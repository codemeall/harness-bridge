import fs from "node:fs";
import path from "node:path";
import {
  byRecency,
  classifyCwd,
  classifyErrorText,
  claudeHome,
  cleanUserText,
  computeEndState,
  isBareCommand,
  isTempPath,
  redactSummary,
  listJsonlFiles,
  mtimeIso,
  normalizeCwd,
  oneLine
} from "./common.js";
import { arr, forEachJsonLine, obj, readHeadRecords, readTailRecords, str } from "./jsonl.js";
import type { PlanItem, ReadStats, SessionAdapter, SessionSummary, TranscriptEvent, WorkspaceInfo } from "./types.js";

/**
 * Claude Code stores one JSONL per session at
 * `~/.claude/projects/<cwd with every non-alphanumeric char replaced by "-">/<session-uuid>.jsonl`.
 * Subagent transcripts live in `<session-uuid>/` beside it and are ignored.
 */
export function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

const FILE_WRITE_TOOLS: Record<string, string> = {
  Edit: "edit",
  MultiEdit: "edit",
  Write: "write",
  NotebookEdit: "edit"
};

// Records that never carry conversation content, or that re-embed request history.
const SKIP_TYPES = new Set([
  "api-request",
  "api-request-blob",
  "api-request-shape",
  "attachment",
  "file-history-snapshot",
  "file-history-delta",
  "mode",
  "permission-mode",
  "atis-latch",
  "cost-state",
  "tools-used",
  "queue-operation",
  "frame-link"
]);

function normalizeStatus(value: unknown): PlanItem["status"] {
  const s = String(value ?? "").toLowerCase().replace(/[-\s]/g, "_");
  if (s === "completed" || s === "complete" || s === "done") return "completed";
  if (s === "in_progress" || s === "active" || s === "doing") return "in_progress";
  return "pending";
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  return arr(content)
    .map((block) => {
      const b = obj(block);
      return b && b.type === "text" ? str(b.text) ?? "" : "";
    })
    .filter(Boolean)
    .join("\n");
}

function summarizeInput(name: string, input: Record<string, unknown>): string {
  const pick = str(input.file_path) ?? str(input.notebook_path) ?? str(input.path) ?? str(input.pattern) ?? str(input.url) ?? str(input.description) ?? str(input.subject) ?? str(input.prompt) ?? str(input.query);
  if (pick) return oneLine(pick, 140);
  const json = JSON.stringify(input);
  return json && json !== "{}" ? oneLine(json, 140) : name;
}

function toolCallEvent(block: Record<string, unknown>, base: Pick<TranscriptEvent, "line" | "timestamp">): TranscriptEvent {
  const name = str(block.name) ?? "tool";
  const input = obj(block.input) ?? {};
  const event: TranscriptEvent = { ...base, kind: "tool_call", tool: name, callId: str(block.id), inputSummary: summarizeInput(name, input) };
  if (name === "Bash") event.command = str(input.command);
  const writeOp = FILE_WRITE_TOOLS[name];
  const target = str(input.file_path) ?? str(input.notebook_path);
  if (writeOp && target) event.files = [{ path: target, op: writeOp }];
  if (name === "TodoWrite") {
    event.plan = arr(input.todos).map((t) => {
      const todo = obj(t) ?? {};
      return { text: str(todo.content) ?? str(todo.activeForm) ?? "", status: normalizeStatus(todo.status) };
    });
  }
  if (name.endsWith("update_plan") && Array.isArray(input.items)) {
    event.plan = arr(input.items).map((t) => {
      const item = obj(t) ?? {};
      return { text: str(item.content) ?? str(item.step) ?? "", status: normalizeStatus(item.status) };
    });
  }
  if (name === "TaskCreate") event.task = { op: "create", subject: str(input.subject) ?? str(input.description) };
  if (name === "TaskUpdate") {
    event.task = { op: "update", id: str(input.taskId) ?? String(input.taskId ?? ""), status: str(input.status), subject: str(input.subject) };
  }
  return event;
}

/** Convert one Claude JSONL record into zero or more normalized events. */
export function parseClaudeRecord(record: Record<string, unknown>, line: number, stats?: ReadStats): TranscriptEvent[] {
  const type = str(record.type);
  if (!type || SKIP_TYPES.has(type)) return [];
  const base = { line, timestamp: str(record.timestamp) };

  if (type === "custom-title") return [{ ...base, kind: "title", text: str(record.customTitle) }];
  if (type === "ai-title") return [{ ...base, kind: "title", text: str(record.aiTitle) }];
  if (type === "continued-in") return [{ ...base, kind: "continued", targetSessionId: str(record.continuedInSessionId) }];
  if (type !== "user" && type !== "assistant") return [];

  if (record.isSidechain === true) {
    if (stats) stats.skippedSidechain += 1;
    return [];
  }
  const message = obj(record.message) ?? {};

  if (type === "assistant") {
    if (record.isApiErrorMessage === true || (record.error && typeof record.error === "string")) {
      const text = flattenContent(message.content);
      return [{ ...base, kind: "error", text, errorKind: classifyErrorText(text, str(record.error)) }];
    }
    const events: TranscriptEvent[] = [];
    for (const raw of arr(message.content)) {
      const block = obj(raw);
      if (!block) continue;
      if (block.type === "text" && str(block.text)?.trim()) {
        events.push({ ...base, kind: "assistant", text: str(block.text), messageId: str(message.id) });
      } else if (block.type === "tool_use") {
        events.push(toolCallEvent(block, base));
      }
    }
    return events;
  }

  // user
  if (record.isMeta === true) return [];
  if (record.isCompactSummary === true) return [{ ...base, kind: "compaction", text: flattenContent(message.content) }];
  const content = message.content;
  if (typeof content === "string") {
    if (/^\s*\[Request interrupted by user/.test(content)) return [{ ...base, kind: "aborted", text: "interrupted by user" }];
    const text = cleanUserText(content);
    return text ? [{ ...base, kind: "user", text }] : [];
  }
  const events: TranscriptEvent[] = [];
  const texts: string[] = [];
  const toolUseResult = obj(record.toolUseResult);
  for (const raw of arr(content)) {
    const block = obj(raw);
    if (!block) continue;
    if (block.type === "tool_result") {
      const text = flattenContent(block.content);
      const exit = text.match(/^Exit code (\d+)/m);
      const event: TranscriptEvent = {
        ...base,
        kind: "tool_result",
        callId: str(block.tool_use_id),
        text,
        isError: block.is_error === true,
        exitCode: exit ? Number(exit[1]) : undefined
      };
      const createdTask = obj(toolUseResult?.task);
      if (createdTask && createdTask.id !== undefined) event.task = { op: "create", id: String(createdTask.id), subject: str(createdTask.subject) };
      events.push(event);
    } else if (block.type === "text" && str(block.text)) {
      if (/^\s*\[Request interrupted by user/.test(str(block.text)!)) {
        events.push({ ...base, kind: "aborted", text: "interrupted by user" });
        continue;
      }
      const cleaned = cleanUserText(str(block.text)!);
      if (cleaned) texts.push(cleaned);
    }
  }
  if (texts.length > 0) events.unshift({ ...base, kind: "user", text: texts.join("\n") });
  return events;
}

function eventsFrom(records: Record<string, unknown>[]): TranscriptEvent[] {
  return records.flatMap((record, index) => parseClaudeRecord(record, index + 1));
}

export const claudeAdapter: SessionAdapter = {
  provider: "claude-code",
  displayName: "Claude Code",

  roots() {
    return [path.join(claudeHome(), "projects")];
  },

  findById(id) {
    if (!/^[A-Za-z0-9-]{8,}$/.test(id)) return undefined;
    const root = this.roots()[0];
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(root);
    } catch {
      return undefined;
    }
    for (const dir of dirs) {
      const candidate = path.join(root, dir, `${id}.jsonl`);
      if (fs.existsSync(candidate)) return candidate;
    }
    return undefined;
  },

  read(file, onEvent) {
    const stats: ReadStats = { lines: 0, malformed: 0, skippedSidechain: 0 };
    const result = forEachJsonLine(file, (record, info) => {
      for (const event of parseClaudeRecord(record, info.line, stats)) onEvent(event);
    });
    stats.lines = result.lines;
    stats.malformed = result.malformed;
    return stats;
  },

  summarize(file, workspace) {
    const size = fs.statSync(file).size;
    const head = readHeadRecords(file, 256 * 1024);
    let tail = readTailRecords(file, 512 * 1024);
    if (size > 512 * 1024 && !tail.some((r) => r.type === "user" || r.type === "assistant")) {
      tail = readTailRecords(file, 8 * 1024 * 1024);
    }
    const firstWithCwd = head.find((r) => typeof r.cwd === "string");
    const cwd = normalizeCwd(str(firstWithCwd?.cwd));
    const headEvents = eventsFrom(head);
    const tailEvents = eventsFrom(tail);
    const titles = [...headEvents, ...tailEvents].filter((e) => e.kind === "title" && e.text);
    const customTitle = [...head, ...tail].filter((r) => r.type === "custom-title").map((r) => str(r.customTitle)).filter(Boolean).pop();
    const firstPrompt = headEvents.find((e) => e.kind === "user" && !isBareCommand(e.text))?.text;
    const lastPromptRecord = [...tail].reverse().find((r) => r.type === "last-prompt");
    const lastPrompt = str(lastPromptRecord?.lastPrompt) ?? [...tailEvents].reverse().find((e) => e.kind === "user")?.text;
    const timestamps = (records: Record<string, unknown>[]) => records.map((r) => str(r.timestamp)).filter((t): t is string => Boolean(t));
    const end = computeEndState(tailEvents);
    const continued = [...tailEvents].reverse().find((e) => e.kind === "continued");
    return redactSummary({
      provider: "claude-code",
      id: path.basename(file, ".jsonl"),
      path: file,
      cwd,
      branch: str(firstWithCwd?.gitBranch),
      title: customTitle && customTitle !== "New session" ? customTitle : titles.pop()?.text ?? (firstPrompt ? oneLine(firstPrompt, 80) : undefined),
      firstPrompt: firstPrompt ? oneLine(firstPrompt, 200) : undefined,
      lastPrompt: lastPrompt ? oneLine(lastPrompt, 200) : undefined,
      startedAt: timestamps(head)[0],
      lastActivityAt: timestamps(tail).pop() ?? mtimeIso(file),
      sizeBytes: size,
      workspaceMatch: workspace ? classifyCwd(cwd, workspace) : "none",
      endState: end.state,
      endDetail: end.detail ? oneLine(end.detail, 160) : undefined,
      continuedIn: continued?.targetSessionId
    } satisfies SessionSummary);
  },

  list(workspace, { limit, hideTemp }) {
    const root = this.roots()[0];
    let dirs: string[];
    try {
      dirs = fs.readdirSync(root).filter((d) => fs.statSync(path.join(root, d)).isDirectory());
    } catch {
      return [];
    }
    const prefix = workspace ? encodeClaudeProjectDir(workspace.root) : undefined;
    const files: { file: string; mtime: number }[] = [];
    for (const dir of dirs) {
      const dirFiles = listJsonlFiles(path.join(root, dir), false);
      if (dirFiles.length === 0) continue;
      if (workspace && dir !== prefix && !dir.startsWith(`${prefix}-`)) {
        // Cheap cwd probe on one file to catch worktrees of the same repo.
        const probe = readHeadRecords(dirFiles[0], 64 * 1024).find((r) => typeof r.cwd === "string");
        const cwd = normalizeCwd(str(probe?.cwd));
        if (!cwd || classifyCwd(cwd, workspace) === "none") continue;
      }
      if (!workspace && hideTemp) {
        const probe = readHeadRecords(dirFiles[0], 64 * 1024).find((r) => typeof r.cwd === "string");
        const cwd = normalizeCwd(str(probe?.cwd));
        if (cwd && isTempPath(cwd)) continue;
      }
      for (const file of dirFiles) files.push({ file, mtime: fs.statSync(file).mtimeMs });
    }
    files.sort((a, b) => b.mtime - a.mtime);
    const out: SessionSummary[] = [];
    for (const { file } of files) {
      if (out.length >= limit) break;
      const summary = this.summarize(file, workspace);
      if (workspace && summary.workspaceMatch === "none") continue;
      out.push(summary);
    }
    return out.sort(byRecency);
  },

  nativeResumeCommand(id) {
    return ["claude", "--resume", id];
  }
};

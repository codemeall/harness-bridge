import fs from "node:fs";
import path from "node:path";
import { byRecency, classifyCwd, classifyErrorText, codexHome, computeEndState, isBareCommand, isTempPath, redactSummary, listJsonlFiles, mtimeIso, normalizeCwd, oneLine } from "./common.js";
import { arr, forEachJsonLine, obj, readHeadRecords, readTailRecords, str } from "./jsonl.js";
import type { PlanItem, ReadStats, SessionAdapter, SessionSummary, TranscriptEvent } from "./types.js";

/**
 * Codex stores rollouts at `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`
 * (archived ones under `archived_sessions/`). Line 1 is `session_meta` with the cwd.
 *
 * Two event layouts exist:
 * - "items": `event_msg` / `item_completed` with typed items (UserMessage, CommandExecution, FileChange, …)
 * - "legacy": `event_msg` user_message/agent_message + `response_item` function calls.
 * The layout is chosen per file so the same turn is never counted twice.
 */
type Layout = "items" | "legacy";

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

function normalizeStatus(value: unknown, completed?: unknown): PlanItem["status"] {
  if (completed === true) return "completed";
  const s = String(value ?? "").toLowerCase().replace(/[-\s]/g, "_");
  if (s === "completed" || s === "complete" || s === "done") return "completed";
  if (s === "in_progress" || s === "active") return "in_progress";
  return "pending";
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  return arr(content)
    .map((c) => str(obj(c)?.text) ?? "")
    .filter(Boolean)
    .join("\n");
}

function commandString(command: unknown): string | undefined {
  if (typeof command === "string") return command;
  const parts = arr(command).map((p) => String(p));
  if (parts.length === 0) return undefined;
  // ["/bin/zsh", "-lc", "<cmd>"] → "<cmd>"
  if (parts.length >= 3 && /(?:^|\/)(?:ba|z|fi)?sh$/.test(parts[0]) && /^-\w*c$/.test(parts[1])) return parts.slice(2).join(" ");
  return parts.join(" ");
}

/** Extract written files from an apply_patch body. */
export function filesFromPatch(patch: string): { path: string; op: string }[] {
  const out: { path: string; op: string }[] = [];
  for (const match of patch.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)) {
    out.push({ path: match[2].trim(), op: match[1].toLowerCase() });
  }
  for (const match of patch.matchAll(/^\*\*\* Move to: (.+)$/gm)) out.push({ path: match[1].trim(), op: "move" });
  return out;
}

function planFrom(value: unknown): PlanItem[] | undefined {
  const items = arr(value);
  if (items.length === 0) return undefined;
  return items.map((raw) => {
    const item = obj(raw) ?? {};
    return { text: str(item.step) ?? str(item.text) ?? str(item.content) ?? "", status: normalizeStatus(item.status, item.completed) };
  });
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return obj(JSON.parse(raw)) ?? {};
    } catch {
      return {};
    }
  }
  return obj(raw) ?? {};
}

function parseItem(item: Record<string, unknown>, base: Pick<TranscriptEvent, "line" | "timestamp">): TranscriptEvent[] {
  const type = str(item.type) ?? "";
  const id = str(item.id);
  switch (type) {
    case "UserMessage": {
      const text = contentText(item.content).trim();
      return text ? [{ ...base, kind: "user", text }] : [];
    }
    case "AgentMessage": {
      const text = contentText(item.content).trim();
      return text ? [{ ...base, kind: "assistant", text, messageId: id }] : [];
    }
    case "CommandExecution": {
      const command = commandString(item.command);
      const exitCode = typeof item.exit_code === "number" ? item.exit_code : undefined;
      const failed = (exitCode !== undefined && exitCode !== 0) || (str(item.status) ?? "completed") !== "completed";
      return [
        { ...base, kind: "tool_call", tool: "shell", callId: id, command, inputSummary: command ? oneLine(command, 140) : "shell" },
        { ...base, kind: "tool_result", callId: id, text: str(item.aggregated_output) ?? "", exitCode, isError: failed }
      ];
    }
    case "FileChange": {
      const changes = obj(item.changes) ?? {};
      const files = Object.entries(changes).map(([file, change]) => ({ path: file, op: str(obj(change)?.type) ?? "update" }));
      const failed = (str(item.status) ?? "completed") !== "completed";
      return [
        { ...base, kind: "tool_call", tool: "apply_patch", callId: id, files, inputSummary: files.map((f) => f.path).join(", ") },
        { ...base, kind: "tool_result", callId: id, text: str(item.stderr) || str(item.stdout) || "", isError: failed }
      ];
    }
    case "McpToolCall": {
      const tool = `${str(item.server) ?? "mcp"}.${str(item.tool) ?? "tool"}`;
      return [{ ...base, kind: "tool_call", tool, callId: id, inputSummary: oneLine(JSON.stringify(item.arguments ?? {}), 140) }];
    }
    case "ContextCompaction":
      return [{ ...base, kind: "compaction" }];
    default: {
      const plan = planFrom(item.items) ?? planFrom(item.plan);
      return plan ? [{ ...base, kind: "tool_call", tool: type || "plan", callId: id, plan }] : [];
    }
  }
}

/** Convert one Codex rollout record into normalized events. */
export function parseCodexRecord(record: Record<string, unknown>, line: number, layout: Layout): TranscriptEvent[] {
  const type = str(record.type);
  const payload = obj(record.payload) ?? {};
  const base = { line, timestamp: str(record.timestamp) };

  if (type === "compacted") {
    const text = str(payload.message);
    return [{ ...base, kind: "compaction", text }];
  }

  if (type === "event_msg") {
    const kind = str(payload.type);
    if (kind === "item_completed" && layout === "items") return parseItem(obj(payload.item) ?? {}, base);
    if (kind === "error" || kind === "stream_error") {
      const text = str(payload.message) ?? JSON.stringify(payload);
      return [{ ...base, kind: "error", text, errorKind: classifyErrorText(text, str(payload.codex_error_info) ?? JSON.stringify(payload.codex_error_info ?? "")) }];
    }
    if (kind === "turn_aborted") return [{ ...base, kind: "aborted", text: str(payload.reason) }];
    if (kind === "token_count") {
      const limits = obj(payload.rate_limits);
      const exhausted = ["primary", "secondary"].some((k) => Number(obj(limits?.[k])?.used_percent ?? 0) >= 100);
      return exhausted ? [{ ...base, kind: "error", text: "rate limit window at 100%", errorKind: "usage-limit" }] : [];
    }
    if (layout === "legacy") {
      if (kind === "user_message") {
        const text = str(payload.message)?.trim();
        return text ? [{ ...base, kind: "user", text }] : [];
      }
      if (kind === "agent_message") {
        const text = str(payload.message)?.trim();
        return text ? [{ ...base, kind: "assistant", text }] : [];
      }
    }
    return [];
  }

  // Plans only arrive as update_plan calls, in both layouts.
  if (type === "response_item" && layout === "items" && payload.type === "function_call" && payload.name === "update_plan") {
    const plan = planFrom(parseArgs(payload.arguments).plan);
    return plan ? [{ ...base, kind: "tool_call", tool: "update_plan", callId: str(payload.call_id), plan }] : [];
  }

  if (type === "response_item" && layout === "legacy") {
    const kind = str(payload.type);
    const callId = str(payload.call_id) ?? str(payload.id);
    if (kind === "function_call" || kind === "custom_tool_call" || kind === "local_shell_call") {
      const name = str(payload.name) ?? kind;
      const args = kind === "custom_tool_call" ? {} : parseArgs(payload.arguments ?? obj(payload.action));
      const event: TranscriptEvent = { ...base, kind: "tool_call", tool: name, callId };
      if (name === "apply_patch") {
        const patch = kind === "custom_tool_call" ? str(payload.input) ?? "" : str(args.input) ?? str(args.patch) ?? "";
        event.files = filesFromPatch(patch);
        event.inputSummary = event.files.map((f) => f.path).join(", ");
      } else if (name === "update_plan") {
        event.plan = planFrom(args.plan);
      } else if (name === "shell" || name === "container.exec" || name === "exec_command" || kind === "local_shell_call") {
        event.command = commandString(args.command ?? args.cmd);
        event.inputSummary = event.command ? oneLine(event.command, 140) : name;
      } else {
        event.inputSummary = oneLine(kind === "custom_tool_call" ? str(payload.input) ?? name : JSON.stringify(args), 140);
      }
      return [event];
    }
    if (kind === "function_call_output" || kind === "custom_tool_call_output") {
      const output = payload.output;
      let text = typeof output === "string" ? output : contentText(output);
      let exitCode: number | undefined;
      const parsed = typeof output === "string" ? parseArgs(output) : {};
      if (typeof parsed.output === "string") text = parsed.output;
      const meta = obj(parsed.metadata);
      if (typeof meta?.exit_code === "number") exitCode = meta.exit_code;
      const exitMatch = text.match(/(?:Exit code|exit_code)[:\s]+(\d+)/i);
      if (exitCode === undefined && exitMatch) exitCode = Number(exitMatch[1]);
      return [{ ...base, kind: "tool_result", callId, text, exitCode, isError: exitCode !== undefined && exitCode !== 0 }];
    }
  }
  return [];
}

function detectLayout(file: string): Layout {
  const head = readHeadRecords(file, 2 * 1024 * 1024);
  return head.some((r) => r.type === "event_msg" && obj(r.payload)?.type === "item_completed") ? "items" : "legacy";
}

function readMeta(file: string): Record<string, unknown> | undefined {
  for (const limit of [256 * 1024, 4 * 1024 * 1024]) {
    const record = readHeadRecords(file, limit).find((r) => r.type === "session_meta");
    if (record) return obj(record.payload);
  }
  return undefined;
}

let titleCache: { mtime: number; titles: Map<string, string> } | undefined;

function threadTitles(): Map<string, string> {
  const index = path.join(codexHome(), "session_index.jsonl");
  let mtime = 0;
  try {
    mtime = fs.statSync(index).mtimeMs;
  } catch {
    return new Map();
  }
  if (titleCache?.mtime === mtime) return titleCache.titles;
  const titles = new Map<string, string>();
  forEachJsonLine(index, (record) => {
    const id = str(record.id);
    const name = str(record.thread_name);
    if (id && name) titles.set(id, name);
  });
  titleCache = { mtime, titles };
  return titles;
}

export const codexAdapter: SessionAdapter = {
  provider: "codex",
  displayName: "Codex",

  roots() {
    return [path.join(codexHome(), "sessions"), path.join(codexHome(), "archived_sessions")];
  },

  findById(id) {
    if (!/^[A-Za-z0-9-]{8,}$/.test(id)) return undefined;
    for (const root of this.roots()) {
      const match = listJsonlFiles(root, true).find((file) => file.endsWith(`${id}.jsonl`));
      if (match) return match;
    }
    return undefined;
  },

  read(file, onEvent) {
    const layout = detectLayout(file);
    const result = forEachJsonLine(file, (record, info) => {
      for (const event of parseCodexRecord(record, info.line, layout)) onEvent(event);
    });
    return { lines: result.lines, malformed: result.malformed, skippedSidechain: 0 };
  },

  summarize(file, workspace) {
    const size = fs.statSync(file).size;
    const meta = readMeta(file) ?? {};
    const layout = detectLayout(file);
    const id = str(meta.id) ?? file.match(UUID)?.[1] ?? path.basename(file, ".jsonl");
    const cwd = normalizeCwd(str(meta.cwd));
    const headEvents = readHeadRecords(file, 512 * 1024).flatMap((r, i) => parseCodexRecord(r, i + 1, layout));
    const tailRecords = readTailRecords(file, 1024 * 1024);
    const tailEvents = tailRecords.flatMap((r, i) => parseCodexRecord(r, i + 1, layout));
    const firstPrompt = headEvents.find((e) => e.kind === "user" && !isBareCommand(e.text))?.text;
    const lastPrompt = [...tailEvents].reverse().find((e) => e.kind === "user")?.text;
    const end = computeEndState(tailEvents);
    const lastTs = tailRecords.map((r) => str(r.timestamp)).filter(Boolean).pop();
    return redactSummary({
      provider: "codex",
      id,
      path: file,
      cwd,
      branch: str(obj(meta.git)?.branch),
      title: threadTitles().get(id) ?? (firstPrompt ? oneLine(firstPrompt, 80) : undefined),
      firstPrompt: firstPrompt ? oneLine(firstPrompt, 200) : undefined,
      lastPrompt: lastPrompt ? oneLine(lastPrompt, 200) : undefined,
      startedAt: str(meta.timestamp),
      lastActivityAt: lastTs ?? mtimeIso(file),
      sizeBytes: size,
      workspaceMatch: workspace ? classifyCwd(cwd, workspace) : "none",
      endState: end.state,
      endDetail: end.detail ? oneLine(end.detail, 160) : undefined
    } satisfies SessionSummary);
  },

  list(workspace, { limit, hideTemp }) {
    const files = this.roots()
      .flatMap((root) => listJsonlFiles(root, true))
      .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 2000);
    const out: SessionSummary[] = [];
    for (const { file } of files) {
      if (out.length >= limit) break;
      const cwd = normalizeCwd(str(readMeta(file)?.cwd));
      if (workspace ? classifyCwd(cwd, workspace) === "none" : hideTemp && cwd !== undefined && isTempPath(cwd)) continue;
      out.push(this.summarize(file, workspace));
    }
    return out.sort(byRecency);
  },

  nativeResumeCommand(id) {
    return ["codex", "resume", id];
  }
};

import { computeEndState, isAfter, isBareCommand, oneLine, truncate } from "../sessions/common.js";
import type { PlanItem, ReadStats, SessionEndState, TranscriptEvent } from "../sessions/types.js";

/** Fixed-size buffer keeping the newest N items. */
class Ring<T> {
  items: T[] = [];
  constructor(private readonly size: number) {}
  push(item: T) {
    this.items.push(item);
    if (this.items.length > this.size) this.items.shift();
  }
  last(): T | undefined {
    return this.items[this.items.length - 1];
  }
}

export interface PromptRef {
  line: number;
  timestamp?: string;
  text: string;
}

export interface FileActivity {
  path: string;
  ops: Record<string, number>;
  firstLine: number;
  lastLine: number;
  lastTimestamp?: string;
}

export interface CommandRun {
  line: number;
  timestamp?: string;
  command: string;
  exitCode?: number;
  isError?: boolean;
  outputTail?: string;
  completed: boolean;
}

export interface TaskState {
  items: PlanItem[];
  source: string;
  line: number;
}

export interface Collected {
  stats: ReadStats;
  eventCount: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  title?: string;
  goal: PromptRef[];
  promptCount: number;
  recentPrompts: PromptRef[];
  recentAssistant: PromptRef[];
  compaction?: PromptRef;
  compactionCount: number;
  plan?: TaskState;
  tasks?: TaskState;
  files: FileActivity[];
  commands: CommandRun[];
  checks: CommandRun[];
  errors: PromptRef[];
  tail: string[];
  end: { state: SessionEndState; detail?: string; line?: number };
  since?: { timestamp: string; events: number; prompts: PromptRef[]; files: string[] };
}

const VERIFY_COMMAND =
  /\b(?:test|tests|vitest|jest|pytest|mocha|tsc|typecheck|lint|eslint|build|check|cargo (?:test|build|check|clippy)|go (?:test|build|vet)|mvn|gradle|xcodebuild|swift (?:test|build)|flutter (?:test|analyze)|playwright|cypress)\b/i;

const MAX_FILES = 200;

export function describeEvent(event: TranscriptEvent, includeOutput = false): string {
  const at = `L${event.line}`;
  switch (event.kind) {
    case "user":
      return `${at} [user] ${oneLine(event.text ?? "", 400)}`;
    case "assistant":
      return `${at} [assistant] ${oneLine(event.text ?? "", 400)}`;
    case "tool_call":
      return `${at} [${event.tool}] ${oneLine(event.command ?? event.inputSummary ?? "", 240)}`;
    case "tool_result": {
      const status = event.exitCode !== undefined ? `exit=${event.exitCode}` : event.isError ? "error" : "ok";
      const body = event.text ?? "";
      return includeOutput
        ? `${at} [result ${status}] ${oneLine(body, 600)}`
        : `${at} [result ${status}] (${body.length} chars${event.isError ? ", error" : ""})`;
    }
    case "error":
      return `${at} [error:${event.errorKind}] ${oneLine(event.text ?? "", 240)}`;
    case "aborted":
      return `${at} [aborted] ${event.text ?? ""}`;
    case "compaction":
      return `${at} [compaction] ${oneLine(event.text ?? "(provider compacted earlier context)", 200)}`;
    case "title":
      return `${at} [title] ${event.text ?? ""}`;
    case "continued":
      return `${at} [continued-in] ${event.targetSessionId ?? ""}`;
  }
}

export interface CollectOptions {
  /** Only count events after this ISO timestamp in `since` (e.g. bridge last_updated). */
  since?: string;
}

/** Single-pass reducer over normalized events. Memory is bounded regardless of transcript size. */
export function createCollector(options: CollectOptions = {}) {
  const goal: PromptRef[] = [];
  const recentPrompts = new Ring<PromptRef>(10);
  const recentAssistant = new Ring<PromptRef>(6);
  const commands = new Ring<CommandRun>(12);
  const checks = new Ring<CommandRun>(6);
  const errors = new Ring<PromptRef>(5);
  const tail = new Ring<string>(30);
  const endWindow = new Ring<TranscriptEvent>(40);
  const files = new Map<string, FileActivity>();
  const openCommands = new Map<string, CommandRun>();
  const pendingTaskCreates = new Map<string, string>();
  const taskMap = new Map<string, PlanItem>();
  let tasksLine = 0;
  let plan: TaskState | undefined;
  let compaction: PromptRef | undefined;
  let compactionCount = 0;
  let promptCount = 0;
  let eventCount = 0;
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;
  let title: string | undefined;
  const since = options.since ? { timestamp: options.since, events: 0, prompts: [] as PromptRef[], files: new Set<string>() } : undefined;

  function onEvent(event: TranscriptEvent) {
    eventCount += 1;
    if (event.timestamp) {
      firstTimestamp ??= event.timestamp;
      lastTimestamp = event.timestamp;
    }
    const afterSince = since && isAfter(event.timestamp, since.timestamp);
    if (afterSince) since.events += 1;
    if (event.kind !== "title") endWindow.push(event);
    if (event.kind !== "title" && event.kind !== "tool_result") tail.push(describeEvent(event));

    switch (event.kind) {
      case "title":
        if (event.text) title = event.text;
        break;
      case "user": {
        promptCount += 1;
        const ref = { line: event.line, timestamp: event.timestamp, text: event.text ?? "" };
        // Re-sent prompts (retries, queued duplicates) add no information.
        if (ref.text === recentPrompts.last()?.text || goal.some((g) => g.text === ref.text)) break;
        if (goal.length < 2 && !isBareCommand(ref.text)) goal.push(ref);
        recentPrompts.push(ref);
        if (afterSince && since.prompts.length < 10) since.prompts.push(ref);
        break;
      }
      case "assistant": {
        const last = recentAssistant.last();
        if (last && event.messageId && (last as PromptRef & { id?: string }).id === event.messageId) {
          last.text = `${last.text}\n${event.text ?? ""}`;
        } else {
          recentAssistant.push(Object.assign({ line: event.line, timestamp: event.timestamp, text: event.text ?? "" }, { id: event.messageId }));
        }
        break;
      }
      case "compaction":
        compactionCount += 1;
        if (event.text) compaction = { line: event.line, timestamp: event.timestamp, text: event.text };
        break;
      case "error":
        errors.push({ line: event.line, timestamp: event.timestamp, text: `${event.errorKind}: ${event.text ?? ""}` });
        break;
      case "tool_call": {
        for (const file of event.files ?? []) {
          let entry = files.get(file.path);
          if (!entry) {
            if (files.size >= MAX_FILES) continue;
            entry = { path: file.path, ops: {}, firstLine: event.line, lastLine: event.line };
            files.set(file.path, entry);
          }
          entry.ops[file.op] = (entry.ops[file.op] ?? 0) + 1;
          entry.lastLine = event.line;
          entry.lastTimestamp = event.timestamp;
          if (afterSince) since.files.add(file.path);
        }
        if (event.command) {
          const run: CommandRun = { line: event.line, timestamp: event.timestamp, command: event.command, completed: false };
          commands.push(run);
          if (VERIFY_COMMAND.test(event.command)) checks.push(run);
          if (event.callId) openCommands.set(event.callId, run);
        }
        if (event.plan) plan = { items: event.plan.filter((item) => item.text), source: event.tool ?? "plan", line: event.line };
        if (event.task?.op === "create" && event.callId) pendingTaskCreates.set(event.callId, event.task.subject ?? "");
        if (event.task?.op === "update" && event.task.id) {
          const item = taskMap.get(event.task.id);
          if (item) {
            if (event.task.status === "deleted") taskMap.delete(event.task.id);
            else {
              if (event.task.status) item.status = normalizeTaskStatus(event.task.status);
              if (event.task.subject) item.text = event.task.subject;
            }
            tasksLine = event.line;
          }
        }
        break;
      }
      case "tool_result": {
        const run = event.callId ? openCommands.get(event.callId) : undefined;
        if (run && event.callId) {
          run.completed = true;
          run.exitCode = event.exitCode;
          run.isError = event.isError;
          const text = (event.text ?? "").trim();
          if (text) run.outputTail = truncate(text.slice(-400), 400);
          openCommands.delete(event.callId);
        }
        if (event.task?.op === "create" && event.task.id) {
          const subject = (event.callId && pendingTaskCreates.get(event.callId)) || event.task.subject || `Task ${event.task.id}`;
          taskMap.set(event.task.id, { id: event.task.id, text: subject, status: "pending" });
          if (event.callId) pendingTaskCreates.delete(event.callId);
          tasksLine = event.line;
        }
        break;
      }
      default:
        break;
    }
  }

  function finish(stats: ReadStats): Collected {
    return {
      stats,
      eventCount,
      firstTimestamp,
      lastTimestamp,
      title,
      goal,
      promptCount,
      recentPrompts: recentPrompts.items,
      recentAssistant: recentAssistant.items.map(({ line, timestamp, text }) => ({ line, timestamp, text })),
      compaction,
      compactionCount,
      plan,
      tasks: taskMap.size > 0 ? { items: [...taskMap.values()], source: "TaskCreate/TaskUpdate", line: tasksLine } : undefined,
      files: [...files.values()],
      commands: commands.items,
      checks: checks.items,
      errors: errors.items,
      tail: tail.items,
      end: computeEndState(endWindow.items),
      since: since ? { timestamp: since.timestamp, events: since.events, prompts: since.prompts, files: [...since.files] } : undefined
    };
  }

  return { onEvent, finish };
}

function normalizeTaskStatus(status: string): PlanItem["status"] {
  const s = status.toLowerCase();
  if (s === "completed" || s === "done") return "completed";
  if (s === "in_progress") return "in_progress";
  return "pending";
}

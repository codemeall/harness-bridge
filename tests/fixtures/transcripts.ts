import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Isolated provider homes + a git workspace. Sets CLAUDE_CONFIG_DIR / CODEX_HOME. */
export interface Sandbox {
  base: string;
  workspace: string;
  claudeHome: string;
  codexHome: string;
  cleanup(): void;
}

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function createSandbox(name = "linkzly"): Sandbox {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hb-recovery-")));
  const workspace = path.join(base, "projects", name);
  fs.mkdirSync(workspace, { recursive: true });
  git(workspace, ["init", "-q", "-b", "main"]);
  git(workspace, ["config", "user.email", "test@example.com"]);
  git(workspace, ["config", "user.name", "Harness Test"]);
  fs.writeFileSync(path.join(workspace, "README.md"), "# Fixture\n");
  git(workspace, ["add", "."]);
  git(workspace, ["commit", "-q", "-m", "initial", "--date=2026-01-01T00:00:00Z"]);
  const claudeHome = path.join(base, "claude-home");
  const codexHome = path.join(base, "codex-home");
  fs.mkdirSync(path.join(claudeHome, "projects"), { recursive: true });
  fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
  const previous = { claude: process.env.CLAUDE_CONFIG_DIR, codex: process.env.CODEX_HOME };
  process.env.CLAUDE_CONFIG_DIR = claudeHome;
  process.env.CODEX_HOME = codexHome;
  return {
    base,
    workspace,
    claudeHome,
    codexHome,
    cleanup() {
      if (previous.claude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous.claude;
      if (previous.codex === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previous.codex;
      fs.rmSync(base, { recursive: true, force: true });
    }
  };
}

let clock = Date.parse("2026-10-27T10:00:00Z");
export function tick(seconds = 30): string {
  clock += seconds * 1000;
  return new Date(clock).toISOString();
}
export function setClock(iso: string) {
  clock = Date.parse(iso);
}

type Line = Record<string, unknown> | string;

/** Builder for Claude Code transcripts with the record shapes observed in Claude Code 2.1. */
export class ClaudeTranscript {
  lines: Line[] = [];
  private parent: string | null = null;
  constructor(readonly cwd: string, readonly id = randomUUID(), readonly branch = "main") {}

  private base(type: string, extra: Record<string, unknown> = {}) {
    const uuid = randomUUID();
    const record = { type, uuid, parentUuid: this.parent, sessionId: this.id, cwd: this.cwd, gitBranch: this.branch, version: "2.1.311", isSidechain: false, timestamp: tick(), ...extra };
    this.parent = uuid;
    return record;
  }
  user(text: string, extra: Record<string, unknown> = {}) {
    this.lines.push(this.base("user", { message: { role: "user", content: text }, ...extra }));
    return this;
  }
  text(text: string, messageId = `msg_${randomUUID()}`) {
    this.lines.push(this.base("assistant", { message: { id: messageId, role: "assistant", content: [{ type: "text", text }] } }));
    return this;
  }
  tool(name: string, input: Record<string, unknown>, result?: { content: string; isError?: boolean; toolUseResult?: unknown }) {
    const id = `toolu_${randomUUID().slice(0, 12)}`;
    this.lines.push(this.base("assistant", { message: { id: `msg_${randomUUID()}`, role: "assistant", content: [{ type: "tool_use", id, name, input }] } }));
    if (result) {
      this.lines.push(
        this.base("user", {
          message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: result.content, is_error: result.isError ?? false }] },
          toolUseResult: result.toolUseResult
        })
      );
    }
    return this;
  }
  taskCreate(taskId: string, subject: string) {
    return this.tool("TaskCreate", { subject, description: subject, activeForm: subject }, { content: `Task #${taskId} created successfully: ${subject}`, toolUseResult: { task: { id: taskId, subject } } });
  }
  taskUpdate(taskId: string, status: string) {
    return this.tool("TaskUpdate", { taskId, status }, { content: `Updated task #${taskId} status`, toolUseResult: { success: true, taskId } });
  }
  usageLimit(text = "You've hit your session limit · resets 8pm (Asia/Calcutta)") {
    this.lines.push(this.base("assistant", { isApiErrorMessage: true, error: "rate_limit", message: { role: "assistant", content: [{ type: "text", text }] } }));
    return this;
  }
  compact(summary: string) {
    this.lines.push(this.base("user", { isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: "user", content: summary } }));
    return this;
  }
  meta(type: string, extra: Record<string, unknown>) {
    this.lines.push({ type, sessionId: this.id, ...extra });
    return this;
  }
  sidechain(text: string) {
    this.lines.push(this.base("user", { isSidechain: true, message: { role: "user", content: text } }));
    return this;
  }
  raw(line: string) {
    this.lines.push(line);
    return this;
  }
  /** Writes to `<claudeHome>/projects/<encoded cwd>/<id>.jsonl`. */
  write(claudeHome: string, options: { truncateLastLine?: boolean } = {}): string {
    const dir = path.join(claudeHome, "projects", this.cwd.replace(/[^A-Za-z0-9]/g, "-"));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${this.id}.jsonl`);
    let body = this.lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n";
    if (options.truncateLastLine) body = body.slice(0, body.length - 20);
    fs.writeFileSync(file, body);
    return file;
  }
}

/** Builder for Codex rollouts. `layout: "items"` mimics Codex Desktop 0.164; "legacy" the older CLI format. */
export class CodexRollout {
  lines: Line[] = [];
  constructor(readonly cwd: string, readonly layout: "items" | "legacy" = "items", readonly id = randomUUID()) {
    this.lines.push({ type: "session_meta", timestamp: tick(), payload: { id, session_id: id, timestamp: tick(0), cwd, originator: "codex_cli", cli_version: "0.164.0", git: { branch: "main" }, base_instructions: { text: "x".repeat(2000) } } });
    this.lines.push({ type: "response_item", timestamp: tick(0), payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>injected</environment_context>" }] } });
  }
  private item(item: Record<string, unknown>) {
    this.lines.push({ type: "event_msg", timestamp: tick(), payload: { type: "item_completed", item } });
  }
  user(text: string) {
    if (this.layout === "items") this.item({ type: "UserMessage", id: randomUUID(), content: [{ type: "text", text }] });
    else this.lines.push({ type: "event_msg", timestamp: tick(), payload: { type: "user_message", message: text } });
    return this;
  }
  agent(text: string) {
    if (this.layout === "items") this.item({ type: "AgentMessage", id: randomUUID(), content: [{ type: "Text", text }], phase: "final_answer" });
    else this.lines.push({ type: "event_msg", timestamp: tick(), payload: { type: "agent_message", message: text } });
    return this;
  }
  command(cmd: string, exitCode: number, output = "") {
    if (this.layout === "items") {
      this.item({ type: "CommandExecution", id: `exec-${randomUUID()}`, command: ["/bin/zsh", "-lc", cmd], cwd: `file://${this.cwd}`, status: "completed", aggregated_output: output, exit_code: exitCode });
    } else {
      const callId = `call_${randomUUID().slice(0, 8)}`;
      this.lines.push({ type: "response_item", timestamp: tick(), payload: { type: "function_call", name: "shell", call_id: callId, arguments: JSON.stringify({ command: ["bash", "-lc", cmd] }) } });
      this.lines.push({ type: "response_item", timestamp: tick(), payload: { type: "function_call_output", call_id: callId, output: JSON.stringify({ output, metadata: { exit_code: exitCode } }) } });
    }
    return this;
  }
  patch(files: { path: string; op: "add" | "update" | "delete" }[]) {
    if (this.layout === "items") {
      const changes = Object.fromEntries(files.map((f) => [path.join(this.cwd, f.path), { type: f.op, unified_diff: "" }]));
      this.item({ type: "FileChange", id: `exec-${randomUUID()}`, changes, status: "completed", stdout: "Success", stderr: "" });
    } else {
      const body = ["*** Begin Patch", ...files.map((f) => `*** ${f.op[0].toUpperCase()}${f.op.slice(1)} File: ${f.path}`), "*** End Patch"].join("\n");
      this.lines.push({ type: "response_item", timestamp: tick(), payload: { type: "custom_tool_call", name: "apply_patch", call_id: `call_${randomUUID().slice(0, 8)}`, input: body } });
    }
    return this;
  }
  plan(items: { step: string; status: string }[]) {
    this.lines.push({ type: "response_item", timestamp: tick(), payload: { type: "function_call", name: "update_plan", call_id: `call_${randomUUID().slice(0, 8)}`, arguments: JSON.stringify({ plan: items }) } });
    return this;
  }
  error(message: string) {
    this.lines.push({ type: "event_msg", timestamp: tick(), payload: { type: "error", message } });
    return this;
  }
  aborted() {
    this.lines.push({ type: "event_msg", timestamp: tick(), payload: { type: "turn_aborted", reason: "interrupted" } });
    return this;
  }
  write(codexHome: string): string {
    const dir = path.join(codexHome, "sessions", "2026", "10", "27");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollout-2026-10-27T10-00-00-${this.id}.jsonl`);
    fs.writeFileSync(file, this.lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
    return file;
  }
}

/** A PATH directory holding fake provider binaries that record any invocation. */
export function fakeBin(base: string, binaries: string[]): { dir: string; marker: string } {
  const dir = path.join(base, `bin-${binaries.join("-") || "empty"}`);
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(base, "provider-invoked.log");
  for (const name of binaries) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/bin/sh\necho "${name} $*" >> "${marker}"\n`);
    fs.chmodSync(file, 0o755);
  }
  return { dir, marker };
}

export function commitFile(workspace: string, rel: string, content: string, message: string, date?: string) {
  const file = path.join(workspace, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  git(workspace, ["add", rel]);
  const env = date ? { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : process.env;
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: workspace, env, stdio: "ignore" });
}

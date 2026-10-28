import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitCommonDir } from "../core/git.js";
import { redactSecrets } from "../core/secrets.js";
import type { SessionEndState, TranscriptEvent, WorkspaceInfo, WorkspaceMatch } from "./types.js";

export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

export function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export function realpathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** Normalise `file:///x` URLs (Codex) and trailing slashes. */
export function normalizeCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  let value = cwd;
  if (value.startsWith("file://")) {
    try {
      value = decodeURIComponent(new URL(value).pathname);
    } catch {
      value = value.slice("file://".length);
    }
  }
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

const TEMP_PREFIXES = [os.tmpdir(), "/tmp", "/private/tmp", "/private/var/folders", "/var/folders"].map((p) => realpathOrSelf(p));

export function isTempPath(p: string): boolean {
  return TEMP_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

const commonDirCache = new Map<string, string | undefined>();

/**
 * Relate a session's recorded cwd to the workspace. Never decodes directory
 * names back into paths: classification always uses the recorded cwd.
 */
export function classifyCwd(cwd: string | undefined, workspace: WorkspaceInfo): WorkspaceMatch {
  const value = normalizeCwd(cwd);
  if (!value) return "none";
  const candidates = new Set([value, realpathOrSelf(value)]);
  for (const candidate of candidates) {
    if (candidate === workspace.root) return "exact";
    if (candidate.startsWith(`${workspace.root}/`)) return "subdir";
  }
  if (fs.existsSync(value)) {
    if (workspace.commonDir) {
      if (!commonDirCache.has(value)) commonDirCache.set(value, gitCommonDir(value));
      if (commonDirCache.get(value) === workspace.commonDir) return "worktree";
    }
    return "none";
  }
  // Deleted worktree (e.g. ~/.t3/worktrees/<repo>/<branch>): only a hint, never a match.
  const segments = value.split("/");
  return segments.includes(workspace.name) ? "possible" : "none";
}

/** Redact the free-text fields of a summary; listings leave the machine via MCP. */
export function redactSummary<T extends { title?: string; firstPrompt?: string; lastPrompt?: string; endDetail?: string }>(summary: T): T {
  const clean = (value?: string) => (value === undefined ? undefined : redactSecrets(value));
  return { ...summary, title: clean(summary.title), firstPrompt: clean(summary.firstPrompt), lastPrompt: clean(summary.lastPrompt), endDetail: clean(summary.endDetail) };
}

/** Compare ISO-8601 timestamps by instant (offsets like +05:30 are common). */
export function isAfter(a: string | undefined, b: string | undefined): boolean {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  return Number.isFinite(ta) && Number.isFinite(tb) && ta > tb;
}

export function byRecency(a: { lastActivityAt?: string }, b: { lastActivityAt?: string }): number {
  return (Date.parse(b.lastActivityAt ?? "") || 0) - (Date.parse(a.lastActivityAt ?? "") || 0);
}

const USAGE_LIMIT_TEXT = /hit your (?:session |usage |weekly |daily |5-hour )?limit|usage limit|rate limit|quota exceeded|limit reached|resets? (?:at|in) /i;
const AUTH_TEXT = /login expired|please run \/login|authentication|unauthori[sz]ed|invalid api key|not logged in/i;

export function classifyErrorText(text: string | undefined, hint?: string): "usage-limit" | "auth" | "api" {
  const h = (hint ?? "").toLowerCase();
  if (h.includes("rate_limit") || h.includes("usage_limit") || h.includes("quota")) return "usage-limit";
  if (h.includes("auth")) return "auth";
  if (text && USAGE_LIMIT_TEXT.test(text)) return "usage-limit";
  if (text && AUTH_TEXT.test(text)) return "auth";
  return "api";
}

/** Read the end state from the last meaningful events. */
export function computeEndState(events: TranscriptEvent[]): { state: SessionEndState; detail?: string; line?: number } {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    switch (event.kind) {
      case "title":
      case "continued":
        continue;
      case "tool_result":
        return { state: "awaiting-response", detail: "last record is a tool result with no assistant reply", line: event.line };
      case "error": {
        const state = event.errorKind === "usage-limit" ? "usage-limit" : event.errorKind === "auth" ? "auth-error" : "api-error";
        return { state, detail: event.text, line: event.line };
      }
      case "aborted":
        return { state: "interrupted", detail: event.text, line: event.line };
      case "tool_call":
        return { state: "mid-tool-call", detail: `${event.tool ?? "tool"} call without a result`, line: event.line };
      case "user":
        return { state: "awaiting-response", detail: "last user message has no reply", line: event.line };
      case "assistant":
        return { state: "turn-complete", line: event.line };
      case "compaction":
        return { state: "unknown", detail: "ended right after a compaction", line: event.line };
    }
  }
  return { state: "unknown" };
}

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function oneLine(text: string, max: number): string {
  return truncate(text.replace(/\s+/g, " "), max);
}

/** A bare slash command such as `/clear` or `/model` says nothing about the task. */
export function isBareCommand(text: string | undefined): boolean {
  return !text || /^\/[\w:.-]+\s*$/.test(text.trim());
}

/** Strip harness-injected wrappers so only what the human typed remains. */
export function cleanUserText(raw: string): string | undefined {
  let text = raw;
  const command = text.match(/<command-name>([^<]*)<\/command-name>/);
  if (command) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim() ?? "";
    return `${command[1].trim()}${args ? ` ${args}` : ""}`;
  }
  if (/^\s*<(local-command-stdout|local-command-stderr|local-command-caveat|bash-stdout|bash-stderr)>/.test(text)) return undefined;
  text = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .replace(/<\/?pasted_content[^>]*>/g, "")
    .trim();
  if (!text) return undefined;
  if (/^\[Request interrupted by user/.test(text)) return undefined;
  return text;
}

export function listJsonlFiles(dir: string, recursive: boolean): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full);
    else if (recursive && entry.isDirectory()) out.push(...listJsonlFiles(full, true));
  }
  return out;
}

export function mtimeIso(file: string): string {
  return fs.statSync(file).mtime.toISOString();
}

export type ProviderId = "claude-code" | "codex";

/** How a session's recorded cwd relates to the workspace being recovered. */
export type WorkspaceMatch = "exact" | "subdir" | "worktree" | "possible" | "none";

/**
 * Best-effort reason the session stopped, read from its final records.
 * `usage-limit` / `auth-error` / `api-error` come from explicit provider error records.
 */
export type SessionEndState =
  | "usage-limit"
  | "auth-error"
  | "api-error"
  | "interrupted"
  | "mid-tool-call"
  | "awaiting-response"
  | "turn-complete"
  | "unknown";

export interface WorkspaceInfo {
  /** Realpath of the git top-level (or the directory itself outside git). */
  root: string;
  /** Shared git dir, used to recognise worktrees of the same repo. */
  commonDir?: string;
  name: string;
}

export interface SessionSummary {
  provider: ProviderId;
  id: string;
  path: string;
  cwd?: string;
  branch?: string;
  title?: string;
  firstPrompt?: string;
  lastPrompt?: string;
  startedAt?: string;
  lastActivityAt?: string;
  sizeBytes: number;
  workspaceMatch: WorkspaceMatch;
  endState: SessionEndState;
  endDetail?: string;
  continuedIn?: string;
}

export interface PlanItem {
  id?: string;
  text: string;
  status: "pending" | "in_progress" | "completed";
}

export type EventKind = "user" | "assistant" | "tool_call" | "tool_result" | "error" | "compaction" | "aborted" | "title" | "continued";

/** Provider-neutral transcript event. Text fields are raw (redaction happens on output). */
export interface TranscriptEvent {
  line: number;
  timestamp?: string;
  kind: EventKind;
  text?: string;
  /** Groups split assistant records that belong to one message. */
  messageId?: string;
  tool?: string;
  callId?: string;
  command?: string;
  /** Files written by this tool call (absolute or as recorded). */
  files?: { path: string; op: string }[];
  /** Full plan snapshot (TodoWrite / update_plan). */
  plan?: PlanItem[];
  /** Incremental task operation (Claude TaskCreate / TaskUpdate). */
  task?: { op: "create" | "update"; id?: string; subject?: string; status?: string };
  isError?: boolean;
  exitCode?: number;
  /** Short tool input summary for display. */
  inputSummary?: string;
  /** Error category for kind=error. */
  errorKind?: "usage-limit" | "auth" | "api";
  /** Linked session id for kind=continued. */
  targetSessionId?: string;
}

export interface ReadStats {
  lines: number;
  malformed: number;
  skippedSidechain: number;
}

export interface SessionAdapter {
  provider: ProviderId;
  displayName: string;
  /** Directories that may contain this provider's transcripts. */
  roots(): string[];
  /** `hideTemp` drops sessions recorded in temp/scratch dirs when listing without a workspace filter. */
  list(workspace: WorkspaceInfo | undefined, options: { limit: number; hideTemp?: boolean }): SessionSummary[];
  /** Locate a transcript by provider session id. */
  findById(id: string): string | undefined;
  /** Stream normalized events in file order. */
  read(file: string, onEvent: (event: TranscriptEvent) => void): ReadStats;
  summarize(file: string, workspace: WorkspaceInfo | undefined): SessionSummary;
  /** argv to resume the session natively with this provider's own CLI. */
  nativeResumeCommand(id: string): string[];
}

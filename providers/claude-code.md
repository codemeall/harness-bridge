# Claude Code · Harness Bridge

Notes specific to using Harness Bridge with [Claude Code](https://github.com/anthropics/claude-code), Anthropic's terminal-based coding agent.

## Instructions file
- **Path:** `CLAUDE.md` at repo root.
- **Loaded:** automatically on session start, injected as a system reminder.
- **Install behavior:** `prompts/init.md` appends a `## Harness Bridge — keep .harness/bridge.md current` section. Existing `CLAUDE.md` content is preserved.

## Init / Producer / Consumer / Recover / Uninstall
Use the `/handoff` and `/pickup` skills (see **Skills** below), or paste the prompts raw into the Claude Code prompt. `/recover-session` continues a session that died, rebuilt from its transcript.

## Transcript location (for recovery)
- **Path:** `$CLAUDE_CONFIG_DIR` (default `~/.claude`) `/projects/<encoded-cwd>/<session-uuid>.jsonl`. Subagent transcripts live in `<session-uuid>/` beside it.
- **`<encoded-cwd>`:** every non-alphanumeric character of the absolute cwd becomes `-`. So `/Users/a/.t3/x` becomes `-Users-a--t3-x`. The encoding is lossy, so Harness Bridge matches sessions by the `cwd` recorded inside the file, never by decoding the folder name.
- **Selection:** `harness-bridge sessions` / `session_list`. Never "the newest file".
- **Records used by recovery** (verified on Claude Code 2.1.311):

  | Record | What recovery takes from it |
  |---|---|
  | `user` / `assistant` | Message content; `tool_use` / `tool_result` blocks |
  | `isCompactSummary` | Provider compaction summary |
  | `isApiErrorMessage` + `error: "rate_limit"` | Usage-limit stop; `authentication_failed` marks an auth stop |
  | `ai-title` / `custom-title` | Session title |
  | `last-prompt` | Last user prompt |
  | `continued-in` | Link to the session where work continued |
  | `TaskCreate` / `TaskUpdate`, `TodoWrite`, `update_plan` | Task state. Task ids come from `toolUseResult.task.id`. |

- **Ignored:** `api-request*` records (they re-embed the whole request history), attachments, `isMeta`, and sidechains.

## Native resume
`claude --resume <session-id>`, run from the session's directory. After a usage limit this only works once the limit resets; cross-provider recovery works immediately.

## Skills
Install the `/handoff`, `/pickup`, `/recover-session` and `harness-bridge` skills with `npx skills@latest add codemeall/harness-bridge` or `npx -y @codemeall/harness-bridge install-skills`, or as a Claude Code plugin: `/plugin marketplace add codemeall/harness-bridge` then `/plugin install harness-bridge@codemeall` (skills are then `/harness-bridge:handoff` and `/harness-bridge:pickup`). Where the agent does not support skills, paste the prompts instead.

## Known quirks
- `CLAUDE.md` is injected as a system reminder, so the maintainer snippet must be **self-contained** — no `(see file X)` indirection. The canonical snippet in `prompts/maintainer.md` already satisfies this.
- Tool outputs in transcripts can be very large (full file reads, large command stdouts). Recovery prompts should skip these and focus on user/assistant text.
- Claude Code's auto-compact behavior may already summarize older parts of a long session; recovery from a heavily compacted transcript may lose detail. The bridge file itself is the safer source — recovery is the fallback.

## Round-trip status
- Automated recovery tests: `tests/recovery.test.ts` (synthetic transcripts in the observed format).
- Manual protocol: `tests/round-trip.md`. Not yet run in full against a live Claude Code session.

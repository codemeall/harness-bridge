# Claude Code · Harness Bridge

Notes specific to using Harness Bridge with [Claude Code](https://github.com/anthropics/claude-code), Anthropic's terminal-based coding agent.

## Instructions file
- **Path:** `CLAUDE.md` at repo root.
- **Loaded:** automatically on session start, injected as a system reminder.
- **Install behavior:** `prompts/init.md` appends a `## Harness Bridge — keep .harness/bridge.md current` section. Existing `CLAUDE.md` content is preserved.

## Init / Producer / Consumer / Recover / Uninstall
All prompts are pasted raw into the Claude Code prompt. Slash-command wrappers are deferred to v2.

## Transcript location (for recovery)
- **Default glob:** `~/.claude/projects/<encoded-cwd>/*.jsonl`
- **`<encoded-cwd>`:** the absolute path of the working directory with `/` characters replaced by `-` and a leading `-` (e.g. `/Users/alice/code/myproj` → `-Users-alice-code-myproj`).
- **Latest-session heuristic:** highest mtime among `*.jsonl` in that directory.
- **Format:** newline-delimited JSON. One object per turn or tool call. Contains user/assistant content, tool inputs, tool outputs (often large — recovery prompts should skip raw tool outputs).

## Slash commands (future)
Reserved names for v2: `/bridge-init`, `/bridge-save`, `/bridge-load`, `/bridge-recover`, `/bridge-uninstall`. Not shipped in v1.

## Known quirks
- `CLAUDE.md` is injected as a system reminder, so the maintainer snippet must be **self-contained** — no `(see file X)` indirection. The canonical snippet in `prompts/maintainer.md` already satisfies this.
- Tool outputs in transcripts can be very large (full file reads, large command stdouts). Recovery prompts should skip these and focus on user/assistant text.
- Claude Code's auto-compact behavior may already summarize older parts of a long session; recovery from a heavily compacted transcript may lose detail. The bridge file itself is the safer source — recovery is the fallback.

## Round-trip status
v1 target: **6/6 — fully supported** (not yet measured — pending first run of `tests/round-trip.md`).

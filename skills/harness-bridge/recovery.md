# Recovering a bridge from a transcript

Use this when `.harness/bridge.md` is missing, stale, or suspect. You rebuild or audit the bridge from the previous session's transcript.

| Mode | When | Writes the bridge? |
|---|---|---|
| `since` | The bridge exists but missed the last part of the session (the everyday case) | Yes, after showing the diff |
| `full` | No usable bridge | Yes, after showing the proposed bridge |
| `verify` | The bridge exists but may have drifted from what happened | No. Report only |

## Where transcripts live

| Agent | Location |
|---|---|
| Claude Code | `~/.claude/projects/<cwd with every / replaced by ->/*.jsonl`. Take the newest by mtime. |
| Codex | `~/.codex/sessions/`. Take the newest session file for this project. |
| Gemini CLI | Under `~/.gemini/` or `~/.config/gemini/`, depending on version. |
| Cursor, Gemini Web | Not on disk. Ask the user to export or paste the chat. |

If you can't find the transcript, ask the user for its path.

## Procedure

1. Read the transcript in chunks. Skip large tool outputs (file dumps, build logs) and focus on user turns, assistant decisions, and tool calls that changed state. If it's over ~50K tokens, ask whether to limit it to a time range first.
2. Redact as you go: no secrets, credentials, or personal data in the result.
3. Apply the mode:
   - `full`: write a new bridge from [template.md](template.md) with `generated_by: recovery-from-transcript`.
   - `since`: take the events after the bridge's `last_updated` and patch Plan, Decisions (append only), Open questions, Files touched, and Next action. Bump `last_updated`.
   - `verify`: report "Bridge says X; transcript shows Y". Don't modify anything.
4. Show the result or diff and get the user's confirmation before writing. With MCP, call `bridge_recover` with `recoveredBridgeMarkdown` and `write: false` to validate, then `write: true` after confirmation.

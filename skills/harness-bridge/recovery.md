# Recovering a bridge from a transcript

Use this when `.harness/bridge.md` is missing, stale or suspect. If a whole session died (usage limit, crash) and the user wants to continue its work, use the `recover-session` skill instead; it covers the full flow.

| Mode | When | Writes the bridge? |
|---|---|---|
| `since` | The bridge exists but missed the last part of the session (the everyday case) | Yes, after showing the changes |
| `full` | No usable bridge | Yes, after showing the proposed bridge |
| `verify` | The bridge exists but may have drifted from what happened | No, report only |

## Get the evidence (deterministic, no raw transcript)

1. **List sessions and let the user pick.**
   - MCP: `session_list` with `cwd`.
   - CLI: `harness-bridge sessions`.

   Never take "the newest file" yourself: it may belong to another task or repo.
2. **Build the recovery package.**
   - MCP: `session_recover` with `session: <id>`.
   - CLI: `harness-bridge recover <id>`.

   The package lists:
   - the goal and the latest user messages;
   - task state (claims from the transcript);
   - files checked against git;
   - command results;
   - the *Bridge* section: whether the bridge is stale, events after `last_updated`, files it doesn't list, and tasks done but not ticked.
3. **Need a detail?** Use `session_read` (or `harness-bridge transcript <id> --around <line>`) on the cited line numbers.

## Apply the mode

- **`full`:** write a new bridge from [template.md](template.md) with `generated_by: recovery-from-transcript`. Validate with `bridge_recover` and `write: false`, show it to the user, then call again with `write: true`.
- **`since`:** apply the *Bridge* section's gaps with `bridge_checkpoint`: Plan, `decisionsToAppend`, Open questions, Files touched, Next action.
- **`verify`:** report "Bridge says X; transcript/repo shows Y". Modify nothing.

Get the user's confirmation before any write.

## Without the CLI or MCP

1. Find the transcript, then confirm the file with the user.
   - Claude Code: `~/.claude/projects/<cwd with every non-alphanumeric character replaced by ->/<session-id>.jsonl`.
   - Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Line 1 records the `cwd`.
   - Cursor and Antigravity: transcripts aren't readable files. Ask the user to export or paste the chat.
2. Read the transcript in chunks. Skip tool outputs and `api-request*` records.
3. Redact secrets as you go. If it's over ~50K tokens, ask to limit it to a time range first.

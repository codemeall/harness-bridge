# Harness Bridge

This workspace uses Harness Bridge for serial AI-agent handoff through `.harness/bridge.md`.

When the Harness Bridge MCP server is configured, use its tools instead of copy-pasting bridge prompts:

- `bridge_status` before trusting existing bridge state.
- `bridge_init` for first setup.
- `bridge_checkpoint` after meaningful checkpoints.
- `bridge_produce` before a deliberate handoff.
- `bridge_consume` when resuming work.
- `bridge_recover` when the bridge is stale, missing, or suspect.

When calling a bridge tool from Cursor, pass the absolute workspace path as `cwd` whenever Cursor exposes it. After a write tool returns, report the returned absolute path; do not claim a handoff was saved unless the tool call succeeded.

For `bridge_produce`, include the current session's handoff content in the tool arguments: updated `plan`, `nextAction`, `filesTouched`, `openQuestions`, `notes`, or appended decisions as applicable. Only set `confirmNoChanges` when you have reviewed the session and the existing bridge already contains the complete handoff.

After `bridge_consume`, restate the current goal, completed work, discrepancies, and next action, then wait for explicit user confirmation before editing files.

Keep `.harness/bridge.md` terse and secret-free.

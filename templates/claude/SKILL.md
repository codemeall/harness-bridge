---
name: harness-bridge
description: Maintain and consume .harness/bridge.md handoff state using the Harness Bridge MCP server.
---

# Harness Bridge

Use this skill when a user asks to initialize, checkpoint, finalize, consume, recover, or validate Harness Bridge state.

Prefer the `harness-bridge` MCP tools when available:

- `bridge_status` before acting on an existing bridge.
- `bridge_init` for first-time setup.
- `bridge_checkpoint` after completed checklist items, decisions, or edit batches.
- `bridge_produce` before a deliberate handoff.
- `bridge_consume` at the start of a fresh session.
- `bridge_recover` only when the bridge is stale, missing, or suspect.
- `bridge_validate` before publishing or committing bridge changes.

After `bridge_consume`, restate the goal, done state, discrepancies, and next action in your own words, then stop and wait for explicit user confirmation before executing.

Do not write secrets, transcripts, or long architectural exposition into `.harness/bridge.md`.

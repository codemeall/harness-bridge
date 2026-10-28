# Harness Bridge

This repo uses Harness Bridge: `.harness/bridge.md` holds the current task state so another agent or provider can continue the work.

- **Resuming:** call `bridge_consume`. Load any suggested skills, restate the goal, what is done and the next action, then wait for the user to confirm before editing.
- **After a finished step, decision or batch of edits:** call `bridge_checkpoint` with only the fields that changed.
- **Before switching agents:** call `bridge_produce` with the updated plan, next action and files touched. If the user said what the next session is for, pass it as `focus`. Link existing specs, issues and PRs in `references`, and list skills to load in `suggestedSkills`. Set `confirmNoChanges` only if the bridge is already complete.
- **Previous session died (usage limit, crash):** call `session_list`, ask the user which session to use, then call `session_recover`. Restate and wait. For more detail use `session_read`; never load raw transcripts.
- Pass the absolute workspace path as `cwd`. Report a write only after the tool call succeeds. Keep the bridge terse and free of secrets and personal data.

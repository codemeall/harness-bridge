---
name: pickup
description: Resume work from a Harness Bridge handoff (.harness/bridge.md) in a fresh session. Grounds itself in git, restates the goal and next action, and waits for confirmation before continuing. Use when the user wants to continue or pick up where a previous session or agent left off.
argument-hint: "Optional: anything that changed since the handoff"
---

# Pickup

Resume from `.harness/bridge.md`, written by a previous session (any provider).

Extra context from the user, if any: $ARGUMENTS

## Steps

1. **Load the bridge.**
   - **MCP available:** call `bridge_consume` with `cwd` set to the absolute workspace path. It returns the bridge content, git discrepancies, commits since the bridge's `head`, and per-file diffs.
   - **No MCP:** read `.harness/bridge.md` at the repo root. If it doesn't exist, stop and tell the user. They may want to recover it from the old transcript (see the `harness-bridge` skill) or start fresh.

2. **Check it against the repo.** Don't silently reconcile; list every mismatch.
   - `branch`: if it differs from the current branch, ask whether to switch or stay.
   - `head`: if it differs from `git rev-parse --short HEAD`, run `git log <bridge-head>..HEAD --oneline`.
   - `dirty: true`, or a dirty tree now: run `git status` and show the uncommitted changes.
   - For each file under **Files touched**, run `git diff <bridge-head> -- <file>` and read the file's current state.

3. **Read only what the next action needs.** Open the **References** that bear on the Next action; skip the rest until they're needed.

4. **Load suggested skills.** For each skill under **Suggested skills** that exists here, invoke it (or its closest equivalent) before starting work.

5. **Restate in your own words:**
   - the goal, and the **Next session focus** if one is set;
   - what's done;
   - the next action;
   - decisions already made (don't re-open them unless the user asks);
   - open questions that affect the next step;
   - any discrepancies from step 2.

6. **Stop and wait for the user to confirm.** Don't edit files or run state-changing commands until they do. This is the cheapest point to catch a misread handoff.

7. **After confirmation,** run the Next action. From then on, keep the bridge current at checkpoints: after finishing a plan item, recording a decision, or finishing a batch of edits. Use `bridge_checkpoint`, or edit the affected section and bump `last_updated`. When the session ends, run `/handoff`.

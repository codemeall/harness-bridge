# Consumer prompt

Paste this into a **new session** to resume work from an existing bridge. Works for same-provider continuation or cross-provider handoffs.

---

Resume work from the Harness Bridge in this repo.

1. **Read `.harness/bridge.md`.** If it doesn't exist, stop and tell me — I may want to run `prompts/recover.md` instead.

2. **Verify frontmatter against repo state:**
   - `repo` matches the current repo.
   - `branch` — if it doesn't match the current branch, ask whether to `git switch <branch>` or proceed where I am.
   - `head` — run `git rev-parse --short HEAD` and compare. If different, run `git log <bridge-head>..HEAD --oneline` so we both see what's changed since the bridge was written.
   - `dirty: true` — run `git status` and surface uncommitted changes before doing anything.

   Surface any discrepancies explicitly. **Do not silently reconcile.**

3. **Ground yourself in real code.** For every file in *Files touched*:
   - Run `git diff <bridge-head> -- <file>` (or `git status <file>` if untracked).
   - Read the file at its current state.

4. **Restate, in your own words:**
   - The goal.
   - What's done.
   - What's next.

   **Then stop and wait for me to confirm** before executing anything. This step is non-negotiable — it's the cheapest way to catch a misread of the bridge.

5. **Once I confirm**, execute the Next action.

6. **From this point on**, follow the maintainer rules in the provider's instructions file (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `.cursor/rules/harness-bridge.md`). Update the bridge at checkpoints.

If at any step the bridge looks inconsistent with the actual repo state, stop and surface the discrepancy. Do not silently reconcile.

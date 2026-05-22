# Init prompt

Paste this into a fresh session of your AI coding agent, opened inside the repo where you want Harness Bridge installed.

---

Set up Harness Bridge in this repo.

1. **Create `.harness/`** at the repo root if it doesn't already exist.

2. **Append the Harness Bridge maintainer snippet** to whichever instructions file this provider uses:
   - Claude Code → `CLAUDE.md` at repo root
   - Codex → `AGENTS.md` at repo root
   - Gemini CLI → `GEMINI.md` at repo root
   - Cursor → create `.cursor/rules/harness-bridge.md` (new file; no append needed)

   The snippet is the block between `--- begin snippet ---` and `--- end snippet ---` in this repo's `prompts/maintainer.md` (or in the Harness Bridge project at <https://github.com/codemeall/harness-bridge.git> if you don't have it locally).

   **Do not overwrite existing content.** Append as a new section. The canonical section header is `## Harness Bridge — keep .harness/bridge.md current`.

3. **Scaffold a starter `.harness/bridge.md`** from the template in the snippet. Populate the frontmatter from `git`:
   - `repo`: from the current directory's basename or `git config`
   - `branch`: `git rev-parse --abbrev-ref HEAD`
   - `head`: `git rev-parse --short HEAD`
   - `dirty`: true iff `git status --porcelain` returns anything
   - `generated_at` / `last_updated`: now, in ISO-8601 UTC
   - `cadence`: `checkpoint`
   - `generated_by`: your agent identifier (e.g. `claude-code`)

   Body sections default to placeholders (`_(none yet)_`) except the title and Goal — ask me for a one-line title and 2–4 sentences of goal before writing.

4. **Do not commit.** Show me the diff (`git status` + the bridge contents) so I can review before staging.

Once installed, run normally — you will update `.harness/bridge.md` at checkpoints per the maintainer rules.

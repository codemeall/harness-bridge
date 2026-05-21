# Uninstall prompt

Use this to symmetrically remove Harness Bridge from a repo. Removes both install artifacts (the `.harness/` folder and the maintainer snippet in the provider's instructions file) without touching anything else.

---

Remove Harness Bridge from this repo.

1. **Delete the `.harness/` directory** (including `bridge.md` and any other contents).

2. **Remove the Harness Bridge section** from this provider's instructions file:

   - **Claude Code** → in `CLAUDE.md`, strip the section starting at `## Harness Bridge — keep .harness/bridge.md current` and everything beneath it that belongs to that section (including the embedded bridge template, up to the next top-level heading or end of file).
   - **Codex** → same operation on `AGENTS.md`.
   - **Gemini CLI** → same operation on `GEMINI.md`.
   - **Cursor** → delete the file `.cursor/rules/harness-bridge.md` entirely.

   Leave the rest of the file untouched. Do not touch any unrelated sections.

3. **Do not commit.** Show me the diff (`git status` + the changes to the instructions file) so I can review before staging.

### Notes

- The canonical section header `## Harness Bridge — keep .harness/bridge.md current` is locked by the Harness Bridge spec (§7). Matching it exactly is safe; matching a shortened or modified header is not.
- **Past bridges remain in git history.** That's intentional — recovery from history is possible. If you need to scrub history because past bridges contained sensitive content, use `git filter-repo` (or BFG Repo Cleaner) separately. This prompt does not touch git history.
- Re-installation is possible at any time via `prompts/init.md`. Uninstall and init are designed to be a symmetrical pair.

# Maintainer snippet

This is the **canonical maintainer snippet**. It is intended to be appended verbatim to your provider's instructions file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, or `.cursor/rules/harness-bridge.md`) by `prompts/init.md`.

Copy everything between the `--- begin snippet ---` and `--- end snippet ---` markers below into your provider's instructions file.

--- begin snippet ---

## Harness Bridge — keep .harness/bridge.md current

This repo uses **Harness Bridge**. `.harness/bridge.md` (schema `harness-bridge/v1`) holds the current task state so a fresh session or a different agent can continue exactly where you stopped. Keep it accurate.

### Rules

1. **Create it before real work.** If the bridge is missing and the task is more than ~3 steps, create it from the template below, or with `bridge_init` over MCP.
2. **Update at checkpoints only:**
   - a plan item finishes;
   - a decision is made;
   - a batch of edits lands;
   - before a long-running operation;
   - the user says "checkpoint".

   Skip read-only exploration and trivial edits.
3. **Patch, don't rewrite.** Change only the affected sections and bump `last_updated`. Over MCP, use `bridge_checkpoint`.
4. **Decisions are append-only.** To change one, add a new entry that names the entry it supersedes.
5. **Stay terse; reference, don't duplicate.** A 10-minute task needs about 30 lines.
   - Link specs, plans, ADRs, issues, PRs and commits under an optional `## References` section (after *Files touched*) instead of copying them.
   - *Files touched* records each file's state, not its diff.
6. **No secrets or personal data.** Never write keys, tokens, passwords, `.env` values, credentialed URLs, emails or customer data. Say where a value lives instead.
7. **Don't commit** on the user's behalf.
8. **Hand off with content.**
   - On "Produce a Harness Bridge handoff" or `/handoff`, send the changed fields to `bridge_produce`: `plan`, `nextAction`, `filesTouched`, `openQuestions`, decisions, and, when useful, `focus`, `references` and `suggestedSkills`.
   - Use `confirmNoChanges` only if the bridge is already complete.
   - The optional sections are `## Next session focus` (after *Goal*), `## References` and `## Suggested skills` (after *Files touched*). Leave them out when empty.
9. **Recover, don't guess.** If the previous session died without a handoff (usage limit, crash), list its sessions (`session_list`, `harness-bridge sessions` or `/recover-session`), let the user pick one, and recover it with `session_recover`.
10. **Over MCP, pass the absolute workspace path as `cwd`.** Report a write only after the tool call succeeds.

### Cadence

The default is **checkpoint**. Follow plain-language overrides:
- "Use lazy cadence": update only when asked.
- "Use aggressive cadence": update after every turn.

When the cadence changes, update the `cadence` frontmatter field to match.

### Bridge template

If `.harness/bridge.md` does not exist, create it with this exact structure:

````markdown
---
schema: harness-bridge/v1
generated_by: <your-agent-id>
generated_at: <ISO-8601 UTC, e.g. 2026-05-22T18:42:00Z>
last_updated: <same as generated_at on first write>
cadence: checkpoint
repo: <repo name from git>
branch: <current branch>
head: <short SHA of HEAD>
dirty: <true if uncommitted changes exist, else false>
---

# Bridge — <one-line title of the work>

## Goal
<2–4 sentences. The why, in plain language.>

## Plan
- [ ] first step
- [ ] second step
- [ ] third step

Legend: [x] done · [~] in progress · [ ] pending

## Next action
<Imperative single paragraph. Specific file paths, function names, commands.>

## Decisions & rationale
_(none yet)_

## Open questions
_(none yet)_

## Files touched
_(none yet)_

## Notes for the next agent
_(optional; leave blank if nothing to note)_
````

Empty sections stay in the file with `_(none)_` placeholders — never omitted.

--- end snippet ---

## Notes for integrators

- The canonical section header `## Harness Bridge — keep .harness/bridge.md current` is required by the spec (§7). Uninstall tools rely on this exact string.
- The snippet is intentionally self-contained: it does not reference external files. Provider instructions files are typically loaded at session start and any indirection would fail.
- Keep the template's structural elements verbatim. Section headings and order are part of the `harness-bridge/v1` schema.

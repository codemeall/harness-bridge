# Maintainer snippet

This is the **canonical maintainer snippet**. It is intended to be appended verbatim to your provider's instructions file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, or `.cursor/rules/harness-bridge.md`) by `prompts/init.md`.

Copy everything between the `--- begin snippet ---` and `--- end snippet ---` markers below into your provider's instructions file.

--- begin snippet ---

## Harness Bridge — keep .harness/bridge.md current

You are working in a repo that uses **Harness Bridge** for cross-session continuity. There is (or should be) a file at `.harness/bridge.md` following the `harness-bridge/v1` schema. Your job is to keep it accurate so a different agent — or a fresh session — can pick up exactly where you left off.

### Rules

1. **Initialize on first non-trivial action.** If `.harness/bridge.md` does not exist and the task is more than ~3 steps, create it from the template at the bottom of this section before doing real work.

2. **Update at checkpoints, not every turn.** Update the bridge after any of:
   - Completing a checklist item.
   - Making a decision worth recording (architecture, library choice, trade-off).
   - Finishing a batch of file edits.
   - Before any long-running operation (migrations, large refactors, builds you'd hate to redo).
   - When the user explicitly says "checkpoint" or "update the bridge."

   Do **not** update on every assistant turn, after read-only exploration, or for trivial edits.

3. **Patch, don't rewrite.** Use the `Edit` tool (or equivalent) to change only the affected section. Bump the `last_updated` frontmatter field every time you patch.

4. **Append-only for decisions.** Never silently revise a past decision in *Decisions & rationale*. Add a new entry that supersedes the old, and reference the old one explicitly.

5. **Stay terse.** A 10-minute task → a ~30-line bridge. The bridge is a reference card, not a journal.

6. **Redact secrets.** Never write API keys, tokens, passwords, `.env*` values, or anything credential-shaped into the bridge.

7. **Don't commit on the user's behalf.** Stage edits to `.harness/bridge.md`; let the user commit.

### Cadence override

This repo uses cadence: **checkpoint** (default).

The user can override per-task in plain language:
- "Use lazy cadence for this exploration" → minimal updates, only on explicit request.
- "Use aggressive cadence — this is critical" → update after every turn.

When you change cadence, update the `cadence` field in the bridge frontmatter accordingly.

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

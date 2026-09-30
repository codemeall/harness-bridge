---
name: handoff
description: Hand off the current coding session to a fresh agent by finalizing the Harness Bridge file (.harness/bridge.md). Use at the end of a session, before switching agents or providers, or before the context window runs out.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

# Handoff

Compact this session into `.harness/bridge.md` so a fresh agent — same provider or a different one — can pick up exactly where you stopped.

Next-session focus from the user: $ARGUMENTS

If that line is empty or still shows a placeholder, there is no stated focus. Otherwise, treat it as a description of what the next session will do and tailor the handoff to it: set **Next session focus**, make **Next action** the first step toward that focus, and leave out detail that doesn't serve it.

## Steps

1. **Read the current bridge.** With the Harness Bridge MCP server, call `bridge_status` (pass the absolute workspace path as `cwd`). Otherwise read `.harness/bridge.md` at the repo root. If none exists, create one from [template.md](template.md) and fill it from this session.

2. **Walk back through the whole session** and collect what changed since the bridge's `last_updated`:
   - **Plan**: tick finished steps `[x]`, mark the current one `[~]` with a short location note, add new pending steps.
   - **Decisions & rationale**: add decisions made in chat, with the reason. Append only; to change an old decision, add a new entry that names the one it replaces.
   - **Open questions**: anything deliberately deferred, and who or what should resolve it.
   - **Files touched**: one line per file with its *state* (new helper, WIP edit, tests failing). Don't restate the diff; git has it.

3. **Sharpen Next action.** Imperative, specific (paths, functions, commands), and runnable without reading the rest of the bridge.

4. **Reference, don't duplicate.** If something is already captured in a spec, plan, ADR, issue, PR, commit, or doc, list its path or URL under **References** and don't copy it. The bridge carries only what isn't written down anywhere else.

5. **Suggest skills.** Under **Suggested skills**, name the skills the next agent should load for the next action, each with a one-line reason (for example, `- tdd — next step is writing the failing test for the retry path`). Only name skills that exist in this environment. Leave the section out if none apply.

6. **Redact.** No API keys, tokens, passwords, `.env` values, connection strings with credentials, or personal data (emails, phone numbers, customer data). Say where a value lives ("token is in 1Password → Staging") instead of writing it.

7. **Write it.**
   - **MCP available:** call `bridge_produce` with `cwd` and the changed fields: `plan`, `nextAction`, `decisionsToAppend`, `openQuestions`, `filesTouched`, `focus`, `references`, `suggestedSkills`, `notes`. Set `confirmNoChanges: true` only if you checked and the bridge is already complete.
   - **No MCP:** edit `.harness/bridge.md` directly. Keep the section order from [template.md](template.md). Bump `last_updated` to now (UTC), and refresh `branch`, `head` (`git rev-parse --short HEAD`) and `dirty` (`git status --porcelain`). If Node is available, check it with `npx -y @codemeall/harness-bridge validate`.

8. **Report back** in a few lines:
   - the absolute path you wrote, and what changed since the last checkpoint;
   - any place where the old bridge contradicted what actually happened (surface it, don't silently overwrite);
   - how to resume: *"In a new session, run `/pickup` (or `/harness-bridge:pickup` if installed as a Claude Code plugin), or say: Consume the Harness Bridge and restate where we are."*

Never claim the handoff was saved unless the write succeeded. Don't commit on the user's behalf.

## Keep it short

A bridge is a reference card, not a journal. It should be about 30–80 lines. If it grows past that, move durable rationale into repo docs and link it under References.

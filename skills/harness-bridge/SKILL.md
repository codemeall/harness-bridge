---
name: harness-bridge
description: Set up and maintain Harness Bridge handoff state (.harness/bridge.md) so AI coding sessions survive token limits, crashes, and switching agents. Use when the user asks to initialize Harness Bridge, checkpoint or update the bridge, recover or verify a bridge from a transcript, validate it, or remove it; and to keep an existing bridge current while working. For a deliberate end-of-session handoff use /handoff; to resume use /pickup; to continue a session that died (usage limit, crash) use /recover-session.
---

# Harness Bridge

`.harness/bridge.md` is a small markdown file at the repo root that records where the current task stands: goal, plan, next action, decisions, open questions, files touched. Any agent can read it and continue. The agent keeps it current *while working*, so if a session dies without warning, the last checkpoint is already on disk.

Companion skills:
- `/handoff [what the next session is for]`: finalize the bridge before ending a session.
- `/pickup`: resume from the bridge in a new session.
- `/recover-session`: continue a session that ended without a handoff, rebuilt from its local transcript.

If the `harness-bridge` MCP server is connected, prefer its tools and pass the absolute workspace path as `cwd`. Otherwise edit the file directly; the rules are the same.

## Initialize

Only for tasks longer than ~3 steps. Ask for a one-line title and a 2–4 sentence goal if you don't have them.

- **MCP:** `bridge_init` with `title`, `goal`, optional `plan` and `nextAction`.
  - `installInstructionsFor` adds the maintainer rules, so every future session keeps the bridge current without this skill. Pass one value or a list, e.g. `["claude-code", "codex"]`:
    - `claude-code` → `CLAUDE.md`
    - `codex` or `antigravity` → `AGENTS.md`
    - `gemini-cli` → `GEMINI.md`
    - `cursor` → `.cursor/rules/harness-bridge.md`
  - `localOnly: true` keeps the bridge out of git (adds `/.harness/` to `.git/info/exclude`). Use it when the user doesn't want handoff notes in commits or PRs.
- **No MCP:** create `.harness/bridge.md` from [template.md](template.md) and fill the frontmatter from git. For local-only mode, append `/.harness/` to `.git/info/exclude`.

Show the user the result. Don't commit.

## Keep it current (checkpoints)

Update the bridge after any of these:
- finishing a plan item;
- making a decision worth recording (architecture, library, trade-off);
- finishing a batch of file edits;
- before a long-running or risky operation (migration, big refactor, long build);
- when the user says "checkpoint" or "update the bridge".

Don't update on every turn, after read-only exploration, or for trivial edits. Cadence is `checkpoint` by default. The user can ask for `lazy` (only on request) or `aggressive` (every turn); record it in the `cadence` field.

- **MCP:** `bridge_checkpoint` with only the fields that changed.
- **No MCP:** edit only the affected section, then bump `last_updated` and refresh `head`, `branch` and `dirty`.

## Rules for the content

1. **Next action is the load-bearing field.** Make it imperative, specific, and runnable without the rest of the file.
2. **Decisions are append-only.** To change one, add a new entry that names the entry it replaces.
3. **Reference, don't duplicate.** Link specs, plans, ADRs, issues, PRs and commits under **References** instead of copying them. Files touched records each file's state, not its diff.
4. **Suggested skills** lists skills the next agent should load, with a reason for each. **Next session focus** is what the next session is for. Both are optional; leave them out when empty.
5. **Stay terse:** about 30–80 lines. It's a reference card, not a journal. Don't include transcripts or long architecture write-ups.
6. **Never write secrets or personal data.** No keys, tokens, passwords, `.env` values, credentialed URLs, emails, or customer data. The MCP tools refuse credential-shaped content.
7. **Required sections, in order:** Goal, Plan, Next action, Decisions & rationale, Open questions, Files touched. Write an empty section as `_(none)_`; never drop it.
8. **Report the path you wrote,** and never claim a write that didn't succeed.

## Recover, validate, remove

- **Stale, missing, or suspect bridge:** follow [recovery.md](recovery.md) (`bridge_recover` with MCP).
- **Validate:** `bridge_validate`, or `npx -y @codemeall/harness-bridge validate`.
- **Remove from a repo:** delete `.harness/`, and remove the `## Harness Bridge — keep .harness/bridge.md current` section from the agent instructions file (or delete `.cursor/rules/harness-bridge.md`). Confirm with the user first.

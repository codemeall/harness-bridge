# Codex · Harness Bridge

Notes specific to using Harness Bridge with [OpenAI Codex](https://openai.com/codex) (CLI / IDE integrations).

## Instructions file
- **Path:** `AGENTS.md` at repo root.
- **Loaded:** automatically on session start (Codex's documented convention).
- **Install behavior:** `prompts/init.md` appends a `## Harness Bridge — keep .harness/bridge.md current` section.

## Init / Producer / Consumer / Recover / Uninstall
Raw prompt paste in v1.

## Transcript location (for recovery)
- **Default root:** `~/.codex/sessions/` (path and structure subject to upstream change).
- **Latest-session heuristic:** most recently modified session file scoped to the current project. If discovery fails, the recovery prompt falls back to asking the user for the file path.
- **Format:** version-dependent; the recovery prompt is written to be robust to format drift (parse user turns, assistant turns, tool calls; skip large raw outputs).

## Skills
Install the `handoff`, `pickup`, and `harness-bridge` skills (invoke them the way this agent invokes skills) with `npx skills@latest add codemeall/harness-bridge` or `npx -y @codemeall/harness-bridge install-skills --agent codex`. Where the agent does not support skills, paste the prompts instead.

## Known quirks
- Codex's `AGENTS.md` convention is well-aligned with Harness Bridge's instructions-file approach. The maintainer snippet drops in cleanly.
- Codex tool surface differs from Claude Code in detail (patch semantics, command execution), but Harness Bridge only requires file read + file edit, which all variants support.

## Round-trip status
v1 target: **6/6 — fully supported** (not yet measured — pending first run of `tests/round-trip.md`).

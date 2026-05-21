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

## Slash commands (future)
Reserved names for v2: `/bridge-init`, `/bridge-save`, `/bridge-load`, `/bridge-recover`, `/bridge-uninstall`. Not shipped in v1.

## Known quirks
- Codex's `AGENTS.md` convention is well-aligned with Harness Bridge's instructions-file approach. The maintainer snippet drops in cleanly.
- Codex tool surface differs from Claude Code in detail (patch semantics, command execution), but Harness Bridge only requires file read + file edit, which all variants support.

## Round-trip status
Target for v1: **6/6 — fully supported**. See `tests/round-trip.md`.

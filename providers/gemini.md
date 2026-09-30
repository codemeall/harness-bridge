# Gemini · Harness Bridge

Notes specific to using Harness Bridge with [Gemini](https://gemini.google.com), Google's AI assistant family. v1 covers the **Gemini CLI** primarily; the web interface has gaps documented below.

## Instructions file
- **Path:** `GEMINI.md` at repo root (Gemini CLI's documented convention).
- **Loaded:** automatically on session start.
- **Install behavior:** `prompts/init.md` appends a `## Harness Bridge — keep .harness/bridge.md current` section.

## Init / Producer / Consumer / Recover / Uninstall
Raw prompt paste in v1.

## Transcript location (for recovery)
- **Gemini CLI:** session logs live under `~/.gemini/` or `~/.config/gemini/` (path varies by version). Most-recent-mtime heuristic; if discovery fails, ask the user for the path.
- **Gemini Web:** **not accessible** to a local agent — there is no filesystem transcript. Recovery from web sessions requires the user to manually export or copy-paste the conversation, then point recovery at the exported file/text.
- **Format:** version-dependent; recovery is robust to format drift.

## Skills
Install the `handoff`, `pickup`, and `harness-bridge` skills (invoke them the way this agent invokes skills) with `npx skills@latest add codemeall/harness-bridge` or `npx -y @codemeall/harness-bridge install-skills --agent gemini-cli`. Where the agent does not support skills, paste the prompts instead.

## Known quirks
- **Web vs CLI split** is the major caveat. Continuous bridge maintenance works in both (the agent edits files either way), but transcript-based recovery only works automatically in the CLI.
- `GEMINI.md` content should be self-contained — same self-contained constraint as `CLAUDE.md`.

## Round-trip status
v1 targets (not yet measured):
- **Gemini CLI: 6/6 — fully supported.**
- **Gemini Web: ≥3/6 — partially supported** (Tests A, B, C expected to pass; Tests D and E require manual transcript export; Test F can run on manually exported transcripts).

See `tests/round-trip.md`.

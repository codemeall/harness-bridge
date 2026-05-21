# Cursor · Harness Bridge

Notes specific to using Harness Bridge with [Cursor](https://cursor.com), the AI-first code editor.

## Instructions file
- **Path:** `.cursor/rules/harness-bridge.md` (new file scoped to the workspace).
- **Loaded:** automatically by Cursor's MDC rules system when working in the project.
- **Install behavior:** unlike Claude Code / Codex / Gemini, Cursor uses a **directory of rule files** rather than a single root file. `prompts/init.md` creates the rule file directly instead of appending. The maintainer snippet becomes the entire file body.

## Init / Producer / Consumer / Recover / Uninstall
Raw prompt paste into the Cursor chat panel in v1.

## Transcript location (for recovery)
- **Status:** Cursor stores chat history in application data (location varies by OS) and does not always expose it as a file the agent can read.
- **v1 procedure:** if you need to run recovery in Cursor, **export the chat manually** (Cursor's UI provides a "copy chat" / "export" affordance) and either save the export to a file or paste it into the recovery prompt.
- The recovery prompt itself is agnostic about transcript format — it works on plain text dumps as well as structured logs.

## Slash commands (future)
Reserved names for v2: `/bridge-init`, `/bridge-save`, `/bridge-load`, `/bridge-recover`, `/bridge-uninstall`. Not shipped in v1.

## Known quirks
- Cursor's agent runs inside the IDE and has direct file-editing access, so the maintainer / consumer flows work without anything special.
- The recovery limitation (manual transcript export) is the main gap. Documented openly here rather than papered over.
- Some Cursor configurations require enabling the rule file via the rules manager UI before it's actually loaded; check that the rule is active if the agent doesn't seem to follow it.

## Round-trip status
Target for v1: **≥4/6 — partially supported**. Tests A, B, C, F should pass cleanly; Tests D and E (recovery modes) may require manual transcript export. See `tests/round-trip.md`.

# Antigravity · Harness Bridge

Notes for [Google Antigravity](https://antigravity.google), covering both the IDE/app and the **Antigravity CLI (`agy`)**. Google moved Gemini CLI individual users to Antigravity CLI on 2026-06-18 ([announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)).

## Instructions file
- **Workspace rules:** `AGENTS.md` (or `GEMINI.md`) at the repo root, `.agents/AGENTS.md`, or `.agents/rules/*.md` ([docs](https://antigravity.google/docs/rules/)).
- **Install:** `bridge_init` with `installInstructionsFor: "antigravity"` appends the maintainer snippet to `AGENTS.md`. Codex reads the same file.

## MCP
- **Global config:** `~/.gemini/config/mcp_config.json`. **Workspace config:** `.agents/mcp_config.json`.
- **Format:** the same `mcpServers` shape as `templates/antigravity/mcp_config.json`.
- **From the CLI:** `agy mcp add harness-bridge npx -y @codemeall/harness-bridge@latest mcp` ([docs](https://antigravity.google/docs/mcp/)).

## Skills
Agent Skills (`SKILL.md` folders) are supported ([docs](https://antigravity.google/docs/skills/)).
- **Install:**
  - `harness-bridge install-skills --agent antigravity` copies them to `~/.gemini/config/skills/` (app/IDE).
  - `--agent antigravity-cli` copies them to `~/.gemini/antigravity-cli/skills/` (`agy`).
  - `npx skills@latest add codemeall/harness-bridge -a antigravity-cli` works too.
- **Project-scoped:** `--project` writes `.agents/skills/`, which Codex also reads.

## As a destination (continue a recovered session)
- `harness-bridge recover <id> --to antigravity` prints `cd <repo> && agy -i '<prompt>'`.
- `agy` has no working-directory flag; the workspace is the process cwd.

## As a recovery source
**Not supported.** The CLI stores each conversation as a SQLite database: `~/.gemini/antigravity-cli/conversations/<uuid>.db`, with protobuf `step_payload` blobs. That format is undocumented.
- If an Antigravity session dies, use the bridge (kept current by the maintainer rules), or resume natively.
- An index of titles, workspaces and status exists in `conversation_summaries.db`, but Harness Bridge doesn't read it yet.

## Native resume
- `agy --conversation <uuid>` resumes a specific conversation.
- `agy -c` resumes the most recent conversation for the current workspace.
- When a session exits, `agy` prints the resume command ([docs](https://antigravity.google/docs/cli/commands/resume/)).

## Quota
Pro/Ultra quota refreshes every 5 hours, up to a weekly cap. Check it with `/usage` in the CLI. Google doesn't document the error text shown when quota runs out, so Harness Bridge cannot detect that state.

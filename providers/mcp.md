# MCP · Harness Bridge

Harness Bridge can run as a local stdio MCP server:

```bash
npx -y harness-bridge mcp
```

For a local Git checkout:

```bash
git clone <repo-url>
cd harness-bridge
npm install
npm run build
node /absolute/path/to/harness-bridge/dist/cli.js mcp
```

The MCP server operates on the current local repository and keeps `.harness/bridge.md` as the source of truth. It does not replace the markdown schema; it automates common bridge operations.

It also exposes the canonical `prompts/*.md` files as MCP prompts/resources, so agents can retrieve the original prompt text when they need the full instruction wording.

For an end-to-end setup and daily workflow guide, see [`docs/mcp-usage.md`](../docs/mcp-usage.md).
For the prompt-to-tool conformance map, see [`docs/mcp-prompt-alignment.md`](../docs/mcp-prompt-alignment.md).

## Tools

| Tool | Purpose |
|---|---|
| `bridge_status` | Validate the bridge and compare frontmatter against current git state. |
| `bridge_init` | Create `.harness/bridge.md` for a repo. |
| `bridge_checkpoint` | Patch bridge sections after completed work, decisions, or edit batches. |
| `bridge_produce` | Finalize the bridge before a deliberate provider/session handoff. |
| `bridge_consume` | Return grounded state for a fresh session; the agent must restate and wait for confirmation. |
| `bridge_recover` | Validate/write agent-supplied recovered bridge content or help with verify-mode transcript review. |
| `bridge_validate` | Validate bridge markdown against `harness-bridge/v1`. |
| `vault_init` | Scaffold an LLM Wiki / second-brain vault (folders + `CLAUDE.md` + `AGENTS.md` + `wiki/index.md` + `wiki/log.md`) in the current dir. Works standalone or alongside an existing project. |
| `vault_status` | Report vault scaffold state and surface pending ingests (files in `raw/` with no matching `wiki/sources/<slug>.md`). |

`bridge_init` can also install the maintainer snippet when called with `installInstructionsFor` set to `claude-code`, `codex`, `gemini-cli`, or `cursor`.

## Vault setup

The same `npx -y harness-bridge mcp` install gives you the vault tools. After your agent is connected, say:

```text
Use harness-bridge to initialize an LLM Wiki vault here. Name: "knowledge"
```

The agent calls `vault_init`. Result:

- **Empty directory** → a standalone vault: `raw/`, `wiki/{entities,concepts,sources,syntheses}/`, `CLAUDE.md`, `AGENTS.md`, `wiki/index.md`, `wiki/log.md`.
- **Existing project repo** → folders created in-place; the vault schema is appended to your existing `CLAUDE.md` / `AGENTS.md` inside `<!-- harness-bridge:vault-schema -->` markers, leaving the host content untouched. Idempotent — re-running detects the marker and skips.

After init, drop source documents (PRDs, transcripts, articles, meeting notes, PDFs, screenshots into `raw/assets/`) into `raw/` and tell the agent `ingest raw/<file>` or `ingest <url>`. The agent follows the schema in `CLAUDE.md` to summarize and integrate them into the wiki.

## Provider setup

### Claude Code

```bash
claude mcp add --transport stdio harness-bridge -- npx -y harness-bridge mcp
```

Optional: copy `templates/claude/SKILL.md` to `.claude/skills/harness-bridge/SKILL.md` for workflow guidance.

### Cursor

Add `templates/cursor/mcp.json` to `.cursor/mcp.json`, or merge the `harness-bridge` entry into an existing file. Add `templates/cursor/harness-bridge-rule.md` to `.cursor/rules/harness-bridge.md`.

### Codex

Merge `templates/codex/config.toml` into the Codex MCP config and append `templates/codex/AGENTS.md.snippet` to `AGENTS.md`.

### Gemini CLI / Antigravity

Merge `templates/gemini/settings.json` or `templates/antigravity/settings.json` into the tool's MCP settings, then add the matching instruction snippet to the project context file.

## Safety model

- The bridge remains a plain markdown file in the repo.
- Mutating tools only write `.harness/bridge.md`.
- `bridge_consume` explicitly returns a confirmation gate; agents must not execute the next action until the user confirms.
- Recovery writes only when the caller passes validated recovered markdown and `write: true`.

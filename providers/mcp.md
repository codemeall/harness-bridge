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

For an end-to-end setup and daily workflow guide, see [`docs/mcp-usage.md`](../docs/mcp-usage.md).

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

# MCP · Harness Bridge

Harness Bridge can run as a local stdio MCP server:

```bash
npx -y @codemeall/harness-bridge@latest mcp
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
| `bridge_recover` | Validate/write a bridge rebuilt from recovered evidence (preview unless `write: true`). |
| `bridge_validate` | Validate bridge markdown against `harness-bridge/v1`. |
| `session_list` | Recent Claude Code / Codex sessions for the workspace, with end state (usage limit, interrupted…). |
| `session_recover` | Deterministic recovery package from a transcript; optional `to` destination and `write`. |
| `session_read` | Bounded, redacted transcript slice (range, around, grep). |
| `session_destinations` | Installed CLIs to continue in (Codex, Claude Code, Antigravity, Cursor Agent). |

`bridge_init` can also install the maintainer snippet. Set `installInstructionsFor` to one target or a list: `claude-code`, `codex`, `antigravity`, `gemini-cli`, `cursor`. Each file gets the snippet only once. The CLI equivalent is `harness-bridge init … --rules claude --rules codex`.

All bridge tools accept an optional `cwd` argument. Agents should pass the absolute workspace path when the MCP client exposes it, because some editors start stdio MCP servers outside the active project directory. Write tools include the absolute `.harness/bridge.md` path in their response.

`bridge_produce` rejects empty no-op calls unless the caller sets `confirmNoChanges: true` after verifying the existing bridge is already current. Normal producer calls should include the current handoff fields such as `plan`, `nextAction`, `filesTouched`, `openQuestions`, `notes`, or appended decisions, plus the optional `focus` (next-session focus), `references` (links instead of copied context), and `suggestedSkills`.

`bridge_init` accepts `localOnly: true` to keep the bridge out of git via `.git/info/exclude`. `bridge_status` reports `ignoredByGit`.

> The LLM Wiki knowledge-vault tools now ship separately in [`@codemeall/harness-wiki`](https://github.com/codemeall/harness-wiki).

## Provider setup

### Claude Code

```bash
claude mcp add --transport stdio harness-bridge -- npx -y @codemeall/harness-bridge@latest mcp
```

Add the `/handoff`, `/pickup`, `/recover-session` and `harness-bridge` skills with `npx -y @codemeall/harness-bridge install-skills` (or `npx skills@latest add codemeall/harness-bridge`). To get the MCP server and the skills together, install the plugin instead: `/plugin marketplace add codemeall/harness-bridge`, then `/plugin install harness-bridge@codemeall`.

### Cursor

Add `templates/cursor/mcp.json` to `.cursor/mcp.json`, or merge the `harness-bridge` entry into an existing file. Add `templates/cursor/harness-bridge-rule.md` to `.cursor/rules/harness-bridge.md`.

### Codex

Merge `templates/codex/config.toml` into the Codex MCP config and append `templates/codex/AGENTS.md.snippet` to `AGENTS.md`.

### Antigravity

Merge `templates/antigravity/mcp_config.json` into `~/.gemini/config/mcp_config.json` (or `.agents/mcp_config.json`), and append `templates/antigravity/AGENTS.md.snippet` to `AGENTS.md`. See [`antigravity.md`](./antigravity.md).

### Gemini CLI (legacy)

Merge `templates/gemini/settings.json` into Gemini CLI settings and append `templates/gemini/GEMINI.md.snippet` to `GEMINI.md`.

## Safety model

- The bridge remains a plain markdown file in the repo.
- Mutating tools only write `.harness/bridge.md`.
- `bridge_consume` explicitly returns a confirmation gate; agents must not execute the next action until the user confirms.
- Recovery writes only when the caller passes validated recovered markdown and `write: true`.
- Session tools read transcripts only from provider transcript directories (realpath-checked), redact secrets, and never contact the source provider. Recovery packages are written only with `write: true`, into the git-ignored `.harness/recovery/`.

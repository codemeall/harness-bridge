# Using Harness Bridge with MCP

Harness Bridge can be used in two ways:

- **Prompt workflow** — paste the prompts in `prompts/` into your coding agent.
- **MCP workflow** — configure Harness Bridge once as a local MCP server, then let your agent call bridge tools directly.

Use the MCP workflow when your agent supports MCP. It keeps `.harness/bridge.md` as the source of truth and removes most prompt copy-paste.

The MCP server exposes the canonical files in `prompts/` as MCP prompts/resources, and the tools implement the same lifecycle in deterministic code where validation, git-state checks, and bridge writes are safer than prompt-only behavior.

For the exact prompt-to-tool mapping, see [`docs/mcp-prompt-alignment.md`](./mcp-prompt-alignment.md).

## What developers get

After setup, your agent can use these tools:

| Tool | What it does |
|---|---|
| `bridge_init` | Creates `.harness/bridge.md` in a project repo. |
| `bridge_status` | Validates the bridge and compares it with current git state. |
| `bridge_checkpoint` | Updates the bridge after meaningful work. |
| `bridge_produce` | Finalizes the bridge before switching sessions or agents. |
| `bridge_consume` | Reads the bridge in a new session and returns the current state. |
| `bridge_recover` | Helps recover a stale or missing bridge from transcript evidence. |
| `bridge_validate` | Validates bridge markdown against the schema. |

The same MCP server also exposes LLM Wiki tools (`vault_init`, `vault_status`) for the separate knowledge-base workflow. See [`docs/llm-wiki.md`](./llm-wiki.md).

The server also exposes these prompt resources for agents that want the canonical prompt text:

- `bridge_init_prompt`
- `bridge_maintainer_prompt`
- `bridge_producer_prompt`
- `bridge_consumer_prompt`
- `bridge_recover_prompt`
- `bridge_uninstall_prompt`
- `bridge_vault_init_prompt` for the separate LLM Wiki setup prompt

## Requirements

- Node.js 20 or newer.
- A git repo for the project you want to use with Harness Bridge.
- An MCP-capable coding agent: Claude Code, Cursor, Codex, Gemini CLI, Antigravity, or another local developer agent.

## Choose an install method

### Option A: npm package

Use this when `@codemeall/harness-bridge` is available from npm:

```bash
npx -y @codemeall/harness-bridge mcp
```

You normally do not run this command by hand. Add it to your agent's MCP config and the agent starts it when needed.

### Option B: Git checkout

Use this when you want to run Harness Bridge from a cloned repo, a private fork, or a local development copy:

```bash
git clone <repo-url>
cd harness-bridge
npm install
npm run build
```

Then configure your agent to run the built CLI:

```json
{
  "mcpServers": {
    "harness-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/harness-bridge/dist/cli.js", "mcp"]
    }
  }
}
```

Replace `/absolute/path/to/harness-bridge` with the real path to your clone.

## Configure your agent

### Claude Code

With npm:

```bash
claude mcp add --transport stdio harness-bridge -- npx -y @codemeall/harness-bridge mcp
```

With a Git checkout:

```bash
claude mcp add --transport stdio harness-bridge -- node /absolute/path/to/harness-bridge/dist/cli.js mcp
```

Optional project skill:

```bash
mkdir -p .claude/skills/harness-bridge
cp /absolute/path/to/harness-bridge/templates/claude/SKILL.md .claude/skills/harness-bridge/SKILL.md
```

### Cursor

Create or merge this into `.cursor/mcp.json`.

With npm:

```json
{
  "mcpServers": {
    "harness-bridge": {
      "command": "npx",
      "args": ["-y", "@codemeall/harness-bridge", "mcp"]
    }
  }
}
```

With a Git checkout:

```json
{
  "mcpServers": {
    "harness-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/harness-bridge/dist/cli.js", "mcp"]
    }
  }
}
```

Then add the workspace rule:

```bash
mkdir -p .cursor/rules
cp /absolute/path/to/harness-bridge/templates/cursor/harness-bridge-rule.md .cursor/rules/harness-bridge.md
```

### Codex

Merge this into your Codex MCP config.

With npm:

```toml
[mcp_servers.harness-bridge]
command = "npx"
args = ["-y", "@codemeall/harness-bridge", "mcp"]
```

With a Git checkout:

```toml
[mcp_servers.harness-bridge]
command = "node"
args = ["/absolute/path/to/harness-bridge/dist/cli.js", "mcp"]
```

Then append the project instructions:

```bash
cat /absolute/path/to/harness-bridge/templates/codex/AGENTS.md.snippet >> AGENTS.md
```

### Gemini CLI

Merge this into your Gemini MCP settings.

With npm:

```json
{
  "mcpServers": {
    "harness-bridge": {
      "command": "npx",
      "args": ["-y", "@codemeall/harness-bridge", "mcp"]
    }
  }
}
```

With a Git checkout:

```json
{
  "mcpServers": {
    "harness-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/harness-bridge/dist/cli.js", "mcp"]
    }
  }
}
```

Then append the project instructions:

```bash
cat /absolute/path/to/harness-bridge/templates/gemini/GEMINI.md.snippet >> GEMINI.md
```

### Antigravity

Merge this into Antigravity's MCP settings.

With npm:

```json
{
  "mcpServers": {
    "harness-bridge": {
      "command": "npx",
      "args": ["-y", "@codemeall/harness-bridge", "mcp"]
    }
  }
}
```

With a Git checkout:

```json
{
  "mcpServers": {
    "harness-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/harness-bridge/dist/cli.js", "mcp"]
    }
  }
}
```

Use the same project-instruction pattern as Gemini: the agent should use Harness Bridge MCP tools for bridge work and must wait for user confirmation after `bridge_consume`.

## Start using it

### 1. Initialize a project

Open your project repo in your agent and say:

```text
Use Harness Bridge to initialize this repo for handoffs.

Title: Add token-bucket rate limiting
Goal: Add per-token rate limiting to public API endpoints so abuse from one token cannot degrade service for everyone. Use a token-bucket design with configurable defaults and route-level overrides.
```

Expected result:

- Agent calls `bridge_init`.
- `.harness/bridge.md` is created.
- If requested, the agent passes `installInstructionsFor` to add the maintainer snippet to `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, or `.cursor/rules/harness-bridge.md`.
- You review the bridge before committing.

### 2. Work normally

Give the agent your implementation task. After meaningful progress, it should call `bridge_checkpoint`.

Good checkpoint moments:

- a checklist item is complete
- a design decision is made
- a batch of files is edited
- a long-running command is about to start

Example prompt:

```text
Checkpoint the bridge: the in-memory limiter is implemented and unit-tested. Next action is to wire the middleware into src/server.ts.
```

### 3. Switch agents or sessions

Before leaving the current agent, say:

```text
Produce a Harness Bridge handoff.
```

Expected result:

- Agent calls `bridge_produce`.
- `Next action` is specific and executable.
- Git state in frontmatter is updated.
- The bridge is ready for the next session.

### 4. Resume elsewhere

Open the same repo in another agent and say:

```text
Consume the Harness Bridge and restate where we are.
```

Expected result:

- Agent calls `bridge_consume`.
- Agent restates the goal, completed work, git discrepancies, file grounding, and next action.
- Agent stops and waits for your confirmation before editing files.

After confirming, the new agent continues from the bridge and keeps updating it at checkpoints.

## LLM Wiki tools

This MCP server also includes tools for the separate LLM Wiki product:

| Tool | What it does |
|---|---|
| `vault_init` | Scaffolds a markdown knowledge vault with `raw/`, `wiki/`, schema files, index, and log. |
| `vault_status` | Reports vault scaffold state and lists pending ingests from `raw/`. |

For setup, daily ingest/query/lint workflows, and the difference between LLM Wiki and Harness Bridge, read [`docs/llm-wiki.md`](./llm-wiki.md).

Ingest, query, and lint are deliberately LLM-driven, not deterministic tools — they need judgment about what's important and what contradicts existing claims. The schema in `CLAUDE.md` is the interface.

## CLI fallback

The package includes a small CLI for local checks.

If installed from npm:

```bash
harness-bridge status
harness-bridge validate .harness/bridge.md
harness-bridge consume
harness-bridge init --title "Add rate limits" --goal "Add per-token rate limiting to public API endpoints."
harness-bridge checkpoint --next-action "Run npm test."
```

If running from a Git checkout:

```bash
node /absolute/path/to/harness-bridge/dist/cli.js status
node /absolute/path/to/harness-bridge/dist/cli.js validate .harness/bridge.md
node /absolute/path/to/harness-bridge/dist/cli.js consume
```

LLM Wiki CLI commands are documented in [`docs/llm-wiki.md`](./llm-wiki.md#cli-fallback).

## Recovery

Use `bridge_recover` when `.harness/bridge.md` is missing, stale, or suspect.

Recovery still requires agent judgment because transcripts differ by provider. The MCP tool validates and writes recovered bridge markdown, but the agent must synthesize that markdown from transcript evidence and get your confirmation before writing.

Modes:

- `verify` — read-only discrepancy report.
- `since` — top up a stale bridge from transcript evidence.
- `full` — rebuild a missing bridge.

## Safety rules

- Do not put secrets, tokens, `.env` values, passwords, or raw transcripts in `.harness/bridge.md`.
- MCP bridge writes validate the schema and refuse credential-shaped content before writing.
- Keep decisions append-only. Supersede old decisions with new entries instead of rewriting history.
- Use serial handoffs: one agent works, then another agent resumes. Concurrent bridge editing is not supported yet.
- Keep durable design rationale in docs or your vault/wiki; keep current task state in `.harness/bridge.md`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Agent cannot see Harness Bridge tools | Confirm the MCP config points to `npx -y @codemeall/harness-bridge mcp` or `node /absolute/path/to/harness-bridge/dist/cli.js mcp`, then restart the agent/editor. |
| Git-checkout command cannot find `dist/cli.js` | Run `npm install` and `npm run build` in the Harness Bridge clone. |
| `npx` fails with cache permission errors | Fix the local npm cache ownership or use the Git-checkout setup. |
| `bridge_status` says `head` or `dirty` differs | Read the discrepancy before acting; the bridge may be stale or the repo may have new uncommitted work. |
| Cursor recovery cannot find transcript | Export/copy the Cursor chat manually and provide it to the agent for recovery. |
| Bridge grows too long | Move durable rationale to docs or the vault; keep only goal, plan, next action, decisions, questions, and files touched. |

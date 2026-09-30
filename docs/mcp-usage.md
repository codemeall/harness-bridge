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

All bridge tools accept an optional `cwd` argument. Agents should pass the absolute workspace path when the MCP client exposes it, especially in editors that can start stdio MCP servers from a different process directory than the project. Write tools return the absolute `.harness/bridge.md` path they updated.

`bridge_produce` intentionally rejects an empty no-op call. The agent must provide the current handoff fields (`plan`, `nextAction`, `filesTouched`, `openQuestions`, `notes`, appended decisions, `focus`, `references`, or `suggestedSkills`), or set `confirmNoChanges: true` only after checking that the existing bridge already contains the complete handoff.

`bridge_checkpoint` and `bridge_produce` also accept three optional handoff fields:

| Field | Section written | Use it for |
|---|---|---|
| `focus` | `## Next session focus` | What the next session will be used for; `/handoff <text>` passes this through. |
| `references` | `## References` | Paths/URLs to specs, ADRs, issues, PRs, commits: link them instead of copying them into the bridge. |
| `suggestedSkills` | `## Suggested skills` | Skills the next agent should load, one reason each. |

Pass an empty string to clear one. `bridge_init` accepts `localOnly: true` to keep the bridge out of git via `.git/info/exclude`.

The LLM Wiki knowledge-vault tools now ship separately in [`@codemeall/harness-wiki`](https://github.com/codemeall/harness-wiki).

The server also exposes these prompt resources for agents that want the canonical prompt text:

- `bridge_init_prompt`
- `bridge_maintainer_prompt`
- `bridge_producer_prompt`
- `bridge_consumer_prompt`
- `bridge_recover_prompt`
- `bridge_uninstall_prompt`

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

Add the skills (`/handoff`, `/pickup`, `harness-bridge`):

```bash
npx -y @codemeall/harness-bridge install-skills             # user-level, ~/.claude/skills
npx -y @codemeall/harness-bridge install-skills --project   # this repo, .claude/skills
```

Or install both the MCP server and the skills as a plugin from inside Claude Code: `/plugin marketplace add codemeall/harness-bridge`, then `/plugin install harness-bridge@codemeall`.

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

Before leaving the current agent, run `/handoff` (optionally with what the next session is for), or say:

```text
Produce a Harness Bridge handoff.
```

Expected result:

- Agent calls `bridge_produce`.
- Agent passes the current session's handoff content, or explicitly confirms no content changes were needed.
- References and suggested skills are recorded for the next agent, and the next-session focus if you gave one.
- `Next action` is specific and executable.
- Git state in frontmatter is updated.
- The tool response includes the absolute `.harness/bridge.md` path that was written.
- The bridge is ready for the next session.

### 4. Resume elsewhere

Open the same repo in another agent and run `/pickup`, or say:

```text
Consume the Harness Bridge and restate where we are.
```

Expected result:

- Agent calls `bridge_consume`.
- Agent restates the goal, completed work, git discrepancies, file grounding, and next action.
- Agent stops and waits for your confirmation before editing files.

After confirming, the new agent continues from the bridge and keeps updating it at checkpoints.

## CLI fallback

The package includes a small CLI for local checks.

If installed from npm:

```bash
harness-bridge status
harness-bridge validate .harness/bridge.md
harness-bridge consume
harness-bridge init --title "Add rate limits" --goal "Add per-token rate limiting to public API endpoints."
harness-bridge checkpoint --next-action "Run npm test." --focus "Get CI green."
harness-bridge init --title "Spike" --goal "Try the new parser." --local   # keep the bridge out of git
harness-bridge install-skills [--agent claude-code|codex|cursor|gemini-cli] [--project] [--dir <path>] [--force]
```

If running from a Git checkout:

```bash
node /absolute/path/to/harness-bridge/dist/cli.js status
node /absolute/path/to/harness-bridge/dist/cli.js validate .harness/bridge.md
node /absolute/path/to/harness-bridge/dist/cli.js consume
```

## Recovery

Use `bridge_recover` when `.harness/bridge.md` is missing, stale, or suspect.

Recovery still requires agent judgment because transcripts differ by provider. The MCP tool validates and writes recovered bridge markdown, but the agent must synthesize that markdown from transcript evidence and get your confirmation before writing.

Modes:

- `verify` — read-only discrepancy report.
- `since` — top up a stale bridge from transcript evidence.
- `full` — rebuild a missing bridge.

## Safety rules

- Do not put secrets, tokens, `.env` values, passwords, personal data, or raw transcripts in `.harness/bridge.md`.
- MCP bridge writes validate the schema and refuse credential-shaped content before writing (API keys, GitHub/npm/Slack/AWS/Google tokens, JWTs, bearer tokens, private keys, credentialed URLs, `password=`-style assignments).
- Reference specs, ADRs, issues, PRs, and commits instead of copying them into the bridge.
- Keep decisions append-only. Supersede old decisions with new entries instead of rewriting history.
- Use serial handoffs: one agent works, then another agent resumes. Concurrent bridge editing is not supported yet.
- Keep durable design rationale in docs or a long-lived knowledge base; keep current task state in `.harness/bridge.md`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Agent cannot see Harness Bridge tools | Confirm the MCP config points to `npx -y @codemeall/harness-bridge mcp` or `node /absolute/path/to/harness-bridge/dist/cli.js mcp`, then restart the agent/editor. |
| Git-checkout command cannot find `dist/cli.js` | Run `npm install` and `npm run build` in the Harness Bridge clone. |
| `npx` fails with cache permission errors | Fix the local npm cache ownership or use the Git-checkout setup. |
| `bridge_status` says `head` or `dirty` differs | Read the discrepancy before acting; the bridge may be stale or the repo may have new uncommitted work. |
| Cursor recovery cannot find transcript | Export/copy the Cursor chat manually and provide it to the agent for recovery. |
| Bridge grows too long | Move durable rationale to docs or a long-lived knowledge base; keep only goal, plan, next action, decisions, questions, and files touched. |

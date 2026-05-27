# MCP Prompt Alignment

Harness Bridge v1 started as a prompt-driven workflow. The MCP server keeps that workflow, but implements the repeatable parts as deterministic tools.

The design rule is:

- `SPEC.md` defines the schema and conformance rules.
- `prompts/*.md` define the human/agent lifecycle workflow.
- MCP tools implement the safe, mechanical parts of those workflows.
- MCP prompts/resources expose the original prompt files so agents can still retrieve the canonical wording.

The MCP server should not parse natural-language prompts as its execution engine. That would be fragile. Instead, tool behavior must be reviewed against the prompts and covered by tests where the behavior is deterministic.

## Prompt to MCP mapping

| Prompt | MCP support | Notes |
|---|---|---|
| `prompts/init.md` | `bridge_init` plus optional `installInstructionsFor` | Creates `.harness/bridge.md` from git state. Can install the maintainer snippet into `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, or `.cursor/rules/harness-bridge.md`. |
| `prompts/maintainer.md` | `bridge_checkpoint`, `bridge_produce`, prompt/resource exposure | Checkpoint updates preserve unknown frontmatter, append decisions, bump git state, validate schema, and refuse credential-shaped content. Cadence judgment still belongs to the agent. |
| `prompts/producer.md` | `bridge_produce` | Performs the mechanical final write. The agent still reviews session history, sharpens `Next action`, and decides what changed since `last_updated`. |
| `prompts/consumer.md` | `bridge_consume`, `bridge_status` | Reads bridge state, compares git state, includes git-log/file grounding, and returns the explicit confirmation gate. The agent must restate and wait before editing. |
| `prompts/recover.md` | `bridge_recover` plus prompt/resource exposure | Validates and writes recovered bridge markdown after confirmation. Transcript interpretation remains agent work because provider transcript formats differ. |
| `prompts/uninstall.md` | prompt/resource exposure only | Full uninstall is still prompt/manual for now; no destructive MCP uninstall tool exists yet. |
| `prompts/vault-init.md` | `vault_init`, `vault_status` plus prompt/resource exposure | Deterministic scaffold of the LLM Wiki folders and schema files. Auto-detects standalone (empty dir) vs co-located (existing project) and appends a marker-fenced vault-schema block to a host `CLAUDE.md` / `AGENTS.md` in the co-located case. Ingest/query/lint stay agent-driven because they need judgment; the prompt remains the canonical source for those operations. |

## Current limitations

- `bridge_recover` does not automatically locate and parse provider transcripts. It supports validated writes from agent-synthesized recovered markdown.
- `bridge_produce` cannot know what happened verbally since `last_updated`; the agent must provide the updated plan, decisions, files, and next action.
- `bridge_checkpoint` does not decide cadence on its own; the agent decides when a checkpoint is meaningful.
- Uninstall remains prompt-driven to avoid broad destructive file edits from MCP.

## Expected user behavior

After MCP setup, users should be able to say natural things like:

```text
Use Harness Bridge to initialize this repo for handoffs.
```

```text
Checkpoint the bridge. The middleware is wired and the next action is to add route overrides.
```

```text
Produce a Harness Bridge handoff.
```

```text
Consume the Harness Bridge and restate where we are.
```

The agent should call the matching MCP tool, then follow the prompt-level rule that matters most: after consuming, restate and wait for explicit user confirmation before executing.

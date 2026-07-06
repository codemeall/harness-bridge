# Harness Bridge

> Hand off AI coding agent context between sessions and providers — through a single committed markdown file.

**The problem.** Your AI coding agent is mid-task and the session ends — token limit hit, the tool crashed, or you want to move the work to a different provider. The next session starts cold. It re-asks what you're doing, re-decides things the previous session already settled, and silently drops the open questions you were deferring. You either retell the whole story or accept the regression.

**The fix.** The agent maintains a tiny markdown file at `.harness/bridge.md` while it works. When any session ends, a new session — same provider or different — reads that file, grounds itself in your repo's git state, restates what's going on, waits for your confirmation, and continues exactly where the previous one left off.

**What you install.** Recommended: configure the local MCP server so your coding agent can call bridge tools directly. If your agent does not support MCP, use the prompt-only fallback. In both modes, `.harness/bridge.md` stays the source of truth.

**Companion product.** Looking for the long-lived knowledge-base workflow (research, design rationale, decisions)? That now lives in its own package, [`@codemeall/harness-wiki`](https://github.com/codemeall/harness-wiki). Harness Bridge tracks the current task; Harness Wiki tracks the durable context around the work.

---

## Table of contents

- [Harness Bridge core](#harness-bridge-core)
- [What a bridge looks like](#what-a-bridge-looks-like)
- [How it works in 30 seconds](#how-it-works-in-30-seconds)
- [Install](#install)
- [Use it](#use-it)
- [Common scenarios](#common-scenarios)
- [Bridge prompt reference](#bridge-prompt-reference)
- [Provider support (bridge)](#provider-support-bridge)
- [MCP integration](#mcp-integration)
- [MCP usage guide](./docs/mcp-usage.md)
- [FAQ (bridge)](#faq-bridge)
- [What it is / what it isn't](#what-it-is--what-it-isnt)
- [Uninstall (bridge)](#uninstall-bridge)
- [Project status & roadmap](#project-status--roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Harness Bridge core

Harness Bridge is the core handoff workflow in this repo. If your goal is reliable handoff between AI sessions while coding in a project repo, start here.

---

## What a bridge looks like

A real bridge file mid-task. This is the actual artifact — readable by you, by your AI agent, and diffable in git.

```markdown
---
schema: harness-bridge/v1
generated_by: claude-code
generated_at: 2026-05-20T14:08:00Z
last_updated: 2026-05-20T15:42:00Z
cadence: checkpoint
repo: example-api
branch: feat/rate-limit
head: 7f3a2c1
dirty: false
---

# Bridge — Add token-bucket rate limiter to public API

## Goal
Public API endpoints currently have no rate limiting; abuse from a single token
can degrade service for everyone. We're adding a per-token token-bucket limiter
with configurable defaults (60/min, burst 20) and per-route overrides.

## Plan
- [x] Define RateLimiter interface
- [x] In-memory TokenBucket for unit tests
- [x] Redis-backed TokenBucket
- [~] **Wire middleware into src/server.ts** — interface plugged in; per-route overrides pending
- [ ] Add per-route overrides
- [ ] Integration test against real Redis
- [ ] Document config

## Next action
Open src/routes/index.ts and pipe each route's `rateLimit` metadata into the
`rateLimitMiddleware()` call already wired in src/server.ts:42. Start with
POST /v1/messages which needs 10/min, burst 3.

## Decisions & rationale
- **Token bucket over fixed window** — smoother for legit bursts.
- **Redis over in-memory for prod** — multiple replicas; in-memory is per-process.

## Open questions
- 429 vs 503 on limit hit? — defer; default to 429.

## Files touched
- src/middleware/rate-limit/* — new module
- src/server.ts — wired at line 42; default config only
- tests/rate-limit.test.ts — in-memory covered; Redis pending
```

See [`examples/`](./examples/) for three more realistic bridges (mid-feature, mid-bugfix with `dirty: true`, and one recovered from a crashed session's transcript).

---

## How it works in 30 seconds

```
┌─────────────────┐   writes & updates    ┌──────────────────────┐
│  Session A      │ ──────────────────▶  │  .harness/bridge.md  │
│  (Claude Code,  │                       │  (committed in git)  │
│   any provider) │                       └──────────┬───────────┘
└─────────────────┘                                  │
       ╳ session ends                                │ reads & resumes
       (limit / crash / switch)                      ▼
                                          ┌──────────────────────┐
                                          │  Session B           │
                                          │  (same or different  │
                                          │   provider)          │
                                          └──────────────────────┘
```

The agent updates the bridge **at checkpoints** as it works — after a completed task item, a recorded decision, a batch of file edits. So even if a session dies without warning, the most recent state is already on disk, ready for the next session to read.

When the on-disk bridge isn't enough (stale, missing, or suspect), a separate **recovery flow** reads the producing session's transcript and rebuilds the bridge from there.

---

## Install

The easiest path is MCP. You configure the server once per agent/editor, then initialize each repo with a normal instruction like "Use Harness Bridge to initialize this repo."

### Option A — MCP (recommended)

Configure Harness Bridge as a local stdio MCP server:

```bash
npx -y @codemeall/harness-bridge mcp
```

You normally do not run that command by hand; add it to your agent's MCP config so the agent starts it when needed. See [`docs/mcp-usage.md`](./docs/mcp-usage.md) and [`providers/mcp.md`](./providers/mcp.md) for Claude Code, Cursor, Codex, Gemini CLI, and Antigravity setup.

After MCP is connected, open your target repo in the agent and say:

```text
Use Harness Bridge to initialize this repo for handoffs.

Title: <one-line task title>
Goal: <2-4 sentences describing what we are trying to finish and why>
```

The agent calls `bridge_init`, creates `.harness/bridge.md`, and can install the maintainer snippet into the right provider instructions file when requested.

### Option B — prompt fallback

Use this when your agent cannot use MCP. Open your AI coding agent in the target repo and paste the contents of [`prompts/init.md`](./prompts/init.md) as your first message. The agent will:

1. Create `.harness/` at the repo root.
2. Append the maintainer snippet to your provider's instructions file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, or create `.cursor/rules/harness-bridge.md`).
3. Scaffold a starter `.harness/bridge.md`.

Review the diff. Commit when ready.

### Option C — manual

1. Open [`prompts/maintainer.md`](./prompts/maintainer.md).
2. Copy everything between `--- begin snippet ---` and `--- end snippet ---`.
3. Paste it into your provider's instructions file:
   - Claude Code → append to `CLAUDE.md` at your repo root.
   - Codex → append to `AGENTS.md`.
   - Gemini CLI → append to `GEMINI.md`.
   - Cursor → save as a new file `.cursor/rules/harness-bridge.md`.
4. Create an empty `.harness/` directory. The agent will populate `bridge.md` on its first non-trivial task.

---

## Use it

Once installed, the everyday loop is short:

### 1. Just work

Start a session, give it a task. The agent maintains `.harness/bridge.md` at checkpoints as it goes. You can ignore the file most of the time — `git diff .harness/bridge.md` shows what it's tracking if you ever want to peek.

### 2. End a session (planned or not)

If you're closing the session deliberately and want a clean handoff, say:

```text
Produce a Harness Bridge handoff.
```

With MCP, the agent calls `bridge_produce`. In prompt-only mode, paste [`prompts/producer.md`](./prompts/producer.md). Either way, this is a touch-up pass that verifies nothing slipped past the last checkpoint.

If the session dies unexpectedly, you can skip this. The bridge is already current to the last checkpoint.

### 3. Resume in a new session

In a fresh session — same provider or a different one — say:

```text
Consume the Harness Bridge and restate where we are.
```

With MCP, the agent calls `bridge_consume`. In prompt-only mode, paste [`prompts/consumer.md`](./prompts/consumer.md). The agent will:

1. Read `.harness/bridge.md`.
2. Run `git status` / `git log` to ground itself in real state.
3. **Restate the goal, what's done, what's next — in its own words.**
4. **Wait for your confirmation.**
5. Then continue execution and resume maintaining the bridge.

The restate-and-wait step is non-negotiable. It's the cheapest way to catch a misread before it becomes 5,000 tokens of wrong-direction work.

---

## Common scenarios

### "I want to switch from Claude Code to Codex mid-task."

1. In the source session, say `Produce a Harness Bridge handoff` to finalize the bridge.
2. Commit. (Or just stage — the file's on disk either way.)
3. Open Codex in the same repo. Say `Consume the Harness Bridge and restate where we are`. Confirm the restate. Continue.

### "My session crashed and I didn't run the producer prompt."

If you were using checkpoint cadence (the default), the bridge is already current to the last checkpoint — usually a few minutes ago.

1. Open a new session. Say `Consume the Harness Bridge and restate where we are` (or paste `prompts/consumer.md` in prompt-only mode).
2. The restate will show you what state the bridge was in at last checkpoint. If that's close enough to where the session actually died, just continue.
3. If the bridge is missing the last few minutes, ask the agent to run recovery in `since` mode (or paste `prompts/recover.md` in prompt-only mode) — it tops up the bridge from the dead session's transcript.

### "The bridge is gone (or was never created)."

Use the recovery flow in `full` mode. With MCP, ask the agent to recover the bridge from transcript evidence. In prompt-only mode, paste `prompts/recover.md` with mode `full`. The agent reads the session transcript from disk and reconstructs the bridge from scratch.

### "I don't trust this bridge — did the previous session actually do what it says?"

Ask the agent to verify the bridge against transcript evidence. In prompt-only mode, paste `prompts/recover.md` with mode `verify`. The agent diffs the bridge against the transcript and reports discrepancies. Read-only — it won't modify the file.

### "I want to slow down bridge updates — this task is exploratory and I don't want the overhead."

Tell the agent: *"Use lazy cadence for this task."* The agent will update the bridge only on explicit request, or when context fills past ~70%.

### "I want to speed up bridge updates — this task is critical."

Tell the agent: *"Use aggressive cadence — this is critical."* The agent will update after every turn. Expect ~12–18% session token overhead in exchange for near-instant death survivability.

---

## Bridge prompt reference

Harness Bridge uses six operational prompts:

| Prompt | When to use it | Purpose |
|---|---|---|
| [`prompts/init.md`](./prompts/init.md) | First-time setup in a project repo | Installs bridge maintainer instructions and scaffolds `.harness/bridge.md` |
| [`prompts/maintainer.md`](./prompts/maintainer.md) | Manual setup only | Source of the maintainer snippet used by `init` |
| [`prompts/producer.md`](./prompts/producer.md) | End of a session (optional but recommended) | Finalize handoff before switching session/provider |
| [`prompts/consumer.md`](./prompts/consumer.md) | Start of a new session | Read bridge, restate state, confirm, and resume |
| [`prompts/recover.md`](./prompts/recover.md) | Bridge is stale/missing/suspect | Rebuild or verify bridge from transcript |
| [`prompts/uninstall.md`](./prompts/uninstall.md) | Remove Harness Bridge from a repo | Removes `.harness/` and maintainer snippet |

> Looking for the long-lived knowledge-vault workflow? It now ships separately as [`@codemeall/harness-wiki`](https://github.com/codemeall/harness-wiki).

## Provider support (bridge)

| Provider | Maintainer auto-loads from | Continuous updates | Consumer | Recovery |
|---|---|---|---|---|
| Claude Code | `CLAUDE.md` | ✅ | ✅ | ✅ |
| Codex | `AGENTS.md` | ✅ | ✅ | ✅ |
| Cursor | `.cursor/rules/harness-bridge.md` | ✅ | ✅ | ⚠️ manual transcript export |
| Gemini CLI | `GEMINI.md` | ✅ | ✅ | ✅ |
| Gemini Web | pasted at session start | ✅ | ✅ | ❌ no transcript access |

The transport layer is plain markdown files, so any agent that can read and edit local files can use Harness Bridge — even tools not listed above. Provider docs in [`providers/`](./providers/) cover transcript locations and known quirks per agent.

## MCP integration

Harness Bridge includes a local stdio MCP server and CLI package.

With npm:

```bash
npx -y @codemeall/harness-bridge mcp
```

With a Git checkout:

```bash
git clone <repo-url>
cd harness-bridge
npm install
npm run build
node /absolute/path/to/harness-bridge/dist/cli.js mcp
```

The MCP server exposes deterministic local tools for bridge status, init, checkpoint, produce, consume, recover, and validation while keeping `.harness/bridge.md` as the source of truth. It also exposes the canonical `prompts/*.md` files as MCP prompts/resources.

See [`providers/mcp.md`](./providers/mcp.md), [`docs/mcp-usage.md`](./docs/mcp-usage.md), and [`templates/`](./templates/) for Claude Code, Cursor, Codex, Gemini CLI, and Antigravity setup snippets.

For end-to-end setup and daily workflow examples, read [`docs/mcp-usage.md`](./docs/mcp-usage.md).

---

## FAQ (bridge)

### Does this cost extra tokens?

A small amount — roughly **3–6% of session tokens** at default (`checkpoint`) cadence. The maintenance lives in small `Edit` calls that patch one section at a time, not full file rewrites. In exchange you get near-immunity to losing state when a session dies. For comparison, redoing five minutes of lost work after a crash typically costs more than a week of checkpoint overhead.

You can switch to `lazy` cadence (~1–2% overhead) for exploration sessions, or `aggressive` (~12–18%) for critical work.

### Why a single file? Why not a directory?

Because the win comes from a **fixed path** the consumer prompt can target without ambiguity. One file → one `Read`. A directory adds complexity (which file is current? which has the next action?) for no real gain when the schema fits in 50–80 lines.

If a bridge ever grows long enough to need splitting, the schema's wrong — bridges are reference cards, not journals.

### Does the bridge contain sensitive information?

Bridges can contain your goal, decisions, file paths, and short notes. They **must not** contain secrets — the maintainer rules explicitly forbid API keys, tokens, env values, etc. If you'd be uncomfortable with the bridge in a public commit, add `.harness/` to `.gitignore` in that repo.

### What if two agents try to edit the bridge at the same time?

v1 assumes **serial handoffs**: one agent works, then another. Concurrent multi-agent edits are an open problem deferred to v2. If you accidentally run two sessions against the same bridge simultaneously, git merge-conflict semantics apply — it's a markdown file like any other.

### Why not just use the conversation transcript directly?

You can — recovery mode reads transcripts. But transcripts are dense, full of dead ends, and often massive (tens of thousands of tokens). The bridge is the **distilled state** the next agent actually needs: ~30 lines instead of ~30K. Transcripts are the backup; the bridge is the primary source.

### Is this an MCP server / CLI / extension?

The original workflow is a documented convention plus markdown files. The MCP server and CLI let developer agents use the same workflow without copy-pasting every operational prompt.

### Will this work in [tool not listed]?

Probably. If the tool can read and edit local files and has a way to load instructions on session start, the convention applies. Provider files in [`providers/`](./providers/) document the four officially-tested integrations; the schema itself is provider-agnostic.

### Why is it called "Harness Bridge"?

Lineage from the original concept note. The name is preserved through v1; we may revisit it for v2 if it proves limiting.

---

## What it is / what it isn't

**Harness Bridge is:**
- A schema for one markdown file (`harness-bridge/v1`).
- Six short prompts that drive the agent's behavior.
- A set of provider-specific notes for where to install and where to find transcripts.
- Provider-agnostic by design.

**Harness Bridge isn't:**
- A retrieval system. It doesn't index your codebase or build embeddings.
- An agent memory layer. It captures one task's state, not your long-term knowledge.
- A hosted service or background daemon. The optional CLI/MCP server runs locally when invoked by you or your agent.
- A replacement for `CLAUDE.md` / `AGENTS.md`. It appends a section to those files; it doesn't take them over.

---

## Uninstall (bridge)

Use [`prompts/uninstall.md`](./prompts/uninstall.md) when you want to remove Harness Bridge from a repo. It removes both install artifacts:

1. The `.harness/` directory and `bridge.md`.
2. The `## Harness Bridge — keep .harness/bridge.md current` section from your provider's instructions file (or deletes `.cursor/rules/harness-bridge.md`).

Past bridges remain in git history. If you need to scrub history because past bridges contained sensitive content, use `git filter-repo` (or BFG Repo Cleaner) separately.

Re-installation is always possible via `prompts/init.md`.

---

## Project status & roadmap

- **Status:** `harness-bridge/v1` (pre-release).
- **License:** [MIT](./LICENSE).
- **Changelog:** [`CHANGELOG.md`](./CHANGELOG.md).
- **Conformance:** see [`SPEC.md`](./SPEC.md) §10.

### Deferred to v2

These are real ideas, deliberately out of scope until v1 proves the schema:

- Slash-command wrappers per provider (`/bridge-init`, `/bridge-save`, etc.).
- Automated round-trip test harness driving headless agents.
- Multi-agent concurrent edit support and state reconciliation.
- Multi-hop chains (agent A → B → C).
- Bridge linter and GitHub Action for schema validation.
- Encryption / automated secret scanning of bridge content.

---

## Contributing

This is v1 — the schema is intentionally small and the surface is intentionally documentation-only. The most useful contributions right now:

- **Run [`tests/round-trip.md`](./tests/round-trip.md)** against a provider and file any gaps you find.
- **Try the everyday flow** (init → work → die → resume) on a real project and report friction.
- **Propose schema additions in an issue first** — schema changes need to stay tight.

When opening an issue, please include your provider, the prompt you pasted, and the bridge file (with secrets redacted) so the failure is reproducible.

---

## License

[MIT](./LICENSE) — use freely in personal and commercial projects.

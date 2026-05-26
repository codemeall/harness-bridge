# Harness Bridge

> Hand off AI coding agent context between sessions and providers — through a single committed markdown file.

**The problem.** Your AI coding agent is mid-task and the session ends — token limit hit, the tool crashed, or you want to move the work to a different provider. The next session starts cold. It re-asks what you're doing, re-decides things the previous session already settled, and silently drops the open questions you were deferring. You either retell the whole story or accept the regression.

**The fix.** The agent maintains a tiny markdown file at `.harness/bridge.md` while it works. When any session ends, a new session — same provider or different — reads that file, grounds itself in your repo's git state, restates what's going on, waits for your confirmation, and continues exactly where the previous one left off.

**What you install.** You can use Harness Bridge as plain markdown prompts, or configure it as a local MCP server so your coding agent can call bridge tools directly. In both modes, `.harness/bridge.md` stays the source of truth.

**Product boundary (important).** Harness Bridge and LLM Wiki are separate features:
- **Harness Bridge** solves session-to-session handoff for in-flight work in one project repo.
- **LLM Wiki** (optional companion via [`prompts/vault-init.md`](./prompts/vault-init.md)) creates a long-lived "second AI brain" for cross-project knowledge.

Use both together if you want full coverage: vault for the *why*, project for the *what*, bridge for the *current work*. Jump to [Part B — LLM Wiki (optional companion)](#part-b--llm-wiki-optional-companion).

---

## Table of contents

- [Part A - Harness Bridge (core)](#part-a--harness-bridge-core)
- [What a bridge looks like](#what-a-bridge-looks-like)
- [How it works in 30 seconds](#how-it-works-in-30-seconds)
- [Install](#install)
- [Use it](#use-it)
- [Common scenarios](#common-scenarios)
- [Bridge prompt reference](#bridge-prompt-reference)
- [Part B - LLM Wiki (optional companion)](#part-b--llm-wiki-optional-companion)
- [What is an AI brain (second brain)?](#what-is-an-ai-brain-second-brain)
- [Vault vs. bridge](#vault-vs-bridge--different-problems-different-tools)
- [When the vault prompt is worth setting up](#when-the-vault-prompt-is-worth-setting-up)
- [How to set up a vault](#how-to-set-up-a-vault--step-by-step)
- [Day-to-day: using your AI brain](#day-to-day-using-your-ai-brain)
- [Where your second brain meets your project repos](#where-your-second-brain-meets-your-project-repos)
- [The full workflow - vault + bridge + project](#the-full-workflow--vault--bridge--project)
- [Vault provider notes](#vault-provider-notes)
- [Uninstall (vault)](#uninstall-vault)
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

## Part A — Harness Bridge (core)

Harness Bridge is the core feature in this repo. If your goal is reliable handoff between AI sessions while coding in a project repo, stay in Part A.

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

You don't install Harness Bridge once; you set it up **per repo**.

### Option A — one prompt (recommended)

Open your AI coding agent in the target repo. Paste the contents of [`prompts/init.md`](./prompts/init.md) as your first message. The agent will:

1. Create `.harness/` at the repo root.
2. Append the maintainer snippet to your provider's instructions file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, or create `.cursor/rules/harness-bridge.md`).
3. Scaffold a starter `.harness/bridge.md`.

Review the diff. Commit when ready.

### Option B — manual

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

If you're closing the session deliberately and want a clean handoff, paste [`prompts/producer.md`](./prompts/producer.md) as your last message. It's a touch-up pass — verifies nothing slipped past the last checkpoint.

If the session dies unexpectedly, you can skip this. The bridge is already current to the last checkpoint.

### 3. Resume in a new session

In a fresh session — same provider or a different one — paste [`prompts/consumer.md`](./prompts/consumer.md). The agent will:

1. Read `.harness/bridge.md`.
2. Run `git status` / `git log` to ground itself in real state.
3. **Restate the goal, what's done, what's next — in its own words.**
4. **Wait for your confirmation.**
5. Then continue execution and resume maintaining the bridge.

The restate-and-wait step is non-negotiable. It's the cheapest way to catch a misread before it becomes 5,000 tokens of wrong-direction work.

---

## Common scenarios

### "I want to switch from Claude Code to Codex mid-task."

1. In the source session, paste `prompts/producer.md` to finalize the bridge.
2. Commit. (Or just stage — the file's on disk either way.)
3. Open Codex in the same repo. Paste `prompts/consumer.md`. Confirm the restate. Continue.

### "My session crashed and I didn't run the producer prompt."

If you were using checkpoint cadence (the default), the bridge is already current to the last checkpoint — usually a few minutes ago.

1. Open a new session. Paste `prompts/consumer.md`.
2. The restate will show you what state the bridge was in at last checkpoint. If that's close enough to where the session actually died, just continue.
3. If the bridge is missing the last few minutes, paste `prompts/recover.md` with mode `since` — it tops up the bridge from the dead session's transcript.

### "The bridge is gone (or was never created)."

Use the recovery flow in `full` mode. Paste `prompts/recover.md` with mode `full`. The agent reads the session transcript from disk and reconstructs the bridge from scratch.

### "I don't trust this bridge — did the previous session actually do what it says?"

Paste `prompts/recover.md` with mode `verify`. The agent diffs the bridge against the transcript and reports discrepancies. Read-only — it won't modify the file.

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

Optional companion prompt (separate feature):

| Prompt | Feature | Purpose |
|---|---|---|
| [`prompts/vault-init.md`](./prompts/vault-init.md) | LLM Wiki | Bootstraps a separate long-lived knowledge vault ("second AI brain") |

---

## Part B — LLM Wiki (optional companion)

Harness Bridge ships an optional companion prompt — [`prompts/vault-init.md`](./prompts/vault-init.md) — that bootstraps a personal **LLM Wiki**, also called an **AI brain** or **second brain**. It's a markdown-based knowledge base that an AI agent maintains for you over time.

### What is an AI brain (second brain)?

A second brain is a structured, interlinked collection of markdown files representing everything you've thought about, read, and decided on across your projects. Unlike a folder of notes, it has *structure*: entities (people, products), concepts (ideas, frameworks), sources (articles, transcripts), and syntheses (analyses, decisions). Pages link to each other; an index summarizes the whole; a log records the timeline of additions and changes.

The point is **compounding**. Each new source you add is integrated into the existing structure — not just filed. New entity? Linked from every relevant concept page. New decision? Old syntheses that touched the same question are flagged for revision. Contradictions surface explicitly. After 50 sources, the wiki isn't 50 disconnected files — it's a cross-referenced map of your thinking.

### Why it's not just "ChatGPT with file uploads"

| | File-upload RAG | LLM Wiki |
|---|---|---|
| What happens when you add a doc | Indexed for retrieval | Read, summarized, integrated into existing pages, cross-referenced |
| What accumulates between sessions | Nothing — retrieval is per-query | Persistent structured wiki you can browse and search |
| Where the "thinking" lives | Re-derived from chunks every query | In syntheses, concept pages, decision logs |
| What you can do after 6 months | Re-upload the docs and re-ask | Read your wiki and pick up where your thinking left off |

RAG retrieves. The LLM Wiki **compiles** and **maintains**. The wiki keeps getting richer every time you add a source or ask a question — the LLM does the bookkeeping that historically killed personal wikis.

### Vault vs. bridge — different problems, different tools

| | LLM Wiki (vault) | Harness Bridge (project) |
|---|---|---|
| What it stores | Design rationale, decisions, research, syntheses | Current work-in-progress state of one task |
| Lifespan | Long-lived — accumulates across projects and years | Per-task — overwritten on each handoff |
| Maintenance pattern | LLM ingests sources, updates concepts, lints | LLM patches the bridge at checkpoints |
| Path | A folder of your choice (typically an Obsidian vault) | `.harness/bridge.md` inside each project repo |
| Audience | You (private second-brain) | You + future AI sessions (and possibly teammates) |

### When the vault prompt is worth setting up

- You're starting a non-trivial project and want design history preserved separately from the codebase.
- You're doing research that spans weeks or months across many sources.
- You have (or plan to have) multiple sibling project repos that share intellectual DNA.
- You want a personal knowledge base that doesn't degrade — because the LLM does the maintenance, not you.
- You want a reusable design playground you can return to months from now and still pick up exactly where you left off.

### How to set up a vault — step by step

1. **Choose a directory.** Anywhere on disk. If you use Obsidian, this directory will also be your Obsidian vault — you get the graph view and links for free. Example: `~/Documents/Knowledge Vault/`.
2. **Open the directory in your AI agent.** `cd` into it and start Claude Code, Codex, Gemini CLI, or open it as a Cursor workspace.
3. **Paste the contents of [`prompts/vault-init.md`](./prompts/vault-init.md)** as your first message to the agent.
4. **Answer the agent's questions.** It will ask what domain the vault is for (research, software, personal, business, learning, etc.) so it can tailor the schema. Be specific — the schema written here defines how the vault works going forward.
5. **Review the scaffold.** The agent creates `raw/`, `wiki/{entities,concepts,sources,syntheses}/`, `CLAUDE.md`, `AGENTS.md`, `wiki/index.md`, and `wiki/log.md`. Glance through `CLAUDE.md` — it's the schema future sessions will follow. Adjust if anything doesn't match how you actually want to work.
6. **(Optional) `git init`** the vault if you want history. The vault is just markdown files; everything diffs and branches cleanly.

That's the entire setup. From here on, every future session in this directory follows the schema automatically — `CLAUDE.md` is loaded on session start by whichever provider you're using.

### Day-to-day: using your AI brain

Once the vault exists, you **use it as a thinking partner**. You ask it questions, you push new sources into it, and you let it find connections you'd otherwise miss. The agent does the bookkeeping invisibly; your interaction stays at the level of ideas.

You interact through three operations defined in the schema. **Query** is the one you'll use most.

#### Query — ask your brain a question

This is the main interface. Once the vault has content, you can ask it anything that touches what you've thought about, read, or decided. The agent reads `wiki/index.md` to locate relevant pages, drills in, follows `[[wikilinks]]`, and answers with citations to the underlying sources.

**Examples of real queries**:

- *"What did I conclude about token-bucket vs leaky-bucket rate limiting?"* → Agent pulls the relevant concept and synthesis pages, gives you the decision and why.
- *"Summarize everything I know about Acme Corp."* → Agent reads the entity page plus every source that mentions them, returns a current briefing.
- *"What are all the open questions across my active feature designs?"* → Agent scans `wiki/syntheses/` for "Open questions" sections, returns the list.
- *"I'm about to start the auth rework. What design context do I already have?"* → Agent surfaces relevant concepts, prior decisions, abandoned alternatives.
- *"Three months ago I was reading about X. What did I take away from it?"* → Agent finds the source page and any concept pages it informed.
- *"What contradicts what I just claimed about Y?"* → Agent looks for opposing claims in older sources, surfaces the tension.

If the answer itself is substantive — a comparison, an analysis, a novel connection between two concepts — the agent offers to **file it back** as a new `wiki/syntheses/<slug>.md`. This is how the wiki compounds: your explorations turn into permanent additions to your brain rather than vanishing into chat history.

**Tip**: ask the wiki things before you start any non-trivial work. Five minutes of querying your past thinking saves hours of redoing it.

#### Ingest — feed your brain a new source

You curate sources; the agent integrates them. Sources can be anything: an article you read, a podcast transcript, a meeting note, a paper, a user-interview transcript, feedback from a customer, a half-formed idea you typed out.

1. **Drop the source** into `raw/`. Use the filename to encode what it is (e.g. `raw/2026-05-22-user-interview-acme.md`, `raw/paper-token-bucket-rate-limiting.md`). Obsidian Web Clipper is great for grabbing web articles as markdown.
2. **Tell the agent**: `ingest raw/<filename>`. The agent reads it end-to-end, then **discusses key takeaways with you before writing** — this is your chance to guide what to emphasize and to flag anything that contradicts what you already believe.
3. **Confirm or guide**: say "proceed" or "emphasize X, downplay Y, then proceed."
4. **The agent does the rest**: writes `wiki/sources/<slug>.md`, updates relevant entity and concept pages, creates stubs for important new mentions, updates the index, appends to the log. A single source typically touches 5–15 pages.
5. **Browse the result.** Open Obsidian (or your editor of choice), follow the new links, glance at the graph view to see the wiki's shape change.

**Tip**: ingest one source at a time and stay engaged. The conversation about takeaways is where the actual thinking happens — batch ingestion is faster but you lose the dialog.

#### Lint — keep your brain healthy

Periodically (every few weeks, or whenever you sense drift), say `lint`. The agent audits the wiki and reports:

- Contradictions between pages
- Stale claims newer sources have superseded
- Orphan pages with no inbound links
- Important concepts mentioned but lacking their own page
- Missing cross-references
- Gaps where a web search or a new source would help
- Suggested next questions worth investigating

Lint isn't maintenance you "have to" do — it's a directed exploration prompt. The agent telling you "you keep mentioning Concept X but never wrote a page for it" or "Source A and Source B disagree about Y" is genuinely useful — it surfaces gaps in your thinking, not just your filing.

### A day in the life

What using a second brain actually looks like, over a typical session:

```
You:    Read this article and integrate it.
        [drops raw/article-multi-tenant-isolation.md]

Agent:  Read it. Three things worth flagging before I write:
        • It contradicts your existing claim in concepts/tenant-isolation.md
          about row-level vs schema-level isolation
        • It introduces a new pattern ("cell architecture") that doesn't
          have a concept page yet
        • The author cites your colleague's blog post from 2024 which
          you've never ingested — worth grabbing too?
        Proceed?

You:    Yes — and grab the colleague's post when you find it.

Agent:  [ingests both; writes 2 source pages, creates concepts/cell-architecture.md,
         updates concepts/tenant-isolation.md with a contradictions section,
         updates index and log. 11 pages touched.]

You:    Given everything I now know, what's the right design for our
        multi-tenant rewrite?

Agent:  [reads relevant concept + synthesis pages]
        Here's the synthesis I'd propose [...]
        Want me to file this as wiki/syntheses/2026-05-22-multi-tenant-design.md?

You:    Yes. And tell me what's still uncertain.

Agent:  [files the synthesis; lists open questions]
        Open questions remaining:
        • [...]
        • [...]
        Suggest ingesting the AWS cell-architecture whitepaper next; it
        addresses two of these directly.

You:    Find and ingest it.

[and so on]
```

Every step compounds. The article you read this afternoon is now connected to a decision you made last month. The synthesis you produced today is a `[[wikilink]]` away from any future query. You can come back in three weeks and pick up exactly where this thinking left off.

### Where your second brain meets your project repos

Once a synthesis in `wiki/syntheses/` is approved as a design, the implementation happens in a **sibling project repo** (separate `git init`). The vault tracks the *why*; the project tracks the *what*. Use Harness Bridge in the project to track in-flight implementation work. The vault's `CLAUDE.md` lists each paired project in a **Paired projects** table, so future sessions know where to find them.

This way: when you sit down months later and say "let's continue Project X," the agent reads the vault's `CLAUDE.md`, finds the project path, switches context, reads `.harness/bridge.md` in the project, restates where you were, and you're back at full speed in under a minute.

### What to ingest (and what to skip)

Worth ingesting:
- ✅ Articles and papers you actually read carefully
- ✅ Transcripts of important meetings or user interviews
- ✅ Your own thinking when you have a substantive insight (write it as a `raw/` note)
- ✅ Decision documents, design specs, project briefs
- ✅ Bug reports and feedback patterns that reveal something about your product

Probably skip:
- ❌ Things you skimmed and don't care about
- ❌ Reference material that's already well-indexed elsewhere (you don't need to ingest the React docs)
- ❌ Truly ephemeral notes (shopping lists, daily journal entries unless your vault is a personal one)
- ❌ Auto-generated content (build logs, CI output)

**The rule**: if you'd want a future-you (or a future session) to remember this in 6 months, ingest it.

### The full workflow — vault + bridge + project

Here's how the three pieces combine for a new project:

```
Step 1 — Vault (design phase)
   Drop seed idea into raw/
   Run `ingest`
   Brainstorm with agent → wiki/syntheses/<feature>-design.md

Step 2 — Project repo (greenfield)
   git init a sibling repo to the vault
   Paste prompts/init.md (Harness Bridge) inside the project
   → maintainer snippet appended to CLAUDE.md / AGENTS.md / etc.
   → .harness/bridge.md scaffolded

Step 3 — Vault (register the project)
   Add a row to the vault's Paired projects table in CLAUDE.md
   → future sessions automatically know where the project lives

Step 4 — Build
   Work in the project repo; the agent maintains .harness/bridge.md at checkpoints
   When the session dies / you switch providers / you context-switch:
      paste prompts/consumer.md in the new session
      → resumes exactly where the last one left off

Step 5 — Loop
   New decisions or learnings → also reflect into the vault
      (update relevant concept pages, add new syntheses)
   New features → start at Step 1 again
```

The vault and project are **independent git repos**. The vault stays private (it holds your unfiltered thinking). The project ships publicly (it's the polished deliverable).

### What stays in the vault vs. what ships in the project

| Goes in the vault | Ships in the project repo |
|---|---|
| Why you chose Approach A over B | The README explaining what Approach A is |
| The decision log for v1 → v2 schema migration | The `CHANGELOG.md` summary |
| Half-formed ideas you might come back to | Code, tests, docs that actually work |
| User feedback patterns, raw interviews | Distilled docs informed by the feedback |
| Competitive analysis, research notes | Nothing public about competitors |

A useful test: if a contributor opened a PR, what would they need vs. what would feel weird seeing? PR-relevant artifacts go in the project. Your private thinking goes in the vault.

### Vault provider notes

The vault prompt works in any AI agent that can read and edit local files: Claude Code, Codex, Cursor, Gemini CLI, and others. Once the agent writes `CLAUDE.md` during setup, every future session automatically loads it as the schema. For agents that use a different instructions file (`AGENTS.md`, `GEMINI.md`), the setup also writes a one-line pointer pointing to `CLAUDE.md` so all providers see the same schema.

### Uninstall (vault)

The vault is just a folder of markdown files. To "uninstall," delete the folder (or remove it from your Obsidian vaults list). Nothing's registered globally; nothing leaves the directory.

---

## Back to Harness Bridge

The sections below return to bridge-specific operational details.

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
npx -y harness-bridge mcp
```

With a Git checkout:

```bash
git clone <repo-url>
cd harness-bridge
npm install
npm run build
node /absolute/path/to/harness-bridge/dist/cli.js mcp
```

The MCP server exposes deterministic local tools for bridge status, init, checkpoint, produce, consume, recover, and validation while keeping `.harness/bridge.md` as the source of truth. It also exposes the canonical `prompts/*.md` files as MCP prompts/resources. See [`providers/mcp.md`](./providers/mcp.md), [`docs/mcp-usage.md`](./docs/mcp-usage.md), and [`templates/`](./templates/) for Claude Code, Cursor, Codex, Gemini CLI, and Antigravity setup snippets.

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
- A CLI or daemon. Nothing runs in the background.
- A replacement for `CLAUDE.md` / `AGENTS.md`. It appends a section to those files; it doesn't take them over.

---

## Uninstall (bridge)

Paste [`prompts/uninstall.md`](./prompts/uninstall.md) into a session. It removes both install artifacts:

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

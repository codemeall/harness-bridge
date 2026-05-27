# Vault init — bootstrap an LLM-maintained knowledge base

Use this prompt to set up an **LLM Wiki** (a personal knowledge base maintained by an AI agent) in a fresh directory. The result is a place where you curate sources and ask questions; the agent does all the bookkeeping — summarizing, cross-referencing, filing, flagging contradictions, keeping the index and log current.

This is the companion to the Harness Bridge workflow. The bridge handles **in-session continuity** for a single project; the vault handles **cross-project knowledge accumulation**. Together: vault for the *why*, project repos for the *what*, bridge files for the *current work*.

Paste this entire prompt as your first message to a fresh AI agent session, opened in the directory you want to become your vault.

> **MCP-capable agents:** if `harness-bridge` is configured as an MCP server, call the `vault_init` tool to create the folders and schema deterministically instead of writing them by hand at step 2 below. The tool auto-detects whether the directory is empty (writes a standalone vault) or already holds a project (appends a marker-fenced vault schema to the host `CLAUDE.md` / `AGENTS.md`). The rest of this prompt — domain discussion, first ingest demo, schema confirmation — still applies.

---

You are about to set up an **LLM Wiki / second brain** in the current working directory. Read this brief, then guide me step by step through the setup.

## The pattern

Most LLM+document workflows are RAG: the LLM retrieves chunks at query time and answers from scratch every call. Nothing accumulates.

This is different. An LLM Wiki is a persistent, structured, interlinked collection of markdown files between me and my raw sources. When I add a new source, you read it, extract key information, and **integrate** it into the existing wiki — updating entity pages, revising syntheses, flagging contradictions, maintaining cross-references. Knowledge is compiled once and kept current.

I curate. You maintain. The wiki compounds.

## Three layers

1. **`raw/`** — sources I curate (articles, papers, transcripts, notes, screenshots). Immutable. You read from here; never modify. This is the source of truth. Place images in `raw/assets/`.

2. **`wiki/`** — markdown pages you own and maintain. Subfolders you'll create:
   - `wiki/entities/` — people, organizations, products, places.
   - `wiki/concepts/` — ideas, theories, frameworks, methods.
   - `wiki/sources/` — one summary page per ingested raw source.
   - `wiki/syntheses/` — comparisons, analyses, designs, novel insights worth keeping.

3. **Schema files** — `CLAUDE.md` (and a one-line `AGENTS.md` pointing to it) defining conventions, page formats, and the three operations below. Provider-specific equivalents (`GEMINI.md`, `.cursor/rules/wiki.md`) can be added as one-liners pointing at `CLAUDE.md`.

## Core files inside `wiki/`

- **`wiki/index.md`** — content-oriented catalog. Every page listed with a one-line summary, grouped by category (entities, concepts, sources, syntheses). You update this on every ingest. You read it **first** when answering a query, then drill into relevant pages.
- **`wiki/log.md`** — chronological, append-only. Every entry begins exactly `## [YYYY-MM-DD] <op> | <title>` so it's greppable. Operations: `ingest`, `query`, `lint`, `schema`.

## Three operations

- **Ingest** (`ingest raw/<file>` or `ingest <url>`) — Read source end-to-end. Discuss key takeaways with me **before writing** so I can guide emphasis. Write `wiki/sources/<slug>.md`, update or create relevant entity/concept pages, integrate the new info into existing syntheses, update `index.md`, append to `log.md`. A single source typically touches 5–15 pages.

- **Query** (any question) — Read `wiki/index.md` first, drill into relevant pages, follow `[[wikilinks]]`, synthesize an answer with inline citations to wiki pages (which themselves cite sources). If the answer is substantive (comparison, analysis, novel connection), offer to file it as `wiki/syntheses/<slug>.md` so the insight compounds.

- **Lint** — Periodic health-check. Surface: contradictions between pages, stale claims newer sources have superseded, orphan pages with no inbound links, important concepts mentioned but lacking their own page, missing cross-references, gaps a web search or new source could fill. Suggest next questions worth investigating.

## Paired projects

This vault may serve as the design knowledge base for one or more **sibling project repos** (separate `git init`'d directories that ship the actual deliverables). The `CLAUDE.md` you write MUST include a **Paired projects** section listing each project's path, purpose, and status:

```markdown
## Paired projects
| Project | Path | Purpose | Status |
|---|---|---|---|
| <project-name> | `../<project-name>/` | <one line> | <design / building / shipped> |
```

This section is the discoverability mechanism — any future session reads `CLAUDE.md` automatically and immediately knows which project repos this vault feeds.

**The rule:** the vault holds design rationale, decisions, research; the project holds implementation and what users actually consume. When a `wiki/syntheses/*` synthesis is approved, implementation happens in the sibling project, **not** in the vault.

## Page conventions

In `CLAUDE.md`, lock these conventions:

- **Filenames**: kebab-case (`elon-musk.md`, `prospect-theory.md`).
- **Wikilinks**: `[[wikilinks]]` everywhere. Create stub pages for important new mentions rather than leaving dead links.
- **Frontmatter** on every page:
  ```yaml
  ---
  type: entity | concept | source | synthesis
  created: YYYY-MM-DD
  updated: YYYY-MM-DD
  sources: [source-slug-1, source-slug-2]
  tags: [tag1, tag2]
  ---
  ```
- **Citations**: every non-obvious claim cites a source page (`[[sources/<slug>]]`).
- **Contradictions**: surfaced explicitly in a `## Contradictions` section, never silently reconciled.
- **Style**: wiki pages are reference material, not essays. Lead with the conclusion; expand below. Prefer bullets, short paragraphs, tables. Wiki pages get re-read; write for that.

## What to do now

1. **Confirm the domain**. Ask me what this vault is for — research, a software project's design brain, a learning area, a business knowledge base, personal journal, etc. Tailor the schema accordingly. Examples:
   - **Software-project vault** → emphasize the Paired-projects section; concepts include features and design patterns.
   - **Research vault** → emphasize citation discipline; entities include authors and papers; lint enforces source-backed claims.
   - **Personal vault** → entities include people, places, recurring themes; sources include journal entries and clips.

2. **Create the folder structure**: `raw/`, `raw/assets/`, `wiki/entities/`, `wiki/concepts/`, `wiki/sources/`, `wiki/syntheses/`.

3. **Write `CLAUDE.md`** with the schema above plus any domain-specific rules we agreed on. Write `AGENTS.md` as a one-liner pointing to `CLAUDE.md`.

4. **Initialize `wiki/index.md`** as an empty catalog and `wiki/log.md` with a single entry:
   ```
   ## [<today>] schema | Vault initialized
   - Created folder structure and schema files.
   - Ready for first ingest.
   ```

5. **Show me the final structure**, then **demonstrate the first ingest** so I see the workflow end-to-end before the session ends.

   For the demonstration source, do **one** of the following:

   - **Option A — ingest a source I provide now.** Ask me whether I have a starting source (an article, note, transcript, idea). If I do, I'll drop it into `raw/` and you'll ingest it through the full flow.

   - **Option B — meta-demonstration.** If I don't have a source ready, copy *this brief* (the vault-init prompt itself, including the LLM Wiki pattern explanation) into `raw/vault-init-pattern.md` and ingest that. The result: a `wiki/sources/vault-init-pattern.md` summary, a `wiki/concepts/llm-wiki.md` concept page, an updated `wiki/index.md`, and a fresh `wiki/log.md` entry. The wiki's first concept page documents the pattern that created it — meta but useful, and you have a real example of an ingest before any of your own sources are added.

   In either case, walk through the full ingest flow visibly:
   1. Read the source end-to-end.
   2. Surface key takeaways with me before writing anything.
   3. After my confirmation, write the source page, create or update concept pages, update `index.md`, append to `log.md`.
   4. Summarize which pages you touched so I can browse them in my editor.

6. **Confirm the schema is live.** Restate the three operations (`ingest`, `query`, `lint`) and remind me that from now on every interaction follows the schema.

## Greenfield vs. brownfield projects

This pattern supports both kinds of work the vault can feed into:

- **Greenfield** (new project) — start a `wiki/syntheses/YYYY-MM-DD-<feature>-design.md` *before* any code exists. The synthesis becomes the spec; implementation happens in a freshly spun-up sibling repo when the design is locked.

- **Brownfield** (existing project) — first ingest the existing project's design docs, READMEs, key code comments, and prior decisions into `raw/` and the wiki. Then run a lint pass to surface implicit decisions, gaps, and stale claims. From there, new feature syntheses build on the recovered design context.

In both cases, register the sibling project in `CLAUDE.md`'s **Paired projects** table so future sessions know where it lives.

---

From now on, every interaction follows this schema. I drive the curation; you do the bookkeeping. The wiki compounds.

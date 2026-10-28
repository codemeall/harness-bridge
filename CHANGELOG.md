# Changelog

All notable changes to Harness Bridge are documented here. The project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0]

### Added
- **Cross-provider session recovery.** Recovery works from local transcripts and never contacts the source provider, so it works while that provider is out of quota.
  - New MCP tools: `session_list`, `session_recover`, `session_read`, `session_destinations`.
  - New CLI commands: `sessions`, `recover`, `transcript`, `resume`, `destinations`.
  - Adapters for Claude Code (`~/.claude/projects`) and Codex (`~/.codex/sessions`, both rollout layouts).
  - Detects why a session stopped: usage limit, auth error, interrupted, mid tool call.
  - Rebuilds task state from TodoWrite / TaskCreate / TaskUpdate / update_plan.
  - Checks written files against `git status` and the commits made since the session started.
  - Reports bridge staleness, follows `continued-in` chains, and keeps output to a budget.
- **Recovery packages** in `.harness/recovery/`. They are git-ignored, written only on request, and their frontmatter serves as the recovery history.
- **Destinations:** Codex (`codex -C`), Claude Code, Antigravity CLI (`agy -i`), Cursor Agent. Each shows a verified command, and `--launch` runs it on a TTY.
- **`recover-session` skill** (`/recover-session`), bundled with `handoff`, `pickup` and `harness-bridge` in every install path, including the Claude Code plugin.
- **Antigravity:** provider notes, `installInstructionsFor: "antigravity"` (writes `AGENTS.md`), and `templates/antigravity/AGENTS.md.snippet`.
- **Maintainer rules in one step:**
  - `installInstructionsFor` now accepts a list, so one `bridge_init` call covers several rules files.
  - New `harness-bridge init --rules <target>` (repeatable) does the same from the CLI.
- **CLI help everywhere:** `<command> --help` now prints usage.
  - `transcript` takes line ranges as `--from N --until N`.
- **Skill installer upgrades:**
  - `install-skills` now updates copies it installed earlier (including untouched 0.3.0 copies). Copies you edited, copies owned by another installer such as `npx skills`, and other authors' skills are still left alone unless you pass `--force`.
  - New `skills-status` command shows each skill as current, outdated, modified, external or missing, and exits 1 when an update is due.
  - New agent targets: `opencode`, `antigravity` (app/IDE) and `antigravity-cli`. Aliases `claude`, `chatgpt` and `agy` work too.
  - `--agent` is repeatable. When omitted, every agent detected on the machine is targeted.
- **New docs:** `docs/audit.md`, `docs/architecture.md` (including the T3 Code comparison).

### Fixed
- `.harness/` no longer counts as uncommitted work. Before this fix, every newly written bridge reported a false `dirty` discrepancy.
- **Secret detection:**
  - Now catches Anthropic, GitHub, AWS, Slack, Stripe and Google keys, JWTs, PEM private keys, Bearer headers and URL credentials.
  - Stops rejecting harmless text such as `max_tokens: 100`.
  - One shared pattern table (`src/core/secrets.ts`) now serves both refusal and redaction.
- `bridge_consume` / `bridge_status` cap inlined diffs: 2k characters per file, 6k total.
- A `cwd` that doesn't exist is now rejected instead of being created.
- `bridge_init` reports an existing bridge instead of claiming it initialized it.
- CRLF bridges now parse.
- The CLI uses `parseArgs` (supports `--flag=value` and `--help`) and gives readable errors.

### Changed
- `bridge_recover` description now points to `session_recover` for evidence. Its arguments and behaviour are unchanged.
- The maintainer snippet is about 23% shorter. Its header and template are unchanged.
- The provider snippets now share one body and gained the recovery route. A test keeps them in sync.
- `prompts/recover.md` uses the deterministic engine, with a manual fallback.
- `install-skills --agent codex` now installs to `~/.agents/skills`, the path the current Codex docs use (also read by the ChatGPT desktop app), instead of `~/.codex/skills`.
- `templates/antigravity/settings.json` was renamed to `templates/antigravity/mcp_config.json`, matching Antigravity's file name.
- Gemini CLI is marked legacy. Google moved individual users to Antigravity CLI on 2026-06-18.
- Docs no longer claim unmeasured "6/6" recovery support.
- `npm test` now builds first, because the CLI tests run `dist/cli.js`.

## [0.3.0]

### Added
- **Installable skills** in `skills/`: `handoff` (`/handoff [what the next session is for]`, user-invoked only), `pickup` (resume with git grounding and a confirmation gate), and `harness-bridge` (init, checkpoints, recovery, validation, removal). They work with or without the MCP server.
- **Three install paths:** as a Claude Code plugin (`/plugin marketplace add codemeall/harness-bridge`, then `/plugin install harness-bridge@codemeall`, which bundles the skills and the MCP server), from GitHub with `npx skills@latest add codemeall/harness-bridge`, or from npm with `npx -y @codemeall/harness-bridge install-skills [--agent claude-code|codex|cursor|gemini-cli] [--project] [--dir <path>] [--force]`, plus `uninstall-skills`.
- **Optional bridge sections** (additive within `harness-bridge/v1`): `## Next session focus`, `## References` (link specs, ADRs, issues, PRs, and commits instead of copying them), and `## Suggested skills` (skills the next agent should load). `bridge_checkpoint`/`bridge_produce` accept `focus`, `references`, and `suggestedSkills`; the CLI takes `--focus`, `--references`, and `--suggested-skills`.
- **Local-only bridges:** `bridge_init` takes `localOnly: true` and the CLI takes `init --local`. Both add `/.harness/` to `.git/info/exclude`; `bridge_status` reports `ignoredByGit`.
- `bridge_consume` now also surfaces decisions already made, open questions, focus, references, and suggested skills.

### Changed
- Broader secret detection before writes and in redaction: GitHub, npm, Slack, AWS, and Google tokens, JWTs, bearer tokens, private keys, and credentialed URLs. `password`/`secret`/`token`/`api_key` assignments are now caught while placeholders and env lookups (`${VAR}`, `process.env.X`, `<from vault>`) and plain numbers (`max_tokens: 1024`) are no longer flagged. The refusal names what was found.
- Producer, consumer, and maintainer prompts and the provider snippets now cover next-session focus, references instead of duplicated context, suggested skills, and personal-data redaction.

### Fixed
- Patching a bridge no longer drops body sections the tool doesn't recognize (forward compatibility, now required by SPEC §4/§10).

### Removed
- `templates/claude/SKILL.md`, replaced by `skills/harness-bridge/SKILL.md` and the new install paths.

## [0.2.0]

### Removed
- **Breaking:** removed the LLM Wiki vault tooling (`vault_init` / `vault_status` MCP tools, the `bridge_vault_init_prompt` prompt/resource, the `vault-init` / `vault-status` CLI commands, `prompts/vault-init.md`, and `docs/llm-wiki.md`). The LLM Wiki workflow is now its own package, [`@codemeall/harness-wiki`](https://github.com/codemeall/harness-wiki), so the two products evolve independently. Existing vaults are unaffected; install `@codemeall/harness-wiki` to keep scaffolding and inspecting them.

## [0.1.2]

### Changed
- Reorganized public documentation so Harness Bridge and LLM Wiki are presented as separate products: the root README now focuses on bridge handoffs, and LLM Wiki has its own guide at `docs/llm-wiki.md`.
- Updated the README onboarding to recommend MCP first for supported agents, with prompt paste flows documented as fallback/manual paths.
- Updated npm package references to the scoped package name `@codemeall/harness-bridge`; the CLI binary remains `harness-bridge`.
- Ignored local `.npmrc` files so npm auth tokens are not accidentally committed.

### Added
- LLM Wiki vault tooling distributed via MCP: new `vault_init` and `vault_status` tools, plus `harness-bridge vault-init` / `vault-status` CLI subcommands. `vault_init` scaffolds the canonical folder structure (`raw/`, `raw/assets/`, `wiki/{entities,concepts,sources,syntheses}/`), writes `CLAUDE.md`, `AGENTS.md`, `wiki/index.md`, and `wiki/log.md`, and auto-detects whether to write standalone (empty dir) or co-located with an existing project (appends a marker-fenced `<!-- harness-bridge:vault-schema -->` block to host `CLAUDE.md` / `AGENTS.md`, leaving host content untouched). `vault_status` reports scaffold state and surfaces pending ingests (files in `raw/` with no matching `wiki/sources/<slug>.md`). Idempotent on re-run via the marker; vault-specific collision rules refuse only on existing `wiki/` without `force: true`.
- Initial v1 design: `harness-bridge/v1` schema, six core prompts (init, maintainer, producer, consumer, recover, uninstall), four provider notes (Claude Code, Codex, Cursor, Gemini), three examples, manual round-trip test protocol.
- LLM Wiki prompt `prompts/vault-init.md` — bootstraps a personal markdown knowledge base maintained by an AI agent. It can be used alongside Harness Bridge: wiki for design rationale, project repos for implementation, bridge files for in-flight work.
- MCP server and CLI: Node/npm package, stdio MCP server, deterministic bridge core, and provider setup templates for Claude Code, Cursor, Codex, Gemini CLI, and Antigravity.
- MCP usage guide documenting provider setup, daily workflows, CLI fallback, recovery, safety rules, and troubleshooting.
- Local Git checkout MCP configuration examples for users who want to run the server from a cloned repo.
- MCP prompt/resource exposure for the canonical `prompts/*.md` files, plus stronger consume grounding and schema/secret safeguards for bridge writes.
- MCP prompt-alignment documentation mapping each v1 prompt to the corresponding MCP behavior and current limitations.

## [1.0.0] — TBD

First public release. See `README.md` for the full feature set.

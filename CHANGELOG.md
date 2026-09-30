# Changelog

All notable changes to Harness Bridge are documented here. The project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

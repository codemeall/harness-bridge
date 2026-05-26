# Changelog

All notable changes to Harness Bridge are documented here. The project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial v1 design: `harness-bridge/v1` schema, six core prompts (init, maintainer, producer, consumer, recover, uninstall), four provider notes (Claude Code, Codex, Cursor, Gemini), three examples, manual round-trip test protocol.
- Companion prompt `prompts/vault-init.md` — bootstraps a personal LLM Wiki (markdown-based knowledge base maintained by an AI agent). Pairs with Harness Bridge to form a complete AI development workflow: vault for design rationale, project repos for implementation, bridge files for in-flight work.
- MCP server and CLI: Node/npm package, stdio MCP server, deterministic bridge core, and provider setup templates for Claude Code, Cursor, Codex, Gemini CLI, and Antigravity.
- MCP usage guide documenting provider setup, daily workflows, CLI fallback, recovery, safety rules, and troubleshooting.
- Local Git checkout MCP configuration examples for users who want to run the server from a cloned repo.
- MCP prompt/resource exposure for the canonical `prompts/*.md` files, plus stronger consume grounding and schema/secret safeguards for bridge writes.
- MCP prompt-alignment documentation mapping each v1 prompt to the corresponding MCP behavior and current limitations.

## [1.0.0] — TBD

First public release. See `README.md` for the full feature set.

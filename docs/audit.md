# Harness Bridge audit (v0.2.0 → v0.3.0)

Audit of the repository at commit `49fd1bc` before the session-recovery work. Findings are verified against the source unless marked otherwise.

> **Correction (2026-10-28).** The local checkout audited here was two commits behind GitHub. `origin/main` (`19de2c1`, PR #1) had already added:
> - `/handoff`, `/pickup` and `harness-bridge` skills;
> - a Claude Code plugin;
> - `install-skills` / `uninstall-skills`;
> - broader secret detection.
>
> Statements below about missing skills describe `49fd1bc` only. The 0.4.0 work was merged on top of `origin/main`. See the CHANGELOG.

## Architecture as found

| Layer | Files | Responsibility |
|---|---|---|
| Schema | `SPEC.md`, `src/core/types.ts` | `harness-bridge/v1`: YAML frontmatter + 7 fixed sections in `.harness/bridge.md`. |
| Core | `src/core/bridge.ts` (406 lines), `src/core/git.ts` | Parse/render/validate, `init`, `checkpoint`, `status` (git grounding), consume summary, secret refusal + redaction. |
| MCP | `src/mcp/server.ts` | 7 tools (`bridge_status/validate/init/checkpoint/produce/consume/recover`) + 6 prompts exposed twice (as MCP prompts and as resources). |
| CLI | `src/cli.ts` | `mcp`, `status`, `validate`, `consume`, `init`, `checkpoint`. |
| Prompts | `prompts/*.md` (6) | Paste-in fallback workflow; `maintainer.md` holds the snippet appended to `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`. |
| Provider notes | `providers/*.md` (5) | Instruction-file paths, transcript locations, quirks. |
| Templates | `templates/*` | MCP configs + 4 near-identical instruction snippets (Claude skill, Codex, Gemini, Cursor). |
| Tests | `tests/core.test.ts`, `tests/mcp.test.ts` (13 tests), `tests/round-trip.md` (manual) | |

Skills/commands: the only skill shipped is `templates/claude/SKILL.md`. There is **no `/pickup` skill anywhere**. The user's `/handoff` is a separate generic skill (`~/.agents/skills/handoff`) that writes a free-form summary to `$TMPDIR`; it does not touch `.harness/bridge.md`, so a session that ends via `/handoff` leaves the bridge stale.

## What `bridge_recover` actually does

All recovery intelligence lives in the LLM; the tool is a validator/writer.

| Step | Who does it today |
|---|---|
| Find the transcript | LLM, guided by `providers/*.md`. Heuristic is "most recently modified file" → can silently pick an unrelated session. |
| Read/parse the transcript | LLM, reading raw JSONL in chunks. |
| Skip noise, redact secrets | LLM ("redact as you go"). |
| Reconstruct tasks, files, decisions | LLM. |
| `full` vs `since` behaviour | Not implemented — both modes just validate + optionally write the agent's markdown. |
| `verify` mode | Echoes back redacted `transcriptText` **that the agent had to paste into the tool call**, so the transcript is paid for twice. |
| Validate + write | Code (`validateBridge`, `writeBridge`, `write:true` gate). |

Consequence: emergency recovery costs tens of thousands of tokens of raw JSONL, is non-deterministic, and depends on the destination agent knowing provider-specific file layouts.

## Problems found

### Bugs
1. **False "dirty" discrepancy after every write.** `getGitState` runs `git status --porcelain` including `.harness/bridge.md` itself, so `init` records `dirty:false` and the very next `status` reports `dirty: bridge=false git=true`. The existing test only passes because it dirties `README.md` first.
2. **Secret check is both too strict and too weak.** `token\s*[:=]\s*\S+` rejects harmless bridges (`max_tokens: 100`, `token budget: 4000`). Meanwhile Anthropic (`sk-ant-…` passes only by accident), GitHub (`ghp_`, `github_pat_`), AWS (`AKIA…`), Slack (`xox?-`), JWTs, `Bearer` headers, URL credentials and PEM private keys are not detected.
3. **Duplicated secret patterns.** `SECRET_PATTERNS` (refuse) and `redactSecrets` (redact) are two hand-maintained regex lists that can drift.
4. **Unbounded consume output.** `bridge_consume`/`bridge_status` inline the full `git diff` of every file in *Files touched*. A large refactor floods the destination agent's context.
5. **`cwd` not validated.** A non-existent `cwd` falls through `getRepoRoot` and `mkdirSync(recursive)` creates `.harness/` in an arbitrary path.
6. **Misleading init message.** `bridge_init` on an existing bridge returns "Initialized bridge at …" though nothing was written.
7. **CRLF bridges fail to parse** (frontmatter regex requires `\n`).
8. **CLI crashes with raw `ENOENT`** for `validate` without a bridge; flags only accept `--flag value`.
9. **Docs overclaim.** README and `providers/*.md` mark recovery "✅ / 6/6 fully supported" for Codex/Gemini although nothing is automated or measured. `providers/claude-code.md` documents the transcript-dir encoding as "`/` → `-`"; actually every non-alphanumeric character becomes `-` (`/.t3/` → `--t3-`).

### Redundancy / token cost
- `templates/claude/SKILL.md`, `templates/codex/AGENTS.md.snippet`, `templates/gemini/GEMINI.md.snippet`, `templates/cursor/harness-bridge-rule.md` repeat the same ~15 lines with no sync check.
- `bridge_checkpoint` and `bridge_produce` declare identical zod schemas twice.
- The maintainer snippet (~1.1k tokens) is loaded into **every** session; several rules repeat what the tools enforce.
- `prompts/recover.md` asks the LLM to do deterministic work (find file, skip tool output, redact) on every recovery.

### Missing for the emergency scenario
- No transcript discovery, no workspace filtering, no session selection.
- No detection of *why* a session stopped (Claude logs `error:"rate_limit"` records; nothing reads them).
- No comparison of bridge vs transcript (stale-bridge detection is only `head`/`dirty`).
- No destination-provider launch/continuation command.
- No distinction between native resume (`claude --resume`) and cross-provider continuation.

## Changes made (Milestone 1 — cleanup)

| Area | Change |
|---|---|
| Secrets | New `src/core/secrets.ts`: one pattern table used for both refusal (high-confidence only) and redaction (broad). `redactSecrets` still exported from `bridge.ts`. |
| Git | Dirty state ignores `.harness/`; added helpers used by recovery (`git log --since`, porcelain status map, common-dir). |
| Bridge core | Validated `cwd`; CRLF tolerant; diffs capped per file and in total; `initBridge` reports whether it created the file. |
| MCP | Shared patch schema for checkpoint/produce; accurate init message; tool descriptions shortened. Tool names and argument schemas unchanged. |
| CLI | `node:util` `parseArgs` (supports `--flag=value`), friendly errors, `--help`. |
| Templates | A single sync test keeps the instruction snippets consistent. Skills live in `skills/`; `origin/main` had already removed `templates/claude/SKILL.md`. |
| Maintainer snippet | Tightened wording; header (§7) and template unchanged. |
| Docs | Removed unmeasured "6/6" claims; corrected the transcript-dir encoding. |

Feature work (Milestones 2–5) is described in [`architecture.md`](./architecture.md).

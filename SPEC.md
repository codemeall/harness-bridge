# Harness Bridge — Specification

**Version:** `harness-bridge/v1`

This document is the canonical schema for Harness Bridge. It defines the bridge file format, where it lives, how it's maintained, and the rules every conforming agent and tool must follow.

If you are building tooling, integrating a new provider, or writing a bridge by hand, this is the source of truth.

---

## 1. Overview

A **bridge** is a single markdown file that captures the working state of an AI coding agent session — enough that a different agent (same provider, different provider, fresh or warm) can pick up exactly where the previous one left off and continue execution on the next concrete step.

The bridge is:
- **Plain markdown** with YAML frontmatter.
- **Single file** per repo, at a fixed path.
- **Committed by git** by default — git history is the audit trail.
- **Living** — maintained continuously by the working agent, not written once at end-of-session.

## 2. Location

```
<repo-root>/.harness/bridge.md
```

- One file per repo.
- The `.harness/` directory exists solely to hold the bridge (and possibly future Harness-Bridge state).
- The path is fixed in v1. Tooling MUST NOT look elsewhere.
- The user MAY keep bridges local-only, either by adding `.harness/` to `.gitignore` (shared) or to the clone's `.git/info/exclude` (this clone only; what `bridge_init localOnly` and `harness-bridge init --local` do). Default is to commit.

## 3. Schema — frontmatter

Every bridge file MUST begin with a YAML frontmatter block containing all of the following fields:

```yaml
---
schema: harness-bridge/v1
generated_by: <agent-identifier>     # e.g. claude-code, codex, cursor, gemini-cli, recovery-from-transcript
generated_at: <ISO-8601 UTC>          # set on first write; never changes
last_updated: <ISO-8601 UTC>          # bumped on every checkpoint update
cadence: <checkpoint | lazy | aggressive>
repo: <repository name>
branch: <git branch name>
head: <short SHA of HEAD at last update>
dirty: <true | false>                 # true iff uncommitted changes exist at last update
---
```

### Field rules
- All fields are REQUIRED.
- `schema` is the only versioned field. Future spec versions will change this value.
- Unknown future fields encountered by older tooling MUST be preserved unmodified (forward compatibility).
- `generated_at` is immutable after first write.
- `last_updated` MUST be bumped on every body change.
- `head` is the short SHA (≥7 chars) of `HEAD` at the time the bridge was last updated. Receiving agents use this as the "ground truth anchor."
- `dirty: true` signals the producing session had uncommitted changes. Receivers MUST run `git status` before acting.

## 4. Schema — body

The body MUST contain the following sections, in this order, with these exact headings:

```markdown
# Bridge — <one-line title>

## Goal
<2–4 sentences describing the destination. Not the next step — the why.>

## Next session focus
<Optional. What the next session will be used for.>

## Plan
- [x] completed step
- [x] completed step
- [~] **in-progress step** — short location note
- [ ] pending step
- [ ] pending step

Legend: [x] done · [~] in progress · [ ] pending

## Next action
<Imperative. Single paragraph. Specific file paths, function names, commands.>

## Decisions & rationale
- **<Decision>** — <why this over alternatives, 1–2 sentences>

(Append-only. Never silently revise. To supersede, add a new entry that explicitly references the old.)

## Open questions
- <Question deliberately deferred> — <who/what should resolve, if known>

## Files touched
- `path/to/file` — short note on state (new helper / WIP edit / tests broken / etc.)

## References
- <Optional. Path or URL of a spec, plan, ADR, issue, PR, or commit that already holds context.>

## Suggested skills
- <Optional. `skill-name` — why the next agent should load it.>

## Notes for the next agent
<Optional. Style/context hints. Keep brief.>
```

### Section rules
- **Goal**, **Plan**, **Next action**, **Decisions & rationale**, **Open questions**, and **Files touched** are REQUIRED. Empty required sections MUST be rendered with a placeholder line ("_(none)_") rather than omitted.
- **Next session focus**, **References**, **Suggested skills**, and **Notes for the next agent** are OPTIONAL. Writers SHOULD omit an optional section that has no content (Notes MAY be rendered empty, as earlier v1 tooling did).
- Known sections MUST appear in the order shown above. Sections a tool does not recognize MUST be preserved unmodified when patching (forward compatibility, like unknown frontmatter fields).
- **References** exists so the bridge does not duplicate context that already lives elsewhere. Writers SHOULD link specs, plans, ADRs, issues, PRs, and commits rather than copy them.
- **Suggested skills** names skills (or tools) the receiving agent should load before acting, each with a short reason. Receivers SHOULD load the ones available to them.
- The `[~]` checkbox marker for in-progress items is a Harness Bridge extension to GitHub-flavored markdown.
- **Decisions & rationale** is append-only. A reader MUST be able to reconstruct the full decision history. To change a past decision, add a new entry that supersedes the old one and references it.
- **Next action** is the single load-bearing field. It MUST be imperative, specific, and actionable without the surrounding context.

## 5. Hard exclusions

The bridge MUST NOT contain:
- Verbatim conversation transcripts (use the Recovery flow instead — see §8).
- Long architectural exposition (lives in repo docs, not the bridge).
- Secrets: API keys, tokens, passwords, `.env*` values, credentialed URLs, private keys, anything credential-shaped.
- Personal data: emails, phone numbers, customer or user records.
- Copies of content that already lives in another artifact (spec, ADR, issue, PR, commit, diff). Reference it under **References** instead.

## 6. Cadence

A maintaining agent updates the bridge at one of three cadences, controlled by the `cadence` frontmatter field:

| Value | Update trigger | Overhead | Death-survival window |
|---|---|---|---|
| `aggressive` | After every assistant turn | ~12–18% session tokens | ~1 step |
| `checkpoint` (default) | After completing a checklist item · making a recorded decision · finishing a batch of file edits · before any long-running operation | ~3–6% | ~1 checkpoint |
| `lazy` | Only on explicit request OR when context >70% full | ~1–2% | Whatever's stale at death is lost |

Maintainers MUST NOT update during pure read-only exploration or for trivial edits.

## 7. Maintainer-snippet marker

The maintainer rules (the snippet that goes into `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `.cursor/rules/harness-bridge.md`) MUST be wrapped in an identifiable section. The canonical header is exactly:

```
## Harness Bridge — keep .harness/bridge.md current
```

Uninstall and lint tooling rely on this exact header.

## 8. Recovery

A bridge can be regenerated from the producing session's transcript when missing, stale, or suspect. Recovery has three modes:

| Mode | Precondition | Action | Writes file? |
|---|---|---|---|
| `full` | No usable bridge | Synthesize fresh bridge from transcript | Yes (after user confirms) |
| `since` | Bridge present but stale | Top-up from transcript since `last_updated` | Yes (diff shown first) |
| `verify` | Bridge present but suspect | Diff transcript vs. bridge; report only | No |

Recovery output MUST be a normal `harness-bridge/v1` bridge with `generated_by: recovery-from-transcript` in frontmatter. Secret redaction (§5) applies equally to recovery output.

*Additive (0.3):* tooling MAY write intermediate **recovery packages** (evidence extracted from a transcript, schema `harness-bridge-recovery/v1`) to `.harness/recovery/`. They are not bridges, MUST be redacted, and MUST be excluded from git (the directory carries its own `.gitignore`). Bridge consumers MUST ignore this directory.

## 9. Lifecycle

| Stage | Prompt | Effect |
|---|---|---|
| Init | `prompts/init.md` | Creates `.harness/bridge.md`; appends maintainer snippet to provider's instructions file |
| Maintain | `prompts/maintainer.md` (loaded via instructions file) | Continuous updates per cadence |
| Produce | `prompts/producer.md` · `/handoff [focus]` skill | Explicit finalize before a deliberate handoff, optionally tailored to what the next session is for |
| Consume | `prompts/consumer.md` · `/pickup` skill | New session reads bridge, grounds in git state, loads suggested skills, restates, waits for confirm, then resumes |
| Recover | `prompts/recover.md` | Rebuild or top-up bridge from session transcript |
| Uninstall | `prompts/uninstall.md` | Symmetrically removes both install artifacts |

## 10. Conformance

A tool, agent, or integration is **v1-conformant** if it:
1. Reads bridges following §3–§4 without error.
2. Writes bridges that pass §3–§4 validation.
3. Preserves unknown frontmatter fields and unknown body sections when patching (§3, §4, forward-compat).
4. Honors the cadence rules in §6 when maintaining.
5. Never writes content excluded by §5.
6. Uses the canonical marker header from §7 when installing the maintainer snippet.

## 11. Versioning

- Breaking changes bump the schema version (`harness-bridge/v1` → `v2`).
- Additive changes that older tooling can safely ignore are made within v1 and documented in `CHANGELOG.md`.
- A bridge with a `schema` value tooling doesn't understand MUST be treated as read-only by that tooling.

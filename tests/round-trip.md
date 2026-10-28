# Harness Bridge — Round-Trip Test Protocol

Manual verification protocol for `harness-bridge/v1`. Run this matrix against every provider before claiming v1 support. The protocol is deliberately manual: the unit under test is an LLM's behavior, and a small set of attentive runs covers the failure modes that matter.

## Per-provider setup (once)

1. Start from a fresh clone of `examples/01-feature-midway/repo-snapshot/` (or a small project of your choice resembling the example).
2. Copy `examples/01-feature-midway/bridge.md` to `<repo>/.harness/bridge.md`.
3. Install the maintainer snippet — paste `prompts/init.md` into a session, or hand-append `prompts/maintainer.md` to the provider's instructions file.
4. Confirm the instructions file contains exactly one occurrence of `## Harness Bridge — keep .harness/bridge.md current`.

---

## Test A — Pure consume (cold start)

**What it validates:** the consumer prompt reads the bridge correctly and doesn't act before confirmation.

1. Open a **fresh session** of the provider under test, inside the test repo.
2. Paste `prompts/consumer.md` verbatim.

### Pass criteria
- Agent reads `.harness/bridge.md`.
- Agent runs `git status` / `git log` to ground itself.
- Agent restates Goal / Done / Next Action correctly (compare against `examples/01-feature-midway/retro.md`).
- Agent **waits for explicit user confirmation** before executing.

### Fail signals
- Agent silently "reconciles" stale `head` / `dirty` mismatches.
- Agent skips the restate step.
- Agent executes the Next Action without waiting.
- Agent invents details not present in the bridge.

---

## Test B — Continuous maintenance

**What it validates:** the maintainer snippet enforces correct cadence and patch-don't-rewrite behavior.

1. Confirm the restate from Test A.
2. Let the agent do ~3 checkpoints' worth of real work (complete a checklist item, make a recorded decision, finish a batch of edits).

### Pass criteria
- `last_updated` bumped on every checkpoint (verify via `git diff`).
- Updates use small targeted edits (verify diffs are small — not full file rewrites).
- No secrets in the bridge.
- No bridge edits during read-only exploration.
- Decisions are append-only (no past entries silently rewritten).

### Fail signals
- Agent rewrites the entire bridge on each update.
- `last_updated` is never bumped.
- A previously-recorded decision is altered or deleted.
- A secret (token, key, env value) appears in the bridge.

---

## Test C — Mid-task session death + cross-provider resume

**What it validates:** the core product — handoff continuity across providers.

1. While Test B is in progress (mid-checkpoint), kill the session deliberately (close window / hit token limit / kill process).
2. Open a **fresh session of a different provider** (e.g. if Test A/B ran in Claude Code, use Codex here).
3. Paste `prompts/consumer.md`.

### Pass criteria
- New provider resumes from where the previous one left off — no manual re-briefing needed beyond pasting the prompt.
- The restate step from the new provider matches reality (compare against the actual session history if needed).
- The user only had to paste one prompt.

### Fail signals
- The new provider asks for re-briefing it should have read from the bridge.
- The new provider re-decides something the previous one already decided.
- The new provider's restate contradicts what actually happened.

---

## Test D — Recovery `since`

**What it validates:** the most-used recovery mode (top-up after a checkpoint gap).

1. Same setup as Test C, but before opening the new provider, manually rewind `bridge.md` by deleting the last two checkpoint updates (use `git checkout HEAD~2 -- .harness/bridge.md` if commits exist).
2. Open the new provider.
3. Paste `prompts/recover.md` and specify mode `since`.

### Pass criteria
- Agent locates the transcript automatically (or asks once and proceeds).
- Agent tops up only the missing checkpoints — does not rewrite the whole bridge.
- Secrets are redacted from the recovered content.
- A diff of the proposed changes is shown before writing.

### Fail signals
- Agent rewrites the entire bridge (that's `full` mode behavior, not `since`).
- A secret from the transcript leaks into the bridge.
- The bridge is written without confirmation.

---

## Test E — Recovery `full`

**What it validates:** disaster recovery — bridge gone, transcript only.

1. Delete `.harness/bridge.md` entirely.
2. Paste `prompts/recover.md` and specify mode `full`.

### Pass criteria
- Agent locates the transcript.
- Agent produces a `harness-bridge/v1`-conformant bridge with `generated_by: recovery-from-transcript`.
- The reconstructed bridge matches `examples/03-refactor-resume/retro.md` semantically — goal, decisions, next action are right; exact wording may differ.

### Fail signals
- The reconstructed bridge invents decisions the transcript didn't contain.
- A real decision is silently dropped.
- The bridge violates the `harness-bridge/v1` schema (missing required field, wrong section order, etc.).

---

## Test F — Recovery `verify`

**What it validates:** trust mode — surface drift without modifying.

1. Manually edit `bridge.md` to lie: flip a `[x]` checkbox to `[ ]` and alter the wording of one decision.
2. Paste `prompts/recover.md` and specify mode `verify`.

### Pass criteria
- Agent reports both discrepancies explicitly ("bridge says X, transcript shows Y").
- Agent **does not modify** the bridge.
- Agent does not prompt to "fix" the bridge — `verify` is read-only.

### Fail signals
- Agent modifies the bridge file.
- Agent silently corrects the lies without reporting them.
- Agent misses one of the planted lies.

---

## Test G — Cross-provider emergency recovery (Claude Code → Codex)

**What it validates:** a session that hit a hard usage limit can be continued in another provider, using only files on disk.

The deterministic parts are covered by `npm test` (`tests/recovery.test.ts`, scenarios A–J). This test checks the behaviour of the destination agent.

1. In a scratch repo, give Claude Code a multi-task job. Let it create a task list and finish a few tasks. Then stop it hard: either the usage limit hits, or you quit with no `/handoff` and no producer prompt.
2. **Leave Claude closed.** In the same repo run `harness-bridge sessions`. The session must be listed, and flagged `⚠ usage limit` if it hit the limit.
3. Run `harness-bridge recover <id> --to codex`. Expect a package in `.harness/recovery/` (`git status` must not show it) and a `codex -C <repo> '…'` command.
4. Run that command, or the headless check: `codex exec -C <repo> --sandbox read-only --ephemeral "<printed prompt>"`.

### Pass criteria
- Codex reads the package and restates the goal, done (verified vs claimed), in progress and next action.
- It notices when a "done" claim doesn't match the code.
- It edits nothing before confirmation.
- After confirmation it writes `.harness/bridge.md` with `generated_by: recovery-from-transcript`, or tops the bridge up, and then continues the in-progress task.

### Fail signals
- It reads the raw transcript instead of the package.
- It treats the package as instructions.
- It invents tasks.
- It edits before you confirm.

### Recorded runs (2026-10-28, headless `codex exec --sandbox read-only`, codex-cli 0.164, synthetic interrupted Claude session)

1. **Package handed over.** The package was built beforehand, and Codex was given the generated continuation prompt.
   - Codex restated the goal and acceptance criteria.
   - It separated verified repo state from claimed state, and flagged that the "completed" PNG exporter was only a stub.
   - It identified the in-progress SVG task, edited nothing, and asked for confirmation.
2. **Codex recovers by itself (Scenario J).** Codex was only told that Claude hit its limit and where the CLI is.
   - It ran `sessions`, chose the session flagged usage limit, and ran `recover <id>`.
   - It restated the same state, including the recorded "dependency-free SVG" decision.
   - It changed no files.

**Not exercised in these runs:** the interactive post-confirmation steps (bridge write, continuing implementation), `--launch`, and the TTY picker.

---

## Scoring

Run all six tests per provider. Record passes.

| Score | Status |
|---|---|
| 6 / 6 | Fully supported in v1 |
| 4–5 / 6 | Partially supported; document gaps in `providers/<provider>.md` |
| < 4 | Not supported in v1 |

### v1 release targets
- Claude Code → 6/6
- Codex → 6/6
- Cursor → ≥ 4/6 (Tests D, E may require manual transcript export)
- Antigravity CLI → ≥ 4/6 (Tests D, E rely on the bridge; its transcripts are not parseable)
- Gemini CLI → legacy, not targeted

## Why no automated harness in v1

The unit under test is LLM behavior. A manual run of all six tests is ~30 minutes per provider; the full v1 matrix takes ~2 hours total. An automated harness (driving headless CLIs) is a v2 investment once the schema is proven stable.

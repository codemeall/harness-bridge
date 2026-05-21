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
- Gemini CLI → 6/6
- Gemini Web → ≥ 3/6 (Tests D, E require manual export; F runs on exported transcript)

## Why no automated harness in v1

The unit under test is LLM behavior. A manual run of all six tests is ~30 minutes per provider; the full v1 matrix takes ~2 hours total. An automated harness (driving headless CLIs) is a v2 investment once the schema is proven stable.

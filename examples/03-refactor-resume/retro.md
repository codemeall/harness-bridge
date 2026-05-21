# Retrospective — 03-refactor-resume

This example **dogfoods the recovery flow**. The producing session crashed (token limit hit) without ever running the producer prompt. The bridge here was synthesized from the dead session's transcript via `recover full`.

## Session context
A large refactor across three files, in progress when the session died. The new bridge was reconstructed from `~/.claude/projects/.../latest.jsonl` — it includes:
- All decisions the original session made.
- The plan inferred from the actual edits performed.
- An approximation of "files touched" reconstructed from the tool call history.

## What "correctly resuming" looks like
The receiving agent should:
1. Read the bridge.
2. **Notice `generated_by: recovery-from-transcript`** and treat exact paths/lines with appropriate caution (cross-check against `git status` and `git diff`).
3. Finish the `checkout.ts` migration first — explicit Next action.
4. Fix `tests/checkout.test.ts` imports.
5. Not start `invoice.ts` or `subscription.ts` until checkout is done and tests pass.

## What this example validates
- **Test E (Recovery `full`)**: an agent given only the transcript should produce a bridge similar to this one. "Similar" = same goal, same decisions, same next action; exact wording may differ.
- The receiver should still work correctly off the recovered bridge.
- Tolerance for transcript-induced approximation: file paths and line ranges may be off; semantic content (decisions, open questions, next action) must be right.

## Failure modes to watch for
- Recovered bridge contains a hallucinated decision the transcript didn't actually contain.
- Recovered bridge omits a real decision (e.g. the "function-based API" decision is silently dropped).
- Receiving agent doesn't notice `generated_by: recovery-from-transcript` and treats approximate paths as authoritative.

## What's in `repo-snapshot/`
Placeholder.

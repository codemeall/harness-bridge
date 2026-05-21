---
schema: harness-bridge/v1
generated_by: codex
generated_at: 2026-05-18T22:11:00Z
last_updated: 2026-05-18T23:35:00Z
cadence: checkpoint
repo: notes-app
branch: fix/sync-flaky-test
head: e9b1d04
dirty: true
---

# Bridge — Debug flaky `SyncService.test.ts` (intermittent failure on CI)

## Goal
`tests/sync-service.test.ts` fails ~1 in 5 runs on CI but passes reliably locally. The failure is in the "syncs pending notes after offline reconnect" case. We're identifying the root cause and either fixing it or marking the test correctly so CI stops being noisy.

## Plan
- [x] Reproduce locally (failed once after 30 retries — confirmed race condition, not env-specific)
- [x] Add `console.log` instrumentation in `src/sync/service.ts` around the reconnect handler
- [x] Identified the race: `flushQueue()` is being scheduled before `connection.state` flips to `'open'`
- [~] **Test fix locally** — added a `try/except` wrapping `flushQueue()` to swallow the race; want to revert and fix the actual ordering
- [ ] Replace the `try/except` hack with a proper `await connection.ready()` before `flushQueue()`
- [ ] Re-run the test 100x locally to confirm fix
- [ ] Push and watch CI for green run

Legend: [x] done · [~] in progress · [ ] pending

## Next action
Revert the WIP `try/except` block in `src/sync/service.ts` (lines 47–52) — it's a band-aid that hides the real bug. Then change the call site so `flushQueue()` is awaited *after* `connection.ready()`. The diagnostic `console.log` lines added earlier can stay until we have a green CI run; remove them in the final commit.

## Decisions & rationale
- **Fix the race, don't paper over it** — the `try/except` makes the test green but leaves the production bug in place. Connection state could be `'opening'` when `flushQueue()` fires, dropping legitimate writes silently.
- **Don't add `await sleep(N)` "fixes"** — fragile, race-condition-y; `connection.ready()` is the documented pattern.

## Open questions
- Should `flushQueue()` itself become idempotent (defensive)? — Defer; out of scope for this bug.
- Are there other call sites with the same race? — Quick grep showed two suspects in `src/sync/migrate.ts`; flag for a follow-up issue, not this fix.

## Files touched
- `src/sync/service.ts` — added diagnostic `console.log` lines AND a WIP `try/except` at lines 47–52 (the latter is to revert)
- `tests/sync-service.test.ts` — unchanged from `head`; bumped retry count to 30 in earlier diagnostic run, already reverted

## Notes for the next agent
Working tree is dirty — `git status` will show the WIP changes in `src/sync/service.ts`. Look at the diff before doing anything. The fix path is small (~5 lines changed) once you revert the band-aid.

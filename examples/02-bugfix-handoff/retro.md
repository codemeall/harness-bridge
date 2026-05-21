# Retrospective — 02-bugfix-handoff

A bugfix session with `dirty: true` — uncommitted WIP code that the next agent must inspect and partially revert. Designed to stress the consumer prompt's git-grounding step.

## Session context
Debugging a flaky test. The producing agent added (a) diagnostic logging and (b) a WIP `try/except` band-aid before realizing the band-aid masks the real bug. Wrote the bridge mid-fix to capture both the diagnosis and the intent to revert.

## What "correctly resuming" looks like
The receiving agent should:
1. Run `git status` first and notice the WIP changes in `src/sync/service.ts`.
2. Review the diff before doing anything.
3. **Revert the `try/except`** at lines 47–52 — explicitly named in Next action.
4. Implement the proper fix: `await connection.ready()` before `flushQueue()`.
5. Leave the `console.log` instrumentation in place until CI is green; remove in the final commit.
6. Not touch `src/sync/migrate.ts` (flagged as out-of-scope follow-up).

## Failure modes to watch for
- Agent treats the `try/except` as a real fix and adds tests around it. (Wrong — it's WIP, named for reversion.)
- Agent commits the changes before fixing the root cause.
- Agent immediately removes `console.log` lines before CI is green.
- Agent goes wandering into `src/sync/migrate.ts` because of the open-question mention.

## What's in `repo-snapshot/`
Placeholder for v1.

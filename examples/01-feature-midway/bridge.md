---
schema: harness-bridge/v1
generated_by: claude-code
generated_at: 2026-05-20T14:08:00Z
last_updated: 2026-05-20T15:42:00Z
cadence: checkpoint
repo: example-api
branch: feat/rate-limit
head: 7f3a2c1
dirty: false
---

# Bridge — Add token-bucket rate limiter to public API

## Goal
Public API endpoints currently have no rate limiting; abuse from a single token can degrade service for everyone. We're adding a per-token token-bucket limiter middleware with configurable defaults (60 requests/min, burst 20) and per-route overrides. The limiter must be testable in isolation and survive process restarts via Redis.

## Plan
- [x] Define `RateLimiter` interface in `src/middleware/rate-limit/types.ts`
- [x] Implement in-memory `TokenBucket` for unit tests
- [x] Add Redis-backed `TokenBucket` using `INCR` + `EXPIRE`
- [~] **Wire middleware into `src/server.ts`** — interface plugged in; default config applied; per-route overrides not yet wired
- [ ] Add per-route override via route metadata
- [ ] Write integration test against a real Redis container
- [ ] Document config in `README.md`

Legend: [x] done · [~] in progress · [ ] pending

## Next action
Open `src/routes/index.ts` and pipe each route's `rateLimit` metadata (when present) into the `rateLimitMiddleware()` call already wired in `src/server.ts:42`. Default config stays at 60/min, burst 20; metadata-provided values fully override. Start with the `POST /v1/messages` route which needs 10/min, burst 3.

## Decisions & rationale
- **Token bucket over fixed window** — Smoother behavior for legitimate burst traffic; well-known algorithm; easy to implement on Redis via `INCR + EXPIRE`.
- **Redis over in-memory for prod** — We run >1 API replica; in-memory limiter would be per-process and useless. In-memory implementation kept for unit tests only.
- **Per-token, not per-IP** — Behind our load balancer, source IP is the LB. Token identity is the only reliable signal.

## Open questions
- What's the right response code on rate-limit hit — `429` (standard) or `503` (matches existing patterns elsewhere in the API)? — Defer until docs pass; default to 429.
- Should the limiter expose metrics to Prometheus, or just log? — Defer; out of scope for v1 of the limiter.

## Files touched
- `src/middleware/rate-limit/types.ts` — new file; `RateLimiter` interface
- `src/middleware/rate-limit/in-memory.ts` — new; `TokenBucket` for tests
- `src/middleware/rate-limit/redis.ts` — new; Redis-backed implementation; tested manually against local Redis
- `src/server.ts` — wired `rateLimitMiddleware()` at line 42; default config only
- `tests/rate-limit.test.ts` — covers in-memory only; Redis integration test still pending

## Notes for the next agent
Redis client is already initialized at `src/db/redis.ts`; reuse rather than creating a new connection. The interface is small enough to mock — don't pull in `ioredis-mock` for the unit tests; the in-memory implementation IS the test double.

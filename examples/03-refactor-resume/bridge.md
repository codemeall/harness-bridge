---
schema: harness-bridge/v1
generated_by: recovery-from-transcript
generated_at: 2026-05-15T09:18:00Z
last_updated: 2026-05-15T09:18:00Z
cadence: checkpoint
repo: billing-service
branch: refactor/extract-pricing-module
head: 4c12e8a
dirty: true
---

# Bridge — Extract pricing logic into `src/pricing/` module

## Goal
Pricing logic is scattered across `src/checkout.ts`, `src/invoice.ts`, and `src/subscription.ts`. Three copies of the discount-stacking rules already diverge. We're extracting all pricing logic into a single `src/pricing/` module with a well-defined surface, then updating call sites to use it.

## Plan
- [x] Inventory all pricing-related code across the three files (15 functions identified)
- [x] Design the new module surface: `src/pricing/index.ts` exporting `calculateLineItem`, `applyDiscounts`, `applyTaxes`, `total`
- [x] Create `src/pricing/discounts.ts` — consolidated discount-stacking rules (deduped 3 → 1)
- [x] Create `src/pricing/taxes.ts` — moved from `src/invoice.ts`
- [~] **Migrating `src/checkout.ts`** — partially rewritten to call the new module; some test imports still reference old paths
- [ ] Migrate `src/invoice.ts` to use the new module
- [ ] Migrate `src/subscription.ts` to use the new module
- [ ] Update all test files to import from new paths
- [ ] Delete the now-orphaned old pricing functions
- [ ] Run full test suite

Legend: [x] done · [~] in progress · [ ] pending

## Next action
Finish `src/checkout.ts` migration. Search for any remaining references to the old `calculateCheckoutTotal()` function — it should be entirely replaced by calls into `src/pricing/`. Then fix the broken test imports in `tests/checkout.test.ts` (they still point at the old paths). Do not yet touch `invoice.ts` or `subscription.ts`.

## Decisions & rationale
- **Single `pricing/` module rather than three sub-modules** — The three current files have ~70% overlap; sub-modularizing premature, and the surface is small.
- **Keep `calculateLineItem` as the smallest unit** — discounts and taxes are derived from line-item math; want to keep the data flow clear.
- **Recovered from transcript** — Bridge was rebuilt by `recover full` after a session crash; some detail in *Files touched* may be approximate.

## Open questions
- Should `src/pricing/` use a class-based or function-based API? — Defer; current proposal is functions only. Revisit if call sites get verbose.
- Currency conversion lives in `src/forex.ts`; should it move into `pricing/` too? — Defer to a separate refactor.

## Files touched
- `src/pricing/index.ts` — new; exports module surface
- `src/pricing/discounts.ts` — new; deduplicated discount-stacking rules
- `src/pricing/taxes.ts` — new; lifted from `src/invoice.ts`
- `src/checkout.ts` — partially migrated; expect ~50 lines still referencing old helpers
- `tests/checkout.test.ts` — imports broken; not yet updated
- `src/invoice.ts`, `src/subscription.ts` — untouched (pending)

## Notes for the next agent
This bridge was synthesized from the transcript of a session that crashed mid-refactor. Trust the high-level direction; double-check exact file paths and line ranges before editing. The `repo-snapshot/` directory shows the state at commit `4c12e8a` if you want to ground-truth before resuming.

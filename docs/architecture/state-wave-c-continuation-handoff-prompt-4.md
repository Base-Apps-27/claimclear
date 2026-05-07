# Wave C Continuation Handoff #4

**Status as of this session**: T005 backend reader migration is **substantially complete**. The remaining work is concentrated on the frontend (T006), the training guide (T008), and the gauntlet/docs wrap-up (T010/T011).

## What shipped this session

### Audit finding: continuation #3's open list is done/out of scope

Read every file in continuation #3's "open" list and confirmed:

| File | Status | Why |
|---|---|---|
| `lib/group-readiness.ts` | done | Already migrated. Reads through `buildLegResolvedIndex` from `@workspace/leg-state` — the canonical Wave-C+ helper that already prefers `disposition`. No legacy column reads remain. |
| `lib/system-health-rollup.ts` | out of scope | All `status` references are `ConnectorRow.status` / `CronRunRow.status` / `WorkerSnapshot.status` / `ComponentStatus`. None touch `claims` or `invoice_groups` legacy columns. Same exclusion class as `routes/system-health.ts` per original handoff §T005.4. |
| `lib/stuck-submissions.ts` | out of scope | Only operates on `portal_submissions.status` (the submission row's own state). Same exclusion class as `routes/batch-jobs.ts`. |
| `lib/email-thread.ts` | done | All `status` references are `ThreadStatus` (the per-thread pill). The `isClaimResolved` parameter is computed by the caller (`routes/response-tracker.ts`, switched in continuation #2). |

### New finding: `lib/brief-personalization.ts`

Not in any prior handoff's open list. Two predicates examined:

1. **`OPEN_STATUSES` filter (line 121/148/132)** — §3.B residual. The 8-status set excludes `MAS Eligible` (which is in `awaiting_reattestation` phase with `attest_*` dispositions, NOT in `final_*`), so `disposition NOT IN (final_*)` would over-include in-attestation legs and start surfacing them in the operator's "recently touched open" section. No clean disposition equivalent. **Documented in-file with §3.B comment, kept on legacy `claims.status`.**

2. **`Needs Review` predicate (line 232 → now 251–258)** — clean switch. Per `lib/invoice-state/derive-disposition.ts`, `disposition === "awaiting_review"` is only emitted by `responseDisposition()` when parent phase is `response_received` and there's no verdict yet — exactly the condition the legacy `status === "Needs Review"` mirrors. **Switched to disposition-first ladder with `unclassified` legacy fallback.**

### Validation
- Typecheck clean.
- `brief-yesterday-actions` + `brief-yesterday-activity` + `daily-brief-outcome` + `daily-brief-route-outcome` = **26/26 green**.
- No tests cover `getNeedsYouToday` directly (function is only called from the daily-brief HTTP route), so no fixture migration needed.

## Comprehensive remaining-work audit

Ran `rg -n "claimsTable\.(status|outcome)|invoiceGroupsTable\.(status|outcome)|sopOutcome"` across `src/lib` + `src/routes` (excluding `__tests__` and `scripts`). Categorized every match:

### Intentional residuals (Wave D writer-rewire territory) — DO NOT switch
- `lib/group-packaging.ts:286` — group-level `PACKAGEABLE_GROUP_STATUSES` gate (`phase=triage` over-includes Needs Review/On Hold/Resolved). §3.B. Documented in-file.
- `lib/expiring-filter.ts:100, 126` — `Portal Queued` exclusion + `GROUP_SUBMITTED_STUCK_STATUSES`. §3.B.
- `lib/urgent-snapshot.ts:67` — `Portal Queued` exclusion. §3.B.
- `lib/day-complete.ts:127-128` — §3.C residual.
- `lib/brief-personalization.ts:132` — §3.B (this session, see above).
- `routes/daily-brief.ts:354` — §3.B residual (continuation #2).
- `routes/dashboard.ts:429, 493` — `Portal Queued` exclusion + `GROUP_SUBMITTED_STUCK_STATUSES`. §3.B.

### Response-shape selects (intentionally deferred per original handoff)
Aggregates and `groupBy(status)` calls that build API response payloads, not phase-membership predicates:
- `lib/urgent-snapshot.ts:45`, `lib/brief-personalization.ts:144, 229`
- `routes/dashboard.ts:138-141, 749-757, 1054, 1263` (all `groupBy` aggregates and CASE expressions for analytic rollups)
- `routes/daily-brief.ts:381`
- `routes/invoice-groups.ts:113, 494, 925, 951` (per-row decoration selects)

### Per-row decoration `Set` membership (out of scope per continuation #2 §T005.5)
- `routes/invoice-groups.ts` lines ~59, 81 (used at 520, 536)
- `routes/claims.ts` lines 42, 50 (used at 374, 390)

### Filter inputs from query string (`?status=…`) — leave as-is
The user passes a status value in the URL; the route filters by it. Not Wave C reader migration.
- `routes/invoice-groups.ts:145-167, 187-191, 387`

### Write paths (NOT readers, out of scope)
- `routes/claims.ts` — most `sopOutcome` references (lines 1101, 1194-1208, 1359, 1747, 1872, 1895-1907, 1988, 2243, 2642, 2777). All write-side: SOP-advance handler, drop-reason logger, etc.
- `routes/invoice-groups.ts:1468, 3008-3308` — write-side bulk SOP advance.
- `lib/claim-transitions.ts:555-569` — write-side.
- `lib/denormalized-cache.ts:70-250` — write-side cache materializer (this IS the source of the disposition column; reading from it would be circular).
- `lib/mas-derivations.ts:23-54`, `lib/prompt-leg-inputs.ts:63-375` — input-shape DTOs for derivations and prompts; not readers in the Wave C sense.

### Scripts (out of scope — one-shot migrations)
- `src/scripts/oneshot-promote-stuck-attestation-legs.ts`
- `src/scripts/oneshot-cleanup-stranded-unclassified-legs.ts`
- `src/scripts/llm-first-classifier-backfill.ts`
- `src/scripts/reclassify-confirmation-emails-backfill.ts`

### Type pins (not predicates)
- `routes/response-tracker.ts:110-111` — `typeof claimsTable.status.enumValues[number]` type assertion.

### Real predicates that COULD still be switched but were intentionally deferred
- `routes/dashboard.ts:148, 163, 203-204, 219-220, 241, 669, 721, 738, 768, 781, 3681` (in `routes/invoice-groups.ts`) — all are dashboard analytic rollups (won/lost/withdrawn counts, denied amount sums, settled-approved expressions). Per the original handoff's "switch only phase-membership predicates, not response-shape aggregates" rule, these are response-shape and stay on legacy columns until the writer rewire makes the underlying counts identical.

**Net: T005 backend has no further "clean switches" pending.** Everything else is intentionally deferred per the documented rules.

## What's left in Wave C

| Task | Estimate | Notes |
|---|---|---|
| **T006 frontend reads** | 2 slices | Slice A: `tone.ts` foundation + 5 derivation libs (small, contained, batchable). Slice B: ~13 components/pages (touch-many, run typecheck + Vitest after each batch of 4-5). |
| **T008 training guide rewrite** | 1 slice | 9 slide components + manifest in `artifacts/training-guide/`. Standalone, no backend touch. |
| **T010 gauntlet** | half a slice | Run the prod-mirror test gauntlet: `pnpm -r typecheck`, `pnpm --filter @workspace/api-server test`, `pnpm --filter @workspace/claimclear test`. Document any newly-revealed flakes vs. the 3 known TZ flakes. |
| **T011 docs + Wave D handoff** | half a slice | Update Wave C section in `docs/architecture/state-machine-refactor.md`. Write `state-wave-d-handoff.md` enumerating the writer rewire backlog (see §3.B residuals list above). |

**Realistic remaining cadence**: 3 more focused sessions (T006-A + T006-B; T008; T010+T011 combined).

## Sharp edges (still authoritative — see continuation #2 §3.A-E)

- **§3.A pre-existing TZ flakes**: `must-file-today-parity` and 2 sibling parity tests fail intermittently when `TZ` is unset. Pin `TZ=America/New_York` and ignore unless newly failing on a code path you touched.
- **§3.B claim-level open filters**: claims have no own `phase` column, and `claims.disposition` doesn't by itself encode "is this leg's parent in a closed/non-actionable phase". Wave D should add a per-claim closed/open mirror column or a JOIN-aware helper.
- **§3.C `lib/day-complete.ts` raw SQL**: status/outcome are interpolated as raw column refs. Switching requires rewriting the SQL builder; defer to Wave D.
- **§3.D `disposition === "unclassified"` fallback rule**: every reader switch should fall through to legacy ladder when `disposition` is the default `unclassified`, until backfill is verified complete in prod.
- **§3.E** `routes/dashboard.ts` analytic rollups: response-shape, defer.

## Files touched this session

- `artifacts/api-server/src/lib/brief-personalization.ts` — switched `Needs Review` predicate; documented `OPEN_STATUSES` residual.
- `docs/architecture/state-wave-c-continuation-handoff-prompt-4.md` — this doc.

## Recommended next session

Start T006-A: `lib/tone.ts` (the central status→tone color map in `artifacts/claimclear/src/lib/tone.ts`) plus the 5 frontend derivation libs (run `rg -l "claims?.status|claims?.outcome|sopOutcome" artifacts/claimclear/src/lib` to enumerate). These are pure functions with co-located Vitest tests, so a batch slice with one validation pass per file is safe and fast.

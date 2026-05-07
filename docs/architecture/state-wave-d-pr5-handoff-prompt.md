# Wave D PR5 Handoff

**Status as of this session**: D-PR1 (`is_open` GENERATED column) shipped commit `e883c79d`; D-PR2a (cache helpers write canonical columns alongside legacy mirrors) shipped commit `1ac4867a`; D-PR2b (single-writer rewire of the four SOP/exclude call-site groups) shipped commit `aad41b98`; D-PR2c (cache inversion — `claims.disposition` is the single source of truth, `claims.status` is a derived projection of it) shipped commit `24e85feb` and published in deployment commit `babc17f1`; D-PR3 (§3.B residuals: the per-claim and per-group "is open" filters now read `is_open`) shipped commit `c6f823d2`; D-PR4 (`day-complete.ts` SQL-builder rewrite onto `invoice_groups.phase` + `expired_sweep_cron` writer rewire to stamp the new `disposed_expired` claim disposition) shipped commit `8c878584`. The Wave D suggested sequence in `state-wave-d-handoff.md` §3 / §6.3 is now at **D-PR5**: collapse the §3.E aggregates onto `phase` and retire the three day-complete status residuals (`Portal Queued`, `Generating Email`, `Resolved`) once `submitted_via` lets the deriver promote `Generating Email` to `submitted` and Resolved+Approved to `closed`.

## What shipped this session

### D-PR4 — `day-complete.ts` SQL builder rewrite + `expired_sweep_cron` rewire

Closed §3.C entirely. The day-complete matcher now reads the canonical `invoice_groups.phase` + `outcome` columns instead of the legacy 8-element `status::text IN (...)` list, and the expired-sweep cron stamps a new `disposed_expired` claim disposition alongside the legacy `status='Expired'` cascade so the last unrewired writer drops out of the PROD `phase_mismatch` baseline.

#### Half 1 — `day-complete.ts` SQL builder rewrite

| File:line | Before | After |
|---|---|---|
| `artifacts/api-server/src/lib/day-complete.ts:50-59` (`isGroupConcluded`) | `IN_FLIGHT_STATUSES` / `CLOSED_STATUSES` literal arrays + `CONCLUDED_OUTCOMES` membership check | `phase IN ('submitted','response_received','awaiting_reattestation','closed') OR outcome IN ('Non-Issue','Withdrawn') OR status IN ('Portal Queued','Generating Email','Resolved')` |
| `artifacts/api-server/src/lib/day-complete.ts:123-158` (`isDayConcluded` CTE) | Same literal lists inlined as `g.status::text IN (...)` | Same phase/outcome predicate, expressed via the typed `invoice_groups.phase` column reference; status list collapsed to the 3 residuals |

The 3 status residuals (`Portal Queued`, `Generating Email`, `Resolved`) are intentional and bit-for-bit preserve legacy operator-intent semantics:

- `Portal Queued` and `Generating Email` both live in `phase=ready_to_submit` from `derivePhase`'s POV (pre-submit, on the filing clock), but the day-complete matcher counts them as concluded because the operator has already clicked through. The residual disappears in D-PR5 once `submitted_via` lets the deriver promote them to `submitted`.
- `Resolved` with `outcome=Approved` lives in `phase=triage` from `derivePhase`'s POV (the closure rationale never fired), but the day-complete matcher counts it as concluded because the operator manually approved it. The residual disappears in D-PR5 once the closure-aware `transitionInvoice` writer ships and Resolved+Approved promotes to `closed`.

Inline comment block at `day-complete.ts:108-122` rewritten to point at the D-PR5 cleanup; the Wave-C reader-switch note (Task #517) is removed.

#### Half 2 — `expired_sweep_cron` writer rewire

Per-row, `transitionGroupStatus({newStatus:"Expired", systemOverride:true})` now passes `extraFields: { phase: 'closed', phaseEnteredAt, closureReason: 'expired' }` so the parent flips to the canonical `closed` phase in the same UPDATE that flips `status='Expired'`. Then the sweep loops every disputed non-held child leg (`errorTypeId IS NOT NULL AND status != 'On Hold'`) and calls `setClaimDisposition(id, 'disposed_expired', { isTerminal: true, mirror: 'skip' })` — `mirror: 'skip'` is correct because Expired carries no SOP rationale that needs to flow back to the legacy column.

Held legs are deliberately skipped: the operator's `holdReason` must survive the cascade (the closure history shows "was on hold when the deadline slipped") and the projector's `legHoldReason → On Hold` override (D-PR2c sharp edge #1) would otherwise fight the disposition write.

#### New disposition: `disposed_expired`

23rd canonical disposition added in lockstep across the vocab/schema/projection/deriver layers:

- `lib/vocab/src/claim-disposition.ts` — added to the `CLAIM_DISPOSITIONS` tuple in canonical order; added to `CLOSED_SET`; glossary entry added.
- `lib/db/src/schema/claims.ts` — `claimDispositionEnum.enumValues` updated.
- `lib/leg-state/src/per-leg-sub-status.ts` — projects to the `frozen` sub-status (same family as the other terminal-cascade dispositions).
- `lib/invoice-state/src/derive-disposition.ts` — `closure_reason='expired'` branch returns `disposed_expired` instead of falling through to the generic terminal handler.
- `scripts/src/__tests__/enum-parity.test.ts` — updated to assert the 23-element canonical-order tuple.

#### Migration 0037 — enum value + trigger widening

`lib/db/migrations/0037_disposed_expired_disposition.sql`:

- `ALTER TYPE claim_disposition ADD VALUE IF NOT EXISTS 'disposed_expired';` — idempotent, transaction-safe in PG≥12.
- `CREATE OR REPLACE FUNCTION validate_disposition_against_phase()` — re-emits the trigger function with `disposed_expired` added to the `closed`-phase valid set. The literal is cast at trigger-fire time so the new enum value is visible in the same migration transaction.

Companion `0037_disposed_expired_disposition.down.sql` reverts the trigger function (Postgres cannot drop enum values once added) and includes a commented pre-step heal `UPDATE` that an operator would run if they truly needed to remove the value via the rename-and-recreate dance.

Migration applied cleanly to dev; schema-drift workflow stays clean (the `lib/db/drizzle/0037_*` snapshot agrees with `lib/db/src/schema/`).

### Test fixture follow-up: `day-complete-celebration.test.ts`

The existing fixtures raw-INSERT groups by `status` only and bypass the cache helpers that keep `phase` in lockstep. With the reader now phase-based, every fixture mutation that touches `status` would diverge from `phase` and the tests would fail for the wrong reason. Patched the test to import `refreshGroupDerivedFields` from `denormalized-cache.ts` and call it after `createGroupOnDay` and after every direct `db.update({status})` / `transitionGroupStatusAndOutcome` call so the fixture path mirrors the PROD cache-helper path. Documented inline as test-side shims pending the writer rewires scheduled for D-PR5/D-PR6.

### Files touched this session

- `artifacts/api-server/src/lib/day-complete.ts` — `isGroupConcluded` predicate rewritten; `isDayConcluded` CTE rewritten; comment block re-anchored to D-PR4/D-PR5; caller signature widened to require `phase` alongside `status`/`outcome`.
- `artifacts/api-server/src/lib/expired-sweep.ts` — per-row `transitionGroupStatus` call now passes `extraFields: { phase: 'closed', phaseEnteredAt, closureReason: 'expired' }`; new disputed-non-held child loop calls `setClaimDisposition(id, 'disposed_expired', { isTerminal: true, mirror: 'skip' })`.
- `artifacts/api-server/src/__tests__/day-complete-celebration.test.ts` — `refreshGroupDerivedFields` shim added at every fixture mutation site.
- `lib/vocab/src/claim-disposition.ts` — `disposed_expired` added (tuple, `CLOSED_SET`, glossary).
- `lib/db/src/schema/claims.ts` — enum value added.
- `lib/leg-state/src/per-leg-sub-status.ts` — `disposed_expired → frozen` mapping.
- `lib/invoice-state/src/derive-disposition.ts` — `closure_reason='expired'` branch.
- `scripts/src/__tests__/enum-parity.test.ts` — 23-tuple assertion.
- `lib/db/migrations/0037_disposed_expired_disposition.sql` (+ `.down.sql`) — applied to dev.
- `lib/db/drizzle/**` — regenerated snapshot for migration 0037.
- `docs/architecture/state-wave-d-pr5-handoff-prompt.md` — this doc.

### Validation

- `pnpm exec tsc -b lib/db lib/vocab lib/leg-state lib/invoice-state` — clean (composite dist refresh required after the schema enum addition; stale dist masked the new value with a `Type '"disposed_expired"' is not assignable` until the rebuild).
- `pnpm -r --workspace-concurrency=1 typecheck` — clean.
- `schema-drift` workflow — clean.
- Targeted node test gauntlet (all green):
  - `day-complete-celebration.test.ts` — 9/9.
  - `expired-status-transitions.test.ts` — 5/5.
  - `set-claim-disposition-parity.test.ts` + `per-leg-state.test.ts` + `leg-status-projector.test.ts` — 89/89 combined (includes 14 disposition-parity cases that now exercise the new enum value end-to-end through the trigger).
  - `scripts/src/__tests__/enum-parity.test.ts` — 4/4 (the 23-tuple assertion is the new pin).
- Pre-existing failure clusters from the D-PR2c/D-PR3 handoff docs (`duplicate-of-endpoints.test.ts:291`, `list-count-past-deadline-parity.test.ts:254`, `closure-data-foundation.test.ts` object-storage URL validation, `dates-guardrail.test.ts` / `dashboard-expiring.test.ts` calendar/weekend math) reproduce identically.
- Dev DB conformance audit (`scripts/src/check-invoice-state-derivation.ts`): **42 `phase_mismatch` rows, 0 `is_open` mismatches**. Identical to the D-PR3/D-PR4 baseline. The dev DB is dirty with pre-existing `Needs Review stored=response_received derived=triage` fixture drift; none of these rows are Expired-sweep related, and they will heal lazily as D-PR2a cache helpers touch them. **The PROD audit is the verification that matters for D-PR4** — the D-PR3 baseline of 1 `phase_mismatch` violation (the `expired_sweep_cron` row from invoice id=302) should drop to 0 once D-PR4 publishes and the cron next ticks.

### Operator follow-up for D-PR4

1. **Publish D-PR4 to PROD.** `8c878584` is the deployment commit.
2. **Re-run the conformance audit against PROD post-publish.** Should drop from 1 `phase_mismatch` to 0. The `expired_sweep_cron` row (invoice id=302 — the canary documented in the D-PR2c/D-PR3 handoffs) heals on the next sweep tick once the cron stamps disposition.
3. **(Optional) Manually heal invoice id=302 BEFORE the next sweep tick** — only if the wait-for-cron approach is undesirable. The natural heal is the better proof point.

---

## What's left in Wave D

| PR | Estimate | Notes |
|---|---|---|
| **D-PR5 — §3.E aggregates + `submitted_via` + day-complete residual collapse** | one slice | §3.E. Add `submitted_via` (or equivalent operator-intent column) to `claims` so the deriver can promote `Generating Email`/`Portal Queued` to `submitted`; add a closure-aware `transitionInvoice` writer so `Resolved` + `outcome=Approved` promotes to `closed`. Once both land, the 3-status residual in `day-complete.ts` (`Portal Queued`/`Generating Email`/`Resolved`) collapses, and the §3.B Portal-Queued-exclusion residual in `expiring-filter.ts` / `urgent-snapshot.ts` / `dashboard.ts:493` (held back in D-PR3) becomes a clean `phase = ready_to_submit AND submitted_via IS NULL`. PROD audit is the parity proof. |
| **D-PR6 — drop the `unclassified` fallback** | half a slice | §3.D. Gated on a re-run of the conformance script post-D-PR5 showing no `unclassified` row that should have a canonical value. |

After D-PR6, Wave E (drop the legacy columns) is unblocked.

---

## D-PR5 inventory — §3.E aggregates + `submitted_via` + day-complete residual collapse

Run `rg -n "§3\.E|submitted_via|Portal Queued|Generating Email|Resolved.*Approved" artifacts/api-server/src lib` for the up-to-date list. As of this session the work splits into three independent halves; the `submitted_via` column has to land first because both the day-complete residual collapse AND the §3.B Portal-Queued-exclusion collapse depend on it.

### Half 1 — `submitted_via` column on `claims`

| Surface | Replacement |
|---|---|
| Schema: `lib/db/src/schema/claims.ts` | Add `submittedVia` column (`text`, nullable, no default). Values: `'portal'` (operator submitted via the portal flow), `'email'` (operator submitted via the email flow), `null` (not yet submitted). The column is operator-intent at the moment of click — once set, it does not flip back. |
| Migration: new `0038_claims_submitted_via.sql` | `ALTER TABLE claims ADD COLUMN submitted_via text NULL;` plus a backfill `UPDATE claims SET submitted_via = 'portal' WHERE status IN ('Portal Queued','Generating Email','Awaiting Response',...)` — the backfill list needs an audit pass (every status that implies "operator clicked submit at some point" should be backfilled). The backfill is the proof that the deriver's new branches are sound; without it the post-publish audit will show drift. |
| Writer: `artifacts/api-server/src/lib/group-packaging.ts` (and any sibling that flips a leg into `Portal Queued`/`Generating Email`/`Awaiting Response`) | Stamp `submittedVia = 'portal'` (or `'email'`) at the moment of the operator click. Use `setClaimDisposition`'s `extraFields` slot if available; otherwise add a thin helper. |
| Deriver: `lib/invoice-state/src/derive-phase.ts` | New branch: `if (group.submittedVia != null) return 'submitted'` BEFORE the current `status IN ('Portal Queued','Generating Email')` falls into `ready_to_submit`. This is the change that lets the day-complete residual `OR status IN ('Portal Queued','Generating Email')` go away. |

#### Day-complete residual collapse (depends on Half 1)

| File:line | After Half 1 |
|---|---|
| `artifacts/api-server/src/lib/day-complete.ts:50-59` (`isGroupConcluded`) | Drop `status IN ('Portal Queued','Generating Email')` from the residual. Predicate becomes: `phase IN ('submitted','response_received','awaiting_reattestation','closed') OR outcome IN ('Non-Issue','Withdrawn') OR status = 'Resolved'` (last residual handled in Half 2). |
| `artifacts/api-server/src/lib/day-complete.ts:123-158` (`isDayConcluded` CTE) | Same. |

#### §3.B Portal-Queued-exclusion collapse (depends on Half 1) — held back from D-PR3

| File:line | Before | After |
|---|---|---|
| `artifacts/api-server/src/lib/expiring-filter.ts:86-128` | `phase=triage OR (phase=ready_to_submit AND status != 'Portal Queued')` | `phase=triage OR (phase=ready_to_submit AND submittedVia IS NULL)` |
| `artifacts/api-server/src/lib/urgent-snapshot.ts:50-72` | Same shape | Same shape |
| `artifacts/api-server/src/routes/dashboard.ts:425-431` + `:493` (`GROUP_SUBMITTED_STUCK_STATUSES`) | Same shape | Same shape |

The `must-file-today-parity.test.ts` contract is the sharp edge: the predicate must NOT widen to include `Awaiting Response` / `Ready to Review` / `Processed` rows. With `submittedVia IS NULL` the collapse is provably equivalent to the legacy `status != 'Portal Queued'` exclusion (any leg that the operator clicked submit on has `submittedVia` set, which is exactly the legacy exclusion's intent).

### Half 2 — closure-aware `transitionInvoice` writer + `Resolved`+`Approved` residual collapse

| File:line | Surface | Replacement |
|---|---|---|
| `artifacts/api-server/src/lib/group-transitions.ts:transitionGroupStatus*` | Currently the operator-driven `Resolved` transition does not flip `phase=closed` because `derivePhase` parks Resolved+Approved in `triage` (the closure rationale never fired). | Add a `transitionInvoice` (or `transitionInvoiceWithClosure`) variant that, when the new status is `Resolved` and `outcome=Approved`, stamps `phase='closed' + closureReason='approved' + phaseEnteredAt=now()` in the same UPDATE — same shape as the D-PR4 `expired-sweep.ts` rewire. |
| Deriver: `lib/invoice-state/src/derive-phase.ts` | The `Resolved`+`Approved → triage` branch becomes vestigial once every writer stamps `closureReason`. Leave the branch in place as the safety net; remove in Wave E. |
| `artifacts/api-server/src/lib/day-complete.ts:50-59` + `:123-158` | After Half 2 the `OR status = 'Resolved'` residual goes away. Predicate becomes the clean: `phase IN ('submitted','response_received','awaiting_reattestation','closed') OR outcome IN ('Non-Issue','Withdrawn')`. |

### Half 3 — §3.E aggregate read-paths

Per the Wave D §6.2 sequencing: ship immediately, no parity window. The aggregates are pure column substitution at the read sites (no logic change), and the PROD audit is the parity proof. Inventory live in `state-wave-d-handoff.md` §3.E — re-run `rg -n "§3\.E" artifacts lib` for the current list. The known surfaces:

- Daily-brief admin metrics aggregates that count `phase` membership today via `status IN (...)` lists.
- Dashboard hero-stat aggregates ditto.
- Any `select count(*) from invoice_groups where status IN (...)` that maps cleanly onto `phase IN (...)` once Halves 1 + 2 have landed.

---

## Sharp edges D-PR5 must preserve

Beyond the §3.A-E sharp edges in the Wave-C continuation series and the four D-PR2b additions + the two D-PR4 additions, D-PR5 inherits two contracts that D-PR4 sharpened or kept open:

1. **`Generating Email` is operator-intent, not state-machine state.** The deriver's new `if (submittedVia != null) return 'submitted'` branch is correct ONLY if the writer stamps `submittedVia` at the moment of the click. If the writer stamps it later (e.g., on the email-sent webhook), the deriver will park the leg in `ready_to_submit` between click and webhook, and the day-complete matcher will mis-count the operator's day-complete celebration. Pinned by the existing `day-complete-celebration.test.ts` cases that include a `Generating Email` group on the day; if those tests pass with the deriver-promoted `Generating Email → submitted` path, the residual is correctly preserved.
2. **`Resolved` without `Approved` outcome is NOT closed.** The closure-aware writer in Half 2 must only stamp `phase=closed` for `Resolved + outcome=Approved`. Resolved + outcome IN (`Pending`, `Denied`, etc.) stays in `triage` because the closure rationale has not landed — these are the operator-mid-flow transitions where the dropdown changed but the closure flow did not complete. Pinned by `set-claim-disposition-parity.test.ts` and `closure-data-foundation.test.ts` (modulo the documented pre-existing object-storage URL noise).

### Known unrewired writer: none after D-PR4

D-PR4 closed the last unrewired writer (`expired_sweep_cron`). Post-publish PROD audit should report 0 `phase_mismatch` violations. If a new violation appears in D-PR5 it is necessarily a regression introduced by the `submittedVia` deriver branch or the closure-aware writer — bisect against `8c878584`.

## Sharp edges (still authoritative — see continuation #2 §3.A-E + Wave D §3)

The Wave-C continuation #2 §3.A-E catalogue and Wave D §3.A-E are unchanged by this session. D-PR4 closed §3.C entirely; D-PR5 closes §3.E and the §3.B Portal-Queued-exclusion residual. §3.D (`unclassified` fallback) remains for D-PR6.

---

## Pre-existing test noise to disentangle

D-PR5 verification will encounter the same five unrelated failure clusters documented in the D-PR2c / D-PR3 / D-PR4 handoff docs — all confirmed pre-existing, none regressions of the Wave D PRs to date:

| Test | Failure | Cause |
|---|---|---|
| `artifacts/api-server/src/__tests__/duplicate-of-endpoints.test.ts` | line 291 | Pre-existing dev DB drift; fails identically under D-PR1 code. |
| `artifacts/api-server/src/__tests__/list-count-past-deadline-parity.test.ts` | line 254 | Pre-existing dev DB drift; fails identically under D-PR1 code. |
| `artifacts/api-server/src/__tests__/closure-data-foundation.test.ts` | 10 cases (closure_evidence + outcome PATCH) | `imageUrl must be an application storage path beginning with /objects/` — object-storage validation in evidence routes. Unrelated to disposition. |
| `artifacts/api-server/src/__tests__/dates-guardrail.test.ts` | 8 cases (Friday/Saturday/Sunday math) | Calendar/weekend deadline math; date-dependent on the test runner's wall clock. |
| `artifacts/api-server/src/__tests__/dashboard-expiring.test.ts` | 13 cases (Friday/Saturday/Sunday math + today-deadline group urgency) | Same calendar/weekend math as above. |

Dev DB still has 42 `phase_mismatch` rows (PROD audit was 1 violation as of D-PR3, expected to drop to 0 once D-PR4 publishes and the next sweep ticks). The D-PR2a cache helpers will heal the dev rows lazily as normal traffic touches them. **Do not block D-PR5 on these** — re-run the conformance audit on PROD after D-PR5 lands; that's the verification that matters. Per Wave D §6.2, no parity window is needed.

---

## Recommended next session

1. **Read first** (in order): `state-wave-d-handoff.md` §3.E (the aggregates inventory) and §3.B (the Portal-Queued-exclusion residual held back from D-PR3), then `lib/invoice-state/src/derive-phase.ts` (the canonical `status → phase` mapping that the new `submittedVia` branch slots into), then `artifacts/api-server/src/lib/day-complete.ts` (current implementation post-D-PR4 — the 3-status residual to collapse), then `artifacts/api-server/src/lib/group-transitions.ts` (the closure-aware writer half).
2. **Verify the writer surfaces.** `rg -n "Portal Queued|Generating Email" artifacts/api-server/src/lib/group-packaging.ts` should land you on every site that currently flips a leg into a post-click pre-submit status; each is a `submittedVia = 'portal'|'email'` stamp candidate.
3. **Half 1 first** — schema column + backfill migration + writer stamps + deriver branch. The backfill is the riskiest step: every status that implies "operator clicked submit" must be in the backfill list, or the post-publish audit will show drift on existing rows.
4. **Half 2 second** — closure-aware `transitionInvoice` writer for Resolved+Approved. Reuse the `extraFields: { phase, phaseEnteredAt, closureReason }` pattern from D-PR4's `expired-sweep.ts` rewire.
5. **Half 3 third** — collapse the day-complete residual (now down to 0 status checks), the §3.B Portal-Queued exclusion, and the §3.E aggregates.
6. **Validation gauntlet** (per Wave D §5):
   - `pnpm -r --workspace-concurrency=1 typecheck` — clean.
   - `pnpm --filter @workspace/api-server exec node --import tsx --test src/__tests__/day-complete-celebration.test.ts src/__tests__/expired-status-transitions.test.ts src/__tests__/must-file-today-parity.test.ts src/__tests__/urgent-today-transitions.test.ts src/__tests__/dashboard-expiring.test.ts src/__tests__/set-claim-disposition-parity.test.ts src/__tests__/per-leg-state.test.ts src/__tests__/leg-status-projector.test.ts` — must stay green modulo the documented pre-existing failures.
   - `scripts/src/check-invoice-state-derivation.ts` against PROD post-D-PR5-publish — must remain at 0 violations. Re-run the dev audit; the 42 pre-existing `phase_mismatch` rows should hold steady or monotonically decrease.
7. **Stop at D-PR5.** D-PR6 (`unclassified` fallback drop) is the next session.

---

## Operator follow-up

Status of the D-PR4 post-merge checklist:

1. **Publish D-PR4 to PROD.** `8c878584` is the deployment commit — the §3.C residuals (`day-complete.ts` SQL builder + `expired_sweep_cron` writer) now read/write the canonical phase + disposition columns.
2. **Run conformance audit against PROD post-publish.** Should drop from 1 `phase_mismatch` to 0. The `expired_sweep_cron` row (invoice id=302) heals on the next sweep tick once the cron stamps disposition. The `is_open` mismatch count should remain at 0.
3. **Re-run the dev audit periodically** through the D-PR5 window. The 42 `phase_mismatch` rows are the same `Needs Review stored=response_received derived=triage` drift documented in the D-PR2b/2c/3/4 handoffs; they should heal lazily as the D-PR2a cache helpers touch them. Treat any *increase* as a regression worth investigating.
4. **(Optional) Manually heal invoice id=302** — recommended to leave UNHEALED through the first post-publish sweep tick, since the natural heal is the proof point that D-PR4's cron rewire actually closes the drift.

### How to invoke the PROD audit

The `PROD_DATABASE_URL` Replit secret is wired into the workspace; the dev `DATABASE_URL` points at the dev branch. To run against PROD without disturbing dev:

```bash
DATABASE_URL="$PROD_DATABASE_URL" pnpm --filter @workspace/scripts run check:invoice-state-derivation
```

(The script does not write — it's read-only across `invoice_groups` + `claims`. D-PR1 added a third assertion that the stored `is_open` column equals `isClaimOpen()` / `isInvoiceGroupOpen()` on every row; D-PR5 should keep that count at 0.)

---

## Validation invocation reference

The default `pnpm test` concurrency wedges the shell on this monorepo. The reliable invocations from D-PR2a / D-PR2b / D-PR2c / D-PR3 / D-PR4:

```bash
# Typecheck (workspace-wide)
pnpm -r --workspace-concurrency=1 typecheck

# Composite dist refresh — REQUIRED after schema enum or vocab changes
# (stale dist masks new enum values with "Type 'X' is not assignable" errors)
pnpm exec tsc -b lib/db lib/vocab lib/leg-state lib/invoice-state

# Targeted unit tests for D-PR5 (must run from inside the api-server filter so tsx resolves)
pnpm --filter @workspace/api-server exec node --import tsx --test \
  src/__tests__/day-complete-celebration.test.ts \
  src/__tests__/expired-status-transitions.test.ts \
  src/__tests__/must-file-today-parity.test.ts \
  src/__tests__/urgent-today-transitions.test.ts \
  src/__tests__/dashboard-expiring.test.ts \
  src/__tests__/set-claim-disposition-parity.test.ts \
  src/__tests__/per-leg-state.test.ts \
  src/__tests__/leg-status-projector.test.ts

# Conformance audit (dev)
pnpm --filter @workspace/scripts run check:invoice-state-derivation

# Conformance audit (PROD)
DATABASE_URL="$PROD_DATABASE_URL" pnpm --filter @workspace/scripts run check:invoice-state-derivation
```

If `lib/db/dist` looks stale (a TS error like `Type '"disposed_expired"' is not assignable to type ...` is the tell), rebuild the composite chain explicitly before re-running typecheck:

```bash
pnpm exec tsc -b lib/db lib/vocab lib/leg-state lib/invoice-state
```

Workflow `artifacts/training-guide: web` emits port-collision noise (`EADDRINUSE 0.0.0.0:5924`) on every restart — pre-existing, ignore.

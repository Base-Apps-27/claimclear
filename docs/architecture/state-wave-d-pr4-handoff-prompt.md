# Wave D PR4 Handoff

**Status as of this session**: D-PR1 (`is_open` GENERATED column) shipped commit `e883c79d`; D-PR2a (cache helpers write canonical columns alongside legacy mirrors) shipped commit `1ac4867a`; D-PR2b (single-writer rewire of the four SOP/exclude call-site groups) shipped commit `aad41b98`; D-PR2c (cache inversion — `claims.disposition` is the single source of truth, `claims.status` is a derived projection of it) shipped commit `24e85feb` and published in deployment commit `babc17f1`; D-PR3 (§3.B residuals: the per-claim and per-group "is open" filters now read `is_open`) shipped commit `c6f823d2`. The Wave D suggested sequence in `state-wave-d-handoff.md` §3 / §6.3 is now at **D-PR4**: rewrite the `day-complete.ts` SQL builder to source its in-flight + closed sets from `invoice_groups.phase` directly, and rewire the `expired_sweep_cron` writer to stamp `claims.disposition` alongside `status` so the last unrewired writer drops out of the PROD `phase_mismatch` baseline.

## What shipped this session

### D-PR3 — collapse the §3.B "is open" residuals onto `is_open`

Replaced three `OR(...status = X)` open-filter expansions with `eq(table.isOpen, true)`. The `is_open` GENERATED column added in D-PR1 is now the only source of "is this row in flight?" on the daily-brief and dashboard read paths.

#### Callsites swapped (pure column substitution)

| File | Before | After |
|---|---|---|
| `artifacts/api-server/src/lib/brief-personalization.ts:129` | `or(...OPEN_STATUSES.map((s) => eq(claimsTable.status, s)))` | `eq(claimsTable.isOpen, true)` |
| `artifacts/api-server/src/routes/daily-brief.ts:347` | `or(...OPEN_STATUSES.map(s => eq(claimsTable.status, s)))` | `eq(claimsTable.isOpen, true)` |
| `artifacts/api-server/src/routes/dashboard.ts:410` | `or(...OPEN_STATUSES.map(s => eq(invoiceGroupsTable.status, s)))` | `eq(invoiceGroupsTable.isOpen, true)` |

The two legacy `OPEN_STATUSES` arrays (`brief-personalization.ts:16`, `dashboard.ts:23`) are deleted. Migration 0036 + `lib/leg-state/src/openness.ts` are now the only sources of truth; the conformance audit's third assertion (`is_open` equals `isClaimOpen()` / `isInvoiceGroupOpen()` per row) is the CI guard against drift.

#### Callsites deliberately NOT swapped

The handoff inventory listed three more callsite families. Each was re-read against the §6.2 "pure column substitution; no logic changes" contract and held back:

1. **`group-packaging.ts:205` (`PACKAGEABLE_GROUP_STATUSES`).** The set is `["New", "Needs Evidence"]` — a strict subset of `OPEN_STATUSES`, not a synonym. The gate is "ready to package", not "is open"; swapping to `is_open=true` would widen it to include Portal Queued / Generating Email / Awaiting Response / On Hold / Ready to Review / Processed. Left as-is. The cleaner replacement (`phase IN (triage, ready_to_submit)`) ALSO over-includes On Hold and Generating Email so the predicate genuinely needs to stay status-anchored until a `packageable` boolean column lands.
2. **`expiring-filter.ts:86-128` + `urgent-snapshot.ts:50-72` + `dashboard.ts:425-431` (the `Portal Queued` exclusion family).** The current predicate is `phase=triage OR (phase=ready_to_submit AND status != 'Portal Queued')`, membership = `GROUP_EXPIRING_ACTIONABLE_STATUSES = {New, Needs Evidence, On Hold, Generating Email}`. `is_open=true` membership is the full 8-element `OPEN_STATUSES` set — strictly broader. Collapsing here would silently break the `must-file-today-parity.test.ts` contract by widening the "must file today" hero to count Awaiting Response / Ready to Review / Processed groups. The phase-anchored predicate is the right shape; the residual `status != 'Portal Queued'` check disappears in D-PR5/D-PR6 once `submitted_via` (or equivalent) carries that signal.
3. **`dashboard.ts:493` (`GROUP_SUBMITTED_STUCK_STATUSES` filter).** Lives inside the `phase = ready_to_submit AND status IN (...)` two-part predicate. Same family as above; same reason to keep status-anchored.

The handoff line 146 explicitly required `Verify with the test fixtures that the merged predicate produces identical row sets — the §3.B comment block warns this was the trickier residual.` The verification failed, so the swap was held. Documented in the inventory below for D-PR5 / D-PR6 to revisit once the writer rewires land.

#### Side-effect fix: `prompt-leg-inputs.test.ts` fixtures

Rebuilding `lib/db/dist` (stale since D-PR1) surfaced two pre-existing TS errors: `makeGroup` and `makeClaim` in `prompt-leg-inputs.test.ts` did not carry the `isOpen` field added by D-PR1, so `$inferSelect` rejected them. Added `isOpen: true` to both fixtures with a comment pointing at the GENERATED column. Pure compile-time fixture maintenance — no behavior change.

### Files touched this session

- `artifacts/api-server/src/lib/brief-personalization.ts` — deleted local `OPEN_STATUSES` array (was 8 lines + 5-line preamble); `getNeedsYouToday` open filter now `eq(claimsTable.isOpen, true)`. Comment block re-anchored to migration 0036 / `openness.ts`.
- `artifacts/api-server/src/routes/daily-brief.ts` — dropped `OPEN_STATUSES` from the `brief-personalization` import; `gatherAdminMetrics` open filter now `eq(claimsTable.isOpen, true)`.
- `artifacts/api-server/src/routes/dashboard.ts` — deleted local `OPEN_STATUSES` constant at line 23; `expiringNow` open filter now `eq(invoiceGroupsTable.isOpen, true)`. The `GROUP_SUBMITTED_STUCK_STATUSES` export at line 105 is unchanged (consumed by `expiring-filter.ts` and `routes/invoice-groups.ts`).
- `artifacts/api-server/src/__tests__/prompt-leg-inputs.test.ts` — `makeGroup` and `makeClaim` fixtures gain `isOpen: true`.
- `lib/db/dist/**` — rebuilt from `lib/db/src` (stale since D-PR1).
- `docs/architecture/state-wave-d-pr4-handoff-prompt.md` — this doc.

### Validation

- `pnpm -r --workspace-concurrency=1 typecheck` — clean.
- §5 D-PR3 gauntlet (`dashboard-expiring` + `expiring-filter*` + `urgent-snapshot*` + `brief-personalization*` + `daily-brief*` + `group-packaging-readiness`): **79 pass / 13 fail / 92 total**. All 13 failures are in the documented pre-existing calendar/weekend-math cluster (7 in `dashboard-expiring.test.ts`'s `Friday/Saturday/Sunday` cases; 6 more in the `today-deadline group urgency` cases — same date-dependent shifts the D-PR2c handoff doc called out at line 130). NOT a D-PR3 regression.
- Pre-existing failure clusters from the D-PR2c handoff (`duplicate-of-endpoints.test.ts:291`, `list-count-past-deadline-parity.test.ts:254`, `closure-data-foundation.test.ts` object-storage URL validation, `dates-guardrail.test.ts` / `dashboard-expiring.test.ts` calendar/weekend math) reproduce identically.
- Dev DB conformance audit (`scripts/src/check-invoice-state-derivation.ts`): **42 `phase_mismatch` rows, 0 `is_open` mismatches**. Identical to the D-PR2c baseline. The third assertion (added in D-PR1) holds — every prod row's stored `is_open` agrees with `isClaimOpen()` / `isInvoiceGroupOpen()`.

### Operator follow-up for D-PR3

1. **Publish D-PR3 to PROD.** `c6f823d2` is the deployment commit.
2. **Re-run the conformance audit against PROD post-publish.** Should remain at 1 `phase_mismatch` violation (the `expired_sweep_cron` row from invoice id=302) and 0 `is_open` mismatches.

---

## What's left in Wave D

| PR | Estimate | Notes |
|---|---|---|
| **D-PR4 — `day-complete.ts` SQL builder rewrite + `expired_sweep_cron` rewire** | one slice | §3.C. Replace the inline `status::text IN (...)` lists in the `isDayConcluded` CTE with `phase` + `outcome` predicates sourced from the canonical columns; rewire `expired-sweep.ts` to stamp `disposition` alongside `status` so the last unrewired writer drops out of the PROD `phase_mismatch` baseline. |
| **D-PR5 — §3.E aggregates** | half a slice | Per §6.2: ship immediately, no parity window. PROD audit is the parity proof. Can flip alongside D-PR4 if convenient. The Portal-Queued-exclusion family in `expiring-filter.ts` / `urgent-snapshot.ts` / `dashboard.ts:493` is part of this PR — once D-PR4 lands the writer side, the read-side residual `status != 'Portal Queued'` check becomes a clean `phase = ready_to_submit AND submitted_via IS NULL` (or equivalent) and the predicate collapses. |
| **D-PR6 — drop the `unclassified` fallback** | half a slice | §3.D. Gated on a re-run of the conformance script post-D-PR4 showing no `unclassified` row that should have a canonical value. |

After D-PR6, Wave E (drop the legacy columns) is unblocked.

---

## D-PR4 inventory — `day-complete.ts` + `expired_sweep_cron`

Run `rg -n "§3\.C|expired_sweep_cron|isDayConcluded|status::text IN" artifacts/api-server/src lib` for the up-to-date list. As of this session the work splits into two independent halves; either can land first, but landing them together keeps the PROD audit baseline meaningful at the moment of publish.

### Half 1 — `day-complete.ts` SQL builder rewrite

| File:line | Surface | Replacement |
|---|---|---|
| `artifacts/api-server/src/lib/day-complete.ts:50-52` | Local `IN_FLIGHT_STATUSES` / `CLOSED_STATUSES` / `CONCLUDED_OUTCOMES` arrays. Used both by `isGroupConcluded` (the in-process predicate) and the inline `status::text IN (...)` lists inside the `isDayConcluded` CTE. | Source from `phase` + `outcome` directly. Per the deriver (`lib/invoice-state/src/derive-phase.ts`), `phase IN ('submitted', 'response_received', 'awaiting_reattestation', 'closed')` covers every "concluded from a day-complete POV" group. The §3.C note in `state-wave-d-handoff.md` flags one residual: `Generating Email` is in-flight from this matcher's POV but lives in `ready_to_submit` (same phase as `New`), so the matcher needs `phase != 'triage' AND phase != 'ready_to_submit'` PLUS a `status = 'Generating Email'` re-include. The cleanest shape after D-PR4 is `phase IN ('submitted', 'response_received', 'awaiting_reattestation', 'closed') OR status = 'Generating Email' OR outcome IN ('Non-Issue', 'Withdrawn')`. The `Generating Email` re-include is the residual that disappears in D-PR5 once `submitted_via` lets the deriver promote it to `submitted`. |
| `artifacts/api-server/src/lib/day-complete.ts:123-152` | `isDayConcluded` CTE inline status list (lines 143-148). | Same `phase IN (...) OR ...` predicate as above, expressed via the typed `invoice_groups.phase` column reference instead of a raw `status::text IN (...)` literal. Drop the `-- Wave C reader-switch note (Task #517)` comment block (lines 108-122) and replace with a tighter Wave-D-PR4 note. |
| `artifacts/api-server/src/lib/day-complete.ts:57-59` | `isGroupConcluded` in-process predicate. | `g.phase ?? derivePhase(g)` membership check. Caller signature changes from `{ status: string; outcome: string }` to `{ phase: InvoicePhase; status: string; outcome: string }` — `status` and `outcome` stay because the `Generating Email` and outcome re-includes still need them. |

#### Caller audit for `isGroupConcluded`

`rg -n "isGroupConcluded|snapshotDayConcludedForGroup|isDayConcluded" artifacts` lists every caller. As of this session: `group-transitions.ts` (4 sites, all wrapping `transitionGroup*`); `routes/admin.ts:317` (manual day-complete trigger). The transitions paths already have `phase` in scope (the transition itself updates `phase`); the admin path reads the row first and can include `phase` in its select. No DTO churn.

### Half 2 — `expired_sweep_cron` writer rewire

| File:line | Surface | Replacement |
|---|---|---|
| `artifacts/api-server/src/lib/expired-sweep.ts:114-161` | The sweep loop calls `transitionGroupStatus({ newStatus: "Expired", systemOverride: true, ... })` for each eligible group. `transitionGroupStatus` cascades `Expired` to every disputed leg via `syncChildRides`, but `syncChildRides` writes legacy `claims.status` only — it does NOT stamp `claims.disposition`. This is the "unrewired writer" that produces invoice id=302 in the PROD audit (`status=Expired stored=triage derived=closed`). | Add a per-leg `setClaimDisposition(claimId, "disposed_expired", { isTerminal: true, mirror: "skip" })` call inside `syncChildRides` (or a dedicated `expireChildRides` variant) so the cascaded `Expired` carries a disposition stamp. Reuse the bulk-loop tx executor pattern from D-PR2b's bulk SOP-advance rewire (one trigger fire per leg, audit + state-event + disposition all on the loop's outer transaction). The `disposed_expired` enum value must be added to `lib/db/enums/leg-state.ts` and `lib/leg-state/src/derive-disposition.ts` if it does not already exist — verify with `rg -n "disposed_expired" lib`. |
| `artifacts/api-server/src/lib/group-transitions.ts:syncChildRides` | The leg-cascade helper invoked by `transitionGroupStatus` for terminal group statuses. Currently writes `claims.status` only. | Same disposition stamp as above when the new group status is `Expired`, `Resolved`, or `Denied`. The Resolved/Denied cascade paths are already disposition-clean (the cache helper recomputes from the parent on the next refresh) but stamping explicitly during the cascade closes the audit window where a SELECT between the status UPDATE and the next cache refresh would see a `disposed_*` parent with a `classifying`/`unclassified` child. |

#### Verification: invoice id=302 must heal

After D-PR4 lands and publishes, manually trigger a no-op transition on invoice id=302 (or wait for the next nightly sweep tick — the cron is idempotent). The next conformance audit should drop from 1 `phase_mismatch` to 0. If id=302 needs a manual heal first (per the D-PR2c follow-up #4), do it AFTER D-PR4 publishes so the heal is the proof that the sweep no longer drifts.

---

## Sharp edges D-PR4 must preserve

Beyond the §3.A-E sharp edges in the Wave-C continuation series and the four D-PR2b additions, D-PR4 inherits two contracts that D-PR3 sharpened or kept open:

1. **`Generating Email` lives in two macro-phases.** From the day-complete matcher's POV, `Generating Email` is in-flight (the operator clicked "package", the system is composing). From `derivePhase` POV, it lives in `ready_to_submit` (pre-submit, on the filing clock). D-PR4 must NOT collapse these — the matcher's `phase != 'ready_to_submit'` rule cannot stand alone. Pinned by `day-complete-celebration.test.ts` cases that include a `Generating Email` group on the day; if those tests pass with the rewritten predicate, the residual is preserved.
2. **`Expired` cascade preserves the operator's `holdReason`.** Pre-D-PR4, the cascade on a held leg writes `status='Expired'` and leaves `holdReason` intact (so the closure history shows "was on hold when the deadline slipped"). The D-PR2c sharp edge #1 (`legHoldReason → On Hold` projection override) must NOT trip the cascade — `disposition_expired` projects to `Expired`, not `On Hold`, even when `holdReason` is set. Verify with a parity test: `legHoldReason set + parent expired → status=Expired, holdReason preserved`. The cache helper's `MIRRORABLE_LEG_STATUSES` set already excludes `Expired` (D-PR2c sharp edge #5), so the projector returns `null` and the legacy `Expired` write survives — the cascade stamp does the right thing by default.

### Known unrewired writer: `expired_sweep_cron` (resolved by this PR)

Resolved when D-PR4 lands. The 2026-05-07 PROD audit row (invoice id=302) is the canary; once the cron stamps disposition the next audit cycle should report 0 violations.

## Sharp edges (still authoritative — see continuation #2 §3.A-E + Wave D §3)

The Wave-C continuation #2 §3.A-E catalogue and Wave D §3.A-E are unchanged by this session. D-PR4 closes §3.C entirely; the §3.B Portal-Queued-exclusion residual and the §3.D `unclassified` fallback remain for D-PR5 / D-PR6.

---

## Pre-existing test noise to disentangle

D-PR4 verification will encounter the same five unrelated failure clusters documented in the D-PR2c / D-PR3 handoff docs — all confirmed pre-existing, none regressions of the Wave D PRs to date:

| Test | Failure | Cause |
|---|---|---|
| `artifacts/api-server/src/__tests__/duplicate-of-endpoints.test.ts` | line 291 | Pre-existing dev DB drift; fails identically under D-PR1 code. |
| `artifacts/api-server/src/__tests__/list-count-past-deadline-parity.test.ts` | line 254 | Pre-existing dev DB drift; fails identically under D-PR1 code. |
| `artifacts/api-server/src/__tests__/closure-data-foundation.test.ts` | 10 cases (closure_evidence + outcome PATCH) | `imageUrl must be an application storage path beginning with /objects/` — object-storage validation in evidence routes. Unrelated to disposition. |
| `artifacts/api-server/src/__tests__/dates-guardrail.test.ts` | 8 cases (Friday/Saturday/Sunday math) | Calendar/weekend deadline math; date-dependent on the test runner's wall clock. |
| `artifacts/api-server/src/__tests__/dashboard-expiring.test.ts` | 13 cases (Friday/Saturday/Sunday math + today-deadline group urgency) | Same calendar/weekend math as above. |

Dev DB still has 42 `phase_mismatch` rows (PROD audit was 1 violation as of D-PR2c, expected to drop to 0 once D-PR4 publishes). The D-PR2a cache helpers will heal the dev rows lazily as normal traffic touches them. **Do not block D-PR4 on these** — re-run the conformance audit on PROD after D-PR4 lands; that's the verification that matters. Per Wave D §6.2, no parity window is needed.

---

## Recommended next session

1. **Read first** (in order): `state-wave-d-handoff.md` §3.C (the `day-complete.ts` rewrite scope), then `lib/invoice-state/src/derive-phase.ts` (the canonical `status → phase` mapping that drives the rewritten CTE), then `artifacts/api-server/src/lib/day-complete.ts` (current implementation, lines 50-158 — the local arrays + the CTE), then `artifacts/api-server/src/lib/expired-sweep.ts` and `artifacts/api-server/src/lib/group-transitions.ts:syncChildRides` (the cron writer half).
2. **Verify the disposition enum** has `disposed_expired`. `rg -n "disposed_expired" lib artifacts` — if missing, add to `lib/db/enums/leg-state.ts`, `lib/leg-state/src/derive-disposition.ts`, and the `claims_disposition_phase_chk` trigger in the next migration. The disposition has to be `phase=closed`-compatible since `Expired` groups derive to `closed`.
3. **Half 1 first** — rewrite `isDayConcluded` and `isGroupConcluded`. The CTE rewrite is the cleaner half; lands without any writer changes and verifies independently via `day-complete-celebration.test.ts` (which exercises both predicates).
4. **Half 2 second** — rewire `syncChildRides` (or a new `cascadeChildDispositions` helper) to stamp `disposition` alongside the legacy `status` cascade. Reuse the bulk-loop tx executor pattern from D-PR2b. Add a parity test mirroring `set-claim-disposition-parity.test.ts` for the cascade path.
5. **Validation gauntlet** (per Wave D §5):
   - `pnpm -r --workspace-concurrency=1 typecheck` — clean.
   - `pnpm --filter @workspace/api-server exec node --import tsx --test src/__tests__/day-complete-celebration.test.ts src/__tests__/expired-status-transitions.test.ts src/__tests__/expired-sweep*.test.ts src/__tests__/group-transitions*.test.ts src/__tests__/leg-status-projector.test.ts src/__tests__/per-leg-state.test.ts src/__tests__/set-claim-disposition-parity.test.ts` — must stay green modulo the documented pre-existing failures.
   - `scripts/src/check-invoice-state-derivation.ts` against PROD post-D-PR4-publish — must drop from 1 violation to 0 (the `expired_sweep_cron` row heals once the cron stamps disposition). Re-run the dev audit; the 42 pre-existing `phase_mismatch` rows should hold steady or monotonically decrease.
6. **Stop at D-PR4.** D-PR5 (§3.E aggregates + the §3.B Portal-Queued-exclusion residual collapse) is the next session.

---

## Operator follow-up

Status of the D-PR3 post-merge checklist:

1. **Publish D-PR3 to PROD.** `c6f823d2` is the deployment commit — the §3.B residuals (per-claim and per-group "is open" filters) now read `is_open`.
2. **Run conformance audit against PROD post-publish.** Should remain at 1 `phase_mismatch` (invoice id=302 — same `expired_sweep_cron` row) and 0 `is_open` mismatches. The `is_open` count is the new pin D-PR3 makes meaningful — every prod row's stored generated column now agrees with the TS helper.
3. **Re-run the dev audit periodically** through the D-PR4 window. The 42 `phase_mismatch` rows are the same `Needs Review stored=response_received derived=triage` drift documented in the D-PR2b/2c/3 handoffs; they should heal lazily as the D-PR2a cache helpers touch them. Treat any *increase* as a regression worth investigating.
4. **(Optional) Manually heal invoice id=302** — recommended to leave UNHEALED through D-PR4, since the row is the proof point that D-PR4's cron rewire actually closes the drift. Heal AFTER D-PR4 publishes.

### How to invoke the PROD audit

The `PROD_DATABASE_URL` Replit secret is wired into the workspace; the dev `DATABASE_URL` points at the dev branch. To run against PROD without disturbing dev:

```bash
DATABASE_URL="$PROD_DATABASE_URL" pnpm --filter @workspace/scripts run check:invoice-state-derivation
```

(The script does not write — it's read-only across `invoice_groups` + `claims`. D-PR1 added a third assertion that the stored `is_open` column equals `isClaimOpen()` / `isInvoiceGroupOpen()` on every row; D-PR4 should keep that count at 0.)

---

## Validation invocation reference

The default `pnpm test` concurrency wedges the shell on this monorepo. The reliable invocations from D-PR2a / D-PR2b / D-PR2c / D-PR3:

```bash
# Typecheck (workspace-wide)
pnpm -r --workspace-concurrency=1 typecheck

# Targeted unit tests for D-PR4 (must run from inside the api-server filter so tsx resolves)
pnpm --filter @workspace/api-server exec node --import tsx --test \
  src/__tests__/day-complete-celebration.test.ts \
  src/__tests__/expired-status-transitions.test.ts \
  src/__tests__/group-transitions*.test.ts \
  src/__tests__/leg-status-projector.test.ts \
  src/__tests__/per-leg-state.test.ts \
  src/__tests__/set-claim-disposition-parity.test.ts

# Conformance audit
pnpm --filter @workspace/scripts run check:invoice-state-derivation
```

If `lib/db/dist` looks stale (a TS error like `Property 'isOpen' does not exist on type 'PgTableWithColumns<...>'` is the tell), rebuild it explicitly before re-running typecheck:

```bash
cd lib/db && pnpm exec tsc -p tsconfig.json
```

Workflow `artifacts/training-guide: web` emits port-collision noise (`EADDRINUSE 0.0.0.0:5924`) on every restart — pre-existing, ignore.

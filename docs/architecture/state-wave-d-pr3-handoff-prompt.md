# Wave D PR3 Handoff

**Status as of this session**: D-PR1 (`is_open` GENERATED column) shipped commit `e883c79d`; D-PR2a (cache helpers write canonical columns alongside legacy mirrors) shipped commit `1ac4867a`; D-PR2b (single-writer rewire of the four SOP/exclude call-site groups) shipped commit `aad41b98`; D-PR2c (cache inversion — `claims.disposition` is now the single source of truth, `claims.status` is a derived projection of it) shipped commit `24e85feb` and published in deployment commit `babc17f1`. The Wave D suggested sequence in `state-wave-d-handoff.md` §3 / §6.3 is now at **D-PR3**: collapse the §3.B residuals onto `claims.is_open` / `invoice_groups.is_open`. Pure column substitution at the six call sites listed in §3.B; no logic changes.

## What shipped this session

### D-PR2c — invert the cache

Replaced the legacy `projectLegStatus(leg, group)` decision table inside `refreshClaimDenormalizedCache` with `dispositionToStatus(disposition, parent, opts?)`. After this PR, `claims.disposition` is the single source of truth on every refresh path and `claims.status` is a derived projection of it. The §6.3 inversion is now complete; the only writer of `claim.status` is the cache helper itself, projecting from disposition.

#### `dispositionToStatus()` shape

`artifacts/api-server/src/lib/leg-state/set-claim-disposition.ts` (~110 new lines, co-located with `dispositionToLegacy` so the §3.D fallback geometry and the §6.3 inversion live in one place). Signature:

```ts
dispositionToStatus(
  disposition: ClaimDisposition,
  parent: {
    phase: InvoicePhase | null;
    status: string;
    reattestRequired: boolean | null;
    reattestCompletedAt: Date | string | null;
  },
  opts?: { legHoldReason?: string | null },
): ClaimStatus | null
```

The signature deviates from the original handoff spec by accepting an `opts.legHoldReason` parameter — see Sharp Edge #1 below for why this was unavoidable. Returns `null` (the pre-existing sentinel) for excluded legs in pre-submit, duplicates, and the defensive unmirrorable-group-status fallback.

Companion `MIRRORABLE_LEG_STATUSES` set moved into the same module (was inline in `denormalized-cache.ts`).

#### Sharp edges preserved

1. **Per-leg `holdReason` override.** The disposition deriver does NOT read `holdReason` (only `sopOutcome === 'hold'` maps to `disposition='blocked'`), so a leg held via the per-leg hold endpoint (`POST /claims/:id/hold` → sets `holdReason`, no `sopOutcome` change) would have its "On Hold" status lost without an explicit override. The cache helper passes `leg.holdReason` through `opts.legHoldReason`; the projector returns `On Hold` whenever it is set, matching pre-D-PR2c Rule 1 line-for-line. Pinned by the `legHoldReason set → On Hold regardless of disposition / parent phase` matrix test.
2. **`disposition='blocked'` projects to `On Hold`.** The canonical encoding for `sopOutcome='hold'` always projects to On Hold, regardless of parent phase. Matches Rule 1b of the legacy projector.
3. **Pre-submit exclusion sentinel preserved.** `disposed_nonissue` and `disposed_withdraw` in pre-submit return `null` so the SOP exclusion path's stamped status (Resolved/Withdrawn) survives — the legacy Rule 2a behavior. Same for `duplicate` (preserves dup-marking status).
4. **In-flight collapse preserved.** Every leg in an in-flight (phase=`submitted`) group surfaces as `Awaiting Response`, regardless of disposition. Matches the legacy projector exactly. Excluded legs typically don't reach this phase — exclusion happens pre-submit — but if one does, the projector mirrors the legacy behavior.
5. **Defensive unmirrorable-status fallback.** When the parent's status falls outside `MIRRORABLE_LEG_STATUSES` (e.g. `Expired`, `Withdrawn`), the projector returns `null` so the leg's existing status is preserved. The legacy projector did the same via `asMirroredStatus(group.status, leg.status)`.

#### Files touched this session

- `artifacts/api-server/src/lib/leg-state/set-claim-disposition.ts` — added `dispositionToStatus` + `MIRRORABLE_LEG_STATUSES` (~110 lines). Imports `getGroupMacroPhase` / `MacroPhase` from `../macro-phase` and `InvoicePhase` from `@workspace/vocab`.
- `artifacts/api-server/src/lib/denormalized-cache.ts` — `refreshClaimDenormalizedCache` now projects status from disposition; the legacy `projectLegStatus` function and its export are deleted; the local `MIRRORABLE_LEG_STATUSES` / `asMirroredStatus` removed (moved into `set-claim-disposition.ts`).
- `artifacts/api-server/src/__tests__/leg-status-projector.test.ts` — rewritten against `dispositionToStatus`. 21 tests (line-for-line counterparts of the pre-D-PR2c suite plus a `legHoldReason` cross-product matrix and a defensive Expired-status fallback case).
- `docs/architecture/state-wave-d-pr3-handoff-prompt.md` — this doc.

### Validation

- `pnpm -r --workspace-concurrency=1 typecheck` — clean.
- §5 validation gauntlet (`leg-status-projector` + `per-leg-state` + `group-sop-advance` + `set-claim-disposition-parity` + `include-terminal-readback-cycle`): **101/101 green**.
- Targeted runs on additional disposition-touching files (`disputed-legs-resolved`, `group-packaging-readiness`, `submit-flow-gates`): **38/38 green**.
- Pre-existing failure clusters from the D-PR2b/2c handoff doc (`duplicate-of-endpoints.test.ts:291`, `list-count-past-deadline-parity.test.ts:254`, `closure-data-foundation.test.ts` object-storage URL validation, `dates-guardrail.test.ts` / `dashboard-expiring.test.ts` calendar/weekend math) reproduce identically and are NOT regressions of this session.
- Dev DB conformance audit (`scripts/src/check-invoice-state-derivation.ts`): **42 `phase_mismatch` rows**, identical to the D-PR2b/2c baseline (`Needs Review stored=response_received derived=triage` overload). Steady state, not a regression.
- **PROD conformance audit (run post-publish 2026-05-07 against deployment `babc17f1`)**: 3,715 rows scanned (1,310 groups + 2,405 claims), **1 `phase_mismatch` violation** — invoice id=302, identical to the 2026-05-07 D-PR2b baseline (the unrewired `expired_sweep_cron` row). NOT a D-PR2c regression. The cache inversion introduced zero new drift in PROD.

---

## What's left in Wave D

| PR | Estimate | Notes |
|---|---|---|
| **D-PR3 — §3.B residuals onto `is_open`** | half a slice | Pure column substitution at the 6 callsites in `state-wave-d-handoff.md` §3.B. Pre-D-PR1 this was blocked on the absence of a per-claim "is the parent in a closed/non-actionable phase" predicate; D-PR1's stored GENERATED column resolved that. |
| **D-PR4 — `day-complete.ts` SQL builder rewrite** | half a slice | §3.C. Source the matcher's sets from `disposition` / `phase` directly. Now safe — disposition is canonical post-D-PR2c. |
| **D-PR5 — §3.E aggregates** | half a slice | Per §6.2: ship immediately, no parity window. PROD audit is the parity proof. Can flip alongside D-PR4 if convenient. |
| **D-PR6 — drop the `unclassified` fallback** | half a slice | §3.D. Gated on a re-run of the conformance script post-D-PR2b/2c showing no `unclassified` row that should have a canonical value. |

After D-PR6, Wave E (drop the legacy columns) is unblocked.

---

## D-PR3 inventory — `OPEN_STATUSES` / `GROUP_SUBMITTED_STUCK_STATUSES` callsites

Run `rg -n "§3\.B|OPEN_STATUSES|GROUP_SUBMITTED_STUCK_STATUSES" artifacts/api-server/src lib` for the up-to-date list. As of this session the residuals split into three families: per-claim open-filter, per-group open-filter, and the `Portal Queued` exclusion. All six are pure read-side WHERE-clause builders — no logic moves, no fixture churn, just swap `OR(...status = X)` for `eq(table.isOpen, true)` (or `ne(table.isOpen, true)` for the inverted "stuck submitted" predicate, when the call is excluding a closed-or-Portal-Queued status).

### Per-claim filters (claims.is_open)

| File:line | Surface | Replacement |
|---|---|---|
| `artifacts/api-server/src/lib/brief-personalization.ts:121-132` | Daily-brief "recently touched open" section. Builds `or(...OPEN_STATUSES.map(s => eq(claimsTable.status, s)))`. | `eq(claimsTable.isOpen, true)`. The local `OPEN_STATUSES` const at line 16 should be deleted; if any remaining callsite needs the array, import `OPEN_STATUSES` from `@workspace/leg-state`. |
| `artifacts/api-server/src/routes/daily-brief.ts:347-364` | Claim-level open-status filter. Same pattern, imports `OPEN_STATUSES` from `brief-personalization`. | `eq(claimsTable.isOpen, true)`. Drop the import. |

### Per-group filters (invoice_groups.is_open)

| File:line | Surface | Replacement |
|---|---|---|
| `artifacts/api-server/src/routes/dashboard.ts:23,410-424` | Dashboard "open invoices" rollup. Local `OPEN_STATUSES` (group-flavored, includes `Portal Queued`). Builds `or(...OPEN_STATUSES.map(s => eq(invoiceGroupsTable.status, s)))`. | `eq(invoiceGroupsTable.isOpen, true)`. Delete the local `OPEN_STATUSES` array at line 23. **Cross-check**: the dashboard's `OPEN_STATUSES` includes `Processed` (a leg-only status that no group ever carries — confirm against the migration's `IN (…)` list before deleting and update `lib/leg-state/src/openness.ts` if the canonical set needs to widen). The D-PR1 commit shipped a single `OPEN_STATUSES` for both tables; if the dashboard's group-flavored set was deliberately broader than the leg-flavored set, the canonical helper needs a `GROUP_OPEN_STATUSES` companion before this swap. |
| `artifacts/api-server/src/lib/group-packaging.ts:~286` | `PACKAGEABLE_GROUP_STATUSES` gate. The §3.B note in `state-wave-d-handoff.md` calls out that `phase=triage` over-includes Needs Review/On Hold/Resolved, which is why this stayed on legacy `status`. | Re-read the gate first — the predicate may be more nuanced than "is open". If the gate is "open AND not packaged", `eq(invoiceGroupsTable.isOpen, true)` plus the existing packaged-state guard works. If it's a tighter "in pre-submit AND ready", the disposition-aware predicate (`phase IN (triage, ready_to_submit)`) is the cleaner replacement. |

### `Portal Queued` exclusion / `GROUP_SUBMITTED_STUCK_STATUSES`

| File:line | Surface | Replacement |
|---|---|---|
| `artifacts/api-server/src/lib/expiring-filter.ts:88-100,~120` | Two-part predicate: exclude `Portal Queued`, then OR back in `GROUP_SUBMITTED_STUCK_STATUSES` (= `["Portal Queued"]`) for the "stuck in submission" lane. | `Portal Queued` is in `OPEN_STATUSES`, so `eq(invoiceGroupsTable.isOpen, true)` keeps the row. The exclusion + re-OR pattern collapses into a single `is_open = true` filter once the readers stop conflating "stuck submitted" with "everything else open". Confirm with the test fixtures that the merged predicate produces identical row sets — the §3.B comment block warns this was the trickier residual. |
| `artifacts/api-server/src/lib/urgent-snapshot.ts:~54-67` | `Portal Queued` exclusion preserves the "actionable but not stuck-in-portal" lane. | Same pattern as `expiring-filter.ts`. Verify against the urgent-snapshot test that `is_open` doesn't widen the result set. |
| `artifacts/api-server/src/routes/dashboard.ts:~493` | `GROUP_SUBMITTED_STUCK_STATUSES` filter. Currently `or(...GROUP_SUBMITTED_STUCK_STATUSES.map(s => eq(invoiceGroupsTable.status, s)))` which is a one-element OR over `Portal Queued`. | Either keep the literal `eq(invoiceGroupsTable.status, "Portal Queued")` (the constant is exported for `expiring-filter.ts` to consume; deleting it requires migrating that callsite first) or lift `GROUP_SUBMITTED_STUCK_STATUSES` into `lib/leg-state/src/openness.ts` alongside `OPEN_STATUSES`. The latter keeps the lockstep documented in migration 0036's header. |

### Type pins / DTO references — leave as-is

`response-tracker.ts:110-111` (the `typeof claimsTable.status.enumValues[number]` type assertion) is not a predicate; D-PR3 must NOT touch it. Same for the `Set` membership lookups called out in `state-wave-d-handoff.md` §3.B "out of scope per continuation #2 §T005.5".

---

## Sharp edges D-PR3 must preserve

Beyond the §3.A-E sharp edges in the Wave-C continuation series and the four D-PR2b additions, D-PR3 inherits two contracts that D-PR2c sharpened or kept open:

1. **`OPEN_STATUSES` is a three-place lockstep.** The migration 0036 `IN (…)` list, `lib/leg-state/src/openness.ts` `OPEN_STATUSES`, and the legacy callsite-local arrays in `brief-personalization.ts` / `dashboard.ts` all must agree. D-PR1's docstrings on each of the three places call this out. D-PR3 deletes the two callsite-local arrays — leaving migration 0036 + `openness.ts` as the only sources of truth. Any future addition to `OPEN_STATUSES` (e.g. a new "in-flight" status for an upcoming feature) needs both the migration update AND the helper update; the conformance script's third assertion (added in D-PR1) is the CI guard against drift.
2. **Group `OPEN_STATUSES` may be a superset of leg `OPEN_STATUSES`.** The dashboard's local `OPEN_STATUSES` was group-flavored and includes statuses (`Portal Queued`, `Generating Email`, etc.) that no claim ever carries. D-PR1 unified them into a single helper assuming the sets are identical for purposes of "is the row in an actionable state". Re-verify before the swap — if the assumption breaks (e.g. `Processed` is included in one but not the other), `lib/leg-state/src/openness.ts` needs a `CLAIM_OPEN_STATUSES` / `GROUP_OPEN_STATUSES` split and the schema's `generatedAlwaysAs(...)` expression on each table needs to reflect the table-specific list. Cheap to verify with `rg -n "OPEN_STATUSES" artifacts lib` and a diff against the migration's `IN (…)` list on each table.

### Known unrewired writer: `expired_sweep_cron`

Unchanged from the D-PR2c handoff. The 2026-05-07 PROD audit row (invoice id=302) is the same drift; D-PR3 does NOT need to fix the cron — the §3.B residuals are read-side only. The cron rewires in D-PR4 alongside the `day-complete.ts` SQL builder rewrite (see `state-wave-d-pr2c-handoff-prompt.md` "Known unrewired writer" callout).

## Sharp edges (still authoritative — see continuation #2 §3.A-E + Wave D §3)

The Wave-C continuation #2 §3.A-E catalogue and Wave D §3.A-E are unchanged by this session. D-PR3 does NOT close any of them — it only consumes the `is_open` GENERATED column D-PR1 added.

---

## Pre-existing test noise to disentangle

D-PR3 verification will encounter the same five unrelated failure clusters documented in the D-PR2c handoff doc — all confirmed pre-existing, none regressions of D-PR1 / D-PR2a / D-PR2b / D-PR2c:

| Test | Failure | Cause |
|---|---|---|
| `artifacts/api-server/src/__tests__/duplicate-of-endpoints.test.ts` | line 291 | Pre-existing dev DB drift; fails identically under D-PR1 code. |
| `artifacts/api-server/src/__tests__/list-count-past-deadline-parity.test.ts` | line 254 | Pre-existing dev DB drift; fails identically under D-PR1 code. |
| `artifacts/api-server/src/__tests__/closure-data-foundation.test.ts` | 10 cases (closure_evidence + outcome PATCH) | `imageUrl must be an application storage path beginning with /objects/` — object-storage validation in evidence routes. Unrelated to disposition. |
| `artifacts/api-server/src/__tests__/dates-guardrail.test.ts` | 8 cases (Friday/Saturday/Sunday math) | Calendar/weekend deadline math; date-dependent on the test runner's wall clock. |
| `artifacts/api-server/src/__tests__/dashboard-expiring.test.ts` | 7 cases (today-deadline group urgency) | Same calendar/weekend math as above. |

Dev DB still has 42 `phase_mismatch` rows (PROD audit was 1 violation as of D-PR2c, unchanged from D-PR2b — the `expired_sweep_cron` row). The D-PR2a cache helpers will heal these lazily as normal traffic touches them. **Do not block D-PR3 on these** — re-run the conformance audit on PROD after D-PR3 lands; that's the verification that matters. Per Wave D §6.2, no parity window is needed.

---

## Recommended next session

1. **Read first** (in order): `state-wave-d-handoff.md` §3.B (the residuals catalogue + the `is_open` rationale), then `lib/db/migrations/0036_invoice_groups_and_claims_is_open.sql` (the GENERATED column + partial index definitions, plus the three-place lockstep callout), then `lib/leg-state/src/openness.ts` (the `OPEN_STATUSES` constant and `isClaimOpen` / `isInvoiceGroupOpen` helpers), then the six callsites listed in the inventory table above.
2. **Verify the lockstep first.** Diff the three `OPEN_STATUSES` definitions before touching any callsite:
   - Migration 0036's `IN (…)` list on `claims` and `invoice_groups` (may differ between tables).
   - `lib/leg-state/src/openness.ts` `OPEN_STATUSES` constant.
   - The legacy arrays at `artifacts/api-server/src/lib/brief-personalization.ts:16` and `artifacts/api-server/src/routes/dashboard.ts:23`.
   - If the sets diverge meaningfully (more than just `Portal Queued` ordering), split `openness.ts` into `CLAIM_OPEN_STATUSES` / `GROUP_OPEN_STATUSES` *before* the swap. The schema `generatedAlwaysAs(...)` expression on each table needs to reflect the table-specific list.
3. **Swap the per-claim filters first** (`brief-personalization.ts:132`, `daily-brief.ts:347`). These are the cleanest — single OR over `OPEN_STATUSES` becomes a single `eq(claimsTable.isOpen, true)`. Delete the local `OPEN_STATUSES` array at `brief-personalization.ts:16` once both callsites are migrated and no other importer references it. `rg -n "from .*brief-personalization.*OPEN_STATUSES|brief-personalization.*OPEN_STATUSES" artifacts` confirms the import graph.
4. **Swap the per-group filters next** (`dashboard.ts:410-424`, `group-packaging.ts:~286`). The dashboard's local `OPEN_STATUSES` deletion is the watershed — after this, no part of the read path defines its own open-status list. Re-read `group-packaging.ts:286` carefully before the swap; the §3.B note flagged this as the residual where the predicate is more nuanced than "is open".
5. **Handle the `Portal Queued` exclusion family last** (`expiring-filter.ts:88-126`, `urgent-snapshot.ts:~54-67`, `dashboard.ts:~493`). These are the trickiest because the predicate is "is open AND not stuck in portal" — the swap collapses the two-part exclude/re-OR pattern into a single `is_open` filter. Verify with the test fixtures that the merged predicate produces identical row sets; the `expiring-filter.ts` §3.B comment block warns this was the residual most likely to surface a behavioral diff.
6. **Lift `GROUP_SUBMITTED_STUCK_STATUSES`** into `lib/leg-state/src/openness.ts` if it survives the consolidation (it's a one-element array of `Portal Queued`, used by `expiring-filter.ts` and `dashboard.ts`). Keeps the lockstep constraint documented in one file.
7. **Validation gauntlet** (per Wave D §5):
   - `pnpm -r --workspace-concurrency=1 typecheck` — clean.
   - `pnpm --filter @workspace/api-server exec node --import tsx --test src/__tests__/dashboard-expiring.test.ts src/__tests__/expiring-filter*.test.ts src/__tests__/urgent-snapshot*.test.ts src/__tests__/brief-personalization*.test.ts src/__tests__/daily-brief*.test.ts src/__tests__/group-packaging-readiness.test.ts` — must stay green modulo the documented pre-existing failures (calendar/weekend math in `dashboard-expiring.test.ts`, etc.).
   - `scripts/src/check-invoice-state-derivation.ts` against PROD post-D-PR3-publish — must remain at 1 violation (the `expired_sweep_cron` row) and 0 `is_open` mismatches. Re-run the dev audit; the 42 pre-existing `phase_mismatch` rows should hold steady or monotonically decrease.
8. **Stop at D-PR3.** D-PR4 (`day-complete.ts` SQL builder rewrite + `expired_sweep_cron` rewire) is the next session.

---

## Operator follow-up

Status of the D-PR2c post-merge checklist:

1. ~~**Publish D-PR2c to PROD.**~~ ✅ **Done 2026-05-07.** Commit `24e85feb` live in deployment commit `babc17f1`.
2. ~~**Run conformance audit against PROD post-publish.**~~ ✅ **Done 2026-05-07** (see Validation §above). 3,715 rows, 1 `phase_mismatch` (invoice id=302 — same `expired_sweep_cron` row). Cache inversion introduced zero new drift.
3. **Re-run the dev audit periodically** through the D-PR3 window. The 42 `phase_mismatch` rows are the same `Needs Review stored=response_received derived=triage` drift documented in the D-PR2b/2c handoffs; they should heal lazily as the D-PR2a cache helpers touch them. Treat any *increase* as a regression worth investigating.
4. **(Optional) Manually heal invoice id=302** to give D-PR3 a clean PROD baseline. One UPDATE: `UPDATE invoice_groups SET phase='closed', closure_reason='expired' WHERE id=302;`. Or just leave it — recommended, since the drift is documentation evidence that the cron is unrewired and will be useful at D-PR4 scoping time.

### How to invoke the PROD audit

The `PROD_DATABASE_URL` Replit secret is wired into the workspace; the dev `DATABASE_URL` points at the dev branch. To run against PROD without disturbing dev:

```bash
DATABASE_URL="$PROD_DATABASE_URL" pnpm --filter @workspace/scripts run check:invoice-state-derivation
```

(The script does not write — it's read-only across `invoice_groups` + `claims`. D-PR1 added a third assertion that the stored `is_open` column equals `isClaimOpen()` / `isInvoiceGroupOpen()` on every row; D-PR3 should keep that count at 0.)

---

## Validation invocation reference

The default `pnpm test` concurrency wedges the shell on this monorepo. The reliable invocations from D-PR2a / D-PR2b / D-PR2c:

```bash
# Typecheck (workspace-wide)
pnpm -r --workspace-concurrency=1 typecheck

# Targeted unit tests for D-PR3 (must run from inside the api-server filter so tsx resolves)
pnpm --filter @workspace/api-server exec node --import tsx --test \
  src/__tests__/dashboard-expiring.test.ts \
  src/__tests__/group-packaging-readiness.test.ts \
  src/__tests__/leg-status-projector.test.ts \
  src/__tests__/per-leg-state.test.ts \
  src/__tests__/set-claim-disposition-parity.test.ts

# Conformance audit
pnpm --filter @workspace/scripts run check:invoice-state-derivation
```

Workflow `artifacts/training-guide: web` emits port-collision noise (`EADDRINUSE 0.0.0.0:5924`) on every restart — pre-existing, ignore.

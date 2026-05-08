# State Readers / Writers Audit — 2026-05-08

Scope: every code site in the live backend and frontend that reads or writes
`status`, `phase`, `disposition`, or `outcome` on `claims` or `invoice_groups`.
Goal: identify "wrong side of the bridge" reads/writes that have caused the
`(status, outcome) ↔ (phase, disposition)` drift incidents we kept finding,
and finish the legacy → canonical migration.

Method: four parallel deep-dive passes, then per-finding verification by
reading the actual source. Findings classified `CORRECT` / `SUSPECT` / `WRONG`.

---

## 1. Writers — `claims` table

| File:Line | Action | Cols Written | Goes Through Helper / Refreshes? | Verdict |
| --- | --- | --- | --- | --- |
| `lib/claim-transitions.ts:167` | `transitionClaimStatus` (canonical) | `status` | Yes — own refresh | CORRECT |
| `lib/claim-transitions.ts:307` | `transitionClaimOutcome` (canonical) | `outcome`, `closureReason`, … | Yes — own refresh | CORRECT |
| `lib/claim-transitions.ts:462` | `transitionClaimStatusAndOutcome` (canonical) | `status`, `outcome`, `closureReason` | Yes — own refresh | CORRECT |
| `lib/leg-state/set-claim-disposition.ts` | `setClaimDisposition` (canonical) | `disposition` (+ projected `status`) | Yes — own refresh | CORRECT |
| `lib/denormalized-cache.ts` | `refreshClaimDenormalizedCache` / `refreshGroupDerivedFields` | `disposition` (re-derived) | self | CORRECT |
| `lib/group-transitions.ts:271-273` (`syncChildRides`) | child status cascade | `status`, `outcome`, … + per-child `refreshClaimDenormalizedCache` | yes (fixed earlier today) | CORRECT |
| `lib/mas-derivations.ts:74` (`applyMasDerivationsForLeg`) | `masActionRequired` write | callers refresh | CORRECT |
| `lib/attestation.ts:135` (`engageMasEligibleAttestationCascade`) | bulk `attestationState='pending'` on disputed children of one group | **NO refresh after** | **WRONG** — disposition stale (see Fix #1) |
| `routes/import.ts:247` | INSERT (with-invoice path) | full row incl. `disposition` via `importedClaimDisposition` | yes (fixed earlier today) | CORRECT |
| `routes/import.ts:314` | INSERT (no-invoice path) | full row incl. `disposition` | yes (fixed earlier today) | CORRECT |
| `routes/import.ts:239` | UPDATE (re-import overwrite, with-invoice) | `invoiceGroupId`, `date`, `refNumber`, `clientNumber`, `carNumber`, `errorDetails`, `claimAmount` | none | CORRECT — none of the columns touched are disposition drivers |
| `routes/import.ts:301` | UPDATE (re-import overwrite, no-invoice) | same set minus `invoiceGroupId` | none | CORRECT — same reason |
| `routes/claims.ts:650` (`PATCH /claims/:id`) | row edit | `confNumber`, `date`, `errorTypeId`, `errorTypeName`, … | first-time `errorTypeId` triggers `transitionClaimStatus → Needs Evidence` (refreshes) | CORRECT — `errorTypeId` is not a deriver input on its own |
| `routes/claims.ts:993` (`applyAttestationAction`) | attest queue / self-confirm | `attestationState`, `attestedAt`, `attestedBy`, `attestationNote` | **NO refresh** | **WRONG** — `attestationState` IS a disposition driver (see Fix #2) |
| `routes/claims.ts:1068` (PATCH evidence) | evidence fields | `evidenceFiles`, `evidenceNotes`, `evidenceChecklist` | not a driver | CORRECT |
| `routes/claims.ts:1108` / `1161` (POST/DELETE hold) | hold fields | `holdReason`, `holdPlacedAt`, `holdPendingFrom` | followed by `refreshClaimDenormalizedCache` | CORRECT |
| `routes/claims.ts:1501` (POST `/claims/bulk-assign-error-type`) | bulk `errorTypeId`, `errorTypeName` | **NO** auto-advance, **NO** refresh | SUSPECT — diverges from single-claim PATCH (no auto-advance to "Needs Evidence"); not a disposition driver, but a UX inconsistency. Tracked as Fix #5. |
| `routes/claims.ts:1591` (PATCH `/closure-review`) | `closureReviewState`, … | not a driver | CORRECT |
| `routes/claims.ts:1747` (POST `/classify`) | `errorTypeId`, `errorTypeName` | followed by refresh | CORRECT |
| `routes/claims.ts:1928` (POST `/sop-advance`) | `sopAnswers`, `sopNodeId` | followed by refresh | CORRECT |
| `routes/claims.ts:2523` (POST `/per-leg-context`) | `perLegContext` | not a driver | CORRECT |
| `routes/claims.ts:2791` (POST `/include`) | `includedInDispute` | followed by refresh | CORRECT |
| `routes/claims.ts:2920` / `2988` (duplicate-of) | `duplicateOfClaimId` | followed by refresh | CORRECT |
| `routes/claims.ts:3096` (POST `/reclassify`) | `errorTypeId`, `sopOutcome`, `holdReason`, … | followed by refresh | CORRECT |
| `routes/claims.ts:3328` (POST `/verdict`) | `attestationState` delta | followed by `refreshGroupDerivedFields` (which re-derives every child disposition incl. this leg) | CORRECT |
| `routes/claims.ts:3452` (POST `/mas-action/complete`) | `masActionCompletedAt`, … | followed by refresh | CORRECT |
| `routes/ai-email.ts:282` | generated email columns | not drivers | CORRECT |
| `routes/withdrawals.ts:486` | `closureReviewState`, … | not drivers | CORRECT |
| `routes/invoice-groups.ts:3084` (bulk verdict promote) | per-leg `attestationState` delta | followed by `refreshGroupDerivedFields(id)` | CORRECT |
| `routes/invoice-groups.ts:3424` (bulk SOP advance) | `sopAnswers`, `sopNodeId` | per-row refresh | CORRECT |
| `routes/invoice-groups.ts:3719` (POST `/reattest/complete`) | `attestationState`, `attestedAt`, `attestedBy` | followed by `refreshGroupDerivedFields(id)` | CORRECT |
| `routes/invoice-groups.ts:3939` (POST `/reattest/queue`) | `attestationState`, `attestationQueuedAt`, … | followed by `refreshGroupDerivedFields(id)` | CORRECT |
| `routes/response-tracker.ts:181` (PATCH `/responses/:id/process`) | `outcome = 'Pending'` reset after `transitionClaimStatus` | **NO refresh** | **WRONG** — `outcome` IS a disposition driver (see Fix #3b) |

## 2. Writers — `invoice_groups` table

| File:Line | Action | Cols Written | Verdict |
| --- | --- | --- | --- |
| `lib/group-transitions.ts:452/646/834` | `transitionGroupStatus` / `transitionGroupOutcome` / `transitionGroupStatusAndOutcome` (canonical) | `status`, `outcome`, `phase`, `closureReason`, `phaseEnteredAt`, `holdReason`, … | CORRECT — canonical writer; `applyClosureApprovedFields` co-writes `phase='closed' + closureReason='approved'` |
| `lib/group-transitions.ts:483 / 914` | `engageMasEligibleAttestationCascade(groupId)` side-effect inside the canonical writer | flips children `attestationState`; group `reattestRequired` → true | **WRONG (caller side)** — does not call `refreshGroupDerivedFields` after the cascade, so disposition for the affected children is stale (see Fix #1) |
| `lib/denormalized-cache.ts` | `refreshGroupDerivedFields` | `phase`, `reattestRequired`, child `disposition` re-derive | CORRECT |
| `lib/group-service-date.ts` | `recomputeGroupServiceDate` | `earliestServiceDate` only | CORRECT |
| `routes/import.ts:199` | INSERT (group create) | `status='New'`, `outcome='Pending'`, metadata | CORRECT — fresh-create defaults |
| `routes/import.ts:214` | UPDATE (group stats refresh) | `rideCount`, `totalAmount`, `errorDetails`, `errorTypeId` | CORRECT — metadata only |
| `routes/invoice-groups.ts:755` | POST create group | initial `status='Needs Review'`, `outcome='Pending'`, metadata | CORRECT |
| `routes/invoice-groups.ts:802 / 1368 / 1764 / 1927 / 1992 / 2133 / 3988` | various metadata edits, payor-denial, awaiting-payor-again, closure-review, reattest queue | none touch `status`/`outcome`/`phase` | CORRECT |
| `routes/admin.ts:89 / 106` | backfill orphan groups | INSERT + metadata UPDATE | CORRECT |
| `routes/withdrawals.ts:505` | `/bulk-address` closure-review fields | not drivers | CORRECT |
| `routes/response-tracker.ts:152` (PATCH `/responses/:id/process`) | `outcome = 'Pending'` reset on the group after `transitionGroupStatus` | **NO refresh** | **WRONG** — `outcome` is a `derivePhaseFromLegacy` input (see Fix #3a) |
| `routes/invoice-groups.ts:3084` (bulk verdict promote) | per-child `attestationState` delta | followed by `refreshGroupDerivedFields(id)` | CORRECT |

---

## 3. Readers — backend

### Confirmed bugs

| File:Line | What it reads | Should read | Why it matters |
| --- | --- | --- | --- |
| `routes/invoice-groups.ts:386` (`buildMacroPhaseCondition`) | `invoiceGroupsTable.status IN (legacy list)` per macro phase | `invoiceGroupsTable.phase IN (canonical list)` | If a row's `status` and `phase` ever drift, this list filter hides it from the macro-phase tab even though every detail page would show it under the canonical bucket. **See macro-phase boundary discrepancy in §6 — fix needs your sign-off because legacy and canonical disagree on which statuses belong to "pre-submit" vs "in-flight".** |

### Intentional legacy reads (correct, with documented exit plan)

| File:Line | What it reads | Why it stays on legacy |
| --- | --- | --- |
| `routes/dashboard.ts:185` | `status` per-bucket counts for the Portal Pipeline tile | UI labels are status names; switching would change the breakdown the operator sees |
| `routes/dashboard.ts:350` (`deadlineMissedExpr`) | `status='Expired' OR status='On Hold'` for the deadline-missed predicate | Phase-side equivalent (`phase='closed' + closure_reason='expired'`) is OK to add but the dollar math is unchanged. Low-risk to migrate later. |
| `routes/daily-brief.ts:367` | `CLAIM_EXPIRING_ACTIONABLE_STATUSES` per-claim filter | Comment in source: claims have no `phase` column; `disposition` alone doesn't encode parent-phase membership; Wave D will add `submitted_via` so this becomes a single-column read. |
| `routes/invoice-groups.ts:156` / `routes/claims.ts:127` | URL `?status=…` chip filters | Operator clicks a status name in the UI → query the legacy column directly, lossless. |
| `routes/response-tracker.ts:142` | `transitionGroupStatus({ newStatus: TAGGED_TARGET_STATUS })` | Writer side; canonical helper rewrites both columns. |
| `lib/macro-phase.ts` | `getMacroPhase(status)` legacy fallback inside `getGroupMacroPhase` | Documented Wave D removal; only fires when caller passes a partial row with no `phase` column. |
| `lib/denormalized-cache.ts` | calls `getMacroPhase(status)` from write paths that only have a status string | Wave C/D — write-side passthrough; will be removed when every writer rewires. |

### Confirmed correct canonical reads

`routes/dashboard.ts:442`, `routes/claims.ts:395` (`isGroupOperatorDone`), `lib/operator-attention.ts`, `lib/expiring-filter.ts`, `lib/urgent-snapshot.ts` — all read the canonical `phase` column and pass full group rows into `getGroupMacroPhase`.

---

## 4. Readers — frontend

### Bugs / drift risks

| File:Line | What it reads | Should read | Notes |
| --- | --- | --- | --- |
| `pages/system-health.tsx:163` | hard-coded legacy status names in description text ("New, Needs Evidence, On Hold, Generating Email") | "Pre-submit phase" canonical wording | Cosmetic; description drifts as state machine evolves. |
| `components/inline-group-workspace-v3.tsx:442, 593` | `detail.status === "On Hold"` for hero/section gating | `getGroupLifecyclePhaseFromGroup(group) === "on-hold"` | Hold gating on legacy `status` is fragile if hold is ever encoded as a flag instead of a status (see Wave D notes in macro-phase.ts header). |
| `components/claim-detail-v2.tsx:715, 725` | `parentGroup.status` to show "no longer accepted" | `parentGroup.macroPhase` (already on the DTO) | Same fragility as above for edit-gating. |
| `pages/invoice-groups.tsx:545` | `StatusPillForStatus` (legacy-only pill) | a row-aware pill that prefers `disposition` then falls back | Cosmetic tone shift only. |

### Intentional legacy reads

URL filter params (`pages/claims.tsx:162-193`, `pages/invoice-groups.tsx:177-224`) — keep status keys for URL stability; will move with the API endpoint behind them in Wave D.

### Confirmed correct canonical reads

`StatusPillForRow` (claim list rows), `lib/lifecycle-phase.ts:182-193` (canonical bridge utility), `components/cohesion/tone.ts:100-107` (`toneForRow` prefers disposition), `claim-detail-v2.tsx:433` (gates on `macroPhase === "pre-submit"`).

---

## 5. DB safety nets (already in place)

* `0034_invoice_phase_and_disposition.sql` — `invoice_groups.phase` + `claims.disposition` enums + cross-row deferrable trigger that rejects any commit where a child's `disposition` is not in `VALID_DISPOSITIONS_BY_PHASE[parent.phase]`. Trigger CASE is mirrored in `lib/vocab/src/claim-disposition.ts:VALID_DISPOSITIONS_BY_PHASE`.
* `0036_invoice_groups_and_claims_is_open.sql` — `is_open boolean GENERATED ALWAYS AS (status IN (…)) STORED` on both tables, mirrored by `OPEN_STATUSES` in `lib/leg-state/src/openness.ts`. Two stragglers still maintain hand-written copies of the list:
  * `lib/brief-personalization.ts:16`
  * `routes/dashboard.ts:23`
  Both are tracked as Wave D-PR3 cleanup; not a drift bug today because the runtime conformance script asserts equality on every prod row.
* `scripts/check-invoice-state-derivation.ts` — runs the TS derivers against every prod row and asserts equality with the SQL-derived columns. Currently 3 violations (intentional Portal Queued mid-flight phase mismatches) — see `.scratchpad`.

---

## 6. Macro-phase canonical/legacy boundary discrepancy (NEEDS DECISION)

`lib/macro-phase.ts` carries two parallel mappings that DO NOT AGREE on where the pre-submit ↔ in-flight boundary sits:

| Status | Legacy `STATUSES_BY_PHASE` | Canonical `phase → PHASE_TO_MACRO` |
| --- | --- | --- |
| `Generating Email` | **in-flight** | `ready_to_submit` → **pre-submit** |
| `Portal Queued`    | **in-flight** | `ready_to_submit` → **pre-submit** |
| `Awaiting Response` | in-flight | `submitted` → in-flight |

The legacy mapping is mirrored in `routes/invoice-groups.ts:378` (`STATUS_BY_PHASE`), which feeds `buildMacroPhaseCondition` (the macro-phase tab list filter). The canonical mapping is the truth used by every reader that calls `getGroupMacroPhase(group)`.

Concretely: a "Portal Queued" group is shown as **in-flight** in the legacy tab filter but is bucketed as **pre-submit** by the canonical reader. Detail pages and dashboard tiles that already read canonical disagree with the list tabs.

**Two valid resolutions, both should ship in one PR:**
1. Adopt the canonical boundary: `Portal Queued` and `Generating Email` move into the pre-submit tab. Aligns with the §6.1 phase deriver. **Recommended** — matches everything downstream.
2. Adopt the legacy boundary: rewrite `PHASE_TO_MACRO` so `ready_to_submit → in-flight`. Keeps the current tab UX. Smaller blast radius but contradicts the phase semantics ("ready_to_submit" was meant to be a pre-submit terminal phase).

**Status:** flagged for sign-off. Not changed in this audit pass to avoid silently moving rows between operator tabs.

---

## 7. Fixes applied in this pass

* **Fix #1 — `lib/group-transitions.ts`**: after each `engageMasEligibleAttestationCascade(...)` call (lines 483 and 914), add `refreshGroupDerivedFields(groupId, ex)` so the bulk `attestationState='pending'` write is followed by a child-disposition re-derivation in the same transaction.
* **Fix #2 — `routes/claims.ts:993`**: `applyAttestationAction` now calls `refreshClaimDenormalizedCache(claimId)` after the `attestationState`/`attestedAt`/`attestedBy` UPDATE, then re-reads the row before returning so the response carries the post-derivation disposition.
* **Fix #3a — `routes/response-tracker.ts:152`**: after the manual `outcome = 'Pending'` reset on the group, call `refreshGroupDerivedFields(response.invoiceGroupId)` to re-derive `phase` (and every child `disposition`) under the new outcome.
* **Fix #3b — `routes/response-tracker.ts:181`**: after the manual `outcome = 'Pending'` reset on the claim, call `refreshClaimDenormalizedCache(response.claimId)` to re-derive `disposition` under the new outcome.

## 8. Items left for follow-up

* **Macro-phase boundary discrepancy** (§6) — needs sign-off, then `buildMacroPhaseCondition` rewrites onto the canonical `phase` column.
* **`bulk-assign-error-type` UX inconsistency** (`routes/claims.ts:1501`) — bulk path missing the auto-advance-to-Needs-Evidence behavior of single-claim PATCH. Not a state-machine drift bug; queue for next batch.
* **Wave D-PR3 reader cleanup** — delete the duplicate `OPEN_STATUSES` literals in `lib/brief-personalization.ts:16` and `routes/dashboard.ts:23`, import from `@workspace/leg-state` instead.
* **Frontend hold-gating cleanup** — `inline-group-workspace-v3.tsx:442, 593` and `claim-detail-v2.tsx:715, 725` still gate on `status === "On Hold"`; switch to `getGroupLifecyclePhaseFromGroup(group) === "on-hold"`.
* **`pages/system-health.tsx:163`** — replace hard-coded legacy status names in description with canonical phase wording.

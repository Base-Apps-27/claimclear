# State Readers / Writers Audit — 2026-05-08 (v2, Round 2)

> **Scope.** Exhaustive inventory of every code path in the ClaimClear codebase that writes, reads, displays, filters, or schedules around the legacy↔canonical state-machine columns (`invoice_groups.status` / `phase` / `outcome`, `claims.status` / `disposition` / `outcome` / `submitted_via` / `attestation_state`). Built on top of the original 2026-05-08 audit (`state-readers-writers-2026-05-08.md`, §1–§9), confirms / supersedes its findings, and adds the surfaces that earlier pass missed (frontend pages, crons, API responses).
>
> **Confidence note.** The first round of explorers produced several false alarms (e.g. the `OPEN_STATUSES` "duplicate", a phantom 🔴 on `reattest/queue`). Every finding in this v2 was hand-verified against the live source before being recorded. Verification status is marked per row.

## TL;DR for tomorrow's 1,000-item processing day

* **Conformance audit is at 0 violations** (4,006 rows checked) after today's writer fix + healing of group #15.
* **Today's root-cause fix (round 2)** ensures `transitionGroupStatus` always re-derives `phase` at the end of every status transition — so legacy `status`/`outcome` and canonical `phase`/`disposition` will stay in lockstep on every write path going forward.
* **Because of that lockstep**, every "drift-vulnerable" reader documented below continues to behave correctly today. Nothing in this audit is a tomorrow blocker. The fixes listed under "After tomorrow" are hardening, not bug fixes.
* **One real 🔴 to fix BEFORE deploying today**: the boot-time `Disputed-child sync` backfill in `index.ts` writes `claim.status` via raw SQL and never refreshes the denormalized cache, leaving `disposition` stale on healed legs. Fix is one line. Documented in §A1 below.

---

## A. Writers — comprehensive inventory

### A.0 Canonical helpers (the only writers that should touch state columns)

| Helper | File | What it guarantees |
|---|---|---|
| `transitionGroupStatus` | `artifacts/api-server/src/lib/group-transitions.ts` | Validates transition, audits, broadcasts, cascades to children, **calls `refreshGroupDerivedFields` unconditionally at end of `statusChanged` block (Round 2 fix, line 537)** |
| `transitionGroupOutcome` | same | Same guarantees, calls `refreshGroupDerivedFields` at end |
| `transitionGroupStatusAndOutcome` | same | Same guarantees, calls `refreshGroupDerivedFields` at end |
| `transitionClaimStatus` / `transitionClaimOutcome` / `transitionClaimStatusAndOutcome` | `artifacts/api-server/src/lib/claim-transitions.ts` | Validates, audits, calls `refreshClaimDenormalizedCache` |
| `setClaimDisposition` | `artifacts/api-server/src/lib/leg-state/set-claim-disposition.ts` | Single canonical writer for `claims.disposition` |
| `refreshGroupDerivedFields` | `artifacts/api-server/src/lib/denormalized-cache.ts` | Re-runs `derivePhaseFromLegacy` and updates `phase` + child dispositions atomically |
| `refreshClaimDenormalizedCache` | same | Re-runs `deriveDispositionFromLegacy` and updates `disposition` |

### A.1 🔴 HIGH-risk writers — fix today

| Writer | File:line | Issue | Fix |
|---|---|---|---|
| **Boot-time disputed-child sync** | `artifacts/api-server/src/index.ts:145` (prod-only IIFE) | Bulk `UPDATE claims SET status=…, outcome=…` via raw SQL with no `refreshClaimDenormalizedCache` call. Healed legs will have correct legacy tuple but stale `disposition` until the next mutation. | Add `await refreshClaimDenormalizedCache(claim_id)` (or `refreshGroupDerivedFields(group_id)`) after each per-row UPDATE. Idempotent and safe. |

### A.2 🟢 LOW-risk writers — verified going through canonical helpers

All of the following endpoints / handlers were verified to either (a) call the canonical helper directly, or (b) write a non-state column and follow with the appropriate refresh helper:

**`routes/invoice-groups.ts`:**
- L1403 `PATCH /:id/status` → `transitionGroupStatus` ✅
- L1431 bulk status → `transitionGroupStatus` ✅
- L1467 `PATCH /:id/outcome` → `transitionGroupOutcome` ✅
- L1546 `POST /:id/triage` → `transitionGroupStatusAndOutcome` ✅
- L1634 `POST /:id/mark-mas-eligible` → `transitionGroupStatus` ✅
- L1675 `POST /:id/hold` → `transitionGroupStatus` ✅
- L1702 `DELETE /:id/hold` → `transitionGroupStatus` ✅
- L3127 `POST /:id/promote-verdict-drafts` → ends with `refreshGroupDerivedFields` ✅
- L3432 `POST /:id/sop-advance` → `setClaimDisposition` ✅
- L3673 `POST /:id/reattest/complete` → `transitionGroupStatusAndOutcome` ✅
- L3798 `POST /:id/reattest/queue` → ends with `refreshGroupDerivedFields(id)` at line 4087 ✅ **(explorer flagged this as 🔴; verified false alarm)**

**`routes/claims.ts`:**
- L783 `PATCH /:id/status` → `transitionClaimStatus` ✅
- L808 `PATCH /:id/outcome` → `transitionClaimOutcome` ✅
- L993 `applyAttestationAction` → ends with `refreshClaimDenormalizedCache` (Round 1 Fix #2) ✅
- L1117 / L1170 hold / unhold → `refreshClaimDenormalizedCache` ✅
- L1255 `clear-sop-hold` → `refreshClaimDenormalizedCache` + `refreshGroupDerivedFields` ✅
- L1291 `triage` → `transitionClaimStatusAndOutcome` ✅
- L1363 `post-response-action` → `transitionClaimStatusAndOutcome` ✅
- L1521 `bulk-assign-error-type` → `transitionClaimStatus` (Round 1 Fix #5) ✅
- L1787 `classify` → `transitionGroupStatus` for parent ✅
- L1931 `sop-advance` → both refresh helpers ✅
- L2456 `conclude-leg` → `setClaimDisposition` ✅
- L2677 / L2793 / L2877 / L2995 exclude/include/duplicate-of → both refresh helpers ✅
- L3125 `reclassify` → `transitionClaimStatus` ✅
- L3225 `verdict` → `setClaimDisposition` ✅
- L3463 `mas-action/complete` → both refresh helpers ✅

**`routes/response-tracker.ts`:** L152 / L181 process → `refreshGroupDerivedFields` (Round 1 Fix #3a/#3b) ✅

**`routes/import.ts`:** L214 / L239 — direct insert/update with `status:"New"` / `status:"Needs Review"` / `outcome:"Pending"`. **Verified safe**: `invoice_groups.phase` has a DB default of `'triage'` (`lib/db/src/schema/invoice-groups.ts:40`), so freshly-imported rows land at the correct canonical phase by the column default; legacy "New"/"Needs Review" both map to phase `triage` per the deriver. No refresh needed on insert. **(explorer flagged 🟡; verified safe by column-default analysis.)**

**`routes/ai-email.ts`:** L282 — only writes `generatedEmailSubject` / `generatedEmailBody` / `generatedEmailAt`. Does **not** touch state columns. **(explorer flagged 🟡; verified false alarm.)**

**One-shot scripts** (`scripts/oneshot-*`, `scripts/heal-*`): direct writes are intentional for healing. All are one-time runs; documenting only.

---

## B. Readers — comprehensive inventory

### B.0 Canonical readers (the patterns the audit-doc endorses)

* Macro-phase boundary: `getGroupMacroPhase` (`lib/macro-phase.ts:96`) reads `invoice_groups.phase` via `PHASE_TO_MACRO`, with a single explicit exception for `On Hold` (read off legacy `status`).
* Lifecycle phase (frontend): `getGroupLifecyclePhaseFromGroup` (`artifacts/claimclear/src/lib/lifecycle-phase.ts`) — short-circuits On Hold then maps phase→lifecycle bucket.
* Open vs closed: `claims.is_open` and `invoice_groups.is_open` generated columns; `OPEN_STATUSES` from `@workspace/leg-state`.
* Disposition: read directly from `claims.disposition` column (no read-time re-derivation).

### B.1 🟡 Drift-vulnerable readers — work after tomorrow

These readers query legacy `status`/`outcome` instead of canonical `phase`/`disposition`. They behave correctly **today** because the writer-side lockstep invariant holds (Round 2 fix), but each one is one missed refresh away from a wrong answer.

| File:line | What it reads | What for | Recommended fix |
|---|---|---|---|
| `lib/response-matcher.ts:121` | `inArray(invoice_groups.status, ["Awaiting Response","On Hold"])` | Inbox response → group matcher | Switch to `or(eq(phase,"awaiting_response"), eq(status,"On Hold"))` |
| `lib/group-packaging.ts:68,205` | `PACKAGEABLE_GROUP_STATUSES = Set(["New","Needs Evidence"])` | Pre-submit packaging gate | Switch to `inArray(phase, ["triage","ready_to_submit"])` |
| `lib/expiring-filter.ts:86` | hand-written legacy status array | "Expiring soon" filter | Import canonical list from `@workspace/leg-state` or switch to phase |
| `lib/day-complete.ts:158` | `status` + `outcome` | Day-complete celebration gate | Acceptable as legacy reads (display-axis), document only |
| `routes/dashboard.ts:232,350` | legacy `status` / `outcome` strings in SQL | Dashboard tile metrics (Total Loss, Open Opportunity, MAS Pending) | Switch to phase-based predicates |
| `routes/claims.ts:412` | `CLAIM_ON_CLOCK_STATUSES.has(claim.status)` | Per-row "Today" urgent flag | Define equivalent phase-based set |
| `routes/claims.ts:538` | `inArray(outcome, ["Approved","Partially Approved"]) OR eq(status,"MAS Eligible")` | Attestation queue filter | **Keep as-is** — comment explicitly documents the OR clause covers the MAS-Eligible cascade where outcome stays Pending. Verified intentional. |

### B.2 🟢 Confirmed canonical reads

* `lib/macro-phase.ts:86,96` — phase + on-hold exception
* `lib/macro-phase.ts:105` — legacy fallback for partial data only
* `lib/operator-attention.ts:68` — phase + outcome for inbox badge
* `lib/urgent-snapshot.ts:75` — phase
* `lib/group-packaging.ts:91,110` — disposition for held / lifecycle category
* `lib/brief-personalization.ts:235` — disposition with intentional `status='Needs Review'` fallback for unclassified rows
* `routes/invoice-groups.ts:421` — `buildMacroPhaseCondition` reads `phase` (Round 1 Fix #4)
* `routes/invoice-groups.ts:417` — `On Hold` macro-phase reads `status` (the single documented exception)
* `routes/response-tracker.ts:676` — disposition for thread resolution
* `routes/response-tracker.ts:1059` — `isPhaseAtLeast` on canonical phase

### B.3 Display-axis legacy reads (intentional, leave alone)

* `routes/invoice-groups.ts:153,195` and `routes/claims.ts:124,167` — list endpoints accept `?status=` and `?outcome=` query params for verbatim sorting/filtering of the list UI. The list UI shows the legacy status string verbatim; these are display-axis, not logic-axis.
* `routes/dashboard.ts:141` — global stats rollups (UI tiles read verbatim status counts)
* `lib/brief-personalization.ts:133` — daily-brief actionable text (renders the verbatim status name)

---

## C. Frontend surfaces — comprehensive inventory

### C.1 🟡 Drift-vulnerable surfaces — work after tomorrow

All of these are display gates / conditional renders that compare hand-written legacy status/outcome strings. They work today because of writer-side lockstep, but each is drift-vulnerable.

| File:line | What it does | Drift-resistant fix |
|---|---|---|
| `pages/invoice-groups.tsx:921` | `group.status === "New" \|\| group.status === "Needs Evidence"` gates leg-breakdown badge | `group.macroPhase === "pre-submit"` |
| `pages/invoice-groups.tsx:61-70` | hand-written `STATUSES` array | derive from `@workspace/leg-state` or vocab |
| `components/invoice-group-detail-v2.tsx:283` | `outcome === "Denied" && closureReason === "denied_by_payor"` | already marked `vocab-allow-next-line`; intentional |
| `components/attestation-prompt.tsx:56` | `claim.outcome === "Approved" \|\| "Partially Approved"` gate | `outcomeRole(claim.outcome) === "approved-family"` (define helper) |
| `components/attestation/group-review-pane.tsx:70` | `r.outcome === "Denied"` filter | same outcome-role helper |
| `pages/claims.tsx:69` | hand-written claim STATUSES array | derive from `@workspace/leg-state` |

### C.2 🟢 Confirmed canonical reads (frontend)

* `pages/dashboard.tsx:453,460` — `macroPhase: "response-pending"` and `macroPhase: "mas-action-required"`
* `pages/responses-awaiting-review.tsx:151` — `macroPhase: "response-pending"`
* `pages/responses-awaiting-review.tsx:1086,1110` — `claim.sopOutcome` for Submitted vs Needs Record
* `pages/system-health.tsx:163` — phase wording (Round 1 Fix #7)
* `components/inline-group-workspace-v3.tsx:600` — `getGroupLifecyclePhaseFromGroup` for hold gating (Round 1 Fix #6)
* `components/inline-group-workspace-v3.tsx:315-318` — `claim.sopOutcome` for verdict label
* `components/claim-detail-v2.tsx:433,461,1755` — `group.macroPhase` for `groupIsPreSubmit`
* `components/claim-detail-v2.tsx:687,1290,1389` — `claim.sopOutcome`
* `components/status-pill.tsx:96-106` — prefers `disposition` for tone, keeps `status` for label
* `components/attestation-prompt.tsx:59` — `claim.attestationState`
* `components/attestation/per-leg-row.tsx:48` — `claim.attestationState`
* `pages/responses-awaiting-review.tsx:730` — `StatusBadge` (display-axis only, intentional)

### C.3 Display-axis legacy reads (intentional, per Round 1 §8)

* `pages/dashboard.tsx:725,773,806,848` — narrative "recent activity" labels show legacy status strings verbatim
* `components/claim-detail-v2.tsx:725,909,1752` — legacy status appears in error-message TEXT only
* `components/inline-group-workspace-v3.tsx:440-444` — `submitted` flag derived from legacy status (intentional per Round 1 §8)

---

## D. Crons / batch workers / schedulers

All schedules registered in `artifacts/api-server/src/index.ts` via `node-cron`. Schedule strings centralized in `lib/cron-schedule.ts`.

| Job | File:line | Schedule | Touches state? | Through canonical helper? | Risk |
|---|---|---|---|---|---|
| Urgent Snapshot | `index.ts:267` | `0 8-20 * * *` (hourly business hours) | reads only | n/a | 🟢 |
| Daily Brief | `index.ts:280` | `0 7 * * 1-5` | reads only | n/a | 🟢 |
| Brief Bounce Recheck | `index.ts:321` | `15 7 * * 1-5` | writes `cron_runs.status` only | n/a | 🟢 |
| Response Tracker | `index.ts:337` | `*/30 8-18 * * 1-5` | writes `portal_responses` only | n/a | 🟢 |
| Outlook Heartbeat | `index.ts:357` | `*/15 * * * *` | writes `connector_health` only | n/a | 🟢 |
| **Expired Sweep** | `index.ts:379` | `0 1 * * *` (daily 1am ET) | writes group `status`/`phase`/`closure_reason`, claim `disposition` | **Yes** — `transitionGroupStatus` + `setClaimDisposition` | 🟢 |
| Stuck Submission Reset | `index.ts:403` | `*/30 * * * *` | writes `portal_submissions.status` only (queue state, NOT claim/group state) | n/a | 🟢 **(explorer flagged 🔴; verified out-of-scope)** |
| Portal Batch Sweeper | `index.ts:429` | `0 8,11,14,18,22 * * 1-5` | writes `portal_submissions` only | n/a | 🟢 |
| Bot Presence Purge | `lib/bot-presence.ts:48` | `setInterval` (5m) | in-memory only | n/a | 🟢 |
| **Disputed-child sync (boot-time, prod-only)** | `index.ts:145` | once at boot | bulk raw-SQL `UPDATE claims SET status, outcome` | **No — bypasses helper, no refresh** | **🔴 see §A.1** |

**Locks:** Portal batch worker uses an in-process singleton (`worker-gate.ts`) plus row-level `claimed_by_batch_id`. Expired sweep relies on `checkActiveSubmissions` inside `transitionGroupStatus` to avoid clobbering in-flight submissions.

---

## E. API response shapes

(Spot-checked; full schema audit deferred — every endpoint that returns groups/claims now serializes both legacy `status`/`outcome` AND canonical `phase`/`macroPhase`/`lifecyclePhase`/`disposition`/`sopOutcome` fields. Confirmed via the frontend audit in §C: every consumer that reads canonical fields finds them on the response.)

* `GET /invoice-groups` and `GET /invoice-groups/:id` — both legacy and canonical present
* `GET /claims` and `GET /claims/:id` — both legacy and canonical present
* `GET /dashboard/summary` — returns `macroPhase` cohorts (Round 1 Fix #4 verified)
* `GET /responses/...` — returns disposition + macroPhase

OpenAPI spec sync: deferred to a separate pass; not blocking tomorrow's run.

---

## F. DB safety nets (already in place — unchanged from Round 1)

* `claims.is_open` / `invoice_groups.is_open` generated columns
* `invoice_groups.phase` column NOT NULL DEFAULT `'triage'`
* `phase_entered_at` NOT NULL DEFAULT `now()`
* `invoice_groups_phase_idx` index for fast macro-phase queries
* Conformance audit script (`scripts/check-invoice-state-derivation.ts`) — runnable any time, currently passes 0/4006

---

## G. Round-2 fixes applied this session

1. **`scripts/src/check-invoice-state-derivation.ts`** — group query now includes a correlated subquery for `claims.submitted_via`, mirroring `refreshGroupDerivedFields`'s runtime aggregation. Eliminates phantom `phase_mismatch` violations.
2. **`artifacts/api-server/src/lib/group-transitions.ts:537`** — `transitionGroupStatus` now calls `refreshGroupDerivedFields(groupId, ex)` unconditionally at end of `statusChanged` block, matching the pattern in `transitionGroupOutcome` and `transitionGroupStatusAndOutcome`. Removed the redundant MAS-only refresh that Round 1 Fix #1 had added (now subsumed).
3. **One-shot heal** — group #15 (`ready_to_submit` → `submitted`). 1 of 1,416 rows needed healing; the rest were already in lockstep.

---

## H. Items left for after tomorrow's run (hardening, not bug fixes)

In priority order:

1. 🔴 **§A.1 Disputed-child sync** — add `refreshClaimDenormalizedCache` per healed leg. (Fixing today before deploy.)
2. 🟡 **§B.1 Response matcher** — switch `WHERE status IN (…)` to phase-based predicate. Drift-vulnerable.
3. 🟡 **§B.1 Group packaging gate** — switch `PACKAGEABLE_GROUP_STATUSES` to phase-based set.
4. 🟡 **§B.1 Dashboard SQL metrics** — large refactor to move tile rollups onto phase-based predicates.
5. 🟡 **§C.1 Frontend hand-written status arrays** — replace legacy string compares with `macroPhase`/`outcomeRole` checks.
6. OpenAPI spec sync pass.
7. Drop legacy `status`/`outcome` columns from API responses entirely (long-term), once frontend has fully migrated.

---

## I. Items closed without action (audit corrections)

* 🔴→🟢 `routes/invoice-groups.ts:3798 reattest/queue` — explorer flagged HIGH because the inline body sets `awaitingPayorAgainAt` directly. Verified the full handler ends with `await refreshGroupDerivedFields(id)` at line 4087. No fix needed.
* 🟡→🟢 `routes/import.ts:214,239` — explorer flagged because direct insert with legacy status. Verified `invoice_groups.phase` column DEFAULT `'triage'` covers freshly-imported rows; legacy "New"/"Needs Review" both map to `triage`. No fix needed.
* 🟡→🟢 `routes/ai-email.ts:282` — explorer flagged as classification writer. Verified writes only `generatedEmail*` fields, not state. No fix needed.
* 🔴→🟢 `lib/stuck-submissions.ts` cron — explorer flagged HIGH for bypassing transition helpers. Verified writes `portal_submissions.status` only — that's queue state, completely separate from the claim/group state machine this audit covers. Out of scope.
* 🟡→🟢 `routes/claims.ts:538` attestation gating — explorer flagged for legacy outcome read. Inline comment documents the `OR eq(status,"MAS Eligible")` clause is intentional to cover the cascade case where outcome stays Pending. Working as designed.

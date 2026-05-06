# State pre-migration census

**Date:** 2026-05-06
**Captured by:** Wave 0 of the hierarchical state machine refactor
**Source:** read-only `execute_sql` against production
**Status of audits:** §6.1 ✓ zero NULLs · **§6.2 ✗ 2 NULL rows** — STOP gate triggered, see §C
**Totals:** 1,310 invoice groups · 2,406 claims

---

## §A. Invoice tuple census

`invoice_groups` grouped by `(status, outcome, reattest_required, reattest_completed_at IS NOT NULL, closure_reason, hold_reason IS NOT NULL)`.

| status | outcome | reattest_required | reattested | closure_reason | held | n | maps to |
|---|---|---|---|---|---|---|---|
| New | Pending | f | f | — | f | 869 | `triage` |
| Awaiting Response | Pending | f | f | — | f | 205 | `submitted` |
| Resolved | Non-Issue | f | f | non_issue | f | 80 | `closed / non_issue` |
| Expired | Pending | f | f | — | f | 72 | `closed / expired` |
| Needs Review | Pending | f | f | — | f | 52 | `triage` |
| Needs Review | Pending | t | t | — | f | 9 | `closed / reattested` |
| Needs Review | Pending | t | f | — | f | 6 | `awaiting_reattestation` |
| Denied | Denied | f | f | denied_by_payor | f | 5 | `closed / denied_by_payor` |
| Denied | Pending | f | f | — | f | 4 | `closed / denied_by_payor` (closure_reason backfilled) |
| New | Pending | t | f | — | f | 4 | `awaiting_reattestation` (reattest_required wins over status) |
| Portal Queued | Pending | f | f | — | f | 1 | `ready_to_submit` |
| Resolved | Non-Issue | f | f | — | f | 1 | `closed / non_issue` (closure_reason backfilled) |
| Needs Evidence | Pending | f | f | — | f | 1 | `triage` (+ `hold_reason='evidence_pending'` per §6.1) |
| On Hold | Pending | f | f | — | t | 1 | `triage` (mapping uses prior phase from audit_log) |
| **Total** | | | | | | **1310** | |

**Distinct tuples observed: 14.**

**Drift notes (worth surfacing later):**
- 9 invoices with `status='Needs Review'` BUT `reattest_completed_at IS NOT NULL` — stale status that hasn't caught up to the completed re-attestation. Maps cleanly to `closed`; healed by the backfill.
- 6 invoices with `status='Needs Review'` BUT `reattest_required=true, reattest_completed_at=NULL` — operator never moved status to `MAS Eligible`. Maps to `awaiting_reattestation`; healed.
- 4 invoices with `status='New'` AND `reattest_required=true` — looks structurally impossible (a new invoice can't need re-attestation), but the data is there. Mapping uses the reattest flag; healed to `awaiting_reattestation`.
- 4 invoices with `(Denied, Pending, NULL closure_reason)` — drift bug #8 from the audit. Backfill stamps `closure_reason='denied_by_payor'`.
- 1 `(Resolved, Non-Issue, NULL closure_reason)` — drift bug #1's invoice-side analog. Backfill stamps `non_issue`.
- 1 `(On Hold)` invoice — only 1 in prod. The §6.1 rule for hold ("use prior phase from audit_log") needs an actual audit_log query to land in the migration's CASE expression; the prototype I ran defaulted to `triage`.

## §A audit (§6.1)

```sql
SELECT id, status, outcome, reattest_required, reattest_completed_at, closure_reason, hold_reason
FROM invoice_groups
WHERE (CASE
  WHEN reattest_completed_at IS NOT NULL THEN 'closed'
  WHEN reattest_required = true AND reattest_completed_at IS NULL THEN 'awaiting_reattestation'
  WHEN status IN ('Resolved','Denied','Expired') THEN 'closed'
  WHEN status = 'Ready to Review' THEN 'response_received'
  WHEN status = 'Awaiting Response' THEN 'submitted'
  WHEN status IN ('Portal Queued','Generating Email') THEN 'ready_to_submit'
  WHEN status IN ('New','Needs Evidence','Needs Review','On Hold') THEN 'triage'
  WHEN status = 'MAS Eligible' THEN 'awaiting_reattestation'
  ELSE NULL
END) IS NULL;
```

**Result:** 0 rows. ✓ §6.1 mapping covers every prod invoice.

---

## §B. Claim tuple census

`claims` grouped by `(status, outcome, sop_outcome, attestation_state, included_in_dispute, duplicate_of_claim_id IS NOT NULL, drop_reason IS NOT NULL)`.

| status | outcome | sop_outcome | attestation_state | inc_in_dispute | is_dup | dropped | n |
|---|---|---|---|---|---|---|---|
| New | Pending | — | not_required | t | f | f | 1181 |
| New | Pending | non_issue | not_required | f | f | f | 431 |
| Awaiting Response | Pending | portal_dispute | not_required | t | f | f | 244 |
| Needs Review | Pending | non_issue | not_required | f | f | f | 216 |
| New | Pending | — | not_required | f | f | f | 94 |
| Expired | Pending | — | not_required | t | f | f | 74 |
| Needs Review | Pending | — | not_required | t | f | f | 31 |
| Needs Review | Pending | portal_dispute | not_required | t | f | f | 22 |
| On Hold | Pending | — | not_required | t | f | f | 19 |
| Awaiting Response | Pending | non_issue | not_required | f | f | f | 17 |
| **Needs Review** | **Approved** | **portal_dispute** | **completed** | t | f | f | **14** |
| Resolved | Non-Issue | non_issue | not_required | f | f | f | 14 |
| Awaiting Response | Pending | — | not_required | t | f | f | 10 |
| **Needs Review** | **Approved** | **portal_dispute** | **queued** | t | f | f | **8** |
| Denied | Denied | portal_dispute | not_required | t | f | f | 5 |
| Denied | Pending | — | not_required | t | f | f | 4 |
| Expired | Pending | portal_dispute | not_required | t | f | f | 2 |
| On Hold | Pending | non_issue | not_required | f | f | f | 2 |
| Portal Queued | Pending | — | not_required | t | f | f | 2 |
| Awaiting Response | Pending | — | not_required | t | **t** | f | 2 |
| Resolved | Non-Issue | portal_dispute | not_required | t | f | f | 1 |
| New | Pending | cannot_dispute | not_required | t | f | **t** | 1 |
| On Hold | Withdrawn | — | not_required | t | f | f | 1 |
| Needs Review | Pending | — | not_required | t | t | f | 1 |
| Needs Review | Denied | portal_dispute | not_required | t | f | f | 1 |
| New | Pending | non_issue | not_required | t | f | t | 1 |
| Needs Evidence | Pending | portal_dispute | not_required | t | f | f | 1 |
| **Needs Review** | **Pending** | **dispute** | not_required | t | f | f | **1** |
| Denied | Denied | dispute | not_required | t | f | f | 1 |
| Processed | Pending | portal_dispute | not_required | t | f | f | 1 |
| Awaiting Response | Approved | dispute | not_required | t | f | f | 1 |
| On Hold | Approved | — | not_required | t | f | f | 1 |
| **On Hold** | **Pending** | **hold** | not_required | t | f | f | **1** |
| **Total** | | | | | | | **2406** |

**Distinct tuples observed: 33.**

**Drift notes:**
- 22 rows with `attestation_state ≠ 'not_required'` — matches audit §B3's "22 non-default rows" exactly. 14 `completed` + 8 `queued`. No `pending`.
- 3 rows with `sop_outcome='dispute'` (the deprecated email-channel value) — matches audit §B5 exactly.
- 1 row with `drop_reason IS NOT NULL` (`(New, Pending, cannot_dispute, …, dropped=t)`) — the `drop_reason` column was reported as all-NULL in audit §B6; this single non-NULL row arose between the audit and now.
- 3 rows with verdict outcomes (`Approved` / `Denied`) on claims whose status is still pre-terminal (`Awaiting Response`, `On Hold`) — verdict-cache lag.

## §B audit (§6.2 — non-verdict rules)

```sql
SELECT id, status, outcome, sop_outcome, attestation_state,
       included_in_dispute, duplicate_of_claim_id, error_type_id
FROM claims
WHERE (CASE
  WHEN duplicate_of_claim_id IS NOT NULL THEN 'duplicate'
  WHEN included_in_dispute = false AND sop_outcome = 'non_issue' THEN 'disposed_nonissue'
  WHEN included_in_dispute = false AND sop_outcome = 'cannot_dispute' THEN 'disposed_withdraw'
  WHEN sop_outcome = 'hold' THEN 'blocked'
  WHEN sop_outcome = 'portal_dispute' THEN 'disposed_portal'
  WHEN sop_outcome = 'dispute' THEN 'disposed_email'
  WHEN sop_outcome IS NULL AND included_in_dispute = true AND error_type_id IS NOT NULL THEN 'classifying'
  WHEN sop_outcome IS NULL THEN 'unclassified'
  ELSE NULL
END) IS NULL;
```

**Initial result (rules as-written in brief §6.2):** 2 rows surfaced. ✗ STOP gate.

| id | status | outcome | sop_outcome | attestation_state | inc_in_dispute | duplicate_of | error_type_id | drop_reason | dropped_at |
|---|---|---|---|---|---|---|---|---|---|
| 729 | New | Pending | non_issue | not_required | **t** | — | 12 | non_issue | NOT NULL |
| 597 | New | Pending | cannot_dispute | not_required | **t** | — | 3 | cannot_dispute | NOT NULL |

Both rows have a terminal-triage `sop_outcome` (`non_issue` / `cannot_dispute`) **and** `drop_reason` populated **and** `included_in_dispute=true`. §6.2's rules 2 and 3 (as originally written) required `included_in_dispute=false` for those `sop_outcome` values, so neither row matched. **This is not data drift** — see §C for the corrected reading.

**Re-run after R1 adopted (`included_in_dispute` predicate dropped from rules 2/3):** **0 rows.** ✓ Confirmed via prod query 2026-05-06; total 2,405 claims, 0 NULL dispositions, 8 distinct disposition values produced. (Total is 2,405 vs. 2,406 from the initial census; one claim was deleted in the interim, immaterial to the audit.)

---

## §C. STOP-gate findings (corrected 2026-05-06)

### The original misread

The first census report framed the 2 surfaced rows as data drift — operators or code that "forgot" to flip `included_in_dispute=false` when recording a do-not-pursue SOP outcome. **This was wrong.** Re-reading the writers in `artifacts/api-server/src/lib/claim-transitions.ts` and `artifacts/api-server/src/routes/claims.ts` shows the 2 rows are the legitimate, correctly-shaped output of a code path that the brief's §6.2 silently assumed didn't exist.

### What actually exists in the codebase

Today's schema has **two parallel writers** that produce the same operator-facing concept ("this leg won't be disputed: non-issue / non-contestable") through two different storage shapes:

| Path | Writer | Where | Sets `included_in_dispute=false`? | Stamps `drop_reason` + `dropped_at`? | Audit action | Sub-status |
|---|---|---|---|---|---|---|
| **Excluded** | `excludeLegCore` | `claim-transitions.ts:548` | yes (only writer that flips it) | no | `leg_excluded` | `excluded` |
| **Dropped** | `POST /claims/:id/conclude-leg` (Task #265 picker) | `claims.ts:1928` | **no** (leaves it true) | yes | `leg_concluded` | `dropped` |
| **Dropped** | `POST /claims/:id/sop-advance` terminal | `claims.ts:1872` | no | yes (when terminal is `non_issue`/`cannot_dispute`) | `leg_sop_advanced` | `dropped` |

When `excludeLegCore` is called with `reason='non_issue'`, it co-writes `sop_outcome='non_issue'` on the same UPDATE (the Task #476 fix, healed historically by the 2026-05-06 oneshot for 680 rows). That's why most production `(non_issue)` rows have `included_in_dispute=false` — but the dropped path is a real, separate, in-use code path that the brief §6.2 simply didn't enumerate.

### What rows 729 and 597 actually are

The `drop_reason IS NOT NULL` column on these two rows is the smoking gun. `excludeLegCore` doesn't write `drop_reason`; only `conclude-leg` and `sop-advance` terminals do. So these 2 rows are operators having clicked the Queue Panel A "Non-issue" / "Non-contestable" buttons. Correct, expected output. Two of them in prod because the conclude-leg picker is a marginal code path (auto-exclusion via blank-sibling does most of the work), but it's a legitimate path.

### What this means for the §6.2 mapping

The original census proposed three resolutions (R1: SOP outcome wins; R2: inclusion flag wins; R3: heal the data). **R1 is still correct, but for the right reason** — not "drift heal," but **"the `disposition` column encodes the operator-facing concept; both writer paths produce the same concept; the inclusion-flag distinction is a per-path storage detail that the new vocabulary intentionally collapses."**

R2 is wrong because it would mis-label 2 production rows as "still in progress" when the operator already concluded them.

R3 is wrong because there is no drift to heal — the rows are correctly-shaped output of an in-use endpoint, not a backfill leftover.

After R1: §B audit returns 0 rows over 2,405 claims, 8 distinct disposition values, NOT NULL constraint will hold.

### Wave 0.5 implications (see §F)

The two-path code structure itself is the kind of legacy storage shape this refactor is meant to clean up. Wave D's writer-site enumeration must be expanded to include the conclude-leg endpoint (currently not in the brief's "12 writer sites" count), the sop-advance terminal branch, and the verdict gate at `claims.ts:2768` (which today keys on `included_in_dispute=true` and needs rewriting to key on `disposition`). These follow-ons are tagged in §F.

---

## §D. Pre-Wave-B baseline snapshot (audit A1 input)

The per-tuple counts in §A and §B are the "before" snapshot. After Wave B, the post-migration `SELECT phase, COUNT(*) FROM invoice_groups GROUP BY phase` projected backward through §6.1 must equal the §A counts exactly. Same for claims via §6.2.

Expected post-Wave-B phase distribution (assuming R1 is adopted):

| phase | n (projected) | derivation |
|---|---|---|
| `triage` | 932 | 869 New + 52 Needs Review + 1 Needs Evidence + 1 On Hold + 9 Needs Review (which map to closed via reattest) — wait, the 9 map to closed; recompute |
| | | 869 + 52 + 1 + 1 = 923 |
| `ready_to_submit` | 1 | 1 Portal Queued |
| `submitted` | 205 | 205 Awaiting Response |
| `response_received` | 0 | (no Ready to Review rows) |
| `reviewed` | 0 | (always transient between response and reattest) |
| `awaiting_reattestation` | 10 | 6 Needs Review reattest pending + 4 New with reattest_required |
| `closed` | 171 | 80 + 1 Resolved/Non-Issue + 72 Expired + 5 + 4 Denied + 9 Needs Review reattested |
| **Total** | **1310** | ✓ |

(Adding to 923 + 1 + 205 + 10 + 171 = 1310. ✓)

---

## §E. Going forward

1. ✓ R1 locked in 2026-05-06. Brief §6.2 rules 2/3 updated to drop the inclusion predicate; brief §3.2 + §4 + §5.3 updated to fold the dropped-path columns (`included_in_dispute`, `drop_reason`, `dropped_at`, `ready_at`) into the Wave E drop list. See §F for the full set of brief revisions and the Wave 0.5 catalogue items this analysis surfaced.
2. ✓ §B audit re-run after R1 returns 0 NULLs across 2,405 claims (8 distinct disposition values). STOP gate cleared.
3. The 33-tuple claim distribution from §B becomes the A1 baseline for Wave B.
4. Proceed to Wave 0.5 (call-site catalogue) using the §F items as starting scope.

---

## §F. Brief revisions applied + Wave 0.5 catalogue items surfaced

### Brief revisions applied (`docs/architecture/state-hierarchy-v1.md`)

| Section | Revision | Why |
|---|---|---|
| §3.2 | Added "Writer-path consolidation" table enumerating the 4 legacy writer paths (`excludeLegCore` × 2 reasons, `conclude-leg` × 2 reasons, `sop-advance` terminal) that all collapse into single `setClaimDisposition` calls. | Brief originally implied a 1:1 writer mapping; production has a 2:1 collapse for the non-issue / non-contestable concepts. |
| §4 | Added `claims.included_in_dispute`, `claims.drop_reason`, `claims.dropped_at`, `claims.ready_at` to the deletion list, with note that they are storage-shape artifacts of the legacy two-path writer split. | Originally only listed `drop_reason`; the others were implicit. Need explicit enumeration so Wave E migration is unambiguous. |
| §5.3 | Added the same 3 columns (`dropped_at`, `ready_at`, `included_in_dispute`) to the `ALTER TABLE claims DROP COLUMN` statement. | Mechanical follow-on to §4. |
| §6.2 | Added "Two-path collapse" preamble; rewrote rules 2/3 to drop the `included_in_dispute=false` predicate; annotated the rules with the two storage shapes both map covers. | Original rules silently assumed only the excluded path existed. R1 fix per §C. |

### Wave 0.5 catalogue items (call sites needing rewrites)

These are sites the brief's "12 writer sites" enumeration must be expanded to cover before Wave D can complete. Each is a known anchor point for the call-site audit phase:

| # | Site | File:line | Wave | Rewrite |
|---|---|---|---|---|
| W0.5-1 | `excludeLegCore` (sole writer of `included_in_dispute=false`, co-writer of `sop_outcome='non_issue'`) | `lib/claim-transitions.ts:548` | D | Becomes `setClaimDisposition(id, 'disposed_nonissue' \| 'disposed_withdraw' \| 'disposed_<other-reason>', ctx)`. The reason→disposition map needs explicit enumeration before Wave D. |
| W0.5-2 | `POST /claims/:id/conclude-leg` (Task #265 picker writer) | `routes/claims.ts:1928` | D | Replace the inline UPDATE (`sop_outcome` + `drop_reason` + `dropped_at`) with `setClaimDisposition(id, mapped, ctx)`. Audit action stays `leg_concluded` via `ctx.source`. |
| W0.5-3 | `POST /claims/:id/sop-advance` terminal branch (writes `sop_outcome` + conditional `drop_reason`/`dropped_at`/`ready_at`) | `routes/claims.ts:1872-1878` | D | The mid-walk branch (sets `sop_node_id` + `sop_answers`) stays as-is; the terminal branch becomes a `setClaimDisposition` call. SOP node id and answers continue to live on `claims` (orthogonal to disposition). |
| W0.5-4 | `POST /claims/:id/include` re-include endpoint (flips `included_in_dispute=true`) | `routes/claims.ts:2330` | D | Becomes `setClaimDisposition(id, <prior-or-classifying>, ctx)` — needs to read the disposition immediately prior to exclusion from audit history, or default to `classifying` if no prior exists. Open question for Wave 0.5. |
| W0.5-5 | Verdict-record gate (rejects when `included_in_dispute=false`) | `routes/claims.ts:2768` | D | Rewrite to gate on `disposition IN {disposed_portal, disposed_email}` (the new equivalents of `submittedSopOutcomes`). Today's `submittedSopOutcomes` set on line 2776 already enumerates this — the gate simplifies to a single disposition check. |
| W0.5-6 | `RESOLVED_LEG_SUB_STATUSES` consumer set (`{ready, dropped, excluded}`) and the entire `lib/leg-state` derivation chain | `lib/leg-state/src/per-leg-sub-status.ts:51` + consumers | A→D | Brief §4 says "lib/leg-state — restructured around the new disposition vocabulary". Wave A defines the new sub-status mapping from `disposition`; Wave D removes the legacy `deriveLegSubStatus` precedence chain. Need a Wave 0.5 inventory of all 30+ call sites that import from `lib/leg-state`. |
| W0.5-7 | `mapTreeOutcomeToSopOutcome` + `SOP_DROP_REASONS` + `SOP_READY_REASONS` (vocab tied to today's `sop_outcome` column) | `routes/claims.ts` (around the SOP-advance handler) + `lib/sop-vocab` | D | These exist to translate decision-tree leaf node `outcomeType` strings into the `sop_outcome` column vocabulary. After Wave D, the equivalent is `mapTreeOutcomeToDisposition`. Vocab needs restated in `lib/vocab` before Wave A. |
| W0.5-8 | `applyMasDerivationsForLeg` (called from sop-advance terminal + conclude-leg + others) | grep needed | D | Today reads `sop_outcome` to decide MAS-action-required; rewrites to read `disposition`. Wave 0.5 catalogue must enumerate every call site. |
| W0.5-9 | Audit-action vocabulary (`leg_excluded`, `leg_concluded`, `leg_sop_advanced`, `leg_included`, etc.) | `lib/observability` registry | A | Needs explicit enumeration in `lib/observability` registry so Wave A can route every legacy action through the new `ctx.source`-stamped audit emitter without losing the per-path distinction. Already covered by the existing registry plan but flagged here for completeness. |

The 8 items the user previously enumerated for Wave 0.5 (expired closure_reason vocab check, `claim_verdicts` table fate, portal-worker leg callback writer, system/bot actor bypass, `mas_cancelled` disposition source, `claims.closure_reason` cascade post-cache-deletion, tour version bump, `lib/eslint-plugin-claimclear` scaffold) **remain in scope and are additive to** the 9 items above.

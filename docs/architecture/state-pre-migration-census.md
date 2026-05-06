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

**Result:** **2 rows.** ✗ STOP gate per handoff §6.

| id | status | outcome | sop_outcome | attestation_state | inc_in_dispute | duplicate_of | error_type_id |
|---|---|---|---|---|---|---|---|
| 729 | New | Pending | non_issue | not_required | **t** | — | 12 |
| 597 | New | Pending | cannot_dispute | not_required | **t** | — | 3 |

Both rows have a terminal-triage `sop_outcome` (`non_issue` / `cannot_dispute`) **but** `included_in_dispute=true`. §6.2's rules 2 and 3 require `included_in_dispute=false` for those `sop_outcome` values, so neither row matches any rule, and both fall through to NULL.

This is a real model gap, not a data quality issue alone. See §C.

---

## §C. STOP-gate findings

### The gap

§6.2 rules 2 and 3 conjoin two facts:
- `sop_outcome ∈ {'non_issue', 'cannot_dispute'}`
- `included_in_dispute = false`

The model assumes the second always follows the first — i.e. that operators (or SOP-advance code) flip `included_in_dispute` to `false` whenever they record a "do-not-pursue" SOP outcome. The 2 surfaced rows show that assumption doesn't hold in production: the SOP recorded the outcome, but the inclusion flag was left at the import default (`true`).

### Why this matters for Wave B

If we ship the §6.2 mapping as-written, Wave B's atomic backfill `UPDATE claims SET disposition = (CASE …)` will write `NULL` for these 2 rows. `claims.disposition` is declared `NOT NULL` in §5.1, so the migration will fail mid-transaction and the deploy will roll back.

### Possible resolutions (decision needed before Wave A starts)

| Option | Description | Trade-off |
|---|---|---|
| **R1: SOP outcome wins** | Drop the `included_in_dispute=false` predicate from rules 2 and 3. Any leg with `sop_outcome='non_issue'` becomes `disposed_nonissue`; any leg with `sop_outcome='cannot_dispute'` becomes `disposed_withdraw`, regardless of the inclusion flag. | Simplest. Aligns with audit §C3's observation that `outcomeRole()` already collapses these to non-include roles. The 2 drift rows heal as a side effect. **Recommended.** |
| **R2: Inclusion flag wins** | Keep rules 2/3 as written. Add a fallback rule: `sop_outcome ∈ {non_issue, cannot_dispute} AND included_in_dispute=true` → `classifying` (i.e. treat the row as still-in-progress because the operator hasn't committed the exclusion). | Preserves the inclusion flag as authoritative. But these 2 rows would map to `classifying`, which means Wave A's auto-advance from `triage → ready_to_submit` would never fire for them, and they'd sit in `triage` forever unless an operator re-touches them. |
| **R3: Heal the data first** | Run a one-shot script before Wave B that flips `included_in_dispute=false` on the 2 rows. Then §6.2 maps cleanly as-written. | The handoff doc explicitly bans boot-time backfills (user pref §4) but allows manual `--apply` scripts. Adds a step but keeps the model strict. |

My recommendation is **R1**. The `included_in_dispute` flag is documented in audit §C3 as a derived field that's been kept around for legacy reasons; `sop_outcome` is the source of truth. Making rules 2/3 read sop_outcome only matches the reality of how the rest of the codebase already treats these values, and heals the 2 drift rows without a separate script.

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

1. Block Wave A on user decision: R1 vs R2 vs R3 above.
2. Once decided, update `state-hierarchy-v1.md` §6.2 rules 2 and 3 accordingly, then re-run §B audit. Must return zero before Wave A starts.
3. The 33-tuple claim distribution from §B becomes the A1 baseline for Wave B.

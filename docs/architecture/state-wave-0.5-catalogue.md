# Wave 0.5 — Call-site catalogue

**Status:** Draft 2026-05-06.
**Inputs:** `state-hierarchy-v1.md` (revised 2026-05-06), `state-pre-migration-census.md` §F.
**Output of this doc:** every code site that touches the legacy state vocabulary, classified by which wave touches it, with line-anchored references. This is the call-site map the brief's "12 writer sites" enumeration was missing.
**Method:** ripgrep counts on each legacy column + manual classification of the top hits. Generated API files (`lib/api-zod/src/generated/`, `lib/api-client-react/src/generated/`) are listed once as a single bucket; they regenerate from `api-spec` and don't need per-line audit.

---

## §1. Writer sites for the four columns folding into `disposition`

These are the only places that **write** `claims.status`, `claims.sop_outcome`, `claims.attestation_state`, `claims.included_in_dispute`, `claims.drop_reason`, `claims.dropped_at`, `claims.ready_at`. Each becomes a `setClaimDisposition` caller in Wave D.

| ID | Path | File:line | Today's writer | Wave D rewrite |
|---|---|---|---|---|
| W1 | Manual exclude button | `artifacts/api-server/src/routes/claims.ts:2207-2220` | `excludeLegCore({reason, …})` | `setClaimDisposition(id, mapReason(reason), ctx{source:'manual_exclude'})` |
| W2 | Bulk auto-exclude blanks at submit | `artifacts/api-server/src/lib/group-transitions.ts:275` | `excludeLegCore({reason:'non_issue', source:'auto_blank_sibling'})` | `setClaimDisposition(id, 'disposed_nonissue', ctx{source:'auto_blank_sibling'})` |
| W3 | Bulk auto-exclude (second loop) | `artifacts/api-server/src/lib/group-transitions.ts:331` | `excludeLegCore` | same as W2 |
| W4 | Conclude-leg picker | `artifacts/api-server/src/routes/claims.ts:1928-1993` | direct UPDATE: `sop_outcome` + `drop_reason` + `dropped_at` | `setClaimDisposition(id, mapReason(reason), ctx{source:'conclude_leg'})` |
| W5 | SOP-advance terminal | `artifacts/api-server/src/routes/claims.ts:1872-1878` | direct UPDATE: `sop_outcome` + conditional `drop_reason`/`dropped_at`/`ready_at` | `setClaimDisposition(id, mapTreeOutcomeToDisposition(option.outcomeType), ctx{source:'sop_terminal'})` |
| W6 | SOP-advance mid-walk | `artifacts/api-server/src/routes/claims.ts:1857-1859` | direct UPDATE: `sop_node_id` + `sop_answers` | **Stays as-is.** SOP node id and answers are orthogonal to disposition — they live on `claims` independent of phase/disposition. |
| W7 | Re-include endpoint | `artifacts/api-server/src/routes/claims.ts:2330-2334` | direct UPDATE: `included_in_dispute=true` | `setClaimDisposition(id, priorDisposition ?? 'classifying', ctx{source:'re_include'})`. **Open question:** the prior disposition needs to be reconstructed from audit history; if no audit row exists, default to `classifying`. Spec this explicitly in Wave A. |
| W8 | Verdict insert (sets attestation downstream) | `artifacts/api-server/src/routes/claims.ts:2787` | `db.insert(claimVerdictTable)` + cascading attestation_state writes elsewhere | Verdict insert stays (verdict log is separate). The attestation_state cascade gets folded into `setClaimDisposition` calls via the post-verdict hook. |
| W9 | Verdict draft delete | `artifacts/api-server/src/routes/claims.ts:2929-2934` | `db.delete(claimVerdictTable)` | Stays. Operates on the verdict log, not on disposition. |
| W10 | Attestation queue/promote/cancel | `artifacts/api-server/src/lib/attestation.ts` (9 refs) + `oneshot-promote-stuck-attestation-legs.ts` (10 refs) | direct UPDATE: `attestation_state` transitions | All become `setClaimDisposition(id, attest_*, ctx)` calls. The 4 attestation_state values map 1:1 to 4 dispositions: `pending → attest_pending`, `queued → attest_queued`, `completed → attested`, `not_required → attest_not_required`. |
| W11 | Bulk MAS reattest queue | `artifacts/api-server/src/routes/invoice-groups.ts` (search around line 2921 verdict-insert path) | mixed UPDATEs across attestation_state + claim_verdicts | Same as W10 + W8. |
| W12 | Backfill scripts (one-shot) | `scripts/src/migrations/*.ts` + `artifacts/api-server/src/scripts/oneshot-*.ts` | direct UPDATEs and `excludeLegCore` calls with `backfillId` | **Out of Wave D scope.** These are one-shot historical scripts; they ran once and don't need conversion. The `backfillId` audit-metadata convention transfers to the new audit registry as `ctx{source:'backfill', backfillId}`. |

**Total writer sites needing Wave D rewrite: 11** (W1-W11; W6 stays, W12 deferred). The brief's "12 writer sites" estimate was approximately right but the breakdown was different (it counted invoice writers + claim writers together; this table is claim-only).

---

## §2. Writer sites for `invoice_groups.status` / `invoice_groups.outcome`

These become `transitionInvoice` callers in Wave D. Brief §3.1 calls out 6; this table enumerates each.

| ID | Path | File:line | Today's writer | Wave D rewrite |
|---|---|---|---|---|
| G1 | Manual transition (operator buttons) | `artifacts/api-server/src/routes/invoice-groups.ts` (multiple) | `db.update(invoiceGroupsTable).set({status, outcome, ...})` | `transitionInvoice(id, toPhase, ctx)` |
| G2 | Auto-advance after all-claims-classified | `artifacts/api-server/src/lib/group-transitions.ts` (multiple) | direct UPDATE | `maybeAdvanceInvoice(id)` invoked from `setClaimDisposition` post-hook (brief §3.2 step 5) |
| G3 | Auto-advance after payor response received | `artifacts/api-server/src/routes/portal-responses.ts` or `routes/portal-submissions.ts` (need verification) | direct UPDATE to `Ready to Review` | `transitionInvoice(id, 'response_received', ctx)` |
| G4 | Reattest completion | `artifacts/api-server/src/lib/group-transitions.ts` (reattest paths) | direct UPDATE to closed + reattest stamps | `transitionInvoice(id, 'closed', ctx{closureReason:'reattested', reattestStamps})` |
| G5 | Closure intake (Resolved/Non-Issue, Expired, Denied, Withdrawn) | `artifacts/api-server/src/lib/closure-validation.ts` (8 refs) + closure routes | direct UPDATE to closed + closure_reason | `transitionInvoice(id, 'closed', ctx{closureReason})` |
| G6 | Bulk MAS combined reattest | `routes/invoice-groups.ts` bulk endpoint | direct UPDATE | `transitionInvoice` per row inside transaction |
| G7 | Backfill scripts | `scripts/src/migrations/*.ts` | direct UPDATEs | **Out of Wave D scope** (one-shot historical) |

**Total invoice writer sites: 6** (G1-G6; G7 deferred). Matches brief §3.1.

---

## §3. Reader sites for the legacy columns (Wave C scope)

Reader sites are the consumers of `claims.sop_outcome`, `claims.attestation_state`, `claims.included_in_dispute`, `claims.drop_reason`, `invoice_groups.status`, `invoice_groups.outcome`. Wave C switches them all to read `disposition` / `phase`. Counted by ripgrep:

### `sopOutcome` consumers (the largest blast radius)

| File | Refs | Role |
|---|---|---|
| `routes/claims.ts` | 28 | mostly writers (already in §1); residual reads in derivation helpers |
| `routes/invoice-groups.ts` | 11 | aggregate per-leg readiness + verdict eligibility |
| `lib/denormalized-cache.ts` | 12 | **deleted entirely in Wave D** (brief §4) |
| `lib/group-packaging.ts` | 12 | per-leg packaging at submit time |
| `lib/claim-transitions.ts` | 9 | excludeLegCore co-write logic |
| `lib/leg-state/src/per-leg-sub-status.ts` | 7 | sub-status derivation — rewrite per W0.5-6 in §F |
| `lib/leg-state/src/index.ts` | 10 | re-exports |
| `lib/vocab/src/leg-sub-status.ts` | 6 | label/order vocabulary |
| `claimclear/src/pages/responses-awaiting-review.tsx` | 7 | UI read |
| `claimclear/src/components/decision-tree/sop-advance-player.tsx` | 12 | tree player reads to know terminal vs mid-walk |
| `lib/mas-derivations.ts` | 4 | MAS-action-required gate |
| `lib/prompt-leg-inputs.ts` + `prompt-context-counters.ts` | 6 | LLM prompt context |
| `claimclear/src/components/claim-detail-v2.tsx` | 5 | leg detail UI |
| `lib/db/src/schema/claims.ts` | 4 | schema definition |
| Generated API (`lib/api-zod/`, `lib/api-client-react/`) | ~115 | regenerates from `api-spec` |
| Tests + decision-tree terminal tests | ~40 | test fixtures |

**Total Wave C reader rewrite sites: ~25 production files** (excluding tests and generated code).

### `includedInDispute` consumers

| File | Refs | Role |
|---|---|---|
| `routes/claims.ts` | 9 | filter SQL + verdict gate |
| `routes/invoice-groups.ts` | 11 | aggregate readiness |
| `lib/group-transitions.ts` | 5 | bulk auto-exclude logic |
| `lib/claim-transitions.ts` | 3 | excludeLegCore |
| `lib/leg-state/src/per-leg-sub-status.ts` | 2 | sub-status precedence #1 (`excluded`) |
| `lib/leg-state/src/leg-resolved.ts` | 1 | resolved-set membership |
| `lib/db/src/schema/claims.ts` | 1 | schema |
| Tests + generated API | ~50 | regenerates / fixtures |

**Total Wave C reader rewrite sites: ~7 production files.**

### `attestationState` consumers

| File | Refs | Role |
|---|---|---|
| `routes/claims.ts` | 14 | attestation queue endpoints |
| `routes/invoice-groups.ts` | 12 | per-leg attestation history aggregator |
| `lib/attestation.ts` | 9 | core attestation logic |
| `oneshot-promote-stuck-attestation-legs.ts` | 10 | one-shot (out of scope) |
| `routes/dashboard.ts` | 5 | dashboard counters |
| `lib/group-transitions.ts` | 1 | reattest path |
| Tests + generated | ~25 | regenerates / fixtures |

**Total Wave C reader rewrite sites: ~6 production files.**

### `dropReason` / `droppedAt` / `readyAt` consumers

Mostly the writers in §1 (W4, W5) plus the leg-state derivation. After §1 rewrites these are write-only (read by audit history rendering only). **Wave C reader rewrite sites: ~3 production files.**

### `claims.status` / `claims.outcome` consumers

The 5 writer sites are already enumerated under W10/W11 + bulk paths. Reader-side: every UI surface that displays per-claim status. **Need follow-on grep before Wave C; estimated ~20 files.**

### `invoice_groups.status` / `invoice_groups.outcome` consumers (read side)

| File | Refs | Role |
|---|---|---|
| `lib/macro-phase.ts` | (entire file deleted in Wave D) | macro-phase derivation — replaced by direct phase read |
| `routes/invoice-groups.ts` | many | filter SQL across all queue panels |
| `routes/dashboard.ts` | many | dashboard counters |
| `claimclear/src/lib/lifecycle-phase.ts` | (entire file deleted) | client-side macro-phase derivation |
| `claimclear/src/components/invoice-group-detail-v2.tsx` | 10 | detail UI |
| `claimclear/src/components/invoice-group-list.tsx` (or equivalent) | many | list UI |
| `lib/vocab/src/closure-reason.ts` | 7 | closure vocab (stays — closure_reason survives) |

**Total Wave C reader rewrite sites: ~12 production files.**

---

## §4. The 8 prior-enumerated Wave 0.5 items

Re-confirming each with concrete location:

| # | Item | Resolution |
|---|---|---|
| P1 | Expired closure_reason vocab check | Vocab in `lib/vocab/src/closure-reason.ts` includes `expired`, `non_issue`, `denied_by_payor`, `reattested`, `withdrawn`, plus 2 free-text-historical values that are confined to closed rows. **No change needed** — the vocab survives intact post-refactor; brief §6.1 carries `closure_reason` forward as-is. |
| P2 | `claim_verdicts` table fate | **KEEPS.** Verdict log is the source of truth for verdicts; `claims.outcome` is a denorm cache of the latest verdict per claim and that cache is what gets deleted. After Wave D, every reader of `claims.outcome` reads from `claim_verdicts` directly (or via a join). The cache deletion in `denormalized-cache.ts` already lists this as one of its mirror columns. |
| P3 | Portal-worker leg callback writer | Located: `artifacts/api-server/src/routes/portal-submissions.ts:1412-1454` uses `submissionActor.kind === "system"` for the bot path. Needs `setClaimDisposition` callable with `ctx.actor.kind='system'` (W7 below). **Listed as W11 in §1 above.** |
| P4 | System/bot actor bypass | Two patterns in audit code: literal `userEmail:"system"` and `userEmail:"system@<scope>"` (e.g. `system@llm-first-classifier-backfill`, `system@attestation-gate-removed-backfill`). Both must be supported by the new `TransitionContext` actor type. **Spec for Wave A:** `actor: {kind: 'user', email, name} \| {kind: 'system', scope: string}`. The audit emitter renders `system@<scope>` for the system kind, preserving the existing convention. |
| P5 | `mas_cancelled` disposition source | Today's `attestationOutcome='mas_cancelled'` is a derived label in `routes/invoice-groups.ts:1130-1140` (leg has `masActionCompletedAt` with `masActionRequired='cancel'`). In the new model, the MAS-cancel completion handler stamps `disposition='mas_cancelled'` directly via `setClaimDisposition`. **Need to locate the writer** — search `masActionCompletedAt` for the writer site. |
| P6 | `claims.closure_reason` cascade post-cache-deletion | `claims` doesn't have a `closure_reason` column today (it's on `invoice_groups`); the per-claim closure cascade is via `claims.outcome` denorm. After cache deletion, the per-leg "closed because…" rendering reads `invoice_groups.closure_reason` via the FK join. **No new writer needed.** |
| P7 | Tour version bump | Current: `CURRENT_TOUR_VERSION = "2026-05-05.v17"` in `artifacts/claimclear/src/tour/tour-config.ts:9`. Wave A's queue panel labels change ("triage" / "ready_to_submit" / etc. replace "New" / "Portal Queued"). **Bump to `2026-05-XX.v18` in the Wave A PR**, with a tour script update referencing the new vocab. |
| P8 | `lib/eslint-plugin-claimclear` scaffold | **Does not exist yet** (`ls lib/` confirmed). Needs new package in Wave 0.5 with one rule: `no-direct-status-write` that forbids `db.update(invoiceGroupsTable).set({status: ...})` and `db.update(claimsTable).set({status: ..., sop_outcome: ..., included_in_dispute: ...})`. Active starting Wave D so the lint rule fails any regression to direct writes. |

---

## §5. Anti-slop audit hooks per wave (consolidated from §F + handoff)

Each wave's PR description must paste the relevant audit table and have it return zero rows on prod before merging. Pulled forward from the brief:

| Audit | Wave | Query summary | Pass criterion |
|---|---|---|---|
| A1 | A | 33-tuple claim baseline + 14-tuple invoice baseline (the §A/§B census tables) | matches pre-wave snapshot exactly |
| A2 | B | every claim has non-NULL `disposition`; every invoice has non-NULL `phase` | 0 rows where either is NULL |
| A3 | B | for every claim row, `disposition ∈ VALID_DISPOSITIONS_BY_PHASE[parent.phase]` | 0 violations |
| A4 | C | the bidirectional cache mirror is consistent before deletion (`claims.status` projected from `disposition` matches stored `claims.status`) | 0 mismatches |
| A5 | D | every direct `db.update(invoiceGroupsTable).set({status:...})` and `db.update(claimsTable).set({status\|sop_outcome\|included_in_dispute:...})` has been removed | grep returns 0 hits in `artifacts/**/src/**` (excluding scripts/) |
| A6 | D | the new lint rule `no-direct-status-write` is active in CI and fails on a deliberate test fixture | CI red on test fixture, green on production code |
| A7 | E | dropped columns (`status`, `outcome`, `sop_outcome`, `attestation_state`, `included_in_dispute`, `drop_reason`, `dropped_at`, `ready_at`) are gone from `\d+ claims` and `\d+ invoice_groups` | psql introspection returns expected column list only |

---

## §6. Wave A spec decisions (resolved 2026-05-06)

All 5 questions resolved before Wave A starts. Each becomes a binding spec line in the Wave A PR.

1. **W7 prior-disposition reconstruction (re-include endpoint).**
   - Decision: on re-include, set `disposition = 'classifying'` if `claims.error_type_id IS NOT NULL AND error_type_id <> ''`, else `disposition = 'unclassified'`.
   - Rationale: matches the legacy sub-status derivation precedence (§3 readers — `per-leg-sub-status.ts:281-293`). Audit history reconstruction would be brittle and slow; a deterministic rule from current column state is consistent with how every other disposition in the model is derived.
   - The pre-exclusion disposition is recoverable from audit if anyone needs it (audit row `leg_excluded` carries `metadata.previousSubStatus`).

2. **`maybeAdvanceInvoice` triggering rule.**
   - Decision: introduce `DISPOSITION_TO_AFFECTED_TRANSITIONS: Record<ClaimDisposition, InvoicePhase[]>` lookup in `lib/invoice-state/src/transition-table.ts`. On every `setClaimDisposition`, only evaluate transitions whose `from === parent.phase AND to ∈ table[disposition]`.
   - Concrete table seed:
     ```
     unclassified, classifying       → []  (no auto-advance possible from these)
     disposed_portal, disposed_email,
     disposed_withdraw, disposed_nonissue,
     blocked, duplicate              → ['ready_to_submit']  (terminal triage values)
     awaiting_review, verdict_drafted → []  (operator must confirm)
     verdict_approved, verdict_denied,
     verdict_partial                 → ['reviewed']
     attest_pending, attest_queued   → []
     attested, mas_cancelled,
     attest_not_required             → ['closed']
     final_*                         → []
     ```
   - This is a small, auditable table; brief §3.3 already shows it as 30 lines of code.

3. **Audit-action name preservation.**
   - Decision: `TransitionContext` carries `source: string` (free-form short tag — `'manual_exclude'`, `'auto_blank_sibling'`, `'conclude_leg'`, `'sop_terminal'`, `'re_include'`, `'verdict_recorded'`, `'attest_complete'`, `'mas_cancel_complete'`, `'expired_sweep_cron'`, `'backfill'`, etc.). The `lib/observability` registry (Wave A PR 1) maps `(source, fromDisposition, toDisposition) → audit_action` so every legacy action name (`leg_excluded`, `leg_concluded`, `leg_sop_advanced`, `leg_included`, `leg_verdict_recorded`, `attestation_completed`, `group_status_changed`, etc.) is preserved.
   - Sources are enumerated in a const in the registry; lint rule `no-direct-status-write` (§4 P8) also forbids unknown source strings.

4. **Concurrent cron at Wave D publish — operator runbook.**
   - All state-mutating crons are tracked in the `cron_runs` table (`lib/db/src/schema/system-health.ts:3`). The 5 state-mutating crons are: `urgent_snapshot`, `daily_brief`, `expired_sweep`, `stuck_submission_reset`, `portal_batch_sweeper` (`artifacts/api-server/src/index.ts:267-429`). Of these, the ones that write `invoice_groups.status` or `claims.status` are `expired_sweep` (writes Expired), `stuck_submission_reset` (resets Generating Email back to New), `portal_batch_sweeper` (writes Awaiting Response).
   - Runbook query for Wave D PR description:
     ```sql
     SELECT job_name, started_at, status FROM cron_runs
     WHERE job_name IN ('expired_sweep', 'stuck_submission_reset', 'portal_batch_sweeper')
       AND status = 'running';
     ```
   - Merge gate: query must return 0 rows. If any are running, wait for completion (or pause via the deploy maintenance window) before merging.

5. **`mas_cancelled` writer location.**
   - Resolved: `artifacts/api-server/src/routes/claims.ts:2994` (`POST /claims/:id/mas-action-complete` endpoint at line 2962). The endpoint stamps `masActionCompletedAt: new Date()`; in Wave D it also calls `setClaimDisposition(id, 'mas_cancelled', ctx{source:'mas_cancel_complete'})`. The `masActionCompletedAt` column itself stays (it's a fact stamp the closed-phase reads), per brief §4 "What survives".
   - Single writer (line 2651 sets `masActionCompletedAt: null` and is the un-cancel path; not relevant to mas_cancelled disposition).

---

## §7. Doc handoff

Wave A planning starts from this catalogue. Each wave PR description references the relevant §1-§3 rows it touches and the §5 audit it must pass. The 5 open questions in §6 must be resolved in the Wave A spec PR (no code change in that PR — spec only).

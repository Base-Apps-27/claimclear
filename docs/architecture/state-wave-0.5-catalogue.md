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

---

## §8. Wave A delivery log

### A-PR1 — `lib/observability` registry (shipped 2026-05-06)

New workspace package `@workspace/observability` (`lib/observability/`). Pure infrastructure — no behavior change, no schema change, no call-site rewires. Exports:

- `TransitionActor = {kind:'user', email, name} | {kind:'system', scope}` (resolves §6 Q3 + P4); plus `toLegacyActor` / `fromLegacyActor` for the legacy `{userEmail, userName}` shape used by the existing `auditLogsTable` insert sites.
- `TRANSITION_SOURCES` — 32-value frozen tuple of every `ctx.source` tag (manual_exclude, auto_blank_sibling, conclude_leg, sop_terminal, re_include, leg_classified, verdict_recorded, attest_*, mas_cancel_complete, expired_sweep_cron, etc.). Plus `isTransitionSource` guard.
- `AUDIT_ACTION_NAMES` — 80-value frozen tuple of every audit action string emitted by the api-server today (enumerated by ripgrep over `action: "..."` literals, cross-checked against `lib/vocab/src/audit-action.ts`). Plus `isAuditActionName` guard.
- `SOURCE_TO_ACTION_TABLE` + `actionForSource(source)` + `resolveAuditAction({source, fromState, toState})` — the registry that resolves §6 Q3. Wave D rewires every `auditLogsTable` insert to call `resolveAuditAction(ctx)` instead of hard-coding the action string.

Wired into root `tsconfig.json` references. 11 tests pass; `tsc -b` succeeds; `dist/` populated. Package has no runtime deps (only `@types/node` + `tsx` for tests).

**Out of scope for this PR (deferred to A-PR2/PR3):** the `InvoicePhase` and `ClaimDisposition` enums, the `DISPOSITION_TO_AFFECTED_TRANSITIONS` table, and the read-side derivation helpers. Those land in `lib/vocab` (PR2) and a new `lib/invoice-state` (PR3) so the dependency graph stays one-way (`observability` is leaf; `vocab` depends on nothing; `invoice-state` will depend on both).

**Next:** A-PR2 — extend `lib/vocab` with `claim-disposition.ts`, `invoice-phase.ts`, restructure `lib/leg-state` exports around the new disposition vocabulary while keeping `deriveLegSubStatus` working in parallel (legacy + new coexist until Wave C flips readers).

### A-PR2 — `lib/vocab` disposition + phase enums (shipped 2026-05-06)

Pure additive vocab change. No DB / no behavior. Adds:

- `lib/vocab/src/invoice-phase.ts` — `INVOICE_PHASES` 7-tuple, `InvoicePhase` type, `INVOICE_PHASE` glossary, helpers `invoicePhaseLabel`, `isInvoicePhase`, `comparePhase`, `isPhaseAtLeast` (sequence comparator backs the phase-monotonicity guards Wave B will add to `transitionInvoice`).
- `lib/vocab/src/claim-disposition.ts` — `CLAIM_DISPOSITIONS` 22-tuple, `ClaimDisposition` type, full glossary, plus the contract tables: `VALID_DISPOSITIONS_BY_PHASE` (per-phase valid set per spec §5.1), `TERMINAL_TRIAGE_DISPOSITIONS`, `CONFIRMED_VERDICT_DISPOSITIONS`, `REATTEST_REQUIRING_DISPOSITIONS`. Helper `isDispositionValidForPhase(d, phase)` enforces the cross-row constraint at the type/runtime layer (the SQL trigger from spec §5.2 will use the same predicate).
- Extended `VocabDomain` union with `"invoice_phase"` + `"claim_disposition"`. Re-exports added to `lib/vocab/src/index.ts`. Both new domains land in `GLOSSARY`.

11 new tests in `lib/vocab/src/__tests__/invoice-state-vocab.test.ts` (full vocab suite: 41 pass). `tsc -b lib/observability lib/vocab lib/leg-state` builds clean. No downstream `VocabDomain` consumer outside `lib/vocab` itself, so the union extension is non-breaking.

**Decision recorded:** the existing `lib/vocab/claim-status.ts`, `outcome.ts`, and `leg-sub-status.ts` are kept verbatim through Waves A-D. They become dead code in Wave E (when the underlying columns drop). Operator-facing render code keeps using them until Wave C flips it to the new disposition labels.

**Next:** A-PR3 — read-side derivation library `lib/invoice-state` (new package). Exports: `deriveDispositionFromLegacy(claim)`, `derivePhaseFromLegacy(group)`, plus the parent-of-claim resolver. Pure functions only — no DB writes. Used by Wave C to render the new vocabulary off legacy columns before the dual-write window opens. Depends on `@workspace/vocab` (for the enums) and nothing else — keeps the dependency graph one-way.

### A-PR3 — `lib/invoice-state` derivation helpers (shipped 2026-05-06)

New workspace package `@workspace/invoice-state` implementing the §6 mapping rules from `state-hierarchy-v1.md` as pure read-only functions. No DB writes anywhere; no behavior change to the running app.

- `legacy-shapes.ts` — narrow input types (`LegacyInvoiceGroupShape`, `LegacyClaimShape`) so the derivers don't import the full Drizzle row types. Anything in the api-server can pass `as LegacyInvoiceGroupShape` / `as LegacyClaimShape` without a runtime adapter.
- `derive-phase.ts` — `derivePhaseFromLegacy(group): { phase, closureReason, prePhaseHint }`. Implements §6.1 deterministically: `reattestCompletedAt` set wins (closed/reattested), then `(Resolved, Non-Issue)` → closed/non_issue, `Expired` → closed/expired, `Denied` → closed/denied_by_payor, `(Resolved, Withdrawn)` carries `closureReason` forward (defaults to `cannot_dispute`), `On Hold` → triage, `MAS Eligible + reattestRequired` → awaiting_reattestation, `Awaiting Response` → submitted, `Ready to Review` → response_received, `Generating Email`/`Portal Queued`/`Processed` → ready_to_submit. `prePhaseHint` is reserved for the post-merge backfill (§6.1 last row computes it from audit_logs in Wave B).
- `derive-disposition.ts` — `deriveDispositionFromLegacy(claim, parentPhase): ClaimDisposition`. Implements §6.2 first-match-wins: `duplicate_of_claim_id` always wins; the two-path collapse for non_issue/cannot_dispute is implemented (sopOutcome = non_issue ∪ dropReason = non_issue → `disposed_nonissue`); `includedInDispute=false` with no other signal → `disposed_nonissue` (auto-blank-sibling case from `excludeLegCore`); errorTypeId set with no SOP outcome → `classifying`; falls through to `unclassified`. Phase-aware: `response_received` adds the verdict-or-`awaiting_review` branch, `awaiting_reattestation` resolves the attestation_state queue (`pending`/`queued`/`completed`/`not_required` → `attest_*`), `closed` resolves `final_*` from `closure_reason` then falls back to outcome.

39 tests in `__tests__/derivation.test.ts` covering: every triage `sopOutcome` value, both writer paths for non_issue/cannot_dispute, the 7 phase-mapping rules from §6.1, every Approved + attestation_state combination, and every `closed` closure-reason path. All pass; `tsc -b lib/observability lib/vocab lib/invoice-state` builds clean. Wired into root `tsconfig.json` references; depends on `@workspace/vocab` (workspace:* dep) and nothing else.

**Wave A complete.** The three new packages (`@workspace/observability`, the disposition+phase additions to `@workspace/vocab`, `@workspace/invoice-state`) form the read+write vocabulary that Waves B-D wire into the running code:

- **Wave B** writes the SQL migration that adds `invoice_groups.phase` + `claims.disposition` columns + the `invoice_phase` / `claim_disposition` Postgres enums + the deferrable `validate_disposition_against_phase()` trigger from spec §5.2 + a one-shot backfill that calls `derivePhaseFromLegacy` / `deriveDispositionFromLegacy` from migration JS to populate every existing row. The §B census audit (0 NULLs across 2,405 claims, 8 dispositions) is the precondition; this PR also re-runs the audit post-backfill to confirm 0 invalid (disposition, phase) pairs.
- **Wave C** swaps every reader (UI label code, dashboard aggregates, queue filters, `lifecycle-phase.ts`, `macro-phase.ts`, `derive-leg-sub-status.ts`) to read from the new columns via the `lib/vocab` glossaries. Legacy columns stay populated by Wave D's dual-writer.
- **Wave D** introduces `transitionInvoice` + `setClaimDisposition` + `maybeAdvanceInvoice` in `lib/invoice-state/src/transitions.ts`, rewires every existing writer (the 11 claim writers W1-W11 and 6 invoice writers G1-G6 catalogued in §1-§2 above) through the two new entry points, threads the `@workspace/observability` registry into every audit emit, and adds the `no-direct-status-write` lint rule (P8) once `lib/eslint-plugin-claimclear` is scaffolded.
- **Wave E** drops `claims.{status,outcome,sop_outcome,attestation_state,drop_reason,dropped_at,ready_at,included_in_dispute}` and `invoice_groups.{status,outcome}` plus the `claim_status` and `claim_outcome` Postgres enums per spec §5.3. The dead vocab files (`claim-status.ts`, `outcome.ts`, `leg-sub-status.ts` excluded for now since per-leg surfaces still render leg-sub-status) get pruned in the same PR.

### B-PR1 — schema dual-write + cross-row trigger + backfill (shipped 2026-05-07)

One atomic migration `lib/db/migrations/0034_invoice_phase_and_disposition.sql` plus the matching Drizzle snapshot `lib/db/drizzle/0031_invoice_phase_and_disposition.sql`. Pre-conditions verified against prod by re-running the §B / §C census the morning of: 1,310 invoice groups across 14 (status,outcome,reattest_completed_at?) tuples, 2,406 claims across 33 disposition tuples, R1 deriver returns 0 NULLs.

What ships:
- **Postgres enums.** `invoice_phase` (7 values, byte-identical to `INVOICE_PHASES`) and `claim_disposition` (22 values, byte-identical to `CLAIM_DISPOSITIONS`), both `CREATE TYPE … IF NOT EXISTS` so retries are no-ops.
- **Columns.** `invoice_groups.phase invoice_phase NOT NULL DEFAULT 'triage'`, `invoice_groups.phase_entered_at timestamptz NOT NULL DEFAULT NOW()`, `claims.disposition claim_disposition NOT NULL DEFAULT 'unclassified'`. The defaults make the `ADD COLUMN` non-blocking; the bulk UPDATEs that follow overwrite them with the real backfill values.
- **Closure-reason heal (5 rows).** Pre-backfill `UPDATE invoice_groups SET closure_reason = …` block populates the four/five drift cases the closed-phase deriver needs (denied_by_payor / non_issue / reattested / expired / cannot_dispute) per the census drift notes — no behavior change for non-closed groups.
- **Backfill (atomic).** Two `UPDATE … CASE WHEN … END` statements that execute the §6.1 (`derivePhaseFromLegacy`) and §6.2 (`deriveDispositionFromLegacy`) mappings inside the same `BEGIN/COMMIT` as the column adds. The disposition `UPDATE` joins to `invoice_groups g` so it can branch on the just-populated `g.phase` (matches the TS deriver signature). `phase_entered_at` is intentionally left at the column-default `NOW()` on first backfill — recovering historical entry times needs an audit-log resolver that lives in Wave D's `transitionInvoice` writer.
- **Cross-row validation trigger.** `validate_disposition_against_phase()` PL/pgSQL fn + `claims_disposition_phase_chk` `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED AFTER INSERT OR UPDATE OF disposition, invoice_group_id`. The per-phase `valid_set` `CASE` mirrors `VALID_DISPOSITIONS_BY_PHASE` from `lib/vocab/src/claim-disposition.ts`. Created **after** the bulk backfill so partial-state during the migration cannot trip it; deferrable so a multi-row Wave-D writer that flips a parent phase + every child disposition in one transaction still validates only at COMMIT.
- **Reader indexes.** `invoice_groups_phase_idx`, `claims_disposition_idx`, `claims_invoice_group_disposition_idx (invoice_group_id, disposition)` — sized for Wave C's "claims in phase X by parent group" reader.

Three lockstep invariants enforced in CI:
1. **Postgres enum ↔ TS literal union.** `scripts/src/__tests__/enum-parity.test.ts` deep-equals `invoicePhaseEnum.enumValues` to `[...INVOICE_PHASES]` and `claimDispositionEnum.enumValues` to `[...CLAIM_DISPOSITIONS]`. Drifting one without the other fails the test with a pointer to all four files that must move together.
2. **Drizzle schema ↔ generated SQL.** Existing `schema-drift` workflow runs `drizzle-kit generate` and diffs `lib/db/drizzle/`. Already passing post-Wave-B (snapshot `0031_invoice_phase_and_disposition.sql` is the autogen counterpart to handwritten `0034_…`).
3. **SQL backfill CASE ↔ TS derivers.** `scripts/src/check-invoice-state-derivation.ts` (script entry `pnpm --filter @workspace/scripts run check:invoice-state-derivation`) reads every `(invoice_groups, claims)` row, runs `derivePhaseFromLegacy` / `deriveDispositionFromLegacy` against the legacy columns, and asserts equality with the stored `phase` / `disposition`. Also runs `isDispositionValidForPhase` per row as the runtime mirror of the SQL trigger. Returns nonzero on any mismatch with the first 20 violations printed inline. Wired to be runnable from the `schema-drift` workflow after migrate.

Reversibility: `lib/db/migrations/rollback/0034_invoice_phase_and_disposition.down.sql` drops trigger → fn → indexes → columns → enums and removes the `__schema_migrations` row. Stored outside `migrations/` so the runner (which globs `*.sql` in `migrations/` only) does not auto-apply it.

SSE plumbing (additive, no behavior change yet): `ClaimEvent.disposition?: string|null` and `GroupEvent.phase?: string|null` added to `artifacts/api-server/src/lib/sse.ts`. Older clients ignore the fields; Wave D's `transitionInvoice`/`setClaimDisposition` will populate them.

Validation evidence:
- `pnpm --filter @workspace/db run check-drift` ✅ no drift.
- `pnpm --filter @workspace/scripts run check:invoice-state-derivation` ✅ 0 violations against the local DB (small dev dataset of 9 groups / 4 claims; full prod conformance is the deploy-time gate).
- `pnpm exec tsx --test scripts/src/__tests__/enum-parity.test.ts` ✅ 4/4 pass.
- API server rebuild ✅ (SSE additive type changes are backward-compatible).

**Out of scope (deferred to C/D):** any reader change, any writer change, any audit-log rewire, any UI label flip, any `setClaimDisposition` / `transitionInvoice` writer entry point. Until Wave D ships, `phase`/`disposition` are read-only and frozen at backfill time — they will drift relative to the legacy columns as `(status, outcome, sop_outcome, …)` continue to mutate, and Wave D's first task is therefore a re-backfill from the current legacy state at the moment the writer swap happens.

**Next:** Wave C — flip readers (UI label code, dashboard aggregates, queue filters, `lifecycle-phase.ts`, `macro-phase.ts`, `derive-leg-sub-status.ts`) to read from `phase`/`disposition` via the `lib/vocab` glossaries. Legacy columns stay populated by the existing writers throughout Wave C; Wave D introduces the dual-writer that owns both.

### B-PR2 — heal post-publish conformance drift (shipped 2026-05-07)

Post-publish prod conformance via `executeSql` against the production DB (read-only) flagged 12 rows where `claims.disposition='classifying'` but `invoice_groups.phase ∈ {ready_to_submit, submitted}` — invalid per `VALID_DISPOSITIONS_BY_PHASE` (the cross-row trigger would reject any subsequent UPDATE that re-touched the disposition column). Distribution: 10 under `submitted` (parent status `Awaiting Response`), 2 under `ready_to_submit` (parent status `Portal Queued`, both inside invoice group 15). All 12 rows shared the same legacy shape: `sop_outcome IS NULL`, `attestation_state='not_required'`, `included_in_dispute=true`, `error_type_id IS NOT NULL`, `outcome='Pending'`, `closure_reason IS NULL`.

**Root cause.** `deriveDispositionFromLegacy` in `lib/invoice-state/src/derive-disposition.ts` had explicit branches for `closed`, `awaiting_reattestation`, `reviewed`, and `response_received`, then fell through to `triageDisposition()` for *every* other phase including `submitted` / `ready_to_submit`. `triageDisposition()`'s last fallback returns `"classifying"` whenever `errorTypeId != null` — correct for the triage phase (legs that have an error type but no SOP outcome yet), structurally invalid for the post-submit phases. The 12 rows are real legacy data: claims that had an error type assigned (so `error_type_id IS NOT NULL`) but were never run through the per-leg SOP triage system that would have set `sop_outcome`, then went out as part of a group submission. The Wave B SQL backfill CASE was a faithful mirror of the TS deriver, so it produced the same wrong answer; the cross-row trigger didn't catch the rows because B-PR1 intentionally creates the trigger *after* the bulk UPDATEs (so pre-trigger data can be healed), and the backfill never re-touches those rows so the trigger never fires for them.

**Why dev tests didn't catch it.** Wave A's 39 derivation tests covered `triage`, `closed`, `response_received`, `reviewed`, and `awaiting_reattestation` — but not the cross-phase case "`error_type_id` set on a `submitted`-phase claim with no `sop_outcome`". Dev DB has 9 groups / 4 claims, none of which exercise this shape (`check-invoice-state-derivation.ts` passed locally with 0 violations). The full prod dataset (1,310 / 2,406) was the first place that surfaced the gap, which is why the conformance audit is the deploy-time gate per B-PR1's invariant 3.

**Fix shipped.**

1. **Deriver fix.** `lib/invoice-state/src/derive-disposition.ts`:
   - Factored the SOP / drop_reason precedence out of `triageDisposition()` into a shared helper `sopOrDropReasonDisposition(claim): ClaimDisposition | null` (used by both triage and submit branches).
   - Added a new branch for `parentPhase ∈ {ready_to_submit, submitted}` that calls `submittedDisposition(claim)`: respects an explicit `sopOutcome` / `dropReason` first, returns `disposed_nonissue` for `includedInDispute=false`, then falls back to the submission-path default — `disposed_portal` when `claim.status='Portal Queued'` (the denormalized mirror of the parent group's submission method, the only claim-level signal we have without expanding the deriver signature to take the full parent row), `disposed_email` otherwise (covers Awaiting Response / Generating Email / Processed).
   - Trade-off recorded in code comments: `claim.status` is officially a "denormalized read cache" of parent state; using it for derivation is pragmatic but has a cleanup path — Wave D's writer can promote the submission-method signal to a proper claim column at re-backfill time if needed.

2. **Test coverage.** Six new test cases in `lib/invoice-state/src/__tests__/derivation.test.ts` under a new `submitted/ready_to_submit phases (Wave B+ heal)` describe block: the two prod repros (Portal Queued → disposed_portal, Awaiting Response → disposed_email), SOP-precedence guards (sopOutcome=non_issue still wins on email-mirror, sopOutcome=portal_dispute still wins, sopOutcome=hold maps to blocked), and the `includedInDispute=false` short-circuit. Total derivation tests: 45/45 pass.

3. **Data heal.** `lib/db/migrations/0035_heal_legacy_classifying_dispositions.sql` — a single-statement UPDATE inside `BEGIN/COMMIT` that rewrites `disposition` for every row currently storing `classifying` whose parent group is in `ready_to_submit` or `submitted`, picking `disposed_portal` when `c.status='Portal Queued'` and `disposed_email` otherwise. Idempotent (post-apply re-runs match zero rows). Safe under the live trigger (the new dispositions are valid for both target phases per `VALID_DISPOSITIONS_BY_PHASE`). The bulk UPDATE *will* fire the deferrable trigger at COMMIT and validate every changed row. Rollback: `lib/db/migrations/rollback/0035_….down.sql` reverts the rewritten rows to `classifying` (only useful inside a full B-PR1 rollback flow once the trigger has been dropped).

4. **No schema change**, so no Drizzle snapshot bump and no `__schema_migrations` row beyond what the runner inserts.

Validation evidence:
- `pnpm --filter @workspace/invoice-state test` ✅ 45/45 (was 39/39).
- `pnpm --filter @workspace/db run check-drift` ✅ no drift.
- `node lib/db/scripts/apply-migrations.mjs` ✅ applied 0035 to dev cleanly (zero rows match in dev — expected, dev has none of the legacy shape).
- `pnpm --filter @workspace/scripts exec tsx src/check-invoice-state-derivation.ts` ✅ 0 violations against dev (13 rows; small).
- Pre-existing typecheck failure in `artifacts/mockup-sandbox/src/components/mockups/tour-cards/FullTour.tsx` (`"portal"` literal not in `ActivePage` union) is unrelated to this change — that file lives in the Canvas mockup sandbox, is not deployed, and the failure predates the Wave B branch.

Prod impact when published: `0035` will rewrite exactly 12 rows (10 → `disposed_email`, 2 → `disposed_portal`), bringing prod to 0 conformance violations and unblocking Wave C readers from inheriting invalid disposition values. The healed rows continue to carry their legacy `(status, outcome, sop_outcome, included_in_dispute, error_type_id)` unchanged — only `disposition` moves — so any reader still on the legacy columns sees no behavior change.

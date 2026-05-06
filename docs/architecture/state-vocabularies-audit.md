# State-vocabularies audit — every status, outcome, reason, phase, and stage in the system

**Date:** 2026-05-06.
**Scope:** every pgEnum, every text-column-as-state, every `as const` literal union, every derived state helper that flows through the product. Companion to `docs/architecture/invoice-terminal-state.md` — that document locks down the *terminal* model; this one inventories *every* state vocabulary so the migration plan touches all of them, not just the closure-related ones.

The audit is organised top-down: A. pgEnums, B. text-as-state columns, C. TS literal-union vocabularies, D. derived/computed states, E. critical drift bugs (the things that need fixing regardless of the lock-down work), F. action per item.

---

## A. pgEnums (8 total in prod)

| Enum | Values | Tables that use it | Why it exists | Drift / issues | Action |
|---|---|---|---|---|---|
| `claim_status` | New, Needs Review, Needs Evidence, Processed, Portal Queued, Generating Email, Ready to Review, Awaiting Response, On Hold, MAS Eligible, Expired, **Resolved**, **Denied** | `claims.status`, `invoice_groups.status` | Workflow phase a row is in — drives macro-phase derivation, queue routing, transitions | (1) **Mixes statuses with terminal verdicts**: `Resolved` and `Denied` are operationally outcomes, not workflow phases. `Denied` is also a value in `claim_outcome`. Two prod groups have `status='Denied', outcome='Pending'` — partial transition state. (2) `Processed` is a leg-only status (the parent group never enters it) — split-domain enum. (3) `MAS Eligible` is the queue gate for the off-system MAS re-attestation step. | **Keep enum values as-is in v1** (no schema change). The terminal-state contract makes `status` irrelevant for "is this done?" — `getInvoiceTerminalState` reads outcome+closureReason instead. v2: split into `claim_workflow_status` (sans Resolved/Denied) and `invoice_workflow_status` (sans Processed). |
| `claim_outcome` | Pending, Approved, Denied, **Partially Approved**, **Non-Issue**, Withdrawn | `claims.outcome`, `invoice_groups.outcome` | Terminal verdict on a workflow | (1) `Non-Issue` (TitleCase, hyphen) is the canonical DB value but renders as `Non-issue` (sentence case) — vocab-mediated. (2) `Partially Approved` is a per-group concept; the per-leg verdict storage uses `Partial` instead — see VERDICT_OUTCOMES in §C. (3) Per the lock-down contract, `Denied` and `Non-Issue` are deprecated as terminals — both fold into `Withdrawn` with `closureReason='denied_by_payor'` / `'non_issue'`. | **Keep enum values as-is in v1**; new writes use `Withdrawn + closureReason`. Backfill 5 `Denied/Denied` + 80 `Resolved/Non-Issue` rows in step 7 of Task #512. v2: drop `Denied` and `Non-Issue` from the enum after a deprecation window. |
| `bot_status` | running, idle, error, stopped | `bot_instances.status` | Liveness of each portal-bot worker | None observed — used only on the bots admin page | **Keep as-is**. Out of scope for the terminal-state work; orthogonal domain. |
| `note_type` | manual, email, email_sent, reply_parsed, status_change, outcome_recorded, system, bot | `notes.type` | Routing for the unified notes/timeline feed | None observed; values are used by the timeline renderer. | **Keep as-is**. Orthogonal domain. |
| `outbound_email_kind` | dispute, follow_up, manual, daily_brief | `outbound_emails.kind` | Routing for the SES sender (different templates / metrics) | None observed | **Keep as-is**. Orthogonal domain. |
| `portal_submission_status` | draft, pending, in_progress, submitted, failed, cancelled, dry_run | `portal_submissions.status` | Lifecycle of one portal-bot submission attempt | None observed; state machine is internal to the bot worker. **Naming collision** with `claim_status`'s `Pending` outcome word — inert because contexts are visually distinct (Submissions page vs claim/group chip). | **Keep as-is**. Already tightly scoped. |
| `response_source` | email, portal, manual | `portal_responses.source` | Where the inbound payor response came from | None observed | **Keep as-is**. |
| `response_type` | approval, denial, partial_approval, info_request, acknowledgment, other | `portal_responses.response_type` | AI/keyword classification of an inbound message | (1) Naming collision with `verdict_outcome` — `denial` here is a *message classification* (the email said "no"), not a terminal verdict. (2) Six values vs the verdict picker's three (`Approved/Denied/Partial`); `info_request`, `acknowledgment`, `other` exist only here. | **Keep as-is, document the relationship**. Inbound classification ≠ operator verdict. |

---

## B. Text columns acting as state (no DB CHECK or with weak/drifting CHECK)

Every text column on `claims` / `invoice_groups` whose name implies a state value, with the actual prod distribution:

### B1. `claims.closure_reason` and `invoice_groups.closure_reason`

| Source of truth | `lib/db/src/schema/claims.ts:16` — `["denied_by_payor","cannot_dispute","non_issue"]` |
|---|---|
| Re-declared in | `lib/vocab/src/closure-reason.ts:16` (same 3 values, with labels), `lib/closure-options/src/index.ts` (`CLOSURE_REASON_BANNER` keys), `closure-validation.ts:17` (z.enum) |
| DB constraint | **None.** Type is `text`, not enum, no CHECK |
| Prod values on `claims` | `denied_by_payor`×6, `cannot_dispute`×2, **`accepted_loss`×1**, **`not_contestable`×1** |
| Prod values on `invoice_groups` | `non_issue`×80, `denied_by_payor`×5 |
| Drift | **CRITICAL — DRIFT BUG #1**. Two prod claim rows hold values that exist in *no* canonical list (`accepted_loss`, `not_contestable`). They are pre-Task-#160 legacy values. |
| Action | (a) Backfill the 2 drift rows: `accepted_loss → denied_by_payor`, `not_contestable → cannot_dispute`. (b) Add a DB CHECK `closure_reason IS NULL OR closure_reason IN (...)`. (c) The lock-down contract adds `'expired'` as a 4th value (also additive, also via CHECK in the same migration). (d) The 3-place re-declaration collapses to a single re-export per the contract §5. |

### B2. `claims.closure_review_state` and `invoice_groups.closure_review_state`

| Source of truth | `lib/db/src/schema/claims.ts:30` — `["pending","addressed"]` |
|---|---|
| Re-declared in | nowhere |
| DB constraint | None |
| Prod values | `pending`×7 (claims), `pending`×5 (groups). No `addressed` rows yet. |
| Drift | None. The schema has it, the constant exists, only one writer. |
| Action | **Keep**, optionally add CHECK in v2 cleanup. |

### B3. `claims.attestation_state`

| Source of truth | `lib/db/src/schema/claims.ts:41` — `["not_required","pending","queued","completed"]` |
|---|---|
| DB constraint | None |
| Prod values | `not_required`×2383 (default), `completed`×14, `queued`×8 |
| Drift | None. Per-leg attestation tracker that was largely superseded by the per-group `reattestRequired/reattestCompletedAt` columns. **Only 22 non-default rows** in prod. |
| Action | **Mark deprecated** in the contract (already done in §8.7). The per-group tracker is the live one. v2 deletes the column. |

### B4. `claims.mas_action_required`

| Source of truth | `lib/db/src/enums/leg-state.ts:37` — `["cancel","none"]` |
|---|---|
| DB constraint | `claims_mas_action_required_chk` (line 205 of claims.ts) |
| Prod values | `(null)`×2373, `none`×23, `cancel`×9 |
| Drift | None. CHECK enforces it. Derived by `deriveMasActionRequired` from sopOutcome + verdict. |
| Action | **Keep as-is**. Already correctly modelled. |

### B5. `claims.sop_outcome`

| Source of truth | `lib/db/src/enums/leg-state.ts:10` — `["portal_dispute","dispute","hold","cannot_dispute","non_issue"]` |
|---|---|
| DB constraint | `claims_sop_outcome_chk` (line 197 of claims.ts) |
| Prod values | `(null)`×1419, `non_issue`×681, `portal_dispute`×298, `dispute`×3, `hold`×3, `cannot_dispute`×1 |
| Drift | None. The `dispute` value is barely used (3 rows) — it's the legacy "email channel" carve-out before everything became `portal_dispute`. `outcomeRole()` already collapses both to `include`. |
| Action | **Keep as-is**. The 3 `dispute` rows can stay; the consumer-side `outcomeRole()` already maps them correctly. |

### B6. `claims.drop_reason`

| Source of truth | `lib/db/src/enums/leg-state.ts:22` — `["cannot_dispute","non_issue"]` |
|---|---|
| DB constraint | `claims_drop_reason_chk` (line 201 of claims.ts) |
| Prod values | All 2403 rows are `(null)` — **the column is unused in prod data**. |
| Drift | None data-wise. Conceptually it's a leg-scoped subset of CLOSURE_REASONS — same 2-value vocabulary. |
| Action | **Keep — the column has writers** in `sop-advance-player.tsx`, `claim-detail-v2.tsx`, `terminals/hold-terminal.tsx` and the `2026-05-per-leg-state-backfill.ts` migration. Just no rows have triggered it yet. v2: consider folding into `closure_reason` since they share vocabulary. |

### B7. `claims.hold_reason` and `invoice_groups.hold_reason`

| Source of truth | `lib/leg-state/src/index.ts:45` — `LEG_HOLD_REASONS = ["evidence_pending","awaiting_external_party","awaiting_member_response","awaiting_internal_review","other"]` |
|---|---|
| Re-declared in | `lib/vocab/src/hold-reason.ts:5` (same 5 values, with labels). The DB schema comment (line 134-137 of claims.ts) explicitly says "constrained at the application layer to LEG_HOLD_REASONS. No CHECK constraint added." |
| DB constraint | **None — explicitly omitted** so the migration could normalise legacy synonyms to `'other'` without rejecting them. |
| Prod values | (claims) `(null)`×2399, plus 6 free-text values like `"Ineligible Enrollee"`, `"Invoice combined with 1855140030. Attested already."`, `"completed on 04/02/2026"`, `"No GPS Data, Not Done"` — **none of which match the canonical 5**. (groups) `(null)`×1309 + `"MAS needs to fix date of service in the portal."`×1. |
| Drift | **DRIFT BUG #2.** The "no CHECK so the backfill can normalise" rationale is correct, but the backfill script (`scripts/src/migrations/2026-05-per-leg-state-backfill.ts:108`) only runs when called manually — the 6 prod rows show it never executed against current data. Today, `hold_reason` is functionally a free-text comment field, not a state column. |
| Action | (a) **Run the existing normalisation backfill in prod** to fold the 6 free-text rows into `'other'` + a note. (b) Add the DB CHECK afterward. (c) Both vocab redeclarations collapse to one re-export. |

### B8. `invoice_groups.payor_denial_reason`

| Source of truth | `lib/payor-denial-reasons/src/index.ts:30` — 7 codes (payor_rejected_gps, payor_rejected_signature, payor_reclassified_error, payor_cited_benefit_rule, payor_cited_timely_filing, payor_no_clear_reason, payor_other) |
|---|---|
| DB constraint | None (free-form text by design; the OpenAPI enum is the API-level enforcer) |
| Prod values | All 1310 rows are `(null)` — feature is wired but no operator has used it. |
| Drift | None data-wise. Has its own dedicated `assertNeverPayorDenialReason` exhaustiveness helper. |
| Action | **Keep as-is**. Cleanly modelled, single source of truth, just no traffic yet. Contract doc §1 must call out that this is **NOT** a closure reason — the column reads as "why did the payor reject" but does not close the group. |

### B9. `claims.closure_category` / `closure_root_cause` / `closure_accountability_tags` / `closure_drivers` / `closure_dispatchers`

These are the structured-detail fields gated by `closure-validation.ts` when `closureReason ∈ {cannot_dispute, non_issue, denied_by_payor}`. Source of truth: `lib/closure-options/src/index.ts` (CLOSURE_CATEGORIES + ROOT_CAUSES_BY_CATEGORY tree). Mostly orthogonal to the terminal-state work — they describe *why*, not *whether*. **Keep**, but the validation matrix needs updating per drift bug #3 below.

### B10. `bot_instances.session_valid` / `portal_responses.processed` / `portal_responses.auto_linked`

Boolean state flags on satellite tables. Each has exactly one consumer; none have known drift. **Keep all as-is.**

### B11. `invoice_groups.reattestRequired` / `reattestCompletedAt`

The per-group attestation tracker that *is* the live one (vs the deprecated per-leg `attestation_state`). **Keep — it's the live source of truth referenced by the lock-down contract §3 / §4.**

---

## C. TypeScript literal-union vocabularies (~25 arrays, in 4 packages)

### C1. `lib/vocab` — the supposed "labels-only" layer

| Symbol | File | What it claims to be | Drift |
|---|---|---|---|
| `CLAIM_STATUSES` | `claim-status.ts:23` | Re-declaration of the schema enum | **DRIFT BUG #4.** Has 13 values matching the pgEnum, but in a **different order**. No automated check enforces parity. |
| `OUTCOMES` | `outcome.ts:14` | Re-declaration of `claim_outcome` enum | Has the same 6 values, parity is implicit only. |
| `CLOSURE_REASONS` | `closure-reason.ts:16` | Re-declaration of `lib/db/src/schema/claims.ts:16` | Same 3 values; parity is implicit. The lock-down contract adds a 4th (`expired`) — must be added here too. |
| `LEG_SUB_STATUSES` | `leg-sub-status.ts:22` | Re-declaration of `lib/leg-state/src/per-leg-sub-status.ts:12` | Same 8 values; parity is implicit only. |
| `VERDICT_OUTCOMES` | `verdict-outcome.ts:7` | **Completely different vocabulary** from `lib/db/src/enums/leg-state.ts:VERDICT_OUTCOMES` — **DRIFT BUG #5 (the worst one).** This file declares `["approved","denied","partially_approved","needs_more_info","no_decision"]` (lowercase, 5 values, mappable to `response_type`); the DB-side declares `["Approved","Denied","Partial"]` (TitleCase, 3 values, what's actually in `claim_verdict.outcome`). Same exported name. **Nothing in production code imports `lib/vocab`'s version** — it's effectively dead documentation. |
| `LEG_CONCLUSIONS` | `leg-conclusion.ts:18` | Per-leg conclusion vocabulary `["sop","non_issue","cannot_dispute"]` | None. Used only on Queue Panel A's LegConclusionRow. |
| `HOLD_REASONS` | `hold-reason.ts:5` | Re-declaration of `LEG_HOLD_REASONS` from `lib/leg-state` | Same 5 values, parity is implicit. |
| `SUBMISSION_STAGES` | `submission-stage.ts:16` | Re-declaration of `portal_submission_status` pgEnum | Same 8 values minus `pending` ordering — parity is implicit. |
| `FORBIDDEN_LITERALS` | `forbidden-literals.ts:11` | List of strings that must NOT appear in artifact source | Lint-only; correct. |

### C2. `lib/db/src/enums/leg-state.ts` — "pinned" leg vocabulary

| Symbol | Values | Drift |
|---|---|---|
| `SOP_OUTCOMES` | `["portal_dispute","dispute","hold","cannot_dispute","non_issue"]` | None — matches the DB CHECK. |
| `LEG_DROP_REASONS` | `["cannot_dispute","non_issue"]` | None — matches the DB CHECK. |
| `LEG_EXCLUSION_REASONS` | `["clean_leg","out_of_scope","duplicate","non_issue","cannot_dispute","other"]` | Used only by the per-leg-state-backfill migration. Not a stored column; lives only in the migration script. |
| `MAS_ACTION_REQUIRED` | `["cancel","none"]` | None. |
| `VERDICT_SOURCE` | `["ai_suggested","operator_confirmed","operator_draft"]` | None — matches the `claim_verdict_source_chk`. |
| `VERDICT_OUTCOMES` | `["Approved","Denied","Partial"]` | None *internally* — matches the `claim_verdict_outcome_chk`. **Externally drifts catastrophically with `lib/vocab/src/verdict-outcome.ts` — see DRIFT BUG #5.** |

### C3. `lib/leg-state` — derived projection vocabulary

| Symbol | Values | Drift |
|---|---|---|
| `LEG_SUB_STATUSES` | `["excluded","duplicate","needs_classification","investigating","blocked","ready","dropped","frozen"]` | None — pure projection, never stored. Re-exported by `lib/db/src/enums/leg-state.ts` and re-exported again by `lib/vocab/src/leg-sub-status.ts`. |
| `LEG_HOLD_REASONS` | `["evidence_pending","awaiting_external_party","awaiting_member_response","awaiting_internal_review","other"]` | None internally; B7 covers the data drift. |
| `OUTCOME_ROLES` | `["include","hold","cannot_dispute","non_issue","internal","duplicate","none"]` | None — pure projection from `sopOutcome` + `duplicateOfClaimId`. |
| `RESOLVED_LEG_SUB_STATUSES` | (subset of LEG_SUB_STATUSES) | None — single consumer is `buildLegResolvedIndex`. |

### C4. `lib/closure-options` — closure intake structured detail

| Symbol | Drift |
|---|---|
| `CLOSURE_REASON_BANNER` | Same 3 keys as `CLOSURE_REASONS`. Has its own labels and Tailwind classes; vocab tests assert label parity with `@workspace/vocab`. The lock-down contract's `expired` reason needs a banner here too. |
| `CLOSURE_CATEGORIES` (12 entries) | Used only by the closure intake dialog; orthogonal to terminal state. |
| `ROOT_CAUSES_BY_CATEGORY` (per-category trees) | Same. |
| `CLOSURE_ACCOUNTABILITY_TAGS` | Re-declared in `lib/db/src/schema/claims.ts:25` with the same 7 values. Parity implicit. |

### C5. `lib/payor-denial-reasons` — single-purpose package

The cleanest one in the repo. Self-contained, exhaustiveness helper, OpenAPI parity test. **Keep as the model for what every other vocab package should look like.**

### C6. `artifacts/api-server/src/lib/*` — server-side derived constants

| Symbol | File | Purpose | Drift |
|---|---|---|---|
| `OPEN_STATUSES` | `brief-personalization.ts:16` | Subset for the daily-brief query | Subset of `claim_status` — implicit parity. |
| `YESTERDAY_*_ACTIONS` | `brief-personalization.ts:37-40` | Audit-log action filters | Implicit; subset of the audit action enum. |
| `GROUP_EXPIRABLE_STATUSES` | `group-transitions.ts:74` | Pre-submit statuses the nightly Expired sweep can stamp | Subset of `claim_status` — implicit parity. |
| `SYSTEM_CONTROLLED_GROUP_STATUSES` | `group-transitions.ts:81` | Statuses operators can't set manually | Same. **Mirrored in `claim-transitions.ts:84`** — third place that lists `["Portal Queued","Generating Email","Ready to Review"]`. |
| `CLAIM_EXPIRABLE_STATUSES` | `claim-transitions.ts:76` | Same as GROUP_EXPIRABLE plus `Processed` | Same as above. |
| `VALID_GROUP_STATUS_TRANSITIONS` | `group-transitions.ts:28` | The state-machine adjacency map | Sole source of truth; not redeclared. |
| `VALID_GROUP_OUTCOME_BY_STATUS` | `group-transitions.ts:83` | Outcome envelope per status | Sole source of truth. |
| `VALID_MANUAL_STATUS_TRANSITIONS` | `claim-transitions.ts:47` | Same for claims | **Different from group's** because of the `Processed` row — correctly so. |
| `VALID_OUTCOME_BY_STATUS` | `claim-transitions.ts:86` | Same for claims | Adds `Processed` row. |
| `CLOSURE_DETAIL_FIELDS` | `closure-validation.ts:100` | Field names that trigger structured-closure validation | Sole source of truth. |
| `GROUP_SERVICE_DATE_REASONS` | `group-no-date-reason.ts:39` | Why a group has no service date | Orthogonal domain. |

### C7. `artifacts/claimclear/src/lib/*` — client-side derivations

| Symbol | File | Purpose | Drift |
|---|---|---|---|
| `STATUSES_BY_PHASE` | `lifecycle-phase.ts:28` | **Client copy of macro-phase map** | **DRIFT BUG #6.** This file maps statuses to phases independently from the server's `artifacts/api-server/src/lib/macro-phase.ts:STATUSES_BY_PHASE`. They are out of sync TODAY: client lists `Processed` in `pre-submit`, server doesn't list it at all (it falls through to `pre-submit` by default). Client lists `"Withdrawn"` in `closed`, server used to (we just removed it). No cross-package test. |
| `PHASE_ORDER` | `lifecycle-phase.ts:107` | Tie-breaker for group rollup | None; client-only. |
| `LIFECYCLE_TABS` | `lifecycle-phase.ts:157` | Tab labels for the list pages | Derived from `STATUSES_BY_PHASE`; inherits its drift. |
| `ENGAGEMENT_NEEDED_PHASES` | `lifecycle-phase.ts:84` | The "needs my action" filter | Derived from `STATUSES_BY_PHASE`. |
| `SUCCESS_VERBS` | `success-verb.ts:13` | Toast copy variants | Cosmetic; orthogonal. |

---

## D. Derived / computed states (no underlying column)

| Helper | Where | Reads | Returns | Notes |
|---|---|---|---|---|
| `getMacroPhase(status)` | `api-server/src/lib/macro-phase.ts:28` | status | one of `MacroPhase` | Server side |
| `getGroupMacroPhase(group)` | same:36 | status, reattestRequired, reattestCompletedAt | `MacroPhase` | Server side; the lock-down contract §7 amends it to consult `getInvoiceTerminalState` first |
| `getLifecyclePhase(status)` | `claimclear/src/lib/lifecycle-phase.ts:48` | status | `LifecyclePhase` | Client mirror — drift #6 |
| `getGroupLifecyclePhase(groupStatus, legs)` | same:121 | status + per-leg statuses | `LifecyclePhase` | Client side; rolls up legs |
| `deriveLegSubStatus(leg)` | `lib/leg-state/src/per-leg-sub-status.ts:51` | per-leg cols | `LegSubStatus` | The model citizen — single source, dependency-free, used by both server and client |
| `outcomeRole(leg)` | `lib/leg-state/src/index.ts:125` | sopOutcome, duplicateOfClaimId | `OutcomeRole` | Same — single source, well-modelled |
| `deriveMasActionRequired(input)` | `api-server/src/lib/mas-derivations.ts:22` | sopOutcome, latestVerdictOutcome | `'cancel'\|'none'\|null` | Server side; clean |
| `computeThreadStatus(thread)` | `api-server/src/lib/email-thread.ts:235` | (responses) | thread state label | Orthogonal domain |
| `deriveVerdictMix(rides)` | `claimclear/src/lib/whats-next-derivation.ts:94` | per-leg verdicts | mix bucket | Reads `claim_verdict.outcome` (TitleCase Approved/Denied/Partial) |
| `deriveInvoiceDisputeOutlook(input)` | same:273 | rollup + verdicts | outlook label | Same |
| `deriveLifecycleTab(filterStatuses)` | `lifecycle-phase.ts:212` | URL params | `LifecycleTabKey` | Client-only |
| `deriveUrgentTodayWhy(input)` | `urgent-today-why.ts:39` | dashboard counters | `Hidden|Shown` | Orthogonal domain |
| `toneForStatus(status)` | `components/cohesion/tone.ts:42` | status | `Tone` (color) | Cosmetic; reads claim_status |
| **MISSING:** `getInvoiceTerminalState(group)` | (to be created) | per lock-down contract §3 | one of 7 | The single helper this whole project hinges on |

---

## E. Critical drift bugs (numbered, with severity)

| # | Severity | Bug | Where | Fix |
|---|---|---|---|---|
| 1 | **HIGH** | `claims.closure_reason` has 2 prod rows with values that exist in NO canonical list (`accepted_loss`×1, `not_contestable`×1) | DB | Backfill to `denied_by_payor` / `cannot_dispute`. Add CHECK. |
| 2 | **HIGH** | `closure-validation.ts:42-44` requires `outcome=Denied → closureReason=denied_by_payor`, but the lock-down contract collapses `Denied` into `Withdrawn`. Validation matrix is incompatible with the contract. | `artifacts/api-server/src/lib/closure-validation.ts` | Update validator: `Withdrawn` accepts any of the 4 sub-reasons; `Denied` becomes a deprecated path that maps to `Withdrawn + denied_by_payor` server-side. |
| 3 | **HIGH** | `closure-validation.ts` doesn't allow the `expired` closure_reason that the lock-down contract introduced | same file | Add `'expired'` to `CLOSURE_REASONS` in `lib/db/src/schema/claims.ts`, propagate. |
| 4 | **MEDIUM** | `lib/vocab` arrays (`CLAIM_STATUSES`, `OUTCOMES`, `CLOSURE_REASONS`, `LEG_SUB_STATUSES`, `HOLD_REASONS`, `SUBMISSION_STAGES`) are re-declarations of the source enum, parity enforced only by hand-eyeball | `lib/vocab/src/*.ts` | Convert each to a `re-export` of the source array; add a vitest case that asserts label-map keys = source array. |
| 5 | **CRITICAL** | `VERDICT_OUTCOMES` exists in TWO places with COMPLETELY DIFFERENT vocabularies under the same name. `lib/db/src/enums/leg-state.ts` declares `["Approved","Denied","Partial"]` (matches DB CHECK + actual `claim_verdict.outcome` rows in prod); `lib/vocab/src/verdict-outcome.ts` declares `["approved","denied","partially_approved","needs_more_info","no_decision"]`. The vocab version is **dead code** (no production importer found). | `lib/vocab/src/verdict-outcome.ts` | **Delete** `lib/vocab/src/verdict-outcome.ts` entirely; re-export the DB-side version with a label map. |
| 6 | **MEDIUM** | Server `macro-phase.ts:STATUSES_BY_PHASE` and client `lifecycle-phase.ts:STATUSES_BY_PHASE` are independent copies that drift. Today: server omits `Processed`, client includes it in pre-submit; client still has `"Withdrawn"` in closed (unreachable status — same bug we just fixed server-side). | `artifacts/claimclear/src/lib/lifecycle-phase.ts:44` | (a) Remove `"Withdrawn"` from client `closed`. (b) Move `STATUSES_BY_PHASE` and the helpers into a new dependency-free `lib/macro-phase` package re-exported by both server and client. |
| 7 | **MEDIUM** | `claims.hold_reason` has 6 prod rows of free-text values that don't match any canonical hold-reason vocabulary; the `2026-05-per-leg-state-backfill.ts` normaliser was never applied to current data. Comment in claims.ts:135 explicitly says "no CHECK so backfill can normalise" — but the backfill never ran in prod against these rows. | DB + `claims.holdReason` writers | Run the existing normaliser on prod, then add the CHECK. |
| 8 | **LOW** | `claim_status` enum mixes workflow phases (`New`, `Awaiting Response`) with terminal verdicts (`Resolved`, `Denied`). `Denied` is also a value in `claim_outcome`. Two prod groups have `status='Denied', outcome='Pending'` — partial transition state with no closure metadata. | DB | (a) Detect via lock-down contract's `getInvoiceTerminalState` — these surface as "open" with mismatched columns. (b) Backfill to `Resolved + Withdrawn + closureReason='denied_by_payor'`. (c) v2: drop `Resolved`/`Denied` from the status enum. |
| 9 | **LOW** | `SYSTEM_CONTROLLED_*_STATUSES` is declared in TWO places with identical values: `group-transitions.ts:81` and `claim-transitions.ts:84` | server | Move to a shared module, import from both. |
| 10 | **LOW** | `claims.attestation_state` has 22 non-default rows but the per-group `reattestCompletedAt` is the live tracker. Per-leg attestation state was never the contract. | `lib/db/src/schema/claims.ts:163` | Mark deprecated in contract (already done §8.7). v2 deletes the column. |

---

## F. Per-item action — single-pass, no compatibility shims

> **Execution model (locked, 2026-05-06).** We control the entire stack. Every change below lands as **(a) drizzle migration in `lib/db/drizzle/`** + **(b) one-shot backfill in `scripts/src/migrations/YYYY-MM-*-backfill.ts`** wired into `scripts/package.json`, run **manually with `--apply` after explicit user approval** + **(c) code change** in the same PR. Three hard rules:
>
> 1. **No boot-time scripts**, ever. Task #74 burned us. The reconcile-on-startup branch in `index.ts` is gone and stays gone. Backfills run once via `pnpm --filter @workspace/scripts run backfill:<name>`, then the file is left in the repo as a historical record (mirrors the existing `2026-05-*` siblings) but the entry-point script is never invoked again.
> 2. **No deprecation windows**: schema + data + code in one pass. We don't keep dead enum values "for compatibility" — once the backfill applies and the code references are gone, the value is dropped from the enum in the next migration in the same PR.
> 3. **Schema drift CHECK** runs in CI (`schema-drift` workflow already exists). Every state-bearing text column gets either a DB CHECK or a promotion to pgEnum — no exceptions.

| Vocabulary / column | Single-pass action | Migration / script / code split |
|---|---|---|
| `claim_status` enum | **Split.** Drop `Resolved`/`Denied` (terminal verdicts, not phases). Drop `Processed` from the group-side usage. | Drizzle: rename current enum → `claim_workflow_status` w/ 11 values; add `invoice_workflow_status` w/ 10 values (no `Processed`). Script: backfill 2 stuck `Denied/Pending` groups → `Resolved + Withdrawn + denied_by_payor`. Code: `claimsTable.status` → claim enum; `invoiceGroupsTable.status` → invoice enum. |
| `claim_outcome` enum | **Shrink.** Drop `Denied` and `Non-Issue`. | Drizzle: new enum w/ 4 values (`Pending`, `Approved`, `Partially Approved`, `Withdrawn`). Script: backfill 5 `Denied/Denied` + 80 `Non-Issue` rows → `Withdrawn` + appropriate `closure_reason`. Code: lock-down contract §3/§6. |
| `claims.closure_reason` (text) | **Promote to pgEnum.** Add `expired`. Backfill 2 drift rows. | Drizzle: create `closure_reason` enum w/ 4 values; alter column. Script: `accepted_loss → denied_by_payor`, `not_contestable → cannot_dispute`. Code: collapse 3-place re-declaration → single re-export. |
| `invoice_groups.closure_reason` (text) | **Promote to pgEnum** (same enum as above). Backfill from contract §6 mapping table. | Same migration; script handles both tables in one transaction. |
| `claims.attestation_state` (text) | **Drop column.** Per-group `reattestCompletedAt` is the live tracker; per-leg version was never the contract. 22 non-default rows are noise. | Drizzle: `DROP COLUMN`. Script: none (just verify counts). Code: remove all 4 references in `lib/db` and `api-server`. |
| `claims.hold_reason` (text) | **Normalise + CHECK.** | Script: run existing `2026-05-per-leg-state-backfill.ts` on prod; collapse 6 free-text rows to `'other'` with the original text moved to a system note. Drizzle: add CHECK `hold_reason IS NULL OR hold_reason IN (...)`. Same for groups. |
| `invoice_groups.hold_reason` (text) | Same as above. | Same migration. |
| `claims.sop_outcome` (text) | **Fold `dispute` → `portal_dispute`.** 3 prod rows. | Script: 3-row `UPDATE`. Drizzle: tighten existing CHECK to drop `'dispute'`. Code: remove the `=== 'dispute'` branches in `outcomeRole`, `deriveLegSubStatus` (they currently treat both identically — the merge is cosmetic but removes a long-standing footgun). |
| `claims.drop_reason` (text) | **Fold into `closure_reason`.** 0 prod rows; same vocabulary; column was a planning artifact. | Drizzle: `DROP COLUMN`. Script: none. Code: remove from schema + the 4 writers in `sop-advance-player.tsx`, `claim-detail-v2.tsx`, `terminals/hold-terminal.tsx`, `2026-05-per-leg-state-backfill.ts`. |
| `claims.mas_action_required` (text) | **Promote to pgEnum.** | Drizzle: create `mas_action` enum (`cancel`, `none`); alter column; drop the existing CHECK (now redundant). |
| `claims.closure_review_state` (text) | **Promote to pgEnum.** | Drizzle: create `closure_review_state` enum (`pending`, `addressed`); alter column. Same for groups. |
| `invoice_groups.closure_review_state` (text) | Same. | Same migration. |
| `invoice_groups.payor_denial_reason` (text) | **Promote to pgEnum.** | Drizzle: create `payor_denial_reason` enum w/ 7 codes; alter column. Code: `lib/payor-denial-reasons` re-exports the enum-derived type instead of declaring its own union (parity becomes structural). |
| `lib/vocab` arrays (`CLAIM_STATUSES`, `OUTCOMES`, `CLOSURE_REASONS`, `LEG_SUB_STATUSES`, `HOLD_REASONS`, `SUBMISSION_STAGES`) | **Replace with re-exports** of the source enum's `.enumValues`. Label maps stay. | Code-only. Add a vitest case per file: `expect(LABEL_MAP keys).toEqual(SOURCE_ENUM.enumValues)`. Wire into `pnpm check:vocab-drift`. |
| `lib/vocab/src/verdict-outcome.ts` | **Delete file.** Dead code with a misleading name (drift bug #5). | Code-only. Replace with a stub re-export of `lib/db/src/enums/leg-state.ts:VERDICT_OUTCOMES` (TitleCase, 3 values) plus a label map for those 3. |
| `lib/closure-options/CLOSURE_REASON_BANNER` | **Add `expired` banner entry.** | Code-only. Closure intake dialog gains the new option automatically. |
| `closure-validation.ts` matrix | **Rewrite** for the lock-down contract: `Withdrawn` accepts any of the 4 sub-reasons (`cannot_dispute`, `non_issue`, `denied_by_payor`, `expired`); the `Denied` and `Non-Issue` outcome cases are removed entirely. | Code-only. Server transitions reject the deprecated outcomes after the backfill clears them. |
| Server `macro-phase.ts` + Client `lifecycle-phase.ts` | **Collapse into one shared package** `lib/macro-phase`. Single `STATUSES_BY_PHASE`, single `getMacroPhase`, single `LIFECYCLE_TABS`. Remove the unreachable `Withdrawn`-in-closed branch (already done server-side, still in client). | Code-only. New package with re-exports. Both `api-server` and `claimclear` consume it. Delete the parallel client copy. |
| `getInvoiceTerminalState` | **Create** per contract §3. Re-export via `@workspace/leg-state` for the client. | Code-only. New file `lib/leg-state/src/invoice-terminal-state.ts` (moved out of `api-server` so client can import). |
| `SYSTEM_CONTROLLED_*_STATUSES` | **One shared module.** | Move to `lib/leg-state/src/system-controlled.ts`; both transition files import from there. |
| `bot_status`, `note_type`, `outbound_email_kind`, `portal_submission_status`, `response_source`, `response_type`, `claim_verdict.source`, `claim_verdict.outcome`, `closure-options` trees, `LEG_SUB_STATUSES`, `OUTCOME_ROLES`, `SOP_OUTCOMES` (post-fold), `LEG_DROP_REASONS`, `MAS_ACTION_REQUIRED` | **No change.** Orthogonal, well-scoped, no drift. | — |

---

## G. Migration ordering (single PR per group, ordered by dependency)

The dependencies between the items above force a specific order. Each group below = one PR = one drizzle migration + one or zero scripts + the code changes in the same commit. The user runs the script with `--apply` after code review of the PR; nothing waits for a deprecation window.

**Group 1 — Pre-requisite drift fixes (independent, can ship first):**
- `closure_reason` 2-row backfill + add `expired` to vocab + promote to pgEnum.
- Delete `lib/vocab/src/verdict-outcome.ts`.
- Remove `Withdrawn` from client `lifecycle-phase.ts:44`.
- Promote `mas_action_required`, `closure_review_state`, `payor_denial_reason` to pgEnums.

**Group 2 — Shared infrastructure (no data changes):**
- Create `lib/macro-phase` (collapse server + client copies).
- Create `lib/leg-state/src/invoice-terminal-state.ts` with `getInvoiceTerminalState`.
- Create `lib/leg-state/src/system-controlled.ts`.
- `lib/vocab` re-export refactor + vitest parity tests.

**Group 3 — Terminal-state contract enforcement (the original §F of the lock-down contract):**
- Rewrite `closure-validation.ts` matrix.
- Replace the four parallel terminality predicates with `getInvoiceTerminalState`.
- Wire Re-attest CTA to the helper (closes #302).
- One-shot terminal-state backfill (76 Expired + 80 Resolved/Non-Issue + 5 Denied groups) — depends on Group 1's `expired` value being live.

**Group 4 — Schema cleanup (only after Groups 1–3 are merged + script ran):**
- Shrink `claim_outcome` enum (drop `Denied`, `Non-Issue`).
- Split `claim_status` into per-table enums (drop `Resolved`/`Denied` from both, drop `Processed` from group enum).
- Drop `claims.attestation_state` column.
- Drop `claims.drop_reason` column.
- Fold `sop_outcome.dispute` → `portal_dispute`, tighten CHECK.
- Normalise `hold_reason` free-text + add CHECK.

**No phase 5 / no v2.** Once Group 4 lands, the audit's actions are complete. Future state vocabulary changes follow the same execution model: schema + script + code in one PR, no boot-time work, no deprecation windows.

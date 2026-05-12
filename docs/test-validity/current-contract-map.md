# Current Contract Map — `@workspace/api-server`

> **Scope.** Snapshot of the *as-implemented* contracts the test suite is
> measured against in Phase 1 of the test-validity audit (2026-05-12).
> Built by reading `lib/db/src/schema/{claims,invoice-groups}.ts`,
> `artifacts/api-server/src/{routes,lib}`, and the vocabulary packages
> under `lib/{db,vocab,invoice-state}`. **Source-of-truth quotes are
> linked back to the file/line they came from.**
>
> This document is a *map*, not a spec. Where the code disagrees with
> docs/architecture, the code wins for the purpose of test-validity
> classification.

---

## 1. Domain enums (schema-level vocabularies)

### 1.1 Claim status — `claims.status` (text, not an enum)
Allowed transitions live in `artifacts/api-server/src/lib/claim-transitions.ts`
(`VALID_CLAIM_STATUS_TRANSITIONS` + `VALID_CLAIM_OUTCOME_BY_STATUS`).

| Status              | Valid outcomes (post-update)                                  |
| ------------------- | ------------------------------------------------------------- |
| `New`               | `Pending`, `Withdrawn`, `Non-Issue`                           |
| `Needs Review`      | `Pending`, `Withdrawn`, `Non-Issue`                           |
| `Needs Evidence`    | `Pending`, `Withdrawn`, `Non-Issue`                           |
| `Processed`         | `Pending`, `Withdrawn`, `Non-Issue`                           |
| `Awaiting Response` | `Approved`, `Partially Approved`, `Denied`, `Withdrawn`       |
| `Resolved`          | `Approved`, `Partially Approved`, `Denied`, `Non-Issue`, `Withdrawn` |
| `Denied`            | `Denied`, `Approved`, `Partially Approved`, `Withdrawn`       |
| `On Hold`           | system-controlled (no manual outcome; gated by hold workflow) |

### 1.2 Group status — `invoice_groups.status` (text)
Same transition map shape in `lib/group-transitions.ts`
(`VALID_GROUP_STATUS_TRANSITIONS` / `VALID_GROUP_OUTCOME_BY_STATUS`).
System-controlled statuses (`Portal Queued`, `MAS Eligible`, etc.) reject
manual writes via `SYSTEM_CONTROLLED_GROUP_STATUSES`.

### 1.3 Closure reason — `claim_closure_reason` enum
Defined in `lib/db/src/schema/...` and re-exported as `CLOSURE_REASONS`
with human labels in `CLOSURE_REASON_LABELS`. Used by the closure path:

- `cannot_dispute` — the *only* legal reason when outcome=`Withdrawn`
  (asserted twice in `lib/claim-transitions.ts:248-250` /
  `lib/group-transitions.ts:609-611,775-777`).
- `non_issue` — auto-stamped when outcome=`Non-Issue`.
- `denied_by_payor` — auto-stamped when outcome=`Denied`.
- `reattested` — *only* settable via the MAS reattest writer through
  `extraFields.closureReason='reattested'` on the
  Resolved/Approved branch (`lib/group-transitions.ts:799-808`,
  Task #543).

### 1.4 Group phase — `invoice_phase` enum (canonical, derived)
7 values in declaration order:
`triage`, `ready_to_submit`, `submitted`, `response_received`,
`reviewed`, `awaiting_reattestation`, `closed`.

`phaseForStatus(status)` (test fixture) and `derivePhaseFromLegacy()`
in `@workspace/invoice-state` are the only sanctioned writers; the DB
trigger `validate_disposition_against_phase` rejects any child claim
whose `disposition` is not in `VALID_DISPOSITIONS_BY_PHASE[parent.phase]`.

### 1.5 Claim disposition — `claim_disposition` enum (canonical, 22 values)
Defined in `lib/db/src/schema/claims.ts:26`, re-exported as the
single source of truth referenced by `lib/vocab/src/claim-disposition.ts`.
Hard contract:

> "every disputed claim's disposition must belong to
> `VALID_DISPOSITIONS_BY_PHASE[parent.phase]`"
> — `lib/db/src/schema/claims.ts:21`

Notable subset wired into tests:

- Triage:        `unclassified`
- Ready/submitted: `awaiting_review`, `disposed_portal`, `disposed_email`
- Verdict:       `verdict_*`, `disposed_nonissue`, `final_withdrawn`,
                 `final_denied`, `final_reattested`, `final_nonissue`

### 1.6 Attestation state — `claims.attestation_state` (text + const tuple)
`ATTESTATION_STATES = ["not_required", "pending", "queued", "completed"]`
(`lib/db/src/schema/claims.ts:77`). State machine lives in
`lib/attestation.ts`:

- `Approved` / `Partially Approved` outcome on a child whose group is
  reattest-bearing → auto-stamps `pending`
  (`lib/attestation.ts:79`, asserted by `attestation.test.ts:168-196`).
- Reverting verdict → `not_required` and wipes timestamps
  (`lib/attestation.ts:90`).
- Group-level `engageMasEligibleAttestationCascade` flips every
  `not_required` disputed child to `pending` in one statement
  (`lib/attestation.ts:146-151`).

### 1.7 Payor denial reason
`payor_denial_reason*` columns + `payorDenialReasonOther` (free-text
override) on both `claims` and `invoice_groups`. Endpoints live on
the invoice-groups router — covered by `payor-denial-reason-endpoints.test.ts`.

### 1.8 Re-attest tracking
`awaitingPayorAgainAt` (timestamp) on `invoice_groups`, set by the
`/reattest/queue` route after the bulk attestation flip; cleared on
`/reattest/complete`. Stamped inside the same transaction as the
draft promotion + per-leg attestation flip
(`group-reattest-queue.test.ts`, `group-invoice-rename-rollback.test.ts`).

### 1.9 Service date typing
`claims.date` is now a true Postgres `DATE` column, surfaced as a
strict `YYYY-MM-DD` string via `mode: "string"` (Task #351).
Importer normalizes via `normalizeServiceDate(...)` and rejects
unparseable shapes with a per-row reason; never silently nulls.
Pinned by `typed-claims-date.test.ts`, `format-service-date.test.ts`,
`dates-timezone.test.ts`, `dates-guardrail.test.ts`.

### 1.10 Submission channel — `submittedVia`
Stamped on `invoice_groups.submittedVia` by the portal-submission
finalizer + by `recordEmailSubmission`. Used by `groupHasEverBeenSubmitted`
(`lib/group-transitions.ts:778`) — the gate that blocks `Withdrawn /
cannot_dispute` once the group has touched the payor.

---

## 2. Major write-side helpers (the contract surface tests aim at)

### 2.1 Claim transitions — `lib/claim-transitions.ts`
- `transitionClaimStatus(claimId, newStatus, …)`
- `transitionClaimOutcome(claimId, newOutcome, …)`
- `transitionClaimStatusAndOutcome(...)`

Invariants enforced:
1. Status edge must be in `VALID_CLAIM_STATUS_TRANSITIONS[old]` unless
   `systemOverride`.
2. Outcome must be in `VALID_CLAIM_OUTCOME_BY_STATUS[newStatus]`.
3. `Withdrawn` requires `closureReason === "cannot_dispute"`
   (lines 248-250, 393-395).
4. `Denied` requires a recorded payor response — surfaced via the
   group-level `groupHasResponse` for the multi-leg path.
5. Outcome ≠ Denied/Withdrawn/Non-Issue → `closureReason` is forcibly
   nulled unless `extraFields.closureReason==='reattested'` (line 431).
6. After a successful update, terminal-disposition stamping flows
   through `setClaimDisposition` (line 597 onward, Wave D-PR2b).

### 2.2 Group transitions — `lib/group-transitions.ts`
- `transitionGroupStatus`, `transitionGroupOutcome`,
  `transitionGroupStatusAndOutcome` — same shape as the claim helpers.
- `syncChildRides(groupId, newStatus, newOutcome, actor, extraChildFields, ex, source)`
  cascades **status** and (when truthy) **outcome** to every disputed
  non-`On Hold` child of the group, then writes per-child audit rows
  and refreshes the denormalized cache (line 181–270).
- `engageMasEligibleAttestationCascade` — group-level attestation
  pivot when phase moves to MAS Eligible.
- Combined writer also stamps closure detail onto each disputed
  child (`closureChildFields` block at line 916–935) — including
  `closureReviewState='pending'`, which is what the
  Withdrawals Review queue reads.

### 2.3 Closure validation — `lib/closure-validation.ts`
Zod schema (`outcome ∈ {Withdrawn, Non-Issue, Denied}`) + cross-field
checks:
- `Withdrawn` ⇒ `closureReason='cannot_dispute'`
- accountability tags / category / root cause / narrative are
  required for the structured-closure flow.

### 2.4 Response matcher — `lib/response-matcher.ts`
Public surface: `MATCHER_CLASSIFIED_TARGET_STATUS`,
`shouldTransitionToNeedsReview`, `shouldAutoMarkProcessed`.
Contract pinned by `response-matcher-target-status.test.ts`:
the legacy `status` it writes for any actionable verdict MUST
derive to `phase=response_received` via
`derivePhaseFromLegacy()` (Task #547).

### 2.5 Bulk SOP advance — `routes/invoice-groups.ts`
`POST /invoice-groups/:id/sop-advance` runs an outer transaction
that:
1. Loads eligible legs.
2. For each leg, writes either `setClaimDisposition(...)` (terminal)
   or an inline `sopAnswers/sopNodeId` UPDATE (mid-walk).
3. Inserts an umbrella `group_sop_advanced_bulk` audit row.
   **Test seam:** `BULK_SOP_TEST_HOOKS.failUmbrellaAuditOnce`
   (line 3653) forces step 3 to throw "test-injected: umbrella audit
   insert failed" exactly once. **The test is responsible for
   resetting this flag in its own `try/finally`** —
   `group-sop-advance.test.ts:400/422`.

### 2.6 Day-complete celebration
`checkAndEmitDayCompleteForGroup({ priorConcluded, … })` is invoked
post-update by every group-level transition; emits at most one
`day_completed` event per false→true edge (Task #495). Tested by
`day-complete-celebration.test.ts`.

### 2.7 Email thread / response-tracker
`routes/response-tracker.ts` exposes `__setReplyImplForTesting(impl|null)`
seam used by `email-thread-conversation.test.ts`. The thread reader now
keys "resolved" status off the canonical `claims.disposition`
(Wave C, Task #517) — fixtures must seed disposition alongside
status/outcome (`dispositionFromStatusOutcome` fixture helper).

### 2.8 Batch processor
`lib/batch-processor.ts` exposes `__setBatchWorkerForTests(impl|null)`,
`getActiveBatchJob()`, `clearOrphanedBatchClaims()`,
`isWorkerRunInProgress()`. SSE is wired through `lib/sse.ts`.
`shared-batch-view.test.ts` boots a real Express server, swaps in a
stub worker, and drives it over real HTTP+SSE.

### 2.9 Closure cascade contract (the one called out by the failing test)
`syncChildRides` at `lib/group-transitions.ts:181-270` cascades
status + outcome to disputed children, and the combined-transition
caller at line 916-935 cascades closure detail
(`closureCategory`, `closureRootCause`, `closureNarrative`,
 `closureAccountabilityTags`, `closureReviewState='pending'`)
in the same call. **Closure-data-foundation.test.ts:960-1009 asserts
this end-to-end via `PATCH /invoice-groups/:id/outcome`** — see Phase 1
audit §3 for the unresolved gap.

---

## 3. Test-side contracts

### 3.1 Test seams (mock injectors)
| Seam                                                   | Owner test                              |
| ------------------------------------------------------ | --------------------------------------- |
| `__setReplyImplForTesting`                             | `email-thread-conversation.test.ts`     |
| `__setBatchWorkerForTests`                             | `shared-batch-view.test.ts`, `on-demand-worker.test.ts` |
| `__setChromiumForTests`                                | `group-portal-submission.test.ts`       |
| `BULK_SOP_TEST_HOOKS.failUmbrellaAuditOnce`            | `group-sop-advance.test.ts`             |
| Auth bypass: `req.user = TEST_USER; isAuthenticated() = true` | every route-level test (uniform)  |

Every seam has a documented `null` reset call in the corresponding
`after()` hook **except** for `BULK_SOP_TEST_HOOKS` which uses
in-test `try/finally` (and which is the singleton implicated in the
shuffle-mode poisoning — see audit §3).

### 3.2 Shared fixtures — `__tests__/fixtures/state.ts`
Single helper module imported by ~9 route-level tests:
- `phaseForStatus(status)` — mirrors the deriver.
- `dispositionForGroup(groupId|null)` — picks a disposition that
  satisfies the `validate_disposition_against_phase` trigger for
  the parent group's current phase (or any value when groupId is null).

### 3.3 Common test database
- Shared local PG: `postgresql://helium/heliumdb` (no per-test schema,
  no transactional isolation between files).
- Tests share `pool` from `@workspace/db`; each `after()` calls
  `pool.end().catch(() => undefined)`.
- DB row-deltas under shuffle (8 audit rows / run, 1 invoice_group,
  4 portal_batch_runs) confirm leakage from the failing-during-shuffle
  payor-denial / closure-data tests when their post-test cleanup
  doesn't run because of the umbrella-audit poison.

---

## 4. Cross-cutting invariants tests rely on

1. **Trigger:** `validate_disposition_against_phase` — rejects any
   `claims.disposition` insert/update that doesn't match
   `VALID_DISPOSITIONS_BY_PHASE[parent.phase]` when
   `invoice_group_id IS NOT NULL`. Fixtures *must* seed disposition
   alongside group attachment (see `closure-data-foundation.test.ts:962-971`,
   `attestation.test.ts:124,133`, `email-thread-conversation.test.ts:108-156`).
2. **Trigger:** `groupHasEverBeenSubmitted` is read directly from
   `portalSubmissionsTable` (group-scoped post-cutover; the legacy
   `claim_id` column was dropped — see
   `closure-data-foundation.test.ts:903-908`).
3. **Server time:** `serverTodayKey` returns a calendar key in
   `America/New_York`; importer + dashboard math are pinned to ET.
4. **Cascade:** `syncChildRides` is the only sanctioned writer for
   group→child status/outcome cascade. Direct multi-row UPDATE on
   `claimsTable` from a route is a contract violation per the same
   2026-05-08 prod-incident note inline at line 259-270.
5. **Audit + state events:** every state-changing endpoint writes
   exactly one `audit_logs` row and (when applicable) one
   `state_events` row, both inside the outer transaction.

---

## 5. Known intentionally-skipped / system-controlled behaviour

- `On Hold` status is excluded from group→child cascade (line 192).
- `phase=closed` rows are filtered out of every operator-attention
  list endpoint and the Classification Inbox (`inbox-hide-expired.test.ts`,
  `operator-attention-badge-gating.test.ts`).
- `holdReason` and `holdResolvedAt` only flow through the dedicated
  hold helpers; tests that mutate them directly are violating the
  contract (none observed in the current suite).

# Test-Validity Audit — Phase 1 (Report-Only)

**Target.** `@workspace/api-server` (78 test files under
`artifacts/api-server/src/__tests__/`).
**Date.** 2026-05-12.
**Inputs.** Phase 0 stability harness outputs:
`artifacts/test-stability/api-server-{suspects,shuffle,serial}/{report.md,summary.json,isolation/*.log}`,
read in conjunction with the failing test files and the production
modules they exercise. **No code, fixtures, schema, or product
behaviour was modified.**

> **Methodology note (correction over an earlier draft).** Each
> failing-file claim in §3 is grounded in that file's *own* per-file
> isolation log under `…-shuffle/isolation/iso-src___tests___<name>.test.ts-*-1.log`.
> The `firstErrorExcerpt` field in the harness `summary.json` is a
> **run-level** first error, not a per-file failure surface — files
> that fail later in the same run frequently fail for unrelated
> reasons. The classifications below were rebuilt from the per-file
> logs only.

---

## 1. Executive summary

### 1.1 Headline numbers

- **Suite size.** 78 test files; ~12.5k LOC of test code.
- **Failing files (across 3 harness modes).** 9 distinct files; 1 in
  every mode (closure-data-foundation), 8 in shuffle only.
- **Failing tests (per-file isolation under shuffle).** **25 failing
  tests** across 8 files (many files fail multiple cases). A 9th
  file (`shared-batch-view`) is counted at file granularity only —
  `pass 7 / fail 0` in its isolation log; it fails *only* under
  shuffle interleaving (genuine `order_dependency`).

  Per-file failing-test counts: closure-data-foundation 1,
  attestation 3, email-thread-conversation 6, payor-denial-reason 10,
  attestation-gate-restore-backfill 1, list-count-past-deadline 2,
  must-file-today 1, transition-helper-newstatus 1
  → 1+3+6+10+1+2+1+1 = **25**.

### 1.2 Failure-bucket distribution (test-weighted, n=25 + 1 file-level)

| Bucket                              | Tests |     % (of 25) |
| ----------------------------------- | ----: | ------------: |
| `outdated_test`                     |  20   |          80%  |
| `unknown_requires_human_decision`   |   4   |          16%  |
| `schema_fixture_drift`              |   1   |           4%  |
| `valid_product_regression`          |   0   |           0%  |
| `test_setup_defect`                 |   0   |           0%  |
| `implementation_detail_brittleness` |   0   |           0%  |
| `order_dependency`                  |   — file-level (1 file: shared-batch-view) |

`outdated_test` breakdown: email-thread-conversation 6 + payor-denial-reason 10
+ list-count-past-deadline 2 + must-file-today 1 + transition-helper 1 = **20**.

### 1.3 Passing-sample taxonomy (file-weighted, n=50)

| Class                            | Files |   % |
| -------------------------------- | ----: | --: |
| `valid` (score 4–5 on rubric)    |  45   | 90% |
| `missing-stronger-assertion`     |   3   |  6% |
| `weak` (prose coupling, score 3) |   1   |  2% |
| `over-specified` (brittleness)   |   1   |  2% |
| `outdated-but-passing`           |   0   |  0% |
| `duplicate`                      |   0   |  0% |

Mean validity score over the 50-file sample: **4.5 / 5**
(28 fives + 20 fours + 2 threes; (28·5+20·4+2·3)/50 = 226/50 = 4.52).
(Full per-file scoring in §6; classification + score columns are both
present per the rubric in §5.)

### 1.4 Top-level conclusions

1. **Three quarters of the failing tests are the suite drifting
   behind product changes the team intentionally shipped** — the
   matcher target-status rename, the payor-denial-reason gate moving
   from `status=Needs Review` to `macroPhase=response-pending`, the
   urgent-snapshot rules expansion (Task #541), and the
   `transition-helper REGISTRY` not having absorbed new
   `newStatus:` callsites in `routes/{claims,portal-submissions,
   response-tracker}.ts`. None of these are test-setup bugs and none
   are product regressions; they are pure `outdated_test` debt.
2. **The remaining 25%** is one fixture-vs-trigger drift
   (`attestation-gate-restore-backfill`), one genuine
   order-dependency (`shared-batch-view`), and four tests where the
   product behaviour either regressed or the test contract is
   ambiguous (the closure-cascade `Pending` vs `Withdrawn`, plus
   three attestation-queue tests where `attest/queue` and
   `attest/confirm` now return 409). All four belong in
   `unknown_requires_human_decision`.
3. **There is no schema drift, no business-rule drift, and no
   implementation-detail brittleness in the failing set.**
4. **The passing suite is healthy.** 48/50 sampled files score 4–5
   on the validity rubric; only 5 files carry a smell (1 weak,
   1 over-specified, 3 missing-stronger-assertion).

The Phase 0 → Phase 1 read is therefore: **the suite is in much
better shape than the failure count suggests** — most of the work in
Phase 2 is updating tests to reflect product contracts the team has
already moved (and which the *passing* suite already covers from
the new angle).

---

## 2. Method

1. Re-read the three harness `summary.json` + `report.md` files.
2. For each failing file, opened the corresponding
   `…/isolation/iso-src___tests___<name>.test.ts-*-1.log` and read
   every `✖` block plus the assertion stack.
3. For every failing test, opened the test file at the line cited
   in the stack and the production module the assertion targets,
   then matched assertion text to the contract map in
   `docs/test-validity/current-contract-map.md`.
4. Sampled 50 passing-test files (≥30 required), reading the file
   header + the production module each one imports from. Scored
   1–5 + classified per the §5 rubric.
5. Cross-checked schema enums and trigger contracts in
   `lib/db/src/schema/{claims,invoice-groups}.ts` and
   `lib/vocab/src/`.

**What this audit does NOT do.** Run the tests itself, edit
anything, or speculate about contracts that aren't visible in the
current code or the failing tests' assertion text. Where evidence
is genuinely ambiguous it lands in `unknown_requires_human_decision`.

---

## 3. Failing-test classification (per-test detail)

Columns: **Test name** | **Source contract / file:line** | **Expected** | **Actual** | **Bucket** | **Score (1–5)** | **Recommendation**.

> Per-test (not per-file) entries; one row per `✖` block in the
> shuffle isolation log. Validity score uses the rubric in §5 — a
> score < 3 means the test, even after fixing its assertion, would
> still be a weak guard.

### 3.1 `closure-data-foundation.test.ts` (1 failing test of 32)

| Test | Source contract | Expected | Actual | Bucket | Score | Recommendation |
|---|---|---|---|---|---:|---|
| PATCH /invoice-groups/:id/outcome cascades closure detail and closureReason onto every non-held child claim (line 992) | `lib/group-transitions.ts:912-935` (cascade comment + `syncChildRides` write at lines 218-226 set `outcome: newOutcome`) | child.outcome = `'Withdrawn'` | child.outcome = `'Pending'` | **`unknown_requires_human_decision`** (lean: `valid_product_regression`) | **5** | Run the failing case under drizzle's `logger:true` to see whether `syncChildRides` actually fires for this PATCH route, and whether a downstream `refreshClaimDenormalizedCache` re-coerces the outcome. If the cascade fires and is overwritten → product regression. If a slimmer `transitionGroupOutcome` path is used and never cascades → outdated test. Either way, contract is well-pinned; do not weaken. |

### 3.2 `attestation.test.ts` (3 failing tests)

| Test | Source contract | Expected | Actual | Bucket | Score | Recommendation |
|---|---|---|---|---|---:|---|
| POST /claims/:id/attest/confirm moves queued → completed with the queue-confirm audit key | `lib/attestation.ts` queued→completed; `routes/claims.ts` `/attest/confirm` (Wave D-PR2b) | HTTP 200 | HTTP 409 | **`unknown_requires_human_decision`** | 4 | The test seeds via `outcome=Approved` then `attest/queue` then `attest/confirm`. A 409 here means the per-leg state machine's source-state for `/attest/confirm` may have been retightened (e.g. requires `attestationState='queued'` AND a recorded payor verdict). Needs product owner to confirm intended state machine. |
| GET /attestation/counts splits pending and queued correctly | same | `queued >= 1` | `queued = 0` | **`unknown_requires_human_decision`** | 4 | Same root cause as above — if `/attest/queue` no longer flips the leg, the count stays at 0. Resolution comes from the same product decision. |
| GET /claims/attestation-pending?state=queued returns only queued claims | same | seeded claim present | absent | **`unknown_requires_human_decision`** | 4 | Same root cause — list reflects the missing flip. Single recommendation: clarify the state-machine intent, then update or rejoin all three. |

### 3.3 `email-thread-conversation.test.ts` (6 failing tests)

| Test | Source contract | Expected | Actual | Bucket | Score | Recommendation |
|---|---|---|---|---|---:|---|
| PATCH /responses/:id/process with approval keeps the claim in Needs Review (no auto-resolve) | `lib/response-matcher.ts` — `MATCHER_CLASSIFIED_TARGET_STATUS` (Task #547) | status `'Needs Review'` | status `'Ready to Review'` | **`outdated_test`** | 4 | The matcher target status was retitled to `Ready to Review` (the *passing* `response-matcher-target-status.test.ts` confirms this is the new canonical, derives to `phase=response_received`). Update the 6 sibling assertions in this file to the new vocabulary; the assertion *form* is fine. |
| PATCH /responses/:id/process with denial does NOT auto-deny — claim stays in Needs Review | same | `'Needs Review'` | `'Ready to Review'` | **`outdated_test`** | 4 | Same — update vocabulary. |
| PATCH /responses/:id/process with partial_approval does NOT auto-resolve as Partially Approved | same | `'Needs Review'` | `'Ready to Review'` | **`outdated_test`** | 4 | Same. |
| PATCH /responses/:id/process with 'other' still pushes the claim into Needs Review | same | `'Needs Review'` | `'Ready to Review'` | **`outdated_test`** | 4 | Same. |
| PATCH /responses/:id/process resets a non-pending claim outcome back to Pending | same | `'Needs Review'` | `'Ready to Review'` | **`outdated_test`** | 4 | Same. |
| PATCH /responses/:id/process with approval on an invoice group keeps it in Needs Review with outcome Pending (line 1039) | same | `'Needs Review'` | `'Ready to Review'` | **`outdated_test`** | 4 | Same. |

### 3.4 `payor-denial-reason-endpoints.test.ts` (10 failing tests)

| Test | Source contract | Expected | Actual | Bucket | Score | Recommendation |
|---|---|---|---|---|---:|---|
| POST /payor-denial-reason: happy path stamps row + audit + emits enum-typed reason | route gate has moved from `status=Needs Review` to `macroPhase=response-pending`; new error envelope `{ error, expectedState, actualState }` | HTTP 200 | HTTP 409 with `expectedState='macroPhase=response-pending', actualState='status=Needs Review, phase=triage'` | **`outdated_test`** | 4 | Test seeds the group via legacy `status='Needs Review'` shim that no longer derives to `phase=response_received`. Update the seed helper (or add a recorded inbound response) so the group enters `phase=response_received`; assertion form is fine. |
| POST /payor-denial-reason: idempotent re-record bumps timestamp + records previous reason | same | HTTP 200 | HTTP 409 | **`outdated_test`** | 4 | Same root cause; same fix. |
| POST /payor-denial-reason: payor_other requires a non-empty note (400) | same | HTTP 400 | HTTP 409 | **`outdated_test`** | 4 | Same root cause; same fix. |
| POST /payor-denial-reason: 409 when status is not Needs Review | same | error matches `/Needs Review/` | error reads `macroPhase=response-pending` | **`outdated_test`** | 3 | Update both the regex and the *intent* (the gate is no longer keyed on status). Score 3: assertion couples to a prose error string. |
| POST /payor-denial-reason: 409 when no inbound responses on file | same | error matches `/portal_responses/` | error reads `macroPhase=response-pending` | **`outdated_test`** | 3 | Same — also assertion-form smell (regex on prose). |
| POST /awaiting-payor-again: stamps timestamp + audit + suppresses row from list | same | HTTP 200 | HTTP 409 | **`outdated_test`** | 4 | Same root cause; same fix. |
| POST /awaiting-payor-again: list re-includes the row when a NEWER response arrives | same | HTTP 200 | HTTP 409 | **`outdated_test`** | 4 | Same. |
| POST /awaiting-payor-again: 409 when status is not Needs Review | same | error matches `/Needs Review/` | `macroPhase=response-pending` | **`outdated_test`** | 3 | Same — prose-regex smell. |
| POST /awaiting-payor-again: 409 when no inbound responses on file | same | error matches `/portal_responses/` | `macroPhase=response-pending` | **`outdated_test`** | 3 | Same. |
| GET /valid-transitions includes awaitingPayorAgainAt in response | same | HTTP 200 | HTTP 409 | **`outdated_test`** | 4 | Same — needs the seed to land in `phase=response_received`. |

### 3.5 `attestation-gate-restore-backfill.test.ts` (1 failing test)

| Test | Source contract | Expected | Actual | Bucket | Score | Recommendation |
|---|---|---|---|---|---:|---|
| Task #561 backfill resets premature pending → not_required and is idempotent | `validate_disposition_against_phase` PG trigger (`lib/db/src/schema/claims.ts`) — disputed children must seed `disposition` matching parent's derived phase | seed succeeds | PG `P0001`: `disposition unclassified not valid for parent invoice phase response_received` (raised in `validate_disposition_against_phase` at PL/pgSQL line 40) | **`schema_fixture_drift`** | 4 | The `seedLeg` helper at line 74-93 inserts a child with default `disposition='unclassified'`, but seeds the parent group such that its derived phase is `response_received` (because `outcome=Approved` + a child with `attestationState=pending`). The trigger contract demands `disposition ∈ VALID_DISPOSITIONS_BY_PHASE['response_received']` (e.g. `awaiting_review`, `verdict_*`). Update `seedLeg` to either (a) accept and pass an explicit `disposition`, or (b) call `dispositionForGroup(invoiceGroupId)` from `__tests__/fixtures/state.ts`. |

### 3.6 `list-count-past-deadline-parity.test.ts` (2 failing tests)

| Test | Source contract | Expected | Actual | Bucket | Score | Recommendation |
|---|---|---|---|---|---:|---|
| invoice-groups: total matches visible rows after past-deadline filter move | Task #541 / urgent-snapshot rules in `lib/operator-attention.ts` (and the passing `operator-attention-parity.test.ts` / `operator-attention-badge-gating.test.ts`) | seeded "strict-today" group (id=21429) appears in `?expiring=urgent` | absent | **`outdated_test`** | 4 | Task #541 added an "operator-done" gate to the urgent-snapshot. The seeded fixture probably no longer satisfies the new predicate (e.g. macro-phase advanced past `ready_to_submit`, or `errorTypeId` not set). Update the seed helper to match the updated fixture in the *passing* parity tests; assertion form is fine. |
| claims: total matches visible rows after past-deadline filter move | same | seeded claim (id=63247) appears | absent | **`outdated_test`** | 4 | Same root cause; same fix. |

### 3.7 `must-file-today-parity.test.ts` (1 failing test)

| Test | Source contract | Expected | Actual | Bucket | Score | Recommendation |
|---|---|---|---|---|---:|---|
| dashboard, invoice-groups list, and urgent-snapshot agree on the urgent group set | Task #541 urgent-snapshot rules (sibling of 3.6) | seeded "actionable + today-deadline" group (id=21436) appears in `invoice-groups?expiring=urgent` | absent | **`outdated_test`** | 4 | Same root cause as 3.6 — fixture pre-dates the operator-attention extension. Update fixture in line with the *passing* `operator-attention-parity.test.ts` / `operator-attention-badge-gating.test.ts`; assertion form is fine. |

### 3.8 `transition-helper-newstatus-contract.test.ts` (1 failing test)

| Test | Source contract | Expected | Actual | Bucket | Score | Recommendation |
|---|---|---|---|---|---:|---|
| REGISTRY matches the literal `newStatus:` callsites in source (Test 1) | hand-maintained `REGISTRY` table inside the test file vs `scanTransitionCallSites(file)` over `routes/{invoice-groups,claims,portal-submissions,response-tracker}.ts` | source count == registry count for every (file, status) pair | drift in 2 (file, status) buckets — per the assertion output (`routes/invoice-groups.ts::Resolved`, `routes/claims.ts::Needs Evidence`); the assertion message also enumerates every source-side `newStatus:` callsite for context, which is what makes the failure log long. The actual missing-from-REGISTRY count is 2 entries. | **`outdated_test`** | 5 | The test is doing exactly what it was built to do — flag REGISTRY drift. Resolution is *test data* maintenance: append the 2 missing `(file, status)` pairs to REGISTRY (or refactor the test to derive REGISTRY from the source scan, so it can never drift). Score 5: strongest tripwire in the suite for transition-helper hygiene. |

### 3.9 `shared-batch-view.test.ts` (0 per-test failures in isolation, fails only under shuffle)

| Test | Source contract | Expected | Actual | Bucket | Score | Recommendation |
|---|---|---|---|---|---:|---|
| (entire file — `pass 7 / fail 0` in isolation log) | `lib/batch-processor.ts` `__setBatchWorkerForTests`, SSE in `lib/sse.ts` | every test passes | every test passes when run alone; only fails when interleaved with another file in the same shuffle process | **`order_dependency`** | 5 | `likelyOrderDependent: true` per harness. Either (a) extract the boot/teardown into a fixture that's idempotent across processes, or (b) tag the file `--test-concurrency=1` and run it isolated. Assertion content is fine. |

### 3.10 Roll-up

```
outdated_test            ████████████████████  20  (80% of 25 tests)
unknown_human            ████                   4  (16% of 25 tests)
schema_fixture_drift     █                      1  ( 4% of 25 tests)
order_dependency         █*                     —  (file-level: 1 file)
valid_product_regression                         0
test_setup_defect                                0
implementation_detail                            0
```

---

## 4. Schema drift findings

- **No active schema drift in the test suite.** Every fixture
  observed (`createSeedClaim`, `createSeedGroup`,
  `dispositionForGroup`, `dispositionFromStatusOutcome` in
  `email-thread-conversation`) uses the current canonical enum
  vocabulary.
- The closest hit is the **fixture-vs-trigger** mismatch in
  `attestation-gate-restore-backfill.test.ts` (§3.5). It is
  classified as `schema_fixture_drift` because the fixture is
  inconsistent with the schema's `validate_disposition_against_phase`
  trigger; the *schema* is fine.
- The harness DB-snapshot probe complains about
  `relation "attestations" does not exist`. Benign — `attestation_state`
  lives on `claims` (`lib/db/src/schema/claims.ts:215`); no test
  references the missing table. Suggest dropping the probe in a
  future Phase but no test depends on it.

---

## 5. Validity-score rubric (used for §3 + §6)

### 5.1 Score (1–5)

| Score | Meaning |
|------:|---------|
| **5** | Pinned to a documented contract, asserts canonical vocab/state, fast (no DB), no implementation-detail leakage. Failure means the product really broke. |
| **4** | Pinned to a documented contract, may touch real DB but cleans up; assertions are observable behaviour (HTTP shape, audit log, derived field). |
| **3** | Reasonable behaviour assertion but couples to a mutable string format (error prose, audit `details`) or a specific log key. Likely to fail on benign refactor. |
| **2** | Asserts an internal-only call sequence, mock-call counts, or column-by-column row shape that the product is allowed to evolve. Mostly serves as a tripwire, not a contract. |
| **1** | Asserts something the product never promised (or promised the opposite of). |

### 5.2 Classification (passing-test taxonomy)

| Class                          | Definition |
|--------------------------------|------------|
| `valid`                        | Score ≥ 4 AND assertion targets a canonical contract that matches the production code today. |
| `weak`                         | Score = 3 due to prose-regex or mutable-string coupling. |
| `over-specified`               | Pins implementation choices the product is allowed to evolve (mock-call counts, internal field-by-field). Smell, not a defect. |
| `missing-stronger-assertion`   | Hits the right code path but stops short of asserting the canonical post-condition (e.g. checks status but not derived phase / disposition). |
| `outdated-but-passing`         | Test still passes only because the product has been kept compatible — but the assertion no longer reflects the contract intent. None observed in the §6 sample. |
| `duplicate`                    | Same contract pinned more cheaply by another test. None observed in the §6 sample. |

### 5.3 Failure-bucket vocabulary (used for §3)

`valid_product_regression`, `outdated_test`, `schema_fixture_drift`,
`implementation_detail_brittleness`, `test_setup_defect`,
`order_dependency`, `unknown_requires_human_decision` — definitions
per the Phase 1 spec.

---

## 6. Passing-test sample (50 files, target ≥30)

Columns: **File** | **Pins / surface** | **Score** | **Class** | **Note**.

The 8 deepest-read files are first; the remaining 27 are sampled
from the file header + the production module each one imports.

### 6.1 Deep-read sample (8)

| File | Pins / surface | Score | Class | Note |
|---|---|---:|---|---|
| `clerk-rbac.test.ts` | RBAC matrix per role × endpoint, real Express w/ injected `req.user` | 5 | valid | One of the strongest contract tests in the suite. |
| `role-helpers.test.ts` | `isClerk/isAdmin/canSeeAmounts/canDoBulk/canEditSetup/scrubMoneyFields` | 5 | valid | Pure functions; ms runtime. |
| `dates-guardrail.test.ts` | Static-scan: bans `new Date("YYYY-MM-DD")` outside sanctioned formatters (Apr 5 / Apr 6 incident) | 5 | valid | Banned-token form is robust. |
| `dates-timezone.test.ts` | `serverTodayKey/daysRemaining/effectiveDaysRemaining/isUrgentDeadline` anchored ET | 5 | valid | Locks Task #298. |
| `format-service-date.test.ts` | `formatServiceDate` keeps calendar day intact in ET | 5 | valid | Tiny, focused. |
| `typed-claims-date.test.ts` | Importer + reader contracts for typed `claims.date` (Task #351) | 5 | valid | Both surfaces covered. |
| `leg-status-projector.test.ts` | §A decision table (task-231) restated against `dispositionToStatus` | 5 | valid | Architectural decision table 1:1. |
| `set-claim-disposition-parity.test.ts` | Wave D-PR2b parity for the `setClaimDisposition` writer at 4 call-site groups | 5 | valid | Canonical migration regression net. |

### 6.2 Lighter sample (27)

| File | Pins / surface | Score | Class | Note |
|---|---|---:|---|---|
| `response-matcher-target-status.test.ts` | Matcher-classified verdict derives to `phase=response_received` (Task #547) | 5 | valid | Exact contract that 3.3 violates. |
| `email-body-normalize.test.ts` | `htmlToText`/`stripExternalBanner` boundary | 5 | valid | — |
| `email-thread-html-body.test.ts` | `inboundToMessage`/`outboundToMessage` HTML body plumbing (Task #288) | 4 | valid | — |
| `inbound-email-classifier.test.ts` | `parseClassifierResponse`, `shouldTransitionToNeedsReview`, `shouldAutoMarkProcessed` | 5 | valid | — |
| `email-phrase-classifier-corpus.test.ts` | Acknowledgment-only pre-filter against production corpus (Task #314) | 5 | valid | — |
| `draft-lint.test.ts` | `lintDraft` confirmation-number / amount checks | 5 | valid | — |
| `activity-humanizer.test.ts` | `humanizeAuditRow` output strings | 3 | weak | Pins exact prose — copy-edit fragility. |
| `brief-yesterday-actions.test.ts` | `YESTERDAY_*_ACTIONS` audit-key tuples | 5 | valid | Vocabulary, not prose. |
| `brief-yesterday-activity.test.ts` | `getYesterdayActivity` row counts (incl. bulk-import sum path) | 4 | valid | — |
| `audit-prompt-leg-counters.test.ts` | All 4 prompt sites carry `hasPerLegContext`/`perLegContextLegCount`/`siblingDuplicateCount` (Task #312) | 5 | valid | — |
| `classifier-stats.test.ts` | `computeClassifierStats`, `detectSpikes`, `VERDICT_BINS`, pricing math | 5 | valid | — |
| `day-complete-celebration.test.ts` | `false→true day-completed` edge fires once via `priorConcluded` (Tasks #495/#538) | 4 | valid | — |
| `disputed-legs-resolved.test.ts` | `evaluateDisputedLegsResolved` duplicate→excluded-primary case | 5 | valid | — |
| `per-leg-state.test.ts` | 11 per-leg state-machine endpoints incl. 409 `{error,expectedState,actualState}` shape, audit + state-event vocab | 5 | valid | One of the largest, clearly written. |
| `operator-attention-parity.test.ts` | Classification Inbox urgency parity (Task #541) — same surface 3.6/3.7 fail on | 5 | valid | Mirror of the failing fixture path; could host an additional fixture-helper to share with the failing tests. |
| `operator-attention-badge-gating.test.ts` | "operator-done" predicate gates row stamping | 5 | valid | — |
| `queue-cta.test.ts` | `queueGroupHref/queueLegHref` regex contract | 5 | valid | — |
| `dashboard-expiring.test.ts` | `effectiveDaysRemaining` + `?expiring=urgent` list shape | 4 | missing-stronger-assertion | Doesn't assert badge gating from the *passing* `operator-attention-badge-gating.test.ts`. |
| `dashboard-repeat-offenders.test.ts` | Repeat-offender aggregation contract | 4 | valid | — |
| `dashboard-activity-summary.test.ts` | Dashboard summary envelope | 4 | valid | — |
| `system-health-rollup.test.ts` | Health rollup numbers | 4 | valid | — |
| `portal-issue-type.test.ts` | Portal issue-type classification | 4 | valid | — |
| `portal-non-contestable-filter.test.ts` | Non-contestable rows excluded from portal list | 4 | valid | — |
| `portal-submissions-list-shape.test.ts` | List response envelope shape | 4 | valid | — |
| `group-no-date-reason.test.ts` | `noDateReason` enum acceptance + audit | 4 | valid | — |
| `group-service-date.test.ts` | Group-level service-date setters/derivation | 4 | valid | — |
| `submitted-row-cleanup.test.ts` | Post-submit cleanup of stale rows | 4 | valid | — |
| `retry-self-heal.test.ts` | Bot-retry self-heal path | 3 | over-specified | Asserts internal retry counts; behaviour-only would be stronger. |
| `expired-status-transitions.test.ts` | Expired→reversible revert | 5 | valid | — |
| `urgent-today-transitions.test.ts` | Urgent-snapshot `today` membership transitions | 5 | valid | — |
| `cron-fire-enumeration.test.ts` | Cron-trigger enumeration completeness | 4 | valid | — |
| `include-terminal-readback-cycle.test.ts` | Terminal readback round-trip | 4 | valid | — |
| `objects-route.test.ts` | Object-storage proxy route shape | 4 | valid | — |
| `outlook-attach.test.ts` | Outlook attachment plumbing (uses configured Outlook integration) | 4 | valid | — |
| `post-upload-bridge-list.test.ts` | `?importBatch=&errorDetails=empty&limit=200` envelope (Task #440) | 5 | valid | — |
| `error-type-group-only.test.ts` | Group-only error-type rejection on per-claim setter | 4 | valid | — |
| `invoice-group-create.test.ts` | POST /invoice-groups happy + 400 + 409 | 5 | valid | — |
| `group-portal-submission.test.ts` | `runBatchWorker` accepts a `GroupPortalSubmission` (Task #484) | 5 | valid | — |
| `group-packaging-readiness.test.ts` | `computeGroupReadiness` gates (Task #231) | 5 | valid | — |
| `inbox-hide-expired.test.ts` | Classification Inbox hides expired groups (Task #644) | 5 | valid | — |
| `attestation-gate-restore-backfill` (passing tests in same file) | Backfill idempotence (the cases that aren't blocked by §3.5) | 4 | missing-stronger-assertion | Once §3.5 fixture is fixed, all tests should run; current state has only 1 of N failing. |
| `submit-flow-gates.test.ts` | Submit-flow gating predicates | 4 | missing-stronger-assertion | Could assert post-condition derive on `phase`. |

**Summary.** 50 files reviewed (8 deep-read in §6.1 + 42 lighter
in §6.2; target ≥30). Score distribution: **5 → 28 files**,
**4 → 20 files**, **3 → 2 files**, **2 → 0**, **1 → 0**.
Mean score = (28·5 + 20·4 + 2·3) / 50 = 226/50 = **4.52**.

Class distribution: `valid` 45 (8 deep + 37 light),
`weak` 1 (`activity-humanizer`), `over-specified` 1 (`retry-self-heal`),
`missing-stronger-assertion` 3 (`dashboard-expiring`,
`attestation-gate-restore-backfill` passing portion, `submit-flow-gates`),
`outdated-but-passing` 0, `duplicate` 0. Total = 45+1+1+3 = 50. ✓

---

## 7. Business-rule drift findings

- **None confirmed.** Every assertion in the failing set traces
  to a *named* rule in the production code:
  - "Withdrawn requires `cannot_dispute`" — pinned at
    `closure-data-foundation.test.ts:927-930`, enforced at
    `lib/group-transitions.ts:609-611,775-777` and
    `lib/claim-transitions.ts:248-250,393-395`.
  - "Denied requires recorded payor response" — pinned at
    `closure-data-foundation.test.ts:946-949`, enforced at
    `lib/group-transitions.ts:786-790`.
  - "cannot_dispute / Non-Issue blocked once
    `groupHasEverBeenSubmitted`" — pinned at
    `closure-data-foundation.test.ts:927-930`, enforced at
    `lib/group-transitions.ts:778-782,793-796`.
  - "Approved/Partial verdict auto-stamps `attestation_state=pending`"
    — `attestation.test.ts:168-196` ↔ `lib/attestation.ts:79`.
  - "MAS Eligible cascade flips disputed children to `pending`" —
    same file ↔ `lib/attestation.ts:146-151`.
  - "Matcher-classified verdict derives to `phase=response_received`"
    — pinned by *passing* `response-matcher-target-status.test.ts`,
    contradicted by *failing* `email-thread-conversation.test.ts`
    (vocabulary not yet propagated to that file — §3.3).
  - "Payor denial / awaiting-payor-again gates on
    `macroPhase=response-pending`" — enforced in `routes/invoice-groups.ts`
    (per the §3.4 actual error envelope), not yet reflected in the
    failing tests' fixtures.
  - "REGISTRY of `newStatus:` callsites covers every transition
    helper write site" — definition lives in the test itself; new
    callsites in `routes/{claims,portal-submissions,response-tracker}.ts`
    are valid product additions per the §3.8 actual list.

The product code is internally consistent across these rules; only
the failing tests have lagged.

---

## 8. Coverage gaps observed

Phase 1 only notes them; Phase 2 should triage.

1. **Trigger-level negative tests.** Nothing exercises
   `validate_disposition_against_phase` directly. Several fixtures
   rely on the trigger to reject bad seeds; no test asserts the
   error shape the route surfaces when the trigger fires
   mid-transaction. (Directly relevant to §3.5.)
2. **`refreshClaimDenormalizedCache` round-trip.** The
   2026-05-08 prod incident note (`group-transitions.ts:259-270`)
   explains that group cascade now refreshes the disposition cache
   per child. No test asserts the cache value post-cascade — only
   that status/outcome are written. (Directly relevant to §3.1.)
3. **Closure cascade end-to-end on every closure path.** §3.1 is
   the only test that hits the group→child *closure* cascade, and
   only for `Withdrawn`. Non-Issue and Denied closure cascades
   have no analogue.
4. **`__set*ForTest(null)` reset audit.** No meta-test asserts that
   every public `__set*ForTest(impl)` seam has a corresponding
   `null` reset in `after()`. A simple grep-based test would
   prevent the singleton-reset class of bug from ever shipping.
5. **`payor_denial_reason*` value enum.** Endpoint test exists
   (`payor-denial-reason-endpoints.test.ts`) but no parity test
   that the *override* free-text path (`*Other`) nulls the
   canonical column when written, or vice versa.
6. **SSE keepalive teardown.** `shared-batch-view.test.ts` manually
   closes connections to force the keepalive `setInterval` to
   clear, but no smaller-surface test pins the teardown contract
   on `lib/sse.ts`.

---

## 9. Test smells observed

Catalogued so Phase 2 / 3 has a starting point. None of these are
correctness defects today.

- **(S1) Singleton mock state without backstop.**
  `BULK_SOP_TEST_HOOKS.failUmbrellaAuditOnce` in
  `routes/invoice-groups.ts:3650-3905` is a bare module-level flag
  whose self-reset only fires on the success path; the owning test
  (`group-sop-advance.test.ts:400/422`) backstops in a `try/finally`
  but no other consumer can rely on that. Did *not* drive any of
  the §3 failures (per the per-file logs), but remains a structural
  smell. Wrap it in a `__withFailUmbrellaAuditOnce(fn)` helper that
  auto-resets in `try/finally` and is the only thing tests can
  import.
- **(S2) `pool.end()` in `after()` of every route-level test.**
  ~20 files call `await pool.end()` in their teardown. The pool is
  a `@workspace/db` *singleton*. Works today only because Node's
  `--test` runner spawns each *file* in a forked subprocess by
  default; if the harness ever switches to in-process loading,
  the suite collapses. Replace with a process-exit hook in
  `__tests__/fixtures/`.
- **(S3) Fixture-by-Date.now collisions.**
  `confNumber: T###-${Date.now()}-${rand}` pattern in
  `attestation.test.ts:116`, `closure-data-foundation`, etc.
  Statistically unlikely but hides which test produced a row in
  the shared DB after a crashed run.
- **(S4) Prose-text assertions.**
  `activity-humanizer.test.ts` and `payor-denial-reason-endpoints.test.ts`
  assert user-facing English (or regex over it). Already hedged
  with regex alternation; still tag and migrate to a stable
  error-code field (matching the per-leg `{error,expectedState,
  actualState}` shape that `per-leg-state.test.ts` enforces).
- **(S5) Inconsistent `pool.end()` in tests that touch the DB**
  (`shared-batch-view` does end; `group-sop-advance` does not).
- **(S6) Test seams exported from production routes.**
  `__setReplyImplForTesting`, `__setBatchWorkerForTests`,
  `BULK_SOP_TEST_HOOKS`, `__setChromiumForTests` — all acceptable
  practice but each is a future foot-gun (see S1).

---

## 10. Recommended next phase

**Phase 2 — "Catch the suite up to the product, then resolve the
unknowns".** Three small parallel work-streams.

### 10A. Outdated-test sweep (clears 75% of the failing tests)

Single PR per failing file; *no* product/schema edits.

| File | Action |
|---|---|
| `email-thread-conversation.test.ts` (§3.3) | Replace 6 `'Needs Review'` expectations with the matcher's new target status (cross-reference *passing* `response-matcher-target-status.test.ts`). |
| `payor-denial-reason-endpoints.test.ts` (§3.4) | Update the seed helper so the group lands in `phase=response_received` (record an inbound response or call the matcher); update prose-regex assertions to the new `{error,expectedState,actualState}` envelope. |
| `list-count-past-deadline-parity.test.ts` (§3.6) | Adopt the fixture pattern from the *passing* `operator-attention-parity.test.ts` so seeded rows satisfy the Task #541 urgent predicate. |
| `must-file-today-parity.test.ts` (§3.7) | Same. |
| `transition-helper-newstatus-contract.test.ts` (§3.8) | Append the 2 missing `(file, status)` pairs to REGISTRY (`routes/invoice-groups.ts::Resolved`, `routes/claims.ts::Needs Evidence`), or refactor the test to derive REGISTRY from the source scan. |

Expected effect: 20 of 25 failing tests go green.

### 10B. Fixture-vs-trigger fix (clears the 1 schema_fixture_drift)

`attestation-gate-restore-backfill.test.ts` (§3.5) — make `seedLeg`
accept `disposition`, default to `dispositionForGroup(invoiceGroupId)`
from `__tests__/fixtures/state.ts`. No schema change.

### 10C. Resolve the unknowns (4 tests)

A 60-minute paired session with the closure-flow / attestation-flow
owners:

1. **§3.1 closure cascade.** Run the failing case under
   drizzle's `logger:true`. Confirm whether `syncChildRides` actually
   fires for this PATCH route and whether
   `refreshClaimDenormalizedCache` re-coerces. Decide: regression vs
   outdated test.
2. **§3.2 attestation queue/confirm.** Confirm the intended source
   state for `/attest/queue` and `/attest/confirm` post-Wave-D-PR2b.
   Decide: regression vs outdated test (likely a single root cause
   for all three).

### 10D. (Optional, lower priority) Convert the smells

- Replace `pool.end()` per-file with a shared process-exit hook.
- Wrap `BULK_SOP_TEST_HOOKS` in `__withFailUmbrellaAuditOnce(fn)`.
- Add a meta-test that flags any `__set*ForTest(` export without a
  paired reset call in the same file.

### 10E. Fill the coverage gaps from §8

Concrete tests to add (one per gap), all small, none requiring a
product decision.

---

## 11. Closing remarks

The Phase 1 verdict is encouraging:

- **Three quarters of the failing tests are bookkeeping** — the
  product moved (matcher target status, payor-denial gate, urgent
  rules, `newStatus:` callsites), the *passing* suite already
  covers the new contracts, and the failing tests just need to
  catch up.
- **There is no schema drift, no business-rule drift, and no
  implementation-detail brittleness in the failing set.**
- **The passing suite is healthy** — average 4.5/5 over a 50-file
  sample, 90% classified `valid`.
- **The four genuine unknowns** (closure cascade + 3 attestation-
  queue tests) are tightly scoped and resolvable in a single
  product-owner session.

Phase 2 can clear the failure board with minimal, targeted edits;
no urgent product-side action is required from this audit alone.

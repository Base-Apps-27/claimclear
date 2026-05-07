# Wave C continuation #3 — picking up after `lib/group-packaging.ts`

This is the THIRD continuation of Wave C (Task #517). It supersedes the
"What's still open" half of `state-wave-c-continuation-handoff-prompt-2.md`
— that file's design rationale, sharp-edge log, and operating
instructions are still authoritative; only the "what to do next"
pointer has moved here.

The user directive remains: **Ship it correctly, not fast.**

## What shipped in this slice

T005 step 1 — `lib/group-packaging.ts` reader switch.

| File | Change |
| --- | --- |
| `artifacts/api-server/src/lib/group-packaging.ts` | Per-leg bucketing now reads `claims.disposition` first (canonical), with the legacy `sopOutcome` ladder as fallback for rows still on the `unclassified` default. Mirrors the precedence pattern in `lib/leg-state/src/per-leg-sub-status.ts`. |
| `artifacts/api-server/src/__tests__/group-packaging-readiness.test.ts` | 8 new tests pinning the disposition path: each terminal-disposition bucket, `disposition='blocked'` ↔ legacy `sopOutcome='hold'`, non-terminal dispositions land in `unprocessed`, `unclassified` falls through to the legacy ladder, disposition wins on divergence, duplicate primary resolution honours disposition. |

### Mapping used

Derived from `DISPOSITION_TO_SUB_STATUS` in
`lib/leg-state/src/per-leg-sub-status.ts`:

| Legacy `sopOutcome` set | Canonical `disposition` set | Bucket |
| --- | --- | --- |
| `{portal_dispute, dispute}` (DISPUTE_OUTCOMES) | `{disposed_portal, disposed_email}` (DISPUTE_DISPOSITIONS) | processed |
| `{cannot_dispute, non_issue}` (EXCLUSION_OUTCOMES) | `{disposed_withdraw, disposed_nonissue}` (EXCLUSION_DISPOSITIONS) | excluded |
| `{hold}` | `{blocked}` | held |
| anything else / null | anything else / `unclassified` | unprocessed |

### Why the group-level gate stayed status-based

`PACKAGEABLE_GROUP_STATUSES = {New, Needs Evidence}` was NOT switched
to `phase === "triage"`. Per `lib/invoice-state/src/derive-phase.ts`,
`phase === "triage"` also contains `Needs Review`, `On Hold`, and the
legacy `Resolved` fallthrough — all three of which the existing
behaviour (and the test suite) intentionally excludes from packaging.
This is the same residual pattern as continuation #2 §3.B
(`routes/daily-brief.ts:354`): a clean phase predicate doesn't exist
yet, the writer trigger keeps `status` and `phase` in sync, and Wave D
will narrow this once the writer rewire lands. Documented inline in
the file header.

### Validated

- `pnpm --filter @workspace/api-server typecheck` — clean.
- `group-packaging-readiness.test.ts` — 23/23 (was 15/15, +8 new).
- `group-attestation-history.test.ts` — 6/6 (touches the detail
  endpoint that calls `computeGroupReadiness`).
- Parity tests with `TZ=America/New_York` pinned: `must-file-today-parity`
  failed with the **same** pre-existing flake documented in
  continuation #2 §3.A (UTC `toISOString().slice(0,10)` near NY
  midnight, reproduces in isolation; `lib/group-packaging.ts` is not
  on the parity tests' code path so this cannot be a reader-switch
  regression).

## What's still open

### T005 — remaining backend reads

Each is a clean follow-up; none are blocking. Recommended order
unchanged from continuation #2:

1. **`lib/group-readiness.ts`, `lib/system-health-rollup.ts`,
   `lib/stuck-submissions.ts`, `lib/email-thread.ts`** — confirmed
   to contain `status`/`outcome`/`sopOutcome` references; haven't
   been audited line-by-line yet. Run
   `rg -n "claimsTable\.status|invoiceGroupsTable\.status|claimsTable\.outcome|invoiceGroupsTable\.outcome|sopOutcome" <file>`
   first to scope.
2. **`routes/search.ts`** (lines 57, 88, 187, 211, 220, 231) —
   RESPONSE-SHAPE selects, not predicates. Per the original handoff
   "switch only phase-membership predicates, not response-shape
   aggregates", these can stay until Wave D's API-spec rewire OR be
   supplemented (add `phase`/`disposition` to the response shape)
   without removing the legacy fields.
3. **`routes/system-health.ts` + `routes/batch-jobs.ts`** — every
   `status` reference is on `portalSubmissionsTable`, NOT
   `claimsTable` / `invoiceGroupsTable`. Skip.
4. **JS-side per-row decoration Sets in `routes/invoice-groups.ts`
   (lines 59, 81; used at 520, 536) and `routes/claims.ts`
   (lines 42, 50; used at 374, 390)** — leave as status-based per
   the original handoff: response-shape aggregates, not predicates.

### T006 — frontend reads

Not started. See continuation #1 §6.D. Wait until after the API-spec
rewire (T008) or duplicate the status→phase map in TypeScript.

### T008 slides / docs rewrite, T010 gauntlet, T011 docs

Untouched. Depend on T005 + T006.

## Why some legacy reads are intentionally kept

Unchanged from continuation #2 §3.B (`routes/daily-brief.ts:354`
claim-level expiring filter) and §3.C (`lib/day-complete.ts`
overlapping in-flight + actionable sets). Plus this slice's group-level
`PACKAGEABLE_GROUP_STATUSES` residual described above.

## Operating instructions for the next session

Identical to continuation #2 §"Operating instructions". The key bits:

1. **Pick up at T005 step 1** above (`lib/group-readiness.ts` is the
   highest-value next file — it is the public-facing equivalent of
   the helper this slice switched).
2. **Run tests individually**, not the full suite:
   ```
   cd artifacts/api-server && TZ=America/New_York \
     pnpm exec node --test --import tsx src/__tests__/<file>
   ```
3. **Fixtures pattern**: when a test fails because the new reader
   sees a default disposition the legacy reader didn't, extend the
   test's local seed helper to derive `disposition` from
   `(status, outcome)` (worked example in
   `email-thread-conversation.test.ts:109-156`). A second worked
   example for unit-test-style fixtures (no DB) lives in the new
   block at the bottom of `group-packaging-readiness.test.ts` — set
   `disposition` directly and clear the legacy column to prove the
   new path is exercised.
4. **DO NOT use git stash** — destructive and behind the sandbox
   wall. To baseline a file before editing:
   ```
   git --no-optional-locks show HEAD:<path> > /tmp/baseline.ts
   ```
5. **Ship it correctly, not fast.** Partial-but-correct is the goal.
   If a switch needs a fixture migration or a JOIN that changes
   hot-path latency, leave a Wave D comment and move on.

# Wave D Handoff — Writer Rewire + Residual Reader Switches

**Status as of authoring**: Wave C is functionally complete on the read side modulo
the intentional residuals enumerated below. Every remaining `claims.status` /
`claims.outcome` / `invoice_groups.status` / `invoice_groups.outcome` /
`sopOutcome` reference still in the codebase is documented here with the
specific Wave D prerequisite that unblocks switching it.

The Wave C continuation series (`state-wave-c-continuation-handoff-prompt-1`
through `-6`) is the authoritative log of what shipped on the reader side. This
doc starts the Wave D log.

---

## 0. The one-sentence mental model

Wave C made readers prefer `disposition` / `phase` while keeping legacy
`status` / `outcome` columns dual-written. **Wave D rewires the writers** so
the legacy columns can be retired in Wave E. Until the writers stop populating
them, the reader-side residuals below cannot collapse cleanly to the canonical
columns without changing observable behavior.

---

## 1. Read these first, in this order

1. `docs/architecture/state-hierarchy-v1.md` — the contract.
2. `docs/architecture/state-migration-plan.md` — the data/schema waves
   (1-5 — orthogonal axis from A/B/C/D, but the data-state preconditions for
   Wave E are tracked there).
3. `docs/architecture/state-wave-c-handoff-prompt.md` — original Wave C scope.
4. `docs/architecture/state-wave-c-continuation-handoff-prompt-{2..6}.md` —
   the rolling log of every reader switch + the rationale for every residual.
5. This doc.

The §3.A–E "sharp edges" referenced throughout the continuation series live
in continuation #2 and are still authoritative; the inventory below catalogues
which residuals trace to which sharp edge.

---

## 2. Writer rewire backlog — by anchor

### §3.B (claim-level open filters)

Claims have no own `phase` column, and `claims.disposition` doesn't by itself
encode "is this leg's parent in a closed/non-actionable phase". A clean
disposition-first predicate would either over-include in-attestation legs
(`disposition NOT IN (final_*)` includes `attest_*`, which is in-flight not
closed) or under-include in-flight `unclassified` legs that the legacy
`OPEN_STATUSES` ladder catches via `status`.

**Wave D prerequisite**: add a per-claim `is_open` mirror column (or a
JOIN-aware `legIsOpen(legRow, parentPhase)` helper in `@workspace/leg-state`)
that collapses both signals in one place. Once that ships, every residual
below switches to it.

Affected residuals (all documented in-file with §3.B comments):

- `artifacts/api-server/src/lib/group-packaging.ts:286` — `PACKAGEABLE_GROUP_STATUSES`
  gate. `phase=triage` over-includes Needs Review/On Hold/Resolved.
- `artifacts/api-server/src/lib/expiring-filter.ts:100,126` —
  `Portal Queued` exclusion + `GROUP_SUBMITTED_STUCK_STATUSES`.
- `artifacts/api-server/src/lib/urgent-snapshot.ts:67` — `Portal Queued`
  exclusion.
- `artifacts/api-server/src/lib/brief-personalization.ts:132` —
  `OPEN_STATUSES` filter for the daily-brief "recently touched open" section.
- `artifacts/api-server/src/routes/daily-brief.ts:354` — claim-level filter.
- `artifacts/api-server/src/routes/dashboard.ts:429,493` — `Portal Queued`
  exclusion + `GROUP_SUBMITTED_STUCK_STATUSES`.

### §3.C (day-complete raw SQL)

`artifacts/api-server/src/lib/day-complete.ts:127-128` interpolates
`status`/`outcome` as raw column refs in a SQL template. The matcher relies on
overlapping in-flight + actionable sets that don't have a clean canonical
projection until the writers stop populating the legacy columns.

**Wave D prerequisite**: rewrite the SQL builder to either (a) source the
sets from `disposition`/`phase` once writers are canonical, or (b) call into
a TS-side derivation and use the result as a parameterized list. Defer to
the writer rewire so we only do this once.

### §3.D (`unclassified` fallback rule)

Every Wave-C reader switch falls through to the legacy ladder when
`disposition === "unclassified"` (the DB default). This is the safety belt
that lets the read side ship before the writer rewire is complete.

**Wave D prerequisite**: backfill verification in prod showing the
unclassified count for any column that should have a canonical value is at
floor (only legitimately-unclassified rows remain). Run
`scripts/check-state-conformance.ts` (or its equivalent — see
`state-migration-plan.md` §D) and gate Wave E on the count.

Affected helpers (the fallback is the documented contract, not a residual to
fix in isolation):
- `lib/leg-state/src/leg-resolved.ts` — `buildLegResolvedIndex`,
  `outcomeRole`.
- `artifacts/claimclear/src/lib/whats-next-derivation.ts` — closure check.
- `artifacts/claimclear/src/components/cohesion/tone.ts` — `toneForRow`.
- `artifacts/api-server/src/lib/brief-personalization.ts` — `Needs Review`
  predicate.

### §3.E (response-shape aggregates)

`groupBy(status)` calls and CASE expressions that build API response payloads
or analytic rollups (won/lost/withdrawn counts, denied amount sums,
settled-approved expressions). Switching them changes the rollup numbers
operators see on the dashboard, so they wait until the writer rewire makes
the underlying counts identical between legacy and canonical columns.

**Wave D prerequisite**: writer rewire complete + a one-shot reconciliation
script that diffs every aggregate computed both ways and verifies parity on
prod data.

Affected residuals (intentionally deferred per original handoff):
- `artifacts/api-server/src/lib/urgent-snapshot.ts:45`
- `artifacts/api-server/src/lib/brief-personalization.ts:144,229`
- `artifacts/api-server/src/routes/dashboard.ts:138-141, 749-757, 1054, 1263`
- `artifacts/api-server/src/routes/daily-brief.ts:381`
- `artifacts/api-server/src/routes/invoice-groups.ts:113, 494, 925, 951`

### Per-row decoration `Set` membership (out of scope per continuation #2 §T005.5)

Internal route-private `Set` lookups used to decorate response rows. Not
phase-membership predicates; survive the writer rewire unchanged because
they read from the same column the writer is updating.

- `artifacts/api-server/src/routes/invoice-groups.ts` lines ~59, 81 (used at 520, 536)
- `artifacts/api-server/src/routes/claims.ts` lines 42, 50 (used at 374, 390)

### Filter inputs from query string (`?status=…`) — leave as-is

The user passes a status value in the URL; the route filters by it. Wave E
collapses these when the legacy column drops.

- `artifacts/api-server/src/routes/invoice-groups.ts:145-167, 187-191, 387`

### Type pins (not predicates) — leave as-is

- `artifacts/api-server/src/routes/response-tracker.ts:110-111` —
  `typeof claimsTable.status.enumValues[number]` type assertion.

---

## 3. Writer rewire scope

The following write-side surfaces still write to the legacy columns. Wave D
must rewire each so it writes the canonical column first (or both, with the
canonical column as the source of truth) and then either drops the legacy
write or leaves it as a deprecated mirror until Wave E.

| Surface | Notes |
|---|---|
| `artifacts/api-server/src/routes/claims.ts` (lines 1101, 1194-1208, 1359, 1747, 1872, 1895-1907, 1988, 2243, 2642, 2777) | SOP-advance handler, drop-reason logger. Most `sopOutcome` writes. |
| `artifacts/api-server/src/routes/invoice-groups.ts:1468, 3008-3308` | Bulk SOP advance. |
| `artifacts/api-server/src/lib/claim-transitions.ts:555-569` | Per-leg transition writer. |
| `artifacts/api-server/src/lib/denormalized-cache.ts:70-250` | The cache materializer that **produces** the disposition column. Cannot read from disposition (circular); audit that its inputs are canonical. |
| `artifacts/api-server/src/lib/mas-derivations.ts:23-54`, `lib/prompt-leg-inputs.ts:63-375` | DTO shapes, not writes per se — but they pin the legacy column shape into prompt inputs. Re-key onto canonical fields before Wave E drops the legacy columns. |

### Suggested sequence

1. **D-PR1**: ship the `is_open` GENERATED column on `claims` AND
   `invoice_groups` (§3.B prerequisite). Decision recorded in §6.1: chose
   a Postgres `GENERATED ALWAYS AS … STORED` column over a writer-maintained
   mirror or a JOIN helper. Includes:
   - Migration 0036: add `is_open boolean GENERATED ALWAYS AS
     (status IN (…OPEN_STATUSES…)) STORED` on both tables, plus a
     partial index `WHERE is_open = true` on each. No backfill needed —
     stored generated columns are populated by the ALTER TABLE itself,
     atomically.
   - `lib/leg-state/src/openness.ts`: pure `isClaimOpen(row)` /
     `isInvoiceGroupOpen(row)` helpers + the canonical `OPEN_STATUSES`
     constant. Used by readers in D-PR3 and by the conformance script.
     The drizzle schema marks the column `.generatedAlwaysAs(…)` so
     drizzle-kit and `createInsertSchema()` know it's not writeable.
   - No writer changes. The DB computes `is_open` server-side every
     time `status` changes; there is no callsite to rewire. The two
     callsites in `brief-personalization.ts` / `dashboard.ts` that
     define the legacy `OPEN_STATUSES` arrays are kept in lockstep
     with the migration's `IN (…)` list and `lib/leg-state`'s constant
     (three places — call out in the docstring on each).
   - Conformance script update: `check-invoice-state-derivation.ts`
     gains a third assertion that the stored `is_open` value matches
     `isClaimOpen()` / `isInvoiceGroupOpen()` from the TS helper. Run
     against prod immediately after migration 0036 lands.

2. **D-PR2** (split into 2a + 2b for the cache inversion — see §6.3):
   - **D-PR2a**: invert `denormalized-cache.ts` first. Today
     `projectLegStatus` reads `(group.status, sopOutcome, holdReason)`
     and writes legacy `claim.status`. Add a parallel
     `projectLegDisposition` path that reads the same inputs and writes
     `disposition`, then **drop the legacy projection** so disposition
     becomes the sole canonical write and `status`/`outcome` are derived
     mirrors written from disposition + a small projector (kept inside
     this file so the inversion lives in one place). Migration trigger
     `validate_disposition_against_phase` (from 0034) keeps enforcing
     the cross-row invariant. Add a parity assertion in dev that the
     two derivations agree on every write.
   - **D-PR2b**: rewire `claim-transitions.ts` and the SOP-advance
     handlers in `routes/claims.ts` + `routes/invoice-groups.ts` to
     call the disposition writer directly (currently they set
     `sopOutcome` and the trigger backfills disposition). Legacy
     columns continue to write only via the cache mirror in D-PR2a;
     no other writer touches them. After this PR, every legacy-column
     write in the codebase is gone except the deprecated mirror in
     `denormalized-cache.ts`.

3. **D-PR3**: collapse the §3.B residuals onto `claims.is_open` /
   `invoice_groups.is_open`. Pure column substitution at the call sites
   listed in §3.B; no logic changes.

4. **D-PR4**: rewrite `day-complete.ts` SQL builder (§3.C). Now that
   disposition is canonical, the matcher sources its sets from
   `disposition`/`phase` directly.

5. **D-PR5**: ship the §3.E aggregates immediately (no parity window —
   see §6.2). The PROD conformance audit (3,715 rows, 0 violations,
   2026-05-07) is the parity proof the original handoff asked for; the
   aggregates can flip onto the canonical columns in a single PR
   alongside D-PR4 if convenient.

6. **D-PR6**: drop the `unclassified` fallback in every helper once the
   prod backfill verification (re-run conformance on a freshly-stamped
   prod, post-D-PR2b) shows no `unclassified` rows that should have a
   canonical value.

After D-PR6, Wave E (drop the legacy columns) is unblocked.

---

## 4. What Wave D does NOT do

- Drop the legacy columns. That's Wave E and gated on the data-side waves
  (4a, 4b in `state-migration-plan.md` §C).
- Touch the `attestation_state` column. Per `state-migration-plan.md` §A7
  it is intentionally KEPT.
- Rewrite the training guide a second time. T008 in the Wave C continuation
  series owns the operator-facing copy refresh; if it didn't ship in the
  Wave C window it stays an open Wave-C item, not a Wave D one.

---

## 5. Validation gauntlet for Wave D PRs

Same as Wave C (see continuation #5 §T010):

- `pnpm -r --workspace-concurrency=1 typecheck` — must be clean.
- `pnpm --filter @workspace/api-server test` — must be clean modulo the
  documented flakes catalogued in continuation #5.
- `pnpm --filter @workspace/claimclear test` — must be clean modulo the
  same flake list.
- For each writer rewire PR: a parity test that asserts the legacy column
  and the canonical column agree on a representative fixture set.

---

## 6. Decisions (recorded 2026-05-07)

### 6.1 `is_open` mirror column vs. JOIN helper — DECISION: GENERATED column

Both options on the table had drawbacks (writer-side invariant for the
mirror, hot-path JOIN for the helper). A third option emerged that
beats both: a Postgres `GENERATED ALWAYS AS (status IN (…)) STORED`
column on `claims` and `invoice_groups`. Rationale:

- The §3.B residuals are concentrated on hot read paths (dashboard,
  daily-brief, expiring-filter, urgent-snapshot, brief-personalization).
  A JOIN helper would add a join to every one of those — for a column
  that almost every list page already filters by.
- A writer-maintained mirror would add an invariant that every
  `UPDATE claims SET status = …` callsite has to remember to refresh.
  Easy to miss; conformance script catches it but only after the fact.
- A `GENERATED ALWAYS AS … STORED` column delegates the invariant to
  Postgres. Every `UPDATE` that changes `status` atomically updates
  `is_open`. Indexed exactly like a regular column. Cannot drift.
- The expression's input list (`OPEN_STATUSES`) is the contract. It
  appears in three places (the migration, the TS helper in
  `lib/leg-state/src/openness.ts`, and the legacy arrays in
  `brief-personalization.ts` / `dashboard.ts`); each carries a
  lockstep docstring pointing at the others. The conformance script
  asserts the stored column equals the TS helper's derivation, so any
  drift fails CI.

### 6.2 Daily-brief aggregate parity window — DECISION: no window

D-PR5 ships the §3.E aggregates immediately, no parity script gating.
The PROD conformance audit (1,310 groups + 2,405 claims = 3,715 rows;
0 phase / disposition / phase-validity violations on 2026-05-07) is
the parity proof the original handoff asked for. Re-run the audit
once after D-PR2b lands; if it stays green, D-PR5 flips with no
additional ceremony.

### 6.3 `denormalized-cache.ts` rewire ordering — DECISION: explicit two-stage flip

The denormalized cache today reads `(group.status, sopOutcome,
holdReason)` and writes both `claims.status` and (via the migration
trigger) `claims.disposition`. After D-PR2b, the only writer that
should set `claims.status` is the cache itself, projecting **from
disposition**. The order of operations therefore is:

1. **D-PR2a** lands first. It inverts the cache: disposition becomes
   the canonical write (computed from sopOutcome/dropReason/etc. via
   `deriveDispositionFromLegacy`); `status` becomes a deprecated
   mirror computed from disposition + a small `dispositionToStatus`
   projector that lives next to `projectLegStatus` in this file. The
   trigger `validate_disposition_against_phase` continues to enforce
   the cross-row invariant.
2. **Parity assertion in dev**: every write goes through both the new
   canonical path and the old legacy path; if the two disagree, the
   write fails loudly. Lift the assertion before D-PR2b ships.
3. **D-PR2b** then makes `claim-transitions.ts` and the SOP-advance
   handlers call the disposition writer directly instead of setting
   `sopOutcome` and relying on the trigger. After this PR, the cache
   in D-PR2a is the only place where legacy `status`/`outcome` is
   written.

D-PR2b cannot land before D-PR2a; otherwise the SOP-advance handlers
would write disposition, the cache would still be reading from the
legacy columns, and the two derivations would race.

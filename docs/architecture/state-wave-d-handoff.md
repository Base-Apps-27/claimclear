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

1. **D-PR1**: ship the `legIsOpen` helper / `is_open` mirror column (§3.B
   prerequisite). Do not change any callers yet.
2. **D-PR2**: rewire `claim-transitions.ts` and the SOP-advance handlers to
   make `disposition` the source of truth (legacy columns become deprecated
   mirrors). Add a parity assertion in dev that the two derivations agree.
3. **D-PR3**: collapse the §3.B residuals onto `legIsOpen`.
4. **D-PR4**: rewrite `day-complete.ts` SQL builder (§3.C).
5. **D-PR5**: parity-script for the §3.E aggregates; ship the switch once
   prod parity is green for one full daily-brief cycle.
6. **D-PR6**: drop the `unclassified` fallback in every helper once the
   prod backfill verification passes (§3.D).

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

## 6. Open questions for Wave D

1. **`is_open` mirror column vs. JOIN helper**: column is faster to read but
   adds another writer-side invariant to maintain. Helper is purer but adds
   a JOIN to every list page. Decide before D-PR1.
2. **Daily-brief aggregate parity window**: how long does prod need to run
   green on the parity script before D-PR5 can flip the switch? Suggest one
   full week including a month-end close, since some aggregates only
   surface end-of-month rollups.
3. **`denormalized-cache.ts` rewire ordering**: this writer produces the
   disposition column from the legacy columns. After D-PR2 the legacy
   columns are derived from disposition, so this file inverts. Plan the
   inversion explicitly — do not let D-PR2 land before the cache is
   re-pointed at the new source of truth.

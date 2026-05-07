# Wave D-PR6 — §G fingerprint cleanup + §3.E aggregates onto `phase`

## Status as of D-PR5 close (2026-05-07, post-prod-publish)

D-PR5 shipped (commit `6209c511`) and was published to prod. PROD
audit is clean: **0 phase_mismatch / 0 is_open** across 1,310 groups
+ 2,405 claims. Dev conformance audit holds at **41 phase_mismatch /
0 is_open** — one row better than the D-PR4 baseline, monotonic
decrease invariant intact.

The §G state-fingerprint was run on PROD for the first time in this
session and surfaced six counts. Every one was drilled and bisected
to its source — the results are the scope below.

| metric                        | count | source                                                                                  | resolution                                                          |
|-------------------------------|-------|-----------------------------------------------------------------------------------------|---------------------------------------------------------------------|
| `open_groups_missing_closure` |     0 | —                                                                                       | nothing to do                                                       |
| `dual_terminal_violation`     |     9 | migration 0034 lines 88-89 stamped `closure_reason='reattested'` alongside `reattest_completed_at` — **by design** | §G query update (shipped this session) — see "Sub-PR 1" below       |
| `claim_closure_drift`         |     2 | rows id=163 (`accepted_loss`) + id=240 (`not_contestable`)                              | one-shot UPDATE → `'cannot_dispute'` (Sub-PR 3)                     |
| `cron_drift`                  |  2894 | `cron-runs.ts:38` writer wrote `result?.status ?? "ok"` straight through; producers in `system-health-rollup.ts` + `batch-processor.ts` emit `'ok'` / `'degraded'` | **shipped this session** — writer shim + migration 0039 (Sub-PR 2)  |
| `user_drift`                  |     0 | —                                                                                       | nothing to do                                                       |
| `hold_drift`                  |     6 | free-text `hold_reason` values from pre-vocab era                                       | one-shot mapping UPDATE → enum set (Sub-PR 3)                       |

---

## What shipped in this session (D-PR6 lead-in)

### Sub-PR 1 — §G fingerprint contract update + workflow wiring
- `lib/db/scripts/check-state-fingerprint.sh` (new, executable). Inlines the §G query block, prints one-line-per-metric, **always exits 0** (informational signal, not a CI gate).
- `.replit` → `schema-drift` workflow gained a second task (`bash lib/db/scripts/check-state-fingerprint.sh`) so the fingerprint runs every workspace boot alongside `check-drift`.
- `docs/architecture/state-migration-plan.md` §G updated:
  - `dual_terminal_violation` now excludes `closure_reason='reattested'` (migration 0034's intentional dual-stamp).
  - `claim_closure_drift` valid set updated to the post-D-PR5 vocabulary (`approved/denied/cannot_dispute/reattested/expired`).
  - `open_groups_missing_closure` now keys off `phase='closed'` (canonical) instead of legacy `outcome='Withdrawn'`.
  - `user_drift` retained as `users.status NOT IN ('pending','approved','suspended')` (column does exist; an earlier scratch revision incorrectly assumed it had been dropped).
  - Inline notes explaining each predicate so a future operator doesn't re-introduce the bisection cycle.

### Sub-PR 2 — Cron Option B (writer collapse to `{running|completed|failed}`)
- `artifacts/api-server/src/lib/cron-runs.ts`:
  - New `mapResultStatus()` shim: `ok → completed`, `degraded → failed`, `failed → failed`. Producer-facing `CronRunResult.status` interface preserved (back-compat with the existing call sites in `system-health-rollup.ts` lines 134/141/235/242/248 and `batch-processor.ts` lines 353/361 — they keep emitting `'ok'`/`'degraded'`).
  - The recorder now writes the mapped value, so future cron rows land in the canonical set unconditionally.
- `lib/db/migrations/0039_cron_runs_state_collapse.sql` (+ rollback): rewrites the 2894 legacy rows in place and adds a `CHECK (status IN ('running','completed','failed'))` constraint. **Did NOT** promote the column to a Postgres enum — column is `text NOT NULL DEFAULT 'running'` and a CHECK is enough; an enum promotion would require a column rewrite under AccessExclusiveLock for no reader-side gain.
- Decision rationale: "degraded → failed" intentionally surfaces the partial-failure rows as failures in the health rollup. The partial-success narrative is preserved in `cron_runs.message`. Migration header documents this.

### Sub-PR 2.b — Cron Option B reader extension (caught in final sweep)
The original Sub-PR 2 only patched the **writer** (`mapResultStatus` shim + migration 0039). The final test sweep surfaced two `recheckPreviousRunBounces` failures because the **reader** in `artifacts/api-server/src/routes/daily-brief.ts` still spoke the legacy vocab:
- Line ~679: `if (prevRun.status !== "ok") return null` → `!== "completed"` (rows are now `completed` post-rewrite).
- Line ~747: `status: "degraded"` write → `status: "failed"` (matches the Option B mapping `degraded → failed`).
- The pure helper `evaluateBounceDowngrade` (in `lib/daily-brief-outcome.ts`) still returns the **semantic** `"ok"|"degraded"` literals; that's intentional — translation only happens at the cron_runs row boundary so the call sites read clearly.
- Test assertions in `daily-brief-bounce-recheck.test.ts` updated to expect the new vocab (`status: "failed"` for spike-downgrade rows, `"completed"` for the 7-day backstop case). Both tests now green.

**Lesson for D-PR6**: any future status-vocabulary collapse must grep both the **writer** (INSERT/UPDATE) AND **reader** (SELECT … WHERE status = '…') sites, not just the writer. Search pattern: `rg -n "status[\"']?\s*[!=]==?\s*['\"](ok|degraded)['\"]" artifacts/api-server/src lib`.

### Sub-PR 3 — D-PR5 test fallout (NOT a separate PR; part of this commit)
Two tests broke when run with the canonical `TZ=America/New_York` env (D-PR5's `?expiring=stuck` and the duplicate-of pre-submit gate both pivoted onto `phase` instead of `status`, but the seed fixtures still inserted at the schema-default `phase='triage'`):
- `artifacts/api-server/src/__tests__/duplicate-of-endpoints.test.ts` `seedGroup` — now advances `phase` AFTER the claim inserts. Has to be a post-insert UPDATE because the `validate_disposition_against_phase` trigger fires on claim INSERT/UPDATE-OF-disposition only (not on group writes), and the claim default disposition `unclassified` is only valid under `phase='triage'`. Inline comment explains this.
- `artifacts/api-server/src/__tests__/list-count-past-deadline-parity.test.ts` `seedGroup` — childless seed, so a direct `phase` write at insert is safe; just stamp `phase='submitted'` for `Portal Queued` fixtures.

The TZ "flake" was self-inflicted: `artifacts/api-server/package.json` test script sets `TZ=America/New_York`, but invoking `node --import tsx --test ...` directly bypasses it. **Always run `pnpm --filter @workspace/api-server test`** or set `TZ=America/New_York` explicitly when running individual files.

---

## Remaining D-PR6 scope

### Sub-PR 4 — 9-row dual-terminal backfill (optional; deferred decision)
The 9 dual-terminal rows (ids 18, 42, 53, 100, 148, 176, 235, 297, 474) were stamped by migration 0034 with **both** `reattest_completed_at` (legitimate Layer-1 stamp) and `closure_reason='reattested'`. The §G fingerprint update (Sub-PR 1) now treats this combo as legitimate, so the count drops to 0 without any data change.

If, on review, the operator wants to drop `closure_reason='reattested'` and keep only the timestamp (one canonical terminal marker per row instead of two), ship a one-shot `UPDATE invoice_groups SET closure_reason = NULL WHERE reattest_completed_at IS NOT NULL AND closure_reason = 'reattested'`. The §G query stays compatible either way — it's the choice between "two cooperating layers" and "single stamp". **Default: do nothing; the dual-stamp is the intended design.**

### Sub-PR 5 — Half A: §3.E status aggregates → `phase`
Carried unchanged from the original D-PR6 plan. Inventory:
- `routes/dashboard.ts:170` — `portalQueued = sum(Portal Queued + Generating Email + Ready to Review)`. Replace with a `phase ∈ {submitted, response_received}` count.
- `routes/dashboard.ts:749-757, 1054, 1263` — display reads vs state-machine reads; convert only the latter.
- `routes/invoice-groups.ts:113, 494, 925, 951` — `113` (`in-flight` filter) is a candidate; the others may be display reads.
- `lib/brief-personalization.ts:144, 229`, `routes/daily-brief.ts:381` — display reads; leave with one-line "intentionally on status" comments.
- `lib/urgent-snapshot.ts:45` — already collapsed in D-PR5; verify nothing residual.

**Acceptance**: any aggregate that is materially a state-machine predicate reads `phase`; any aggregate that is a display axis stays on `status` and is documented inline.

### Sub-PR 6 — Half B (DROPPED): the `unclassified` fallback stays
**Decision (operator, 2026-05-07)**: the 31 unclassified legs surfaced in the dev audit are genuine (no implicit canonical mapping exists). Half B is dropped — the `unclassified` arm in `deriveDispositionFromLegacy` and the corresponding union in `lib/vocab` remain. Re-evaluate only if a future audit run shows a row pattern with a non-trivial canonical mapping the deriver could be taught to apply.

### Sub-PR 7 — Trivial vocab-cleanup backfills
- **Claim closure_reason drift (2 rows)**: `UPDATE claims SET closure_reason = 'cannot_dispute' WHERE id IN (163, 240)` (rows currently hold `'accepted_loss'` and `'not_contestable'` — both pre-vocab strings whose canonical mapping is `cannot_dispute`).
- **Hold reason drift (6 rows)**: free-text → enum mapping. Inspect each row first (`SELECT id, hold_reason FROM invoice_groups WHERE status = 'On Hold' AND hold_reason NOT IN ('awaiting_internal_decision','awaiting_external_party','client_paused','other')`), then a one-shot UPDATE per cohort. Most likely targets: `'other'` and `'awaiting_external_party'`.

Both ship as dev migrations + UPDATE scripts (the prod DB is read-only via the db skill — backfills reach prod through the publish flow).

### Sub-PR 8 — Residual `closure-data-foundation.test.ts` failures (5)
Surfaced by the final full sweep (740 tests, 735 pass, **5 fail** — all in this one file). Each is the same class of D-PR5 fixture rot we already fixed in Sub-PR 3 (`duplicate-of-endpoints` / `list-count-past-deadline-parity`) but in a different test module. **Not blockers for the D-PR5 publish** — they exercise PATCH outcome paths that already work in prod; the fixtures just don't satisfy the post-D-PR5 phase contract.

Cluster A — phase not advanced before outcome PATCH (3 tests):
- `PATCH /claims/:id/outcome with Denied + structured Denied-by-Payor closure persists the closure_* columns`
- `PATCH /claims/:id/outcome with Denied (no closureReason, no structured fields) records a bare denial`
- `PATCH /claims/:id/outcome with the Non-Issue outcome persists closureReason='non_issue' (not null)`
All three fail with `400: Cannot set outcome to "Denied"/"Non-Issue" when claim is in "Needs Review" status. Valid outcomes: Pending, Withdrawn`. Fix: same pattern as Sub-PR 3 — advance the seeded claim's `phase` past `triage` (probably to `submitted` + `response_received`) before the PATCH. Likely also need to stamp `submitted_via` so the deriver doesn't kick the leg back. Use `duplicate-of-endpoints.test.ts` `seedGroup` as the template.

Cluster B — error-message regex tightened (1 test):
- `PATCH /claims/:id/outcome rejects Denied when no portal_response (or email response) is on file`
The route still returns 400; the assertion `assert.match(res.json.error, /payor.*portal response/)` no longer matches the current wording. Either widen the regex or update the assertion to the actual phrasing returned by `validateDeniedRequiresResponse` (read the route + helper, then patch the regex).

Cluster C — claim-move FK / trigger violation (1 test):
- `PATCH /invoice-groups/:id/outcome cascades closure detail and closureReason onto every non-held child claim`
Fails with a raw drizzle `UPDATE claims SET invoice_group_id = $1 …` error (no constraint message captured). Root cause is most likely the `validate_disposition_against_phase` trigger firing because the seeded claim has `disposition='unclassified'` (only valid under `phase='triage'`) but the destination group's phase is past triage. Fix: stamp a non-`unclassified` disposition AND the matching phase on the seeded claim before the move, OR stamp the group at `phase='triage'` until after the move. Same trigger we fought in Sub-PR 3.

Two separate "unrelated" bugs were also fixed in passing while diagnosing this cluster, both worth noting:
1. **`closure-data-foundation.test.ts` imageUrl prefix (5 tests)** — all `imageUrl: "https://example.com/uploads/X.png"` fixtures changed to `"/objects/uploads/X.png"` so they pass the `isValidImageUrl` guard in `routes/claim-evidence.ts` (which requires the App Storage `/objects/` prefix). This is **not** D-PR5 work — the guard predates this session — but the tests had been silently broken; the sweep just made them visible.
2. **`celebrations.test.ts` dates-guardrail violation** — `new Date("2026-05-06T12:00:00Z")` literal triggered the off-by-one date lint. Switched to the local-component constructor `new Date(2026, 4, 6, 12, 0, 0)` to match the Friday fixtures already in the file. Inline comment explains the lint rule.

---

## Session-start ritual (D-PR6 onwards)
1. **Pick the bite** — read this doc's "Remaining scope" section; pick the smallest sub-PR that unblocks the next.
2. **§G first** — the `schema-drift` workflow now runs the fingerprint at boot. Glance at the printed counts; anything non-zero that wasn't non-zero last session = drill into the rows BEFORE touching anything else.
3. **Run the right test command** — `pnpm --filter @workspace/api-server test`, never the bare `node --import tsx --test ...` form. The pnpm script sets `TZ=America/New_York`; bypassing it makes date-keyed tests fail spuriously.
4. **Bisect dual-terminal** — when a violation appears, the bisection ritual is: (a) live writer patch (search `rg -n '<column>' artifacts/api-server/src`), (b) one-shot backfill (search `rg -n '<column>' lib/db/migrations`). Both clean = the row predates the contract; widen the predicate or stamp the missing field.

---

## Validation gauntlet
Same shape as D-PR5:
```bash
# Composite refresh (required if you touch lib/vocab)
pnpm exec tsc -b lib/db lib/vocab lib/leg-state lib/invoice-state

# Typecheck
pnpm --filter @workspace/api-server exec tsc --noEmit

# Schema drift + §G fingerprint (single workflow now)
pnpm --filter @workspace/db run check-drift && bash lib/db/scripts/check-state-fingerprint.sh

# Targeted tests (always via pnpm so TZ=America/New_York is set)
pnpm --filter @workspace/api-server test

# Conformance audit (dev)
pnpm --filter @workspace/scripts run check:invoice-state-derivation
```

`dashboard-expiring.test.ts` and `urgent-today-transitions.test.ts` carry date-keyed assertions that flake when the test process inherits the host TZ (UTC) instead of `America/New_York`. The `pnpm test` script sets the env; running tests directly does not.

## Risks / known landmines
- **§3.E flip**: changing a display axis (per-status UI breakdown) onto `phase` silently flattens rows the operator expects to see broken out. **Read each site's UI consumer before flipping** — if the aggregate feeds a chart/table that lists statuses by name, leave it on status with an inline "display axis" comment.
- **D-PR5's safety-net deriver branch** still produces `closureReason='reattested'` for Resolved+Approved+reattestCompleted rows that the writer hasn't re-stamped. If the conformance audit shows `closureReason='approved'` rows the deriver wants to flip back to `'reattested'`, that's drift — fix the deriver to honour the writer's `'approved'` value (extend `LegacyClosureReasonValue` to include it).
- **Cron Option B writes (Sub-PR 2 + 2.b)** hit prod via the next publish. Until then the prod fingerprint will continue to show `cron_drift = 2894`; that's expected, not a regression. Re-run §G after the publish to confirm the migration normalised the historical rows. Dev already shows `cron_drift = 0` after applying 0039.
- **Final sweep totals (2026-05-07, end of session)**: `pnpm --filter @workspace/api-server test` → 740 tests, 735 pass, 5 fail (all in `closure-data-foundation.test.ts`, documented as Sub-PR 8 above). tsc clean. Schema-drift workflow clean. Dev §G fingerprint: `open_groups_missing_closure=3, dual_terminal_violation=0, claim_closure_drift=0, cron_drift=0, user_drift=1, hold_drift=0` (the 3 + 1 are dev fixtures — prod will differ).

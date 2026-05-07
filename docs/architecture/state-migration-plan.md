# State migration plan — schema + data, end-to-end

**Date:** 2026-05-06.
**Scope:** the executable consolidation of `docs/architecture/invoice-terminal-state.md` (the contract) and `docs/architecture/state-vocabularies-audit.md` (the census). Answers: what does the schema look like when this is done, and how do we get every existing row in prod into that final state without breaking the running app.

> **Three execution rules (locked).** Same as audit §F:
> 1. **No boot-time scripts, ever.** Every backfill is `pnpm --filter @workspace/scripts run backfill:<name> -- --apply`, run manually with explicit user approval.
> 2. **No deprecation windows.** Schema + data + code in one PR per step.
> 3. **Schema-drift CHECK in CI** must stay green. Every state-bearing text column ends up either as a pgEnum or with a CHECK constraint.

---

## A. Final-state schema target (what we're heading toward)

When all waves complete, the database looks like this. Diffs from today's schema are flagged.

### A1. Invoice groups (`invoice_groups`)

```
status              invoice_workflow_status   (NEW enum, 10 values, drops Resolved/Denied/Processed)
outcome             claim_outcome             (SHRUNK enum: Pending, Approved, Partially Approved, Withdrawn — drops Denied, Non-Issue)
closure_reason      closure_reason            (NEW enum: cannot_dispute, non_issue, denied_by_payor, expired)
closure_review_state closure_review_state     (NEW enum: pending, addressed)
hold_reason         text + CHECK              (vocabulary: 5 LEG_HOLD_REASONS)
payor_denial_reason payor_denial_reason       (NEW enum: 7 codes from lib/payor-denial-reasons)
reattest_required   boolean                   (unchanged)
reattest_completed_at timestamp               (unchanged)
... all other columns unchanged
```

### A2. Claims (`claims`)

```
status                  claim_workflow_status   (NEW enum, 11 values, drops Resolved/Denied)
outcome                 claim_outcome           (same shrunk enum as groups)
closure_reason          closure_reason          (same enum as groups)
closure_review_state    closure_review_state    (same enum)
sop_outcome             text + tightened CHECK  (drops 'dispute' — folded into 'portal_dispute')
hold_reason             text + CHECK            (vocabulary: LEG_HOLD_REASONS)
mas_action_required     mas_action              (NEW enum: cancel, none)
attestation_state       text + CHECK            (KEPT — see A6 below; original audit was wrong to mark for drop)
included_in_dispute     boolean                 (unchanged)
duplicate_of_claim_id   integer                 (unchanged)
DROPPED:
  drop_reason           — column removed (0 prod rows; writers cleaned up)
```

### A3. Portal submissions / responses / verdicts (Layer 3+4)

```
portal_submissions.status     portal_submission_status    (unchanged enum)
portal_responses.response_type response_type              (unchanged enum)
claim_verdict.outcome         text + CHECK                (unchanged: Approved, Denied, Partial)
claim_verdict.source          text + CHECK                (unchanged)
```

### A4. Infrastructure (Layer 5)

```
bot_instances.status      bot_status                 (unchanged enum)
cron_runs.status          cron_run_status            (NEW enum: running, completed, failed)
connector_health.status   connector_health_status    (NEW enum: healthy, degraded, unhealthy, unknown)
portal_batch_runs.status  portal_batch_run_status    (NEW enum: running, completed, failed, cancelled)
```

### A5. Identity (Layer 6)

```
users.role     user_role     (NEW enum: user, admin)
users.status   user_status   (NEW enum: pending, approved, suspended)
messages.role  text          (unchanged — controlled by AI SDK contract, not us)
```

### A6. Observability (cross-cutting)

```
audit_logs.action       text  (unchanged column type; vocabulary now governed by lib/observability registry)
state_events.event_key  text  (unchanged column type; same registry)
bot_activity_log.action text  (unchanged column type; same registry)
```

These three remain free-text in the DB because they are **append-only logs** with thousands of historical values it would be costly to backfill. The constraint moves to the **emit side**: `lib/observability` exports `EventKey.LegSopAdvanced` etc., and the `emitEvent` helper writes both the human-readable `audit_logs.action` and the dotted `state_events.event_key` from one call.

### A7. attestation_state — KEPT, not dropped

The original audit (§A row B3, drift bug #10) called for dropping `claims.attestation_state` as deprecated. **A targeted re-read of the codebase contradicts that** — the column has live consumers across:

- `routes/claims.ts`: `/attestation/queue` and `/attestation/complete` endpoints; the `/triage/legs/:id/attestation-state` PATCH handler
- `routes/invoice-groups.ts:1144,1604,3544–3778`: queue counts, the bulk-queue cascade, and the per-leg cascade-on-Approved logic
- `routes/dashboard.ts:206,221,324,680–697`: Reclaimed KPI definition; "queued" / "pending" attestation counts; SQL filters
- `lib/attestation.ts`: `engageMasEligibleAttestationCascade`, `computeAttestationDelta` — the per-leg state machine
- 4 components + 4 e2e/unit tests
- OpenAPI generated client + zod (~50 references)

The per-group `reattest_completed_at` is the **invoice-level** terminal stamp; the per-leg `attestation_state` is the **leg-level** queue column. They are NOT duplicates. The audit's claim that one is the live tracker and the other is dead was wrong. Final state: **keep the column**, optionally promote to pgEnum in a future cleanup. No data migration needed.

This is the only revision to the audit doc. Everything else holds.

---

## B. Existing data census (what we're touching)

Total scale today (2026-05-06):

| Table | Rows | What gets touched |
|---|---|---|
| `invoice_groups` | **1310** | 162 rows migrate to new terminal vocabulary (12.4%) |
| `claims` | **2405** | 102 rows migrate (4.2%) + 8 column drops/promotions affect all rows |
| `portal_submissions` | 382 | 0 rows migrate (clean enum already) |
| `portal_responses` | 255 | 0 rows migrate (clean enum already) |
| `claim_verdict` | 63 | 0 rows migrate (clean) |
| `audit_logs` | 6728 | 0 rows migrate (append-only) |
| `state_events` | 577 | 0 rows migrate (append-only) |
| `users` | 7 | 0 rows migrate (already conforms to canonical vocab) |
| `cron_runs` / `connector_health` / `portal_batch_runs` | various | 0 rows migrate (existing values become enum members) |

### B1. Invoice groups requiring data migration (162 rows)

| Current `(status, outcome)` | New `(status, outcome, closure_reason)` | Rows |
|---|---|---|
| `Resolved / Non-Issue` | `Resolved / Withdrawn / non_issue` | 81 |
| `Expired / Pending` | `Resolved / Withdrawn / expired` | 72 |
| `Denied / Denied` | `Resolved / Withdrawn / denied_by_payor` | 5 |
| `Denied / Pending` (stuck transitions) | `Resolved / Withdrawn / denied_by_payor` | 4 |
| **Total touched** | | **162 / 1310** |

### B2. Claims requiring data migration (102 rows)

| Current `(status, outcome)` | New `(status, outcome, closure_reason)` | Rows |
|---|---|---|
| `Expired / Pending` | `Resolved / Withdrawn / expired` | 76 |
| `Resolved / Non-Issue` | `Resolved / Withdrawn / non_issue` | 15 |
| `Denied / Denied` | `Resolved / Withdrawn / denied_by_payor` | 6 |
| `Denied / Pending` (stuck) | `Resolved / Withdrawn / denied_by_payor` | 4 |
| `Needs Review / Denied` (orphan) | `Resolved / Withdrawn / denied_by_payor` | 1 |
| **Total touched** | | **102 / 2405** |

### B3. Other data fixes

| Fix | Rows | Where |
|---|---|---|
| `closure_reason` drift backfill: `accepted_loss → denied_by_payor`, `not_contestable → cannot_dispute` | 2 | `claims.closure_reason` |
| `hold_reason` free-text normalisation: collapse to `'other'`, move original text to system note | 6 | `claims.hold_reason` |
| `hold_reason` free-text normalisation (group) | 1 | `invoice_groups.hold_reason` |
| `sop_outcome` fold: `dispute → portal_dispute` | 3 | `claims.sop_outcome` |

**Grand total:** 162 group rows + 102 claim rows + 12 surgical fixes = **276 rows of structured-state mutation** across the entire migration. Plus 7 new audit_log rows per backfill (one per writer) and ~276 new state_event rows. Everything else is schema-only (column type changes, CHECK additions, enum value drops).

---

## C. Wave-by-wave execution

Each wave is **one PR** containing drizzle migration + backfill script (if needed) + code changes. The user runs each backfill manually with `--apply` after PR review.

### Wave 1 — Pre-requisite drift fixes (6 PRs, mostly parallelisable)

**Wave 1a — `closure_reason` lock-down + drift backfill** (2 rows touched)

- **Drizzle migration:** Create `closure_reason` pgEnum with `['cannot_dispute','non_issue','denied_by_payor','expired']`. The migration's `UP` runs in this order inside a transaction:
  1. `UPDATE claims SET closure_reason = 'denied_by_payor' WHERE closure_reason = 'accepted_loss';` (1 row)
  2. `UPDATE claims SET closure_reason = 'cannot_dispute' WHERE closure_reason = 'not_contestable';` (1 row)
  3. `ALTER TABLE claims ALTER COLUMN closure_reason TYPE closure_reason USING closure_reason::closure_reason;`
  4. Same for `invoice_groups`.
- **Script:** none — backfill embedded in migration's UP because the enum cast can't succeed without it.
- **Code:** `lib/db/src/schema/claims.ts:16` — `CLOSURE_REASONS` array becomes 4 values; `lib/vocab/src/closure-reason.ts` collapses to a re-export; `lib/closure-options/CLOSURE_REASON_BANNER` gains an `expired` entry.
- **Verify:** `SELECT closure_reason, count(*) FROM claims GROUP BY 1` returns only the 4 enum values.
- **Rollback:** Migration's `DOWN` casts back to text and re-introduces the original 2 values. Code revert is one commit.

**Wave 1b — Delete `lib/vocab/src/verdict-outcome.ts`** (drift bug #5)

- **Code only.** Delete the file. Move the 3-value label map (Approved/Denied/Partial) onto `lib/db/src/enums/leg-state.ts`.
- **Verify:** `pnpm typecheck` passes (proof that nothing imported the dead vocab).
- **Risk:** Zero. The file was unimported.

**Wave 1c — Remove `Withdrawn` from client `lifecycle-phase.ts:44`**

- **Code only.** One-line edit. Mirrors the server-side fix already shipped.
- **Verify:** `pnpm test` (the existing macro-phase tests catch the change).

**Wave 1d — Promote 3 well-modelled text columns to pgEnums** (claims/groups columns)

- **Drizzle:** Three new pgEnums (`mas_action`, `closure_review_state`, `payor_denial_reason`) + ALTER COLUMN per table. Drop the now-redundant CHECKs.
- **Script:** None — data already conforms (verified in audit §B).
- **Code:** `lib/payor-denial-reasons` re-exports `enumValues` instead of declaring its own union.
- **Verify:** Drizzle generated types match. `pnpm check:vocab-drift` passes.

**Wave 1e — Infrastructure layer enum promotions** (Layer 5)

- **Drizzle:** Three new pgEnums:
  - `cron_run_status` = `running, completed, failed`
  - `connector_health_status` = `healthy, degraded, unhealthy, unknown`
  - `portal_batch_run_status` = `running, completed, failed, cancelled`
  - The migration's UP `SELECT DISTINCT status FROM ...` to confirm prod values are subsets before the cast; aborts if not.
- **Script:** None.
- **Code:** Schema files updated; consumers (cron runner, health probe, bot worker) typecheck against the enums.

**Wave 1f — Identity layer enum promotions** (Layer 6)

- **Drizzle:** Two new pgEnums:
  - `user_role` = `user, admin`
  - `user_status` = `pending, approved, suspended`
- **Script:** None — current prod data is `role='user'` and `status='approved'` (single values), both inside the new enums.
- **Code:** `auth.ts` schema; auth middleware's role check becomes typed.

### Wave 2 — Shared infrastructure (4 PRs, no data, no scripts)

**Wave 2a — `lib/macro-phase` package**

- New package consolidating `STATUSES_BY_PHASE`, `getMacroPhase`, `getGroupMacroPhase`, `LIFECYCLE_TABS`, `PHASE_ORDER`, `ENGAGEMENT_NEEDED_PHASES`. Both `api-server/src/lib/macro-phase.ts` and `claimclear/src/lib/lifecycle-phase.ts` reduce to thin re-exports, then are deleted.
- **Verify:** Existing macro-phase + lifecycle-phase tests pass against the new package; cross-package vitest case asserts server and client read the same map.

**Wave 2b — `lib/leg-state/src/invoice-terminal-state.ts`**

- Implements `getInvoiceTerminalState` per contract §3 exactly: pure function, mutual-exclusion guard, returns one of 7 terminals or `null`. Re-exported via `@workspace/leg-state`.
- Move `SYSTEM_CONTROLLED_*_STATUSES` into `lib/leg-state/src/system-controlled.ts` in the same PR.
- **Verify:** Vitest covering all 7 terminal cases + the mutual-exclusion guard.

**Wave 2c — `lib/vocab` re-export refactor + parity tests**

- Replace array literals in `claim-status.ts`, `outcome.ts`, `closure-reason.ts`, `leg-sub-status.ts`, `hold-reason.ts`, `submission-stage.ts` with re-exports of the source enum's `.enumValues`.
- Add per-file vitest case: `expect(Object.keys(LABEL_MAP)).toEqual([...SOURCE_ENUM.enumValues])`. Wire into `pnpm check:vocab-drift`.

**Wave 2d — `lib/observability` registry**

- New package with an `EventKey` enum-like registry: each event has `humanAction` (snake_case) and `machineKey` (dotted). New `emitEvent(EventKey.LegSopAdvanced, ctx)` helper writes both the `audit_logs` row and the `state_events` row from one call. `bot_activity_log` joins the same registry.
- **Verify:** Per-event vitest case asserts the helper writes both rows; CI lint that flags any direct `db.insert(auditLogsTable)` outside the helper.

### Wave 3 — Terminal-state contract enforcement (5 PRs, then the big backfill)

**Wave 3a — Rewrite `closure-validation.ts` matrix**

- `Withdrawn` accepts all 4 sub-reasons (`cannot_dispute`, `non_issue`, `denied_by_payor`, `expired`). The `Denied` and `Non-Issue` outcome paths are removed entirely (server transitions reject them after Wave 4 clears them; rejection here is fine because no UI surface still emits them).

**Wave 3b — Replace four parallel terminality predicates with the helper**

- Every `status ∈ {Resolved, Denied, Expired}`, `outcome !== 'Pending'`, `reattestCompletedAt != null`, `closureReason != null` site listed in contract §F switches to `getInvoiceTerminalState(group).terminal !== null`.
- The 3 raw-SQL strings in §F7 read from a typed `TERMINAL_STATUS_LIST` constant.

**Wave 3c — Bridge per-leg `Partial` ↔ per-group `Partially Approved`**

- `lib/leg-state/src/verdict.ts`: `verdictOutcomeToGroupOutcome()`, `groupOutcomeToVerdictOutcome()`. Replace raw `=== 'Partial'` comparisons in `routes/invoice-groups.ts:3537,3696` and `lib/denormalized-cache.ts:263`.

**Wave 3d — Wire Re-attest CTA to the helper**

- `routes/invoice-groups.ts:3430-3542` (`/reattest/queue` and `/reattest/complete`) and `components/invoice-group-action-slot.tsx` gate on `getInvoiceTerminalState`. Closes the original #302 bug — the 9 prod groups currently re-attested-but-not-terminal stop being orphans.

**Wave 3e — One-shot terminal-state backfill** (the big one — 264 rows)

- `scripts/src/migrations/2026-05-terminal-state-lockdown-backfill.ts`, modeled on the existing `2026-05-pre-group-leg-sop-outcome-backfill.ts` template. Same structure: dry-run by default, `--apply` writes, audit-stamped, idempotent.
- **Behaviour, in order, in one transaction per row:**
  1. Pull all `invoice_groups` matching: `(status='Resolved' AND outcome='Non-Issue') OR (status='Expired') OR (status='Denied')`.
  2. For each, compute the new tuple per the §B1 mapping table.
  3. `UPDATE invoice_groups SET status='Resolved', outcome='Withdrawn', closure_reason=<mapped>` plus the closure metadata defaults from contract §6.
  4. `INSERT INTO audit_logs (action, claim_id, invoice_group_id, details, metadata)` with `action='terminal_state_lockdown_backfill_group'`, `metadata={backfillId, source, from: <prev tuple>, to: <new tuple>}`.
  5. `INSERT INTO state_events (event_key, ...)` mirror via the new `emitEvent` helper.
  6. Repeat for the 102 `claims` rows.
- **Idempotency:** Re-running matches zero rows because the predicate filters to the deprecated tuples. Once stamped, they no longer match.
- **Output:** Per-table summary + sample of 5 rows + total writes.
- **To run:**
  ```
  # dry-run
  pnpm --filter @workspace/scripts run backfill:terminal-state-lockdown
  # apply
  pnpm --filter @workspace/scripts run backfill:terminal-state-lockdown -- --apply
  ```
- **Verify after apply:**
  ```sql
  SELECT status, outcome, count(*) FROM invoice_groups GROUP BY 1, 2;
  -- Expected: zero rows for (Denied/*), (Expired/*), (Resolved/Non-Issue).
  -- (Resolved/Withdrawn) increases by 162.
  SELECT closure_reason, count(*) FROM invoice_groups WHERE outcome='Withdrawn' GROUP BY 1;
  -- Expected: cannot_dispute, non_issue, denied_by_payor, expired (no nulls).
  ```
- **Rollback:** The audit_log rows carry the full `from` tuple. A rollback script reads them and inverts. Not built by default; build only if needed.

### Wave 4 — Schema cleanup (only after Wave 3e applies cleanly)

**Wave 4a — Shrink `claim_outcome` enum** (drop `Denied`, `Non-Issue`)

- **Drizzle:** Postgres enum value removal requires the rename-and-recreate dance:
  ```sql
  ALTER TYPE claim_outcome RENAME TO claim_outcome_old;
  CREATE TYPE claim_outcome AS ENUM ('Pending','Approved','Partially Approved','Withdrawn');
  ALTER TABLE claims ALTER COLUMN outcome TYPE claim_outcome USING outcome::text::claim_outcome;
  ALTER TABLE invoice_groups ALTER COLUMN outcome TYPE claim_outcome USING outcome::text::claim_outcome;
  DROP TYPE claim_outcome_old;
  ```
- The `USING` cast fails if any row still holds `Denied` or `Non-Issue` — that's the safety belt that proves Wave 3e cleared everything.
- **Code:** Remove `Denied` and `Non-Issue` from every TS literal union; label maps lose their entries.

**Wave 4b — Split `claim_status` into per-table enums**

- **Drizzle:** Create `claim_workflow_status` (drops `Resolved`, `Denied`) and `invoice_workflow_status` (drops `Resolved`, `Denied`, AND `Processed`). ALTER both columns. Drop the old `claim_status` type.
- **Code:** `claimsTable.status` typing splits from `invoiceGroupsTable.status`. The shared `ClaimStatus` type alias becomes two distinct types.

**Wave 4c — Drop `claims.drop_reason` column**

- **Drizzle:** `ALTER TABLE claims DROP COLUMN drop_reason;` plus drop the existing CHECK.
- **Code:** Remove the writers in `routes/claims.ts:1989,1874,2643`, `routes/invoice-groups.ts:3272`, the SOP advance player, and the schema. Update OpenAPI spec + regen `lib/api-zod` and `lib/api-client-react/generated`.
- **Risk:** Higher than it looks because of the OpenAPI codegen blast radius (~30 generated files reference `dropReason`). The blast is mechanical though — `pnpm codegen` produces all the diffs.

**Wave 4d — Fold `sop_outcome.dispute → portal_dispute`** (3 rows)

- **Drizzle:** `UPDATE claims SET sop_outcome='portal_dispute' WHERE sop_outcome='dispute';` then tighten the CHECK to drop `'dispute'`.
- **Code:** Remove the `=== 'dispute'` branches in `outcomeRole` and `deriveLegSubStatus`. They currently treat both identically — the merge is cosmetic but eliminates a long-standing footgun.

**Wave 4e — Normalise `hold_reason` free-text + add CHECK** (7 rows)

- **Script:** Run the existing `2026-05-per-leg-state-backfill.ts` normaliser against prod's 6 claim rows + 1 group row. For each, set `hold_reason='other'` and append the original text to a system `note` row so the operator context isn't lost.
- **Drizzle:** Add CHECK `hold_reason IS NULL OR hold_reason IN (LEG_HOLD_REASONS)` on both tables.
- **Verify:** `SELECT hold_reason, count(*) FROM claims GROUP BY 1` shows only the canonical 5 values + null.

**No Wave 4f — `attestation_state` is kept** (per A7 above).

### Wave 5 — Documentation

- Update `replit.md` with a 4-line "State vocabulary model" section pointing at:
  - `docs/architecture/invoice-terminal-state.md` (the contract)
  - `docs/architecture/state-vocabularies-audit.md` (the census)
  - `docs/architecture/state-migration-plan.md` (this doc)
- Mark the audit's drift bug #10 as **revised** (attestation_state stays).

---

## D. Verification queries (run before & after each wave)

These go in a `scripts/src/check-state-conformance.ts` that reports drift in one place:

```sql
-- D1. Closure reason conformance (Wave 1a)
SELECT 'claims' tbl, closure_reason, count(*) FROM claims GROUP BY 2
UNION ALL
SELECT 'groups', closure_reason, count(*) FROM invoice_groups GROUP BY 2
ORDER BY 1, 2;
-- Expected after Wave 1a: only NULL or one of the 4 canonical values.

-- D2. Invoice (status, outcome) conformance (Wave 3e)
SELECT status, outcome, count(*) FROM invoice_groups GROUP BY 1, 2 ORDER BY 3 DESC;
-- Expected after Wave 3e: zero rows in (Resolved, Non-Issue), (Expired, *), (Denied, *).

-- D3. Claim (status, outcome) conformance (Wave 3e)
SELECT status, outcome, count(*) FROM claims GROUP BY 1, 2 ORDER BY 3 DESC;
-- Same expected outcome.

-- D4. Terminal-state mutual exclusion (Wave 2b helper)
SELECT id FROM invoice_groups
WHERE reattest_completed_at IS NOT NULL AND closure_reason IS NOT NULL;
-- Expected: zero rows. Helper enforces this; query catches violations.

-- D5. Hold reason conformance (Wave 4e)
SELECT 'claims' tbl, hold_reason, count(*) FROM claims WHERE hold_reason IS NOT NULL GROUP BY 2
UNION ALL
SELECT 'groups', hold_reason, count(*) FROM invoice_groups WHERE hold_reason IS NOT NULL GROUP BY 2;
-- Expected after Wave 4e: only the 5 canonical LEG_HOLD_REASONS values.

-- D6. SOP outcome conformance (Wave 4d)
SELECT sop_outcome, count(*) FROM claims WHERE sop_outcome IS NOT NULL GROUP BY 1;
-- Expected after Wave 4d: dispute count is zero.

-- D7. Stuck transition states (any wave)
SELECT id, status, outcome FROM invoice_groups
WHERE (status='Denied' AND outcome='Pending') OR (outcome='Denied' AND status NOT IN ('Awaiting Response'))
   OR (outcome='Non-Issue' AND status NOT IN ('Resolved'));
-- Expected: zero rows once Wave 3e applies.

-- D8. Vocabulary parity (Wave 2c, runs in CI)
-- Implemented as vitest:
-- expect(Object.keys(CLAIM_STATUS_LABEL)).toEqual([...claimsTable.status.enumValues]);
```

---

## E. Risk + sequencing summary

| Wave | Touches data? | Touches schema? | Blast radius | Reversible? |
|---|---|---|---|---|
| 1a | 2 rows | YES (new enum) | Low | Yes (DOWN cast back to text) |
| 1b | No | No | Zero | Yes (revert commit) |
| 1c | No | No | Zero | Yes |
| 1d | No | YES (3 enums) | Low | Yes |
| 1e | No | YES (3 enums) | Low | Yes |
| 1f | No | YES (2 enums) | Low | Yes |
| 2a–d | No | No | Code-only refactor | Yes |
| 3a–d | No | No | Code-only refactor | Yes |
| **3e** | **264 rows** | No | Medium — this is the big one | Yes (audit_log rows hold the inverse) |
| 4a | No (Wave 3e cleared) | YES (enum shrink) | Medium | Migration's USING cast is the safety belt |
| 4b | No | YES (enum split) | Medium | Same |
| 4c | No (column unused) | YES (drop column) | High (OpenAPI codegen) | One-way; rebuild from git history if needed |
| 4d | 3 rows | YES (CHECK tighten) | Low | Yes |
| 4e | 7 rows | YES (CHECK add) | Low | Yes |
| 5 | No | No | Docs | n/a |

## F. Critical sequencing constraints

1. **Wave 3e must apply BEFORE Wave 4a/4b** — the enum shrink's USING cast fails if any row still holds the deprecated values.
2. **Wave 1a must apply BEFORE Wave 3a** — the validation matrix can't accept `expired` until the value exists in the enum.
3. **Wave 2b must apply BEFORE Wave 3b** — can't replace predicates with a helper that doesn't exist yet.
4. **Wave 4c (drop drop_reason) is independent** — can ship anywhere after Wave 1.
5. **Waves 1b, 1c, 1d, 1e, 1f are mutually independent** — can ship in any order or in parallel.
6. **Waves 2a, 2c, 2d are independent of each other and of Wave 1.** Wave 2b depends on no other wave.

## G. What "done" looks like

A single SQL query, run on prod, returns these counts. The canonical
implementation lives in `lib/db/scripts/check-state-fingerprint.sh`
and is wired into the `schema-drift` workflow as a session-start
ritual (Wave D-PR6, 2026-05-07) — read the printed counts at workspace
boot and drill into anything non-zero.

```sql
-- The whole audit collapses to this fingerprint.
SELECT
  -- Layer 1: invoice terminal state
  (SELECT count(*) FROM invoice_groups WHERE phase = 'closed' AND closure_reason IS NULL AND reattest_completed_at IS NULL) AS open_groups_missing_closure,
  -- Dual-terminal: ONLY non-reattested combos count as a violation.
  -- Migration 0034 deliberately stamps `closure_reason='reattested'`
  -- alongside `reattest_completed_at` — that is the design (Layer 1
  -- timestamp + Layer 2 vocabulary on the same row), not drift. Real
  -- violations are rows where `closure_reason` carries a *different*
  -- terminal narrative (e.g. 'expired', 'cannot_dispute', 'approved')
  -- while `reattest_completed_at` is also stamped.
  (SELECT count(*) FROM invoice_groups WHERE reattest_completed_at IS NOT NULL AND closure_reason IS NOT NULL AND closure_reason <> 'reattested') AS dual_terminal_violation,
  -- Layer 2: claim drift
  (SELECT count(*) FROM claims WHERE closure_reason IS NOT NULL AND closure_reason NOT IN ('approved','denied','cannot_dispute','reattested','expired')) AS claim_closure_drift,
  -- Layer 5: infra free-text
  -- Wave D-PR6 / migration 0039 normalises legacy 'ok'/'degraded'
  -- producer strings to the canonical {running|completed|failed}
  -- set and adds a CHECK constraint. The `mapResultStatus` shim in
  -- artifacts/api-server/src/lib/cron-runs.ts ensures future writes
  -- never re-emit the legacy strings, so this count should hold at 0.
  (SELECT count(*) FROM cron_runs WHERE status NOT IN ('running','completed','failed')) AS cron_drift,
  -- Layer 6: identity free-text
  (SELECT count(*) FROM users WHERE status NOT IN ('pending','approved','suspended')) AS user_drift,
  -- Hold reason normalisation (carried into D-PR7 — see handoff doc)
  (SELECT count(*) FROM invoice_groups WHERE status = 'On Hold' AND hold_reason IS NOT NULL AND hold_reason NOT IN ('awaiting_internal_decision','awaiting_external_party','client_paused','other')) AS hold_drift;
-- All zeros = done.
```

The bash wrapper around this query exits 0 unconditionally — the
fingerprint is informational, not a CI gate. A non-zero count means
"a writer (or a one-shot migration backfill) violated the layered
terminal contract; drill into the listed rows and fix forward".
Hard-failing on legitimate non-zero counts (e.g. the 31 fallback
`unclassified` legs the operator decided to keep in D-PR6) would
force a workflow-level allowlist for every audit decision.

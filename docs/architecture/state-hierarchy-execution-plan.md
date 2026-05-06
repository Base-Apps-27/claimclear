# Hierarchical state machine — execution plan

**Date:** 2026-05-06.
**Status:** Plan-of-record execution document. Companion to `state-hierarchy-v1.md` (the model brief).
**Purpose:** Give operationally complete, anti-slop-audited, blast-radius-aware execution steps for landing the hierarchical state machine.

---

## How to read this document

Each wave defines:

1. **Goal** — one sentence.
2. **Preconditions** — what must be true before starting.
3. **Steps** — numbered, file-level, in execution order.
4. **Anti-slop audits** — forced gates that must produce a specific result (zero rows, expected count, matching hash, etc.) before the wave is considered complete. These exist to catch the specific failure modes I'm prone to: missing a writer site, miscounting prod rows, marking work done because tests passed without checking the actual behavior, bundling unrelated changes.
5. **Validation queries** — SQL (read-only, against prod) + code-level checks, copy-pasteable.
6. **Done definition** — binary, falsifiable.
7. **Rollback procedure** — exactly how to back out if something fails.

**"Anti-slop" defined.** Five failure modes this plan must defend against:

| Slop pattern | What it looks like | The audit that catches it |
|---|---|---|
| **Missed call site** | "I migrated all the writers" — but `rg` finds one I missed | Mandatory zero-result `rg` queries between waves |
| **Optimistic test coverage** | "Tests pass" — but the tests fixtured the old vocab and never exercised the new path | Test-fixture audit: tests must use new vocab AND old vocab during dual-write window |
| **Row-count drift** | Backfill ran, no errors — but it skipped 7 rows because of an unhandled NULL | Pre-migration census + post-migration count assertion, exact equality |
| **Silent payload shape break** | Client UI keeps rendering — but micro-interaction never fires because SSE field renamed | SSE payload contract test + manual smoke against running app |
| **Bundled scope creep** | Wave D PR also "fixes a small thing" in a route — and the thing breaks | Per-wave PR scope manifest; reviewer rejects out-of-scope edits |

---

## 1. Blast radius inventory

Every file/system affected by the topology change. Organized by domain so it can be reviewed completely before Wave A starts.

### 1.1 Database layer
| File | Today's role | Wave touched |
|---|---|---|
| `lib/db/src/schema/invoice-groups.ts` | `status` + `outcome` columns | B (add phase), E (drop status/outcome) |
| `lib/db/src/schema/claims.ts` | `status` + `outcome` + `sopOutcome` + `attestationState` + `dropReason` | B (add disposition), E (drop 5 columns) |
| `lib/db/src/enums/leg-state.ts` | Per-leg sub-status enum | C (refactored to align with disposition) |
| `lib/db/migrations/*.sql` | Two new migration files | B + E |

### 1.2 Server core (api-server)
| File | Today's role | Wave touched |
|---|---|---|
| `lib/denormalized-cache.ts` | Bidirectional mirror — root cause | **D (DELETE)** |
| `lib/macro-phase.ts` | 7-value derived phase (seed of new model) | **D (DELETE)** |
| `lib/group-transitions.ts` | 3 transition functions (kernel of new model) | A (extracted to `lib/invoice-state`), D (deleted from api-server) |
| `lib/claim-transitions.ts` | 4 audit-emitting transition helpers | D (rewritten as setClaimDisposition callers) |
| `lib/attestation.ts` | Reattest queue logic | D (disposition-aware) |
| `lib/group-readiness.ts` | "Is this invoice ready to submit?" | C (reads phase instead of computing) |
| `lib/expiring-filter.ts` | Phase-aware filtering | C |
| `lib/group-packaging.ts` | computeGroupReadiness | C |
| `lib/system-health-rollup.ts` | Drift checks | C (queries reshaped to new model) |
| `lib/urgent-snapshot.ts` | "Must file today" computation | C |
| `lib/day-complete.ts` | Day-complete celebration trigger | C (reads phase) |
| `lib/email-thread.ts` | Per-thread status pill from claim outcome | C (reads disposition) |
| `lib/response-matcher.ts` | Status writes on response link | D |
| `lib/inbound-email-classifier.ts` | Reattest decisions | D |
| `lib/submission-retry.ts` | Status writes on retry | D |
| `lib/stuck-submissions.ts` | Status checks for stuck detection | C+D |
| `lib/batch-processor.ts` | 7 status writes during batch ops | D |
| `lib/observability.ts` | **NEW** in A — emit registry | A |
| `lib/sse.ts` | broadcastClaimEvent + broadcastGroupEvent payloads | C (payload includes both old+new), E (drop old) |

### 1.3 Server routes (api-server)
| File | Today's role | Wave touched |
|---|---|---|
| `routes/portal-submissions.ts` | 1 group.status writer + portal callback | D |
| `routes/invoice-groups.ts` | 3 group.status writers + ~12 audit emits + ~10 eventKeys | C+D |
| `routes/claims.ts` | 5 claim.status writers + ~13 eventKeys | C+D |
| `routes/admin.ts` | Re-open path | D |
| `routes/import.ts` | Default new-invoice phase | D |
| `routes/dashboard.ts` | KPI rollups | C |
| `routes/response-tracker.ts` | **2 ADDITIONAL terminal-state predicates not in audit** (drift bug #12 + #13) | C |
| `routes/responses.ts` | Response inbox | C |
| `routes/daily-brief.ts` | Daily brief generation | C |
| `routes/search.ts` | Search filtering by status | C |
| `routes/batch-jobs.ts` | Batch job listing | C |
| `routes/system-health.ts` | Health endpoints | C |

### 1.4 OpenAPI + generated clients
| File | Wave touched |
|---|---|
| `lib/api-spec/openapi.yaml` | C (add phase/disposition fields, deprecate status/outcome), E (delete deprecated) |
| `lib/api-zod/src/generated/**` | Regen on C, regen on E |
| `lib/api-client-react/src/generated/**` | Regen on C, regen on E |
| `lib/api-zod/src/generated/types/invoiceGroupResponseMacroPhase.ts` (and 7 sibling files) | E (DELETE — macroPhase removed from spec) |

### 1.5 Frontend (claimclear)
| File | Today's role | Wave touched |
|---|---|---|
| `src/lib/lifecycle-phase.ts` | Client-side macro-phase derivation | **D (DELETE)** |
| `src/lib/sop-terminal-routing.ts` | SOP-driven status assignments | C |
| `src/lib/whats-next-derivation.ts` | Verdict mix → next action | C (disposition-aware) |
| `src/lib/sop-transcript.ts` | SOP outcome transcript | C |
| `src/lib/prompt-context-counters.ts` | AI prompt counters | C |
| `src/lib/sop-sibling-eligibility.ts` | Sibling-leg eligibility | C |
| `src/components/cohesion/tone.ts` | **`toneForStatus()` switches on 13 raw status strings** — micro-interaction color/tone driver | C (rewrite to `toneForPhase` + `toneForDisposition`) |
| `src/components/leg-sub-status-pill.tsx` | Per-leg state pill | C |
| `src/components/per-leg-verdict-picker.tsx` | Verdict selection | C |
| `src/components/invoice-group-detail-v2.tsx` | Invoice detail page | C |
| `src/components/claim-detail-v2.tsx` | Claim detail page | C |
| `src/components/leg-conclusion-row.tsx` | Conclusion row in SOP | C |
| `src/components/queue-needs-review-panel.tsx` | Needs-review panel | C |
| `src/components/classify-dialog.tsx` | Classification dialog | C |
| `src/components/invoice-group-submission-gauntlet.tsx` | Submission gauntlet | C |
| `src/components/hold-reason-select.tsx` | Hold reason picker | C (hold becomes flag) |
| `src/components/decision-tree/per-leg-context-editor.tsx` | Per-leg context editor | C |
| `src/pages/dashboard.tsx` | Main dashboard | C |
| `src/pages/queue.tsx` | Invoice queue | C |
| `src/pages/invoice-groups.tsx` | Invoice groups list | C |
| `src/pages/claims.tsx` | Claims list | C |
| `src/pages/responses-awaiting-review.tsx` | Response review queue | C |
| `src/pages/insights.tsx` | Insights/KPI page | C |
| `src/components/layout.tsx` | Global SSE subscription | C |

### 1.6 Micro-interaction engine (Task #509) — special call-out
**This is the system the user explicitly flagged as at-risk.** It is driven by status transitions through three layers:

| Layer | File | What breaks if status flow changes |
|---|---|---|
| **Tone selection** | `cohesion/tone.ts` `toneForStatus()` | 13-case switch on raw status strings → if status is renamed, tone falls through to `muted` — pill colors silently degrade |
| **Transition detection** | `useActorCausedTransition` | Watches the `status` field of objects via `useEffect` — if the field name changes, no transitions detected, micro-interactions never fire |
| **Celebration triggers** | `celebrations.ts` `fireCelebration(tier)` | Called from components that observe state via the above hooks — silent regression if upstream layers fail |

**Specific celebrations at risk:**
- Decision-tree checkmark (fires on SOP completion → `disposed_*`)
- Group-cleared card fade (fires on `phase=closed`)
- Day-complete confetti (fires when all today's invoices reach `phase >= submitted`)
- Save breath (fires on disposition change)
- Number ticker (animates KPI deltas — KPIs come from phase rollups)
- Bulk row shimmer (fires on bulk dispositions)

**Anti-slop audit (Wave C):** Component preview each celebration trigger in the mockup-sandbox before publish. Manual confetti verification per Task #509's step 7. Snapshot test of `toneForPhase` returns expected color for every phase.

### 1.7 Cron / batch / bot
| File | Today's role | Wave touched |
|---|---|---|
| `bot/batch-worker.ts` | Background batch processor | D |
| `bot/cron-payor-response-scan.ts` | Polls for payor responses | D |
| `bot/cron-stuck-submissions.ts` (if exists) | Stuck detection | D |
| `scripts/oneshot-promote-stuck-attestation-legs.ts` | One-off backfill | D (rewritten to use disposition) |
| `scripts/llm-first-classifier-backfill.ts` | LLM classifier backfill | D |

### 1.8 Tests
| Set | Count | Wave touched |
|---|---|---|
| `__tests__/*.test.ts` files fixturing `status: "..."` / `outcome: "..."` | **19 files** | A (add new fixture variants), C+D (migrate fixtures), E (drop old fixtures) |
| Specific high-risk tests | `submit-flow-gates.test.ts`, `attestation.test.ts`, `mas-reattest-offline.test.ts`, `urgent-today-transitions.test.ts`, `group-reattest-queue.test.ts`, `must-file-today-parity.test.ts`, `endpoint-action-contract.test.ts` | Each must have BOTH old-shape and new-shape variants during dual-write window |

### 1.9 Training material — special call-out
**This is end-user training material.** It teaches operators the current vocabulary. If we ship Wave C with new phase names but training still teaches "Awaiting Response" → operator confusion → bug reports.

| File | Wave touched |
|---|---|
| `artifacts/training-guide/src/pages/slides/StatusLifecycle.tsx` | **Rewrite required** — entire slide is dedicated to teaching the 13-status vocabulary; replaces with 7-phase + disposition vocab |
| `artifacts/training-guide/src/pages/slides/ReviewQueue.tsx` | C (status references → phase) |
| `artifacts/training-guide/src/pages/slides/InvoiceGroupDetail.tsx` | C |
| `artifacts/training-guide/src/pages/slides/ClaimsBulk.tsx` | C |
| `artifacts/training-guide/src/pages/slides/SubmitDispute.tsx` | C |
| `artifacts/training-guide/src/pages/slides/DailyRoutine.tsx` | C |
| `artifacts/training-guide/src/pages/slides/WorkflowPlayer.tsx` | C |
| `artifacts/training-guide/src/pages/slides/CommonPitfalls.tsx` | C |
| `artifacts/training-guide/src/pages/slides/AddEvidence.tsx` | C |
| `artifacts/training-guide/src/data/slides-manifest.json` | C (slide title updates) |

**Training must ship in the same publish as Wave C** — otherwise operators see a UI that doesn't match what they were taught.

### 1.10 SSE event payloads — special call-out
**Every claimclear page/component listed in §1.5 subscribes to these.**

`broadcastClaimEvent(event: ClaimEvent)` and `broadcastGroupEvent(event: GroupEvent)` send JSON payloads that clients destructure. Today the payloads include `status`/`outcome` fields. Changing the field names mid-flight means subscribers stop reacting to events — UI appears stuck.

**Strategy:** SSE payloads include BOTH old and new fields during the entire dual-write window (Waves B → E). Specifically:
- Wave B ships: payload includes `{status, outcome, phase, disposition}` (additive)
- Wave C readers switch to `{phase, disposition}` (still receive old fields)
- Wave D writers switch (still emit both)
- Wave E drops `{status, outcome}` from payload (after one observation period of no consumers reading them)

**Anti-slop audit (Wave E):** before dropping old fields from SSE payload, `rg "event\.status|event\.outcome|event\?\.status|event\?\.outcome" artifacts/claimclear/src/` must return zero results.

### 1.11 Total inventory

| Category | File count |
|---|---|
| Database schema | 4 |
| API server (lib + routes + bot + scripts) | 32 |
| OpenAPI + generated clients | ~30 (regen) |
| Claimclear (lib + components + pages) | 26 |
| Tests | 19 |
| Training guide | 10 |
| **Total in-scope files** | **~120** |

Of these, ~12 are deleted, ~30 are regenerated, ~78 are edited.

---

## 2. The 7 anti-slop audits used throughout

These appear repeatedly in the wave plans. Each one is named here so the wave docs can reference them by ID.

| ID | Audit name | What it does | When it fires |
|---|---|---|---|
| **A1: Census parity** | Pre/post row count comparison | `SELECT phase, COUNT(*) FROM invoice_groups GROUP BY phase` post-Wave-B must, when projected through §6.1 mapping reverse, match the pre-Wave-0 census of `(status, outcome)` tuples. | After Wave B migration |
| **A2: Zero-rg-result** | Forced ripgrep returns no matches | E.g. `rg "denormalized-cache" artifacts/ lib/` returns zero after Wave D. Each wave specifies which queries must return zero. | End of every wave |
| **A3: Conformance script** | The `check-invoice-state-derivation.ts` from Wave A | Runs in CI on every PR, reads prod, asserts no row violates `derivePhase` / `deriveDisposition` / disposition-valid-for-phase invariants. | Every PR after Wave A |
| **A4: SSE payload contract test** | Programmatic test that asserts SSE payload includes expected fields | Wave B adds: payload must include `phase` and `disposition`. Wave E removes: payload must NOT include `status` or `outcome`. | Waves B, E |
| **A5: Test-fixture audit** | Counts of test fixtures using old vs new vocab | During dual-write window: BOTH must be > 0 (proves both paths are exercised). After Wave E: only new must be > 0. | C, D, E |
| **A6: Manual smoke runbook** | Specific operator flows that must be walked through in the running app before publish | A 12-step flow defined per wave (e.g. "Import → triage → all-classified → ready_to_submit → submit → response → reviewed → closed" for Wave D) | C, D, E |
| **A7: Lint rule effectiveness** | The `no-direct-state-update` ESLint rule must FAIL on a deliberately-introduced violation | After installing rule, commit a violation locally → confirm CI rejects → revert | A2, D |

---

## 3. Wave 0 — Pre-flight (read-only, ~30 min)

### Goal
Prove the §6 mapping covers every prod row before any code is written.

### Preconditions
- `state-hierarchy-v1.md` brief is reviewed
- This execution plan is reviewed

### Steps

1. **Census today's invoice tuple distribution.**
   ```sql
   -- Run via execute_sql with environment: production
   SELECT status, outcome, reattest_required, reattest_completed_at IS NOT NULL AS reattested,
          closure_reason, hold_reason IS NOT NULL AS held, COUNT(*) AS n
   FROM invoice_groups
   GROUP BY 1,2,3,4,5,6
   ORDER BY n DESC;
   ```
   Save output → `docs/architecture/state-pre-migration-census.md` §A.

2. **Census today's claim tuple distribution.**
   ```sql
   SELECT status, outcome, sop_outcome, attestation_state,
          included_in_dispute, duplicate_of_claim_id IS NOT NULL AS is_dup,
          drop_reason IS NOT NULL AS dropped, COUNT(*) AS n
   FROM claims
   GROUP BY 1,2,3,4,5,6,7
   ORDER BY n DESC;
   ```
   Save output → `docs/architecture/state-pre-migration-census.md` §B.

3. **Run §6.1 mapping in SQL against prod and assert no NULL results.**
   ```sql
   SELECT id, status, outcome, reattest_required, reattest_completed_at, closure_reason
   FROM invoice_groups
   WHERE
     CASE
       WHEN reattest_completed_at IS NOT NULL THEN 'closed'
       WHEN reattest_required = true AND reattest_completed_at IS NULL THEN 'awaiting_reattestation'
       WHEN status IN ('Resolved', 'Denied', 'Expired') THEN 'closed'
       WHEN status = 'Ready to Review' THEN 'response_received'
       WHEN status = 'Awaiting Response' THEN 'submitted'
       WHEN status IN ('Portal Queued', 'Generating Email') THEN 'ready_to_submit'
       WHEN status IN ('New', 'Needs Evidence', 'Needs Review', 'On Hold') THEN 'triage'
       WHEN status = 'MAS Eligible' THEN 'awaiting_reattestation'
       ELSE NULL
     END IS NULL;
   ```
   **Expected:** zero rows. Any returned row exposes a §6.1 gap → revise brief before continuing.

4. **Run §6.2 mapping in SQL against prod, same pattern, assert no NULL.** (Full SQL in appendix.)

5. **Anti-slop audit A1 baseline:** save the per-`(status, outcome)` count map as the "before" snapshot. After Wave B, the per-`phase` count map projected backward through §6.1 must equal this snapshot exactly.

### Anti-slop audits
- **A1 (baseline):** capture pre-migration counts
- **A2:** `rg "TODO|XXX|FIXME" docs/architecture/state-hierarchy-*.md` — the brief must not have unresolved TODOs

### Validation
Steps 3 and 4 produce zero rows.

### Done definition
- `state-pre-migration-census.md` exists and contains §A + §B
- §6.1 SQL returns zero rows
- §6.2 SQL returns zero rows

### Rollback
None — this wave is read-only.

### What user does next
Reviews the census file. If anything looks wrong, raises it before Wave A starts.

---

## 4. Wave A — Read-side foundations (~3 hours, 1 publish)

### Goal
Land all new logic and observability infrastructure as dead code. Zero behavior change.

### Preconditions
- Wave 0 complete with all anti-slop audits green

### Steps

#### A.1 — New `lib/invoice-state` package
1. Create package skeleton via the pnpm-workspace skill conventions:
   - `lib/invoice-state/package.json`
   - `lib/invoice-state/tsconfig.json`
   - `lib/invoice-state/src/index.ts`
2. Create `lib/invoice-state/src/phases.ts`:
   ```ts
   export const INVOICE_PHASES = [
     'triage', 'ready_to_submit', 'submitted', 'response_received',
     'reviewed', 'awaiting_reattestation', 'closed'
   ] as const;
   export type InvoicePhase = (typeof INVOICE_PHASES)[number];
   ```
3. Create `lib/invoice-state/src/dispositions.ts` — full disposition list per brief §2.
4. Create `lib/invoice-state/src/valid-dispositions-by-phase.ts` — the matrix from brief §2.
5. Create `lib/invoice-state/src/transition-table.ts` — the 8 transitions from brief §3.3.
6. Create `lib/invoice-state/src/derive-phase.ts` — implements brief §6.1.
7. Create `lib/invoice-state/src/derive-disposition.ts` — implements brief §6.2.
8. Create `lib/invoice-state/src/guards.ts` — entry-condition functions referenced in transition table.
9. Create `lib/invoice-state/src/labels.ts` — human-readable strings for phase + disposition (used by C in UI).
10. Add unit tests for each derivation, each guard, each phase/disposition match. **Fixtures lifted directly from brief §6 mapping table** (so tests literally encode the mapping spec).

#### A.2 — New `lib/observability` package
1. Create package skeleton.
2. Define `EventKey` registry as exhaustive union (catalogued from `rg "eventKey:" artifacts/api-server/src/`).
3. Define `AuditAction` registry similarly (from `rg "action:" artifacts/api-server/src/`).
4. Implement `emitEvent({ key, action, actorId, metadata, executor })` — single function that writes one `audit_logs` + one `state_events` row in one txn.
5. Refactor 4 existing emit sites to use it (start with one per area: claims route, invoice-groups route, batch-processor, response-matcher). NOT all sites yet — that's Wave D.
6. Create custom ESLint rule `no-direct-audit-log-insert`:
   - Plugin in `lib/eslint-plugin-claimclear/`
   - Rule fails on `db.insert(auditLogsTable)` outside `lib/observability/`
7. Wire rule into root `.eslintrc.cjs` or equivalent.

#### A.3 — CI conformance script
1. Create `scripts/src/check-invoice-state-derivation.ts`:
   - Connects to prod via existing pattern in scripts/
   - SELECTs every row from `invoice_groups` and `claims`
   - Runs `derivePhase` and `deriveDisposition` from `lib/invoice-state`
   - Asserts no NULL results
   - Asserts every claim's derived disposition is in `VALID_DISPOSITIONS_BY_PHASE[parent.derivedPhase]`
   - Outputs per-phase counts to stdout
2. Wire into `schema-drift` workflow:
   ```ts
   // pnpm --filter @workspace/scripts run check-invoice-state-derivation
   ```
3. Add to package.json scripts.

### Files touched
- New: `lib/invoice-state/**`, `lib/observability/**`, `scripts/src/check-invoice-state-derivation.ts`, ESLint plugin
- Modified: 4 emit sites (one each from claims, invoice-groups, batch-processor, response-matcher), `schema-drift` workflow config
- Total: ~25 new files, ~6 modified files

### Anti-slop audits
- **A2:** `rg "from ['\"]@workspace/invoice-state" artifacts/` returns zero results (proves no prod code imports the new package yet — it really is dead code)
- **A2:** `rg "from ['\"]@workspace/observability" artifacts/` returns exactly 4 results (the 4 refactored emit sites)
- **A7:** Deliberately commit `db.insert(auditLogsTable)...` in a route file → confirm CI fails → revert
- **A3 (first run):** `pnpm --filter @workspace/scripts run check-invoice-state-derivation` against prod returns zero violations

### Validation
- `pnpm typecheck` green across monorepo
- `pnpm test` green for new packages
- `schema-drift` workflow green with new step

### Done definition
- 25+ new files committed
- ESLint rule live and verified by audit A7
- Conformance script green
- Zero behavior change in any artifact (verified by manual smoke of dashboard, queue, invoice detail pages)

### Rollback
- `git revert` the wave commits. Trivial — nothing depends on the new packages yet.

### Publish gate
After review, **publish #1**. This is a low-risk deploy: dead code + 4 refactored audit emits (behaviorally identical) + ESLint rule.

### What user does next
- Confirms publish #1 is healthy in prod (no audit log anomalies, no SSE errors)
- After 24h soak, give green light for Wave B

---

## 5. Wave B — Schema + backfill (~2-3 hours, 1 publish, the big atomic one)

### Goal
Add `phase` + `disposition` columns and backfill every row in a single migration. Both columns populated but unread by application code.

### Preconditions
- Publish #1 is healthy in prod for ≥24h
- A3 conformance script has been green for 24h

### Steps

#### B.1 — Generate migration
1. Update `lib/db/src/schema/invoice-groups.ts`: add `phase: invoicePhaseEnum('phase').notNull().default('triage')`, add `phaseEnteredAt: timestamp('phase_entered_at').notNull().defaultNow()`.
2. Update `lib/db/src/schema/claims.ts`: add `disposition: claimDispositionEnum('disposition').notNull().default('unclassified')`.
3. Add the two pgEnums.
4. Run `pnpm --filter @workspace/db drizzle-kit generate` → produces base migration.

#### B.2 — Augment migration with backfill + trigger
The drizzle-generated migration only has the schema additions. We hand-augment it to be atomic:

```sql
-- 1. Schema additions (drizzle-generated)
CREATE TYPE invoice_phase AS ENUM (...);
CREATE TYPE claim_disposition AS ENUM (...);
ALTER TABLE invoice_groups ADD COLUMN phase invoice_phase NOT NULL DEFAULT 'triage';
ALTER TABLE invoice_groups ADD COLUMN phase_entered_at timestamptz NOT NULL DEFAULT NOW();
ALTER TABLE claims ADD COLUMN disposition claim_disposition NOT NULL DEFAULT 'unclassified';

-- 2. Backfill phases per §6.1 (inlined as CASE)
UPDATE invoice_groups SET phase = (CASE
  WHEN reattest_completed_at IS NOT NULL THEN 'closed'
  WHEN reattest_required AND reattest_completed_at IS NULL THEN 'awaiting_reattestation'
  WHEN status IN ('Resolved','Denied','Expired') THEN 'closed'
  ...
END)::invoice_phase;

-- Set phase_entered_at to last status change time (best-effort from audit_logs)
UPDATE invoice_groups SET phase_entered_at = COALESCE(
  (SELECT MAX(created_at) FROM audit_logs
   WHERE entity_type = 'invoice_group' AND entity_id = invoice_groups.id
     AND action LIKE '%status%'),
  created_at
);

-- 3. Backfill dispositions per §6.2 (inlined as CASE)
UPDATE claims SET disposition = (CASE
  WHEN duplicate_of_claim_id IS NOT NULL THEN 'duplicate'
  WHEN included_in_dispute = false AND sop_outcome = 'non_issue' THEN 'disposed_nonissue'
  ...
END)::claim_disposition;

-- 4. Add cross-row trigger (LAST — after backfill)
CREATE FUNCTION validate_disposition_against_phase() RETURNS trigger AS $$
DECLARE parent_phase invoice_phase;
BEGIN
  SELECT phase INTO parent_phase FROM invoice_groups WHERE id = NEW.invoice_group_id;
  IF NOT (NEW.disposition = ANY(...)) THEN  -- per VALID_DISPOSITIONS_BY_PHASE
    RAISE EXCEPTION 'disposition % not valid for phase %', NEW.disposition, parent_phase;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER claims_validate_disposition
  BEFORE INSERT OR UPDATE OF disposition ON claims
  FOR EACH ROW EXECUTE FUNCTION validate_disposition_against_phase();

-- 5. Migration audit event
INSERT INTO audit_logs (entity_type, entity_id, action, metadata, created_at)
SELECT 'invoice_group', id, 'phase_backfill_v1',
       jsonb_build_object('from_status', status, 'from_outcome', outcome, 'to_phase', phase),
       NOW()
FROM invoice_groups;
-- Same for claims
```

The order is critical: backfill MUST complete before the trigger is added, otherwise the trigger validates against backfill UPDATEs and may reject rows whose target disposition the backfill is computing.

#### B.3 — SSE payload extension
Update `lib/sse.ts` to include `phase` and `disposition` in event payloads:
```ts
export type ClaimEvent = {
  // existing fields preserved
  status: ClaimStatus;
  outcome: ClaimOutcome;
  // NEW
  disposition: ClaimDisposition;
  phaseAfter?: InvoicePhase;  // parent invoice's phase post-event
};
```
Update emit sites (4 from Wave A, no others yet) to populate the new fields.

#### B.4 — Test fixture additions
Add fixture builders in `__tests__/fixtures/state.ts`:
```ts
export function fixtureInvoice(phase: InvoicePhase = 'triage', overrides = {}) {
  return {
    status: PHASE_TO_LEGACY_STATUS[phase],   // populated for old code
    outcome: PHASE_TO_LEGACY_OUTCOME[phase], // populated for old code
    phase,                                    // populated for new code
    ...overrides,
  };
}
```
Tests that fixture invoices now use this helper. Old hand-rolled fixtures still work — new ones get phase too.

### Files touched
- `lib/db/src/schema/invoice-groups.ts`, `lib/db/src/schema/claims.ts`
- `lib/db/migrations/<timestamp>_add_phase_and_disposition.sql` (new)
- `lib/sse.ts`
- 4 emit sites' SSE payload calls
- `__tests__/fixtures/state.ts` (new)

### Anti-slop audits
- **A1:** Post-migration `SELECT phase, COUNT(*) FROM invoice_groups GROUP BY phase` mapped backward through §6.1 = pre-migration `SELECT status, outcome, COUNT(*)` exactly
- **A1:** Same for claims
- **A3:** Conformance script green after migration (it now reads the stored `phase` and asserts it equals what `derivePhase` would compute)
- **A2:** `rg "phase:|disposition:" artifacts/api-server/src/routes/ artifacts/api-server/src/lib/` — count matches expected (only the 4 emit sites + new lib/invoice-state usage)
- **A4:** New SSE contract test asserts every event payload includes `phase` and `disposition` fields
- Trigger smoke test in migration's own DOWN section verification: `INSERT INTO claims (..., disposition='verdict_approved') WHERE parent_phase='triage'` → expect rejection

### Validation
- Migration runs locally on dev DB
- `pnpm --filter @workspace/db run check-drift` green
- All existing tests pass (they read old columns, which are unchanged)
- Conformance script green against prod after publish

### Done definition
- Migration committed and runs cleanly
- A1 audit passes
- A4 audit passes
- Trigger smoke test passes
- All existing tests still green

### Rollback
- DOWN migration: drop trigger, drop columns, drop types
- Data preserved in old columns; reverting Wave B leaves prod identical to pre-Wave-B
- If migration fails partway: it's wrapped in a single transaction → atomic rollback by Postgres

### Publish gate
**Publish #2.** Migration runs on prod via the deploy's migration step. Post-deploy: re-run conformance script against prod, confirm row counts.

### What user does next
- After publish #2, run validation queries against prod via execute_sql
- Confirm phase distribution matches expectation
- ≥24h soak for any unexpected trigger firings (logged in api-server logs)

---

## 6. Wave C — Switch reads + training (~4 hours, 1 publish)

### Goal
Every read path uses `phase` / `disposition`. Old columns still written by existing writers; cache still runs. Training material updated. UI tone/colors map from new vocab.

### Preconditions
- Publish #2 healthy ≥24h
- A3 conformance green throughout

### Steps

#### C.1 — Update OpenAPI spec
1. `lib/api-spec/openapi.yaml`:
   - Add `phase: { type: string, enum: [...7 values...] }` to InvoiceGroupResponse
   - Add `disposition: { type: string, enum: [...] }` to ClaimResponse
   - Mark `status`, `outcome`, `macroPhase` as `deprecated: true` (kept for backward shape)
2. `pnpm --filter @workspace/api-spec run codegen` → regen `lib/api-zod`, `lib/api-client-react`

#### C.2 — Server: switch read paths
Each of the following routes/lib files: replace reads from `status`/`outcome` with `phase`/`disposition`. Done one file per commit so the bisect is clean:

1. `routes/dashboard.ts` (KPI queries)
2. `routes/response-tracker.ts` (**fix the 2 missed terminal predicates here**)
3. `routes/responses.ts`
4. `routes/daily-brief.ts`
5. `routes/search.ts`
6. `routes/batch-jobs.ts`
7. `routes/system-health.ts`
8. `routes/invoice-groups.ts` (GET handlers only — write handlers stay status-based)
9. `routes/claims.ts` (GET handlers only)
10. `lib/expiring-filter.ts`
11. `lib/group-packaging.ts`
12. `lib/group-readiness.ts`
13. `lib/system-health-rollup.ts`
14. `lib/urgent-snapshot.ts`
15. `lib/day-complete.ts`
16. `lib/email-thread.ts`
17. `lib/stuck-submissions.ts` (read paths)

#### C.3 — Frontend: switch read paths
1. `src/lib/lifecycle-phase.ts` — temporarily wraps `phase` (becomes a passthrough; deleted in Wave D)
2. `src/components/cohesion/tone.ts`:
   - Add `toneForPhase(phase: InvoicePhase): Tone`
   - Add `toneForDisposition(d: ClaimDisposition): Tone`
   - Keep `toneForStatus()` as a deprecated passthrough that maps status → phase first
3. `src/lib/whats-next-derivation.ts` — read disposition
4. `src/lib/sop-terminal-routing.ts` — disposition-aware
5. `src/lib/sop-transcript.ts`
6. `src/lib/prompt-context-counters.ts`
7. `src/lib/sop-sibling-eligibility.ts`
8. All 13 components/pages from §1.5

#### C.4 — Training guide rewrite (mandatory in same publish)
1. `StatusLifecycle.tsx`: rewrite slide. New content:
   - "An invoice is in one of 7 phases. Here's what each means and what action it expects from you."
   - Phase cards with friendly names, entry conditions, what the operator does
   - Disposition mini-cards showing per-phase claim states
2. `ReviewQueue.tsx`, `InvoiceGroupDetail.tsx`, etc. — replace status references with phase references
3. `slides-manifest.json`: any slide title containing status terminology gets updated

#### C.5 — Update tests
1. Tests that fixture invoices/claims via `__tests__/fixtures/state.ts` (added in Wave B) automatically get phase
2. Tests that read response payload `.status` / `.outcome` add equivalent assertion on `.phase` / `.disposition`
3. **Audit A5:** count of test files asserting `.phase` ≥ count asserting `.status`

### Files touched
~50 files. Per §1.

### Anti-slop audits
- **A2:** `rg "macroPhase|getMacroPhase" artifacts/api-server/src/routes/ artifacts/api-server/src/lib/` returns ONLY references to the deprecated function (which is now a passthrough); same query against `artifacts/claimclear/src/` should return zero (claimclear no longer derives macro phase client-side)
- **A2:** `rg "lifecyclePhase|LifecyclePhase" artifacts/claimclear/src/components/ artifacts/claimclear/src/pages/` returns zero (only the temporary passthrough file in lib/ remains)
- **A2:** `rg "toneForStatus" artifacts/claimclear/src/` returns ONLY the deprecated function definition (no callers)
- **A3:** Conformance script still green
- **A4:** SSE payload contract test still passes (payload unchanged in Wave C)
- **A5:** test file count audit
- **A6:** Manual smoke runbook (executed against running claimclear in dev):
  1. Open dashboard → KPI tiles render with correct phase counts
  2. Open invoice queue → invoices display correct phase pill with correct tone color
  3. Open invoice detail page for triage invoice → "Triage" phase shown, claims display dispositions
  4. Open invoice detail for closed invoice → "Closed" phase, closure_reason displayed
  5. Open responses-awaiting-review → list filters by `phase=response_received`
  6. Open insights → KPIs come from phase rollups
  7. Open training-guide → StatusLifecycle slide shows new vocabulary
  8. Open training-guide → ReviewQueue slide screenshots match running app
  9. SSE: open invoice detail in two tabs, edit one, confirm other updates (proves SSE payload still has fields client reads)
  10. Micro-interaction: trigger a disposition → save breath fires
  11. Micro-interaction: complete decision tree → checkmark fires
  12. Micro-interaction: invoice clears → card-fade fires
- Component preview each at-risk celebration in mockup-sandbox

### Validation
- `pnpm typecheck` green across all artifacts
- `pnpm test` green
- All A2 ripgrep audits pass
- Manual smoke 12-step passes

### Done definition
- All read paths read new columns
- Training material updated
- Tone/UI driven by phase/disposition
- All audits green
- Manual smoke runbook complete

### Rollback
- `git revert` Wave C commits
- Old columns still populated by writers, so reverting reads is non-destructive
- Take ~5 min to re-publish

### Publish gate
**Publish #3.** Combined with Wave D? **No** — keep separate. Wave C is reversible; Wave D is the topology change. Want C in prod for ≥24h before D ships, so we can confirm:
- All UI elements render correctly with phase data
- Training guide changes are well-received
- No surprise consumer of old fields surfaces in error logs

### What user does next
- Walks through claimclear in prod
- Walks through training-guide in prod
- Confirms operators don't see anything weird
- Green-lights Wave D after ≥24h

---

## 7. Wave D — Switch writes + delete cache (~4-5 hours, 1 publish, the topology change)

### Goal
All writes go through transition functions. Bidirectional cache deleted. macro-phase / lifecycle-phase deleted. Lint rule prevents regression.

### Preconditions
- Publish #3 healthy ≥24h
- All A6 smoke runbook items green

### Steps

#### D.1 — Implement transition functions
1. `lib/invoice-state/src/transitions.ts`:
   - `transitionInvoice(invoiceId, toPhase, ctx, executor?)` — locks row, validates transition + guard, updates phase + phase_entered_at, emits via lib/observability
2. `lib/invoice-state/src/disposition.ts`:
   - `setClaimDisposition(claimId, toDisposition, ctx, executor?)` — locks claim + parent, validates against phase set, updates, emits
3. `lib/invoice-state/src/maybe-advance.ts`:
   - `maybeAdvanceInvoice(invoiceId, executor)` — checks if next legal phase's guard is satisfied + auto-advances; respects `hold_reason IS NOT NULL`

#### D.2 — Migrate the 12 server writer sites
One commit per writer site. Each commit:
1. Imports `transitionInvoice` / `setClaimDisposition`
2. Removes direct `.update().set({status: ...})`
3. Adds the new call
4. Updates audit log emit (now goes through observability registry)
5. Removes calls to `refreshGroupDerivedFields` / `refreshClaimDenormalizedCache`

Order:
1. `routes/import.ts` (simplest — new invoice always starts at triage)
2. `routes/admin.ts` (re-open path)
3. `routes/portal-submissions.ts` (operator submit click)
4. `routes/invoice-groups.ts` writers (3 sites)
5. `routes/claims.ts` writers (5 sites)
6. `lib/response-matcher.ts`
7. `lib/inbound-email-classifier.ts`
8. `lib/submission-retry.ts`
9. `lib/stuck-submissions.ts` writers
10. `lib/batch-processor.ts` (7 sites)
11. `lib/attestation.ts`
12. `bot/cron-payor-response-scan.ts` + `bot/batch-worker.ts`

After each commit: `pnpm typecheck` green, the 4 high-risk tests still pass:
- `submit-flow-gates.test.ts`
- `attestation.test.ts`
- `mas-reattest-offline.test.ts`
- `urgent-today-transitions.test.ts`

#### D.3 — Install lint rule
1. New ESLint rule `no-direct-state-update` in plugin:
   - Fires on `db.update(invoiceGroupsTable).set(obj)` where `obj` includes `status`, `outcome`, `phase`, `closureReason`, `holdReason`, `reattestRequired`, `reattestCompletedAt` outside `lib/invoice-state/`
   - Same for claimsTable with `status`, `outcome`, `disposition`, `sopOutcome`, `attestationState`
2. Wire into root config
3. **Audit A7:** deliberately introduce violation, confirm CI rejects, revert

#### D.4 — Delete the four files
```
git rm artifacts/api-server/src/lib/denormalized-cache.ts
git rm artifacts/api-server/src/lib/macro-phase.ts
git rm artifacts/claimclear/src/lib/lifecycle-phase.ts
git rm lib/vocab/src/verdict-outcome.ts  # already dead
```

Plus delete the 1 remaining `__tests__/leg-status-projector.test.ts` if it imports denormalized-cache.

#### D.5 — Migrate scripts
1. `scripts/oneshot-promote-stuck-attestation-legs.ts` → uses `setClaimDisposition`
2. `scripts/llm-first-classifier-backfill.ts` → uses new vocab

#### D.6 — Update tests
1. Each of the 19 test files: replace `status:` / `outcome:` fixtures with `phase:` / `disposition:` (now the source of truth)
2. The 7 high-risk tests get explicit transition-function call assertions

### Files touched
~30 modified, 4 deleted, ~5 new

### Anti-slop audits
- **A2:** `rg "denormalized-cache|asMirroredStatus|verdictOutcomeToClaimOutcome|refreshGroupDerivedFields|refreshClaimDenormalizedCache|MIRRORABLE_LEG_STATUSES" artifacts/ lib/` returns zero
- **A2:** `rg "macro-phase|getMacroPhase|getGroupMacroPhase|MacroPhase" artifacts/api-server/src/ artifacts/claimclear/src/` returns zero (only the deprecated OpenAPI deprecation comment may remain)
- **A2:** `rg "lifecyclePhase|lifecycle-phase|LifecyclePhase" artifacts/claimclear/src/` returns zero
- **A2:** `rg "\\.update\\(invoiceGroupsTable\\)\\.set\\(\\{[^}]*status" artifacts/api-server/src/` outside `lib/invoice-state/` returns zero
- **A2:** Same for `claimsTable` + `status|disposition`
- **A3:** Conformance script green
- **A4:** SSE payload still includes both old + new (Wave E removes old)
- **A5:** test fixture audit — now at least 80% of fixtures use new vocab
- **A6:** Manual smoke runbook (Wave D version):
  1. Import a CSV → verify invoices land in `phase=triage`
  2. Triage flow: classify all claims in an invoice → verify auto-advance to `ready_to_submit`
  3. Submit invoice → verify `phase=submitted`, no claim writes happen incorrectly
  4. Receive a payor response (test fixture) → verify auto-advance to `response_received`
  5. Confirm verdicts on all claims → verify auto-advance to `reviewed`
  6. With Approved verdict → verify auto-advance to `awaiting_reattestation`
  7. Complete reattest → verify `phase=closed`
  8. With all-Denied verdicts → verify direct advance to `closed`
  9. Place an invoice on hold → verify auto-advance pauses
  10. Try to submit invoice with un-disposed claims → verify rejection with structured "blocking claims" list
  11. Admin re-open of closed invoice → verify reverse transition allowed
  12. Bulk reattest queue endpoint still works
  13. Batch processor (background): verify it writes via transition functions, no direct status writes
  14. Cron job: payor response scan triggers `transitionInvoice('response_received')`
- **A7:** confirmed (above)
- Lint rule audit: `pnpm lint` green; deliberately introduce a `.update().set({status:` and confirm rejection

### Validation
- `pnpm typecheck` green
- `pnpm test` green
- All `__tests__/state-*` and `__tests__/transition-*` and the 7 high-risk tests green
- Manual smoke 14-step complete

### Done definition
- 4 files deleted
- 12 writer sites migrated
- Lint rule live and verified
- All audits green
- Smoke runbook complete

### Rollback
**One-way operationally.** Restoration requires:
1. Restore `denormalized-cache.ts` from git history
2. Restore `macro-phase.ts`, `lifecycle-phase.ts`
3. Revert the 12 writer site commits
4. Delete the lint rule (or it will block re-introduction)
5. Re-publish

Data is recoverable: phase/disposition columns still populated, can be derived back to status/outcome via reverse mapping. But operationally annoying and time-consuming (~2-3 hours).

**Mitigation:** Wave D ships as one large PR that's reviewed in one sitting. If anything looks wrong in the smoke runbook, abort BEFORE merging.

### Publish gate
**Publish #3.5.** This is the topology change. After publish:
- Watch error logs intensely for ~4 hours
- Run conformance script every 30 min for first 4 hours
- Manual spot-checks of micro-interactions (these are what break silently)
- ≥72h soak before Wave E

### What user does next
- Verifies operator flows in prod end-to-end
- Confirms no SSE/micro-interaction regressions
- After ≥72h with zero anomalies, green-light Wave E

---

## 8. Wave E — Drop old columns + clean up (~2 hours, 1 publish, finishing)

### Goal
Old columns + enums + deprecated SSE fields gone. Schema reflects model.

### Preconditions
- Publish #3.5 healthy ≥72h
- Zero error log entries about missing/null new columns
- Conformance script green for entire soak period

### Steps

#### E.1 — Final pre-flight
1. **Audit A2:** `rg "\\.status|\\.outcome|claim\\.sopOutcome|attestationState" artifacts/api-server/src/lib/ artifacts/api-server/src/routes/` excluding `lib/invoice-state/`, excluding test files, excluding portal_submissions table (which has its own status). Result must be zero.
2. **Audit A2:** Same for `artifacts/claimclear/src/` excluding `cohesion/tone.ts`'s deprecated passthrough.
3. **Audit A2:** Same for `event.status|event.outcome` in claimclear hooks/components — proves no SSE consumer still reads old fields.
4. If any audit finds matches: STOP, fix, re-soak before proceeding.

#### E.2 — Drop migration
```sql
ALTER TABLE invoice_groups DROP COLUMN status;
ALTER TABLE invoice_groups DROP COLUMN outcome;
ALTER TABLE claims DROP COLUMN status;
ALTER TABLE claims DROP COLUMN outcome;
ALTER TABLE claims DROP COLUMN sop_outcome;
ALTER TABLE claims DROP COLUMN attestation_state;
ALTER TABLE claims DROP COLUMN drop_reason;
DROP TYPE claim_status;
DROP TYPE claim_outcome;
```

Note: `attestation_state` was renamed to `disposition` (it's the per-leg attestation queue state); the column is dropped but the data lives on in `disposition`. Verify this in pre-flight.

#### E.3 — Schema file cleanup
1. `lib/db/src/schema/invoice-groups.ts` — drop columns from definition
2. `lib/db/src/schema/claims.ts` — drop columns from definition
3. Delete `lib/vocab/src/verdict-outcome.ts` (already deleted in D, finalize)

#### E.4 — OpenAPI cleanup
1. `lib/api-spec/openapi.yaml` — delete `status`, `outcome`, `macroPhase` fields entirely (no longer deprecated, just gone)
2. `pnpm --filter @workspace/api-spec run codegen`
3. Delete the 8 generated macroPhase type files (cleaned up by codegen automatically)

#### E.5 — SSE payload cleanup
1. `lib/sse.ts` — remove `status` and `outcome` from `ClaimEvent` and `GroupEvent` types
2. Update emit sites accordingly (will be tiny diff since they all came from `lib/observability`)

#### E.6 — Frontend cleanup
1. `src/components/cohesion/tone.ts` — delete `toneForStatus()` deprecated passthrough
2. `src/lib/lifecycle-phase.ts` — delete (was the temporary passthrough from Wave C)
3. Update any remaining stragglers found by A2 audit

#### E.7 — Test cleanup
1. `__tests__/fixtures/state.ts` — drop the `status: PHASE_TO_LEGACY_STATUS[phase]` field; fixture now only emits new vocab
2. Audit: any test that fails compile after this is using old vocab → fix it

### Files touched
~15 modified, ~10 deleted, ~30 regenerated

### Anti-slop audits
- **A2:** `rg "claim_status|claim_outcome" lib/db/src/schema/ lib/db/src/enums/` returns zero
- **A2:** `rg "claimStatusEnum|claimOutcomeEnum" artifacts/ lib/` returns zero
- **A2:** `rg "macroPhase|MacroPhase|lifecyclePhase|LifecyclePhase" artifacts/ lib/` returns zero
- **A4 (final):** SSE payload contract test asserts `status` and `outcome` are NOT in payload
- **A5 (final):** test fixture audit — 0% use old vocab, 100% use new
- **A3:** Conformance script — modified to verify only `phase`/`disposition` (since old columns no longer exist)

### Validation
- `pnpm typecheck` green (this is the real check — anything still referencing dropped columns fails compile)
- `pnpm --filter @workspace/db run check-drift` green
- All tests green
- Production smoke after publish: same 14-step runbook from Wave D, all flows work

### Done definition
- 7 columns dropped from schema
- 2 enums dropped
- All audits green
- Production functional

### Rollback
- Requires backup restore (columns + data are gone)
- By this point, code has been running on new columns for ≥1 week → rollback should be unnecessary
- If catastrophic: restore from snapshot, revert E.2-E.7 commits

### Publish gate
**Publish #4 — final.** After publish, run conformance script one final time and confirm green.

### What user does next
- Final operator walk-through
- Confirm metrics dashboards still show expected data
- Mark project complete; close out brief + execution-plan docs as historical record

---

## 9. Cross-wave concerns

### 9.1 What if an audit fails?
Each wave has audits that MUST pass before publish. If one fails:
1. Do NOT publish.
2. Investigate the audit failure.
3. Fix the underlying cause (not the audit).
4. Re-run audit until green.
5. Then publish.

This is the discipline that prevents the slop patterns named in §0.

### 9.2 What if prod surfaces an issue between publishes?
Each wave's rollback procedure is documented above. The granularity of waves is intentional — small, reversible chunks until Wave D.

### 9.3 What if a writer site is discovered mid-Wave-D?
The lint rule will catch new ones. But if D ships and prod surfaces an unmigrated writer:
1. Hot-fix: route the writer through `transitionInvoice`
2. Same-day patch publish
3. Add the missed site to a postmortem and check why A2 audit didn't catch it (insufficient ripgrep query? extend the audit.)

### 9.4 Handling SSE during Wave D deploy
The publish itself causes a momentary SSE disconnect (server restarts). Existing `useEventSource` from Task #509 handles reconnection with exponential backoff. Verify post-publish that all open client tabs reconnect.

### 9.5 Operator-visible disruption
- Waves A, B, E: zero operator-visible change
- Wave C: pill colors / labels may shift slightly (matched to training); operators see new vocab
- Wave D: zero operator-visible change (writes route differently but produce identical UI state)

### 9.6 Background jobs (cron) handling
Cron jobs running across publishes:
- A cron job started before Wave D and finishing after must not call into `denormalized-cache.ts` (will fail to import)
- **Mitigation:** Wait for in-flight cron runs to complete before publishing D. Watch `cron_runs` table for active rows, only publish when count is 0.

---

## 10. Sign-off checklist (per wave)

Before each publish, every box must be checked:

- [ ] All steps in the wave's plan executed
- [ ] All anti-slop audits green (specific results recorded)
- [ ] All validation checks pass (`pnpm typecheck`, `pnpm test`, `pnpm lint`)
- [ ] Manual smoke runbook complete (where applicable)
- [ ] Rollback procedure verified (dry-run if possible)
- [ ] PR scope reviewed — no out-of-scope edits bundled in
- [ ] Conformance script green against prod (post-Wave-A onward)
- [ ] User has reviewed and green-lit publish

---

## 11. Calendar

Realistic estimate assuming aggressive but careful execution:

| Wave | Active work | Soak before next | Cumulative |
|---|---|---|---|
| 0 | 0.5h | — | day 0 |
| A | 3h | 24h | day 1 |
| B | 3h | 24h | day 2 |
| C | 4h | 24h | day 3 |
| D | 5h | 72h | day 7 |
| E | 2h | — | day 7 |

**Total:** ~17 hours of active work, ~7 calendar days end-to-end.

Cautious version (longer soak between D and E): ~10-14 calendar days.

---

## 12. Appendix: full SQL for §6 mappings

(Will be added once the brief is reviewed and confirmed. Keeping the doc focused on execution structure for now.)

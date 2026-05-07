# Wave B handoff prompt — Schema + dual-write backfill

Paste this entire file as the first user message of the next session.

---

You are continuing work on the ClaimClear hierarchical state machine refactor. Wave A shipped on 2026-05-06; you are about to start **Wave B**. Read this entire prompt before doing anything else, then read the three documents it references, then start.

## 0. The one-sentence mental model (do not lose this)

The invoice is the noun that moves through 7 sequential phases. Each claim is a work item that contributes to the next phase transition. Phase advancement is gated by an aggregate over claim dispositions — never by a free-running cache. Today's `groups + claims as peers with overlapping state, kept in sync by a bidirectional cache (denormalized-cache.ts)` model is the actual root cause of every drift bug catalogued in `state-vocabularies-audit.md`. Wave B replaces the topology by adding two new authoritative columns and backfilling them; Waves C-E flip readers, then writers, then drop the old columns.

## 1. Read these first, in this order

1. `docs/architecture/state-hierarchy-v1.md` — the spec. Pay closest attention to §1 (the 7 phases), §2 (per-phase valid disposition sets), §5 (schema diff), §6 (the deterministic legacy→new mapping that Wave A's derivers already implement), and §7 Wave B (the migration outline).
2. `docs/architecture/state-hierarchy-execution-plan.md` Wave B section (around line 320) — gives the augmented migration template and the anti-slop audit IDs (A1-A7).
3. `docs/architecture/state-pre-migration-census.md` — the row-by-row census from prod. §A is the invoice tuple distribution (1,310 invoices, 14 distinct tuples, all map cleanly per §6.1 with 0 NULLs). §B is the claim tuple distribution (2,406 claims, **had 2 NULL rows that triggered a STOP gate** — read §C of that file carefully and confirm those 2 rows have either been healed in prod OR that Wave A's `deriveDispositionFromLegacy` now covers their tuple. The Wave A derivers in `lib/invoice-state/src/derive-disposition.ts` were written with full §6.2 coverage including a final fallthrough, so re-run audit A3 against prod first to confirm 0 NULLs before writing the migration).
4. `docs/architecture/state-wave-0.5-catalogue.md` §8 — the wave delivery log. A-PR1, A-PR2, A-PR3 are all marked shipped 2026-05-06.

## 2. What's already built (Wave A — don't redo any of this)

Three workspace packages exist, all type-clean, all tested (91 tests across the three), all in root `tsconfig.json` references. Dependency graph is one-way: `observability` (leaf) → `vocab` (leaf) → `invoice-state` (depends only on `@workspace/vocab`).

### `@workspace/observability` (`lib/observability/`)
- `actor.ts` — `TransitionActor` discriminated union: `{ kind: "user", userId, displayName? } | { kind: "system", source }`.
- `sources.ts` — `TRANSITION_SOURCES` 32-tuple (every batch-worker, cron, SOP-advance, response-matcher, importer, MAS-evaluator origin tag).
- `audit-actions.ts` — `AUDIT_ACTION_NAMES` 80-tuple (every `audit_logs.action` value currently emitted, harvested by `rg "action:" artifacts/api-server/src/`).
- `registry.ts` — `SOURCE_TO_ACTION_TABLE: Record<TransitionSource, AuditActionName[]>` declaring which actions each source is allowed to emit. 11 tests passing.
- **NOT YET WIRED** into any emit site. That's Wave D's job (P5 in the catalogue).

### `@workspace/vocab` additions
- `lib/vocab/src/invoice-phase.ts` — `INVOICE_PHASES` 7-tuple, `InvoicePhase` type, glossary, `comparePhase`, `isPhaseAtLeast`, `invoicePhaseLabel`, `isInvoicePhase`. Sequence is exactly: `triage → ready_to_submit → submitted → response_received → reviewed → awaiting_reattestation → closed`.
- `lib/vocab/src/claim-disposition.ts` — `CLAIM_DISPOSITIONS` 22-tuple, `ClaimDisposition` type, glossary, plus the cross-row contract tables: `VALID_DISPOSITIONS_BY_PHASE` (the per-phase valid set from spec §5.1), `TERMINAL_TRIAGE_DISPOSITIONS` (the 4 dispositions that promote triage→ready_to_submit), `CONFIRMED_VERDICT_DISPOSITIONS` (`verdict_approved | verdict_denied | verdict_partial` — the reviewed entry condition), `REATTEST_REQUIRING_DISPOSITIONS` (`verdict_approved | verdict_partial`). Helper `isDispositionValidForPhase(d, phase)` that the SQL trigger from §5.2 will mirror exactly. 41 vocab tests pass total.
- `lib/vocab/src/domains.ts` — `VocabDomain` union extended with `"invoice_phase"` and `"claim_disposition"`. Both new domains land in the flat `GLOSSARY`.
- The existing `lib/vocab/claim-status.ts`, `outcome.ts`, `leg-sub-status.ts` are intentionally kept verbatim through Waves A-D. They become dead code in Wave E. Don't touch them.

### `@workspace/invoice-state` (`lib/invoice-state/`)
The pure read-only derivation library. `package.json` declares `"@workspace/vocab": "workspace:*"`. Composite TS project. 39 tests pass.
- `src/legacy-shapes.ts` — narrow input types `LegacyInvoiceGroupShape` and `LegacyClaimShape`. The migration JS will pass DB rows cast to these.
- `src/derive-phase.ts` — `derivePhaseFromLegacy(group): { phase: InvoicePhase, closureReason: LegacyClosureReasonValue | null, prePhaseHint: InvoicePhase | null }`. Implements §6.1 deterministically. Order matters — first match wins:
  1. `reattestCompletedAt` set → `closed / reattested` (regardless of status)
  2. `(Resolved, Non-Issue)` → `closed / non_issue`
  3. `Expired` → `closed / expired`
  4. `Denied` → `closed / denied_by_payor`
  5. `(Resolved, Withdrawn)` → `closed`, carries `closureReason` forward (defaults to `cannot_dispute`)
  6. `On Hold` → `triage` (hold is a flag, not a phase — note `prePhaseHint` is reserved for the audit-log lookup; currently always `null`)
  7. `MAS Eligible + reattestRequired + !reattestCompleted` → `awaiting_reattestation`
  8. Switch on remaining status: `New | Needs Review | Needs Evidence` → `triage`; `Generating Email | Portal Queued | Processed` → `ready_to_submit`; `Ready to Review` → `response_received`; `Awaiting Response` → `submitted`; `MAS Eligible` (without reattest flag) → `awaiting_reattestation`; `Resolved` (without earlier hit) → `triage` fallback.
  9. Final fallthrough → `triage`.
- `src/derive-disposition.ts` — `deriveDispositionFromLegacy(claim, parentPhase): ClaimDisposition`. Phase-aware. First-match-wins:
  1. `duplicate_of_claim_id != null` → `duplicate` (always wins, every phase).
  2. `parentPhase === "closed"` → `terminalForClosedPhase(claim)`: closure_reason wins (`non_issue → final_nonissue`, `denied_by_payor → final_denied`, `cannot_dispute → final_withdrawn`); else attestation `completed → final_reattested`; else outcome (`Approved|Partial → final_reattested`, `Denied → final_denied`, `Withdrawn → final_withdrawn`, `Non-Issue → final_nonissue`); else `sopOutcome` fallback; else `final_nonissue`.
  3. `parentPhase === "awaiting_reattestation"` → `Denied → verdict_denied`; `Approved|Partial` + attestation_state queue (`queued → attest_queued`, `pending → attest_pending`, `completed → attested`, `not_required → attest_not_required`); fallback verdict or `attest_pending`.
  4. `parentPhase === "reviewed"` → verdict-from-outcome; default `verdict_approved` (wave D will tighten this).
  5. `parentPhase === "response_received"` → verdict if outcome is set; else `awaiting_review`.
  6. Else (`triage | ready_to_submit | submitted`) → `triageDisposition(claim)`: sopOutcome priority (`non_issue → disposed_nonissue`, `cannot_dispute → disposed_withdraw`, `hold → blocked`, `portal_dispute → disposed_portal`, `dispute → disposed_email`); then `dropReason` (`non_issue → disposed_nonissue`, `cannot_dispute → disposed_withdraw`); then `includedInDispute === false && !sopOutcome → disposed_nonissue` (the auto-blank-sibling case from `excludeLegCore`); then `errorTypeId != null → classifying`; else `unclassified`.

The two-path collapse (sopOutcome=non_issue vs included_in_dispute=false vs dropReason=non_issue all → `disposed_nonissue`) is implemented and tested. The dispute→portal_dispute fold is **not** done in the derivers — `dispute` maps to `disposed_email` directly per spec §6.2 (the historical `dispute` value was email-channel; `portal_dispute` is portal-channel). 3 prod rows have `sop_outcome='dispute'` — they'll land as `disposed_email`. This is correct.

### Catalogue + memory
- `docs/architecture/state-wave-0.5-catalogue.md` §8 has full delivery notes for A-PR1/PR2/PR3 with rationale, test counts, and the Wave B-E roadmap.
- `replit.md` "State model" section lists the Wave A packages.
- Last commit: `2fd2286` — "Add new vocabulary for invoice phases and claim dispositions".

## 3. Wave B — what to build this session

One PR. Schema + backfill + trigger + post-backfill audit. **Atomic in a single migration file** because the trigger added in step 4 below would reject the inserts if data weren't already conformant.

### B.0 — Re-run the A3 conformance audit against prod (PRECONDITION)

Before writing any migration, query prod via `executeSql` with `environment: "production"`:

```sql
-- §A: invoice tuple census (matches state-pre-migration-census.md §A)
SELECT status, outcome, reattest_required, reattest_completed_at IS NOT NULL AS reattested,
       closure_reason, hold_reason IS NOT NULL AS held, COUNT(*) AS n
FROM invoice_groups GROUP BY 1,2,3,4,5,6 ORDER BY n DESC;

-- §B: claim tuple census
SELECT status, outcome, sop_outcome, attestation_state,
       included_in_dispute, duplicate_of_claim_id IS NOT NULL AS is_dup,
       drop_reason IS NOT NULL AS dropped, COUNT(*) AS n
FROM claims GROUP BY 1,2,3,4,5,6,7 ORDER BY n DESC;

-- §C: was 2 NULL claim rows in the previous census — confirm the
-- Wave A deriver covers them now. The deriver has a fallthrough to
-- `unclassified`, so this should return zero. If it returns rows,
-- read state-pre-migration-census.md §C and figure out which §6.2
-- rule should match before proceeding.
SELECT id, status, outcome, sop_outcome, attestation_state,
       included_in_dispute, duplicate_of_claim_id, drop_reason
FROM claims
WHERE -- the §6.2 case expression — copy from state-pre-migration-census.md §C
  ...
```

Write `derivePhaseFromLegacy` and `deriveDispositionFromLegacy` over the result set in a node script under `scripts/src/check-invoice-state-derivation.ts` (this is part of A.3 from the execution plan — Wave A planned for it but A-PR1/PR2/PR3 deferred it as out-of-scope). Assert:
- Every group derives to a non-null phase (already true per census §A audit).
- Every claim derives to a disposition that is in `VALID_DISPOSITIONS_BY_PHASE[parent.derivedPhase]`.
- Print per-phase counts (sanity check: 869 New + 52 Needs Review + 1 Needs Evidence + 1 On Hold = 923 → triage; 205 → submitted; 80+1 → closed/non_issue; 72 → closed/expired; 9 → closed/denied; 6 → awaiting_reattestation; 9+4 → closed/reattested; 4 → awaiting_reattestation; 1 → ready_to_submit). Census totals must match.

If census drift has happened in the 0-N hours since the original census, update `state-pre-migration-census.md` §A/§B/§C with the fresh numbers and a "re-run on YYYY-MM-DD" note. Don't proceed until A3 is green.

### B.1 — Schema additions in Drizzle

Edit `lib/db/src/schema/invoice-groups.ts`:
```ts
export const invoicePhaseEnum = pgEnum("invoice_phase", [
  "triage", "ready_to_submit", "submitted", "response_received",
  "reviewed", "awaiting_reattestation", "closed",
]);

// In invoiceGroupsTable definition, add:
phase: invoicePhaseEnum("phase").notNull().default("triage"),
phaseEnteredAt: timestamp("phase_entered_at", { withTimezone: true }).notNull().defaultNow(),
// And a closureReason text column if not already present (it is — keep as-is).
```

Edit `lib/db/src/schema/claims.ts`:
```ts
export const claimDispositionEnum = pgEnum("claim_disposition", [
  "unclassified", "classifying", "disposed_portal", "disposed_email",
  "disposed_withdraw", "disposed_nonissue", "blocked", "duplicate",
  "awaiting_review", "verdict_drafted",
  "verdict_approved", "verdict_denied", "verdict_partial",
  "attest_pending", "attest_queued", "attested", "mas_cancelled", "attest_not_required",
  "final_reattested", "final_withdrawn", "final_denied", "final_nonissue",
]);

// In claimsTable definition, add:
disposition: claimDispositionEnum("disposition").notNull().default("unclassified"),
```

Cross-check against `lib/vocab/src/invoice-phase.ts:INVOICE_PHASES` and `lib/vocab/src/claim-disposition.ts:CLAIM_DISPOSITIONS` — the Postgres enum values must be byte-identical to the TS string-literal unions (Wave C readers will cast directly). Add a unit test under `lib/db/__tests__/` that imports both and asserts `INVOICE_PHASES.every((p, i) => p === invoicePhaseEnum.enumValues[i])`.

### B.2 — Hand-write the migration `lib/db/migrations/0034_invoice_phase_and_disposition.sql`

Numbering: highest existing migration is `0033_drop_day_completed_celebration_unique.sql`. Use `0034_`.

The migration runner is `lib/db/scripts/apply-migrations.mjs` — purely SQL-based, no JS hooks. So **the §6 mapping must be inlined as SQL CASE expressions**, not called out to the TS derivers. Keep the SQL CASE byte-for-byte equivalent to `derivePhaseFromLegacy` / `deriveDispositionFromLegacy` (this is the audit A1 contract).

Skeleton:
```sql
-- 0034_invoice_phase_and_disposition.sql
-- Wave B of the hierarchical state machine refactor.
-- Adds the two authoritative columns (invoice_groups.phase, claims.disposition),
-- the two pgEnums, the cross-row validation trigger, and runs the §6 mapping
-- backfill for every existing row. Atomic — the trigger is added AFTER the
-- backfill so the backfill UPDATE doesn't trip it on partial state.
--
-- Pre-conditions: A3 conformance audit green against prod. See
-- docs/architecture/state-pre-migration-census.md §A/§B/§C.
--
-- Idempotent: every CREATE/ALTER uses IF NOT EXISTS where possible.

BEGIN;

-- 1. Enums (idempotent via DO block)
DO $$ BEGIN
  CREATE TYPE invoice_phase AS ENUM (
    'triage','ready_to_submit','submitted','response_received',
    'reviewed','awaiting_reattestation','closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE claim_disposition AS ENUM (
    'unclassified','classifying','disposed_portal','disposed_email',
    'disposed_withdraw','disposed_nonissue','blocked','duplicate',
    'awaiting_review','verdict_drafted',
    'verdict_approved','verdict_denied','verdict_partial',
    'attest_pending','attest_queued','attested','mas_cancelled','attest_not_required',
    'final_reattested','final_withdrawn','final_denied','final_nonissue'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Columns
ALTER TABLE invoice_groups
  ADD COLUMN IF NOT EXISTS phase invoice_phase NOT NULL DEFAULT 'triage',
  ADD COLUMN IF NOT EXISTS phase_entered_at timestamptz NOT NULL DEFAULT NOW();

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS disposition claim_disposition NOT NULL DEFAULT 'unclassified';

-- 3. Backfill invoice_groups.phase per §6.1 (deriver-equivalent CASE).
--    Order matters; first match wins. Same precedence as derivePhaseFromLegacy.
UPDATE invoice_groups SET phase = (CASE
  WHEN reattest_completed_at IS NOT NULL                       THEN 'closed'
  WHEN status = 'Resolved' AND outcome = 'Non-Issue'           THEN 'closed'
  WHEN status = 'Expired'                                      THEN 'closed'
  WHEN status = 'Denied'                                       THEN 'closed'
  WHEN status = 'Resolved' AND outcome = 'Withdrawn'           THEN 'closed'
  WHEN status = 'On Hold'                                      THEN 'triage'
  WHEN status = 'MAS Eligible' AND reattest_required = TRUE    THEN 'awaiting_reattestation'
  WHEN status IN ('New','Needs Review','Needs Evidence')       THEN 'triage'
  WHEN status IN ('Generating Email','Portal Queued','Processed') THEN 'ready_to_submit'
  WHEN status = 'Ready to Review'                              THEN 'response_received'
  WHEN status = 'Awaiting Response'                            THEN 'submitted'
  WHEN status = 'MAS Eligible'                                 THEN 'awaiting_reattestation'
  ELSE 'triage'
END)::invoice_phase;

-- 3b. Backfill closure_reason for the heal cases from census §A drift notes:
--     - 4 (Denied, NULL closure_reason)         → 'denied_by_payor'
--     - 1 (Resolved, Non-Issue, NULL)           → 'non_issue'
--     - all reattest_completed_at IS NOT NULL   → 'reattested' (if currently NULL)
--     - all (Resolved, Withdrawn, NULL)         → 'cannot_dispute'  (matches deriver fallback)
UPDATE invoice_groups SET closure_reason = 'denied_by_payor'
  WHERE status = 'Denied' AND closure_reason IS NULL;
UPDATE invoice_groups SET closure_reason = 'non_issue'
  WHERE status = 'Resolved' AND outcome = 'Non-Issue' AND closure_reason IS NULL;
UPDATE invoice_groups SET closure_reason = 'reattested'
  WHERE reattest_completed_at IS NOT NULL AND closure_reason IS NULL;
UPDATE invoice_groups SET closure_reason = 'expired'
  WHERE status = 'Expired' AND closure_reason IS NULL;
UPDATE invoice_groups SET closure_reason = 'cannot_dispute'
  WHERE status = 'Resolved' AND outcome = 'Withdrawn' AND closure_reason IS NULL;

-- 3c. phase_entered_at — best-effort from audit_logs. If too complex to express
--     in pure SQL for the first cut, leave it at the column default (NOW()) and
--     file a follow-up to refine via a one-shot post-deploy script. Document
--     this trade-off in the migration header if you take that route.

-- 4. Backfill claims.disposition per §6.2 deriver. Needs parent phase, so JOIN.
--    First-match-wins ordering must mirror deriveDispositionFromLegacy exactly.
UPDATE claims c SET disposition = (CASE
  WHEN c.duplicate_of_claim_id IS NOT NULL THEN 'duplicate'
  -- closed phase: closure_reason wins, then attestation, then outcome
  WHEN g.phase = 'closed' AND c.closure_reason = 'non_issue'        THEN 'final_nonissue'
  WHEN g.phase = 'closed' AND c.closure_reason = 'denied_by_payor'  THEN 'final_denied'
  WHEN g.phase = 'closed' AND c.closure_reason = 'cannot_dispute'   THEN 'final_withdrawn'
  WHEN g.phase = 'closed' AND c.attestation_state = 'completed'     THEN 'final_reattested'
  WHEN g.phase = 'closed' AND c.outcome IN ('Approved','Partially Approved') THEN 'final_reattested'
  WHEN g.phase = 'closed' AND c.outcome = 'Denied'                  THEN 'final_denied'
  WHEN g.phase = 'closed' AND c.outcome = 'Withdrawn'               THEN 'final_withdrawn'
  WHEN g.phase = 'closed' AND c.outcome = 'Non-Issue'               THEN 'final_nonissue'
  WHEN g.phase = 'closed' AND c.sop_outcome = 'non_issue'           THEN 'final_nonissue'
  WHEN g.phase = 'closed' AND c.sop_outcome = 'cannot_dispute'      THEN 'final_withdrawn'
  WHEN g.phase = 'closed'                                           THEN 'final_nonissue'
  -- awaiting_reattestation: attestation_state queue
  WHEN g.phase = 'awaiting_reattestation' AND c.outcome = 'Denied'                  THEN 'verdict_denied'
  WHEN g.phase = 'awaiting_reattestation' AND c.outcome IN ('Approved','Partially Approved') AND c.attestation_state = 'queued'    THEN 'attest_queued'
  WHEN g.phase = 'awaiting_reattestation' AND c.outcome IN ('Approved','Partially Approved') AND c.attestation_state = 'pending'   THEN 'attest_pending'
  WHEN g.phase = 'awaiting_reattestation' AND c.outcome IN ('Approved','Partially Approved') AND c.attestation_state = 'completed' THEN 'attested'
  WHEN g.phase = 'awaiting_reattestation' AND c.outcome IN ('Approved','Partially Approved') AND c.attestation_state = 'not_required' THEN 'attest_not_required'
  WHEN g.phase = 'awaiting_reattestation'                                           THEN 'attest_pending'
  -- reviewed: verdict from outcome (Wave D will tighten the default)
  WHEN g.phase = 'reviewed' AND c.outcome = 'Approved'              THEN 'verdict_approved'
  WHEN g.phase = 'reviewed' AND c.outcome = 'Partially Approved'    THEN 'verdict_partial'
  WHEN g.phase = 'reviewed' AND c.outcome = 'Denied'                THEN 'verdict_denied'
  WHEN g.phase = 'reviewed'                                         THEN 'verdict_approved'
  -- response_received: verdict-or-awaiting_review
  WHEN g.phase = 'response_received' AND c.outcome = 'Approved'           THEN 'verdict_approved'
  WHEN g.phase = 'response_received' AND c.outcome = 'Partially Approved' THEN 'verdict_partial'
  WHEN g.phase = 'response_received' AND c.outcome = 'Denied'             THEN 'verdict_denied'
  WHEN g.phase = 'response_received'                                      THEN 'awaiting_review'
  -- triage / ready_to_submit / submitted: triageDisposition logic
  WHEN c.sop_outcome = 'non_issue'      THEN 'disposed_nonissue'
  WHEN c.sop_outcome = 'cannot_dispute' THEN 'disposed_withdraw'
  WHEN c.sop_outcome = 'hold'           THEN 'blocked'
  WHEN c.sop_outcome = 'portal_dispute' THEN 'disposed_portal'
  WHEN c.sop_outcome = 'dispute'        THEN 'disposed_email'
  WHEN c.drop_reason = 'non_issue'      THEN 'disposed_nonissue'
  WHEN c.drop_reason = 'cannot_dispute' THEN 'disposed_withdraw'
  WHEN c.included_in_dispute = FALSE AND c.sop_outcome IS NULL THEN 'disposed_nonissue'
  WHEN c.error_type_id IS NOT NULL      THEN 'classifying'
  ELSE 'unclassified'
END)::claim_disposition
FROM invoice_groups g
WHERE c.invoice_group_id = g.id;

-- 5. Cross-row validation trigger from spec §5.2.
--    Mirrors VALID_DISPOSITIONS_BY_PHASE in lib/vocab/src/claim-disposition.ts.
--    Keep these two in lockstep — change one, change both, add a test that
--    asserts equality (suggested test in scripts/src/check-disposition-trigger-parity.ts).
CREATE OR REPLACE FUNCTION validate_disposition_against_phase() RETURNS trigger AS $$
DECLARE parent_phase invoice_phase;
DECLARE valid_set claim_disposition[];
BEGIN
  IF NEW.invoice_group_id IS NULL THEN RETURN NEW; END IF;
  SELECT phase INTO parent_phase FROM invoice_groups WHERE id = NEW.invoice_group_id;
  valid_set := CASE parent_phase
    WHEN 'triage' THEN ARRAY['unclassified','classifying','disposed_portal','disposed_email','disposed_withdraw','disposed_nonissue','blocked','duplicate']::claim_disposition[]
    WHEN 'ready_to_submit' THEN ARRAY['disposed_portal','disposed_email','disposed_withdraw','disposed_nonissue','blocked','duplicate']::claim_disposition[]
    WHEN 'submitted' THEN ARRAY['disposed_portal','disposed_email','disposed_withdraw','disposed_nonissue','blocked','duplicate']::claim_disposition[]
    WHEN 'response_received' THEN ARRAY['awaiting_review','verdict_drafted','verdict_approved','verdict_denied','verdict_partial','disposed_withdraw','disposed_nonissue','duplicate']::claim_disposition[]
    WHEN 'reviewed' THEN ARRAY['verdict_approved','verdict_denied','verdict_partial','disposed_withdraw','disposed_nonissue','duplicate']::claim_disposition[]
    WHEN 'awaiting_reattestation' THEN ARRAY['verdict_approved','verdict_denied','verdict_partial','attest_pending','attest_queued','attested','attest_not_required','mas_cancelled','disposed_withdraw','disposed_nonissue','duplicate']::claim_disposition[]
    WHEN 'closed' THEN ARRAY['final_reattested','final_withdrawn','final_denied','final_nonissue','duplicate']::claim_disposition[]
  END;
  IF NOT (NEW.disposition = ANY(valid_set)) THEN
    RAISE EXCEPTION 'disposition % not valid for parent invoice phase %', NEW.disposition, parent_phase;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER claims_disposition_phase_chk
  AFTER INSERT OR UPDATE OF disposition, invoice_group_id ON claims
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_disposition_against_phase();

-- 6. Indexes for the Wave C reader queries
CREATE INDEX IF NOT EXISTS invoice_groups_phase_idx ON invoice_groups (phase);
CREATE INDEX IF NOT EXISTS claims_disposition_idx ON claims (disposition);
CREATE INDEX IF NOT EXISTS claims_invoice_group_disposition_idx ON claims (invoice_group_id, disposition);

COMMIT;
```

**Critical mirror-with-TS callouts** — these three things must be kept byte-identical:
1. The Postgres enum value lists in step 1 vs `INVOICE_PHASES` / `CLAIM_DISPOSITIONS` in `lib/vocab/src/`. Add a runtime test that imports both and asserts equality.
2. The trigger's `valid_set` CASE in step 5 vs `VALID_DISPOSITIONS_BY_PHASE` in `lib/vocab/src/claim-disposition.ts`. Same: add a test.
3. The backfill CASE expressions in step 3 + step 4 vs `derivePhaseFromLegacy` / `deriveDispositionFromLegacy` in `lib/invoice-state/src/`. The TS derivers are the spec; the SQL is the executable. Wave A's 39 derivation tests are also indirect tests of this CASE expression.

Add a paragraph to the migration's header comment explaining all three lockstep constraints so the next maintainer doesn't break one without the others.

### B.3 — `phase_entered_at` follow-up decision

The simplest first cut: leave `phase_entered_at` at `DEFAULT NOW()` (the column default fires for every existing row at migration time, so all rows get the same timestamp). The "real" value would come from the most recent matching `audit_logs.action` row — but that requires a per-phase action mapping that's only resolved by Wave D's writer rewire. **Recommendation:** ship with `NOW()` and document a follow-up in the catalogue. Wave D's `transitionInvoice` is what starts maintaining it correctly going forward.

If you want to be more accurate without blocking, add step 3d:
```sql
UPDATE invoice_groups SET phase_entered_at = COALESCE(
  (SELECT MAX(created_at) FROM audit_logs
   WHERE invoice_group_id = invoice_groups.id
     AND action IN ('group_status_changed','group_phase_changed','group_resolved','group_closed')),
  created_at
);
```

### B.4 — Conformance script `scripts/src/check-invoice-state-derivation.ts`

This is A3 from the execution plan. Purpose: read every prod row, run the Wave A derivers, assert the **stored** column equals what the deriver would compute. After Wave B, this catches drift between any future SQL trigger update and the TS deriver.

```ts
import { db } from "@workspace/db";
import { invoiceGroupsTable, claimsTable } from "@workspace/db/schema";
import {
  derivePhaseFromLegacy,
  deriveDispositionFromLegacy,
} from "@workspace/invoice-state";
import { isDispositionValidForPhase } from "@workspace/vocab";

// SELECT all groups, all claims (chunked if needed)
// For each group: compare row.phase to derivePhaseFromLegacy(row).phase. Mismatch → fail.
// For each claim: lookup parent.phase, compare row.disposition to deriveDispositionFromLegacy(row, parent.phase). Mismatch → fail.
// Also: assert isDispositionValidForPhase(claim.disposition, parent.phase) for every (claim, parent) pair.
// Print per-phase counts and per-disposition counts for sanity.
// Exit code 0 if clean, 1 if any violation.
```

Add to `scripts/package.json`:
```json
"scripts": {
  "check-invoice-state-derivation": "tsx src/check-invoice-state-derivation.ts"
}
```

Wire into the existing `schema-drift` workflow as an additional step after the existing drift check. Confirm green run before publishing.

### B.5 — SSE payload contract (A4)

The Wave C reader swap will need `phase` and `disposition` on SSE event payloads. **Wave B should already include them additively** (no removal yet — that's Wave E). Find every site that emits an SSE update for an invoice or claim:

```bash
rg -n "broadcastInvoice|broadcastClaim|sse\.(send|emit)" artifacts/api-server/src
```

Add `phase` and `disposition` to the payload alongside the existing `status`/`outcome`. Add an A4 test that asserts both old and new fields are present. The new fields are safe to add — no client reads them yet.

### B.6 — `replit.md` + catalogue updates

- Append B-PR1 to `docs/architecture/state-wave-0.5-catalogue.md` §8 with rationale, file list, audit results (A1, A3, A4 results inline), and "Next: Wave C — read swap".
- Update `replit.md` "State model" section: bump the date, list the new columns + the trigger, list the conformance script.

### B.7 — Validation gauntlet before publishing

Run all of these and confirm each is green:

```bash
# Typecheck
npx tsc -b lib/observability lib/vocab lib/invoice-state lib/db
pnpm -r typecheck

# Tests (Wave A test count must not regress)
pnpm --filter @workspace/observability test    # 11 pass
pnpm --filter @workspace/vocab test            # 41 pass
pnpm --filter @workspace/invoice-state test    # 39 pass
pnpm --filter @workspace/db test               # whatever exists + new enum-parity test

# Migration apply on a dev DB
pnpm --filter @workspace/db migrate

# Drift check
pnpm --filter @workspace/db check-drift

# A3 conformance (against dev DB after backfill)
pnpm --filter @workspace/scripts run check-invoice-state-derivation

# A1 census parity: reverse-project the new phase distribution back to the
# §6.1 mapping table, confirm every cell matches state-pre-migration-census.md §A.

# A2 zero-rg-result audits for Wave B:
rg -n "phase invoice_phase|claim_disposition" lib/db/migrations/   # should hit only 0034
rg -n "invoicePhaseEnum|claimDispositionEnum" lib/db/src/schema/   # should hit only the two schema files
```

Anti-slop A6 manual smoke (run in the workspace preview):
1. Import an invoice → confirm `phase=triage` in DB.
2. SOP-walk a leg to non_issue → confirm leg's `disposition=disposed_nonissue` and parent still `triage`.
3. SOP-walk every leg to a terminal → manually inspect: parent should still be `triage` (auto-advance is Wave D's job). Wave B writers don't touch the new columns; only the migration backfill does.
4. Submit a group → confirm legacy writes still flow, `phase` stays at whatever the backfill set it to (no auto-update yet).

This last point is important: **Wave B is dual-write only in the sense that legacy columns continue to work and the new columns exist with backfilled values. Writers don't update the new columns yet — that's Wave D.** Between Wave B and Wave D, the new columns drift away from reality on any newly-changing row. That's the cost of the staged migration; Wave C still reads from the new columns (because the readable info is the same as the backfill captured). For the few rows that change between Wave B publish and Wave D publish, Wave D's first task is a re-backfill from the legacy columns at the moment the writer swap happens.

Add this to the migration header comment so the on-call doesn't get confused.

## 4. What NOT to do this session

- Do not touch any writer. No changes to `claim-transitions.ts`, `excludeLegCore`, `concludeLeg`, `transitionInvoice`/`setClaimDisposition` (those don't exist yet — they're Wave D), `denormalized-cache.ts`, `macro-phase.ts`, `lifecycle-phase.ts`. All legacy code paths must keep working unchanged.
- Do not touch any reader. Don't swap UI labels to use the new vocab. The new dispositions glossary in `@workspace/vocab` is import-clean already, but no UI imports it yet — keep it that way until Wave C.
- Do not delete `lib/vocab/claim-status.ts`, `outcome.ts`, or `leg-sub-status.ts`. They die in Wave E.
- Do not scaffold `lib/eslint-plugin-claimclear` yet. That's Wave D's `no-direct-status-write` rule.
- Do not wire `@workspace/observability` into any emit site. Wave D again.
- Do not regenerate `lib/api-zod` / `lib/api-client-react` to expose the new fields in OpenAPI yet. Wave C makes them canonical in the API spec.

## 5. Reversibility

If Wave B has to be rolled back after publish:
1. The migration is backwards-compatible additively — dropping the two columns + the trigger + the two enums is one DOWN migration. Write `0034_invoice_phase_and_disposition.down.sql` next to the up migration even though the runner doesn't apply it; that way the rollback is one copy-paste away.
2. No application code reads the new columns yet (Wave C hasn't shipped), so deleting them is behaviorally invisible.
3. The conformance script will fail loudly if a deploy-time race introduces drift — that's why A3 runs in CI on every PR.

## 6. Operational notes

- Production DB has 2,406 claims and 1,310 invoices per the census. The backfill UPDATE statements scan each table once. On a hot Neon Postgres instance these complete in seconds; locking is row-level; no need for batched updates. The deferrable trigger is created **after** the backfill so the bulk UPDATE doesn't trip it.
- Migration runner is `lib/db/scripts/apply-migrations.mjs`. It records applied migrations in `__schema_migrations`. Each migration owns its BEGIN/COMMIT (the runner doesn't wrap). The `0034` file will appear in lex order after `0033`. Idempotent re-run is a no-op because the runner checks `__schema_migrations`.
- The schema-drift workflow catches drift between Drizzle schema and DB. If you add the columns to the schema files but forget the migration, drift-check fails. If you write the migration but forget the schema, drift-check fails. Both must move together.
- `invoiceGroupsTable.statusenum` and `claimsTable.statusenum` already exist as `claimStatusEnum` shared between the two tables — do not delete that. Wave E removes it.

## 7. Definition of done for this session

- [ ] Census re-run against prod, captured into `state-pre-migration-census.md` (or confirmed unchanged).
- [ ] A3 conformance script written and green against dev DB.
- [ ] `lib/db/src/schema/invoice-groups.ts` + `claims.ts` updated with the two new columns + two new pgEnums. Enum-parity test passes.
- [ ] `lib/db/migrations/0034_invoice_phase_and_disposition.sql` written; migration applied cleanly to dev DB; idempotent re-apply confirmed.
- [ ] Trigger active; manual test: try `UPDATE claims SET disposition = 'verdict_approved' WHERE id = X` where X's parent is in `triage` phase — must raise.
- [ ] SSE payloads carry `phase` + `disposition` additively. A4 contract test passes.
- [ ] A1 census parity audit passes (post-backfill phase counts reverse-project to the §A tuple distribution).
- [ ] A2 zero-rg audits pass (the new column names appear only in expected files).
- [ ] All Wave A test suites still green (11 + 41 + 39).
- [ ] `replit.md` State model section + `state-wave-0.5-catalogue.md` §8 updated with B-PR1 entry.
- [ ] Manual smoke (B.7 step A6) walks cleanly without console errors.
- [ ] `suggest_deploy` recommended; user publishes; 24h soak before Wave C.

Good luck. The mapping is fully specified in `docs/architecture/state-hierarchy-v1.md` §6 and already tested in `lib/invoice-state/src/__tests__/derivation.test.ts` — your job is to translate that into one atomic SQL migration and prove it landed correctly. Don't add scope; the next four waves are already planned.

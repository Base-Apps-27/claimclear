// One-shot heal (audit-state-divergence follow-up, 2026-05-08).
//
// Background. The 2026-05-08 prod audit
// (`scripts/audit-state-divergence.ts`) flagged 46 invoice_groups rows
// in `status='Awaiting Response' / phase='triage'`. The status is
// truthful — the row was submitted to the payor and is waiting on a
// reply — but `phase` was never bumped past `triage`. The post-Task
// #547/#550 transition helpers correctly derive `Awaiting Response` →
// phase `submitted` (macro `in-flight`); the contract test
// `transition-helper-newstatus-contract.test.ts` enumerates every
// literal-newStatus call site and proves that. So new rows of this
// shape will not accumulate.
//
// These 46 are pre-fix historical residue from a writer that updated
// `status` without routing through the helper. Symptom: the row reads
// in-flight via the legacy macro reader (status column) but pre-submit
// via the canonical macro reader (phase column). The audit script's
// `status_phase_macro_drift` check fires; downstream surfaces (the
// dispute outlook, the Re-attest CTA gate) read whichever column they
// were wired to and disagree.
//
// Heal contract (per row):
//   * UPDATE invoice_groups SET phase = <derived from current legacy
//     tuple>, phase_entered_at = COALESCE(phase_entered_at, NOW()).
//     Status, outcome, closure_reason, hold_reason are NOT touched.
//   * No claim cascade — child claims have no `phase` column.
//   * Write a single `group_phase_healed` audit row with
//     `metadata.backfillId = 'awaiting_response_phase_heal_2026_05_08'`.
//
// Guardrail. Only rows with audit-log evidence of a prior submission-
// path writer (`group_status_changed` audit row whose details mention
// "Portal Queued" or "Awaiting Response", OR a `portal_draft_created`
// row) are healed. A row that landed in this state for any other
// reason is left alone.
//
// Idempotent. Candidate filter + per-row UPDATE re-assert
// `status='Awaiting Response' AND phase='triage'`, so a partial re-run
// only touches rows that still drift.
//
// Run (against whichever DATABASE_URL is exported in the shell;
// typically PROD_DATABASE_URL):
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-heal-stuck-awaiting-response-phase-2026-05-08.ts [--apply]

import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  derivePhaseFromLegacy,
  type LegacyClaimStatus,
  type LegacyOutcome,
} from "@workspace/invoice-state";

const BACKFILL_ID = "awaiting_response_phase_heal_2026_05_08";
const ACTOR_EMAIL = "system@claimclear";
const ACTOR_NAME =
  "System (audit-state-divergence awaiting-response phase heal 2026-05-08)";

interface CandidateRow extends Record<string, unknown> {
  id: number;
  invoice_number: string;
  status: string;
  outcome: string;
  phase: string;
  reattest_required: boolean;
  reattest_completed_at: string | null;
  closure_reason: string | null;
  hold_reason: string | null;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const candidatesRes = await db.execute<CandidateRow>(sql`
    SELECT g.id,
           g.invoice_number,
           g.status::text  AS status,
           g.outcome::text AS outcome,
           g.phase::text   AS phase,
           g.reattest_required,
           g.reattest_completed_at,
           g.closure_reason,
           g.hold_reason
      FROM invoice_groups g
     WHERE g.status::text = 'Awaiting Response'
       AND g.phase::text  = 'triage'
       AND EXISTS (
             SELECT 1 FROM audit_logs a
              WHERE a.invoice_group_id = g.id
                AND (
                      a.action = 'portal_draft_created'
                   OR (a.action = 'group_status_changed'
                       AND (a.details ILIKE '%Portal Queued%'
                         OR a.details ILIKE '%Awaiting Response%'))
                )
           )
     ORDER BY g.id;
  `);
  const candidates = (candidatesRes.rows ?? []) as CandidateRow[];

  console.log(
    `[oneshot] Found ${candidates.length} invoice_groups row(s) stuck in` +
      ` status='Awaiting Response' / phase='triage' with prior submission-path audit evidence.`,
  );

  if (candidates.length === 0) {
    console.log("[oneshot] Nothing to do. Exiting.");
    return;
  }

  if (!apply) {
    console.log("[oneshot] Dry run. Re-run with --apply to write changes.");
    console.log(`[oneshot] Candidates: ${JSON.stringify(candidates, null, 2)}`);
    return;
  }

  let groupsUpdated = 0;
  let auditsWritten = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const row of candidates) {
      const derived = derivePhaseFromLegacy({
        status: row.status as LegacyClaimStatus,
        outcome: row.outcome as LegacyOutcome,
        reattestRequired: row.reattest_required,
        reattestCompletedAt: row.reattest_completed_at
          ? new Date(row.reattest_completed_at)
          : null,
        closureReason: row.closure_reason,
        holdReason: row.hold_reason,
      });
      const newPhase = derived.phase;

      // Defensive: if the deriver still says 'triage' for this tuple
      // (it shouldn't for Awaiting Response/Pending), skip — there's
      // nothing to heal and the heal would no-op anyway.
      if (newPhase === "triage") {
        continue;
      }

      const updateRes = await client.query(
        `UPDATE invoice_groups
            SET phase            = $2::invoice_phase,
                phase_entered_at = COALESCE(phase_entered_at, NOW())
          WHERE id = $1
            AND status::text = 'Awaiting Response'
            AND phase::text  = 'triage'
          RETURNING id`,
        [row.id, newPhase],
      );
      if (updateRes.rowCount === 0) {
        // Another writer beat us to it (or partial re-run).
        continue;
      }
      groupsUpdated += 1;

      const metadata = {
        backfillId: BACKFILL_ID,
        status: "Awaiting Response",
        fromPhase: "triage",
        toPhase: newPhase,
        source: "oneshot:awaiting_response_phase_heal",
        reason:
          "Heal: pre-Task-#547/#550 writer updated status to 'Awaiting Response' " +
          "without routing through transitionGroupStatus, leaving phase='triage'. " +
          "Re-deriving phase from current legacy tuple. Status and outcome unchanged.",
      };

      await client.query(
        `INSERT INTO audit_logs
           (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
         VALUES
           (NULL, $1, $2, $3, $4::jsonb, $5, $6)`,
        [
          row.id,
          "group_phase_healed",
          `phase: triage → ${newPhase} (status unchanged: Awaiting Response)` +
            ` — heal of pre-fix submission writer (backfillId=${BACKFILL_ID})`,
          JSON.stringify(metadata),
          ACTOR_EMAIL,
          ACTOR_NAME,
        ],
      );
      auditsWritten += 1;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  console.log(
    `[oneshot] Done. Updated ${groupsUpdated} invoice_groups row(s),` +
      ` wrote ${auditsWritten} audit row(s).` +
      ` Slice with: SELECT * FROM audit_logs WHERE metadata->>'backfillId' = '${BACKFILL_ID}';`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

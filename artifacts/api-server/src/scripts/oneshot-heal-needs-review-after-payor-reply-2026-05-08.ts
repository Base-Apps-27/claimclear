// One-shot heal (Task #547, 2026-05-08).
//
// Background. Until Task #547 the response matcher wrote
// `status = 'Needs Review'` for every classified payor reply. The new
// hierarchical-state-machine deriver maps "Needs Review" to phase
// `triage`, while the verdict endpoint
// (`POST /claims/:id/verdict` / bulk `promote-draft-verdicts`) requires
// macro phase `response-pending` (i.e. phase `response_received`).
// Operators saw HTTP 409 "Group is not in the response-pending phase"
// on every Approved/Denied click for these rows. Production scan on
// 2026-05-08 found 62 such rows.
//
// Heal contract (per row):
//   * UPDATE invoice_groups SET status='Ready to Review',
//     phase=<derived> (expected 'response_received'),
//     phase_entered_at = COALESCE(phase_entered_at, NOW()).
//   * Cascade the legacy status change to disputed child claims (the
//     `errorTypeId IS NOT NULL` cohort that `syncChildRides` operates
//     on; `On Hold` children are skipped to match the live cascade).
//   * Write a single `group_status_healed` audit row with
//     `metadata.backfillId = 'needs_review_after_payor_reply_heal_2026_05_08'`
//     so the heal can be sliced out of audit history later.
//
// Guardrail. Only rows that ALREADY have an audit_logs row with
// `action IN ('response_received','response_acknowledged')` are
// healed — that is the "a payor response actually arrived" signal.
// Rows in `status='Needs Review' / phase='triage'` for any other
// reason (operator-driven triage, on-hold revert, etc.) are left
// alone.
//
// Out of scope (per Task #547):
//   * Rows in `status='Needs Review' / phase='closed'`. Those reached
//     closed via a different path; do not touch.
//   * The deriver's "Needs Review → triage" mapping. That is still
//     correct for genuine triage rows; only the matcher's write site
//     was wrong.
//
// Idempotent. The candidate query filters on the exact stuck
// fingerprint, and the per-row UPDATE re-asserts the same WHERE so a
// partial re-run only touches rows that still drift. Re-running after
// a clean run is a no-op.
//
// Run (against whichever DATABASE_URL is exported in the shell;
// typically PROD_DATABASE_URL):
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-heal-needs-review-after-payor-reply-2026-05-08.ts [--apply]

import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  derivePhaseFromLegacy,
  type LegacyClaimStatus,
  type LegacyOutcome,
} from "@workspace/invoice-state";

const BACKFILL_ID = "needs_review_after_payor_reply_heal_2026_05_08";
const ACTOR_EMAIL = "system@claimclear";
const ACTOR_NAME = "System (Task #547 needs-review-after-payor-reply heal 2026-05-08)";
const HEAL_TARGET_STATUS = "Ready to Review";

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

  // Stuck fingerprint + payor-response guardrail. EXISTS filters on
  // the audit-log evidence so a row that landed in 'Needs Review' for
  // any other reason is left alone.
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
     WHERE g.status::text = 'Needs Review'
       AND g.phase::text  = 'triage'
       AND EXISTS (
             SELECT 1 FROM audit_logs a
              WHERE a.invoice_group_id = g.id
                AND a.action IN ('response_received', 'response_acknowledged')
           )
     ORDER BY g.id;
  `);
  const candidates = (candidatesRes.rows ?? []) as CandidateRow[];

  console.log(
    `[oneshot] Found ${candidates.length} invoice_groups row(s) stuck in` +
      ` status='Needs Review' / phase='triage' with prior payor-response audit evidence.`,
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
  let childrenCascaded = 0;
  let auditsWritten = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const row of candidates) {
      // Re-derive the phase from the post-heal legacy tuple. With
      // status='Ready to Review' and the row's existing outcome/closure
      // shape this is expected to be 'response_received', but we trust
      // the deriver as the single source of truth (Wave B/C contract).
      const derived = derivePhaseFromLegacy({
        status: HEAL_TARGET_STATUS as LegacyClaimStatus,
        outcome: row.outcome as LegacyOutcome,
        reattestRequired: row.reattest_required,
        reattestCompletedAt: row.reattest_completed_at
          ? new Date(row.reattest_completed_at)
          : null,
        closureReason: row.closure_reason,
        holdReason: row.hold_reason,
      });
      const newPhase = derived.phase;

      const updateRes = await client.query(
        `UPDATE invoice_groups
            SET status           = $2::group_status,
                phase            = $3::invoice_phase,
                phase_entered_at = COALESCE(phase_entered_at, NOW())
          WHERE id = $1
            AND status::text = 'Needs Review'
            AND phase::text  = 'triage'
          RETURNING id`,
        [row.id, HEAL_TARGET_STATUS, newPhase],
      );
      if (updateRes.rowCount === 0) {
        // Another writer beat us to it (or partial re-run). Don't
        // double-stamp the audit row.
        continue;
      }
      groupsUpdated += 1;

      // Cascade the legacy status change to disputed child claims —
      // matches `syncChildRides` (skip On Hold, require error_type_id).
      // Outcome is unchanged (the matcher never sets outcome; the
      // operator records that on the verdict click).
      const cascadeRes = await client.query(
        `UPDATE claims
            SET status = $2::claim_status
          WHERE invoice_group_id = $1
            AND error_type_id IS NOT NULL
            AND status::text <> 'On Hold'
            AND status::text <> $2`,
        [row.id, HEAL_TARGET_STATUS],
      );
      childrenCascaded += cascadeRes.rowCount ?? 0;

      const metadata = {
        backfillId: BACKFILL_ID,
        fromStatus: "Needs Review",
        toStatus: HEAL_TARGET_STATUS,
        fromPhase: "triage",
        toPhase: newPhase,
        cascadedChildCount: cascadeRes.rowCount ?? 0,
        source: "oneshot:needs_review_after_payor_reply_heal",
        reason:
          "Heal: response matcher wrote status='Needs Review' for classified payor replies " +
          "(Task #547). Phase derived to 'triage', which 409s the verdict endpoint. " +
          "Re-routing to 'Ready to Review' so phase=response_received and Approved/Denied " +
          "clicks succeed.",
      };

      await client.query(
        `INSERT INTO audit_logs
           (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
         VALUES
           (NULL, $1, $2, $3, $4::jsonb, $5, $6)`,
        [
          row.id,
          "group_status_healed",
          `status: Needs Review → ${HEAL_TARGET_STATUS}, phase: triage → ${newPhase}` +
            ` — heal of pre-Task-547 matcher write site (backfillId=${BACKFILL_ID})`,
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
      ` cascaded ${childrenCascaded} child claim(s), wrote ${auditsWritten} audit row(s).` +
      ` Slice with: SELECT * FROM audit_logs WHERE metadata->>'backfillId' = '${BACKFILL_ID}';`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

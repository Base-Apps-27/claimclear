// One-shot heal (Task #543, 2026-05-08).
//
// Heals invoice_groups rows where the canonical hierarchical-state
// columns moved to closed/reattested but the legacy `status` /
// `outcome` columns were left wherever the operator clicked from
// (almost always Needs Review / Pending post-email-match) because
// the prior `/invoice-groups/:id/reattest/complete` route stamped
// `reattest_completed_at` directly without routing through
// `transitionGroupStatusAndOutcome`. Production scan on 2026-05-08
// found 9 such rows.
//
// What this does (per row):
//   * Updates `invoice_groups` SET status='Resolved', outcome='Approved',
//     phase='closed' (defensive — already 'closed' for these rows),
//     phaseEnteredAt=NOW() (only if NULL),
//     closureReason='reattested' (defensive — already 'reattested').
//   * Writes a `group_status_and_outcome_changed` audit row matching
//     the shape `transitionGroupStatusAndOutcome` would have produced,
//     with `metadata.backfillId =
//     'reattest_completed_status_heal_2026_05_08'` (Task #268
//     convention) so the backfill's effects can be sliced out of audit
//     history later.
//
// What this does NOT do:
//   * Cascade legacy `status` to disputed children. The disputed-child
//     sync backfill at boot (`src/index.ts:125`) already heals child
//     status drift idempotently, and these rows' children sit in legit
//     mid-flight statuses that can't be terminal-flipped without a
//     verdict — letting the standing backfill catch up keeps the
//     decision local.
//
// Idempotent: the candidate query filters on the exact drifted
// fingerprint (`reattest_completed_at IS NOT NULL` AND
// `status NOT IN ('Resolved','Denied','Expired')`), and the per-row
// UPDATE re-asserts the same WHERE so a partial re-run only touches
// rows that still drift.
//
// Run (against whichever DATABASE_URL is exported in the shell;
// typically PROD_DATABASE_URL):
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-heal-reattest-completed-status-2026-05-08.ts [--apply]

import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

const BACKFILL_ID = "reattest_completed_status_heal_2026_05_08";
const ACTOR_EMAIL = "system@claimclear";
const ACTOR_NAME = "System (Task #543 reattest-status heal 2026-05-08)";

interface CandidateRow extends Record<string, unknown> {
  id: number;
  invoice_number: string;
  status: string;
  outcome: string;
  phase: string | null;
  closure_reason: string | null;
  reattest_completed_at: string;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const candidatesRes = await db.execute<CandidateRow>(sql`
    SELECT id,
           invoice_number,
           status::text         AS status,
           outcome::text        AS outcome,
           phase,
           closure_reason,
           reattest_completed_at
      FROM invoice_groups
     WHERE reattest_completed_at IS NOT NULL
       AND status::text NOT IN ('Resolved', 'Denied', 'Expired')
     ORDER BY id;
  `);
  const candidates = (candidatesRes.rows ?? []) as CandidateRow[];

  console.log(
    `[oneshot] Found ${candidates.length} invoice_groups row(s) where reattest_completed_at` +
      ` is set but legacy status is non-terminal.`,
  );

  if (candidates.length === 0) {
    console.log("[oneshot] Nothing to do. Exiting.");
    return;
  }

  if (!apply) {
    console.log("[oneshot] Dry run. Re-run with --apply to write changes.");
    console.log(
      `[oneshot] Candidates: ${JSON.stringify(candidates, null, 2)}`,
    );
    return;
  }

  let updated = 0;
  let auditsWritten = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const row of candidates) {
      const updateRes = await client.query(
        `UPDATE invoice_groups
            SET status         = 'Resolved'::group_status,
                outcome        = 'Approved'::group_outcome,
                phase          = 'closed',
                phase_entered_at = COALESCE(phase_entered_at, NOW()),
                closure_reason = 'reattested'
          WHERE id = $1
            AND reattest_completed_at IS NOT NULL
            AND status::text NOT IN ('Resolved', 'Denied', 'Expired')
          RETURNING id`,
        [row.id],
      );
      if (updateRes.rowCount === 0) {
        // Another writer beat us to it (or re-run mid-flight). Skip the
        // audit row so we don't double-stamp.
        continue;
      }
      updated += 1;

      const metadata = {
        backfillId: BACKFILL_ID,
        fromStatus: row.status,
        toStatus: "Resolved",
        fromOutcome: row.outcome,
        toOutcome: "Approved",
        source: "oneshot:reattest_completed_status_heal",
        reason:
          "Heal: reattest_completed_at was set but legacy status/outcome were never moved to a terminal state" +
          " (Task #543). Routing through canonical Resolved/Approved retroactively.",
        closureReason: "reattested",
        closureReasonLabel: "Re-attested",
        previousPhase: row.phase,
        previousClosureReason: row.closure_reason,
      };

      await client.query(
        `INSERT INTO audit_logs
           (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
         VALUES
           (NULL, $1, $2, $3, $4::jsonb, $5, $6)`,
        [
          row.id,
          "group_status_and_outcome_changed",
          `status: ${row.status} → Resolved, outcome: ${row.outcome} → Approved, closure: Re-attested` +
            ` — heal of pre-Task-543 reattest-complete writer (backfillId=${BACKFILL_ID})`,
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
    `[oneshot] Done. Updated ${updated} invoice_groups row(s), wrote ${auditsWritten} audit row(s).` +
      ` Slice with: SELECT * FROM audit_logs WHERE metadata->>'backfillId' = '${BACKFILL_ID}';`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

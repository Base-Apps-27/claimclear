// One-shot heal (2026-05-12 incident, group #422 et al.).
//
// Heals "survivor" legs whose parent invoice_group has already cleared
// MAS re-attestation (`reattest_completed_at IS NOT NULL`,
// status='Resolved', phase='closed') but whose own row was left at
// `status='MAS Eligible'` and `attestation_state IN ('pending','queued')`.
//
// Root cause: `transitionGroupStatusAndOutcome`'s child-status cascade
// only fires for legs with `errorTypeId IS NOT NULL` (the "disputed
// children" predicate). Non-issue / no-error survivor legs
// (errorTypeId=NULL, disposition='final_nonissue' or sop_outcome
// 'non_issue') are intentionally skipped by that cascade. Combined with
// the MAS-Eligible attestation-cascade that queued them upstream, those
// survivors get stranded after the group closes:
//   * `claims.status` stays at 'MAS Eligible'
//   * `claims.attestation_state` stays at 'queued' (or 'pending')
//   * `/claims/attestation-pending` still admits them (it admits any
//     status='MAS Eligible' + attestation_state in pending|queued leg)
//   * the attestation wizard offers the "Re-attested in MAS" button
//     for the parent group, and every click 409s because the group is
//     already closed.
//
// Production scan on 2026-05-12 found 9 such legs across 8 groups
// (422, 514, 540, 541, 565, 593, 600, 641; group 593 has two stranded
// legs).
//
// What this does (per stranded leg):
//   * Updates `claims` SET status='Resolved',
//     attestation_state='completed', attested_at = parent group's
//     reattest_completed_at, attested_by = parent group's
//     reattest_completed_by.
//   * Writes a `claim_status_changed` audit row mirroring the cascade
//     `transitionGroupStatusAndOutcome` would have produced if it
//     hadn't filtered survivor legs out, with
//     `metadata.backfillId = 'survivor_leg_stranded_heal_2026_05_12'`
//     (Task #268 convention) so the heal's effects can be sliced out
//     of audit history later.
//   * Writes an `attestation_completed` audit row so the leg's
//     attestation timeline reflects the auto-completion.
//   * Refreshes the leg's denormalized disposition cache via the
//     standing helper so `claims.disposition` lands in `attested`
//     (matches what `set_claim_disposition` would have produced).
//
// Forward fix shipped alongside this heal: the same survivor cleanup
// is now embedded in the
// `/api/invoice-groups/:id/reattest/complete` writer (see the
// "Survivor-leg cleanup" block in `routes/invoice-groups.ts`), so
// future reattest completions will not strand survivor legs.
//
// Idempotent: the candidate query filters on the exact stranded
// fingerprint, and per-leg UPDATE re-asserts the same WHERE so a
// partial re-run only touches rows that still drift.
//
// Run (against whichever DATABASE_URL is exported in the shell;
// typically PROD_DATABASE_URL):
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-heal-survivor-leg-stranded-2026-05-12.ts [--apply]

import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { refreshClaimDenormalizedCache } from "../lib/denormalized-cache";

const BACKFILL_ID = "survivor_leg_stranded_heal_2026_05_12";
const ACTOR_EMAIL = "system@claimclear";
const ACTOR_NAME = "System (survivor-leg stranded heal 2026-05-12)";

interface CandidateRow extends Record<string, unknown> {
  leg_id: number;
  leg_status: string;
  leg_outcome: string;
  attestation_state: string;
  group_id: number;
  reattest_completed_at: string;
  reattest_completed_by: string | null;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const candidatesRes = await db.execute<CandidateRow>(sql`
    SELECT c.id                          AS leg_id,
           c.status::text                AS leg_status,
           c.outcome::text               AS leg_outcome,
           c.attestation_state::text     AS attestation_state,
           g.id                          AS group_id,
           g.reattest_completed_at,
           g.reattest_completed_by
      FROM claims c
      JOIN invoice_groups g ON g.id = c.invoice_group_id
     WHERE g.reattest_completed_at IS NOT NULL
       AND g.status::text = 'Resolved'
       AND c.status::text = 'MAS Eligible'
       AND c.attestation_state::text IN ('pending', 'queued')
     ORDER BY g.id, c.id;
  `);
  const candidates = (candidatesRes.rows ?? []) as CandidateRow[];

  console.log(
    `[oneshot] Found ${candidates.length} stranded survivor leg(s) under closed/Resolved groups.`,
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

  let updated = 0;
  let auditsWritten = 0;
  const touchedLegIds: number[] = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const row of candidates) {
      const updateRes = await client.query(
        `UPDATE claims
            SET status            = 'Resolved'::claim_status,
                attestation_state = 'completed',
                attested_at       = $2,
                attested_by       = $3
          WHERE id = $1
            AND status::text = 'MAS Eligible'
            AND attestation_state::text IN ('pending', 'queued')
          RETURNING id`,
        [row.leg_id, row.reattest_completed_at, row.reattest_completed_by ?? ACTOR_EMAIL],
      );
      if (updateRes.rowCount === 0) {
        // Another writer beat us to it (or re-run mid-flight). Skip the
        // audit rows so we don't double-stamp.
        continue;
      }
      updated += 1;
      touchedLegIds.push(row.leg_id);

      const cascadeMetadata = {
        backfillId: BACKFILL_ID,
        from: row.leg_status,
        to: "Resolved",
        previousOutcome: row.leg_outcome,
        newOutcome: row.leg_outcome,
        source: "oneshot:survivor_leg_stranded_heal",
        cascadedFromGroupId: row.group_id,
        reason:
          "Heal: survivor leg was stranded at status=MAS Eligible after parent group closed, because" +
          " transitionGroupStatusAndOutcome's child-status cascade only touches legs with errorTypeId IS NOT NULL.",
      };

      await client.query(
        `INSERT INTO audit_logs
           (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
         VALUES
           ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [
          row.leg_id,
          row.group_id,
          "claim_status_changed",
          `Status changed from ${row.leg_status} to Resolved (cascaded from invoice group manual heal, backfillId=${BACKFILL_ID})`,
          JSON.stringify(cascadeMetadata),
          ACTOR_EMAIL,
          ACTOR_NAME,
        ],
      );
      auditsWritten += 1;

      const attMetadata = {
        backfillId: BACKFILL_ID,
        from: row.attestation_state,
        to: "completed",
        trigger: "group_reattest_completed_survivor_heal",
        invoiceGroupId: row.group_id,
      };

      await client.query(
        `INSERT INTO audit_logs
           (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
         VALUES
           ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [
          row.leg_id,
          row.group_id,
          "attestation_completed",
          `Attestation auto-completed for survivor leg (${row.attestation_state} → completed) via heal (backfillId=${BACKFILL_ID}).`,
          JSON.stringify(attMetadata),
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

  // Refresh disposition cache outside the raw-pg tx (the helper uses
  // the drizzle pool/db). Each call is idempotent.
  for (const legId of touchedLegIds) {
    await refreshClaimDenormalizedCache(legId);
  }

  console.log(
    `[oneshot] Done. Updated ${updated} claim row(s), wrote ${auditsWritten} audit row(s),` +
      ` refreshed ${touchedLegIds.length} disposition cache(s).` +
      ` Slice with: SELECT * FROM audit_logs WHERE metadata->>'backfillId' = '${BACKFILL_ID}';`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

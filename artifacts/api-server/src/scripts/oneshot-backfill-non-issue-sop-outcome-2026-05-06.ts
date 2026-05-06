// One-shot backfill (2026-05-06).
//
// Heals legs that were excluded as "non-issue" by the historical
// `retro_auto_non_issue_backfill` (2026-05-01) and any other path that
// wrote a `leg_excluded` audit row with `metadata.reason = 'non_issue'`
// but never wrote `claims.sop_outcome = 'non_issue'`.
//
// Why this matters:
//   The new invoice-level outlook (Task #476,
//   `deriveInvoiceDisputeOutlook` in
//   `artifacts/claimclear/src/lib/whats-next-derivation.ts`) treats a
//   leg as a re-attest survivor ONLY when `sopOutcome === 'non_issue'`.
//   A leg that's excluded with audit-reason='non_issue' but null
//   `sop_outcome` is invisible to that gate, so an invoice that should
//   show "Re-attest" instead falls through to the "Mark as closed"
//   amber CTA (Task #481 nothing_to_do path). Production scan on
//   2026-05-06 found 680 such legs across 613 invoice groups.
//
// What this script does:
//   For every leg whose latest `leg_excluded` audit row carries
//   `metadata.reason = 'non_issue'` AND whose `claims.sop_outcome` is
//   currently NULL, set `sop_outcome = 'non_issue'` and write a
//   matching `leg_sop_outcome_backfilled` audit row. The row update
//   itself is guarded by `sop_outcome IS NULL`, so re-running this
//   script after the first pass is a no-op.
//
// Audit shape:
//   Each new audit row carries `metadata.backfillId =
//   'sop_outcome_non_issue_backfill_2026_05_06'` (Task #268 convention)
//   so this run's effects can be sliced out of audit history with one
//   uniform filter, AND `metadata.sourceAuditId` referencing the
//   leg_excluded row that triggered the heal.
//
// Run (against whichever DATABASE_URL is exported in the shell;
// typically PROD_DATABASE_URL for this script):
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-backfill-non-issue-sop-outcome-2026-05-06.ts [--apply]

import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

const BACKFILL_ID = "sop_outcome_non_issue_backfill_2026_05_06";
const ACTOR_EMAIL = "system@claimclear";
const ACTOR_NAME = "System (sop_outcome non-issue backfill 2026-05-06)";

interface CandidateRow extends Record<string, unknown> {
  claim_id: number;
  invoice_group_id: number | null;
  conf_number: string | null;
  source_audit_id: number;
  source_action: string;
  source_reason: string;
  source_backfill_id: string | null;
}

async function main() {
  const apply = process.argv.includes("--apply");

  // Latest leg_excluded audit row per claim where reason='non_issue', joined
  // to claims with sop_outcome IS NULL. We rank by id DESC so we always cite
  // the newest excluded-as-non-issue audit row as the source.
  const candidatesRes = await db.execute<CandidateRow>(sql`
    WITH ranked AS (
      SELECT a.id           AS audit_id,
             a.claim_id     AS claim_id,
             a.action       AS action,
             a.metadata->>'reason'     AS reason,
             a.metadata->>'backfillId' AS backfill_id,
             ROW_NUMBER() OVER (PARTITION BY a.claim_id ORDER BY a.id DESC) AS rn
      FROM audit_logs a
      WHERE a.action = 'leg_excluded'
        AND a.metadata->>'reason' = 'non_issue'
        AND a.claim_id IS NOT NULL
    )
    SELECT c.id              AS claim_id,
           c.invoice_group_id AS invoice_group_id,
           c.conf_number     AS conf_number,
           ranked.audit_id   AS source_audit_id,
           ranked.action     AS source_action,
           ranked.reason     AS source_reason,
           ranked.backfill_id AS source_backfill_id
    FROM ranked
    JOIN claims c ON c.id = ranked.claim_id
    WHERE ranked.rn = 1
      AND c.sop_outcome IS NULL
    ORDER BY c.invoice_group_id NULLS LAST, c.id;
  `);

  const candidates = (candidatesRes.rows ?? []) as CandidateRow[];
  const groupIds = new Set(
    candidates.map((r) => r.invoice_group_id).filter((g): g is number => g != null),
  );

  // Source-attribution histogram so the operator can sanity-check before --apply.
  const bySource = candidates.reduce<Record<string, number>>((acc, r) => {
    const key = r.source_backfill_id ?? "(no backfillId on source audit)";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    `[oneshot] Found ${candidates.length} leg(s) across ${groupIds.size} invoice group(s) with` +
      ` audit-reason='non_issue' but sop_outcome IS NULL.`,
  );
  console.log(`[oneshot] Source-audit breakdown: ${JSON.stringify(bySource)}`);

  if (candidates.length === 0) {
    console.log("[oneshot] Nothing to do. Exiting.");
    return;
  }

  if (!apply) {
    console.log("[oneshot] Dry run. Re-run with --apply to write changes.");
    console.log(
      `[oneshot] First 10 candidates: ${JSON.stringify(candidates.slice(0, 10), null, 2)}`,
    );
    return;
  }

  // Single transaction: every leg gets its sop_outcome flipped AND its audit
  // row written, or none do. Per-row WHERE guard (`sop_outcome IS NULL`)
  // makes the UPDATE idempotent even if the script crashes mid-run and is
  // re-invoked.
  let updated = 0;
  let auditsWritten = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const row of candidates) {
      const updateRes = await client.query(
        `UPDATE claims
            SET sop_outcome = 'non_issue'
          WHERE id = $1
            AND sop_outcome IS NULL
          RETURNING id`,
        [row.claim_id],
      );
      if (updateRes.rowCount === 0) {
        // Another process beat us to it (or the script was re-run mid-flight).
        // Skip the audit row so we don't double-stamp.
        continue;
      }
      updated += 1;

      const metadata = {
        backfillId: BACKFILL_ID,
        sourceAuditId: row.source_audit_id,
        sourceAction: row.source_action,
        sourceReason: row.source_reason,
        sourceBackfillId: row.source_backfill_id,
        previousSopOutcome: null,
        newSopOutcome: "non_issue",
        rationale:
          "leg was excluded as non_issue via leg_excluded audit but claims.sop_outcome was never written;" +
          " backfilling so the invoice-level outlook (Task #476) recognises it as a re-attest survivor",
      };

      await client.query(
        `INSERT INTO audit_logs
           (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
         VALUES
           ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [
          row.claim_id,
          row.invoice_group_id,
          "leg_sop_outcome_backfilled",
          `sop_outcome backfilled to 'non_issue' from leg_excluded audit #${row.source_audit_id} (reason='non_issue'). See backfillId=${BACKFILL_ID}.`,
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
    `[oneshot] Done. Updated ${updated} claim row(s), wrote ${auditsWritten} audit row(s).` +
      ` Slice with: SELECT * FROM audit_logs WHERE metadata->>'backfillId' = '${BACKFILL_ID}';`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

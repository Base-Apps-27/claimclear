// One-shot backfill (Task #648, 2026-05-15).
//
// Backfills `invoice_groups.approved_amount = total_amount` on every
// row whose outcome is 'Approved' (full approval, NOT 'Partially
// Approved') and whose `approved_amount` is currently NULL or 0.
//
// Why this exists
// ---------------
// The MAS re-attest completion route (`POST /invoice-groups/:id/
// reattest/complete`, `routes/invoice-groups.ts:4343`) hard-codes
// `outcome='Approved'` and stamps `reattest_completed_at` but, prior
// to the Task #648 patch in the same file, never wrote
// `approved_amount`. Every group that closed via that path landed
// with `outcome='Approved'`, `reattest_completed_at` set, and
// `approved_amount=NULL` — which made the dashboard "Recovered $",
// "Recovery rate", "Net change vs prior" and the daily-brief
// recovery block all read $0 / 0% even with a non-zero "wins" count.
// Production scan on 2026-05-15 found 69 such rows summing to
// ~$6,151.79 of un-credited recovered $.
//
// What this does (per row)
// ------------------------
//   * UPDATE invoice_groups SET approved_amount = total_amount
//     WHERE outcome = 'Approved'
//       AND (approved_amount IS NULL OR approved_amount = 0)
//       AND is_tour_sample = false.
//   * Writes a single per-row `approved_amount_backfilled` audit row
//     with `metadata.backfillId =
//     'approved_amount_default_2026_05_15'` (Task #268 convention) so
//     the backfill's effects can be sliced out of audit history later.
//
// What this does NOT do
// ---------------------
//   * Touch any 'Partially Approved' row. A partial approval has a
//     real per-invoice dollar number that only the operator knows;
//     defaulting to total_amount would silently inflate recovered $
//     for those rows. The forward-going writer patch likewise refuses
//     to touch partials.
//   * Touch any row with an existing non-zero `approved_amount` (an
//     operator-entered number always wins).
//   * Touch tour samples.
//   * Cascade to per-leg `claims.approved_amount`. Group-level
//     recovered-$ is the canonical surface that drives every dollar
//     tile on the Dashboard / Insights / daily brief; the leg-level
//     column is read by per-claim drilldowns only and inherits its
//     own fill via the verdict-time writers. A separate one-shot can
//     follow if leg-level drilldowns ever surface zeros.
//
// Idempotent: the candidate query filters on the exact gap
// fingerprint (`outcome='Approved' AND (approved_amount IS NULL OR
// approved_amount = 0)`), and the per-row UPDATE re-asserts the same
// WHERE so a partial re-run only touches rows that still drift.
//
// Run (against whichever DATABASE_URL is exported in the shell;
// typically PROD_DATABASE_URL):
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-backfill-approved-amount-2026-05-15.ts [--apply]
//
// Without `--apply` the script does a dry run: it prints what it
// would touch and exits without writing.

import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

const BACKFILL_ID = "approved_amount_default_2026_05_15";
const ACTOR_EMAIL = "system@claimclear";
const ACTOR_NAME = "System (Task #648 approved-amount default backfill 2026-05-15)";

interface CandidateRow extends Record<string, unknown> {
  id: number;
  invoice_number: string | null;
  outcome: string;
  total_amount: string | null;
  approved_amount: string | null;
  reattest_completed_at: string | null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    `[oneshot] approved_amount backfill — mode: ${apply ? "APPLY" : "DRY RUN"}`,
  );
  console.log(`[oneshot] backfillId: ${BACKFILL_ID}`);

  const candidatesRes = await db.execute(sql<CandidateRow>`
    SELECT
      id,
      invoice_number,
      outcome::text             AS outcome,
      total_amount::text        AS total_amount,
      approved_amount::text     AS approved_amount,
      reattest_completed_at::text AS reattest_completed_at
    FROM invoice_groups
    WHERE is_tour_sample = false
      AND outcome = 'Approved'
      AND (approved_amount IS NULL OR approved_amount = 0)
    ORDER BY id;
  `);
  const candidates = (candidatesRes as unknown as { rows: CandidateRow[] }).rows
    ?? (candidatesRes as unknown as CandidateRow[]);
  console.log(`[oneshot] candidates: ${candidates.length}`);

  if (candidates.length === 0) {
    console.log("[oneshot] nothing to do — exiting.");
    await pool.end();
    return;
  }

  const totalDollars = candidates.reduce(
    (acc, r) => acc + (parseFloat(r.total_amount ?? "0") || 0),
    0,
  );
  console.log(
    `[oneshot] would credit recovered_$ += ${totalDollars.toFixed(2)} across ${candidates.length} rows`,
  );

  // Print the first 10 + last 5 for a human sanity check.
  const preview = [...candidates.slice(0, 10), ...candidates.slice(-5)];
  console.log("[oneshot] preview (first 10 + last 5):");
  for (const r of preview) {
    console.log(
      `  id=${r.id} invoice=${r.invoice_number ?? "—"} total=${r.total_amount} approved=${r.approved_amount ?? "NULL"} reattest=${r.reattest_completed_at ?? "—"}`,
    );
  }

  if (!apply) {
    console.log("[oneshot] DRY RUN — no writes performed. Re-run with --apply to commit.");
    await pool.end();
    return;
  }

  let applied = 0;
  for (const row of candidates) {
    await db.transaction(async (tx) => {
      const updateRes = await tx.execute(sql`
        UPDATE invoice_groups
        SET approved_amount = total_amount
        WHERE id = ${row.id}
          AND outcome = 'Approved'
          AND (approved_amount IS NULL OR approved_amount = 0)
        RETURNING id, approved_amount::text AS approved_amount, total_amount::text AS total_amount;
      `);
      const updatedRows = (updateRes as unknown as { rows: Array<{ id: number; approved_amount: string; total_amount: string }> }).rows
        ?? (updateRes as unknown as Array<{ id: number; approved_amount: string; total_amount: string }>);
      if (updatedRows.length === 0) {
        console.log(`[oneshot] id=${row.id} skipped (lost race or no longer matches filter)`);
        return;
      }
      const u = updatedRows[0];
      await tx.execute(sql`
        INSERT INTO audit_logs (invoice_group_id, action, details, metadata, user_email, user_name)
        VALUES (
          ${row.id},
          'approved_amount_backfilled',
          ${`Backfill: approved_amount NULL/0 → ${u.approved_amount} (= total_amount) on Approved group; previously masked the recovered-$ dashboard tile.`},
          ${JSON.stringify({
            backfillId: BACKFILL_ID,
            previousApprovedAmount: row.approved_amount,
            newApprovedAmount: u.approved_amount,
            totalAmount: u.total_amount,
          })}::jsonb,
          ${ACTOR_EMAIL},
          ${ACTOR_NAME}
        );
      `);
      applied += 1;
    });
  }

  console.log(`[oneshot] applied: ${applied} / ${candidates.length}`);

  // Post-run verification.
  const verifyRes = await db.execute(sql`
    SELECT
      outcome::text AS outcome,
      COUNT(*)::int AS n,
      COUNT(*) FILTER (WHERE approved_amount IS NOT NULL AND approved_amount > 0)::int AS n_with_approved_amt,
      COALESCE(SUM(approved_amount), 0)::text AS sum_approved,
      COALESCE(SUM(total_amount), 0)::text AS sum_total
    FROM invoice_groups
    WHERE is_tour_sample = false
      AND outcome IN ('Approved','Partially Approved')
    GROUP BY outcome
    ORDER BY outcome;
  `);
  const verifyRows = (verifyRes as unknown as { rows: Array<Record<string, unknown>> }).rows
    ?? (verifyRes as unknown as Array<Record<string, unknown>>);
  console.log("[oneshot] post-backfill rollup:");
  for (const r of verifyRows) {
    console.log(`  ${JSON.stringify(r)}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[oneshot] FAILED:", err);
  process.exit(1);
});

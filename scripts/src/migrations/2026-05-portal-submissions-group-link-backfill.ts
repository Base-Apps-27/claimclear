// One-shot backfill that prepares portal_submissions for the cutover task
// (Task #199). Before we can drop portal_submissions.claim_id, every row's
// invoice_group_id must be populated — that's the canonical link in the
// per-invoice model.
//
// What this script does:
//   1. Reports counts of the work to be done (rows missing invoice_group_id,
//      rows pointing at deleted/orphan claims).
//   2. For every row where invoice_group_id IS NULL: resolve via
//      claim_id -> claims.invoice_group_id and update the row.
//   3. Per the task spec: orphan submissions whose claim is gone OR whose
//      claim has no invoice_group_id are deleted. The historical paper trail
//      lives in audit_logs.
//   4. Verifies the post-state:
//        - SELECT COUNT(*) FROM portal_submissions WHERE invoice_group_id IS NULL
//          must return 0.
//        - Spot-check 10 random rows: claim_id -> claims.invoice_group_id
//          must equal the row's invoice_group_id.
//
// Idempotent: re-running after a successful pass is a no-op (no rows match
// the WHERE NULL filter).
//
// To run:
//   pnpm --filter @workspace/scripts run backfill:portal-submissions-group-link

import { db, pool } from "@workspace/db";

interface OrphanRow {
  id: number;
  claim_id: number;
  reason: "claim_missing" | "claim_has_no_group";
}

async function reportPreState(): Promise<void> {
  const totalRes = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM portal_submissions`,
  );
  const nullGroupRes = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM portal_submissions WHERE invoice_group_id IS NULL`,
  );
  console.log(
    `[pre] portal_submissions total=${totalRes.rows[0].n} | invoice_group_id IS NULL=${nullGroupRes.rows[0].n}`,
  );
}

async function findOrphans(): Promise<OrphanRow[]> {
  // Two orphan flavours that block the column drop:
  //   - claim_missing: the claim_id points at a deleted claims row.
  //   - claim_has_no_group: the claim exists but has no invoice_group_id, so
  //     we cannot project the submission onto an invoice group.
  const orphans: OrphanRow[] = [];

  const missing = await pool.query<{ id: number; claim_id: number }>(`
    SELECT ps.id, ps.claim_id
    FROM portal_submissions ps
    LEFT JOIN claims c ON c.id = ps.claim_id
    WHERE ps.invoice_group_id IS NULL
      AND c.id IS NULL
  `);
  for (const r of missing.rows) {
    orphans.push({ id: r.id, claim_id: r.claim_id, reason: "claim_missing" });
  }

  const noGroup = await pool.query<{ id: number; claim_id: number }>(`
    SELECT ps.id, ps.claim_id
    FROM portal_submissions ps
    JOIN claims c ON c.id = ps.claim_id
    WHERE ps.invoice_group_id IS NULL
      AND c.invoice_group_id IS NULL
  `);
  for (const r of noGroup.rows) {
    orphans.push({ id: r.id, claim_id: r.claim_id, reason: "claim_has_no_group" });
  }

  return orphans;
}

async function deleteOrphans(orphans: OrphanRow[]): Promise<void> {
  if (orphans.length === 0) {
    console.log("[orphans] none — nothing to delete");
    return;
  }
  console.log(`[orphans] found ${orphans.length} — deleting (recommended path per task plan)`);
  for (const o of orphans) {
    console.log(`  delete portal_submissions#${o.id} (claim_id=${o.claim_id}, reason=${o.reason})`);
  }
  const ids = orphans.map(o => o.id);
  await pool.query(
    `DELETE FROM portal_submissions WHERE id = ANY($1::int[])`,
    [ids],
  );
}

async function backfillGroupLinks(): Promise<number> {
  // After deleting orphans, every remaining row with NULL invoice_group_id
  // points at a claim that has invoice_group_id set. Project it.
  const r = await pool.query(`
    UPDATE portal_submissions ps
    SET invoice_group_id = c.invoice_group_id,
        updated_at = now()
    FROM claims c
    WHERE c.id = ps.claim_id
      AND ps.invoice_group_id IS NULL
      AND c.invoice_group_id IS NOT NULL
  `);
  return r.rowCount ?? 0;
}

async function verify(): Promise<boolean> {
  const remaining = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM portal_submissions WHERE invoice_group_id IS NULL`,
  );
  const remainingCount = remaining.rows[0].n;
  console.log(`[verify] portal_submissions WHERE invoice_group_id IS NULL = ${remainingCount}`);
  if (remainingCount !== 0) {
    console.error(
      `  ✗ Backfill incomplete — ${remainingCount} rows still have NULL invoice_group_id. Investigate before dropping the column.`,
    );
    return false;
  }

  // Spot-check 10 random rows: claim_id -> claims.invoice_group_id must
  // equal the submission's invoice_group_id.
  const spot = await pool.query<{
    id: number;
    claim_id: number;
    invoice_group_id: number;
    claim_group: number | null;
  }>(`
    SELECT ps.id, ps.claim_id, ps.invoice_group_id, c.invoice_group_id AS claim_group
    FROM portal_submissions ps
    JOIN claims c ON c.id = ps.claim_id
    ORDER BY random()
    LIMIT 10
  `);

  let ok = true;
  for (const r of spot.rows) {
    const match = r.claim_group === r.invoice_group_id;
    const mark = match ? "✓" : "✗";
    console.log(
      `  ${mark} portal_submissions#${r.id}: claim#${r.claim_id} → claim.invoice_group_id=${r.claim_group} | submission.invoice_group_id=${r.invoice_group_id}`,
    );
    if (!match) ok = false;
  }
  if (!ok) {
    console.error(
      "  ✗ Spot-check mismatch — at least one submission's invoice_group_id disagrees with its claim's. Investigate before dropping the column.",
    );
  } else if (spot.rows.length > 0) {
    console.log("  ✓ Spot-check passed (all sampled rows agree).");
  }
  return ok;
}

async function main(): Promise<void> {
  console.log("[backfill] starting portal-submissions group-link backfill\n");

  await reportPreState();

  const orphans = await findOrphans();
  await deleteOrphans(orphans);

  const updated = await backfillGroupLinks();
  console.log(`[backfill] populated invoice_group_id on ${updated} rows`);

  const ok = await verify();
  if (!ok) {
    console.error(
      "\n[backfill] HALTED. Fix the issues above before dropping portal_submissions.claim_id.",
    );
    throw new Error("backfill verification failed");
  }
  console.log("\n[backfill] done — safe to drop portal_submissions.claim_id");
  void db;
}

main()
  .then(() => pool.end().then(() => process.exit(0)))
  .catch(err => {
    console.error("[backfill] FAILED", err);
    pool.end().finally(() => process.exit(1));
  });

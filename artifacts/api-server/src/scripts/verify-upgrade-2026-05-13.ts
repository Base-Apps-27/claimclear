import { pool } from "@workspace/db";

async function main() {

  const r1 = await pool.query(
    "SELECT \"responseType\", classifier_source, classifier_confidence, COUNT(*)::int as n FROM portal_responses WHERE metadata->>'upgradeBackfillId' = 'duplicate_cluster_response_upgrade_2026_05_13' GROUP BY 1,2,3 ORDER BY 1",
  );
  console.log("Upgraded portal_responses by type/source/conf:");
  console.table(r1.rows);

  const r2 = await pool.query(
    "SELECT action, COUNT(*)::int as n FROM audit_logs WHERE metadata->>'backfillId' = 'duplicate_cluster_response_upgrade_2026_05_13' GROUP BY 1",
  );
  console.log("Audit logs:");
  console.table(r2.rows);

  const r3 = await pool.query(
    "SELECT id, invoice_group_id, \"responseType\", classifier_source, classifier_confidence, LEFT(ai_summary, 100) as summary, metadata->>'suggestedPayorDenialReason' as denial_reason, processed FROM portal_responses WHERE metadata->>'upgradeBackfillId' = 'duplicate_cluster_response_upgrade_2026_05_13' ORDER BY \"responseType\", id LIMIT 8",
  );
  console.log("Sample rows:");
  for (const row of r3.rows) console.log(JSON.stringify(row));

  const r4 = await pool.query(
    "SELECT classifier_source, metadata->>'classifierVersion' as version, COUNT(*)::int as n FROM portal_responses WHERE metadata->>'upgradeBackfillId' = 'duplicate_cluster_response_upgrade_2026_05_13' GROUP BY 1,2",
  );
  console.log("Classifier version stamping:");
  console.table(r4.rows);

  // Residual-synthetic check: include BOTH possible original classifier_source
  // values ('manual' is what production carried; 'keyword' is the schema
  // default and was assumed in the first pass). Also require absence of our
  // upgrade stamp so a re-run of the original backfill on a brand-new row
  // wouldn't trip a false alarm.
  const r5 = await pool.query(
    "SELECT COUNT(*)::int AS still_synthetic FROM portal_responses WHERE metadata->>'backfillId' = 'duplicate_cluster_resolution_2026_05_13' AND classifier_source IN ('manual','keyword') AND (metadata->>'upgradeBackfillId') IS DISTINCT FROM 'duplicate_cluster_response_upgrade_2026_05_13'",
  );
  console.log("Rows still in synthetic state (should be 0):", r5.rows[0]);

  const r6 = await pool.query(
    "SELECT COUNT(*)::int as ig_in_review FROM invoice_groups ig WHERE ig.status = 'Ready to Review' AND EXISTS (SELECT 1 FROM portal_responses pr WHERE pr.invoice_group_id = ig.id AND pr.\"responseType\" IN ('approval','denial','partial_approval','info_request','other') AND pr.metadata->>'upgradeBackfillId' = 'duplicate_cluster_response_upgrade_2026_05_13')",
  );
  console.log("Invoice groups in Ready-to-Review with upgraded reviewable response:", r6.rows[0]);

  const r7 = await pool.query(
    "SELECT metadata->>'previousSynthetic' IS NOT NULL as has_prev, COUNT(*)::int as n FROM portal_responses WHERE metadata->>'upgradeBackfillId' = 'duplicate_cluster_response_upgrade_2026_05_13' GROUP BY 1",
  );
  console.log("previousSynthetic preservation (all should be true):");
  console.table(r7.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { db, claimsTable, invoiceGroupsTable, auditLogsTable } from "@workspace/db";
import { eq, and, ne, isNotNull, inArray, sql } from "drizzle-orm";

/**
 * One-shot backfill: heal claims whose status drifted from their invoice
 * group's status because of the old `syncChildRides` terminal-only guard.
 *
 * Run once after deploying the syncChildRides rewrite:
 *   pnpm --filter @workspace/api-server tsx scripts/backfill-disputed-child-sync.ts
 *
 * Affects: disputed legs (error_type_id IS NOT NULL) that are NOT On Hold and
 * whose group is in a system-controlled or terminal status with a status
 * different from the leg's. Clean legs are never touched. Held legs are
 * never touched. The fix is idempotent — running it twice is a no-op.
 *
 * Audit rows produced by this script are tagged with the Task #268
 * uniform `metadata.backfillId` convention so the saved
 * `_backfill-audit-rows.sql` query lists them alongside rows from any
 * other backfill. The legacy `metadata.source = 'group_cascade:backfill'`
 * tag is preserved for backwards compatibility with pre-existing rows.
 */
// Mirrors BACKFILL_IDS.disputedChildSync in scripts/src/migrations/
// _backfill-audit.ts (kept as a literal here to avoid a circular
// workspace dependency from api-server back to @workspace/scripts).
const BACKFILL_ID = "api-server-backfill-disputed-child-sync";

const SYNCABLE_GROUP_STATUSES = [
  "Portal Queued",
  "Generating Email",
  "Awaiting Response",
  "Ready to Review",
  "Resolved",
  "Denied",
];

async function main() {
  console.log("Backfill: scanning for drifted disputed legs...");

  const drifted = await db
    .select({
      claimId: claimsTable.id,
      confNumber: claimsTable.confNumber,
      claimStatus: claimsTable.status,
      claimOutcome: claimsTable.outcome,
      groupId: invoiceGroupsTable.id,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
      groupStatus: invoiceGroupsTable.status,
      groupOutcome: invoiceGroupsTable.outcome,
    })
    .from(claimsTable)
    .innerJoin(invoiceGroupsTable, eq(claimsTable.invoiceGroupId, invoiceGroupsTable.id))
    .where(and(
      isNotNull(claimsTable.errorTypeId),
      ne(claimsTable.status, "On Hold"),
      inArray(invoiceGroupsTable.status, SYNCABLE_GROUP_STATUSES),
      sql`${claimsTable.status}::text != ${invoiceGroupsTable.status}::text`,
    ));

  console.log(`Found ${drifted.length} drifted disputed leg(s).`);

  if (drifted.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  for (const row of drifted) {
    console.log(
      `  - claim ${row.confNumber ?? row.claimId} (group ${row.invoiceNumber}): ${row.claimStatus}/${row.claimOutcome} → ${row.groupStatus}/${row.groupOutcome}`,
    );
  }

  await db.transaction(async (tx) => {
    for (const row of drifted) {
      await tx
        .update(claimsTable)
        .set({
          status: row.groupStatus as never,
          outcome: row.groupOutcome as never,
        })
        .where(eq(claimsTable.id, row.claimId));

      await tx.insert(auditLogsTable).values({
        claimId: row.claimId,
        invoiceGroupId: row.groupId,
        action: "claim_status_changed",
        details: `Status changed from ${row.claimStatus} to ${row.groupStatus} (backfill: cascaded from invoice group)`,
        metadata: {
          from: row.claimStatus,
          to: row.groupStatus,
          previousOutcome: row.claimOutcome,
          newOutcome: row.groupOutcome,
          source: "group_cascade:backfill",
          cascadedFromGroupId: row.groupId,
          // Task #268 uniform tag — set on every audit row produced by
          // any backfill so a single saved query (see scripts/src/
          // migrations/_backfill-audit-rows.sql) can list them all.
          backfillId: BACKFILL_ID,
        },
        userEmail: null,
        userName: "system (backfill)",
      });
    }
  });

  console.log(`Backfill complete: ${drifted.length} leg(s) re-synced with their group.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });

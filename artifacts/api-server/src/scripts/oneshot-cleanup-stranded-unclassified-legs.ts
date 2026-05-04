// One-shot backfill (Task: Classification Inbox cleanup, 2026-05-04).
//
// Some invoice groups landed in a terminal status (Resolved / Denied /
// Expired) while still carrying legs that were `includedInDispute=true`
// with no `errorTypeId`. Those legs keep showing up in the
// Classification Inbox even though their parent group is done. As of
// 2026-05-04 prod that was 80 Resolved groups (126 legs) plus 9 Expired
// legs.
//
// The forward-looking fix is `autoExcludeUnclassifiedOnTerminalClose`
// in `lib/group-transitions.ts`, which clears these legs at the moment
// the group is closed. This script does the same thing for the
// already-stranded rows by calling the shared `excludeLegCore` helper
// — same row update, same audit row, same metadata shape as the live
// path. Each audit row is stamped with `metadata.backfillId` so the
// effects of this run can be sliced out of audit history with a single
// uniform filter (the convention from Task #268).
//
// Idempotent: the row update inside `excludeLegCore` is guarded by
// `includedInDispute = true`, so re-running this script after the
// first pass is a no-op.
//
// Run (against whichever DATABASE_URL is exported in the shell):
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-cleanup-stranded-unclassified-legs.ts [--apply]

import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db, claimsTable, invoiceGroupsTable } from "@workspace/db";
import { excludeLegCore } from "../lib/claim-transitions";

const TERMINAL = ["Resolved", "Denied", "Expired"] as const;
type TerminalStatus = (typeof TERMINAL)[number];
const BACKFILL_ID = "stranded_unclassified_legs_2026_05_04";

async function main() {
  const apply = process.argv.includes("--apply");

  const stranded = await db
    .select({
      id: claimsTable.id,
      invoiceGroupId: claimsTable.invoiceGroupId,
      confNumber: claimsTable.confNumber,
      errorDetails: claimsTable.errorDetails,
      groupStatus: invoiceGroupsTable.status,
    })
    .from(claimsTable)
    .innerJoin(
      invoiceGroupsTable,
      eq(invoiceGroupsTable.id, claimsTable.invoiceGroupId),
    )
    .where(
      and(
        eq(claimsTable.includedInDispute, true),
        isNull(claimsTable.duplicateOfClaimId),
        or(isNull(claimsTable.errorTypeId), eq(claimsTable.errorTypeId, "")),
        inArray(invoiceGroupsTable.status, TERMINAL as readonly TerminalStatus[]),
      ),
    );

  const byStatus = stranded.reduce<Record<string, number>>((acc, row) => {
    const k = row.groupStatus ?? "(null)";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const groupCount = new Set(stranded.map((r) => r.invoiceGroupId)).size;

  console.log(
    `[oneshot] Found ${stranded.length} stranded leg(s) across ${groupCount} group(s). By status: ${JSON.stringify(byStatus)}`,
  );

  if (!apply) {
    console.log("[oneshot] Dry run. Re-run with --apply to write changes.");
    return;
  }

  const actor = {
    userEmail: "system",
    userName: "Stranded-Unclassified-Legs Backfill",
  };

  let excluded = 0;
  for (const row of stranded) {
    const [leg] = await db
      .select()
      .from(claimsTable)
      .where(eq(claimsTable.id, row.id));
    if (!leg) continue;
    await excludeLegCore({
      claimId: leg.id,
      reason: "non_issue",
      note: "Backfill: parent group already closed without classification",
      source: "backfill_stranded_unclassified_legs_2026_05_04",
      actor,
      leg,
      trustCallerStateGuard: true,
      backfillId: BACKFILL_ID,
    });
    excluded += 1;
    if (excluded % 25 === 0) console.log(`[oneshot] Excluded ${excluded}/${stranded.length}…`);
  }
  console.log(`[oneshot] Done. Excluded ${excluded} leg(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// One-shot revert (2026-05-05).
//
// Invoice group #299 (invoice_number=1822117500, 1 leg, "Incomplete GPS")
// was advanced to "Generating Email" by an operator on 2026-05-04. The
// group has no draft subject/body, no preview, no submission, and the
// per-leg investigation walk still needs to be completed — but the
// "Generating Email" status blocks all leg-level edits, so the operator
// cannot finish the SOP from inside that status (see screenshot
// 2026-05-05).
//
// Revert the group back to "New" via the standard transition helper so
// the leg cascades back to "New" too (syncChildRides runs because the
// leg has an errorTypeId set). The existing classification ("Incomplete
// GPS", error_type_id=2) is preserved on the leg — only the workflow
// status is rolled back, which is what unblocks the Investigation walk.
//
// Idempotent: transitionGroupStatus is a no-op when the group is
// already in the target status.
//
// Run:
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-revert-group-1822117500-to-new.ts [--apply]

import { eq } from "drizzle-orm";
import { db, invoiceGroupsTable, claimsTable } from "@workspace/db";
import { transitionGroupStatus } from "../lib/group-transitions";

const GROUP_ID = 299;
const EXPECTED_INVOICE_NUMBER = "1822117500";

async function main() {
  const apply = process.argv.includes("--apply");

  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, GROUP_ID));
  if (!group) {
    console.error(`Group ${GROUP_ID} not found.`);
    process.exit(1);
  }
  if (group.invoiceNumber !== EXPECTED_INVOICE_NUMBER) {
    console.error(
      `Safety check failed: group ${GROUP_ID} has invoice_number "${group.invoiceNumber}" (expected "${EXPECTED_INVOICE_NUMBER}"). Aborting.`,
    );
    process.exit(1);
  }

  const legs = await db.select().from(claimsTable).where(eq(claimsTable.invoiceGroupId, GROUP_ID));

  console.log(`=== Plan ===`);
  console.log(`Group #${GROUP_ID} (invoice ${group.invoiceNumber})`);
  console.log(`  status:           ${group.status} → New`);
  console.log(`  outcome:          ${group.outcome} (unchanged)`);
  console.log(`  error_type_name:  ${group.errorTypeName ?? "(none)"} (unchanged)`);
  console.log(`Legs (${legs.length}):`);
  for (const l of legs) {
    console.log(`  #${l.id} ${l.confNumber}: status ${l.status} → New (errorTypeId=${l.errorTypeId} preserved)`);
  }

  if (!apply) {
    console.log(`\n(dry-run — pass --apply to commit)`);
    return;
  }

  console.log(`\nApplying...`);
  await transitionGroupStatus({
    groupId: GROUP_ID,
    newStatus: "New",
    source: "oneshot_revert_group_1822117500_to_new_2026_05_05",
    reason:
      "Operator-requested revert: group was advanced to Generating Email before the per-leg Investigation walk was complete; reverting to New so leg-level edits are unblocked and the SOP can finish.",
    actor: { userEmail: "system", userName: "Group Revert Backfill" },
    systemOverride: true,
  });

  console.log(`Done.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

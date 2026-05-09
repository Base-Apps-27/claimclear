// One-shot heal (2026-05-09).
//
// Invoice group #3 (invoice_number=1860438520, 2 legs, "Incomplete GPS")
// was correctly submitted to the portal on 2026-04-28 (portal_submission
// #17, ticket #85153) and an approval response was auto-detected on
// 2026-04-29, which advanced the group from "Awaiting Response" to
// "Needs Review" via the response matcher.
//
// On 2026-05-02, an operator (z7ytv7jcb4@privaterelay.appleid.com) used
// the legacy Transitions dropdown to move the group from "Needs Review"
// → "Needs Evidence" — instead of replying with additional evidence on
// the response page. Because the deriver maps "Needs Evidence" to
// phase="triage", the group fell back into the pre-submit (Action
// Required) lane on the Queue page, even though portal submission #17
// is still open and a payor response is on file. Cascade also moved
// leg #62 (#14952042) from "Needs Review" → "Needs Evidence".
//
// Heal: restore the group to "Ready to Review" (which derives to
// phase="response_received" → macro phase "response-pending"), so the
// invoice surfaces on the Responses Awaiting Review page where the
// operator can act on the existing payor response. Leg #62 cascades
// back to "Needs Review". Leg #79 (#14952041, sop_outcome=non_issue,
// is_open=false) is left untouched.
//
// Idempotent: transitionGroupStatus is a no-op when the group is
// already in the target status, and the leg update is a no-op when the
// leg is already in "Needs Review".
//
// Run:
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-heal-group-1860438520-post-response.ts [--apply]

import { and, eq } from "drizzle-orm";
import { db, invoiceGroupsTable, claimsTable, auditLogsTable } from "@workspace/db";
import { transitionGroupStatus } from "../lib/group-transitions";

const GROUP_ID = 3;
const EXPECTED_INVOICE_NUMBER = "1860438520";
const TARGET_GROUP_STATUS = "Ready to Review" as const;
const DISPUTED_LEG_ID = 62;
const DISPUTED_LEG_CONF = "14952042";
const NON_ISSUE_LEG_ID = 79;
const HEAL_ID = "heal_1860438520_post_response_2026_05_09";

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
  const disputedLeg = legs.find((l) => l.id === DISPUTED_LEG_ID);
  const nonIssueLeg = legs.find((l) => l.id === NON_ISSUE_LEG_ID);

  if (!disputedLeg) {
    console.error(`Disputed leg #${DISPUTED_LEG_ID} not found on group ${GROUP_ID}. Aborting.`);
    process.exit(1);
  }
  if (disputedLeg.confNumber !== DISPUTED_LEG_CONF) {
    console.error(
      `Safety check failed: leg ${DISPUTED_LEG_ID} has conf_number "${disputedLeg.confNumber}" (expected "${DISPUTED_LEG_CONF}"). Aborting.`,
    );
    process.exit(1);
  }

  console.log(`=== Plan ===`);
  console.log(`Group #${GROUP_ID} (invoice ${group.invoiceNumber})`);
  console.log(`  status:        ${group.status} → ${TARGET_GROUP_STATUS}`);
  console.log(`  phase:         ${group.phase} → response_received (derived)`);
  console.log(`Legs (${legs.length}):`);
  for (const l of legs) {
    if (l.id === DISPUTED_LEG_ID) {
      console.log(`  #${l.id} ${l.confNumber}: status ${l.status} → Needs Review (cascaded)`);
    } else if (l.id === NON_ISSUE_LEG_ID) {
      console.log(`  #${l.id} ${l.confNumber}: status ${l.status} (unchanged — sop_outcome=${l.sopOutcome ?? "(none)"}, is_open=${l.isOpen})`);
    } else {
      console.log(`  #${l.id} ${l.confNumber}: status ${l.status} (unchanged)`);
    }
  }

  if (!apply) {
    console.log(`\n(dry-run — pass --apply to commit)`);
    return;
  }

  console.log(`\nApplying...`);

  // 1) Group status transition. transitionGroupStatus handles the
  // group_status_changed audit log emission and any cascades it owns.
  await transitionGroupStatus({
    groupId: GROUP_ID,
    newStatus: TARGET_GROUP_STATUS,
    source: "oneshot_heal_group_1860438520_post_response_2026_05_09",
    reason:
      "Manual heal: group was rewound from 'Needs Review' to 'Needs Evidence' on 2026-05-02 via the legacy Transitions dropdown after portal submission #17 (ticket #85153) had already been filed on 2026-04-28 and an approval response was auto-detected on 2026-04-29. Restoring to 'Ready to Review' so the existing payor response surfaces on the Responses Awaiting Review page instead of the pre-submit Action Required queue.",
    actor: { userEmail: "system@claimclear-heal", userName: "Manual Heal" },
    systemOverride: true,
  });

  // 2) Restore the disputed leg's status if the group transition above
  // didn't cascade it (cascade rules vary by target status). Idempotent:
  // only fires if the leg is still on "Needs Evidence".
  const updated = await db
    .update(claimsTable)
    .set({ status: "Needs Review", updatedAt: new Date() })
    .where(and(eq(claimsTable.id, DISPUTED_LEG_ID), eq(claimsTable.status, "Needs Evidence")))
    .returning({ id: claimsTable.id, status: claimsTable.status });

  if (updated.length > 0) {
    await db.insert(auditLogsTable).values({
      invoiceGroupId: GROUP_ID,
      claimId: DISPUTED_LEG_ID,
      action: "claim_status_changed",
      details: "Status changed from Needs Evidence to Needs Review (cascaded from invoice group manual heal)",
      userEmail: "system@claimclear-heal",
      userName: "Manual Heal",
      metadata: { healId: HEAL_ID, source: "oneshot_heal_group_1860438520_post_response_2026_05_09" },
    });
    console.log(`Leg #${DISPUTED_LEG_ID} status restored to Needs Review.`);
  } else {
    console.log(`Leg #${DISPUTED_LEG_ID} already cascaded by transitionGroupStatus (or was not in 'Needs Evidence') — no-op.`);
  }

  if (nonIssueLeg) {
    console.log(
      `Leg #${NON_ISSUE_LEG_ID} (#${nonIssueLeg.confNumber}) left untouched: sop_outcome=${nonIssueLeg.sopOutcome ?? "(none)"}, is_open=${nonIssueLeg.isOpen}.`,
    );
  }

  console.log(`Done.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

// One-shot backfill (2026-05-05 re-attestation queue audit).
//
// Production audit on 2026-05-05 found 6 Approved/Partially Approved
// legs sitting at attestation_state='not_required' even though their
// outcome made them re-attestation candidates. Root cause: the
// pre-2026-05 `computeAttestationDelta` gate parked Approved verdicts
// at `not_required` until an operator clicked the group-level bulk-
// queue button, and that follow-up click was routinely missed
// (groups 17, 18, 53, 66, 148 plus group 2 across the affected legs).
//
// The forward-looking fix is the gate removal in `lib/attestation.ts`
// — every NEW Approved verdict now engages attestationState=pending
// directly. This script repairs the already-stranded rows by promoting
// them to `pending` so they surface in the Open re-attestation queue
// today, mirroring what the live cascade would now do at verdict-
// confirm time.
//
// Idempotent: the WHERE clause restricts the UPDATE to rows that are
// still Approved/Partial AND still at `not_required`, so re-running
// after the first pass is a no-op. Each touched row also gets an
// `attestation_engaged_backfill` audit row stamped with
// `metadata.backfillId` so the effects of this run can be sliced out
// of audit history with a single uniform filter (the convention from
// Task #268 and the 2026-05-04 stranded-leg backfill).
//
// Run (against whichever DATABASE_URL is exported in the shell):
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-promote-stuck-attestation-legs.ts [--apply]
//
// Defaults to a dry run that prints the candidate set without
// touching any rows. Pass --apply to commit.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, claimsTable, invoiceGroupsTable, auditLogsTable } from "@workspace/db";
import { emitStateEvent } from "../lib/state-events";

const APPROVED_OUTCOMES = ["Approved", "Partially Approved"] as const;
const BACKFILL_ID = "attestation_gate_removed_2026_05_05";

async function main() {
  const apply = process.argv.includes("--apply");

  // Same admit predicate as the new computeAttestationDelta engage
  // branch: every leg whose outcome is Approved/Partial but whose
  // attestation_state is still parked at not_required (with no stale
  // attested_at / queued_at stamps that would imply it had already
  // been through the queue).
  const stuck = await db
    .select({
      id: claimsTable.id,
      confNumber: claimsTable.confNumber,
      outcome: claimsTable.outcome,
      attestationState: claimsTable.attestationState,
      invoiceGroupId: claimsTable.invoiceGroupId,
      groupInvoiceNumber: invoiceGroupsTable.invoiceNumber,
      groupStatus: invoiceGroupsTable.status,
      groupReattestRequired: invoiceGroupsTable.reattestRequired,
      groupReattestCompletedAt: invoiceGroupsTable.reattestCompletedAt,
    })
    .from(claimsTable)
    .leftJoin(invoiceGroupsTable, eq(invoiceGroupsTable.id, claimsTable.invoiceGroupId))
    .where(and(
      inArray(claimsTable.outcome, [...APPROVED_OUTCOMES]),
      eq(claimsTable.attestationState, "not_required"),
      isNull(claimsTable.attestedAt),
      isNull(claimsTable.attestationQueuedAt),
    ));

  console.log(
    `[oneshot] Found ${stuck.length} stuck Approved leg(s) at attestation_state='not_required'.`,
  );
  for (const row of stuck) {
    console.log(
      `  - claim#${row.id} (${row.confNumber}) outcome=${row.outcome}` +
      ` group#${row.invoiceGroupId ?? "-"} (inv ${row.groupInvoiceNumber ?? "-"}, status=${row.groupStatus ?? "-"})` +
      ` reattestRequired=${row.groupReattestRequired ?? "-"}` +
      ` reattestCompletedAt=${row.groupReattestCompletedAt ? row.groupReattestCompletedAt.toISOString() : "(null)"}`,
    );
  }

  if (stuck.length === 0) {
    console.log("[oneshot] Nothing to do.");
    return;
  }

  if (!apply) {
    console.log("[oneshot] Dry run. Re-run with --apply to write changes.");
    return;
  }

  const actor = {
    userEmail: "system@attestation-gate-removed-backfill",
    userName: "Attestation-Gate-Removed Backfill",
  };

  let promoted = 0;
  for (const row of stuck) {
    // Re-check inside the loop so a concurrent operator action (e.g.
    // someone clicked the bulk-queue button between the SELECT and
    // here) doesn't get clobbered. Same idempotency principle as the
    // live cascade.
    await db.transaction(async (tx) => {
      const [refreshed] = await tx
        .select()
        .from(claimsTable)
        .where(eq(claimsTable.id, row.id));
      if (!refreshed) return;
      if (refreshed.attestationState !== "not_required") return;
      if (!APPROVED_OUTCOMES.includes(refreshed.outcome as typeof APPROVED_OUTCOMES[number])) return;
      if (refreshed.attestedAt != null || refreshed.attestationQueuedAt != null) return;

      await tx
        .update(claimsTable)
        .set({ attestationState: "pending" })
        .where(eq(claimsTable.id, row.id));

      await tx.insert(auditLogsTable).values({
        claimId: row.id,
        invoiceGroupId: row.invoiceGroupId,
        action: "attestation_engaged_backfill",
        details:
          `Promoted attestationState 'not_required' → 'pending' to recover stuck ${refreshed.outcome} verdict ` +
          `(missed bulk-queue click pre-2026-05-05 gate removal).`,
        metadata: {
          from: "not_required",
          to: "pending",
          backfillId: BACKFILL_ID,
          outcome: refreshed.outcome,
        },
        userEmail: actor.userEmail,
        userName: actor.userName,
      });

      await emitStateEvent({
        eventKey: "leg.attestation_engaged_backfill",
        claimId: row.id,
        invoiceGroupId: row.invoiceGroupId,
        actorUserId: actor.userEmail,
        metadata: {
          from: "not_required",
          to: "pending",
          backfillId: BACKFILL_ID,
        },
      }, tx);

      promoted += 1;
    });
  }
  console.log(`[oneshot] Done. Promoted ${promoted}/${stuck.length} leg(s) to attestationState='pending'.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

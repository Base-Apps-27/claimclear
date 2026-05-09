// One-shot backfill (Task #561 — 2026-05-09 attestation-gate restore).
//
// Task #561 restored the Task #196 attestation engagement gate that was
// removed 2026-05-05. With the gate back in place, an Approved verdict
// on a group whose `reattest_completed_at` is still NULL must NOT push
// `claims.attestation_state` to `pending`. Engagement now happens
// inside the `/invoice-groups/:id/reattest/complete` writer.
//
// During the gate-removed window (2026-05-05 → 2026-05-09) and during
// the previous 2026-05-05 backfill, some legs were promoted to
// `attestationState='pending'` before the parent group cleared MAS
// re-attest. Under the restored model these are "premature" — the leg
// is occupying a slot in the Open re-attestation queue even though no
// MAS re-attest has been recorded for the invoice. This script walks
// those rows and resets them to `not_required` so the queue surface
// matches the invoice-first contract.
//
// Eligibility (must satisfy ALL):
//   * `claims.attestation_state = 'pending'`
//   * `claims.attested_at IS NULL` (the leg has not been attested yet)
//   * `claims.attestation_queued_at IS NULL` (an operator did not
//     deliberately park it for a teammate — those legs should ride
//     out as `queued` rather than be reset)
//   * `claims.invoice_group_id IS NOT NULL` (standalone legs bypass
//     the gate per `computeAttestationDelta` contract)
//   * `claims.outcome IN ('Approved','Partially Approved')` — the only
//     outcomes that the verdict-driven engagement could ever flip
//   * Parent `invoice_groups.reattest_completed_at IS NULL`
//
// Idempotent: the WHERE clause re-checks every condition inside the
// per-row transaction so a concurrent operator action (e.g. someone
// recorded MAS re-attest between SELECT and write) can't get
// clobbered, and re-running after the first pass is a no-op.
//
// Each touched row gets an `attestation_disengaged_backfill` audit row
// + `claim.attestation_disengaged_backfill` state event stamped with
// `metadata.backfillId='attestation_gate_restored_2026_05_09'` so
// downstream readers can slice the effects of this run cleanly out of
// audit history (Task #268 + 2026-05-04 stranded-leg backfill
// convention).
//
// Run (against whichever DATABASE_URL is exported in the shell):
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-attestation-gate-restore-backfill.ts [--apply]
//
// Defaults to a dry run that prints the candidate set without
// touching any rows. Pass --apply to commit.

import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { db, claimsTable, invoiceGroupsTable, auditLogsTable } from "@workspace/db";
import { emitStateEvent } from "../lib/state-events";

const APPROVED_OUTCOMES = ["Approved", "Partially Approved"] as const;
const BACKFILL_ID = "attestation_gate_restored_2026_05_09";

async function main() {
  const apply = process.argv.includes("--apply");

  const premature = await db
    .select({
      id: claimsTable.id,
      confNumber: claimsTable.confNumber,
      outcome: claimsTable.outcome,
      attestationState: claimsTable.attestationState,
      invoiceGroupId: claimsTable.invoiceGroupId,
      groupInvoiceNumber: invoiceGroupsTable.invoiceNumber,
      groupStatus: invoiceGroupsTable.status,
      groupReattestCompletedAt: invoiceGroupsTable.reattestCompletedAt,
    })
    .from(claimsTable)
    .innerJoin(invoiceGroupsTable, eq(invoiceGroupsTable.id, claimsTable.invoiceGroupId))
    .where(and(
      eq(claimsTable.attestationState, "pending"),
      isNull(claimsTable.attestedAt),
      isNull(claimsTable.attestationQueuedAt),
      isNotNull(claimsTable.invoiceGroupId),
      inArray(claimsTable.outcome, [...APPROVED_OUTCOMES]),
      isNull(invoiceGroupsTable.reattestCompletedAt),
    ));

  console.log(
    `[oneshot] Found ${premature.length} prematurely-engaged leg(s) at attestation_state='pending' on groups without reattest_completed_at.`,
  );
  for (const row of premature) {
    console.log(
      `  - claim#${row.id} (${row.confNumber}) outcome=${row.outcome}` +
      ` group#${row.invoiceGroupId} (inv ${row.groupInvoiceNumber ?? "-"}, status=${row.groupStatus ?? "-"})` +
      ` reattestCompletedAt=${row.groupReattestCompletedAt ? row.groupReattestCompletedAt.toISOString() : "(null)"}`,
    );
  }

  if (premature.length === 0) {
    console.log("[oneshot] Nothing to do.");
    return;
  }

  if (!apply) {
    console.log("[oneshot] Dry run. Re-run with --apply to write changes.");
    return;
  }

  const actor = {
    userEmail: "system@attestation-gate-restored-backfill",
    userName: "Attestation-Gate-Restored Backfill",
  };

  let reset = 0;
  for (const row of premature) {
    await db.transaction(async (tx) => {
      // Re-check inside the tx so a concurrent operator action (e.g.
      // someone just recorded MAS re-attest, or queued the leg, or
      // attested it) can't get clobbered.
      const [refreshed] = await tx
        .select()
        .from(claimsTable)
        .where(eq(claimsTable.id, row.id));
      if (!refreshed) return;
      if (refreshed.attestationState !== "pending") return;
      if (refreshed.attestedAt != null || refreshed.attestationQueuedAt != null) return;
      if (refreshed.invoiceGroupId == null) return;
      if (!APPROVED_OUTCOMES.includes(refreshed.outcome as typeof APPROVED_OUTCOMES[number])) return;

      const [parent] = await tx
        .select({ reattestCompletedAt: invoiceGroupsTable.reattestCompletedAt })
        .from(invoiceGroupsTable)
        .where(eq(invoiceGroupsTable.id, refreshed.invoiceGroupId));
      if (!parent || parent.reattestCompletedAt != null) return;

      await tx
        .update(claimsTable)
        .set({ attestationState: "not_required" })
        .where(eq(claimsTable.id, row.id));

      await tx.insert(auditLogsTable).values({
        claimId: row.id,
        invoiceGroupId: row.invoiceGroupId,
        action: "attestation_disengaged_backfill",
        details:
          `Reset attestationState 'pending' → 'not_required' to honor restored Task #196 gate ` +
          `(parent group has no reattest_completed_at; engagement is now deferred to /reattest/complete).`,
        metadata: {
          from: "pending",
          to: "not_required",
          backfillId: BACKFILL_ID,
          outcome: refreshed.outcome,
        },
        userEmail: actor.userEmail,
        userName: actor.userName,
      });

      await emitStateEvent({
        eventKey: "claim.attestation_disengaged_backfill",
        claimId: row.id,
        invoiceGroupId: row.invoiceGroupId,
        actorUserId: actor.userEmail,
        metadata: {
          from: "pending",
          to: "not_required",
          backfillId: BACKFILL_ID,
        },
      }, tx);

      reset += 1;
    });
  }
  console.log(`[oneshot] Done. Reset ${reset}/${premature.length} leg(s) to attestationState='not_required'.`);
}

// Export the runner so the test can drive it without spawning a child
// process. The script still self-runs when executed via tsx (the
// `main()` invocation guarded by `import.meta` below).
export { main as runAttestationGateRestoreBackfill };

const isMain = (() => {
  try {
    // tsx populates process.argv[1] with the script path; compare
    // against import.meta.url to guard against test imports.
    const url = new URL(import.meta.url);
    return url.pathname.endsWith("oneshot-attestation-gate-restore-backfill.ts");
  } catch {
    return false;
  }
})();

if (isMain && process.argv.some((a) => a.endsWith("oneshot-attestation-gate-restore-backfill.ts"))) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

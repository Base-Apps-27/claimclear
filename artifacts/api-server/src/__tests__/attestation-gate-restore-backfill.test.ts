// Task #561 — backfill idempotence test for the attestation gate
// restore one-shot script
// (`scripts/oneshot-attestation-gate-restore-backfill.ts`).
//
// The forward gate restoration in `lib/attestation.ts` ensures NEW
// Approved verdicts no longer push attestation_state to pending until
// the parent group records MAS re-attest. The backfill repairs rows
// that were prematurely engaged during the 2026-05-05 → 2026-05-09
// gate-removed window: pending legs whose parent group has not yet
// stamped reattest_completed_at are reset to not_required.
//
// Coverage:
//   * Premature pending row on a group with no reattest_completed_at
//     gets reset to not_required, gets an `attestation_disengaged_backfill`
//     audit row + `claim.attestation_disengaged_backfill` state event.
//   * Re-running the backfill is a no-op (idempotent) — the second
//     pass produces no additional state changes or audit rows.
//   * Pending row on a group that HAS reattest_completed_at stamped
//     is left alone (the gate is open, the engagement was legitimate).
//   * Queued / completed / attested rows are left alone — only
//     pending-with-no-stamps rows are reset.
//   * Standalone legs (no parent group) are left alone — they bypass
//     the gate by design.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { eq } from "drizzle-orm";

import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
  notesTable,
  portalResponsesTable,
  portalSubmissionsTable,
  claimEvidenceTable,
  claimVerdictTable,
  stateEventsTable,
} from "@workspace/db";

import { runAttestationGateRestoreBackfill } from "../scripts/oneshot-attestation-gate-restore-backfill";
import { phaseForStatus, dispositionForPhase } from "./fixtures/state";
import type { ClaimDisposition } from "@workspace/vocab";

after(async () => {
  await pool.end().catch(() => undefined);
});

// Drive the backfill in --apply mode by mutating process.argv around
// the call. Restore the original argv afterwards so other tests in the
// suite (or the script's `isMain` guard) aren't perturbed.
async function runBackfillApply(): Promise<void> {
  const original = process.argv;
  process.argv = [original[0] ?? "node", "test-runner", "--apply"];
  try {
    await runAttestationGateRestoreBackfill();
  } finally {
    process.argv = original;
  }
}

async function seedGroup(opts: { reattestCompletedAt?: Date | null } = {}): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const invoiceNumber = `T561G-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: "Needs Review",
    outcome: "Pending",
    phase: phaseForStatus("Needs Review"),
    reattestCompletedAt: opts.reattestCompletedAt ?? null,
  }).returning();
  return row;
}

async function seedLeg(opts: {
  invoiceGroupId: number | null;
  attestationState?: "not_required" | "pending" | "queued" | "completed";
  outcome?: "Approved" | "Partially Approved" | "Pending" | "Denied";
  attestedAt?: Date | null;
  attestationQueuedAt?: Date | null;
  disposition?: ClaimDisposition;
}): Promise<typeof claimsTable.$inferSelect> {
  const confNumber = `T561-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  // Schema-fixture-drift fix (current-contract-map §1.4 lines 60-61
  // + §3.2 line 235 + §3.3 line 252): the
  // `validate_disposition_against_phase` insert/update trigger,
  // installed by `lib/db/migrations/0034_invoice_phase_and_disposition.sql`,
  // rejects any child claim whose `disposition` is not in
  // `VALID_DISPOSITIONS_BY_PHASE[parent.phase]`. seedGroup above
  // lands `phase=response_received` (`phaseForStatus("Needs Review")`),
  // whose valid set excludes the schema's default `unclassified`.
  // Default the leg to the canonical disposition for the parent's
  // phase (`response_received → awaiting_review`) so the trigger
  // accepts the insert; standalone legs (no parent) bypass the
  // trigger and get `unclassified`. Caller can override via
  // `opts.disposition` when the test explicitly needs a different
  // verdict-bearing disposition (e.g. verdict_approved).
  const disposition: ClaimDisposition = opts.disposition
    ?? (opts.invoiceGroupId != null
      ? dispositionForPhase(phaseForStatus("Needs Review"))
      : "unclassified");
  const [row] = await db.insert(claimsTable).values({
    confNumber,
    status: "Needs Review",
    outcome: opts.outcome ?? "Approved",
    invoiceGroupId: opts.invoiceGroupId,
    errorTypeId: "et-test",
    errorTypeName: "Seeded Error",
    claimAmount: "100.00",
    attestationState: opts.attestationState ?? "pending",
    attestedAt: opts.attestedAt ?? null,
    attestationQueuedAt: opts.attestationQueuedAt ?? null,
    disposition,
  }).returning();
  return row;
}

async function cleanupClaim(id: number) {
  await db.delete(claimVerdictTable).where(eq(claimVerdictTable.claimId, id)).catch(() => undefined);
  await db.delete(stateEventsTable).where(eq(stateEventsTable.claimId, id)).catch(() => undefined);
  await db.delete(portalResponsesTable).where(eq(portalResponsesTable.claimId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, id)).catch(() => undefined);
  await db.delete(notesTable).where(eq(notesTable.claimId, id)).catch(() => undefined);
  await db.delete(claimEvidenceTable).where(eq(claimEvidenceTable.claimId, id)).catch(() => undefined);
  await db.delete(claimsTable).where(eq(claimsTable.id, id)).catch(() => undefined);
}

async function cleanupGroup(id: number | null) {
  if (id == null) return;
  const children = await db.select({ id: claimsTable.id }).from(claimsTable).where(eq(claimsTable.invoiceGroupId, id));
  for (const c of children) await cleanupClaim(c.id);
  await db.delete(stateEventsTable).where(eq(stateEventsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(claimEvidenceTable).where(eq(claimEvidenceTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)).catch(() => undefined);
}

test("Task #561 backfill resets premature pending → not_required and is idempotent", async () => {
  // Premature pending leg under a group with NO reattest_completed_at.
  const gatedGroup = await seedGroup({ reattestCompletedAt: null });
  const prematureLeg = await seedLeg({
    invoiceGroupId: gatedGroup.id,
    attestationState: "pending",
    outcome: "Approved",
  });

  // Legitimate pending leg under a group whose gate is OPEN.
  const openGroup = await seedGroup({ reattestCompletedAt: new Date() });
  const legitLeg = await seedLeg({
    invoiceGroupId: openGroup.id,
    attestationState: "pending",
    outcome: "Approved",
  });

  // Operator-parked queued leg — must not be touched even though the
  // gate is closed (operators deliberately parked it for a teammate).
  const queuedLeg = await seedLeg({
    invoiceGroupId: gatedGroup.id,
    attestationState: "queued",
    outcome: "Approved",
    attestationQueuedAt: new Date(),
  });

  // Standalone leg (no parent group) — bypasses the gate.
  const standaloneLeg = await seedLeg({
    invoiceGroupId: null,
    attestationState: "pending",
    outcome: "Approved",
  });

  try {
    // First pass — must reset only `prematureLeg`.
    await runBackfillApply();

    const [premPost1] = await db.select().from(claimsTable).where(eq(claimsTable.id, prematureLeg.id));
    assert.equal(premPost1.attestationState, "not_required",
      "Premature pending leg under a gated group must be reset to not_required");

    const [legitPost1] = await db.select().from(claimsTable).where(eq(claimsTable.id, legitLeg.id));
    assert.equal(legitPost1.attestationState, "pending",
      "Pending leg under a group with reattest_completed_at stamped must NOT be reset");

    const [queuedPost1] = await db.select().from(claimsTable).where(eq(claimsTable.id, queuedLeg.id));
    assert.equal(queuedPost1.attestationState, "queued",
      "Queued leg must be left alone — operators deliberately parked it");

    const [standalonePost1] = await db.select().from(claimsTable).where(eq(claimsTable.id, standaloneLeg.id));
    assert.equal(standalonePost1.attestationState, "pending",
      "Standalone leg (no parent group) bypasses the gate and must NOT be reset");

    const audits1 = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.claimId, prematureLeg.id));
    const disengaged = audits1.filter((a) => a.action === "attestation_disengaged_backfill");
    assert.equal(disengaged.length, 1,
      `Expected exactly one attestation_disengaged_backfill audit row, got ${disengaged.length}`);
    assert.equal((disengaged[0].metadata as any)?.from, "pending");
    assert.equal((disengaged[0].metadata as any)?.to, "not_required");
    assert.equal((disengaged[0].metadata as any)?.backfillId, "attestation_gate_restored_2026_05_09");

    const events1 = await db.select().from(stateEventsTable)
      .where(eq(stateEventsTable.claimId, prematureLeg.id));
    const evCount1 = events1.filter((e) => e.eventKey === "claim.attestation_disengaged_backfill").length;
    assert.equal(evCount1, 1,
      `Expected exactly one claim.attestation_disengaged_backfill state event, got ${evCount1}`);

    // Second pass — idempotent. No additional row writes.
    await runBackfillApply();

    const [premPost2] = await db.select().from(claimsTable).where(eq(claimsTable.id, prematureLeg.id));
    assert.equal(premPost2.attestationState, "not_required",
      "Idempotency: second pass keeps the row at not_required");

    const audits2 = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.claimId, prematureLeg.id));
    const disengaged2 = audits2.filter((a) => a.action === "attestation_disengaged_backfill");
    assert.equal(disengaged2.length, 1,
      `Idempotency: second pass must not write another audit row (got ${disengaged2.length} total)`);

    const events2 = await db.select().from(stateEventsTable)
      .where(eq(stateEventsTable.claimId, prematureLeg.id));
    const evCount2 = events2.filter((e) => e.eventKey === "claim.attestation_disengaged_backfill").length;
    assert.equal(evCount2, 1,
      `Idempotency: second pass must not emit another state event (got ${evCount2} total)`);
  } finally {
    await cleanupClaim(prematureLeg.id);
    await cleanupClaim(legitLeg.id);
    await cleanupClaim(queuedLeg.id);
    await cleanupClaim(standaloneLeg.id);
    await cleanupGroup(gatedGroup.id);
    await cleanupGroup(openGroup.id);
  }
});

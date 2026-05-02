// Tests for the Task #346 one-shot recovery that reopens invoice
// groups mis-demoted from `Needs Review` into `Awaiting Response` (or
// `Resolved` / Non-Issue) by an over-eager run of the Task #299
// stuck-Needs-Review heal script. The bug fingerprint:
//
//   - status in {Awaiting Response, Resolved/Non-Issue}, AND
//   - every active leg (`included_in_dispute = true`,
//     `duplicate_of_claim_id IS NULL`) has `error_type_id IS NULL`,
//     AND
//   - every such leg's `error_details` is null/blank, AND
//   - no reviewable portal_response is on file.

import { test, after } from "node:test";
import { strict as assert } from "node:assert";
import { eq, sql } from "drizzle-orm";

import {
  db,
  pool,
  invoiceGroupsTable,
  auditLogsTable,
  notesTable,
  portalResponsesTable,
  claimsTable,
} from "@workspace/db";

import {
  runBackfill,
  BACKFILL_ID,
} from "../migrations/2026-05-recover-misdemoted-classify-inbox-backfill";
import { BACKFILL_IDS } from "../migrations/_backfill-audit";

after(async () => {
  await pool.end().catch(() => undefined);
});

type GroupStatus = typeof invoiceGroupsTable.status.enumValues[number];
type GroupOutcome = typeof invoiceGroupsTable.outcome.enumValues[number];
type ResponseType = typeof portalResponsesTable.responseType.enumValues[number];

async function createSeedGroup(opts: { status: GroupStatus; outcome?: GroupOutcome }): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const invoiceNumber = `T346G-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [row] = await db
    .insert(invoiceGroupsTable)
    .values({
      invoiceNumber,
      status: opts.status,
      outcome: opts.outcome ?? "Pending",
    })
    .returning();
  return row;
}

async function seedClaim(opts: {
  groupId: number;
  errorTypeId?: string | null;
  errorDetails?: string | null;
  includedInDispute?: boolean;
  duplicateOfClaimId?: number | null;
}): Promise<typeof claimsTable.$inferSelect> {
  const confNumber = `T346-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [row] = await db
    .insert(claimsTable)
    .values({
      confNumber,
      invoiceGroupId: opts.groupId,
      errorTypeId: opts.errorTypeId ?? null,
      errorDetails: opts.errorDetails ?? null,
      includedInDispute: opts.includedInDispute ?? true,
      duplicateOfClaimId: opts.duplicateOfClaimId ?? null,
      claimAmount: "100.00",
      status: "Awaiting Response",
      outcome: "Pending",
    })
    .returning();
  return row;
}

async function seedResponse(opts: { groupId: number; responseType: ResponseType }): Promise<number> {
  const [row] = await db
    .insert(portalResponsesTable)
    .values({
      invoiceGroupId: opts.groupId,
      source: "email",
      responseType: opts.responseType,
      classifierSource: "ai",
      processed: false,
      content: "test",
      senderEmail: `t346-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
      autoLinked: true,
    })
    .returning({ id: portalResponsesTable.id });
  return row.id;
}

async function fetchGroup(id: number): Promise<{ status: string; outcome: string } | null> {
  const [row] = await db
    .select({ status: invoiceGroupsTable.status, outcome: invoiceGroupsTable.outcome })
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.id, id));
  return row ?? null;
}

async function fetchRecoveryAudits(groupId: number): Promise<Array<{ id: number; metadata: unknown }>> {
  return await db
    .select({ id: auditLogsTable.id, metadata: auditLogsTable.metadata })
    .from(auditLogsTable)
    .where(
      sql`${auditLogsTable.invoiceGroupId} = ${groupId}
          and ${auditLogsTable.action} = 'inbox_heal_reverted'
          and ${auditLogsTable.metadata}->>'backfillId' = ${BACKFILL_ID}`,
    );
}

async function fetchStatusChangeAudits(groupId: number): Promise<Array<{ metadata: unknown }>> {
  return await db
    .select({ metadata: auditLogsTable.metadata })
    .from(auditLogsTable)
    .where(
      sql`${auditLogsTable.invoiceGroupId} = ${groupId}
          and ${auditLogsTable.action} = 'group_status_changed'
          and ${auditLogsTable.metadata}->>'source' = 'recover_misdemoted_classify_inbox_backfill'`,
    );
}

async function fetchRecoveryNotes(groupId: number): Promise<Array<{ content: string; type: string }>> {
  // Filter on type='system' AND the content marker so we don't pick
  // up the `status_change` note that `transitionGroupStatus` writes
  // for the same status flip.
  return await db
    .select({ content: notesTable.content, type: notesTable.type })
    .from(notesTable)
    .where(
      sql`${notesTable.invoiceGroupId} = ${groupId}
          and ${notesTable.type} = 'system'
          and ${notesTable.content} like '%Classify Inbox Recovery%'`,
    );
}

async function cleanupGroup(id: number): Promise<void> {
  const children = await db.select({ id: claimsTable.id }).from(claimsTable).where(eq(claimsTable.invoiceGroupId, id));
  for (const c of children) {
    await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, c.id)).catch(() => undefined);
  }
  await db.delete(claimsTable).where(eq(claimsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(portalResponsesTable).where(eq(portalResponsesTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(notesTable).where(eq(notesTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)).catch(() => undefined);
}

test("recover-misdemoted-classify-inbox: backfill id is registered in BACKFILL_IDS", () => {
  assert.equal(BACKFILL_ID, BACKFILL_IDS.recoverMisdemotedClassifyInbox);
  assert.equal(BACKFILL_ID, "2026-05-recover-misdemoted-classify-inbox");
});

test("recover-misdemoted-classify-inbox: dry-run reports plan without writing", async () => {
  const g = await createSeedGroup({ status: "Awaiting Response" });
  await seedClaim({ groupId: g.id, errorTypeId: null, errorDetails: null });
  await seedClaim({ groupId: g.id, errorTypeId: null, errorDetails: "" });

  try {
    const report = await runBackfill({ apply: false, groupId: g.id, silent: true });
    assert.equal(report.totals.scanned, 1);
    assert.equal(report.totals.recovered, 1);
    assert.equal(report.applied, false);

    // Group status unchanged in dry-run.
    const grp = await fetchGroup(g.id);
    assert.equal(grp?.status, "Awaiting Response");
    assert.equal((await fetchRecoveryAudits(g.id)).length, 0);
    assert.equal((await fetchRecoveryNotes(g.id)).length, 0);
  } finally {
    await cleanupGroup(g.id);
  }
});

test("recover-misdemoted-classify-inbox: --apply reopens an Awaiting Response group whose every active leg is blank+unclassified", async () => {
  const g = await createSeedGroup({ status: "Awaiting Response" });
  await seedClaim({ groupId: g.id, errorTypeId: null, errorDetails: null });
  await seedClaim({ groupId: g.id, errorTypeId: null, errorDetails: "" });

  try {
    const report = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(report.totals.recovered, 1);

    const grp = await fetchGroup(g.id);
    assert.equal(grp?.status, "Needs Review");
    assert.equal(grp?.outcome, "Pending");

    const audits = await fetchRecoveryAudits(g.id);
    assert.equal(audits.length, 1);
    const meta = audits[0].metadata as Record<string, unknown>;
    assert.equal(meta.backfillId, BACKFILL_ID);
    assert.equal(meta.priorStatus, "Awaiting Response");
    assert.equal(meta.priorOutcome, "Pending");
    assert.equal(meta.targetStatus, "Needs Review");
    assert.equal(meta.outcomeResetToPending, false);
    assert.equal(meta.totalActiveLegs, 2);
    assert.equal(meta.unclassifiedActiveLegCount, 2);
    assert.equal(meta.blankUnclassifiedActiveLegCount, 2);

    const sc = await fetchStatusChangeAudits(g.id);
    assert.equal(sc.length, 1);
    const scMeta = sc[0].metadata as Record<string, unknown>;
    assert.equal(scMeta.from, "Awaiting Response");
    assert.equal(scMeta.to, "Needs Review");

    const notes = await fetchRecoveryNotes(g.id);
    assert.ok(notes.length >= 1);
    assert.equal(notes[0].type, "system");
    assert.match(notes[0].content, /reopened from Awaiting Response to Needs Review/);
    assert.match(notes[0].content, /audit entry/);
  } finally {
    await cleanupGroup(g.id);
  }
});

test("recover-misdemoted-classify-inbox: reopens Resolved/Non-Issue groups and resets outcome to Pending", async () => {
  const g = await createSeedGroup({ status: "Resolved", outcome: "Non-Issue" });
  await seedClaim({ groupId: g.id, errorTypeId: null, errorDetails: null });

  try {
    const report = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(report.totals.recovered, 1);

    const grp = await fetchGroup(g.id);
    assert.equal(grp?.status, "Needs Review");
    assert.equal(grp?.outcome, "Pending", "outcome must be reset to Pending on the way back");

    const audits = await fetchRecoveryAudits(g.id);
    assert.equal(audits.length, 1);
    const meta = audits[0].metadata as Record<string, unknown>;
    assert.equal(meta.priorStatus, "Resolved");
    assert.equal(meta.priorOutcome, "Non-Issue");
    assert.equal(meta.outcomeResetToPending, true);
  } finally {
    await cleanupGroup(g.id);
  }
});

test("recover-misdemoted-classify-inbox: skips when at least one active leg is already classified", async () => {
  const g = await createSeedGroup({ status: "Awaiting Response" });
  // One classified, one blank — group does NOT match the bug
  // fingerprint, so leave it alone.
  await seedClaim({
    groupId: g.id,
    errorTypeId: "billing-mismatch",
    errorDetails: "amount differs",
  });
  await seedClaim({ groupId: g.id, errorTypeId: null, errorDetails: null });

  try {
    const report = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(report.totals.recovered, 0);
    assert.equal(report.totals.skippedHasClassifiedActiveLeg, 1);

    const grp = await fetchGroup(g.id);
    assert.equal(grp?.status, "Awaiting Response", "must not move");
    assert.equal((await fetchRecoveryAudits(g.id)).length, 0);
  } finally {
    await cleanupGroup(g.id);
  }
});

test("recover-misdemoted-classify-inbox: skips when an unclassified leg has non-blank error_details", async () => {
  const g = await createSeedGroup({ status: "Awaiting Response" });
  // The importer would have stamped status="New" for a non-blank
  // description, so a non-blank unclassified leg never went through
  // the mis-demote path.
  await seedClaim({ groupId: g.id, errorTypeId: null, errorDetails: "real description" });

  try {
    const report = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(report.totals.recovered, 0);
    assert.equal(report.totals.skippedHasNonblankUnclassifiedLeg, 1);
    assert.equal((await fetchGroup(g.id))?.status, "Awaiting Response");
  } finally {
    await cleanupGroup(g.id);
  }
});

test("recover-misdemoted-classify-inbox: skips when a reviewable portal response is on file", async () => {
  const g = await createSeedGroup({ status: "Awaiting Response" });
  await seedClaim({ groupId: g.id, errorTypeId: null, errorDetails: null });
  // A real payor verdict on file means the group belongs in the
  // Stage 2 inbox, not the Classify inbox — recovery must skip it.
  await seedResponse({ groupId: g.id, responseType: "denial" });

  try {
    const report = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(report.totals.recovered, 0);
    assert.equal(report.totals.skippedHasReviewableResponse, 1);
    assert.equal((await fetchGroup(g.id))?.status, "Awaiting Response");
  } finally {
    await cleanupGroup(g.id);
  }
});

test("recover-misdemoted-classify-inbox: skips groups with no active legs", async () => {
  const g = await createSeedGroup({ status: "Awaiting Response" });
  // Only an excluded leg — no active legs at all means there's
  // nothing to triage, so leave the group put.
  await seedClaim({
    groupId: g.id,
    errorTypeId: null,
    errorDetails: null,
    includedInDispute: false,
  });

  try {
    const report = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(report.totals.recovered, 0);
    assert.equal(report.totals.skippedNoActiveLegs, 1);
    assert.equal((await fetchGroup(g.id))?.status, "Awaiting Response");
  } finally {
    await cleanupGroup(g.id);
  }
});

test("recover-misdemoted-classify-inbox: --apply is idempotent (re-run recovers zero)", async () => {
  const g = await createSeedGroup({ status: "Awaiting Response" });
  await seedClaim({ groupId: g.id, errorTypeId: null, errorDetails: null });

  try {
    const first = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(first.totals.recovered, 1);
    const auditCountAfterFirst = (await fetchRecoveryAudits(g.id)).length;
    const noteCountAfterFirst = (await fetchRecoveryNotes(g.id)).length;
    assert.equal(auditCountAfterFirst, 1);
    assert.equal(noteCountAfterFirst, 1);

    // The group is no longer in {Awaiting Response, Resolved/Non-Issue},
    // so the candidate filter must report zero on the second run.
    const second = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(second.totals.scanned, 0);
    assert.equal(second.totals.recovered, 0);
    assert.equal((await fetchRecoveryAudits(g.id)).length, auditCountAfterFirst);
    assert.equal((await fetchRecoveryNotes(g.id)).length, noteCountAfterFirst);
  } finally {
    await cleanupGroup(g.id);
  }
});

test("recover-misdemoted-classify-inbox: --group-id scopes to a single group", async () => {
  const targeted = await createSeedGroup({ status: "Awaiting Response" });
  const bystander = await createSeedGroup({ status: "Awaiting Response" });
  await seedClaim({ groupId: targeted.id, errorTypeId: null, errorDetails: null });
  await seedClaim({ groupId: bystander.id, errorTypeId: null, errorDetails: null });

  try {
    const report = await runBackfill({ apply: true, groupId: targeted.id, silent: true });
    assert.equal(report.totals.scanned, 1);
    assert.equal(report.totals.recovered, 1);

    assert.equal((await fetchGroup(targeted.id))?.status, "Needs Review");
    assert.equal((await fetchGroup(bystander.id))?.status, "Awaiting Response");
    assert.equal((await fetchRecoveryAudits(bystander.id)).length, 0);
  } finally {
    await cleanupGroup(targeted.id);
    await cleanupGroup(bystander.id);
  }
});

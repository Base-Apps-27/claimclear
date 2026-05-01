// Tests for the Task #260 retroactive backfill that applies the
// "auto non-issue blank sibling" rule (Task #232) to invoice groups
// that pre-date the rule.
//
// The three buckets called out in the task spec:
//   1. Qualifying mixed group → blank siblings flip, classified leg stays.
//   2. All-blank group → no flips (live rule explicitly leaves these
//      for manual triage).
//   3. Already-fully-classified group → no flips (no blank legs to target).
//
// Plus a re-run check that proves --apply is idempotent: a second run
// over the just-backfilled dataset writes nothing and adds no audit rows.

import { test, after } from "node:test";
import { strict as assert } from "node:assert";
import { eq, inArray } from "drizzle-orm";

import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
  errorTypesTable,
} from "@workspace/db";

import {
  runBackfill,
  RETRO_BACKFILL_SOURCE,
} from "../migrations/2026-05-auto-non-issue-siblings-backfill";

after(async () => {
  await pool.end().catch(() => undefined);
});

// --- Seeding helpers (lightweight; the script itself never seeds, so
//     we only need the columns the rule reads). -----------------------

type GroupStatus = typeof invoiceGroupsTable.status.enumValues[number];
type ClaimStatus = typeof claimsTable.status.enumValues[number];

async function createSeedGroup(opts: { status?: GroupStatus } = {}): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const invoiceNumber = `T260G-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: opts.status ?? "New",
    outcome: "Pending",
  }).returning();
  return row;
}

async function createSeedClaim(opts: {
  invoiceGroupId?: number | null;
  errorTypeId?: string | null;
  errorTypeName?: string | null;
  errorDetails?: string | null;
  includedInDispute?: boolean;
  status?: ClaimStatus;
} = {}): Promise<typeof claimsTable.$inferSelect> {
  const confNumber = `T260-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(claimsTable).values({
    confNumber,
    status: opts.status ?? "New",
    outcome: "Pending",
    invoiceGroupId: opts.invoiceGroupId ?? null,
    errorTypeId: Object.prototype.hasOwnProperty.call(opts, "errorTypeId") ? opts.errorTypeId : null,
    errorTypeName: opts.errorTypeName ?? null,
    errorDetails: Object.prototype.hasOwnProperty.call(opts, "errorDetails") ? opts.errorDetails : null,
    includedInDispute: opts.includedInDispute ?? true,
    claimAmount: "100.00",
  }).returning();
  return row;
}

async function createSeedErrorType(): Promise<typeof errorTypesTable.$inferSelect> {
  const name = `T260-ErrType-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(errorTypesTable).values({
    name,
    description: "test",
    decisionTree: null,
  }).returning();
  return row;
}

async function cleanupGroup(id: number) {
  const children = await db.select({ id: claimsTable.id }).from(claimsTable).where(eq(claimsTable.invoiceGroupId, id));
  for (const c of children) {
    await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, c.id)).catch(() => undefined);
    await db.delete(claimsTable).where(eq(claimsTable.id, c.id)).catch(() => undefined);
  }
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)).catch(() => undefined);
}

async function cleanupErrorType(id: number) {
  await db.delete(errorTypesTable).where(eq(errorTypesTable.id, id)).catch(() => undefined);
}

async function retroAuditCount(groupId: number): Promise<number> {
  const rows = await db
    .select({ id: auditLogsTable.id, metadata: auditLogsTable.metadata })
    .from(auditLogsTable)
    .where(eq(auditLogsTable.invoiceGroupId, groupId));
  return rows.filter((r) => {
    const meta = r.metadata as { source?: string } | null;
    return meta?.source === RETRO_BACKFILL_SOURCE;
  }).length;
}

test("retro backfill: dry-run plans flips without writing; --apply lands them", async () => {
  const errType = await createSeedErrorType();

  // Bucket 1: qualifying mixed — one leg with errorDetails, two blank
  // siblings still in dispute. The backfill must exclude both blanks
  // and leave the qualifying leg in dispute.
  const qualifyingGroup = await createSeedGroup({ status: "New" });
  const qualifyingLeg = await createSeedClaim({
    invoiceGroupId: qualifyingGroup.id,
    errorDetails: "real issue narrative",
    errorTypeId: null,
  });
  const blank1 = await createSeedClaim({
    invoiceGroupId: qualifyingGroup.id,
    errorDetails: null,
    errorTypeId: null,
  });
  const blank2 = await createSeedClaim({
    invoiceGroupId: qualifyingGroup.id,
    errorDetails: "   ",
    errorTypeId: null,
  });

  // Bucket 2: all-blank — every leg has empty errorDetails. The live
  // rule leaves these for manual triage; the backfill must do the same.
  const allBlankGroup = await createSeedGroup({ status: "New" });
  const ab1 = await createSeedClaim({
    invoiceGroupId: allBlankGroup.id,
    errorDetails: null,
    errorTypeId: null,
  });
  const ab2 = await createSeedClaim({
    invoiceGroupId: allBlankGroup.id,
    errorDetails: "",
    errorTypeId: null,
  });

  // Bucket 3: fully-classified — every leg has errorTypeId set. No
  // blank-target legs exist, so nothing to flip.
  const classifiedGroup = await createSeedGroup({ status: "Needs Evidence" });
  const c1 = await createSeedClaim({
    invoiceGroupId: classifiedGroup.id,
    errorDetails: "first issue",
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
  });
  const c2 = await createSeedClaim({
    invoiceGroupId: classifiedGroup.id,
    errorDetails: "second issue",
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
  });

  try {
    const allGroupIds = [qualifyingGroup.id, allBlankGroup.id, classifiedGroup.id];

    // --- Dry-run --------------------------------------------------------
    const beforeAudits = await db
      .select({ id: auditLogsTable.id })
      .from(auditLogsTable)
      .where(inArray(auditLogsTable.invoiceGroupId, allGroupIds));

    const dryReport = await runBackfill({ apply: false, statuses: [], silent: true });
    assert.ok(
      dryReport.qualifyingGroups >= 1,
      `dry-run should detect at least the seeded qualifying group (saw ${dryReport.qualifyingGroups})`,
    );
    assert.ok(
      dryReport.legsFlipped >= 2,
      `dry-run should plan ≥2 flips for the qualifying group (saw ${dryReport.legsFlipped})`,
    );

    const afterDryAudits = await db
      .select({ id: auditLogsTable.id })
      .from(auditLogsTable)
      .where(inArray(auditLogsTable.invoiceGroupId, allGroupIds));
    assert.equal(
      afterDryAudits.length,
      beforeAudits.length,
      "dry-run must not insert any audit rows",
    );

    const stillIn = await db
      .select()
      .from(claimsTable)
      .where(inArray(claimsTable.id, [blank1.id, blank2.id]));
    for (const r of stillIn) {
      assert.equal(r.includedInDispute, true, `blank leg ${r.id} must still be in dispute after dry-run`);
    }

    // --- Apply ---------------------------------------------------------
    const applyReport = await runBackfill({ apply: true, statuses: [], silent: true });
    assert.ok(applyReport.legsFlipped >= 2, `apply should flip ≥2 legs (saw ${applyReport.legsFlipped})`);

    // Bucket 1: blank siblings excluded; qualifying leg untouched.
    const blanksAfter = await db
      .select()
      .from(claimsTable)
      .where(inArray(claimsTable.id, [blank1.id, blank2.id]));
    for (const r of blanksAfter) {
      assert.equal(r.includedInDispute, false, `blank sibling ${r.id} must be excluded`);
    }
    const [qualAfter] = await db
      .select()
      .from(claimsTable)
      .where(eq(claimsTable.id, qualifyingLeg.id));
    assert.equal(qualAfter.includedInDispute, true, "qualifying leg must remain in dispute");

    // Audit rows on the qualifying group must be tagged with the retro
    // source string and reason=non_issue.
    const qualGroupAudits = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.invoiceGroupId, qualifyingGroup.id));
    type Meta = { source?: string; reason?: string } | null;
    const retroAudits = qualGroupAudits.filter((a) => (a.metadata as Meta)?.source === RETRO_BACKFILL_SOURCE);
    assert.equal(
      retroAudits.length,
      2,
      `expected 2 retro_auto_non_issue_backfill audit rows on qualifying group, got ${retroAudits.length}`,
    );
    for (const a of retroAudits) {
      assert.equal(a.action, "leg_excluded");
      assert.equal((a.metadata as Meta)?.reason, "non_issue");
    }

    // Bucket 2: all-blank group untouched.
    const abAfter = await db
      .select()
      .from(claimsTable)
      .where(inArray(claimsTable.id, [ab1.id, ab2.id]));
    for (const r of abAfter) {
      assert.equal(r.includedInDispute, true, `all-blank leg ${r.id} must NOT be flipped`);
    }
    assert.equal(await retroAuditCount(allBlankGroup.id), 0, "all-blank group must have no retro audit rows");

    // Bucket 3: fully-classified group untouched.
    const cAfter = await db
      .select()
      .from(claimsTable)
      .where(inArray(claimsTable.id, [c1.id, c2.id]));
    for (const r of cAfter) {
      assert.equal(r.includedInDispute, true, `classified leg ${r.id} must remain in dispute`);
    }
    assert.equal(await retroAuditCount(classifiedGroup.id), 0, "classified group must have no retro audit rows");

    // --- Idempotency: a second --apply must be a no-op. ----------------
    const auditsBeforeRerun = await db
      .select({ id: auditLogsTable.id })
      .from(auditLogsTable)
      .where(eq(auditLogsTable.invoiceGroupId, qualifyingGroup.id));
    await runBackfill({ apply: true, statuses: [], silent: true });
    const auditsAfterRerun = await db
      .select({ id: auditLogsTable.id })
      .from(auditLogsTable)
      .where(eq(auditLogsTable.invoiceGroupId, qualifyingGroup.id));
    assert.equal(
      auditsAfterRerun.length,
      auditsBeforeRerun.length,
      "second --apply must not write any new audit rows on already-cleaned group",
    );
    assert.equal(
      await retroAuditCount(qualifyingGroup.id),
      retroAudits.length,
      "second --apply must not append additional retro audit rows",
    );
  } finally {
    await cleanupGroup(qualifyingGroup.id);
    await cleanupGroup(allBlankGroup.id);
    await cleanupGroup(classifiedGroup.id);
    await cleanupErrorType(errType.id);
  }
});

test("retro backfill: --group-id scopes to a single group", async () => {
  const targetGroup = await createSeedGroup({ status: "New" });
  await createSeedClaim({
    invoiceGroupId: targetGroup.id,
    errorDetails: "real",
    errorTypeId: null,
  });
  const blank = await createSeedClaim({
    invoiceGroupId: targetGroup.id,
    errorDetails: null,
    errorTypeId: null,
  });

  const otherGroup = await createSeedGroup({ status: "New" });
  await createSeedClaim({
    invoiceGroupId: otherGroup.id,
    errorDetails: "real",
    errorTypeId: null,
  });
  const otherBlank = await createSeedClaim({
    invoiceGroupId: otherGroup.id,
    errorDetails: null,
    errorTypeId: null,
  });

  try {
    const report = await runBackfill({
      apply: true,
      statuses: [],
      groupId: targetGroup.id,
      silent: true,
    });
    assert.equal(report.groupsScanned, 1, "must only scan the requested group");
    assert.equal(report.legsFlipped, 1, "must only flip the targeted blank leg");

    const [targetBlank] = await db.select().from(claimsTable).where(eq(claimsTable.id, blank.id));
    assert.equal(targetBlank.includedInDispute, false, "targeted blank leg must be excluded");

    const [otherBlankAfter] = await db.select().from(claimsTable).where(eq(claimsTable.id, otherBlank.id));
    assert.equal(otherBlankAfter.includedInDispute, true, "other group's blank leg must remain untouched");
  } finally {
    await cleanupGroup(targetGroup.id);
    await cleanupGroup(otherGroup.id);
  }
});

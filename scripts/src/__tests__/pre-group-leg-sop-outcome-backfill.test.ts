// Tests for the Task #301 retroactive backfill that heals legs
// pre-dating the invoice-group flow so their `sop_outcome` matches the
// channel they were actually submitted through. Verdicts can then be
// recorded via the modern endpoint without falling back to the
// reconcile path.
//
// The four candidate buckets exercised here:
//   1. Email evidence via `claims.dispute_email_sent = true`
//      → stamp `sop_outcome = 'dispute'`.
//   2. Email evidence via an `outbound_emails` row keyed to the leg
//      with `kind = 'dispute'` → stamp `sop_outcome = 'dispute'`.
//   3. Portal evidence via a `portal_submissions` row in the same
//      group with `status = 'submitted'` → stamp
//      `sop_outcome = 'portal_dispute'`.
//   4. No evidence → leg is reported as skipped (operator must use the
//      in-app reconcile path).
//
// Plus three negative-predicate cases that must NOT be picked up:
//   - leg already has `sop_outcome` set
//   - leg `included_in_dispute = false`
//   - leg has no `error_type_id`
//
// And an idempotency check: the dataset stays clean across a second
// `--apply` (no extra writes, no extra audit rows).

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
  outboundEmailsTable,
  portalSubmissionsTable,
} from "@workspace/db";

import {
  runBackfill,
  isCandidateLeg,
  decideEvidence,
  BACKFILL_SOURCE,
  BACKFILL_ID,
} from "../migrations/2026-05-pre-group-leg-sop-outcome-backfill";
import { BACKFILL_IDS } from "../migrations/_backfill-audit";

after(async () => {
  await pool.end().catch(() => undefined);
});

type GroupStatus = typeof invoiceGroupsTable.status.enumValues[number];
type ClaimStatus = typeof claimsTable.status.enumValues[number];

async function createSeedGroup(opts: { status?: GroupStatus } = {}): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const invoiceNumber = `T301G-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: opts.status ?? "Awaiting Response",
    outcome: "Pending",
  }).returning();
  return row;
}

async function createSeedClaim(opts: {
  invoiceGroupId?: number | null;
  errorTypeId?: string | null;
  errorTypeName?: string | null;
  sopOutcome?: string | null;
  status?: ClaimStatus;
  includedInDispute?: boolean;
  disputeEmailSent?: boolean;
} = {}): Promise<typeof claimsTable.$inferSelect> {
  const confNumber = `T301-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(claimsTable).values({
    confNumber,
    status: opts.status ?? "Awaiting Response",
    outcome: "Pending",
    invoiceGroupId: opts.invoiceGroupId ?? null,
    errorTypeId: Object.prototype.hasOwnProperty.call(opts, "errorTypeId") ? opts.errorTypeId : null,
    errorTypeName: opts.errorTypeName ?? null,
    sopOutcome: opts.sopOutcome ?? null,
    includedInDispute: opts.includedInDispute ?? true,
    disputeEmailSent: opts.disputeEmailSent ?? false,
    claimAmount: "100.00",
  }).returning();
  return row;
}

async function createSeedErrorType(): Promise<typeof errorTypesTable.$inferSelect> {
  const name = `T301-ErrType-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
    await db.delete(outboundEmailsTable).where(eq(outboundEmailsTable.claimId, c.id)).catch(() => undefined);
    await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, c.id)).catch(() => undefined);
    await db.delete(claimsTable).where(eq(claimsTable.id, c.id)).catch(() => undefined);
  }
  await db.delete(outboundEmailsTable).where(eq(outboundEmailsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)).catch(() => undefined);
}

async function cleanupErrorType(id: number) {
  await db.delete(errorTypesTable).where(eq(errorTypesTable.id, id)).catch(() => undefined);
}

test("isCandidateLeg returns true only for the documented predicate", async () => {
  // Predicate (matches the SQL filter in streamCandidateBatches):
  //   sop_outcome IS NULL
  //   AND included_in_dispute = true
  //   AND error_type_id IS NOT NULL
  //   AND invoice_group_id IS NOT NULL
  const errType = await createSeedErrorType();
  const group = await createSeedGroup();
  try {
    const ok = await createSeedClaim({
      invoiceGroupId: group.id,
      errorTypeId: String(errType.id),
      errorTypeName: errType.name,
    });
    assert.equal(isCandidateLeg(ok), true, "ideal candidate must match");

    const alreadyStamped = await createSeedClaim({
      invoiceGroupId: group.id,
      errorTypeId: String(errType.id),
      sopOutcome: "dispute",
    });
    assert.equal(isCandidateLeg(alreadyStamped), false, "already-stamped legs are not candidates");

    const excluded = await createSeedClaim({
      invoiceGroupId: group.id,
      errorTypeId: String(errType.id),
      includedInDispute: false,
    });
    assert.equal(isCandidateLeg(excluded), false, "excluded legs are not candidates");

    const unclassified = await createSeedClaim({
      invoiceGroupId: group.id,
      errorTypeId: null,
    });
    assert.equal(isCandidateLeg(unclassified), false, "unclassified legs are not candidates");

    const orphan = await createSeedClaim({
      invoiceGroupId: null,
      errorTypeId: String(errType.id),
    });
    assert.equal(isCandidateLeg(orphan), false, "orphan legs (no group) are not candidates");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("backfill stamps the right sop_outcome per evidence channel and skips legs with no evidence", async () => {
  const errType = await createSeedErrorType();

  // Bucket 1: dispute_email_sent flag → 'dispute'
  const flagGroup = await createSeedGroup();
  const flagLeg = await createSeedClaim({
    invoiceGroupId: flagGroup.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    disputeEmailSent: true,
  });

  // Bucket 2: outbound_emails row → 'dispute'
  const outboundGroup = await createSeedGroup();
  const outboundLeg = await createSeedClaim({
    invoiceGroupId: outboundGroup.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
  });
  await db.insert(outboundEmailsTable).values({
    claimId: outboundLeg.id,
    invoiceGroupId: outboundGroup.id,
    kind: "dispute",
    subject: "test dispute",
  });

  // Bucket 3: portal_submissions row in submitted state → 'portal_dispute'
  const portalGroup = await createSeedGroup();
  const portalLeg = await createSeedClaim({
    invoiceGroupId: portalGroup.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
  });
  await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: portalGroup.id,
    status: "submitted",
  });

  // Bucket 4: no evidence whatsoever → must be reported as skipped.
  const noEvidenceGroup = await createSeedGroup();
  const noEvidenceLeg = await createSeedClaim({
    invoiceGroupId: noEvidenceGroup.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
  });

  // Negative case: a portal_submissions row in 'pending' is NOT evidence
  // the payor saw it. The leg must still be skipped.
  const draftPortalGroup = await createSeedGroup();
  const draftPortalLeg = await createSeedClaim({
    invoiceGroupId: draftPortalGroup.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
  });
  await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: draftPortalGroup.id,
    status: "pending",
  });

  try {
    // --- decideEvidence is exposed as a pure unit -----------------------
    const fresh = await db
      .select()
      .from(claimsTable)
      .where(inArray(claimsTable.id, [flagLeg.id, outboundLeg.id, portalLeg.id, noEvidenceLeg.id, draftPortalLeg.id]));
    const byId = new Map(fresh.map((r) => [r.id, r]));
    assert.deepEqual(await decideEvidence(db, byId.get(flagLeg.id)!), {
      channel: "email", to: "dispute",
    });
    assert.deepEqual(await decideEvidence(db, byId.get(outboundLeg.id)!), {
      channel: "email", to: "dispute",
    });
    assert.deepEqual(await decideEvidence(db, byId.get(portalLeg.id)!), {
      channel: "portal", to: "portal_dispute",
    });
    assert.equal(await decideEvidence(db, byId.get(noEvidenceLeg.id)!), null);
    assert.equal(
      await decideEvidence(db, byId.get(draftPortalLeg.id)!),
      null,
      "a 'pending' portal_submissions row is not evidence the payor saw it",
    );

    // --- Dry-run plans the stamps but never writes ---------------------
    const dryReport = await runBackfill({ apply: false, silent: true });
    assert.ok(
      dryReport.legsStamped >= 3,
      `dry-run should plan ≥3 stamps for the seeded buckets (saw ${dryReport.legsStamped})`,
    );
    const flagStill = await db.select().from(claimsTable).where(eq(claimsTable.id, flagLeg.id));
    assert.equal(flagStill[0]!.sopOutcome, null, "dry-run must not write to claims.sop_outcome");

    // --- Apply lands the stamps + audit rows --------------------------
    const applyReport = await runBackfill({ apply: true, silent: true });
    assert.ok(applyReport.legsStamped >= 3, `apply should stamp ≥3 legs (saw ${applyReport.legsStamped})`);
    assert.ok(
      applyReport.legsSkippedNoEvidence >= 2,
      `apply should report ≥2 no-evidence legs (saw ${applyReport.legsSkippedNoEvidence})`,
    );

    const post = await db
      .select()
      .from(claimsTable)
      .where(inArray(claimsTable.id, [flagLeg.id, outboundLeg.id, portalLeg.id, noEvidenceLeg.id, draftPortalLeg.id]));
    const postById = new Map(post.map((r) => [r.id, r]));
    assert.equal(postById.get(flagLeg.id)!.sopOutcome, "dispute");
    assert.equal(postById.get(outboundLeg.id)!.sopOutcome, "dispute");
    assert.equal(postById.get(portalLeg.id)!.sopOutcome, "portal_dispute");
    assert.equal(postById.get(noEvidenceLeg.id)!.sopOutcome, null, "no-evidence leg must remain unstamped");
    assert.equal(postById.get(draftPortalLeg.id)!.sopOutcome, null, "draft-portal leg must remain unstamped");

    // Audit rows must carry the script source string AND the uniform
    // backfillId tag (Task #268 cross-backfill registry).
    type Meta = {
      source?: string;
      to?: string;
      from?: unknown;
      evidence?: string;
      backfillId?: string;
    } | null;
    for (const legId of [flagLeg.id, outboundLeg.id, portalLeg.id]) {
      const audits = await db
        .select()
        .from(auditLogsTable)
        .where(eq(auditLogsTable.claimId, legId));
      const ours = audits.filter((a) => (a.metadata as Meta)?.source === BACKFILL_SOURCE);
      assert.equal(ours.length, 1, `leg ${legId} must get exactly one backfill audit row`);
      const row = ours[0]!;
      assert.equal(row.action, "leg_sop_outcome_backfilled");
      const meta = row.metadata as Meta;
      assert.equal(meta?.from, null, "audit row must record from=null");
      assert.equal(typeof meta?.to, "string");
      assert.ok(["dispute", "portal_dispute"].includes(meta!.to!), "to must be a stamped outcome");
      assert.ok(["email", "portal"].includes(meta!.evidence!), "evidence must be email or portal");
      assert.equal(meta?.backfillId, BACKFILL_ID, "backfillId must be stamped");
      assert.equal(BACKFILL_ID, BACKFILL_IDS.preGroupLegSopOutcome, "registered constant must match");
    }

    // No-evidence legs must not produce backfill audit rows.
    for (const legId of [noEvidenceLeg.id, draftPortalLeg.id]) {
      const audits = await db
        .select()
        .from(auditLogsTable)
        .where(eq(auditLogsTable.claimId, legId));
      const ours = audits.filter((a) => (a.metadata as Meta)?.source === BACKFILL_SOURCE);
      assert.equal(ours.length, 0, `no-evidence leg ${legId} must not get a backfill audit row`);
    }

    // --- Idempotency: a second --apply must be a no-op ----------------
    const auditsBefore = await db
      .select({ id: auditLogsTable.id })
      .from(auditLogsTable)
      .where(inArray(auditLogsTable.claimId, [flagLeg.id, outboundLeg.id, portalLeg.id]));
    const rerun = await runBackfill({ apply: true, silent: true });
    const auditsAfter = await db
      .select({ id: auditLogsTable.id })
      .from(auditLogsTable)
      .where(inArray(auditLogsTable.claimId, [flagLeg.id, outboundLeg.id, portalLeg.id]));
    assert.equal(
      auditsAfter.length,
      auditsBefore.length,
      "second --apply must not append audit rows for already-stamped legs",
    );
    // The seeded healed legs must no longer be picked up; the rerun may
    // still report no-evidence skips from siblings, but stamps should
    // not include the three already healed.
    for (const legId of [flagLeg.id, outboundLeg.id, portalLeg.id]) {
      assert.ok(
        !rerun.preview.some((p) => p.legId === legId),
        `leg ${legId} must not appear in the rerun preview`,
      );
    }
  } finally {
    await cleanupGroup(flagGroup.id);
    await cleanupGroup(outboundGroup.id);
    await cleanupGroup(portalGroup.id);
    await cleanupGroup(noEvidenceGroup.id);
    await cleanupGroup(draftPortalGroup.id);
    await cleanupErrorType(errType.id);
  }
});

test("backfill --leg-id scopes to a single leg", async () => {
  const errType = await createSeedErrorType();
  const group = await createSeedGroup();
  const targetLeg = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    disputeEmailSent: true,
  });
  const otherLeg = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    disputeEmailSent: true,
  });
  try {
    const report = await runBackfill({ apply: true, legId: targetLeg.id, silent: true });
    assert.equal(report.legsStamped, 1, "must only stamp the targeted leg");

    const [post] = await db.select().from(claimsTable).where(eq(claimsTable.id, targetLeg.id));
    assert.equal(post.sopOutcome, "dispute", "targeted leg must be stamped");

    const [otherPost] = await db.select().from(claimsTable).where(eq(claimsTable.id, otherLeg.id));
    assert.equal(otherPost.sopOutcome, null, "non-targeted leg must remain untouched");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

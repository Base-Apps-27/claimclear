// Tests for the Task #299 one-shot backfill that heals invoice groups
// stuck in `Needs Review` / `Ready to Review` with no reviewable
// portal_response on file (the blank "Response details unavailable"
// rows in the Stage 2 inbox).
//
// Buckets exercised:
//   1. Stuck group with NO responses, no audit trail → defaults to
//      `Awaiting Response`.
//   2. Stuck group whose last audit `from` was `Needs Evidence`
//      (a valid manual-revert target) → reverted to `Needs Evidence`.
//   3. Stuck group whose only prior statuses are system-controlled
//      (`Generating Email`) → defaults to `Awaiting Response`, with
//      the raw prior status stashed in audit metadata for traceability.
//   4. Stuck group with a reviewable response (`denial`) on file →
//      SKIPPED (it belongs in the inbox).
//   5. Stuck group with only an `acknowledgment` response on file →
//      qualifies for the heal (acknowledgments are not reviewable).
//   6. Group not in a stuck status (`Awaiting Response`) → ignored
//      regardless of its responses.
//
// Plus the non-negotiable post-conditions:
//   - Apply writes a `group_status_changed` audit row + status_change
//     note + `inbox_heal_applied` audit row + system note per heal.
//   - The `inbox_heal_applied` row carries `metadata.backfillId`,
//     `priorStatus`, `targetStatus`, `targetSource`, and the
//     considered-response-id list.
//   - Idempotency: a second `--apply` over the just-healed dataset
//     reports zero heals and writes zero new heal-tagged audit rows.
//   - Group-id scoping: `--group-id` only touches the named group,
//     leaving every other stuck group alone.

import { test, after } from "node:test";
import { strict as assert } from "node:assert";
import { eq, inArray, sql } from "drizzle-orm";

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
} from "../migrations/2026-05-heal-stuck-needs-review-inbox-backfill";
import { BACKFILL_IDS } from "../migrations/_backfill-audit";

after(async () => {
  await pool.end().catch(() => undefined);
});

type GroupStatus = typeof invoiceGroupsTable.status.enumValues[number];
type ResponseType = typeof portalResponsesTable.responseType.enumValues[number];

async function createSeedGroup(opts: { status: GroupStatus }): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const invoiceNumber = `T299G-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [row] = await db
    .insert(invoiceGroupsTable)
    .values({
      invoiceNumber,
      status: opts.status,
      outcome: "Pending",
    })
    .returning();
  return row;
}

async function seedAuditTransition(opts: {
  groupId: number;
  from: string;
  to: string;
  // Audit rows are sorted by timestamp DESC so the test can dictate
  // which "from" the script will pick. Higher = more recent.
  ageMinutes: number;
}): Promise<void> {
  const ts = new Date(Date.now() - opts.ageMinutes * 60 * 1000);
  await db.insert(auditLogsTable).values({
    invoiceGroupId: opts.groupId,
    action: "group_status_changed",
    details: `Status changed from ${opts.from} to ${opts.to}`,
    metadata: { from: opts.from, to: opts.to, source: "test_seed", reason: "seed" },
    userEmail: "seed@test",
    userName: "Seed",
    timestamp: ts,
  });
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
      senderEmail: `t299-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
      autoLinked: true,
    })
    .returning({ id: portalResponsesTable.id });
  return row.id;
}

async function fetchGroupStatus(id: number): Promise<string> {
  const [row] = await db
    .select({ status: invoiceGroupsTable.status })
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.id, id));
  return row?.status ?? "(missing)";
}

async function fetchHealAudits(groupId: number): Promise<Array<{ id: number; metadata: unknown }>> {
  return await db
    .select({ id: auditLogsTable.id, metadata: auditLogsTable.metadata })
    .from(auditLogsTable)
    .where(
      sql`${auditLogsTable.invoiceGroupId} = ${groupId}
          and ${auditLogsTable.action} = 'inbox_heal_applied'
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
          and ${auditLogsTable.metadata}->>'source' = 'heal_stuck_needs_review_inbox_backfill'`,
    );
}

async function fetchHealNotes(groupId: number): Promise<Array<{ content: string; type: string }>> {
  return await db
    .select({ content: notesTable.content, type: notesTable.type })
    .from(notesTable)
    .where(
      sql`${notesTable.invoiceGroupId} = ${groupId}
          and ${notesTable.content} like '%Stuck Inbox Heal%'`,
    );
}

async function seedClaim(opts: {
  groupId: number;
  errorTypeId?: string | null;
  errorDetails?: string | null;
  includedInDispute?: boolean;
  duplicateOfClaimId?: number | null;
}): Promise<typeof claimsTable.$inferSelect> {
  const confNumber = `T346-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [row] = await db.insert(claimsTable).values({
    confNumber,
    invoiceGroupId: opts.groupId,
    errorTypeId: opts.errorTypeId ?? null,
    errorDetails: opts.errorDetails ?? null,
    includedInDispute: opts.includedInDispute ?? true,
    duplicateOfClaimId: opts.duplicateOfClaimId ?? null,
    claimAmount: "100.00",
    status: "Needs Review",
    outcome: "Pending",
  }).returning();
  return row;
}

async function cleanupGroup(id: number): Promise<void> {
  // Walk children first so we don't leave orphan audit/claim rows
  // around between tests.
  const children = await db
    .select({ id: claimsTable.id })
    .from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, id));
  for (const c of children) {
    await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, c.id)).catch(() => undefined);
  }
  await db.delete(claimsTable).where(eq(claimsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(portalResponsesTable).where(eq(portalResponsesTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(notesTable).where(eq(notesTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)).catch(() => undefined);
}

test("heal-stuck-needs-review-inbox: backfill id is registered in BACKFILL_IDS", () => {
  assert.equal(BACKFILL_ID, BACKFILL_IDS.healStuckNeedsReviewInbox);
  assert.equal(BACKFILL_ID, "2026-05-heal-stuck-needs-review-inbox");
});

test("heal-stuck-needs-review-inbox: dry-run reports plan without writing", async () => {
  const stuckBlank = await createSeedGroup({ status: "Needs Review" });
  const stuckWithReviewable = await createSeedGroup({ status: "Needs Review" });
  await seedResponse({ groupId: stuckWithReviewable.id, responseType: "denial" });

  try {
    const report = await runBackfill({
      apply: false,
      groupId: stuckBlank.id,
      silent: true,
    });
    assert.equal(report.totals.scanned, 1);
    assert.equal(report.totals.healed, 1);
    assert.equal(report.applied, false);

    // Stuck blank group must NOT have moved.
    assert.equal(await fetchGroupStatus(stuckBlank.id), "Needs Review");
    // Dry-run wrote no heal audit rows.
    assert.equal((await fetchHealAudits(stuckBlank.id)).length, 0);
    // Dry-run wrote no heal notes.
    assert.equal((await fetchHealNotes(stuckBlank.id)).length, 0);

    // The reviewable-response group is in a different scope; just sanity
    // check that targeting the blank group didn't accidentally pull it in.
    const otherReport = await runBackfill({
      apply: false,
      groupId: stuckWithReviewable.id,
      silent: true,
    });
    assert.equal(otherReport.totals.scanned, 1);
    assert.equal(otherReport.totals.healed, 0);
    assert.equal(otherReport.totals.skippedHasReviewable, 1);
  } finally {
    await cleanupGroup(stuckBlank.id);
    await cleanupGroup(stuckWithReviewable.id);
  }
});

test("heal-stuck-needs-review-inbox: skips groups with reviewable responses", async () => {
  const groups: number[] = [];
  try {
    for (const t of ["approval", "denial", "partial_approval", "info_request", "other"] as const) {
      const g = await createSeedGroup({ status: "Needs Review" });
      groups.push(g.id);
      await seedResponse({ groupId: g.id, responseType: t });

      const report = await runBackfill({ apply: true, groupId: g.id, silent: true });
      assert.equal(report.totals.skippedHasReviewable, 1, `responseType=${t} must be skipped`);
      assert.equal(report.totals.healed, 0);
      assert.equal(
        await fetchGroupStatus(g.id),
        "Needs Review",
        `group with ${t} must remain in Needs Review`,
      );
      // No heal audits / notes written.
      assert.equal((await fetchHealAudits(g.id)).length, 0);
      assert.equal((await fetchStatusChangeAudits(g.id)).length, 0);
    }
  } finally {
    for (const id of groups) await cleanupGroup(id);
  }
});

test("heal-stuck-needs-review-inbox: ack-only group qualifies and defaults to Awaiting Response without audit", async () => {
  const g = await createSeedGroup({ status: "Needs Review" });
  await seedResponse({ groupId: g.id, responseType: "acknowledgment" });

  try {
    const report = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(report.totals.healed, 1);
    assert.equal(report.totals.healedDefaulted, 1);
    assert.equal(report.totals.healedFromAudit, 0);

    // Status flipped to Awaiting Response.
    assert.equal(await fetchGroupStatus(g.id), "Awaiting Response");

    // Heal audit row carries the rich metadata.
    const heals = await fetchHealAudits(g.id);
    assert.equal(heals.length, 1);
    const meta = heals[0].metadata as Record<string, unknown>;
    assert.equal(meta.backfillId, BACKFILL_ID);
    assert.equal(meta.priorStatus, "Needs Review");
    assert.equal(meta.targetStatus, "Awaiting Response");
    assert.equal(meta.targetSource, "default");
    assert.equal((meta.responseTypeCounts as Record<string, number>).acknowledgment, 1);
    assert.equal((meta.consideredResponseIds as number[]).length, 1);
    assert.equal(meta.consideredResponseIdCount, 1);

    // group_status_changed audit row from transitionGroupStatus(systemOverride).
    const sc = await fetchStatusChangeAudits(g.id);
    assert.equal(sc.length, 1);
    const scMeta = sc[0].metadata as Record<string, unknown>;
    assert.equal(scMeta.from, "Needs Review");
    assert.equal(scMeta.to, "Awaiting Response");
    assert.equal(scMeta.source, "heal_stuck_needs_review_inbox_backfill");

    // Heal note exists and references the audit.
    const notes = await fetchHealNotes(g.id);
    assert.ok(notes.length >= 1);
    assert.equal(notes[0].type, "system");
    assert.match(notes[0].content, /reverted from Needs Review to Awaiting Response/);
    assert.match(notes[0].content, /audit entry/);
  } finally {
    await cleanupGroup(g.id);
  }
});

test("heal-stuck-needs-review-inbox: picks most recent valid prior status from audit trail", async () => {
  const g = await createSeedGroup({ status: "Ready to Review" });
  // Order matters: the most recent group_status_changed row whose `from`
  // is in the manual-revert set is what wins. Older rows are ignored.
  await seedAuditTransition({ groupId: g.id, from: "New", to: "Awaiting Response", ageMinutes: 600 });
  await seedAuditTransition({ groupId: g.id, from: "Awaiting Response", to: "Needs Evidence", ageMinutes: 300 });
  await seedAuditTransition({ groupId: g.id, from: "Needs Evidence", to: "Ready to Review", ageMinutes: 60 });

  try {
    const report = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(report.totals.healed, 1);
    assert.equal(report.totals.healedFromAudit, 1);
    assert.equal(report.totals.healedDefaulted, 0);

    // The most recent transition's `from` was `Needs Evidence` — that's
    // in the manual-revert set, so the script picks it.
    assert.equal(await fetchGroupStatus(g.id), "Needs Evidence");

    const heals = await fetchHealAudits(g.id);
    assert.equal(heals.length, 1);
    const meta = heals[0].metadata as Record<string, unknown>;
    assert.equal(meta.priorStatus, "Ready to Review");
    assert.equal(meta.targetStatus, "Needs Evidence");
    assert.equal(meta.targetSource, "audit_trail");
    assert.ok(typeof meta.chosenFromAuditId === "number");
  } finally {
    await cleanupGroup(g.id);
  }
});

test("heal-stuck-needs-review-inbox: defaults when only system-controlled statuses appear in audit trail", async () => {
  const g = await createSeedGroup({ status: "Needs Review" });
  // Only system-controlled prior statuses — none qualify, so the
  // script defaults to Awaiting Response and stashes the most recent
  // *non-stuck* prior status for traceability. The intervening
  // Ready to Review → Needs Review shuffle (`from='Ready to Review'`)
  // is itself a stuck status and must be skipped over by the picker.
  await seedAuditTransition({ groupId: g.id, from: "Generating Email", to: "Ready to Review", ageMinutes: 120 });
  await seedAuditTransition({ groupId: g.id, from: "Ready to Review", to: "Needs Review", ageMinutes: 30 });

  try {
    const report = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(report.totals.healed, 1);
    assert.equal(report.totals.healedDefaulted, 1);

    assert.equal(await fetchGroupStatus(g.id), "Awaiting Response");

    const heals = await fetchHealAudits(g.id);
    assert.equal(heals.length, 1);
    const meta = heals[0].metadata as Record<string, unknown>;
    assert.equal(meta.targetStatus, "Awaiting Response");
    assert.equal(meta.targetSource, "default");
    // The most recent non-stuck `from` was `Generating Email` (a
    // system-controlled status not in the revert set) — that's what
    // the picker landed on and must be stashed verbatim for tracing.
    assert.equal(meta.mostRecentPriorAuditStatus, "Generating Email");
    assert.equal(meta.chosenFromAuditId, null);
  } finally {
    await cleanupGroup(g.id);
  }
});

test("heal-stuck-needs-review-inbox: defaults when most recent prior is system-controlled, even if older history has a valid target", async () => {
  // Mixed-history case: an older transition shows the group held
  // `Awaiting Response` (a valid manual revert target), but the most
  // recent transition before it landed in the inbox came out of
  // `Portal Queued` (system-controlled). The picker must NOT skip
  // over the recent system-controlled status to grab the older
  // `Awaiting Response`. It must default to `Awaiting Response`
  // because that's the policy choice — but record `targetSource`
  // as `default` and stash the raw `Portal Queued` for traceability.
  const g = await createSeedGroup({ status: "Needs Review" });
  // Oldest: Awaiting Response → Portal Queued.
  await seedAuditTransition({
    groupId: g.id,
    from: "Awaiting Response",
    to: "Portal Queued",
    ageMinutes: 600,
  });
  // Most recent: Portal Queued → Needs Review (this is the one whose
  // `from` the picker should land on).
  await seedAuditTransition({
    groupId: g.id,
    from: "Portal Queued",
    to: "Needs Review",
    ageMinutes: 60,
  });

  try {
    const report = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(report.totals.healed, 1);
    assert.equal(
      report.totals.healedDefaulted,
      1,
      "must default — picker must not look further back past the system-controlled status",
    );
    assert.equal(report.totals.healedFromAudit, 0);

    assert.equal(await fetchGroupStatus(g.id), "Awaiting Response");

    const heals = await fetchHealAudits(g.id);
    assert.equal(heals.length, 1);
    const meta = heals[0].metadata as Record<string, unknown>;
    assert.equal(meta.targetStatus, "Awaiting Response");
    assert.equal(meta.targetSource, "default");
    assert.equal(
      meta.mostRecentPriorAuditStatus,
      "Portal Queued",
      "must record the recent system-controlled status, NOT the older valid one",
    );
    assert.equal(meta.chosenFromAuditId, null);
  } finally {
    await cleanupGroup(g.id);
  }
});

test("heal-stuck-needs-review-inbox: leaves non-stuck groups alone", async () => {
  // A group already in Awaiting Response — even if it has no responses
  // — must be ignored entirely. The script's filter is on STATUS, not
  // on responses.
  const g = await createSeedGroup({ status: "Awaiting Response" });
  try {
    const report = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(report.totals.scanned, 0);
    assert.equal(report.totals.healed, 0);
    assert.equal(await fetchGroupStatus(g.id), "Awaiting Response");
    assert.equal((await fetchHealAudits(g.id)).length, 0);
  } finally {
    await cleanupGroup(g.id);
  }
});

test("heal-stuck-needs-review-inbox: --apply is idempotent (re-run heals zero)", async () => {
  const g = await createSeedGroup({ status: "Needs Review" });
  await seedResponse({ groupId: g.id, responseType: "acknowledgment" });

  try {
    const first = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(first.totals.healed, 1);
    const auditCountAfterFirst = (await fetchHealAudits(g.id)).length;
    const noteCountAfterFirst = (await fetchHealNotes(g.id)).length;
    assert.equal(auditCountAfterFirst, 1);
    assert.equal(noteCountAfterFirst, 1);

    // The group is no longer in {Needs Review, Ready to Review}, so the
    // status-scoped filter must report zero scanned/healed on the second
    // run and write nothing further.
    const second = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(second.totals.scanned, 0);
    assert.equal(second.totals.healed, 0);
    assert.equal((await fetchHealAudits(g.id)).length, auditCountAfterFirst);
    assert.equal((await fetchHealNotes(g.id)).length, noteCountAfterFirst);
  } finally {
    await cleanupGroup(g.id);
  }
});

test("heal-stuck-needs-review-inbox: --group-id scopes to a single group", async () => {
  const targeted = await createSeedGroup({ status: "Needs Review" });
  const bystander = await createSeedGroup({ status: "Needs Review" });

  try {
    const report = await runBackfill({ apply: true, groupId: targeted.id, silent: true });
    assert.equal(report.totals.scanned, 1);
    assert.equal(report.totals.healed, 1);

    assert.equal(await fetchGroupStatus(targeted.id), "Awaiting Response");
    // Bystander stays put — --group-id strictly scopes the run.
    assert.equal(await fetchGroupStatus(bystander.id), "Needs Review");
    assert.equal((await fetchHealAudits(bystander.id)).length, 0);
  } finally {
    await cleanupGroup(targeted.id);
    await cleanupGroup(bystander.id);
  }
});

// ──────────────────────────────────────────────────────────────────────
// Task #346 regression. The original predicate would demote any stuck
// group with no reviewable response — including pre-classification
// groups whose legs had simply never been triaged. Those groups must
// now be left alone so they stay in the Classify section of the Queue
// page. We also want to be sure the existing "stuck after
// acknowledgment" case still gets healed, so Task #299's fix isn't
// regressed.
// ──────────────────────────────────────────────────────────────────────

test("heal-stuck-needs-review-inbox: skips Needs Review groups whose active legs are still unclassified (Task #346 guard)", async () => {
  const g = await createSeedGroup({ status: "Needs Review" });
  // Two active legs, both unclassified. No portal responses. Under
  // the old predicate this group would have been demoted to Awaiting
  // Response and silently disappeared from the Classify inbox.
  await seedClaim({ groupId: g.id, errorTypeId: null, errorDetails: null });
  await seedClaim({ groupId: g.id, errorTypeId: null, errorDetails: null });

  try {
    const report = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(report.totals.scanned, 1);
    assert.equal(report.totals.healed, 0, "guard must prevent the heal");
    assert.equal(report.totals.skippedUnclassifiedLegs, 1);
    assert.equal(report.skippedUnclassifiedLegs[0]?.unclassifiedActiveLegCount, 2);

    // Status unchanged.
    assert.equal(await fetchGroupStatus(g.id), "Needs Review");
    // No audit/note was written.
    assert.equal((await fetchHealAudits(g.id)).length, 0);
    assert.equal((await fetchStatusChangeAudits(g.id)).length, 0);
    assert.equal((await fetchHealNotes(g.id)).length, 0);
  } finally {
    await cleanupGroup(g.id);
  }
});

test("heal-stuck-needs-review-inbox: guard also skips groups whose only active leg is unclassified, even with acknowledgment-only responses on file", async () => {
  // The existing Task #299 case (ack-only response → demote) must
  // NOT fire when the group has unclassified active legs. The new
  // guard runs ahead of the reviewable-response check on purpose.
  const g = await createSeedGroup({ status: "Needs Review" });
  await seedClaim({ groupId: g.id, errorTypeId: null, errorDetails: null });
  await seedResponse({ groupId: g.id, responseType: "acknowledgment" });

  try {
    const report = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(report.totals.healed, 0);
    assert.equal(report.totals.skippedUnclassifiedLegs, 1);
    assert.equal(report.totals.skippedHasReviewable, 0);
    assert.equal(await fetchGroupStatus(g.id), "Needs Review");
  } finally {
    await cleanupGroup(g.id);
  }
});

test("heal-stuck-needs-review-inbox: guard does NOT skip when every active leg has been classified (Task #299 stuck-after-ack case still heals)", async () => {
  // Same shape as the Task #299 case but with a classified leg in
  // place — the guard must NOT trigger here, and the existing heal
  // must still fire so we don't regress the Task #299 fix.
  const g = await createSeedGroup({ status: "Needs Review" });
  await seedClaim({
    groupId: g.id,
    errorTypeId: "billing-mismatch",
    errorDetails: "amount differs",
  });
  await seedResponse({ groupId: g.id, responseType: "acknowledgment" });

  try {
    const report = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(report.totals.skippedUnclassifiedLegs, 0);
    assert.equal(report.totals.healed, 1);
    assert.equal(await fetchGroupStatus(g.id), "Awaiting Response");
    assert.equal((await fetchHealAudits(g.id)).length, 1);
  } finally {
    await cleanupGroup(g.id);
  }
});

test("heal-stuck-needs-review-inbox: guard ignores excluded and duplicate legs (only ACTIVE legs gate the skip)", async () => {
  // An "active" leg is `included_in_dispute=true` AND
  // `duplicate_of_claim_id IS NULL`. Excluded or duplicate legs
  // that happen to also have `error_type_id IS NULL` must NOT keep
  // the heal from running, because they aren't sitting in the
  // Classify inbox waiting on triage anyway.
  const g = await createSeedGroup({ status: "Needs Review" });
  // The "real" active leg has been classified.
  await seedClaim({
    groupId: g.id,
    errorTypeId: "billing-mismatch",
    errorDetails: "amount differs",
  });
  // Excluded leg: still has error_type_id IS NULL — must NOT count.
  await seedClaim({
    groupId: g.id,
    errorTypeId: null,
    errorDetails: null,
    includedInDispute: false,
  });
  // Duplicate leg pointing at the active classified leg above: the
  // FK target id is just a sentinel to make duplicate_of_claim_id
  // non-null. We can't reference the freshly-inserted row's id
  // before the await resolves, but for this test we don't actually
  // need the reference to resolve to a real row — drizzle accepts a
  // valid integer and the heal predicate only checks `IS NOT NULL`.
  // Using the group's first leg id keeps the FK valid.
  const firstLeg = (await db.select({ id: claimsTable.id }).from(claimsTable).where(eq(claimsTable.invoiceGroupId, g.id))).at(0);
  await seedClaim({
    groupId: g.id,
    errorTypeId: null,
    errorDetails: null,
    duplicateOfClaimId: firstLeg?.id ?? null,
  });
  await seedResponse({ groupId: g.id, responseType: "acknowledgment" });

  try {
    const report = await runBackfill({ apply: true, groupId: g.id, silent: true });
    assert.equal(report.totals.skippedUnclassifiedLegs, 0, "excluded/duplicate legs must not gate the guard");
    assert.equal(report.totals.healed, 1);
    assert.equal(await fetchGroupStatus(g.id), "Awaiting Response");
  } finally {
    await cleanupGroup(g.id);
  }
});

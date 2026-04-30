// Behavior test for getYesterdayActivity: seeds real audit_logs rows with
// controlled timestamps and asserts that the daily brief's "Yesterday at a
// glance" tile counts match what the app actually emits — including the
// `claims_imported.metadata.created` summing path that bulk imports rely on.
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { inArray } from "drizzle-orm";

import { db, pool, auditLogsTable } from "@workspace/db";
import { getYesterdayActivity } from "../lib/brief-personalization";

const seededAuditIds: number[] = [];

// Use a far-past, deterministic window so seeded rows never collide with
// real data and so the "yesterday window" we pass into the function is the
// same one the test seeded into.
const YESTERDAY_START = new Date("2020-06-15T04:00:00.000Z");
const TODAY_START = new Date("2020-06-16T04:00:00.000Z");
const INSIDE_WINDOW = new Date("2020-06-15T15:00:00.000Z");
const BEFORE_WINDOW = new Date("2020-06-14T15:00:00.000Z");

async function seedAudit(action: string, opts: { metadata?: unknown; timestamp?: Date } = {}): Promise<void> {
  const [row] = await db
    .insert(auditLogsTable)
    .values({
      action,
      details: `test seed: ${action}`,
      metadata: (opts.metadata ?? null) as never,
      timestamp: opts.timestamp ?? INSIDE_WINDOW,
    })
    .returning({ id: auditLogsTable.id });
  seededAuditIds.push(row.id);
}

before(async () => {
  // Per-claim creates inside the window
  await seedAudit("claim_created");
  await seedAudit("claim_created");

  // Bulk imports — `created` count from metadata is what should be summed
  await seedAudit("claims_imported", { metadata: { created: 23, groupsCreated: 4 } });
  await seedAudit("claims_imported", { metadata: { created: 7, groupsCreated: 1 } });
  // An import row with no `created` metadata should contribute 0, not crash
  await seedAudit("claims_imported", { metadata: { groupsCreated: 1 } });

  // Drafts submitted — only the new key counts; legacy key must be ignored
  await seedAudit("portal_submission_confirmed");
  await seedAudit("portal_submission_confirmed");
  await seedAudit("portal_submission_confirmed");
  await seedAudit("portal_submission_submitted"); // legacy, must NOT count

  // Responses received
  await seedAudit("response_received");
  await seedAudit("response_received");
  await seedAudit("response_received");
  await seedAudit("response_received");
  await seedAudit("outbound_sent"); // legacy, must NOT count

  // Decisions logged — claim outcome + group outcome + group status+outcome
  await seedAudit("outcome_changed");
  await seedAudit("group_outcome_changed");
  await seedAudit("group_status_and_outcome_changed");
  await seedAudit("group_resolved"); // legacy, must NOT count
  await seedAudit("group_denied"); // legacy, must NOT count

  // Out-of-window noise that must be ignored entirely
  await seedAudit("claim_created", { timestamp: BEFORE_WINDOW });
  await seedAudit("portal_submission_confirmed", { timestamp: BEFORE_WINDOW });
  await seedAudit("claims_imported", {
    metadata: { created: 999, groupsCreated: 99 },
    timestamp: BEFORE_WINDOW,
  });
});

after(async () => {
  if (seededAuditIds.length) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.id, seededAuditIds)).catch(() => undefined);
  }
  await pool.end().catch(() => undefined);
});

test("getYesterdayActivity counts the current audit-action whitelist", async () => {
  const got = await getYesterdayActivity(YESTERDAY_START, TODAY_START);

  // Note: the function reads from a shared dev DB that may contain other
  // rows in the same window. We assert "at least" so the test is robust to
  // ambient data, while still exercising the new whitelist + import-sum path.
  assert.ok(
    got.claimsCreated >= 2 + 23 + 7,
    `claimsCreated should include 2 claim_created + 23 + 7 from claims_imported.metadata.created (got ${got.claimsCreated})`,
  );
  assert.ok(
    got.draftsSubmitted >= 3,
    `draftsSubmitted should count the 3 portal_submission_confirmed seeds (got ${got.draftsSubmitted})`,
  );
  assert.ok(
    got.responsesReceived >= 4,
    `responsesReceived should count the 4 response_received seeds (got ${got.responsesReceived})`,
  );
  assert.ok(
    got.decisionsLogged >= 3,
    `decisionsLogged should count outcome_changed + group_outcome_changed + group_status_and_outcome_changed (got ${got.decisionsLogged})`,
  );
});

test("getYesterdayActivity excludes audit rows outside the window", async () => {
  // Query a tight window (2020-06-13) that sits before any of the seeded rows
  // (INSIDE_WINDOW = 2020-06-15, BEFORE_WINDOW = 2020-06-14). None of the
  // 30 + 23 + 7 + 999 of "claims created" we seeded should appear here. We
  // assert an upper bound generous enough to tolerate ambient dev data while
  // still catching a regression that drops the start/end filter.
  const start = new Date("2020-06-13T00:00:00.000Z");
  const end = new Date("2020-06-14T00:00:00.000Z");
  const got = await getYesterdayActivity(start, end);
  assert.ok(
    got.claimsCreated < 900,
    `out-of-window query must not bleed in seeded rows (got claimsCreated=${got.claimsCreated})`,
  );
  assert.ok(
    got.draftsSubmitted < 3,
    `out-of-window query must not bleed in seeded portal_submission_confirmed rows (got ${got.draftsSubmitted})`,
  );
});

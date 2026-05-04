// Integration tests for recheckPreviousRunBounces: briefRunId-keyed
// downgrade and 7-day backstop.

import { test, after } from "node:test";
import { strict as assert } from "node:assert";
import { eq, inArray, and } from "drizzle-orm";

import { recheckPreviousRunBounces } from "../routes/daily-brief";
import {
  db,
  pool,
  outboundEmailsTable,
  cronRunsTable,
  emailBouncesTable,
} from "@workspace/db";

const TEST_BRIEF_RUN_ID = `test-recheck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_RECIPIENTS = [
  `recheck-1-${Date.now()}@test.local`,
  `recheck-2-${Date.now()}@test.local`,
  `recheck-3-${Date.now()}@test.local`,
];
const TEST_SUBJECT = `Recheck-test brief — ${TEST_BRIEF_RUN_ID}`;
const cronRunIds: number[] = [];
const bounceIds: number[] = [];

after(async () => {
  if (cronRunIds.length > 0) {
    await db.delete(cronRunsTable).where(inArray(cronRunsTable.id, cronRunIds));
  }
  if (bounceIds.length > 0) {
    await db.delete(emailBouncesTable).where(inArray(emailBouncesTable.id, bounceIds));
  }
  await db
    .delete(outboundEmailsTable)
    .where(and(
      eq(outboundEmailsTable.kind, "daily_brief"),
      eq(outboundEmailsTable.subject, TEST_SUBJECT),
    ));
  await pool.end().catch(() => undefined);
});

test("recheckPreviousRunBounces: downgrades a prior ok run when bounces exceed the spike threshold via briefRunId match", async () => {
  const startedAt = new Date(Date.now() - 12 * 60 * 1000);
  const [run] = await db
    .insert(cronRunsTable)
    .values({
      jobName: "daily_brief",
      status: "ok",
      message: "Sent 3 personalized briefs.",
      startedAt,
      finishedAt: new Date(startedAt.getTime() + 5_000),
      metadata: { briefRunId: TEST_BRIEF_RUN_ID, sentCount: 3, recipientCount: 3 },
    })
    .returning({ id: cronRunsTable.id });
  cronRunIds.push(run!.id);

  for (const email of TEST_RECIPIENTS) {
    await db.insert(outboundEmailsTable).values({
      kind: "daily_brief",
      subject: TEST_SUBJECT,
      recipients: [email],
      bodyPreview: "test",
      sentAt: new Date(startedAt.getTime() + 1_000),
      messageId: `stub-${email}`,
      errorExcerpt: null,
      metadata: { briefRunId: TEST_BRIEF_RUN_ID, roleVariant: "operator" },
    });
  }

  for (const email of TEST_RECIPIENTS.slice(0, 2)) {
    const [bounce] = await db
      .insert(emailBouncesTable)
      .values({
        recipientEmail: email,
        subject: TEST_SUBJECT,
        receivedAt: new Date(startedAt.getTime() + 3 * 60 * 1000),
        rawExcerpt: "5.1.1 user unknown",
      })
      .returning({ id: emailBouncesTable.id });
    bounceIds.push(bounce!.id);
  }

  const result = await recheckPreviousRunBounces();

  assert.ok(result, "expected recheck to return a result for an eligible prior run");
  assert.equal(result!.runId, run!.id);
  assert.equal(result!.downgrade, "degraded");

  const [refreshed] = await db
    .select({ status: cronRunsTable.status, message: cronRunsTable.message })
    .from(cronRunsTable)
    .where(eq(cronRunsTable.id, run!.id));
  assert.equal(refreshed!.status, "degraded");
  assert.match(refreshed!.message ?? "", /Bounce spike/);
  assert.match(refreshed!.message ?? "", /2 of 3/);
});

test("recheckPreviousRunBounces: 7-day backstop returns null for an ancient ok run (no false-positive)", async () => {
  const ancientRunId = `ancient-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const [run] = await db
    .insert(cronRunsTable)
    .values({
      jobName: "daily_brief",
      status: "ok",
      message: "Sent ancient brief.",
      startedAt: eightDaysAgo,
      finishedAt: new Date(eightDaysAgo.getTime() + 5_000),
      metadata: { briefRunId: ancientRunId },
    })
    .returning({ id: cronRunsTable.id });
  // Drop the prior test's row so the ancient one becomes "most recent"
  // for ORDER BY started_at DESC LIMIT 1.
  if (cronRunIds.length > 0) {
    await db.delete(cronRunsTable).where(inArray(cronRunsTable.id, cronRunIds));
    cronRunIds.length = 0;
  }
  cronRunIds.push(run!.id);

  const result = await recheckPreviousRunBounces();
  const [refreshed] = await db
    .select({ status: cronRunsTable.status })
    .from(cronRunsTable)
    .where(eq(cronRunsTable.id, run!.id));
  assert.equal(refreshed!.status, "ok", "ancient run must remain ok (7-day backstop)");
  if (result) {
    assert.notEqual(result.runId, run!.id, "ancient run must not be the downgraded one");
  }
});

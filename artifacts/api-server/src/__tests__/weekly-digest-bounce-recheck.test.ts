// Integration test: recheckPreviousRunBounces("weekly_digest") must
// downgrade a prior `completed` weekly_digest cron_runs row when the
// bounce-spike thresholds trip. The daily/weekly recheck share one
// implementation parameterized by jobName; this test guards the
// weekly path from regressing.

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

const TEST_BRIEF_RUN_ID = `test-weekly-recheck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_RECIPIENTS = [
  `weekly-recheck-1-${Date.now()}@test.local`,
  `weekly-recheck-2-${Date.now()}@test.local`,
  `weekly-recheck-3-${Date.now()}@test.local`,
];
const TEST_SUBJECT = `Weekly recheck-test digest — ${TEST_BRIEF_RUN_ID}`;
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

test('recheckPreviousRunBounces("weekly_digest"): downgrades a prior completed weekly run when bounces exceed threshold', async () => {
  const startedAt = new Date(Date.now() - 12 * 60 * 1000);
  const [run] = await db
    .insert(cronRunsTable)
    .values({
      jobName: "weekly_digest",
      status: "completed",
      message: "Sent 3 weekly digests.",
      startedAt,
      finishedAt: new Date(startedAt.getTime() + 5_000),
      metadata: { briefRunId: TEST_BRIEF_RUN_ID, sentCount: 3, recipientCount: 3 },
    })
    .returning({ id: cronRunsTable.id });
  cronRunIds.push(run!.id);

  // outbound_emails.kind stays "daily_brief" for both jobs; the
  // metadata.roleVariant=weekly_exec distinguishes them. The recheck
  // joins by briefRunId so this is enough to get matched.
  for (const email of TEST_RECIPIENTS) {
    await db.insert(outboundEmailsTable).values({
      kind: "daily_brief",
      subject: TEST_SUBJECT,
      recipients: [email],
      bodyPreview: "test",
      sentAt: new Date(startedAt.getTime() + 1_000),
      messageId: `stub-weekly-${email}`,
      errorExcerpt: null,
      metadata: { briefRunId: TEST_BRIEF_RUN_ID, roleVariant: "weekly_exec" },
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

  const result = await recheckPreviousRunBounces("weekly_digest");

  assert.ok(result, "expected recheck to return a result for an eligible prior weekly run");
  assert.equal(result!.runId, run!.id);
  assert.equal(result!.downgrade, "degraded");

  const [refreshed] = await db
    .select({ status: cronRunsTable.status, message: cronRunsTable.message })
    .from(cronRunsTable)
    .where(eq(cronRunsTable.id, run!.id));
  assert.equal(refreshed!.status, "failed", "downgrade must persist as failed under cron Option B");
  assert.match(refreshed!.message ?? "", /Bounce spike/);
  assert.match(refreshed!.message ?? "", /2 of 3/);
});

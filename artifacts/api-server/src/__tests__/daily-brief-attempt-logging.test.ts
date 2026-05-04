// Integration tests for recordDailyBriefAttempt: persists one
// outbound_emails row per attempted recipient (success OR failure).

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { eq, inArray, and } from "drizzle-orm";

import {
  recordDailyBriefAttempt,
  __setDailyBriefSendImplForTesting,
} from "../lib/email-send";
import { db, pool, outboundEmailsTable } from "@workspace/db";

const TEST_RUN_ID = `test-brief-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

before(() => {
  // No-op default; individual tests override per case.
  __setDailyBriefSendImplForTesting(null);
});

after(async () => {
  __setDailyBriefSendImplForTesting(null);
  await db
    .delete(outboundEmailsTable)
    .where(and(
      eq(outboundEmailsTable.kind, "daily_brief"),
      inArray(outboundEmailsTable.subject, [
        "Test daily brief — success",
        "Test daily brief — failure",
        "Test daily brief — mixed run",
      ]),
    ));
  await pool.end().catch(() => undefined);
});

test("recordDailyBriefAttempt: success persists row with messageId and null error_excerpt", async () => {
  __setDailyBriefSendImplForTesting(async () => ({
    messageId: "stub-msg-id-123",
    conversationId: "stub-conv-id-456",
  }));

  const result = await recordDailyBriefAttempt({
    recipientEmail: "ops-success@example.test",
    subject: "Test daily brief — success",
    html: "<p>Hello</p>",
    roleVariant: "operator",
    briefRunId: TEST_RUN_ID,
  });

  assert.equal(result.ok, true);
  assert.equal(result.messageId, "stub-msg-id-123");
  assert.equal(result.errorExcerpt, null);

  const [row] = await db
    .select()
    .from(outboundEmailsTable)
    .where(and(
      eq(outboundEmailsTable.subject, "Test daily brief — success"),
      eq(outboundEmailsTable.kind, "daily_brief"),
    ))
    .limit(1);

  assert.ok(row, "expected outbound_emails row for successful daily brief send");
  assert.equal(row.messageId, "stub-msg-id-123");
  assert.equal(row.conversationId, "stub-conv-id-456");
  assert.equal(row.errorExcerpt, null);
  assert.deepEqual(row.recipients, ["ops-success@example.test"]);
  const meta = row.metadata as Record<string, unknown>;
  assert.equal(meta.roleVariant, "operator");
  assert.equal(meta.briefRunId, TEST_RUN_ID);
});

test("recordDailyBriefAttempt: failure still persists a row with error_excerpt and null messageId", async () => {
  __setDailyBriefSendImplForTesting(async () => {
    throw new Error("Outlook returned 503 Service Unavailable");
  });

  const result = await recordDailyBriefAttempt({
    recipientEmail: "ops-failure@example.test",
    subject: "Test daily brief — failure",
    html: "<p>Hello</p>",
    roleVariant: "admin",
    briefRunId: TEST_RUN_ID,
  });

  assert.equal(result.ok, false);
  assert.equal(result.messageId, null);
  assert.match(result.errorExcerpt ?? "", /503 Service Unavailable/);

  const [row] = await db
    .select()
    .from(outboundEmailsTable)
    .where(and(
      eq(outboundEmailsTable.subject, "Test daily brief — failure"),
      eq(outboundEmailsTable.kind, "daily_brief"),
    ))
    .limit(1);

  assert.ok(row, "expected outbound_emails row for FAILED daily brief send");
  assert.equal(row.messageId, null);
  assert.equal(row.conversationId, null);
  assert.match(row.errorExcerpt ?? "", /503 Service Unavailable/);
  const meta = row.metadata as Record<string, unknown>;
  assert.equal(meta.roleVariant, "admin");
  assert.equal(meta.briefRunId, TEST_RUN_ID);
});

test("recordDailyBriefAttempt: a mixed run produces one row per recipient, both success and failure", async () => {
  let callCount = 0;
  __setDailyBriefSendImplForTesting(async () => {
    callCount += 1;
    if (callCount === 2) throw new Error("ECONNRESET on second send");
    return { messageId: `stub-${callCount}`, conversationId: null };
  });

  const recipients = ["a@x.test", "b@x.test", "c@x.test"];
  const subject = "Test daily brief — mixed run";
  for (const r of recipients) {
    await recordDailyBriefAttempt({
      recipientEmail: r,
      subject,
      html: "<p>x</p>",
      roleVariant: "operator",
      briefRunId: TEST_RUN_ID,
    });
  }

  const rows = await db
    .select({
      id: outboundEmailsTable.id,
      recipients: outboundEmailsTable.recipients,
      messageId: outboundEmailsTable.messageId,
      errorExcerpt: outboundEmailsTable.errorExcerpt,
      metadata: outboundEmailsTable.metadata,
    })
    .from(outboundEmailsTable)
    .where(and(
      eq(outboundEmailsTable.subject, subject),
      eq(outboundEmailsTable.kind, "daily_brief"),
    ));

  assert.equal(rows.length, 3, "exactly one row per attempted recipient");
  for (const r of rows) {
    const meta = r.metadata as Record<string, unknown>;
    assert.equal(meta.briefRunId, TEST_RUN_ID);
  }
  const successes = rows.filter((r) => r.errorExcerpt === null);
  const failures = rows.filter((r) => r.errorExcerpt !== null);
  assert.equal(successes.length, 2);
  assert.equal(failures.length, 1);
  assert.match(failures[0]!.errorExcerpt ?? "", /ECONNRESET/);
  assert.equal(failures[0]!.messageId, null);
});

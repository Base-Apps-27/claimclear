import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, and } from "drizzle-orm";

import { recordPortalRouter } from "../routes/response-tracker";
import { requireAuthOrBot } from "../middlewares/requireBotToken";
import { computeIdempotencyKey, IDEMPOTENCY_HEADER, DUPLICATE_IDEMPOTENCY_KEY_CODE } from "../lib/idempotency";
import { scheduleRetryOrFail } from "../lib/submission-retry";
import {
  db,
  pool,
  invoiceGroupsTable,
  portalSubmissionsTable,
  portalResponsesTable,
  auditLogsTable,
  notesTable,
} from "@workspace/db";

// Task #842. Idempotency-key contract for bot-originated mutations.
//
// The bot's only HTTP mutation surface is POST /responses/record-portal.
// Every call must carry an `Idempotency-Key` header derived from
// `(submissionId, action, day-bucket, externalMessageId)`. The server
// persists it on both the new portal_responses row and the matching
// audit_logs row, each protected by a partial unique index.
//
// Asserted here:
//   1. Two POSTs with the same `Idempotency-Key` → first wins (200),
//      second 409 with `code:"duplicate_idempotency_key"`.
//   2. Exactly ONE portal_responses row exists for that key — the
//      partial unique index actually fired, not just an in-memory dedup.
//   3. Two POSTs with DIFFERENT keys → both succeed and produce two
//      distinct rows (the index is correctly scoped to the key column).
//   4. A POST with NO header still works (operator-initiated /
//      legacy-bot path leaves the column null and so is excluded from
//      the partial index).

const TEST_BOT_TOKEN = "test-bot-service-token-842";

let server: http.Server;
let baseUrl: string;

before(async () => {
  process.env.BOT_SERVICE_TOKEN = TEST_BOT_TOKEN;

  const app: Express = express();
  app.use(express.json());
  // No session middleware — bot calls authenticate purely via x-bot-token.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).isAuthenticated = () => false;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", requireAuthOrBot, recordPortalRouter);

  await new Promise<void>((resolveListen, rejectListen) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolveListen();
      } else {
        rejectListen(new Error("Failed to obtain test server port"));
      }
    });
  });
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  await pool.end().catch(() => undefined);
});

async function fetchJson<T = any>(
  path: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<{ status: number; json: T }> {
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((resolveReq, rejectReq) => {
    const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined;
    const headers: Record<string, string> = {};
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body).toString();
    }
    if (init?.headers) Object.assign(headers, init.headers);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: init?.method ?? "GET",
        headers,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          let parsed: any = {};
          if (raw) {
            try { parsed = JSON.parse(raw); }
            catch { parsed = { _raw: raw }; }
          }
          resolveReq({ status: res.statusCode ?? 0, json: parsed as T });
        });
      },
    );
    req.on("error", rejectReq);
    if (body) req.write(body);
    req.end();
  });
}

async function createSeedSubmission(): Promise<{
  groupId: number;
  submissionId: number;
  portalTicketId: string;
}> {
  const invoiceNumber = `T842G-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: "Awaiting Response",
    outcome: "Pending",
    phase: "submitted",
  }).returning();
  const portalTicketId = `T842T-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [sub] = await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: group.id,
    status: "submitted",
    issueType: "other",
    subject: "test",
    descriptionHtml: "<p>test</p>",
    confNumber: `CN-${invoiceNumber}`,
    refNumber: null,
    invoiceNumber: group.invoiceNumber,
    attempts: 1,
    portalTicketId,
    claimedByBatchId: null,
  }).returning();
  return { groupId: group.id, submissionId: sub.id, portalTicketId };
}

async function cleanupGroup(groupId: number): Promise<void> {
  await db.delete(portalResponsesTable).where(eq(portalResponsesTable.invoiceGroupId, groupId)).catch(() => undefined);
  await db.delete(notesTable).where(eq(notesTable.invoiceGroupId, groupId)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, groupId)).catch(() => undefined);
  await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.invoiceGroupId, groupId)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupId)).catch(() => undefined);
}

test("Task #842: same Idempotency-Key twice → first wins (200), second 409 duplicate_idempotency_key, only one portal_responses row exists", async () => {
  const { groupId, submissionId, portalTicketId } = await createSeedSubmission();
  try {
    const key = computeIdempotencyKey({
      entityId: submissionId,
      action: "record_portal_response",
      bucket: "2026-05-23",
      extra: "ext-msg-A",
    });
    const body = {
      submissionId,
      portalTicketId,
      responseType: "other",
      content: "first call",
      externalMessageId: "ext-msg-A",
    };
    const headers = {
      "x-bot-token": TEST_BOT_TOKEN,
      [IDEMPOTENCY_HEADER]: key,
    };

    const first = await fetchJson("/api/responses/record-portal", { method: "POST", body, headers });
    assert.equal(first.status, 200, `first call expected 200, got ${first.status} (${JSON.stringify(first.json)})`);
    assert.ok(first.json.responseId, "first call must return responseId");

    // Retry with the same key — must be 409 + typed code, NOT 200 and
    // NOT 500. The bot wrapper folds this into success-on-retry.
    const second = await fetchJson("/api/responses/record-portal", {
      method: "POST",
      body: { ...body, content: "retry payload — should not be persisted" },
      headers,
    });
    assert.equal(second.status, 409, `second call expected 409, got ${second.status} (${JSON.stringify(second.json)})`);
    assert.equal(
      second.json.code,
      DUPLICATE_IDEMPOTENCY_KEY_CODE,
      `second call must return code:"${DUPLICATE_IDEMPOTENCY_KEY_CODE}", got ${second.json.code}`,
    );

    // Structural assertion: exactly ONE portal_responses row carries
    // the key. The retry's payload ("retry payload — should not be
    // persisted") must NOT appear anywhere.
    const rows = await db.select().from(portalResponsesTable)
      .where(eq(portalResponsesTable.idempotencyKey, key));
    assert.equal(rows.length, 1, `expected exactly 1 portal_responses row for key, got ${rows.length}`);
    assert.equal(rows[0].content, "first call", "the first call's payload must be the one persisted");

    // And the matching audit row exists exactly once.
    const auditRows = await db.select().from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.invoiceGroupId, groupId),
        eq(auditLogsTable.action, "response_received"),
      ));
    assert.equal(auditRows.length, 1, `expected exactly 1 response_received audit row, got ${auditRows.length}`);
    assert.equal(auditRows[0].idempotencyKey, `${key}:audit`, "audit row must carry the :audit-scoped key");
  } finally {
    await cleanupGroup(groupId);
  }
});

test("Task #842: two POSTs with DIFFERENT Idempotency-Keys both succeed (partial index is scoped per-key)", async () => {
  const { groupId, submissionId, portalTicketId } = await createSeedSubmission();
  try {
    const baseBody = {
      submissionId,
      portalTicketId,
      responseType: "other",
      content: "ok",
    };
    const keyA = computeIdempotencyKey({
      entityId: submissionId, action: "record_portal_response", bucket: "2026-05-23", extra: "ext-A",
    });
    const keyB = computeIdempotencyKey({
      entityId: submissionId, action: "record_portal_response", bucket: "2026-05-23", extra: "ext-B",
    });
    assert.notEqual(keyA, keyB, "sanity: distinct extras produce distinct keys");

    const a = await fetchJson("/api/responses/record-portal", {
      method: "POST",
      body: { ...baseBody, externalMessageId: "ext-A" },
      headers: { "x-bot-token": TEST_BOT_TOKEN, [IDEMPOTENCY_HEADER]: keyA },
    });
    const b = await fetchJson("/api/responses/record-portal", {
      method: "POST",
      body: { ...baseBody, externalMessageId: "ext-B" },
      headers: { "x-bot-token": TEST_BOT_TOKEN, [IDEMPOTENCY_HEADER]: keyB },
    });
    assert.equal(a.status, 200, `A expected 200, got ${a.status}`);
    assert.equal(b.status, 200, `B expected 200, got ${b.status}`);

    const rows = await db.select().from(portalResponsesTable)
      .where(eq(portalResponsesTable.submissionId, submissionId));
    assert.equal(rows.length, 2, `expected 2 portal_responses rows for distinct keys, got ${rows.length}`);
  } finally {
    await cleanupGroup(groupId);
  }
});

test("Task #842 (submit path): the partial unique index on portal_submissions.idempotency_key rejects a second insert with the same key", async () => {
  const { groupId, submissionId } = await createSeedSubmission();
  try {
    const key = computeIdempotencyKey({
      entityId: submissionId,
      action: "submit_portal_submission",
      bucket: "2026-05-23",
      extra: "ticket-XYZ",
    });
    // First stamp lands on the existing row.
    await db.update(portalSubmissionsTable)
      .set({ idempotencyKey: key })
      .where(eq(portalSubmissionsTable.id, submissionId));

    // A second row trying to claim the same key must trip the partial
    // unique index — structural proof that two concurrent submit
    // workers can't both record "I submitted this".
    let duplicateThrew = false;
    try {
      await db.insert(portalSubmissionsTable).values({
        invoiceGroupId: groupId,
        status: "submitted",
        issueType: "other",
        subject: "duplicate",
        descriptionHtml: "<p>x</p>",
        confNumber: `DUP-${Date.now()}`,
        refNumber: null,
        invoiceNumber: `DUP-${Date.now()}`,
        attempts: 1,
        portalTicketId: null,
        claimedByBatchId: null,
        idempotencyKey: key,
      });
    } catch (err: any) {
      duplicateThrew = true;
      assert.equal(err.code, "23505", `expected unique-violation 23505, got ${err.code}`);
      assert.ok(
        err.constraint?.endsWith("idempotency_key_uidx"),
        `expected constraint to end with idempotency_key_uidx, got ${err.constraint}`,
      );
    }
    assert.ok(duplicateThrew, "second insert with same key must trip the partial unique index");
  } finally {
    await cleanupGroup(groupId);
  }
});

test("Task #842 (retry path): scheduleRetryOrFail called twice for the same submission/attempt writes exactly one audit row (second call swallowed by the audit idempotency guard)", async () => {
  const { groupId, submissionId } = await createSeedSubmission();
  try {
    // Caller is responsible for bumping `attempts` before calling the
    // helper (per its contract). Set attempts=1 so we exercise the
    // retry_scheduled branch, not retries_exhausted.
    await db.update(portalSubmissionsTable)
      .set({ status: "in_progress", attempts: 1, maxAttempts: 4 })
      .where(eq(portalSubmissionsTable.id, submissionId));

    const first = await scheduleRetryOrFail({
      submissionId,
      errorMessage: "simulated transient failure",
      source: "test:idempotency-key-contract",
      userName: "Test",
    });
    assert.equal(first.outcome, "retry_scheduled");

    // Reset attempts to 1 again to model the "same attempt double-fired"
    // race (e.g. /fail HTTP endpoint AND the in-process catch block
    // both reporting the same attempt's failure). The audit-idempotency
    // guard must collapse the second call to a no-op.
    await db.update(portalSubmissionsTable)
      .set({ status: "in_progress", attempts: 1 })
      .where(eq(portalSubmissionsTable.id, submissionId));

    const second = await scheduleRetryOrFail({
      submissionId,
      errorMessage: "simulated transient failure (re-reported)",
      source: "test:idempotency-key-contract",
      userName: "Test",
    });
    assert.equal(second.outcome, "retry_scheduled");

    const auditRows = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.invoiceGroupId, groupId),
      eq(auditLogsTable.action, "submission_retry_scheduled"),
    ));
    assert.equal(auditRows.length, 1, `expected exactly 1 submission_retry_scheduled audit row, got ${auditRows.length}`);
    assert.ok(
      auditRows[0].idempotencyKey?.startsWith("bot_"),
      "audit row must carry the deterministic idempotency key",
    );
  } finally {
    await cleanupGroup(groupId);
  }
});

test("Task #842: a POST with no Idempotency-Key still succeeds (operator/legacy path leaves the column null and is excluded from the partial index)", async () => {
  const { groupId, submissionId, portalTicketId } = await createSeedSubmission();
  try {
    const body = {
      submissionId,
      portalTicketId,
      responseType: "other",
      content: "no-key",
    };
    // Two no-key calls in a row both succeed — null is excluded from
    // the partial index so they don't collide.
    const first = await fetchJson("/api/responses/record-portal", {
      method: "POST", body, headers: { "x-bot-token": TEST_BOT_TOKEN },
    });
    const second = await fetchJson("/api/responses/record-portal", {
      method: "POST", body, headers: { "x-bot-token": TEST_BOT_TOKEN },
    });
    assert.equal(first.status, 200, `first no-key call expected 200, got ${first.status}`);
    assert.equal(second.status, 200, `second no-key call expected 200, got ${second.status}`);

    const rows = await db.select().from(portalResponsesTable)
      .where(eq(portalResponsesTable.submissionId, submissionId));
    assert.equal(rows.length, 2, `expected 2 no-key portal_responses rows, got ${rows.length}`);
    for (const r of rows) {
      assert.equal(r.idempotencyKey, null, "no-key calls must leave idempotency_key null");
    }
  } finally {
    await cleanupGroup(groupId);
  }
});

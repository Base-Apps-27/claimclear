// Regression for Task #809 — submit-bot retry must NEVER create a
// duplicate MAS portal ticket when the prior attempt already landed one.
// Two guards live in `lib/batch-processor.ts`:
//
//   1. late-failure-with-ticket — `processViaExternalBot` captures
//      `result` from `runBatchWorker`. If a post-success step throws
//      AFTER the bot returned a `ticketId`, we route the row through
//      the task-#805 dedupe insert path (`persistPortalSubmissionSuccess`)
//      and swallow the error so the outer loop never calls
//      `scheduleRetryOrFail`. A `bot_activity_log` row is written with
//      `action: 'retry_suppressed_existing_ticket'` and a
//      `guard=late_failure_with_ticket` marker in `message`.
//
//   2. pre-retry portal-index lookup — before `scheduleRetryOrFail` runs
//      in the outer catch, we read page 1 of the portal ticket list
//      (under `portalBrowserGate`) and adopt any ticket whose subject
//      matches this invoice number. A `bot_activity_log` row is written
//      with `guard=portal_index_lookup`.
//
// Both tests drive a real batch through the /batch-process route, with
// the Playwright bot + the portal-index reader swapped out via the
// `__setBatchWorkerForTests` / `__setPortalIndexReaderForTests` seams.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express } from "express";
import { eq, and, desc } from "drizzle-orm";

import batchJobsRouter from "../routes/batch-jobs";
import {
  __setBatchWorkerForTests,
  __setPortalIndexReaderForTests,
  isWorkerRunInProgress,
  getRetriesSuppressedCount,
} from "../lib/batch-processor";
import {
  db,
  pool,
  portalSubmissionsTable,
  botActivityLogTable,
  claimsTable,
  invoiceGroupsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;

before(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/api", batchJobsRouter);

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
  __setBatchWorkerForTests(null);
  __setPortalIndexReaderForTests(null);
  server.closeAllConnections?.();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  await pool.end().catch(() => undefined);
});

async function fetchJson<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; json: T }> {
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((resolveReq, rejectReq) => {
    const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: init?.method ?? "GET",
        headers: body
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body).toString() }
          : {},
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try {
            resolveReq({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : ({} as T) });
          } catch (e) { rejectReq(e); }
        });
      },
    );
    req.on("error", rejectReq);
    if (body) req.write(body);
    req.end();
  });
}

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 10_000, intervalMs = 25): Promise<void> {
  const start = Date.now();
  while (true) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

interface Seeded {
  groupId: number;
  claimId: number;
  submissionId: number;
  invoiceNumber: string;
}

async function seedRow(opts: {
  invoiceNumber: string;
  confNumber: string;
  priorPortalTicketId?: string | null;
  attempts?: number;
}): Promise<Seeded> {
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: opts.invoiceNumber,
    status: "Portal Queued",
  }).returning({ id: invoiceGroupsTable.id });
  const [claim] = await db.insert(claimsTable).values({
    confNumber: opts.confNumber,
    status: "Portal Queued",
    invoiceGroupId: group.id,
  }).returning({ id: claimsTable.id });
  const [sub] = await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: group.id,
    status: "pending",
    confNumber: opts.confNumber,
    invoiceNumber: opts.invoiceNumber,
    attempts: opts.attempts ?? 1,
    maxAttempts: 4,
    portalTicketId: opts.priorPortalTicketId ?? null,
  }).returning({ id: portalSubmissionsTable.id });
  return { groupId: group.id, claimId: claim.id, submissionId: sub.id, invoiceNumber: opts.invoiceNumber };
}

async function cleanup(s: Seeded): Promise<void> {
  const subs = await db.select({ id: portalSubmissionsTable.id })
    .from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.invoiceGroupId, s.groupId));
  for (const sub of subs) {
    await db.delete(botActivityLogTable)
      .where(eq(botActivityLogTable.submissionId, sub.id)).catch(() => undefined);
  }
  await db.delete(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.invoiceGroupId, s.groupId)).catch(() => undefined);
  await db.delete(claimsTable).where(eq(claimsTable.id, s.claimId)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, s.groupId)).catch(() => undefined);
}

async function runBatchAndWait(submissionId: number): Promise<string> {
  const res = await fetchJson<{ batchId: string }>(
    "/api/portal-submissions/batch-process",
    { method: "POST", body: { submissionIds: [submissionId] } },
  );
  assert.equal(res.status, 200, `expected 200 from /batch-process, got ${res.status}`);
  await waitFor(() => !isWorkerRunInProgress(), 10_000);
  return res.json.batchId;
}

// =========================================================================
// GUARD 1 — late-failure-with-ticket. The stub bot returns a real
// portal ticket id, but reports `ticked: false` on all legs so the
// failedLegs check in `processViaExternalBot` throws AFTER `result`
// has the ticket id. The processor's catch must NOT re-throw to the
// outer loop (which would schedule a retry) and must NOT leave the
// row in 'failed'/'pending'. It must route through the task-#805
// dedupe insert path, mark the row 'submitted' with the returned
// ticket id, and write a `retry_suppressed_existing_ticket` activity
// log with the `guard=late_failure_with_ticket` marker.
// =========================================================================
test("late-failure-with-ticket: post-result throw is routed through dedupe insert path; no retry scheduled", async () => {
  const sinceTs = new Date();

  __setBatchWorkerForTests(async (sub) => {
    return {
      ticketId: "LATE-FAIL-TICKET-1",
      screenshotPath: undefined,
      perLeg: sub.legs.map((l) => ({
        legId: l.id,
        ticked: false,
        error: "simulated mid-flight failure after submit landed",
      })),
    };
  });
  __setPortalIndexReaderForTests(null);

  const seeded = await seedRow({
    invoiceNumber: `T809-LATE-${Date.now()}`,
    confNumber: `T809_LATE_${Date.now()}`,
    priorPortalTicketId: null,
    attempts: 1,
  });

  try {
    await runBatchAndWait(seeded.submissionId);

    const rows = await db.select().from(portalSubmissionsTable)
      .where(eq(portalSubmissionsTable.invoiceGroupId, seeded.groupId));
    assert.equal(rows.length, 1,
      "first-time late-failure-with-ticket recovery must reuse the existing row (no duplicate insert)");

    const row = rows[0];
    assert.equal(row.id, seeded.submissionId);
    assert.equal(row.status, "submitted",
      "late-failure-with-ticket guard MUST drive the row to 'submitted' — leaving it 'pending'/'failed' would let the next sweep create a duplicate MAS ticket");
    assert.equal(row.portalTicketId, "LATE-FAIL-TICKET-1",
      "the ticket id the bot reported BEFORE the throw must land on the row so the scrape cron can pull its response");
    assert.ok(row.nextRetryAt === null,
      "no retry must be scheduled — `scheduleRetryOrFail` would create a duplicate ticket on the next sweep");

    const activity = await db.select().from(botActivityLogTable)
      .where(and(
        eq(botActivityLogTable.submissionId, seeded.submissionId),
        eq(botActivityLogTable.action, "retry_suppressed_existing_ticket"),
      ))
      .orderBy(desc(botActivityLogTable.createdAt));
    assert.equal(activity.length, 1,
      "exactly one retry_suppressed_existing_ticket activity log row must be written");
    assert.match(activity[0].message ?? "", /guard=late_failure_with_ticket/,
      "activity log message must encode the guard name so admins can tell the two suppression paths apart");
    assert.match(activity[0].message ?? "", /LATE-FAIL-TICKET-1/,
      "activity log message must include the adopted ticket id for forensic traceability");

    const suppressed = await getRetriesSuppressedCount(sinceTs);
    assert.ok(suppressed >= 1,
      `getRetriesSuppressedCount(since) must include the guard hit (got ${suppressed})`);
  } finally {
    __setBatchWorkerForTests(null);
    await cleanup(seeded);
  }
});

// =========================================================================
// GUARD 2 — pre-retry portal-index lookup. The stub bot throws WITHOUT
// returning a ticket id (so guard 1 doesn't fire). The stub portal-index
// reader returns one row whose subject matches this invoice number. The
// outer catch in `processSequentially` must adopt that ticket via the
// dedupe insert path and skip `scheduleRetryOrFail`. A
// `retry_suppressed_existing_ticket` activity log row must be written
// with `guard=portal_index_lookup`.
// =========================================================================
test("pre-retry portal-index lookup: adopts an existing matching ticket and skips retry", async () => {
  const sinceTs = new Date();

  __setBatchWorkerForTests(async () => {
    throw new Error("simulated portal submit failure (no ticket id returned)");
  });

  const invoiceNumber = `T809-IDX-${Date.now()}`;
  const adoptedTicketId = "ADOPTED-FROM-INDEX-9";

  __setPortalIndexReaderForTests(async (page, _opts) => ({
    page,
    totalPagesHint: 1,
    empty: false,
    rows: [
      {
        ticketId: adoptedTicketId,
        subject: `Invoice #${invoiceNumber} — GPS Control Deviation`,
        status: "Open",
        lastUpdatedRaw: new Date().toISOString(),
      },
      {
        ticketId: "UNRELATED-1",
        subject: "Invoice #SOMETHING-ELSE",
        status: "Open",
        lastUpdatedRaw: new Date().toISOString(),
      },
    ],
  }));

  const seeded = await seedRow({
    invoiceNumber,
    confNumber: `T809_IDX_${Date.now()}`,
    priorPortalTicketId: null,
    attempts: 1,
  });

  try {
    await runBatchAndWait(seeded.submissionId);

    const rows = await db.select().from(portalSubmissionsTable)
      .where(eq(portalSubmissionsTable.invoiceGroupId, seeded.groupId));
    assert.equal(rows.length, 1,
      "first-time pre-retry adoption must reuse the existing row (no duplicate insert)");

    const row = rows[0];
    assert.equal(row.id, seeded.submissionId);
    assert.equal(row.status, "submitted",
      "the pre-retry portal-index guard MUST drive the row to 'submitted' so no further retries fire");
    assert.equal(row.portalTicketId, adoptedTicketId,
      "the adopted ticket id from the portal index page must land on the row so the scrape cron can pull its response");
    assert.ok(row.nextRetryAt === null,
      "no retry must be scheduled — that's the whole point of the guard");

    const activity = await db.select().from(botActivityLogTable)
      .where(and(
        eq(botActivityLogTable.submissionId, seeded.submissionId),
        eq(botActivityLogTable.action, "retry_suppressed_existing_ticket"),
      ))
      .orderBy(desc(botActivityLogTable.createdAt));
    assert.equal(activity.length, 1,
      "exactly one retry_suppressed_existing_ticket activity log row must be written");
    assert.match(activity[0].message ?? "", /guard=portal_index_lookup/,
      "activity log message must encode the guard name so admins can distinguish from the late-failure guard");
    assert.match(activity[0].message ?? "", new RegExp(adoptedTicketId),
      "activity log message must include the adopted ticket id for forensic traceability");

    const suppressed = await getRetriesSuppressedCount(sinceTs);
    assert.ok(suppressed >= 1,
      `getRetriesSuppressedCount(since) must include the guard hit (got ${suppressed})`);
  } finally {
    __setBatchWorkerForTests(null);
    __setPortalIndexReaderForTests(null);
    await cleanup(seeded);
  }
});

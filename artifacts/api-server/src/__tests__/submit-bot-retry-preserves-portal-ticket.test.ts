// Regression for Task #805 — submit-bot retry must never overwrite the
// portal_ticket_id on an existing portal_submissions row. When the bot
// returns a brand-new portal ticket id on a retry while the row already
// has a different id (left over from a prior portal-side submit whose
// DB write didn't land, or from an operator/sandbox bouncing a row back
// to pending), the processor must INSERT a new portal_submissions row
// for the new ticket and leave the existing row's portal_ticket_id,
// submittedAt, and attempts intact. Otherwise the prior ticket is
// orphaned on MAS and any DENIED reply it carries is lost.
//
// Drives a real batch through the /batch-process route, with the
// Playwright bot swapped out via the __setBatchWorkerForTests seam.
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express } from "express";
import { eq, and, ne } from "drizzle-orm";

import batchJobsRouter from "../routes/batch-jobs";
import {
  __setBatchWorkerForTests,
  isWorkerRunInProgress,
} from "../lib/batch-processor";
import {
  db,
  pool,
  portalSubmissionsTable,
  claimsTable,
  invoiceGroupsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;

// The stub bot returns a per-confNumber ticket id. The test seeds rows
// whose confNumber encodes the ticket id the bot should "produce" on
// this run. That lets a single before() configure the bot for every
// test without per-test re-wiring.
before(async () => {
  __setBatchWorkerForTests(async (sub) => {
    const head = sub.legs[0];
    const conf = head?.confNumber ?? "";
    const m = conf.match(/__TICKET_([A-Za-z0-9-]+)$/);
    const ticketId = m ? m[1] : `STUB-${sub.groupId}`;
    return {
      ticketId,
      screenshotPath: undefined,
      perLeg: sub.legs.map((l) => ({ legId: l.id, ticked: true })),
    };
  });

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
}

async function seedRow(opts: {
  confNumber: string;
  priorPortalTicketId?: string | null;
  priorSubmittedAt?: string | null;
  attempts?: number;
}): Promise<Seeded> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: `T805-${tag}`,
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
    attempts: opts.attempts ?? 1,
    maxAttempts: 4,
    portalTicketId: opts.priorPortalTicketId ?? null,
    submittedAt: opts.priorSubmittedAt ?? null,
  }).returning({ id: portalSubmissionsTable.id });
  return { groupId: group.id, claimId: claim.id, submissionId: sub.id };
}

async function cleanup(s: Seeded): Promise<void> {
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
// THE regression test from the task spec: submit → fail mid-flow → retry
// → second submission lands a new portal ticket id. Two rows must exist
// after the retry, same invoice_group_id, different portal_ticket_ids.
// =========================================================================
test("retry that produces a new portal ticket id inserts a new row and preserves the prior ticket id", async () => {
  // "Submit → fail mid-flow" is simulated by seeding a row whose
  // portal_ticket_id is already set to the prior ticket (TICKET-A) but
  // whose status is back to 'pending' — the exact post-condition of a
  // prior successful portal-side submit whose follow-up bookkeeping
  // (or an operator-driven rerun) bounced the row out of 'submitted'.
  // The stub bot is wired to return TICKET-B on this run.
  const priorSubmittedAt = new Date(Date.now() - 60_000).toISOString();
  const seeded = await seedRow({
    confNumber: `T805_RETRY_NEW_${Date.now()}__TICKET_TICKET-B`,
    priorPortalTicketId: "TICKET-A",
    priorSubmittedAt,
    attempts: 1,
  });

  try {
    await runBatchAndWait(seeded.submissionId);

    const rows = await db.select().from(portalSubmissionsTable)
      .where(eq(portalSubmissionsTable.invoiceGroupId, seeded.groupId));

    assert.equal(rows.length, 2,
      `expected exactly 2 portal_submissions rows for the invoice group after retry, got ${rows.length}`);

    const original = rows.find((r) => r.id === seeded.submissionId);
    const inserted = rows.find((r) => r.id !== seeded.submissionId);
    assert.ok(original, "original seeded row must still exist");
    assert.ok(inserted, "a brand-new row must have been inserted for the new ticket id");

    // The prior row keeps its history: same portal_ticket_id, same
    // submittedAt, same attempts. That is the whole point of the fix.
    assert.equal(original!.portalTicketId, "TICKET-A",
      "original row's portal_ticket_id MUST be preserved (was being overwritten before the fix)");
    assert.equal(original!.submittedAt, priorSubmittedAt,
      "original row's submittedAt must be preserved");
    assert.equal(original!.attempts, 2,
      "original row's attempts counter reflects the retry that was just claimed (1 → 2); it must NOT reset");

    // The new row carries the new ticket id and is ready for the scrape
    // cron to pick it up (last_scraped_at IS NULL).
    assert.equal(inserted!.portalTicketId, "TICKET-B",
      "the inserted row must carry the brand-new portal ticket id");
    assert.equal(inserted!.status, "submitted", "inserted row must be 'submitted'");
    assert.equal(inserted!.attempts, 0,
      "the inserted row is brand-new from the bot's perspective: attempts must be 0");
    assert.equal(inserted!.lastScrapedAt, null,
      "the inserted row must have last_scraped_at = NULL so the scrape cron picks it up");
    assert.equal(inserted!.invoiceGroupId, seeded.groupId,
      "inserted row must belong to the same invoice group");

    // And the two rows DO have different portal_ticket_ids (the
    // single-most-important assertion from the task spec).
    const distinctTickets = await db.select({ id: portalSubmissionsTable.id })
      .from(portalSubmissionsTable)
      .where(and(
        eq(portalSubmissionsTable.invoiceGroupId, seeded.groupId),
        ne(portalSubmissionsTable.portalTicketId, "TICKET-A"),
      ));
    assert.equal(distinctTickets.length, 1,
      "exactly one row on this invoice group must carry a portal_ticket_id other than TICKET-A");
  } finally {
    await cleanup(seeded);
  }
});

// =========================================================================
// First-time submission (no prior portal_ticket_id) must still UPDATE
// the same row, not insert a duplicate. Guards the path-C branch.
// =========================================================================
test("first-time submission updates the existing row in place (no duplicate insert)", async () => {
  const seeded = await seedRow({
    confNumber: `T805_FIRST_${Date.now()}__TICKET_FRESH-1`,
    priorPortalTicketId: null,
    attempts: 0,
  });

  try {
    await runBatchAndWait(seeded.submissionId);

    const rows = await db.select().from(portalSubmissionsTable)
      .where(eq(portalSubmissionsTable.invoiceGroupId, seeded.groupId));
    assert.equal(rows.length, 1, "first-time submission must not duplicate the row");

    const only = rows[0];
    assert.equal(only.id, seeded.submissionId, "the same row id stays put");
    assert.equal(only.status, "submitted");
    assert.equal(only.portalTicketId, "FRESH-1",
      "the ticket id must land on the existing row (no prior id to preserve)");
    assert.ok(only.submittedAt, "submittedAt must be stamped on first-time submission");
  } finally {
    await cleanup(seeded);
  }
});

// =========================================================================
// Idempotent retry: bot returns the SAME ticket id the row already
// carries. Must update in place, never insert. Guards path-C's "same id"
// branch and prevents a regression where any prior id would force insert.
// =========================================================================
test("idempotent retry (bot returns the same prior portal_ticket_id) updates in place, no insert", async () => {
  const priorSubmittedAt = new Date(Date.now() - 30_000).toISOString();
  const seeded = await seedRow({
    confNumber: `T805_IDEM_${Date.now()}__TICKET_SAME-9`,
    priorPortalTicketId: "SAME-9",
    priorSubmittedAt,
    attempts: 2,
  });

  try {
    await runBatchAndWait(seeded.submissionId);

    const rows = await db.select().from(portalSubmissionsTable)
      .where(eq(portalSubmissionsTable.invoiceGroupId, seeded.groupId));
    assert.equal(rows.length, 1,
      "idempotent retry must not insert a duplicate row when the bot reports the same ticket id");

    const only = rows[0];
    assert.equal(only.id, seeded.submissionId);
    assert.equal(only.portalTicketId, "SAME-9",
      "portal_ticket_id stays put (it never changed)");
    assert.equal(only.status, "submitted",
      "row transitions to submitted on the idempotent retry success");
  } finally {
    await cleanup(seeded);
  }
});

// Task #750 — backend tests for POST /invoice-groups/bulk-approve.
//
// Covers:
//   * Mixed eligible / skipped: gate (not_ai, partial_approval, low_confidence)
//   * Idempotent re-run returns `already_queued` skip the second time
//   * Cap > BULK_APPROVE_MAX_ROWS returns 400 code=cap_exceeded
//   * Per-group transaction isolation: a forced failure on one group
//     does not poison the rest of the batch
//   * Empty / missing note returns 400
//
// Harness mirrors closure-data-foundation.test.ts (express + http,
// fetchJson, per-test seed/cleanup).

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, desc, and } from "drizzle-orm";

import invoiceGroupsRouter from "../routes/invoice-groups";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
  notesTable,
  portalResponsesTable,
  portalSubmissionsTable,
  claimVerdictTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;

const TEST_USER = { email: "bulk-tester@example.com", displayName: "Bulk Tester" };

before(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", invoiceGroupsRouter);
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
          } catch (e) {
            rejectReq(e);
          }
        });
      },
    );
    req.on("error", rejectReq);
    if (body) req.write(body);
    req.end();
  });
}

let seq = 0;
function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}-${Math.floor(Math.random() * 1e6)}`;
}

interface SeedOpts {
  classifierSource?: string;
  classifierConfidence?: string | null;
  responseType?: "approval" | "denial" | "partial_approval" | "info_request" | "acknowledgment" | "other";
  legCount?: number;
  legSopOutcome?: "portal_dispute" | "dispute" | "non_issue" | "hold";
  attestationState?: "not_required" | "queued" | "completed";
  includedInDispute?: boolean;
  withErrorType?: boolean;
  activeSubmission?: boolean;
}

interface Seeded {
  groupId: number;
  portalResponseId: number;
  legIds: number[];
}

async function seedGroup(opts: SeedOpts = {}): Promise<Seeded> {
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: uniq("BA"),
    status: "Needs Review",
    outcome: "Pending",
    phase: "response_received",
  }).returning();

  const legCount = opts.legCount ?? 2;
  const legIds: number[] = [];
  for (let i = 0; i < legCount; i++) {
    const [leg] = await db.insert(claimsTable).values({
      confNumber: uniq("BAL"),
      status: "Awaiting Response",
      outcome: "Pending",
      errorTypeId: opts.withErrorType === false ? null : "et-bulk",
      errorTypeName: opts.withErrorType === false ? null : "Bulk Test ET",
      invoiceGroupId: group.id,
      sopOutcome: opts.legSopOutcome ?? "portal_dispute",
      includedInDispute: opts.includedInDispute ?? true,
      attestationState: opts.attestationState ?? "not_required",
      disposition: "awaiting_review",
    }).returning();
    legIds.push(leg.id);
  }

  const [pr] = await db.insert(portalResponsesTable).values({
    invoiceGroupId: group.id,
    source: "email",
    responseType: opts.responseType ?? "approval",
    classifierSource: opts.classifierSource ?? "ai",
    classifierConfidence: opts.classifierConfidence === undefined ? "high" : opts.classifierConfidence,
    subject: "Approved",
    content: "Approved",
    bodyFormat: "text",
  }).returning();

  if (opts.activeSubmission) {
    await db.insert(portalSubmissionsTable).values({
      invoiceGroupId: group.id,
      status: "in_progress",
      submittedAt: new Date().toISOString(),
    });
  }

  return { groupId: group.id, portalResponseId: pr.id, legIds };
}

async function cleanupSeeded(s: Seeded) {
  for (const legId of s.legIds) {
    await db.delete(claimVerdictTable).where(eq(claimVerdictTable.claimId, legId)).catch(() => undefined);
    await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, legId)).catch(() => undefined);
  }
  await db.delete(portalResponsesTable).where(eq(portalResponsesTable.id, s.portalResponseId)).catch(() => undefined);
  await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.invoiceGroupId, s.groupId)).catch(() => undefined);
  await db.delete(notesTable).where(eq(notesTable.invoiceGroupId, s.groupId)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, s.groupId)).catch(() => undefined);
  await db.delete(claimsTable).where(eq(claimsTable.invoiceGroupId, s.groupId)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, s.groupId)).catch(() => undefined);
}

interface BulkApproveBody {
  success: boolean;
  bulkApproveRunId: string;
  approved: number;
  approvedItems: Array<{ portalResponseId: number; id: number; refNumber: string | null; queuedLegCount: number }>;
  skipped: Array<{ portalResponseId: number; id: number | null; reason: string }>;
  failed: Array<{ portalResponseId: number; id: number | null; reason: string }>;
  cap: number;
}

// ---- Mixed eligible / skipped --------------------------------------------

test("bulk-approve: mixed eligible and skipped — gate filters non-AI, partial_approval, low_confidence", async () => {
  const eligible = await seedGroup();
  const notAi = await seedGroup({ classifierSource: "keyword" });
  const partial = await seedGroup({ responseType: "partial_approval" });
  const lowConf = await seedGroup({ classifierConfidence: "medium" });
  const noLegs = await seedGroup({ legSopOutcome: "non_issue" });
  const activeSub = await seedGroup({ activeSubmission: true });

  try {
    const res = await fetchJson<BulkApproveBody>(
      "/api/invoice-groups/bulk-approve",
      {
        method: "POST",
        body: {
          portalResponseIds: [
            eligible.portalResponseId,
            notAi.portalResponseId,
            partial.portalResponseId,
            lowConf.portalResponseId,
            noLegs.portalResponseId,
            activeSub.portalResponseId,
          ],
          note: "Reviewed weekly batch against payor export",
        },
      },
    );
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
    assert.equal(res.json.approved, 1, `only the eligible group should be approved: ${JSON.stringify(res.json)}`);
    assert.equal(res.json.approvedItems[0].id, eligible.groupId);
    assert.equal(res.json.approvedItems[0].queuedLegCount, eligible.legIds.length);
    assert.ok(res.json.bulkApproveRunId.length > 0);
    assert.equal(res.json.cap, 200);

    const reasonByPr = new Map(res.json.skipped.map((s) => [s.portalResponseId, s.reason]));
    assert.equal(reasonByPr.get(notAi.portalResponseId), "not_ai");
    assert.equal(reasonByPr.get(partial.portalResponseId), "partial_approval");
    assert.equal(reasonByPr.get(lowConf.portalResponseId), "low_confidence");
    assert.equal(reasonByPr.get(noLegs.portalResponseId), "no_disputed_legs");
    assert.equal(reasonByPr.get(activeSub.portalResponseId), "active_submission");

    // Eligible group received per-leg verdicts and was queued.
    const verdicts = await db.select().from(claimVerdictTable)
      .where(eq(claimVerdictTable.claimId, eligible.legIds[0]));
    const sources = verdicts.map((v) => v.source).sort();
    assert.deepEqual(
      sources,
      ["operator_confirmed", "operator_draft"].sort(),
      `eligible leg should have draft+confirmed verdicts: ${JSON.stringify(sources)}`,
    );

    // Audit rows on each leg carry the bulkApproveRunId.
    const legAudits = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.claimId, eligible.legIds[0]));
    assert.ok(legAudits.length > 0);
    for (const row of legAudits) {
      assert.equal((row.metadata as any)?.bulkApproveRunId, res.json.bulkApproveRunId);
    }

    // Group queued for re-attestation + processed flag set.
    const [reloadedGroup] = await db.select().from(invoiceGroupsTable)
      .where(eq(invoiceGroupsTable.id, eligible.groupId));
    assert.ok(reloadedGroup.awaitingPayorAgainAt, "expected awaitingPayorAgainAt to be stamped");
    const [reloadedPr] = await db.select().from(portalResponsesTable)
      .where(eq(portalResponsesTable.id, eligible.portalResponseId));
    assert.equal(reloadedPr.processed, true);

    // Tagged note row with [bulk-approve] prefix.
    const noteRows = await db.select().from(notesTable)
      .where(eq(notesTable.invoiceGroupId, eligible.groupId));
    assert.equal(noteRows.length, 1);
    assert.ok(noteRows[0].content.startsWith("[bulk-approve] "));

    // Each queued leg moved to attestationState='queued'.
    const reloadedLegs = await db.select().from(claimsTable)
      .where(eq(claimsTable.invoiceGroupId, eligible.groupId));
    for (const leg of reloadedLegs) {
      assert.equal(leg.attestationState, "queued",
        `expected leg ${leg.id} queued, got ${leg.attestationState}`);
    }
  } finally {
    await cleanupSeeded(eligible);
    await cleanupSeeded(notAi);
    await cleanupSeeded(partial);
    await cleanupSeeded(lowConf);
    await cleanupSeeded(noLegs);
    await cleanupSeeded(activeSub);
  }
});

// ---- Idempotency ---------------------------------------------------------

test("bulk-approve: re-running on the same portal_response returns already_queued skip", async () => {
  const seed = await seedGroup();
  try {
    const first = await fetchJson<BulkApproveBody>(
      "/api/invoice-groups/bulk-approve",
      { method: "POST", body: { portalResponseIds: [seed.portalResponseId], note: "first run" } },
    );
    assert.equal(first.status, 200);
    assert.equal(first.json.approved, 1);

    // Second run — every leg is now queued, so the entire group is a
    // success-shaped skip with reason 'already_queued'.
    const second = await fetchJson<BulkApproveBody>(
      "/api/invoice-groups/bulk-approve",
      { method: "POST", body: { portalResponseIds: [seed.portalResponseId], note: "second run" } },
    );
    assert.equal(second.status, 200);
    assert.equal(second.json.approved, 0);
    assert.equal(second.json.skipped.length, 1);
    assert.equal(second.json.skipped[0].reason, "already_queued");
    // bulkApproveRunId differs across runs.
    assert.notEqual(first.json.bulkApproveRunId, second.json.bulkApproveRunId);

    // Only one tagged note row should exist (second run did nothing).
    const noteRows = await db.select().from(notesTable)
      .where(eq(notesTable.invoiceGroupId, seed.groupId));
    assert.equal(noteRows.length, 1, `expected one note from the first run, got ${noteRows.length}`);
  } finally {
    await cleanupSeeded(seed);
  }
});

// ---- Cap enforcement -----------------------------------------------------

test("bulk-approve: > 200 ids returns 400 with code=cap_exceeded", async () => {
  const ids = Array.from({ length: 201 }, (_, i) => i + 1);
  const res = await fetchJson<{ error: string; code?: string; cap?: number }>(
    "/api/invoice-groups/bulk-approve",
    { method: "POST", body: { portalResponseIds: ids, note: "too many" } },
  );
  assert.equal(res.status, 400);
  assert.equal(res.json.code, "cap_exceeded");
  assert.equal(res.json.cap, 200);
});

// ---- Note required -------------------------------------------------------

test("bulk-approve: missing or empty note returns 400", async () => {
  const seed = await seedGroup();
  try {
    const missing = await fetchJson<{ error: string }>(
      "/api/invoice-groups/bulk-approve",
      { method: "POST", body: { portalResponseIds: [seed.portalResponseId] } },
    );
    assert.equal(missing.status, 400);
    assert.match(missing.json.error, /note/i);

    const empty = await fetchJson<{ error: string }>(
      "/api/invoice-groups/bulk-approve",
      { method: "POST", body: { portalResponseIds: [seed.portalResponseId], note: "   " } },
    );
    assert.equal(empty.status, 400);

    // No verdict / note rows were written for either rejection.
    const verdicts = await db.select().from(claimVerdictTable)
      .where(eq(claimVerdictTable.claimId, seed.legIds[0]));
    assert.equal(verdicts.length, 0);
    const notes = await db.select().from(notesTable)
      .where(eq(notesTable.invoiceGroupId, seed.groupId));
    assert.equal(notes.length, 0);
  } finally {
    await cleanupSeeded(seed);
  }
});

// ---- Empty input ---------------------------------------------------------

test("bulk-approve: empty portalResponseIds array returns 400", async () => {
  const res = await fetchJson<{ error: string }>(
    "/api/invoice-groups/bulk-approve",
    { method: "POST", body: { portalResponseIds: [], note: "n/a" } },
  );
  assert.equal(res.status, 400);
});

// ---- Per-group transaction isolation -------------------------------------
//
// Mix one valid group with a portal_response id that doesn't exist
// (skip with reason='not_found'). The valid group's transaction must
// still commit cleanly — the absent id is reported in `skipped`, not
// in `failed`, and definitely doesn't roll back the good group.

// A forced mid-transaction throw on one group must NOT roll back its
// neighbor. Monkey-patches db.transaction to throw on the second
// invocation (the second group in the batch) and asserts the first
// group still committed and the second landed in `failed[]`.

test("bulk-approve: a forced mid-txn failure on one group does not poison the neighbor", async () => {
  const good = await seedGroup();
  const bad = await seedGroup();
  // The bulk-approve route calls db.transaction once per group for
  // its main write, then post-commit refresh helpers
  // (refreshClaimDenormalizedCache, refreshGroupDerivedFields) call
  // db.transaction internally. Those refresh calls are silently
  // caught by the route, so counting *all* transaction invocations
  // would throw in the wrong place. Use the call-site stack to count
  // only the route's own per-group write txn — and throw on the
  // second one (the bad group).
  const original = (db as any).transaction.bind(db);
  let writeTxnCount = 0;
  (db as any).transaction = async (...args: any[]) => {
    // Inspect the immediate caller frame so we only count the
    // route's own per-group write txn, not the refresh helpers'
    // internal txns (which live in lib/denormalized-cache.ts but
    // still show invoice-groups.ts deeper in the stack).
    const stack = new Error().stack ?? "";
    const callerFrame = stack.split("\n")[2] ?? "";
    const isRouteWrite = /routes\/invoice-groups\.ts/.test(callerFrame);
    if (isRouteWrite) {
      writeTxnCount += 1;
      if (writeTxnCount === 2) throw new Error("forced isolation failure");
    }
    return (original as any)(...args);
  };
  try {
    const res = await fetchJson<BulkApproveBody>(
      "/api/invoice-groups/bulk-approve",
      {
        method: "POST",
        body: {
          portalResponseIds: [good.portalResponseId, bad.portalResponseId],
          note: "forced failure isolation",
        },
      },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.approved, 1, `expected exactly one approval: ${JSON.stringify(res.json)}`);
    assert.equal(res.json.approvedItems[0].id, good.groupId);
    const failed = res.json.failed.find((f) => f.portalResponseId === bad.portalResponseId);
    assert.ok(failed, `bad group should land in failed[]: ${JSON.stringify(res.json)}`);

    // Good group fully committed.
    const goodVerdicts = await db.select().from(claimVerdictTable)
      .where(eq(claimVerdictTable.claimId, good.legIds[0]));
    assert.equal(goodVerdicts.length, 2);

    // Bad group rolled back — no verdicts, no notes.
    const badVerdicts = await db.select().from(claimVerdictTable)
      .where(eq(claimVerdictTable.claimId, bad.legIds[0]));
    assert.equal(badVerdicts.length, 0);
    const badNotes = await db.select().from(notesTable)
      .where(eq(notesTable.invoiceGroupId, bad.groupId));
    assert.equal(badNotes.length, 0);
  } finally {
    (db as any).transaction = original;
    await cleanupSeeded(good);
    await cleanupSeeded(bad);
  }
});

// Server-side preflight returns the eligibility shape without writing.

test("bulk-approve preflight: separate endpoint returns eligibility preview without writing", async () => {
  const eligible = await seedGroup();
  const lowConf = await seedGroup({ classifierConfidence: "medium" });
  try {
    const res = await fetchJson<{
      success: boolean;
      eligible: number;
      eligibleItems: Array<{ portalResponseId: number; groupId: number }>;
      skipped: Array<{ portalResponseId: number; reason: string }>;
      cap: number;
    }>(
      "/api/invoice-groups/bulk-approve/preflight",
      {
        method: "POST",
        body: {
          portalResponseIds: [eligible.portalResponseId, lowConf.portalResponseId],
        },
      },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.eligible, 1);
    assert.equal(res.json.eligibleItems[0].groupId, eligible.groupId);
    assert.equal(res.json.skipped.find((s) => s.portalResponseId === lowConf.portalResponseId)?.reason, "low_confidence");

    // Nothing was written.
    const verdicts = await db.select().from(claimVerdictTable)
      .where(eq(claimVerdictTable.claimId, eligible.legIds[0]));
    assert.equal(verdicts.length, 0);
    const notes = await db.select().from(notesTable)
      .where(eq(notesTable.invoiceGroupId, eligible.groupId));
    assert.equal(notes.length, 0);
  } finally {
    await cleanupSeeded(eligible);
    await cleanupSeeded(lowConf);
  }
});

test("bulk-approve: missing portal_response id is reported as skipped without poisoning the batch", async () => {
  const good = await seedGroup();
  const ghostId = 999_000_000 + Math.floor(Math.random() * 1e6);
  try {
    const res = await fetchJson<BulkApproveBody>(
      "/api/invoice-groups/bulk-approve",
      {
        method: "POST",
        body: {
          portalResponseIds: [ghostId, good.portalResponseId],
          note: "isolation check",
        },
      },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.approved, 1);
    assert.equal(res.json.approvedItems[0].id, good.groupId);
    const ghostSkip = res.json.skipped.find((s) => s.portalResponseId === ghostId);
    assert.ok(ghostSkip, "ghost id should appear in skipped");
    assert.equal(ghostSkip!.reason, "not_found");

    // Good group fully committed despite the ghost neighbor.
    const verdicts = await db.select().from(claimVerdictTable)
      .where(eq(claimVerdictTable.claimId, good.legIds[0]));
    assert.equal(verdicts.length, 2);
  } finally {
    await cleanupSeeded(good);
  }
});

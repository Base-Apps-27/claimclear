// Task #840 — backend tests for the three bulk-eligibility dry-run
// endpoints (the fourth named action, bulk-approve, already has its
// own dry-run/real parity check in bulk-approve.test.ts via the
// /bulk-approve/preflight test).
//
// For each endpoint we seed a mix of eligible and skipped rows, call
// the dry-run, then loop the real endpoint with the same input and
// assert the dry-run eligible count equals the real run's succeeded
// count. The real flow for bulk-exclude and bulk-reclassify is a
// per-leg sequential loop on the frontend (no /bulk endpoint on the
// server), so the test loops the per-leg endpoints the same way.
//
// Harness mirrors bulk-approve.test.ts (express + http, fetchJson).

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";

import invoiceGroupsRouter from "../routes/invoice-groups";
import claimsRouter from "../routes/claims";
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
  errorTypesTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;

const TEST_USER = { email: "bulk-dryrun-tester@example.com", displayName: "Bulk Dry-Run Tester" };

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
  app.use("/api", claimsRouter);
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

// ---- seeders --------------------------------------------------------------

interface SeededGroup {
  groupId: number;
  legIds: number[];
  portalResponseIds: number[];
}

async function deleteSeeded(s: SeededGroup) {
  for (const legId of s.legIds) {
    await db.delete(claimVerdictTable).where(eq(claimVerdictTable.claimId, legId)).catch(() => undefined);
    await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, legId)).catch(() => undefined);
  }
  for (const prId of s.portalResponseIds) {
    await db.delete(portalResponsesTable).where(eq(portalResponsesTable.id, prId)).catch(() => undefined);
  }
  await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.invoiceGroupId, s.groupId)).catch(() => undefined);
  await db.delete(notesTable).where(eq(notesTable.invoiceGroupId, s.groupId)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, s.groupId)).catch(() => undefined);
  await db.delete(claimsTable).where(eq(claimsTable.invoiceGroupId, s.groupId)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, s.groupId)).catch(() => undefined);
}

// Seed a group that bulk-reattest considers eligible: needs at least one
// non-issue hard-survivor leg, no disputable legs, no in-flight
// attestation. We use a single `non_issue` leg so the verdict-source
// dance for approved survivors isn't needed.
async function seedReattestEligibleGroup(opts: { isTourSample?: boolean } = {}): Promise<SeededGroup> {
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: uniq("RA"),
    status: "Needs Review",
    outcome: "Pending",
    phase: "response_received",
    isTourSample: opts.isTourSample ?? false,
  }).returning();
  const [leg] = await db.insert(claimsTable).values({
    confNumber: uniq("RAL"),
    status: "Awaiting Response",
    outcome: "Pending",
    invoiceGroupId: group.id,
    sopOutcome: "non_issue",
    includedInDispute: false,
    attestationState: "not_required",
    disposition: "awaiting_review",
  }).returning();
  return { groupId: group.id, legIds: [leg.id], portalResponseIds: [] };
}

// Seed a group bulk-reattest skips because it still has a disputable leg.
async function seedReattestSkippedGroup(): Promise<SeededGroup> {
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: uniq("RS"),
    status: "Needs Review",
    outcome: "Pending",
    phase: "response_received",
  }).returning();
  const [disputable] = await db.insert(claimsTable).values({
    confNumber: uniq("RSL"),
    status: "Awaiting Response",
    outcome: "Pending",
    invoiceGroupId: group.id,
    sopOutcome: "portal_dispute",
    includedInDispute: true,
    attestationState: "not_required",
    disposition: "awaiting_review",
  }).returning();
  return { groupId: group.id, legIds: [disputable.id], portalResponseIds: [] };
}

// Seed a leg that the bulk-exclude (mark no-issue) endpoint will accept:
// needs_classification sub-status, not a tour sample, blank errorType.
async function seedExcludableLeg(): Promise<SeededGroup> {
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: uniq("XG"),
    status: "New",
    outcome: "Pending",
    phase: "triage",
  }).returning();
  // Leave disposition at the default 'unclassified' + errorTypeId null
  // so deriveLegSubStatus falls through the legacy ladder to
  // "needs_classification".
  const [leg] = await db.insert(claimsTable).values({
    confNumber: uniq("XL"),
    status: "New",
    outcome: "Pending",
    invoiceGroupId: group.id,
    includedInDispute: true,
    attestationState: "not_required",
    errorTypeId: null,
    errorTypeName: null,
  }).returning();
  return { groupId: group.id, legIds: [leg.id], portalResponseIds: [] };
}

// Seed a leg that bulk-exclude will skip with reason='wrong_state' —
// includedInDispute=false → deriveLegSubStatus returns "excluded",
// which is not in the allowed-source list.
async function seedNotExcludableLeg(): Promise<SeededGroup> {
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: uniq("XGW"),
    status: "New",
    outcome: "Pending",
    phase: "triage",
  }).returning();
  const [leg] = await db.insert(claimsTable).values({
    confNumber: uniq("XLW"),
    status: "New",
    outcome: "Pending",
    invoiceGroupId: group.id,
    includedInDispute: false,
    attestationState: "not_required",
  }).returning();
  return { groupId: group.id, legIds: [leg.id], portalResponseIds: [] };
}

// ---- 1) bulk-reattest dry-run vs real -------------------------------------

test("bulk-reattest dry-run vs real: eligible count from dry-run matches queued count from real run", async () => {
  const eligibleA = await seedReattestEligibleGroup();
  const eligibleB = await seedReattestEligibleGroup();
  const disputable = await seedReattestSkippedGroup();
  const ghostId = 999_999_999;

  try {
    const allIds = [
      eligibleA.groupId,
      eligibleB.groupId,
      disputable.groupId,
      ghostId,
    ];
    const dry = await fetchJson<{
      eligible: Array<{ id: number; queuedLegCount: number }>;
      skipped: Array<{ id: number; reason: string }>;
    }>("/api/invoice-groups/bulk-reattest/dry-run", {
      method: "POST",
      body: { groupIds: allIds },
    });
    assert.equal(dry.status, 200);
    assert.equal(dry.json.eligible.length, 2,
      `expected 2 eligible groups: ${JSON.stringify(dry.json)}`);
    const dryEligibleIds = new Set(dry.json.eligible.map((e) => e.id));
    assert.ok(dryEligibleIds.has(eligibleA.groupId));
    assert.ok(dryEligibleIds.has(eligibleB.groupId));
    const skipReasonById = new Map(dry.json.skipped.map((s) => [s.id, s.reason]));
    assert.equal(skipReasonById.get(disputable.groupId), "has_disputable_legs");
    assert.equal(skipReasonById.get(ghostId), "not_found");

    // Dry-run does not write — eligible groups still have
    // attestationState='not_required' on their legs.
    for (const seed of [eligibleA, eligibleB]) {
      const [reloaded] = await db.select().from(claimsTable)
        .where(eq(claimsTable.id, seed.legIds[0]));
      assert.equal(reloaded.attestationState, "not_required",
        "dry-run must not mutate the leg");
    }

    // Now run the real endpoint with the SAME input ids and assert
    // queued count equals dry-run eligible count.
    const real = await fetchJson<{
      success: boolean;
      queued: number;
      queuedItems: Array<{ id: number; queuedLegCount: number }>;
      skipped: Array<{ id: number; reason: string }>;
    }>("/api/invoice-groups/bulk-reattest", {
      method: "POST",
      body: { groupIds: allIds },
    });
    assert.equal(real.status, 200);
    assert.equal(real.json.queued, dry.json.eligible.length,
      `dry-run eligible (${dry.json.eligible.length}) must match real run queued (${real.json.queued})`);
    const realQueuedIds = new Set(real.json.queuedItems.map((q) => q.id));
    for (const id of dryEligibleIds) {
      assert.ok(realQueuedIds.has(id),
        `dry-run eligible id ${id} should appear in real queuedItems`);
    }
  } finally {
    await deleteSeeded(eligibleA);
    await deleteSeeded(eligibleB);
    await deleteSeeded(disputable);
  }
});

test("bulk-reattest dry-run: empty groupIds returns 400", async () => {
  const res = await fetchJson<{ error: string }>(
    "/api/invoice-groups/bulk-reattest/dry-run",
    { method: "POST", body: { groupIds: [] } },
  );
  assert.equal(res.status, 400);
});

// ---- 2) bulk-exclude (mark no-issue) dry-run vs real ----------------------

test("bulk-exclude dry-run vs real: eligible count from dry-run matches succeeded count from per-leg /exclude loop", async () => {
  const okA = await seedExcludableLeg();
  const okB = await seedExcludableLeg();
  const wrong = await seedNotExcludableLeg();
  const ghostId = 999_999_998;

  try {
    const allIds = [okA.legIds[0], okB.legIds[0], wrong.legIds[0], ghostId];
    const dry = await fetchJson<{
      eligible: Array<{ id: number; confNumber: string | null }>;
      skipped: Array<{ id: number; reason: string }>;
    }>("/api/claims/bulk-exclude/dry-run", {
      method: "POST",
      body: { claimIds: allIds },
    });
    assert.equal(dry.status, 200);
    assert.equal(dry.json.eligible.length, 2,
      `expected 2 eligible legs: ${JSON.stringify(dry.json)}`);
    const dryEligibleIds = dry.json.eligible.map((e) => e.id);
    assert.deepEqual(dryEligibleIds.sort(), [okA.legIds[0], okB.legIds[0]].sort());
    const skipReasonById = new Map(dry.json.skipped.map((s) => [s.id, s.reason]));
    assert.equal(skipReasonById.get(wrong.legIds[0]), "wrong_state");
    assert.equal(skipReasonById.get(ghostId), "not_found");

    // Dry-run does not mutate.
    for (const seed of [okA, okB]) {
      const [reloaded] = await db.select().from(claimsTable)
        .where(eq(claimsTable.id, seed.legIds[0]));
      assert.notEqual(reloaded.disposition, "excluded",
        "dry-run must not exclude the leg");
    }

    // Real run: loop the per-leg /exclude endpoint with the same
    // input ids and count succeeded responses (status 200).
    let succeeded = 0;
    for (const id of allIds) {
      const r = await fetchJson(`/api/claims/${id}/exclude`, {
        method: "POST",
        body: { reason: "non_issue", note: "test bulk no-issue parity" },
      });
      if (r.status === 200) succeeded += 1;
    }
    assert.equal(succeeded, dry.json.eligible.length,
      `dry-run eligible (${dry.json.eligible.length}) must match per-leg /exclude succeeded count (${succeeded})`);
  } finally {
    await deleteSeeded(okA);
    await deleteSeeded(okB);
    await deleteSeeded(wrong);
  }
});

test("bulk-exclude dry-run: empty claimIds returns 400", async () => {
  const res = await fetchJson<{ error: string }>(
    "/api/claims/bulk-exclude/dry-run",
    { method: "POST", body: { claimIds: [] } },
  );
  assert.equal(res.status, 400);
});

// ---- 3) bulk-reclassify dry-run vs real -----------------------------------

test("bulk-reclassify dry-run vs real: eligible count from dry-run matches succeeded count from per-leg /classify loop", async () => {
  // Reclassify routable states include needs_classification: legs that
  // have an errorDetails description can be classified directly via
  // /claims/:id/classify, no pre-step needed.
  const okA = await seedExcludableLeg();
  const okB = await seedExcludableLeg();
  const ghostId = 999_999_997;

  try {
    const allIds = [okA.legIds[0], okB.legIds[0], ghostId];
    const dry = await fetchJson<{
      eligible: Array<{ id: number; confNumber: string | null }>;
      skipped: Array<{ id: number; reason: string }>;
    }>("/api/claims/bulk-reclassify/dry-run", {
      method: "POST",
      body: { claimIds: allIds },
    });
    assert.equal(dry.status, 200);
    assert.equal(dry.json.eligible.length, 2,
      `expected 2 eligible legs: ${JSON.stringify(dry.json)}`);
    const skipReasonById = new Map(dry.json.skipped.map((s) => [s.id, s.reason]));
    assert.equal(skipReasonById.get(ghostId), "not_found");

    // Dry-run does not mutate.
    for (const seed of [okA, okB]) {
      const [reloaded] = await db.select().from(claimsTable)
        .where(eq(claimsTable.id, seed.legIds[0]));
      assert.equal(reloaded.errorTypeId, null,
        "dry-run must not classify the leg");
    }

    // Real run: loop /classify with a dummy errorTypeId and count
    // succeeded responses. We use an unknown errorTypeId so we don't
    // depend on seeded error types; /classify accepts the id as a
    // string and writes it through.
    const [seededErrorType] = await db.insert(errorTypesTable).values({
      name: `Bulk-DryRun-Test-${Date.now()}`,
    }).returning();
    let succeeded = 0;
    for (const id of allIds) {
      const r = await fetchJson(`/api/claims/${id}/classify`, {
        method: "POST",
        body: { errorTypeId: String(seededErrorType.id) },
      });
      if (r.status === 200) succeeded += 1;
    }
    await db.delete(errorTypesTable).where(eq(errorTypesTable.id, seededErrorType.id));
    assert.equal(succeeded, dry.json.eligible.length,
      `dry-run eligible (${dry.json.eligible.length}) must match per-leg /classify succeeded count (${succeeded})`);
  } finally {
    await deleteSeeded(okA);
    await deleteSeeded(okB);
  }
});

test("bulk-reclassify dry-run: empty claimIds returns 400", async () => {
  const res = await fetchJson<{ error: string }>(
    "/api/claims/bulk-reclassify/dry-run",
    { method: "POST", body: { claimIds: [] } },
  );
  assert.equal(res.status, 400);
});

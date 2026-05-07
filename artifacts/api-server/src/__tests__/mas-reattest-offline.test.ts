import { phaseForStatus, dispositionForGroup } from "./fixtures/state";
// Task #333 — admin "recorded offline" path on
// POST /invoice-groups/:id/reattest/complete.
//
// Coverage:
//   - 403 when a non-admin actor sets recordedOffline=true.
//   - 400 when offlineNote is missing or shorter than 10 trimmed chars.
//   - 200 when admin + valid note: bypasses the macro-phase check, bypasses
//     the cancel-completeness check, stamps the same completion columns,
//     writes a `mas_reattest_recorded_offline` audit row (NOT
//     `mas_reattest_completed`), emits the same `group.reattest_completed`
//     state event, and graduates Approved verdict legs to attestation
//     pending.
//
// Harness mirrors per-leg-state.test.ts but injects { role } on req.user
// so the requireAdmin-style branch in the route can pass / fail. Each
// test toggles `currentRole` between "admin" and "operator" before
// hitting the endpoint.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, desc } from "drizzle-orm";

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
  claimEvidenceTable,
  claimVerdictTable,
  errorTypesTable,
  stateEventsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;
let currentRole: "admin" | "operator" = "admin";

const TEST_USER = { email: "mas-offline-tester@example.com", displayName: "Offline Re-attest Tester" };

before(async () => {
  const app: Express = express();
  app.use(express.json());

  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved", role: currentRole };
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

async function fetchJson<T = any>(
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

// --- Seeding (mirrors per-leg-state.test.ts) ---------------------------

async function createSeedGroup(opts: { status?: any } = {}): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const invoiceNumber = `T333G-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const status = opts.status ?? "Needs Review";
  const [row] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status,
    outcome: "Pending",
    phase: phaseForStatus(status),
  }).returning();
  return row;
}

async function createSeedClaim(opts: {
  invoiceGroupId?: number | null;
  errorTypeId?: string | null;
  errorTypeName?: string | null;
  status?: any;
  outcome?: any;
  sopOutcome?: string | null;
} = {}): Promise<typeof claimsTable.$inferSelect> {
  const confNumber = `T333-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const invoiceGroupId = opts.invoiceGroupId ?? null;
  const disposition = await dispositionForGroup(invoiceGroupId);
  const [row] = await db.insert(claimsTable).values({
    confNumber,
    status: opts.status ?? "Needs Review",
    outcome: opts.outcome ?? "Pending",
    invoiceGroupId,
    errorTypeId: opts.errorTypeId ?? null,
    errorTypeName: opts.errorTypeName ?? null,
    sopOutcome: opts.sopOutcome ?? null,
    includedInDispute: true,
    claimAmount: "100.00",
    disposition,
  }).returning();
  return row;
}

async function createSeedErrorType(): Promise<typeof errorTypesTable.$inferSelect> {
  const name = `T333-ErrType-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(errorTypesTable).values({
    name,
    description: "test",
    decisionTree: null,
  }).returning();
  return row;
}

async function cleanupClaim(id: number) {
  await db.delete(claimVerdictTable).where(eq(claimVerdictTable.claimId, id)).catch(() => undefined);
  await db.delete(stateEventsTable).where(eq(stateEventsTable.claimId, id)).catch(() => undefined);
  await db.delete(portalResponsesTable).where(eq(portalResponsesTable.claimId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, id)).catch(() => undefined);
  await db.delete(notesTable).where(eq(notesTable.claimId, id)).catch(() => undefined);
  await db.delete(claimEvidenceTable).where(eq(claimEvidenceTable.claimId, id)).catch(() => undefined);
  await db.delete(claimsTable).where(eq(claimsTable.id, id)).catch(() => undefined);
}

async function cleanupGroup(id: number) {
  const children = await db.select({ id: claimsTable.id }).from(claimsTable).where(eq(claimsTable.invoiceGroupId, id));
  for (const c of children) await cleanupClaim(c.id);
  await db.delete(stateEventsTable).where(eq(stateEventsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(claimEvidenceTable).where(eq(claimEvidenceTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)).catch(() => undefined);
}

async function cleanupErrorType(id: number) {
  await db.delete(errorTypesTable).where(eq(errorTypesTable.id, id)).catch(() => undefined);
}

// --- Tests --------------------------------------------------------------

test("POST /invoice-groups/:id/reattest/complete with recordedOffline=true returns 403 for non-admin actor", async () => {
  currentRole = "operator";
  const group = await createSeedGroup({ status: "Needs Review" });
  await db.update(invoiceGroupsTable).set({ reattestRequired: true })
    .where(eq(invoiceGroupsTable.id, group.id));
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/reattest/complete`, {
      method: "POST",
      body: { recordedOffline: true, offlineNote: "Re-attested by phone with payor today." },
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status} (${JSON.stringify(res.json)})`);

    // Nothing should have been stamped.
    const [post] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.equal(post.reattestCompletedAt, null, "non-admin must not stamp completion columns");
    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, group.id));
    assert.ok(!audits.find((a) => a.action === "mas_reattest_recorded_offline"),
      "no audit row should be emitted on 403");
  } finally {
    await cleanupGroup(group.id);
    currentRole = "admin";
  }
});

test("POST /invoice-groups/:id/reattest/complete with recordedOffline=true returns 400 when offlineNote is missing", async () => {
  currentRole = "admin";
  const group = await createSeedGroup({ status: "Needs Review" });
  await db.update(invoiceGroupsTable).set({ reattestRequired: true })
    .where(eq(invoiceGroupsTable.id, group.id));
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/reattest/complete`, {
      method: "POST",
      body: { recordedOffline: true },
    });
    assert.equal(res.status, 400, `expected 400, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.field, "offlineNote");

    const [post] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.equal(post.reattestCompletedAt, null);
  } finally {
    await cleanupGroup(group.id);
  }
});

test("POST /invoice-groups/:id/reattest/complete with recordedOffline=true returns 400 when offlineNote is shorter than 10 trimmed chars", async () => {
  currentRole = "admin";
  const group = await createSeedGroup({ status: "Needs Review" });
  await db.update(invoiceGroupsTable).set({ reattestRequired: true })
    .where(eq(invoiceGroupsTable.id, group.id));
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/reattest/complete`, {
      method: "POST",
      // 9 visible chars, padded with whitespace — must be rejected after trimming.
      body: { recordedOffline: true, offlineNote: "   shortie   " },
    });
    assert.equal(res.status, 400, `expected 400, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.field, "offlineNote");
  } finally {
    await cleanupGroup(group.id);
  }
});

test("POST /invoice-groups/:id/reattest/complete recordedOffline=true bypasses cancel-completeness AND stamps the columns + writes a mas_reattest_recorded_offline audit", async () => {
  currentRole = "admin";
  const errType = await createSeedErrorType();
  const group = await createSeedGroup({ status: "Needs Review" });
  await db.update(invoiceGroupsTable).set({ reattestRequired: true })
    .where(eq(invoiceGroupsTable.id, group.id));
  // Seed a leg with an OUTSTANDING MAS cancel — the standard path
  // would 409 here ("all-cancels-complete"). The override should
  // bypass it.
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: "dispute",
    status: "Needs Review",
  });
  await db.update(claimsTable).set({ masActionRequired: "cancel" })
    .where(eq(claimsTable.id, claim.id));
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/reattest/complete`, {
      method: "POST",
      body: {
        recordedOffline: true,
        offlineNote: "Recorded after MAS phone call on 5/2; paper log filed.",
      },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.ok(res.json.reattestCompletedAt, "completion timestamp must be stamped");
    assert.equal(res.json.reattestCompletedBy, TEST_USER.email);
    assert.equal(
      res.json.reattestNote,
      "Recorded after MAS phone call on 5/2; paper log filed.",
      "reattestNote should be the trimmed offlineNote",
    );

    // Audit row uses the distinct action key.
    const audits = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.invoiceGroupId, group.id))
      .orderBy(desc(auditLogsTable.timestamp));
    const offlineAudit = audits.find((a) => a.action === "mas_reattest_recorded_offline");
    assert.ok(offlineAudit, "expected mas_reattest_recorded_offline audit row");
    const meta = offlineAudit!.metadata as any;
    assert.equal(meta.recordedOffline, true);
    assert.ok(typeof meta.offlineNote === "string" && meta.offlineNote.length >= 10);
    assert.ok(
      !audits.find((a) => a.action === "mas_reattest_completed"),
      "must NOT also write the standard mas_reattest_completed audit",
    );

    // Same SSE event so listeners react identically.
    const events = await db.select().from(stateEventsTable)
      .where(eq(stateEventsTable.invoiceGroupId, group.id));
    assert.ok(
      events.find((e) => e.eventKey === "group.reattest_completed"),
      "expected group.reattest_completed state_events row (same as standard path)",
    );
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("POST /invoice-groups/:id/reattest/complete recordedOffline=true bypasses macro-phase check (group not in mas-action-required phase)", async () => {
  currentRole = "admin";
  // Group does NOT have reattestRequired set, so getGroupMacroPhase
  // returns something other than mas-action-required. The standard path
  // 409s; the override path should succeed.
  const group = await createSeedGroup({ status: "Needs Evidence" });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/reattest/complete`, {
      method: "POST",
      body: {
        recordedOffline: true,
        offlineNote: "Backfilling re-attest from a paper record.",
      },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.ok(res.json.reattestCompletedAt);

    const audits = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.invoiceGroupId, group.id));
    assert.ok(audits.find((a) => a.action === "mas_reattest_recorded_offline"));
  } finally {
    await cleanupGroup(group.id);
  }
});

test("POST /invoice-groups/:id/reattest/complete recordedOffline=true still graduates Approved-verdict legs to attestation pending", async () => {
  currentRole = "admin";
  const errType = await createSeedErrorType();
  const group = await createSeedGroup({ status: "Needs Review" });
  await db.update(invoiceGroupsTable).set({ reattestRequired: true })
    .where(eq(invoiceGroupsTable.id, group.id));
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: "dispute",
    status: "Needs Review",
    outcome: "Approved",
  });
  await db.insert(claimVerdictTable).values({
    claimId: claim.id,
    source: "operator_confirmed",
    outcome: "Approved",
    createdBy: TEST_USER.email,
  });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/reattest/complete`, {
      method: "POST",
      body: {
        recordedOffline: true,
        offlineNote: "Confirmed completion in MAS by hand earlier today.",
      },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);

    const [post] = await db.select().from(claimsTable).where(eq(claimsTable.id, claim.id));
    assert.equal(
      post.attestationState,
      "pending",
      "Approved verdict legs must graduate to attestation=pending on the offline path too",
    );
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("POST /invoice-groups/:id/reattest/complete WITHOUT recordedOffline still enforces the standard preconditions for non-admin actors", async () => {
  // Sanity-check that the standard 409 path is unaffected by the new
  // branch: non-admin, no recordedOffline flag, group not in
  // mas-action-required phase → 409.
  currentRole = "operator";
  const group = await createSeedGroup({ status: "Needs Evidence" });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/reattest/complete`, {
      method: "POST", body: {},
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.expectedState, "mas-action-required");
  } finally {
    await cleanupGroup(group.id);
    currentRole = "admin";
  }
});

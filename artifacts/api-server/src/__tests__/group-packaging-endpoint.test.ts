// Integration tests for POST /invoice-groups/:id/package introduced in
// Task #231. Spins up the real Express router against the live database
// (mirrors the harness in per-leg-state.test.ts and submit-flow-gates.test.ts).
//
// Coverage:
//   • 404 for unknown id
//   • 409 + reason when readiness gates fail (unprocessed leg, no
//     contestable leg, wrong group status)
//   • 200 happy path: group flips to Generating Email, audit log
//     captures the operator action, response includes the refreshed
//     readiness payload
//   • GET /invoice-groups/:id surfaces packagingReadiness on the
//     pre-submit detail response (the field the CTA binds to)

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, and, desc } from "drizzle-orm";

import invoiceGroupsRouter from "../routes/invoice-groups";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
  notesTable,
  portalSubmissionsTable,
  portalResponsesTable,
  claimEvidenceTable,
  claimVerdictTable,
  stateEventsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;

const TEST_USER = { email: "package-tester@example.com", displayName: "Package Tester" };

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

// --- Seeding ------------------------------------------------------------

async function createGroup(opts: { status?: any } = {}) {
  const invoiceNumber = `T231G-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: opts.status ?? "Needs Evidence",
    outcome: "Pending",
  }).returning();
  return row;
}

async function createLeg(opts: {
  invoiceGroupId: number;
  sopOutcome?: string | null;
  holdReason?: string | null;
  status?: any;
}) {
  const confNumber = `T231-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(claimsTable).values({
    confNumber,
    status: opts.status ?? "Needs Evidence",
    outcome: "Pending",
    invoiceGroupId: opts.invoiceGroupId,
    sopOutcome: opts.sopOutcome ?? null,
    holdReason: opts.holdReason ?? null,
    includedInDispute: true,
    claimAmount: "100.00",
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

// --- Tests --------------------------------------------------------------

test("POST /package returns 404 for unknown id", async () => {
  const res = await fetchJson("/api/invoice-groups/9999999/package", { method: "POST" });
  assert.equal(res.status, 404);
  assert.match(res.json.error, /not found/i);
});

test("POST /package returns 409 + reason when a leg is unprocessed", async () => {
  const grp = await createGroup({ status: "Needs Evidence" });
  const a = await createLeg({ invoiceGroupId: grp.id, sopOutcome: "portal_dispute" });
  const b = await createLeg({ invoiceGroupId: grp.id, sopOutcome: null });
  try {
    const res = await fetchJson(`/api/invoice-groups/${grp.id}/package`, { method: "POST" });
    assert.equal(res.status, 409, JSON.stringify(res.json));
    assert.match(res.json.error, /worktree review/i);
    // Server returns the readiness payload alongside the error so the
    // client can refresh the disabled-CTA tooltip without a separate fetch.
    assert.equal(res.json.packagingReadiness.ready, false);
    assert.equal(res.json.packagingReadiness.unprocessedLegCount, 1);
    assert.equal(res.json.packagingReadiness.processedLegCount, 1);
    // Group must remain unchanged after a failed packaging attempt.
    const [post] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, grp.id));
    assert.equal(post.status, "Needs Evidence");
  } finally {
    await cleanupClaim(a.id);
    await cleanupClaim(b.id);
    await cleanupGroup(grp.id);
  }
});

test("POST /package returns 409 when no leg is contestable", async () => {
  const grp = await createGroup({ status: "Needs Evidence" });
  const a = await createLeg({ invoiceGroupId: grp.id, sopOutcome: "cannot_dispute" });
  const b = await createLeg({ invoiceGroupId: grp.id, sopOutcome: "non_issue" });
  try {
    const res = await fetchJson(`/api/invoice-groups/${grp.id}/package`, { method: "POST" });
    assert.equal(res.status, 409);
    assert.match(res.json.error, /contestable/i);
  } finally {
    await cleanupClaim(a.id);
    await cleanupClaim(b.id);
    await cleanupGroup(grp.id);
  }
});

test("POST /package returns 409 when group is already past pre-submit", async () => {
  const grp = await createGroup({ status: "Generating Email" });
  const a = await createLeg({ invoiceGroupId: grp.id, sopOutcome: "portal_dispute" });
  try {
    const res = await fetchJson(`/api/invoice-groups/${grp.id}/package`, { method: "POST" });
    assert.equal(res.status, 409);
    assert.match(res.json.error, /pre-submit/i);
  } finally {
    await cleanupClaim(a.id);
    await cleanupGroup(grp.id);
  }
});

test("POST /package: happy path flips to Generating Email and writes audit log", async () => {
  const grp = await createGroup({ status: "Needs Evidence" });
  const a = await createLeg({ invoiceGroupId: grp.id, sopOutcome: "portal_dispute" });
  const b = await createLeg({ invoiceGroupId: grp.id, sopOutcome: "cannot_dispute" });
  // Held leg deliberately mixed in to lock down the spec invariant
  // that held legs do NOT block packaging.
  const c = await createLeg({ invoiceGroupId: grp.id, holdReason: "ask_payor" });
  try {
    const res = await fetchJson(`/api/invoice-groups/${grp.id}/package`, { method: "POST" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.status, "Generating Email");
    // Refreshed readiness in the same response — must reflect the new
    // group status (no longer pre-submit, so ready=false now).
    assert.ok(res.json.packagingReadiness, "response should include packagingReadiness");
    assert.equal(res.json.packagingReadiness.ready, false);

    // DB side effects: group status flipped, audit row recorded with
    // the operator_packaged source.
    const [postGroup] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, grp.id));
    assert.equal(postGroup.status, "Generating Email");

    const [audit] = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.invoiceGroupId, grp.id))
      .orderBy(desc(auditLogsTable.timestamp))
      .limit(1);
    assert.ok(audit, "expected an audit_logs entry for the packaging action");
    // The action / metadata contract is fixed by transitionGroupStatus;
    // we just lock in that something was recorded for this group and
    // attributed to the test operator.
    assert.equal(audit.userEmail, TEST_USER.email);
  } finally {
    await cleanupClaim(a.id);
    await cleanupClaim(b.id);
    await cleanupClaim(c.id);
    await cleanupGroup(grp.id);
  }
});

test("GET /invoice-groups/:id surfaces packagingReadiness on a pre-submit group", async () => {
  // The CTA binds to this field — if it disappears, the button never
  // renders. This test pins the contract.
  const grp = await createGroup({ status: "Needs Evidence" });
  const a = await createLeg({ invoiceGroupId: grp.id, sopOutcome: "portal_dispute" });
  const b = await createLeg({ invoiceGroupId: grp.id, sopOutcome: null });
  try {
    const res = await fetchJson(`/api/invoice-groups/${grp.id}`);
    assert.equal(res.status, 200);
    assert.ok(res.json.packagingReadiness, "GET response should include packagingReadiness");
    assert.equal(res.json.packagingReadiness.ready, false);
    assert.equal(res.json.packagingReadiness.unprocessedLegCount, 1);
    assert.equal(res.json.packagingReadiness.processedLegCount, 1);
    assert.equal(res.json.packagingReadiness.totalLegCount, 2);
  } finally {
    await cleanupClaim(a.id);
    await cleanupClaim(b.id);
    await cleanupGroup(grp.id);
  }
});

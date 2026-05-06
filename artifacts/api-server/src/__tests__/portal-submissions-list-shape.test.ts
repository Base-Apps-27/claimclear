// Task #485: the Portal Submissions list now returns one row per invoice
// group (not one row per leg), with a per-leg breakdown surfaced via the
// `legs` JSONB column. This integration test mounts the router in-process,
// seeds two distinct portal_submissions rows for two distinct invoice
// groups (each with multiple legs in JSONB), and asserts:
//   1. GET /api/portal-submissions returns exactly one entry per row,
//   2. each entry surfaces its `legs[]` array unchanged from JSONB,
//   3. legs preserve their input order so the drawer can render them in the
//      same order the operator approved at draft time.
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, inArray } from "drizzle-orm";

import portalSubmissionsRouter from "../routes/portal-submissions";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  portalSubmissionsTable,
} from "@workspace/db";

interface SubmissionLeg {
  legId: number;
  confNumber: string | null;
  ticked: boolean;
  error?: string | null;
}

interface SubmissionRow {
  id: number;
  invoiceGroupId: number;
  status: string;
  legs: SubmissionLeg[];
}

const TEST_USER = { email: "list-shape-tester@example.com", displayName: "List Shape Tester" };

let server: http.Server;
let baseUrl: string;
const createdGroupIds: number[] = [];
const createdSubmissionIds: number[] = [];

before(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", portalSubmissionsRouter);

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
  if (createdSubmissionIds.length > 0) {
    await db.delete(portalSubmissionsTable).where(inArray(portalSubmissionsTable.id, createdSubmissionIds));
  }
  if (createdGroupIds.length > 0) {
    await db.delete(claimsTable).where(inArray(claimsTable.invoiceGroupId, createdGroupIds));
    await db.delete(invoiceGroupsTable).where(inArray(invoiceGroupsTable.id, createdGroupIds));
  }
  server.closeAllConnections?.();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  await pool.end().catch(() => undefined);
});

async function fetchJson<T = unknown>(path: string): Promise<{ status: number; json: T }> {
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((resolveReq, rejectReq) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: "GET" },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try {
            resolveReq({ status: res.statusCode ?? 0, json: JSON.parse(raw) as T });
          } catch (e) {
            rejectReq(e);
          }
        });
      },
    );
    req.on("error", rejectReq);
    req.end();
  });
}

test("GET /portal-submissions returns one entry per row with `legs[]` populated from JSONB", async () => {
  // Seed two invoice groups, each with two claims; then create one
  // portal_submissions row per group (NOT per leg) with a `legs` JSONB
  // array that mirrors the per-leg breakdown.
  const tag = `list-shape-${Date.now()}`;

  const [groupA] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: `${tag}-A`,
    status: "Portal Queued",
  }).returning();
  const [groupB] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: `${tag}-B`,
    status: "Portal Queued",
  }).returning();
  createdGroupIds.push(groupA.id, groupB.id);

  const claimsA = await db.insert(claimsTable).values([
    { invoiceGroupId: groupA.id, confNumber: `${tag}-A1`, date: "2025-01-01", clientNumber: "C", status: "Portal Queued" },
    { invoiceGroupId: groupA.id, confNumber: `${tag}-A2`, date: "2025-01-02", clientNumber: "C", status: "Portal Queued" },
  ]).returning();
  const claimsB = await db.insert(claimsTable).values([
    { invoiceGroupId: groupB.id, confNumber: `${tag}-B1`, date: "2025-01-03", clientNumber: "C", status: "Portal Queued" },
    { invoiceGroupId: groupB.id, confNumber: `${tag}-B2`, date: "2025-01-04", clientNumber: "C", status: "Portal Queued" },
    { invoiceGroupId: groupB.id, confNumber: `${tag}-B3`, date: "2025-01-05", clientNumber: "C", status: "Portal Queued" },
  ]).returning();

  const [subA] = await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: groupA.id,
    status: "draft",
    invoiceNumber: groupA.invoiceNumber,
    confNumber: claimsA.map((c) => c.confNumber).join(", "),
    legs: claimsA.map((c) => ({ legId: c.id, confNumber: c.confNumber, ticked: false })),
  }).returning();
  const [subB] = await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: groupB.id,
    status: "submitted",
    invoiceNumber: groupB.invoiceNumber,
    confNumber: claimsB.map((c) => c.confNumber).join(", "),
    legs: claimsB.map((c, i) => ({
      legId: c.id,
      confNumber: c.confNumber,
      // Mix of outcomes so the test catches a producer that flattens the
      // array or drops the per-leg `error` field.
      ticked: i !== 1,
      error: i === 1 ? "tickbox not found" : null,
    })),
  }).returning();
  createdSubmissionIds.push(subA.id, subB.id);

  const { status, json } = await fetchJson<SubmissionRow[]>("/api/portal-submissions");
  assert.equal(status, 200);

  const rowA = json.find((r) => r.id === subA.id);
  const rowB = json.find((r) => r.id === subB.id);
  assert.ok(rowA, "row for group A is present");
  assert.ok(rowB, "row for group B is present");

  // One row per group, NOT one row per leg.
  const rowsForA = json.filter((r) => r.invoiceGroupId === groupA.id);
  const rowsForB = json.filter((r) => r.invoiceGroupId === groupB.id);
  assert.equal(rowsForA.length, 1, "exactly one entry per invoice group A");
  assert.equal(rowsForB.length, 1, "exactly one entry per invoice group B");

  // Per-leg breakdown is surfaced unchanged from JSONB, in input order.
  assert.equal(rowA.legs.length, 2);
  assert.deepEqual(rowA.legs.map((l) => l.legId), claimsA.map((c) => c.id));
  assert.ok(rowA.legs.every((l) => l.ticked === false));

  assert.equal(rowB.legs.length, 3);
  assert.deepEqual(rowB.legs.map((l) => l.legId), claimsB.map((c) => c.id));
  assert.deepEqual(rowB.legs.map((l) => l.ticked), [true, false, true]);
  assert.equal(rowB.legs[1].error, "tickbox not found");
});

test("GET /portal-submissions enriches legacy rows (legs=[]) with per-leg breakdown from the invoice group's claims", async () => {
  // Simulate a pre-Task-#485 row: a portal_submissions row whose `legs`
  // column is the migration's default empty array, attached to an invoice
  // group that has multiple claims. The list endpoint must synthesize a
  // per-leg breakdown so the new UI renders consistently across history.
  const tag = `legacy-shape-${Date.now()}`;

  const [groupL] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: `${tag}-L`,
    status: "Portal Queued",
  }).returning();
  createdGroupIds.push(groupL.id);

  const claimsL = await db.insert(claimsTable).values([
    { invoiceGroupId: groupL.id, confNumber: `${tag}-L1`, date: "2025-02-01", clientNumber: "C", status: "Portal Queued" },
    { invoiceGroupId: groupL.id, confNumber: `${tag}-L2`, date: "2025-02-02", clientNumber: "C", status: "Portal Queued" },
  ]).returning();

  const [subL] = await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: groupL.id,
    status: "submitted",
    invoiceNumber: groupL.invoiceNumber,
    // Note: NO `legs` field — relies on the column default of [] to mimic
    // a row that was inserted before the JSONB column existed.
  }).returning();
  createdSubmissionIds.push(subL.id);

  // List endpoint enriches legacy rows.
  const list = await fetchJson<SubmissionRow[]>("/api/portal-submissions");
  assert.equal(list.status, 200);
  const listRow = list.json.find((r) => r.id === subL.id);
  assert.ok(listRow, "legacy row appears in the list");
  assert.equal(listRow.legs.length, 2, "list endpoint enriches legacy legs from claims");
  assert.deepEqual(listRow.legs.map((l) => l.legId), claimsL.map((c) => c.id));
  assert.deepEqual(listRow.legs.map((l) => l.confNumber), claimsL.map((c) => c.confNumber));
  assert.ok(listRow.legs.every((l) => l.ticked === false));

  // Detail endpoint enriches the same way.
  const detail = await fetchJson<SubmissionRow>(`/api/portal-submissions/${subL.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.legs.length, 2);
  assert.deepEqual(detail.json.legs.map((l) => l.legId), claimsL.map((c) => c.id));
});

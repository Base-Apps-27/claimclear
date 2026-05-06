// POST /invoice-groups — manual create + 409 conflict + attach-to-existing.
//
// Mirrors the harness pattern from group-invoice-rename-rollback.test.ts:
// boots a real Express app with the production router, stubs req.user
// with an admin, and hits the live DB. Each test uses a tag-prefixed
// invoice number with a timestamp so reruns don't collide.
//
// Coverage:
//   - 201 happy path: group inserted, legs inserted, audit row written,
//     `Needs Review` status, leg `includedInDispute=false`.
//   - 400 validation: missing invoiceNumber and missing legs both reject.
//   - 409 conflict: second create with same invoiceNumber is blocked
//     and returns the existing group summary.
//   - 201 attach-to-existing: passing `attachToExistingId` skips the
//     create, appends legs, and refreshes rideCount/totalAmount.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";

import invoiceGroupsRouter from "../routes/invoice-groups";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;

const TEST_USER = { email: "manual-create-tester@example.com", displayName: "Manual Create Tester" };

before(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved", role: "admin" };
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

function uniqueInvoiceNumber(tag: string): string {
  return `MANUAL-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

test("POST /invoice-groups happy path — creates group + legs + audit row", async () => {
  const invoiceNumber = uniqueInvoiceNumber("happy");
  const conf1 = `${invoiceNumber}-A`;
  const conf2 = `${invoiceNumber}-B`;

  const res = await fetchJson<any>("/api/invoice-groups", {
    method: "POST",
    body: {
      invoiceNumber,
      payorEmail: "billing@example.com",
      legs: [
        { confNumber: conf1, date: "2025-09-15", claimAmount: "12.34", clientNumber: "MEM-1" },
        { confNumber: conf2, date: "2025-09-16", claimAmount: "7.66", refNumber: "R-99" },
      ],
    },
  });

  try {
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.json)}`);
    assert.equal(res.json.attachedToExisting, false);
    assert.equal(res.json.createdLegIds.length, 2);

    const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, res.json.group.id));
    assert.equal(group.invoiceNumber, invoiceNumber);
    assert.equal(group.status, "Needs Review");
    assert.equal(group.rideCount, 2);
    // Group-level clientNumber inherited from first leg's clientNumber
    // since the body didn't set one.
    assert.equal(group.clientNumber, "MEM-1");

    const legs = await db.select().from(claimsTable).where(eq(claimsTable.invoiceGroupId, group.id));
    assert.equal(legs.length, 2);
    for (const l of legs) {
      assert.equal(l.includedInDispute, false, "manual legs start out of dispute (no error type)");
      assert.equal(l.invoiceNumbers, invoiceNumber);
      assert.equal(l.payorEmail, "billing@example.com");
    }

    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, group.id));
    assert.ok(audits.some(a => a.action === "invoice_group_created"), "expected invoice_group_created audit row");
  } finally {
    await db.delete(claimsTable).where(eq(claimsTable.invoiceNumbers, invoiceNumber));
    await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, res.json.group.id));
    await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, res.json.group.id));
  }
});

test("POST /invoice-groups validation — missing invoiceNumber", async () => {
  const res = await fetchJson<any>("/api/invoice-groups", {
    method: "POST",
    body: { legs: [{ confNumber: "X" }] },
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /invoiceNumber/);
});

test("POST /invoice-groups validation — empty legs array", async () => {
  const res = await fetchJson<any>("/api/invoice-groups", {
    method: "POST",
    body: { invoiceNumber: uniqueInvoiceNumber("noleg"), legs: [] },
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /leg/i);
});

test("POST /invoice-groups validation — duplicate confNumber in submission", async () => {
  const res = await fetchJson<any>("/api/invoice-groups", {
    method: "POST",
    body: {
      invoiceNumber: uniqueInvoiceNumber("dupconf"),
      legs: [{ confNumber: "DUP-1" }, { confNumber: "DUP-1" }],
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /Duplicate/);
});

test("POST /invoice-groups conflict — second create on same invoiceNumber returns 409", async () => {
  const invoiceNumber = uniqueInvoiceNumber("conflict");
  const first = await fetchJson<any>("/api/invoice-groups", {
    method: "POST",
    body: { invoiceNumber, legs: [{ confNumber: `${invoiceNumber}-A`, claimAmount: "10" }] },
  });
  assert.equal(first.status, 201);
  const groupId = first.json.group.id;

  try {
    const second = await fetchJson<any>("/api/invoice-groups", {
      method: "POST",
      body: { invoiceNumber, legs: [{ confNumber: `${invoiceNumber}-B` }] },
    });
    assert.equal(second.status, 409);
    assert.equal(second.json.existingGroup.id, groupId);
    assert.equal(second.json.existingGroup.invoiceNumber, invoiceNumber);
    assert.equal(second.json.existingGroup.rideCount, 1);
  } finally {
    await db.delete(claimsTable).where(eq(claimsTable.invoiceNumbers, invoiceNumber));
    await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, groupId));
    await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupId));
  }
});

test("POST /invoice-groups attachToExistingId — appends legs to existing group", async () => {
  const invoiceNumber = uniqueInvoiceNumber("attach");
  const first = await fetchJson<any>("/api/invoice-groups", {
    method: "POST",
    body: { invoiceNumber, legs: [{ confNumber: `${invoiceNumber}-A`, claimAmount: "10" }] },
  });
  assert.equal(first.status, 201);
  const groupId = first.json.group.id;

  try {
    const attach = await fetchJson<any>("/api/invoice-groups", {
      method: "POST",
      body: {
        invoiceNumber,
        attachToExistingId: groupId,
        legs: [
          { confNumber: `${invoiceNumber}-B`, claimAmount: "5" },
          { confNumber: `${invoiceNumber}-C`, claimAmount: "2.5" },
        ],
      },
    });
    assert.equal(attach.status, 201, `expected 201, got ${attach.status}: ${JSON.stringify(attach.json)}`);
    assert.equal(attach.json.attachedToExisting, true);
    assert.equal(attach.json.createdLegIds.length, 2);

    const [refreshed] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupId));
    assert.equal(refreshed.rideCount, 3, "rideCount should be recalculated after attach");
    assert.equal(parseFloat(refreshed.totalAmount ?? "0"), 17.5, "totalAmount should reflect all legs");

    const legs = await db.select().from(claimsTable).where(eq(claimsTable.invoiceGroupId, groupId));
    assert.equal(legs.length, 3);

    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, groupId));
    assert.ok(audits.some(a => a.action === "invoice_group_legs_added"), "expected invoice_group_legs_added audit row");
  } finally {
    await db.delete(claimsTable).where(eq(claimsTable.invoiceNumbers, invoiceNumber));
    await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, groupId));
    await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupId));
  }
});

test("POST /invoice-groups attachToExistingId — wrong invoiceNumber rejected", async () => {
  const realInvoice = uniqueInvoiceNumber("guard-real");
  const first = await fetchJson<any>("/api/invoice-groups", {
    method: "POST",
    body: { invoiceNumber: realInvoice, legs: [{ confNumber: `${realInvoice}-A` }] },
  });
  assert.equal(first.status, 201);
  const groupId = first.json.group.id;

  try {
    const mismatched = await fetchJson<any>("/api/invoice-groups", {
      method: "POST",
      body: {
        invoiceNumber: uniqueInvoiceNumber("guard-other"),
        attachToExistingId: groupId,
        legs: [{ confNumber: `${realInvoice}-X` }],
      },
    });
    assert.equal(mismatched.status, 400);
    assert.match(mismatched.json.error, /different invoiceNumber/);
  } finally {
    await db.delete(claimsTable).where(eq(claimsTable.invoiceNumbers, realInvoice));
    await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, groupId));
    await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupId));
  }
});

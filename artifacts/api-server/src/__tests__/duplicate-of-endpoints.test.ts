// Integration tests for POST/DELETE /api/claims/:id/duplicate-of.
// Mounts the claims router in-process and seeds invoice_group + claim
// rows directly. Asserts both the success path (writes the pointer,
// emits the audit row, derives `duplicate`) and the validation paths
// (self-reference, cross-group, chain-rejection, group-phase guard).

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, inArray } from "drizzle-orm";

import claimsRouter from "../routes/claims";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
} from "@workspace/db";
import { deriveLegSubStatus } from "@workspace/leg-state";

const TEST_USER = { email: "duplicate-of-tester@example.com", displayName: "Dup Tester" };

let server: http.Server;
let baseUrl: string;

before(async () => {
  const app: Express = express();
  app.use(express.json());

  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });

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

async function request<T = unknown>(
  method: "POST" | "DELETE" | "GET",
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const url = new URL(`${baseUrl}${path}`);
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return new Promise((resolveReq, rejectReq) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : undefined,
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
    if (payload) req.write(payload);
    req.end();
  });
}

interface Seed {
  groupId: number;
  claimIds: number[];
}

async function seedGroup(opts: {
  status?: string;
  legs: Array<{ confSuffix: string; sopOutcome?: string | null; includedInDispute?: boolean }>;
}): Promise<Seed> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: `DUP-${tag}`,
    status: (opts.status ?? "Needs Evidence") as "Needs Evidence",
  }).returning({ id: invoiceGroupsTable.id });

  const claimIds: number[] = [];
  for (const leg of opts.legs) {
    const [c] = await db.insert(claimsTable).values({
      confNumber: `DUP-${tag}-${leg.confSuffix}`,
      status: "Needs Evidence",
      invoiceGroupId: group.id,
      sopOutcome: leg.sopOutcome ?? null,
      includedInDispute: leg.includedInDispute ?? true,
    }).returning({ id: claimsTable.id });
    claimIds.push(c.id);
  }
  return { groupId: group.id, claimIds };
}

async function cleanup(seed: Seed) {
  if (seed.claimIds.length) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.claimId, seed.claimIds)).catch(() => undefined);
    await db.delete(claimsTable).where(inArray(claimsTable.id, seed.claimIds)).catch(() => undefined);
  }
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, seed.groupId)).catch(() => undefined);
}

// ── Happy path ──────────────────────────────────────────────────────────

test("POST marks the leg, writes the pointer, derives 'duplicate', emits an audit row", async () => {
  const seed = await seedGroup({
    legs: [
      { confSuffix: "A" },
      { confSuffix: "B" },
    ],
  });
  try {
    const [primaryId, dupId] = seed.claimIds;
    const r = await request("POST", `/api/claims/${dupId}/duplicate-of`, {
      primaryClaimId: primaryId,
      note: "Same passenger as A",
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));

    const [row] = await db.select().from(claimsTable).where(eq(claimsTable.id, dupId));
    assert.equal(row.duplicateOfClaimId, primaryId);
    assert.equal(deriveLegSubStatus(row), "duplicate");

    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.claimId, dupId));
    const dupAudit = audits.find((a) => a.action === "leg_marked_duplicate");
    assert.ok(dupAudit, "expected leg_marked_duplicate audit row");
    assert.match(dupAudit!.details ?? "", /sibling duplicate/i);
  } finally {
    await cleanup(seed);
  }
});

test("DELETE clears the pointer; leg derives back to underlying state", async () => {
  const seed = await seedGroup({
    legs: [
      { confSuffix: "A" },
      { confSuffix: "B" },
    ],
  });
  try {
    const [primaryId, dupId] = seed.claimIds;
    await request("POST", `/api/claims/${dupId}/duplicate-of`, { primaryClaimId: primaryId });

    const r = await request("DELETE", `/api/claims/${dupId}/duplicate-of`);
    assert.equal(r.status, 200, JSON.stringify(r.json));

    const [row] = await db.select().from(claimsTable).where(eq(claimsTable.id, dupId));
    assert.equal(row.duplicateOfClaimId, null);
    // No errorTypeId on the seed → falls back to needs_classification.
    assert.equal(deriveLegSubStatus(row), "needs_classification");
  } finally {
    await cleanup(seed);
  }
});

// ── Validation ──────────────────────────────────────────────────────────

test("rejects self-reference (400)", async () => {
  const seed = await seedGroup({ legs: [{ confSuffix: "X" }] });
  try {
    const [id] = seed.claimIds;
    const r = await request("POST", `/api/claims/${id}/duplicate-of`, { primaryClaimId: id });
    assert.equal(r.status, 400);
    assert.match((r.json as any).error, /itself/i);
  } finally {
    await cleanup(seed);
  }
});

test("rejects cross-group primary (400)", async () => {
  const a = await seedGroup({ legs: [{ confSuffix: "A1" }] });
  const b = await seedGroup({ legs: [{ confSuffix: "B1" }] });
  try {
    const r = await request("POST", `/api/claims/${a.claimIds[0]}/duplicate-of`, {
      primaryClaimId: b.claimIds[0],
    });
    assert.equal(r.status, 400);
    assert.match((r.json as any).error, /same invoice group/i);
  } finally {
    await cleanup(a);
    await cleanup(b);
  }
});

test("rejects chains (primary already a duplicate) (400)", async () => {
  const seed = await seedGroup({
    legs: [
      { confSuffix: "A" },
      { confSuffix: "B" },
      { confSuffix: "C" },
    ],
  });
  try {
    const [a, b, c] = seed.claimIds;
    // B → A
    let r = await request("POST", `/api/claims/${b}/duplicate-of`, { primaryClaimId: a });
    assert.equal(r.status, 200);
    // C → B should be rejected as a chain.
    r = await request("POST", `/api/claims/${c}/duplicate-of`, { primaryClaimId: b });
    assert.equal(r.status, 400);
    assert.match((r.json as any).error, /chain|sibling duplicate/i);
  } finally {
    await cleanup(seed);
  }
});

// Reverse-direction chain guard: if C already points at A, A must not be
// markable as a duplicate of B (that would create C → A → B). The flat
// fan-out invariant the rest of the system relies on requires both
// directions to be checked.
test("rejects re-pointing chain (leg already has dependents) (400)", async () => {
  const seed = await seedGroup({
    legs: [
      { confSuffix: "A" },
      { confSuffix: "B" },
      { confSuffix: "C" },
    ],
  });
  try {
    const [a, b, c] = seed.claimIds;
    // C → A (A now has a dependent).
    let r = await request("POST", `/api/claims/${c}/duplicate-of`, { primaryClaimId: a });
    assert.equal(r.status, 200);
    // A → B must be rejected because C → A already exists.
    r = await request("POST", `/api/claims/${a}/duplicate-of`, { primaryClaimId: b });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.match((r.json as any).error, /chain|dependents|already point/i);
    assert.deepEqual((r.json as any).dependentClaimIds, [c]);
  } finally {
    await cleanup(seed);
  }
});

test("rejects when the leg is excluded (409)", async () => {
  const seed = await seedGroup({
    legs: [
      { confSuffix: "A" },
      { confSuffix: "B", includedInDispute: false },
    ],
  });
  try {
    const [primaryId, dupId] = seed.claimIds;
    const r = await request("POST", `/api/claims/${dupId}/duplicate-of`, { primaryClaimId: primaryId });
    assert.equal(r.status, 409);
    assert.equal((r.json as any).actualState, "excluded");
  } finally {
    await cleanup(seed);
  }
});

test("rejects after the group leaves pre-submit (409)", async () => {
  const seed = await seedGroup({
    status: "Awaiting Response",
    legs: [
      { confSuffix: "A" },
      { confSuffix: "B" },
    ],
  });
  try {
    const [primaryId, dupId] = seed.claimIds;
    const r = await request("POST", `/api/claims/${dupId}/duplicate-of`, { primaryClaimId: primaryId });
    assert.equal(r.status, 409);
    assert.match((r.json as any).error, /pre-submit/i);
  } finally {
    await cleanup(seed);
  }
});

test("DELETE on a non-duplicate leg → 409", async () => {
  const seed = await seedGroup({ legs: [{ confSuffix: "A" }] });
  try {
    const r = await request("DELETE", `/api/claims/${seed.claimIds[0]}/duplicate-of`);
    assert.equal(r.status, 409);
    assert.match((r.json as any).error, /not marked/i);
  } finally {
    await cleanup(seed);
  }
});

// Regression for the SQL ↔ JS derivation parity. The JS deriveLegSubStatus
// returns `duplicate` for legs with duplicateOfClaimId set; the SQL
// `legSubStatus` filter must do the same — and must exclude those legs
// from the other buckets (needs_classification, investigating, …).
test("GET /claims?legSubStatus=duplicate returns marked legs and other filters skip them", async () => {
  const seed = await seedGroup({
    legs: [
      { confSuffix: "PRIMARY" },
      { confSuffix: "DUP" },
    ],
  });
  try {
    const [primaryId, dupId] = seed.claimIds;
    const mark = await request("POST", `/api/claims/${dupId}/duplicate-of`, { primaryClaimId: primaryId });
    assert.equal(mark.status, 200);

    type ListResp = { claims: Array<{ id: number }>; total: number };
    const dupList = await request<ListResp>(
      "GET",
      `/api/claims?legSubStatus=duplicate&search=DUP-`,
    );
    assert.equal(dupList.status, 200);
    const dupIds = dupList.json.claims.map((c) => c.id);
    assert.ok(dupIds.includes(dupId), `expected duplicate filter to include ${dupId}; got ${dupIds.join(",")}`);
    assert.ok(!dupIds.includes(primaryId), "duplicate filter must not include the primary leg");

    const ncList = await request<ListResp>(
      "GET",
      `/api/claims?legSubStatus=needs_classification&search=DUP-`,
    );
    assert.equal(ncList.status, 200);
    const ncIds = ncList.json.claims.map((c) => c.id);
    assert.ok(!ncIds.includes(dupId), "needs_classification filter must not include the duplicate leg");
  } finally {
    await cleanup(seed);
  }
});

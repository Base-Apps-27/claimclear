// Task #714 — Regression coverage for the "No Action Needed" auto-close
// cascade. Verifies that when every disputed leg of a pre-submit invoice
// group resolves to sop_outcome='non_issue' (via SOP-walk terminal,
// /conclude-leg, or /exclude with reason='non_issue'), the parent group
// auto-lands at (status='Resolved', outcome='No Action Needed',
// closure_reason='non_issue'). And conversely: a single non-non_issue
// sibling holds the group open (negative case).
//
// N=1 case: one disputed leg, walked to a non_issue terminal SOP node →
// group auto-closes to (Resolved, No Action Needed, non_issue).
//
// N=4 case: four disputed legs, all four concluded as non_issue via
// /conclude-leg → group auto-closes once, on the LAST conclude.
//
// Negative case: three legs non_issue, one still Pending → group stays
// pre-submit (status untouched, outcome stays Pending).

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";

import claimsRouter from "../routes/claims";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  errorTypesTable,
} from "@workspace/db";
import { __setAnthropicClientForTesting } from "@workspace/integrations-anthropic-ai";

let server: http.Server;
let baseUrl: string;

const TEST_USER = { email: "auto-close-714@example.com", displayName: "Auto-close Tester" };

before(async () => {
  __setAnthropicClientForTesting({
    messages: {
      async create(): Promise<{ content: Array<{ type: string; text: string }> }> {
        return { content: [{ type: "text", text: JSON.stringify({ subject: "x", body: "y" }) }] };
      },
    },
  } as never);

  const app: Express = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved", role: "operator" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", claimsRouter);

  await new Promise<void>((res, rej) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
        res();
      } else rej(new Error("no port"));
    });
  });
});

after(async () => {
  __setAnthropicClientForTesting(null);
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
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

const TREE = {
  rootId: "root",
  nodes: [
    {
      id: "root",
      question: "Was this a real billing error?",
      options: [
        { label: "yes", outcomeType: "portal_dispute" },
        { label: "no", outcomeType: "non_issue" },
      ],
    },
  ],
};

async function seedErrorType() {
  const [row] = await db.insert(errorTypesTable).values({
    name: `T714-ET-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    description: "auto-close test",
    decisionTree: TREE as any,
  }).returning();
  return row;
}

async function seedGroup() {
  const invoiceNumber = `T714-G-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: "Needs Evidence",
    outcome: "Pending",
    phase: "triage",
  }).returning();
  return row;
}

async function seedClaimMidWalk(opts: {
  groupId: number;
  errorTypeId: number;
  errorTypeName: string;
}) {
  const confNumber = `T714-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [row] = await db.insert(claimsTable).values({
    confNumber,
    status: "Needs Evidence",
    outcome: "Pending",
    invoiceGroupId: opts.groupId,
    errorTypeId: String(opts.errorTypeId),
    errorTypeName: opts.errorTypeName,
    sopAnswers: [],
    sopNodeId: "root",
    claimAmount: "100.00",
    disposition: "classifying" as any,
    includedInDispute: true,
  }).returning();
  return row;
}

async function readGroup(id: number) {
  const [row] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  return row;
}

test("Task #714 — N=1: a single disputed leg walked to non_issue auto-closes the group", async () => {
  const et = await seedErrorType();
  const g = await seedGroup();
  const leg = await seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name });

  const r = await fetchJson(`/api/claims/${leg.id}/sop-advance`, {
    method: "POST",
    body: { nodeId: "root", answer: "no" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));

  const after = await readGroup(g.id);
  assert.equal(after.status, "Resolved");
  assert.equal(after.outcome, "No Action Needed");
  assert.equal(after.closureReason, "non_issue");
});

test("Task #714 — N=4: group auto-closes only on the LAST non_issue conclude", async () => {
  const et = await seedErrorType();
  const g = await seedGroup();
  const legs = await Promise.all([
    seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name }),
    seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name }),
    seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name }),
    seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name }),
  ]);

  // Conclude first three — group stays open.
  for (let i = 0; i < 3; i++) {
    const r = await fetchJson(`/api/claims/${legs[i].id}/conclude-leg`, {
      method: "POST",
      body: { reason: "non_issue", note: null },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const mid = await readGroup(g.id);
    assert.notEqual(mid.status, "Resolved", `Group prematurely closed at leg ${i + 1}/4`);
    assert.equal(mid.outcome, "Pending");
  }

  // Last one trips the cascade.
  const last = await fetchJson(`/api/claims/${legs[3].id}/conclude-leg`, {
    method: "POST",
    body: { reason: "non_issue", note: null },
  });
  assert.equal(last.status, 200, JSON.stringify(last.json));

  const after = await readGroup(g.id);
  assert.equal(after.status, "Resolved");
  assert.equal(after.outcome, "No Action Needed");
  assert.equal(after.closureReason, "non_issue");
});

test("Task #714 — negative: one Pending sibling holds the group open", async () => {
  const et = await seedErrorType();
  const g = await seedGroup();
  const a = await seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name });
  const b = await seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name });
  const c = await seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name });
  // `d` is left Pending — never advanced.
  await seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name });

  for (const legId of [a.id, b.id, c.id]) {
    const r = await fetchJson(`/api/claims/${legId}/conclude-leg`, {
      method: "POST",
      body: { reason: "non_issue", note: null },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }

  const after = await readGroup(g.id);
  assert.notEqual(after.status, "Resolved", "Group should stay open while one leg is still Pending");
  assert.equal(after.outcome, "Pending");
  assert.equal(after.closureReason, null);
});

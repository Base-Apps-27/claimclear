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
//
// Orphan-shape case: a group whose every leg is blank (no error_type,
// never classified) gets all legs flipped to non_issue via per-leg
// /exclude with reason='non_issue' (the "Mark all as no-issue" Queue
// path). The cascade must still close the group at (Resolved, No
// Action Needed, non_issue) — the helper's predicate is broader than
// "every disputed leg" precisely so it covers blank-classified groups.

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

async function seedBlankClaim(opts: { groupId: number }) {
  // Orphan-shape leg: never classified, no error_type, sits at
  // sub_status='needs_classification' so /exclude accepts it.
  const confNumber = `T714-BLANK-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [row] = await db.insert(claimsTable).values({
    confNumber,
    status: "Needs Evidence",
    outcome: "Pending",
    invoiceGroupId: opts.groupId,
    errorTypeId: null,
    errorTypeName: null,
    sopAnswers: [],
    sopNodeId: null,
    claimAmount: "100.00",
    disposition: "unclassified" as any,
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

test("Task #714 — mixed: blank non-issue passenger + real disputed pending leg keeps group open", async () => {
  // The broadened predicate must NOT close a group just because one
  // blank leg got excluded as non_issue. As long as a real disputed
  // leg is still mid-walk (sopOutcome=null, includedInDispute=true),
  // the rollup says "not_all_non_issue" and the group stays open.
  const et = await seedErrorType();
  const g = await seedGroup();
  const blank = await seedBlankClaim({ groupId: g.id });
  // Real disputed leg, never advanced — sopOutcome=null, in dispute.
  await seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name });

  const r = await fetchJson(`/api/claims/${blank.id}/exclude`, {
    method: "POST",
    body: { reason: "non_issue", note: null },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));

  const after = await readGroup(g.id);
  assert.notEqual(after.status, "Resolved", "Group must stay open while a real disputed leg is still pending");
  assert.equal(after.outcome, "Pending");
  assert.equal(after.closureReason, null);
});

test("Task #714 — orphan shape: blank-classified group auto-closes via /exclude", async () => {
  // No error type seeded — every leg is a blank passenger row, the
  // shape produced by Task #260's auto-non-issue-siblings rule and by
  // operators clicking "Mark all as no-issue" on never-classified
  // groups. Pre-broadening, the cascade short-circuited with
  // `no_rollup_legs` (formerly `no_disputed_legs`) here and left the
  // group stuck pre-submit.
  const g = await seedGroup();
  const a = await seedBlankClaim({ groupId: g.id });
  const b = await seedBlankClaim({ groupId: g.id });
  const c = await seedBlankClaim({ groupId: g.id });

  // Exclude first two — group stays open.
  for (const legId of [a.id, b.id]) {
    const r = await fetchJson(`/api/claims/${legId}/exclude`, {
      method: "POST",
      body: { reason: "non_issue", note: null },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const mid = await readGroup(g.id);
    assert.notEqual(mid.status, "Resolved", "Group prematurely closed before final exclusion");
  }

  // Last exclusion trips the cascade.
  const last = await fetchJson(`/api/claims/${c.id}/exclude`, {
    method: "POST",
    body: { reason: "non_issue", note: null },
  });
  assert.equal(last.status, 200, JSON.stringify(last.json));

  const after = await readGroup(g.id);
  assert.equal(after.status, "Resolved");
  assert.equal(after.outcome, "No Action Needed");
  assert.equal(after.closureReason, "non_issue");
});

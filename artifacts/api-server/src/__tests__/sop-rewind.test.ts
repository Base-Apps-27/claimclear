// Per-leg SOP rewind & restart endpoint tests for Task #525.
//
// Covers the four new routes:
//   • GET  /claims/:id/sop-rewind-impact
//   • POST /claims/:id/sop-back-step
//   • POST /claims/:id/sop-jump
//   • POST /claims/:id/sop-restart
//
// Verifies the planner (answers popped, sopOutcome cleared, evidence
// wiped on restart only), the draft-discard 409 gate, audit + state
// event vocabulary, and clerk role gating.

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
  auditLogsTable,
  notesTable,
  portalResponsesTable,
  portalSubmissionsTable,
  claimEvidenceTable,
  claimVerdictTable,
  errorTypesTable,
  stateEventsTable,
} from "@workspace/db";
import { __setAnthropicClientForTesting } from "@workspace/integrations-anthropic-ai";

let server: http.Server;
let baseUrl: string;
let currentRole: "operator" | "clerk" = "operator";

const TEST_USER = { email: "rewind-tester@example.com", displayName: "Rewind Tester" };

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
    (req as any).user = { ...TEST_USER, status: "approved", role: currentRole };
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

// ── Seeds ──────────────────────────────────────────────────────────────

const TREE = {
  rootId: "root",
  nodes: {
    root: { id: "root", question: "?", options: [{ label: "yes", next: "n2" }, { label: "no", next: "n3" }] },
    n2: { id: "n2", question: "?", options: [{ label: "go", next: "n4" }] },
    n3: { id: "n3", question: "?", terminal: { sopOutcome: "non_issue" } },
    n4: { id: "n4", question: "?", terminal: { sopOutcome: "dispute" } },
  },
};

async function seedErrorType(): Promise<typeof errorTypesTable.$inferSelect> {
  const [row] = await db.insert(errorTypesTable).values({
    name: `T525-ET-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    description: "rewind test",
    decisionTree: TREE as any,
  }).returning();
  return row;
}

async function seedGroup(opts: Partial<typeof invoiceGroupsTable.$inferInsert> = {}) {
  const invoiceNumber = `T525-G-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: "Needs Evidence",
    outcome: "Pending",
    phase: "triage",
    ...opts,
  }).returning();
  return row;
}

async function seedClaimMidWalk(opts: {
  groupId: number;
  errorTypeId: number;
  errorTypeName: string;
}) {
  const [row] = await db.insert(claimsTable).values({
    confNumber: `T525-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    status: "Needs Evidence",
    outcome: "Pending",
    invoiceGroupId: opts.groupId,
    errorTypeId: String(opts.errorTypeId),
    errorTypeName: opts.errorTypeName,
    sopAnswers: [
      { nodeId: "root", answer: "yes", ts: new Date().toISOString() },
      { nodeId: "n2", answer: "go", ts: new Date().toISOString() },
    ],
    sopNodeId: "n4",
    sopOutcome: "dispute",
    readyAt: new Date(),
    claimAmount: "100.00",
    disposition: "classifying" as any,
    includedInDispute: true,
  }).returning();
  return row;
}

async function cleanup(claimId: number, groupId: number, errorTypeId: number) {
  await db.delete(claimVerdictTable).where(eq(claimVerdictTable.claimId, claimId)).catch(() => undefined);
  await db.delete(stateEventsTable).where(eq(stateEventsTable.claimId, claimId)).catch(() => undefined);
  await db.delete(portalResponsesTable).where(eq(portalResponsesTable.claimId, claimId)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, claimId)).catch(() => undefined);
  await db.delete(notesTable).where(eq(notesTable.claimId, claimId)).catch(() => undefined);
  await db.delete(claimEvidenceTable).where(eq(claimEvidenceTable.claimId, claimId)).catch(() => undefined);
  await db.delete(claimsTable).where(eq(claimsTable.id, claimId)).catch(() => undefined);
  await db.delete(stateEventsTable).where(eq(stateEventsTable.invoiceGroupId, groupId)).catch(() => undefined);
  await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.invoiceGroupId, groupId)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, groupId)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupId)).catch(() => undefined);
  await db.delete(errorTypesTable).where(eq(errorTypesTable.id, errorTypeId)).catch(() => undefined);
}

// ── Tests ──────────────────────────────────────────────────────────────

test("GET /sop-rewind-impact reports plan for back-step on a terminal leg", async () => {
  const et = await seedErrorType();
  const g = await seedGroup();
  const c = await seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name });
  try {
    const res = await fetchJson(`/api/claims/${c.id}/sop-rewind-impact?action=back-step`);
    assert.equal(res.status, 200);
    assert.equal(res.json.action, "back-step");
    assert.equal(res.json.answersToPop, 1);
    assert.equal(res.json.nextSopNodeId, "n2");
    assert.equal(res.json.currentSopOutcome, "dispute");
    assert.equal(res.json.clearsTerminal, true);
    assert.equal(res.json.evidenceWillBeCleared, 0);
    assert.equal(res.json.draftWillBeDiscarded, false);
  } finally { await cleanup(c.id, g.id, et.id); }
});

test("GET /sop-rewind-impact reports draftWillBeDiscarded=true when group has previewGeneratedAt", async () => {
  const et = await seedErrorType();
  const g = await seedGroup({ previewGeneratedAt: new Date(), draftSubject: "s", draftDescriptionHtml: "<p>x</p>" });
  const c = await seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name });
  try {
    const res = await fetchJson(`/api/claims/${c.id}/sop-rewind-impact?action=restart`);
    assert.equal(res.status, 200);
    assert.equal(res.json.draftWillBeDiscarded, true);
    assert.ok(res.json.previewGeneratedAt);
  } finally { await cleanup(c.id, g.id, et.id); }
});

test("POST /sop-back-step pops last answer + clears terminal sopOutcome", async () => {
  const et = await seedErrorType();
  const g = await seedGroup();
  const c = await seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name });
  try {
    const res = await fetchJson(`/api/claims/${c.id}/sop-back-step`, { method: "POST", body: {} });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.sopOutcome, null);
    assert.equal(res.json.dropReason, null);
    assert.equal(res.json.readyAt, null);
    assert.equal(res.json.sopNodeId, "n2");
    assert.equal(res.json.errorTypeId, String(et.id), "errorTypeId preserved");
    const reloaded = await db.select().from(claimsTable).where(eq(claimsTable.id, c.id));
    assert.equal((reloaded[0].sopAnswers as any[]).length, 1);

    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.claimId, c.id));
    const rew = audits.find((a) => a.action === "leg_sop_rewound");
    assert.ok(rew, "expected leg_sop_rewound audit row");
    assert.equal((rew!.metadata as any).kind, "back-step");
    assert.equal((rew!.metadata as any).answersPopped, 1);

    const events = await db.select().from(stateEventsTable).where(eq(stateEventsTable.claimId, c.id));
    assert.ok(events.find((e) => e.eventKey === "leg.sop_rewound"));
  } finally { await cleanup(c.id, g.id, et.id); }
});

test("POST /sop-back-step on a leg with zero answers returns 409", async () => {
  const et = await seedErrorType();
  const g = await seedGroup();
  const [c] = await db.insert(claimsTable).values({
    confNumber: `T525-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    status: "Needs Evidence",
    outcome: "Pending",
    invoiceGroupId: g.id,
    errorTypeId: String(et.id),
    errorTypeName: et.name,
    claimAmount: "100.00",
    disposition: "classifying" as any,
  }).returning();
  try {
    const res = await fetchJson(`/api/claims/${c.id}/sop-back-step`, { method: "POST", body: {} });
    assert.equal(res.status, 409);
  } finally { await cleanup(c.id, g.id, et.id); }
});

test("POST /sop-jump pops to the named node", async () => {
  const et = await seedErrorType();
  const g = await seedGroup();
  const c = await seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name });
  try {
    const res = await fetchJson(`/api/claims/${c.id}/sop-jump`, { method: "POST", body: { nodeId: "root" } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.sopNodeId, "root");
    assert.equal(res.json.sopOutcome, null);
    const reloaded = await db.select().from(claimsTable).where(eq(claimsTable.id, c.id));
    assert.equal((reloaded[0].sopAnswers as any[]).length, 0);

    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.claimId, c.id));
    const rew = audits.find((a) => a.action === "leg_sop_rewound");
    assert.ok(rew, "expected leg_sop_rewound audit row");
    assert.equal((rew!.metadata as any).kind, "jump");
    assert.equal((rew!.metadata as any).targetNodeId, "root");
    assert.equal((rew!.metadata as any).answersPopped, 2);
    assert.equal((rew!.metadata as any).clearedSopOutcome, "dispute");
  } finally { await cleanup(c.id, g.id, et.id); }
});

test("POST /sop-jump with unknown nodeId returns 409", async () => {
  const et = await seedErrorType();
  const g = await seedGroup();
  const c = await seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name });
  try {
    const res = await fetchJson(`/api/claims/${c.id}/sop-jump`, { method: "POST", body: { nodeId: "ghost" } });
    assert.equal(res.status, 409);
  } finally { await cleanup(c.id, g.id, et.id); }
});

test("POST /sop-restart wipes answers + walk-tied evidence, preserves errorTypeId", async () => {
  const et = await seedErrorType();
  const g = await seedGroup();
  const c = await seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name });
  // Walk-tied evidence (treeNodeId set) + non-walk evidence (treeNodeId null).
  await db.insert(claimEvidenceTable).values({
    claimId: c.id, evidenceTypeName: "screenshot", treeNodeId: "n2",
  } as any);
  await db.insert(claimEvidenceTable).values({
    claimId: c.id, evidenceTypeName: "screenshot", treeNodeId: null,
  } as any);
  try {
    const res = await fetchJson(`/api/claims/${c.id}/sop-restart`, { method: "POST", body: {} });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.sopNodeId, "root");
    assert.equal(res.json.sopOutcome, null);
    assert.equal(res.json.errorTypeId, String(et.id), "errorTypeId preserved");
    const reloaded = await db.select().from(claimsTable).where(eq(claimsTable.id, c.id));
    assert.equal((reloaded[0].sopAnswers as any[]).length, 0);

    const ev = await db.select().from(claimEvidenceTable).where(eq(claimEvidenceTable.claimId, c.id));
    assert.equal(ev.length, 1, "non-walk evidence preserved, walk evidence wiped");
    assert.equal(ev[0].treeNodeId, null);
  } finally { await cleanup(c.id, g.id, et.id); }
});

test("POST /sop-restart returns 409 draft_discard_required when group has previewGeneratedAt and no opt-in", async () => {
  const et = await seedErrorType();
  const g = await seedGroup({ previewGeneratedAt: new Date(), draftSubject: "s", draftDescriptionHtml: "<p>x</p>" });
  const c = await seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name });
  try {
    const res = await fetchJson(`/api/claims/${c.id}/sop-restart`, { method: "POST", body: {} });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, "draft_discard_required");
    assert.equal(res.json.impact.draftWillBeDiscarded, true);
    assert.equal(res.json.impact.action, "restart");

    // Leg unchanged.
    const reloaded = await db.select().from(claimsTable).where(eq(claimsTable.id, c.id));
    assert.equal((reloaded[0].sopAnswers as any[]).length, 2, "leg untouched on 409");
    assert.equal(reloaded[0].sopOutcome, "dispute");
  } finally { await cleanup(c.id, g.id, et.id); }
});

test("POST /sop-restart with discardDraft:true clears the group's draft fields", async () => {
  const et = await seedErrorType();
  const g = await seedGroup({
    previewGeneratedAt: new Date(),
    previewGeneratedBy: "x@example.com",
    draftSubject: "subj",
    draftDescriptionHtml: "<p>body</p>",
    aiBaselineSubject: "base",
    aiBaselineDescriptionHtml: "<p>base</p>",
    draftReviewedAt: new Date(),
    draftReviewedBy: "y@example.com",
  });
  const c = await seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name });
  try {
    const res = await fetchJson(`/api/claims/${c.id}/sop-restart`, { method: "POST", body: { discardDraft: true } });
    assert.equal(res.status, 200, JSON.stringify(res.json));

    const [gAfter] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, g.id));
    assert.equal(gAfter.previewGeneratedAt, null);
    assert.equal(gAfter.previewGeneratedBy, null);
    assert.equal(gAfter.draftSubject, null);
    assert.equal(gAfter.draftDescriptionHtml, null);
    assert.equal(gAfter.aiBaselineSubject, null);
    assert.equal(gAfter.aiBaselineDescriptionHtml, null);
    assert.equal(gAfter.draftReviewedAt, null);
    assert.equal(gAfter.draftReviewedBy, null);

    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, g.id));
    assert.ok(audits.find((a) => a.action === "group_draft_discarded"), "expected group_draft_discarded audit");
    const rew = audits.find((a) => a.action === "leg_sop_rewound");
    assert.equal((rew!.metadata as any).draftDiscarded, true);
  } finally { await cleanup(c.id, g.id, et.id); }
});

test("POST /sop-back-step from a clerk role is denied with 403", async () => {
  const et = await seedErrorType();
  const g = await seedGroup();
  const c = await seedClaimMidWalk({ groupId: g.id, errorTypeId: et.id, errorTypeName: et.name });
  currentRole = "clerk";
  try {
    const res = await fetchJson(`/api/claims/${c.id}/sop-back-step`, { method: "POST", body: {} });
    assert.equal(res.status, 403);
  } finally {
    currentRole = "operator";
    await cleanup(c.id, g.id, et.id);
  }
});


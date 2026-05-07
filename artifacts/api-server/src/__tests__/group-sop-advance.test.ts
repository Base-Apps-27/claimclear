import { phaseForStatus, dispositionForGroup } from "./fixtures/state";
// Task #470 — Pivot B1. Bulk SOP advance endpoint:
// POST /invoice-groups/:id/sop-advance
//
// Coverage (mirrors the spec's "Done looks like" checklist):
//  (a) Happy path — advances 3 eligible legs in one txn, 1 wrong-node
//      leg + 1 sibling-duplicate leg returned in `skipped`. Verifies
//      audit + state event rows + umbrella audit metadata.
//  (b) Terminal step stamps sop_outcome + ready_at on every eligible
//      leg, with `terminalSopOutcome` body override applied uniformly.
//  (c) 409 `node_not_bulk_eligible` when the node carries an evidence
//      requirement on the chosen branch's child step.
//  (d) 409 `node_not_bulk_eligible` when the node lacks
//      `appliesPerInvoice = true`.
//  (e) 409 `no_eligible_legs` when zero matching legs after pre-check.
//  (f) Transaction rollback when the audit insert fails — leg rows
//      stay untouched.
//  (g) Auth — clerk gets 403, anonymous gets 401.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";

import invoiceGroupsRouter, { BULK_SOP_TEST_HOOKS } from "../routes/invoice-groups";
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
let currentRole: "admin" | "operator" | "clerk" = "operator";
let currentAuthenticated = true;

const TEST_USER = { email: "bulk-sop-tester@example.com", displayName: "Bulk SOP Tester" };

before(async () => {
  const app: Express = express();
  app.use(express.json());

  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = currentAuthenticated
      ? { ...TEST_USER, status: "approved", role: currentRole }
      : undefined;
    (req as any).isAuthenticated = () => currentAuthenticated;
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
          let parsed: T;
          try {
            parsed = raw ? JSON.parse(raw) : ({} as T);
          } catch {
            // Express default 500 handler renders HTML — keep the
            // status code and surface an empty body so callers can still
            // assert on res.status without crashing on parse.
            parsed = { _nonJson: raw } as unknown as T;
          }
          resolveReq({ status: res.statusCode ?? 0, json: parsed });
        });
      },
    );
    req.on("error", rejectReq);
    if (body) req.write(body);
    req.end();
  });
}

// --- Seeding -----------------------------------------------------------

async function createSeedGroup(): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const invoiceNumber = `T470G-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: "Needs Evidence",
    outcome: "Pending",
    phase: phaseForStatus("Needs Evidence"),
  }).returning();
  return row;
}

async function createBulkErrorType(opts: { appliesPerInvoice: boolean; childHasEvidence?: boolean } = { appliesPerInvoice: true }):
  Promise<typeof errorTypesTable.$inferSelect> {
  const name = `T470-ErrType-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  // Tree shape:
  //   N1 (appliesPerInvoice = opts) — "Was the trip cancelled?"
  //     → "Yes" childId=N2
  //     → "No" terminal portal_dispute
  //   N2 — leaf "submit"
  const childNode: any = { id: "N2", question: "Submit step", options: [
    { label: "Done", outcomeType: "portal_dispute" },
  ]};
  if (opts.childHasEvidence) {
    childNode.evidenceRequirements = [{ key: "ev1", label: "Cancellation email", required: true }];
  }
  const tree = {
    rootId: "N1",
    nodes: [
      {
        id: "N1",
        question: "Was the trip cancelled?",
        appliesPerInvoice: opts.appliesPerInvoice,
        options: [
          { label: "Yes", childId: "N2" },
          { label: "No", outcomeType: "portal_dispute" },
        ],
      },
      childNode,
    ],
  };
  const [row] = await db.insert(errorTypesTable).values({
    name,
    description: "test",
    decisionTree: tree as unknown as Record<string, unknown>,
  }).returning();
  return row;
}

async function createSeedClaim(opts: {
  invoiceGroupId: number;
  errorTypeId: string;
  errorTypeName: string;
  sopNodeId?: string | null;
  sopOutcome?: string | null;
  includedInDispute?: boolean;
  duplicateOfClaimId?: number | null;
}): Promise<typeof claimsTable.$inferSelect> {
  const confNumber = `T470-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const disposition = await dispositionForGroup(opts.invoiceGroupId);
  const [row] = await db.insert(claimsTable).values({
    confNumber,
    status: "Needs Review",
    outcome: "Pending",
    invoiceGroupId: opts.invoiceGroupId,
    errorTypeId: opts.errorTypeId,
    errorTypeName: opts.errorTypeName,
    sopNodeId: opts.sopNodeId ?? "N1",
    sopOutcome: opts.sopOutcome ?? null,
    includedInDispute: opts.includedInDispute ?? true,
    duplicateOfClaimId: opts.duplicateOfClaimId ?? null,
    claimAmount: "100.00",
    disposition,
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

test("(a) happy path — 3 eligible advance, 1 wrong-node + 1 sibling-duplicate skipped, audit + state events written", async () => {
  currentRole = "operator"; currentAuthenticated = true;
  const group = await createSeedGroup();
  const errType = await createBulkErrorType({ appliesPerInvoice: true });
  const a = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name });
  const b = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name });
  const c = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name });
  const wrong = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name, sopNodeId: "N2" });
  const dup = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name, duplicateOfClaimId: a.id });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/sop-advance`, {
      method: "POST",
      body: { nodeId: "N1", answer: "Yes" },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.succeeded.length, 3);
    assert.equal(res.json.skipped.length, 2);
    // Skipped uses { id, ref, reason } shape.
    for (const s of res.json.skipped) {
      assert.ok(typeof s.id === "number", "skipped item must have numeric id");
      assert.ok(typeof s.ref === "string" && s.ref.length > 0, "skipped item must have ref");
      assert.ok(["wrong_node", "sibling_duplicate"].includes(s.reason));
    }
    const reasonsByClaim = new Map<number, string>(res.json.skipped.map((s: any) => [s.id, s.reason]));
    assert.equal(reasonsByClaim.get(wrong.id), "wrong_node");
    assert.equal(reasonsByClaim.get(dup.id), "sibling_duplicate");

    // Each succeeded leg advanced to N2 (mid-walk).
    for (const id of [a.id, b.id, c.id]) {
      const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
      assert.equal(leg.sopNodeId, "N2");
      assert.equal(leg.sopOutcome, null);
      const ans = leg.sopAnswers as Array<{ nodeId: string; answer: string }>;
      assert.equal(ans[ans.length - 1].nodeId, "N1");
      assert.equal(ans[ans.length - 1].answer, "Yes");
    }

    // Per-leg audit + state event rows.
    for (const id of [a.id, b.id, c.id]) {
      const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.claimId, id));
      assert.ok(audits.find((r) => r.action === "leg_sop_advanced" && (r.metadata as any)?.bulk === true),
        `leg ${id} must have a bulk leg_sop_advanced audit row`);
      const events = await db.select().from(stateEventsTable).where(eq(stateEventsTable.claimId, id));
      assert.ok(events.find((e) => e.eventKey === "leg.sop_advanced"));
    }

    // Umbrella group audit row.
    const groupAudits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, group.id));
    const umbrella = groupAudits.find((r) => r.action === "group_sop_advanced_bulk");
    assert.ok(umbrella, "must write a group_sop_advanced_bulk audit row");
    const meta = umbrella!.metadata as any;
    assert.equal(meta.succeeded, 3);
    assert.equal(meta.bulk, true);
    assert.equal(meta.source, "group_sop_advance");
    assert.equal(meta.nodeId, "N1");
    assert.equal(meta.answer, "Yes");
    assert.ok(Array.isArray(meta.skipped));
    assert.equal(meta.skipped.length, 2);

    // Wrong-node leg unchanged.
    const [wrongPost] = await db.select().from(claimsTable).where(eq(claimsTable.id, wrong.id));
    assert.equal(wrongPost.sopNodeId, "N2");
    assert.equal(wrongPost.sopOutcome, null);
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("(b) terminal answer + terminalSopOutcome override applies uniformly + stamps readyAt", async () => {
  currentRole = "operator"; currentAuthenticated = true;
  const group = await createSeedGroup();
  const errType = await createBulkErrorType({ appliesPerInvoice: true });
  const a = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name });
  const b = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/sop-advance`, {
      method: "POST",
      body: { nodeId: "N1", answer: "No", terminalSopOutcome: "dispute" },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.succeeded.length, 2);
    for (const id of [a.id, b.id]) {
      const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
      assert.equal(leg.sopOutcome, "dispute", "terminalSopOutcome override should win");
      assert.ok(leg.readyAt, "dispute terminal must stamp readyAt");
    }
    const events = await db.select().from(stateEventsTable).where(eq(stateEventsTable.invoiceGroupId, group.id));
    assert.equal(events.filter((e) => e.eventKey === "leg.sop_terminal").length, 2);
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("(c) 409 node_not_bulk_eligible when child step has evidence", async () => {
  currentRole = "operator"; currentAuthenticated = true;
  const group = await createSeedGroup();
  const errType = await createBulkErrorType({ appliesPerInvoice: true, childHasEvidence: true });
  const leg = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/sop-advance`, {
      method: "POST",
      body: { nodeId: "N1", answer: "Yes" },
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, "node_not_bulk_eligible");
    assert.ok(typeof res.json.reason === "string");
    // Leg untouched.
    const [post] = await db.select().from(claimsTable).where(eq(claimsTable.id, leg.id));
    assert.equal(post.sopNodeId, "N1");
    assert.equal(post.sopOutcome, null);
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("(d) 409 node_not_bulk_eligible when node lacks appliesPerInvoice = true", async () => {
  currentRole = "operator"; currentAuthenticated = true;
  const group = await createSeedGroup();
  const errType = await createBulkErrorType({ appliesPerInvoice: false });
  const leg = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/sop-advance`, {
      method: "POST",
      body: { nodeId: "N1", answer: "Yes" },
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, "node_not_bulk_eligible");
    const [post] = await db.select().from(claimsTable).where(eq(claimsTable.id, leg.id));
    assert.equal(post.sopNodeId, "N1");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("(e) 409 no_eligible_legs when zero matching legs after pre-check", async () => {
  currentRole = "operator"; currentAuthenticated = true;
  const group = await createSeedGroup();
  const errType = await createBulkErrorType({ appliesPerInvoice: true });
  // All legs in some non-matching state.
  await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name, sopOutcome: "portal_dispute" });
  await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name, includedInDispute: false });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/sop-advance`, {
      method: "POST",
      body: { nodeId: "N1", answer: "Yes" },
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, "no_eligible_legs");
    assert.equal(res.json.succeeded.length, 0);
    assert.equal(res.json.skipped.length, 2);
    const reasons = res.json.skipped.map((s: any) => s.reason).sort();
    assert.deepEqual(reasons, ["already_terminal", "excluded_from_dispute"]);
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("(f) transaction rollback — umbrella audit insert failure rolls back every per-leg update, audit, and state event", async () => {
  currentRole = "operator"; currentAuthenticated = true;
  const group = await createSeedGroup();
  const errType = await createBulkErrorType({ appliesPerInvoice: true });
  const a = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name });
  const b = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name });
  // Arm the test seam: route throws when it tries to insert the
  // umbrella `group_sop_advanced_bulk` audit row, AFTER every per-leg
  // update + per-leg audit + per-leg state event has been queued in
  // the same transaction. The whole txn must roll back.
  BULK_SOP_TEST_HOOKS.failUmbrellaAuditOnce = true;
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/sop-advance`, {
      method: "POST",
      body: { nodeId: "N1", answer: "Yes" },
    });
    assert.equal(res.status, 500, `expected 500 from rollback, got ${res.status} (${JSON.stringify(res.json)})`);
    for (const id of [a.id, b.id]) {
      const [leg] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
      assert.equal(leg.sopNodeId, "N1", `leg ${id} sopNodeId must not have advanced`);
      assert.equal(leg.sopOutcome, null);
      // sopAnswers must NOT have appended the in-flight answer.
      const ans = (leg.sopAnswers as Array<{ nodeId: string; answer: string }>) ?? [];
      assert.equal(ans.length, 0, `leg ${id} should have no recorded answers after rollback`);
      const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.claimId, id));
      assert.equal(audits.length, 0, `leg ${id} should have NO audit rows after rollback`);
      const events = await db.select().from(stateEventsTable).where(eq(stateEventsTable.claimId, id));
      assert.equal(events.length, 0, `leg ${id} should have NO state events after rollback`);
    }
    const groupAudits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, group.id));
    assert.equal(groupAudits.length, 0, "umbrella audit must also have rolled back");
  } finally {
    BULK_SOP_TEST_HOOKS.failUmbrellaAuditOnce = false;
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("(h) root-null match — leg with sopNodeId=null advances when nodeId equals tree.rootId", async () => {
  currentRole = "operator"; currentAuthenticated = true;
  const group = await createSeedGroup();
  const errType = await createBulkErrorType({ appliesPerInvoice: true });
  // Two legs: one has sopNodeId=null (never advanced), one is at "N1"
  // explicitly. Bulk advance for the root node ("N1") MUST treat both
  // as matching.
  const nullLeg = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name, sopNodeId: null as unknown as string });
  const explicitLeg = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name, sopNodeId: "N1" });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/sop-advance`, {
      method: "POST",
      body: { nodeId: "N1", answer: "Yes" },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.succeeded.length, 2, "both root-null and explicit-root legs should advance");
    assert.equal(res.json.skipped.length, 0);
    const [nullPost] = await db.select().from(claimsTable).where(eq(claimsTable.id, nullLeg.id));
    const [explicitPost] = await db.select().from(claimsTable).where(eq(claimsTable.id, explicitLeg.id));
    assert.equal(nullPost.sopNodeId, "N2");
    assert.equal(explicitPost.sopNodeId, "N2");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("(j) mixed error-types — each leg follows its OWN tree's transition for the same nodeId/answer", async () => {
  currentRole = "operator"; currentAuthenticated = true;
  const group = await createSeedGroup();
  // Two error-types, both with a node "N1" + answer "Yes" + appliesPerInvoice=true,
  // but with DIFFERENT transitions:
  //   errType A: "Yes" → mid-walk to "A_NEXT".
  //   errType B: "Yes" → terminal portal_dispute.
  // Per-leg tree resolution must route each leg correctly — using a
  // canonical tree would have advanced both to the same target.
  const nameA = `T470-MixA-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const treeA = {
    rootId: "N1",
    nodes: [
      {
        id: "N1",
        question: "Q",
        appliesPerInvoice: true,
        options: [{ label: "Yes", childId: "A_NEXT" }],
      },
      { id: "A_NEXT", question: "next", options: [{ label: "Done", outcomeType: "portal_dispute" }] },
    ],
  };
  const nameB = `T470-MixB-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const treeB = {
    rootId: "N1",
    nodes: [
      {
        id: "N1",
        question: "Q",
        appliesPerInvoice: true,
        options: [{ label: "Yes", outcomeType: "portal_dispute" }],
      },
    ],
  };
  const [errA] = await db.insert(errorTypesTable).values({
    name: nameA, description: "mixed A", decisionTree: treeA as unknown as Record<string, unknown>,
  }).returning();
  const [errB] = await db.insert(errorTypesTable).values({
    name: nameB, description: "mixed B", decisionTree: treeB as unknown as Record<string, unknown>,
  }).returning();
  const legA = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errA.id), errorTypeName: errA.name });
  const legB = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errB.id), errorTypeName: errB.name });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/sop-advance`, {
      method: "POST",
      body: { nodeId: "N1", answer: "Yes" },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.succeeded.length, 2);
    const [legAPost] = await db.select().from(claimsTable).where(eq(claimsTable.id, legA.id));
    const [legBPost] = await db.select().from(claimsTable).where(eq(claimsTable.id, legB.id));
    // legA followed treeA → mid-walk to A_NEXT.
    assert.equal(legAPost.sopNodeId, "A_NEXT", "legA must follow treeA's mid-walk transition");
    assert.equal(legAPost.sopOutcome, null);
    // legB followed treeB → terminal portal_dispute.
    assert.equal(legBPost.sopOutcome, "portal_dispute", "legB must follow treeB's terminal transition");
    assert.ok(legBPost.readyAt);
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errA.id);
    await cleanupErrorType(errB.id);
  }
});

test("(i) pre-check fires even with zero candidates — non-bulk-eligible node returns 409 not no_eligible_legs", async () => {
  currentRole = "operator"; currentAuthenticated = true;
  const group = await createSeedGroup();
  const errType = await createBulkErrorType({ appliesPerInvoice: false });
  // No candidate legs (all at wrong node). Pre-check must STILL run
  // against the tree and surface node_not_bulk_eligible — empty
  // candidate set must not mask an ineligible node.
  await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name, sopNodeId: "N2" });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/sop-advance`, {
      method: "POST",
      body: { nodeId: "N1", answer: "Yes" },
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, "node_not_bulk_eligible");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("(g1) 403 for clerk role", async () => {
  currentRole = "clerk"; currentAuthenticated = true;
  const group = await createSeedGroup();
  const errType = await createBulkErrorType({ appliesPerInvoice: true });
  const leg = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/sop-advance`, {
      method: "POST",
      body: { nodeId: "N1", answer: "Yes" },
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status} (${JSON.stringify(res.json)})`);
    const [post] = await db.select().from(claimsTable).where(eq(claimsTable.id, leg.id));
    assert.equal(post.sopNodeId, "N1");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
    currentRole = "operator";
  }
});

test("(g2) 401 for anonymous (unauthenticated) caller", async () => {
  currentRole = "operator"; currentAuthenticated = false;
  const group = await createSeedGroup();
  const errType = await createBulkErrorType({ appliesPerInvoice: true });
  const leg = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: String(errType.id), errorTypeName: errType.name });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/sop-advance`, {
      method: "POST",
      body: { nodeId: "N1", answer: "Yes" },
    });
    assert.equal(res.status, 401, `expected 401, got ${res.status} (${JSON.stringify(res.json)})`);
    const [post] = await db.select().from(claimsTable).where(eq(claimsTable.id, leg.id));
    assert.equal(post.sopNodeId, "N1");
    assert.equal(post.sopOutcome, null);
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
    currentAuthenticated = true;
  }
});

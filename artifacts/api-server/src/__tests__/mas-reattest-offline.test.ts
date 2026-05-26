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

    // Task #561 — engagement must also write an `attestation_engaged`
    // audit row and a `claim.attestation_engaged` state_event so the
    // restored gate is observable in dashboards and audit history.
    const audits = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.claimId, claim.id));
    const engaged = audits.find((a) => a.action === "attestation_engaged");
    assert.ok(engaged,
      `Task #561: expected attestation_engaged audit row, got ${JSON.stringify(audits.map((a) => a.action))}`);
    assert.equal((engaged!.metadata as any)?.from, "not_required");
    assert.equal((engaged!.metadata as any)?.to, "pending");
    assert.equal((engaged!.metadata as any)?.trigger, "group_reattest_completed");

    const events = await db.select().from(stateEventsTable)
      .where(eq(stateEventsTable.claimId, claim.id));
    assert.ok(
      events.find((e) => e.eventKey === "claim.attestation_engaged"),
      `Task #561: expected claim.attestation_engaged state_event, got ${JSON.stringify(events.map((e) => e.eventKey))}`,
    );
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("Task #561: /reattest/complete is the only path that engages attestation_state=pending; pre-completion verdicts park at not_required", async () => {
  // Restored Task #196 gate: confirming an Approved verdict on a leg
  // whose parent group has not yet recorded MAS re-attest must NOT
  // push attestationState to pending. The transition only happens
  // inside the /reattest/complete writer once reattest_completed_at
  // lands. This protects the invoice-first contract: an Approved
  // verdict means the group is ready to be sent to MAS, not that the
  // leg is owed a portal re-attest.
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
  // Operator-confirmed Approved verdict — but no MAS re-attest yet.
  await db.insert(claimVerdictTable).values({
    claimId: claim.id,
    source: "operator_confirmed",
    outcome: "Approved",
    createdBy: TEST_USER.email,
  });

  try {
    // Snapshot: the leg's attestation_state must still be the
    // schema default ('not_required') — nothing has flipped it
    // because the gate is closed.
    const [pre] = await db.select().from(claimsTable).where(eq(claimsTable.id, claim.id));
    assert.equal(pre.attestationState, "not_required",
      "Pre-/reattest/complete: gated leg must remain at not_required");

    // Now run /reattest/complete. Engagement should fire.
    const res = await fetchJson(`/api/invoice-groups/${group.id}/reattest/complete`, {
      method: "POST",
      body: {
        recordedOffline: true,
        offlineNote: "Confirmed completion in MAS earlier today.",
      },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);

    const [post] = await db.select().from(claimsTable).where(eq(claimsTable.id, claim.id));
    // 2026-05-26 update (incident on invoices 1881682210 /
    // 1877954550): the survivor cleanup at the bottom of
    // /reattest/complete now drains pending/queued legs the
    // attestation queue would admit. The Task #561 engagement gate
    // still fires (asserted via the audit row above), but the leg's
    // terminal attestation_state after the call is `completed`, not
    // `pending` — one click = engage + complete.
    assert.equal(post.attestationState, "completed",
      "Post-/reattest/complete: gate opens, engagement runs, and survivor cleanup drains the leg to completed");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

// Task #543 — invariant guard. The pre-fix writer stamped
// `reattest_completed_at` directly without funneling through
// `transitionGroupStatusAndOutcome`, leaving legacy `status` /
// `outcome` at whatever the operator clicked from (almost always
// Needs Review / Pending). Production scan on 2026-05-08 surfaced
// 9 such rows. These two tests cover both the standard and the
// admin-offline path: after a successful re-attest completion, the
// row MUST land at status=Resolved + outcome=Approved with phase
// closed and closure_reason='reattested'. Re-running this writer
// after the route is already terminal must remain idempotent.
test("Task #543: standard reattest/complete lands status=Resolved, outcome=Approved, closure_reason=reattested", async () => {
  currentRole = "operator";
  const errType = await createSeedErrorType();
  const group = await createSeedGroup({ status: "Needs Review" });
  // Set up the same prod fingerprint: reattestRequired=true, no
  // outstanding MAS cancels — phase=awaiting_reattestation maps
  // to macro=mas-action-required so the standard path is allowed.
  await db.update(invoiceGroupsTable).set({
    reattestRequired: true,
    phase: "awaiting_reattestation",
  }).where(eq(invoiceGroupsTable.id, group.id));
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: "dispute",
    status: "Needs Review",
  });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/reattest/complete`, {
      method: "POST",
      body: { note: "approved on the portal", masReference: "MAS-543-A" },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);

    const [post] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.equal(post.status, "Resolved", "legacy status must move to Resolved");
    assert.equal(post.outcome, "Approved", "legacy outcome must move to Approved");
    assert.equal(post.phase, "closed", "canonical phase must be 'closed'");
    assert.equal(
      post.closureReason,
      "reattested",
      "closure_reason must remain 'reattested' (NOT overwritten to 'approved' by applyClosureApprovedFields)",
    );
    assert.ok(post.reattestCompletedAt, "reattest_completed_at must be stamped");
    assert.ok(post.phaseEnteredAt, "phase_entered_at must be stamped");

    const audits = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.invoiceGroupId, group.id))
      .orderBy(desc(auditLogsTable.timestamp));
    assert.ok(
      audits.find((a) => a.action === "mas_reattest_completed"),
      "mas_reattest_completed audit row must still be written",
    );
    assert.ok(
      audits.find((a) => a.action === "group_status_and_outcome_changed"),
      "transitionGroupStatusAndOutcome must emit a status/outcome audit row",
    );
    void claim;
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("Task #543: recordedOffline=true also lands status=Resolved + outcome=Approved + closure_reason=reattested", async () => {
  currentRole = "admin";
  const group = await createSeedGroup({ status: "Needs Review" });
  await db.update(invoiceGroupsTable).set({ reattestRequired: true })
    .where(eq(invoiceGroupsTable.id, group.id));
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/reattest/complete`, {
      method: "POST",
      body: {
        recordedOffline: true,
        offlineNote: "Re-attest paper-logged earlier; backfilling now.",
      },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);

    const [post] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.equal(post.status, "Resolved");
    assert.equal(post.outcome, "Approved");
    assert.equal(post.phase, "closed");
    assert.equal(post.closureReason, "reattested");
    assert.ok(post.reattestCompletedAt);
  } finally {
    await cleanupGroup(group.id);
  }
});

test("POST /invoice-groups/:id/reattest/complete WITHOUT recordedOffline still 409s for groups in pre-submit/in-flight phase with no reattest-only outlook", async () => {
  // Sanity-check that the standard 409 path still rejects groups
  // outside the {mas-action-required, response-pending,
  // reattest_only-outlook} accept-set: non-admin, no recordedOffline
  // flag, group in pre-submit (Needs Evidence → phase=ready_to_submit)
  // with zero legs (no reattest-only outlook either) → 409.
  currentRole = "operator";
  const group = await createSeedGroup({ status: "Needs Evidence" });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/reattest/complete`, {
      method: "POST", body: {},
    });
    assert.equal(res.status, 409);
    assert.equal(
      res.json.expectedState,
      "macroPhase in (mas-action-required, response-pending) OR outlook=reattest_only",
    );
  } finally {
    await cleanupGroup(group.id);
    currentRole = "admin";
  }
});

// 2026-05-12 regression — invoice 1849951770 (group #354) shipped to prod
// with phase=response_received, reattest_required=true, both legs Approved
// + queued for re-attestation, mas_action_required='none'. The bulk-queue
// route's response-pending branch (invoice-groups.ts L4578) intentionally
// does NOT promote phase → awaiting_reattestation (mixed
// disputable+survivor groups still need MAS dispute submission for the
// disputed legs), so the canonical macro-phase stayed at "response-pending".
// /reattest/complete then 409'd with "Group is not in the
// mas-action-required phase" even though the operator had completed the
// MAS work and clicked "Re-attested in MAS". The frontend gate
// (canQueueOrCompleteReattest) accepted the click; only the server
// gate refused. The fix is to mirror the queue-gate's three accept
// conditions on the complete-gate too.
test("/reattest/complete accepts response-pending groups with reattest-only outlook (2026-05-12 regression)", async () => {
  currentRole = "operator";
  const errType = await createSeedErrorType();
  // Reproduce prod fingerprint: phase=response_received,
  // reattest_required=true, status=Ready to Review.
  const group = await createSeedGroup({ status: "Ready to Review" });
  await db.update(invoiceGroupsTable).set({
    reattestRequired: true,
    phase: "response_received",
  }).where(eq(invoiceGroupsTable.id, group.id));
  // Two Approved legs, both queued for re-attestation, no MAS cancels
  // owed — outlook = reattest_only.
  const claim1 = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: "dispute",
    status: "Needs Review",
    outcome: "Approved",
  });
  const claim2 = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: "dispute",
    status: "Needs Review",
    outcome: "Approved",
  });
  for (const id of [claim1.id, claim2.id]) {
    await db.update(claimsTable).set({
      attestationState: "queued",
      masActionRequired: "none",
    }).where(eq(claimsTable.id, id));
    await db.insert(claimVerdictTable).values({
      claimId: id,
      source: "operator_confirmed",
      outcome: "Approved",
      createdBy: TEST_USER.email,
    });
  }
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/reattest/complete`, {
      method: "POST",
      body: { note: "Re-attested both legs in MAS", masReference: "MAS-354" },
    });
    assert.equal(
      res.status,
      200,
      `expected 200, got ${res.status} (${JSON.stringify(res.json)}) — the complete-gate must accept response-pending groups with a reattest_only outlook, mirroring the bulk-queue gate and the frontend canQueueOrCompleteReattest mirror.`,
    );

    const [post] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.ok(post.reattestCompletedAt, "reattest_completed_at must be stamped");
    assert.equal(post.phase, "closed", "group must close out via the standard transition");
    assert.equal(post.status, "Resolved");
    assert.equal(post.outcome, "Approved");
    assert.equal(post.closureReason, "reattested");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("/reattest/complete still 409s on outstanding MAS cancels even from the response-pending branch", async () => {
  // Defense in depth: relaxing the phase gate must NOT let a group
  // through with an unfinished MAS cancel. The cancel-completeness
  // check still runs after the phase check.
  currentRole = "operator";
  const errType = await createSeedErrorType();
  const group = await createSeedGroup({ status: "Ready to Review" });
  await db.update(invoiceGroupsTable).set({
    reattestRequired: true,
    phase: "response_received",
  }).where(eq(invoiceGroupsTable.id, group.id));
  const survivor = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: "dispute",
    status: "Needs Review",
    outcome: "Approved",
  });
  await db.update(claimsTable).set({ masActionRequired: "none" })
    .where(eq(claimsTable.id, survivor.id));
  // A second leg with an outstanding MAS cancel — outlook is no longer
  // reattest_only (it has a denied/disputable leg) AND it has an
  // incomplete cancel, so the call must 409.
  const denied = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: "dispute",
    status: "Needs Review",
    outcome: "Denied",
  });
  await db.update(claimsTable).set({ masActionRequired: "cancel" })
    .where(eq(claimsTable.id, denied.id));
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/reattest/complete`, {
      method: "POST", body: {},
    });
    // Group has a Denied disputable leg, so outlook is NOT
    // reattest_only — the response-pending phase is still accepted by
    // the gate, but the cancel-completeness check 409s next.
    assert.equal(res.status, 409, `expected 409, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.expectedState, "all-cancels-complete");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

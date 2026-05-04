// POST /invoice-groups/:id/reattest/queue — atomic bulk queue path
// used by the Re-attest modal's "Queue for later" button.
//
// The legacy per-leg loop (`POST /claims/:id/attest/queue`) tripped on
// the Task #196 attestation gate: when the group's MAS re-attest
// hasn't been stamped yet, every leg sits at attestation_state =
// 'not_required', and /attest/queue requires source state = 'pending'.
// This bulk endpoint flips eligible legs straight to 'queued' and
// stamps awaiting_payor_again_at on the group in one transaction.
//
// Coverage:
//   - happy path: every operator-confirmed Approved/Partial leg moves
//     to queued in one shot, even when the group is pre-reattest gate
//     (legs were at not_required);
//   - awaiting_payor_again_at gets stamped on the group in the same
//     call;
//   - per-leg attestation_queued audit row + state event written;
//   - umbrella group_reattest_queued_bulk audit row + state event
//     written;
//   - eligibility filter: legs with non-operator_confirmed verdicts,
//     non-Approved outcomes, or attestation_state already in
//     terminal/queued are excluded;
//   - 409 when no eligible legs (defense in depth — the modal also
//     hides the button);
//   - 409 when the group isn't in Needs Review or has no inbound
//     payor response on file.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, desc } from "drizzle-orm";

import claimsRouter from "../routes/claims";
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
  stateEventsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;

const TEST_USER = { email: "group-queue-tester@example.com", displayName: "Group Queue Tester" };

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

async function fetchJson<T = unknown>(
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
          } catch (e) {
            rejectReq(e);
          }
        });
      },
    );
    req.on("error", rejectReq);
    if (body) req.write(body);
    req.end();
  });
}

interface SeedOptions {
  /** "not_required" by default — pre-reattest gate is the modal's real-world entry point. */
  attestationState?: "not_required" | "pending" | "queued" | "completed";
  /** Verdict source for the latest claim_verdict row. Default: operator_confirmed. */
  verdictSource?: "ai_suggested" | "operator_confirmed" | "operator_draft";
  /** Verdict outcome. Default: Approved. */
  verdictOutcome?: "Approved" | "Denied" | "Partial";
  /** Claim outcome. Default: Approved. */
  outcome?: "Pending" | "Approved" | "Partially Approved" | "Denied";
  /** Whether the leg has an errorTypeId (i.e. is "disputed"). Default: true. */
  disputed?: boolean;
}

async function seedLeg(
  groupId: number,
  opts: SeedOptions = {},
): Promise<typeof claimsTable.$inferSelect> {
  const confNumber = `T-BULKQ-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const errorTypeId = opts.disputed === false ? null : "et-test";
  const [leg] = await db.insert(claimsTable).values({
    confNumber,
    status: "Awaiting Response",
    outcome: opts.outcome ?? "Approved",
    errorTypeId,
    errorTypeName: errorTypeId ? "Seeded Error" : null,
    invoiceGroupId: groupId,
    claimAmount: "100.00",
    attestationState: opts.attestationState ?? "not_required",
  }).returning();

  await db.insert(claimVerdictTable).values({
    claimId: leg.id,
    source: opts.verdictSource ?? "operator_confirmed",
    outcome: opts.verdictOutcome ?? "Approved",
  });

  return leg;
}

async function seedGroup(
  opts: { withResponse?: boolean; status?: string } = {},
): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const invoiceNumber = `T-BULKQ-G-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: (opts.status ?? "Needs Review") as any,
    outcome: "Pending",
  }).returning();

  if (opts.withResponse !== false) {
    await db.insert(portalResponsesTable).values({
      source: "email",
      invoiceGroupId: group.id,
      claimId: null,
      content: "Seed payor response so groupHasResponse() returns true.",
      responseType: "other",
    });
  }
  return group;
}

async function cleanupGroup(id: number) {
  const children = await db.select({ id: claimsTable.id }).from(claimsTable).where(eq(claimsTable.invoiceGroupId, id));
  for (const c of children) {
    await db.delete(claimVerdictTable).where(eq(claimVerdictTable.claimId, c.id)).catch(() => undefined);
    await db.delete(portalResponsesTable).where(eq(portalResponsesTable.claimId, c.id)).catch(() => undefined);
    await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, c.id)).catch(() => undefined);
    await db.delete(notesTable).where(eq(notesTable.claimId, c.id)).catch(() => undefined);
    await db.delete(claimEvidenceTable).where(eq(claimEvidenceTable.claimId, c.id)).catch(() => undefined);
    await db.delete(stateEventsTable).where(eq(stateEventsTable.claimId, c.id)).catch(() => undefined);
    await db.delete(claimsTable).where(eq(claimsTable.id, c.id)).catch(() => undefined);
  }
  await db.delete(portalResponsesTable).where(eq(portalResponsesTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(claimEvidenceTable).where(eq(claimEvidenceTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(stateEventsTable).where(eq(stateEventsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)).catch(() => undefined);
}

// ---- Happy path -------------------------------------------------------

test("flips every operator-confirmed Approved/Partial leg from not_required straight to queued in one shot", async () => {
  // Pre-reattest gate state: legs sit at attestation_state = 'not_required'.
  // The bulk endpoint must bypass the per-leg /attest/queue 'pending' source-state
  // requirement and flip them straight to 'queued' anyway.
  const group = await seedGroup();
  const approvedLeg = await seedLeg(group.id, { attestationState: "not_required" });
  const partialLeg = await seedLeg(group.id, {
    attestationState: "not_required",
    outcome: "Partially Approved",
    verdictOutcome: "Partial",
  });
  try {
    const res = await fetchJson<{
      group: { id: number; awaitingPayorAgainAt: string | null };
      queuedLegIds: number[];
    }>(`/api/invoice-groups/${group.id}/reattest/queue`, {
      method: "POST",
      body: { note: "Park for portal user" },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.queuedLegIds.length, 2);
    assert.ok(res.json.queuedLegIds.includes(approvedLeg.id));
    assert.ok(res.json.queuedLegIds.includes(partialLeg.id));

    const [refreshedApproved] = await db.select().from(claimsTable).where(eq(claimsTable.id, approvedLeg.id));
    const [refreshedPartial] = await db.select().from(claimsTable).where(eq(claimsTable.id, partialLeg.id));
    assert.equal(refreshedApproved.attestationState, "queued",
      "Approved leg starting at not_required must move to queued, bypassing the per-leg pending gate");
    assert.equal(refreshedApproved.attestationQueuedBy, TEST_USER.email);
    assert.ok(refreshedApproved.attestationQueuedAt, "attestationQueuedAt must be stamped");
    assert.equal(refreshedApproved.attestationNote, "Park for portal user");
    assert.equal(refreshedPartial.attestationState, "queued",
      "Partially Approved leg with operator_confirmed Partial verdict must also move to queued");
  } finally {
    await cleanupGroup(group.id);
  }
});

test("stamps awaiting_payor_again_at on the group in the same call", async () => {
  const group = await seedGroup();
  await seedLeg(group.id);
  try {
    const before = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.equal(before[0].awaitingPayorAgainAt, null, "fresh group should have no awaiting_payor_again_at stamp");

    const res = await fetchJson<{ group: { awaitingPayorAgainAt: string | null } }>(
      `/api/invoice-groups/${group.id}/reattest/queue`,
      { method: "POST", body: {} },
    );
    assert.equal(res.status, 200);
    assert.ok(res.json.group.awaitingPayorAgainAt,
      "awaiting_payor_again_at must be stamped in the same call so the group drops off Responses Awaiting Review");

    const [refreshed] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.ok(refreshed.awaitingPayorAgainAt, "DB row must reflect the stamp too");
  } finally {
    await cleanupGroup(group.id);
  }
});

test("writes one attestation_queued audit row + state event per leg, plus one umbrella row + event for the group", async () => {
  const group = await seedGroup();
  const a = await seedLeg(group.id);
  const b = await seedLeg(group.id);
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/reattest/queue`, {
      method: "POST",
      body: { note: "Audit-trail test note" },
    });
    assert.equal(res.status, 200);

    // Per-leg audit rows.
    for (const leg of [a, b]) {
      const legAudits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.claimId, leg.id));
      const queuedRow = legAudits.find((r) => r.action === "attestation_queued");
      assert.ok(queuedRow, `leg #${leg.id} must have one attestation_queued audit row`);
      assert.equal((queuedRow!.metadata as any).bulk, true, "metadata.bulk must mark this as a bulk-queue write");
      assert.equal((queuedRow!.metadata as any).source, "group_reattest_queue");
      assert.equal((queuedRow!.metadata as any).from, "not_required");
      assert.equal((queuedRow!.metadata as any).to, "queued");
      assert.equal(queuedRow!.userEmail, TEST_USER.email);

      const legEvents = await db.select().from(stateEventsTable).where(eq(stateEventsTable.claimId, leg.id));
      assert.ok(legEvents.find((e) => e.eventKey === "leg.attestation_queued"),
        `leg #${leg.id} must have one leg.attestation_queued state event row`);
    }

    // Umbrella group audit row + event.
    const groupAudits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, group.id));
    const umbrella = groupAudits.find((r) => r.action === "group_reattest_queued_bulk");
    assert.ok(umbrella, "group must carry one umbrella group_reattest_queued_bulk audit row");
    assert.equal((umbrella!.metadata as any).legCount, 2);
    assert.deepEqual(
      [...((umbrella!.metadata as any).queuedLegIds as number[])].sort((x, y) => x - y),
      [a.id, b.id].sort((x, y) => x - y),
      "umbrella metadata must list every leg id that got queued",
    );

    const groupEvents = await db.select().from(stateEventsTable).where(eq(stateEventsTable.invoiceGroupId, group.id));
    const umbrellaEvents = groupEvents.filter((e) => e.eventKey === "group.reattest_queued_bulk");
    assert.equal(umbrellaEvents.length, 1, "exactly one umbrella state event row");
  } finally {
    await cleanupGroup(group.id);
  }
});

// ---- Eligibility filter ------------------------------------------------

test("excludes legs with non-operator_confirmed verdicts, non-disputed legs, denied legs, and already-completed/queued legs", async () => {
  const group = await seedGroup();
  // Eligible: operator_confirmed Approved, attestation_state not_required.
  const eligible = await seedLeg(group.id);
  // Skipped: latest verdict is operator_draft (not committed yet).
  const draftOnly = await seedLeg(group.id, { verdictSource: "operator_draft" });
  // Skipped: latest verdict is ai_suggested (no human commit).
  const aiOnly = await seedLeg(group.id, { verdictSource: "ai_suggested" });
  // Skipped: outcome is Denied — attestation is meaningless.
  const denied = await seedLeg(group.id, {
    outcome: "Denied",
    verdictOutcome: "Denied",
  });
  // Skipped: not disputed (no errorTypeId).
  const undisputed = await seedLeg(group.id, { disputed: false });
  // Skipped: already completed — attestation is one-way.
  const alreadyDone = await seedLeg(group.id, { attestationState: "completed" });
  // Skipped: already queued — re-stamping would clobber the prior queued_at/by.
  const alreadyQueued = await seedLeg(group.id, { attestationState: "queued" });
  try {
    const res = await fetchJson<{ queuedLegIds: number[] }>(
      `/api/invoice-groups/${group.id}/reattest/queue`,
      { method: "POST", body: {} },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.queuedLegIds, [eligible.id],
      "only the operator-confirmed Approved disputed leg with an owed attestation must be queued");

    // Verify the skipped legs were not touched.
    for (const skipped of [draftOnly, aiOnly, denied, undisputed]) {
      const [row] = await db.select().from(claimsTable).where(eq(claimsTable.id, skipped.id));
      assert.notEqual(row.attestationState, "queued",
        `skipped leg #${skipped.id} (${skipped.outcome}/${row.attestationState}) must NOT be flipped to queued`);
    }
    const [doneRow] = await db.select().from(claimsTable).where(eq(claimsTable.id, alreadyDone.id));
    assert.equal(doneRow.attestationState, "completed", "completed leg must stay completed");
    const [queuedRow] = await db.select().from(claimsTable).where(eq(claimsTable.id, alreadyQueued.id));
    assert.equal(queuedRow.attestationState, "queued", "already-queued leg stays queued (no re-stamp)");
  } finally {
    await cleanupGroup(group.id);
  }
});

// ---- Guard rails -------------------------------------------------------

test("returns 409 when the group has no eligible legs (defense in depth)", async () => {
  const group = await seedGroup();
  // Only an undisputed leg + a Denied leg — neither is eligible.
  await seedLeg(group.id, { disputed: false });
  await seedLeg(group.id, { outcome: "Denied", verdictOutcome: "Denied" });
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/invoice-groups/${group.id}/reattest/queue`,
      { method: "POST", body: {} },
    );
    assert.equal(res.status, 409, `expected 409, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.match(res.json.error, /No eligible legs/i);

    // Defense in depth: no audit row, no state event, no awaiting_payor_again_at stamp.
    const [g] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.equal(g.awaitingPayorAgainAt, null, "409 must NOT have stamped awaiting_payor_again_at");
    const groupAudits = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.invoiceGroupId, group.id));
    assert.equal(
      groupAudits.filter((r) => r.action === "group_reattest_queued_bulk").length,
      0,
      "409 must NOT have written the umbrella audit row",
    );
  } finally {
    await cleanupGroup(group.id);
  }
});

test("returns 409 when the group is not in Needs Review", async () => {
  const group = await seedGroup({ status: "Awaiting Response" });
  await seedLeg(group.id);
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/invoice-groups/${group.id}/reattest/queue`,
      { method: "POST", body: {} },
    );
    assert.equal(res.status, 409);
    assert.match(res.json.error, /Needs Review/i);
  } finally {
    await cleanupGroup(group.id);
  }
});

test("returns 409 when the group has no inbound payor response on file", async () => {
  const group = await seedGroup({ withResponse: false });
  await seedLeg(group.id);
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/invoice-groups/${group.id}/reattest/queue`,
      { method: "POST", body: {} },
    );
    assert.equal(res.status, 409);
    assert.match(res.json.error, /payor response/i);
  } finally {
    await cleanupGroup(group.id);
  }
});

test("returns 404 for a non-existent group id", async () => {
  const res = await fetchJson<{ error: string }>(
    `/api/invoice-groups/99999999/reattest/queue`,
    { method: "POST", body: {} },
  );
  assert.equal(res.status, 404);
});

// ---- Note normalization -------------------------------------------------

test("trims the note and collapses pure-whitespace to null on both leg and group rows", async () => {
  const group = await seedGroup();
  const leg = await seedLeg(group.id);
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/reattest/queue`, {
      method: "POST",
      body: { note: "   \n\t   " },
    });
    assert.equal(res.status, 200);

    const [refreshed] = await db.select().from(claimsTable).where(eq(claimsTable.id, leg.id));
    assert.equal(refreshed.attestationNote, null,
      "pure-whitespace note must collapse to null on the claim row");

    const groupAudits = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.invoiceGroupId, group.id))
      .orderBy(desc(auditLogsTable.timestamp));
    const umbrella = groupAudits.find((r) => r.action === "group_reattest_queued_bulk");
    assert.equal((umbrella!.metadata as any).note, null,
      "pure-whitespace note must collapse to null on the umbrella audit row");
  } finally {
    await cleanupGroup(group.id);
  }
});

// GET /invoice-groups/attestation-history — feeds the "Completed
// re-attestations" tab on the Attestation Queue page.
//
// Coverage:
//   - excludes groups with `reattestCompletedAt = null`;
//   - 7d window excludes groups completed > 7 days ago;
//   - 30d window includes the same row that 7d excluded;
//   - all-window returns everything regardless of age;
//   - sort order: most-recently-completed first;
//   - per-leg attestationOutcome classification covers all 4 buckets
//     (`attested`, `mas_cancelled`, `queued`, `not_required`);
//   - 401 when isAuthenticated() returns false;
//   - truncated=true once row count exceeds the cap.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, inArray } from "drizzle-orm";

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
// Toggleable auth flag flipped per-test. Mounting the router in
// isolation means we control the auth signal directly; the route
// only refuses callers whose `isAuthenticated()` explicitly returns
// false, so flipping this to false drives the 401 branch.
let authed = true;

const TEST_USER = { email: "history-tester@example.com", displayName: "History Tester" };

before(async () => {
  const app: Express = express();
  app.use(express.json());

  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved" };
    (req as any).isAuthenticated = () => authed;
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

interface SeedGroupOpts {
  reattestCompletedAt?: Date | null;
  reattestCompletedBy?: string | null;
  reattestNote?: string | null;
}

async function seedGroup(opts: SeedGroupOpts = {}): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const invoiceNumber = `T-HIST-G-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [g] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: "Awaiting Response",
    outcome: "Pending",
    reattestRequired: true,
    reattestCompletedAt: opts.reattestCompletedAt ?? null,
    reattestCompletedBy: opts.reattestCompletedBy ?? null,
    reattestNote: opts.reattestNote ?? null,
  }).returning();
  return g;
}

interface SeedLegOpts {
  attestationState?: "not_required" | "pending" | "queued" | "completed";
  attestedAt?: Date | null;
  attestedBy?: string | null;
  attestationNote?: string | null;
  attestationQueuedAt?: Date | null;
  attestationQueuedBy?: string | null;
  masActionRequired?: "cancel" | "none" | null;
  masActionCompletedAt?: Date | null;
  masActionCompletedBy?: string | null;
  masActionNote?: string | null;
  outcome?: "Pending" | "Approved" | "Partially Approved" | "Denied";
}

async function seedLeg(groupId: number, opts: SeedLegOpts = {}): Promise<typeof claimsTable.$inferSelect> {
  const confNumber = `T-HIST-L-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [c] = await db.insert(claimsTable).values({
    confNumber,
    status: "Awaiting Response",
    outcome: opts.outcome ?? "Approved",
    invoiceGroupId: groupId,
    claimAmount: "100.00",
    attestationState: opts.attestationState ?? "not_required",
    attestedAt: opts.attestedAt ?? null,
    attestedBy: opts.attestedBy ?? null,
    attestationNote: opts.attestationNote ?? null,
    attestationQueuedAt: opts.attestationQueuedAt ?? null,
    attestationQueuedBy: opts.attestationQueuedBy ?? null,
    masActionRequired: opts.masActionRequired ?? null,
    masActionCompletedAt: opts.masActionCompletedAt ?? null,
    masActionCompletedBy: opts.masActionCompletedBy ?? null,
    masActionNote: opts.masActionNote ?? null,
  }).returning();
  return c;
}

async function cleanupGroup(id: number): Promise<void> {
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

interface HistoryResponse {
  groups: Array<{
    group: { id: number; invoiceNumber: string; reattestCompletedAt: string | null };
    legs: Array<{
      claim: { id: number; confNumber: string };
      attestationOutcome: "attested" | "mas_cancelled" | "queued" | "not_required";
      outcomeAt: string | null;
      outcomeBy: string | null;
      outcomeNote: string | null;
    }>;
  }>;
  truncated: boolean;
}

const dayMs = 24 * 60 * 60 * 1000;

// ---- Window filter ---------------------------------------------------

test("excludes groups whose reattestCompletedAt is null", async () => {
  const inWindow = await seedGroup({ reattestCompletedAt: new Date(Date.now() - 1 * dayMs) });
  const noReattest = await seedGroup({ reattestCompletedAt: null });
  try {
    const res = await fetchJson<HistoryResponse>("/api/invoice-groups/attestation-history?range=7d");
    assert.equal(res.status, 200);
    const ids = res.json.groups.map((g) => g.group.id);
    assert.ok(ids.includes(inWindow.id), "completed-in-window group must be in the response");
    assert.ok(!ids.includes(noReattest.id), "groups with null reattestCompletedAt must be excluded");
  } finally {
    await cleanupGroup(inWindow.id);
    await cleanupGroup(noReattest.id);
  }
});

test("7d window excludes a group completed 8 days ago, 30d and all include it", async () => {
  const eightDaysAgo = await seedGroup({ reattestCompletedAt: new Date(Date.now() - 8 * dayMs) });
  try {
    const r7 = await fetchJson<HistoryResponse>("/api/invoice-groups/attestation-history?range=7d");
    const r30 = await fetchJson<HistoryResponse>("/api/invoice-groups/attestation-history?range=30d");
    const rAll = await fetchJson<HistoryResponse>("/api/invoice-groups/attestation-history?range=all");
    assert.equal(r7.status, 200);
    assert.equal(r30.status, 200);
    assert.equal(rAll.status, 200);
    assert.ok(!r7.json.groups.some((g) => g.group.id === eightDaysAgo.id), "7d window must exclude the 8-day-old row");
    assert.ok(r30.json.groups.some((g) => g.group.id === eightDaysAgo.id), "30d window must include the 8-day-old row");
    assert.ok(rAll.json.groups.some((g) => g.group.id === eightDaysAgo.id), "all window must include the 8-day-old row");
  } finally {
    await cleanupGroup(eightDaysAgo.id);
  }
});

// ---- Sort order ------------------------------------------------------

test("groups are sorted by reattestCompletedAt DESC", async () => {
  const older = await seedGroup({ reattestCompletedAt: new Date(Date.now() - 3 * dayMs) });
  const newer = await seedGroup({ reattestCompletedAt: new Date(Date.now() - 1 * dayMs) });
  try {
    const res = await fetchJson<HistoryResponse>("/api/invoice-groups/attestation-history?range=7d");
    assert.equal(res.status, 200);
    const ourIds = res.json.groups.map((g) => g.group.id).filter((id) => id === older.id || id === newer.id);
    assert.deepEqual(ourIds, [newer.id, older.id], "newest reattest_completed_at must come first");
  } finally {
    await cleanupGroup(older.id);
    await cleanupGroup(newer.id);
  }
});

// ---- Per-leg outcome classification ----------------------------------

test("classifies legs into all four attestationOutcome buckets", async () => {
  const group = await seedGroup({ reattestCompletedAt: new Date(Date.now() - 1 * dayMs) });
  // attested: leg has an attestedAt stamp
  const attestedLeg = await seedLeg(group.id, {
    attestationState: "completed",
    attestedAt: new Date(Date.now() - 30 * 60 * 1000),
    attestedBy: "attester@example.com",
    attestationNote: "confirmed in MAS",
  });
  // mas_cancelled: masActionRequired='cancel' AND completed stamp set,
  // but no attestedAt (a Denied leg that resolved via cancel rather
  // than re-attestation)
  const cancelledLeg = await seedLeg(group.id, {
    outcome: "Denied",
    masActionRequired: "cancel",
    masActionCompletedAt: new Date(Date.now() - 60 * 60 * 1000),
    masActionCompletedBy: "canceller@example.com",
    masActionNote: "MAS cancel done",
  });
  // queued: attestation_state='queued', no attestedAt
  const queuedLeg = await seedLeg(group.id, {
    attestationState: "queued",
    attestationQueuedAt: new Date(Date.now() - 90 * 60 * 1000),
    attestationQueuedBy: "queuer@example.com",
    attestationNote: "park for portal user",
  });
  // not_required: nothing of the above
  const otherLeg = await seedLeg(group.id, {
    attestationState: "not_required",
  });
  try {
    const res = await fetchJson<HistoryResponse>("/api/invoice-groups/attestation-history?range=7d");
    assert.equal(res.status, 200);
    const entry = res.json.groups.find((g) => g.group.id === group.id);
    assert.ok(entry, "seeded group must appear in the response");
    const byClaimId = new Map(entry!.legs.map((l) => [l.claim.id, l]));
    assert.equal(byClaimId.get(attestedLeg.id)?.attestationOutcome, "attested");
    assert.equal(byClaimId.get(attestedLeg.id)?.outcomeBy, "attester@example.com");
    assert.equal(byClaimId.get(attestedLeg.id)?.outcomeNote, "confirmed in MAS");
    assert.ok(byClaimId.get(attestedLeg.id)?.outcomeAt, "attested leg must carry an outcomeAt stamp");

    assert.equal(byClaimId.get(cancelledLeg.id)?.attestationOutcome, "mas_cancelled");
    assert.equal(byClaimId.get(cancelledLeg.id)?.outcomeBy, "canceller@example.com");
    assert.equal(byClaimId.get(cancelledLeg.id)?.outcomeNote, "MAS cancel done");

    assert.equal(byClaimId.get(queuedLeg.id)?.attestationOutcome, "queued");
    assert.equal(byClaimId.get(queuedLeg.id)?.outcomeBy, "queuer@example.com");
    assert.equal(byClaimId.get(queuedLeg.id)?.outcomeNote, "park for portal user");

    assert.equal(byClaimId.get(otherLeg.id)?.attestationOutcome, "not_required");
    assert.equal(byClaimId.get(otherLeg.id)?.outcomeAt, null);
    assert.equal(byClaimId.get(otherLeg.id)?.outcomeBy, null);
  } finally {
    await cleanupGroup(group.id);
  }
});

// ---- Auth ------------------------------------------------------------

test("returns 401 when isAuthenticated() returns false", async () => {
  authed = false;
  try {
    const res = await fetchJson<{ error: string }>("/api/invoice-groups/attestation-history?range=7d");
    assert.equal(res.status, 401);
  } finally {
    authed = true;
  }
});

// ---- Cap / truncated -------------------------------------------------

test("truncated=true once the result set exceeds the 200-row cap", async () => {
  // Seed 201 groups all in-window. Stagger reattestCompletedAt so the
  // sort order is deterministic and our seeded rows occupy the head of
  // the response (most-recently-completed first), which the cap then
  // slices to exactly 200.
  const created: number[] = [];
  try {
    for (let i = 0; i < 201; i++) {
      // Spread 1ms apart so DESC sort picks the newest rows first; all
      // still < 7d to stay inside the default window.
      const stamp = new Date(Date.now() - (i + 1));
      const g = await seedGroup({ reattestCompletedAt: stamp });
      created.push(g.id);
    }
    const res = await fetchJson<HistoryResponse>("/api/invoice-groups/attestation-history?range=7d");
    assert.equal(res.status, 200);
    assert.equal(res.json.truncated, true, "201 in-window rows must produce truncated=true");
    assert.equal(res.json.groups.length, 200, "response must be capped at exactly 200 rows");
  } finally {
    // Cleanup in chunks to keep delete predicates manageable.
    for (const id of created) {
      await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)).catch(() => undefined);
    }
    // Also clear any orphaned audit/state rows in one shot.
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.invoiceGroupId, created)).catch(() => undefined);
    await db.delete(stateEventsTable).where(inArray(stateEventsTable.invoiceGroupId, created)).catch(() => undefined);
  }
});

// Route + transition tests for re-attestation tracking.
//
// Coverage:
//   - claim-level: PATCH /claims/:id/outcome to Approved auto-sets
//     attestationState=pending; flipping back to a non-Approved outcome
//     clears the state to not_required.
//   - group-level: PATCH /invoice-groups/:id/outcome cascades the same
//     pending transition to disputed children only.
//   - actions: /attest, /attest/queue, and /attest/confirm move the row
//     through the state machine and write the right audit-log keys.
//   - guards: actions on a non-Approved claim are 409; the count endpoint
//     returns the right pending/queued totals.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, desc } from "drizzle-orm";

import claimsRouter from "../routes/claims";
import invoiceGroupsRouter from "../routes/invoice-groups";
import { computeAttestationDelta } from "../lib/attestation";
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
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;

const TEST_USER = { email: "attest-tester@example.com", displayName: "Attestation Tester" };

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

async function createSeedClaim(opts: {
  status?: "New" | "Needs Review" | "Needs Evidence" | "Awaiting Response";
  errorTypeId?: string | null;
  invoiceGroupId?: number | null;
  outcome?: "Pending" | "Approved" | "Partially Approved" | "Denied";
} = {}): Promise<typeof claimsTable.$inferSelect> {
  const confNumber = `T165-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  // `??` would coalesce explicit `null` into the default, so we use a
  // hasOwnProperty check here — passing errorTypeId: null must mean
  // "create an undisputed sibling claim".
  const errorTypeId = Object.prototype.hasOwnProperty.call(opts, "errorTypeId")
    ? opts.errorTypeId ?? null
    : "et-test";
  const [row] = await db.insert(claimsTable).values({
    confNumber,
    status: opts.status ?? "Awaiting Response",
    outcome: opts.outcome ?? "Pending",
    errorTypeId,
    errorTypeName: errorTypeId ? "Seeded Error" : null,
    invoiceGroupId: opts.invoiceGroupId ?? null,
    claimAmount: "100.00",
  }).returning();
  return row;
}

async function createSeedGroup(): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const invoiceNumber = `T165G-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: "Awaiting Response",
    outcome: "Pending",
  }).returning();
  return row;
}

async function cleanupClaim(id: number) {
  await db.delete(portalResponsesTable).where(eq(portalResponsesTable.claimId, id)).catch(() => undefined);
  await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.claimId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, id)).catch(() => undefined);
  await db.delete(notesTable).where(eq(notesTable.claimId, id)).catch(() => undefined);
  await db.delete(claimEvidenceTable).where(eq(claimEvidenceTable.claimId, id)).catch(() => undefined);
  await db.delete(claimsTable).where(eq(claimsTable.id, id)).catch(() => undefined);
}

async function cleanupGroup(id: number) {
  const children = await db.select({ id: claimsTable.id }).from(claimsTable).where(eq(claimsTable.invoiceGroupId, id));
  for (const c of children) await cleanupClaim(c.id);
  await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(claimEvidenceTable).where(eq(claimEvidenceTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)).catch(() => undefined);
}

// ---- Auto-transition on outcome change ---------------------------------

test("claim outcome → Approved auto-sets attestationState=pending", async () => {
  const seed = await createSeedClaim();
  try {
    const res = await fetchJson<typeof claimsTable.$inferSelect>(
      `/api/claims/${seed.id}/outcome`,
      { method: "PATCH", body: { outcome: "Approved", approvedAmount: "100.00" } },
    );
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.outcome, "Approved");
    assert.equal(res.json.attestationState, "pending",
      "Approved verdict must auto-set attestationState=pending so the dashboard surfaces the next step");
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("claim outcome → Partially Approved also sets attestationState=pending", async () => {
  const seed = await createSeedClaim();
  try {
    const res = await fetchJson<typeof claimsTable.$inferSelect>(
      `/api/claims/${seed.id}/outcome`,
      { method: "PATCH", body: { outcome: "Partially Approved", approvedAmount: "50.00" } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.attestationState, "pending");
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("computeAttestationDelta: Approved → non-Approved resets attestation fields", () => {
  // The route-level revert path is gated by other workflow rules (you can't
  // jump back to Pending, Denied requires a recorded response, etc.), so we
  // unit-test the delta helper directly. Both transition functions
  // (claim-level and group-level) call this same helper, so this guarantees
  // the cleanup behavior regardless of which route gets used.
  const delta = computeAttestationDelta("Approved", "Withdrawn");
  assert.equal(delta.attestationState, "not_required",
    "Moving out of an Approved verdict must reset attestationState");
  assert.equal(delta.attestedAt, null);
  assert.equal(delta.attestedBy, null);
  assert.equal(delta.attestationNote, null);
  assert.equal(delta.attestationQueuedAt, null);
  assert.equal(delta.attestationQueuedBy, null);
});

test("computeAttestationDelta: Approved → Approved (no-op) keeps in-flight attestation untouched", () => {
  // We must NOT re-stamp pending or wipe stamps when nothing real is
  // changing — otherwise re-saving an Approved row would clobber a partly-
  // completed attestation.
  const delta = computeAttestationDelta("Approved", "Partially Approved");
  assert.deepEqual(delta, {},
    "Sideways flips within the Approved family must produce no attestation delta");
});

// ---- Action endpoints ---------------------------------------------------

test("POST /claims/:id/attest moves pending → completed and writes the self-confirmed audit log", async () => {
  const seed = await createSeedClaim();
  try {
    await fetchJson(`/api/claims/${seed.id}/outcome`, {
      method: "PATCH", body: { outcome: "Approved", approvedAmount: "100.00" },
    });
    const res = await fetchJson<typeof claimsTable.$inferSelect>(
      `/api/claims/${seed.id}/attest`,
      { method: "POST", body: { note: "Confirmation #ABC" } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.attestationState, "completed");
    assert.equal(res.json.attestedBy, TEST_USER.email);
    assert.equal(res.json.attestationNote, "Confirmation #ABC");

    const logs = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.claimId, seed.id))
      .orderBy(desc(auditLogsTable.timestamp));
    const log = logs.find((l) => l.action === "attestation_self_confirmed");
    assert.ok(log, `expected attestation_self_confirmed audit log, got ${JSON.stringify(logs.map((l) => l.action))}`);
    assert.equal((log!.metadata as any)?.from, "pending");
    assert.equal((log!.metadata as any)?.to, "completed");
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("POST /claims/:id/attest/queue moves pending → queued and records who parked it", async () => {
  const seed = await createSeedClaim();
  try {
    await fetchJson(`/api/claims/${seed.id}/outcome`, {
      method: "PATCH", body: { outcome: "Approved", approvedAmount: "100.00" },
    });
    const res = await fetchJson<typeof claimsTable.$inferSelect>(
      `/api/claims/${seed.id}/attest/queue`,
      { method: "POST", body: { note: "Park for Sarah" } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.attestationState, "queued");
    assert.equal(res.json.attestationQueuedBy, TEST_USER.email);
    assert.equal(res.json.attestedAt, null);

    const logs = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.claimId, seed.id));
    assert.ok(logs.find((l) => l.action === "attestation_queued"),
      `expected attestation_queued audit log, got ${JSON.stringify(logs.map((l) => l.action))}`);
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("POST /claims/:id/attest/confirm moves queued → completed with the queue-confirm audit key", async () => {
  const seed = await createSeedClaim();
  try {
    await fetchJson(`/api/claims/${seed.id}/outcome`, {
      method: "PATCH", body: { outcome: "Approved", approvedAmount: "100.00" },
    });
    await fetchJson(`/api/claims/${seed.id}/attest/queue`, { method: "POST", body: {} });
    const res = await fetchJson<typeof claimsTable.$inferSelect>(
      `/api/claims/${seed.id}/attest/confirm`,
      { method: "POST", body: {} },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.attestationState, "completed");
    assert.equal(res.json.attestedBy, TEST_USER.email);

    const logs = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.claimId, seed.id));
    assert.ok(logs.find((l) => l.action === "attestation_queue_confirmed"),
      "queue-confirm flow must write attestation_queue_confirmed (not the self-confirmed key) so the audit story stays accurate");
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("attest action on a non-Approved claim returns 409", async () => {
  const seed = await createSeedClaim({ outcome: "Denied" });
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/claims/${seed.id}/attest`,
      { method: "POST", body: {} },
    );
    assert.equal(res.status, 409, `expected 409, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.match(res.json.error, /Approved/i);
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("POST /claims/:id/attest/confirm on a pending (un-queued) claim returns 409", async () => {
  // The /confirm endpoint is for the queue-review flow only — calling it on
  // a freshly-Approved (pending) claim would log the wrong audit key, so
  // the route must reject it with 409.
  const seed = await createSeedClaim();
  try {
    await fetchJson(`/api/claims/${seed.id}/outcome`, {
      method: "PATCH", body: { outcome: "Approved", approvedAmount: "100.00" },
    });
    const res = await fetchJson<{ error: string }>(
      `/api/claims/${seed.id}/attest/confirm`,
      { method: "POST", body: {} },
    );
    assert.equal(res.status, 409, `expected 409 for confirm-on-pending, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.match(res.json.error, /queued/i);
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("POST /claims/:id/attest on a queued claim returns 409 (must use /confirm)", async () => {
  // The /attest endpoint logs attestation_self_confirmed. Once a claim has
  // already been parked into the review queue, using this endpoint would
  // produce an audit log that contradicts the operational reality (the
  // claim went through review, not a same-session self-confirm).
  const seed = await createSeedClaim();
  try {
    await fetchJson(`/api/claims/${seed.id}/outcome`, {
      method: "PATCH", body: { outcome: "Approved", approvedAmount: "100.00" },
    });
    await fetchJson(`/api/claims/${seed.id}/attest/queue`, { method: "POST", body: {} });
    const res = await fetchJson<{ error: string }>(
      `/api/claims/${seed.id}/attest`,
      { method: "POST", body: {} },
    );
    assert.equal(res.status, 409, `expected 409 for self-confirm-on-queued, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.match(res.json.error, /pending/i);
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("POST /claims/:id/attest/queue on an already-queued claim returns 409", async () => {
  // Re-queueing a claim that's already queued is a no-op state-wise but
  // would either overwrite the queued-by metadata or split the audit into
  // multiple "queued" entries that look like duplicate work — neither is
  // helpful. Reject with 409 so the caller knows the state is preserved.
  const seed = await createSeedClaim();
  try {
    await fetchJson(`/api/claims/${seed.id}/outcome`, {
      method: "PATCH", body: { outcome: "Approved", approvedAmount: "100.00" },
    });
    await fetchJson(`/api/claims/${seed.id}/attest/queue`, { method: "POST", body: {} });
    const res = await fetchJson<{ error: string }>(
      `/api/claims/${seed.id}/attest/queue`,
      { method: "POST", body: {} },
    );
    assert.equal(res.status, 409, `expected 409 for re-queue, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.match(res.json.error, /pending/i);
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("attest action on an already-completed claim returns 409 (no double-attestation)", async () => {
  const seed = await createSeedClaim();
  try {
    await fetchJson(`/api/claims/${seed.id}/outcome`, {
      method: "PATCH", body: { outcome: "Approved", approvedAmount: "100.00" },
    });
    await fetchJson(`/api/claims/${seed.id}/attest`, { method: "POST", body: {} });
    const res = await fetchJson<{ error: string }>(
      `/api/claims/${seed.id}/attest`,
      { method: "POST", body: {} },
    );
    assert.equal(res.status, 409);
  } finally {
    await cleanupClaim(seed.id);
  }
});

// ---- Counts + queue listing --------------------------------------------

test("GET /attestation/counts splits pending and queued correctly", async () => {
  const a = await createSeedClaim();
  const b = await createSeedClaim();
  try {
    // a: pending. b: queued.
    await fetchJson(`/api/claims/${a.id}/outcome`, {
      method: "PATCH", body: { outcome: "Approved", approvedAmount: "100.00" },
    });
    await fetchJson(`/api/claims/${b.id}/outcome`, {
      method: "PATCH", body: { outcome: "Approved", approvedAmount: "100.00" },
    });
    await fetchJson(`/api/claims/${b.id}/attest/queue`, { method: "POST", body: {} });

    const res = await fetchJson<{ pending: number; queued: number }>(`/api/attestation/counts`);
    assert.equal(res.status, 200);
    // Other tests in the suite may concurrently leave claims in pending /
    // queued, so we only assert the floor for this scenario rather than an
    // exact equality.
    assert.ok(res.json.pending >= 1, `expected at least 1 pending, got ${res.json.pending}`);
    assert.ok(res.json.queued >= 1, `expected at least 1 queued, got ${res.json.queued}`);
  } finally {
    await cleanupClaim(a.id);
    await cleanupClaim(b.id);
  }
});

test("GET /claims/attestation-pending?state=queued returns only queued claims", async () => {
  const seed = await createSeedClaim();
  try {
    await fetchJson(`/api/claims/${seed.id}/outcome`, {
      method: "PATCH", body: { outcome: "Approved", approvedAmount: "100.00" },
    });
    await fetchJson(`/api/claims/${seed.id}/attest/queue`, { method: "POST", body: {} });

    const res = await fetchJson<{ claims: Array<{ id: number; attestationState: string }> }>(
      `/api/claims/attestation-pending?state=queued`,
    );
    assert.equal(res.status, 200);
    const found = res.json.claims.find((c) => c.id === seed.id);
    assert.ok(found, "queued claim should appear in the queued list");
    assert.equal(found!.attestationState, "queued");
    assert.ok(res.json.claims.every((c) => c.attestationState === "queued"),
      "queue listing must not leak claims in other attestation states");
  } finally {
    await cleanupClaim(seed.id);
  }
});

// ---- Group cascade ------------------------------------------------------

// ---- Unauthenticated rejection -----------------------------------------

test("all attestation endpoints reject unauthenticated callers with 401", async () => {
  // Spin up a parallel server that mounts requireAuth in front of the
  // claimsRouter, so the test exercises the same gating users see in
  // production. Using a fresh app keeps it cleanly isolated from the
  // pre-authed shim used elsewhere in this file.
  const { requireAuth } = await import("../middlewares/requireAuth");
  const unauthedApp: Express = express();
  unauthedApp.use(express.json());
  unauthedApp.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).isAuthenticated = () => false;
    (req as any).user = undefined;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  unauthedApp.use("/api", requireAuth, claimsRouter);

  const unauthedServer = await new Promise<http.Server>((resolveListen, rejectListen) => {
    const s = unauthedApp.listen(0, () => {
      const addr = s.address();
      if (typeof addr === "object" && addr) resolveListen(s);
      else rejectListen(new Error("Failed to obtain test server port"));
    });
  });
  const addr = unauthedServer.address();
  const unauthedBase = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";

  async function unauthedFetch(path: string, method: string, body?: unknown): Promise<number> {
    const url = new URL(`${unauthedBase}${path}`);
    return new Promise((resolveReq, rejectReq) => {
      const payload = body !== undefined ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method,
          headers: payload
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload).toString() }
            : {},
        },
        (res) => {
          res.on("data", () => undefined);
          res.on("end", () => resolveReq(res.statusCode ?? 0));
        },
      );
      req.on("error", rejectReq);
      if (payload) req.write(payload);
      req.end();
    });
  }

  try {
    // Every endpoint introduced in this task must 401 when unauthenticated:
    // the listing surface, all three actions, and the counts endpoint.
    const cases: Array<[string, string, unknown?]> = [
      ["/api/claims/attestation-pending", "GET"],
      ["/api/claims/attestation-pending?state=queued", "GET"],
      ["/api/claims/1/attest", "POST", {}],
      ["/api/claims/1/attest/queue", "POST", {}],
      ["/api/claims/1/attest/confirm", "POST", {}],
      ["/api/attestation/counts", "GET"],
    ];
    for (const [path, method, body] of cases) {
      const status = await unauthedFetch(path, method, body);
      assert.equal(status, 401, `${method} ${path} must 401 for unauthenticated callers (got ${status})`);
    }
  } finally {
    unauthedServer.closeAllConnections?.();
    await new Promise<void>((resolveClose) => unauthedServer.close(() => resolveClose()));
  }
});

// ---- Group cascade ------------------------------------------------------

test("group outcome → Approved cascades pending attestation to disputed children (post-reattest gate)", async () => {
  // Per Task #196, the cascade only engages once the group's MAS re-attest
  // has been stamped complete. We pre-stamp `reattest_completed_at` here so
  // the gate is open before the outcome flip; without that stamp, the
  // dedicated gate-closed test below verifies the cascade stays parked.
  const group = await createSeedGroup();
  await db.update(invoiceGroupsTable)
    .set({ reattestRequired: true, reattestCompletedAt: new Date() })
    .where(eq(invoiceGroupsTable.id, group.id));
  const child = await createSeedClaim({ invoiceGroupId: group.id });
  // A non-disputed sibling (no errorTypeId) should NOT pick up an attestation
  // state — only disputed claims need re-attestation.
  const sibling = await createSeedClaim({ invoiceGroupId: group.id, errorTypeId: null });
  try {
    const res = await fetchJson<typeof invoiceGroupsTable.$inferSelect>(
      `/api/invoice-groups/${group.id}/outcome`,
      { method: "PATCH", body: { outcome: "Approved", approvedAmount: "100.00" } },
    );
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);

    const [refreshedChild] = await db.select().from(claimsTable).where(eq(claimsTable.id, child.id));
    const [refreshedSibling] = await db.select().from(claimsTable).where(eq(claimsTable.id, sibling.id));
    assert.equal(refreshedChild.attestationState, "pending",
      "disputed child of an Approved group must inherit attestationState=pending once reattest is complete");
    assert.equal(refreshedSibling.attestationState, "not_required",
      "non-disputed siblings (no errorTypeId) must not be rolled into the attestation queue");
  } finally {
    await cleanupGroup(group.id);
  }
});

test("group outcome → Approved with reattest gate CLOSED parks children at not_required", async () => {
  // Mirror of the test above with the gate intentionally closed: we don't
  // stamp `reattest_completed_at`, so even though the outcome flips to
  // Approved the disputed children must NOT engage attestation. This is
  // the new Task #196 behavior — verdicts capture, but engagement waits.
  const group = await createSeedGroup();
  const child = await createSeedClaim({ invoiceGroupId: group.id });
  try {
    const res = await fetchJson<typeof invoiceGroupsTable.$inferSelect>(
      `/api/invoice-groups/${group.id}/outcome`,
      { method: "PATCH", body: { outcome: "Approved", approvedAmount: "100.00" } },
    );
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);

    const [refreshedChild] = await db.select().from(claimsTable).where(eq(claimsTable.id, child.id));
    assert.equal(refreshedChild.attestationState, "not_required",
      "with reattest_completed_at unset, the gate keeps the disputed child at not_required");
  } finally {
    await cleanupGroup(group.id);
  }
});

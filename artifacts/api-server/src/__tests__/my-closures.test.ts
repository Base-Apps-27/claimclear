// Task #889 — focused route tests for /api/my-closures:
//   • cross-role 403       — IT-coordinator cannot address an agent_mistake row
//   • address success      — matching role addresses with ≥10 char note → 200
//   • stale 409            — second address attempt on already-acknowledged row
//   • reopen happy path    — same user reopens within 24h
//   • reopen >24h forbids  — backdated acknowledgement returns 403
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, count } from "drizzle-orm";

import myClosuresRouter from "../routes/my-closures";
import {
  db,
  pool,
  usersTable,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;
let currentUser: { id: string; email: string; displayName: string };

const userItCoo = {
  id: `tu-it-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  email: `it-${Date.now()}@example.com`,
  displayName: "IT Coordinator Tester",
};
const userContact = {
  id: `tu-cc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  email: `cc-${Date.now()}@example.com`,
  displayName: "Contact Center Tester",
};

before(async () => {
  // Seed two real users — loadCurrentRoles re-reads from DB each call.
  await db.insert(usersTable).values([
    {
      id: userItCoo.id, email: userItCoo.email,
      firstName: "IT", lastName: "Coordinator",
      role: "user", status: "approved",
      responsibleRoles: ["it_coordinator_or_coo"],
    },
    {
      id: userContact.id, email: userContact.email,
      firstName: "Contact", lastName: "Center",
      role: "user", status: "approved",
      responsibleRoles: ["contact_center_manager"],
    },
  ]).onConflictDoNothing();

  currentUser = userItCoo;

  const app: Express = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...currentUser, status: "approved" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", myClosuresRouter);

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
  // Best-effort cleanup; failures here shouldn't fail the run.
  await db.delete(usersTable).where(eq(usersTable.id, userItCoo.id)).catch(() => undefined);
  await db.delete(usersTable).where(eq(usersTable.id, userContact.id)).catch(() => undefined);
  await pool.end().catch(() => undefined);
});

function setActor(u: typeof userItCoo) {
  currentUser = u;
}

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
          : undefined,
      },
      (resp) => {
        let data = "";
        resp.setEncoding("utf8");
        resp.on("data", (chunk) => { data += chunk; });
        resp.on("end", () => {
          try {
            resolveReq({ status: resp.statusCode ?? 0, json: data ? JSON.parse(data) as T : (undefined as T) });
          } catch {
            resolveReq({ status: resp.statusCode ?? 0, json: data as unknown as T });
          }
        });
      },
    );
    req.on("error", rejectReq);
    if (body) req.write(body);
    req.end();
  });
}

async function seedClaim(responsibility: string): Promise<number> {
  const [row] = await db.insert(claimsTable).values({
    confNumber: `T889-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    status: "Resolved",
    outcome: "Withdrawn",
    disposition: "disposed_withdraw",
    closureReason: "cannot_dispute",
    closureResponsibility: responsibility,
    closureReviewState: "pending",
  }).returning({ id: claimsTable.id });
  return row!.id;
}

async function cleanupClaim(id: number) {
  await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, id)).catch(() => undefined);
  await db.delete(claimsTable).where(eq(claimsTable.id, id)).catch(() => undefined);
}

// ────────────────────────────────────────────────────────────────────────

test("cross-role 403: IT coordinator cannot address an agent_mistake claim", async () => {
  setActor(userItCoo);
  const id = await seedClaim("agent_mistake"); // routes to contact_center_manager
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/my-closures/claim/${id}/address`,
      { method: "POST", body: { note: "fixed the routing rule" } },
    );
    assert.equal(res.status, 403, `expected 403, got ${res.status} (${JSON.stringify(res.json)})`);
    const after = await db.select({
      st: claimsTable.closureReviewState,
      at: claimsTable.closureAddressedAt,
    }).from(claimsTable).where(eq(claimsTable.id, id));
    assert.equal(after[0]?.st, "pending", "refused request must not mutate review state");
    assert.equal(after[0]?.at, null, "refused request must not stamp addressedAt");
    // Task #889 refusal-path contract: NO audit row is written when
    // the request is refused — otherwise audit log fills with noise
    // and an operator can't distinguish real activity.
    const [{ value: auditCount }] = await db
      .select({ value: count() })
      .from(auditLogsTable)
      .where(eq(auditLogsTable.claimId, id));
    assert.equal(Number(auditCount), 0, "refused cross-role request must not insert audit row");
  } finally {
    await cleanupClaim(id);
  }
});

test("address success + stale 409: matching role acknowledges, second attempt 409s", async () => {
  setActor(userItCoo);
  const id = await seedClaim("system_error"); // routes to it_coordinator_or_coo
  try {
    const ok = await fetchJson<{ ok: boolean; reviewState: string }>(
      `/api/my-closures/claim/${id}/address`,
      { method: "POST", body: { note: "rebuilt the integration token" } },
    );
    assert.equal(ok.status, 200, `expected 200, got ${ok.status} (${JSON.stringify(ok.json)})`);
    assert.equal(ok.json.reviewState, "acknowledged_by_party");

    const dup = await fetchJson<{ error: string }>(
      `/api/my-closures/claim/${id}/address`,
      { method: "POST", body: { note: "trying to acknowledge again" } },
    );
    assert.equal(dup.status, 409, `expected 409 on duplicate, got ${dup.status}`);
  } finally {
    await cleanupClaim(id);
  }
});

test("null prior review state: legacy row can still be acknowledged (CAS null-safe)", async () => {
  setActor(userItCoo);
  const id = await seedClaim("system_error");
  try {
    // Simulate a legacy row whose closure_review_state was never set.
    await db.update(claimsTable)
      .set({ closureReviewState: null })
      .where(eq(claimsTable.id, id));

    const res = await fetchJson<{ ok: boolean; reviewState: string }>(
      `/api/my-closures/claim/${id}/address`,
      { method: "POST", body: { note: "legacy row, first acknowledgement" } },
    );
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.reviewState, "acknowledged_by_party");
  } finally {
    await cleanupClaim(id);
  }
});

test("note minimum: <10 chars returns 400, no mutation", async () => {
  setActor(userItCoo);
  const id = await seedClaim("system_error");
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/my-closures/claim/${id}/address`,
      { method: "POST", body: { note: "too short" } },
    );
    assert.equal(res.status, 400);
    const row = await db.select({ st: claimsTable.closureReviewState })
      .from(claimsTable).where(eq(claimsTable.id, id));
    assert.equal(row[0]?.st, "pending");
    const [{ value: auditCount }] = await db
      .select({ value: count() })
      .from(auditLogsTable)
      .where(eq(auditLogsTable.claimId, id));
    assert.equal(Number(auditCount), 0, "validation-rejected request must not insert audit row");
  } finally {
    await cleanupClaim(id);
  }
});

test("reopen within 24h: original acknowledger may reopen", async () => {
  setActor(userItCoo);
  const id = await seedClaim("system_error");
  try {
    const ack = await fetchJson(`/api/my-closures/claim/${id}/address`, {
      method: "POST", body: { note: "first acknowledgement — investigating" },
    });
    assert.equal(ack.status, 200);

    const reopen = await fetchJson<{ ok: boolean; reviewState: string }>(
      `/api/my-closures/claim/${id}/reopen`,
      { method: "POST", body: { note: "false alarm — needs rework" } },
    );
    assert.equal(reopen.status, 200, `expected 200, got ${reopen.status} (${JSON.stringify(reopen.json)})`);
    assert.equal(reopen.json.reviewState, "pending");
    // Task #889 spec: reopen must clear acknowledgement fields back
    // to a clean pending state — note included.
    const [row] = await db.select({
      st: claimsTable.closureReviewState,
      notes: claimsTable.closureReviewNotes,
      addressedAt: claimsTable.closureAddressedAt,
      addressedByEmail: claimsTable.closureAddressedByEmail,
    }).from(claimsTable).where(eq(claimsTable.id, id));
    assert.equal(row?.st, "pending");
    assert.equal(row?.notes, null, "reopen must clear closure_review_notes");
    assert.equal(row?.addressedAt, null);
    assert.equal(row?.addressedByEmail, null);
  } finally {
    await cleanupClaim(id);
  }
});

test("reopen >24h: backdated acknowledgement returns 403", async () => {
  setActor(userItCoo);
  const id = await seedClaim("system_error");
  try {
    const ack = await fetchJson(`/api/my-closures/claim/${id}/address`, {
      method: "POST", body: { note: "first acknowledgement — investigating" },
    });
    assert.equal(ack.status, 200);

    // Backdate the acknowledgement timestamp past the 24h self-reopen window.
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db.update(claimsTable)
      .set({ closureAddressedAt: old, updatedAt: old })
      .where(eq(claimsTable.id, id));

    const res = await fetchJson<{ error: string }>(
      `/api/my-closures/claim/${id}/reopen`,
      { method: "POST", body: { note: "too late to reopen" } },
    );
    assert.equal(res.status, 403, `expected 403, got ${res.status} (${JSON.stringify(res.json)})`);
  } finally {
    await cleanupClaim(id);
  }
});

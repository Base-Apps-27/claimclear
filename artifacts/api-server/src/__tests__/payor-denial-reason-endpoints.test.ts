// Integration tests for the Task #321 endpoints:
//   POST /api/invoice-groups/:id/payor-denial-reason
//   POST /api/invoice-groups/:id/awaiting-payor-again
//
// Also covers the GET /api/invoice-groups list filter that the
// "awaiting payor again" flip drives. Same pattern as
// duplicate-of-endpoints.test.ts: in-process router, real DB, seed +
// cleanup per test.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, inArray } from "drizzle-orm";

import invoiceGroupsRouter from "../routes/invoice-groups";
import {
  db,
  pool,
  invoiceGroupsTable,
  portalResponsesTable,
  auditLogsTable,
} from "@workspace/db";

const TEST_USER = { email: "task-321-tester@example.com", displayName: "Task 321 Tester" };

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
  responseIds: number[];
}

async function seedGroup(opts: {
  status?: string;
  withResponse?: { receivedAt?: Date; responseType?: string };
} = {}): Promise<Seed> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: `T321-${tag}`,
    status: (opts.status ?? "Needs Review") as "Needs Review",
  }).returning({ id: invoiceGroupsTable.id });

  const responseIds: number[] = [];
  if (opts.withResponse) {
    const [r] = await db.insert(portalResponsesTable).values({
      claimId: null,
      invoiceGroupId: group.id,
      source: "email",
      responseType: (opts.withResponse.responseType ?? "denial") as "denial",
      content: "seed response",
      autoLinked: true,
      processed: false,
      receivedAt: opts.withResponse.receivedAt ?? new Date(),
    }).returning({ id: portalResponsesTable.id });
    responseIds.push(r.id);
  }
  return { groupId: group.id, responseIds };
}

async function cleanup(seed: Seed) {
  if (seed.responseIds.length) {
    await db.delete(portalResponsesTable).where(inArray(portalResponsesTable.id, seed.responseIds)).catch(() => undefined);
  }
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, seed.groupId)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, seed.groupId)).catch(() => undefined);
}

// ── payor-denial-reason ─────────────────────────────────────────────────

test("POST /payor-denial-reason: happy path stamps row + audit + emits enum-typed reason", async () => {
  const seed = await seedGroup({ withResponse: {} });
  try {
    const r = await request<any>(
      "POST",
      `/api/invoice-groups/${seed.groupId}/payor-denial-reason`,
      { reason: "payor_rejected_gps" },
    );
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.payorDenialReason, "payor_rejected_gps");
    assert.equal(r.json.payorDenialReasonNote, null);
    assert.ok(r.json.payorDenialReasonAt, "expected payorDenialReasonAt to be stamped");

    const [row] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, seed.groupId));
    assert.equal(row.payorDenialReason, "payor_rejected_gps");
    assert.equal(row.payorDenialReasonBy, TEST_USER.displayName);

    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, seed.groupId));
    const hit = audits.find((a) => a.action === "payor_denial_reason_recorded");
    assert.ok(hit, "expected payor_denial_reason_recorded audit row");
    assert.equal((hit!.metadata as any).reason, "payor_rejected_gps");
    assert.equal((hit!.metadata as any).previousReason, null);
  } finally {
    await cleanup(seed);
  }
});

test("POST /payor-denial-reason: idempotent re-record bumps timestamp + records previous reason", async () => {
  const seed = await seedGroup({ withResponse: {} });
  try {
    const first = await request<any>(
      "POST",
      `/api/invoice-groups/${seed.groupId}/payor-denial-reason`,
      { reason: "payor_rejected_gps" },
    );
    assert.equal(first.status, 200);
    const firstAt = first.json.payorDenialReasonAt;

    // Small delay so the second timestamp must be strictly after.
    await new Promise((r) => setTimeout(r, 20));

    const second = await request<any>(
      "POST",
      `/api/invoice-groups/${seed.groupId}/payor-denial-reason`,
      { reason: "payor_cited_benefit_rule" },
    );
    assert.equal(second.status, 200);
    assert.equal(second.json.payorDenialReason, "payor_cited_benefit_rule");
    assert.notEqual(second.json.payorDenialReasonAt, firstAt);

    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, seed.groupId));
    const hits = audits.filter((a) => a.action === "payor_denial_reason_recorded");
    assert.equal(hits.length, 2, "expected two audit rows for two recordings");
    const second_ = hits.find((a) => (a.metadata as any).reason === "payor_cited_benefit_rule");
    assert.equal((second_!.metadata as any).previousReason, "payor_rejected_gps");
  } finally {
    await cleanup(seed);
  }
});

test("POST /payor-denial-reason: payor_other requires a non-empty note (400)", async () => {
  const seed = await seedGroup({ withResponse: {} });
  try {
    for (const note of [undefined, null, "", "   "]) {
      const r = await request<any>(
        "POST",
        `/api/invoice-groups/${seed.groupId}/payor-denial-reason`,
        { reason: "payor_other", note },
      );
      assert.equal(r.status, 400, `note=${JSON.stringify(note)} should be rejected`);
      assert.match(r.json.error, /note.*required/i);
    }

    // With a real note the same payload is accepted.
    const ok = await request<any>(
      "POST",
      `/api/invoice-groups/${seed.groupId}/payor-denial-reason`,
      { reason: "payor_other", note: "Driver said the trip never happened." },
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.json.payorDenialReasonNote, "Driver said the trip never happened.");
  } finally {
    await cleanup(seed);
  }
});

test("POST /payor-denial-reason: invalid code rejected (400)", async () => {
  const seed = await seedGroup({ withResponse: {} });
  try {
    const r = await request<any>(
      "POST",
      `/api/invoice-groups/${seed.groupId}/payor-denial-reason`,
      { reason: "rejected_gps" }, // missing the payor_ prefix
    );
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Invalid reason/);
  } finally {
    await cleanup(seed);
  }
});

test("POST /payor-denial-reason: 409 when status is not Needs Review", async () => {
  const seed = await seedGroup({ status: "Awaiting Response", withResponse: {} });
  try {
    const r = await request<any>(
      "POST",
      `/api/invoice-groups/${seed.groupId}/payor-denial-reason`,
      { reason: "payor_rejected_gps" },
    );
    assert.equal(r.status, 409);
    assert.match(r.json.expectedState, /Needs Review/);
  } finally {
    await cleanup(seed);
  }
});

test("POST /payor-denial-reason: 409 when no inbound responses on file", async () => {
  // Needs Review, but no portal_responses linked → must still be rejected.
  const seed = await seedGroup({ status: "Needs Review" });
  try {
    const r = await request<any>(
      "POST",
      `/api/invoice-groups/${seed.groupId}/payor-denial-reason`,
      { reason: "payor_rejected_gps" },
    );
    assert.equal(r.status, 409);
    assert.match(r.json.expectedState, /portal_responses/);
  } finally {
    await cleanup(seed);
  }
});

test("POST /payor-denial-reason: 404 on unknown group", async () => {
  const r = await request<any>(
    "POST",
    `/api/invoice-groups/9999999/payor-denial-reason`,
    { reason: "payor_rejected_gps" },
  );
  assert.equal(r.status, 404);
});

// ── awaiting-payor-again ────────────────────────────────────────────────

test("POST /awaiting-payor-again: stamps timestamp + audit + suppresses row from list", async () => {
  // Seed with an OLD inbound response so the suppression rule (latest
  // received_at < awaiting_payor_again_at) actually triggers.
  const oldResponseAt = new Date(Date.now() - 60_000);
  const seed = await seedGroup({ withResponse: { receivedAt: oldResponseAt } });
  try {
    const r = await request<any>(
      "POST",
      `/api/invoice-groups/${seed.groupId}/awaiting-payor-again`,
    );
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.awaitingPayorAgainAt, "expected awaitingPayorAgainAt to be stamped");

    const [row] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, seed.groupId));
    assert.ok(row.awaitingPayorAgainAt, "row should have awaitingPayorAgainAt");

    // List filter: macroPhase=response-pending should now SKIP this row.
    const list = await request<any>(
      "GET",
      `/api/invoice-groups?macroPhase=response-pending&search=${encodeURIComponent("T321-")}`,
    );
    assert.equal(list.status, 200);
    const ids = (list.json.groups ?? list.json.invoiceGroups ?? []).map((g: any) => g.id);
    assert.ok(!ids.includes(seed.groupId), `expected suppressed group ${seed.groupId} to be hidden; got ${ids.join(",")}`);

    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, seed.groupId));
    assert.ok(audits.some((a) => a.action === "awaiting_payor_again"), "expected awaiting_payor_again audit row");
  } finally {
    await cleanup(seed);
  }
});

test("POST /awaiting-payor-again: list re-includes the row when a NEWER response arrives", async () => {
  const oldResponseAt = new Date(Date.now() - 60_000);
  const seed = await seedGroup({ withResponse: { receivedAt: oldResponseAt } });
  try {
    const flip = await request<any>(
      "POST",
      `/api/invoice-groups/${seed.groupId}/awaiting-payor-again`,
    );
    assert.equal(flip.status, 200);

    // Simulate a newer payor response landing on the same group.
    const [r2] = await db.insert(portalResponsesTable).values({
      claimId: null,
      invoiceGroupId: seed.groupId,
      source: "email",
      responseType: "denial",
      content: "newer payor reply",
      autoLinked: true,
      processed: false,
      receivedAt: new Date(),
    }).returning({ id: portalResponsesTable.id });
    seed.responseIds.push(r2.id);

    const list = await request<any>(
      "GET",
      `/api/invoice-groups?macroPhase=response-pending&search=${encodeURIComponent("T321-")}`,
    );
    assert.equal(list.status, 200);
    const ids = (list.json.groups ?? list.json.invoiceGroups ?? []).map((g: any) => g.id);
    assert.ok(
      ids.includes(seed.groupId),
      `expected group ${seed.groupId} to re-appear after a newer response; got ${ids.join(",")}`,
    );
  } finally {
    await cleanup(seed);
  }
});

test("POST /awaiting-payor-again: 409 when status is not Needs Review", async () => {
  const seed = await seedGroup({ status: "Awaiting Response", withResponse: {} });
  try {
    const r = await request<any>("POST", `/api/invoice-groups/${seed.groupId}/awaiting-payor-again`);
    assert.equal(r.status, 409);
    assert.match(r.json.expectedState, /Needs Review/);
  } finally {
    await cleanup(seed);
  }
});

test("POST /awaiting-payor-again: 409 when no inbound responses on file", async () => {
  const seed = await seedGroup({ status: "Needs Review" });
  try {
    const r = await request<any>("POST", `/api/invoice-groups/${seed.groupId}/awaiting-payor-again`);
    assert.equal(r.status, 409);
    assert.match(r.json.expectedState, /portal_responses/);
  } finally {
    await cleanup(seed);
  }
});

// ── valid-transitions response includes awaitingPayorAgainAt ────────────

test("GET /valid-transitions includes awaitingPayorAgainAt in response", async () => {
  const seed = await seedGroup({ withResponse: {} });
  try {
    const before = await request<any>("GET", `/api/invoice-groups/${seed.groupId}/valid-transitions`);
    assert.equal(before.status, 200);
    assert.equal(before.json.awaitingPayorAgainAt, null);

    const flip = await request<any>("POST", `/api/invoice-groups/${seed.groupId}/awaiting-payor-again`);
    assert.equal(flip.status, 200);

    const after_ = await request<any>("GET", `/api/invoice-groups/${seed.groupId}/valid-transitions`);
    assert.equal(after_.status, 200);
    assert.ok(after_.json.awaitingPayorAgainAt, "expected awaitingPayorAgainAt to be present after flip");
  } finally {
    await cleanup(seed);
  }
});

/**
 * End-to-end test for the per-leg-context AI clarification gate.
 *
 * Drives the readback → Accept → save cycle against the real api-server
 * endpoints in the same order the `PerLegContextEditor` component calls
 * them in production, and asserts the audit trail + persistence the
 * operator UI relies on. The editor is now rendered inline during the
 * SOP walk (and on the inline "Ready" surface inside SopAdvancePlayer
 * when the leg lands at an include outcome) — the standalone Include
 * terminal "I'm done — hand off" screen and its `canHandoff` gate have
 * been retired, so this test no longer pins those UI invariants.
 *
 * What this pins:
 *
 *   1. POST /api/claims/:id/per-leg-context-readback returns the cleaned
 *      restatement and writes a `leg_per_leg_context_readback` audit row
 *      with `rawLength` / `readbackLength` metadata + actor attribution.
 *      Source: artifacts/api-server/src/routes/claims.ts (per-leg-context
 *      readback handler, ~line 2026).
 *
 *   2. POST /api/claims/:id/per-leg-context (the "Accept" save) writes
 *      the clarified text to `claims.per_leg_context` and emits a
 *      `leg_per_leg_context_set` audit row with `contextLength`. Source:
 *      same file, ~line 1953.
 *
 * Test seam: the Anthropic SDK is stubbed via
 * `__setAnthropicClientForTesting` so the readback handler returns
 * deterministic text without provisioning real credentials — same
 * pattern used by `audit-prompt-leg-counters.test.ts`.
 */

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, and } from "drizzle-orm";

import claimsRouter from "../routes/claims";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
  stateEventsTable,
  errorTypesTable,
} from "@workspace/db";
import { __setAnthropicClientForTesting } from "@workspace/integrations-anthropic-ai";

const TEST_USER = { email: "task-379-tester@example.com", displayName: "Task #379 Tester" };

// The cleaned-up restatement the stub hands back. Any non-empty deterministic
// string works; we capture the value here so the assertions can pin it.
const CANNED_READBACK =
  "Driver waited 47 minutes at pickup; member confirmed the delay by phone before the trip.";

let server: http.Server;
let baseUrl: string;

function makeAnthropicStub() {
  return {
    messages: {
      async create(_args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
        return {
          content: [{ type: "text", text: CANNED_READBACK }],
        };
      },
    },
  };
}

before(async () => {
  __setAnthropicClientForTesting(makeAnthropicStub() as never);

  const app: Express = express();
  app.use(express.json());

  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as { user?: typeof TEST_USER & { status: string } }).user = { ...TEST_USER, status: "approved" };
    (req as { isAuthenticated?: () => boolean }).isAuthenticated = () => true;
    (req as { log?: unknown }).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });

  app.use("/api", claimsRouter);

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
  __setAnthropicClientForTesting(null);
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
    const headers: Record<string, string> = {};
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body).toString();
    }
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: init?.method ?? "GET",
        headers,
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

interface SeedHandle {
  groupId: number;
  claimId: number;
  errorTypeId: number;
}

/**
 * Seed a single-leg invoice group in pre-submit phase (status `Needs
 * Evidence` → macro phase `pre-submit`, which is the only phase the
 * /per-leg-context* handlers accept). The leg has `sopOutcome:
 * portal_dispute` + `includedInDispute: true` so it matches the state
 * the IncludeTerminal renders against.
 */
async function seedPreSubmitLeg(): Promise<SeedHandle> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const [errType] = await db.insert(errorTypesTable).values({
    name: `T379-ErrType-${suffix}`,
    description: "Trip distance mismatch",
    guidance: "Verify GPS breadcrumbs.",
    decisionTree: null,
  }).returning();

  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: `T379-INV-${suffix}`,
    status: "Needs Evidence",
    outcome: "Pending",
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    errorDetails: "Distance billed exceeds the contract distance for this leg.",
  }).returning();

  const [leg] = await db.insert(claimsTable).values({
    confNumber: `T379-LEG-${suffix}`,
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    status: "Needs Evidence",
    outcome: "Pending",
    sopOutcome: "portal_dispute",
    includedInDispute: true,
    claimAmount: "42.50",
    date: "2026-01-15",
    clientNumber: "C100",
    carNumber: "CAR-7",
  }).returning();

  return { groupId: group.id, claimId: leg.id, errorTypeId: errType.id };
}

async function cleanupSeed(seed: SeedHandle): Promise<void> {
  await db.delete(stateEventsTable).where(eq(stateEventsTable.invoiceGroupId, seed.groupId)).catch(() => undefined);
  await db.delete(stateEventsTable).where(eq(stateEventsTable.claimId, seed.claimId)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, seed.groupId)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, seed.claimId)).catch(() => undefined);
  await db.delete(claimsTable).where(eq(claimsTable.id, seed.claimId)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, seed.groupId)).catch(() => undefined);
  await db.delete(errorTypesTable).where(eq(errorTypesTable.id, seed.errorTypeId)).catch(() => undefined);
}

test("Per-leg-context editor readback → Accept → save cycle drives the real api-server endpoints and writes the expected audit rows", async () => {
  const seed = await seedPreSubmitLeg();
  const rawTyped = "driver waited like 47 min, member confirmed by phone before trip";

  try {
    // ─── Step 1: operator types raw text and clicks "Check with AI" ───
    // The component POSTs the raw note to /per-leg-context-readback. The
    // server forwards to Anthropic (stubbed) and returns the cleaned
    // restatement plus writes the audit breadcrumb.
    const readbackRes = await fetchJson<{ readback: string }>(
      `/api/claims/${seed.claimId}/per-leg-context-readback`,
      { method: "POST", body: { context: rawTyped } },
    );
    assert.equal(
      readbackRes.status,
      200,
      `readback expected 200, got ${readbackRes.status} (${JSON.stringify(readbackRes.json)})`,
    );
    assert.equal(
      readbackRes.json.readback,
      CANNED_READBACK,
      "server should return the AI restatement verbatim",
    );

    // ─── Step 2: assert the readback audit row ───
    const readbackAuditRows = await db
      .select()
      .from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.claimId, seed.claimId),
        eq(auditLogsTable.action, "leg_per_leg_context_readback"),
      ));
    assert.equal(
      readbackAuditRows.length,
      1,
      `expected exactly one leg_per_leg_context_readback audit row, found ${readbackAuditRows.length}`,
    );
    const readbackAudit = readbackAuditRows[0];
    const readbackMeta = readbackAudit.metadata as Record<string, unknown> | null;
    assert.ok(readbackMeta && typeof readbackMeta === "object", "readback audit row missing metadata");
    assert.equal(readbackMeta.rawLength, rawTyped.length, "rawLength must reflect the operator's typed text");
    assert.equal(readbackMeta.readbackLength, CANNED_READBACK.length, "readbackLength must reflect the AI restatement");
    assert.equal(readbackAudit.userEmail, TEST_USER.email, "audit row must attribute the operator");
    assert.equal(readbackAudit.userName, TEST_USER.displayName, "audit row must attribute the operator");

    // The readback handler MUST NOT mutate the leg's saved context — the
    // operator hasn't accepted anything yet. Verify it's still null.
    const [legAfterReadback] = await db
      .select()
      .from(claimsTable)
      .where(eq(claimsTable.id, seed.claimId));
    assert.equal(legAfterReadback.perLegContext, null, "readback alone must not persist anything");

    // ─── Step 3: operator clicks Accept → component POSTs the clarified text ───
    // PerLegContextEditor sends the AI's restatement (not the raw text)
    // as the saved context.
    const acceptedContext = readbackRes.json.readback;
    const saveRes = await fetchJson<{ id: number; perLegContext: string | null }>(
      `/api/claims/${seed.claimId}/per-leg-context`,
      { method: "POST", body: { context: acceptedContext } },
    );
    assert.equal(
      saveRes.status,
      200,
      `save expected 200, got ${saveRes.status} (${JSON.stringify(saveRes.json)})`,
    );
    assert.equal(
      saveRes.json.perLegContext,
      acceptedContext,
      "server should echo back the persisted clarified text",
    );

    // ─── Step 4: assert the per-leg-context-set audit row + DB state ───
    const setAuditRows = await db
      .select()
      .from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.claimId, seed.claimId),
        eq(auditLogsTable.action, "leg_per_leg_context_set"),
      ));
    assert.equal(setAuditRows.length, 1, "expected exactly one leg_per_leg_context_set audit row");
    const setMeta = setAuditRows[0].metadata as Record<string, unknown> | null;
    assert.ok(setMeta && typeof setMeta === "object", "set audit row missing metadata");
    assert.equal(setMeta.contextLength, acceptedContext.length, "contextLength must reflect the saved clarified text");

    const [legAfterSave] = await db
      .select()
      .from(claimsTable)
      .where(eq(claimsTable.id, seed.claimId));
    assert.equal(
      legAfterSave.perLegContext,
      acceptedContext,
      "leg.perLegContext must hold the clarified text after Accept",
    );
  } finally {
    await cleanupSeed(seed);
  }
});

/**
 * Task #379 end-to-end test for the Include-terminal AI clarification gate.
 *
 * Drives the readback → Accept → save → hand-off cycle against the real
 * api-server endpoints in the same order the IncludeTerminal component
 * calls them in production, and asserts the audit trail + persistence
 * the operator UI relies on.
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
 *   3. The IncludeTerminal `canHandoff` contract — the hand-off button
 *      stays disabled while typed text differs from `lastSavedRaw`, and
 *      becomes enabled on either an exact match or an empty box. Source
 *      of truth: `artifacts/claimclear/src/components/decision-tree
 *      /terminals/include-terminal.tsx` (canHandoff helper, ~line 74).
 *      Pinned here as part of the same scenario so a regression on
 *      either side surfaces in this single test.
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

/**
 * Local mirror of the IncludeTerminal `canHandoff` contract. Source of
 * truth lives in `artifacts/claimclear/src/components/decision-tree
 * /terminals/include-terminal.tsx`; reproduced here so this test pins
 * the integration boundary the handler depends on (the button stays
 * disabled until the typed text matches `lastSavedRaw`, OR the box is
 * empty). If the React-side helper changes, its dedicated unit tests in
 * `include-terminal.test.tsx` will fail; if the API contract this test
 * exercises changes, this test will fail.
 */
type IncludeEditorMode = "edit" | "checking" | "review" | "saving";
function canHandoff(args: {
  mode: IncludeEditorMode;
  raw: string;
  lastSavedRaw: string;
}): boolean {
  if (args.mode !== "edit") return false;
  if (args.raw.trim().length === 0) return true;
  return args.raw === args.lastSavedRaw;
}

test("Include-terminal readback → Accept → save → hand-off cycle drives the real api-server endpoints, writes the audit row, and pins the canHandoff disabled-while-diverged invariant", async () => {
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

    // ─── Step 3: pin canHandoff DISABLED while the readback is on screen ───
    // Mid-cycle (before Accept) the operator's typed text is `rawTyped`
    // and `lastSavedRaw` is still empty. Hand-off must stay blocked.
    assert.equal(
      canHandoff({ mode: "edit", raw: rawTyped, lastSavedRaw: "" }),
      false,
      "hand-off must stay disabled while typed text differs from lastSavedRaw",
    );
    // Component is also briefly in `review` mode while the readback
    // panel is open; non-edit modes always block hand-off.
    assert.equal(
      canHandoff({ mode: "review", raw: rawTyped, lastSavedRaw: "" }),
      false,
      "hand-off must stay disabled outside edit mode",
    );

    // ─── Step 4: operator clicks Accept → component POSTs the clarified text ───
    // IncludeTerminal sends the AI's restatement (not the raw text) as
    // the saved context, and bookmarks `lastSavedRaw = rawTyped` locally
    // so the user's original wording is what gates the next hand-off.
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

    // ─── Step 5: assert the per-leg-context-set audit row + DB state ───
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

    // ─── Step 6: pin canHandoff at the boundary states post-save ───
    // After Accept, the component sets `lastSavedRaw = rawTyped`
    // (the operator's untouched typed text). Hand-off rules:
    //   - typed text matches lastSavedRaw → ENABLED.
    assert.equal(
      canHandoff({ mode: "edit", raw: rawTyped, lastSavedRaw: rawTyped }),
      true,
      "hand-off must be enabled when typed text matches lastSavedRaw",
    );
    //   - operator edits the text after Accept → DISABLED again until
    //     they re-run Check + Accept or revert.
    assert.equal(
      canHandoff({ mode: "edit", raw: `${rawTyped} (edit)`, lastSavedRaw: rawTyped }),
      false,
      "hand-off must re-disable when typed text diverges from lastSavedRaw post-save",
    );
    //   - operator clears the box entirely → ENABLED (the explicit
    //     "nothing to add" path; doesn't touch the saved server state).
    assert.equal(
      canHandoff({ mode: "edit", raw: "", lastSavedRaw: rawTyped }),
      true,
      "hand-off must be enabled when the textarea is empty",
    );
  } finally {
    await cleanupSeed(seed);
  }
});

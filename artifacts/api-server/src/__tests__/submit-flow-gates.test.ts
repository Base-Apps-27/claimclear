import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, and, desc } from "drizzle-orm";

import portalSubmissionsRouter from "../routes/portal-submissions";
import invoiceGroupsRouter from "../routes/invoice-groups";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
  notesTable,
  portalSubmissionsTable,
  claimEvidenceTable,
  stateEventsTable,
  errorTypesTable,
} from "@workspace/db";

const TEST_BOT_TOKEN = "test-bot-service-token-210";

let server: http.Server;
let baseUrl: string;

const TEST_USER = { email: "submit-gates-tester@example.com", displayName: "Submit Gates Tester" };

before(async () => {
  process.env.BOT_SERVICE_TOKEN = TEST_BOT_TOKEN;

  const app: Express = express();
  app.use(express.json());

  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });

  app.use("/api", portalSubmissionsRouter);
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
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<{ status: number; json: T }> {
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((resolveReq, rejectReq) => {
    const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined;
    const headers: Record<string, string> = {};
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body).toString();
    }
    if (init?.headers) Object.assign(headers, init.headers);
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

async function createSeedGroup(opts: {
  status?: any;
  understandingReadbackAt?: Date | null;
  previewGeneratedAt?: Date | null;
} = {}): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const invoiceNumber = `T210G-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: opts.status ?? "Needs Evidence",
    outcome: "Pending",
  }).returning();

  const updates: Record<string, unknown> = {};
  if (opts.understandingReadbackAt !== undefined) {
    updates.understandingReadbackAt = opts.understandingReadbackAt;
  }
  if (opts.previewGeneratedAt !== undefined) {
    updates.previewGeneratedAt = opts.previewGeneratedAt;
  }
  if (Object.keys(updates).length > 0) {
    const [updated] = await db.update(invoiceGroupsTable)
      .set(updates)
      .where(eq(invoiceGroupsTable.id, row.id))
      .returning();
    return updated;
  }

  return row;
}

async function createSeedClaim(opts: {
  invoiceGroupId?: number | null;
  errorTypeId?: string | null;
  errorTypeName?: string | null;
  sopOutcome?: string | null;
  status?: any;
  outcome?: any;
  includedInDispute?: boolean;
} = {}): Promise<typeof claimsTable.$inferSelect> {
  const confNumber = `T210-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(claimsTable).values({
    confNumber,
    status: opts.status ?? "Needs Evidence",
    outcome: opts.outcome ?? "Pending",
    invoiceGroupId: opts.invoiceGroupId ?? null,
    errorTypeId: Object.prototype.hasOwnProperty.call(opts, "errorTypeId") ? opts.errorTypeId : null,
    errorTypeName: opts.errorTypeName ?? null,
    sopOutcome: opts.sopOutcome ?? null,
    includedInDispute: opts.includedInDispute ?? true,
    claimAmount: "100.00",
  }).returning();
  return row;
}

async function createSeedErrorType(): Promise<typeof errorTypesTable.$inferSelect> {
  const name = `T210-ErrType-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(errorTypesTable).values({
    name,
    description: "test",
    decisionTree: null,
  }).returning();
  return row;
}

async function cleanupClaim(id: number) {
  await db.delete(stateEventsTable).where(eq(stateEventsTable.claimId, id)).catch(() => undefined);
  // portal_submissions was reparented to invoice_group_id, so it's
  // cleaned up by cleanupGroup (not here, where we'd have no group ref).
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

function submitBody(groupId: number, overrides?: Record<string, unknown>) {
  return {
    invoiceGroupId: groupId,
    understandingReadback: "Test readback text for the AI understanding check",
    disputeReason: "Test dispute reason",
    ...overrides,
  };
}

test("Operator submit when understandingReadbackAt is null no longer gates — readback is optional, falls through to next gate (preview)", async () => {
  // Readback was previously a hard gate. It is now OPTIONAL: an operator
  // who has nothing extra to add about the case overall can leave the
  // notes blank and proceed. With both readback AND preview unset, the
  // submission must now hit the PREVIEW gate (the next one in the
  // pipeline) rather than the removed readback gate.
  const errType = await createSeedErrorType();
  const group = await createSeedGroup({
    status: "Needs Evidence",
    understandingReadbackAt: null,
    previewGeneratedAt: null,
  });
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: "portal_dispute",
    includedInDispute: true,
  });
  try {
    const res = await fetchJson("/api/portal-submissions", {
      method: "POST",
      body: submitBody(group.id, { actorType: "operator", understandingReadback: "" }),
    });
    assert.equal(res.status, 409, `expected 409, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.gate, "preview", `expected the preview gate to fire, not the removed readback gate (got ${JSON.stringify(res.json)})`);
    assert.equal(res.json.expectedState, "preview-generated");
    assert.equal(res.json.actualState, "no-preview");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("Operator submit when only previewGeneratedAt is missing returns 409 gate=preview", async () => {
  const errType = await createSeedErrorType();
  const group = await createSeedGroup({
    status: "Needs Evidence",
    understandingReadbackAt: new Date(),
    previewGeneratedAt: null,
  });
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: "portal_dispute",
    includedInDispute: true,
  });
  try {
    const res = await fetchJson("/api/portal-submissions", {
      method: "POST",
      body: submitBody(group.id, { actorType: "operator" }),
    });
    assert.equal(res.status, 409, `expected 409, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.gate, "preview");
    assert.equal(res.json.expectedState, "preview-generated");
    assert.equal(res.json.actualState, "no-preview");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("Operator submit when one disputed leg is investigating returns 409 gate=legs", async () => {
  const errType = await createSeedErrorType();
  const group = await createSeedGroup({
    status: "Needs Evidence",
    understandingReadbackAt: new Date(),
    previewGeneratedAt: new Date(),
  });
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: null,
    includedInDispute: true,
  });
  try {
    const res = await fetchJson("/api/portal-submissions", {
      method: "POST",
      body: submitBody(group.id, { actorType: "operator" }),
    });
    assert.equal(res.status, 409, `expected 409, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.gate, "legs");
    assert.equal(res.json.actualState, "1-unresolved");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("Bot submit with valid token bypasses the preview gate, emits audit+state_event", async () => {
  const errType = await createSeedErrorType();
  const group = await createSeedGroup({
    status: "Needs Evidence",
    understandingReadbackAt: null,
    previewGeneratedAt: null,
  });
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: "portal_dispute",
    includedInDispute: true,
  });
  try {
    const res = await fetchJson("/api/portal-submissions", {
      method: "POST",
      body: submitBody(group.id, { actorType: "system" }),
      headers: { "x-bot-token": TEST_BOT_TOKEN },
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status} (${JSON.stringify(res.json)})`);

    const audits = await db.select().from(auditLogsTable).where(
      and(
        eq(auditLogsTable.invoiceGroupId, group.id),
        eq(auditLogsTable.action, "submission_actor_bypass"),
      ),
    );
    assert.ok(audits.length >= 1, "expected submission_actor_bypass audit row");
    const meta = audits[0].metadata as any;
    // Readback is no longer a gate (it's optional context), so the bot
    // only needs to bypass the preview gate now.
    assert.deepStrictEqual(meta.bypassed, ["preview"]);
    assert.equal(meta.actorType, "system");

    const events = await db.select().from(stateEventsTable).where(
      and(
        eq(stateEventsTable.invoiceGroupId, group.id),
        eq(stateEventsTable.eventKey, "group.submission_bypass_used"),
      ),
    );
    assert.ok(events.length >= 1, "expected group.submission_bypass_used state event");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("Operator request with actorType=system but no bot token returns 403", async () => {
  const errType = await createSeedErrorType();
  const group = await createSeedGroup({
    status: "Needs Evidence",
    understandingReadbackAt: new Date(),
    previewGeneratedAt: new Date(),
  });
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: "portal_dispute",
    includedInDispute: true,
  });
  try {
    const res = await fetchJson("/api/portal-submissions", {
      method: "POST",
      body: submitBody(group.id, { actorType: "system" }),
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.error, "Bot actorType requires service-token authentication");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("Bot submit with unresolved leg returns 409 gate=legs (phase+legs gates still apply)", async () => {
  const errType = await createSeedErrorType();
  const group = await createSeedGroup({
    status: "Needs Evidence",
    understandingReadbackAt: null,
    previewGeneratedAt: null,
  });
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: null,
    includedInDispute: true,
  });
  try {
    const res = await fetchJson("/api/portal-submissions", {
      method: "POST",
      body: submitBody(group.id, { actorType: "system" }),
      headers: { "x-bot-token": TEST_BOT_TOKEN },
    });
    assert.equal(res.status, 409, `expected 409, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.gate, "legs");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("Bot regression: valid bot path with resolved legs produces 201 and Portal Queued group", async () => {
  const errType = await createSeedErrorType();
  const group = await createSeedGroup({
    status: "Needs Evidence",
    understandingReadbackAt: null,
    previewGeneratedAt: null,
  });
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: "portal_dispute",
    includedInDispute: true,
  });
  try {
    const res = await fetchJson("/api/portal-submissions", {
      method: "POST",
      body: submitBody(group.id, { actorType: "system" }),
      headers: { "x-bot-token": TEST_BOT_TOKEN },
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status} (${JSON.stringify(res.json)})`);

    const [updatedGroup] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.equal(updatedGroup.status, "Portal Queued", `expected group status Portal Queued, got ${updatedGroup.status}`);
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

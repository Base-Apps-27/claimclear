// Task #745 — verify-then-save gate on the "Understanding notes" textarea.
//
// The /invoice-groups/:id/understanding-readback route is now a true
// gate: a non-empty operator note (`specialCircumstances`) must match
// the most recent preflight (`understandingReadback` +
// `understandingReadbackForText`) before we accept the save. Empty
// notes follow an explicit "clear" path that bypasses the gate.
//
// These tests exercise the four shapes the UI cares about:
//   1. missing_readback   — non-empty note, no preflight on file
//   2. stale_readback (note drift)     — note edited since last check
//   3. stale_readback (readback drift) — readback doesn't match anchor
//   4. happy path         — fresh preflight, save stamps all columns
//   5. empty clear        — empty note wipes the columns + audit row
import { phaseForStatus, dispositionForGroup } from "./fixtures/state";
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, and, desc } from "drizzle-orm";

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

let server: http.Server;
let baseUrl: string;
const TEST_USER = { email: "readback-gate-tester@example.com", displayName: "Readback Gate Tester" };

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
      } else rejectListen(new Error("port?"));
    });
  });
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
  await pool.end().catch(() => undefined);
});

async function fetchJson<T = any>(
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
      { hostname: url.hostname, port: url.port, path: url.pathname, method: init?.method ?? "GET", headers },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try { resolveReq({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : ({} as T) }); }
          catch (e) { rejectReq(e); }
        });
      },
    );
    req.on("error", rejectReq);
    if (body) req.write(body);
    req.end();
  });
}

async function seedErrorType(): Promise<typeof errorTypesTable.$inferSelect> {
  const [row] = await db.insert(errorTypesTable).values({
    name: `T745-ET-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    description: "test",
    decisionTree: null,
  }).returning();
  return row;
}

async function seedGroup(opts: {
  understandingReadback?: string | null;
  understandingReadbackForText?: string | null;
  specialCircumstances?: string | null;
}): Promise<{ group: typeof invoiceGroupsTable.$inferSelect; errType: typeof errorTypesTable.$inferSelect }> {
  const status = "Needs Evidence";
  const invoiceNumber = `T745-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db
    .insert(invoiceGroupsTable)
    .values({
      invoiceNumber,
      status,
      outcome: "Pending",
      phase: phaseForStatus(status),
      understandingReadback: opts.understandingReadback ?? null,
      understandingReadbackForText: opts.understandingReadbackForText ?? null,
      specialCircumstances: opts.specialCircumstances ?? null,
    })
    .returning();
  // Add one fully-resolved leg (errorType + sopOutcome=portal_dispute
  // → sub-status="ready") so the all-disputed-legs-resolved gate clears
  // and we hit the readback gate cleanly.
  const errType = await seedErrorType();
  const disposition = await dispositionForGroup(row.id);
  await db.insert(claimsTable).values({
    confNumber: `T745-CL-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    status: "Needs Evidence",
    outcome: "Pending",
    invoiceGroupId: row.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: "portal_dispute",
    includedInDispute: true,
    claimAmount: "100.00",
    disposition,
  });
  return { group: row, errType };
}

async function cleanupGroup(id: number) {
  const children = await db.select({ id: claimsTable.id }).from(claimsTable).where(eq(claimsTable.invoiceGroupId, id));
  for (const c of children) {
    await db.delete(stateEventsTable).where(eq(stateEventsTable.claimId, c.id)).catch(() => undefined);
    await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, c.id)).catch(() => undefined);
    await db.delete(notesTable).where(eq(notesTable.claimId, c.id)).catch(() => undefined);
    await db.delete(claimEvidenceTable).where(eq(claimEvidenceTable.claimId, c.id)).catch(() => undefined);
    await db.delete(claimsTable).where(eq(claimsTable.id, c.id)).catch(() => undefined);
  }
  await db.delete(stateEventsTable).where(eq(stateEventsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(claimEvidenceTable).where(eq(claimEvidenceTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)).catch(() => undefined);
}

test("Task #745: omitted specialCircumstances returns 400 (cannot silently clear the saved note)", async () => {
  const { group, errType } = await seedGroup({
    specialCircumstances: "Existing operator note",
    understandingReadback: "AI restatement",
    understandingReadbackForText: "Existing operator note",
  });
  try {
    // Legacy/buggy caller: only sends `readback`, omits `specialCircumstances`.
    // Must NOT route to the empty-clear path; must reject so the saved
    // note stays put.
    const r = await fetchJson(`/api/invoice-groups/${group.id}/understanding-readback`, {
      method: "POST",
      body: { readback: "AI restatement" },
    });
    assert.strictEqual(r.status, 400);
    assert.strictEqual((r.json as any).code, "missing_special_circumstances");
    const [after] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.strictEqual(after.specialCircumstances, "Existing operator note");
    assert.strictEqual(after.understandingReadback, "AI restatement");
    assert.strictEqual(after.understandingReadbackForText, "Existing operator note");
  } finally {
    await cleanupGroup(group.id); await db.delete(errorTypesTable).where(eq(errorTypesTable.id, errType.id)).catch(() => undefined);
  }
});

test("Task #745: omitted readback on a non-empty note returns 400 (cannot bypass the AI gate)", async () => {
  const { group, errType } = await seedGroup({});
  try {
    const r = await fetchJson(`/api/invoice-groups/${group.id}/understanding-readback`, {
      method: "POST",
      body: { specialCircumstances: "New note operator typed" },
    });
    assert.strictEqual(r.status, 400);
    assert.strictEqual((r.json as any).code, "missing_readback_field");
  } finally {
    await cleanupGroup(group.id); await db.delete(errorTypesTable).where(eq(errorTypesTable.id, errType.id)).catch(() => undefined);
  }
});

test("Task #745: non-empty note with no preflight returns 409 missing_readback", async () => {
  const { group, errType } = await seedGroup({ understandingReadback: null, understandingReadbackForText: null });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/understanding-readback`, {
      method: "POST",
      body: { readback: "anything", specialCircumstances: "Driver took a wrong turn" },
    });
    assert.equal(res.status, 409, `expected 409, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.code, "missing_readback");
  } finally {
    await cleanupGroup(group.id); await db.delete(errorTypesTable).where(eq(errorTypesTable.id, errType.id)).catch(() => undefined);
  }
});

test("Task #745: note edited since preflight returns 409 stale_readback (note drift)", async () => {
  const { group, errType } = await seedGroup({
    understandingReadback: "AI restatement here.",
    understandingReadbackForText: "Original note v1",
  });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/understanding-readback`, {
      method: "POST",
      body: { readback: "AI restatement here.", specialCircumstances: "Original note v2" },
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, "stale_readback");
  } finally {
    await cleanupGroup(group.id); await db.delete(errorTypesTable).where(eq(errorTypesTable.id, errType.id)).catch(() => undefined);
  }
});

test("Task #745: readback that doesn't match anchor returns 409 stale_readback (readback drift)", async () => {
  const { group, errType } = await seedGroup({
    understandingReadback: "Server-side AI restatement.",
    understandingReadbackForText: "The note text",
  });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/understanding-readback`, {
      method: "POST",
      body: { readback: "Stale client-side text from another tab.", specialCircumstances: "The note text" },
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, "stale_readback");
  } finally {
    await cleanupGroup(group.id); await db.delete(errorTypesTable).where(eq(errorTypesTable.id, errType.id)).catch(() => undefined);
  }
});

test("Task #745: matching note + readback saves and stamps all columns", async () => {
  const { group, errType } = await seedGroup({
    understandingReadback: "AI restatement.",
    understandingReadbackForText: "Operator note about edge case.",
  });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/understanding-readback`, {
      method: "POST",
      body: { readback: "AI restatement.", specialCircumstances: "Operator note about edge case." },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const [row] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.equal(row.specialCircumstances, "Operator note about edge case.");
    assert.equal(row.understandingReadback, "AI restatement.");
    assert.equal(row.understandingReadbackForText, "Operator note about edge case.");
    assert.ok(row.understandingReadbackAt instanceof Date, "expected understandingReadbackAt stamp");
    assert.equal(row.understandingReadbackBy, TEST_USER.email);

    const [audit] = await db
      .select()
      .from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.invoiceGroupId, group.id),
        eq(auditLogsTable.action, "understanding_readback_confirmed"),
      ))
      .orderBy(desc(auditLogsTable.id))
      .limit(1);
    assert.ok(audit, "expected understanding_readback_confirmed audit row");
    const meta = audit.metadata as any;
    assert.equal(meta.specialCircumstancesLength, "Operator note about edge case.".length);
    assert.equal(typeof meta.noteHash, "string");
    assert.ok(meta.noteHash.length > 0);
  } finally {
    await cleanupGroup(group.id); await db.delete(errorTypesTable).where(eq(errorTypesTable.id, errType.id)).catch(() => undefined);
  }
});

test("Task #745: empty note bypasses the gate and clears all columns (no preflight required)", async () => {
  const { group, errType } = await seedGroup({
    understandingReadback: "stale AI text",
    understandingReadbackForText: "stale operator note",
    specialCircumstances: "stale operator note",
  });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/understanding-readback`, {
      method: "POST",
      body: { readback: "", specialCircumstances: "   " },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const [row] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.equal(row.specialCircumstances, null);
    assert.equal(row.understandingReadback, null);
    assert.equal(row.understandingReadbackForText, null);
    assert.ok(row.understandingReadbackAt instanceof Date);

    const [audit] = await db
      .select()
      .from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.invoiceGroupId, group.id),
        eq(auditLogsTable.action, "understanding_readback_confirmed"),
      ))
      .orderBy(desc(auditLogsTable.id))
      .limit(1);
    assert.ok(audit);
    assert.equal((audit.metadata as any).cleared, true);
  } finally {
    await cleanupGroup(group.id); await db.delete(errorTypesTable).where(eq(errorTypesTable.id, errType.id)).catch(() => undefined);
  }
});

import { phaseForStatus, dispositionForGroup } from "./fixtures/state";
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";

import claimsRouter from "../routes/claims";
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

// Pivot B2 (Task #471) — error-type changes must come from the group.
//
// 1. Leg endpoint refuses with 409 + code:"use_group_endpoint" when
//    any requested leg has a non-null invoiceGroupId.
// 2. Leg endpoint preserves back-compat for legacy un-grouped legs
//    (every requested leg has invoiceGroupId IS NULL).
// 3. UI mapping logic (selected leg ids → distinct group ids,
//    de-duplicated) drives the group endpoint and updates each
//    distinct invoice group exactly once.

const TEST_USER = {
  email: "task-471-tester@example.com",
  displayName: "Task 471 Tester",
};

let server: http.Server;
let baseUrl: string;

before(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved", role: "admin" };
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
          let parsed: any = {};
          if (raw) {
            try { parsed = JSON.parse(raw); }
            catch { parsed = { _raw: raw }; }
          }
          resolveReq({ status: res.statusCode ?? 0, json: parsed as T });
        });
      },
    );
    req.on("error", rejectReq);
    if (body) req.write(body);
    req.end();
  });
}

async function createSeedGroup(): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const invoiceNumber = `T471G-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: "Needs Evidence",
    outcome: "Pending",
    phase: phaseForStatus("Needs Evidence"),
  }).returning();
  return row;
}

async function createSeedClaim(opts: {
  invoiceGroupId?: number | null;
} = {}): Promise<typeof claimsTable.$inferSelect> {
  const confNumber = `T471-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const invoiceGroupId = opts.invoiceGroupId ?? null;
  const disposition = await dispositionForGroup(invoiceGroupId);
  const [row] = await db.insert(claimsTable).values({
    confNumber,
    status: "Needs Evidence",
    outcome: "Pending",
    invoiceGroupId,
    includedInDispute: true,
    claimAmount: "100.00",
    disposition,
  }).returning();
  return row;
}

async function createSeedErrorType(): Promise<typeof errorTypesTable.$inferSelect> {
  const name = `T471-ErrType-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(errorTypesTable).values({
    name,
    description: "test",
    decisionTree: null,
  }).returning();
  return row;
}

async function cleanupClaim(id: number) {
  await db.delete(stateEventsTable).where(eq(stateEventsTable.claimId, id)).catch(() => undefined);
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
  await db.delete(notesTable).where(eq(notesTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(claimEvidenceTable).where(eq(claimEvidenceTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)).catch(() => undefined);
}

async function cleanupErrorType(id: number) {
  await db.delete(errorTypesTable).where(eq(errorTypesTable.id, id)).catch(() => undefined);
}

test("Pivot B2: POST /claims/bulk-assign-error-type returns 409 + code:use_group_endpoint when any selected leg belongs to an invoice group", async () => {
  const errType = await createSeedErrorType();
  const groupA = await createSeedGroup();
  const groupB = await createSeedGroup();
  const legA1 = await createSeedClaim({ invoiceGroupId: groupA.id });
  const legA2 = await createSeedClaim({ invoiceGroupId: groupA.id });
  const legB1 = await createSeedClaim({ invoiceGroupId: groupB.id });
  try {
    const res = await fetchJson(`/api/claims/bulk-assign-error-type`, {
      method: "POST",
      body: { claimIds: [legA1.id, legA2.id, legB1.id], errorTypeId: errType.id },
    });
    assert.equal(res.status, 409, `expected 409, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.code, "use_group_endpoint", "stable code so out-of-tree callers can route to the group endpoint");
    assert.ok(Array.isArray(res.json.groupIds), "groupIds[] must be returned for the caller to retry against");
    const returned = new Set(res.json.groupIds);
    assert.ok(returned.has(groupA.id), `groupIds must include groupA.id (${groupA.id}); got ${JSON.stringify(res.json.groupIds)}`);
    assert.ok(returned.has(groupB.id), `groupIds must include groupB.id (${groupB.id}); got ${JSON.stringify(res.json.groupIds)}`);
    assert.equal(res.json.groupIds.length, 2, "groupIds must be de-duplicated (groupA appeared twice in the input)");

    // No silent write: legs must NOT have been updated.
    const [a1After] = await db.select().from(claimsTable).where(eq(claimsTable.id, legA1.id));
    assert.equal(a1After.errorTypeId, null, "leg endpoint must not write when refusing with 409");
  } finally {
    await cleanupGroup(groupA.id);
    await cleanupGroup(groupB.id);
    await cleanupErrorType(errType.id);
  }
});

test("Pivot B2: POST /claims/bulk-assign-error-type returns 409 even when the selection is MIXED — only some legs are grouped (one grouped leg is enough to flip the entire request)", async () => {
  const errType = await createSeedErrorType();
  const group = await createSeedGroup();
  const groupedLeg = await createSeedClaim({ invoiceGroupId: group.id });
  const ungroupedLeg = await createSeedClaim({ invoiceGroupId: null });
  try {
    const res = await fetchJson(`/api/claims/bulk-assign-error-type`, {
      method: "POST",
      body: { claimIds: [groupedLeg.id, ungroupedLeg.id], errorTypeId: errType.id },
    });
    assert.equal(res.status, 409, `mixed selection must still refuse (one grouped leg is enough), got ${res.status}`);
    assert.equal(res.json.code, "use_group_endpoint");
    assert.deepEqual(res.json.groupIds, [group.id], "groupIds must list only the grouped invoice's id");

    // No silent partial write — neither leg may have been updated.
    const [groupedAfter] = await db.select().from(claimsTable).where(eq(claimsTable.id, groupedLeg.id));
    const [ungroupedAfter] = await db.select().from(claimsTable).where(eq(claimsTable.id, ungroupedLeg.id));
    assert.equal(groupedAfter.errorTypeId, null, "grouped leg must not be written when refusing");
    assert.equal(ungroupedAfter.errorTypeId, null, "ungrouped leg must also not be written — refusal is all-or-nothing, no partial update");
  } finally {
    await cleanupGroup(group.id);
    await cleanupClaim(ungroupedLeg.id);
    await cleanupErrorType(errType.id);
  }
});

test("Pivot B2: POST /claims/bulk-assign-error-type still succeeds (back-compat) when every requested leg has invoiceGroupId IS NULL", async () => {
  const errType = await createSeedErrorType();
  const legacyLeg1 = await createSeedClaim({ invoiceGroupId: null });
  const legacyLeg2 = await createSeedClaim({ invoiceGroupId: null });
  try {
    const res = await fetchJson(`/api/claims/bulk-assign-error-type`, {
      method: "POST",
      body: { claimIds: [legacyLeg1.id, legacyLeg2.id], errorTypeId: errType.id },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.updated, 2, "both legacy un-grouped legs must be updated");

    const [after1] = await db.select().from(claimsTable).where(eq(claimsTable.id, legacyLeg1.id));
    assert.equal(after1.errorTypeId, String(errType.id), "back-compat write must actually persist the errorTypeId on the leg");
  } finally {
    await cleanupClaim(legacyLeg1.id);
    await cleanupClaim(legacyLeg2.id);
    await cleanupErrorType(errType.id);
  }
});

test("Pivot B2: POST /invoice-groups/bulk-assign-error-type returns groups already on the target error type as skipped with stable reason `already_assigned` and does not re-write them", async () => {
  const errType = await createSeedErrorType();
  const groupAlready = await createSeedGroup();
  const groupFresh = await createSeedGroup();
  // Pre-stamp groupAlready with the target error type so it should
  // come back as `already_assigned` (no-op).
  await db.update(invoiceGroupsTable)
    .set({ errorTypeId: String(errType.id), errorTypeName: errType.name })
    .where(eq(invoiceGroupsTable.id, groupAlready.id));
  try {
    const res = await fetchJson(`/api/invoice-groups/bulk-assign-error-type`, {
      method: "POST",
      body: {
        groupIds: [groupAlready.id, groupFresh.id],
        errorTypeId: String(errType.id),
        errorTypeName: errType.name,
      },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.updated, 1, "exactly one fresh group should have been updated; the already-assigned group must NOT be re-written");
    const skipped = res.json.skipped as Array<{ id: number; reason: string }>;
    assert.ok(
      skipped.some(s => s.id === groupAlready.id && s.reason === "already_assigned"),
      `groupAlready must appear in skipped[] with stable reason="already_assigned", got ${JSON.stringify(skipped)}`,
    );
    // No audit row may be written for the already-assigned group
    // (re-stamping a no-op would pollute the timeline).
    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, groupAlready.id));
    assert.equal(audits.length, 0, "already_assigned no-op must not write a group_error_type_assigned audit row");
  } finally {
    await cleanupGroup(groupAlready.id);
    await cleanupGroup(groupFresh.id);
    await cleanupErrorType(errType.id);
  }
});

test("Pivot B2: UI mapping (leg ids → distinct group ids) drives the group endpoint and updates each invoice group exactly once", async () => {
  // This integration test mirrors the All Claims page mapping logic:
  // selectedClaims → distinct invoiceGroupIds → group bulk endpoint.
  const errType = await createSeedErrorType();
  const groupA = await createSeedGroup();
  const groupB = await createSeedGroup();
  // Two legs per group — exercises the de-dup so groupA appears once
  // even though two legs from it are selected.
  const a1 = await createSeedClaim({ invoiceGroupId: groupA.id });
  const a2 = await createSeedClaim({ invoiceGroupId: groupA.id });
  const b1 = await createSeedClaim({ invoiceGroupId: groupB.id });
  try {
    const selectedLegIds = [a1.id, a2.id, b1.id];
    const selectedClaims = await db.select({
      id: claimsTable.id,
      invoiceGroupId: claimsTable.invoiceGroupId,
    }).from(claimsTable);
    const selected = selectedClaims.filter(c => selectedLegIds.includes(c.id));
    const groupIds = Array.from(new Set(
      selected.map(c => c.invoiceGroupId).filter((id): id is number => id != null),
    ));
    assert.equal(groupIds.length, 2, "mapping must de-duplicate group ids when multiple legs share a group");

    const res = await fetchJson(`/api/invoice-groups/bulk-assign-error-type`, {
      method: "POST",
      body: {
        groupIds,
        errorTypeId: String(errType.id),
        errorTypeName: errType.name,
      },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.updated, 2, "exactly 2 distinct groups must be updated (not 3 — the duplicate must be collapsed)");

    const [groupAAfter] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupA.id));
    const [groupBAfter] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupB.id));
    assert.equal(groupAAfter.errorTypeId, String(errType.id), "groupA must carry the new errorTypeId");
    assert.equal(groupBAfter.errorTypeId, String(errType.id), "groupB must carry the new errorTypeId");
  } finally {
    await cleanupGroup(groupA.id);
    await cleanupGroup(groupB.id);
    await cleanupErrorType(errType.id);
  }
});

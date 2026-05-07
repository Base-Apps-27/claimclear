import { phaseForStatus, dispositionForGroup } from "./fixtures/state";
// Route-level tests for the closure-data foundation: auto-advance on classify,
// structured Withdrawn / Non-Issue closures, and POST /claim-evidence/closure.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, and, desc } from "drizzle-orm";

import claimsRouter from "../routes/claims";
import invoiceGroupsRouter from "../routes/invoice-groups";
import claimEvidenceRouter from "../routes/claim-evidence";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  claimEvidenceTable,
  auditLogsTable,
  notesTable,
  portalResponsesTable,
  portalSubmissionsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;

const TEST_USER = { email: "tester@example.com", displayName: "Closure Tester" };

before(async () => {
  const app: Express = express();
  app.use(express.json());

  // Test auth shim — populates req.user so actorFromReq + audit user fields work.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });

  app.use("/api", claimsRouter);
  app.use("/api", invoiceGroupsRouter);
  app.use("/api", claimEvidenceRouter);

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
  status?: "New" | "Needs Review" | "Needs Evidence";
  errorTypeId?: string | null;
  withGroup?: boolean;
} = {}): Promise<typeof claimsTable.$inferSelect> {
  let invoiceGroupId: number | null = null;
  if (opts.withGroup) {
    const group = await createSeedGroup();
    invoiceGroupId = group.id;
  }
  const confNumber = `T130-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const disposition = await dispositionForGroup(invoiceGroupId);
  const [row] = await db.insert(claimsTable).values({
    confNumber,
    status: opts.status ?? "New",
    outcome: "Pending",
    errorTypeId: opts.errorTypeId ?? null,
    errorTypeName: opts.errorTypeId ? "Seeded Error" : null,
    invoiceGroupId,
    disposition,
  }).returning();
  return row;
}

async function createSeedGroup(): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const invoiceNumber = `T130G-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: "Needs Review",
    outcome: "Pending",
    phase: phaseForStatus("Needs Review"),
  }).returning();
  return row;
}

async function cleanupClaim(id: number) {
  const [claim] = await db.select({ invoiceGroupId: claimsTable.invoiceGroupId })
    .from(claimsTable).where(eq(claimsTable.id, id)).catch(() => [{ invoiceGroupId: null as number | null }]);
  await db.delete(portalResponsesTable).where(eq(portalResponsesTable.claimId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, id)).catch(() => undefined);
  await db.delete(notesTable).where(eq(notesTable.claimId, id)).catch(() => undefined);
  await db.delete(claimEvidenceTable).where(eq(claimEvidenceTable.claimId, id)).catch(() => undefined);
  await db.delete(claimsTable).where(eq(claimsTable.id, id)).catch(() => undefined);
  if (claim?.invoiceGroupId) {
    await cleanupGroup(claim.invoiceGroupId);
  }
}

async function cleanupGroup(id: number) {
  await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(claimEvidenceTable).where(eq(claimEvidenceTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)).catch(() => undefined);
}

// ---- Auto-advance after classify ---------------------------------------

test("auto-advance: PATCH /claims/:id setting errorTypeId on New (previously empty) → Needs Evidence with source auto_after_classify", async () => {
  const seed = await createSeedClaim({ status: "New", errorTypeId: null });
  try {
    const res = await fetchJson<typeof claimsTable.$inferSelect>(
      `/api/claims/${seed.id}`,
      { method: "PATCH", body: { errorTypeId: "et-1", errorTypeName: "Late Cancel" } },
    );
    assert.equal(res.status, 200, `expected 200 OK, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.status, "Needs Evidence",
      `claim must auto-advance to Needs Evidence after first classification, got ${res.json.status}`);
    assert.equal(res.json.errorTypeId, "et-1");

    const logs = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.claimId, seed.id))
      .orderBy(desc(auditLogsTable.timestamp));
    const autoLog = logs.find(
      (l) => (l.metadata as any)?.source === "auto_after_classify",
    );
    assert.ok(autoLog, `expected an audit log with source="auto_after_classify"; got ${JSON.stringify(logs.map((l) => ({ a: l.action, m: l.metadata })))}`);
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("auto-advance: PATCH /claims/:id setting errorTypeId on Needs Review (previously empty) → Needs Evidence", async () => {
  const seed = await createSeedClaim({ status: "Needs Review", errorTypeId: null });
  try {
    const res = await fetchJson<typeof claimsTable.$inferSelect>(
      `/api/claims/${seed.id}`,
      { method: "PATCH", body: { errorTypeId: "et-2", errorTypeName: "Address Mismatch" } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.status, "Needs Evidence",
      "Needs Review claims must also auto-advance once classified");
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("auto-advance: does NOT trigger when errorTypeId was already set", async () => {
  const seed = await createSeedClaim({ status: "Needs Review", errorTypeId: "et-prev" });
  try {
    const res = await fetchJson<typeof claimsTable.$inferSelect>(
      `/api/claims/${seed.id}`,
      { method: "PATCH", body: { errorTypeId: "et-new", errorTypeName: "Reassigned" } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.status, "Needs Review",
      "Status must remain unchanged when errorTypeId was already populated; auto-advance is first-classify-only");
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("auto-advance: does NOT trigger from statuses other than New / Needs Review", async () => {
  const seed = await createSeedClaim({ status: "Needs Evidence", errorTypeId: null });
  try {
    const res = await fetchJson<typeof claimsTable.$inferSelect>(
      `/api/claims/${seed.id}`,
      { method: "PATCH", body: { errorTypeId: "et-3", errorTypeName: "Late assigned" } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.status, "Needs Evidence",
      "Status should remain Needs Evidence; auto-advance only fires from New / Needs Review");
  } finally {
    await cleanupClaim(seed.id);
  }
});

// ---- Structured closure on PATCH /claims/:id/outcome -------------------

const VALID_NARRATIVE =
  "Driver reported the run was completed but the trip card never saved due to a tablet sync hiccup at end-of-day.";

test("PATCH /claims/:id/outcome with structured Withdrawn closure persists every closure_* column and audits the closure sub-object", async () => {
  const seed = await createSeedClaim({ status: "Needs Review", errorTypeId: "et-x" });
  try {
    const body = {
      outcome: "Withdrawn",
      closureReason: "cannot_dispute",
      closureCategory: "evidence_gap",
      closureRootCause: "tablet_sync",
      closureNarrative: VALID_NARRATIVE,
      closureAccountabilityTags: ["driver", "it_system"],
      closureDrivers: [{ name: "Pat Driver", id: "d-1" }],
      closureCommunicatedTo: "Ops lead",
    };
    const res = await fetchJson<typeof claimsTable.$inferSelect>(
      `/api/claims/${seed.id}/outcome`,
      { method: "PATCH", body },
    );
    assert.equal(res.status, 200, `expected 200 OK, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.outcome, "Withdrawn");
    assert.equal(res.json.status, "Resolved");
    assert.equal(res.json.closureReason, "cannot_dispute");
    assert.equal(res.json.closureCategory, "evidence_gap");
    assert.equal(res.json.closureRootCause, "tablet_sync");
    assert.equal(res.json.closureNarrative, VALID_NARRATIVE);
    assert.deepEqual(res.json.closureAccountabilityTags, ["driver", "it_system"]);
    assert.deepEqual(res.json.closureDrivers, [{ name: "Pat Driver", id: "d-1" }]);
    assert.equal(res.json.closureCommunicatedTo, "Ops lead");
    assert.equal(res.json.closureReviewState, "pending",
      "Filing a structured closure must set closureReviewState=pending so the Withdrawals Review queue picks it up");

    const closureLogs = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.claimId, seed.id))
      .orderBy(desc(auditLogsTable.timestamp));
    const outcomeLog = closureLogs.find(
      (l) => (l.action === "outcome_changed" || l.action === "status_and_outcome_changed")
        && (l.metadata as any)?.closure,
    );
    assert.ok(outcomeLog, `expected an outcome_changed/status_and_outcome_changed audit log carrying a closure sub-object; got ${JSON.stringify(closureLogs.map((l) => ({ a: l.action, m: l.metadata })))}`);
    const meta = outcomeLog.metadata as any;
    const toOutcome = meta.to ?? meta.toOutcome;
    assert.equal(toOutcome, "Withdrawn");
    assert.equal(meta.closureReason, "cannot_dispute");
    assert.ok(meta.closure, "metadata must include a `closure` sub-object");
    assert.equal(meta.closure.outcome, "Withdrawn",
      "closure sub-object must echo the outcome verbatim from the request");
    assert.equal(meta.closure.closureReason, "cannot_dispute",
      "closure sub-object must use `closureReason` (not `reason`) so it matches the request payload");
    assert.equal(meta.closure.closureCategory, "evidence_gap",
      "closure sub-object must use `closureCategory` (not `category`) verbatim");
    assert.equal(meta.closure.closureRootCause, "tablet_sync",
      "closure sub-object must include `closureRootCause` verbatim");
    assert.equal(meta.closure.closureNarrative, VALID_NARRATIVE,
      "closure sub-object must use `closureNarrative` (not `narrative`) verbatim");
    assert.deepEqual(meta.closure.closureAccountabilityTags, ["driver", "it_system"],
      "closure sub-object must use `closureAccountabilityTags` verbatim");
    assert.deepEqual(meta.closure.closureDrivers, [{ name: "Pat Driver", id: "d-1" }],
      "closure sub-object must use `closureDrivers` verbatim");
    assert.equal(meta.closure.closureCommunicatedTo, "Ops lead",
      "closure sub-object must use `closureCommunicatedTo` verbatim");
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("PATCH /claims/:id/outcome rejects a Withdrawn/cannot_dispute closure when the narrative is too short", async () => {
  const seed = await createSeedClaim({ status: "Needs Review", errorTypeId: "et-x" });
  try {
    const body = {
      outcome: "Withdrawn",
      closureReason: "cannot_dispute",
      closureCategory: "evidence_gap",
      closureRootCause: "missing_documentation",
      closureNarrative: "too short",
      closureAccountabilityTags: ["driver"],
      closureDrivers: [{ name: "Pat" }],
    };
    const res = await fetchJson<{ error: string }>(
      `/api/claims/${seed.id}/outcome`,
      { method: "PATCH", body },
    );
    assert.equal(res.status, 400, `expected 400, got ${res.status}`);
    assert.match(res.json.error, /closureNarrative/i,
      "error must point at the closureNarrative field so the UI can highlight it");
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("PATCH /claims/:id/outcome rejects a cannot_dispute closure when 'driver' tag is set but no driver is supplied", async () => {
  const seed = await createSeedClaim({ status: "Needs Review", errorTypeId: "et-x" });
  try {
    const body = {
      outcome: "Withdrawn",
      closureReason: "cannot_dispute",
      closureCategory: "evidence_gap",
      closureRootCause: "missing_documentation",
      closureNarrative: VALID_NARRATIVE,
      closureAccountabilityTags: ["driver"],
      closureDrivers: [],
    };
    const res = await fetchJson<{ error: string }>(
      `/api/claims/${seed.id}/outcome`,
      { method: "PATCH", body },
    );
    assert.equal(res.status, 400);
    assert.match(res.json.error, /closureDrivers/i);
  } finally {
    await cleanupClaim(seed.id);
  }
});

// ---- POST /claim-evidence/closure --------------------------------------

test("POST /claim-evidence/closure attaches an evidence row with closureScope + closureReasonAtAttach and writes a closure_evidence_attached audit log", async () => {
  const seed = await createSeedClaim({ status: "Needs Evidence" });
  try {
    const res = await fetchJson<typeof claimEvidenceTable.$inferSelect>(
      `/api/claim-evidence/closure`,
      {
        method: "POST",
        body: {
          claimId: seed.id,
          evidenceTypeName: "Trip card",
          imageUrl: "/objects/uploads/trip-card.png",
          notes: "Captured at closure time",
          closureScope: "closure",
          closureReasonAtAttach: "cannot_dispute",
        },
      },
    );
    assert.equal(res.status, 201, `expected 201 Created, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.claimId, seed.id);
    assert.equal(res.json.invoiceGroupId, null);
    assert.equal(res.json.evidenceTypeName, "Trip card");
    assert.equal(res.json.closureScope, "closure");
    assert.equal(res.json.closureReasonAtAttach, "cannot_dispute");
    assert.equal(res.json.collectedBy, TEST_USER.displayName);

    const [auditRow] = await db.select().from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.claimId, seed.id),
        eq(auditLogsTable.action, "closure_evidence_attached"),
      ))
      .orderBy(desc(auditLogsTable.timestamp))
      .limit(1);
    assert.ok(auditRow, "must write a closure_evidence_attached audit log");
    const meta = auditRow.metadata as any;
    assert.equal(meta.evidenceId, res.json.id);
    assert.equal(meta.closureScope, "closure");
    assert.equal(meta.closureReasonAtAttach, "cannot_dispute");
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("POST /claim-evidence/closure works for an invoiceGroupId target", async () => {
  const seed = await createSeedGroup();
  try {
    const res = await fetchJson<typeof claimEvidenceTable.$inferSelect>(
      `/api/claim-evidence/closure`,
      {
        method: "POST",
        body: {
          invoiceGroupId: seed.id,
          evidenceTypeName: "Group screenshot",
          imageUrl: "/objects/uploads/group-screenshot.png",
          closureScope: "closure",
          closureReasonAtAttach: "non_issue",
        },
      },
    );
    assert.equal(res.status, 201, `expected 201, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.invoiceGroupId, seed.id);
    assert.equal(res.json.claimId, null);
    assert.equal(res.json.closureReasonAtAttach, "non_issue");
  } finally {
    await cleanupGroup(seed.id);
  }
});

test("POST /claim-evidence/closure rejects when both claimId and invoiceGroupId are provided", async () => {
  const claim = await createSeedClaim();
  const group = await createSeedGroup();
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/claim-evidence/closure`,
      {
        method: "POST",
        body: {
          claimId: claim.id,
          invoiceGroupId: group.id,
          evidenceTypeName: "Ambiguous",
        },
      },
    );
    assert.equal(res.status, 400);
    assert.match(res.json.error, /exactly one/i);
  } finally {
    await cleanupClaim(claim.id);
    await cleanupGroup(group.id);
  }
});

test("POST /claim-evidence/closure rejects when neither claimId nor invoiceGroupId is provided", async () => {
  const res = await fetchJson<{ error: string }>(
    `/api/claim-evidence/closure`,
    { method: "POST", body: { evidenceTypeName: "Orphan" } },
  );
  assert.equal(res.status, 400);
  assert.match(res.json.error, /exactly one/i);
});

test("POST /claim-evidence/closure rejects an unknown closureScope", async () => {
  const seed = await createSeedClaim();
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/claim-evidence/closure`,
      {
        method: "POST",
        body: {
          claimId: seed.id,
          evidenceTypeName: "Bad scope",
          imageUrl: "/objects/uploads/bad-scope.png",
          closureScope: "bogus",
        },
      },
    );
    assert.equal(res.status, 400);
    assert.match(res.json.error, /closureScope/i);
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("POST /claim-evidence/closure rejects an unknown closureReasonAtAttach", async () => {
  const seed = await createSeedClaim();
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/claim-evidence/closure`,
      {
        method: "POST",
        body: {
          claimId: seed.id,
          evidenceTypeName: "Bad reason",
          imageUrl: "/objects/uploads/bad-reason.png",
          closureReasonAtAttach: "made_up_reason",
        },
      },
    );
    assert.equal(res.status, 400);
    assert.match(res.json.error, /closureReasonAtAttach/i);
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("POST /claim-evidence/closure 404s when the parent claim does not exist", async () => {
  const res = await fetchJson<{ error: string }>(
    `/api/claim-evidence/closure`,
    {
      method: "POST",
      body: {
        claimId: 999_999_999,
        evidenceTypeName: "Ghost",
        imageUrl: "/objects/uploads/ghost.png",
        closureScope: "closure",
      },
    },
  );
  assert.equal(res.status, 404);
});

// ---- Validation cannot be bypassed by omitting structured fields -------

test("PATCH /claims/:id/outcome rejects Withdrawn/cannot_dispute when no structured closure fields are supplied", async () => {
  const seed = await createSeedClaim({ status: "Needs Review", errorTypeId: "et-x" });
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/claims/${seed.id}/outcome`,
      {
        method: "PATCH",
        body: { outcome: "Withdrawn", closureReason: "cannot_dispute" },
      },
    );
    assert.equal(res.status, 400,
      "a cannot_dispute closure with no closureCategory/closureRootCause/closureNarrative must be rejected — the bypass path that previously let bare bodies through is closed");
    assert.match(res.json.error, /closureCategory|closureRootCause|closureNarrative/i,
      "error must point at one of the missing required closure fields");
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("PATCH /invoice-groups/:id/outcome rejects Withdrawn/cannot_dispute when no structured closure fields are supplied", async () => {
  const seed = await createSeedGroup();
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/invoice-groups/${seed.id}/outcome`,
      {
        method: "PATCH",
        body: { outcome: "Withdrawn", closureReason: "cannot_dispute" },
      },
    );
    assert.equal(res.status, 400,
      "groups must enforce the same canonical closure validator as per-claim outcomes");
    assert.match(res.json.error, /closureCategory|closureRootCause|closureNarrative/i);
  } finally {
    await cleanupGroup(seed.id);
  }
});

test("PATCH /claims/:id/outcome requires closureRootCause for cannot_dispute closures (not just on 'other')", async () => {
  const seed = await createSeedClaim({ status: "Needs Review", errorTypeId: "et-x" });
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/claims/${seed.id}/outcome`,
      {
        method: "PATCH",
        body: {
          outcome: "Withdrawn",
          closureReason: "cannot_dispute",
          closureCategory: "evidence_gap",
          closureNarrative: VALID_NARRATIVE,
          closureAccountabilityTags: ["our_staff"],
          // closureRootCause intentionally omitted
        },
      },
    );
    assert.equal(res.status, 400,
      "closureRootCause must be required, not just validated when value === 'other'");
    assert.match(res.json.error, /closureRootCause/i);
  } finally {
    await cleanupClaim(seed.id);
  }
});

// ---- Additional validation regressions --------------------------------

test("POST /claim-evidence/closure rejects a body without imageUrl — closure evidence rows must reference an uploaded file", async () => {
  const seed = await createSeedClaim({ status: "Needs Evidence" });
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/claim-evidence/closure`,
      {
        method: "POST",
        body: {
          claimId: seed.id,
          evidenceTypeName: "Trip card",
          // imageUrl deliberately omitted
          closureScope: "closure",
          closureReasonAtAttach: "cannot_dispute",
        },
      },
    );
    assert.equal(res.status, 400,
      "closure evidence without an imageUrl is a dangling pointer; the route must reject it instead of writing a row that links to nothing");
    assert.match(res.json.error, /imageUrl/i,
      "error must call out the missing imageUrl field so callers can fix the request");
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("POST /claim-evidence/closure rejects an empty-string imageUrl", async () => {
  const seed = await createSeedClaim({ status: "Needs Evidence" });
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/claim-evidence/closure`,
      {
        method: "POST",
        body: {
          claimId: seed.id,
          evidenceTypeName: "Trip card",
          imageUrl: "",
          closureScope: "closure",
        },
      },
    );
    assert.equal(res.status, 400, "an empty imageUrl is the same as missing — must reject");
    assert.match(res.json.error, /imageUrl/i);
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("PATCH /claims/:id/outcome with Denied + structured Denied-by-Payor closure persists the closure_* columns", async () => {
  const seed = await createSeedClaim({ status: "Needs Review", errorTypeId: "et-x" });
  const [resp] = await db.insert(portalResponsesTable).values({
    claimId: seed.id,
    source: "manual",
    responseType: "denial",
    content: "Payor denial — test seed",
  }).returning({ id: portalResponsesTable.id });
  try {
    const res = await fetchJson<typeof claimsTable.$inferSelect>(
      `/api/claims/${seed.id}/outcome`,
      {
        method: "PATCH",
        body: {
          outcome: "Denied",
          closureReason: "denied_by_payor",
          closureCategory: "data_quirk",
          closureRootCause: "duplicate_ride_row",
          closureNarrative: VALID_NARRATIVE,
          closureAccountabilityTags: ["external_payor"],
        },
      },
    );
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.outcome, "Denied");
    assert.equal(res.json.closureReason, "denied_by_payor");
    assert.equal(res.json.closureCategory, "data_quirk",
      "structured closure_* fields must persist for Denied + denied_by_payor when supplied");
    assert.equal(res.json.closureRootCause, "duplicate_ride_row");
    assert.equal(res.json.closureNarrative, VALID_NARRATIVE);
  } finally {
    await db.delete(portalResponsesTable).where(eq(portalResponsesTable.id, resp.id));
    await cleanupClaim(seed.id);
  }
});

test("PATCH /claims/:id/outcome with Denied (no closureReason, no structured fields) records a bare denial", async () => {
  const seed = await createSeedClaim({ status: "Needs Review", errorTypeId: "et-x" });
  const [resp] = await db.insert(portalResponsesTable).values({
    claimId: seed.id,
    source: "manual",
    responseType: "denial",
    content: "Payor denial — test seed",
  }).returning({ id: portalResponsesTable.id });
  try {
    const res = await fetchJson<typeof claimsTable.$inferSelect>(
      `/api/claims/${seed.id}/outcome`,
      { method: "PATCH", body: { outcome: "Denied" } },
    );
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.outcome, "Denied");
    assert.equal(res.json.closureCategory, null,
      "a bare Denied (no closure body) must not persist structured closure_* columns");
    assert.equal(res.json.closureNarrative, null);
  } finally {
    await db.delete(portalResponsesTable).where(eq(portalResponsesTable.id, resp.id));
    await cleanupClaim(seed.id);
  }
});

test("PATCH /claims/:id/outcome with the Non-Issue outcome persists closureReason='non_issue' (not null)", async () => {
  const seed = await createSeedClaim({ status: "Needs Review", errorTypeId: "et-x" });
  try {
    const res = await fetchJson<typeof claimsTable.$inferSelect>(
      `/api/claims/${seed.id}/outcome`,
      {
        method: "PATCH",
        body: {
          outcome: "Non-Issue",
          closureCategory: "operational",
          closureRootCause: "data_correction",
          closureNarrative: VALID_NARRATIVE,
          closureAccountabilityTags: ["our_staff"],
        },
      },
    );
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.outcome, "Non-Issue");
    assert.equal(res.json.closureReason, "non_issue",
      "Non-Issue closures must persist closureReason='non_issue' so dashboards/queues can filter by reason without special-casing the outcome name");
    assert.equal(res.json.closureNarrative, VALID_NARRATIVE);
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("PATCH /claims/:id/outcome persists closureAddressedAt/By/ByEmail/ReviewNotes when the body supplies them", async () => {
  const seed = await createSeedClaim({ status: "Needs Review", errorTypeId: "et-x" });
  try {
    const addressedAt = "2026-04-30T12:00:00.000Z";
    const res = await fetchJson<typeof claimsTable.$inferSelect>(
      `/api/claims/${seed.id}/outcome`,
      {
        method: "PATCH",
        body: {
          outcome: "Withdrawn",
          closureReason: "cannot_dispute",
          closureCategory: "evidence_gap",
          closureRootCause: "tablet_sync",
          closureNarrative: VALID_NARRATIVE,
          closureAccountabilityTags: ["our_staff"],
          closureAddressedAt: addressedAt,
          closureAddressedBy: "Reviewer One",
          closureAddressedByEmail: "reviewer.one@example.com",
          closureReviewNotes: "Validated on 2026-04-30; cleared for closure.",
        },
      },
    );
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(
      res.json.closureAddressedAt && new Date(res.json.closureAddressedAt as unknown as string).toISOString(),
      addressedAt,
      "closureAddressedAt must round-trip from the request into the claims column",
    );
    assert.equal(res.json.closureAddressedBy, "Reviewer One",
      "closureAddressedBy must persist verbatim so reviewer attribution is auditable");
    assert.equal(res.json.closureAddressedByEmail, "reviewer.one@example.com",
      "closureAddressedByEmail must persist so we can link the reviewer to a stable identity");
    assert.equal(res.json.closureReviewNotes, "Validated on 2026-04-30; cleared for closure.",
      "closureReviewNotes must persist so the review queue can show the reviewer's commentary");
  } finally {
    await cleanupClaim(seed.id);
  }
});

// ---- Group → child cascade --------------------------------------------

test("PATCH /claims/:id/outcome rejects Non-Issue + cannot_dispute (Non-Issue requires closureReason='non_issue')", async () => {
  const seed = await createSeedClaim({ status: "Needs Review", errorTypeId: "et-x" });
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/claims/${seed.id}/outcome`,
      {
        method: "PATCH",
        body: { outcome: "Non-Issue", closureReason: "cannot_dispute" },
      },
    );
    assert.equal(res.status, 400, `expected 400, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.match(res.json.error, /Non-Issue/i);
    const [row] = await db.select().from(claimsTable).where(eq(claimsTable.id, seed.id));
    assert.equal(row.outcome, "Pending", "outcome must NOT have changed when validation rejects the request");
    assert.equal(row.closureReason, null, "closureReason must NOT have been persisted");
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("PATCH /claims/:id/outcome rejects Non-Issue + denied_by_payor", async () => {
  const seed = await createSeedClaim({ status: "Needs Review", errorTypeId: "et-x" });
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/claims/${seed.id}/outcome`,
      {
        method: "PATCH",
        body: { outcome: "Non-Issue", closureReason: "denied_by_payor" },
      },
    );
    assert.equal(res.status, 400, `expected 400, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.match(res.json.error, /Non-Issue/i);
    const [row] = await db.select().from(claimsTable).where(eq(claimsTable.id, seed.id));
    assert.equal(row.outcome, "Pending");
    assert.equal(row.closureReason, null);
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("PATCH /invoice-groups/:id/outcome rejects Non-Issue + cannot_dispute", async () => {
  const seed = await createSeedGroup();
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/invoice-groups/${seed.id}/outcome`,
      {
        method: "PATCH",
        body: { outcome: "Non-Issue", closureReason: "cannot_dispute" },
      },
    );
    assert.equal(res.status, 400, `expected 400, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.match(res.json.error, /Non-Issue/i);
    const [row] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, seed.id));
    assert.equal(row.outcome, "Pending");
    assert.equal(row.closureReason, null);
  } finally {
    await cleanupGroup(seed.id);
  }
});

test("PATCH /invoice-groups/:id/outcome rejects Non-Issue + denied_by_payor", async () => {
  const seed = await createSeedGroup();
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/invoice-groups/${seed.id}/outcome`,
      {
        method: "PATCH",
        body: { outcome: "Non-Issue", closureReason: "denied_by_payor" },
      },
    );
    assert.equal(res.status, 400, `expected 400, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.match(res.json.error, /Non-Issue/i);
    const [row] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, seed.id));
    assert.equal(row.outcome, "Pending");
    assert.equal(row.closureReason, null);
  } finally {
    await cleanupGroup(seed.id);
  }
});

// ---- Stage-aware closure-reason gates (Task #160) ----------------------

test("PATCH /claims/:id/outcome rejects Withdrawn/cannot_dispute once a portal_submission exists for the claim", async () => {
  const seed = await createSeedClaim({ status: "Needs Review", errorTypeId: "et-x", withGroup: true });
  await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: seed.invoiceGroupId!,
    status: "submitted",
  });
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/claims/${seed.id}/outcome`,
      {
        method: "PATCH",
        body: {
          outcome: "Withdrawn",
          closureReason: "cannot_dispute",
          // structured closure fields are required for cannot_dispute, so we
          // supply them here to ensure validation passes and the request
          // actually reaches the submission gate.
          closureCategory: "documentation_lost",
          closureRootCause: "trip_sheet_missing",
          closureNarrative: VALID_NARRATIVE,
          closureAccountabilityTags: ["our_staff"],
        },
      },
    );
    assert.equal(res.status, 400,
      `expected 400 (gate must reject post-submission cannot_dispute), got ${res.status} (${JSON.stringify(res.json)})`);
    assert.match(res.json.error, /Cannot Dispute|submitted to the payor/i,
      "error must explain that cannot_dispute is no longer available after submission");
    const [row] = await db.select().from(claimsTable).where(eq(claimsTable.id, seed.id));
    assert.equal(row.outcome, "Pending",
      "outcome must NOT have changed when the cannot_dispute gate rejects the request");
    assert.equal(row.closureReason, null, "closureReason must NOT have been persisted");
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("PATCH /claims/:id/outcome rejects Denied when no portal_response (or email response) is on file", async () => {
  const seed = await createSeedClaim({ status: "Needs Review", errorTypeId: "et-x", withGroup: true });
  await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: seed.invoiceGroupId!,
    status: "submitted",
  });
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/claims/${seed.id}/outcome`,
      { method: "PATCH", body: { outcome: "Denied", closureReason: "denied_by_payor" } },
    );
    assert.equal(res.status, 400,
      `expected 400 (gate must reject Denied without payor response), got ${res.status} (${JSON.stringify(res.json)})`);
    assert.match(res.json.error, /no portal or email response|Denied by Payor/i,
      "error must explain that Denied requires a recorded payor/portal response");
    const [row] = await db.select().from(claimsTable).where(eq(claimsTable.id, seed.id));
    assert.equal(row.outcome, "Pending",
      "outcome must NOT have changed when the Denied/no-response gate rejects the request");
    assert.equal(row.closureReason, null, "closureReason must NOT have been persisted");
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("PATCH /invoice-groups/:id/outcome rejects Withdrawn/cannot_dispute once any portal_submission exists for the group", async () => {
  const seed = await createSeedGroup();
  // Post-cutover, portal_submissions are group-scoped (claim_id was dropped)
  // — we just attach a submission directly to the group and the cannot_dispute
  // gate should fire on groupHasEverBeenSubmitted.
  await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: seed.id,
    status: "submitted",
  });
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/invoice-groups/${seed.id}/outcome`,
      {
        method: "PATCH",
        body: {
          outcome: "Withdrawn",
          closureReason: "cannot_dispute",
          // Supply structured closure fields so validation passes and the
          // request actually reaches the submission gate.
          closureCategory: "documentation_lost",
          closureRootCause: "trip_sheet_missing",
          closureNarrative: VALID_NARRATIVE,
          closureAccountabilityTags: ["our_staff"],
        },
      },
    );
    assert.equal(res.status, 400,
      `expected 400 (gate must reject post-submission cannot_dispute on a group), got ${res.status} (${JSON.stringify(res.json)})`);
    assert.match(res.json.error, /Cannot Dispute|submitted to the payor/i,
      "error must explain that cannot_dispute is no longer available after the group has been submitted");
    const [row] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, seed.id));
    assert.equal(row.outcome, "Pending");
    assert.equal(row.closureReason, null);
  } finally {
    await cleanupGroup(seed.id);
  }
});

test("PATCH /invoice-groups/:id/outcome rejects Denied when no portal_response (or email response) is on file for the group", async () => {
  const seed = await createSeedGroup();
  try {
    const res = await fetchJson<{ error: string }>(
      `/api/invoice-groups/${seed.id}/outcome`,
      { method: "PATCH", body: { outcome: "Denied", closureReason: "denied_by_payor" } },
    );
    assert.equal(res.status, 400,
      `expected 400 (gate must reject group Denied without payor response), got ${res.status} (${JSON.stringify(res.json)})`);
    assert.match(res.json.error, /no portal or email response|Denied by Payor/i,
      "error must explain that group Denied requires a recorded payor/portal response");
    const [row] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, seed.id));
    assert.equal(row.outcome, "Pending");
    assert.equal(row.closureReason, null);
  } finally {
    await cleanupGroup(seed.id);
  }
});

// ---- Group → child cascade --------------------------------------------

test("PATCH /invoice-groups/:id/outcome cascades closure detail and closureReason onto every non-held child claim", async () => {
  const seed = await createSeedGroup();
  const childA = await createSeedClaim({ status: "Needs Review", errorTypeId: "et-x" });
  const childB = await createSeedClaim({ status: "Needs Review", errorTypeId: "et-x" });
  await db.update(claimsTable).set({ invoiceGroupId: seed.id }).where(eq(claimsTable.id, childA.id));
  await db.update(claimsTable).set({ invoiceGroupId: seed.id }).where(eq(claimsTable.id, childB.id));
  try {
    const res = await fetchJson<typeof invoiceGroupsTable.$inferSelect>(
      `/api/invoice-groups/${seed.id}/outcome`,
      {
        method: "PATCH",
        body: {
          outcome: "Withdrawn",
          closureReason: "cannot_dispute",
          closureCategory: "evidence_gap",
          closureRootCause: "missing_documentation",
          closureNarrative: VALID_NARRATIVE,
          closureAccountabilityTags: ["our_staff"],
        },
      },
    );
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);

    for (const id of [childA.id, childB.id]) {
      const [child] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
      assert.equal(child.status, "Resolved", `child ${id} must be moved to Resolved alongside the group`);
      assert.equal(child.outcome, "Withdrawn", `child ${id} must inherit the group's Withdrawn outcome`);
      assert.equal(child.closureReason, "cannot_dispute",
        `child ${id} must inherit closureReason from the group cascade`);
      assert.equal(child.closureCategory, "evidence_gap",
        `child ${id} must inherit the structured closureCategory from the group`);
      assert.equal(child.closureRootCause, "missing_documentation",
        `child ${id} must inherit the structured closureRootCause from the group`);
      assert.equal(child.closureNarrative, VALID_NARRATIVE,
        `child ${id} must inherit the closureNarrative from the group`);
      assert.equal(child.closureReviewState, "pending",
        `child ${id} must inherit closureReviewState='pending' so review queues can find it`);
    }
  } finally {
    await cleanupClaim(childA.id);
    await cleanupClaim(childB.id);
    await cleanupGroup(seed.id);
  }
});

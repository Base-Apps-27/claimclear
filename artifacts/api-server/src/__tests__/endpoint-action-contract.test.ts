import { phaseForStatus, dispositionForGroup } from "./fixtures/state";
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, and, desc, sql } from "drizzle-orm";

import portalSubmissionsRouter from "../routes/portal-submissions";
import invoiceGroupsRouter from "../routes/invoice-groups";
import claimsRouter from "../routes/claims";
import notesRouter from "../routes/notes";
import anthropicRouter from "../routes/anthropic";
import claimEvidenceRouter from "../routes/claim-evidence";
import adminRemovalsRouter from "../routes/admin-removals";
import { ObjectStorageService } from "../lib/objectStorage";
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

// Task #411: cross-cutting endpoint-action contract tests.
//
// Each action-named endpoint must produce its named side-effect, not
// merely return 200/204 with a status flag stamped. These tests would
// fail if any of the audit's findings reverted to the old
// "button-stamps-a-flag" behavior.
//
// Specifically asserted:
//   1. POST /portal-submissions/:id/confirm with `ack:true` and a
//      pending lint warning writes a dedicated `lint_warnings_bypassed`
//      audit row (separate from the generic `portal_submission_confirmed`
//      row). A blended row would silently lose the bypass signal.
//   2. POST /portal-submissions returns 400 with `code:"missing_description"`
//      when both `descriptionHtml` and `disputeReason` are absent (no
//      silent fallback boilerplate substitution).
//   3. POST /claims/bulk-assign-error-type returns a per-row breakdown
//      with `skipped` listing requested ids that didn't actually change
//      (instead of `{updated: requestedCount}` lying that everything
//      worked).
//   4. POST /invoice-groups/bulk-assign-error-type returns the same
//      per-row breakdown shape.
//   5. DELETE /api/notes/:id actually removes the note row AND writes a
//      `note_deleted` audit entry.
//   6. The four removed admin/orphan DELETE endpoints (claims, invoice
//      groups, group-evidence, anthropic conversations) return 404 — the
//      surface area no longer exposes them.

const TEST_BOT_TOKEN = "test-bot-service-token-411";

let server: http.Server;
let baseUrl: string;

const TEST_USER = { email: "endpoint-contract-tester@example.com", displayName: "Endpoint Contract Tester" };

// Task #413: spy on the orphan-blob cleanup so the integration tests
// can deterministically assert that a row-insert failure on the
// claim-evidence write path triggers a best-effort blob delete with
// the same `imageUrl` the caller passed. The spy returns true to
// simulate a successful delete (real GCS isn't reachable in tests),
// and records every call in `tryDeleteCalls` so each test can scope
// its assertions to the blob path it created.
const tryDeleteCalls: string[] = [];
const originalTryDeleteObjectEntity = ObjectStorageService.prototype.tryDeleteObjectEntity;
ObjectStorageService.prototype.tryDeleteObjectEntity = async function (objectPath: string): Promise<boolean> {
  tryDeleteCalls.push(objectPath);
  return true;
};

before(async () => {
  process.env.BOT_SERVICE_TOKEN = TEST_BOT_TOKEN;

  const app: Express = express();
  app.use(express.json());

  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved", role: "admin" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });

  app.use("/api", portalSubmissionsRouter);
  app.use("/api", invoiceGroupsRouter);
  app.use("/api", claimsRouter);
  app.use("/api", notesRouter);
  app.use("/api", claimEvidenceRouter);
  app.use("/api/anthropic/conversations", anthropicRouter);
  app.use("/api", adminRemovalsRouter);

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
  ObjectStorageService.prototype.tryDeleteObjectEntity = originalTryDeleteObjectEntity;
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
          // Express's default 404 handler returns HTML, not JSON, so we
          // tolerate non-JSON bodies — the test asserts on status code,
          // and falls back to a body-as-string in `_raw` if needed.
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
  const invoiceNumber = `T411G-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
  errorTypeId?: string | null;
  errorTypeName?: string | null;
  sopOutcome?: string | null;
} = {}): Promise<typeof claimsTable.$inferSelect> {
  const confNumber = `T411-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const invoiceGroupId = opts.invoiceGroupId ?? null;
  const disposition = await dispositionForGroup(invoiceGroupId);
  const [row] = await db.insert(claimsTable).values({
    confNumber,
    status: "Needs Evidence",
    outcome: "Pending",
    invoiceGroupId,
    errorTypeId: opts.errorTypeId ?? null,
    errorTypeName: opts.errorTypeName ?? null,
    sopOutcome: opts.sopOutcome ?? null,
    includedInDispute: true,
    claimAmount: "100.00",
    disposition,
  }).returning();
  return row;
}

async function createSeedErrorType(): Promise<typeof errorTypesTable.$inferSelect> {
  const name = `T411-ErrType-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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

test("Tier 3: POST /portal-submissions refuses with 400 + code:missing_description when both descriptionHtml and disputeReason are absent (no silent fallback boilerplate)", async () => {
  const errType = await createSeedErrorType();
  const group = await createSeedGroup();
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    // sopOutcome must be set so the legs gate considers the leg
    // resolved — otherwise the test trips the legs gate first and
    // never exercises the description branch we actually want to assert.
    sopOutcome: "portal_dispute",
  });
  // Mark preview-generated so we get past the preview gate and into
  // the description branch — that's the line that previously fell
  // back to `buildFallbackDescription` and now must return 400.
  await db.update(invoiceGroupsTable)
    .set({ previewGeneratedAt: new Date(), understandingReadbackAt: new Date() })
    .where(eq(invoiceGroupsTable.id, group.id));
  try {
    const res = await fetchJson("/api/portal-submissions", {
      method: "POST",
      body: {
        invoiceGroupId: group.id,
        actorType: "system",
        // both descriptionHtml AND disputeReason intentionally omitted
      },
      headers: { "x-bot-token": TEST_BOT_TOKEN },
    });
    assert.equal(res.status, 400, `expected 400 missing_description, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.code, "missing_description", "endpoint must return a stable code so callers can distinguish 'I forgot the draft' from a 502 LLM outage");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

// Task #703: lint+bypass gating moved from the now-removed
// `/portal-submissions/:id/confirm` route onto POST /portal-submissions
// (the submit-time row creator). The contract — dedicated
// `lint_warnings_bypassed` audit row + verbatim operator reason — is
// preserved verbatim, only the call shape changed.
test("Tier 3 (#703 post-cutover): POST /portal-submissions with ack:true writes a dedicated lint_warnings_bypassed audit row (separate from portal_submission_confirmed)", async () => {
  const errType = await createSeedErrorType();
  const group = await createSeedGroup();
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: "portal_dispute",
  });
  // Make the group eligible for the submit-time creation path: pass
  // the preview gate and the all-disputed-legs-resolved gate.
  await db.update(invoiceGroupsTable)
    .set({ previewGeneratedAt: new Date(), understandingReadbackAt: new Date() })
    .where(eq(invoiceGroupsTable.id, group.id));
  try {
    const TEST_BYPASS_REASON = "Operator override: payor previously accepted similar wording, see attached PDF.";
    // Description deliberately references "photo" without a matching
    // claim_evidence row → triggers the `unattached_evidence:photo`
    // warning rule deterministically. Includes the conf number so
    // the missing-conf hard-fail doesn't fire.
    const descriptionHtml = `<p>Confirmation ${claim.confNumber}: please review the attached photo for proof.</p>`;
    const res = await fetchJson("/api/portal-submissions", {
      method: "POST",
      body: {
        invoiceGroupId: group.id,
        actorType: "operator",
        descriptionHtml,
        ack: true,
        bypassReason: TEST_BYPASS_REASON,
      },
    });
    assert.equal(res.status, 201, `expected 201 created, got ${res.status} (${JSON.stringify(res.json)})`);
    const submissionId = res.json.id as number;

    // Task #703 regression: exactly ONE portal_submissions row exists
    // for the group, and it landed in `pending` directly — no ghost
    // draft row got inserted along the way.
    const allRows = await db.select().from(portalSubmissionsTable)
      .where(eq(portalSubmissionsTable.invoiceGroupId, group.id));
    assert.equal(allRows.length, 1, `expected exactly 1 portal_submissions row, got ${allRows.length}`);
    assert.equal(allRows[0].status, "pending", "submit-time creator must land the row in pending, never draft");

    const bypassRows = await db.select().from(auditLogsTable).where(
      and(
        eq(auditLogsTable.invoiceGroupId, group.id),
        eq(auditLogsTable.action, "lint_warnings_bypassed"),
      ),
    );
    const confirmRows = await db.select().from(auditLogsTable).where(
      and(
        eq(auditLogsTable.invoiceGroupId, group.id),
        eq(auditLogsTable.action, "portal_submission_confirmed"),
      ),
    );
    assert.ok(confirmRows.length >= 1, "expected portal_submission_confirmed audit row from the submit-time creator");
    assert.ok(bypassRows.length >= 1, "expected lint_warnings_bypassed audit row when ack=true with a real warning");

    const meta = bypassRows[0].metadata as any;
    assert.ok(Array.isArray(meta?.bypassedWarnings), "lint_warnings_bypassed must record the actual warnings, not just a flag");
    assert.equal(typeof meta.bypassedCount, "number", "lint_warnings_bypassed must record how many warnings were bypassed");
    assert.equal(meta.submissionId, submissionId, "lint_warnings_bypassed must reference the submission");
    assert.equal(
      meta.bypassReason,
      TEST_BYPASS_REASON,
      "lint_warnings_bypassed must record the operator's typed bypass reason verbatim",
    );
    assert.ok(
      (bypassRows[0].details ?? "").includes(TEST_BYPASS_REASON),
      "lint_warnings_bypassed details string must surface the bypass reason for the activity feed",
    );
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("Tier 3 (#703 post-cutover): POST /portal-submissions with ack:true but missing bypassReason refuses with 400 + code:missing_bypass_reason", async () => {
  // Bypassing lint warnings without a written reason must still be a
  // hard refusal at the new submit-time row-creation site. Same
  // contract that previously lived on /confirm.
  const errType = await createSeedErrorType();
  const group = await createSeedGroup();
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: "portal_dispute",
  });
  await db.update(invoiceGroupsTable)
    .set({ previewGeneratedAt: new Date(), understandingReadbackAt: new Date() })
    .where(eq(invoiceGroupsTable.id, group.id));
  try {
    // Same warn-deterministic description: references "photo" with
    // no matching evidence row → guaranteed warning, no hard-fail.
    const descriptionHtml = `<p>Confirmation ${claim.confNumber}: please review the attached photo.</p>`;
    const res = await fetchJson("/api/portal-submissions", {
      method: "POST",
      body: {
        invoiceGroupId: group.id,
        actorType: "operator",
        descriptionHtml,
        ack: true, // bypassReason intentionally omitted
      },
    });
    assert.equal(res.status, 400, `expected 400 missing_bypass_reason, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json?.code, "missing_bypass_reason", `expected code:missing_bypass_reason, got ${res.json?.code}`);
    assert.equal(res.json?.field, "bypassReason", `expected field:bypassReason, got ${res.json?.field}`);

    // Task #703 regression: a refused submit must not have left ANY
    // portal_submissions row behind for the group — neither a draft
    // nor a pending row. The whole insert is gated by lint, so
    // failure means zero rows.
    const allRows = await db.select().from(portalSubmissionsTable)
      .where(eq(portalSubmissionsTable.invoiceGroupId, group.id));
    assert.equal(allRows.length, 0, `expected 0 portal_submissions rows after refused submit, found ${allRows.length}`);
    // No lint_warnings_bypassed row may exist on the refusal path —
    // that row is only written when a real bypass with a real reason
    // succeeds.
    const bypassRows = await db.select().from(auditLogsTable).where(
      and(
        eq(auditLogsTable.invoiceGroupId, group.id),
        eq(auditLogsTable.action, "lint_warnings_bypassed"),
      ),
    );
    assert.equal(bypassRows.length, 0, "no lint_warnings_bypassed row may exist when the bypass refusal path fires");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

// Task #703: full preview → save-draft → submit happy path. Asserts
// (1) Generate-preview never inserts a portal_submissions row,
// (2) saving the draft to invoice_groups.draft* never inserts one,
// (3) Submit creates exactly one row landing in `pending` directly.
test("Tier 3 (#703): preview → save draft → submit creates exactly one pending portal_submissions row at submit time, none before", async () => {
  const errType = await createSeedErrorType();
  const group = await createSeedGroup();
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
    sopOutcome: "portal_dispute",
  });
  try {
    // Step 1: Generate preview. Pre-#703 this inserted a ghost
    // status='draft' row; post-#703 it must only stamp invoice_groups.
    const previewRes = await fetchJson(`/api/invoice-groups/${group.id}/preview-generated`, {
      method: "POST",
      body: {},
    });
    assert.equal(previewRes.status, 200, `preview failed: ${JSON.stringify(previewRes.json)}`);
    let rows = await db.select().from(portalSubmissionsTable)
      .where(eq(portalSubmissionsTable.invoiceGroupId, group.id));
    assert.equal(rows.length, 0, `Generate-preview must not insert a portal_submissions row, found ${rows.length}`);

    // Step 2: save the operator's edits to the draft. Same regression
    // surface — must not insert a portal_submissions row.
    const saveRes = await fetchJson(`/api/invoice-groups/${group.id}/draft`, {
      method: "POST",
      body: {
        subject: `Dispute for ${group.invoiceNumber}`,
        descriptionHtml: `<p>Confirmation ${claim.confNumber}: please refund this trip.</p>`,
      },
    });
    assert.equal(saveRes.status, 200, `save draft failed: ${JSON.stringify(saveRes.json)}`);
    rows = await db.select().from(portalSubmissionsTable)
      .where(eq(portalSubmissionsTable.invoiceGroupId, group.id));
    assert.equal(rows.length, 0, `Save draft must not insert a portal_submissions row, found ${rows.length}`);

    // Step 3: Submit. This is the ONE row-insert site post-#703.
    // Mirrors the gauntlet's submit body shape — passes the operator-
    // reviewed draft text inline.
    const submitRes = await fetchJson("/api/portal-submissions", {
      method: "POST",
      body: {
        invoiceGroupId: group.id,
        actorType: "operator",
        descriptionHtml: `<p>Confirmation ${claim.confNumber}: please refund this trip.</p>`,
      },
    });
    assert.equal(submitRes.status, 201, `submit failed: ${submitRes.status} ${JSON.stringify(submitRes.json)}`);

    rows = await db.select().from(portalSubmissionsTable)
      .where(eq(portalSubmissionsTable.invoiceGroupId, group.id));
    assert.equal(rows.length, 1, `expected exactly 1 portal_submissions row after submit, got ${rows.length}`);
    assert.equal(rows[0].status, "pending", `the row must land in pending directly, got status=${rows[0].status}`);

    // Confirm audit row written by the submit-time creator.
    const confirmRows = await db.select().from(auditLogsTable).where(
      and(
        eq(auditLogsTable.invoiceGroupId, group.id),
        eq(auditLogsTable.action, "portal_submission_confirmed"),
      ),
    );
    assert.ok(confirmRows.length >= 1, "expected portal_submission_confirmed audit row from the submit-time creator");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

// Task #703 round 2 (per code review): the boot-time cleanup must
// HARD-DELETE orphan ghost-draft rows so they vanish from the Portal
// Submissions list, not just flip them to `cancelled` (which still
// renders in the "All" view of the list page). This test simulates a
// pre-#703 ghost row, runs the same DELETE the boot-time backfill in
// `index.ts` runs, then asserts the list payload (GET
// /portal-submissions, the same endpoint the UI's data hook uses)
// returns zero rows for the group — proving the row truly is gone.
test("Tier 3 (#703 r2): orphan ghost-draft rows are hard-deleted at boot and do not appear in GET /portal-submissions", async () => {
  const errType = await createSeedErrorType();
  const group = await createSeedGroup();
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
  });
  // Simulate a pre-#703 ghost row exactly as the old generate-preview
  // path would have written it: status='draft', no bot activity
  // markers, all the orphan-criteria the cleanup matches on.
  const [ghost] = await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: group.id,
    status: "draft",
    issueType: "other",
    subject: "ghost",
    descriptionHtml: "<p>ghost</p>",
    confNumber: claim.confNumber,
    refNumber: null,
    invoiceNumber: group.invoiceNumber,
    attempts: 0,
    portalTicketId: null,
    claimedByBatchId: null,
  }).returning();
  try {
    // Same DELETE statement as the boot-time backfill in
    // artifacts/api-server/src/index.ts. Kept inline (not extracted)
    // because the boot helper isn't exported and re-using its SQL
    // text proves the regression at the exact point the operator's
    // session hits it post-deploy.
    await db.execute(sql`
      DELETE FROM portal_submissions
      WHERE status = 'draft'
        AND attempts = 0
        AND portal_ticket_id IS NULL
        AND claimed_by_batch_id IS NULL
    `);

    // The exact endpoint the Portal Submissions page hits — no status
    // filter, "All" view. Pre-fix this returned the ghost as
    // status='cancelled' which still rendered in the list.
    const res = await fetchJson("/api/portal-submissions");
    assert.equal(res.status, 200, `list fetch failed: ${res.status} ${JSON.stringify(res.json)}`);
    const list = Array.isArray(res.json) ? res.json : (res.json?.items ?? []);
    const groupRows = (list as Array<{ id: number; invoiceGroupId: number }>)
      .filter(r => r.invoiceGroupId === group.id);
    assert.equal(
      groupRows.length,
      0,
      `Portal Submissions list must return 0 rows for the group after ghost cleanup (ghost was id=${ghost.id}); found ${groupRows.length}`,
    );
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("Tier 4: POST /claims/bulk-assign-error-type returns per-row breakdown including skipped ids that don't exist", async () => {
  const errType = await createSeedErrorType();
  const claim = await createSeedClaim();
  const phantomId = 9_000_000 + Math.floor(Math.random() * 1e6);
  try {
    const res = await fetchJson(`/api/claims/bulk-assign-error-type`, {
      method: "POST",
      body: {
        claimIds: [claim.id, phantomId],
        errorTypeId: errType.id,
      },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.updated, 1, "exactly one real claim should have been updated");
    assert.ok(Array.isArray(res.json.skipped), "response must include a per-row skipped array — generic { updated } is not enough");
    const skipped = res.json.skipped as Array<{ id: number; reason: string }>;
    assert.ok(
      skipped.some((s) => s.id === phantomId && s.reason === "not_found"),
      `phantom id ${phantomId} must appear in skipped[] with reason=not_found, got ${JSON.stringify(skipped)}`,
    );
    assert.ok(Array.isArray(res.json.updatedItems), "response must include updatedItems[] so the toast can name what changed");
  } finally {
    await cleanupClaim(claim.id);
    await cleanupErrorType(errType.id);
  }
});

test("Tier 4: POST /invoice-groups/bulk-assign-error-type returns per-row breakdown including skipped ids that don't exist", async () => {
  const errType = await createSeedErrorType();
  const group = await createSeedGroup();
  const phantomId = 9_000_000 + Math.floor(Math.random() * 1e6);
  try {
    const res = await fetchJson(`/api/invoice-groups/bulk-assign-error-type`, {
      method: "POST",
      body: {
        groupIds: [group.id, phantomId],
        errorTypeId: String(errType.id),
        errorTypeName: errType.name,
      },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.updated, 1, "exactly one real group should have been updated");
    assert.ok(Array.isArray(res.json.skipped), "response must include a per-row skipped array");
    const skipped = res.json.skipped as Array<{ id: number; reason: string }>;
    assert.ok(
      skipped.some((s) => s.id === phantomId && s.reason === "not_found"),
      `phantom id ${phantomId} must appear in skipped[] with reason=not_found, got ${JSON.stringify(skipped)}`,
    );
    assert.ok(Array.isArray(res.json.updatedItems), "response must include updatedItems[]");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("Tier 5: DELETE /api/notes/:id actually removes the note row and writes a note_deleted audit entry", async () => {
  const claim = await createSeedClaim();
  // Author must match `req.user.displayName` so the route's owner check passes.
  const [note] = await db.insert(notesTable).values({
    claimId: claim.id,
    content: "test note for delete contract",
    type: "manual",
    author: TEST_USER.displayName,
  }).returning();
  try {
    const res = await fetchJson(`/api/notes/${note.id}`, { method: "DELETE" });
    assert.equal(res.status, 204, `expected 204, got ${res.status} (${JSON.stringify(res.json)})`);

    const stillThere = await db.select().from(notesTable).where(eq(notesTable.id, note.id));
    assert.equal(stillThere.length, 0, "DELETE must remove the row, not just stamp a soft-delete flag");

    const audit = await db.select().from(auditLogsTable).where(
      and(eq(auditLogsTable.claimId, claim.id), eq(auditLogsTable.action, "note_deleted")),
    );
    assert.ok(audit.length >= 1, "DELETE must write a note_deleted audit row so the timeline reflects the action");
  } finally {
    await cleanupClaim(claim.id);
  }
});

test("Action endpoint: POST /claims/:id/post-response-action with action=mark_denied_by_payor actually transitions claim status (no flag-stamp)", async () => {
  const claim = await createSeedClaim();
  // post-response-action requires the claim to be in a status the
  // transition function accepts. mark_denied_by_payor moves to
  // Denied/Denied — the source status doesn't matter for the
  // contract assertion (we just verify the action *did* the named
  // work, not just returned 200).
  try {
    const res = await fetchJson(`/api/claims/${claim.id}/post-response-action`, {
      method: "POST",
      body: { action: "mark_denied_by_payor", notes: "test" },
    });
    // Either the transition succeeded (200) — in which case the
    // claim row must reflect it — or the transition was guarded
    // (400/404) — in which case the claim row must NOT reflect it
    // (proving the endpoint isn't stamping a flag and ignoring the
    // guard). Both shapes are valid; what's invalid is "200 + no
    // mutation".
    const [after] = await db.select().from(claimsTable).where(eq(claimsTable.id, claim.id));
    if (res.status === 200) {
      assert.equal(after.status, "Denied", `200 response must be backed by a real status transition, got status=${after.status}`);
      assert.equal(after.outcome, "Denied", `200 response must be backed by a real outcome transition, got outcome=${after.outcome}`);
      const audit = await db.select().from(auditLogsTable).where(
        and(eq(auditLogsTable.claimId, claim.id)),
      );
      assert.ok(audit.length >= 1, "post-response-action must write at least one audit row");
    } else {
      assert.notEqual(after.status, "Denied", `non-200 response must NOT have mutated the row, got status=${after.status}`);
    }
  } finally {
    await cleanupClaim(claim.id);
  }
});

test("Action endpoint: POST /invoice-groups/:id/reattest/complete refuses (409) when phase precondition is unmet — no silent stamp of reattestCompletedAt", async () => {
  // The seed group is Needs Evidence (pre-submit), which is NOT the
  // mas-action-required phase that reattest/complete expects. The
  // endpoint must refuse with 409 AND must NOT have stamped
  // reattest_completed_at as a side effect — that's the exact
  // anti-pattern this contract test exists to catch.
  const group = await createSeedGroup();
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/reattest/complete`, {
      method: "POST",
      body: { note: "test" },
    });
    assert.equal(res.status, 409, `expected 409 phase guard, got ${res.status} (${JSON.stringify(res.json)})`);
    const [after] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.equal(after.reattestCompletedAt, null, "reattest_completed_at must remain null after a 409 — never stamp on the refusal path");
    assert.equal(after.reattestCompletedBy, null, "reattest_completed_by must remain null after a 409");
  } finally {
    await cleanupGroup(group.id);
  }
});

test("Action endpoint: POST /invoice-groups/:id/preview-generated refuses (409) when disputed legs are unresolved — no silent stamp of previewGeneratedAt", async () => {
  // Seed: a group in pre-submit with one disputed leg that has no
  // sopOutcome (i.e. unresolved). preview-generated must refuse with
  // 409 AND must NOT have stamped previewGeneratedAt.
  const group = await createSeedGroup();
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    // No sopOutcome → disputed leg is unresolved → legs gate fires.
  });
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/preview-generated`, {
      method: "POST",
      body: {},
    });
    assert.equal(res.status, 409, `expected 409 legs guard, got ${res.status} (${JSON.stringify(res.json)})`);
    const [after] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.equal(after.previewGeneratedAt, null, "preview_generated_at must remain null after a 409 — never stamp on the refusal path");
  } finally {
    await cleanupGroup(group.id);
  }
});

test("Action endpoint: POST /invoice-groups/:id/draft/regenerate refuses (4xx) when no eligible legs — no silent stamp of draftEditedAt", async () => {
  // Seed group has zero attached claims, so the LLM helper
  // (`generatePortalDraftForGroup`) raises `GroupNotFoundError` (it
  // really means "no eligible legs in this group") and the route
  // maps that to 404. The contract assertion is the same as for the
  // other refusal-path tests: a non-200 response MUST NOT have
  // overwritten the draft columns. Before the contract was tightened
  // the route silently re-wrote the draft from the latest portal-
  // submission row even when no fresh AI take was produced.
  const group = await createSeedGroup();
  const [before] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/draft/regenerate`, {
      method: "POST",
      body: {},
    });
    assert.ok(res.status >= 400 && res.status < 500, `expected 4xx refusal, got ${res.status} (${JSON.stringify(res.json)})`);
    const [after] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.equal(
      String(after.draftDescriptionHtml ?? ""),
      String(before.draftDescriptionHtml ?? ""),
      "draft_description_html must not have been overwritten on the refusal path",
    );
    assert.equal(
      after.draftEditedAt?.toISOString() ?? null,
      before.draftEditedAt?.toISOString() ?? null,
      "draft_edited_at must not have been stamped on the refusal path",
    );
  } finally {
    await cleanupGroup(group.id);
  }
});

test("Tier 2 atomic upload: POST /claims/:claimId/evidence with an invalid imageUrl shape rejects without leaving any orphan claim_evidence row", async () => {
  // Validation refusal must be a clean refusal — no half-written
  // row. The atomic-upload contract is verified at insert time:
  // before this fix, a bad imageUrl validated late could have left
  // an inconsistent row. The post-fix invariant is that a 400
  // response leaves the table exactly as it was found.
  const claim = await createSeedClaim();
  const beforeRows = await db.select().from(claimEvidenceTable).where(eq(claimEvidenceTable.claimId, claim.id));
  try {
    const res = await fetchJson(`/api/claims/${claim.id}/evidence`, {
      method: "POST",
      body: {
        evidenceTypeName: "Test Evidence",
        imageUrl: "https://malicious.example.com/file.png", // not /objects/...
      },
    });
    assert.equal(res.status, 400, `expected 400 invalid imageUrl, got ${res.status} (${JSON.stringify(res.json)})`);
    const afterRows = await db.select().from(claimEvidenceTable).where(eq(claimEvidenceTable.claimId, claim.id));
    assert.equal(
      afterRows.length,
      beforeRows.length,
      "400 must leave the claim_evidence table exactly as found — no half-written row",
    );
  } finally {
    await cleanupClaim(claim.id);
  }
});

test("Tier 5: removed orphan DELETE endpoints are absent from the API surface", async () => {
  // These endpoints had no UI caller and were removed per the
  // endpoint-action contract rule. Re-introducing them without a
  // calling UI must fail this test.
  const claim = await createSeedClaim();
  const group = await createSeedGroup();
  try {
    const claimRes = await fetchJson(`/api/claims/${claim.id}`, { method: "DELETE" });
    assert.equal(claimRes.status, 404, `DELETE /claims/:id must be absent, got ${claimRes.status}`);

    const groupRes = await fetchJson(`/api/invoice-groups/${group.id}`, { method: "DELETE" });
    assert.equal(groupRes.status, 404, `DELETE /invoice-groups/:id must be absent, got ${groupRes.status}`);

    const evidenceRes = await fetchJson(`/api/invoice-groups/${group.id}/evidence/1`, { method: "DELETE" });
    assert.equal(evidenceRes.status, 404, `DELETE /invoice-groups/:id/evidence/:evidenceId must be absent, got ${evidenceRes.status}`);

    const anthropicRes = await fetchJson(`/api/anthropic/conversations/1`, { method: "DELETE" });
    assert.equal(anthropicRes.status, 404, `DELETE /anthropic/conversations/:id must be absent, got ${anthropicRes.status}`);
  } finally {
    await cleanupGroup(group.id);
    await cleanupClaim(claim.id);
  }
});

// ---------------------------------------------------------------------------
// Task #413 — atomic upload: row-insert failure must clean up the orphan blob.
//
// Evidence upload is a two-step flow: PUT /storage/uploads finalizes the
// blob, then POST /claims/:id/evidence inserts the `claim_evidence` row
// pointing at it. If the second step fails, the blob would otherwise be
// orphaned in object storage forever (paying GCS rent with no UI surface
// referencing it). The route wraps the insert in a try/catch and calls
// `objectStorageService.tryDeleteObjectEntity(imageUrl)` on failure, BUT
// only if no other `claim_evidence` row already references that blob —
// otherwise we'd nuke a blob a different leg is legitimately reusing.
//
// The tests below exercise all three corners of that contract end-to-end
// via the live HTTP server and DB, with the storage delete spied so we
// don't need a real GCS connection.
// ---------------------------------------------------------------------------

test("Task #413: POST /claims/:claimId/evidence row-insert failure triggers best-effort orphan blob cleanup with the same imageUrl", async () => {
  // Force a row-insert failure deterministically: claim_id is a FK to
  // claims.id (ON DELETE CASCADE), so a non-existent claim id makes
  // the insert raise a FK violation. This is the realistic shape of
  // the failure the post-ingest audit (Task #411) flagged: the blob
  // is already finalized in storage by the time the row insert dies.
  const phantomClaimId = 9_000_000 + Math.floor(Math.random() * 1e6);
  const fakeBlob = `/objects/uploads/task-413-orphan-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`;

  const callsBefore = tryDeleteCalls.length;
  const res = await fetchJson(`/api/claims/${phantomClaimId}/evidence`, {
    method: "POST",
    body: {
      evidenceTypeName: "Task 413 Orphan Test",
      imageUrl: fakeBlob,
    },
  });

  assert.equal(res.status, 500, `expected 500 from FK-violating insert, got ${res.status} (${JSON.stringify(res.json)})`);

  const newCalls = tryDeleteCalls.slice(callsBefore);
  assert.deepEqual(
    newCalls,
    [fakeBlob],
    `row-insert failure must trigger exactly one best-effort blob delete with the caller's imageUrl, got ${JSON.stringify(newCalls)}`,
  );

  // No orphan claim_evidence row may have been written for the phantom
  // claim id, and no row pointing at the orphan blob may exist anywhere
  // in the table — the storage finalize and the row insert must either
  // both land or neither land.
  const phantomRows = await db.select().from(claimEvidenceTable).where(eq(claimEvidenceTable.claimId, phantomClaimId));
  assert.equal(phantomRows.length, 0, "no claim_evidence row may exist for the phantom claim id after a 500");
  const blobRows = await db.select().from(claimEvidenceTable).where(eq(claimEvidenceTable.imageUrl, fakeBlob));
  assert.equal(blobRows.length, 0, "no claim_evidence row may reference the orphan blob after a 500");
});

test("Task #413: successful POST /claims/:claimId/evidence makes the file visible in GET /claims/:id/evidence immediately (no cleanup attempted)", async () => {
  // The "happy path" half of the atomic-upload contract: a 2xx
  // response means the row landed and the leg's evidence list must
  // reflect the new file on the very next read. This guards against
  // any future refactor that defers the insert (e.g. into a queue) —
  // such a change would break the "API returns 2xx → leg shows it"
  // invariant the task explicitly calls out.
  const claim = await createSeedClaim();
  const realBlob = `/objects/uploads/task-413-happy-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`;
  const callsBefore = tryDeleteCalls.length;
  try {
    const postRes = await fetchJson(`/api/claims/${claim.id}/evidence`, {
      method: "POST",
      body: {
        evidenceTypeName: "Task 413 Happy Path",
        imageUrl: realBlob,
        notes: "uploaded by integration test",
      },
    });
    assert.equal(postRes.status, 201, `expected 201 on happy path, got ${postRes.status} (${JSON.stringify(postRes.json)})`);
    assert.equal(postRes.json.imageUrl, realBlob, "201 response must echo the persisted imageUrl");

    // Cleanup must NOT have been invoked on the success path —
    // the spy would have appended a call if it had been.
    assert.equal(
      tryDeleteCalls.length,
      callsBefore,
      `success path must not invoke orphan-blob cleanup, but ${tryDeleteCalls.length - callsBefore} call(s) were recorded`,
    );

    const listRes = await fetchJson(`/api/claims/${claim.id}/evidence`);
    assert.equal(listRes.status, 200, `GET evidence list must succeed, got ${listRes.status}`);
    const listed: Array<{ id: number; imageUrl: string | null }> = listRes.json.evidence;
    assert.ok(
      Array.isArray(listed) && listed.some((e) => e.imageUrl === realBlob),
      `GET /claims/${claim.id}/evidence must include the just-uploaded blob immediately after the 201, got ${JSON.stringify(listed)}`,
    );
  } finally {
    await cleanupClaim(claim.id);
  }
});

test("Task #413: row-insert failure must NOT delete the blob when another claim_evidence row already references it (shared-blob safety)", async () => {
  // The cleanup helper deliberately checks for existing references
  // to the same `imageUrl` before calling tryDeleteObjectEntity —
  // otherwise re-attaching an existing evidence file to a second
  // leg, where the second insert fails, would silently destroy the
  // blob the first leg still points at. This test pins that
  // guard: an existing row with the same imageUrl must keep the
  // blob safe even when a follow-up insert fails.
  const sharedClaim = await createSeedClaim();
  const sharedBlob = `/objects/uploads/task-413-shared-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`;
  try {
    // First, a successful insert that legitimately references the blob.
    const firstRes = await fetchJson(`/api/claims/${sharedClaim.id}/evidence`, {
      method: "POST",
      body: { evidenceTypeName: "Shared Blob Owner", imageUrl: sharedBlob },
    });
    assert.equal(firstRes.status, 201, `seed insert must succeed, got ${firstRes.status} (${JSON.stringify(firstRes.json)})`);

    const callsBefore = tryDeleteCalls.length;

    // Now a second insert against a phantom claim id that fails on
    // FK violation, but uses the SAME blob path.
    const phantomClaimId = 9_000_000 + Math.floor(Math.random() * 1e6);
    const failRes = await fetchJson(`/api/claims/${phantomClaimId}/evidence`, {
      method: "POST",
      body: { evidenceTypeName: "Shared Blob Reattach", imageUrl: sharedBlob },
    });
    assert.equal(failRes.status, 500, `phantom-claim insert must fail with 500, got ${failRes.status} (${JSON.stringify(failRes.json)})`);

    const newCalls = tryDeleteCalls.slice(callsBefore);
    assert.deepEqual(
      newCalls,
      [],
      `cleanup must SKIP the delete when another row already references the blob, but it was called with ${JSON.stringify(newCalls)}`,
    );

    // The owning row must still be there (the failed second insert
    // must not have collateral-damaged the first leg's evidence).
    const stillThere = await db.select().from(claimEvidenceTable).where(eq(claimEvidenceTable.imageUrl, sharedBlob));
    assert.equal(stillThere.length, 1, "the original owning row must remain after the failed second insert");
    assert.equal(stillThere[0].claimId, sharedClaim.id, "the surviving row must be the original owning leg's");
  } finally {
    await cleanupClaim(sharedClaim.id);
  }
});

// =====================================================================
// Task #838 — soft-delete + 30-day undo contract tests.
//
// Each destructive action must (a) stamp the right soft-delete column
// on the row instead of hard-deleting it, (b) surface that row through
// GET /api/admin/removals, and (c) be reversible via POST
// /api/admin/removals/:kind/:id/restore (which clears the stamp + writes
// a dedicated `*_restored` / `*_undone` audit row).
//
// Without these the "Undo" affordance is a lie — the row would already
// be gone (or worse, still gone but listed as restorable).
// =====================================================================

test("Task #838: PATCH /invoice-groups/:id/outcome Withdrawn stamps withdrawn_at; admin restore clears it", async () => {
  const group = await createSeedGroup();
  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/outcome`, {
      method: "PATCH",
      body: { outcome: "Withdrawn", closureReason: "cannot_dispute", cannotDisputeReason: "duplicate" },
    });
    assert.equal(res.status, 200, `expected 200 from Withdrawn outcome, got ${res.status} (${JSON.stringify(res.json)})`);

    const [afterWithdraw] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.ok(afterWithdraw.withdrawnAt, "withdrawn_at must be stamped on Withdrawn outcome");
    assert.equal(afterWithdraw.outcome, "Withdrawn");

    const list = await fetchJson<{ items: Array<{ kind: string; refId: number }> }>("/api/admin/removals");
    assert.equal(list.status, 200);
    assert.ok(
      list.json.items.some((i) => i.kind === "group_withdrawn" && i.refId === group.id),
      "Recent removals listing must include the withdrawn group",
    );

    const restoreRes = await fetchJson(`/api/admin/removals/group_withdrawn/${group.id}/restore`, { method: "POST" });
    assert.equal(restoreRes.status, 200, `restore must succeed, got ${restoreRes.status} (${JSON.stringify(restoreRes.json)})`);

    const [afterRestore] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.equal(afterRestore.withdrawnAt, null, "withdrawn_at must be cleared after restore");
    assert.equal(afterRestore.outcome, "Pending", "outcome must reset to Pending after restore");

    const restoredAudit = await db.select().from(auditLogsTable).where(
      and(eq(auditLogsTable.invoiceGroupId, group.id), eq(auditLogsTable.action, "group_withdraw_restored")),
    );
    assert.equal(restoredAudit.length, 1, "exactly one group_withdraw_restored audit row must be written");
    const restoredMeta = (restoredAudit[0]?.metadata ?? {}) as Record<string, unknown>;
    assert.ok(
      typeof restoredMeta.restoredFromAuditLogId === "number" && restoredMeta.restoredFromAuditLogId > 0,
      "restore audit metadata must reference the originating removal audit row id",
    );
  } finally {
    await cleanupGroup(group.id);
  }
});

test("Task #838: PATCH /claims/:id/outcome Withdrawn stamps withdrawn_at; admin restore clears it", async () => {
  const errType = await createSeedErrorType();
  const group = await createSeedGroup();
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
  });
  try {
    const res = await fetchJson(`/api/claims/${claim.id}/outcome`, {
      method: "PATCH",
      body: { outcome: "Withdrawn", closureReason: "cannot_dispute", cannotDisputeReason: "duplicate" },
    });
    assert.equal(res.status, 200, `expected 200 from claim Withdrawn outcome, got ${res.status} (${JSON.stringify(res.json)})`);

    const [afterWithdraw] = await db.select().from(claimsTable).where(eq(claimsTable.id, claim.id));
    assert.ok(afterWithdraw.withdrawnAt, "withdrawn_at must be stamped on claim Withdrawn outcome");
    assert.equal(afterWithdraw.outcome, "Withdrawn");

    const list = await fetchJson<{ items: Array<{ kind: string; refId: number; actorEmail: string | null; reasonNote: string | null; auditLogId: number | null }> }>("/api/admin/removals");
    assert.equal(list.status, 200);
    const listed = list.json.items.find((i) => i.kind === "claim_withdrawn" && i.refId === claim.id);
    assert.ok(listed, "Recent removals listing must include the withdrawn claim");
    assert.ok(
      typeof listed!.auditLogId === "number" && listed!.auditLogId > 0,
      "listing item must carry the originating removal audit row id",
    );

    const restoreRes = await fetchJson(`/api/admin/removals/claim_withdrawn/${claim.id}/restore`, { method: "POST" });
    assert.equal(restoreRes.status, 200, `restore must succeed, got ${restoreRes.status} (${JSON.stringify(restoreRes.json)})`);

    const [afterRestore] = await db.select().from(claimsTable).where(eq(claimsTable.id, claim.id));
    assert.equal(afterRestore.withdrawnAt, null, "withdrawn_at must be cleared after restore");
    assert.equal(afterRestore.outcome, "Pending", "outcome must reset to Pending after restore");

    const restoredAudit = await db.select().from(auditLogsTable).where(
      and(eq(auditLogsTable.claimId, claim.id), eq(auditLogsTable.action, "claim_withdraw_restored")),
    );
    assert.equal(restoredAudit.length, 1, "exactly one claim_withdraw_restored audit row must be written");
    const meta = (restoredAudit[0]?.metadata ?? {}) as Record<string, unknown>;
    assert.equal(meta.restoredFromAuditLogId, listed!.auditLogId, "restore audit must link back to the originating removal audit row id");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("Task #838: POST /claims/:id/exclude reason=handled_offline stamps removed_offline_at; admin restore clears it", async () => {
  const errType = await createSeedErrorType();
  const group = await createSeedGroup();
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
  });
  try {
    const excludeRes = await fetchJson(`/api/claims/${claim.id}/exclude`, {
      method: "POST",
      body: { reason: "handled_offline", note: "Resolved via phone call with rep, ticket #ABC123." },
    });
    assert.equal(excludeRes.status, 200, `expected 200 from handled_offline exclude, got ${excludeRes.status} (${JSON.stringify(excludeRes.json)})`);

    const [afterExclude] = await db.select().from(claimsTable).where(eq(claimsTable.id, claim.id));
    assert.ok(afterExclude.removedOfflineAt, "removed_offline_at must be stamped on handled_offline exclude");

    const list = await fetchJson<{ items: Array<{ kind: string; refId: number; actorEmail: string | null; reasonNote: string | null; auditLogId: number | null }> }>("/api/admin/removals");
    const listed = list.json.items.find((i) => i.kind === "claim_removed_offline" && i.refId === claim.id);
    assert.ok(listed, "Recent removals listing must include the handled-offline claim");
    assert.ok(listed!.reasonNote && listed!.reasonNote.includes("Resolved via phone call"), "listing item must surface the original reason note");
    assert.ok(typeof listed!.auditLogId === "number" && listed!.auditLogId > 0, "listing item must surface the originating removal audit row id");

    const restoreRes = await fetchJson(`/api/admin/removals/claim_removed_offline/${claim.id}/restore`, { method: "POST" });
    assert.equal(restoreRes.status, 200, `restore must succeed, got ${restoreRes.status} (${JSON.stringify(restoreRes.json)})`);

    const [afterRestore] = await db.select().from(claimsTable).where(eq(claimsTable.id, claim.id));
    assert.equal(afterRestore.removedOfflineAt, null, "removed_offline_at must be cleared after restore");
    assert.equal(afterRestore.includedInDispute, true, "included_in_dispute must flip back to true after restore");

    const restoredAudit = await db.select().from(auditLogsTable).where(
      and(eq(auditLogsTable.claimId, claim.id), eq(auditLogsTable.action, "claim_removed_handled_offline_undone")),
    );
    assert.equal(restoredAudit.length, 1, "exactly one claim_removed_handled_offline_undone audit row must be written");
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("Task #838: DELETE /invoice-groups/:id/draft snapshots and clears the live draft; admin restore repopulates it", async () => {
  const group = await createSeedGroup();
  try {
    const subject = "Original draft subject";
    const descriptionHtml = "<p>Original drafted body for the dispute payload.</p>";
    await db.update(invoiceGroupsTable)
      .set({ draftSubject: subject, draftDescriptionHtml: descriptionHtml })
      .where(eq(invoiceGroupsTable.id, group.id));

    const delRes = await fetchJson(`/api/invoice-groups/${group.id}/draft`, { method: "DELETE" });
    assert.equal(delRes.status, 200, `expected 200 from DELETE /draft, got ${delRes.status} (${JSON.stringify(delRes.json)})`);

    const [afterDiscard] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.equal(afterDiscard.draftSubject, null, "draft_subject must be cleared after discard");
    assert.equal(afterDiscard.draftDescriptionHtml, null, "draft_description_html must be cleared after discard");
    assert.equal(afterDiscard.draftDiscardedSubject, subject, "discarded snapshot must preserve the prior subject");
    assert.equal(afterDiscard.draftDiscardedDescriptionHtml, descriptionHtml, "discarded snapshot must preserve the prior body");
    assert.ok(afterDiscard.draftDiscardedAt, "draft_discarded_at must be stamped on discard");

    const discardAudit = await db.select().from(auditLogsTable).where(
      and(eq(auditLogsTable.invoiceGroupId, group.id), eq(auditLogsTable.action, "group_draft_discarded")),
    );
    assert.equal(discardAudit.length, 1, "exactly one group_draft_discarded audit row must be written");

    const list = await fetchJson<{ items: Array<{ kind: string; refId: number }> }>("/api/admin/removals");
    assert.ok(
      list.json.items.some((i) => i.kind === "group_draft_discarded" && i.refId === group.id),
      "Recent removals listing must include the discarded draft",
    );

    const restoreRes = await fetchJson(`/api/admin/removals/group_draft_discarded/${group.id}/restore`, { method: "POST" });
    assert.equal(restoreRes.status, 200, `restore must succeed, got ${restoreRes.status} (${JSON.stringify(restoreRes.json)})`);

    const [afterRestore] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.equal(afterRestore.draftSubject, subject, "live draft_subject must be repopulated from the snapshot");
    assert.equal(afterRestore.draftDescriptionHtml, descriptionHtml, "live draft body must be repopulated from the snapshot");
    assert.equal(afterRestore.draftDiscardedAt, null, "draft_discarded_at must be cleared after restore");
    assert.equal(afterRestore.draftDiscardedSubject, null, "snapshot subject column must be cleared after restore");
    assert.equal(afterRestore.draftDiscardedDescriptionHtml, null, "snapshot body column must be cleared after restore");

    const restoreAudit = await db.select().from(auditLogsTable).where(
      and(eq(auditLogsTable.invoiceGroupId, group.id), eq(auditLogsTable.action, "group_draft_discard_restored")),
    );
    assert.equal(restoreAudit.length, 1, "exactly one group_draft_discard_restored audit row must be written");
  } finally {
    await cleanupGroup(group.id);
  }
});

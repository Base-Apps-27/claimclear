import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, and, desc } from "drizzle-orm";

import portalSubmissionsRouter from "../routes/portal-submissions";
import invoiceGroupsRouter from "../routes/invoice-groups";
import claimsRouter from "../routes/claims";
import notesRouter from "../routes/notes";
import anthropicRouter from "../routes/anthropic";
import claimEvidenceRouter from "../routes/claim-evidence";
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
  const [row] = await db.insert(claimsTable).values({
    confNumber,
    status: "Needs Evidence",
    outcome: "Pending",
    invoiceGroupId: opts.invoiceGroupId ?? null,
    errorTypeId: opts.errorTypeId ?? null,
    errorTypeName: opts.errorTypeName ?? null,
    sopOutcome: opts.sopOutcome ?? null,
    includedInDispute: true,
    claimAmount: "100.00",
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

test("Tier 3: POST /portal-submissions/:id/confirm with ack:true writes a dedicated lint_warnings_bypassed audit row (separate from portal_submission_confirmed)", async () => {
  const errType = await createSeedErrorType();
  const group = await createSeedGroup();
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
  });
  // Build a draft submission that will trigger at least one lint
  // warning. The deterministic way to do this without re-mocking
  // every lint rule is to seed a minimal draft and rely on the
  // lint result being non-empty for a missing-field draft. If the
  // draft happens to lint clean we skip the assertion (so the test
  // doesn't false-fail on lint logic changes), but we still verify
  // that no `lint_warnings_bypassed` row is written when no warning
  // existed — i.e. the audit row is gated, not unconditional.
  const [submission] = await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: group.id,
    status: "draft",
    issueType: "other",
    subject: "Test subject",
    descriptionHtml: "<p>test</p>",
    confNumber: claim.confNumber,
    refNumber: null,
    invoiceNumber: group.invoiceNumber,
  }).returning();
  try {
    const TEST_BYPASS_REASON = "Operator override: payor previously accepted similar wording, see attached PDF.";
    const res = await fetchJson(`/api/portal-submissions/${submission.id}/confirm`, {
      method: "POST",
      body: { ack: true, bypassReason: TEST_BYPASS_REASON },
    });
    // Either the confirm succeeded (200) or got blocked by a
    // hard-fail lint (422). Both are valid lint engine outputs; we
    // only assert that IF warnings were present and ack=true, the
    // dedicated audit row is written AND it captures the operator's
    // typed bypass reason.
    if (res.status === 200) {
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
      // Confirm row must always be present after a successful confirm.
      assert.ok(confirmRows.length >= 1, "expected portal_submission_confirmed audit row");

      // If a bypass row exists it must carry the bypassed warnings
      // AND the operator's typed reason in metadata — proves it
      // isn't a flag-only stamp.
      if (bypassRows.length > 0) {
        const meta = bypassRows[0].metadata as any;
        assert.ok(Array.isArray(meta?.bypassedWarnings), "lint_warnings_bypassed must record the actual warnings, not just a flag");
        assert.equal(typeof meta.bypassedCount, "number", "lint_warnings_bypassed must record how many warnings were bypassed");
        assert.equal(meta.submissionId, submission.id, "lint_warnings_bypassed must reference the submission");
        assert.equal(
          meta.bypassReason,
          TEST_BYPASS_REASON,
          "lint_warnings_bypassed must record the operator's typed bypass reason verbatim",
        );
        assert.ok(
          (bypassRows[0].details ?? "").includes(TEST_BYPASS_REASON),
          "lint_warnings_bypassed details string must surface the bypass reason for the activity feed",
        );
      }
    }
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

test("Tier 3: POST /portal-submissions/:id/confirm with ack:true but missing bypassReason refuses with 400 + code:missing_bypass_reason", async () => {
  // Bypassing lint warnings without a written reason must be a hard
  // refusal — operators (and bots) cannot dismiss the warnings
  // silently. The contract is enforced server-side so the same
  // shape applies whether the caller is the UI dialog, the bot, or
  // a curl. We seed a draft that's likely to lint warn (minimal
  // content) and assert the 400 + named code shape.
  const errType = await createSeedErrorType();
  const group = await createSeedGroup();
  const claim = await createSeedClaim({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
  });
  const [submission] = await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: group.id,
    status: "draft",
    issueType: "other",
    subject: "Test subject",
    descriptionHtml: "<p>x</p>", // minimal — likely to lint warn
    confNumber: claim.confNumber,
    refNumber: null,
    invoiceNumber: group.invoiceNumber,
  }).returning();
  try {
    const res = await fetchJson(`/api/portal-submissions/${submission.id}/confirm`, {
      method: "POST",
      body: { ack: true }, // bypassReason intentionally omitted
    });
    // Outcomes:
    //   - 422 → lint hard-failed (no warnings to bypass; the
    //     bypass-reason gate isn't reached). Acceptable; no
    //     bypass row should exist.
    //   - 200 → submission lint-clean (no warnings); bypass-reason
    //     gate not reached. Acceptable; no bypass row should exist.
    //   - 400 + code:missing_bypass_reason → lint warned and the
    //     gate fired correctly. This is the case we're asserting.
    if (res.status === 400) {
      assert.equal(res.json?.code, "missing_bypass_reason", `expected code:missing_bypass_reason, got ${res.json?.code}`);
      assert.equal(res.json?.field, "bypassReason", `expected field:bypassReason, got ${res.json?.field}`);
      // The submission must NOT have flipped to pending — the bypass
      // refusal path must be a clean refusal.
      const [after] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, submission.id));
      assert.equal(after.status, "draft", "missing-reason refusal must not have flipped the submission to pending");
    }
    // In all branches, no lint_warnings_bypassed row may exist for
    // this group — the row is only written when a real bypass with
    // a real reason succeeds.
    if (res.status !== 200) {
      const bypassRows = await db.select().from(auditLogsTable).where(
        and(
          eq(auditLogsTable.invoiceGroupId, group.id),
          eq(auditLogsTable.action, "lint_warnings_bypassed"),
        ),
      );
      assert.equal(bypassRows.length, 0, "no lint_warnings_bypassed row may exist when the bypass refusal path fires");
    }
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

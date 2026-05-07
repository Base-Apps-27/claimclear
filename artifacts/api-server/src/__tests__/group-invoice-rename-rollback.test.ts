import { phaseForStatus, dispositionForGroup } from "./fixtures/state";
// Task #456 — atomic invoice-number rename inside the Re-attest commit
// (both POST /invoice-groups/:id/reattest/complete and
// POST /invoice-groups/:id/reattest/queue).
//
// Task #455 wraps the optional `renameInvoiceNumberTo` rename in the
// same db.transaction as the re-attest stamp + draft promotion + leg
// attestation flips. When the new number collides with another group,
// `applyGroupInvoiceRename` throws `InvoiceNumberConflictError`, the
// route catches it, returns 409 `code:"invoice_number_conflict"`, and
// drizzle rolls the surrounding transaction back so NONE of the
// re-attest writes leak through.
//
// Coverage:
//   - /reattest/complete conflict: 409, no `group_invoice_number_renamed`
//     audit row, no `mas_reattest_completed` audit row, no
//     reattestCompletedAt stamp, no leg attestationState graduation.
//   - /reattest/queue conflict: 409, no audit rows, no
//     awaitingPayorAgainAt stamp, no leg flipped to `queued`.
//   - Happy-path /reattest/complete: a successful rename writes the
//     `group_invoice_number_renamed` audit row with
//     `{from, to, sourceResponseId}`.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";

import invoiceGroupsRouter from "../routes/invoice-groups";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
  notesTable,
  portalResponsesTable,
  portalSubmissionsTable,
  claimEvidenceTable,
  claimVerdictTable,
  errorTypesTable,
  stateEventsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;

const TEST_USER = { email: "rename-rollback-tester@example.com", displayName: "Rename Rollback Tester" };

before(async () => {
  const app: Express = express();
  app.use(express.json());

  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved", role: "admin" };
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

async function fetchJson<T = any>(
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
          } catch (e) { rejectReq(e); }
        });
      },
    );
    req.on("error", rejectReq);
    if (body) req.write(body);
    req.end();
  });
}

// --- Seeding -----------------------------------------------------------

function uniqueInvoiceNumber(tag: string): string {
  return `T456-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

async function createSeedGroup(opts: {
  invoiceNumber?: string;
  status?: any;
  reattestRequired?: boolean;
  phase?: any;
} = {}): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const status = opts.status ?? "Needs Review";
  const reattestRequired = opts.reattestRequired ?? false;
  // Wave C: macro-phase is derived from `phase` directly, so a group
  // marked `reattestRequired:true` must also live in the
  // `awaiting_reattestation` phase or the route gate (which now
  // reads `group.phase`) will short-circuit on the wrong macro.
  const phase = opts.phase ?? (reattestRequired ? "awaiting_reattestation" : phaseForStatus(status));
  const [row] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: opts.invoiceNumber ?? uniqueInvoiceNumber("G"),
    status,
    outcome: "Pending",
    reattestRequired,
    phase,
  }).returning();
  return row;
}

async function createSeedErrorType(): Promise<typeof errorTypesTable.$inferSelect> {
  const name = `T456-ErrType-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [row] = await db.insert(errorTypesTable).values({
    name,
    description: "test",
    decisionTree: null,
  }).returning();
  return row;
}

async function createApprovedLeg(opts: {
  invoiceGroupId: number;
  errorTypeId: string;
  errorTypeName: string;
}): Promise<typeof claimsTable.$inferSelect> {
  const confNumber = `T456L-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const disposition = await dispositionForGroup(opts.invoiceGroupId);
  const [leg] = await db.insert(claimsTable).values({
    confNumber,
    status: "Awaiting Response",
    outcome: "Approved",
    invoiceGroupId: opts.invoiceGroupId,
    errorTypeId: opts.errorTypeId,
    errorTypeName: opts.errorTypeName,
    includedInDispute: true,
    claimAmount: "100.00",
    attestationState: "not_required",
    disposition,
  }).returning();
  await db.insert(claimVerdictTable).values({
    claimId: leg.id,
    source: "operator_confirmed",
    outcome: "Approved",
    createdBy: TEST_USER.email,
  });
  return leg;
}

async function seedPayorResponse(groupId: number) {
  await db.insert(portalResponsesTable).values({
    source: "email",
    invoiceGroupId: groupId,
    claimId: null,
    content: "Seed payor response so groupHasResponse() returns true.",
    responseType: "other",
  });
}

async function cleanupClaim(id: number) {
  await db.delete(claimVerdictTable).where(eq(claimVerdictTable.claimId, id)).catch(() => undefined);
  await db.delete(stateEventsTable).where(eq(stateEventsTable.claimId, id)).catch(() => undefined);
  await db.delete(portalResponsesTable).where(eq(portalResponsesTable.claimId, id)).catch(() => undefined);
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
  await db.delete(portalResponsesTable).where(eq(portalResponsesTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(claimEvidenceTable).where(eq(claimEvidenceTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)).catch(() => undefined);
}

async function cleanupErrorType(id: number) {
  await db.delete(errorTypesTable).where(eq(errorTypesTable.id, id)).catch(() => undefined);
}

// --- Tests --------------------------------------------------------------

test("POST /reattest/complete with renameInvoiceNumberTo colliding with another group rolls the entire write set back (409, no audit, no stamp, no leg flip)", async () => {
  const errType = await createSeedErrorType();
  // Group A is the one we re-attest. It's in mas-action-required phase.
  const groupA = await createSeedGroup({ status: "Needs Review", reattestRequired: true });
  // Group B owns the invoice number we'll try to rename A to — collision.
  const collidingNumber = uniqueInvoiceNumber("CONFLICT");
  const groupB = await createSeedGroup({ invoiceNumber: collidingNumber, status: "Needs Review" });

  // Eligible leg: operator_confirmed Approved verdict at not_required
  // would graduate to `pending` on a successful re-attest. The rollback
  // must keep it at `not_required`.
  const leg = await createApprovedLeg({
    invoiceGroupId: groupA.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
  });

  try {
    const res = await fetchJson(`/api/invoice-groups/${groupA.id}/reattest/complete`, {
      method: "POST",
      body: {
        note: "ok",
        renameInvoiceNumberTo: collidingNumber,
        renameSourceResponseId: 7,
      },
    });

    assert.equal(res.status, 409, `expected 409, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal((res.json as any).code, "invoice_number_conflict");
    assert.equal((res.json as any).conflictingGroupId, groupB.id);

    // Group A: no re-attest stamp, invoice number unchanged.
    const [postA] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupA.id));
    assert.equal(postA.reattestCompletedAt, null,
      "rollback must NOT stamp reattestCompletedAt");
    assert.equal(postA.reattestCompletedBy, null,
      "rollback must NOT stamp reattestCompletedBy");
    assert.equal(postA.reattestNote, null,
      "rollback must NOT stamp reattestNote");
    assert.notEqual(postA.invoiceNumber, collidingNumber,
      "rollback must NOT have renamed group A to the colliding number");
    assert.equal(postA.invoiceNumber, groupA.invoiceNumber,
      "rollback must leave the original invoice number intact");

    // Audit rows for group A must be empty of rename + completion entries.
    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, groupA.id));
    assert.ok(
      !audits.find((a) => a.action === "group_invoice_number_renamed"),
      "rollback must NOT have written a group_invoice_number_renamed audit row",
    );
    assert.ok(
      !audits.find((a) => a.action === "mas_reattest_completed"),
      "rollback must NOT have written a mas_reattest_completed audit row",
    );
    assert.ok(
      !audits.find((a) => a.action === "mas_reattest_recorded_offline"),
      "rollback must NOT have written a mas_reattest_recorded_offline audit row",
    );

    // Leg: attestation_state must NOT have graduated to `pending`.
    const [postLeg] = await db.select().from(claimsTable).where(eq(claimsTable.id, leg.id));
    assert.equal(postLeg.attestationState, "not_required",
      "rollback must NOT graduate the eligible leg's attestationState");
  } finally {
    await cleanupGroup(groupA.id);
    await cleanupGroup(groupB.id);
    await cleanupErrorType(errType.id);
  }
});

test("POST /reattest/queue with renameInvoiceNumberTo colliding with another group rolls the entire write set back (409, no audit, no stamp, no leg queueing)", async () => {
  const errType = await createSeedErrorType();
  // Group A is the one being bulk-queued — Needs Review + payor response on file.
  const groupA = await createSeedGroup({ status: "Needs Review" });
  await seedPayorResponse(groupA.id);
  const collidingNumber = uniqueInvoiceNumber("CONFLICT");
  const groupB = await createSeedGroup({ invoiceNumber: collidingNumber, status: "Needs Review" });

  // Eligible leg for the bulk-queue: Approved + operator_confirmed verdict
  // at not_required. A successful queue would flip it to `queued`.
  const leg = await createApprovedLeg({
    invoiceGroupId: groupA.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
  });

  try {
    const res = await fetchJson(`/api/invoice-groups/${groupA.id}/reattest/queue`, {
      method: "POST",
      body: {
        note: "park for portal user",
        renameInvoiceNumberTo: collidingNumber,
        renameSourceResponseId: 11,
      },
    });

    assert.equal(res.status, 409, `expected 409, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal((res.json as any).code, "invoice_number_conflict");
    assert.equal((res.json as any).conflictingGroupId, groupB.id);

    // Group A: no awaiting_payor_again_at stamp, invoice number unchanged.
    const [postA] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupA.id));
    assert.equal(postA.awaitingPayorAgainAt, null,
      "rollback must NOT stamp awaitingPayorAgainAt");
    assert.equal(postA.invoiceNumber, groupA.invoiceNumber,
      "rollback must leave the original invoice number intact");
    assert.notEqual(postA.invoiceNumber, collidingNumber,
      "rollback must NOT have renamed group A to the colliding number");

    // Audit rows must be empty of rename + bulk-queue entries.
    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, groupA.id));
    assert.ok(
      !audits.find((a) => a.action === "group_invoice_number_renamed"),
      "rollback must NOT have written a group_invoice_number_renamed audit row",
    );
    assert.ok(
      !audits.find((a) => a.action === "group_reattest_queued_bulk"),
      "rollback must NOT have written the umbrella group_reattest_queued_bulk audit row",
    );

    // Per-leg: no `attestation_queued` audit row, attestationState unchanged.
    const legAudits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.claimId, leg.id));
    assert.ok(
      !legAudits.find((a) => a.action === "attestation_queued"),
      "rollback must NOT have written a per-leg attestation_queued audit row",
    );
    const [postLeg] = await db.select().from(claimsTable).where(eq(claimsTable.id, leg.id));
    assert.equal(postLeg.attestationState, "not_required",
      "rollback must NOT flip the eligible leg's attestationState to queued");
    assert.equal(postLeg.attestationQueuedAt, null,
      "rollback must NOT stamp attestationQueuedAt on the leg");
    assert.equal(postLeg.attestationQueuedBy, null,
      "rollback must NOT stamp attestationQueuedBy on the leg");
  } finally {
    await cleanupGroup(groupA.id);
    await cleanupGroup(groupB.id);
    await cleanupErrorType(errType.id);
  }
});

test("POST /reattest/complete happy path writes a group_invoice_number_renamed audit row with {from, to, sourceResponseId}", async () => {
  const errType = await createSeedErrorType();
  const originalNumber = uniqueInvoiceNumber("FROM");
  const targetNumber = uniqueInvoiceNumber("TO");
  const group = await createSeedGroup({
    invoiceNumber: originalNumber,
    status: "Needs Review",
    reattestRequired: true,
  });
  // Seed a leg so the gate has something to graduate, but the rename
  // audit row is the focus of this test.
  await createApprovedLeg({
    invoiceGroupId: group.id,
    errorTypeId: String(errType.id),
    errorTypeName: errType.name,
  });

  const sourceResponseId = 4242;

  try {
    const res = await fetchJson(`/api/invoice-groups/${group.id}/reattest/complete`, {
      method: "POST",
      body: {
        note: "ok",
        renameInvoiceNumberTo: targetNumber,
        renameSourceResponseId: sourceResponseId,
      },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);

    // The group row reflects both the rename and the re-attest stamp.
    const [post] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));
    assert.equal(post.invoiceNumber, targetNumber, "invoice number must be renamed on commit");
    assert.ok(post.reattestCompletedAt, "reattestCompletedAt must be stamped on commit");

    const audits = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, group.id));
    const renameAudit = audits.find((a) => a.action === "group_invoice_number_renamed");
    assert.ok(renameAudit, "expected one group_invoice_number_renamed audit row");
    const meta = renameAudit!.metadata as { from: string; to: string; sourceResponseId: number | null };
    assert.equal(meta.from, originalNumber, "audit metadata.from must be the original invoice #");
    assert.equal(meta.to, targetNumber, "audit metadata.to must be the new invoice #");
    assert.equal(meta.sourceResponseId, sourceResponseId,
      "audit metadata.sourceResponseId must echo the renameSourceResponseId from the request body");
    assert.equal(renameAudit!.userEmail, TEST_USER.email);
  } finally {
    await cleanupGroup(group.id);
    await cleanupErrorType(errType.id);
  }
});

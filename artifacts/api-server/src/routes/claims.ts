import { Router, type IRouter, type Request } from "express";
import { eq, or, ilike, desc, and, count, inArray, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, auditLogsTable, notesTable, errorTypesTable, portalSubmissionsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { broadcastClaimEvent } from "../lib/sse";
import {
  transitionClaimStatus,
  transitionClaimOutcome,
  transitionClaimStatusAndOutcome,
  VALID_MANUAL_STATUS_TRANSITIONS,
  VALID_OUTCOME_BY_STATUS,
  SYSTEM_CONTROLLED_STATUSES,
} from "../lib/claim-transitions";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

async function createAuditLog(claimId: number, action: string, details: string, req: Request, metadata?: Record<string, unknown>) {
  const userEmail = req.user?.email ?? null;
  const userName = req.user?.displayName ?? null;
  await db.insert(auditLogsTable).values({
    claimId,
    action,
    details,
    metadata: metadata ?? null,
    userEmail,
    userName,
  });
}

function emitClaimEvent(claimId: number, type: string, req: Request) {
  broadcastClaimEvent({
    type,
    claimId,
    userName: req.user?.displayName ?? null,
    userEmail: req.user?.email ?? null,
    timestamp: new Date().toISOString(),
  });
}

function actorFromReq(req: Request) {
  return {
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? null,
  };
}

router.get("/claims", asyncHandler(async (req, res): Promise<void> => {
  const { status, outcome, search, limit: limitStr, offset: offsetStr } = req.query;
  const limitVal = parseInt(String(limitStr || "50"), 10);
  const offsetVal = parseInt(String(offsetStr || "0"), 10);

  const conditions: SQL[] = [];
  if (status && typeof status === "string") {
    if (status.includes(",")) {
      const statuses = status.split(",") as (typeof claimsTable.status.enumValues)[number][];
      const statusOr = or(...statuses.map(s => eq(claimsTable.status, s)));
      if (statusOr) conditions.push(statusOr);
    } else {
      conditions.push(eq(claimsTable.status, status as (typeof claimsTable.status.enumValues)[number]));
    }
  }
  if (outcome && typeof outcome === "string") {
    conditions.push(eq(claimsTable.outcome, outcome as (typeof claimsTable.outcome.enumValues)[number]));
  }
  if (search && typeof search === "string") {
    const searchPattern = `%${search}%`;
    const searchOr = or(
      ilike(claimsTable.confNumber, searchPattern),
      ilike(claimsTable.refNumber, searchPattern),
      ilike(claimsTable.clientNumber, searchPattern),
      ilike(claimsTable.errorDetails, searchPattern),
    );
    if (searchOr) conditions.push(searchOr);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult] = await db.select({ count: count() }).from(claimsTable).where(where);
  const claims = await db.select().from(claimsTable).where(where)
    .orderBy(desc(claimsTable.createdAt))
    .limit(limitVal)
    .offset(offsetVal);

  res.json({ claims, total: totalResult.count });
}));

router.post("/claims", asyncHandler(async (req, res): Promise<void> => {
  const body = req.body;
  if (!body.confNumber) {
    res.status(400).json({ error: "confNumber is required" });
    return;
  }

  const [claim] = await db.insert(claimsTable).values({
    confNumber: body.confNumber,
    date: body.date || null,
    refNumber: body.refNumber || null,
    clientNumber: body.clientNumber || null,
    carNumber: body.carNumber || null,
    errorDetails: body.errorDetails || null,
    errorTypeId: body.errorTypeId || null,
    errorTypeName: body.errorTypeName || null,
    claimAmount: body.claimAmount || null,
    payorEmail: body.payorEmail || null,
  }).returning();

  await createAuditLog(claim.id, "claim_created", `Claim ${claim.confNumber} created`, req);
  emitClaimEvent(claim.id, "claim_created", req);
  res.status(201).json(claim);
}));

router.get("/claims/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  res.json(claim);
}));

router.patch("/claims/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const updateData: Partial<typeof claimsTable.$inferInsert> = {};
  const allowedFields = ["confNumber", "date", "refNumber", "clientNumber", "carNumber", "errorDetails",
    "errorTypeId", "errorTypeName", "claimAmount", "payorEmail", "invoiceNumbers", "evidenceNotes",
    "evidenceFiles", "evidenceChecklist"] as const;
  for (const f of allowedFields) {
    if (req.body[f] !== undefined) {
      (updateData as Record<string, unknown>)[f] = req.body[f];
    }
  }

  const [claim] = await db.update(claimsTable).set(updateData).where(eq(claimsTable.id, id)).returning();
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  await createAuditLog(id, "claim_edited", `Claim ${claim.confNumber} updated`, req, { fields: Object.keys(updateData) });
  emitClaimEvent(id, "claim_edited", req);
  res.json(claim);
}));

router.delete("/claims/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Claim not found" }); return; }

  await createAuditLog(id, "claim_deleted", `Claim ${existing.confNumber} deleted`, req);
  emitClaimEvent(id, "claim_deleted", req);
  await db.delete(claimsTable).where(eq(claimsTable.id, id));
  res.sendStatus(204);
}));

router.get("/claims/valid-transitions/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  const activeSubmissions = await db.select().from(portalSubmissionsTable)
    .where(and(
      eq(portalSubmissionsTable.claimId, id),
      inArray(portalSubmissionsTable.status, ["pending", "in_progress"])
    ));

  const validStatuses = activeSubmissions.length > 0 ? [] : (VALID_MANUAL_STATUS_TRANSITIONS[claim.status] || []);

  const validOutcomes: string[] = [];
  if (activeSubmissions.length === 0) {
    const allowed = VALID_OUTCOME_BY_STATUS[claim.status] || [];
    for (const o of allowed) {
      if (!validOutcomes.includes(o)) validOutcomes.push(o);
    }
  }

  res.json({
    currentStatus: claim.status,
    currentOutcome: claim.outcome,
    validStatuses,
    validOutcomes,
    hasActiveSubmission: activeSubmissions.length > 0,
    canQueueForPortal: !activeSubmissions.length && ["Needs Evidence", "Needs Review", "New"].includes(claim.status),
  });
}));

router.patch("/claims/:id/status", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { status, _systemOverride } = req.body;
  if (!status) { res.status(400).json({ error: "status is required" }); return; }

  try {
    const result = await transitionClaimStatus({
      claimId: id,
      newStatus: status,
      source: "manual",
      reason: `Manual status change by user`,
      actor: actorFromReq(req),
      systemOverride: _systemOverride,
    });
    res.json(result.claim);
  } catch (err: any) {
    const msg = err.message || "Failed to change status";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    if (msg.includes("in progress")) { res.status(409).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

router.patch("/claims/:id/outcome", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { outcome, approvedAmount, invoiceNumbers, _systemOverride } = req.body;
  if (!outcome) { res.status(400).json({ error: "outcome is required" }); return; }

  try {
    const result = await transitionClaimOutcome({
      claimId: id,
      newOutcome: outcome,
      source: "manual",
      reason: `Manual outcome change by user`,
      actor: actorFromReq(req),
      systemOverride: _systemOverride,
      approvedAmount,
      invoiceNumbers,
    });
    res.json(result.claim);
  } catch (err: any) {
    const msg = err.message || "Failed to change outcome";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    if (msg.includes("in progress")) { res.status(409).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

router.patch("/claims/:id/evidence", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const updateData: Partial<typeof claimsTable.$inferInsert> = {};
  if (req.body.evidenceFiles !== undefined) updateData.evidenceFiles = req.body.evidenceFiles;
  if (req.body.evidenceNotes !== undefined) updateData.evidenceNotes = req.body.evidenceNotes;
  if (req.body.evidenceChecklist !== undefined) updateData.evidenceChecklist = req.body.evidenceChecklist;

  const [claim] = await db.update(claimsTable).set(updateData).where(eq(claimsTable.id, id)).returning();
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  await createAuditLog(id, "evidence_submitted", "Evidence updated", req);
  emitClaimEvent(id, "evidence_updated", req);
  res.json(claim);
}));

router.post("/claims/:id/hold", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { holdReason, holdPendingFrom } = req.body;
  if (!holdReason) { res.status(400).json({ error: "holdReason is required" }); return; }

  try {
    const result = await transitionClaimStatus({
      claimId: id,
      newStatus: "On Hold",
      source: "manual",
      reason: `Hold placed: ${holdReason}`,
      actor: actorFromReq(req),
      systemOverride: true,
      extraFields: {
        holdReason,
        holdPendingFrom: holdPendingFrom || null,
        holdPlacedAt: new Date().toISOString(),
      },
    });
    res.json(result.claim);
  } catch (err: any) {
    const msg = err.message || "Failed to place hold";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

router.delete("/claims/:id/hold", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const result = await transitionClaimStatus({
      claimId: id,
      newStatus: "Needs Evidence",
      source: "manual",
      reason: "Hold removed from claim",
      actor: actorFromReq(req),
      systemOverride: true,
      extraFields: {
        holdReason: null,
        holdPendingFrom: null,
        holdPlacedAt: null,
      },
    });
    res.json(result.claim);
  } catch (err: any) {
    const msg = err.message || "Failed to remove hold";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

router.patch("/claims/:id/workflow", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { workflowProgress } = req.body;
  const [claim] = await db.update(claimsTable).set({ workflowProgress }).where(eq(claimsTable.id, id)).returning();
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  await createAuditLog(id, "workflow_step", "Workflow progress updated", req);
  emitClaimEvent(id, "workflow_updated", req);
  res.json(claim);
}));

router.post("/claims/:id/triage", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { action, errorTypeId, errorTypeName, triageNotes } = req.body;
  if (!action || !["non_issue", "issue_found"].includes(action)) {
    res.status(400).json({ error: "action must be 'non_issue' or 'issue_found'" });
    return;
  }

  try {
    if (action === "non_issue") {
      const result = await transitionClaimStatusAndOutcome({
        claimId: id,
        newStatus: "Resolved",
        newOutcome: "Non-Issue",
        source: "triage",
        reason: `Triaged as non-issue${triageNotes ? `: ${triageNotes}` : ""}`,
        actor: actorFromReq(req),
        extraFields: {
          claimAmount: "0",
          approvedAmount: "0",
          triageNotes: triageNotes || null,
          triagedAt: new Date().toISOString(),
        },
      });
      res.json(result.claim);
    } else {
      if (!errorTypeId || !errorTypeName) {
        res.status(400).json({ error: "errorTypeId and errorTypeName are required for issue_found" });
        return;
      }

      const result = await transitionClaimStatus({
        claimId: id,
        newStatus: "New",
        source: "triage",
        reason: `Issue identified during triage: ${errorTypeName}${triageNotes ? `. ${triageNotes}` : ""}`,
        actor: actorFromReq(req),
        systemOverride: true,
        extraFields: {
          errorTypeId: String(errorTypeId),
          errorTypeName,
          triageNotes: triageNotes || null,
          triagedAt: new Date().toISOString(),
        },
      });
      res.json(result.claim);
    }
  } catch (err: any) {
    const msg = err.message || "Failed to triage";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

router.post("/claims/bulk-assign-error-type", asyncHandler(async (req, res): Promise<void> => {
  const { claimIds, errorTypeId } = req.body;
  if (!Array.isArray(claimIds) || claimIds.length === 0) {
    res.status(400).json({ error: "claimIds array is required" });
    return;
  }
  if (!errorTypeId) {
    res.status(400).json({ error: "errorTypeId is required" });
    return;
  }

  const [errorType] = await db.select({ id: errorTypesTable.id, name: errorTypesTable.name })
    .from(errorTypesTable)
    .where(eq(errorTypesTable.id, Number(errorTypeId)));

  if (!errorType) {
    res.status(404).json({ error: "Error type not found" });
    return;
  }

  const ids = claimIds.map((id: string | number) => Number(id)).filter((id: number) => !isNaN(id));
  if (ids.length === 0) {
    res.status(400).json({ error: "No valid claim IDs provided" });
    return;
  }

  const claims = await db.select({ id: claimsTable.id, confNumber: claimsTable.confNumber })
    .from(claimsTable)
    .where(inArray(claimsTable.id, ids));

  if (claims.length === 0) {
    res.status(404).json({ error: "No matching claims found" });
    return;
  }

  const errorTypeName = errorType.name;
  const userEmail = req.user?.email ?? null;
  const userName = req.user?.displayName ?? null;

  await db.transaction(async (tx) => {
    await tx.update(claimsTable)
      .set({ errorTypeId: String(errorTypeId), errorTypeName })
      .where(inArray(claimsTable.id, ids));

    for (const claim of claims) {
      await tx.insert(auditLogsTable).values({
        claimId: claim.id,
        action: "error_type_assigned",
        details: `Error type assigned: ${errorTypeName}`,
        metadata: { errorTypeId, errorTypeName },
        userEmail,
        userName,
      });
    }
  });

  for (const claim of claims) {
    emitClaimEvent(claim.id, "claim_edited", req);
  }

  res.json({ updated: claims.length });
}));


export default router;

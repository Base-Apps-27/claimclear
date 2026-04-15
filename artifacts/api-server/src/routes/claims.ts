import { Router, type IRouter, type Request } from "express";
import { eq, or, ilike, desc, and, count, inArray, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, auditLogsTable, notesTable, errorTypesTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { broadcastClaimEvent } from "../lib/sse";

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

router.patch("/claims/:id/status", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { status } = req.body;
  if (!status) { res.status(400).json({ error: "status is required" }); return; }

  const [old] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!old) { res.status(404).json({ error: "Claim not found" }); return; }

  const [claim] = await db.update(claimsTable).set({ status }).where(eq(claimsTable.id, id)).returning();
  await createAuditLog(id, "status_changed", `Status changed from ${old.status} to ${status}`, req, { from: old.status, to: status });
  await db.insert(notesTable).values({
    claimId: id,
    type: "status_change",
    content: `Status changed from ${old.status} to ${status}`,
    author: req.user?.displayName || req.user?.email || "System",
  });
  emitClaimEvent(id, "status_changed", req);
  res.json(claim);
}));

router.patch("/claims/:id/outcome", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { outcome, approvedAmount, invoiceNumbers } = req.body;
  if (!outcome) { res.status(400).json({ error: "outcome is required" }); return; }

  const updateData: Partial<typeof claimsTable.$inferInsert> = { outcome };
  if (approvedAmount !== undefined) {
    const cleaned = typeof approvedAmount === "string" ? approvedAmount.trim() : approvedAmount;
    updateData.approvedAmount = cleaned === "" ? null : String(cleaned);
  }
  if (invoiceNumbers !== undefined) updateData.invoiceNumbers = invoiceNumbers;

  const [old] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!old) { res.status(404).json({ error: "Claim not found" }); return; }

  const [claim] = await db.update(claimsTable).set(updateData).where(eq(claimsTable.id, id)).returning();
  await createAuditLog(id, "outcome_changed", `Outcome changed to ${outcome}`, req, { from: old.outcome, to: outcome, approvedAmount });
  await db.insert(notesTable).values({
    claimId: id,
    type: "outcome_recorded",
    content: `Outcome changed from ${old.outcome} to ${outcome}${approvedAmount ? ` (approved: $${approvedAmount})` : ""}`,
    author: req.user?.displayName || req.user?.email || "System",
  });
  emitClaimEvent(id, "outcome_changed", req);
  res.json(claim);
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

  const [claim] = await db.update(claimsTable).set({
    status: "On Hold",
    holdReason,
    holdPendingFrom: holdPendingFrom || null,
    holdPlacedAt: new Date().toISOString(),
  }).where(eq(claimsTable.id, id)).returning();

  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  await createAuditLog(id, "hold_placed", `Claim placed on hold: ${holdReason}`, req, { holdReason, holdPendingFrom });
  emitClaimEvent(id, "hold_placed", req);
  res.json(claim);
}));

router.delete("/claims/:id/hold", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [claim] = await db.update(claimsTable).set({
    status: "Needs Evidence",
    holdReason: null,
    holdPendingFrom: null,
    holdPlacedAt: null,
  }).where(eq(claimsTable.id, id)).returning();

  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  await createAuditLog(id, "hold_removed", "Hold removed from claim", req);
  emitClaimEvent(id, "hold_removed", req);
  res.json(claim);
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

router.post("/claims/admin/purge-all", asyncHandler(async (req, res): Promise<void> => {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const allClaims = await db.select({ id: claimsTable.id, confNumber: claimsTable.confNumber }).from(claimsTable);
  if (allClaims.length === 0) {
    res.json({ deleted: 0, message: "No claims to delete" });
    return;
  }
  const ids = allClaims.map(c => c.id);
  await db.delete(claimsTable).where(inArray(claimsTable.id, ids));
  res.json({ deleted: allClaims.length, message: `Purged ${allClaims.length} claims and all related data` });
}));

export default router;

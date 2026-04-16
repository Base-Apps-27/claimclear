import { Router, type IRouter, type Request } from "express";
import { eq, or, ilike, desc, and, count, inArray, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { invoiceGroupsTable, claimsTable, auditLogsTable, notesTable, portalSubmissionsTable, portalResponsesTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { broadcastClaimEvent } from "../lib/sse";
import {
  transitionClaimStatus,
  transitionClaimOutcome,
  VALID_MANUAL_STATUS_TRANSITIONS,
  VALID_OUTCOME_BY_STATUS,
  SYSTEM_CONTROLLED_STATUSES,
} from "../lib/claim-transitions";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

function actorFromReq(req: Request) {
  return {
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? null,
  };
}

router.get("/invoice-groups", asyncHandler(async (req, res): Promise<void> => {
  const { status, outcome, search, limit: limitStr, offset: offsetStr } = req.query;
  const limitVal = parseInt(String(limitStr || "50"), 10);
  const offsetVal = parseInt(String(offsetStr || "0"), 10);

  const conditions: SQL[] = [];
  if (status && typeof status === "string") {
    if (status.includes(",")) {
      const statuses = status.split(",") as (typeof invoiceGroupsTable.status.enumValues)[number][];
      const statusOr = or(...statuses.map(s => eq(invoiceGroupsTable.status, s)));
      if (statusOr) conditions.push(statusOr);
    } else {
      conditions.push(eq(invoiceGroupsTable.status, status as (typeof invoiceGroupsTable.status.enumValues)[number]));
    }
  }
  if (outcome && typeof outcome === "string") {
    conditions.push(eq(invoiceGroupsTable.outcome, outcome as (typeof invoiceGroupsTable.outcome.enumValues)[number]));
  }
  if (search && typeof search === "string") {
    const searchPattern = `%${search}%`;
    const searchOr = or(
      ilike(invoiceGroupsTable.invoiceNumber, searchPattern),
      ilike(invoiceGroupsTable.clientNumber, searchPattern),
      ilike(invoiceGroupsTable.errorDetails, searchPattern),
      ilike(invoiceGroupsTable.errorTypeName, searchPattern),
    );
    if (searchOr) conditions.push(searchOr);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult] = await db.select({ count: count() }).from(invoiceGroupsTable).where(where);
  const groups = await db.select().from(invoiceGroupsTable).where(where)
    .orderBy(desc(invoiceGroupsTable.createdAt))
    .limit(limitVal)
    .offset(offsetVal);

  res.json({ groups, total: totalResult.count });
}));

router.get("/invoice-groups/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const rides = await db.select().from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, id))
    .orderBy(desc(claimsTable.createdAt));

  const submissions = await db.select().from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.invoiceGroupId, id))
    .orderBy(desc(portalSubmissionsTable.createdAt));

  const notes = await db.select().from(notesTable)
    .where(eq(notesTable.invoiceGroupId, id))
    .orderBy(desc(notesTable.createdAt));

  const auditLogs = await db.select().from(auditLogsTable)
    .where(eq(auditLogsTable.invoiceGroupId, id))
    .orderBy(desc(auditLogsTable.timestamp));

  const responses = await db.select().from(portalResponsesTable)
    .where(eq(portalResponsesTable.invoiceGroupId, id))
    .orderBy(desc(portalResponsesTable.receivedAt));

  res.json({ ...group, rides, submissions, notes, auditLogs, responses });
}));

router.patch("/invoice-groups/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const updateData: Partial<typeof invoiceGroupsTable.$inferInsert> = {};
  const allowedFields = [
    "errorDetails", "errorTypeId", "errorTypeName", "payorEmail",
    "evidenceNotes", "evidenceFiles", "evidenceChecklist",
  ] as const;
  for (const f of allowedFields) {
    if (req.body[f] !== undefined) {
      (updateData as Record<string, unknown>)[f] = req.body[f];
    }
  }

  const [group] = await db.update(invoiceGroupsTable).set(updateData).where(eq(invoiceGroupsTable.id, id)).returning();
  if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const actor = actorFromReq(req);
  await db.insert(auditLogsTable).values({
    invoiceGroupId: id,
    action: "group_edited",
    details: `Invoice group ${group.invoiceNumber} updated`,
    metadata: { fields: Object.keys(updateData) },
    ...actor,
  });

  broadcastClaimEvent({
    type: "group_edited",
    claimId: id,
    userName: actor.userName,
    userEmail: actor.userEmail,
    timestamp: new Date().toISOString(),
  });

  res.json(group);
}));

router.patch("/invoice-groups/:id/status", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { status, reason } = req.body;
  if (!status) { res.status(400).json({ error: "status is required" }); return; }

  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const currentStatus = group.status;
  const validTargets = VALID_MANUAL_STATUS_TRANSITIONS[currentStatus] || [];
  if (!validTargets.includes(status) && !SYSTEM_CONTROLLED_STATUSES.includes(currentStatus)) {
    res.status(400).json({ error: `Cannot transition from ${currentStatus} to ${status}` });
    return;
  }

  const updateData: Partial<typeof invoiceGroupsTable.$inferInsert> = { status };
  if (status === "On Hold") {
    updateData.holdReason = reason || null;
    updateData.holdPendingFrom = currentStatus;
    updateData.holdPlacedAt = new Date().toISOString();
  }
  if (currentStatus === "On Hold" && status !== "On Hold") {
    updateData.holdReason = null;
    updateData.holdPendingFrom = null;
    updateData.holdPlacedAt = null;
  }

  const [updated] = await db.update(invoiceGroupsTable).set(updateData).where(eq(invoiceGroupsTable.id, id)).returning();

  const actor = actorFromReq(req);
  await db.insert(auditLogsTable).values({
    invoiceGroupId: id,
    action: "group_status_changed",
    details: `Invoice group ${group.invoiceNumber} status changed from ${currentStatus} to ${status}`,
    metadata: { from: currentStatus, to: status, reason: reason || null },
    ...actor,
  });

  await db.insert(notesTable).values({
    claimId: null,
    invoiceGroupId: id,
    type: "status_change",
    content: `Status changed from ${currentStatus} to ${status}${reason ? `: ${reason}` : ""}`,
    author: actor.userName || actor.userEmail || "System",
  });

  res.json(updated);
}));

router.patch("/invoice-groups/:id/outcome", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { outcome, approvedAmount } = req.body;
  if (!outcome) { res.status(400).json({ error: "outcome is required" }); return; }

  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const updateData: Partial<typeof invoiceGroupsTable.$inferInsert> = { outcome };
  if (approvedAmount !== undefined) updateData.approvedAmount = String(approvedAmount);

  let newStatus = group.status;
  if (outcome === "Approved" || outcome === "Partially Approved" || outcome === "Non-Issue") {
    newStatus = "Resolved";
    updateData.status = newStatus;
  } else if (outcome === "Denied") {
    newStatus = "Denied";
    updateData.status = newStatus;
  }

  const [updated] = await db.update(invoiceGroupsTable).set(updateData).where(eq(invoiceGroupsTable.id, id)).returning();

  const actor = actorFromReq(req);
  await db.insert(auditLogsTable).values({
    invoiceGroupId: id,
    action: "group_outcome_changed",
    details: `Invoice group ${group.invoiceNumber} outcome set to ${outcome}`,
    metadata: { outcome, approvedAmount, previousOutcome: group.outcome },
    ...actor,
  });

  res.json(updated);
}));

router.post("/invoice-groups/:id/triage", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { triageOutcome, errorTypeId, errorTypeName, notes: triageNotes } = req.body;
  if (!triageOutcome) { res.status(400).json({ error: "triageOutcome is required" }); return; }

  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const actor = actorFromReq(req);

  if (triageOutcome === "non_issue") {
    await db.update(invoiceGroupsTable).set({
      status: "Resolved",
      outcome: "Non-Issue",
      triageNotes: triageNotes || null,
      triagedAt: new Date().toISOString(),
      totalAmount: "0",
    }).where(eq(invoiceGroupsTable.id, id));

    await db.update(claimsTable).set({
      status: "Resolved",
      outcome: "Non-Issue",
      claimAmount: "0",
    }).where(eq(claimsTable.invoiceGroupId, id));
  } else {
    const updateData: Partial<typeof invoiceGroupsTable.$inferInsert> = {
      status: "New",
      triageNotes: triageNotes || null,
      triagedAt: new Date().toISOString(),
    };
    if (errorTypeId) {
      updateData.errorTypeId = errorTypeId;
      updateData.errorTypeName = errorTypeName || null;
    }
    await db.update(invoiceGroupsTable).set(updateData).where(eq(invoiceGroupsTable.id, id));
  }

  await db.insert(auditLogsTable).values({
    invoiceGroupId: id,
    action: "group_triaged",
    details: `Invoice group ${group.invoiceNumber} triaged: ${triageOutcome}`,
    metadata: { triageOutcome, errorTypeId, triageNotes },
    ...actor,
  });

  const [updated] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  res.json(updated);
}));

router.post("/invoice-groups/:id/hold", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { reason } = req.body;
  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const [updated] = await db.update(invoiceGroupsTable).set({
    status: "On Hold",
    holdReason: reason || null,
    holdPendingFrom: group.status,
    holdPlacedAt: new Date().toISOString(),
  }).where(eq(invoiceGroupsTable.id, id)).returning();

  const actor = actorFromReq(req);
  await db.insert(auditLogsTable).values({
    invoiceGroupId: id,
    action: "group_hold_placed",
    details: `Invoice group ${group.invoiceNumber} placed on hold: ${reason || "No reason given"}`,
    metadata: { reason, previousStatus: group.status },
    ...actor,
  });

  res.json(updated);
}));

router.delete("/invoice-groups/:id/hold", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const resumeStatus = group.holdPendingFrom || "Needs Evidence";
  const [updated] = await db.update(invoiceGroupsTable).set({
    status: resumeStatus as typeof group.status,
    holdReason: null,
    holdPendingFrom: null,
    holdPlacedAt: null,
  }).where(eq(invoiceGroupsTable.id, id)).returning();

  const actor = actorFromReq(req);
  await db.insert(auditLogsTable).values({
    invoiceGroupId: id,
    action: "group_hold_removed",
    details: `Invoice group ${group.invoiceNumber} hold removed, resumed to ${resumeStatus}`,
    metadata: { resumeStatus },
    ...actor,
  });

  res.json(updated);
}));

router.post("/invoice-groups/bulk-assign-error-type", asyncHandler(async (req, res): Promise<void> => {
  const { groupIds, errorTypeId, errorTypeName } = req.body;
  if (!Array.isArray(groupIds) || groupIds.length === 0 || !errorTypeId) {
    res.status(400).json({ error: "groupIds array and errorTypeId are required" });
    return;
  }

  await db.update(invoiceGroupsTable)
    .set({ errorTypeId, errorTypeName: errorTypeName || null })
    .where(inArray(invoiceGroupsTable.id, groupIds));

  const actor = actorFromReq(req);
  for (const gid of groupIds) {
    await db.insert(auditLogsTable).values({
      invoiceGroupId: gid,
      action: "group_error_type_assigned",
      details: `Error type assigned: ${errorTypeName || errorTypeId}`,
      metadata: { errorTypeId, errorTypeName },
      ...actor,
    });
  }

  res.json({ success: true, updated: groupIds.length });
}));

router.get("/invoice-groups/:id/valid-transitions", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const activeSubmissions = await db.select().from(portalSubmissionsTable)
    .where(and(
      eq(portalSubmissionsTable.invoiceGroupId, id),
      or(
        eq(portalSubmissionsTable.status, "pending"),
        eq(portalSubmissionsTable.status, "in_progress"),
      ),
    ));

  const hasActiveSubmission = activeSubmissions.length > 0;

  const validStatuses = hasActiveSubmission ? [] : (VALID_MANUAL_STATUS_TRANSITIONS[group.status] || []);
  const validOutcomes = VALID_OUTCOME_BY_STATUS[group.status] || [];

  const canQueueForPortal = !hasActiveSubmission &&
    group.status === "Needs Evidence" &&
    !!group.errorTypeId;

  const latestResponse = await db.select().from(portalResponsesTable)
    .where(eq(portalResponsesTable.invoiceGroupId, id))
    .orderBy(desc(portalResponsesTable.receivedAt))
    .limit(1);

  const latestResponseType = latestResponse.length > 0 ? latestResponse[0].responseType : null;

  let postResponseActions: string[] = [];
  if (group.status === "Needs Review" && latestResponseType) {
    if (["approval", "partial_approval"].includes(latestResponseType)) {
      postResponseActions = ["resolve_reattest", "resolve_new_invoice"];
    } else if (latestResponseType === "denial") {
      postResponseActions = ["accept_loss", "re_dispute"];
    } else {
      postResponseActions = ["resolve_reattest", "resolve_new_invoice", "accept_loss", "re_dispute"];
    }
  }

  res.json({
    validStatuses,
    validOutcomes,
    canQueueForPortal,
    hasActiveSubmission,
    postResponseActions,
    latestResponseType,
  });
}));

router.delete("/invoice-groups/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const actor = actorFromReq(req);
  await db.insert(auditLogsTable).values({
    invoiceGroupId: id,
    action: "group_deleted",
    details: `Invoice group ${existing.invoiceNumber} deleted`,
    ...actor,
  });

  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  res.sendStatus(204);
}));

export default router;

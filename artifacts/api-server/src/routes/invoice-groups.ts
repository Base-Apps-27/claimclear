import { Router, type IRouter, type Request } from "express";
import { eq, or, ilike, desc, and, count, inArray, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { invoiceGroupsTable, claimsTable, auditLogsTable, notesTable, portalSubmissionsTable, portalResponsesTable, claimEvidenceTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { broadcastGroupEvent } from "../lib/sse";
import {
  transitionGroupStatus,
  transitionGroupOutcome,
  transitionGroupStatusAndOutcome,
  VALID_GROUP_STATUS_TRANSITIONS,
  VALID_GROUP_OUTCOME_BY_STATUS,
  SYSTEM_CONTROLLED_GROUP_STATUSES,
} from "../lib/group-transitions";

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

function emitGroupEvent(invoiceGroupId: number, type: string, req: Request) {
  broadcastGroupEvent({
    type,
    invoiceGroupId,
    userName: req.user?.displayName ?? null,
    userEmail: req.user?.email ?? null,
    timestamp: new Date().toISOString(),
  });
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

  emitGroupEvent(id, "group_edited", req);

  res.json(group);
}));

router.patch("/invoice-groups/:id/status", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { status, reason } = req.body;
  if (!status) { res.status(400).json({ error: "status is required" }); return; }

  try {
    const result = await transitionGroupStatus({
      groupId: id,
      newStatus: status,
      source: "manual",
      reason: reason || "Manual status change",
      actor: actorFromReq(req),
      extraFields: status === "On Hold" ? { holdReason: reason || null } : undefined,
    });
    res.json(result.group);
  } catch (err: any) {
    const msg = err.message || "Failed to update status";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

router.patch("/invoice-groups/:id/outcome", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { outcome, approvedAmount } = req.body;
  if (!outcome) { res.status(400).json({ error: "outcome is required" }); return; }

  let newStatus: string | undefined;
  if (outcome === "Approved" || outcome === "Partially Approved" || outcome === "Non-Issue") {
    newStatus = "Resolved";
  } else if (outcome === "Denied") {
    newStatus = "Denied";
  }

  try {
    if (newStatus) {
      const result = await transitionGroupStatusAndOutcome({
        groupId: id,
        newStatus: newStatus as typeof invoiceGroupsTable.status.enumValues[number],
        newOutcome: outcome,
        source: "manual",
        reason: `Outcome set to ${outcome}`,
        actor: actorFromReq(req),
        extraFields: approvedAmount !== undefined ? { approvedAmount: String(approvedAmount) } : undefined,
      });
      res.json(result.group);
    } else {
      const result = await transitionGroupOutcome({
        groupId: id,
        newOutcome: outcome,
        source: "manual",
        reason: `Outcome set to ${outcome}`,
        actor: actorFromReq(req),
        approvedAmount: approvedAmount !== undefined ? String(approvedAmount) : undefined,
      });
      res.json(result.group);
    }
  } catch (err: any) {
    const msg = err.message || "Failed to update outcome";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

router.post("/invoice-groups/:id/triage", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { triageOutcome, errorTypeId, errorTypeName, notes: triageNotes } = req.body;
  if (!triageOutcome || !["non_issue", "issue_found"].includes(triageOutcome)) {
    res.status(400).json({ error: "triageOutcome must be 'non_issue' or 'issue_found'" });
    return;
  }

  const actor = actorFromReq(req);

  try {
    if (triageOutcome === "non_issue") {
      const result = await transitionGroupStatusAndOutcome({
        groupId: id,
        newStatus: "Resolved",
        newOutcome: "Non-Issue",
        source: "triage",
        reason: `Triaged as non-issue${triageNotes ? `: ${triageNotes}` : ""}`,
        actor,
        extraFields: {
          triageNotes: triageNotes || null,
          triagedAt: new Date().toISOString(),
          totalAmount: "0",
        },
        childFields: {
          claimAmount: "0",
          approvedAmount: "0",
        },
      });
      res.json(result.group);
    } else {
      if (!errorTypeId || !errorTypeName) {
        res.status(400).json({ error: "errorTypeId and errorTypeName are required for issue_found" });
        return;
      }

      const result = await transitionGroupStatus({
        groupId: id,
        newStatus: "New",
        source: "triage",
        reason: `Issue identified during triage: ${errorTypeName}${triageNotes ? `. ${triageNotes}` : ""}`,
        actor,
        extraFields: {
          errorTypeId: String(errorTypeId),
          errorTypeName,
          triageNotes: triageNotes || null,
          triagedAt: new Date().toISOString(),
        },
      });
      res.json(result.group);
    }
  } catch (err: any) {
    const msg = err.message || "Failed to triage";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

router.post("/invoice-groups/:id/hold", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { reason } = req.body;

  try {
    const result = await transitionGroupStatus({
      groupId: id,
      newStatus: "On Hold",
      source: "manual",
      reason: reason || "No reason given",
      actor: actorFromReq(req),
      extraFields: { holdReason: reason || null },
    });
    res.json(result.group);
  } catch (err: any) {
    const msg = err.message || "Failed to place on hold";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
}));

router.delete("/invoice-groups/:id/hold", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
  if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const resumeStatus = (group.holdPendingFrom || "Needs Evidence") as typeof group.status;

  try {
    const result = await transitionGroupStatus({
      groupId: id,
      newStatus: resumeStatus,
      source: "manual",
      reason: "Hold removed",
      actor: actorFromReq(req),
      systemOverride: true,
    });
    res.json(result.group);
  } catch (err: any) {
    const msg = err.message || "Failed to remove hold";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    res.status(400).json({ error: msg });
  }
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

  const validStatuses = hasActiveSubmission ? [] : (VALID_GROUP_STATUS_TRANSITIONS[group.status] || []);
  const validOutcomes = VALID_GROUP_OUTCOME_BY_STATUS[group.status] || [];

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

router.patch("/invoice-groups/:id/workflow", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { workflowProgress } = req.body;
  const [group] = await db.update(invoiceGroupsTable)
    .set({ workflowProgress })
    .where(eq(invoiceGroupsTable.id, id))
    .returning();
  if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const actor = actorFromReq(req);
  await db.insert(auditLogsTable).values({
    invoiceGroupId: id,
    action: "group_workflow_step",
    details: `Workflow progress updated for invoice group ${group.invoiceNumber}`,
    ...actor,
  });

  emitGroupEvent(id, "group_workflow_updated", req);
  res.json(group);
}));

router.get("/invoice-groups/:id/evidence", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const evidence = await db.select().from(claimEvidenceTable)
    .where(eq(claimEvidenceTable.invoiceGroupId, id))
    .orderBy(claimEvidenceTable.collectedAt);
  res.json({ evidence });
}));

router.post("/invoice-groups/:id/evidence", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { evidenceTypeId, evidenceTypeName, treeNodeId, imageUrl, notes } = req.body;
  if (!evidenceTypeName) {
    res.status(400).json({ error: "evidenceTypeName is required" });
    return;
  }

  const user = req.user;
  const [created] = await db.insert(claimEvidenceTable).values({
    claimId: null,
    invoiceGroupId: id,
    evidenceTypeId: evidenceTypeId || null,
    evidenceTypeName,
    treeNodeId: treeNodeId || null,
    imageUrl: imageUrl || null,
    notes: notes || null,
    collectedBy: user?.displayName || user?.email || null,
  }).returning();

  emitGroupEvent(id, "group_evidence_added", req);
  res.status(201).json(created);
}));

router.delete("/invoice-groups/:id/evidence/:evidenceId", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const evidenceId = parseInt(String(req.params.evidenceId), 10);
  if (isNaN(id) || isNaN(evidenceId)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.delete(claimEvidenceTable)
    .where(and(eq(claimEvidenceTable.id, evidenceId), eq(claimEvidenceTable.invoiceGroupId, id)));

  emitGroupEvent(id, "group_evidence_removed", req);
  res.json({ success: true });
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

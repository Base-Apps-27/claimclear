import { eq, and, or, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { invoiceGroupsTable, claimsTable, auditLogsTable, notesTable, portalSubmissionsTable, portalResponsesTable } from "@workspace/db";
import { CLOSURE_REASON_LABELS, type ClosureReason } from "@workspace/db";
import { broadcastGroupEvent } from "./sse";

export type GroupStatus = typeof invoiceGroupsTable.status.enumValues[number];
type GroupOutcome = typeof invoiceGroupsTable.outcome.enumValues[number];
type ClaimStatus = typeof claimsTable.status.enumValues[number];
type ClaimOutcome = typeof claimsTable.outcome.enumValues[number];

export interface GroupTransitionActor {
  userEmail: string | null;
  userName: string | null;
}

export interface GroupTransitionResult {
  success: true;
  group: typeof invoiceGroupsTable.$inferSelect;
  previousStatus: string;
  previousOutcome: string;
}

export const VALID_GROUP_STATUS_TRANSITIONS: Record<string, string[]> = {
  "New": ["Needs Evidence", "Needs Review", "On Hold", "Resolved", "Denied"],
  "Needs Review": ["New", "Needs Evidence", "On Hold", "Resolved", "Denied"],
  "Needs Evidence": ["Needs Review", "On Hold", "Resolved", "Denied"],
  "Portal Queued": [],
  "Generating Email": [],
  "Ready to Review": [],
  "Awaiting Response": ["Needs Review", "On Hold", "Resolved", "Denied"],
  "On Hold": ["New", "Needs Review", "Needs Evidence"],
  "Resolved": ["New", "Needs Review"],
  "Denied": ["New", "Needs Review"],
};

export const SYSTEM_CONTROLLED_GROUP_STATUSES = ["Portal Queued", "Generating Email", "Ready to Review"];

export const VALID_GROUP_OUTCOME_BY_STATUS: Record<string, string[]> = {
  "New": ["Pending", "Withdrawn"],
  "Needs Review": ["Pending", "Withdrawn"],
  "Needs Evidence": ["Pending", "Withdrawn"],
  "Portal Queued": [],
  "Generating Email": [],
  "Ready to Review": [],
  "Awaiting Response": ["Approved", "Partially Approved", "Denied", "Withdrawn"],
  "On Hold": [],
  "Resolved": ["Approved", "Partially Approved", "Denied", "Non-Issue", "Withdrawn"],
  "Denied": ["Denied", "Approved", "Partially Approved", "Withdrawn"],
};

const TERMINAL_STATUSES: string[] = ["Resolved", "Denied"];

async function checkActiveSubmissions(groupId: number): Promise<void> {
  const activeSubmissions = await db.select().from(portalSubmissionsTable)
    .where(and(
      eq(portalSubmissionsTable.invoiceGroupId, groupId),
      or(
        eq(portalSubmissionsTable.status, "pending"),
        eq(portalSubmissionsTable.status, "in_progress"),
      ),
    ));
  if (activeSubmissions.length > 0) {
    throw new Error("Cannot change status while a portal submission is in progress. Wait for the submission to complete or cancel it first.");
  }
}

function applyHoldFields(
  updateData: Partial<typeof invoiceGroupsTable.$inferInsert>,
  oldStatus: string,
  newStatus: string,
  holdReason?: string | null,
): void {
  if (newStatus === "On Hold") {
    updateData.holdReason = holdReason ?? null;
    updateData.holdPendingFrom = oldStatus;
    updateData.holdPlacedAt = new Date().toISOString();
  }
  if (oldStatus === "On Hold" && newStatus !== "On Hold") {
    updateData.holdReason = null;
    updateData.holdPendingFrom = null;
    updateData.holdPlacedAt = null;
  }
}

async function syncChildRides(
  groupId: number,
  newStatus: string,
  newOutcome: string | null,
  actor: GroupTransitionActor,
  extraChildFields?: Partial<typeof claimsTable.$inferInsert>,
) {
  if (!TERMINAL_STATUSES.includes(newStatus)) return;

  const updateData: Partial<typeof claimsTable.$inferInsert> = {
    status: newStatus as ClaimStatus,
    ...(newOutcome ? { outcome: newOutcome as ClaimOutcome } : {}),
    ...extraChildFields,
  };

  await db.update(claimsTable)
    .set(updateData)
    .where(eq(claimsTable.invoiceGroupId, groupId));
}

export async function transitionGroupStatus(opts: {
  groupId: number;
  newStatus: GroupStatus;
  source: string;
  reason: string;
  actor: GroupTransitionActor;
  systemOverride?: boolean;
  extraFields?: Partial<typeof invoiceGroupsTable.$inferInsert>;
  childFields?: Partial<typeof claimsTable.$inferInsert>;
}): Promise<GroupTransitionResult> {
  const { groupId, newStatus, source, reason, actor, systemOverride = false, extraFields, childFields } = opts;

  const [old] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupId));
  if (!old) throw new Error(`Invoice group ${groupId} not found`);

  if (old.status === newStatus && !extraFields) {
    return { success: true, group: old, previousStatus: old.status, previousOutcome: old.outcome };
  }

  if (!systemOverride) {
    await checkActiveSubmissions(groupId);

    if (SYSTEM_CONTROLLED_GROUP_STATUSES.includes(newStatus)) {
      throw new Error(`"${newStatus}" is a system-controlled status and cannot be set manually.`);
    }

    const allowed = VALID_GROUP_STATUS_TRANSITIONS[old.status] || [];
    if (!allowed.includes(newStatus)) {
      throw new Error(`Cannot transition from "${old.status}" to "${newStatus}". Valid transitions: ${allowed.length > 0 ? allowed.join(", ") : "none (status is system-controlled)"}`);
    }
  }

  const updateData: Partial<typeof invoiceGroupsTable.$inferInsert> = { status: newStatus, ...extraFields };
  applyHoldFields(updateData, old.status, newStatus, extraFields?.holdReason);

  const [group] = await db.update(invoiceGroupsTable).set(updateData).where(eq(invoiceGroupsTable.id, groupId)).returning();

  const statusChanged = old.status !== newStatus;
  if (statusChanged) {
    await db.insert(auditLogsTable).values({
      invoiceGroupId: groupId,
      action: "group_status_changed",
      details: `Status changed from ${old.status} to ${newStatus}`,
      metadata: { from: old.status, to: newStatus, source, reason },
      userEmail: actor.userEmail,
      userName: actor.userName,
    });

    await db.insert(notesTable).values({
      claimId: null,
      invoiceGroupId: groupId,
      type: "status_change",
      content: `Status changed from ${old.status} to ${newStatus} — ${reason}`,
      author: actor.userName || actor.userEmail || source,
    });

    await syncChildRides(groupId, newStatus, group.outcome, actor, childFields);

    broadcastGroupEvent({
      type: "status_changed",
      invoiceGroupId: groupId,
      userName: actor.userName,
      userEmail: actor.userEmail,
      timestamp: new Date().toISOString(),
    });
  }

  return { success: true, group, previousStatus: old.status, previousOutcome: old.outcome };
}

export async function groupHasResponse(groupId: number): Promise<boolean> {
  const direct = await db.select({ id: portalResponsesTable.id })
    .from(portalResponsesTable)
    .where(eq(portalResponsesTable.invoiceGroupId, groupId))
    .limit(1);
  if (direct.length > 0) return true;

  const childClaims = await db.select({ id: claimsTable.id })
    .from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, groupId));
  if (childClaims.length === 0) return false;

  const linked = await db.select({ id: portalResponsesTable.id })
    .from(portalResponsesTable)
    .where(inArray(portalResponsesTable.claimId, childClaims.map(c => c.id)))
    .limit(1);
  return linked.length > 0;
}

export async function transitionGroupOutcome(opts: {
  groupId: number;
  newOutcome: GroupOutcome;
  source: string;
  reason: string;
  actor: GroupTransitionActor;
  approvedAmount?: string | null;
  closureReason?: ClosureReason | null;
  systemOverride?: boolean;
}): Promise<GroupTransitionResult> {
  const { groupId, newOutcome, source, reason, actor, approvedAmount, systemOverride = false } = opts;
  let { closureReason } = opts;

  const [old] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupId));
  if (!old) throw new Error(`Invoice group ${groupId} not found`);

  await checkActiveSubmissions(groupId);

  const allowed = VALID_GROUP_OUTCOME_BY_STATUS[old.status] || [];
  if (!allowed.includes(newOutcome)) {
    throw new Error(`Cannot set outcome to "${newOutcome}" when group is in "${old.status}" status. ${allowed.length > 0 ? `Valid outcomes: ${allowed.join(", ")}` : "Outcome changes are not allowed in this status."}`);
  }

  if (newOutcome === "Denied") {
    if (!systemOverride) {
      const has = await groupHasResponse(groupId);
      if (!has) {
        throw new Error(`Cannot mark this invoice group as Denied because no portal or email response has been recorded. Use "Withdraw — Not Contestable" instead.`);
      }
    }
    closureReason = "payer_denied";
  } else if (newOutcome === "Withdrawn") {
    if (closureReason !== "not_contestable" && closureReason !== "accepted_loss") {
      throw new Error(`Withdrawn outcome requires a closureReason of "not_contestable" or "accepted_loss".`);
    }
  } else if (newOutcome === "Non-Issue") {
    closureReason = "non_issue";
  } else if (closureReason === undefined) {
    closureReason = null;
  }

  const updateData: Partial<typeof invoiceGroupsTable.$inferInsert> = { outcome: newOutcome };
  if (approvedAmount !== undefined) {
    const cleaned = typeof approvedAmount === "string" ? approvedAmount.trim() : approvedAmount;
    updateData.approvedAmount = cleaned === "" ? null : cleaned ? String(cleaned) : null;
  }
  updateData.closureReason = closureReason ?? null;

  const [group] = await db.update(invoiceGroupsTable).set(updateData).where(eq(invoiceGroupsTable.id, groupId)).returning();

  const closureLabel = closureReason ? CLOSURE_REASON_LABELS[closureReason] : null;
  await db.insert(auditLogsTable).values({
    invoiceGroupId: groupId,
    action: "group_outcome_changed",
    details: `Outcome changed from ${old.outcome} to ${newOutcome}${closureLabel ? ` (${closureLabel})` : ""}`,
    metadata: { from: old.outcome, to: newOutcome, source, reason, approvedAmount, closureReason: closureReason ?? null, closureReasonLabel: closureLabel },
    userEmail: actor.userEmail,
    userName: actor.userName,
  });

  await db.insert(notesTable).values({
    claimId: null,
    invoiceGroupId: groupId,
    type: "outcome_recorded",
    content: `Outcome changed from ${old.outcome} to ${newOutcome}${closureLabel ? ` — ${closureLabel}` : ""}${approvedAmount ? ` (approved: $${approvedAmount})` : ""} — ${reason}`,
    author: actor.userName || actor.userEmail || source,
  });

  broadcastGroupEvent({
    type: "outcome_changed",
    invoiceGroupId: groupId,
    userName: actor.userName,
    userEmail: actor.userEmail,
    timestamp: new Date().toISOString(),
  });

  return { success: true, group, previousStatus: old.status, previousOutcome: old.outcome };
}

export async function transitionGroupStatusAndOutcome(opts: {
  groupId: number;
  newStatus: GroupStatus;
  newOutcome: GroupOutcome;
  source: string;
  reason: string;
  actor: GroupTransitionActor;
  systemOverride?: boolean;
  extraFields?: Partial<typeof invoiceGroupsTable.$inferInsert>;
  childFields?: Partial<typeof claimsTable.$inferInsert>;
  closureReason?: ClosureReason | null;
}): Promise<GroupTransitionResult> {
  const { groupId, newStatus, newOutcome, source, reason, actor, systemOverride = false, extraFields, childFields } = opts;
  let { closureReason } = opts;

  const [old] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupId));
  if (!old) throw new Error(`Invoice group ${groupId} not found`);

  if (!systemOverride) {
    await checkActiveSubmissions(groupId);

    if (old.status !== newStatus) {
      if (SYSTEM_CONTROLLED_GROUP_STATUSES.includes(newStatus)) {
        throw new Error(`"${newStatus}" is a system-controlled status and cannot be set manually.`);
      }
      const allowed = VALID_GROUP_STATUS_TRANSITIONS[old.status] || [];
      if (!allowed.includes(newStatus)) {
        throw new Error(`Cannot transition from "${old.status}" to "${newStatus}". Valid transitions: ${allowed.length > 0 ? allowed.join(", ") : "none (status is system-controlled)"}`);
      }
    }

    const allowedOutcomes = VALID_GROUP_OUTCOME_BY_STATUS[newStatus] || [];
    if (allowedOutcomes.length > 0 && !allowedOutcomes.includes(newOutcome)) {
      throw new Error(`Cannot set outcome to "${newOutcome}" when group is moving to "${newStatus}" status. Valid outcomes: ${allowedOutcomes.join(", ")}`);
    }
  }

  if (newOutcome === "Withdrawn" && closureReason !== "not_contestable" && closureReason !== "accepted_loss") {
    throw new Error(`Withdrawn outcome requires a closureReason of "not_contestable" or "accepted_loss".`);
  }
  if (newOutcome === "Denied") {
    if (!systemOverride) {
      const has = await groupHasResponse(groupId);
      if (!has) {
        throw new Error(`Cannot mark this invoice group as Denied because no portal or email response has been recorded. Use "Withdraw — Not Contestable" instead.`);
      }
    }
    if (closureReason === undefined) closureReason = "payer_denied";
  }
  if (newOutcome === "Non-Issue" && closureReason === undefined) closureReason = "non_issue";
  if (newOutcome !== "Denied" && newOutcome !== "Withdrawn" && newOutcome !== "Non-Issue") {
    closureReason = null;
  }

  const updateData: Partial<typeof invoiceGroupsTable.$inferInsert> = {
    status: newStatus,
    outcome: newOutcome,
    ...extraFields,
  };
  if (closureReason !== undefined) updateData.closureReason = closureReason ?? null;
  applyHoldFields(updateData, old.status, newStatus, extraFields?.holdReason);

  const [group] = await db.update(invoiceGroupsTable).set(updateData).where(eq(invoiceGroupsTable.id, groupId)).returning();

  const changes: string[] = [];
  if (old.status !== newStatus) changes.push(`status: ${old.status} → ${newStatus}`);
  if (old.outcome !== newOutcome) changes.push(`outcome: ${old.outcome} → ${newOutcome}`);
  const closureLabel = closureReason ? CLOSURE_REASON_LABELS[closureReason] : null;
  if (closureLabel) changes.push(`closure: ${closureLabel}`);
  const changeDesc = changes.length > 0 ? changes.join(", ") : "no change";

  await db.insert(auditLogsTable).values({
    invoiceGroupId: groupId,
    action: "group_status_and_outcome_changed",
    details: `${changeDesc} — ${reason}`,
    metadata: {
      fromStatus: old.status, toStatus: newStatus,
      fromOutcome: old.outcome, toOutcome: newOutcome,
      source, reason,
      closureReason: closureReason ?? null,
      closureReasonLabel: closureLabel,
    },
    userEmail: actor.userEmail,
    userName: actor.userName,
  });

  await db.insert(notesTable).values({
    claimId: null,
    invoiceGroupId: groupId,
    type: "status_change",
    content: `${changeDesc} — ${reason}`,
    author: actor.userName || actor.userEmail || source,
  });

  await syncChildRides(groupId, newStatus, newOutcome, actor, childFields);

  broadcastGroupEvent({
    type: "status_changed",
    invoiceGroupId: groupId,
    userName: actor.userName,
    userEmail: actor.userEmail,
    timestamp: new Date().toISOString(),
  });

  return { success: true, group, previousStatus: old.status, previousOutcome: old.outcome };
}

export function getValidGroupTransitions(status: string) {
  return {
    validStatuses: VALID_GROUP_STATUS_TRANSITIONS[status] || [],
    validOutcomes: VALID_GROUP_OUTCOME_BY_STATUS[status] || [],
  };
}

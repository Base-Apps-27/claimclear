import { eq, and, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, auditLogsTable, notesTable, portalSubmissionsTable, portalResponsesTable } from "@workspace/db";
import { CLOSURE_REASON_LABELS, type ClosureReason } from "@workspace/db";
import { broadcastClaimEvent } from "./sse";
import { closureAuditPayload, type NormalizedClosure } from "./closure-validation";

// A "DB executor" is anything with the same select/update/insert surface as
// the top-level `db` handle. The drizzle transaction object passed to
// `db.transaction(async tx => ...)` is structurally compatible (it just
// lacks `$client` and a few pool-level helpers), so callers who want their
// work to participate in an outer transaction can pass `tx` here and every
// read/write inside the transition will join that tx.
export type DbExecutor = Pick<typeof db, "select" | "update" | "insert" | "delete">;

export type ClaimStatus = typeof claimsTable.status.enumValues[number];

export interface TransitionActor {
  userEmail: string | null;
  userName: string | null;
}

export interface TransitionResult {
  success: true;
  claim: typeof claimsTable.$inferSelect;
  previousStatus: string;
  previousOutcome: string;
}

const VALID_MANUAL_STATUS_TRANSITIONS: Record<string, string[]> = {
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

const SYSTEM_CONTROLLED_STATUSES = ["Portal Queued", "Generating Email", "Ready to Review"];

const VALID_OUTCOME_BY_STATUS: Record<string, string[]> = {
  "New": ["Pending", "Withdrawn"],
  "Needs Review": ["Pending", "Withdrawn"],
  "Needs Evidence": ["Pending", "Withdrawn"],
  "Portal Queued": [],
  "Generating Email": [],
  "Ready to Review": [],
  "Awaiting Response": ["Approved", "Partially Approved", "Denied", "Withdrawn"],
  "On Hold": [],
  "Resolved": ["Approved", "Partially Approved", "Denied", "Withdrawn"],
  "Denied": ["Denied", "Approved", "Partially Approved", "Withdrawn"],
};

export { VALID_MANUAL_STATUS_TRANSITIONS, SYSTEM_CONTROLLED_STATUSES, VALID_OUTCOME_BY_STATUS };

export async function transitionClaimStatus(opts: {
  claimId: number;
  newStatus: string;
  source: string;
  reason: string;
  actor: TransitionActor;
  systemOverride?: boolean;
  extraFields?: Partial<typeof claimsTable.$inferInsert>;
  /**
   * Optional drizzle executor (the global `db` or a `tx` object from inside
   * `db.transaction`). When provided, every read and write done by the
   * transition runs against that executor so the caller can wrap the
   * transition together with its own row edit + audit in one atomic unit.
   */
  executor?: DbExecutor;
}): Promise<TransitionResult> {
  const { claimId, newStatus, source, reason, actor, systemOverride = false, extraFields, executor } = opts;
  const ex: DbExecutor = executor ?? db;

  const [old] = await ex.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!old) throw new Error(`Claim ${claimId} not found`);

  if (old.status === newStatus && !extraFields) {
    return { success: true, claim: old, previousStatus: old.status, previousOutcome: old.outcome };
  }

  if (!systemOverride) {
    const activeSubmissions = await ex.select().from(portalSubmissionsTable)
      .where(and(
        eq(portalSubmissionsTable.claimId, claimId),
        inArray(portalSubmissionsTable.status, ["pending", "in_progress"])
      ));
    if (activeSubmissions.length > 0) {
      throw new Error(`Cannot change status while a portal submission is in progress. Wait for the submission to complete or cancel it first.`);
    }

    if (SYSTEM_CONTROLLED_STATUSES.includes(newStatus)) {
      throw new Error(`"${newStatus}" is a system-controlled status and cannot be set manually.`);
    }

    const allowed = VALID_MANUAL_STATUS_TRANSITIONS[old.status] || [];
    if (!allowed.includes(newStatus)) {
      throw new Error(`Cannot transition from "${old.status}" to "${newStatus}". Valid transitions: ${allowed.length > 0 ? allowed.join(", ") : "none (status is system-controlled)"}`);
    }
  }

  const updateData: Partial<typeof claimsTable.$inferInsert> = { status: newStatus as any, ...extraFields };
  const [claim] = await ex.update(claimsTable).set(updateData).where(eq(claimsTable.id, claimId)).returning();

  const statusChanged = old.status !== newStatus;
  if (statusChanged) {
    await ex.insert(auditLogsTable).values({
      claimId,
      action: "status_changed",
      details: `Status changed from ${old.status} to ${newStatus}`,
      metadata: { from: old.status, to: newStatus, source, reason },
      userEmail: actor.userEmail,
      userName: actor.userName,
    });

    await ex.insert(notesTable).values({
      claimId,
      type: "status_change",
      content: `Status changed from ${old.status} to ${newStatus} — ${reason}`,
      author: actor.userName || actor.userEmail || source,
    });
  }

  broadcastClaimEvent({
    type: "status_changed",
    claimId,
    userName: actor.userName,
    userEmail: actor.userEmail,
    timestamp: new Date().toISOString(),
  });

  return { success: true, claim, previousStatus: old.status, previousOutcome: old.outcome };
}

export async function transitionClaimOutcome(opts: {
  claimId: number;
  newOutcome: string;
  source: string;
  reason: string;
  actor: TransitionActor;
  systemOverride?: boolean;
  approvedAmount?: string | null;
  invoiceNumbers?: string | null;
  closureReason?: ClosureReason | null;
  /** Full validated closure detail payload, when the staff filed a structured closure. */
  closure?: NormalizedClosure | null;
}): Promise<TransitionResult> {
  const { claimId, newOutcome, source, reason, actor, systemOverride = false, approvedAmount, invoiceNumbers, closure } = opts;
  let { closureReason } = opts;

  const [old] = await db.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!old) throw new Error(`Claim ${claimId} not found`);

  if (!systemOverride) {
    const activeSubmissions = await db.select().from(portalSubmissionsTable)
      .where(and(
        eq(portalSubmissionsTable.claimId, claimId),
        inArray(portalSubmissionsTable.status, ["pending", "in_progress"])
      ));
    if (activeSubmissions.length > 0) {
      throw new Error(`Cannot change outcome while a portal submission is in progress.`);
    }

    const allowed = VALID_OUTCOME_BY_STATUS[old.status] || [];
    if (!allowed.includes(newOutcome)) {
      throw new Error(`Cannot set outcome to "${newOutcome}" when claim is in "${old.status}" status. ${allowed.length > 0 ? `Valid outcomes: ${allowed.join(", ")}` : "Outcome changes are not allowed in this status."}`);
    }
  }

  if (newOutcome === "Denied") {
    if (!systemOverride) {
      const responseCount = await db.select({ id: portalResponsesTable.id })
        .from(portalResponsesTable)
        .where(eq(portalResponsesTable.claimId, claimId))
        .limit(1);
      if (responseCount.length === 0) {
        throw new Error(`Cannot mark this claim as Denied because no portal or email response has been recorded. Use "Withdraw — Not Contestable" instead.`);
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

  const updateData: Partial<typeof claimsTable.$inferInsert> = { outcome: newOutcome as any };
  if (approvedAmount !== undefined) {
    const cleaned = typeof approvedAmount === "string" ? approvedAmount.trim() : approvedAmount;
    updateData.approvedAmount = cleaned === "" ? null : cleaned ? String(cleaned) : null;
  }
  if (invoiceNumbers !== undefined) updateData.invoiceNumbers = invoiceNumbers;
  updateData.closureReason = closureReason ?? null;
  if (closure) {
    updateData.closureCategory = closure.closureCategory;
    updateData.closureCategoryOther = closure.closureCategoryOther;
    updateData.closureRootCause = closure.closureRootCause;
    updateData.closureRootCauseOther = closure.closureRootCauseOther;
    updateData.closureNarrative = closure.closureNarrative;
    updateData.closureAccountabilityTags = closure.closureAccountabilityTags;
    updateData.closureAccountabilityOther = closure.closureAccountabilityOther;
    updateData.closureDrivers = closure.closureDrivers;
    updateData.closureDispatchers = closure.closureDispatchers;
    updateData.closureCommunicatedTo = closure.closureCommunicatedTo;
    if (closure.closureAddressedAt !== null) updateData.closureAddressedAt = closure.closureAddressedAt;
    if (closure.closureAddressedBy !== null) updateData.closureAddressedBy = closure.closureAddressedBy;
    if (closure.closureAddressedByEmail !== null) updateData.closureAddressedByEmail = closure.closureAddressedByEmail;
    if (closure.closureReviewNotes !== null) updateData.closureReviewNotes = closure.closureReviewNotes;
    updateData.closureReviewState = "pending";
  }

  const [claim] = await db.update(claimsTable).set(updateData).where(eq(claimsTable.id, claimId)).returning();

  const closureLabel = closureReason ? CLOSURE_REASON_LABELS[closureReason] : null;
  await db.insert(auditLogsTable).values({
    claimId,
    action: "outcome_changed",
    details: `Outcome changed from ${old.outcome} to ${newOutcome}${closureLabel ? ` (${closureLabel})` : ""}`,
    metadata: {
      from: old.outcome,
      to: newOutcome,
      source,
      reason,
      approvedAmount,
      closureReason: closureReason ?? null,
      closureReasonLabel: closureLabel,
      ...(closure ? { closure: closureAuditPayload(closure) } : {}),
    },
    userEmail: actor.userEmail,
    userName: actor.userName,
  });

  await db.insert(notesTable).values({
    claimId,
    type: "outcome_recorded",
    content: `Outcome changed from ${old.outcome} to ${newOutcome}${closureLabel ? ` — ${closureLabel}` : ""}${approvedAmount ? ` (approved: $${approvedAmount})` : ""} — ${reason}`,
    author: actor.userName || actor.userEmail || source,
  });

  broadcastClaimEvent({
    type: "outcome_changed",
    claimId,
    userName: actor.userName,
    userEmail: actor.userEmail,
    timestamp: new Date().toISOString(),
  });

  return { success: true, claim, previousStatus: old.status, previousOutcome: old.outcome };
}

export async function transitionClaimStatusAndOutcome(opts: {
  claimId: number;
  newStatus: string;
  newOutcome: string;
  source: string;
  reason: string;
  actor: TransitionActor;
  extraFields?: Partial<typeof claimsTable.$inferInsert>;
  closureReason?: ClosureReason | null;
  closure?: NormalizedClosure | null;
}): Promise<TransitionResult> {
  const { claimId, newStatus, newOutcome, source, reason, actor, extraFields, closure } = opts;
  let { closureReason } = opts;

  const [old] = await db.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!old) throw new Error(`Claim ${claimId} not found`);

  if (newOutcome === "Withdrawn" && closureReason !== "not_contestable" && closureReason !== "accepted_loss") {
    throw new Error(`Withdrawn outcome requires a closureReason of "not_contestable" or "accepted_loss".`);
  }
  if (newOutcome === "Denied") {
    const responseCount = await db.select({ id: portalResponsesTable.id })
      .from(portalResponsesTable)
      .where(eq(portalResponsesTable.claimId, claimId))
      .limit(1);
    if (responseCount.length === 0) {
      throw new Error(`Cannot mark this claim as Denied because no portal or email response has been recorded. Use "Withdraw — Not Contestable" instead.`);
    }
    if (closureReason === undefined) closureReason = "payer_denied";
  }
  if (newOutcome === "Non-Issue" && closureReason === undefined) closureReason = "non_issue";
  if (newOutcome !== "Denied" && newOutcome !== "Withdrawn" && newOutcome !== "Non-Issue") {
    closureReason = null;
  }

  const updateData: Partial<typeof claimsTable.$inferInsert> = {
    status: newStatus as any,
    outcome: newOutcome as any,
    ...extraFields,
  };
  if (closureReason !== undefined) updateData.closureReason = closureReason ?? null;
  if (closure) {
    updateData.closureCategory = closure.closureCategory;
    updateData.closureCategoryOther = closure.closureCategoryOther;
    updateData.closureRootCause = closure.closureRootCause;
    updateData.closureRootCauseOther = closure.closureRootCauseOther;
    updateData.closureNarrative = closure.closureNarrative;
    updateData.closureAccountabilityTags = closure.closureAccountabilityTags;
    updateData.closureAccountabilityOther = closure.closureAccountabilityOther;
    updateData.closureDrivers = closure.closureDrivers;
    updateData.closureDispatchers = closure.closureDispatchers;
    updateData.closureCommunicatedTo = closure.closureCommunicatedTo;
    if (closure.closureAddressedAt !== null) updateData.closureAddressedAt = closure.closureAddressedAt;
    if (closure.closureAddressedBy !== null) updateData.closureAddressedBy = closure.closureAddressedBy;
    if (closure.closureAddressedByEmail !== null) updateData.closureAddressedByEmail = closure.closureAddressedByEmail;
    if (closure.closureReviewNotes !== null) updateData.closureReviewNotes = closure.closureReviewNotes;
    updateData.closureReviewState = "pending";
  }

  const [claim] = await db.update(claimsTable).set(updateData).where(eq(claimsTable.id, claimId)).returning();

  const changes: string[] = [];
  if (old.status !== newStatus) changes.push(`status: ${old.status} → ${newStatus}`);
  if (old.outcome !== newOutcome) changes.push(`outcome: ${old.outcome} → ${newOutcome}`);
  const closureLabel = closureReason ? CLOSURE_REASON_LABELS[closureReason] : null;
  if (closureLabel) changes.push(`closure: ${closureLabel}`);
  const changeDesc = changes.length > 0 ? changes.join(", ") : "no change";

  await db.insert(auditLogsTable).values({
    claimId,
    action: "status_and_outcome_changed",
    details: `${changeDesc} — ${reason}`,
    metadata: {
      fromStatus: old.status, toStatus: newStatus,
      fromOutcome: old.outcome, toOutcome: newOutcome,
      source, reason,
      closureReason: closureReason ?? null,
      closureReasonLabel: closureLabel,
      ...(closure ? { closure: closureAuditPayload(closure) } : {}),
    },
    userEmail: actor.userEmail,
    userName: actor.userName,
  });

  await db.insert(notesTable).values({
    claimId,
    type: "status_change",
    content: `${changeDesc} — ${reason}`,
    author: actor.userName || actor.userEmail || source,
  });

  broadcastClaimEvent({
    type: "claim_updated",
    claimId,
    userName: actor.userName,
    userEmail: actor.userEmail,
    timestamp: new Date().toISOString(),
  });

  return { success: true, claim, previousStatus: old.status, previousOutcome: old.outcome };
}

export function getValidTransitions(status: string) {
  return {
    validStatuses: VALID_MANUAL_STATUS_TRANSITIONS[status] || [],
    validOutcomes: VALID_OUTCOME_BY_STATUS[status] || [],
  };
}

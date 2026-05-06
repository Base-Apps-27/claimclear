import { eq, and, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, auditLogsTable, notesTable, portalSubmissionsTable, portalResponsesTable, invoiceGroupsTable } from "@workspace/db";
import { CLOSURE_REASON_LABELS, type ClosureReason } from "@workspace/db";
import { broadcastClaimEvent } from "./sse";
import { closureAuditPayload, type NormalizedClosure } from "./closure-validation";
import { computeAttestationDelta, type AttestationGroupContext } from "./attestation";

// A "DB executor" is anything with the same select/update/insert surface as
// the top-level `db` handle. The drizzle transaction object passed to
// `db.transaction(async tx => ...)` is structurally compatible (it just
// lacks `$client` and a few pool-level helpers), so callers who want their
// work to participate in an outer transaction can pass `tx` here and every
// read/write inside the transition will join that tx.
export type DbExecutor = Pick<typeof db, "select" | "update" | "insert" | "delete">;

// Load the parent invoice group (just the attestation-relevant flag) for
// a leg that has one. Returns null when the leg is standalone — in that
// case computeAttestationDelta falls back to legacy "always pending"
// semantics so backward-compat tests keep working.
async function loadParentGroupForAttestation(
  invoiceGroupId: number | null,
  ex: DbExecutor,
): Promise<AttestationGroupContext | null> {
  if (invoiceGroupId == null) return null;
  const [g] = await ex
    .select({ reattestCompletedAt: invoiceGroupsTable.reattestCompletedAt })
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.id, invoiceGroupId));
  return g ?? null;
}

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
  "New": ["Needs Evidence", "Needs Review", "On Hold", "Expired", "Resolved", "Denied"],
  "Needs Review": ["New", "Needs Evidence", "On Hold", "Resolved", "Denied"],
  "Needs Evidence": ["Needs Review", "On Hold", "Expired", "Resolved", "Denied"],
  // Operator can drop a "Processed" leg back to Needs Evidence if they
  // realise they ran the worktree on the wrong basis, place it on
  // hold, or close it as resolved/denied. The actual flip into
  // Generating Email happens at the group level (operator clicks
  // "Ready to package"), not via a manual claim transition.
  "Processed": ["Needs Evidence", "On Hold", "Expired", "Resolved", "Denied"],
  "Portal Queued": [],
  "Generating Email": [],
  "Ready to Review": [],
  "Awaiting Response": ["Needs Review", "On Hold", "Resolved", "Denied"],
  "On Hold": ["New", "Needs Review", "Needs Evidence", "Expired"],
  // Expired reversible to the same New/Needs Review re-entry path
  // used by the other terminal statuses. See group-transitions.ts
  // for the parent-level semantics.
  "Expired": ["New", "Needs Review"],
  "Resolved": ["New", "Needs Review"],
  "Denied": ["New", "Needs Review"],
};

// Pre-submit claim statuses eligible for the nightly Expired sweep.
// Superset of GROUP_EXPIRABLE_STATUSES (adds Processed — a leg-only
// pre-submit status). Portal Queued is intentionally NOT here: a
// past-deadline Portal Queued row is "submitted but unconfirmed" and
// stays on the submittedStuck tier per Task #352 + the Expired-lane
// design decision.
export const CLAIM_EXPIRABLE_STATUSES = [
  "New",
  "Needs Evidence",
  "On Hold",
  "Generating Email",
  "Processed",
] as const;

const SYSTEM_CONTROLLED_STATUSES = ["Portal Queued", "Generating Email", "Ready to Review"];

const VALID_OUTCOME_BY_STATUS: Record<string, string[]> = {
  "New": ["Pending", "Withdrawn"],
  "Needs Review": ["Pending", "Withdrawn"],
  "Needs Evidence": ["Pending", "Withdrawn"],
  // "Processed" is a pre-filing status — same outcome envelope as the
  // other pre-submit statuses. No portal/email outcomes until the
  // dispute has actually been filed.
  "Processed": ["Pending", "Withdrawn"],
  "Portal Queued": [],
  "Generating Email": [],
  "Ready to Review": [],
  "Awaiting Response": ["Approved", "Partially Approved", "Denied", "Withdrawn"],
  "On Hold": [],
  // See group-transitions.ts: Expired keeps outcome=Pending so a
  // revert preserves the original outcome envelope.
  "Expired": ["Pending"],
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
    // Submissions are group-scoped post-cutover, so the "is a submission in
    // flight on this claim?" check has to look at the claim's invoice group.
    // Standalone legs (no group) can't have submissions and skip the guard.
    if (old.invoiceGroupId) {
      const activeSubmissions = await ex.select({ id: portalSubmissionsTable.id }).from(portalSubmissionsTable)
        .where(and(
          eq(portalSubmissionsTable.invoiceGroupId, old.invoiceGroupId),
          inArray(portalSubmissionsTable.status, ["pending", "in_progress"])
        ));
      if (activeSubmissions.length > 0) {
        throw new Error(`Cannot change status while a portal submission is in progress. Wait for the submission to complete or cancel it first.`);
      }
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
    toStatus: newStatus,
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
    if (old.invoiceGroupId) {
      const activeSubmissions = await db.select({ id: portalSubmissionsTable.id }).from(portalSubmissionsTable)
        .where(and(
          eq(portalSubmissionsTable.invoiceGroupId, old.invoiceGroupId),
          inArray(portalSubmissionsTable.status, ["pending", "in_progress"])
        ));
      if (activeSubmissions.length > 0) {
        throw new Error(`Cannot change outcome while a portal submission is in progress.`);
      }
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
        throw new Error(`Cannot mark this claim as Denied by Payor because no portal or email response has been recorded. Use "Withdraw — Cannot Dispute" instead.`);
      }
    }
    closureReason = "denied_by_payor";
  } else if (newOutcome === "Withdrawn") {
    if (closureReason !== "cannot_dispute") {
      throw new Error(`Withdrawn outcome requires a closureReason of "cannot_dispute".`);
    }
    if (!systemOverride && old.invoiceGroupId) {
      const submissionCount = await db.select({ id: portalSubmissionsTable.id })
        .from(portalSubmissionsTable)
        .where(eq(portalSubmissionsTable.invoiceGroupId, old.invoiceGroupId))
        .limit(1);
      if (submissionCount.length > 0) {
        throw new Error(`Cannot close as "Cannot Dispute" once this claim has been submitted to the payor. If the payor responded with a denial, mark it Denied by Payor instead.`);
      }
    }
  } else if (newOutcome === "Non-Issue") {
    if (!systemOverride && old.invoiceGroupId) {
      const submissionCount = await db.select({ id: portalSubmissionsTable.id })
        .from(portalSubmissionsTable)
        .where(eq(portalSubmissionsTable.invoiceGroupId, old.invoiceGroupId))
        .limit(1);
      if (submissionCount.length > 0) {
        throw new Error(`Cannot close as "Non-Issue" once this claim has been submitted to the payor. If the payor responded with a denial, mark it Denied by Payor instead.`);
      }
    }
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
  // Per Task #196 we now gate attestation auto-engagement on the parent
  // group's `reattest_completed_at`. Standalone legs (no parent group)
  // keep the legacy "outcome→Approved primes pending" behavior so the
  // existing #165 test fixtures still pass.
  const parentGroupForAtt = await loadParentGroupForAttestation(old.invoiceGroupId, db);
  Object.assign(updateData, computeAttestationDelta(old.outcome, newOutcome, parentGroupForAtt));
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
  systemOverride?: boolean;
}): Promise<TransitionResult> {
  const { claimId, newStatus, newOutcome, source, reason, actor, extraFields, closure, systemOverride = false } = opts;
  let { closureReason } = opts;

  const [old] = await db.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!old) throw new Error(`Claim ${claimId} not found`);

  if (!systemOverride) {
    if (old.invoiceGroupId) {
      const activeSubmissions = await db.select({ id: portalSubmissionsTable.id }).from(portalSubmissionsTable)
        .where(and(
          eq(portalSubmissionsTable.invoiceGroupId, old.invoiceGroupId),
          inArray(portalSubmissionsTable.status, ["pending", "in_progress"])
        ));
      if (activeSubmissions.length > 0) {
        throw new Error(`Cannot change status while a portal submission is in progress. Wait for the submission to complete or cancel it first.`);
      }
    }

    if (newStatus !== old.status) {
      if (SYSTEM_CONTROLLED_STATUSES.includes(newStatus)) {
        throw new Error(`"${newStatus}" is a system-controlled status and cannot be set manually.`);
      }

      const allowedStatuses = VALID_MANUAL_STATUS_TRANSITIONS[old.status] || [];
      if (!allowedStatuses.includes(newStatus)) {
        throw new Error(`Cannot transition from "${old.status}" to "${newStatus}". Valid transitions: ${allowedStatuses.length > 0 ? allowedStatuses.join(", ") : "none (status is system-controlled)"}`);
      }
    }

    const allowedOutcomes = VALID_OUTCOME_BY_STATUS[old.status] || [];
    if (!allowedOutcomes.includes(newOutcome)) {
      throw new Error(`Cannot set outcome to "${newOutcome}" when claim is in "${old.status}" status. ${allowedOutcomes.length > 0 ? `Valid outcomes: ${allowedOutcomes.join(", ")}` : "Outcome changes are not allowed in this status."}`);
    }
  }

  if (newOutcome === "Withdrawn") {
    if (closureReason !== "cannot_dispute") {
      throw new Error(`Withdrawn outcome requires a closureReason of "cannot_dispute".`);
    }
    if (!systemOverride && old.invoiceGroupId) {
      const submissionCount = await db.select({ id: portalSubmissionsTable.id })
        .from(portalSubmissionsTable)
        .where(eq(portalSubmissionsTable.invoiceGroupId, old.invoiceGroupId))
        .limit(1);
      if (submissionCount.length > 0) {
        throw new Error(`Cannot close as "Cannot Dispute" once this claim has been submitted to the payor. If the payor responded with a denial, mark it Denied by Payor instead.`);
      }
    }
  }
  if (newOutcome === "Denied") {
    if (!systemOverride) {
      const responseCount = await db.select({ id: portalResponsesTable.id })
        .from(portalResponsesTable)
        .where(eq(portalResponsesTable.claimId, claimId))
        .limit(1);
      if (responseCount.length === 0) {
        throw new Error(`Cannot mark this claim as Denied by Payor because no portal or email response has been recorded. Use "Withdraw — Cannot Dispute" instead.`);
      }
    }
    if (closureReason === undefined) closureReason = "denied_by_payor";
  }
  if (newOutcome === "Non-Issue") {
    if (!systemOverride && old.invoiceGroupId) {
      const submissionCount = await db.select({ id: portalSubmissionsTable.id })
        .from(portalSubmissionsTable)
        .where(eq(portalSubmissionsTable.invoiceGroupId, old.invoiceGroupId))
        .limit(1);
      if (submissionCount.length > 0) {
        throw new Error(`Cannot close as "Non-Issue" once this claim has been submitted to the payor. If the payor responded with a denial, mark it Denied by Payor instead.`);
      }
    }
    if (closureReason === undefined) closureReason = "non_issue";
  }
  if (newOutcome !== "Denied" && newOutcome !== "Withdrawn" && newOutcome !== "Non-Issue") {
    closureReason = null;
  }

  const updateData: Partial<typeof claimsTable.$inferInsert> = {
    status: newStatus as any,
    outcome: newOutcome as any,
    ...extraFields,
  };
  if (closureReason !== undefined) updateData.closureReason = closureReason ?? null;
  // Same Task #196 gate as transitionClaimOutcome — see note above.
  const parentGroupForAtt2 = await loadParentGroupForAttestation(old.invoiceGroupId, db);
  Object.assign(updateData, computeAttestationDelta(old.outcome, newOutcome, parentGroupForAtt2));
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

// --- Shared exclude-leg helper ----------------------------------------------
//
// Both the manual `POST /claims/:id/exclude` route handler and the
// auto-exclusion that runs when Needs Review → Needs Evidence promotes a
// group with blank-description sibling claims call into this function.
// Centralising it ensures both paths produce identical side effects:
// the leg row update, the `leg_excluded` audit row, the state event,
// the denormalized cache refresh, and the SSE broadcast all happen the
// same way regardless of who triggered the exclusion. Add a new caller?
// Reach for this helper rather than duplicating the writes.
export interface ExcludeLegParams {
  claimId: number;
  reason: string;
  note: string | null;
  source: string;
  actor: TransitionActor;
  // Pre-loaded leg row, so the helper doesn't re-read it. Auto-exclusion
  // already has the row in hand from the bulk select; the manual path
  // also loads it for the sub-status guard. Passing it through means we
  // avoid a redundant round-trip and also avoid a race against the
  // caller's own writes.
  leg: typeof claimsTable.$inferSelect;
  // True when the caller has already validated state and just wants the
  // helper to perform the writes. The manual route validates with the
  // legSubStatus === "needs_classification" guard before calling; the
  // auto path filters its candidate set with the same predicate before
  // looping. Set to false to have the helper enforce the guard itself.
  trustCallerStateGuard: boolean;
  ex?: DbExecutor;
  // Set by one-shot backfill callers (see Task #268 / scripts/src/
  // migrations/_backfill-audit.ts). When provided, the helper stamps
  // `metadata.backfillId = <id>` on the audit row so operators can slice
  // backfill-produced rows out of audit history with a single uniform
  // filter regardless of which backfill ran. Live callers (manual
  // exclude route, auto-after-classify path) leave this undefined and
  // the field is omitted from metadata as before.
  backfillId?: string;
}

export interface ExcludeLegResult {
  claim: typeof claimsTable.$inferSelect;
}

export async function excludeLegCore(params: ExcludeLegParams): Promise<ExcludeLegResult> {
  const { claimId, reason, note, source, actor, leg, ex, backfillId } = params;
  const executor = ex ?? db;

  // When the exclusion reason is "non_issue", also stamp
  // `sop_outcome = 'non_issue'` on the same row update. The invoice-level
  // outlook (Task #476, `deriveInvoiceDisputeOutlook`) treats a leg as a
  // re-attest survivor only when `sopOutcome === 'non_issue'`; without
  // this co-write, audit-reason and sop_outcome diverge and the outlook
  // gate misses the leg, falling through to the amber "Mark as closed"
  // CTA. The 2026-05-06 backfill healed 680 historical rows produced by
  // callers that bypassed sop_outcome (the 2026-05-01 retro and the
  // 2026-05-04 stranded-unclassified cleanup); this guard prevents the
  // class of bug from re-emerging through any future caller of the
  // helper. Conservative: only write sop_outcome when it's currently
  // null, so we never clobber an SOP-walk verdict that already landed
  // before exclusion.
  const setNonIssueSopOutcome = reason === "non_issue" && leg.sopOutcome == null;
  const updateSet: { includedInDispute: false; sopOutcome?: "non_issue" } = {
    includedInDispute: false,
  };
  if (setNonIssueSopOutcome) updateSet.sopOutcome = "non_issue";

  const [updated] = await executor
    .update(claimsTable)
    .set(updateSet)
    .where(and(eq(claimsTable.id, claimId), eq(claimsTable.includedInDispute, true)))
    .returning();

  // If `updated` is undefined the row was already excluded (or vanished).
  // Treat the no-op as success so callers in bulk paths don't have to
  // special-case it; we still return the leg row so the caller has
  // something coherent to work with.
  const claim = updated ?? leg;

  const metadata: Record<string, unknown> = {
    reason,
    note,
    source,
    previousSubStatus: "needs_classification",
  };
  if (setNonIssueSopOutcome) metadata.sopOutcomeCoWritten = "non_issue";
  if (backfillId !== undefined) metadata.backfillId = backfillId;

  await executor.insert(auditLogsTable).values({
    claimId,
    invoiceGroupId: leg.invoiceGroupId,
    action: "leg_excluded",
    details: `Leg excluded: ${reason}${note ? ` — ${note}` : ""}`,
    metadata,
    userEmail: actor.userEmail,
    userName: actor.userName,
  });

  return { claim };
}

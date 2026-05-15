import { eq, and, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, auditLogsTable, notesTable, portalSubmissionsTable, portalResponsesTable, invoiceGroupsTable } from "@workspace/db";
import { CLOSURE_REASON_LABELS, type ClosureReason } from "@workspace/db";
import { broadcastClaimEvent } from "./sse";
import { closureAuditPayload, type NormalizedClosure } from "./closure-validation";
import { computeAttestationDelta, type AttestationGroupContext } from "./attestation";
import { setClaimDisposition } from "./leg-state/set-claim-disposition";
import {
  getTerminalClosurePolicy,
  resolveTerminalOverride,
  isTerminalOutcome,
  isSystemControlledClosureBypass,
  NORMAL_LANE_SYSTEM_SOURCES,
  type TerminalOverride,
} from "./terminal-closure-policy";

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

// "Non-Issue" is a triage classification ("not really an error") emitted
// by the prod /triage route (routes/claims.ts) and by the closure intake
// dialog when reason="non_issue". It must be valid from any pre-submit
// status — otherwise the validator 400s on legitimate UI calls. Mirrors
// group-transitions.ts where "Non-Issue" is valid for the equivalent
// pre-submit group statuses.
const VALID_OUTCOME_BY_STATUS: Record<string, string[]> = {
  "New": ["Pending", "Withdrawn", "Non-Issue", "No Action Needed"],
  "Needs Review": ["Pending", "Withdrawn", "Non-Issue", "No Action Needed"],
  "Needs Evidence": ["Pending", "Withdrawn", "Non-Issue", "No Action Needed"],
  // "Processed" is a pre-filing status — same outcome envelope as the
  // other pre-submit statuses. No portal/email outcomes until the
  // dispute has actually been filed.
  "Processed": ["Pending", "Withdrawn", "Non-Issue", "No Action Needed"],
  "Portal Queued": [],
  "Generating Email": [],
  "Ready to Review": [],
  "Awaiting Response": ["Approved", "Partially Approved", "Denied", "Withdrawn"],
  "On Hold": [],
  // See group-transitions.ts: Expired keeps outcome=Pending so a
  // revert preserves the original outcome envelope.
  "Expired": ["Pending"],
  "Resolved": ["Approved", "Partially Approved", "Denied", "Non-Issue", "Withdrawn", "No Action Needed"],
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
  /**
   * Task #758 — terminal-closure override. When the source status's normal
   * outcome envelope doesn't include `newOutcome` AND the target is a
   * terminal outcome, the operator may supply an override reason
   * (≥TERMINAL_OVERRIDE_MIN_REASON chars) to record reality. The reason
   * is stamped into audit metadata and notes. See terminal-closure-policy.ts.
   */
  override?: TerminalOverride | null;
}): Promise<TransitionResult> {
  const { claimId, newOutcome, source, reason, actor, systemOverride = false, approvedAmount, invoiceNumbers, closure, override } = opts;
  let { closureReason } = opts;

  const [old] = await db.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!old) throw new Error(`Claim ${claimId} not found`);

  // Terminal-closure override resolution. When the target outcome is in
  // the terminal set, decide whether this is the normal lane or the
  // override lane and validate the override payload accordingly. The
  // result `overrideReason` (string|null) is what we stamp into audit
  // metadata; presence also unlocks bypassing the per-outcome guards
  // below (response-required, no-submission, etc.) — those are exactly
  // the rules the operator is explicitly choosing to bypass.
  let overrideReason: string | null = null;
  if (!systemOverride && isTerminalOutcome(newOutcome)) {
    const validOutcomes = VALID_OUTCOME_BY_STATUS[old.status] || [];
    const policy = getTerminalClosurePolicy(old.status, newOutcome, validOutcomes);
    overrideReason = resolveTerminalOverride(policy, old.status, newOutcome, override);
  }
  const overrideApplied = overrideReason !== null;
  const closureBypass =
    overrideApplied || isSystemControlledClosureBypass(old.status, newOutcome);

  if (!systemOverride) {
    // Task #758 review feedback: explicit terminal-closure override
    // bypasses the active-submission lock so stuck bot-owned legs
    // remain closable.
    if (!overrideApplied && old.invoiceGroupId) {
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
    if (!allowed.includes(newOutcome) && !closureBypass) {
      throw new Error(`Cannot set outcome to "${newOutcome}" when claim is in "${old.status}" status. ${allowed.length > 0 ? `Valid outcomes: ${allowed.join(", ")}` : "Outcome changes are not allowed in this status."}`);
    }
  }

  if (newOutcome === "Denied") {
    // Per Task #758 review feedback: the Denied response-required guard
    // is a per-outcome semantic invariant ("don't claim the payor denied
    // unless we have a recorded response"). Only an explicit operator
    // override (with reason ≥20 chars) is allowed to bypass it — the
    // system-controlled normal lane is NOT enough on its own.
    if (!systemOverride && !overrideApplied) {
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
    if (!systemOverride && !overrideApplied && old.invoiceGroupId) {
      const submissionCount = await db.select({ id: portalSubmissionsTable.id })
        .from(portalSubmissionsTable)
        .where(eq(portalSubmissionsTable.invoiceGroupId, old.invoiceGroupId))
        .limit(1);
      if (submissionCount.length > 0) {
        throw new Error(`Cannot close as "Cannot Dispute" once this claim has been submitted to the payor. If the payor responded with a denial, mark it Denied by Payor instead.`);
      }
    }
  } else if (newOutcome === "Non-Issue") {
    if (!systemOverride && !overrideApplied && old.invoiceGroupId) {
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
  const overrideAuditFragment = overrideApplied
    ? { override: { applied: true, sourceStatus: old.status, targetOutcome: newOutcome, reason: overrideReason } }
    : {};
  const overrideNoteFragment = overrideApplied
    ? ` — Override (from ${old.status}): ${overrideReason}`
    : "";
  await db.insert(auditLogsTable).values({
    claimId,
    action: "outcome_changed",
    details: `Outcome changed from ${old.outcome} to ${newOutcome}${closureLabel ? ` (${closureLabel})` : ""}${overrideApplied ? ` [override from ${old.status}]` : ""}`,
    metadata: {
      from: old.outcome,
      to: newOutcome,
      source,
      reason,
      approvedAmount,
      closureReason: closureReason ?? null,
      closureReasonLabel: closureLabel,
      ...(closure ? { closure: closureAuditPayload(closure) } : {}),
      ...overrideAuditFragment,
    },
    userEmail: actor.userEmail,
    userName: actor.userName,
  });

  await db.insert(notesTable).values({
    claimId,
    type: "outcome_recorded",
    content: `Outcome changed from ${old.outcome} to ${newOutcome}${closureLabel ? ` — ${closureLabel}` : ""}${approvedAmount ? ` (approved: $${approvedAmount})` : ""} — ${reason}${overrideNoteFragment}`,
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
  /** Task #758 — terminal-closure override. See transitionClaimOutcome. */
  override?: TerminalOverride | null;
}): Promise<TransitionResult> {
  const { claimId, newStatus, newOutcome, source, reason, actor, extraFields, closure, systemOverride = false, override } = opts;
  let { closureReason } = opts;

  const [old] = await db.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!old) throw new Error(`Claim ${claimId} not found`);

  // Terminal-closure override resolution. See transitionClaimOutcome
  // for the full rationale; same shape applies here. The override
  // bypasses the source-status outcome guard (and source-status
  // *transition* guard, since terminal closures are by definition
  // exit transitions to operator-resolved end states), and downgrades
  // the per-outcome guards (response required, no-submission) the
  // operator is explicitly choosing to overrule. The
  // SYSTEM_CONTROLLED_STATUSES *entry* guard stays — override is for
  // closing OUT of those statuses, not into them.
  // Task #758 — for combined status+outcome flips the "normal lane"
  // is whatever the writer's own status-transition + target-status
  // outcome envelope would already accept (mirrors the guards
  // immediately below); otherwise the closure runs on the override
  // lane (≥20-char reason). Earlier iterations only inspected the
  // source-status outcome envelope, which wrongly demanded override
  // on legitimate normal flips like Needs Review → Resolved/Approved.
  let overrideReason: string | null = null;
  if (!systemOverride && isTerminalOutcome(newOutcome)) {
    const statusNormallyAllowed =
      old.status === newStatus ||
      (VALID_MANUAL_STATUS_TRANSITIONS[old.status] || []).includes(newStatus);
    const outcomeNormallyAllowed =
      (VALID_OUTCOME_BY_STATUS[newStatus] || []).includes(newOutcome);
    const normalLaneAccepts =
      NORMAL_LANE_SYSTEM_SOURCES.has(old.status) ||
      (statusNormallyAllowed && outcomeNormallyAllowed);
    const policy = normalLaneAccepts ? "allowed-normally" : "allowed-with-override";
    overrideReason = resolveTerminalOverride(policy, old.status, newOutcome, override);
  }
  const overrideApplied = overrideReason !== null;
  const closureBypass =
    overrideApplied || isSystemControlledClosureBypass(old.status, newOutcome);

  if (!systemOverride) {
    // Task #758 review feedback: explicit terminal-closure override
    // bypasses the active-submission lock so stuck bot-owned legs
    // remain closable.
    if (!overrideApplied && old.invoiceGroupId) {
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
      if (!allowedStatuses.includes(newStatus) && !closureBypass) {
        throw new Error(`Cannot transition from "${old.status}" to "${newStatus}". Valid transitions: ${allowedStatuses.length > 0 ? allowedStatuses.join(", ") : "none (status is system-controlled)"}`);
      }
    }

    // Task #758 — outcome envelope is checked against the DESTINATION
    // status (mirrors group writer line ~854). The earlier source-status
    // form rejected legitimate normal flips like Needs Review →
    // Resolved/Approved even though Resolved → Approved is in envelope.
    const allowedOutcomes = VALID_OUTCOME_BY_STATUS[newStatus] || [];
    if (allowedOutcomes.length > 0 && !allowedOutcomes.includes(newOutcome) && !closureBypass) {
      throw new Error(`Cannot set outcome to "${newOutcome}" when claim is moving to "${newStatus}" status. Valid outcomes: ${allowedOutcomes.join(", ")}`);
    }
  }

  if (newOutcome === "Withdrawn") {
    if (closureReason !== "cannot_dispute") {
      throw new Error(`Withdrawn outcome requires a closureReason of "cannot_dispute".`);
    }
    if (!systemOverride && !overrideApplied && old.invoiceGroupId) {
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
    // See transitionClaimOutcome — Denied response-required guard is
    // a per-outcome semantic invariant; bypass requires explicit
    // operator override, NOT just the system-controlled normal lane.
    if (!systemOverride && !overrideApplied) {
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
    if (!systemOverride && !overrideApplied && old.invoiceGroupId) {
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
  // Task #714 — system-asserted "No Action Needed" mirrors the manual
  // Non-Issue branch. Pre-submit only (no Withdrawn-style escape after
  // submission), closureReason locked to 'non_issue'. Only the
  // auto-close cascade calls this with `systemOverride: true`; manual
  // operator paths continue to use "Non-Issue".
  if (newOutcome === "No Action Needed") {
    if (closureReason !== undefined && closureReason !== "non_issue") {
      throw new Error(`"No Action Needed" outcome requires closureReason "non_issue".`);
    }
    if (!systemOverride && !overrideApplied && old.invoiceGroupId) {
      const submissionCount = await db.select({ id: portalSubmissionsTable.id })
        .from(portalSubmissionsTable)
        .where(eq(portalSubmissionsTable.invoiceGroupId, old.invoiceGroupId))
        .limit(1);
      if (submissionCount.length > 0) {
        throw new Error(`Cannot land "No Action Needed" once this claim has been submitted to the payor.`);
      }
    }
    if (closureReason === undefined) closureReason = "non_issue";
  }
  if (
    newOutcome !== "Denied" &&
    newOutcome !== "Withdrawn" &&
    newOutcome !== "Non-Issue" &&
    newOutcome !== "No Action Needed"
  ) {
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

  const overrideAuditFragment2 = overrideApplied
    ? { override: { applied: true, sourceStatus: old.status, targetOutcome: newOutcome, reason: overrideReason } }
    : {};
  const overrideNoteFragment2 = overrideApplied
    ? ` — Override (from ${old.status}): ${overrideReason}`
    : "";
  await db.insert(auditLogsTable).values({
    claimId,
    action: "status_and_outcome_changed",
    details: `${changeDesc} — ${reason}${overrideApplied ? ` [override from ${old.status}]` : ""}`,
    metadata: {
      fromStatus: old.status, toStatus: newStatus,
      fromOutcome: old.outcome, toOutcome: newOutcome,
      source, reason,
      closureReason: closureReason ?? null,
      closureReasonLabel: closureLabel,
      ...(closure ? { closure: closureAuditPayload(closure) } : {}),
      ...overrideAuditFragment2,
    },
    userEmail: actor.userEmail,
    userName: actor.userName,
  });

  await db.insert(notesTable).values({
    claimId,
    type: "status_change",
    content: `${changeDesc} — ${reason}${overrideNoteFragment2}`,
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
  // Task #689 — when set, the helper writes this audit action key
  // instead of the default `leg_excluded`. Used by the
  // `handled_offline` reason path so the activity timeline renders a
  // distinct "Removed — handled offline" entry. Pass `undefined`
  // (the existing call shape) to keep the legacy `leg_excluded` key
  // for every other reason.
  auditAction?: string;
  // Task #689 — when set, prefixes the audit row's free-text
  // `details` column. Default behaviour ("Leg excluded: <reason>") is
  // unchanged; the handled-offline path overrides this so the
  // human-readable detail line matches the new audit action.
  auditDetailsPrefix?: string;
  // 2026-05-14 — when the manual /exclude route accepts a source
  // sub-status other than `needs_classification` (e.g. `investigating`,
  // after the route clears the leg's classification fields in the same
  // transaction), the audit row must record the *real* prior state so
  // the activity timeline / future undo paths can reason about where
  // the leg came from. Defaults to "needs_classification" to preserve
  // every existing call site's metadata exactly.
  previousSubStatus?: string;
}

export interface ExcludeLegResult {
  claim: typeof claimsTable.$inferSelect;
}

export async function excludeLegCore(params: ExcludeLegParams): Promise<ExcludeLegResult> {
  const { claimId, reason, note, source, actor, leg, ex, backfillId, auditAction, auditDetailsPrefix, previousSubStatus } = params;
  const executor = ex ?? db;

  // Wave D-PR2b: route through `setClaimDisposition` so the canonical
  // `disposition` column is stamped alongside the legacy mirrors in
  // one UPDATE. Disposition for an excluded leg is `disposed_nonissue`
  // regardless of reason — the deriver's triage branch returns it for
  // any `included_in_dispute = false` row whose `sop_outcome` is
  // currently null, and `excludeLegCore` is only ever called from the
  // `needs_classification` sub-status (manual exclude route + auto
  // exclusion after classification cascade), both of which run in
  // pre-submit / triage phases. See `derive-disposition.ts` line 78.
  //
  // Mirror policy:
  //   • `reason === "non_issue"` → `mirror: "derived"` so the writer
  //     co-writes `sop_outcome = 'non_issue'` (Task #476 contract).
  //     The writer's null-guard prevents clobbering an SOP-walk
  //     verdict that landed before exclusion.
  //   • Other reasons (e.g. `cannot_dispute`) → `mirror: "skip"` so
  //     `sop_outcome` stays null, matching the legacy code path's
  //     intentional non-co-write — `cannot_dispute` exclusion is an
  //     audit-reason signal, NOT an SOP verdict, and stamping
  //     `sop_outcome = 'non_issue'` here would falsely mark the leg
  //     as a re-attest survivor in `deriveInvoiceDisputeOutlook`.
  //
  // `onlyWhenIncluded` mirrors the previous predicate
  // (`included_in_dispute = true`) so a double-exclude is a no-op
  // and the existing row is returned unchanged.
  const setNonIssueSopOutcome = reason === "non_issue" && leg.sopOutcome == null;
  const claim = (await setClaimDisposition(claimId, "disposed_nonissue", {
    isTerminal: false,
    mirror: reason === "non_issue" ? "derived" : "skip",
    includedInDispute: false,
    onlyWhenIncluded: true,
    ex: executor,
  })) ?? leg;

  const metadata: Record<string, unknown> = {
    reason,
    note,
    source,
    previousSubStatus: previousSubStatus ?? "needs_classification",
  };
  if (setNonIssueSopOutcome) metadata.sopOutcomeCoWritten = "non_issue";
  if (backfillId !== undefined) metadata.backfillId = backfillId;

  const detailsPrefix = auditDetailsPrefix ?? `Leg excluded: ${reason}`;
  await executor.insert(auditLogsTable).values({
    claimId,
    invoiceGroupId: leg.invoiceGroupId,
    action: auditAction ?? "leg_excluded",
    details: `${detailsPrefix}${note ? ` — ${note}` : ""}`,
    metadata,
    userEmail: actor.userEmail,
    userName: actor.userName,
  });

  // Task #714 — auto-close cascade. Excluding a leg with reason='non_issue'
  // co-writes sop_outcome='non_issue' (see mirror policy above). When this
  // is the LAST disputed leg holding a pre-submit group open, the parent
  // group should auto-land at (Resolved, No Action Needed,
  // closure_reason='non_issue'). Hooking this in the shared writer (rather
  // than only in the manual /exclude route) ensures every entry point —
  // manual exclude, auto-after-classify cascade in group-transitions.ts,
  // future callers — gets the same cascade. Helper is idempotent: the
  // already-terminal short-circuit makes a redundant call against an
  // already-closed group a no-op.
  if (reason === "non_issue" && leg.invoiceGroupId != null) {
    // Deferred import: auto-close-non-issue.ts pulls in
    // group-transitions.ts which in turn imports excludeLegCore from
    // this file. A static import here would create a runtime ESM
    // cycle whose initialization order is fragile. Resolving the
    // module lazily at call time sidesteps the cycle entirely while
    // keeping the cascade synchronous within the writer's await chain.
    const { autoCloseGroupIfAllNonIssue } = await import("./auto-close-non-issue");
    await autoCloseGroupIfAllNonIssue(leg.invoiceGroupId, executor);
  }

  return { claim };
}

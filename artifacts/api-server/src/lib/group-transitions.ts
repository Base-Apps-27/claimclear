import { eq, and, or, ne, inArray, isNotNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { invoiceGroupsTable, claimsTable, auditLogsTable, notesTable, portalSubmissionsTable, portalResponsesTable } from "@workspace/db";
import { CLOSURE_REASON_LABELS, type ClosureReason } from "@workspace/db";
import { broadcastGroupEvent } from "./sse";
import { closureAuditPayload, type NormalizedClosure } from "./closure-validation";
import { excludeLegCore, type DbExecutor } from "./claim-transitions";
import { computeAttestationDelta, engageMasEligibleAttestationCascade } from "./attestation";
import { checkAndEmitDayCompleteForGroup, snapshotDayConcludedForGroup } from "./day-complete";

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
  // "MAS Eligible" is a destination from the three statuses where an
  // operator could realistically discover the MAS portal verdict —
  // straight from upload (New / Needs Review) or after a portal round
  // trip (Awaiting Response). It deliberately is NOT a destination
  // from Needs Evidence or On Hold; those have their own resolution
  // paths and reaching MAS Eligible from them would skip the
  // outstanding evidence / hold-reason housekeeping.
  //
  // "Expired" is offered as a manual destination from every pre-submit
  // status that the nightly sweep itself can stamp (see
  // GROUP_EXPIRABLE_STATUSES below) so an operator can pre-empt the
  // sweep on a row they already know is dead. The sweep uses
  // `systemOverride: true` so it can also stamp Generating Email
  // rows where the manual transition map omits the destination.
  "New": ["Needs Evidence", "Needs Review", "On Hold", "MAS Eligible", "Expired", "Resolved", "Denied"],
  "Needs Review": ["New", "Needs Evidence", "On Hold", "MAS Eligible", "Resolved", "Denied"],
  "Needs Evidence": ["Needs Review", "On Hold", "Expired", "Resolved", "Denied"],
  "Portal Queued": [],
  "Generating Email": [],
  "Ready to Review": [],
  "Awaiting Response": ["Needs Review", "On Hold", "MAS Eligible", "Resolved", "Denied"],
  "On Hold": ["New", "Needs Review", "Needs Evidence", "Expired"],
  // From MAS Eligible an operator can revert (mistake / re-triage) or
  // close the group as Resolved once the off-system MAS portal
  // re-attestation is complete. Going to Denied / Needs Evidence /
  // On Hold from here would muddy the post-verdict state — explicitly
  // omitted.
  "MAS Eligible": ["Needs Review", "Resolved"],
  // Expired is reversible — revert path mirrors Resolved/Denied so an
  // operator who retired a row in error can put it back into the
  // working set. The audit log row preserves the original pre-expiry
  // status (the transition writes from→to metadata).
  "Expired": ["New", "Needs Review"],
  "Resolved": ["New", "Needs Review"],
  "Denied": ["New", "Needs Review"],
};

// Pre-submit statuses whose past-deadline rows are eligible for the
// nightly Expired sweep. Mirror of the user-spec list — kept as a
// dedicated constant so the sweep, the dashboard "expirable" facet,
// and the transition map all reason about the same set. "Generating
// Email" is system-controlled (cannot be set manually) but the sweep
// passes `systemOverride: true` so it CAN flip those rows; a row
// stuck in Generating Email past its deadline is by definition a
// stalled draft that needs to be retired.
export const GROUP_EXPIRABLE_STATUSES = [
  "New",
  "Needs Evidence",
  "On Hold",
  "Generating Email",
] as const;

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
  // MAS Eligible carries an implicit positive verdict (carrier owes
  // money) but the formal outcome stays Pending until the operator
  // closes the group as Resolved with an explicit Approved /
  // Partially Approved decision. Keeping outcome=Pending here also
  // preserves the existing Approved/Partially-Approved attestation
  // trigger semantics (attestation here is engaged via the dedicated
  // MAS Eligible cascade in `engageMasEligibleAttestationCascade`).
  "MAS Eligible": ["Pending"],
  // Expired carries no resolution outcome — it's a "we missed the
  // window" terminal status. Outcome stays Pending so a future revert
  // back to New/Needs Review preserves the row's original outcome
  // envelope without forcing an outcome flip on the way out.
  "Expired": ["Pending"],
  "Resolved": ["Approved", "Partially Approved", "Denied", "Non-Issue", "Withdrawn"],
  "Denied": ["Denied", "Approved", "Partially Approved", "Withdrawn"],
};

const TERMINAL_STATUSES: string[] = ["Resolved", "Denied"];

async function checkActiveSubmissions(groupId: number, ex: DbExecutor): Promise<void> {
  const activeSubmissions = await ex.select().from(portalSubmissionsTable)
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
  extraChildFields: Partial<typeof claimsTable.$inferInsert> | undefined,
  ex: DbExecutor,
  source: string,
) {
  // Don't cascade On Hold to children — group-level holds pause the group's
  // own clock without forcing each leg into the per-leg hold flow (which has
  // its own reason / pending-from inputs).
  if (newStatus === "On Hold") return;

  // Cascade to *disputed* legs only. A leg is "disputed" iff it has an
  // error_type_id — that's how it got into the workflow in the first place.
  // Clean legs sit on the same invoice but were never part of any dispute, so
  // their status must not move when the group's status moves. The previous
  // implementation only fired on terminal statuses, which let mid-lifecycle
  // group transitions (Portal Queued, Awaiting Response, Ready to Review)
  // silently leave child status drifting from group status.
  const disputedChildren = await ex
    .select({
      id: claimsTable.id,
      status: claimsTable.status,
      outcome: claimsTable.outcome,
    })
    .from(claimsTable)
    .where(and(
      eq(claimsTable.invoiceGroupId, groupId),
      ne(claimsTable.status, "On Hold"),
      isNotNull(claimsTable.errorTypeId),
    ));

  if (disputedChildren.length === 0) return;

  const updateData: Partial<typeof claimsTable.$inferInsert> = {
    status: newStatus as ClaimStatus,
    ...(newOutcome ? { outcome: newOutcome as ClaimOutcome } : {}),
    ...extraChildFields,
  };

  // Held legs are intentionally excluded — they are tracked separately and
  // resolved on their own ticket once the hold is removed.
  await ex.update(claimsTable)
    .set(updateData)
    .where(and(
      eq(claimsTable.invoiceGroupId, groupId),
      ne(claimsTable.status, "On Hold"),
      isNotNull(claimsTable.errorTypeId),
    ));

  // Per-child audit rows so the claim timeline reflects what actually
  // happened ("Status changed from X to Y (cascaded from group)") instead
  // of leaving the operator to infer the cause from a sibling group event.
  const auditRows = disputedChildren
    .filter((c) => c.status !== newStatus || (newOutcome != null && c.outcome !== newOutcome))
    .map((c) => ({
      claimId: c.id,
      invoiceGroupId: groupId,
      action: "claim_status_changed",
      details: `Status changed from ${c.status} to ${newStatus} (cascaded from invoice group)`,
      metadata: {
        from: c.status,
        to: newStatus,
        previousOutcome: c.outcome,
        newOutcome: newOutcome ?? c.outcome,
        source: `group_cascade:${source}`,
        cascadedFromGroupId: groupId,
      },
      userEmail: actor.userEmail,
      userName: actor.userName,
    }));

  if (auditRows.length > 0) {
    await ex.insert(auditLogsTable).values(auditRows);
  }
}

// Auto-exclusion: at the Needs Review → Needs Evidence promotion, blank
// `errorDetails` legs that are still needs_classification are clearly
// "no-issue" siblings of the qualifying ones. Auto-exclude them so the
// operator doesn't have to hand-clear each blank row.
//
// Predicate (qualifying group): at least one sibling has non-empty
// errorDetails. If every leg is blank, do nothing — the operator must
// triage by hand. Idempotent: only flips legs whose includedInDispute is
// still true and whose errorDetails is empty.
async function autoExcludeBlankSiblingsOnPromote(
  groupId: number,
  oldStatus: string,
  newStatus: string,
  source: string,
  actor: GroupTransitionActor,
  ex: DbExecutor,
): Promise<void> {
  if (oldStatus !== "Needs Review" || newStatus !== "Needs Evidence") return;
  if (source !== "auto_after_classify") return;

  // Read full leg rows so we can hand them to excludeLegCore — that
  // helper uses the row to populate the audit log's invoiceGroupId and
  // skips the redundant re-read it would otherwise do.
  const allLegs = await ex
    .select()
    .from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, groupId));

  // Qualifying-group predicate — must have at least one sibling whose
  // errorDetails is non-empty (regardless of include status). If nothing
  // qualifies, skip the auto-exclude entirely (the all-blank case is
  // handled manually in the inbox).
  const hasQualifyingSibling = allLegs.some(
    (l) => typeof l.errorDetails === "string" && l.errorDetails.trim().length > 0,
  );
  if (!hasQualifyingSibling) return;

  // Target rows: still in dispute, no errorTypeId yet (so they're still
  // needs_classification), and blank errorDetails.
  const blankLegs = allLegs.filter(
    (l) =>
      l.includedInDispute === true &&
      (l.errorTypeId === null || l.errorTypeId === "") &&
      (l.errorDetails === null || (typeof l.errorDetails === "string" && l.errorDetails.trim() === "")),
  );
  if (blankLegs.length === 0) return;

  // Funnel every flip through the shared helper so the manual exclude
  // path and the auto-exclude path produce identical writes (row update +
  // audit row with the same metadata shape and reason vocabulary). The
  // only behavioural difference is the audit `details` text and the
  // `source` field — both are passed in.
  for (const l of blankLegs) {
    await excludeLegCore({
      claimId: l.id,
      reason: "non_issue",
      note: null,
      source: "auto_after_classify_sibling_clear",
      actor,
      leg: l,
      trustCallerStateGuard: true,
      ex,
    });
  }
}

// Safety net: when a group is being closed (Resolved / Denied / Expired)
// any leg that is still flagged `includedInDispute = true` but never
// received an `errorTypeId` is, by definition, going to be left in
// limbo — it'll keep showing up in the Classification Inbox forever
// even though its parent group is done. Auto-exclude those legs as
// `non_issue` so the inbox tracks reality.
//
// This complements `autoExcludeBlankSiblingsOnPromote`, which only
// fires on the Needs Review → Needs Evidence (auto_after_classify)
// path. It does not catch a group that goes straight from New (or any
// other pre-close state) to a terminal status without ever being
// classified, which is how the 80-group / 126-leg backlog observed in
// prod on 2026-05-04 piled up. Runs unconditionally on terminal
// transitions; the helper is idempotent (the row update is guarded by
// `includedInDispute = true`).
const TERMINAL_CLOSE_STATUSES_FOR_AUTOEXCLUDE: string[] = ["Resolved", "Denied", "Expired"];
async function autoExcludeUnclassifiedOnTerminalClose(
  groupId: number,
  oldStatus: string,
  newStatus: string,
  source: string,
  actor: GroupTransitionActor,
  ex: DbExecutor,
): Promise<void> {
  if (!TERMINAL_CLOSE_STATUSES_FOR_AUTOEXCLUDE.includes(newStatus)) return;
  // Re-entering a terminal state from another terminal state has nothing
  // new to clean up — skip the read.
  if (TERMINAL_CLOSE_STATUSES_FOR_AUTOEXCLUDE.includes(oldStatus)) return;

  const allLegs = await ex
    .select()
    .from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, groupId));

  const stranded = allLegs.filter(
    (l) =>
      l.includedInDispute === true &&
      (l.errorTypeId === null || l.errorTypeId === "") &&
      l.duplicateOfClaimId === null,
  );
  if (stranded.length === 0) return;

  for (const l of stranded) {
    await excludeLegCore({
      claimId: l.id,
      reason: "non_issue",
      note: null,
      source: `auto_on_terminal_close:${source}`,
      actor,
      leg: l,
      trustCallerStateGuard: true,
      ex,
    });
  }
}

async function ensureNoHeldLegsBeforeClosure(groupId: number, newStatus: string, ex: DbExecutor): Promise<void> {
  if (!TERMINAL_STATUSES.includes(newStatus)) return;
  const held = await ex.select({ id: claimsTable.id, confNumber: claimsTable.confNumber })
    .from(claimsTable)
    .where(and(
      eq(claimsTable.invoiceGroupId, groupId),
      eq(claimsTable.status, "On Hold"),
    ));
  if (held.length > 0) {
    const labels = held.map(h => h.confNumber || `claim ${h.id}`).join(", ");
    throw new Error(`Cannot close this invoice group while leg${held.length === 1 ? "" : "s"} ${labels} ${held.length === 1 ? "is" : "are"} on hold. Remove the hold and resolve ${held.length === 1 ? "it" : "them"} first, or withdraw the leg${held.length === 1 ? "" : "s"} individually.`);
  }
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
  /** See note on `transitionClaimStatus.executor`. */
  executor?: DbExecutor;
}): Promise<GroupTransitionResult> {
  const { groupId, newStatus, source, reason, actor, systemOverride = false, extraFields, childFields, executor } = opts;
  const ex: DbExecutor = executor ?? db;

  const [old] = await ex.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupId));
  if (!old) throw new Error(`Invoice group ${groupId} not found`);

  if (old.status === newStatus && !extraFields) {
    return { success: true, group: old, previousStatus: old.status, previousOutcome: old.outcome };
  }

  if (!systemOverride) {
    await checkActiveSubmissions(groupId, ex);
    await ensureNoHeldLegsBeforeClosure(groupId, newStatus, ex);

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

  // Task #495 — capture day-aggregate concluded state BEFORE the UPDATE
  // so the day-complete celebration can fire only on the false→true edge.
  const priorConcluded = await snapshotDayConcludedForGroup(groupId, ex);

  const [group] = await ex.update(invoiceGroupsTable).set(updateData).where(eq(invoiceGroupsTable.id, groupId)).returning();

  const statusChanged = old.status !== newStatus;
  if (statusChanged) {
    await ex.insert(auditLogsTable).values({
      invoiceGroupId: groupId,
      action: "group_status_changed",
      details: `Status changed from ${old.status} to ${newStatus}`,
      metadata: { from: old.status, to: newStatus, source, reason },
      userEmail: actor.userEmail,
      userName: actor.userName,
    });

    await ex.insert(notesTable).values({
      claimId: null,
      invoiceGroupId: groupId,
      type: "status_change",
      content: `Status changed from ${old.status} to ${newStatus} — ${reason}`,
      author: actor.userName || actor.userEmail || source,
    });

    await syncChildRides(groupId, newStatus, group.outcome, actor, childFields, ex, source);

    // MAS Eligible side-effect: stamp the group as re-attest-required
    // and engage attestation_state=pending on every disputed leg. This
    // is what bridges Phase 1 (the status) to the existing attestation
    // queue (which already lists pending+queued legs). Runs unconditionally
    // when the destination is MAS Eligible — the helper itself is
    // idempotent, so a no-op transition (already in MAS Eligible) does
    // nothing.
    if (newStatus === "MAS Eligible") {
      await engageMasEligibleAttestationCascade(groupId, ex);
    }

    // Auto-exclusion of blank no-issue siblings on the qualifying transition.
    // Runs in the same executor so it shares the caller's transaction (when
    // present) or commits with the row update otherwise.
    await autoExcludeBlankSiblingsOnPromote(groupId, old.status, newStatus, source, actor, ex);

    // Safety net for terminal closures: any leg still flagged as in-dispute
    // but never classified would otherwise be left dangling in the
    // Classification Inbox after the parent group is closed. See the
    // helper's comment for the prod incident this prevents.
    await autoExcludeUnclassifiedOnTerminalClose(groupId, old.status, newStatus, source, actor, ex);

    broadcastGroupEvent({
      type: "status_changed",
      invoiceGroupId: groupId,
      userName: actor.userName,
      userEmail: actor.userEmail,
      timestamp: new Date().toISOString(),
      // Carry the new status so the streak-pip listener can bump the
      // personal counter on Portal Queued transitions without having
      // to refetch the row.
      toStatus: newStatus,
    });

    // Day-complete celebration: re-check after every status change because
    // entering in-flight or closed can make the group's day fully concluded.
    // Task #495 — gated on the false→true edge by `priorConcluded` captured
    // before the UPDATE; the unique-index dedupe was dropped in 0033 so the
    // edge check is the sole guard against duplicate broadcasts.
    await checkAndEmitDayCompleteForGroup({ groupId, actor, priorConcluded, executor: ex });
  }

  return { success: true, group, previousStatus: old.status, previousOutcome: old.outcome };
}

export async function groupHasEverBeenSubmitted(groupId: number, executor?: DbExecutor): Promise<boolean> {
  // Submissions are now exclusively group-scoped (Task #199 cutover); the
  // legacy "linked-via-children" lookup that fanned out to claim ids is gone.
  const ex: DbExecutor = executor ?? db;
  const direct = await ex.select({ id: portalSubmissionsTable.id })
    .from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.invoiceGroupId, groupId))
    .limit(1);
  return direct.length > 0;
}

export async function groupHasResponse(groupId: number, executor?: DbExecutor): Promise<boolean> {
  const ex: DbExecutor = executor ?? db;
  const direct = await ex.select({ id: portalResponsesTable.id })
    .from(portalResponsesTable)
    .where(eq(portalResponsesTable.invoiceGroupId, groupId))
    .limit(1);
  if (direct.length > 0) return true;

  const childClaims = await ex.select({ id: claimsTable.id })
    .from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, groupId));
  if (childClaims.length === 0) return false;

  const linked = await ex.select({ id: portalResponsesTable.id })
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
  closure?: NormalizedClosure | null;
  systemOverride?: boolean;
  executor?: DbExecutor;
}): Promise<GroupTransitionResult> {
  const { groupId, newOutcome, source, reason, actor, approvedAmount, systemOverride = false, closure, executor } = opts;
  let { closureReason } = opts;
  const ex: DbExecutor = executor ?? db;

  const [old] = await ex.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupId));
  if (!old) throw new Error(`Invoice group ${groupId} not found`);

  await checkActiveSubmissions(groupId, ex);

  const allowed = VALID_GROUP_OUTCOME_BY_STATUS[old.status] || [];
  if (!allowed.includes(newOutcome)) {
    throw new Error(`Cannot set outcome to "${newOutcome}" when group is in "${old.status}" status. ${allowed.length > 0 ? `Valid outcomes: ${allowed.join(", ")}` : "Outcome changes are not allowed in this status."}`);
  }

  if (newOutcome === "Denied") {
    if (!systemOverride) {
      const has = await groupHasResponse(groupId, ex);
      if (!has) {
        throw new Error(`Cannot mark this invoice group as Denied by Payor because no portal or email response has been recorded. Use "Withdraw — Cannot Dispute" instead.`);
      }
    }
    closureReason = "denied_by_payor";
  } else if (newOutcome === "Withdrawn") {
    if (closureReason !== "cannot_dispute") {
      throw new Error(`Withdrawn outcome requires a closureReason of "cannot_dispute".`);
    }
    if (!systemOverride) {
      const submitted = await groupHasEverBeenSubmitted(groupId, ex);
      if (submitted) {
        throw new Error(`Cannot close as "Cannot Dispute" once this invoice group has been submitted to the payor. If the payor responded with a denial, mark it Denied by Payor instead.`);
      }
    }
  } else if (newOutcome === "Non-Issue") {
    if (!systemOverride) {
      const submitted = await groupHasEverBeenSubmitted(groupId, ex);
      if (submitted) {
        throw new Error(`Cannot close as "Non-Issue" once this invoice group has been submitted to the payor. If the payor responded with a denial, mark it Denied by Payor instead.`);
      }
    }
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

  // Task #495 — capture pre-update day-aggregate concluded state for
  // the day-complete edge check below.
  const priorConcluded = await snapshotDayConcludedForGroup(groupId, ex);

  const [group] = await ex.update(invoiceGroupsTable).set(updateData).where(eq(invoiceGroupsTable.id, groupId)).returning();

  // Cascade the attestation flip to all disputed children so the queue
  // counter and dashboard math stay in sync. The group itself does not
  // carry attestation state (the claim is the source of truth) but the
  // children inherit the outcome via syncChildRides on the next cascade.
  const childAttestation = computeAttestationDelta(old.outcome, newOutcome, old);
  if (Object.keys(childAttestation).length > 0) {
    await ex
      .update(claimsTable)
      .set(childAttestation)
      .where(and(
        eq(claimsTable.invoiceGroupId, groupId),
        ne(claimsTable.status, "On Hold"),
        isNotNull(claimsTable.errorTypeId),
      ));
  }

  const closureLabel = closureReason ? CLOSURE_REASON_LABELS[closureReason] : null;
  await ex.insert(auditLogsTable).values({
    invoiceGroupId: groupId,
    action: "group_outcome_changed",
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

  await ex.insert(notesTable).values({
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

  // Day-complete celebration: setting outcome to Non-Issue or Withdrawn
  // can be the final action that concludes the group's day. Task #495 —
  // gated on `priorConcluded` captured before the UPDATE.
  await checkAndEmitDayCompleteForGroup({ groupId, actor, priorConcluded, executor: ex });

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
  closure?: NormalizedClosure | null;
  executor?: DbExecutor;
}): Promise<GroupTransitionResult> {
  const { groupId, newStatus, newOutcome, source, reason, actor, systemOverride = false, extraFields, childFields, closure, executor } = opts;
  let { closureReason } = opts;
  const ex: DbExecutor = executor ?? db;

  const [old] = await ex.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupId));
  if (!old) throw new Error(`Invoice group ${groupId} not found`);

  if (!systemOverride) {
    await checkActiveSubmissions(groupId, ex);
    await ensureNoHeldLegsBeforeClosure(groupId, newStatus, ex);

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

  if (newOutcome === "Withdrawn") {
    if (closureReason !== "cannot_dispute") {
      throw new Error(`Withdrawn outcome requires a closureReason of "cannot_dispute".`);
    }
    if (!systemOverride) {
      const submitted = await groupHasEverBeenSubmitted(groupId, ex);
      if (submitted) {
        throw new Error(`Cannot close as "Cannot Dispute" once this invoice group has been submitted to the payor. If the payor responded with a denial, mark it Denied by Payor instead.`);
      }
    }
  }
  if (newOutcome === "Denied") {
    if (!systemOverride) {
      const has = await groupHasResponse(groupId, ex);
      if (!has) {
        throw new Error(`Cannot mark this invoice group as Denied by Payor because no portal or email response has been recorded. Use "Withdraw — Cannot Dispute" instead.`);
      }
    }
    if (closureReason === undefined) closureReason = "denied_by_payor";
  }
  if (newOutcome === "Non-Issue") {
    if (!systemOverride) {
      const submitted = await groupHasEverBeenSubmitted(groupId, ex);
      if (submitted) {
        throw new Error(`Cannot close as "Non-Issue" once this invoice group has been submitted to the payor. If the payor responded with a denial, mark it Denied by Payor instead.`);
      }
    }
    if (closureReason === undefined) closureReason = "non_issue";
  }
  if (newOutcome !== "Denied" && newOutcome !== "Withdrawn" && newOutcome !== "Non-Issue") {
    closureReason = null;
  }

  const updateData: Partial<typeof invoiceGroupsTable.$inferInsert> = {
    status: newStatus,
    outcome: newOutcome,
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
  applyHoldFields(updateData, old.status, newStatus, extraFields?.holdReason);

  // Task #495 — capture pre-update day-aggregate concluded state for
  // the day-complete edge check below.
  const priorConcluded = await snapshotDayConcludedForGroup(groupId, ex);

  const [group] = await ex.update(invoiceGroupsTable).set(updateData).where(eq(invoiceGroupsTable.id, groupId)).returning();

  // Cascade attestation flip to disputed children — see note in
  // transitionGroupOutcome.
  const childAttestation = computeAttestationDelta(old.outcome, newOutcome, old);
  if (Object.keys(childAttestation).length > 0) {
    await ex
      .update(claimsTable)
      .set(childAttestation)
      .where(and(
        eq(claimsTable.invoiceGroupId, groupId),
        ne(claimsTable.status, "On Hold"),
        isNotNull(claimsTable.errorTypeId),
      ));
  }

  const changes: string[] = [];
  if (old.status !== newStatus) changes.push(`status: ${old.status} → ${newStatus}`);
  if (old.outcome !== newOutcome) changes.push(`outcome: ${old.outcome} → ${newOutcome}`);
  const closureLabel = closureReason ? CLOSURE_REASON_LABELS[closureReason] : null;
  if (closureLabel) changes.push(`closure: ${closureLabel}`);
  const changeDesc = changes.length > 0 ? changes.join(", ") : "no change";

  await ex.insert(auditLogsTable).values({
    invoiceGroupId: groupId,
    action: "group_status_and_outcome_changed",
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

  await ex.insert(notesTable).values({
    claimId: null,
    invoiceGroupId: groupId,
    type: "status_change",
    content: `${changeDesc} — ${reason}`,
    author: actor.userName || actor.userEmail || source,
  });

  // Cascade closure detail to member legs so a Withdrawals Review reader can
  // see the same closure rationale on the child claim it sees on the group.
  // childFields takes precedence so callers can override.
  const closureChildFields: Partial<typeof claimsTable.$inferInsert> = {};
  if (closureReason !== undefined) closureChildFields.closureReason = closureReason ?? null;
  if (closure) {
    closureChildFields.closureCategory = closure.closureCategory;
    closureChildFields.closureCategoryOther = closure.closureCategoryOther;
    closureChildFields.closureRootCause = closure.closureRootCause;
    closureChildFields.closureRootCauseOther = closure.closureRootCauseOther;
    closureChildFields.closureNarrative = closure.closureNarrative;
    closureChildFields.closureAccountabilityTags = closure.closureAccountabilityTags;
    closureChildFields.closureAccountabilityOther = closure.closureAccountabilityOther;
    closureChildFields.closureDrivers = closure.closureDrivers;
    closureChildFields.closureDispatchers = closure.closureDispatchers;
    closureChildFields.closureCommunicatedTo = closure.closureCommunicatedTo;
    if (closure.closureAddressedAt !== null) closureChildFields.closureAddressedAt = closure.closureAddressedAt;
    if (closure.closureAddressedBy !== null) closureChildFields.closureAddressedBy = closure.closureAddressedBy;
    if (closure.closureAddressedByEmail !== null) closureChildFields.closureAddressedByEmail = closure.closureAddressedByEmail;
    if (closure.closureReviewNotes !== null) closureChildFields.closureReviewNotes = closure.closureReviewNotes;
    closureChildFields.closureReviewState = "pending";
  }
  await syncChildRides(groupId, newStatus, newOutcome, actor, { ...closureChildFields, ...childFields }, ex, source);

  // MAS Eligible side-effect (mirror of the same block in
  // `transitionGroupStatus` — combined transitions take this path
  // when a caller flips status+outcome together). See note there.
  if (newStatus === "MAS Eligible") {
    await engageMasEligibleAttestationCascade(groupId, ex);
  }

  broadcastGroupEvent({
    type: "status_changed",
    invoiceGroupId: groupId,
    userName: actor.userName,
    userEmail: actor.userEmail,
    timestamp: new Date().toISOString(),
  });

  // Day-complete celebration: combined status+outcome transitions are how
  // the closure path (Resolved / Denied / Withdrawn) commits, so this is
  // the most common terminal flip for the day-complete signal. Task #495 —
  // gated on `priorConcluded` captured before the UPDATE.
  await checkAndEmitDayCompleteForGroup({ groupId, actor, priorConcluded, executor: ex });

  return { success: true, group, previousStatus: old.status, previousOutcome: old.outcome };
}

export function getValidGroupTransitions(status: string) {
  return {
    validStatuses: VALID_GROUP_STATUS_TRANSITIONS[status] || [],
    validOutcomes: VALID_GROUP_OUTCOME_BY_STATUS[status] || [],
  };
}

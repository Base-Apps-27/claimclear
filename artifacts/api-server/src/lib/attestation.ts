// Shared helpers for the re-attestation tracking layered on top of the
// existing claim outcome flow. The state machine itself is enumerated in
// the schema (ATTESTATION_STATES); this module is just the "what fields
// move when an outcome flips to/away from Approved" logic so both the
// claim-level and group-level transition functions stay consistent.

import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db, claimsTable, invoiceGroupsTable } from "@workspace/db";
import type { DbExecutor } from "./claim-transitions";

export const APPROVED_OUTCOMES = new Set(["Approved", "Partially Approved"]);

export type AttestationDelta = Partial<typeof claimsTable.$inferInsert>;

/**
 * Per-Task #196: the trigger gate. The "outcome moving INTO
 * Approved/Partially Approved → set attestationState=pending" branch
 * only fires when the parent group has completed MAS re-attest. Before
 * that, the verdict is captured but attestation engagement waits.
 *
 * Pass either the parent group object (we read `reattestCompletedAt`)
 * or `null` when there is no parent (rare in the new model — every
 * disputed claim should have a parent invoice group). The flag
 * `requireGroupReattest` lets callers force the new gate even when the
 * group object isn't readily available.
 */
export interface AttestationGroupContext {
  reattestCompletedAt: typeof invoiceGroupsTable.$inferSelect["reattestCompletedAt"] | null;
}

/**
 * Compute the attestation-related field delta to apply when a claim's
 * outcome is changing.
 *
 * - Outcome moving INTO Approved/Partially Approved (from anything else)
 *   primes attestationState=pending **only** when the parent group's
 *   `reattest_completed_at` is set; otherwise the delta clears stale
 *   completion stamps but parks the state at `not_required`.
 * - Outcome moving OUT of Approved/Partially Approved (e.g., clawback)
 *   resets attestationState=not_required and wipes the stamps. The audit
 *   log retains the prior history.
 * - Outcome staying in/out of Approved produces no delta — we never
 *   re-stamp `pending` if the user is already mid-attestation, and we
 *   leave non-Approved rows untouched.
 *
 * Returns an empty object when nothing should change.
 */
export function computeAttestationDelta(
  oldOutcome: string | null | undefined,
  newOutcome: string,
  group?: AttestationGroupContext | null,
): AttestationDelta {
  const wasApproved = oldOutcome != null && APPROVED_OUTCOMES.has(oldOutcome);
  const willBeApproved = APPROVED_OUTCOMES.has(newOutcome);

  if (!wasApproved && willBeApproved) {
    // Trigger gate (Task #196): only engage attestation once the parent
    // group's MAS re-attest is complete. Two backward-compat exceptions:
    //   • `group === undefined` → caller didn't pass any group context;
    //     fall back to the legacy "engage immediately" behavior so older
    //     call sites and tests keep working.
    //   • `group === null` → the claim has no parent invoice group at all
    //     (standalone leg); engage immediately because there's no group
    //     to gate against.
    // Only when `group` is supplied AND the stamp is missing do we park
    // at `not_required`.
    const groupSupplied = group !== undefined;
    const groupExists = group != null;
    const reattestStamped = group != null && group.reattestCompletedAt != null;
    const shouldEngage = !groupSupplied || !groupExists || reattestStamped;
    return {
      attestationState: shouldEngage ? "pending" : "not_required",
      attestedAt: null,
      attestedBy: null,
      attestationNote: null,
      attestationQueuedAt: null,
      attestationQueuedBy: null,
    };
  }

  if (wasApproved && !willBeApproved) {
    return {
      attestationState: "not_required",
      attestedAt: null,
      attestedBy: null,
      attestationNote: null,
      attestationQueuedAt: null,
      attestationQueuedBy: null,
    };
  }

  return {};
}

/**
 * Side-effect cascade fired when an invoice group transitions INTO the
 * "MAS Eligible" status. Bridges the new MAS-Eligible status (Phase 1
 * of the post-upload triage bridge) to the existing attestation queue:
 *
 *   1. Stamp `invoice_groups.reattest_required = true` on the group.
 *      This flips the group's macro phase to `mas-action-required`
 *      (see `getGroupMacroPhase` in macro-phase.ts) so dashboards and
 *      group queries surface it correctly.
 *   2. Engage `claims.attestation_state = 'pending'` on every disputed
 *      (errorTypeId NOT NULL), non-held leg whose attestation_state is
 *      still `not_required`. The existing /attestation-queue page lists
 *      `pending` and `queued` rows, so once this cascade runs the legs
 *      appear in the queue without further plumbing.
 *
 * Idempotent: re-running the cascade against a group that's already
 * been MAS-Eligible flagged is a no-op (the group update only matches
 * `reattest_required = false`, the leg update only matches
 * `attestation_state = 'not_required'`). This means a no-op transition
 * (already MAS Eligible → MAS Eligible) does nothing, and a mistaken
 * re-trigger never clobbers an in-flight attestation that an operator
 * has already queued or completed.
 *
 * Held legs are deliberately excluded: a held leg has its own resume
 * flow which will re-evaluate attestation when it un-holds, and we
 * don't want a held leg to materialise in the attestation queue while
 * its hold reason is still open.
 */
export async function engageMasEligibleAttestationCascade(
  groupId: number,
  executor?: DbExecutor,
): Promise<void> {
  const ex: DbExecutor = executor ?? db;

  await ex
    .update(invoiceGroupsTable)
    .set({ reattestRequired: true })
    .where(and(
      eq(invoiceGroupsTable.id, groupId),
      eq(invoiceGroupsTable.reattestRequired, false),
    ));

  await ex
    .update(claimsTable)
    .set({ attestationState: "pending" })
    .where(and(
      eq(claimsTable.invoiceGroupId, groupId),
      isNotNull(claimsTable.errorTypeId),
      ne(claimsTable.status, "On Hold"),
      eq(claimsTable.attestationState, "not_required"),
    ));
}

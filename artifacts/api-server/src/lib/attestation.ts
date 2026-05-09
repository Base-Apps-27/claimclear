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
 * Group-context shape used by the attestation engagement gate. The
 * `reattestCompletedAt` field is the single source of truth for
 * whether the parent invoice group has cleared MAS re-attestation
 * (Task #196 / Task #561). Standalone legs (no parent group) pass
 * `null` here and bypass the gate per the legacy fixture contract.
 */
export interface AttestationGroupContext {
  reattestCompletedAt: typeof invoiceGroupsTable.$inferSelect["reattestCompletedAt"] | null;
}

/**
 * Compute the attestation-related field delta to apply when a claim's
 * outcome is changing.
 *
 * - Outcome moving INTO Approved/Partially Approved (from anything else)
 *   primes attestationState=pending IFF the parent invoice group has
 *   already cleared MAS re-attestation (`reattest_completed_at IS NOT
 *   NULL`). This is the Task #196 gate, restored 2026-05-09 by
 *   Task #561 in service of the invoice-first model: an Approved
 *   verdict on its own does not mean the leg is owed a portal
 *   re-attestation — it means the group is ready for the operator to
 *   record MAS re-attest, and the queue should only engage once that
 *   completion lands. The gate fires inside the
 *   `/invoice-groups/:id/reattest/complete` writer, which loops
 *   eligible legs and re-evaluates this delta with `reattestCompletedAt`
 *   freshly stamped. The stranded-leg problem the 2026-05-05 gate
 *   removal tried to fix is solved instead by the explicit per-leg
 *   engagement inside the reattest/complete tx (which now also writes
 *   audit + state-event rows so the engagement is observable).
 *
 *   Standalone legs (no parent group, `group=null`) keep the legacy
 *   "outcome→Approved primes pending" semantics so the existing
 *   #165 test fixtures continue to pass.
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
    // Task #561 — gate engagement on MAS re-attest having been recorded
    // for the parent group. Standalone legs (group omitted or null)
    // keep the legacy unconditional-engage behavior so the existing
    // standalone-claim test fixtures still hold. When a parent group
    // is supplied but has not yet stamped `reattest_completed_at`,
    // leave the attestation state untouched: the per-leg engagement
    // fires inside the `/invoice-groups/:id/reattest/complete` writer
    // once that timestamp lands.
    if (group != null && group.reattestCompletedAt == null) {
      return {};
    }
    return {
      attestationState: "pending",
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

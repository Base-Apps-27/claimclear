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
 * Group-context shape kept for caller compatibility: pre-2026-05 the
 * `reattestCompletedAt` field gated the engage-on-Approved cascade
 * (Task #196). That gate was removed after a 2026-05-05 prod audit
 * showed it was stranding Approved legs at `not_required` whenever
 * operators confirmed a verdict without immediately following up with
 * the bulk-queue click — see the function docstring below for the
 * full reasoning. The field is still accepted so existing call sites
 * compile, but it no longer influences the delta.
 */
export interface AttestationGroupContext {
  reattestCompletedAt: typeof invoiceGroupsTable.$inferSelect["reattestCompletedAt"] | null;
}

/**
 * Compute the attestation-related field delta to apply when a claim's
 * outcome is changing.
 *
 * - Outcome moving INTO Approved/Partially Approved (from anything else)
 *   primes attestationState=pending unconditionally so the leg appears
 *   in the Open re-attestation queue immediately. The historical
 *   Task #196 gate (only engage once `reattest_completed_at` is set)
 *   was removed 2026-05-05 after the prod audit found it was the root
 *   cause of stuck Approved legs: every fresh Approved verdict landed
 *   on a group with `reattest_completed_at IS NULL`, so the gate
 *   parked them at `not_required` and the queue page never surfaced
 *   them. Operators were expected to manually click the group-level
 *   bulk-queue button to recover, and that follow-up step was
 *   routinely missed (groups 17, 18, 53, 148 in prod had verdicts
 *   confirmed but no bulk-queue click). The bulk-queue endpoint
 *   stays available for the "park for a teammate with portal access"
 *   path (`pending → queued`); the change here just guarantees the
 *   leg is visible in the queue UI the moment its verdict lands.
 * - Outcome moving OUT of Approved/Partially Approved (e.g., clawback)
 *   resets attestationState=not_required and wipes the stamps. The audit
 *   log retains the prior history.
 * - Outcome staying in/out of Approved produces no delta — we never
 *   re-stamp `pending` if the user is already mid-attestation, and we
 *   leave non-Approved rows untouched.
 *
 * Returns an empty object when nothing should change. The optional
 * `group` parameter is preserved for caller compatibility but no
 * longer affects the result.
 */
export function computeAttestationDelta(
  oldOutcome: string | null | undefined,
  newOutcome: string,
  _group?: AttestationGroupContext | null,
): AttestationDelta {
  const wasApproved = oldOutcome != null && APPROVED_OUTCOMES.has(oldOutcome);
  const willBeApproved = APPROVED_OUTCOMES.has(newOutcome);

  if (!wasApproved && willBeApproved) {
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

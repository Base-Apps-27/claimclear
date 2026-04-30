// Shared helpers for the re-attestation tracking layered on top of the
// existing claim outcome flow. The state machine itself is enumerated in
// the schema (ATTESTATION_STATES); this module is just the "what fields
// move when an outcome flips to/away from Approved" logic so both the
// claim-level and group-level transition functions stay consistent.

import { claimsTable } from "@workspace/db";

export const APPROVED_OUTCOMES = new Set(["Approved", "Partially Approved"]);

export type AttestationDelta = Partial<typeof claimsTable.$inferInsert>;

/**
 * Compute the attestation-related field delta to apply when a claim's
 * outcome is changing.
 *
 * - Outcome moving INTO Approved/Partially Approved (from anything else)
 *   primes attestationState=pending and clears any stale completion
 *   stamps from a prior attestation cycle.
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

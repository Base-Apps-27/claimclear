// Task #893 / #895 — single source of truth for the "open
// attestation" counter, shared by both the ClaimClear client
// (sidebar badge, header pill, Open tab badge, Queue section
// subhead) and the api-server's parity test for /attestation/counts.
//
// The Attestation Queue page renders one row per invoice group
// (Task #430), so distinct `invoice_group_id` values across the
// pending + queued attestation lists is the unit every counter
// agrees on. Legs missing an `invoice_group_id` each count as their
// own bucket (matching the QueueWorkspace's `c:${claim-id}` fallback
// key) so a row never goes uncounted.
//
// Structural typing keeps this lib dependency-free: any payload with
// `claims: Array<{ id, invoiceGroupId }>` works, which is what both
// /api/claims/attestation-pending and the React Query hook return.

export interface AttestationCountsClaim {
  id: number;
  invoiceGroupId?: number | null;
}

export interface AttestationCountsPayload {
  claims?: ReadonlyArray<AttestationCountsClaim>;
}

export function countDistinctAttestationGroups(
  payloads: ReadonlyArray<AttestationCountsPayload | undefined | null>,
): number {
  const seen = new Set<string>();
  for (const payload of payloads) {
    for (const claim of payload?.claims ?? []) {
      const key =
        claim.invoiceGroupId != null
          ? `g:${claim.invoiceGroupId}`
          : `c:${claim.id}`;
      seen.add(key);
    }
  }
  return seen.size;
}

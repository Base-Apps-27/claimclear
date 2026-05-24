import type { ListAttestationPending200 } from "@workspace/api-client-react";

// Task #893 — single source of truth for the "open attestation"
// counter. The Attestation Queue page renders one row per invoice
// group (Task #430), so the sidebar badge, the header pill, the Open
// tab badge and the in-page Queue section header all share this
// helper: distinct `invoice_group_id` values across the pending +
// queued attestation lists. Legs missing an `invoice_group_id` each
// count as their own bucket (matching the QueueWorkspace's
// `c:${claim-id}` fallback key) so a row never goes uncounted.
export function countDistinctAttestationGroups(
  payloads: ReadonlyArray<ListAttestationPending200 | undefined>,
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

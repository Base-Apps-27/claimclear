// Task #660 — Single source of truth for queue-deep-link CTA URLs
// emitted by the API server (operator daily brief, future email
// templates, in-app notifications).
//
// The URL contract — `/queue?group=<id>[&leg=<legId>]` — is shared
// with the front-end's `artifacts/claimclear/src/lib/queue-cta.ts`.
// Both are pure functions so the contract is unit-testable on
// either side without mounting the queue.

export function queueGroupHref(invoiceGroupId: number): string {
  return `/queue?group=${invoiceGroupId}`;
}

export function queueLegHref(invoiceGroupId: number, claimId: number): string {
  return `/queue?group=${invoiceGroupId}&leg=${claimId}`;
}

// Task #660 — Single source of truth for queue-deep-link CTA URLs.
//
// Every walk/submit-flavored CTA in the ClaimClear UI builds its
// destination through these helpers so the URL contract
// (`/queue?group=<id>[&leg=<legId>]`) cannot drift across surfaces.
// The helpers are intentionally tiny pure functions so they are
// trivially unit-testable (see `queue-cta.test.ts`).

export function queueGroupHref(invoiceGroupId: number): string {
  return `/queue?group=${invoiceGroupId}`;
}

export function queueLegHref(invoiceGroupId: number, claimId: number): string {
  return `/queue?group=${invoiceGroupId}&leg=${claimId}`;
}

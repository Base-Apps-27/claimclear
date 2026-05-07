// "Is this row open?" predicate — the canonical TS counterpart to the
// `is_open` GENERATED column added on `claims` and `invoice_groups` in
// migration 0036. See `docs/architecture/state-wave-d-handoff.md` §6.1
// for the rationale (we delegate the invariant to Postgres so writers
// never have to remember to refresh a mirror).
//
// LOCKSTEP CONTRACT (change one, change ALL THREE):
//   1. The `OPEN_STATUSES` constant below.
//   2. The `status IN (…)` list in `lib/db/migrations/
//      0036_invoice_groups_and_claims_is_open.sql`.
//   3. The legacy `OPEN_STATUSES` arrays in
//      `artifacts/api-server/src/lib/brief-personalization.ts` and
//      `artifacts/api-server/src/routes/dashboard.ts` (kept until
//      Wave D-PR3 collapses every reader onto `is_open`).
//
// The conformance audit (`scripts/src/check-invoice-state-derivation.ts`)
// asserts the stored `is_open` column equals `isClaimOpen()` /
// `isInvoiceGroupOpen()` for every prod row, so any drift between the
// three lists fails CI.
//
// Both helpers accept the same shape (just `status`) on purpose — the
// `claims` and `invoice_groups` openness rule is identical today. They
// stay distinct functions so a future divergence (e.g. groups gaining
// a non-`status`-dependent openness criterion) doesn't have to thread
// through every callsite.

export const OPEN_STATUSES = [
  "New",
  "Needs Evidence",
  "Processed",
  "Portal Queued",
  "Generating Email",
  "Ready to Review",
  "Awaiting Response",
  "On Hold",
] as const;
export type OpenStatus = (typeof OPEN_STATUSES)[number];

const OPEN_STATUS_SET: ReadonlySet<string> = new Set<string>(OPEN_STATUSES);

/** True iff `claim.status` belongs to `OPEN_STATUSES`. Pure, no DB. */
export function isClaimOpen(row: { status: string }): boolean {
  return OPEN_STATUS_SET.has(row.status);
}

/** True iff `invoice_group.status` belongs to `OPEN_STATUSES`. Pure, no DB. */
export function isInvoiceGroupOpen(row: { status: string }): boolean {
  return OPEN_STATUS_SET.has(row.status);
}

// Role-based access helpers for the three-tier role model.
//
// Roles:
//   admin — superuser; manages users, edits configuration, runs every action.
//   user  — operator; processes claims, runs bulk actions, sees money.
//   clerk — restricted operator; per-claim work only. No money values, no
//           configuration, no bulk actions, no setup pages, no exports.
//
// `requireAuth` keeps accepting clerks (they are still authenticated +
// approved); `requireAdmin` keeps rejecting them (they are not admin).
// The `denyClerk` middleware is for the bulk-action and setup endpoints
// that allow `user` but not `clerk`. Use `canSeeAmounts` /
// `dropAmountFiltersForUser` / `scrubMoneyFromClaim` etc. inside route
// handlers to shape responses for clerks.
import type { AuthUser } from "@workspace/api-zod";

export type Role = "admin" | "user" | "clerk";

export function isClerk(user: { role?: string | null } | null | undefined): boolean {
  return user?.role === "clerk";
}

export function isAdmin(user: { role?: string | null } | null | undefined): boolean {
  return user?.role === "admin";
}

// Money visibility: admins and users see all dollar amounts; clerks do not.
export function canSeeAmounts(user: { role?: string | null } | null | undefined): boolean {
  return !isClerk(user);
}

// Bulk actions (CSV exports, multi-record updates, batch submit, import):
// admins + users only. Clerks do per-claim work one at a time.
export function canDoBulk(user: { role?: string | null } | null | undefined): boolean {
  return !isClerk(user);
}

// Setup writes (error types, app settings, admin tools): admins + users.
// Clerks may still need read access for labels (e.g. error type names),
// but they cannot mutate any of these surfaces.
export function canEditSetup(user: { role?: string | null } | null | undefined): boolean {
  return !isClerk(user);
}

// ── Money scrubbers ─────────────────────────────────────────────────────
// Single source of truth for which fields are "money" — shared with the
// route handlers below so future endpoints opt in by calling the helper
// rather than remembering individual field names.
const MONEY_FIELDS = [
  "claimAmount",
  "approvedAmount",
  "totalAmount",
] as const;

export function scrubMoneyFields<T extends Record<string, unknown>>(
  row: T,
  user: { role?: string | null } | null | undefined,
): T {
  if (canSeeAmounts(user)) return row;
  const next = { ...row } as Record<string, unknown>;
  for (const f of MONEY_FIELDS) {
    if (f in next) next[f] = null;
  }
  return next as T;
}

export function scrubMoneyFieldsArray<T extends Record<string, unknown>>(
  rows: T[],
  user: { role?: string | null } | null | undefined,
): T[] {
  if (canSeeAmounts(user)) return rows;
  return rows.map(r => scrubMoneyFields(r, user));
}

// Dashboard exposure totals — distinct from the per-row money fields
// above because the keys differ (`atRiskExposure` etc. instead of
// `claimAmount`). Nulls everything in the `amounts` block for clerks.
const DASHBOARD_AMOUNT_FIELDS = [
  "totalClaimed",
  "totalApproved",
  "totalExposure",
  "totalLost",
  "atRiskClaim",
  "atRiskExposure",
  "lostExpiredClaim",
  "lostExpiredExposure",
  "lostDeniedClaim",
  "lostDeniedExposure",
  "lostExposureTotal",
  "reclaimedApproved",
  // Task #720 canonical 7d block. `recoveryRate` is a unitless integer,
  // not money — clerks already see no money fields, so without the rate
  // they have no denominator and the rate becomes a useless leak. Null
  // it for clerks alongside the dollar fields.
  "disputedAmount",
  "recoveredAmount",
  "confirmedRecoveredAmount",
  "priorRecoveredAmount",
  "netChangeRecovered",
  "recoveryRate",
] as const;

export function scrubDashboardAmounts<T extends Record<string, unknown>>(
  amounts: T,
  user: { role?: string | null } | null | undefined,
): T {
  if (canSeeAmounts(user)) return amounts;
  const next = { ...amounts } as Record<string, unknown>;
  for (const f of DASHBOARD_AMOUNT_FIELDS) {
    if (f in next) next[f] = null;
  }
  return next as T;
}

// Strips amountMin / amountMax from a request query for clerks so the
// where-builder cannot leak existence-of-amount information through
// filter results. Mutates and returns the same object.
export function dropAmountFiltersForUser(
  query: Record<string, unknown>,
  user: { role?: string | null } | null | undefined,
): Record<string, unknown> {
  if (canSeeAmounts(user)) return query;
  delete query.amountMin;
  delete query.amountMax;
  return query;
}

// Re-exports for convenience so callers don't need a second import.
export type { AuthUser };

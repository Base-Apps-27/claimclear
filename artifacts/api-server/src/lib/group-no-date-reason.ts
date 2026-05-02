// Why a group has no service date — a labeled enum that replaces the
// silent em-dash the Invoice Groups list used to render whenever
// `invoice_groups.service_date` came back null. See Task #353.
//
// The enum is the contract shared by:
//   • the list endpoint (one value per row, embedded in the response)
//   • the detail endpoint (one value at the top of the group payload)
//   • the React `<ServiceDateCell />` (label + action link per branch)
//
// The pure helper below takes the stored service date plus the group's
// children and classifies. Keeping it pure means the unit tests can
// exercise every branch — including `all_dated_legs_excluded` — without
// touching the database.
//
// Branch precedence
// -----------------
//   has_date                 → service_date column already non-null
//   no_claims                → no children at all
//   no_dated_claims          → children exist but every `date` is blank
//   parse_failed             → children have date strings but none parse
//                              (effectively unreachable now that
//                              `claims.date` is a typed DATE column —
//                              kept so the enum stays self-explanatory
//                              if a regression ever brings TEXT back)
//   all_dated_legs_excluded  → children have parseable dates but every
//                              dated leg is excluded or sibling-duplicate
//                              (operator-actionable: include or attach a
//                              fresh dated leg)
//
// `all_dated_legs_excluded` is special because the live MIN semantics
// (lib/group-service-date.ts) include excluded + duplicate legs, so a
// group in this shape will usually have a non-null `service_date`. We
// still surface the reason on every row when `service_date` happens to
// be null, and the helper is callable independently so the detail page
// can offer the same labeled hint when desired.

import { normalizeServiceDate } from "./dates";

export const GROUP_SERVICE_DATE_REASONS = [
  "has_date",
  "no_claims",
  "no_dated_claims",
  "parse_failed",
  "all_dated_legs_excluded",
] as const;

export type GroupServiceDateReason = (typeof GROUP_SERVICE_DATE_REASONS)[number];

/**
 * The minimal leg shape the classifier needs. Field names match the
 * `claims` columns so callers can spread a row directly.
 */
export interface ServiceDateReasonLeg {
  date: string | null;
  includedInDispute?: boolean | null;
  duplicateOfClaimId?: number | null;
}

function isParseable(date: string | null | undefined): boolean {
  return normalizeServiceDate(date) !== null;
}

function isExcludedOrDuplicate(leg: ServiceDateReasonLeg): boolean {
  if (leg.includedInDispute === false) return true;
  if (leg.duplicateOfClaimId != null) return true;
  return false;
}

function hasDateString(date: string | null | undefined): boolean {
  return typeof date === "string" && date.trim().length > 0;
}

/**
 * Pure classifier for the Service Date column / detail-page banner.
 *
 * `serviceDate` is the value already stored on `invoice_groups`. When
 * it's non-null we short-circuit to `has_date` regardless of leg state
 * — the row has a real date to render and that's the answer.
 *
 * Otherwise we walk the legs and pick the most specific empty-state.
 */
export function classifyGroupServiceDateReason(
  serviceDate: string | null | undefined,
  legs: ReadonlyArray<ServiceDateReasonLeg>,
): GroupServiceDateReason {
  if (serviceDate != null && String(serviceDate).length > 0) {
    return "has_date";
  }
  if (legs.length === 0) return "no_claims";

  const datedLegs = legs.filter((l) => hasDateString(l.date));
  if (datedLegs.length === 0) return "no_dated_claims";

  const parseableLegs = datedLegs.filter((l) => isParseable(l.date));
  if (parseableLegs.length === 0) return "parse_failed";

  const activeParseable = parseableLegs.filter(
    (l) => !isExcludedOrDuplicate(l),
  );
  if (activeParseable.length === 0) return "all_dated_legs_excluded";

  // Every empty branch above is exhaustive: if `service_date` is null but
  // we have at least one dated, parseable, non-excluded leg, the recompute
  // helper would have written a value. The only way to land here is a
  // drift where the stored column is stale; classify as no_dated_claims
  // so the operator at least gets a meaningful nudge instead of a dash.
  return "no_dated_claims";
}

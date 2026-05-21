// Task #753 — Pure URL→server-query bridge for the verdict-pending
// list on the Responses Awaiting Review page. Extracted into its own
// module so the frontend filter test can pin the contract without
// pulling in the full page (which transitively imports React hooks,
// the API client, and replit-auth — none of which the helpers need).

// Task #813 — the two "hidden from this view" chips on the Responses
// Awaiting Review header double as inline view toggles. When one of
// these bucket names is active the list query switches from the
// default verdict-pending cohort to that bucket's predicate (shared
// SQL with `/responses/awaiting-review/hidden-counts` so the chip
// count and the visible list always agree).
export const HIDDEN_BUCKET_VALUES = [
  "awaitingPayorAgain",
  "acknowledgmentOnly",
] as const;
export type HiddenBucket = typeof HIDDEN_BUCKET_VALUES[number];

export function parseHiddenBucket(raw: string | null | undefined): HiddenBucket | null {
  if (!raw) return null;
  return (HIDDEN_BUCKET_VALUES as readonly string[]).includes(raw)
    ? (raw as HiddenBucket)
    : null;
}

export interface VerdictPendingFilterState {
  q: string | null;
  statuses: string[];
  responseTypes: string[];
  errorTypeIds: string[];
  clientNumbers: string[];
  serviceDateFrom: string | null;
  serviceDateTo: string | null;
  responseReceivedFrom: string | null;
  responseReceivedTo: string | null;
  /** Task #813 — when set, the list query is swapped for the matching
   *  hidden-bucket predicate so operators can review those items in
   *  place. `null` keeps the default awaiting-review cohort. */
  hiddenBucket: HiddenBucket | null;
}

export function buildVerdictPendingQuery(s: VerdictPendingFilterState) {
  // Task #813 — when a hidden bucket is active, the cohort changes:
  // the default `macroPhase=response-pending + errorTypeAssigned`
  // predicate is replaced by `inboxHiddenBucket=<bucket>`. Free-text
  // search still threads through so operators can narrow within the
  // bucket; the other facet filters target columns the bucketed list
  // doesn't surface (status, response type, …) so we drop them rather
  // than silently filter to nothing.
  if (s.hiddenBucket) {
    return {
      inboxHiddenBucket: s.hiddenBucket,
      limit: 500,
      ...(s.q ? { q: s.q } : {}),
    };
  }
  return {
    macroPhase: "response-pending" as const,
    limit: 500,
    includeExpired: true,
    errorTypeAssigned: true,
    ...(s.q ? { q: s.q } : {}),
    ...(s.statuses.length ? { status: s.statuses.join(",") } : {}),
    ...(s.responseTypes.length ? { responseType: s.responseTypes.join(",") } : {}),
    ...(s.errorTypeIds.length ? { errorTypeId: s.errorTypeIds.join(",") } : {}),
    ...(s.clientNumbers.length ? { clientNumber: s.clientNumbers.join(",") } : {}),
    ...(s.serviceDateFrom ? { serviceDateFrom: s.serviceDateFrom } : {}),
    ...(s.serviceDateTo ? { serviceDateTo: s.serviceDateTo } : {}),
    ...(s.responseReceivedFrom ? { responseReceivedFrom: s.responseReceivedFrom } : {}),
    ...(s.responseReceivedTo ? { responseReceivedTo: s.responseReceivedTo } : {}),
  };
}

export function hasActiveVerdictPendingFilters(s: VerdictPendingFilterState): boolean {
  return (
    !!s.q ||
    s.statuses.length > 0 ||
    s.responseTypes.length > 0 ||
    s.errorTypeIds.length > 0 ||
    s.clientNumbers.length > 0 ||
    !!s.serviceDateFrom ||
    !!s.serviceDateTo ||
    !!s.responseReceivedFrom ||
    !!s.responseReceivedTo
  );
}

// Task #753 — Allowed values for the Status facet on Responses Awaiting
// Review. MUST be a strict subset of the canonical `claim_status` pgEnum
// (lib/db/src/schema/claims.ts). The page only ever serves rows in
// `macroPhase=response-pending` + `errorTypeAssigned`, so values from
// the enum that can't appear in that bucket (e.g. "New", "Processed",
// "MAS Eligible", "Expired", "Generating Email", "Portal Queued",
// "Ready to Review", "Needs Evidence") are intentionally absent — they'd
// be dead checkboxes that never narrow the list.
//
// A frontend test pins this against `CLAIM_STATUS_ENUM_VALUES` so we
// fail loudly if either side drifts.
export const VERDICT_PENDING_STATUS_FILTER_VALUES = [
  "Awaiting Response",
  "Needs Review",
  "On Hold",
  "Resolved",
  "Denied",
] as const;

// Task #753 — Allowed values for the Response type facet. MUST match the
// `responseType` enum in the OpenAPI spec
// (lib/api-spec/openapi.yaml — ResponsePayload.responseType) and the
// SQL allowlist in `buildInvoiceGroupWhere`.
export const VERDICT_PENDING_RESPONSE_TYPE_FILTER_VALUES = [
  "approval",
  "denial",
  "partial_approval",
  "info_request",
  "acknowledgment",
  "other",
] as const;

// Mirror of the `claim_status` pgEnum (lib/db/src/schema/claims.ts).
// Kept here as a const-tuple so the frontend filter test can assert
// `VERDICT_PENDING_STATUS_FILTER_VALUES ⊂ CLAIM_STATUS_ENUM_VALUES`
// without dragging the server-only `@workspace/db` package into the
// frontend bundle. If the canonical enum changes, this list MUST be
// updated in lockstep.
export const CLAIM_STATUS_ENUM_VALUES = [
  "New", "Needs Review", "Needs Evidence", "Processed", "Portal Queued",
  "Generating Email", "Ready to Review", "Awaiting Response", "On Hold",
  "MAS Eligible", "Expired", "Resolved", "Denied",
] as const;

// Payload for `useUrlParams().set(...)` that wipes every Task #753
// filter facet in one call.
export const CLEAR_ALL_VERDICT_PENDING_FILTERS_PAYLOAD: Record<string, null> = {
  q: null,
  status: null,
  responseType: null,
  errorTypeId: null,
  clientNumber: null,
  serviceDateFrom: null,
  serviceDateTo: null,
  responseReceivedFrom: null,
  responseReceivedTo: null,
};

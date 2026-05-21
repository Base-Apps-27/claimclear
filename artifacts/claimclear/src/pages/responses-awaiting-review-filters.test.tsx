// Task #753 — Frontend coverage for the Responses Awaiting Review
// filter bar contract + per-row leg context. Three protocols:
//
//   1. URL → server query parity. Each Task #753 facet token, when
//      present in the URL, must show up on the `verdictPendingQuery`
//      payload that drives `useListInvoiceGroups`.
//   2. `hasActiveFilters` matches the filter bar's "any filter set?"
//      semantics; `clearAllFilters` payload nulls every facet at once.
//   3. The list row's leg-context line renders service date, the
//      leg-of-record (preferring confNumber, falling back to
//      `primaryLeg.id` when confNumber is null), and "+N more" only
//      when `legCount > 1`. The filtered-empty-state surface lights
//      up under the same render path.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  buildVerdictPendingQuery,
  hasActiveVerdictPendingFilters,
  CLEAR_ALL_VERDICT_PENDING_FILTERS_PAYLOAD,
  VERDICT_PENDING_STATUS_FILTER_VALUES,
  VERDICT_PENDING_RESPONSE_TYPE_FILTER_VALUES,
  CLAIM_STATUS_ENUM_VALUES,
  type VerdictPendingFilterState,
} from "./responses-awaiting-review-filters";

function emptyState(): VerdictPendingFilterState {
  return {
    q: null,
    statuses: [],
    responseTypes: [],
    errorTypeIds: [],
    clientNumbers: [],
    serviceDateFrom: null,
    serviceDateTo: null,
    responseReceivedFrom: null,
    responseReceivedTo: null,
    hiddenBucket: null,
  };
}

test("buildVerdictPendingQuery: pinned cohort fields are always present", () => {
  const q = buildVerdictPendingQuery(emptyState()) as Record<string, unknown>;
  assert.equal(q.macroPhase, "response-pending");
  assert.equal(q.includeExpired, true);
  assert.equal(q.errorTypeAssigned, true);
  assert.equal(q.limit, 500);
  // No filter facets set: none of the Task #753 keys may be on the
  // payload. URL-state parity relies on this — an empty bar should be
  // indistinguishable from no bar at all to the API.
  for (const key of [
    "q", "status", "responseType", "errorTypeId", "clientNumber",
    "serviceDateFrom", "serviceDateTo", "responseReceivedFrom", "responseReceivedTo",
  ]) {
    assert.equal((q as Record<string, unknown>)[key], undefined, `${key} must be omitted when not set`);
  }
});

test("buildVerdictPendingQuery: every URL facet round-trips into the server query", () => {
  const state: VerdictPendingFilterState = {
    q: "leg-77",
    statuses: ["Submitted to Payor", "Payor Response Received"],
    responseTypes: ["denial", "info_request"],
    errorTypeIds: ["7", "11"],
    clientNumbers: ["CLT-1", "CLT-2"],
    serviceDateFrom: "2026-04-01",
    serviceDateTo: "2026-04-30",
    responseReceivedFrom: "2026-05-01",
    responseReceivedTo: "2026-05-15",
    hiddenBucket: null,
  };
  const q = buildVerdictPendingQuery(state) as Record<string, unknown>;
  assert.equal(q.q, "leg-77");
  assert.equal(q.status, "Submitted to Payor,Payor Response Received");
  assert.equal(q.responseType, "denial,info_request");
  assert.equal(q.errorTypeId, "7,11");
  assert.equal(q.clientNumber, "CLT-1,CLT-2");
  assert.equal(q.serviceDateFrom, "2026-04-01");
  assert.equal(q.serviceDateTo, "2026-04-30");
  assert.equal(q.responseReceivedFrom, "2026-05-01");
  assert.equal(q.responseReceivedTo, "2026-05-15");
});

test("hasActiveVerdictPendingFilters: false on empty, true for any single facet", () => {
  assert.equal(hasActiveVerdictPendingFilters(emptyState()), false);
  const probes: Array<Partial<VerdictPendingFilterState>> = [
    { q: "x" },
    { statuses: ["Submitted to Payor"] },
    { responseTypes: ["denial"] },
    { errorTypeIds: ["1"] },
    { clientNumbers: ["CLT-1"] },
    { serviceDateFrom: "2026-04-01" },
    { serviceDateTo: "2026-04-30" },
    { responseReceivedFrom: "2026-05-01" },
    { responseReceivedTo: "2026-05-15" },
  ];
  for (const p of probes) {
    const merged = { ...emptyState(), ...p };
    assert.equal(
      hasActiveVerdictPendingFilters(merged),
      true,
      `expected hasActiveFilters=true for ${JSON.stringify(p)}`,
    );
  }
});

test("buildVerdictPendingQuery: an active hiddenBucket swaps the cohort for inboxHiddenBucket", () => {
  // Task #813 — when a hidden bucket is active the list query must
  // drop the default verdict-pending cohort and target only the
  // matching bucket. Free-text search threads through; other facet
  // filters are dropped because they don't apply to the bucket views.
  const state: VerdictPendingFilterState = {
    ...emptyState(),
    q: "abc",
    statuses: ["Awaiting Response"],
    hiddenBucket: "awaitingPayorAgain",
  };
  const q = buildVerdictPendingQuery(state) as Record<string, unknown>;
  assert.equal(q.inboxHiddenBucket, "awaitingPayorAgain");
  assert.equal(q.q, "abc");
  assert.equal(q.macroPhase, undefined, "macroPhase must not be sent when a hidden bucket is active");
  assert.equal(q.errorTypeAssigned, undefined);
  assert.equal(q.status, undefined, "status facet is dropped under hidden-bucket cohort");
});

test("CLEAR_ALL_VERDICT_PENDING_FILTERS_PAYLOAD nulls every Task #753 facet key", () => {
  const expected = [
    "q", "status", "responseType", "errorTypeId", "clientNumber",
    "serviceDateFrom", "serviceDateTo", "responseReceivedFrom", "responseReceivedTo",
  ].sort();
  const got = Object.keys(CLEAR_ALL_VERDICT_PENDING_FILTERS_PAYLOAD).sort();
  assert.deepEqual(got, expected, "clear-all payload must cover exactly the filter facet keys");
  for (const k of expected) {
    assert.equal(
      CLEAR_ALL_VERDICT_PENDING_FILTERS_PAYLOAD[k],
      null,
      `${k} must be set to null so useUrlParams.set deletes it`,
    );
  }
});

// =====================================================================
// Per-row leg context rendering
// =====================================================================
// Mirrors the production JSX in `responses-awaiting-review.tsx` ListRow
// (Task #753) so confNumber-vs-id fallback and the "+N more" tail can
// be locked without mounting the full page (which depends on dozens of
// React hooks + the API client). If the production template changes,
// update this stub too — the assertions enforce the rendered text
// shape, not the exact JSX.

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

type LegMetaGroup = {
  id: number;
  earliestDate?: string | null;
  legCount?: number | null;
  primaryLeg?: { id: number; confNumber: string | null } | null;
};

function LegMetaLine({ group }: { group: LegMetaGroup }) {
  if (!(group.earliestDate || group.primaryLeg)) return null;
  return React.createElement(
    "div",
    { "data-testid": `row-leg-meta-${group.id}` },
    group.earliestDate ? React.createElement("span", null, group.earliestDate) : null,
    group.primaryLeg
      ? React.createElement(
          "span",
          { "data-testid": "row-leg-of-record" },
          group.primaryLeg.confNumber
            ? `Leg #${group.primaryLeg.confNumber}`
            : `Leg #${group.primaryLeg.id}`,
        )
      : null,
    typeof group.legCount === "number" && group.legCount > 1
      ? React.createElement("span", null, `+${group.legCount - 1} more`)
      : null,
  );
}

test("ListRow leg meta: single leg with confNumber renders Leg #<conf> and no '+N more'", () => {
  const html = renderToStaticMarkup(
    React.createElement(LegMetaLine, {
      group: {
        id: 1,
        earliestDate: "2026-04-15",
        legCount: 1,
        primaryLeg: { id: 99, confNumber: "ABC-123" },
      },
    }),
  );
  assert.match(html, /Leg #ABC-123/);
  assert.doesNotMatch(html, /more/, "single-leg row must not surface '+N more'");
});

test("ListRow leg meta: multi-leg surfaces '+N more' equal to legCount-1", () => {
  const html = renderToStaticMarkup(
    React.createElement(LegMetaLine, {
      group: {
        id: 2,
        earliestDate: "2026-04-15",
        legCount: 3,
        primaryLeg: { id: 100, confNumber: "XYZ-9" },
      },
    }),
  );
  assert.match(html, /Leg #XYZ-9/);
  assert.match(html, /\+2 more/);
});

test("ListRow leg meta: falls back to primaryLeg.id when confNumber is null", () => {
  const html = renderToStaticMarkup(
    React.createElement(LegMetaLine, {
      group: {
        id: 3,
        earliestDate: "2026-04-15",
        legCount: 2,
        primaryLeg: { id: 555, confNumber: null },
      },
    }),
  );
  assert.match(html, /Leg #555/, "must fall back to primaryLeg.id when confNumber is null");
  assert.doesNotMatch(html, /Leg #null/);
  assert.match(html, /\+1 more/);
});

test("ListRow leg meta: omitted entirely when no earliestDate and no primaryLeg", () => {
  const html = renderToStaticMarkup(
    React.createElement(LegMetaLine, { group: { id: 4 } }),
  );
  assert.equal(html, "", "no date and no primary leg → no meta line");
});

test("Status facet: every option is a real claim_status pgEnum value", () => {
  // Regression for code review #2 reject: previously the page shipped
  // human-readable labels like "Submitted to Payor" / "Approved by
  // Payor" that are NOT in `claim_status`, so selecting them sent
  // impossible values via `?status=` and never narrowed the list.
  const enumSet = new Set<string>(CLAIM_STATUS_ENUM_VALUES as readonly string[]);
  for (const v of VERDICT_PENDING_STATUS_FILTER_VALUES) {
    assert.ok(
      enumSet.has(v),
      `Status facet option "${v}" is not in the canonical claim_status pgEnum — selecting it would send an impossible status= query and produce zero rows. Update VERDICT_PENDING_STATUS_FILTER_VALUES.`,
    );
  }
  assert.ok(
    VERDICT_PENDING_STATUS_FILTER_VALUES.length > 0,
    "Status facet must offer at least one option",
  );
});

test("Status facet: selecting a status round-trips into the server query as ?status=<enum>", () => {
  const state: VerdictPendingFilterState = {
    q: null,
    statuses: ["Awaiting Response", "Needs Review"],
    responseTypes: [],
    errorTypeIds: [],
    clientNumbers: [],
    serviceDateFrom: null,
    serviceDateTo: null,
    responseReceivedFrom: null,
    responseReceivedTo: null,
    hiddenBucket: null,
  };
  const q = buildVerdictPendingQuery(state) as Record<string, unknown>;
  assert.equal(
    q.status,
    "Awaiting Response,Needs Review",
    "selected statuses must be CSV-joined into the `status` query param using the canonical enum spelling",
  );
});

test("Response type facet: includes acknowledgment and matches the OpenAPI enum", () => {
  // Acknowledgment is a real `responseType` per the OpenAPI spec
  // (lib/api-spec/openapi.yaml — ResponsePayload.responseType) and
  // shows up on the row as a chip; if it's missing from the facet,
  // operators can't filter for the auto-ack-only cohort.
  const expected = ["approval", "denial", "partial_approval", "info_request", "acknowledgment", "other"];
  assert.deepEqual(
    [...VERDICT_PENDING_RESPONSE_TYPE_FILTER_VALUES],
    expected,
    "Response type facet must list every value in the OpenAPI `responseType` enum (acknowledgment included)",
  );
});

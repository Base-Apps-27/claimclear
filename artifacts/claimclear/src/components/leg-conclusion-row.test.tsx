// Component tests for <LegConclusionRow /> — Task #418.
//
// What we pin here is the surface contract for sibling-duplicate legs:
// once the primary leg reaches a terminal sub-status, the duplicate row
// must classify as `processed` (muted variant, no Process action area)
// even though its OWN sub-status is `duplicate`. The rule must match
// the backend's `evaluateDisputedLegsResolved`. The shared rule lives
// in `lib/leg-resolved` and is exercised end-to-end here.
//
// We mock `@workspace/replit-auth-web` and the SSE-aware
// `use-claim-events` hook because they pull `react` through a peer-dep
// boundary that node:test can't resolve from `lib/`. The mocks return
// inert values that don't affect the variant classifier under test.

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";

// Stub the auth + claim-events hooks BEFORE importing the row. Both
// returns are inert: the row's "you finished a leg" microinteraction
// only fires inside useEffect, which renderToStaticMarkup never runs.
mock.module("@workspace/replit-auth-web", {
  namedExports: {
    useAuth: () => ({
      user: null,
      isLoading: false,
      isAuthenticated: false,
      sessionExpiry: null,
      login: () => {},
      logout: () => {},
      clearAuth: () => {},
    }),
  },
});

mock.module("@/hooks/use-claim-events", {
  namedExports: {
    useClaimEvents: () => ({
      lastClaimUpdateBy: { current: null },
    }),
  },
});

// Stub ClaimDetailV2 — the embedded leg detail screen pulls a huge
// dependency tree (router, query subscriptions, more hooks) we don't
// need for the variant test. Initially-collapsed rows don't render
// it anyway, but the stub keeps the import graph cheap.
mock.module("@/components/claim-detail-v2", {
  namedExports: {
    ClaimDetailV2: () => null,
  },
});

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { LegConclusionRow } = await import("./leg-conclusion-row");
type ClaimResponse = import("@workspace/api-client-react").ClaimResponse;

void React;

function render(node: import("react").ReactElement): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client: qc, children: node }),
  );
}

// Minimal ClaimResponse builder — only the fields the row + the
// resolved-leg helper read. Cast through `unknown` to satisfy the
// generated schema's strict shape without enumerating its 80+ fields.
function claim(over: Partial<ClaimResponse> & { id: number }): ClaimResponse {
  return {
    id: over.id,
    confNumber: `CLM-${over.id}`,
    status: "New",
    outcome: null,
    includedInDispute: true,
    duplicateOfClaimId: null,
    sopOutcome: null,
    errorTypeId: null,
    holdReason: null,
    ...over,
  } as unknown as ClaimResponse;
}

function row(claimArg: ClaimResponse, siblings: readonly ClaimResponse[]) {
  return React.createElement(LegConclusionRow, {
    claim: claimArg,
    groupId: 42,
    siblings,
  });
}

// ─────────────────────────────────────────────────────────────────────
// (a) Duplicate leg whose primary is `dropped` (Non-contestable)
//     renders the row as PROCESSED — muted card, no action area.
// ─────────────────────────────────────────────────────────────────────
test("LegConclusionRow: duplicate of a dropped primary renders as processed", () => {
  const primary = claim({
    id: 589,
    errorTypeId: "ET-1",
    sopOutcome: "cannot_dispute", // → dropped
  });
  const duplicate = claim({
    id: 588,
    duplicateOfClaimId: 589, // → duplicate
  });
  const html = render(row(duplicate, [primary, duplicate]));
  // Variant attribute is the row's contract for downstream consumers
  // (the queue's bucketed sort + e2e selectors).
  assert.match(html, /data-testid="leg-conclusion-row-588"/);
  assert.match(html, /data-variant="processed"/);
  // The "you finished a leg" microinteraction icon is rendered for
  // the processed variant.
  assert.match(html, /data-testid="leg-row-icon-processed-588"/);
  // No action area — the operator can't (and shouldn't) Process /
  // Continue / quick-conclude a duplicate whose primary is done.
  assert.equal(
    html.includes(`data-testid="leg-conclusion-controls-588"`),
    false,
    "processed duplicate must not render the strip action area",
  );
});

// ─────────────────────────────────────────────────────────────────────
// (b) Duplicate leg whose primary is still `investigating` keeps
//     rendering as ACTIVE — same behaviour as the backend's gate.
// ─────────────────────────────────────────────────────────────────────
test("LegConclusionRow: duplicate of an investigating primary stays active", () => {
  const primary = claim({
    id: 589,
    errorTypeId: "ET-1",
    sopOutcome: null, // → investigating
  });
  const duplicate = claim({
    id: 588,
    duplicateOfClaimId: 589,
  });
  const html = render(row(duplicate, [primary, duplicate]));
  assert.match(html, /data-testid="leg-conclusion-row-588"/);
  assert.match(html, /data-variant="active"/);
  // Active row renders the action area so the operator (or the
  // sibling-duplicate prompt + Process button) can keep moving.
  assert.match(html, /data-testid="leg-conclusion-controls-588"/);
});

// ─────────────────────────────────────────────────────────────────────
// (c) Reverse case — clearing the primary's terminal state (e.g.
//     reclassifying it back to investigating) flips the duplicate row
//     back to active without any extra operator action.
// ─────────────────────────────────────────────────────────────────────
test("LegConclusionRow: reclassifying primary back to investigating re-locks duplicate row", () => {
  const duplicate = claim({ id: 588, duplicateOfClaimId: 589 });

  // Round 1: primary is terminal → row is processed.
  const primaryDone = claim({
    id: 589,
    errorTypeId: "ET-1",
    sopOutcome: "cannot_dispute",
  });
  const html1 = render(row(duplicate, [primaryDone, duplicate]));
  assert.match(html1, /data-variant="processed"/);

  // Round 2: same duplicate, but the primary has been reclassified
  // back to mid-walk. The row flips back to active.
  const primaryReopened = claim({
    id: 589,
    errorTypeId: "ET-1",
    sopOutcome: null,
  });
  const html2 = render(row(duplicate, [primaryReopened, duplicate]));
  assert.match(html2, /data-variant="active"/);
  assert.match(html2, /data-testid="leg-conclusion-controls-588"/);
});

// ─────────────────────────────────────────────────────────────────────
// (e) Edge case mirrored from the backend's
//     `evaluateDisputedLegsResolved` integration test — an excluded
//     primary (`includedInDispute=false`) derives to `excluded`, which
//     IS a terminal sub-status, so the duplicate's row is processed
//     even though the primary itself is hidden from the disputed
//     subset.
// ─────────────────────────────────────────────────────────────────────
test("LegConclusionRow: duplicate of an excluded primary still renders as processed", () => {
  const excludedPrimary = claim({
    id: 589,
    includedInDispute: false, // → excluded
  });
  const duplicate = claim({
    id: 588,
    duplicateOfClaimId: 589,
  });
  const html = render(row(duplicate, [excludedPrimary, duplicate]));
  assert.match(html, /data-variant="processed"/);
  assert.equal(
    html.includes(`data-testid="leg-conclusion-controls-588"`),
    false,
  );
});

// Sanity-check baseline: a non-duplicate, non-terminal leg still
// renders as `active` (so the duplicate-specific assertions above
// aren't accidentally passing for the wrong reason).
test("LegConclusionRow: non-duplicate investigating leg renders as active", () => {
  const c = claim({
    id: 100,
    errorTypeId: "ET-1",
    sopOutcome: null,
  });
  const html = render(row(c, [c]));
  assert.match(html, /data-variant="active"/);
});

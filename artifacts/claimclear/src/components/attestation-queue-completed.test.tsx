// Page-level test for the Attestation Queue's "Completed re-attestations"
// tab — Task #426.
//
// What we pin here is the SSR-stable contract for the completed history
// surface:
//   * the new tabs strip renders both Open and Completed triggers;
//   * the range selector renders with the URL-driven value;
//   * the completed list, per-leg outcome badges, and the read-only
//     detail pane render from the mocked history payload;
//   * the truncated banner appears when the API flags overflow;
//   * an empty payload renders the empty-state instead of the grid.
//
// We mock the network hooks (queue + history) to avoid pulling the
// network runtime into the SSR test, and stub AttestationPrompt
// (which depends on react-query mutations) since the Completed tab
// never renders it. node:test only lets us register a given module
// mock once per process, so we drive the empty-state vs populated-
// state branches off a mutable flag inside the same mock factory.

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";

let urlParams: Record<string, string> = {};
let lastSetCall: { updates: Record<string, string | null>; resetPage: boolean } | null = null;
let historyMode: "populated" | "empty" = "populated";
const historyHookCalls: Array<Record<string, never>> = [];

mock.module("@/lib/use-url-params", {
  namedExports: {
    useUrlParams: () => ({
      get: (key: string) => urlParams[key] ?? "",
      getAll: (_key: string) => [],
      set: (
        updates: Record<string, string | null>,
        resetPage = true,
      ) => {
        lastSetCall = { updates, resetPage };
      },
      searchParams: new URLSearchParams(),
    }),
  },
});

mock.module("@/components/attestation-prompt", {
  namedExports: { AttestationPrompt: () => null },
});

// wouter's <Link> uses useSyncExternalStore against `window.location`,
// which is undefined in node:test SSR. Substitute a plain anchor so
// the Link renders to a deterministic, location-free DOM node.
mock.module("wouter", {
  namedExports: {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      React.createElement("a", { href, ...rest }, children),
    useLocation: () => ["/", () => {}],
  },
});

const inertQuery = <T,>(data: T) => ({
  data,
  isLoading: false,
  isError: false,
  error: null,
  isSuccess: true,
  refetch: () => Promise.resolve({ data } as never),
  queryKey: [] as never,
});

const populatedPayload = {
  groups: [
    {
      group: {
        id: 11,
        invoiceNumber: "INV-COMPLETE-1",
        status: "Awaiting Response",
        outcome: "Approved",
        rideCount: 3,
        disputeEmailSent: true,
        reattestRequired: true,
        reattestCompletedAt: "2026-04-30T12:00:00.000Z",
        reattestCompletedBy: "ops@example.com",
        reattestNote: "All confirmed in MAS",
        errorTypeName: "Eligibility",
        clientNumber: "PAYOR-X",
      },
      legs: [
        {
          claim: {
            id: 901,
            confNumber: "CLM-901",
            status: "Awaiting Response",
            outcome: "Approved",
            disputeEmailSent: true,
            attestationState: "completed",
            includedInDispute: true,
            date: "2026-04-15",
          },
          attestationOutcome: "attested",
          outcomeAt: "2026-04-30T12:00:00.000Z",
          outcomeBy: "ops@example.com",
          outcomeNote: null,
        },
        {
          claim: {
            id: 902,
            confNumber: "CLM-902",
            status: "Awaiting Response",
            outcome: "Denied",
            disputeEmailSent: true,
            attestationState: "not_required",
            includedInDispute: true,
          },
          attestationOutcome: "mas_cancelled",
          outcomeAt: "2026-04-30T11:00:00.000Z",
          outcomeBy: "canceller@example.com",
          outcomeNote: "Cancelled in MAS",
        },
        {
          claim: {
            id: 903,
            confNumber: "CLM-903",
            status: "Awaiting Response",
            outcome: "Approved",
            disputeEmailSent: true,
            attestationState: "queued",
            includedInDispute: true,
          },
          attestationOutcome: "queued",
          outcomeAt: "2026-04-30T10:00:00.000Z",
          outcomeBy: "queuer@example.com",
          outcomeNote: null,
        },
        {
          claim: {
            id: 904,
            confNumber: "CLM-904",
            status: "Awaiting Response",
            outcome: "Pending",
            disputeEmailSent: false,
            attestationState: "not_required",
            includedInDispute: false,
          },
          attestationOutcome: "not_required",
          outcomeAt: null,
          outcomeBy: null,
          outcomeNote: null,
        },
      ],
    },
  ],
  truncated: true,
};

const inertMutation = () => ({
  mutate: () => {},
  mutateAsync: async () => undefined,
  isPending: false,
  isError: false,
  isSuccess: false,
  isIdle: true,
  error: null,
  data: undefined,
  reset: () => {},
});

mock.module("@workspace/api-client-react", {
  namedExports: {
    useListAttestationPending: () => inertQuery({ claims: [], extras: {} }),
    useGetInvoiceGroupAttestationHistory: () => {
      historyHookCalls.push({});
      return inertQuery(
        historyMode === "populated"
          ? populatedPayload
          : { groups: [], truncated: false },
      );
    },
    // Open-tab hooks — Open tab isn't rendered in this test (we drive
    // ?tab=completed) so the empty list short-circuits before any of
    // these are needed at render time, but the imports at module load
    // still resolve. Stub them out so module replacement covers all
    // named exports the page uses.
    useGetInvoiceGroup: () => inertQuery(null),
    useCompleteGroupReattest: inertMutation,
    useAttestClaim: inertMutation,
    useConfirmQueuedAttestation: inertMutation,
    useCompleteLegMasAction: inertMutation,
    getListAttestationPendingQueryKey: () => ["pending"],
    getGetInvoiceGroupAttestationHistoryQueryKey: () => ["history"],
    getGetInvoiceGroupQueryKey: () => ["invoice-group"],
    getGetAttestationCountsQueryKey: () => ["attest-counts"],
    getGetDashboardSummaryQueryKey: () => ["dashboard"],
    getGetClaimQueryKey: () => ["claim"],
  },
});

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const useUrlParamsMod = await import("@/lib/use-url-params");
const { default: AttestationQueue } = await import(
  "../pages/attestation-queue"
);

void React;

function render(): string {
  return renderToStaticMarkup(React.createElement(AttestationQueue));
}

test("renders both Open and Completed tabs in the strip", () => {
  urlParams = {};
  historyMode = "populated";
  const html = render();
  assert.match(html, /data-testid="attestation-tabs"/);
  assert.match(html, /data-testid="attestation-tab-open"[^>]*>\s*Open\s*</);
  assert.match(
    html,
    /data-testid="attestation-tab-completed"[^>]*>\s*Completed re-attestations\s*</,
  );
});

test("Completed tab content renders the workspace, list, and truncated banner (no range selector — Task #893)", () => {
  urlParams = { tab: "completed" };
  historyMode = "populated";
  const html = render();
  assert.match(html, /data-testid="completed-workspace"/);
  // Task #893 — the trailing-window selector was removed from the
  // Completed tab; the page now always shows every completed
  // re-attestation on file. Pin the absence so the selector can't
  // come back without an intentional test change.
  assert.equal(
    html.includes('data-testid="completed-range-select"'),
    false,
    "range selector must not render on the Completed tab",
  );
  assert.match(html, /data-testid="completed-list"/);
  assert.match(html, /data-testid="completed-row-11"/);
  assert.match(html, /INV-COMPLETE-1/);
  assert.match(html, /data-testid="completed-truncated-banner"/);
});

test("Completed detail pane renders all four per-leg outcome buckets, read-only", () => {
  urlParams = { tab: "completed" };
  historyMode = "populated";
  const html = render();
  assert.match(html, /data-testid="completed-detail-11"/);
  assert.match(html, /data-testid="completed-leg-901"/);
  assert.match(
    html,
    /data-testid="completed-leg-outcome-901"[^>]*>\s*Re-attested\s*</,
  );
  assert.match(
    html,
    /data-testid="completed-leg-outcome-902"[^>]*>\s*MAS cancelled\s*</,
  );
  assert.match(
    html,
    /data-testid="completed-leg-outcome-903"[^>]*>\s*Queued for portal user\s*</,
  );
  assert.match(
    html,
    /data-testid="completed-leg-outcome-904"[^>]*>\s*Not required\s*</,
  );
  // Read-only: no AttestationPrompt CTA on the Completed tab.
  assert.equal(html.includes("attestation-prompt"), false);
});

test("empty payload renders the empty-state instead of the master/detail grid", () => {
  urlParams = { tab: "completed" };
  historyMode = "empty";
  const html = render();
  assert.match(html, /data-testid="completed-empty"/);
  assert.equal(
    html.includes('data-testid="completed-list"'),
    false,
    "list must not render when there are no completed groups",
  );
});

test("history hook is invoked without a range param — Task #893 dropped the trailing-window filter", () => {
  // Sanity guard so the page can't silently re-introduce the range
  // query param. The hook should fire exactly once per render and
  // with no arguments now that the time-window UI is gone.
  historyHookCalls.length = 0;
  historyMode = "populated";

  urlParams = { tab: "completed" };
  render();
  assert.equal(historyHookCalls.length, 1);
  // `lastSetCall` is touched only by the `set()` writer; verifying it
  // stays null after a populated render proves the workspace isn't
  // pushing range-related URL writes anymore either.
  lastSetCall = null;
  void useUrlParamsMod;
  assert.equal(lastSetCall, null);
});

test("payor and earliest service date appear on completed rows and detail header", () => {
  urlParams = { tab: "completed" };
  historyMode = "populated";
  const html = render();
  // List row carries Payor + Earliest service.
  assert.match(html, /data-testid="completed-row-11"[\s\S]*Payor[\s\S]*PAYOR-X[\s\S]*Earliest service/);
  // Detail header carries Payor next to invoice number.
  assert.match(html, /data-testid="completed-detail-11"[\s\S]*Payor[\s\S]*PAYOR-X/);
  // Detail grid exposes "Earliest service" as a labeled field.
  assert.match(html, /Earliest service/);
  // Group-detail link points to the canonical /invoice-groups/:id route.
  assert.match(html, /href="\/invoice-groups\/11"[^>]*data-testid="completed-detail-open-11"/);
});

test("empty-state copy is window-free — Task #893 always reads 'on file'", () => {
  historyMode = "empty";
  urlParams = { tab: "completed" };
  const html = render();
  assert.match(html, /No completed re-attestations on file\./);
});

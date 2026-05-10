// Click-flow contract for the Attestation Queue Open tab (Task #430):
// the group-level "Mark group as re-attested" CTA must call
// useCompleteGroupReattest with the group id, and per-leg "Confirm just
// this leg" must call useAttestClaim with the leg id.

import "./decision-tree/terminals/_setup-jsdom.ts";

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";
import type { ClaimResponse } from "@workspace/api-client-react";

let urlParams: Record<string, string> = {};

mock.module("@/lib/use-url-params", {
  namedExports: {
    useUrlParams: () => ({
      get: (key: string) => urlParams[key] ?? "",
      getAll: () => [],
      set: () => {},
      searchParams: new URLSearchParams(),
    }),
  },
});

mock.module("wouter", {
  namedExports: {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      React.createElement("a", { href, ...rest }, children),
    useLocation: () => ["/", () => {}],
  },
});

mock.module("@/hooks/use-toast", {
  namedExports: {
    useToast: () => ({ toast: () => {} }),
    toast: () => ({ id: "0", dismiss: () => {}, update: () => {} }),
    successToast: () => ({ id: "0", dismiss: () => {}, update: () => {} }),
  },
});

interface MutationCall {
  id: number;
  data: unknown;
}
const completeGroupReattestCalls: MutationCall[] = [];
const attestClaimCalls: MutationCall[] = [];
const confirmQueuedCalls: MutationCall[] = [];
const completeLegMasCalls: MutationCall[] = [];

function makeRecordingMutation(sink: MutationCall[]) {
  return () => ({
    mutate: () => {},
    mutateAsync: async (vars: MutationCall) => {
      sink.push(vars);
      return undefined;
    },
    isPending: false,
    isError: false,
    isSuccess: false,
    isIdle: true,
    error: null,
    data: undefined,
    reset: () => {},
  });
}

const inertQuery = <T,>(data: T) => ({
  data,
  isLoading: false,
  isError: false,
  error: null,
  isSuccess: true,
  refetch: () => Promise.resolve({ data } as never),
  queryKey: [] as never,
});

function makeLeg(overrides: {
  id: number;
  confNumber: string;
  outcome: string;
  invoiceGroupId: number | null;
  invoiceNumbers?: string;
}): ClaimResponse {
  const claim = {
    id: overrides.id,
    confNumber: overrides.confNumber,
    status: "Awaiting Response" as const,
    outcome: overrides.outcome as ClaimResponse["outcome"],
    disputeEmailSent: true,
    invoiceGroupId: overrides.invoiceGroupId,
    invoiceNumbers: overrides.invoiceNumbers ?? "INV-100",
    clientNumber: "PAYOR-X",
    attestationState: "pending" as const,
    attestationQueuedAt: null,
    attestationQueuedBy: null,
    attestationNote: null,
    includedInDispute: true,
    masActionRequired: null,
    masActionCompletedAt: null,
  };
  return claim as unknown as ClaimResponse;
}

// One group with two Approved legs — no MAS cancels, so the gated
// re-attest checkbox in MasActionChecklist is immediately clickable.
const leg1001 = makeLeg({
  id: 1001,
  confNumber: "CLM-1001",
  outcome: "Approved",
  invoiceGroupId: 100,
});
const leg1002 = makeLeg({
  id: 1002,
  confNumber: "CLM-1002",
  outcome: "Approved",
  invoiceGroupId: 100,
});

const grp100 = {
  id: 100,
  invoiceNumber: "INV-100",
  status: "Awaiting Response",
  outcome: "Approved",
  rideCount: 2,
  disputeEmailSent: true,
  reattestRequired: true,
  reattestCompletedAt: null,
  clientNumber: "PAYOR-X",
  rides: [leg1001, leg1002],
};

const pendingPayload = {
  claims: [leg1001, leg1002],
  extras: {
    "1001": { verdictRecordedAt: "2026-04-30T09:00:00.000Z" },
    "1002": { verdictRecordedAt: "2026-04-30T09:30:00.000Z" },
  },
};
const queuedPayload = { claims: [], extras: {} };

mock.module("@workspace/api-client-react", {
  namedExports: {
    useListAttestationPending: (params: { state?: string } = {}) =>
      params.state === "pending" ? inertQuery(pendingPayload) : inertQuery(queuedPayload),
    useGetInvoiceGroup: (id: number) =>
      inertQuery(id === 100 ? grp100 : null),
    useGetInvoiceGroupAttestationHistory: () =>
      inertQuery({ groups: [], truncated: false }),
    useCompleteGroupReattest: makeRecordingMutation(completeGroupReattestCalls),
    useAttestClaim: makeRecordingMutation(attestClaimCalls),
    useConfirmQueuedAttestation: makeRecordingMutation(confirmQueuedCalls),
    useCompleteLegMasAction: makeRecordingMutation(completeLegMasCalls),
    getListAttestationPendingQueryKey: () => ["pending"],
    getGetInvoiceGroupAttestationHistoryQueryKey: () => ["history"],
    getGetInvoiceGroupQueryKey: () => ["invoice-group"],
    getGetAttestationCountsQueryKey: () => ["attest-counts"],
    getGetDashboardSummaryQueryKey: () => ["dashboard"],
    getGetClaimQueryKey: () => ["claim"],
  },
});

const React = await import("react");
const {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);
const { default: AttestationQueue } = await import(
  "../pages/attestation-queue"
);

void React;

function mount() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(AttestationQueue),
    ),
  );
}

test("per-leg 'Confirm just this leg' calls useAttestClaim with the leg id", async (t) => {
  urlParams = {};
  attestClaimCalls.length = 0;
  t.after(cleanup);
  mount();
  await waitFor(() => {
    assert.ok(screen.queryByTestId("confirm-just-this-leg-1001"));
  });
  fireEvent.click(screen.getByTestId("confirm-just-this-leg-1001"));
  await waitFor(() => {
    assert.equal(attestClaimCalls.length, 1);
  });
  assert.equal(attestClaimCalls[0].id, 1001);
  assert.equal(completeGroupReattestCalls.length, 0);
});

test("wizard 'Re-attested in MAS' button calls useCompleteGroupReattest with the group id", async (t) => {
  // Task #650: Step 3 button replaces the legacy reattest checkbox.
  urlParams = {};
  completeGroupReattestCalls.length = 0;
  attestClaimCalls.length = 0;
  t.after(cleanup);
  mount();
  await waitFor(() => {
    assert.ok(screen.queryByTestId("wizard-reattest-button"));
  });
  fireEvent.click(screen.getByTestId("wizard-reattest-button"));
  await waitFor(() => {
    assert.equal(completeGroupReattestCalls.length, 1);
  });
  assert.equal(completeGroupReattestCalls[0].id, 100);
  assert.equal(attestClaimCalls.length, 0);
});

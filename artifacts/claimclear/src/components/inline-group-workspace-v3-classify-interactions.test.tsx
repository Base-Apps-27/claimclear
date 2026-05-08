// Task #528 — Click-flow contract for the V3 ClassifyHero (R4):
// when the active leg's sub-status is `needs_classification`, picking
// a suggestion (or grid tile) and clicking "Start walk" must call
// useClassifyLeg with `{ id, data: { errorTypeId } }` so the wizard's
// hero routing transitions to the SOP walk on the next render.

import "./decision-tree/terminals/_setup-jsdom.ts";

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";
import type {
  ClaimResponse,
  InvoiceGroupDetailResponse,
} from "@workspace/api-client-react";

interface MutationCall {
  id: number;
  data: { errorTypeId: string };
}
const classifyLegCalls: MutationCall[] = [];
const lookupCalls: { data: { errorDetails: string[] } }[] = [];

function makeClassifyMutation() {
  return () => ({
    mutate: () => {},
    mutateAsync: async (vars: MutationCall) => {
      classifyLegCalls.push(vars);
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

// Lookup mutation captures its call so we can assert the canonical
// signal was queried, and exposes a `data` field that the hero reads
// to seed its "Recommended" suggestion. We hand-build a successful
// match against ET-77 so the test exercises the mapping → suggestion
// → click path, not the overlap fallback.
function makeLookupMutation() {
  return () => ({
    mutate: (vars: { data: { errorDetails: string[] } }) => {
      lookupCalls.push(vars);
    },
    mutateAsync: async () => ({ mappings: [] }),
    isPending: false,
    isError: false,
    isSuccess: true,
    isIdle: false,
    error: null,
    data: {
      mappings: [
        {
          originalText: "Travel time too short",
          normalizedText: "travel time too short",
          matched: true,
          errorTypeId: 77,
          errorTypeName: "Travel time discrepancy",
          pieces: null,
        },
      ],
    },
    reset: () => {},
  });
}

const inertMutation = () => ({
  mutate: () => {},
  mutateAsync: async () => ({}),
  isPending: false,
  isError: false,
  isSuccess: false,
  isIdle: true,
  error: null,
  data: undefined,
  reset: () => {},
});

const errorTypes = [
  { id: 77, name: "Travel time discrepancy", category: "Time" },
  { id: 88, name: "Wrong member", category: "Identity" },
  { id: 99, name: "GPS pickup deviation", category: "Location" },
];

let capturedGroup: InvoiceGroupDetailResponse | null = null;

mock.module("@workspace/api-client-react", {
  namedExports: {
    useClassifyLeg: makeClassifyMutation(),
    useLookupErrorDetailMappings: makeLookupMutation(),
    useStampPreviewGenerated: inertMutation,
    useSaveInvoiceGroupDraft: inertMutation,
    useRegenerateInvoiceGroupDraft: inertMutation,
    useMarkInvoiceGroupDraftReviewed: inertMutation,
    useCreatePortalSubmission: inertMutation,
    useConfirmUnderstandingReadback: inertMutation,
    useCompleteGroupReattest: inertMutation,
    useBulkQueueGroupReattest: inertMutation,
    useMarkAwaitingPayorAgain: inertMutation,
    usePromoteVerdictDrafts: inertMutation,
    useGetInvoiceGroup: (_id: number) => ({
      data: capturedGroup,
      isLoading: false,
    }),
    useGetClaim: (_id: number) => ({ data: null, isLoading: false }),
    useListErrorTypes: () => ({ data: errorTypes }),
    getGetInvoiceGroupQueryKey: (id: number) => ["invoice-group", id],
    getGetInvoiceGroupValidTransitionsQueryKey: (id: number) => [
      "invoice-group",
      id,
      "transitions",
    ],
    getGetClaimQueryKey: (id: number) => ["claim", id],
    getListInvoiceGroupsQueryKey: () => ["invoice-groups"],
    getGetResponsesAwaitingReviewCountQueryKey: () => [
      "responses-awaiting-review-count",
    ],
  },
});

mock.module("@workspace/replit-auth-web", {
  namedExports: { useAuth: () => ({ user: { role: "operator" } }) },
});

mock.module("@/hooks/use-toast", {
  namedExports: {
    useToast: () => ({ toast: () => {} }),
    toast: () => ({ id: "0", dismiss: () => {}, update: () => {} }),
    successToast: () => ({ id: "0", dismiss: () => {}, update: () => {} }),
  },
});

mock.module("@/lib/use-url-params", {
  namedExports: {
    useUrlParams: () => ({ get: (_k: string) => "", set: (_v: unknown) => {} }),
  },
});

mock.module("@/lib/role", {
  namedExports: { HideForClerk: ({ children }: { children: unknown }) => children },
});

mock.module("@/components/claim-detail-v2", {
  namedExports: {
    ClaimDetailV2: (props: { claimId: number }) =>
      React.createElement("div", {
        "data-testid": `stub-claim-detail-v2-${props.claimId}`,
      }),
  },
});

mock.module("@/components/whats-next/reattest-modal", {
  namedExports: { ReattestModal: () => null },
});

mock.module("@/components/closure/closure-launcher", {
  namedExports: {
    useClosureLauncher: () => ({ open: () => {}, dialog: null }),
  },
});

mock.module("@/components/decision-tree/sop-advance-player", {
  namedExports: {
    SopAdvancePlayer: () =>
      React.createElement("div", { "data-testid": "stub-sop-advance-player" }),
  },
});

const React = await import("react");
const {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);
const { InlineGroupWorkspaceV3 } = await import("./inline-group-workspace-v3");

void React;

function leg(id: number, errorTypeId: string | null, errorDetails: string | null): ClaimResponse {
  return {
    id,
    confNumber: `C${id}`,
    status: "New",
    outcome: null,
    includedInDispute: true,
    duplicateOfClaimId: null,
    sopOutcome: null,
    errorTypeId,
    errorTypeName: errorTypeId === null ? null : "Wrong member",
    errorDetails,
    holdReason: null,
    latestVerdict: null,
    latestDraft: null,
  } as unknown as ClaimResponse;
}

function group(rides: ClaimResponse[]): InvoiceGroupDetailResponse {
  return {
    id: 99,
    confNumber: "GRP-99",
    invoiceNumber: "INV-99",
    status: "New",
    rideCount: rides.length,
    totalAmount: 100,
    rides,
    submissions: [],
    notes: [],
    auditLogs: [],
    responses: [],
  } as unknown as InvoiceGroupDetailResponse;
}

function renderWorkspace() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc, children: null },
      React.createElement(InlineGroupWorkspaceV3, { groupId: 99 }),
    ),
  );
}

test("ClassifyHero — picking the recommended suggestion + Start walk fires useClassifyLeg with that errorTypeId", async () => {
  classifyLegCalls.length = 0;
  lookupCalls.length = 0;
  capturedGroup = group([
    leg(1, null, "Travel time too short"),
    leg(2, "ET-1", null),
  ]);

  renderWorkspace();

  // Hero must be the Classify picker, not WalkSopHero.
  assert.ok(screen.getByTestId("v3-hero-classify"));

  // The mapping lookup should have fired with the leg's errorDetails —
  // this is the canonical classifier signal.
  assert.equal(lookupCalls.length, 1);
  assert.deepEqual(lookupCalls[0].data, {
    errorDetails: ["Travel time too short"],
  });

  // The mapped errorTypeId (77) should be the top "Recommended" pick.
  const recommended = screen.getByTestId("v3-classify-suggestion-77");
  assert.equal(recommended.getAttribute("data-recommended"), "true");

  // Click the recommended suggestion → the Start walk CTA should
  // commit to that errorTypeId.
  fireEvent.click(recommended);
  const startWalk = screen.getByTestId("v3-classify-start-walk");
  assert.match(startWalk.textContent ?? "", /Travel time discrepancy/);

  await act(async () => {
    fireEvent.click(startWalk);
  });

  assert.equal(classifyLegCalls.length, 1);
  assert.deepEqual(classifyLegCalls[0], {
    id: 1,
    data: { errorTypeId: "77" },
  });

  cleanup();
});

test("ClassifyHero — picking a grid tile + Start walk fires useClassifyLeg with that errorTypeId", async () => {
  classifyLegCalls.length = 0;
  lookupCalls.length = 0;
  capturedGroup = group([
    leg(1, null, "Travel time too short"),
    leg(2, "ET-1", null),
  ]);

  renderWorkspace();

  // Pick a different type from the "All error types" grid (id 88,
  // which is NOT the recommended mapping match).
  const tile = screen.getByTestId("v3-classify-tile-88");
  fireEvent.click(tile);
  const startWalk = screen.getByTestId("v3-classify-start-walk");
  assert.match(startWalk.textContent ?? "", /Wrong member/);

  await act(async () => {
    fireEvent.click(startWalk);
  });

  assert.equal(classifyLegCalls.length, 1);
  assert.deepEqual(classifyLegCalls[0], {
    id: 1,
    data: { errorTypeId: "88" },
  });

  cleanup();
});

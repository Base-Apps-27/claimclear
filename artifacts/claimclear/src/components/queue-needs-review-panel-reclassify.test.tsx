// Task #795 — Single-leg Classify routing in QueueNeedsReviewPanel.
//
// When the dialog is opened on a leg that is excluded or already
// classified, picking an Error Type + clicking Classify must POST the
// correct pre-step (/include or /reclassify) BEFORE /classify, and the
// onCompleted message must read "reclassified" rather than the default
// "classified" so the operator sees that the leg was rerouted, not
// just classified for the first time.

import "./decision-tree/terminals/_setup-jsdom.ts";

// Radix Select calls these on the trigger / option elements; jsdom does
// not implement them, so they need stubs before Select effects run.
if (!(globalThis.HTMLElement.prototype as { hasPointerCapture?: unknown }).hasPointerCapture) {
  (globalThis.HTMLElement.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false;
  (globalThis.HTMLElement.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
  (globalThis.HTMLElement.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};
}
if (!(globalThis.Element.prototype as { scrollIntoView?: unknown }).scrollIntoView) {
  (globalThis.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
}

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";
import type { ClaimResponse, NeedsClassificationInboxGroup } from "@workspace/api-client-react";

interface Call {
  hook: string;
  id: number;
  data?: unknown;
}
const calls: Call[] = [];

function makeRecording(hook: string) {
  return () => ({
    mutate: () => {},
    mutateAsync: async (vars: { id: number; data?: unknown }) => {
      calls.push({ hook, id: vars.id, data: vars.data });
      return undefined;
    },
    isPending: false,
    isError: false,
    isSuccess: false,
    isIdle: true,
    error: null,
    data: undefined,
    reset: () => {},
    variables: undefined,
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

// `liveGroup.rides` drives `liveClaimById` inside the panel — that's the
// thing the routing logic inspects to pick the pre-step.
let liveGroup: { id: number; rides: ClaimResponse[] } = { id: 1, rides: [] };

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

mock.module("@workspace/api-client-react", {
  namedExports: {
    useGetInvoiceGroup: () => inertQuery(liveGroup as never),
    useListErrorTypes: () =>
      inertQuery([
        { id: 7, name: "Duplicate Charge", category: "Billing", description: "" },
      ] as never),
    useClassifyLeg: makeRecording("classify"),
    useExcludeLeg: makeRecording("exclude"),
    useIncludeLeg: makeRecording("include"),
    useReclassifyLeg: makeRecording("reclassify"),
    useCreateErrorType: () => ({
      mutate: () => {},
      mutateAsync: async () => ({ id: 0 }),
      isPending: false,
    }),
    getListInvoiceGroupsQueryKey: () => ["groups"],
    getListErrorTypesQueryKey: () => ["err-types"],
    getGetInvoiceGroupQueryKey: () => ["invoice-group"],
  },
});

const React = await import("react");
const {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { QueueNeedsReviewPanel } = await import("./queue-needs-review-panel");

void React;

function buildClaim(over: Partial<ClaimResponse> & { id: number }): ClaimResponse {
  return {
    confNumber: `CLM-${over.id}`,
    status: "Needs Evidence",
    outcome: "Pending",
    includedInDispute: true,
    duplicateOfClaimId: null,
    sopOutcome: null,
    errorTypeId: null,
    errorTypeName: null,
    holdReason: null,
    ...over,
  } as unknown as ClaimResponse;
}

function buildInbox(legId: number, opts: { errorTypeId?: string | null } = {}): NeedsClassificationInboxGroup {
  return {
    id: 1,
    invoiceNumber: "INV-1",
    status: "Needs Evidence",
    rideCount: 1,
    totalAmount: "100.00",
    clientNumber: "PAYOR-X",
    needsClassificationCount: 0,
    qualifyingSiblingCount: 1,
    allBlank: false,
    claims: [
      {
        id: legId,
        confNumber: `CLM-${legId}`,
        date: null,
        claimAmount: "100.00",
        errorDetails: "Some details so the row is not 'blank'",
        isBlank: false,
        ...(opts.errorTypeId !== undefined ? { errorTypeId: opts.errorTypeId } : {}),
      },
    ],
  } as unknown as NeedsClassificationInboxGroup;
}

function mount(inbox: NeedsClassificationInboxGroup, highlightLegId: number, onCompleted: (m: string) => void) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(QueueNeedsReviewPanel, {
        inboxGroup: inbox,
        highlightLegId,
        onCompleted,
        initialErrorTypeIds: { [highlightLegId]: null },
      }),
    ),
  );
}

async function pickAndClassify(legId: number) {
  // The Radix <Select> renders a button per option; the simplest reliable
  // path in jsdom is to set the underlying form state by clicking the
  // trigger then the option. The panel exposes a stable test id on the
  // trigger and on the Classify button per leg.
  const trigger = screen.getByTestId(`select-claim-error-type-${legId}`);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  // Radix portals options to document.body; query by role.
  const option = await waitFor(() => {
    const found = screen.queryByText("Duplicate Charge");
    if (!found) throw new Error("option not yet rendered");
    return found;
  });
  fireEvent.click(option);
  const classifyBtn = screen.getByTestId(`button-classify-claim-${legId}`);
  await act(async () => {
    fireEvent.click(classifyBtn);
  });
}

test("single-leg Classify on an EXCLUDED leg routes /include then /classify and reports reclassified", async (t) => {
  t.after(cleanup);
  calls.length = 0;
  const legId = 501;
  const live = buildClaim({ id: legId, includedInDispute: false }); // → excluded
  liveGroup = { id: 1, rides: [live] };
  let completedMessage = "";
  mount(buildInbox(legId), legId, (m) => { completedMessage = m; });

  await pickAndClassify(legId);

  await waitFor(() => {
    assert.equal(calls.length, 2, `expected 2 mutation calls, got ${calls.length} (${JSON.stringify(calls)})`);
  });
  assert.equal(calls[0].hook, "include", "first call must be /include");
  assert.equal(calls[0].id, legId);
  assert.equal(calls[1].hook, "classify", "second call must be /classify");
  assert.equal(calls[1].id, legId);
  await waitFor(() => {
    assert.match(completedMessage, /reclassified as/i,
      `onCompleted message must say "reclassified", got: ${completedMessage}`);
  });
});

test("single-leg Classify on an ALREADY-CLASSIFIED leg routes /reclassify then /classify and reports reclassified", async (t) => {
  t.after(cleanup);
  calls.length = 0;
  const legId = 502;
  // errorTypeId set + no SOP terminal → derives to `investigating`.
  const live = buildClaim({ id: legId, errorTypeId: "11", errorTypeName: "Old" });
  liveGroup = { id: 1, rides: [live] };
  let completedMessage = "";
  mount(buildInbox(legId, { errorTypeId: "11" }), legId, (m) => { completedMessage = m; });

  await pickAndClassify(legId);

  await waitFor(() => {
    assert.equal(calls.length, 2, `expected 2 mutation calls, got ${calls.length} (${JSON.stringify(calls)})`);
  });
  assert.equal(calls[0].hook, "reclassify", "first call must be /reclassify");
  assert.equal(calls[0].id, legId);
  assert.equal(calls[1].hook, "classify", "second call must be /classify");
  assert.equal(calls[1].id, legId);
  await waitFor(() => {
    assert.match(completedMessage, /reclassified as/i,
      `onCompleted message must say "reclassified", got: ${completedMessage}`);
  });
});

test("single-leg Classify on a NEEDS_CLASSIFICATION leg posts /classify only and reports classified", async (t) => {
  t.after(cleanup);
  calls.length = 0;
  const legId = 503;
  const live = buildClaim({ id: legId }); // → needs_classification
  liveGroup = { id: 1, rides: [live] };
  let completedMessage = "";
  mount(buildInbox(legId), legId, (m) => { completedMessage = m; });

  await pickAndClassify(legId);

  await waitFor(() => {
    assert.equal(calls.length, 1, `expected 1 mutation call, got ${calls.length} (${JSON.stringify(calls)})`);
  });
  assert.equal(calls[0].hook, "classify");
  assert.equal(calls[0].id, legId);
  await waitFor(() => {
    assert.match(completedMessage, /^Claim .* classified as/i,
      `onCompleted message must say "classified" (not reclassified), got: ${completedMessage}`);
  });
});

// Task #835 — Optimistic-flip coverage for the QueueNeedsReviewPanel
// surfaces wired through useOptimisticMutation.
//
//   • Bulk reclassify: every visible leg's errorTypeId flips in the
//     group cache up front. On a per-leg failure inside the loop, the
//     succeeded legs keep the flip and the skipped legs roll back —
//     preserving the {succeeded, skipped} partial-failure contract.
//   • Per-row Mark no-issue: standardized rollback toast on failure.

import "./decision-tree/terminals/_setup-jsdom.ts";

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

interface ToastCall { title?: unknown; description?: unknown; variant?: unknown }
const toastCalls: ToastCall[] = [];

// Track classify-leg failures per id: if `failClassifyIds` contains the id
// the mutateAsync rejects, otherwise resolves. Lets the bulk loop produce
// a real partial failure.
const failClassifyIds = new Set<number>();
let failExclude = false;
const calls: Array<{ hook: string; id: number; data?: unknown }> = [];

mock.module("wouter", {
  namedExports: {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      React.createElement("a", { href, ...rest }, children),
    useLocation: () => ["/", () => {}],
  },
});

mock.module("@/hooks/use-toast", {
  namedExports: {
    useToast: () => ({ toast: (p: ToastCall) => toastCalls.push(p) }),
    toast: (p: ToastCall) => toastCalls.push(p),
    successToast: () => undefined,
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

let liveGroup: { id: number; rides: ClaimResponse[] } = { id: 1, rides: [] };

mock.module("@workspace/api-client-react", {
  namedExports: {
    useGetInvoiceGroup: () => inertQuery(liveGroup as never),
    useListErrorTypes: () =>
      inertQuery([
        { id: 7, name: "Duplicate Charge", category: "Billing", description: "" },
      ] as never),
    useClassifyLeg: () => ({
      mutateAsync: async (vars: { id: number; data?: unknown }) => {
        calls.push({ hook: "classify", id: vars.id, data: vars.data });
        if (failClassifyIds.has(vars.id)) throw new Error(`classify boom #${vars.id}`);
        return undefined;
      },
      isPending: false,
    }),
    useExcludeLeg: () => ({
      mutateAsync: async (vars: { id: number; data?: unknown }) => {
        calls.push({ hook: "exclude", id: vars.id, data: vars.data });
        if (failExclude) throw new Error("exclude server boom");
        return undefined;
      },
      isPending: false,
    }),
    useIncludeLeg: () => ({
      mutateAsync: async (vars: { id: number; data?: unknown }) => {
        calls.push({ hook: "include", id: vars.id, data: vars.data });
        return undefined;
      },
      isPending: false,
    }),
    useReclassifyLeg: () => ({
      mutateAsync: async (vars: { id: number; data?: unknown }) => {
        calls.push({ hook: "reclassify", id: vars.id, data: vars.data });
        return undefined;
      },
      isPending: false,
    }),
    useCreateErrorType: () => ({
      mutateAsync: async () => ({ id: 0 }),
      isPending: false,
    }),
    getListInvoiceGroupsQueryKey: () => ["groups"],
    getListErrorTypesQueryKey: () => ["err-types"],
    getGetInvoiceGroupQueryKey: (id: number) => ["invoice-group", id],
  },
});

const React = await import("react");
const { render, screen, fireEvent, waitFor, cleanup, act } = await import("@testing-library/react");
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

function buildInbox(legIds: number[]): NeedsClassificationInboxGroup {
  return {
    id: 1,
    invoiceNumber: "INV-1",
    status: "Needs Evidence",
    rideCount: legIds.length,
    totalAmount: "100.00",
    clientNumber: "PAYOR-X",
    needsClassificationCount: legIds.length,
    qualifyingSiblingCount: 0,
    allBlank: false,
    claims: legIds.map((id) => ({
      id,
      confNumber: `CLM-${id}`,
      date: null,
      claimAmount: "100.00",
      errorDetails: "Has details so the row is not blank",
      isBlank: false,
    })),
  } as unknown as NeedsClassificationInboxGroup;
}

function mount(inbox: NeedsClassificationInboxGroup, qc: import("@tanstack/react-query").QueryClient, onCompleted: (m: string) => void) {
  return render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(QueueNeedsReviewPanel, { inboxGroup: inbox, onCompleted }),
    ),
  );
}

async function pickBulkErrorType() {
  const trigger = screen.getByTestId("select-bulk-reclassify-error-type");
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.click(trigger);
  const option = await waitFor(() => {
    const found = screen.queryByText("Duplicate Charge");
    if (!found) throw new Error("option not yet rendered");
    return found;
  });
  fireEvent.click(option);
}

test("bulk reclassify partial-failure rolls back ONLY the skipped legs and standardized toast cites succeeded/skipped", async (t) => {
  t.after(cleanup);
  toastCalls.length = 0;
  calls.length = 0;
  failClassifyIds.clear();
  failExclude = false;

  const legIds = [101, 102, 103];
  // Make leg 102 fail at classify so we get one skipped + two succeeded.
  failClassifyIds.add(102);
  liveGroup = { id: 1, rides: legIds.map((id) => buildClaim({ id })) };

  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(["invoice-group", 1], { id: 1, rides: liveGroup.rides });

  let completed = "";
  mount(buildInbox(legIds), qc, (m) => { completed = m; });

  await pickBulkErrorType();
  const applyBtn = screen.getByTestId("button-bulk-reclassify");
  await act(async () => {
    fireEvent.click(applyBtn);
  });

  await waitFor(() => {
    assert.equal(calls.filter((c) => c.hook === "classify").length, 3,
      "all three legs must attempt classify");
  });

  // Cache must reflect partial-failure truth: succeeded legs flipped,
  // skipped leg rolled back to its prior (null) errorType.
  const cached = qc.getQueryData<{ rides: ClaimResponse[] }>(["invoice-group", 1])!;
  const byId = new Map(cached.rides.map((r) => [r.id, r] as const));
  assert.equal(byId.get(101)?.errorTypeId, "7", "leg 101 flip must persist (succeeded)");
  assert.equal(byId.get(101)?.errorTypeName, "Duplicate Charge");
  assert.equal(byId.get(103)?.errorTypeId, "7", "leg 103 flip must persist (succeeded)");
  assert.equal(byId.get(102)?.errorTypeId, null, "leg 102 must roll back (skipped)");
  assert.equal(byId.get(102)?.errorTypeName, null);

  // Partial-failure toast must NOT be the all-failed rollback title; it
  // must cite succeeded + skipped counts so the operator can act.
  await waitFor(() => {
    assert.ok(toastCalls.length >= 1, "partial-failure toast must fire");
  });
  const partial = toastCalls.find((c) => /partial/i.test(String(c.title)));
  assert.ok(partial, `expected a partial-failure toast, got: ${JSON.stringify(toastCalls)}`);
  assert.match(String(partial!.title), /2 succeeded, 1 skipped/);
  assert.equal(completed, "", "onCompleted must NOT fire on partial failure");
});

test("bulk reclassify all-failed fires the standardized rollback toast and reverts every leg", async (t) => {
  t.after(cleanup);
  toastCalls.length = 0;
  calls.length = 0;
  failClassifyIds.clear();
  failExclude = false;

  const legIds = [201, 202];
  legIds.forEach((id) => failClassifyIds.add(id));
  liveGroup = { id: 1, rides: legIds.map((id) => buildClaim({ id })) };

  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(["invoice-group", 1], { id: 1, rides: liveGroup.rides });

  mount(buildInbox(legIds), qc, () => {});

  await pickBulkErrorType();
  await act(async () => {
    fireEvent.click(screen.getByTestId("button-bulk-reclassify"));
  });

  await waitFor(() => {
    assert.equal(calls.filter((c) => c.hook === "classify").length, 2);
  });
  const cached = qc.getQueryData<{ rides: ClaimResponse[] }>(["invoice-group", 1])!;
  for (const r of cached.rides) {
    assert.equal(r.errorTypeId, null, `leg ${r.id} must roll back on all-failed`);
  }
  await waitFor(() => {
    const rollback = toastCalls.find((c) => /Couldn't reclassify legs — reverted/.test(String(c.title)));
    assert.ok(rollback, `expected standardized rollback toast; got: ${JSON.stringify(toastCalls)}`);
    assert.equal(rollback!.variant, "destructive");
  });
});

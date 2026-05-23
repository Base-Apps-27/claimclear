// Task #835 — Optimistic-flip coverage for the "Queue for re-attest"
// surface in ReattestModal.
//
//   • success: approved legs flip attestationState='queued' and the
//     group stamps `awaitingPayorAgainAt` in the group cache before
//     the network call resolves.
//   • failure: cache rolls back to the pre-mutation snapshot AND a
//     destructive toast surfaces the standardized rollback title.

import "../decision-tree/terminals/_setup-jsdom.ts";

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";

interface ToastCall { title?: unknown; description?: unknown; variant?: unknown }
const toastCalls: ToastCall[] = [];

let queueResult: { queuedLegIds: number[] } | Error = { queuedLegIds: [10, 11] };
const queueCalls: Array<{ id: number; data: unknown }> = [];

mock.module("@/hooks/use-toast", {
  namedExports: {
    useToast: () => ({ toast: (p: ToastCall) => toastCalls.push(p) }),
    toast: (p: ToastCall) => toastCalls.push(p),
    successToast: () => undefined,
  },
});

mock.module("@/hooks/use-session-milestones", {
  namedExports: {
    notifyClaimProcessedThisSession: () => {},
  },
});

mock.module("@workspace/api-client-react", {
  namedExports: {
    useCompleteGroupReattest: () => ({
      mutateAsync: async () => undefined,
      isPending: false,
    }),
    useBulkQueueGroupReattest: () => ({
      mutateAsync: async (vars: { id: number; data: unknown }) => {
        queueCalls.push(vars);
        if (queueResult instanceof Error) throw queueResult;
        return queueResult;
      },
      isPending: false,
    }),
    getGetInvoiceGroupQueryKey: (id: number) => ["invoice-group", id],
  },
});

const React = await import("react");
const { render, fireEvent, act, cleanup, waitFor } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ReattestModal } = await import("./reattest-modal");

void React;

function makeApproved(id: number) {
  return {
    id,
    confNumber: `CLM-${id}`,
    errorTypeName: "Test Error",
    invoiceNumbers: "INV-1",
    attestationState: "pending",
    attestationQueuedAt: null,
  } as unknown as import("@workspace/api-client-react").ClaimResponse;
}

function mount(opts: { groupId: number; approvedIds: number[]; promoteDraftsFails?: boolean }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(["invoice-group", opts.groupId], {
    id: opts.groupId,
    invoiceNumber: "INV-1",
    awaitingPayorAgainAt: null,
    rides: opts.approvedIds.map(makeApproved),
  });
  let afterMsg = "";
  const view = render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(ReattestModal, {
        open: true,
        onOpenChange: () => {},
        group: {
          id: opts.groupId,
          invoiceNumber: "INV-1",
          rideCount: opts.approvedIds.length,
        } as unknown as import("@workspace/api-client-react").InvoiceGroupResponse,
        approvedLegs: opts.approvedIds.map(makeApproved),
        deniedLegs: [],
        promoteDrafts: async () => {
          if (opts.promoteDraftsFails) throw new Error("promote boom");
        },
        onAfterAction: (m: string) => { afterMsg = m; },
      }),
    ),
  );
  return { qc, view, getAfterMsg: () => afterMsg };
}

async function clickIntoQueueAndSubmit() {
  // Step 1 — click the "Queue for later" pick button.
  const pickQueue = document.body.querySelector(
    '[data-testid="reattest-pick-queue"]',
  ) as HTMLElement | null;
  // Fall back to text match if the testid differs.
  const queueBtn = pickQueue
    ?? Array.from(document.body.querySelectorAll("button")).find(
      (b) => /queue for re-attest later/i.test(b.textContent ?? ""),
    ) as HTMLElement | undefined;
  assert.ok(queueBtn, "queue mode pick button must render");
  await act(async () => { fireEvent.click(queueBtn!); });

  // Step 2 — primary Queue button opens the double-confirm dialog.
  const primary = document.body.querySelector(
    '[data-testid="reattest-queue-confirm"]',
  ) as HTMLElement | null;
  assert.ok(primary, "primary queue button must render in queue mode");
  await act(async () => { fireEvent.click(primary!); });

  // Step 3 — confirm send.
  const send = await waitFor(() => {
    const el = document.body.querySelector(
      '[data-testid="reattest-queue-confirm-send"]',
    ) as HTMLElement | null;
    if (!el) throw new Error("confirm-send not yet rendered");
    return el;
  });
  await act(async () => { fireEvent.click(send); });
}

test("success: approved legs flip to queued + group stamps awaitingPayorAgainAt before server resolves", async (t) => {
  t.after(cleanup);
  toastCalls.length = 0;
  queueCalls.length = 0;
  queueResult = { queuedLegIds: [10, 11] };

  const { qc, getAfterMsg } = mount({ groupId: 42, approvedIds: [10, 11] });

  await clickIntoQueueAndSubmit();

  await waitFor(() => {
    assert.equal(queueCalls.length, 1, "bulk-queue endpoint must be called once");
  });
  const cached = qc.getQueryData<{
    awaitingPayorAgainAt: string | null;
    rides: Array<{ id: number; attestationState: string; attestationQueuedAt: string | null }>;
  }>(["invoice-group", 42])!;
  assert.ok(cached.awaitingPayorAgainAt, "awaitingPayorAgainAt must be stamped optimistically");
  for (const r of cached.rides) {
    assert.equal(r.attestationState, "queued", `leg ${r.id} must flip to queued`);
    assert.ok(r.attestationQueuedAt, `leg ${r.id} must stamp queuedAt`);
  }
  await waitFor(() => {
    assert.match(getAfterMsg(), /Queued 2 legs for re-attestation/);
  });
  assert.equal(toastCalls.length, 0, "no destructive toast on success");
});

test("failure: snapshot rolls back the optimistic flip AND standardized destructive toast fires", async (t) => {
  t.after(cleanup);
  toastCalls.length = 0;
  queueCalls.length = 0;
  queueResult = new Error("queue server boom");

  const { qc, getAfterMsg } = mount({ groupId: 55, approvedIds: [20, 21] });

  await clickIntoQueueAndSubmit();

  await waitFor(() => {
    assert.equal(toastCalls.length, 1, "destructive toast must fire on failure");
  });
  const cached = qc.getQueryData<{
    awaitingPayorAgainAt: string | null;
    rides: Array<{ id: number; attestationState: string; attestationQueuedAt: string | null }>;
  }>(["invoice-group", 55])!;
  assert.equal(cached.awaitingPayorAgainAt, null, "awaitingPayorAgainAt must roll back");
  for (const r of cached.rides) {
    assert.equal(r.attestationState, "pending", `leg ${r.id} must roll back to pending`);
    assert.equal(r.attestationQueuedAt, null, `leg ${r.id} queuedAt must roll back`);
  }
  assert.equal(toastCalls[0].title, "Couldn't queue for re-attest — reverted",
    "toast must use the standardized rollback copy");
  assert.equal(toastCalls[0].variant, "destructive");
  assert.match(String(toastCalls[0].description), /queue server boom/);
  assert.equal(getAfterMsg(), "", "onAfterAction must NOT fire on failure");
});

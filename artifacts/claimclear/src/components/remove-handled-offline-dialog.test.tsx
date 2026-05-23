// Task #835 — Optimistic flip + rollback coverage for the
// "Remove — handled offline" dialog.
//
// Pins two scenarios:
//   • success path: the leg's group-cache row flips
//     `includedInDispute=false` + `dropReason='handled_offline'`
//     before the network call resolves, and the success message
//     fires after the mutationFn settles.
//   • failure path: on a server error the cache rolls back to the
//     pre-mutation snapshot AND a destructive toast surfaces the
//     standardized rollback title.

import "./decision-tree/terminals/_setup-jsdom.ts";

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";

interface ToastCall {
  title?: unknown;
  description?: unknown;
  variant?: unknown;
}
const toastCalls: ToastCall[] = [];
const successToastCalls: ToastCall[] = [];

mock.module("@/hooks/use-toast", {
  namedExports: {
    useToast: () => ({ toast: (p: ToastCall) => toastCalls.push(p) }),
    toast: (p: ToastCall) => toastCalls.push(p),
    successToast: (p: ToastCall) => successToastCalls.push(p),
  },
});

let nextServerResult: { ok: true } | Error = { ok: true };
const excludeCalls: Array<{ id: number; data: unknown }> = [];

mock.module("@workspace/api-client-react", {
  namedExports: {
    useExcludeLeg: () => ({
      mutateAsync: async (vars: { id: number; data: unknown }) => {
        excludeCalls.push(vars);
        if (nextServerResult instanceof Error) throw nextServerResult;
        return nextServerResult;
      },
      isPending: false,
    }),
    getGetClaimQueryKey: (id: number) => ["claim", id],
    getGetInvoiceGroupQueryKey: (id: number) => ["invoice-group", id],
    getListInvoiceGroupsQueryKey: () => ["invoice-groups"],
    getListClaimAuditLogsQueryKey: (id: number) => ["audit", id],
  },
});

const React = await import("react");
const { render, fireEvent, act, cleanup, waitFor } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { RemoveHandledOfflineDialog } = await import("./remove-handled-offline-dialog");

void React;

function mount(opts: { claimId: number; groupId: number; onRemoved: () => void }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(["invoice-group", opts.groupId], {
    id: opts.groupId,
    rides: [
      {
        id: opts.claimId,
        includedInDispute: true,
        dropReason: null,
      },
    ],
  });
  const view = render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(RemoveHandledOfflineDialog, {
        open: true,
        onOpenChange: () => {},
        claimId: opts.claimId,
        groupId: opts.groupId,
        onRemoved: opts.onRemoved,
      }),
    ),
  );
  return { view, qc };
}

async function fillAndSubmit() {
  // Radix Dialog portals content to document.body so we query there.
  const textarea = document.body.querySelector("textarea") as HTMLTextAreaElement | null;
  assert.ok(textarea, "textarea must render once dialog is open");
  await act(async () => {
    fireEvent.change(textarea!, {
      target: { value: "Talked to payor offline, ok." },
    });
  });
  const checkbox = document.body.querySelector(
    'button[role="checkbox"]',
  ) as HTMLElement | null;
  assert.ok(checkbox, "confirm checkbox must render");
  await act(async () => {
    fireEvent.click(checkbox!);
  });
  const submit = document.body.querySelector(
    '[data-testid="remove-handled-offline-confirm"]',
  ) as HTMLElement | null;
  assert.ok(submit, "submit button must render");
  await act(async () => {
    fireEvent.click(submit!);
  });
}

test("success: leg flips in group cache before server resolves and success toast fires", async (t) => {
  t.after(cleanup);
  toastCalls.length = 0;
  successToastCalls.length = 0;
  excludeCalls.length = 0;
  nextServerResult = { ok: true };

  let removed = false;
  const { qc } = mount({ claimId: 999, groupId: 7, onRemoved: () => { removed = true; } });

  await fillAndSubmit();

  await waitFor(() => {
    assert.equal(excludeCalls.length, 1);
  });
  const cached = qc.getQueryData<{ rides: Array<{ id: number; includedInDispute: boolean; dropReason: string | null }> }>(
    ["invoice-group", 7],
  );
  assert.ok(cached, "group cache should exist");
  const leg = cached!.rides.find((r) => r.id === 999)!;
  assert.equal(leg.includedInDispute, false, "leg should be flipped excluded");
  assert.equal(leg.dropReason, "handled_offline", "dropReason should be stamped");
  assert.equal(excludeCalls[0].id, 999);
  await waitFor(() => {
    assert.equal(successToastCalls.length, 1, "success toast must fire on resolve");
  });
  assert.equal(removed, true, "onRemoved callback fired");
  assert.equal(toastCalls.length, 0, "no destructive toast on success");
});

test("failure: snapshot rolls back the leg flip and standardized destructive toast fires", async (t) => {
  t.after(cleanup);
  toastCalls.length = 0;
  successToastCalls.length = 0;
  excludeCalls.length = 0;
  nextServerResult = new Error("server exploded");

  let removed = false;
  const { qc } = mount({ claimId: 1001, groupId: 11, onRemoved: () => { removed = true; } });

  await fillAndSubmit();

  await waitFor(() => {
    assert.equal(toastCalls.length, 1, "destructive toast must fire on failure");
  });
  const cached = qc.getQueryData<{ rides: Array<{ id: number; includedInDispute: boolean; dropReason: string | null }> }>(
    ["invoice-group", 11],
  );
  const leg = cached!.rides.find((r) => r.id === 1001)!;
  assert.equal(leg.includedInDispute, true, "leg must roll back to includedInDispute=true");
  assert.equal(leg.dropReason, null, "dropReason must roll back to null");
  assert.equal(toastCalls[0].title, "Couldn't remove leg — reverted",
    "toast title must use the standardized rollback copy");
  assert.equal(toastCalls[0].variant, "destructive");
  assert.match(String(toastCalls[0].description), /server exploded/);
  assert.equal(successToastCalls.length, 0, "no success toast on failure");
  assert.equal(removed, false, "onRemoved must NOT fire on failure");
});

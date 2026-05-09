// Task #555 — interactive coverage for the MAS Action checklist that
// now lives on `invoice-group-detail-v2`. The component drives two
// async write paths (per-leg cancel + group re-attest) and gates the
// re-attest row until every cancel is checked off, so we exercise:
//
//   1. The empty-state branch (no cancels, no pending re-attest).
//   2. The gated state — pending cancel keeps the re-attest disabled +
//      shows the gate alert.
//   3. The completion handshake — checking the cancel checkbox calls
//      the per-leg handler, and when the group is later refreshed
//      with no pending cancels the re-attest row unlocks and its
//      handler fires.
import { test, mock } from "node:test";
import { strict as assert } from "node:assert";

mock.module("@/components/attestation/utils", {
  namedExports: {
    firstInvoiceToken: (c: { invoiceTokens?: string[] }) =>
      c.invoiceTokens?.[0] ?? null,
  },
});

const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost/",
});
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.MouseEvent = dom.window.MouseEvent;
g.KeyboardEvent = dom.window.KeyboardEvent;
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
try {
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
} catch {
  // Node 24 navigator is a non-configurable getter; React only reads
  // userAgent for warnings, so leaving the built-in is harmless.
}

const React = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

const { MasActionChecklist } = await import("./mas-action-checklist");
type ClaimResponse = import("@workspace/api-client-react").ClaimResponse;
type InvoiceGroupDetailResponse =
  import("@workspace/api-client-react").InvoiceGroupDetailResponse;

void React;

function leg(over: Partial<ClaimResponse> & { id: number }): ClaimResponse {
  return {
    confNumber: `CLM-${over.id}`,
    status: "MAS Eligible",
    outcome: "Approved",
    includedInDispute: true,
    duplicateOfClaimId: null,
    masActionRequired: "cancel",
    masActionCompletedAt: null,
    masActionCompletedBy: null,
    invoiceTokens: ["INV-100"],
    ...over,
  } as unknown as ClaimResponse;
}

function group(
  rides: ClaimResponse[],
  over: Partial<InvoiceGroupDetailResponse> = {},
): InvoiceGroupDetailResponse {
  return {
    id: 1,
    invoiceNumber: "INV-100",
    rides,
    reattestRequired: true,
    reattestCompletedAt: null,
    ...over,
  } as unknown as InvoiceGroupDetailResponse;
}

function mountInDom(node: import("react").ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    cleanup: () =>
      act(() => {
        root.unmount();
        container.remove();
      }),
  };
}

test("mas-checklist: empty state when no cancels and no re-attest owed", () => {
  const { container, cleanup } = mountInDom(
    React.createElement(MasActionChecklist, {
      group: group([], { reattestRequired: false }),
      onCompleteLegMasAction: async () => {},
      onCompleteGroupReattest: async () => {},
    }),
  );
  assert.ok(container.querySelector('[data-testid="mas-action-empty"]'));
  cleanup();
});

test("mas-checklist: pending cancel gates the re-attest row", () => {
  const g = group([leg({ id: 11 })]);
  const { container, cleanup } = mountInDom(
    React.createElement(MasActionChecklist, {
      group: g,
      onCompleteLegMasAction: async () => {},
      onCompleteGroupReattest: async () => {},
    }),
  );
  assert.ok(
    container.querySelector('[data-testid="mas-cancel-row-pending-11"]'),
    "pending cancel row renders",
  );
  assert.ok(
    container.querySelector('[data-testid="reattest-gate"]'),
    "re-attest gate alert renders while a cancel is still pending",
  );
  const reattestCb = container.querySelector(
    '[data-testid="checkbox-reattest"]',
  ) as HTMLButtonElement | null;
  assert.equal(
    reattestCb?.getAttribute("data-disabled"),
    "",
    "re-attest checkbox is disabled while gated",
  );
  cleanup();
});

test("mas-checklist: completing every cancel unlocks the re-attest row and fires its handler", async () => {
  const cancelCalls: number[] = [];
  const reattestCalls: Array<{ note?: string; masReference?: string }> = [];

  // Two-render dance: first render with the cancel still pending; we
  // toggle the checkbox to fire the per-leg handler. The component
  // then re-renders with the cancel marked complete (server-side
  // refresh would do this in production), the re-attest gate clears,
  // and we toggle the re-attest checkbox to fire its handler.
  const pendingGroup = group([leg({ id: 11 })]);
  const completedGroup = group([
    leg({
      id: 11,
      masActionCompletedAt: "2026-01-02T00:00:00Z",
      masActionCompletedBy: "tester@example.com",
    }),
  ]);

  let currentGroup = pendingGroup;
  function render() {
    return React.createElement(MasActionChecklist, {
      group: currentGroup,
      onCompleteLegMasAction: async (claimId) => {
        cancelCalls.push(claimId);
      },
      onCompleteGroupReattest: async (body) => {
        reattestCalls.push(body);
      },
    });
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(render());
  });

  const cancelCb = container.querySelector(
    '[data-testid="checkbox-mas-11"]',
  ) as HTMLButtonElement | null;
  assert.ok(cancelCb, "cancel checkbox is mounted");
  await act(async () => {
    cancelCb!.click();
  });
  assert.deepEqual(cancelCalls, [11], "per-leg cancel handler invoked once");

  // Simulate the server refresh swapping in the completed leg.
  currentGroup = completedGroup;
  await act(async () => {
    root.render(render());
  });
  assert.ok(
    container.querySelector('[data-testid="mas-cancel-row-done-11"]'),
    "completed cancel row renders after re-render",
  );
  assert.ok(
    container.querySelector('[data-testid="reattest-ready"]'),
    "re-attest ready alert renders once gate clears",
  );

  const reattestCb = container.querySelector(
    '[data-testid="checkbox-reattest"]',
  ) as HTMLButtonElement | null;
  await act(async () => {
    reattestCb!.click();
  });
  assert.equal(reattestCalls.length, 1, "group re-attest handler invoked once");

  await act(async () => {
    root.unmount();
  });
  container.remove();
});

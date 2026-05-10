// Component tests for <InlineGroupWorkspaceMini /> — Task #682d.

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";

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
g.location = dom.window.location;
g.addEventListener = dom.window.addEventListener.bind(dom.window);
g.removeEventListener = dom.window.removeEventListener.bind(dom.window);
g.history = dom.window.history;
g.IS_REACT_ACT_ENVIRONMENT = true;
try {
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
} catch {
  // Node 24's navigator getter isn't configurable; React only reads it
  // for warnings.
}

const inertMutation = () => ({
  mutateAsync: async () => null,
  mutate: () => {},
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null,
  data: null,
  reset: () => {},
});

let removeLegHoldCalls: Array<{ id: number }> = [];
const removeLegHoldHook = () => ({
  ...inertMutation(),
  mutate: (vars: { id: number }) => {
    removeLegHoldCalls.push(vars);
  },
});

let currentDetail: unknown = null;
let currentLegParam = "";

mock.module("@workspace/api-client-react", {
  namedExports: {
    useGetInvoiceGroup: () => ({ data: currentDetail, isLoading: !currentDetail }),
    useGetClaim: () => ({ data: null }),
    useHoldInvoiceGroup: inertMutation,
    usePlaceLegOnHold: inertMutation,
    useRemoveInvoiceGroupHold: inertMutation,
    useRemoveLegHold: removeLegHoldHook,
    useListErrorTypes: () => ({ data: [] }),
    useCreatePortalSubmission: inertMutation,
    useClearLegVerdictDraft: inertMutation,
    useExcludeLeg: inertMutation,
    getGetClaimQueryKey: (id: number) => ["claim", id],
    getGetInvoiceGroupValidTransitionsQueryKey: (id: number) => [
      "invoice-group",
      id,
      "transitions",
    ],
    getGetInvoiceGroupQueryKey: (id: number) => ["invoice-group", id],
    getListInvoiceGroupsQueryKey: () => ["invoice-groups", "list"],
    ApiError: class {},
  },
});

mock.module("@/lib/use-url-params", {
  namedExports: {
    useUrlParams: () => ({
      get: (k: string) => (k === "leg" ? currentLegParam : ""),
      set: () => {},
    }),
  },
});

mock.module("@/hooks/use-toast", {
  namedExports: {
    useToast: () => ({ toast: () => {} }),
    toast: () => ({ id: "0", dismiss: () => {}, update: () => {} }),
    successToast: () => ({ id: "0", dismiss: () => {}, update: () => {} }),
  },
});

mock.module("@/hooks/use-local-action-mark", {
  namedExports: {
    markLocalAction: () => {},
    consumeLocalActionMark: () => false,
  },
});

mock.module("@/components/admin-status-override", {
  namedExports: { AdminStatusOverride: () => null },
});

// `@/lib/role` re-exports `useAuth` from a workspace package that
// node's package resolver can't find under tsx; stub the gate.
mock.module("@/lib/role", {
  namedExports: {
    HideForClerk: ({ children }: { children: React.ReactNode }) => children,
    ShowForClerk: ({ children }: { children: React.ReactNode }) => children,
    useRole: () => ({ role: "ops" }),
  },
});

mock.module("@/components/invoice-group-submission-gauntlet", {
  namedExports: { InvoiceGroupSubmissionGauntlet: () => null },
});
mock.module("@/components/invoice-group-action-slot", {
  namedExports: { InvoiceGroupActionSlot: () => null },
});
mock.module("@/components/chip-drawer-overlay", {
  namedExports: {
    ChipDrawerOverlay: () => null,
    MarkDuplicateDialog: () => null,
    legStateIcon: () => null,
  },
});
mock.module("@/components/decision-tree/sop-advance-player", {
  namedExports: { SopAdvancePlayer: () => null },
});
mock.module("@/components/classify-dialog", {
  namedExports: { ClassifyDialog: () => null },
});

const React = await import("react");
const { act } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);

const mini = await import("./inline-group-workspace-mini");
type ClaimResponse = import("@workspace/api-client-react").ClaimResponse;
type InvoiceGroupDetailResponse =
  import("@workspace/api-client-react").InvoiceGroupDetailResponse;

void React;

function withProviders(node: React.ReactElement): React.ReactElement {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: qc, children: node });
}

function renderMini(
  detail: InvoiceGroupDetailResponse,
  opts: { legParam?: number } = {},
): string {
  currentDetail = detail;
  currentLegParam = opts.legParam ? String(opts.legParam) : "";
  return renderToStaticMarkup(
    withProviders(
      React.createElement(mini.InlineGroupWorkspaceMini, { groupId: detail.id }),
    ),
  );
}

function mountMini(
  detail: InvoiceGroupDetailResponse,
  opts: { legParam?: number } = {},
) {
  currentDetail = detail;
  currentLegParam = opts.legParam ? String(opts.legParam) : "";
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      withProviders(
        React.createElement(mini.InlineGroupWorkspaceMini, { groupId: detail.id }),
      ),
    );
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

function claim(over: Partial<ClaimResponse> & { id: number }): ClaimResponse {
  return {
    confNumber: `CLM-${over.id}`,
    status: "New",
    outcome: null,
    includedInDispute: true,
    duplicateOfClaimId: null,
    sopOutcome: null,
    sopNodeId: null,
    errorTypeId: null,
    errorTypeName: null,
    holdReason: null,
    holdPendingFrom: null,
    holdPlacedAt: null,
    invoiceGroupId: 1,
    ...over,
  } as unknown as ClaimResponse;
}

function group(
  rides: ClaimResponse[],
  over: Partial<InvoiceGroupDetailResponse> = {},
): InvoiceGroupDetailResponse {
  return {
    id: 1,
    invoiceNumber: "INV-1",
    rideCount: rides.length,
    rides,
    phase: "triage",
    status: "Investigating",
    payorEmailBounceState: null,
    holdReason: null,
    holdPendingFrom: null,
    holdPlacedAt: null,
    ...over,
  } as unknown as InvoiceGroupDetailResponse;
}

test("V3 landing: classified leg with no SOP progress renders the Start-walk hero", () => {
  const a = claim({
    id: 100,
    errorTypeId: "ET-1",
    errorTypeName: "GPS Deviation",
  });
  const html = renderMini(group([a]), { legParam: 100 });

  assert.match(html, /data-testid="mini-landing-start-walk"/);
  assert.match(html, /data-testid="mini-start-walk"/);
  assert.match(html, /data-testid="mini-landing-change-classification"/);
  assert.match(html, /data-testid="mini-landing-reclassify"/);
  assert.match(html, /data-testid="mini-landing-mark-duplicate"/);
  assert.match(html, /data-testid="mini-landing-exclude"/);
  assert.match(html, /data-testid="mini-landing-group-state"/);
  assert.match(html, /GPS Deviation/);
});

// Regression — the legacy hold banner and chip-strip release button
// must not re-appear once the hero owns release.
test("V3 hold-exit: legacy banner + chip-strip release testids are gone", () => {
  const a = claim({
    id: 250,
    holdReason: "Awaiting docs",
    holdPlacedAt: "2026-05-01T10:00:00Z",
  });
  const html = renderMini(group([a]), { legParam: 250 });
  assert.doesNotMatch(html, /mini-group-hold-banner/);
  assert.doesNotMatch(html, /mini-release-leg-hold/);
  assert.doesNotMatch(html, /mini-release-group-hold/);
});

test("V3 hold-exit: leg-scoped hold renders the leg HoldHero", () => {
  const a = claim({
    id: 200,
    holdReason: "Awaiting member response",
    holdPendingFrom: "Member · phone outreach",
    holdPlacedAt: "2026-05-01T10:00:00Z",
  });
  const html = renderMini(group([a]), { legParam: 200 });

  assert.match(html, /data-testid="mini-hold-hero-leg"/);
  assert.match(html, /data-scope="leg"/);
  assert.match(html, /data-testid="mini-hold-hero-leg-clear"/);
  assert.match(html, /data-testid="mini-hold-hero-leg-reason"[^>]*>Awaiting member response</);
  assert.match(
    html,
    /data-testid="mini-hold-hero-leg-pending-from"[^>]*>Member · phone outreach</,
  );
});

test("V3 hold-exit: group-scoped hold renders the group HoldHero", () => {
  const a = claim({ id: 300 });
  // `getGroupLifecyclePhaseFromGroup` reads on-hold off the legacy
  // status string; phase column treats hold as a flag.
  const detail = group([a], {
    status: "On Hold",
    holdReason: "Awaiting payor portal response",
    holdPendingFrom: "MAS Medicaid · ticket #48211",
    holdPlacedAt: "2026-04-25T09:00:00Z",
  });
  const html = renderMini(detail, { legParam: 300 });

  assert.match(html, /data-testid="mini-hold-hero-group"/);
  assert.match(html, /data-scope="group"/);
  assert.match(html, /data-testid="mini-hold-hero-group-clear"/);
  assert.match(
    html,
    /data-testid="mini-hold-hero-group-reason"[^>]*>Awaiting payor portal response</,
  );
});

test("V3 hold-exit: clicking Clear-leg-hold calls useRemoveLegHold with the active leg id", () => {
  removeLegHoldCalls = [];
  const a = claim({
    id: 412,
    holdReason: "Awaiting member response",
    holdPlacedAt: "2026-05-01T10:00:00Z",
  });
  const { container, cleanup } = mountMini(group([a]), { legParam: 412 });

  const btn = container.querySelector(
    '[data-testid="mini-hold-hero-leg-clear"]',
  ) as HTMLButtonElement | null;
  assert.ok(btn, "Clear-leg-hold button rendered");

  act(() => {
    btn!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });

  assert.deepEqual(removeLegHoldCalls, [{ id: 412 }]);
  cleanup();
});

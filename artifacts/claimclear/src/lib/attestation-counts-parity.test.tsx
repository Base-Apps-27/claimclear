// Task #895 — Lock in the four-counter parity for "open attestations"
// so a future refactor of any one counter can't silently let them
// drift apart. Renders the AppLayout (sidebar badge) wrapped around
// the AttestationQueue page (header pill, Open tab badge, Queue
// section subhead) against a single mocked pending+queued payload
// and asserts all four show the same number.
//
// Heavy UI primitives (sidebar chrome, dropdowns, tooltips, header
// search, theme toggle, etc.) are stubbed to plain passthrough nodes
// so the test exercises the counter-derivation logic in layout.tsx +
// attestation-queue.tsx without dragging in shadcn / radix runtime
// behavior we don't care about for this contract.

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";
import type { ClaimResponse } from "@workspace/api-client-react";

// ---- URL params + routing stubs ----------------------------------------

mock.module("@/lib/use-url-params", {
  namedExports: {
    useUrlParams: () => ({
      get: (_key: string) => "",
      getAll: (_key: string) => [],
      set: () => {},
      searchParams: new URLSearchParams(),
    }),
  },
});

mock.module("wouter", {
  namedExports: {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      React.createElement("a", { href, ...rest }, children),
    useLocation: () => ["/attestation-queue", () => {}],
  },
});

mock.module("@/hooks/use-toast", {
  namedExports: {
    useToast: () => ({ toast: () => {} }),
    toast: () => ({ id: "0", dismiss: () => {}, update: () => {} }),
    successToast: () => ({ id: "0", dismiss: () => {}, update: () => {} }),
  },
});

// ---- Auth + react-query stubs ------------------------------------------

mock.module("@workspace/replit-auth-web", {
  namedExports: {
    useAuth: () => ({
      user: {
        id: "u-1",
        email: "tester@example.com",
        displayName: "Tester",
        role: "admin",
        status: "approved",
        profileImageUrl: null,
        responsibleRoles: [],
        isPortalOnly: false,
      },
      isAuthenticated: true,
      sessionExpiry: null,
      login: () => {},
      logout: () => {},
    }),
  },
});

mock.module("@tanstack/react-query", {
  namedExports: {
    useQueryClient: () => ({
      invalidateQueries: async () => {},
      getQueryCache: () => ({ getAll: () => [], subscribe: () => () => {} }),
    }),
  },
});

// ---- The single shared payload every counter must agree on -------------
//
// Three distinct invoice groups across the pending + queued lists, with
// repeated legs in one group and a NULL invoiceGroupId leg to exercise
// the `c:<claim-id>` fallback. Expected distinct-group count: 4
// (groups 100 + 200 + 300 + the ungrouped fallback).

function makeLeg(overrides: {
  id: number;
  invoiceGroupId: number | null;
  attestationState?: "pending" | "queued";
}): ClaimResponse {
  return {
    id: overrides.id,
    confNumber: `CLM-${overrides.id}`,
    status: "Awaiting Response",
    outcome: "Approved",
    disputeEmailSent: true,
    invoiceGroupId: overrides.invoiceGroupId,
    invoiceNumbers: `INV-${overrides.invoiceGroupId ?? overrides.id}`,
    clientNumber: "PAYOR-X",
    attestationState: overrides.attestationState ?? "pending",
    attestationQueuedAt: null,
    attestationQueuedBy: null,
    attestationNote: null,
    includedInDispute: true,
    masActionRequired: null,
    masActionCompletedAt: null,
    date: null,
    sopOutcome: null,
  } as unknown as ClaimResponse;
}

const pendingPayload = {
  claims: [
    makeLeg({ id: 1001, invoiceGroupId: 100 }),
    makeLeg({ id: 1002, invoiceGroupId: 100 }),
    makeLeg({ id: 2001, invoiceGroupId: 200 }),
    makeLeg({ id: 9999, invoiceGroupId: null }),
  ],
  extras: {},
};
const queuedPayload = {
  claims: [makeLeg({ id: 3001, invoiceGroupId: 300, attestationState: "queued" })],
  extras: {},
};
const EXPECTED_OPEN_COUNT = 4;

const inertQuery = <T,>(data: T) => ({
  data,
  isLoading: false,
  isError: false,
  error: null,
  isSuccess: true,
  refetch: () => Promise.resolve({ data } as never),
  queryKey: [] as never,
});
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
    useListAttestationPending: (params: { state?: string } = {}) =>
      params.state === "pending" ? inertQuery(pendingPayload) : inertQuery(queuedPayload),
    useGetInvoiceGroup: () => inertQuery(null),
    useGetInvoiceGroupAttestationHistory: () =>
      inertQuery({ groups: [], truncated: false }),
    useGetResponsesAwaitingReviewCount: () => inertQuery({ count: 0 }),
    useGetMacroPhaseRollup: () => inertQuery(null),
    useCompleteGroupReattest: inertMutation,
    useAttestClaim: inertMutation,
    useConfirmQueuedAttestation: inertMutation,
    useCompleteLegMasAction: inertMutation,
    getListAttestationPendingQueryKey: () => ["pending"],
    getGetResponsesAwaitingReviewCountQueryKey: () => ["awaiting-review"],
    getGetMacroPhaseRollupQueryKey: () => ["macro-phase"],
    getGetInvoiceGroupAttestationHistoryQueryKey: () => ["history"],
    getGetInvoiceGroupQueryKey: () => ["invoice-group"],
    getGetAttestationCountsQueryKey: () => ["attest-counts"],
    getGetDashboardSummaryQueryKey: () => ["dashboard"],
    getGetClaimQueryKey: () => ["claim"],
    getExportAttestationPendingCsvUrl: () => "/api/claims/attestation-pending/export-csv",
  },
});

// ---- Layout-only heavy primitives stubbed to passthroughs --------------
//
// We only care about the data-testid the badge renders, not the radix
// sidebar machinery around it. Stubbing here keeps the test focused on
// the counter-parity contract instead of SSR-incompatible sidebar code.

function passthrough(tag: string) {
  return ({ children, ...rest }: { children?: React.ReactNode } & Record<string, unknown>) =>
    React.createElement(tag, rest, children);
}

mock.module("@/components/ui/sidebar", {
  namedExports: {
    Sidebar: passthrough("aside"),
    SidebarContent: passthrough("div"),
    SidebarFooter: passthrough("div"),
    SidebarGroup: passthrough("div"),
    SidebarGroupAction: passthrough("button"),
    SidebarGroupContent: passthrough("div"),
    SidebarGroupLabel: passthrough("div"),
    SidebarHeader: passthrough("div"),
    SidebarMenu: passthrough("ul"),
    SidebarMenuAction: passthrough("button"),
    SidebarMenuButton: ({ children, asChild: _asChild, ...rest }: { children?: React.ReactNode; asChild?: boolean } & Record<string, unknown>) =>
      React.createElement("div", rest, children),
    SidebarMenuItem: passthrough("li"),
    SidebarProvider: passthrough("div"),
    SidebarTrigger: passthrough("button"),
  },
});

mock.module("@/components/ui/dropdown-menu", {
  namedExports: {
    DropdownMenu: passthrough("div"),
    DropdownMenuContent: passthrough("div"),
    DropdownMenuItem: passthrough("div"),
    DropdownMenuTrigger: ({ children, asChild: _asChild, ...rest }: { children?: React.ReactNode; asChild?: boolean } & Record<string, unknown>) =>
      React.createElement("div", rest, children),
  },
});

mock.module("@/components/info-tooltip", {
  namedExports: {
    WrapTooltip: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    InfoTooltip: () => null,
  },
});

mock.module("@/components/batch-status-pill", { namedExports: { BatchStatusPill: () => null } });
mock.module("@/components/state-legend", { namedExports: { StateLegend: () => null } });
mock.module("@/components/header-search", { namedExports: { HeaderSearch: () => null } });
mock.module("@/components/theme-toggle", { namedExports: { ThemeToggle: () => null } });
mock.module("@/components/session-countdown", { namedExports: { SessionCountdown: () => null } });
mock.module("@/components/streak-pip-avatar", {
  namedExports: {
    StreakPipAvatar: () => null,
    useStreakPipLiveUpdates: () => {},
  },
});
mock.module("@/components/activity-hover-card", {
  namedExports: {
    ActivityHoverCard: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  },
});
mock.module("@/components/state-badge", { namedExports: { StateBadge: () => null } });
mock.module("@/tour/admin-tour", {
  namedExports: {
    useAdminTour: () => ({ startTour: () => {}, isAvailable: false }),
  },
});
mock.module("@/tour/help-popover", { namedExports: { HelpPopover: () => null } });
mock.module("@/hooks/use-system-events", { namedExports: { useSystemEvents: () => {} } });
mock.module("@/hooks/use-session-milestones", {
  namedExports: {
    useSessionMilestonesLifecycle: () => {},
    useSessionProcessedCount: () => 0,
    notifyClaimProcessedThisSession: () => {},
  },
});
mock.module("@/hooks/use-welcome-back-toast", {
  namedExports: { useWelcomeBackWinsToast: () => {} },
});
mock.module("@/hooks/use-presence", {
  namedExports: {
    usePresence: () => ({ viewers: [], isStale: false }),
  },
});
mock.module("@/hooks/use-recent-group-visits", {
  namedExports: {
    useRecentGroupVisits: () => ({
      visits: [],
      togglePin: () => {},
      clearRecents: () => {},
      applyPhaseUpdates: () => {},
    }),
  },
});

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { AppLayout } = await import("../components/layout");
const { default: AttestationQueue } = await import("../pages/attestation-queue");

test("Task #895: sidebar badge, header pill, Open tab badge, and Queue section subhead all show the same open-attestation count", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      AppLayout,
      null,
      React.createElement(AttestationQueue),
    ),
  );

  // 1) Sidebar nav badge — emitted by layout.tsx for the Attestation
  //    Queue entry. The amber tone is the only one in use today.
  const sidebarMatch = html.match(
    /data-testid="nav-badge-attestation-queue-amber"[^>]*>\s*(\d+)\s*</,
  );
  assert.ok(sidebarMatch, "sidebar Attestation Queue badge must render");
  const sidebarCount = Number(sidebarMatch[1]);

  // 2) Header pill on the Attestation page — "{N} open".
  const headerMatch = html.match(
    /data-testid="attestation-header-count-open"[\s\S]*?>\s*(\d+)\s+open\s*</,
  );
  assert.ok(headerMatch, "Attestation header Open pill must render");
  const headerCount = Number(headerMatch[1]);

  // 3) Open tab badge — number inside the Tabs trigger.
  const tabMatch = html.match(
    /data-testid="attestation-tab-open-count"[^>]*>\s*(\d+)\s*</,
  );
  assert.ok(tabMatch, "Open tab count badge must render");
  const tabCount = Number(tabMatch[1]);

  // 4) Queue section subhead — "{N} group(s) pending".
  const subheadMatch = html.match(
    /data-testid="queue-pending-total"[^>]*>\s*(\d+)\s+groups?\s+pending\s*</,
  );
  assert.ok(subheadMatch, "Queue section subhead must render");
  const subheadCount = Number(subheadMatch[1]);

  // The contract: all four come from the shared helper, so they must
  // agree pairwise AND match the expected number for the fixture.
  assert.equal(
    sidebarCount,
    EXPECTED_OPEN_COUNT,
    `sidebar badge=${sidebarCount} expected ${EXPECTED_OPEN_COUNT} (distinct invoice groups across pending+queued)`,
  );
  assert.equal(headerCount, sidebarCount, `header pill (${headerCount}) drifted from sidebar (${sidebarCount})`);
  assert.equal(tabCount, sidebarCount, `Open tab badge (${tabCount}) drifted from sidebar (${sidebarCount})`);
  assert.equal(subheadCount, sidebarCount, `Queue subhead (${subheadCount}) drifted from sidebar (${sidebarCount})`);
});

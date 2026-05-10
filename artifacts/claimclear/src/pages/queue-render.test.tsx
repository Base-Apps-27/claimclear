// V1/V5/V6 (Task #649) — Runtime render coverage for the Queue page.
//
// This file mounts `queue.tsx` via `renderToStaticMarkup` under a
// fully mocked dependency surface so we can assert on the actual
// rendered DOM rather than on source text. Three protocols live here:
//
//   • V1 — URL ↔ control parity. For every parity-relevant URL token
//     we render the page with that token set and assert the matching
//     control's data-testid surface reflects it (chip present, lane
//     count visible, search input value bound, etc.). Control → URL
//     is covered by the helper-level matrix in
//     `queue-filter-parity.test.tsx`; the runtime mount here verifies
//     the URL → control half end-to-end.
//
//   • V5 — Wire integrity. Rendering across multiple parity URLs
//     produces zero `console.error` output, and row data-testids stay
//     stable when toggling `?group=` (compact rail) on and off.
//
//   • V6 — No currency in rendered output. The visible HTML must not
//     contain a `$` character anywhere in the queue row template.

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";

// ── URL state used by the wouter mock, reassigned per render ────────
let currentParams = new URLSearchParams("");
function setUrl(qs: string) {
  currentParams = new URLSearchParams(qs);
}

mock.module("wouter", {
  namedExports: {
    Link: ({ href, children, ...rest }: { href: string; children: unknown }) =>
      ({ type: "a", props: { href, ...rest, children } }),
    useLocation: () => ["/", () => {}],
    useSearchParams: () => [
      currentParams,
      (next: URLSearchParams) => {
        currentParams = new URLSearchParams(next.toString());
      },
    ],
  },
});

// ── Per-test row fixture ────────────────────────────────────────────
type RowFixture = {
  id: number;
  invoiceNumber: string;
  rideCount: number;
  totalAmount: string;
  clientNumber: string;
  status: string;
  isUrgent?: boolean;
  effectiveDaysLeft?: number | null;
  submittedStuck?: boolean;
  errorTypeId?: number | null;
  errorTypeName?: string | null;
  legSubStatusCounts?: Record<string, number>;
};

const baseRow = (overrides: Partial<RowFixture>): RowFixture => ({
  id: overrides.id ?? 1,
  invoiceNumber: overrides.invoiceNumber ?? `INV-${overrides.id ?? 1}`,
  rideCount: overrides.rideCount ?? 1,
  totalAmount: overrides.totalAmount ?? "0",
  clientNumber: overrides.clientNumber ?? "CLT-1",
  status: overrides.status ?? "New",
  isUrgent: overrides.isUrgent ?? false,
  effectiveDaysLeft: overrides.effectiveDaysLeft ?? 5,
  submittedStuck: overrides.submittedStuck ?? false,
  errorTypeId: overrides.errorTypeId ?? null,
  errorTypeName: overrides.errorTypeName ?? null,
  legSubStatusCounts: overrides.legSubStatusCounts ?? {},
});

let rowsByStatus: Record<string, RowFixture[]> = {
  New: [baseRow({ id: 1, invoiceNumber: "INV-1", effectiveDaysLeft: 0, isUrgent: true })],
  "Needs Evidence": [],
  "Generating Email": [],
  "Portal Queued": [],
  "On Hold": [],
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
    useListInvoiceGroups: (params: { status?: string; include?: string }) => {
      if (params?.include === "needs_classification") {
        return {
          data: {
            groups: [],
            needsClassificationInbox: { groups: [], total: 0, byStatus: {} },
          },
          isLoading: false,
          isError: false,
          isSuccess: true,
          refetch: async () => ({ data: undefined } as never),
          queryKey: [],
        };
      }
      const groups = rowsByStatus[params?.status ?? ""] ?? [];
      return {
        data: { groups, total: groups.length, today: "2026-05-10" },
        isLoading: false,
        isError: false,
        isSuccess: true,
        refetch: async () => ({ data: undefined } as never),
        queryKey: [],
      };
    },
    useListErrorTypes: () => ({
      data: [{ id: 9, name: "Underpayment" }],
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: async () => ({ data: undefined } as never),
      queryKey: [],
    }),
    getListInvoiceGroupsQueryKey: () => ["listInvoiceGroups"],
    useImportClaims: inertMutation,
    useTriageInvoiceGroup: inertMutation,
  },
});

mock.module("@tanstack/react-query", {
  namedExports: {
    useQueryClient: () => ({
      invalidateQueries: () => {},
      setQueryData: () => {},
    }),
  },
});

// Track every call to useInvoiceGroupEvents so V5 can pin behavioral
// subscription stability under filter toggles.
const groupEventsCalls: Array<unknown> = [];
function resetGroupEventsCalls() {
  groupEventsCalls.length = 0;
}
mock.module("@/hooks/use-claim-events", {
  namedExports: {
    useInvoiceGroupsListEvents: () => undefined,
    useInvoiceGroupEvents: (groupId: unknown) => {
      groupEventsCalls.push(groupId);
      return { events: [], lastEventAt: null, hasNewSinceMount: false };
    },
  },
});

mock.module("@/hooks/use-presence", {
  namedExports: {
    usePresence: () => ({ humanViewers: [], botActivity: [] }),
  },
});

mock.module("@/hooks/use-row-settle", {
  namedExports: {
    useRowSettle: <T,>(rows: T[]) => ({
      slots: rows.map((r) => ({ item: r, isSettling: false })),
    }),
  },
});

mock.module("@/lib/server-day-rollover", {
  namedExports: {
    useServerDayRolloverInvalidator: () => undefined,
    latestTodayKey: () => "2026-05-10",
  },
});

mock.module("@/lib/role", {
  namedExports: {
    HideForClerk: ({ children }: { children: unknown }) => children,
    ShowForClerk: ({ children }: { children: unknown }) => children,
  },
});

mock.module("@/components/inline-group-workspace-mini", {
  namedExports: {
    InlineGroupWorkspaceMini: () => null,
  },
});

mock.module("@/components/classify-dialog", {
  namedExports: {
    ClassifyDialog: () => null,
  },
});

mock.module("@/components/presence-banners", {
  namedExports: {
    HumanPresenceBanner: () => null,
    BotPresenceBanner: () => null,
    PresenceAvatars: () => null,
  },
});

// ── React + render harness ──────────────────────────────────────────
const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { default: QueuePage } = await import("./queue");

void React;

function renderAt(qs: string): { html: string; errors: string[] } {
  setUrl(qs);
  const errors: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const html = renderToStaticMarkup(React.createElement(QueuePage as never));
    return { html, errors };
  } finally {
    console.error = origError;
  }
}

// ── V6: no currency in rendered output ──────────────────────────────
test("V6 (rendered): queue HTML contains no `$` glyph anywhere", () => {
  rowsByStatus = {
    New: [
      baseRow({ id: 1, invoiceNumber: "INV-1", totalAmount: "150.00" }),
      baseRow({
        id: 2,
        invoiceNumber: "INV-2",
        totalAmount: "999.99",
        effectiveDaysLeft: 2,
      }),
    ],
    "Needs Evidence": [],
    "Generating Email": [],
    "Portal Queued": [],
    "On Hold": [],
  };
  const { html } = renderAt("");
  assert.equal(
    html.includes("$"),
    false,
    "rendered queue HTML must not contain any `$` glyph",
  );
});

// ── V1: URL → control parity, asserted against rendered HTML ────────
const parityUrls: Array<{ name: string; qs: string; expectInHtml: RegExp[] }> = [
  {
    name: "engagement=all",
    qs: "engagement=all",
    expectInHtml: [/data-testid="queue-active-filter-chip-engagement-all"/],
  },
  {
    name: "expiring=urgent",
    qs: "expiring=urgent",
    expectInHtml: [/data-testid="queue-active-filter-chip-expiring-today"/],
  },
  {
    name: "expiring=today-tomorrow",
    qs: "expiring=today-tomorrow",
    expectInHtml: [
      /data-testid="queue-active-filter-chip-expiring-today"/,
      /data-testid="queue-active-filter-chip-expiring-tomorrow"/,
    ],
  },
  {
    name: "outlook=ready_to_review",
    qs: "outlook=ready_to_review",
    expectInHtml: [
      /data-testid="queue-active-filter-chip-outlook-ready_to_review"/,
    ],
  },
  {
    name: "errorTypeId=9",
    qs: "errorTypeId=9",
    expectInHtml: [/data-testid="queue-active-filter-chip-errorTypeId-9"/],
  },
  {
    name: "draftReviewed=reviewed",
    qs: "draftReviewed=reviewed",
    expectInHtml: [
      /data-testid="queue-active-filter-chip-draftReviewed-reviewed"/,
    ],
  },
  {
    name: "showPastDeadline=true",
    qs: "showPastDeadline=true",
    expectInHtml: [/data-testid="queue-active-filter-chip-showPastDeadline"/],
  },
  {
    name: "qSearch",
    qs: "qSearch=INV-1",
    expectInHtml: [
      /data-testid="queue-active-filter-chip-qSearch"/,
      /data-testid="queue-search-input"[^>]*value="INV-1"/,
    ],
  },
];

for (const c of parityUrls) {
  test(`V1 (rendered): URL ?${c.qs} surfaces the matching control`, () => {
    rowsByStatus = {
      New: [baseRow({ id: 1 })],
      "Needs Evidence": [],
      "Generating Email": [],
      "Portal Queued": [],
      "On Hold": [],
    };
    const { html } = renderAt(c.qs);
    for (const re of c.expectInHtml) {
      assert.match(html, re, `${c.name}: missing ${re}`);
    }
  });
}

test("V1 (rendered): no parity-relevant URL token leaves stale chips behind", () => {
  rowsByStatus = {
    New: [baseRow({ id: 1 })],
    "Needs Evidence": [],
    "Generating Email": [],
    "Portal Queued": [],
    "On Hold": [],
  };
  const { html } = renderAt("");
  // Default URL has zero parity facets ⇒ chips strip says "No filters
  // active." and there are no chip nodes.
  assert.match(html, /No filters active\./);
  assert.equal(
    /data-testid="queue-active-filter-chip-/.test(html),
    false,
    "no chip nodes should render under the default URL",
  );
});

// ── V5: wire integrity — console clean + row-key stability ──────────
test("V5 (rendered): rendering across parity URLs produces zero console.error output", () => {
  rowsByStatus = {
    New: [baseRow({ id: 1 }), baseRow({ id: 2, effectiveDaysLeft: 3 })],
    "Needs Evidence": [],
    "Generating Email": [],
    "Portal Queued": [],
    "On Hold": [baseRow({ id: 9, status: "On Hold" })],
  };
  const allErrors: string[] = [];
  for (const c of parityUrls) {
    const { errors } = renderAt(c.qs);
    for (const e of errors) {
      // Filter the React warning that fires for unknown DOM props on
      // our stub components — those are stub artifacts, not real bugs.
      if (/unrecognized.*prop|Invalid DOM property/i.test(e)) continue;
      allErrors.push(`${c.qs}: ${e}`);
    }
  }
  assert.deepEqual(allErrors, [], `console.error fired:\n${allErrors.join("\n")}`);
});

test("V5 (rendered): row data-testids stay stable across `?group=` toggle", () => {
  rowsByStatus = {
    New: [baseRow({ id: 1 }), baseRow({ id: 2, effectiveDaysLeft: 4 })],
    "Needs Evidence": [],
    "Generating Email": [],
    "Portal Queued": [],
    "On Hold": [],
  };
  const without = renderAt("");
  const withGroup = renderAt("group=2");
  const idsFrom = (html: string) =>
    Array.from(html.matchAll(/data-testid="queue-row-(\d+)"/g))
      .map((m) => m[1])
      .sort();
  // Both renders contain the same set of row keys (compact mode hides
  // detail panels but does not re-key the rows).
  assert.deepEqual(idsFrom(without.html), idsFrom(withGroup.html));
  assert.ok(idsFrom(without.html).includes("1"));
  assert.ok(idsFrom(without.html).includes("2"));
});

test("V5 (behavioral): useInvoiceGroupEvents subscription is stable across filter toggles", () => {
  // Filter facets must not drive new event subscriptions: the hook is
  // keyed on selectedWorkflowId alone. Render at varying URLs without
  // ?group= and assert the call count stays at exactly 1 per render
  // (the lone hook invocation in queue.tsx).
  rowsByStatus = {
    New: [baseRow({ id: 1 })],
    "Needs Evidence": [],
    "Generating Email": [],
    "Portal Queued": [],
    "On Hold": [],
  };
  const callsPerUrl: Array<{ qs: string; calls: number; lastArg: unknown }> = [];
  for (const qs of [
    "",
    "expiring=urgent",
    "outlook=ready_to_review",
    "errorTypeId=9",
    "draftReviewed=reviewed",
    "showPastDeadline=true",
    "qSearch=INV-1",
  ]) {
    resetGroupEventsCalls();
    renderAt(qs);
    callsPerUrl.push({
      qs,
      calls: groupEventsCalls.length,
      lastArg: groupEventsCalls[groupEventsCalls.length - 1],
    });
  }
  // Exactly one subscription per render and the arg is the same
  // (undefined when no ?group= is set).
  for (const c of callsPerUrl) {
    assert.equal(c.calls, 1, `?${c.qs}: expected 1 useInvoiceGroupEvents call, got ${c.calls}`);
    assert.equal(
      c.lastArg ?? null,
      null,
      `?${c.qs}: subscription arg should be nullish without ?group=, got ${String(c.lastArg)}`,
    );
  }
  // With ?group=42 set, the same call count holds but the arg flips
  // to 42 — proving the hook is keyed on selectedWorkflowId alone.
  resetGroupEventsCalls();
  renderAt("group=42");
  assert.equal(groupEventsCalls.length, 1);
  assert.equal(groupEventsCalls[0], 42);
});

test("V5 (rendered): toggling filters does not cause duplicate row nodes (dedup wires through)", () => {
  // The same id appearing under two simultaneous status buckets would
  // produce duplicate DOM nodes if dedupRowsById weren't applied.
  const dup = baseRow({ id: 7, invoiceNumber: "INV-7" });
  rowsByStatus = {
    New: [dup],
    "Needs Evidence": [],
    "Generating Email": [{ ...dup }],
    "Portal Queued": [{ ...dup }],
    "On Hold": [],
  };
  const { html } = renderAt("");
  const matches = html.match(/data-testid="queue-row-7"/g) ?? [];
  assert.equal(matches.length, 1, `row 7 should appear once, saw ${matches.length}`);
});

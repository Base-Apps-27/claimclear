// Task #476 — invoice-level Re-attest CTA replaces the dispute UI
// when there are no dispute-eligible legs left.
//
// Six cases pinned here:
//   (a) outlook = has_disputable when at least one in-flight leg
//   (b) outlook = reattest_only for the 2-non-issue + 2-non-contestable shape
//   (c) outlook = nothing_to_do when every leg is non-contestable with no survivors
//   (d) reattest_only render: gauntlet absent, Re-attest CTA present
//   (e) clicking Re-attest opens ReattestModal with the correct partition
//   (f) has_disputable render: gauntlet present, Re-attest CTA absent
//
// Plus a small integration-style assertion that a `reattest_only`
// shape mounted through the slot the Queue page uses (no `bare`,
// `onJumpToLeg` set) renders the CTA and not the gauntlet — same
// surface the Queue's `InlineGroupWorkspace` mounts.

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";

const inertMutation = () => ({
  mutateAsync: async () => ({}),
  mutate: () => {},
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null,
  data: null,
  reset: () => {},
});

mock.module("@workspace/api-client-react", {
  namedExports: {
    useConfirmUnderstandingReadback: inertMutation,
    useStampPreviewGenerated: inertMutation,
    useCreatePortalSubmission: inertMutation,
    useSaveInvoiceGroupDraft: inertMutation,
    useRegenerateInvoiceGroupDraft: inertMutation,
    useMarkInvoiceGroupDraftReviewed: inertMutation,
    useCompleteGroupReattest: inertMutation,
    useBulkQueueGroupReattest: inertMutation,
    useMarkAwaitingPayorAgain: inertMutation,
    usePromoteVerdictDrafts: inertMutation,
    getGetInvoiceGroupQueryKey: (id: number) => ["invoice-group", id],
    getGetInvoiceGroupValidTransitionsQueryKey: (id: number) => [
      "invoice-group",
      id,
      "transitions",
    ],
    getListInvoiceGroupsQueryKey: () => ["invoice-groups"],
    getGetResponsesAwaitingReviewCountQueryKey: () => [
      "responses-awaiting-review-count",
    ],
  },
});

mock.module("@workspace/replit-auth-web", {
  namedExports: {
    useAuth: () => ({ user: { role: "operator" } }),
  },
});

mock.module("@/hooks/use-toast", {
  namedExports: {
    useToast: () => ({ toast: () => {} }),
    toast: () => ({ id: "0", dismiss: () => {}, update: () => {} }),
    successToast: () => ({ id: "0", dismiss: () => {}, update: () => {} }),
  },
});

mock.module("@/components/prompt-context-badge", {
  namedExports: { PromptContextBadge: () => null },
});

// Stub the closure launcher so the nothing_to_do close-out test can
// observe the open() args without mounting the heavy intake dialog.
interface CapturedClosureCall {
  target: { kind: string; id: number };
  reason: string;
}
const closureCalls: CapturedClosureCall[] = [];
function clearClosureCalls() {
  closureCalls.length = 0;
}
mock.module("@/components/closure/closure-launcher", {
  namedExports: {
    useClosureLauncher: () => ({
      open: (args: CapturedClosureCall) => {
        closureCalls.push({ target: args.target, reason: args.reason });
      },
      dialog: null,
    }),
  },
});

// Stub the heavy ReattestModal — capture the props it was last called
// with so case (e) can assert the survivor / dropped partition is
// passed through correctly.
interface CapturedModalProps {
  open: boolean;
  approvedIds: number[];
  deniedIds: number[];
}
const modalCalls: CapturedModalProps[] = [];
function clearModalCalls() {
  modalCalls.length = 0;
}
mock.module("@/components/whats-next/reattest-modal", {
  namedExports: {
    ReattestModal: (props: {
      open: boolean;
      approvedLegs: Array<{ id: number }>;
      deniedLegs: Array<{ id: number }>;
    }) => {
      modalCalls.push({
        open: props.open,
        approvedIds: props.approvedLegs.map((l) => l.id),
        deniedIds: props.deniedLegs.map((l) => l.id),
      });
      return props.open
        ? React.createElement(
            "div",
            { "data-testid": "stub-reattest-modal-open" },
            "modal-open",
          )
        : null;
    },
  },
});

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);

const {
  deriveInvoiceDisputeOutlook,
} = await import("@/lib/whats-next-derivation");
const { InvoiceGroupActionSlot } = await import(
  "./invoice-group-action-slot"
);

type ClaimResponse = import("@workspace/api-client-react").ClaimResponse;
type InvoiceGroupDetailResponse =
  import("@workspace/api-client-react").InvoiceGroupDetailResponse;

void React;

interface LegOpts {
  id: number;
  sopOutcome?: string | null;
  includedInDispute?: boolean;
  duplicateOfClaimId?: number | null;
  errorTypeId?: string | null;
  verdict?: { outcome: string; source: string } | null;
}

function leg(opts: LegOpts): ClaimResponse {
  return {
    id: opts.id,
    confNumber: `C${opts.id}`,
    status: "New",
    outcome: null,
    includedInDispute: opts.includedInDispute ?? true,
    duplicateOfClaimId: opts.duplicateOfClaimId ?? null,
    sopOutcome: opts.sopOutcome ?? null,
    errorTypeId: opts.errorTypeId ?? "ET-1",
    holdReason: null,
    latestVerdict: opts.verdict
      ? ({
          id: 1,
          claimId: opts.id,
          source: opts.verdict.source,
          outcome: opts.verdict.outcome,
          createdAt: new Date().toISOString(),
        } as unknown)
      : null,
    latestDraft: null,
  } as unknown as ClaimResponse;
}

function group(
  rides: ClaimResponse[],
  overrides: Partial<InvoiceGroupDetailResponse> = {},
): InvoiceGroupDetailResponse {
  return {
    id: 99,
    confNumber: "GRP-99",
    invoiceNumber: "INV-99",
    // Default to the canonical Task #476 Early-Re-attest state so the
    // ReattestOnlyCta's server-mirror eligibility gate
    // (`canQueueOrCompleteReattest`) passes without per-test
    // boilerplate. Tests that need to exercise blocked phases pass
    // overrides explicitly.
    status: "MAS Eligible",
    phase: "awaiting_reattestation",
    rides,
    submissions: [],
    notes: [],
    auditLogs: [],
    responses: [],
    ...overrides,
  } as unknown as InvoiceGroupDetailResponse;
}

function renderHtml(node: import("react").ReactElement): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client: qc, children: node }),
  );
}

// ─── (a) outlook = has_disputable ──────────────────────────────────
test("deriveInvoiceDisputeOutlook — has_disputable when at least one in-flight leg", () => {
  const g = group([
    leg({ id: 1, sopOutcome: "non_issue" }),
    leg({ id: 2, sopOutcome: "portal_dispute" }),
  ]);
  const r = deriveInvoiceDisputeOutlook(g, g.rides ?? []);
  assert.equal(r.outlook, "has_disputable");
});

// ─── (b) outlook = reattest_only for 2 non-issue + 2 non-contestable ─
test("deriveInvoiceDisputeOutlook — reattest_only for 2 non-issue + 2 non-contestable", () => {
  const g = group([
    leg({ id: 1, sopOutcome: "non_issue" }),
    leg({ id: 2, sopOutcome: "non_issue" }),
    leg({ id: 3, sopOutcome: "cannot_dispute" }),
    leg({ id: 4, sopOutcome: "cannot_dispute" }),
  ]);
  const r = deriveInvoiceDisputeOutlook(g, g.rides ?? []);
  assert.equal(r.outlook, "reattest_only");
  assert.deepEqual(r.survivors.map((l) => l.id).sort(), [1, 2]);
  assert.deepEqual(r.dropped.map((l) => l.id).sort(), [3, 4]);
});

// ─── (c) outlook = nothing_to_do when no survivors ─────────────────
test("deriveInvoiceDisputeOutlook — nothing_to_do when every leg is non-contestable with no survivors", () => {
  const g = group([
    leg({ id: 1, sopOutcome: "cannot_dispute" }),
    leg({ id: 2, sopOutcome: "cannot_dispute" }),
    leg({ id: 3, sopOutcome: "cannot_dispute" }),
    leg({ id: 4, sopOutcome: "cannot_dispute" }),
  ]);
  const r = deriveInvoiceDisputeOutlook(g, g.rides ?? []);
  assert.equal(r.outlook, "nothing_to_do");
  assert.equal(r.survivors.length, 0);
  assert.equal(r.dropped.length, 4);
});

// ─── Sibling-duplicate counts as dropped, not dispute-eligible ─────
test("deriveInvoiceDisputeOutlook — sibling-duplicate goes into dropped", () => {
  const g = group([
    leg({ id: 1, sopOutcome: "non_issue" }),
    leg({ id: 2, duplicateOfClaimId: 1 }),
  ]);
  const r = deriveInvoiceDisputeOutlook(g, g.rides ?? []);
  assert.equal(r.outlook, "reattest_only");
  assert.deepEqual(r.survivors.map((l) => l.id), [1]);
  assert.deepEqual(r.dropped.map((l) => l.id), [2]);
});

// ─── (d) reattest_only render: gauntlet absent, CTA present ────────
test("InvoiceGroupActionSlot (reattest_only) — gauntlet is absent, Re-attest CTA is present", () => {
  const g = group([
    leg({ id: 1, sopOutcome: "non_issue" }),
    leg({ id: 2, sopOutcome: "non_issue" }),
    leg({ id: 3, sopOutcome: "cannot_dispute" }),
    leg({ id: 4, sopOutcome: "cannot_dispute" }),
  ]);
  const html = renderHtml(
    React.createElement(InvoiceGroupActionSlot, { group: g, groupId: 99 }),
  );
  assert.match(html, /data-testid="invoice-reattest-only-cta"/);
  assert.match(html, /data-testid="invoice-reattest-only-open"/);
  assert.match(html, /Ready to re-attest\./);
  assert.match(html, /2 legs need re-attestation/);
  assert.match(html, /2 non-contestable legs will be cancelled/);
  assert.equal(
    html.includes(`data-testid="generate-preview"`),
    false,
    "gauntlet must not render in reattest_only state",
  );
  assert.equal(
    html.includes(`data-testid="readback-input"`),
    false,
    "gauntlet readback must not render in reattest_only state",
  );
  assert.equal(
    html.includes(`data-testid="submit-to-portal"`),
    false,
    "gauntlet submit must not render in reattest_only state",
  );
});

// Same shape, mounted the way the Queue's InlineGroupWorkspace mounts
// the slot (no `bare`, `onJumpToLeg` wired) — exercises the Queue
// surface end-to-end so Step 5's integration assertion is covered.
test("InvoiceGroupActionSlot (reattest_only, Queue surface) — gauntlet absent, CTA present", () => {
  const g = group([
    leg({ id: 1, sopOutcome: "non_issue" }),
    leg({ id: 2, sopOutcome: "non_issue" }),
    leg({ id: 3, sopOutcome: "cannot_dispute" }),
    leg({ id: 4, sopOutcome: "cannot_dispute" }),
  ]);
  const html = renderHtml(
    React.createElement(InvoiceGroupActionSlot, {
      group: g,
      groupId: 99,
      onJumpToLeg: () => {},
    }),
  );
  assert.match(html, /data-testid="invoice-reattest-only-cta"/);
  assert.equal(
    html.includes(`data-testid="generate-preview"`),
    false,
    "Queue-surface mount must not render the gauntlet in reattest_only",
  );
});

// ─── Re-attest server-mirror gate: blocked phases disable the CTA ──
// Mirrors the server's gate on /bulk-queue-reattest and
// /complete-reattest (invoice-groups.ts L3810-3852) so the operator
// can't fire the request from a phase that will 409.
test("InvoiceGroupActionSlot (reattest_only) — phase=in-flight blocks the Re-attest button", () => {
  const g = group(
    [
      leg({ id: 1, sopOutcome: "non_issue" }),
      leg({ id: 2, sopOutcome: "cannot_dispute" }),
    ],
    { status: "Awaiting Response" as InvoiceGroupDetailResponse["status"], phase: "submitted" as InvoiceGroupDetailResponse["phase"] },
  );
  const html = renderHtml(
    React.createElement(InvoiceGroupActionSlot, { group: g, groupId: 99 }),
  );
  assert.match(html, /data-testid="invoice-reattest-only-cta"/);
  assert.match(html, /data-testid="invoice-reattest-only-blocked"/);
  assert.equal(
    html.includes(`data-testid="invoice-reattest-only-open"`),
    false,
    "enabled CTA must not render when the server gate would 409",
  );
  assert.match(html, /Waiting on the payor/);
});

test("InvoiceGroupActionSlot (reattest_only) — reattestCompletedAt set blocks the Re-attest button", () => {
  const g = group(
    [
      leg({ id: 1, sopOutcome: "non_issue" }),
      leg({ id: 2, sopOutcome: "cannot_dispute" }),
    ],
    { reattestCompletedAt: "2026-05-01T12:00:00Z" as InvoiceGroupDetailResponse["reattestCompletedAt"] },
  );
  const html = renderHtml(
    React.createElement(InvoiceGroupActionSlot, { group: g, groupId: 99 }),
  );
  assert.match(html, /data-testid="invoice-reattest-only-blocked"/);
  assert.match(html, /Re-attestation has already been recorded/);
});

// ─── (f) has_disputable render: gauntlet present, CTA absent ──────
test("InvoiceGroupActionSlot (has_disputable) — gauntlet present, CTA absent", () => {
  const g = group([
    leg({ id: 1, sopOutcome: "portal_dispute" }),
    leg({ id: 2, sopOutcome: "non_issue" }),
  ]);
  const html = renderHtml(
    React.createElement(InvoiceGroupActionSlot, { group: g, groupId: 99 }),
  );
  assert.match(html, /data-testid="generate-preview"/);
  assert.equal(
    html.includes(`data-testid="invoice-reattest-only-cta"`),
    false,
    "Re-attest CTA must not render alongside the gauntlet",
  );
});

// ─── Task #481 — nothing_to_do renders the close-out card ─────────
test("InvoiceGroupActionSlot (nothing_to_do) — close-out card renders, gauntlet + reattest CTA absent", () => {
  const g = group([
    leg({ id: 1, sopOutcome: "cannot_dispute" }),
    leg({ id: 2, sopOutcome: "cannot_dispute" }),
  ]);
  const html = renderHtml(
    React.createElement(InvoiceGroupActionSlot, { group: g, groupId: 99 }),
  );
  assert.match(html, /data-testid="invoice-nothing-to-do-closeout"/);
  assert.match(html, /data-testid="invoice-nothing-to-do-close"/);
  assert.match(html, /Nothing left to dispute on this invoice\./);
  assert.match(html, /2 legs closed as non-contestable/);
  assert.match(html, /Mark as closed/);
  assert.equal(
    html.includes(`data-testid="invoice-reattest-only-cta"`),
    false,
    "Re-attest CTA must not render in nothing_to_do",
  );
  assert.equal(
    html.includes(`data-testid="generate-preview"`),
    false,
    "gauntlet must not render in nothing_to_do",
  );
});

// ─── Task #481 — already-closed nothing_to_do shows passive row ───
test("InvoiceGroupActionSlot (nothing_to_do, already closed) — shows passive Closed row, no Mark as closed button", () => {
  const g = group([
    leg({ id: 1, sopOutcome: "cannot_dispute" }),
    leg({ id: 2, sopOutcome: "cannot_dispute" }),
  ]);
  // vocab-allow-next-line — comparing against the API enum value, not a label.
  (g as unknown as { outcome: string }).outcome = "Withdrawn";
  const html = renderHtml(
    React.createElement(InvoiceGroupActionSlot, { group: g, groupId: 99 }),
  );
  assert.match(html, /data-testid="invoice-nothing-to-do-already-closed"/);
  assert.equal(
    html.includes(`data-testid="invoice-nothing-to-do-close"`),
    false,
    "Mark-as-closed button must not render once the invoice is already closed",
  );
});

// ─── Task #481 — clicking Mark as closed opens the closure launcher ─
test("InvoiceGroupActionSlot (nothing_to_do) — clicking Mark as closed opens closure launcher with cannot_dispute on the group", async () => {
  const { JSDOM } = await import("jsdom");
  const ReactDOM = await import("react-dom/client");
  const ReactTestUtils = await import("react-dom/test-utils");

  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const win = dom.window as unknown as Window & typeof globalThis;
  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = win.document;
  (globalThis as Record<string, unknown>).HTMLElement = win.HTMLElement;
  (globalThis as Record<string, unknown>).Element = win.Element;
  (globalThis as Record<string, unknown>).Node = win.Node;
  (globalThis as Record<string, unknown>).getComputedStyle = (
    win as unknown as { getComputedStyle: typeof window.getComputedStyle }
  ).getComputedStyle;

  clearClosureCalls();
  const g = group([
    leg({ id: 1, sopOutcome: "cannot_dispute" }),
    leg({ id: 2, sopOutcome: "cannot_dispute" }),
    leg({ id: 3, sopOutcome: "cannot_dispute" }),
  ]);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await ReactTestUtils.act(async () => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(InvoiceGroupActionSlot, {
          group: g,
          groupId: 99,
        }),
      ),
    );
  });

  const button = container.querySelector(
    `[data-testid="invoice-nothing-to-do-close"]`,
  ) as HTMLButtonElement | null;
  assert.ok(button, "Mark as closed button must render");

  await ReactTestUtils.act(async () => {
    button.click();
  });

  assert.equal(closureCalls.length, 1, "closure launcher must be opened once");
  assert.deepEqual(closureCalls[0].target, { kind: "group", id: 99 });
  assert.equal(closureCalls[0].reason, "cannot_dispute");

  await ReactTestUtils.act(async () => {
    root.unmount();
  });
});

// ─── (e) clicking Re-attest opens the modal with the right partition ──
test("InvoiceGroupActionSlot — clicking Re-attest opens ReattestModal with the correct approvedLegs / deniedLegs", async () => {
  const { JSDOM } = await import("jsdom");
  const ReactDOM = await import("react-dom/client");
  const ReactTestUtils = await import("react-dom/test-utils");

  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const win = dom.window as unknown as Window & typeof globalThis;
  // Set only the globals React-DOM truly needs. `navigator` is a
  // getter on globalThis in some Node builds, so we intentionally
  // avoid touching it.
  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = win.document;
  (globalThis as Record<string, unknown>).HTMLElement = win.HTMLElement;
  (globalThis as Record<string, unknown>).Element = win.Element;
  (globalThis as Record<string, unknown>).Node = win.Node;
  (globalThis as Record<string, unknown>).getComputedStyle = (
    win as unknown as { getComputedStyle: typeof window.getComputedStyle }
  ).getComputedStyle;

  clearModalCalls();
  const g = group([
    leg({ id: 11, sopOutcome: "non_issue" }),
    leg({ id: 12, sopOutcome: "non_issue" }),
    leg({ id: 21, sopOutcome: "cannot_dispute" }),
    leg({ id: 22, sopOutcome: "cannot_dispute" }),
  ]);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await ReactTestUtils.act(async () => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(InvoiceGroupActionSlot, {
          group: g,
          groupId: 99,
        }),
      ),
    );
  });

  // Initial render: modal is mounted but closed.
  const initial = modalCalls[modalCalls.length - 1];
  assert.ok(initial, "modal stub must be invoked at least once on mount");
  assert.equal(initial.open, false);
  assert.deepEqual(initial.approvedIds.sort(), [11, 12]);
  assert.deepEqual(initial.deniedIds.sort(), [21, 22]);

  const button = container.querySelector(
    `[data-testid="invoice-reattest-only-open"]`,
  ) as HTMLButtonElement | null;
  assert.ok(button, "Re-attest button must render");

  await ReactTestUtils.act(async () => {
    button.click();
  });

  const opened = modalCalls.filter((c) => c.open);
  assert.ok(opened.length >= 1, "modal must be opened after Re-attest click");
  const last = opened[opened.length - 1];
  assert.deepEqual(last.approvedIds.sort(), [11, 12]);
  assert.deepEqual(last.deniedIds.sort(), [21, 22]);
  assert.ok(
    container.querySelector(`[data-testid="stub-reattest-modal-open"]`),
    "stubbed modal must render its open marker",
  );

  await ReactTestUtils.act(async () => {
    root.unmount();
  });
});

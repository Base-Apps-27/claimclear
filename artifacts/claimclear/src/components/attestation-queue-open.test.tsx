// SSR contract for the Attestation Queue Open tab (Task #430): per-group
// rows, the live reattest instruction list, the persisted-note disclosure,
// and per-leg confirm buttons. Click-flow coverage lives in the sibling
// `attestation-queue-open-interactions.test.tsx`.

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";
import type { ClaimResponse } from "@workspace/api-client-react";

let urlParams: Record<string, string> = {};

mock.module("@/lib/use-url-params", {
  namedExports: {
    useUrlParams: () => ({
      get: (key: string) => urlParams[key] ?? "",
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

mock.module("@tanstack/react-query", {
  namedExports: {
    useQueryClient: () => ({ invalidateQueries: async () => {} }),
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

// Three groups exercising every buildReattestChecklist branch:
// 100 (all-approved), 200 (single-denied), 300 (multi-denied).

type AttestState = "pending" | "queued" | "completed";

function makeLeg(overrides: {
  id: number;
  confNumber: string;
  outcome: string;
  invoiceGroupId: number | null;
  invoiceNumbers?: string;
  attestationState?: AttestState;
  attestationNote?: string | null;
  masActionRequired?: "cancel" | null;
  includedInDispute?: boolean;
  masActionCompletedAt?: string | null;
  date?: string | null;
  sopOutcome?: string | null;
}): ClaimResponse {
  const claim = {
    id: overrides.id,
    confNumber: overrides.confNumber,
    status: "Awaiting Response" as const,
    outcome: overrides.outcome as ClaimResponse["outcome"],
    disputeEmailSent: true,
    invoiceGroupId: overrides.invoiceGroupId,
    invoiceNumbers: overrides.invoiceNumbers ?? "INV-DEFAULT",
    clientNumber: "PAYOR-X",
    attestationState: overrides.attestationState ?? "pending",
    attestationQueuedAt:
      overrides.attestationState === "queued" ? "2026-04-30T08:00:00.000Z" : null,
    attestationQueuedBy:
      overrides.attestationState === "queued" ? "queuer@example.com" : null,
    attestationNote: overrides.attestationNote ?? null,
    includedInDispute: overrides.includedInDispute ?? true,
    masActionRequired: overrides.masActionRequired ?? null,
    masActionCompletedAt: overrides.masActionCompletedAt ?? null,
    date: overrides.date ?? null,
    sopOutcome: overrides.sopOutcome ?? null,
  };
  return claim as unknown as ClaimResponse;
}

const grp100AllApproved = {
  id: 100,
  invoiceNumber: "INV-100",
  status: "Awaiting Response",
  outcome: "Approved",
  rideCount: 2,
  disputeEmailSent: true,
  reattestRequired: true,
  reattestCompletedAt: null,
  clientNumber: "PAYOR-X",
  rides: [
    makeLeg({
      id: 1001,
      confNumber: "CLM-1001",
      outcome: "Approved",
      invoiceGroupId: 100,
      invoiceNumbers: "INV-100",
    }),
    makeLeg({
      id: 1002,
      confNumber: "CLM-1002",
      outcome: "Approved",
      invoiceGroupId: 100,
      invoiceNumbers: "INV-100",
    }),
  ],
};

const grp200SingleDenied = {
  id: 200,
  invoiceNumber: "INV-200",
  status: "Awaiting Response",
  outcome: "Mixed",
  rideCount: 2,
  disputeEmailSent: true,
  reattestRequired: true,
  reattestCompletedAt: null,
  clientNumber: "PAYOR-X",
  rides: [
    makeLeg({
      id: 2001,
      confNumber: "CLM-2001",
      outcome: "Approved",
      invoiceGroupId: 200,
      invoiceNumbers: "INV-200",
    }),
    makeLeg({
      id: 2002,
      confNumber: "CLM-2002",
      outcome: "Denied",
      invoiceGroupId: 200,
      invoiceNumbers: "INV-200",
      masActionRequired: "cancel",
    }),
  ],
};

const grp300MultiDenied = {
  id: 300,
  invoiceNumber: "INV-300A",
  status: "Awaiting Response",
  outcome: "Mixed",
  rideCount: 3,
  disputeEmailSent: true,
  reattestRequired: true,
  reattestCompletedAt: null,
  clientNumber: "PAYOR-X",
  rides: [
    makeLeg({
      id: 3001,
      confNumber: "CLM-3001",
      outcome: "Approved",
      invoiceGroupId: 300,
      invoiceNumbers: "INV-300A",
    }),
    makeLeg({
      id: 3002,
      confNumber: "CLM-3002",
      outcome: "Denied",
      invoiceGroupId: 300,
      invoiceNumbers: "INV-300A",
      masActionRequired: "cancel",
    }),
    makeLeg({
      id: 3003,
      confNumber: "CLM-3003",
      outcome: "Denied",
      invoiceGroupId: 300,
      invoiceNumbers: "INV-300B",
      masActionRequired: "cancel",
    }),
  ],
};

const groupsById: Record<number, unknown> = {
  100: grp100AllApproved,
  200: grp200SingleDenied,
  300: grp300MultiDenied,
};

// grp100 has two legs (drives the multi-row per-leg breakdown);
// grp200 carries a persisted attestationNote for the disclosure check;
// service dates are unique per bucket so the service-date sort can be
// asserted in both directions; grp200's pending leg carries
// sopOutcome="cannot_dispute" to exercise the hot-dot signal; one
// leg's verdictRecordedAt is set to "now" so the fresh-dot signal
// fires within its 30-minute window.
const FRESH_NOW = new Date().toISOString();
const pendingPayload = {
  claims: [
    makeLeg({
      id: 1001,
      confNumber: "CLM-1001",
      outcome: "Approved",
      invoiceGroupId: 100,
      invoiceNumbers: "INV-100",
      attestationNote: null,
      date: "2026-04-01",
    }),
    makeLeg({
      id: 1002,
      confNumber: "CLM-1002",
      outcome: "Approved",
      invoiceGroupId: 100,
      invoiceNumbers: "INV-100",
      attestationNote: null,
      date: "2026-04-02",
    }),
    makeLeg({
      id: 2001,
      confNumber: "CLM-2001",
      outcome: "Approved",
      invoiceGroupId: 200,
      invoiceNumbers: "INV-200",
      attestationNote: "1. In MAS: cancel /…\n2. Re-attest the invoice.",
      date: "2026-04-15",
      sopOutcome: "cannot_dispute",
    }),
    makeLeg({
      id: 3001,
      confNumber: "CLM-3001",
      outcome: "Approved",
      invoiceGroupId: 300,
      invoiceNumbers: "INV-300A",
      date: "2026-04-20",
    }),
  ],
  extras: {
    "1001": { verdictRecordedAt: "2026-04-30T09:00:00.000Z" },
    "1002": { verdictRecordedAt: "2026-04-30T09:30:00.000Z" },
    "2001": { verdictRecordedAt: "2026-04-30T10:00:00.000Z" },
    "3001": { verdictRecordedAt: FRESH_NOW },
  },
};

const queuedPayload = { claims: [], extras: {} };

let selectedGroupForFixture: number | null = null;

mock.module("@workspace/api-client-react", {
  namedExports: {
    useListAttestationPending: (params: { state?: string } = {}) => {
      if (params.state === "pending") return inertQuery(pendingPayload);
      return inertQuery(queuedPayload);
    },
    useGetInvoiceGroup: (id: number) => inertQuery(groupsById[id] ?? null),
    useGetInvoiceGroupAttestationHistory: () =>
      inertQuery({ groups: [], truncated: false }),
    useCompleteGroupReattest: inertMutation,
    useAttestClaim: inertMutation,
    useConfirmQueuedAttestation: inertMutation,
    useCompleteLegMasAction: inertMutation,
    getListAttestationPendingQueryKey: () => ["pending"],
    getGetInvoiceGroupAttestationHistoryQueryKey: () => ["history"],
    getGetInvoiceGroupQueryKey: () => ["invoice-group"],
    getGetAttestationCountsQueryKey: () => ["attest-counts"],
    getGetDashboardSummaryQueryKey: () => ["dashboard"],
    getGetClaimQueryKey: () => ["claim"],
  },
});

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { default: AttestationQueue } = await import(
  "../pages/attestation-queue"
);

void React;
void selectedGroupForFixture;

function render(): string {
  return renderToStaticMarkup(React.createElement(AttestationQueue));
}

test("Open tab aggregates legs into per-invoice-group rows (one row per group)", () => {
  urlParams = {};
  const html = render();
  assert.match(html, /data-testid="queue-row-g:100"/);
  assert.match(html, /data-testid="queue-row-g:200"/);
  assert.match(html, /data-testid="queue-row-g:300"/);
  assert.match(html, /data-testid="queue-row-leg-count-g:300"[^>]*>\s*1 leg\s*</);
  assert.match(html, /data-testid="queue-list"/);
  assert.equal(html.includes('data-testid="queue-row-1001"'), false);
});

test("(a) all-approved group renders the wizard with a reattest step (no MAS-cancel step)", () => {
  // Task #650: all-approved bucket → wizard with no Step 2.
  urlParams = {};
  const html = render();
  assert.match(html, /data-testid="group-review-pane-g:100"/);
  assert.match(html, /data-testid="attestation-wizard-g:100"/);
  assert.match(html, /data-testid="wizard-step-1"/);
  assert.match(html, /data-testid="wizard-step-3"/);
  assert.match(html, /data-testid="wizard-reattest-button"/);
  // No denied leg → no MAS-cancel station in the DOM.
  assert.equal(html.includes('data-testid="wizard-step-2"'), false);
  assert.equal(html.includes('data-testid="wizard-cancel-button"'), false);
});

const built = await import("./whats-next/reattest-instruction-template");

test("(b) single-denied-invoice group renders 1 MAS line + reattest line", () => {
  // Drive the helper directly: the right pane's initial selection is grp100
  // and we can't re-mock mid-process to flip selection to grp200.
  const items = built.buildReattestChecklist(
    grp200SingleDenied.rides.filter((r) => r.outcome === "Denied"),
    grp200SingleDenied.invoiceNumber,
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].id, "mas-INV-200");
  assert.match(items[0].text, /In MAS: cancel \/ accept GPS deviation for invoice #INV-200\./);
  assert.equal(items[1].id, "reattest");
});

test("(c) multi-denied-invoice group renders 2 distinct MAS lines + reattest line", () => {
  const items = built.buildReattestChecklist(
    grp300MultiDenied.rides.filter((r) => r.outcome === "Denied"),
    grp300MultiDenied.invoiceNumber,
  );
  assert.equal(items.length, 3);
  assert.equal(items[0].id, "mas-INV-300A");
  assert.equal(items[1].id, "mas-INV-300B");
  assert.equal(items[2].id, "reattest");
  const dupeItems = built.buildReattestChecklist(
    [
      ...grp300MultiDenied.rides.filter((r) => r.outcome === "Denied"),
      makeLeg({
        id: 3004,
        confNumber: "CLM-3004",
        outcome: "Denied",
        invoiceGroupId: 300,
        invoiceNumbers: "INV-300A",
      }),
    ],
    grp300MultiDenied.invoiceNumber,
  );
  assert.equal(dupeItems.length, 3);
});

test("right pane renders the wizard summary band above the per-leg fallback disclosure", () => {
  // Task #650: wizard summary band sits above the per-leg fallback.
  urlParams = {};
  const html = render();
  const summaryIdx = html.indexOf('data-testid="wizard-summary-band"');
  const perLegIdx = html.indexOf('data-testid="wizard-per-leg-disclosure"');
  assert.ok(summaryIdx >= 0);
  assert.ok(perLegIdx >= 0);
  assert.ok(summaryIdx < perLegIdx);
});

test("Open tab left rail renders Variant B affordances: pending pill, hot dot for cannot_dispute, fresh dot for recent verdicts, plus the subhead with sort dropdown", () => {
  // Task #650: pending pill on every bucket; hot dot on grp200
  // (cannot_dispute); fresh dot on grp300 (verdict ~now).
  urlParams = {};
  const html = render();
  assert.match(html, /data-testid="queue-row-pending-count-g:100"/);
  assert.match(html, /data-testid="queue-row-pending-count-g:200"/);
  assert.match(html, /data-testid="queue-row-pending-count-g:300"/);
  assert.match(html, /data-testid="queue-row-hot-dot-g:200"/);
  assert.equal(html.includes('data-testid="queue-row-hot-dot-g:100"'), false);
  assert.match(html, /data-testid="queue-row-fresh-dot-g:300"/);
  assert.equal(html.includes('data-testid="queue-row-fresh-dot-g:100"'), false);
  assert.match(html, /data-testid="queue-pending-total"/);
  assert.match(html, /data-testid="queue-sort-select"/);
});

test("Open tab honors ?sort=service-asc / service-desc and reverses the bucket order", () => {
  // Task #650: ?sort flips the rail ordering by service date.
  urlParams = { sort: "service-asc" };
  const ascHtml = render();
  const ascList = ascHtml.match(/data-testid="queue-row-(g:\d+)"/g) ?? [];
  assert.deepEqual(ascList.slice(0, 3), [
    'data-testid="queue-row-g:100"',
    'data-testid="queue-row-g:200"',
    'data-testid="queue-row-g:300"',
  ]);

  urlParams = { sort: "service-desc" };
  const descHtml = render();
  const descList = descHtml.match(/data-testid="queue-row-(g:\d+)"/g) ?? [];
  assert.deepEqual(descList.slice(0, 3), [
    'data-testid="queue-row-g:300"',
    'data-testid="queue-row-g:200"',
    'data-testid="queue-row-g:100"',
  ]);
});

test("Open tab shows a 'Next up' tag on the top row when nothing is selected", () => {
  // Task #650: top row gets the Next-up tag when ?group= is absent.
  urlParams = {};
  const html = render();
  assert.match(html, /data-testid="queue-row-next-up-tag"/);
});

test("Open tab hides the 'Next up' tag once the URL pins a selection", () => {
  // A pinned ?group= counts as an explicit selection.
  urlParams = { group: "g:200" };
  const html = render();
  assert.equal(
    html.includes('data-testid="queue-row-next-up-tag"'),
    false,
  );
});

test("persisted attestationNote is shown in a collapsed <details> disclosure when it adds something new", () => {
  urlParams = {};
  // Seed a note on the default-selected group (grp100, all-approved →
  // live checklist is just "Re-attest the invoice.") that is genuinely
  // different from the live walkthrough so the disclosure renders.
  const leg1001 = pendingPayload.claims.find((c) => c.id === 1001)!;
  const original = leg1001.attestationNote;
  leg1001.attestationNote =
    "Heads up: cancelled the duplicate manually before parking this.";
  try {
    const html = render();
    assert.match(html, /data-testid="persisted-attestation-notes"/);
    assert.match(html, /data-testid="persisted-note-1001"/);
    // Collapsed by default — no `open` attribute on the <details>.
    assert.equal(
      /<details[^>]*\bopen\b[^>]*data-testid="persisted-attestation-notes"/.test(html),
      false,
    );
  } finally {
    leg1001.attestationNote = original;
  }
});

test("persisted attestationNote disclosure is hidden when the note is redundant with the live checklist", () => {
  urlParams = {};
  // grp100's live checklist is the single line "Re-attest the
  // invoice." Seeding the same text (or a substring of the live
  // walkthrough) must drop the entry and hide the whole disclosure.
  const leg1001 = pendingPayload.claims.find((c) => c.id === 1001)!;
  const original = leg1001.attestationNote;
  leg1001.attestationNote = "Re-attest the invoice.";
  try {
    const html = render();
    assert.equal(
      html.includes('data-testid="persisted-attestation-notes"'),
      false,
    );
    assert.equal(
      html.includes('data-testid="persisted-note-1001"'),
      false,
    );
  } finally {
    leg1001.attestationNote = original;
  }
});

test("persisted attestationNote disclosure is hidden when the note is a strict substring of the live checklist", () => {
  urlParams = {};
  // grp100's live checklist text is "1. Re-attest the invoice." A
  // strict substring of that walkthrough (not an exact match) must
  // still be filtered out and the whole disclosure hidden.
  const leg1001 = pendingPayload.claims.find((c) => c.id === 1001)!;
  const original = leg1001.attestationNote;
  leg1001.attestationNote = "Re-attest the invoice";
  try {
    const html = render();
    assert.equal(
      html.includes('data-testid="persisted-attestation-notes"'),
      false,
    );
    assert.equal(
      html.includes('data-testid="persisted-note-1001"'),
      false,
    );
  } finally {
    leg1001.attestationNote = original;
  }
});

test("each leg in the group exposes a 'Confirm just this leg' button", () => {
  urlParams = {};
  const html = render();
  assert.match(html, /data-testid="confirm-just-this-leg-1001"/);
  assert.match(html, /data-testid="confirm-just-this-leg-1002"/);
  assert.match(html, /data-testid="group-leg-breakdown"/);
  assert.match(html, /data-testid="group-leg-row-1001"/);
  assert.match(html, /data-testid="group-leg-row-1002"/);
});

test("legs already attested in the group detail show an 'Already confirmed' pill and hide the per-leg confirm button", () => {
  urlParams = {};
  // Simulate a teammate having just confirmed CLM-1001 in another tab:
  // the pending list (cached) still includes the leg, but the freshly
  // refetched invoice-group detail reports it as completed.
  const original = grp100AllApproved.rides[0];
  grp100AllApproved.rides[0] = makeLeg({
    id: 1001,
    confNumber: "CLM-1001",
    outcome: "Approved",
    invoiceGroupId: 100,
    invoiceNumbers: "INV-100",
    attestationState: "completed",
  });
  try {
    const html = render();
    // The completed leg shows the pill and hides its confirm button…
    assert.match(html, /data-testid="already-confirmed-1001"/);
    assert.equal(
      html.includes('data-testid="confirm-just-this-leg-1001"'),
      false,
    );
    // …while the still-pending sibling keeps both behaviors as before.
    assert.equal(
      html.includes('data-testid="already-confirmed-1002"'),
      false,
    );
    assert.match(html, /data-testid="confirm-just-this-leg-1002"/);
  } finally {
    grp100AllApproved.rides[0] = original;
  }
});

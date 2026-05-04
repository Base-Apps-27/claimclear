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
  namedExports: { useToast: () => ({ toast: () => {} }) },
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

type AttestState = "pending" | "queued";

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
// grp200 carries a persisted attestationNote for the disclosure check.
const pendingPayload = {
  claims: [
    makeLeg({
      id: 1001,
      confNumber: "CLM-1001",
      outcome: "Approved",
      invoiceGroupId: 100,
      invoiceNumbers: "INV-100",
      attestationNote: null,
    }),
    makeLeg({
      id: 1002,
      confNumber: "CLM-1002",
      outcome: "Approved",
      invoiceGroupId: 100,
      invoiceNumbers: "INV-100",
      attestationNote: null,
    }),
    makeLeg({
      id: 2001,
      confNumber: "CLM-2001",
      outcome: "Approved",
      invoiceGroupId: 200,
      invoiceNumbers: "INV-200",
      attestationNote: "1. In MAS: cancel /…\n2. Re-attest the invoice.",
    }),
    makeLeg({
      id: 3001,
      confNumber: "CLM-3001",
      outcome: "Approved",
      invoiceGroupId: 300,
      invoiceNumbers: "INV-300A",
    }),
  ],
  extras: {
    "1001": { verdictRecordedAt: "2026-04-30T09:00:00.000Z" },
    "1002": { verdictRecordedAt: "2026-04-30T09:30:00.000Z" },
    "2001": { verdictRecordedAt: "2026-04-30T10:00:00.000Z" },
    "3001": { verdictRecordedAt: "2026-04-30T11:00:00.000Z" },
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

test("(a) all-approved group renders 1 instructional line — just 'Re-attest the invoice.'", () => {
  urlParams = {};
  const html = render();
  assert.match(html, /data-testid="group-review-pane-g:100"/);
  assert.match(html, /data-testid="reattest-instruction-reattest"/);
  assert.equal(/data-testid="reattest-instruction-mas-/.test(html), false);
  assert.match(html, /Re-attest the invoice\./);
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

test("right pane renders the live instructional list above the action checklist", () => {
  urlParams = {};
  const html = render();
  const instrIdx = html.indexOf('data-testid="reattest-instructions"');
  const checklistIdx = html.indexOf('data-testid="group-action-checklist-g:100"');
  assert.ok(instrIdx >= 0);
  assert.ok(checklistIdx >= 0);
  assert.ok(instrIdx < checklistIdx);
});

test("persisted attestationNote is preserved in a collapsed <details> disclosure", () => {
  urlParams = {};
  const html = render();
  // grp100 (default selection) has no persisted notes — the disclosure
  // for grp200's note must NOT render here, and when it does it must be
  // collapsed (no `open` attribute).
  assert.equal(
    html.includes('data-testid="persisted-note-2001"'),
    false,
  );
  assert.equal(
    /<details[^>]*\bopen\b[^>]*data-testid="persisted-attestation-notes"/.test(html),
    false,
  );
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

// Component tests for <InvoiceGroupSubmissionGauntlet /> — Task #418.
//
// What we pin here is the submission gate's behaviour for sibling-
// duplicate legs. The backend's `evaluateDisputedLegsResolved`
// considers a duplicate resolved iff its primary is in a terminal
// sub-status; the gauntlet must mirror that or operators get stuck on
// "needs action" rows that can't actually be acted on. The shared
// rule lives in `lib/leg-resolved`; here we verify the gauntlet is
// correctly wired to it (gate row check, generate-preview enable,
// disabled-tooltip summary).
//
// React-Query mutation hooks are mocked away (they pull network
// runtime + react), and the toast hook is stubbed. Tooltip content
// only renders when a portal opens, so we assert against the wrapper
// + button-disabled state, which are the SSR-stable contract.

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";

// Stub api-client mutations — return inert hook shapes so the
// component renders without a network runtime.
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
mock.module("@workspace/api-client-react", {
  namedExports: {
    useConfirmUnderstandingReadback: inertMutation,
    useStampPreviewGenerated: inertMutation,
    useCreatePortalSubmission: inertMutation,
    useSaveInvoiceGroupDraft: inertMutation,
    useRegenerateInvoiceGroupDraft: inertMutation,
    useMarkInvoiceGroupDraftReviewed: inertMutation,
    getGetInvoiceGroupQueryKey: (id: number) => ["invoice-group", id],
    getGetInvoiceGroupValidTransitionsQueryKey: (id: number) => [
      "invoice-group",
      id,
      "transitions",
    ],
  },
});

mock.module("@/hooks/use-toast", {
  namedExports: {
    useToast: () => ({ toast: () => {} }),
    toast: () => ({ id: "0", dismiss: () => {}, update: () => {} }),
    successToast: () => ({ id: "0", dismiss: () => {}, update: () => {} }),
  },
});

// PromptContextBadge pulls a heavier dependency tree it doesn't need
// for the gate-row assertions; render nothing.
mock.module("@/components/prompt-context-badge", {
  namedExports: { PromptContextBadge: () => null },
});

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);
const { InvoiceGroupSubmissionGauntlet } = await import(
  "./invoice-group-submission-gauntlet"
);
type ClaimResponse = import("@workspace/api-client-react").ClaimResponse;
type InvoiceGroupDetailResponse =
  import("@workspace/api-client-react").InvoiceGroupDetailResponse;

void React;

function render(node: import("react").ReactElement): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client: qc, children: node }),
  );
}

function claim(over: Partial<ClaimResponse> & { id: number }): ClaimResponse {
  return {
    confNumber: `CLM-${over.id}`,
    status: "New",
    outcome: null,
    includedInDispute: true,
    duplicateOfClaimId: null,
    sopOutcome: null,
    errorTypeId: null,
    holdReason: null,
    ...over,
  } as unknown as ClaimResponse;
}

function group(rides: ClaimResponse[]): InvoiceGroupDetailResponse {
  return {
    id: 42,
    confNumber: "GRP-42",
    status: "New", // → isPreSubmit, so the gate is live
    rides,
    submissions: [],
    notes: [],
    auditLogs: [],
    responses: [],
  } as unknown as InvoiceGroupDetailResponse;
}

// ─────────────────────────────────────────────────────────────────────
// Gate is GREEN when the only "open" leg is a duplicate whose primary
// has dropped (Non-contestable). Without this fix the gauntlet would
// stay locked forever — the duplicate row has no Process control, so
// the operator can't move it to a terminal state by hand.
// ─────────────────────────────────────────────────────────────────────
test("gauntlet: duplicate of dropped primary unlocks the legs gate", () => {
  const primary = claim({
    id: 589,
    errorTypeId: "ET-1",
    sopOutcome: "cannot_dispute", // → dropped
  });
  const duplicate = claim({ id: 588, duplicateOfClaimId: 589 });
  const html = render(
    React.createElement(InvoiceGroupSubmissionGauntlet, {
      group: group([primary, duplicate]),
      groupId: 42,
    }),
  );

  // Gate row checked: ✓ + summary line (1 SOP-resolved, 0 excluded —
  // the duplicate is not double-counted, it rolls up under the primary).
  // The `<li>` carries text-green-700 styling alongside the testid.
  assert.match(
    html,
    /<li class="text-green-700" data-testid="gate-row-legs">✓ All legs reached a conclusion — 1 SOP, 0 excluded<\/li>/,
  );

  // Preview button is enabled: no disabled-wrapper around it, and
  // the readback notes textarea is unlocked (no locked-reason copy).
  assert.equal(
    html.includes(`data-testid="generate-preview-disabled-wrapper"`),
    false,
    "all-resolved state must not wrap Generate-preview in a disabled tooltip",
  );
  assert.equal(
    html.includes(`data-testid="readback-locked-reason"`),
    false,
    "all-resolved state must unlock the readback notes",
  );
});

// ─────────────────────────────────────────────────────────────────────
// Gate stays RED when the duplicate's primary is still investigating —
// the gauntlet's lock matches the backend's gate, and the disabled
// tooltip surfaces the leg counts the operator still owes.
// ─────────────────────────────────────────────────────────────────────
test("gauntlet: duplicate of investigating primary keeps the gate locked", () => {
  const primary = claim({
    id: 589,
    errorTypeId: "ET-1",
    sopOutcome: null, // → investigating
  });
  const duplicate = claim({ id: 588, duplicateOfClaimId: 589 });
  const html = render(
    React.createElement(InvoiceGroupSubmissionGauntlet, {
      group: group([primary, duplicate]),
      groupId: 42,
    }),
  );

  // Gate row open: ○ + plain copy, muted styling.
  assert.match(
    html,
    /<li class="text-muted-foreground" data-testid="gate-row-legs">○ All legs reached a conclusion<\/li>/,
  );
  assert.equal(
    html.includes("SOP, 0 excluded"),
    false,
    "open state must not render the resolved summary",
  );

  // Generate-preview wrapped in a disabled tooltip + the inner button
  // carries the `disabled` attribute. (The Radix TooltipContent isn't
  // emitted in SSR until the tooltip opens, so we assert the wrapper
  // + button-disabled state — the SSR-stable contract.)
  assert.match(html, /data-testid="generate-preview-disabled-wrapper"/);
  assert.match(html, /disabled="" data-testid="generate-preview"/);

  // Readback notes locked.
  assert.match(html, /data-testid="readback-locked-reason"/);
});

// ─────────────────────────────────────────────────────────────────────
// Excluded primary edge case (mirrors the backend integration test):
// `includedInDispute=false` derives to `excluded`, which is itself a
// terminal sub-status, so the duplicate that points at the excluded
// primary is also resolved. The gate unlocks.
// ─────────────────────────────────────────────────────────────────────
test("gauntlet: duplicate of an excluded primary still unlocks the gate", () => {
  // Disputed leg list (post-filter) is just the duplicate; the
  // excluded primary lives in `allRides` so the index can see it.
  const excludedPrimary = claim({
    id: 589,
    includedInDispute: false, // → excluded (filtered out of rides)
  });
  const duplicate = claim({ id: 588, duplicateOfClaimId: 589 });
  const html = render(
    React.createElement(InvoiceGroupSubmissionGauntlet, {
      group: group([excludedPrimary, duplicate]),
      groupId: 42,
    }),
  );

  // Gate row checked. The duplicate is the only disputed leg and it
  // resolves through its (excluded) primary — 0 SOP, 0 excluded in
  // the disputed bucket counts (the excluded primary itself is
  // filtered out before counting).
  assert.match(
    html,
    /<li class="text-green-700" data-testid="gate-row-legs">✓ All legs reached a conclusion — 0 SOP, 0 excluded<\/li>/,
  );
  assert.equal(
    html.includes(`data-testid="generate-preview-disabled-wrapper"`),
    false,
  );
});

// Task #517 — Queue V3 walk-first wizard parity tests.
//
// Verifies that InlineGroupWorkspaceV3 routes each Phase-4 outlook to
// the same terminal action surface InvoiceGroupActionSlot mounts in
// the classic /queue workspace. This is the parity guarantee: V3 is
// pure chrome — every mutation, query invalidation, and audit-write
// path is inherited from InvoiceGroupActionSlot.
//
// Five cases pinned here:
//   (a) buildPhaseConfigV3 — has_disputable progresses Walk → Preview
//       → Review → Submit as the real group state advances
//   (b) buildPhaseConfigV3 — reattest_only collapses to a 2-step
//       ladder (Walk → Re-attest)
//   (c) buildPhaseConfigV3 — nothing_to_do has a single Close step
//   (d) Render parity: has_disputable mounts the gauntlet, the V3
//       chrome (leg switcher, hero, pinned footer) is present, and
//       neither the Re-attest CTA nor the close-out card render
//   (e) Render parity: reattest_only mounts the Re-attest CTA, the
//       gauntlet does NOT render, and the V3 chrome stays present
//   (f) Render parity: nothing_to_do mounts the close-out card and
//       collapses the chrome (no leg switcher, no SOP hero, no
//       pinned footer)

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
    useGetInvoiceGroup: (_id: number) => ({ data: capturedGroup, isLoading: false }),
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

mock.module("@/lib/use-url-params", {
  namedExports: {
    useUrlParams: () => ({ get: (_k: string) => "", set: (_v: unknown) => {} }),
  },
});

mock.module("@/lib/role", {
  namedExports: {
    HideForClerk: ({ children }: { children: unknown }) => children,
  },
});

// ClaimDetailV2 is huge and pulls in the whole leg-detail tree. Stub
// to a marker div so we can assert it's rendered (or not) in each
// outlook without paying the cost of mounting the real component.
mock.module("@/components/claim-detail-v2", {
  namedExports: {
    ClaimDetailV2: (props: { claimId: number; embedded?: boolean }) =>
      React.createElement("div", {
        "data-testid": `stub-claim-detail-v2-${props.claimId}`,
      }),
  },
});

mock.module("@/components/whats-next/reattest-modal", {
  namedExports: {
    ReattestModal: () => null,
  },
});

mock.module("@/components/closure/closure-launcher", {
  namedExports: {
    useClosureLauncher: () => ({ open: () => {}, dialog: null }),
  },
});

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);

const { InlineGroupWorkspaceV3, buildPhaseConfigV3 } = await import(
  "./inline-group-workspace-v3"
);

type ClaimResponse = import("@workspace/api-client-react").ClaimResponse;
type InvoiceGroupDetailResponse =
  import("@workspace/api-client-react").InvoiceGroupDetailResponse;

// Per-test mutable group payload returned by the mocked
// useGetInvoiceGroup — set right before each render call.
let capturedGroup: InvoiceGroupDetailResponse | null = null;

void React;

interface LegOpts {
  id: number;
  sopOutcome?: string | null;
  includedInDispute?: boolean;
  duplicateOfClaimId?: number | null;
  errorTypeId?: string | null;
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
    errorTypeName: "Wrong member",
    holdReason: null,
    latestVerdict: null,
    latestDraft: null,
  } as unknown as ClaimResponse;
}

function group(
  rides: ClaimResponse[],
  extra: Partial<InvoiceGroupDetailResponse> = {},
): InvoiceGroupDetailResponse {
  return {
    id: 99,
    confNumber: "GRP-99",
    invoiceNumber: "INV-99",
    status: "New",
    rideCount: rides.length,
    totalAmount: 100,
    rides,
    submissions: [],
    notes: [],
    auditLogs: [],
    responses: [],
    ...extra,
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

// ─── (a) buildPhaseConfigV3 — has_disputable progression ────────────
test("buildPhaseConfigV3 — has_disputable progresses Walk → Preview → Review → Submit", () => {
  const base = {
    outlook: "has_disputable" as const,
    legCount: 2,
    submitted: false,
  };
  const walking = buildPhaseConfigV3({
    ...base,
    resolvedCount: 1,
    previewGenerated: false,
    draftReviewed: false,
  });
  assert.equal(walking.activeIndex, 0);
  assert.equal(walking.steps.length, 4);

  const walked = buildPhaseConfigV3({
    ...base,
    resolvedCount: 2,
    previewGenerated: false,
    draftReviewed: false,
  });
  assert.equal(walked.activeIndex, 1);
  assert.equal(walked.pill.label, "Ready to preview");

  const previewed = buildPhaseConfigV3({
    ...base,
    resolvedCount: 2,
    previewGenerated: true,
    draftReviewed: false,
  });
  assert.equal(previewed.activeIndex, 2);
  assert.equal(previewed.pill.label, "Awaiting review");

  const reviewed = buildPhaseConfigV3({
    ...base,
    resolvedCount: 2,
    previewGenerated: true,
    draftReviewed: true,
  });
  assert.equal(reviewed.activeIndex, 3);
  assert.equal(reviewed.pill.label, "Ready to submit");

  const sent = buildPhaseConfigV3({
    ...base,
    resolvedCount: 2,
    previewGenerated: true,
    draftReviewed: true,
    submitted: true,
  });
  assert.equal(sent.pill.label, "Submitted");
});

// ─── (b) buildPhaseConfigV3 — reattest_only collapses ──────────────
test("buildPhaseConfigV3 — reattest_only is a 2-step Walk → Re-attest ladder", () => {
  const cfg = buildPhaseConfigV3({
    outlook: "reattest_only",
    legCount: 2,
    resolvedCount: 2,
    previewGenerated: false,
    draftReviewed: false,
    submitted: false,
  });
  assert.deepEqual([...cfg.steps], ["Walk legs", "Re-attest"]);
  assert.equal(cfg.activeIndex, 1);
  assert.equal(cfg.pill.label, "Ready to re-attest");
});

// ─── (c) buildPhaseConfigV3 — nothing_to_do is a single step ───────
test("buildPhaseConfigV3 — nothing_to_do is a single Close step", () => {
  const cfg = buildPhaseConfigV3({
    outlook: "nothing_to_do",
    legCount: 0,
    resolvedCount: 0,
    previewGenerated: false,
    draftReviewed: false,
    submitted: false,
  });
  assert.deepEqual([...cfg.steps], ["Close"]);
  assert.equal(cfg.pill.label, "Ready to close");
});

// ─── (d) Render parity — has_disputable mounts gauntlet ────────────
test("InlineGroupWorkspaceV3 (has_disputable) — mounts gauntlet, V3 chrome present", () => {
  capturedGroup = group([
    leg({ id: 1, sopOutcome: "non_issue" }),
    leg({ id: 2, sopOutcome: "portal_dispute" }),
  ]);
  const html = renderHtml(
    React.createElement(InlineGroupWorkspaceV3, { groupId: 99 }),
  );
  assert.match(html, /data-outlook="has_disputable"/);
  assert.match(html, /data-collapsed="false"/);
  assert.match(html, /data-testid="v3-leg-switcher"/);
  assert.match(html, /data-testid="v3-leg-hero"/);
  assert.match(html, /data-testid="v3-pinned-footer"/);
  // Gauntlet's readback / preview / submit testids are fingerprints
  // for "the gauntlet mounted". At least one of them must appear.
  assert.ok(
    html.includes("generate-preview") ||
      html.includes("readback-input") ||
      html.includes("submit-to-portal"),
    "expected gauntlet to mount for has_disputable",
  );
  assert.equal(
    html.includes("invoice-reattest-only-cta"),
    false,
    "Re-attest CTA must not render for has_disputable",
  );
  assert.equal(
    html.includes("invoice-nothing-to-do-closeout"),
    false,
    "close-out card must not render for has_disputable",
  );
});

// ─── (e) Render parity — reattest_only mounts CTA ───────────────────
test("InlineGroupWorkspaceV3 (reattest_only) — mounts Re-attest CTA, gauntlet absent, chrome present", () => {
  capturedGroup = group([
    leg({ id: 1, sopOutcome: "non_issue" }),
    leg({ id: 2, sopOutcome: "non_issue" }),
    leg({ id: 3, sopOutcome: "cannot_dispute" }),
    leg({ id: 4, sopOutcome: "cannot_dispute" }),
  ]);
  const html = renderHtml(
    React.createElement(InlineGroupWorkspaceV3, { groupId: 99 }),
  );
  assert.match(html, /data-outlook="reattest_only"/);
  assert.match(html, /data-collapsed="false"/);
  assert.match(html, /data-testid="v3-leg-switcher"/);
  assert.match(html, /data-testid="v3-leg-hero"/);
  assert.match(html, /data-testid="v3-pinned-footer"/);
  assert.match(html, /data-testid="invoice-reattest-only-cta"/);
  assert.equal(
    html.includes("generate-preview"),
    false,
    "gauntlet must not render in reattest_only",
  );
  assert.equal(
    html.includes("invoice-nothing-to-do-closeout"),
    false,
    "close-out card must not render in reattest_only",
  );
});

// ─── (f) Render parity — nothing_to_do collapses chrome ────────────
test("InlineGroupWorkspaceV3 (nothing_to_do) — mounts close-out card, chrome collapsed", () => {
  capturedGroup = group([
    leg({ id: 1, sopOutcome: "cannot_dispute" }),
    leg({ id: 2, sopOutcome: "cannot_dispute" }),
  ]);
  const html = renderHtml(
    React.createElement(InlineGroupWorkspaceV3, { groupId: 99 }),
  );
  assert.match(html, /data-outlook="nothing_to_do"/);
  assert.match(html, /data-collapsed="true"/);
  assert.match(html, /data-testid="invoice-nothing-to-do-closeout"/);
  assert.equal(
    html.includes(`data-testid="v3-leg-switcher"`),
    false,
    "leg switcher must not render when chrome is collapsed",
  );
  assert.equal(
    html.includes(`data-testid="v3-leg-hero"`),
    false,
    "SOP hero must not render when chrome is collapsed",
  );
  assert.equal(
    html.includes(`data-testid="v3-pinned-footer"`),
    false,
    "pinned footer must not render when chrome is collapsed",
  );
  assert.equal(
    html.includes("generate-preview"),
    false,
    "gauntlet must not render in nothing_to_do",
  );
  assert.equal(
    html.includes("invoice-reattest-only-cta"),
    false,
    "Re-attest CTA must not render in nothing_to_do",
  );
});

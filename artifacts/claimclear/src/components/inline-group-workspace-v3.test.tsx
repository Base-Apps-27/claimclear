// Task #517 + #521 — Queue V3 walk-first wizard parity tests.
//
// Verifies that InlineGroupWorkspaceV3 swaps its hero per phase
// (walking → walk-complete → preview → review → submitted) and that
// the outlook routing still hands off to InvoiceGroupActionSlot for
// the reattest_only and nothing_to_do branches.
//
// Cases:
//   (a) buildPhaseConfigV3 — has_disputable progresses Walk → Preview
//       → Review → Submit as the real group state advances
//   (b) buildPhaseConfigV3 — reattest_only collapses to a 2-step
//       ladder (Walk → Re-attest)
//   (c) buildPhaseConfigV3 — nothing_to_do has a single Close step
//   (d) Render: has_disputable + walk in progress mounts the SOP walk
//       hero (no ClaimDetailV2 in the hero, no gauntlet card stacked)
//   (e) Render: has_disputable + all walked + no preview mounts the
//       walk-complete hero with the Generate-preview CTA bound to the
//       gauntlet's mutation
//   (f) Render: has_disputable + previewGenerated + !draftReviewed
//       mounts the read-only Preview hero
//   (g) Render: has_disputable + draftReviewed mounts the editable
//       Review hero with Submit
//   (h) Render: reattest_only + all walked mounts the Re-attest CTA;
//       no SOP walk hero, no submission heroes
//   (i) Render: nothing_to_do collapses the chrome and mounts the
//       close-out card

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
    useClassifyLeg: inertMutation,
    useLookupErrorDetailMappings: inertMutation,
    useStampPreviewGenerated: inertMutation,
    useSaveInvoiceGroupDraft: inertMutation,
    useRegenerateInvoiceGroupDraft: inertMutation,
    useMarkInvoiceGroupDraftReviewed: inertMutation,
    useCreatePortalSubmission: inertMutation,
    useConfirmUnderstandingReadback: inertMutation,
    useCompleteGroupReattest: inertMutation,
    useBulkQueueGroupReattest: inertMutation,
    useMarkAwaitingPayorAgain: inertMutation,
    usePromoteVerdictDrafts: inertMutation,
    useSopRestartLeg: inertMutation,
    useReclassifyLeg: inertMutation,
    useGetSopRewindImpact: () => ({ data: null, isLoading: false, error: null }),
    useGetInvoiceGroup: (_id: number) => ({ data: capturedGroup, isLoading: false }),
    useGetClaim: (_id: number) => ({ data: null, isLoading: false }),
    useListErrorTypes: () => ({ data: [] }),
    getGetInvoiceGroupQueryKey: (id: number) => ["invoice-group", id],
    getGetInvoiceGroupValidTransitionsQueryKey: (id: number) => [
      "invoice-group",
      id,
      "transitions",
    ],
    getGetClaimQueryKey: (id: number) => ["claim", id],
    getListInvoiceGroupsQueryKey: () => ["invoice-groups"],
    getGetResponsesAwaitingReviewCountQueryKey: () => [
      "responses-awaiting-review-count",
    ],
    getGetSopRewindImpactQueryKey: (id: number, params: unknown) => [
      "sop-rewind-impact",
      id,
      params,
    ],
    getListClaimEvidenceQueryKey: (id: number) => ["claim", id, "evidence"],
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
// to a marker div so we can assert it's only ever rendered in the
// drawer (never in the hero).
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

// SOP player is large. Stub to a marker div so we can assert its
// presence/absence per phase.
mock.module("@/components/decision-tree/sop-advance-player", {
  namedExports: {
    SopAdvancePlayer: () =>
      React.createElement("div", { "data-testid": "stub-sop-advance-player" }),
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
    errorTypeId: "errorTypeId" in opts ? opts.errorTypeId : "ET-1",
    errorTypeName: opts.errorTypeId === null ? null : "Wrong member",
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

// ─── (d) Walk in progress mounts the SOP walk hero ─────────────────
test("InlineGroupWorkspaceV3 (has_disputable, walking) — mounts SOP walk hero, no ClaimDetailV2 in hero, no gauntlet card", () => {
  capturedGroup = group([
    leg({ id: 1, sopOutcome: null }),
    leg({ id: 2, sopOutcome: null }),
  ]);
  const html = renderHtml(
    React.createElement(InlineGroupWorkspaceV3, { groupId: 99 }),
  );
  assert.match(html, /data-outlook="has_disputable"/);
  assert.match(html, /data-collapsed="false"/);
  assert.match(html, /data-testid="v3-leg-switcher"/);
  assert.match(html, /data-testid="v3-hero-walk"/);
  assert.match(html, /data-testid="v3-pinned-footer"/);
  // The walk-complete / preview / review / submitted heroes must not
  // appear when we're still walking.
  assert.equal(html.includes('data-testid="v3-hero-walk-complete"'), false);
  assert.equal(html.includes('data-testid="v3-hero-preview"'), false);
  assert.equal(html.includes('data-testid="v3-hero-review"'), false);
  // The classic gauntlet card must NOT be stacked under the hero —
  // its mutations are bound directly into the wizard heroes now.
  assert.equal(html.includes("readback-input"), false);
  assert.equal(html.includes("generate-preview"), false);
  assert.equal(html.includes("submit-to-portal"), false);
  assert.equal(html.includes("invoice-reattest-only-cta"), false);
  assert.equal(html.includes("invoice-nothing-to-do-closeout"), false);
  assert.equal(html.includes('data-testid="v3-offramp-reattest-strip"'), false);
  assert.equal(html.includes('data-testid="v3-offramp-close-strip"'), false);
});

// ─── (e) Walk complete mounts the verdict-summary hero ─────────────
test("InlineGroupWorkspaceV3 (has_disputable, walk complete) — mounts WalkCompleteHero with Generate preview", () => {
  capturedGroup = group([
    leg({ id: 1, sopOutcome: "non_issue" }),
    leg({ id: 2, sopOutcome: "portal_dispute" }),
  ]);
  const html = renderHtml(
    React.createElement(InlineGroupWorkspaceV3, { groupId: 99 }),
  );
  assert.match(html, /data-testid="v3-hero-walk-complete"/);
  assert.match(html, /data-testid="v3-generate-preview"/);
  assert.match(html, /data-testid="v3-verdict-1"/);
  assert.match(html, /data-testid="v3-verdict-2"/);
  assert.equal(html.includes('data-testid="v3-hero-walk"'), false);
  assert.equal(html.includes('data-testid="v3-hero-preview"'), false);
});

// ─── (f) Preview generated mounts the read-only Preview hero ───────
test("InlineGroupWorkspaceV3 (has_disputable, previewed) — mounts read-only PreviewDocHero", () => {
  capturedGroup = group(
    [
      leg({ id: 1, sopOutcome: "non_issue" }),
      leg({ id: 2, sopOutcome: "portal_dispute" }),
    ],
    {
      previewGeneratedAt: "2026-05-07T18:00:00Z",
      aiBaselineSubject: "Dispute for invoice INV-99",
      aiBaselineDescriptionHtml: "Body text rendered by the AI baseline.",
    } as Partial<InvoiceGroupDetailResponse>,
  );
  const html = renderHtml(
    React.createElement(InlineGroupWorkspaceV3, { groupId: 99 }),
  );
  assert.match(html, /data-testid="v3-hero-preview"/);
  assert.match(html, /data-testid="v3-skip-review"/);
  assert.match(html, /data-testid="v3-enter-review"/);
  assert.match(html, /Body text rendered by the AI baseline\./);
  assert.equal(html.includes('data-testid="v3-hero-walk-complete"'), false);
  assert.equal(html.includes('data-testid="v3-hero-review"'), false);
});

// ─── (g) Reviewed mounts the editable Review hero with Submit ──────
test("InlineGroupWorkspaceV3 (has_disputable, reviewed) — mounts editable ReviewEditHero with Submit", () => {
  capturedGroup = group(
    [
      leg({ id: 1, sopOutcome: "non_issue" }),
      leg({ id: 2, sopOutcome: "portal_dispute" }),
    ],
    {
      previewGeneratedAt: "2026-05-07T18:00:00Z",
      draftReviewedAt: "2026-05-07T18:30:00Z",
      draftSubject: "Dispute for invoice INV-99",
      draftDescriptionHtml: "Reviewed body text.",
    } as Partial<InvoiceGroupDetailResponse>,
  );
  const html = renderHtml(
    React.createElement(InlineGroupWorkspaceV3, { groupId: 99 }),
  );
  assert.match(html, /data-testid="v3-hero-review"/);
  assert.match(html, /data-testid="v3-draft-subject-input"/);
  assert.match(html, /data-testid="v3-draft-body-input"/);
  assert.match(html, /data-testid="v3-mark-reviewed"/);
  assert.match(html, /data-testid="v3-submit-to-portal"/);
  assert.equal(html.includes('data-testid="v3-hero-preview"'), false);
});

// ─── (h) reattest_only mounts CTA, never a submission hero ─────────
test("InlineGroupWorkspaceV3 (reattest_only) — mounts Re-attest CTA, no submission heroes", () => {
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
  assert.match(html, /data-testid="v3-pinned-footer"/);
  // V4 Q6 — inline reattest strip replaces the standalone CTA card.
  assert.match(html, /data-testid="v3-hero-reattest"/);
  assert.match(html, /data-testid="v3-offramp-reattest-strip"/);
  assert.match(html, /data-testid="v3-offramp-queue-reattest"/);
  assert.match(html, /data-testid="v3-offramp-note-toggle"/);
  // The off-ramp single-pill stepper renders for reattest.
  assert.match(html, /data-testid="v3-wizard-step-reattest"/);
  // The standalone slot's CTA card and the legacy close-out card
  // must NOT be mounted alongside the inline strip.
  assert.equal(html.includes("invoice-reattest-only-cta"), false);
  assert.equal(html.includes("invoice-nothing-to-do-closeout"), false);
  // No submission-flow heroes for the re-attest path.
  assert.equal(html.includes('data-testid="v3-hero-walk-complete"'), false);
  assert.equal(html.includes('data-testid="v3-hero-preview"'), false);
  assert.equal(html.includes('data-testid="v3-hero-review"'), false);
  assert.equal(html.includes('data-testid="v3-hero-submitted"'), false);
  assert.equal(html.includes('data-testid="v3-offramp-close-strip"'), false);
});

// ─── (j) needs_classification mounts the Classify hero (R4) ───────
// Active leg with no errorTypeId should render the phase-zero
// Classify picker instead of WalkSopHero, and the segmented stepper
// should prepend a "Classify" pill (5-step ladder) with the pill
// label switching to "{n} to classify".
test("InlineGroupWorkspaceV3 (has_disputable, needs_classification) — mounts ClassifyHero + Classify stepper pill", () => {
  capturedGroup = group([
    leg({ id: 1, errorTypeId: null, sopOutcome: null }),
    leg({ id: 2, sopOutcome: null }),
  ]);
  const html = renderHtml(
    React.createElement(InlineGroupWorkspaceV3, { groupId: 99 }),
  );
  assert.match(html, /data-outlook="has_disputable"/);
  assert.match(html, /data-testid="v3-hero-classify"/);
  assert.match(html, /data-testid="v3-classify-search"/);
  assert.match(html, /data-testid="v3-classify-start-walk"/);
  assert.match(html, /1 to classify/);
  assert.match(html, /Classify/);
  // ClassifyHero replaces WalkSopHero for this leg.
  assert.equal(html.includes('data-testid="v3-hero-walk"'), false);
});

test("buildPhaseConfigV3 — has_disputable + needsClassificationCount prepends Classify pill", () => {
  const cfg = buildPhaseConfigV3({
    outlook: "has_disputable",
    legCount: 2,
    resolvedCount: 0,
    previewGenerated: false,
    draftReviewed: false,
    submitted: false,
    needsClassificationCount: 1,
  });
  assert.equal(cfg.steps.length, 5);
  assert.equal(cfg.steps[0], "Classify");
  assert.equal(cfg.activeIndex, 0);
  assert.equal(cfg.pill.label, "1 to classify");
  assert.equal(cfg.pill.tone, "amber");
});

// ─── (i) nothing_to_do collapses chrome to the close-out card ──────
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
  // V4 Q7 — inline close strip replaces the standalone close-out card.
  assert.match(html, /data-testid="v3-hero-close"/);
  assert.match(html, /data-testid="v3-offramp-close-strip"/);
  assert.match(html, /data-testid="v3-offramp-reason-select"/);
  assert.match(html, /data-testid="v3-offramp-close-invoice"/);
  // The off-ramp single-pill stepper renders for close.
  assert.match(html, /data-testid="v3-wizard-step-close"/);
  // The legacy close-out card and the reattest CTA must NOT be mounted.
  assert.equal(html.includes("invoice-nothing-to-do-closeout"), false);
  assert.equal(html.includes("invoice-reattest-only-cta"), false);
  assert.equal(html.includes(`data-testid="v3-leg-switcher"`), false);
  assert.equal(html.includes(`data-testid="v3-pinned-footer"`), false);
  assert.equal(html.includes('data-testid="v3-hero-walk"'), false);
  assert.equal(html.includes('data-testid="v3-hero-walk-complete"'), false);
  assert.equal(html.includes('data-testid="v3-hero-preview"'), false);
  assert.equal(html.includes('data-testid="v3-hero-review"'), false);
  assert.equal(html.includes('data-testid="v3-offramp-reattest-strip"'), false);
});

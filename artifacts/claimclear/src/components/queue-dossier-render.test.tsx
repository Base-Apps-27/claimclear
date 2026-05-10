// Task #675 — restored chip-drawer surface render coverage.
//
// After restoring the pre-#657 right-edge ChipDrawerOverlay + chip
// strip, the queue right pane is no longer the two-column dossier.
// This test pins the new contract:
//   - The pre-#657 wrapper (`inline-group-workspace-mini`) renders.
//   - The chip strip and its four chips render on any walkable hero.
//   - The WalkTranscriptSection (`queue-dossier-section-walk-transcript`)
//     stays inline so operators can backtrack without opening the drawer.
//   - The deleted dossier ids (left/right columns, evidence/notes
//     sections, parent-invoice / payor-verdict / mas-action / activity /
//     group-next-step / hero-gauntlet cards) are absent.
//   - Submitted / withdrawn groups suppress the chip strip + transcript.

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

let currentDetail: any = null;
let currentClaim: any = null;
let currentParams = new URLSearchParams("");

function stub(testid: string) {
  return (props: any) =>
    React.createElement(
      "div",
      { "data-testid": testid },
      props?.children ?? testid,
    );
}

mock.module("wouter", {
  namedExports: {
    Link: ({ href, children }: any) =>
      React.createElement("a", { href }, children),
  },
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
    useGetInvoiceGroup: () => ({ data: currentDetail, isLoading: false }),
    useGetClaim: () => ({ data: currentClaim, isLoading: false }),
    useHoldInvoiceGroup: inertMutation,
    usePlaceLegOnHold: inertMutation,
    useRemoveInvoiceGroupHold: inertMutation,
    useRemoveLegHold: inertMutation,
    useListErrorTypes: () => ({
      data: [
        {
          id: 9,
          name: "Underpayment",
          decisionTree: {
            rootId: "n1",
            nodes: {
              n1: { id: "n1", question: "Q1" },
              n2: { id: "n2", question: "Q2" },
              n3: { id: "n3", question: "Q3" },
            },
          },
        },
      ],
      isLoading: false,
    }),
    useListClaimNotes: () => ({ data: [], isLoading: false }),
    useCreateClaimNote: inertMutation,
    useDeleteNote: inertMutation,
    useGetInvoiceGroupEmailThread: () => ({ data: { conversations: [] }, isLoading: false }),
    useReplyToInvoiceGroupEmailConversation: inertMutation,
    useCreatePortalSubmission: inertMutation,
    useExcludeLeg: inertMutation,
    useMarkLegDuplicate: inertMutation,
    getGetClaimQueryKey: (id: number) => ["getClaim", id],
    getGetInvoiceGroupValidTransitionsQueryKey: (id: number) => ["txn", id],
    getListClaimNotesQueryKey: (id: number) => ["notes", id],
    getGetInvoiceGroupEmailThreadQueryKey: (id: number) => ["thread", id],
    getGetInvoiceGroupQueryKey: (id: number) => ["group", id],
    getListInvoiceGroupsQueryKey: () => ["groups"],
    ApiError: class ApiError extends Error {},
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

mock.module("@workspace/leg-state", {
  namedExports: {
    buildLegResolvedIndex: () => ({
      isLegResolved: (leg: any) =>
        !!leg &&
        (leg.sopOutcome === "cannot_dispute" ||
          leg.sopOutcome === "non_issue" ||
          leg.sopOutcome === "duplicate" ||
          leg.sopOutcome === "internal" ||
          leg.includedInDispute === false),
    }),
    deriveLegSubStatus: (leg: any) =>
      !leg?.errorTypeId ? "needs_classification" : "ready",
  },
});

mock.module("@workspace/vocab", {
  namedExports: { legSubStatusLabel: (s: string) => s },
});

mock.module("@/lib/sop-sibling-eligibility", {
  namedExports: { siblingPromptEligibilityFor: () => null },
});

mock.module("@/lib/use-url-params", {
  namedExports: {
    useUrlParams: () => ({
      get: (k: string) => currentParams.get(k) ?? "",
      set: (next: Record<string, string | null>) => {
        for (const [k, v] of Object.entries(next)) {
          if (v == null) currentParams.delete(k);
          else currentParams.set(k, v);
        }
      },
    }),
  },
});

mock.module("@/lib/whats-next-derivation", {
  namedExports: {
    deriveInvoiceDisputeOutlook: () => ({
      outlook: "has_disputable",
      survivors: [],
      dropped: [],
    }),
    derivePreviewGateState: () => ({ ok: true, blockers: [] }),
  },
});

mock.module("@/lib/lifecycle-phase", {
  namedExports: {
    getGroupLifecyclePhaseFromGroup: (g: any) =>
      g?.phase === "closed"
        ? "closed"
        : g?.phase === "submitted"
          ? "submitted"
          : g?.holdReason
            ? "on-hold"
            : "active",
  },
});

mock.module("@/lib/sop-transcript", {
  namedExports: {
    buildSopTranscript: (answers: any) =>
      Array.isArray(answers)
        ? answers.map((a: any) => ({
            question: `Q ${a.nodeId}`,
            answer: a.answer,
            resolved: true,
          }))
        : [],
  },
});

mock.module("@/lib/apply-mutation-result", {
  namedExports: {
    applyGroupMutationResult: () => {},
    applyLegMutationResult: () => {},
  },
});

mock.module("@/lib/role", {
  namedExports: {
    HideForClerk: ({ children }: any) => children,
    ShowForClerk: ({ children }: any) => children,
  },
});

mock.module("@/lib/format", {
  namedExports: {
    formatCurrency: (v: any) => `$${v}`,
    formatDateTime: (v: any) => String(v),
  },
});

mock.module("@/hooks/use-toast", {
  namedExports: {
    useToast: () => ({ toast: () => {} }),
    successToast: () => {},
    toast: () => {},
  },
});

mock.module("@/hooks/use-local-action-mark", {
  namedExports: { markLocalAction: () => {} },
});

mock.module("@/components/decision-tree/sop-advance-player", {
  namedExports: { SopAdvancePlayer: stub("stub-sop-advance-player") },
});

mock.module("@/components/invoice-group-action-slot", {
  namedExports: { InvoiceGroupActionSlot: stub("stub-group-action-slot") },
});

mock.module("@/components/invoice-group-submission-gauntlet", {
  namedExports: {
    InvoiceGroupSubmissionGauntlet: stub("stub-gauntlet"),
  },
});

mock.module("@/components/activity-feed", {
  namedExports: { ActivityFeed: stub("stub-activity-feed") },
});

mock.module("@/components/evidence-file-list", {
  namedExports: { EvidenceFileList: stub("stub-evidence-file-list") },
});

mock.module("@/components/classify-dialog", {
  namedExports: { ClassifyDialog: () => null },
});

mock.module("@/components/service-date-cell", {
  namedExports: { ServiceDateCell: () => null },
});

mock.module("@/components/hold-reason-select", {
  namedExports: {
    HoldReasonSelect: () => null,
    isHoldReasonValid: () => true,
  },
});

mock.module("@/components/ref-number", {
  namedExports: {
    RefNumber: ({ value }: any) =>
      React.createElement("span", null, value ?? ""),
  },
});

const { InlineGroupWorkspaceMini } = await import("./inline-group-workspace-mini");

void React;

function render(detail: any, claim?: any, qs = ""): string {
  currentDetail = detail;
  currentClaim = claim ?? detail.rides?.[0] ?? null;
  currentParams = new URLSearchParams(qs);
  return renderToStaticMarkup(
    React.createElement(InlineGroupWorkspaceMini, { groupId: detail.id }),
  );
}

function leg(over: any = {}): any {
  return {
    id: over.id ?? 1,
    invoiceGroupId: 100,
    confNumber: over.confNumber ?? `CLM-${over.id ?? 1}`,
    errorTypeId: 9,
    errorTypeName: "Underpayment",
    sopAnswers: [],
    sopNodeId: null,
    sopOutcome: null,
    includedInDispute: true,
    duplicateOfClaimId: null,
    holdReason: null,
    evidenceFiles: [],
    evidenceNotes: "",
    masActionRequired: null,
    masActionCompletedAt: null,
    latestVerdict: null,
    latestDraft: null,
    latestAiSuggestion: null,
    date: "2026-05-01",
    claimAmount: "100",
    ...over,
  };
}

function group(over: any = {}): any {
  return {
    id: over.id ?? 100,
    invoiceNumber: over.invoiceNumber ?? "INV-100",
    rideCount: over.rides?.length ?? 1,
    totalAmount: "1000",
    phase: "pre-submit",
    macroPhase: "pre-submit",
    rides: over.rides ?? [leg()],
    auditLogs: [],
    notes: [],
    evidenceFiles: [],
    holdReason: null,
    closureReason: null,
    payorEmailBounceState: null,
    ...over,
  };
}

const REMOVED_DOSSIER_IDS = [
  "queue-dossier-root",
  "queue-dossier-left",
  "queue-dossier-right",
  "queue-dossier-section-investigation-walk",
  "queue-dossier-section-evidence",
  "queue-dossier-section-internal-notes",
  "queue-dossier-card-parent-invoice",
  "queue-dossier-card-payor-verdict",
  "queue-dossier-card-mas-action",
  "queue-dossier-card-activity",
  "queue-dossier-card-group-next-step",
  "queue-dossier-hero-gauntlet",
];

function assertHas(html: string, id: string, fixture: string) {
  assert.ok(
    html.includes(`data-testid="${id}"`),
    `[${fixture}] expected testid ${id} present`,
  );
}
function assertNo(html: string, id: string, fixture: string) {
  assert.ok(
    !html.includes(`data-testid="${id}"`),
    `[${fixture}] expected testid ${id} ABSENT`,
  );
}

type Fixture = { name: string; detail: any; expectChips: boolean };

const FIXTURES: Fixture[] = [
  {
    name: "a:walkable-no-progress",
    detail: group({ rides: [leg({ id: 1 })] }),
    expectChips: true,
  },
  {
    name: "b:walkable-mid-walk",
    detail: group({
      rides: [
        leg({
          id: 2,
          sopNodeId: "n2",
          sopAnswers: [{ nodeId: "n1", answer: "Yes" }],
        }),
      ],
    }),
    expectChips: true,
  },
  {
    name: "c:terminal-cannot-dispute",
    detail: group({
      rides: [leg({ id: 3, sopOutcome: "cannot_dispute", sopNodeId: "n3" })],
    }),
    expectChips: true,
  },
  {
    name: "f:submitted",
    detail: group({ phase: "submitted", macroPhase: "submitted" }),
    expectChips: false,
  },
  {
    name: "g:withdrawn",
    detail: group({
      phase: "closed",
      macroPhase: "closed",
      closureReason: "cannot_dispute",
    }),
    expectChips: false,
  },
];

for (const fx of FIXTURES) {
  test(`restored chip-strip surface — ${fx.name}`, () => {
    const html = render(fx.detail);
    assertHas(html, "inline-group-workspace-mini", fx.name);
    if (fx.expectChips) {
      assertHas(html, "queue-dossier-section-walk-transcript", fx.name);
      assertHas(html, "mini-chip-strip", fx.name);
      assertHas(html, "mini-chip-evidence", fx.name);
      assertHas(html, "mini-chip-notes", fx.name);
      assertHas(html, "mini-chip-comms", fx.name);
      assertHas(html, "mini-chip-activity", fx.name);
      assertHas(html, "mini-place-leg-hold", fx.name);
    } else {
      assertNo(html, "queue-dossier-section-walk-transcript", fx.name);
      assertNo(html, "mini-chip-strip", fx.name);
    }
    for (const id of REMOVED_DOSSIER_IDS) assertNo(html, id, fx.name);
  });
}

test("Hold-leg button uses chip-peer pill styling, not ghost button", () => {
  const detail = group({ rides: [leg({ id: 7 })] });
  const html = render(detail);
  const idx = html.indexOf('data-testid="mini-place-leg-hold"');
  assert.ok(idx >= 0, "mini-place-leg-hold must render");
  // Walk back to the opening tag and verify the cc-pill cc-pill-amber
  // chip-peer classes are present on the same element.
  const tagStart = html.lastIndexOf("<", idx);
  const tagEnd = html.indexOf(">", idx);
  const tag = html.slice(tagStart, tagEnd + 1);
  assert.ok(
    tag.includes("cc-pill") &&
      tag.includes("cc-pill-amber") &&
      tag.includes("chip-peer"),
    `Hold-leg button must carry cc-pill cc-pill-amber chip-peer classes; got: ${tag}`,
  );
});

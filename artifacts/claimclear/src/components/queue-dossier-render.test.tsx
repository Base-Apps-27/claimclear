// V1 + V2 — Queue dossier render coverage (Task #657).
//
// Mounts `InlineGroupWorkspaceMini` against fixtures that exercise the
// hero-priority ladder and asserts the test-id allowlist contract from
// the task spec. V2 (hero parity) is folded in: for the
// `nothing_to_do` and `reattest_only` fixtures we assert the per-leg
// Investigation walk card AND the Group-next-step card both render.

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

let currentDetail: any = null;
let currentClaim: any = null;
let currentParams = new URLSearchParams("");
let currentOutlook: "has_disputable" | "reattest_only" | "nothing_to_do" =
  "has_disputable";

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
    useMarkLegDuplicate: inertMutation,
    useRecordLegVerdict: inertMutation,
    useClearLegVerdictDraft: inertMutation,
    useCompleteLegMasAction: inertMutation,
    getGetClaimQueryKey: (id: number) => ["getClaim", id],
    getGetInvoiceGroupValidTransitionsQueryKey: (id: number) => ["txn", id],
    getListClaimNotesQueryKey: (id: number) => ["notes", id],
    getGetInvoiceGroupQueryKey: (id: number) => ["group", id],
    getListInvoiceGroupsQueryKey: () => ["groups"],
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
      outlook: currentOutlook,
      survivors: [],
      dropped: [],
    }),
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

mock.module("@/components/per-leg-verdict-picker", {
  namedExports: { PerLegVerdictPicker: stub("stub-per-leg-verdict-picker") },
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
    RefNumber: ({ value }: any) => React.createElement("span", null, value ?? ""),
  },
});

const { InlineGroupWorkspaceMini } = await import("./inline-group-workspace-mini");

void React;

function render(
  detail: any,
  claim?: any,
  qs = "",
  outlook: typeof currentOutlook = "has_disputable",
): string {
  currentDetail = detail;
  currentClaim = claim ?? detail.rides?.[0] ?? null;
  currentParams = new URLSearchParams(qs);
  currentOutlook = outlook;
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

const REQUIRED_DOSSIER_IDS = [
  "queue-dossier-root",
  "queue-dossier-left",
  "queue-dossier-right",
  "queue-dossier-section-walk-transcript",
  "queue-dossier-section-investigation-walk",
  "queue-dossier-section-evidence",
  "queue-dossier-section-internal-notes",
  "queue-dossier-card-parent-invoice",
  "queue-dossier-card-payor-verdict",
  "queue-dossier-card-mas-action",
  "queue-dossier-card-activity",
];

const BLOCKLIST_IDS = [
  "chip-drawer-overlay",
  "chip-drawer-evidence",
  "chip-drawer-notes",
  "chip-drawer-comms",
  "chip-drawer-activity",
  "chip-drawer-reclassify",
  "mini-chip-strip",
  "mini-chip-evidence",
  "mini-chip-notes",
  "mini-chip-comms",
  "mini-chip-activity",
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

type Outlook = "has_disputable" | "reattest_only" | "nothing_to_do";
type Fixture = {
  name: string;
  detail: any;
  expectDossier: boolean;
  outlook: Outlook;
};

const FIXTURES: Fixture[] = [
  {
    name: "a:walkable-no-progress",
    detail: group({ rides: [leg({ id: 1 })] }),
    expectDossier: true,
    outlook: "has_disputable",
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
    expectDossier: true,
    outlook: "has_disputable",
  },
  {
    name: "c:terminal-cannot-dispute",
    detail: group({
      rides: [leg({ id: 3, sopOutcome: "cannot_dispute", sopNodeId: "n3" })],
    }),
    expectDossier: true,
    outlook: "nothing_to_do",
  },
  {
    name: "d:single-leg-nothing-to-do",
    detail: group({
      macroPhase: "pre-submit",
      rides: [leg({ id: 4, sopOutcome: "cannot_dispute", sopNodeId: "n3" })],
    }),
    expectDossier: true,
    outlook: "nothing_to_do",
  },
  {
    name: "e:multi-leg-reattest-only",
    detail: group({
      macroPhase: "response-pending",
      rides: [
        leg({ id: 5, sopOutcome: "cannot_dispute" }),
        leg({ id: 6, sopOutcome: null, sopNodeId: "n2" }),
      ],
    }),
    expectDossier: true,
    outlook: "reattest_only",
  },
  {
    name: "f:submitted",
    detail: group({ phase: "submitted", macroPhase: "submitted" }),
    expectDossier: false,
    outlook: "has_disputable",
  },
  {
    name: "g:withdrawn",
    detail: group({
      phase: "closed",
      macroPhase: "closed",
      closureReason: "cannot_dispute",
    }),
    expectDossier: false,
    outlook: "has_disputable",
  },
];

for (const fx of FIXTURES) {
  test(`V1 dossier presence — ${fx.name}`, () => {
    const html = render(fx.detail, undefined, "", fx.outlook);
    assertHas(html, "queue-dossier-root", fx.name);
    if (fx.expectDossier) {
      for (const id of REQUIRED_DOSSIER_IDS) assertHas(html, id, fx.name);
      // Outlook-specific placement: gauntlet hero vs demoted card.
      if (fx.outlook === "has_disputable") {
        assertHas(html, "queue-dossier-hero-gauntlet", fx.name);
        assertNo(html, "queue-dossier-card-group-next-step", fx.name);
      } else {
        assertNo(html, "queue-dossier-hero-gauntlet", fx.name);
        assertHas(html, "queue-dossier-card-group-next-step", fx.name);
      }
    } else {
      assertNo(html, "queue-dossier-left", fx.name);
      assertNo(html, "queue-dossier-right", fx.name);
      assertNo(html, "queue-dossier-hero-gauntlet", fx.name);
      assertNo(html, "queue-dossier-card-group-next-step", fx.name);
    }
    for (const id of BLOCKLIST_IDS) assertNo(html, id, fx.name);
  });
}

function assertSopPlayerInsideInvestigationWalk(html: string, fixture: string) {
  const startIdx = html.indexOf(
    'data-testid="queue-dossier-section-investigation-walk"',
  );
  assert.ok(
    startIdx >= 0,
    `[${fixture}] queue-dossier-section-investigation-walk not found`,
  );
  // The walk section is the last left-column section before the right
  // column. Slice from this section to the next dossier-section/card
  // boundary and assert the SopAdvancePlayer stub renders inside.
  const tail = html.slice(startIdx);
  const nextBoundary = tail
    .slice(1)
    .search(/data-testid="queue-dossier-(section|card|right)-/);
  const window = nextBoundary >= 0 ? tail.slice(0, nextBoundary + 1) : tail;
  assert.ok(
    window.includes('data-testid="stub-sop-advance-player"'),
    `[${fixture}] SopAdvancePlayer must mount inside the investigation-walk section so the per-leg walk stays reachable`,
  );
}

test("V2 hero parity — nothing_to_do still shows the per-leg walk and demotes the CTA", () => {
  const fx = FIXTURES.find((f) => f.name === "d:single-leg-nothing-to-do")!;
  const html = render(fx.detail, undefined, "", fx.outlook);
  assertHas(html, "queue-dossier-section-investigation-walk", fx.name);
  assertHas(html, "queue-dossier-card-group-next-step", fx.name);
  assertNo(html, "queue-dossier-hero-gauntlet", fx.name);
  assertSopPlayerInsideInvestigationWalk(html, fx.name);
  assert.ok(
    html.includes('data-testid="stub-group-action-slot"'),
    "group-next-step card should mount InvoiceGroupActionSlot",
  );
});

test("V2 hero parity — reattest_only still shows the per-leg walk and demotes the CTA", () => {
  const fx = FIXTURES.find((f) => f.name === "e:multi-leg-reattest-only")!;
  const html = render(fx.detail, undefined, "", fx.outlook);
  assertHas(html, "queue-dossier-section-investigation-walk", fx.name);
  assertHas(html, "queue-dossier-card-group-next-step", fx.name);
  assertNo(html, "queue-dossier-hero-gauntlet", fx.name);
  assertSopPlayerInsideInvestigationWalk(html, fx.name);
  assert.ok(
    html.includes('data-testid="stub-group-action-slot"'),
    "group-next-step card should mount InvoiceGroupActionSlot",
  );
});

test("V2 anti-drift — has_disputable keeps the gauntlet in the hero slot", () => {
  const detail = group({ rides: [leg({ id: 7 })] });
  const html = render(detail, undefined, "", "has_disputable");
  assertHas(html, "queue-dossier-hero-gauntlet", "has_disputable");
  assertNo(html, "queue-dossier-card-group-next-step", "has_disputable");
  assert.ok(
    html.includes('data-testid="stub-group-action-slot"'),
    "hero gauntlet should mount InvoiceGroupActionSlot",
  );
});

test("V1 hero attribute exposes the active leg for the URL contract", () => {
  const detail = group({ rides: [leg({ id: 42 })] });
  const html = render(detail, undefined, "leg=42");
  assert.match(html, /data-active-leg="42"/);
  assert.match(html, /data-hero="(sop|classify|resolved)"/);
});

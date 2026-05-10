// V3 — Removal proof for the chip-drawer model (Task #657).

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
    Link: ({ href, children }: any) => React.createElement("a", { href }, children),
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
    useListErrorTypes: () => ({ data: [], isLoading: false }),
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
    buildLegResolvedIndex: () => ({ isLegResolved: () => false }),
    deriveLegSubStatus: () => "ready",
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
      outlook: "has_disputable",
      survivors: [],
      dropped: [],
    }),
  },
});

mock.module("@/lib/lifecycle-phase", {
  namedExports: { getGroupLifecyclePhaseFromGroup: () => "active" },
});

mock.module("@/lib/sop-transcript", {
  namedExports: { buildSopTranscript: () => [] },
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
  namedExports: { SopAdvancePlayer: stub("stub-sop") },
});

mock.module("@/components/invoice-group-action-slot", {
  namedExports: { InvoiceGroupActionSlot: stub("stub-action-slot") },
});

mock.module("@/components/per-leg-verdict-picker", {
  namedExports: { PerLegVerdictPicker: stub("stub-picker") },
});

mock.module("@/components/activity-feed", {
  namedExports: { ActivityFeed: stub("stub-feed") },
});

mock.module("@/components/evidence-file-list", {
  namedExports: { EvidenceFileList: stub("stub-evidence") },
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

const FIXTURE_DETAIL = {
  id: 100,
  invoiceNumber: "INV-100",
  rideCount: 1,
  totalAmount: "1000",
  phase: "pre-submit",
  macroPhase: "pre-submit",
  rides: [
    {
      id: 1,
      invoiceGroupId: 100,
      confNumber: "CLM-1",
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
    },
  ],
  auditLogs: [],
  notes: [],
  evidenceFiles: [],
  holdReason: null,
  closureReason: null,
  payorEmailBounceState: null,
};

const BLOCKLIST_IDS = [
  "chip-drawer-overlay",
  "chip-drawer-evidence",
  "chip-drawer-notes",
  "chip-drawer-comms",
  "chip-drawer-activity",
  "chip-drawer-reclassify",
  "chip-drawer-backdrop",
  "chip-drawer-close",
  "chip-drawer-leg-tabs",
  "chip-drawer-section-close",
  "mini-chip-strip",
  "mini-chip-evidence",
  "mini-chip-notes",
  "mini-chip-comms",
  "mini-chip-activity",
];

test("V3 chip-drawer model is fully removed from the queue right pane", () => {
  currentDetail = FIXTURE_DETAIL;
  currentClaim = FIXTURE_DETAIL.rides[0];
  currentParams = new URLSearchParams("");
  const html = renderToStaticMarkup(
    React.createElement(InlineGroupWorkspaceMini, { groupId: FIXTURE_DETAIL.id }),
  );
  assert.match(html, /data-testid="queue-dossier-root"/);
  for (const id of BLOCKLIST_IDS) {
    assert.ok(
      !html.includes(`data-testid="${id}"`),
      `expected chip/drawer testid ${id} to be ABSENT after refactor`,
    );
  }
});

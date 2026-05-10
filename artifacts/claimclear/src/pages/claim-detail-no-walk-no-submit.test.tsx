// Task #658 — V1 + V2 verification: prove that the standalone
// `/claims/:id` page no longer mounts the live SOP player and
// no longer surfaces any submission-progression action, while
// still exposing the queue deep-link CTA + recovery actions.
//
// Renders `ClaimDetailV2` with `embedded={false}` (the same way
// `pages/claim-detail.tsx` does) for five fixtures covering the
// realistic state cross-section: walkable, walked-to-terminal,
// hold, non_issue, classified-but-not-walked. For each fixture
// asserts:
//   - Every test-id in the task's blocklist is ABSENT.
//   - Every required test-id in the allowlist is PRESENT.
//   - The queue-deep-link CTA's `href` is exactly
//     `/queue?group=<groupId>&leg=<legId>` (V2).

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

type AnyClaim = Record<string, unknown> & { id: number; invoiceGroupId: number };

let currentClaim: AnyClaim | null = null;
let currentGroup: Record<string, unknown> | null = null;
let currentSubStatus = "investigating";

function stub(testid: string) {
  return (props: any) =>
    React.createElement("div", { "data-testid": testid }, props?.children ?? testid);
}

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

mock.module("wouter", {
  namedExports: {
    Link: ({ href, children }: any) => React.createElement("a", { href }, children),
    useParams: () => ({ id: String(currentClaim?.id ?? 0) }),
  },
});

mock.module("@workspace/api-client-react", {
  namedExports: {
    useGetClaim: () => ({ data: currentClaim, isLoading: false }),
    useGetInvoiceGroup: () => ({ data: currentGroup, isLoading: false }),
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
            },
          },
        },
      ],
      isLoading: false,
    }),
    useReclassifyLeg: inertMutation,
    useExcludeLeg: inertMutation,
    useMarkLegDuplicate: inertMutation,
    useUnmarkLegDuplicate: inertMutation,
    useListClaimNotes: () => ({ data: [], isLoading: false }),
    useCreateClaimNote: inertMutation,
    useDeleteNote: inertMutation,
    useListClaimAuditLogs: () => ({ data: [], isLoading: false }),
    useListClaimEvidence: () => ({ data: { evidence: [] }, isLoading: false }),
    useGetClaimEmailThread: () => ({ data: { messages: [] }, isLoading: false }),
    useRecordLegVerdict: inertMutation,
    useClearLegVerdictDraft: inertMutation,
    useCompleteLegMasAction: inertMutation,
    useSopRestartLeg: inertMutation,
    useSopBackStepLeg: inertMutation,
    usePlaceLegOnHold: inertMutation,
    useClearLegHold: inertMutation,
    getGetClaimQueryKey: (id: number) => ["getClaim", id],
    getGetInvoiceGroupQueryKey: (id: number) => ["group", id],
    getListClaimNotesQueryKey: (id: number) => ["notes", id],
    getListClaimAuditLogsQueryKey: (id: number) => ["audit", id],
    getListClaimEvidenceQueryKey: (id: number) => ["evidence", id],
    getGetClaimEmailThreadQueryKey: (id: number) => ["thread", id],
    getListInvoiceGroupsQueryKey: () => ["groups"],
  },
});

mock.module("@workspace/api-zod", {
  namedExports: { EMAIL_MESSAGE_MAX_BYTES: 25 * 1024 * 1024 },
});

mock.module("@tanstack/react-query", {
  namedExports: {
    useQueryClient: () => ({ invalidateQueries: () => {}, setQueryData: () => {} }),
  },
});

mock.module("@workspace/replit-auth-web", {
  namedExports: { useAuth: () => ({ user: { id: "u1", email: "u@example.com" } }) },
});

mock.module("@workspace/leg-state", {
  namedExports: {
    deriveLegSubStatus: () => currentSubStatus,
    isLegacyDerivedContext: () => false,
  },
});

mock.module("@/hooks/use-claim-events", {
  namedExports: { useClaimEvents: () => ({ lastClaimUpdateBy: null }) },
});
mock.module("@/hooks/use-local-action-mark", {
  namedExports: { markLocalAction: () => {} },
});
mock.module("@/hooks/use-session-milestones", {
  namedExports: { notifyClaimProcessedThisSession: () => {} },
});
mock.module("@/hooks/use-actor-caused-transition", {
  namedExports: { useActorCausedTransition: () => {} },
});
mock.module("@/hooks/use-transient-flag", {
  namedExports: { useTransientFlag: () => ({ active: false, fire: () => {} }) },
});
mock.module("@/hooks/use-toast", {
  namedExports: {
    useToast: () => ({ toast: () => {} }),
    successToast: () => {},
    toast: () => {},
  },
});
mock.module("@/hooks/use-breath", {
  namedExports: { useBreath: () => ({ trigger: () => {}, breathing: false, className: "" }) },
});

mock.module("@/lib/sop-transcript", {
  namedExports: {
    buildSopTranscript: (answers: any) =>
      Array.isArray(answers)
        ? answers.map((a: any, i: number) => ({
            question: `Q${i + 1}`,
            answer: a?.answer ?? "Yes",
            resolved: true,
          }))
        : [],
  },
});

mock.module("@/lib/sop-sibling-eligibility", {
  namedExports: {
    buildTripOverridingErrorTypeIds: () => new Set(),
    findSiblingDuplicatePrimaryCandidates: () => [],
    siblingPromptEligibilityFor: () => null,
  },
});

mock.module("@/lib/format", {
  namedExports: { formatCurrency: (v: any) => `$${v}`, formatDateTime: (v: any) => String(v) },
});
mock.module("@/lib/time", {
  namedExports: { formatRelative: () => "now", absoluteTooltip: () => "" },
});
mock.module("@/lib/role", {
  namedExports: {
    HideForClerk: ({ children }: any) => children,
    ShowForClerk: ({ children }: any) => children,
  },
});
mock.module("@/lib/utils", { namedExports: { cn: (...xs: any[]) => xs.filter(Boolean).join(" ") } });

mock.module("@/components/back-bar", {
  namedExports: { BackBar: () => null },
});
mock.module("@/components/cohesion", {
  namedExports: { TonePill: ({ children }: any) => React.createElement("span", null, children) },
});
mock.module("@/components/state-badge", {
  namedExports: { StateBadge: ({ value }: any) => React.createElement("span", null, String(value)) },
});
mock.module("@/components/ref-number", {
  namedExports: { RefNumber: ({ value }: any) => React.createElement("span", null, value ?? "") },
});
mock.module("@/components/classify-dialog", {
  namedExports: { ClassifyDialog: () => null },
});
mock.module("@/components/hold-reason-select", {
  namedExports: {
    HoldReasonSelect: () => React.createElement("div", { "data-testid": "stub-hold-reason-select" }),
    isHoldReasonValid: () => false,
    holdReasonLabel: (r: string) => r,
  },
});
mock.module("@/components/decision-tree/sop-advance-player", {
  namedExports: { SopAdvancePlayer: stub("LIVE-SOP-PLAYER-MOUNTED") },
});
mock.module("@/components/decision-tree/terminals/duplicate-terminal", {
  namedExports: { DuplicateTerminal: stub("stub-duplicate-terminal") },
});
mock.module("@/components/per-leg-verdict-picker", {
  namedExports: { PerLegVerdictPicker: stub("stub-verdict-picker") },
});

// Headless primitives — render children only.
const passthrough = ({ children }: any) => React.createElement(React.Fragment, null, children);
const headlessTrigger = ({ children, asChild, ...rest }: any) =>
  asChild ? children : React.createElement("button", rest, children);
mock.module("@/components/ui/button", {
  namedExports: {
    Button: ({ children, ...rest }: any) =>
      React.createElement("button", rest, children),
  },
});
mock.module("@/components/ui/textarea", {
  namedExports: {
    Textarea: (props: any) => React.createElement("textarea", props),
  },
});
mock.module("@/components/ui/dialog", {
  namedExports: {
    Dialog: passthrough,
    DialogContent: passthrough,
    DialogFooter: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
    DialogTrigger: headlessTrigger,
  },
});
mock.module("@/components/ui/alert-dialog", {
  namedExports: {
    AlertDialog: passthrough,
    AlertDialogAction: ({ children, ...rest }: any) =>
      React.createElement("button", rest, children),
    AlertDialogCancel: ({ children, ...rest }: any) =>
      React.createElement("button", rest, children),
    AlertDialogContent: passthrough,
    AlertDialogDescription: passthrough,
    AlertDialogFooter: passthrough,
    AlertDialogHeader: passthrough,
    AlertDialogTitle: passthrough,
  },
});
mock.module("@/components/ui/select", {
  namedExports: {
    Select: passthrough,
    SelectContent: passthrough,
    SelectItem: passthrough,
    SelectTrigger: passthrough,
    SelectValue: passthrough,
  },
});

// Lucide icons → simple <i> stubs so renderToStaticMarkup stays cheap.
const LUCIDE_ICONS = [
  "Loader2", "RotateCcw", "AlertTriangle", "RefreshCw", "XCircle", "FileText",
  "Copy", "Link2Off", "Edit2", "Pin", "Plus", "Mail", "ArrowUpRight", "Lock",
  "Activity", "Paperclip", "Gavel", "Stamp", "Clock", "Send", "CheckCircle2",
  "ListChecks", "Trash2", "Tag", "Sparkles", "ChevronDown", "ChevronUp",
  "ChevronRight", "ChevronLeft", "X", "Check", "Info", "AlertCircle",
  "ExternalLink", "Download", "Upload", "Search", "Filter", "MoreHorizontal",
  "MoreVertical", "Eye", "EyeOff", "Calendar", "User", "Users", "Settings",
  "HelpCircle", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
  "MessageSquare", "Bell", "Star", "Heart", "Bookmark", "Flag", "Globe",
  "Home", "FolderOpen", "File", "FileEdit", "FileX", "Inbox", "Archive",
  "Clipboard", "ClipboardCheck", "Zap", "Shield", "ShieldAlert", "ShieldCheck",
  "ThumbsUp", "ThumbsDown", "Play", "Pause", "Square", "Circle", "Triangle",
  "Hash", "AtSign", "Percent", "DollarSign", "PlusCircle", "MinusCircle",
  "Undo", "Undo2", "Redo", "Redo2", "Save", "Pencil", "PenLine",
];
const lucideStubs: Record<string, any> = {};
for (const name of LUCIDE_ICONS) {
  lucideStubs[name] = (props: any) => React.createElement("i", props);
}
mock.module("lucide-react", { namedExports: lucideStubs });

const { ClaimDetailV2 } = await import("../components/claim-detail-v2");

void React;

const BLOCKLIST_TESTIDS = [
  "mini-start-walk",
  "start-walk",
  "sop-answer-button",
  "sop-advance-button",
  "sop-bulk-apply-checkbox",
  "gauntlet-root",
  "gauntlet-submit",
  "gauntlet-mark-reviewed",
  "gauntlet-generate-preview",
  "gauntlet-draft-subject",
  "gauntlet-draft-body",
  "submit-to-portal",
  "send-dispute",
  "mark-as-reviewed",
  "generate-preview",
  // The SopAdvancePlayer stub renders "LIVE-SOP-PLAYER-MOUNTED" when the
  // live player gets mounted. On /claims/:id (embedded=false) it must
  // never appear — that's the whole anti-drift contract.
  "LIVE-SOP-PLAYER-MOUNTED",
];

const BLOCKLIST_VERB_PHRASES = [
  /Submit to portal/i,
  /Generate preview/i,
  /Mark reviewed/i,
  /Mark as reviewed/i,
  /Send dispute/i,
  /\bStart walk\b/i,
];

function makeGroup(extra: Record<string, unknown> = {}) {
  return {
    id: 100,
    invoiceNumber: "INV-100",
    rideCount: 1,
    totalAmount: "1000",
    status: "Pre-submit",
    macroPhase: "pre-submit",
    rides: [],
    evidenceFiles: [],
    ...extra,
  };
}

function makeLeg(extra: Record<string, unknown> = {}): AnyClaim {
  return {
    id: 501,
    invoiceGroupId: 100,
    confNumber: "CLM-501",
    errorTypeId: 9,
    errorTypeName: "Underpayment",
    sopAnswers: [],
    sopNodeId: null,
    sopOutcome: null,
    dropReason: null,
    includedInDispute: true,
    duplicateOfClaimId: null,
    holdReason: null,
    perLegContext: null,
    evidenceFiles: [],
    masActionRequired: null,
    masActionCompletedAt: null,
    masActionNote: null,
    latestVerdict: null,
    latestDraft: null,
    latestAiSuggestion: null,
    date: "2026-05-01",
    claimAmount: "100",
    updatedAt: "2026-05-01T00:00:00Z",
    status: "In progress",
    ...extra,
  };
}

const FIXTURES: Array<{
  name: string;
  subStatus: string;
  leg: AnyClaim;
  group?: Record<string, unknown>;
  // #687 — RecoveryActions removed from /claims/:id. The leg page no
  // longer renders Place/Release leg-hold or Restart/Change-answer
  // buttons. Hold place/release lives only in V3HoldExit hero in A;
  // walk progression lives only in the queue. Fixtures retained for
  // shape coverage but expect* flags are uniformly false now.
  expectHoldMeta?: string | null;
}> = [
  {
    name: "(a) walkable leg — fresh, no answers yet",
    subStatus: "investigating",
    leg: makeLeg({ id: 501 }),
  },
  {
    name: "(b) walked-to-terminal leg",
    subStatus: "ready",
    leg: makeLeg({
      id: 502,
      sopAnswers: [{ nodeId: "n1", answer: "Yes" }],
      sopNodeId: "n1",
      sopOutcome: "portal_dispute",
    }),
  },
  {
    name: "(c) hold leg",
    subStatus: "blocked",
    leg: makeLeg({
      id: 503,
      holdReason: "awaiting_internal_review",
    }),
    expectHoldMeta: "awaiting_internal_review",
  },
  {
    name: "(d) non_issue leg",
    subStatus: "dropped",
    leg: makeLeg({
      id: 504,
      sopAnswers: [{ nodeId: "n1", answer: "No" }],
      sopOutcome: "non_issue",
      dropReason: "non_issue",
    }),
  },
  {
    name: "(e) classified-but-not-walked leg",
    subStatus: "investigating",
    leg: makeLeg({ id: 505 }),
  },
];

// Task #664 — guard rail: render must never reach window.confirm/prompt.
// The previous implementation called those browser primitives from the
// recovery action click handlers; the new implementation uses the shared
// AlertDialog + HoldReasonSelect UI. We blow up the test if anything in
// the render tree even touches them.
const originalConfirm = globalThis.confirm;
const originalPrompt = globalThis.prompt;
(globalThis as any).confirm = () => {
  throw new Error("window.confirm must not be invoked from claim-detail render");
};
(globalThis as any).prompt = () => {
  throw new Error("window.prompt must not be invoked from claim-detail render");
};
process.on("exit", () => {
  (globalThis as any).confirm = originalConfirm;
  (globalThis as any).prompt = originalPrompt;
});

for (const fx of FIXTURES) {
  test(`Task #658 V1+V2 — ${fx.name}`, () => {
    currentClaim = fx.leg;
    currentGroup = makeGroup(fx.group ?? {});
    currentSubStatus = fx.subStatus;

    const html = renderToStaticMarkup(
      React.createElement(ClaimDetailV2, { claimId: fx.leg.id, embedded: false }),
    );

    // Blocklist test-ids — must be ABSENT.
    for (const id of BLOCKLIST_TESTIDS) {
      assert.ok(
        !html.includes(`data-testid="${id}"`),
        `expected blocklist testid '${id}' to be ABSENT on /claims/:id (${fx.name})`,
      );
    }

    // Blocklist verb phrases — must be ABSENT in user-visible text.
    for (const re of BLOCKLIST_VERB_PHRASES) {
      assert.ok(
        !re.test(html),
        `expected blocklist phrase ${re} to be ABSENT on /claims/:id (${fx.name})`,
      );
    }

    // Required test-ids — must be PRESENT.
    const required = [
      "claim-detail-walk-transcript-readonly",
      "claim-detail-cta-walk-in-queue",
      "claim-detail-section-evidence",
      "claim-detail-section-internal-notes",
      "claim-detail-section-activity",
    ];
    for (const id of required) {
      assert.ok(
        html.includes(`data-testid="${id}"`),
        `expected required testid '${id}' on /claims/:id (${fx.name})`,
      );
    }

    // V2 — Deep-link CTA href contract.
    const expectedHref = `/queue?group=${(currentGroup as any).id}&amp;leg=${fx.leg.id}`;
    assert.ok(
      html.includes(`href="${expectedHref}"`),
      `expected queue deep-link href '${expectedHref}' on /claims/:id (${fx.name})`,
    );

    // #687 — Recovery actions (Place/Release leg-hold, Restart walk,
    // Change my answer) are NEVER rendered on /claims/:id anymore.
    // Place/release lives in the V3HoldExit hero in A; walk
    // progression lives in the queue. Assert all four are absent
    // unconditionally; the only hold surface left here is the
    // read-only "On hold: <reason>" meta line in the leg header.
    for (const id of [
      "claim-detail-action-change-my-answer",
      "claim-detail-action-restart-walk",
      "claim-detail-action-place-leg-hold",
      "claim-detail-action-release-leg-hold",
    ]) {
      assert.ok(
        !html.includes(`data-testid="${id}"`),
        `did NOT expect '${id}' on ${fx.name} (#687: removed from /claims/:id)`,
      );
    }
    if (fx.expectHoldMeta) {
      const metaIdx = html.indexOf(`data-testid="leg-header-hold-meta"`);
      assert.ok(
        metaIdx > 0,
        `expected leg-header hold meta on ${fx.name}`,
      );
      const metaSlice = html.slice(metaIdx, metaIdx + 400);
      assert.ok(
        metaSlice.includes("On hold:") && metaSlice.includes(fx.expectHoldMeta),
        `expected "On hold: ${fx.expectHoldMeta}" in leg-header meta on ${fx.name}`,
      );
    } else {
      assert.ok(
        !html.includes(`data-testid="leg-header-hold-meta"`),
        `did NOT expect leg-header hold meta on ${fx.name}`,
      );
    }

    // V2-extra — primary CTA copy must contain the literal arrow glyph
    // exactly as specified in the task ("Walk this leg in the queue →").
    const ctaIdx = html.indexOf(`data-testid="claim-detail-cta-walk-in-queue"`);
    assert.ok(ctaIdx > 0, `CTA element missing on ${fx.name}`);
    const ctaSlice = html.slice(ctaIdx, ctaIdx + 400);
    assert.match(
      ctaSlice,
      /Walk this leg in the queue\s+→/,
      `expected literal "Walk this leg in the queue →" copy in CTA on ${fx.name}`,
    );

    // Reclassify must remain available across all walkable / walked /
    // hold fixtures (it's the safety-net escape from a bad classify).
    if (fx.subStatus !== "needs_classification" && fx.subStatus !== "excluded") {
      assert.ok(
        html.includes(`data-testid="claim-detail-action-reclassify"`),
        `expected reclassify action on ${fx.name}`,
      );
    }
  });
}

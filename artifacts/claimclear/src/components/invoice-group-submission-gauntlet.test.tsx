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
    usePortalUnderstandingPreflight: inertMutation,
    useStampPreviewGenerated: inertMutation,
    useCreatePortalSubmission: inertMutation,
    useSaveInvoiceGroupDraft: inertMutation,
    useRegenerateInvoiceGroupDraft: inertMutation,
    useMarkInvoiceGroupDraftReviewed: inertMutation,
    // Task #685 (R3): per-leg overflow's "Redo walk" reuses A's
    // clear-verdict-draft hook. Inert-stub it so the SSR render and
    // the menu-trigger render don't pull network code.
    useClearLegVerdictDraft: inertMutation,
    getGetInvoiceGroupQueryKey: (id: number) => ["invoice-group", id],
    getGetInvoiceGroupValidTransitionsQueryKey: (id: number) => [
      "invoice-group",
      id,
      "transitions",
    ],
    getGetClaimQueryKey: (id: number) => ["claim", id],
    getListInvoiceGroupsQueryKey: () => ["invoice-groups", "list"],
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

function group(
  rides: ClaimResponse[],
  over: Partial<InvoiceGroupDetailResponse> = {},
): InvoiceGroupDetailResponse {
  return {
    id: 42,
    confNumber: "GRP-42",
    status: "New", // → isPreSubmit, so the gate is live
    phase: "triage",
    // Task #555: the preview gate now also requires the operator-confirmed
    // understanding readback (#168). Pin it on the fixture so the gate
    // tests focus on the leg-resolution rule.
    understandingReadbackAt: "2026-01-01T00:00:00Z",
    rides,
    submissions: [],
    notes: [],
    auditLogs: [],
    responses: [],
    ...over,
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
// Task #683 — AI summary hero (Q1–Q7 graduation). Visual-only block
// rendered above the existing readback step. Asserts the SSR-stable
// contract: hero appears, one card per disputed leg (with the leg's
// confNumber), and the resolved-N-of-M counter reflects the
// resolved-leg index.
// ─────────────────────────────────────────────────────────────────────
test("gauntlet hero: renders one card per disputed leg with conf number + resolved counter", () => {
  const ready = claim({
    id: 700,
    confNumber: "RIDE-700",
    errorTypeId: "ET-1",
    sopOutcome: "dispute", // → ready/resolved
  });
  const investigating = claim({
    id: 701,
    confNumber: "RIDE-701",
    errorTypeId: "ET-1",
    sopOutcome: null, // → investigating/unresolved
  });
  const html = render(
    React.createElement(InvoiceGroupSubmissionGauntlet, {
      group: group([ready, investigating]),
      groupId: 42,
    }),
  );

  // Hero shell present, above the existing claim-id strip.
  assert.match(html, /data-testid="gauntlet-hero"/);
  // One card per disputed leg, with the leg's confNumber rendered
  // through <RefNumber />.
  assert.match(html, /data-testid="gauntlet-hero-card-700"[^>]*>[\s\S]*RIDE-700/);
  assert.match(html, /data-testid="gauntlet-hero-card-701"[^>]*>[\s\S]*RIDE-701/);
  // Resolved-N-of-M counter — 1 of 2 (only `ready` is resolved).
  assert.match(
    html,
    /data-testid="gauntlet-hero-resolved-counter"[\s\S]*?>1<\/span>[\s\S]*?>2<\/span>/,
  );
});

// Hero off-ramps (Re-attest / Close) and attachments rail are visual
// indicators bound to existing payload fields — no new mutations.
// Asserts they appear when the underlying field is set, and stay
// hidden otherwise so quiet groups don't carry empty chrome.
test("gauntlet hero: attachments rail + Re-attest/Close off-ramps render from payload", () => {
  const ride = claim({
    id: 900,
    confNumber: "RIDE-900",
    errorTypeId: "ET-1",
    sopOutcome: "dispute",
  });
  const html = render(
    React.createElement(InvoiceGroupSubmissionGauntlet, {
      group: group([ride], {
        reattestRequired: true,
        closureReason: "approved",
        evidenceFiles: [
          { url: "/objects/abc/release.pdf", name: "release.pdf" },
          { url: "/objects/abc/gps.csv" },
        ],
      } as unknown as Partial<InvoiceGroupDetailResponse>),
      groupId: 42,
    }),
  );

  assert.match(html, /data-testid="gauntlet-hero-attachments"/);
  assert.match(html, /data-testid="gauntlet-hero-attachment-0"[^>]*>release\.pdf/);
  assert.match(html, /data-testid="gauntlet-hero-attachment-1"[^>]*>gps\.csv/);
  assert.match(
    html,
    /data-testid="gauntlet-hero-offramp-reattest"[^>]*data-state="required"/,
  );
  assert.match(
    html,
    /data-testid="gauntlet-hero-offramp-close"[^>]*data-state="closed"/,
  );
});

test("gauntlet hero: off-ramps + attachments rail are hidden when fields are unset", () => {
  const ride = claim({
    id: 901,
    confNumber: "RIDE-901",
    errorTypeId: "ET-1",
    sopOutcome: "dispute",
  });
  const html = render(
    React.createElement(InvoiceGroupSubmissionGauntlet, {
      group: group([ride]),
      groupId: 42,
    }),
  );

  assert.equal(html.includes(`data-testid="gauntlet-hero-attachments"`), false);
  assert.equal(
    html.includes(`data-testid="gauntlet-hero-offramp-reattest"`),
    false,
  );
  assert.equal(
    html.includes(`data-testid="gauntlet-hero-offramp-close"`),
    false,
  );
});

// Excluded legs (`includedInDispute === false`) are filtered out of
// the disputed `rides` set, and so must not get a hero card. This
// keeps the card count aligned with the resolved-N-of-M counter and
// the "what feeds the AI prompt" mental model.
test("gauntlet hero: excluded legs are not rendered as hero cards", () => {
  const included = claim({
    id: 800,
    confNumber: "RIDE-800",
    errorTypeId: "ET-1",
    sopOutcome: "dispute",
  });
  const excluded = claim({
    id: 801,
    confNumber: "RIDE-801",
    includedInDispute: false,
  });
  const html = render(
    React.createElement(InvoiceGroupSubmissionGauntlet, {
      group: group([included, excluded]),
      groupId: 42,
    }),
  );

  assert.match(html, /data-testid="gauntlet-hero-card-800"/);
  assert.equal(
    html.includes(`data-testid="gauntlet-hero-card-801"`),
    false,
    "excluded leg must not get a hero card",
  );
  // Only the disputed leg counts toward the M in the resolved counter.
  assert.match(
    html,
    /data-testid="gauntlet-hero-resolved-counter"[\s\S]*?>1<\/span>[\s\S]*?>1<\/span>/,
  );
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

// ─────────────────────────────────────────────────────────────────────
// Task #685 (R3) — every disputed leg card grows an overflow trigger
// in the static SSR. The trigger is the only SSR-stable surface for
// Radix DropdownMenu (the Content portal only mounts on open) so we
// pin the per-card trigger testid here. We render two disputed legs
// to prove the overflow is per-card, not group-scoped.
// ─────────────────────────────────────────────────────────────────────
test("gauntlet R3: each leg card renders its own overflow trigger", () => {
  const a = claim({ id: 700, errorTypeId: "ET-1", sopOutcome: "dispute" });
  const b = claim({ id: 701, errorTypeId: "ET-2", sopOutcome: "dispute" });
  const html = render(
    React.createElement(InvoiceGroupSubmissionGauntlet, {
      group: group([a, b]),
      groupId: 42,
      onJumpToLeg: () => {},
      onReclassifyLeg: () => {},
    }),
  );

  assert.match(
    html,
    /data-testid="gauntlet-hero-card-700-overflow-trigger"/,
    "leg 700 must render its own overflow trigger",
  );
  assert.match(
    html,
    /data-testid="gauntlet-hero-card-701-overflow-trigger"/,
    "leg 701 must render its own overflow trigger",
  );
});

// ─────────────────────────────────────────────────────────────────────
// Task #685 (R4) — a leg whose `deriveLegSubStatus` is
// `needs_classification` (no errorTypeId, not a duplicate, not
// excluded) gets the amber visual treatment on its card: the card
// carries `data-sub-status="needs_classification"` and renders the
// pick-an-error-type prompt. Confirms the visual is keyed off the
// shared sub-status derivation, not a separate code path.
// ─────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────
// Task #830 — Understanding notes textarea persists after Save and
// after Generate Preview. The pre-#830 UI collapsed the saved state
// into a read-only blockquote (data-testid="readback-saved-display")
// with an Edit button (data-testid="readback-edit"); that made the
// field feel inert at the moment the operator most often wanted to
// tweak it (right after seeing the generated preview). The textarea
// is now always the editable surface; saved state is communicated
// through an inline Saved badge alongside it. We pin the SSR-stable
// contract: in the "readback confirmed" state, the textarea is still
// in the DOM, the Saved badge is rendered next to it, and the
// retired read-only display + Edit button are gone. The drift/revert
// loop runs off React `useState` we can't easily drive without a
// DOM-mounted render, so we keep this test to the at-rest contract;
// the drift logic itself is exercised by the backend preflight tests
// + the existing `notesMatchSaved` derivation.
// ─────────────────────────────────────────────────────────────────────
test("gauntlet readback (Task #830): confirmed-state still renders the editable textarea + Saved badge, with no read-only blockquote or Edit button", () => {
  const ride = claim({
    id: 700,
    confNumber: "RIDE-700",
    errorTypeId: "ET-1",
    sopOutcome: "dispute",
  });
  const saved = "Driver waited 47 min; member confirmed delay.";
  const html = render(
    React.createElement(InvoiceGroupSubmissionGauntlet, {
      group: group([ride], {
        specialCircumstances: saved,
        understandingReadback:
          "The operator says the driver waited about 47 minutes and the member confirmed the delay.",
        understandingReadbackForText: saved,
      } as unknown as Partial<InvoiceGroupDetailResponse>),
      groupId: 42,
    }),
  );

  // Textarea is the always-visible editable surface — even though
  // the readback is confirmed and the preview is generatable. This
  // is the headline contract of Task #830.
  assert.match(html, /data-testid="readback-input"/);
  // Saved badge sits alongside the textarea (not in place of it).
  assert.match(
    html,
    /data-testid="readback-saved-badge"[^>]*>[\s\S]*?Saved/,
  );
  // The pre-#830 read-only blockquote and its Edit button are gone.
  assert.equal(
    html.includes(`data-testid="readback-saved-display"`),
    false,
    "saved-state must not render a read-only blockquote",
  );
  assert.equal(
    html.includes(`data-testid="readback-edit"`),
    false,
    "Edit button is retired — textarea is always live",
  );
});

test("gauntlet R4: needs_classification leg renders the amber visual", () => {
  // No errorTypeId → deriveLegSubStatus returns "needs_classification".
  const unclassified = claim({ id: 800 });
  const html = render(
    React.createElement(InvoiceGroupSubmissionGauntlet, {
      group: group([unclassified]),
      groupId: 42,
    }),
  );

  // The card carries the data-sub-status attribute…
  assert.match(
    html,
    /data-testid="gauntlet-hero-card-800"[^>]*data-sub-status="needs_classification"/,
  );
  // …and renders the prompt that's specific to this state.
  assert.match(
    html,
    /data-testid="gauntlet-hero-card-800-needs-classification"/,
  );
});
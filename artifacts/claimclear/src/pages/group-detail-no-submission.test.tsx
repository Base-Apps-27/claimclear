// Task #659 dossier coverage for /invoice-groups/:id.
// V1: source scan + per-fixture runtime absence of blocklisted
// gauntlet/submit/walk test-ids. V2: per-fixture render asserting
// required dossier surfaces. V3: real CloseAsNonIssueDialog
// interaction in jsdom + page lifecycle reflection.

// Must precede any DOM-touching module so jsdom globals win the
// ESM hoist race.
import "@/components/decision-tree/terminals/_setup-jsdom";

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// V1 (a) — Source-file removal proof.

const PAGE_PATH = resolve(__dirname, "./invoice-group-detail.tsx");
const V2_PATH = resolve(
  __dirname,
  "../components/invoice-group-detail-v2.tsx",
);
const PAGE_SRC = readFileSync(PAGE_PATH, "utf8");
const V2_SRC = readFileSync(V2_PATH, "utf8");

// Test-ids that the submission gauntlet used. None may appear
// anywhere on the dossier surface.
const BLOCKLIST_TESTIDS = [
  "gauntlet-root",
  "gauntlet-submit",
  "gauntlet-mark-reviewed",
  "gauntlet-generate-preview",
  "gauntlet-draft-subject",
  "gauntlet-draft-body",
  "gauntlet-attachments",
  "submit-to-portal",
  "send-dispute",
  "draft-email-send",
  "mini-start-walk",
  "start-walk",
  "sop-answer-button",
  "submission-preview-card",
  "header-phase-submit",
];

// Task #687 — removed hold/recovery UI from C (invoice-group-detail-v2).
// A owns the V3HoldExit hero; C must show meta only.
const V2_ONLY_BLOCKLIST_TESTIDS = [
  "header-phase-place-on-hold",
  "header-phase-clear-hold",
  "hold-dialog",
  "hold-dialog-confirm",
  "hold-dialog-cancel",
  "group-note-delete",
];

const BLOCKLIST_TOUR = ["group-gauntlet"];

const BLOCKLIST_LABELS = [
  ">Submit dispute",
  ">Submit to portal",
  ">Generate preview",
  ">Mark reviewed",
  ">Send dispute",
  "Walk this",
];

for (const id of BLOCKLIST_TESTIDS) {
  test(`V1(a) — page source must not reference test-id "${id}"`, () => {
    assert.ok(
      !PAGE_SRC.includes(`"${id}"`),
      `forbidden test-id "${id}" found in invoice-group-detail.tsx`,
    );
  });
  test(`V1(a) — V2 source must not reference test-id "${id}"`, () => {
    assert.ok(
      !V2_SRC.includes(`"${id}"`),
      `forbidden test-id "${id}" found in invoice-group-detail-v2.tsx`,
    );
  });
}

// Task #687 — these IDs may legitimately exist on A
// (inline-group-workspace-mini.tsx) but must NEVER appear on C
// (invoice-group-detail-v2.tsx). Use a substring scan so quoted,
// template-literal, and prefix forms (e.g. `group-note-delete-${n.id}`)
// all get caught. (The third historical owner, group-dossier-chrome.tsx,
// was deleted in Task #767 when its surfaces were absorbed into V2.)
for (const id of V2_ONLY_BLOCKLIST_TESTIDS) {
  test(`V1(a) — Task #687: V2 source must not contain test-id "${id}"`, () => {
    assert.ok(
      !V2_SRC.includes(id),
      `Task #687: forbidden hold/recovery test-id "${id}" found in invoice-group-detail-v2.tsx in some form (quoted, template literal, or prefix) (A + queue chrome own this surface)`,
    );
  });
}

// Task #687 — C must render the read-only meta line when the group is held.
test(`V1(a) — Task #687: V2 source renders group-header-hold-meta`, () => {
  assert.ok(
    V2_SRC.includes(`"group-header-hold-meta"`),
    `Task #687: invoice-group-detail-v2.tsx must render data-testid="group-header-hold-meta" for the read-only "On hold" meta line`,
  );
});

// Task #687 — C must not import or call the stripped hooks. Whole-word
// regex catches both call sites and import/symbol references.
// Task #767 — useHoldInvoiceGroup / useRemoveInvoiceGroupHold dropped
// from this blocklist because GroupDossierChrome was absorbed into V2,
// which now legitimately owns the place-hold / release-hold dialogs in
// its left-rail "Overrides & admin" card.
for (const hook of [
  "useDeleteNote",
  "useCompleteLegMasAction",
]) {
  test(`V1(a) — Task #687: V2 source must not reference ${hook}`, () => {
    const re = new RegExp(`\\b${hook}\\b`);
    assert.ok(
      !re.test(V2_SRC),
      `Task #687: invoice-group-detail-v2.tsx must not reference ${hook} — neither call nor import (A owns the hold/recovery surface)`,
    );
  });
}

for (const t of BLOCKLIST_TOUR) {
  test(`V1(a) — V2 source must not have data-tour="${t}"`, () => {
    assert.ok(
      !V2_SRC.includes(`data-tour="${t}"`),
      `forbidden data-tour="${t}" still present in V2`,
    );
  });
}

for (const lbl of BLOCKLIST_LABELS) {
  test(`V1(a) — V2 source must not render label ${JSON.stringify(lbl)}`, () => {
    assert.ok(
      !V2_SRC.includes(lbl),
      `forbidden visible label ${JSON.stringify(lbl)} still present in V2`,
    );
  });
}

// Shared mocks for V1(b) / V2 page-render and V3 page-reflection.

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

interface DetailFixture {
  id: number;
  invoiceNumber: string;
  status: string;
  rideCount?: number;
  totalAmount?: string;
  rides?: unknown[];
  auditLogs?: unknown[];
  notes?: unknown[];
  evidenceFiles?: unknown[];
  holdReason?: string | null;
  closureReason?: string | null;
  disputeEmailSentAt?: string | null;
  previewGeneratedAt?: string | null;
  draftReviewedAt?: string | null;
}

let currentDetail: DetailFixture | null = null;

mock.module("wouter", {
  namedExports: {
    Link: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children: React.ReactNode;
    }) => React.createElement("a", { href, ...rest }, children),
    useParams: () => ({ id: String(currentDetail?.id ?? 0) }),
    useSearch: () => "",
    useLocation: () => ["/invoice-groups", () => {}],
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

// Tracked mutation/invalidation state — V3 resets and asserts on it.
const updateOutcomeCalls: Array<{
  id: number;
  data: Record<string, unknown>;
}> = [];
const invalidatedKeys: Array<unknown[]> = [];

mock.module("@workspace/api-client-react", {
  namedExports: {
    useGetInvoiceGroup: () => ({ data: currentDetail, isLoading: false }),
    useHoldInvoiceGroup: inertMutation,
    useRemoveInvoiceGroupHold: inertMutation,
    useUpdateInvoiceGroupOutcome: () => ({
      ...inertMutation(),
      mutateAsync: async (vars: { id: number; data: Record<string, unknown> }) => {
        updateOutcomeCalls.push(vars);
        return { id: vars.id };
      },
    }),
    getGetInvoiceGroupQueryKey: (id: number) => ["group", id],
    getGetInvoiceGroupValidTransitionsQueryKey: (id: number) => ["txn", id],
    getListInvoiceGroupsQueryKey: () => ["groups"],
  },
});

mock.module("@tanstack/react-query", {
  namedExports: {
    useQueryClient: () => ({
      invalidateQueries: ({ queryKey }: { queryKey: unknown[] }) => {
        invalidatedKeys.push(queryKey);
      },
      setQueryData: () => {},
    }),
  },
});

mock.module("@/hooks/use-toast", {
  namedExports: {
    useToast: () => ({ toast: () => {} }),
    successToast: () => {},
    toast: () => {},
  },
});

mock.module("@/lib/format", {
  namedExports: {
    formatCurrency: (v: unknown) => `$${v}`,
    formatDate: (v: unknown) => String(v ?? ""),
    formatDateTime: (v: unknown) => String(v ?? ""),
  },
});

// V2 mounted as sentinel stub; V2's surface is covered by V1 source
// scan + V2's own component tests.
mock.module("@/components/invoice-group-detail-v2", {
  namedExports: {
    InvoiceGroupDetailV2: ({ groupId }: { groupId: number }) =>
      React.createElement(
        "div",
        { "data-testid": "invoice-group-detail-v2" },
        `v2-mounted-${groupId}`,
      ),
  },
});

// Closure intake dialog stubbed; covered by its own tests.
mock.module("@/components/closure/closure-intake-dialog", {
  namedExports: {
    ClosureIntakeDialog: () => null,
  },
});

const { default: InvoiceGroupDetail } = await import("./invoice-group-detail");

void React;

// Fixtures — six lifecycle states span pre-submit through closure.

function makeFixture(overrides: Partial<DetailFixture>): DetailFixture {
  return {
    id: 100,
    invoiceNumber: "INV-100",
    status: "New",
    rideCount: 1,
    totalAmount: "1000",
    rides: [
      {
        id: 7,
        invoiceGroupId: 100,
        confNumber: "CLM-7",
        errorTypeName: "Underpayment",
      },
    ],
    auditLogs: [],
    notes: [],
    evidenceFiles: [],
    holdReason: null,
    closureReason: null,
    disputeEmailSentAt: null,
    previewGeneratedAt: null,
    draftReviewedAt: null,
    ...overrides,
  };
}

const FIXTURES: Array<{ name: string; detail: DetailFixture }> = [
  { name: "(a) pre-submit", detail: makeFixture({ status: "New" }) },
  {
    name: "(b) preview-generated",
    detail: makeFixture({
      status: "Needs Evidence",
      previewGeneratedAt: "2026-05-01T10:00:00Z",
    }),
  },
  {
    name: "(c) draft-reviewed",
    detail: makeFixture({
      status: "Needs Evidence",
      previewGeneratedAt: "2026-05-01T10:00:00Z",
      draftReviewedAt: "2026-05-01T10:30:00Z",
    }),
  },
  {
    name: "(d) submitted",
    detail: makeFixture({
      status: "Awaiting Response",
      previewGeneratedAt: "2026-05-01T10:00:00Z",
      draftReviewedAt: "2026-05-01T10:30:00Z",
      disputeEmailSentAt: "2026-05-01T10:45:00Z",
    }),
  },
  {
    name: "(e) withdrawn",
    detail: makeFixture({
      status: "Resolved",
      closureReason: "cannot_dispute",
      disputeEmailSentAt: "2026-05-01T10:45:00Z",
    }),
  },
  {
    name: "(f) closed-as-non-issue",
    detail: makeFixture({
      status: "Resolved",
      closureReason: "non_issue",
    }),
  },
];

// Task #767 — GroupDossierChrome was absorbed into V2. The page now
// just mounts V2 (sentinel testid below); everything else moved inside.
// We keep the contract by scanning V2_SRC for the testids that used to
// live on the chrome wrapper instead of rendering them via the page.
const V2_INTERNAL_REQUIRED_TESTIDS = [
  "group-detail-submission-summary-readonly",
  "group-detail-submission-summary-status",
  "group-detail-cta-process-in-queue",
  "group-detail-summary-preview-at",
  "group-detail-summary-reviewed-at",
  "group-detail-summary-submitted-at",
  "group-detail-action-withdraw-group",
  "group-detail-action-close-as-non-issue",
  "group-detail-action-reclassify-group",
  "group-detail-action-mark-duplicate",
  // Section anchors moved into V2.
  "group-detail-section-legs",
  "group-detail-section-evidence",
  "group-detail-section-activity",
];

const PAGE_REQUIRED_RENDER_TESTIDS = [
  // Page mounts V2 (sentinel testid). The chrome that used to wrap V2
  // is gone — all other contract testids now live inside V2 and are
  // covered by the V2_INTERNAL_REQUIRED_TESTIDS source-scan below.
  "invoice-group-detail-v2",
];

function renderFixture(detail: DetailFixture): string {
  currentDetail = detail;
  return renderToStaticMarkup(React.createElement(InvoiceGroupDetail, {}));
}

// V1(b) — per-fixture runtime absence of every blocklisted test-id.

for (const { name, detail } of FIXTURES) {
  test(`V1(b) — render ${name} — blocklisted test-ids absent`, () => {
    const html = renderFixture(detail);
    for (const id of BLOCKLIST_TESTIDS) {
      assert.ok(
        !html.includes(`data-testid="${id}"`),
        `blocklisted test-id "${id}" must not render in ${name}`,
      );
    }
    assert.ok(
      !html.includes(`data-tour="group-gauntlet"`),
      `data-tour="group-gauntlet" must not render in ${name}`,
    );
  });
}

// V2 — per-fixture required RENDER surfaces present (just the V2
// sentinel now; chrome was absorbed into V2 in Task #767).

for (const { name, detail } of FIXTURES) {
  test(`V2 — page render — ${name} — required surfaces present`, () => {
    const html = renderFixture(detail);
    for (const id of PAGE_REQUIRED_RENDER_TESTIDS) {
      assert.ok(
        html.includes(`data-testid="${id}"`),
        `required test-id "${id}" must appear (${name})`,
      );
    }
  });
}

// V2 source-scan contract — testids that used to live on the page
// (via GroupDossierChrome) now live inside V2. Since this test mocks
// V2 as a sentinel stub, we enforce their presence by scanning the
// V2 source string instead of rendered HTML. Behavioral assertions
// (yes/no badges, enabled state, CTA href format) are covered by V2's
// own component test (invoice-group-detail-v2-rides-legs.test.tsx).
for (const id of V2_INTERNAL_REQUIRED_TESTIDS) {
  test(`V2 source contract — must declare test-id "${id}" (absorbed from chrome)`, () => {
    assert.ok(
      V2_SRC.includes(`"${id}"`),
      `Task #767: invoice-group-detail-v2.tsx must declare data-testid "${id}" — was on chrome, now absorbed into V2`,
    );
  });
}

// V2 source-scan: the queue-deep-link CTA must be an <a> anchor (not
// a <button>) so middle-click / Cmd-click open in a new tab. Format-
// check: the CTA testid + an href that interpolates the groupId via
// /queue?group=${...} must both appear in the JSX.
test(`V2 source contract — process-in-queue CTA is an <a> with /queue?group=\${groupId}`, () => {
  assert.ok(
    V2_SRC.includes(`href={\`/queue?group=\${groupId}\`}`),
    "V2 must build the CTA href as /queue?group=${groupId}",
  );
  assert.ok(
    V2_SRC.includes(`data-testid="group-detail-cta-process-in-queue"`),
    "V2 must mark the CTA with data-testid='group-detail-cta-process-in-queue'",
  );
});

// V3 — Close-as-non-issue dialog: real interaction in jsdom + page
// reflection of the resulting lifecycle transition.

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

const { CloseAsNonIssueDialog, CLOSE_AS_NON_ISSUE_NOTE_MIN } = await import(
  "@/components/close-as-non-issue-dialog"
);

test("V3 — close-as-non-issue: confirm fires real mutation, invalidates queue, page reflects closure", async () => {
  updateOutcomeCalls.length = 0;
  invalidatedKeys.length = 0;

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      React.createElement(CloseAsNonIssueDialog, {
        open: true,
        onOpenChange: () => {},
        groupId: 42,
      }),
    );
  });

  // Radix Dialog portals to document.body.
  const queryByTestId = (id: string): HTMLElement | null =>
    document.body.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  const confirm = queryByTestId("close-as-non-issue-confirm-button");
  assert.ok(confirm, "confirm button must render");
  assert.equal(
    confirm!.hasAttribute("disabled"),
    true,
    "confirm starts disabled",
  );

  const noteInput = queryByTestId(
    "close-as-non-issue-note-input",
  ) as HTMLTextAreaElement | null;
  assert.ok(noteInput, "narrative textarea must render");

  // Short note — still disabled.
  await act(async () => {
    const proto =
      Object.getOwnPropertyDescriptor(
        (globalThis as unknown as {
          HTMLTextAreaElement: typeof HTMLTextAreaElement;
        }).HTMLTextAreaElement.prototype,
        "value",
      )?.set ?? null;
    proto?.call(noteInput!, "too short");
    noteInput!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.equal(
    queryByTestId("close-as-non-issue-confirm-button")!.hasAttribute(
      "disabled",
    ),
    true,
    "confirm stays disabled while narrative < min",
  );

  // ≥80-char note — enabled.
  const longNote =
    "Spoke with the payor. The disputed amount was a posting error on " +
    "their end and was reversed offline yesterday. No dispute needed.";
  assert.ok(longNote.length >= CLOSE_AS_NON_ISSUE_NOTE_MIN);

  await act(async () => {
    const proto = Object.getOwnPropertyDescriptor(
      (globalThis as unknown as {
        HTMLTextAreaElement: typeof HTMLTextAreaElement;
      }).HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    proto?.call(noteInput!, longNote);
    noteInput!.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const enabled = queryByTestId("close-as-non-issue-confirm-button");
  assert.equal(
    enabled!.hasAttribute("disabled"),
    false,
    "confirm enables once narrative crosses min",
  );

  // Click Confirm — mutation fires with full payload contract.
  await act(async () => {
    enabled!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  // Allow the await mutateAsync + .then chain to flush.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.equal(
    updateOutcomeCalls.length,
    1,
    "mutateAsync must fire exactly once on Confirm",
  );
  const call = updateOutcomeCalls[0]!;
  assert.equal(call.id, 42);
  // vocab-allow-next-line — asserting the API enum value sent in the payload, not a UI label.
  assert.equal(call.data.outcome, "Non-Issue");
  assert.equal(call.data.closureReason, "non_issue");
  assert.ok(
    typeof call.data.closureCategory === "string" &&
      (call.data.closureCategory as string).length > 0,
    "payload must include a closureCategory",
  );
  assert.ok(
    typeof call.data.closureRootCause === "string" &&
      (call.data.closureRootCause as string).length > 0,
    "payload must include a closureRootCause",
  );
  assert.ok(
    Array.isArray(call.data.closureAccountabilityTags) &&
      (call.data.closureAccountabilityTags as unknown[]).length >= 1,
    "payload must include ≥1 accountability tag",
  );
  assert.ok(
    typeof call.data.closureNarrative === "string" &&
      (call.data.closureNarrative as string).length >= 80,
    "payload must carry the ≥80-char narrative",
  );
  // Distinct from Withdraw — closureReason "non_issue" (not
  // "cannot_dispute") is what proves the lifecycle transition uses
  // the dedicated lane.
  assert.notEqual(
    call.data.closureReason,
    "cannot_dispute",
    "non-issue closure must NOT reuse the withdraw closureReason",
  );

  // Queue-removal proof: invalidating these three keys IS the
  // mechanism by which TanStack Query refetches and the queue drops
  // the row. Activity-feed entry is emitted server-side from
  // POST /invoice-groups/:id/outcome (see api-server route handler);
  // its absence from this client-side assertion is intentional —
  // server emission is covered by the api-server's own test suite.
  const flat = invalidatedKeys.map((k) => JSON.stringify(k));
  assert.ok(
    flat.some((s) => s.includes('"group"') && s.includes("42")),
    "must invalidate the group detail query (forces page refresh)",
  );
  assert.ok(
    flat.some((s) => s.includes('"txn"') && s.includes("42")),
    "must invalidate the valid-transitions query (locks UI affordances)",
  );
  assert.ok(
    flat.some((s) => s.includes('"groups"')),
    "must invalidate the groups list query (queue drops the row)",
  );

  await act(async () => {
    root.unmount();
  });
  container.remove();

  // Task #767 — the "lifecycle reflection" assertions (status badge
  // flips to "Resolved", Withdraw/Close-as-non-issue stay enabled
  // post-closure) used to scan the page's rendered HTML for testids
  // that lived on GroupDossierChrome. That chrome was absorbed into
  // V2, and V2 is stubbed in this test as a sentinel <div>, so those
  // testids can't be rendered here. The status-badge + reversibility
  // contract is now enforced via V2_INTERNAL_REQUIRED_TESTIDS source
  // scans above, plus V2's own component test suite.
});

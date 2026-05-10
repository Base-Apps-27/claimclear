// Task #678 — per-leg page rewires "Open group ↗" arrows
// (`GoToGroupLink`) to open the right-edge ChipDrawerOverlay instead
// of navigating to /invoice-groups/:id.
//
// Approach: ClaimDetailV2 has a deep, hard-to-stub dependency tree
// (decision-tree terminals, audit-action-meta, vocab, etc.). Rather
// than chase mocks for components that have nothing to do with this
// rewire, we assert the contract at the source level:
//   1. `GoToGroupLink` renders as a `<button type="button">` carrying
//      `data-testid="leg-open-group-overlay"` and an `onClick` —
//      NOT as a wouter `<Link>` and not with an `href` prop.
//   2. The file imports `ChipDrawerOverlayMount` from the new
//      `chip-drawer-overlay` module.
//   3. The file mounts `<ChipDrawerOverlayMount …>` on the page so
//      the drawer surface is reachable from the leg page.
//   4. No `GoToGroupLink` callsite still passes a `groupId={…}` prop
//      (the old API). Every callsite passes `onOpen={…}`.
//
// Plus a runtime check that `ChipDrawerOverlayMount` itself returns
// `null` when `openChip` is `null` (the closed-by-default contract).
// That one we CAN render in isolation — it has a small dep surface.

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

const here = dirname(fileURLToPath(import.meta.url));
const claimDetailSource = readFileSync(
  join(here, "claim-detail-v2.tsx"),
  "utf8",
);

test("Task #678 — claim-detail-v2 imports ChipDrawerOverlayMount", () => {
  assert.match(
    claimDetailSource,
    /import\s+\{[\s\S]*?ChipDrawerOverlayMount[\s\S]*?\}\s+from\s+"@\/components\/chip-drawer-overlay"/,
    "claim-detail-v2 must import ChipDrawerOverlayMount from chip-drawer-overlay",
  );
});

test("Task #678 — claim-detail-v2 mounts <ChipDrawerOverlayMount /> in render", () => {
  assert.match(
    claimDetailSource,
    /<ChipDrawerOverlayMount\b/,
    "claim-detail-v2 must mount <ChipDrawerOverlayMount /> in its render tree",
  );
});

test("Task #678 — GoToGroupLink renders as <button> with leg-open-group-overlay test id, not <Link>", () => {
  // Locate the component definition.
  const m = claimDetailSource.match(
    /function GoToGroupLink\(\{[\s\S]*?\}\s*:\s*\{[\s\S]*?\}\)\s*\{([\s\S]*?)\n\}/,
  );
  assert.ok(m, "GoToGroupLink function must be defined in claim-detail-v2");
  const body = m![1];
  assert.match(
    body,
    /<button\b/,
    "GoToGroupLink must render a <button> element",
  );
  assert.match(
    body,
    /type="button"/,
    "GoToGroupLink's button must be type=\"button\"",
  );
  assert.match(
    body,
    /data-testid="leg-open-group-overlay"/,
    "GoToGroupLink must carry data-testid=\"leg-open-group-overlay\"",
  );
  assert.match(
    body,
    /onClick=\{onOpen\}/,
    "GoToGroupLink must wire onClick to the onOpen prop",
  );
  assert.ok(
    !/<Link\b/.test(body),
    "GoToGroupLink must NOT use wouter <Link> anymore",
  );
  assert.ok(
    !/\bhref=/.test(body),
    "GoToGroupLink must NOT carry an href anymore",
  );
});

test("Task #678 — every <GoToGroupLink> callsite passes onOpen, not groupId", () => {
  const callsites = claimDetailSource.match(/<GoToGroupLink[^>]*>/g) ?? [];
  assert.ok(
    callsites.length >= 1,
    "expected at least one <GoToGroupLink> callsite",
  );
  for (const tag of callsites) {
    assert.ok(
      /\bonOpen=/.test(tag),
      `GoToGroupLink callsite must pass onOpen={…}; got: ${tag}`,
    );
    assert.ok(
      !/\bgroupId=/.test(tag),
      `GoToGroupLink callsite must NOT pass groupId={…} anymore; got: ${tag}`,
    );
  }
});

// ── Runtime test: ChipDrawerOverlayMount renders nothing when closed ──
//
// This one we CAN run in isolation because the mount has a tiny
// runtime footprint when `openChip` is null (it short-circuits before
// touching any of the heavy children).

mock.module("@tanstack/react-query", {
  namedExports: {
    useQueryClient: () => ({
      invalidateQueries: () => {},
      setQueryData: () => {},
    }),
    useMutation: () => ({
      mutate: () => {},
      mutateAsync: async () => undefined,
      isPending: false,
      isError: false,
      isSuccess: false,
      isIdle: true,
      error: null,
      data: undefined,
      reset: () => {},
    }),
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
    useGetInvoiceGroup: () => ({ data: undefined, isLoading: false }),
    useExcludeLeg: inertMutation,
    useMarkLegDuplicate: inertMutation,
    useListClaimNotes: () => ({ data: [], isLoading: false }),
    useCreateClaimNote: inertMutation,
    useDeleteNote: inertMutation,
    useGetInvoiceGroupEmailThread: () => ({ data: { conversations: [] }, isLoading: false }),
    useReplyToInvoiceGroupEmailConversation: inertMutation,
    getGetInvoiceGroupQueryKey: (id: number) => ["group", id],
    getListInvoiceGroupsQueryKey: () => ["groups"],
    getListClaimNotesQueryKey: (id: number) => ["notes", id],
    getGetInvoiceGroupEmailThreadQueryKey: (id: number) => ["thread", id],
  },
});

mock.module("@/components/evidence-file-list", {
  namedExports: { EvidenceFileList: () => null },
});
mock.module("@/components/activity-feed", {
  namedExports: { ActivityFeed: () => null },
});
mock.module("@/components/ref-number", {
  namedExports: {
    RefNumber: ({ value }: any) => React.createElement("span", null, value ?? ""),
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
mock.module("wouter", {
  namedExports: {
    Link: ({ href, children }: any) => React.createElement("a", { href }, children),
  },
});

const { ChipDrawerOverlayMount } = await import("./chip-drawer-overlay");

void React;

test("Task #678 — ChipDrawerOverlayMount renders nothing when openChip is null", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChipDrawerOverlayMount, {
      groupId: 100,
      legId: 1,
      openChip: null,
      onClose: () => {},
    }),
  );
  assert.equal(
    html,
    "",
    `ChipDrawerOverlayMount must render nothing when closed; got: ${html}`,
  );
});

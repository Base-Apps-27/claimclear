// Task #678 — per-leg page rewires "Open group ↗" arrows
// (`GoToGroupLink`) to open the right-edge ChipDrawerOverlay.
import { test, mock } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as React from "react";

const here = dirname(fileURLToPath(import.meta.url));
const claimDetailSource = readFileSync(
  join(here, "claim-detail-v2.tsx"),
  "utf8",
);

test("claim-detail-v2 imports ChipDrawerOverlayMount", () => {
  assert.match(
    claimDetailSource,
    /import\s+\{[\s\S]*?ChipDrawerOverlayMount[\s\S]*?\}\s+from\s+"@\/components\/chip-drawer-overlay"/,
  );
});

test("claim-detail-v2 mounts <ChipDrawerOverlayMount /> and wires onOpenClassify", () => {
  assert.match(claimDetailSource, /<ChipDrawerOverlayMount\b/);
  const m = claimDetailSource.match(/<ChipDrawerOverlayMount[\s\S]*?\/>/);
  assert.ok(m, "expected a self-closing <ChipDrawerOverlayMount /> mount");
  assert.match(
    m![0],
    /onOpenClassify=\{[^}]*setClassifyOpen\(true\)[^}]*\}/,
    "ChipDrawerOverlayMount must wire onOpenClassify to the page's classify dialog",
  );
});

test("GoToGroupLink renders a <button> with leg-open-group-overlay test id, not a wouter <Link>", () => {
  const m = claimDetailSource.match(
    /function GoToGroupLink\(\{[\s\S]*?\}\s*:\s*\{[\s\S]*?\}\)\s*\{([\s\S]*?)\n\}/,
  );
  assert.ok(m, "GoToGroupLink function must be defined");
  const body = m![1];
  assert.match(body, /<button\b/);
  assert.match(body, /type="button"/);
  assert.match(body, /data-testid="leg-open-group-overlay"/);
  assert.match(body, /onClick=\{onOpen\}/);
  assert.ok(!/<Link\b/.test(body), "GoToGroupLink must not use wouter <Link>");
  assert.ok(!/\bhref=/.test(body), "GoToGroupLink must not carry an href");
});

test("every <GoToGroupLink> callsite passes onOpen, not groupId", () => {
  const callsites = claimDetailSource.match(/<GoToGroupLink[^>]*>/g) ?? [];
  assert.ok(callsites.length >= 1, "expected at least one callsite");
  for (const tag of callsites) {
    assert.ok(/\bonOpen=/.test(tag), `callsite must pass onOpen: ${tag}`);
    assert.ok(
      !/\bgroupId=/.test(tag),
      `callsite must not pass groupId anymore: ${tag}`,
    );
  }
});

// Runtime behavior: ChipDrawerOverlayMount returns null when closed.
type MutationStub = {
  mutate: () => void;
  mutateAsync: () => Promise<undefined>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  isIdle: boolean;
  error: null;
  data: undefined;
  reset: () => void;
};
const inertMutation = (): MutationStub => ({
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

mock.module("@tanstack/react-query", {
  namedExports: {
    useQueryClient: () => ({
      invalidateQueries: () => {},
      setQueryData: () => {},
    }),
    useMutation: inertMutation,
  },
});

mock.module("@workspace/api-client-react", {
  namedExports: {
    useGetInvoiceGroup: () => ({ data: undefined, isLoading: false }),
    useExcludeLeg: inertMutation,
    useMarkLegDuplicate: inertMutation,
    useListClaimNotes: () => ({ data: [], isLoading: false }),
    useCreateClaimNote: inertMutation,
    useDeleteNote: inertMutation,
    useGetInvoiceGroupEmailThread: () => ({
      data: { conversations: [] },
      isLoading: false,
    }),
    useReplyToInvoiceGroupEmailConversation: inertMutation,
    getGetInvoiceGroupQueryKey: (id: number) => ["group", id],
    getListInvoiceGroupsQueryKey: () => ["groups"],
    getListClaimNotesQueryKey: (id: number) => ["notes", id],
    getGetInvoiceGroupEmailThreadQueryKey: (id: number) => ["thread", id],
  },
});

const passthrough = (props: { children?: React.ReactNode }) =>
  React.createElement(React.Fragment, null, props.children);
mock.module("@/components/evidence-file-list", {
  namedExports: { EvidenceFileList: () => null },
});
mock.module("@/components/activity-feed", {
  namedExports: { ActivityFeed: () => null },
});
mock.module("@/components/ref-number", {
  namedExports: {
    RefNumber: ({ value }: { value: string | null | undefined }) =>
      React.createElement("span", null, value ?? ""),
  },
});
mock.module("@/lib/role", {
  namedExports: { HideForClerk: passthrough, ShowForClerk: passthrough },
});
mock.module("@/lib/format", {
  namedExports: {
    formatCurrency: (v: number | string) => `$${v}`,
    formatDateTime: (v: string | Date) => String(v),
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
    Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
      React.createElement("a", { href }, children),
  },
});

const { ChipDrawerOverlayMount } = await import("./chip-drawer-overlay");
const { renderToStaticMarkup } = await import("react-dom/server");

test("ChipDrawerOverlayMount renders nothing when openChip is null", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChipDrawerOverlayMount, {
      groupId: 100,
      legId: 1,
      openChip: null,
      onClose: () => {},
      onOpenClassify: () => {},
    }),
  );
  assert.equal(html, "");
});

// Task #681 — behavioral tests for the queue-side ports.
//
// These tests render real components (not source strings) with the
// hooks mocked so we exercise the gating decisions at runtime:
//   - AdminStatusOverride returns null for clerks (HideForClerk + the
//     isAdmin early return) even when valid override transitions are
//     available from the server.
//   - AdminStatusOverride renders the trigger + override items for
//     admins, and partitionTransitions correctly excludes
//     forward/same-rank statuses (those belong to the phase-action
//     section, which is owned by other queue CTAs).

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

let currentTransitions: { validStatuses: string[] } = { validStatuses: [] };
let currentRole: "admin" | "clerk" | "operator" = "admin";

mock.module("@workspace/api-client-react", {
  namedExports: {
    useGetInvoiceGroupValidTransitions: () => ({
      data: currentTransitions,
      isLoading: false,
    }),
    useUpdateInvoiceGroupStatus: () => ({
      mutate: () => {},
      isPending: false,
    }),
    getGetInvoiceGroupQueryKey: (id: number) => ["group", id],
    getGetInvoiceGroupValidTransitionsQueryKey: (id: number) => ["txn", id],
    getListInvoiceGroupsQueryKey: () => ["groups"],
  },
});

mock.module("@workspace/replit-auth-web", {
  namedExports: {
    useAuth: () => ({ user: { role: currentRole } }),
  },
});

mock.module("@tanstack/react-query", {
  namedExports: {
    useQueryClient: () => ({ invalidateQueries: () => {} }),
  },
});

mock.module("@/lib/role", {
  namedExports: {
    HideForClerk: ({ children }: { children: React.ReactNode }) =>
      currentRole === "clerk" ? null : React.createElement(React.Fragment, null, children),
    ShowForClerk: ({ children }: { children: React.ReactNode }) =>
      currentRole === "clerk" ? React.createElement(React.Fragment, null, children) : null,
  },
});

mock.module("@/hooks/use-toast", {
  namedExports: {
    useToast: () => ({ toast: () => {} }),
    successToast: () => {},
    toast: () => {},
  },
});

// Stub the dropdown primitives so we can read the trigger/items
// directly out of the static markup without needing Radix portal
// machinery. The shapes below mirror the ones the component imports.
const passthrough =
  (testid: string) =>
  ({ children }: { children?: React.ReactNode }) =>
    React.createElement(
      "div",
      { "data-testid": testid },
      children ?? null,
    );

mock.module("@/components/ui/dropdown-menu", {
  namedExports: {
    DropdownMenu: passthrough("ddm-root"),
    DropdownMenuTrigger: ({ children }: { children?: React.ReactNode; asChild?: boolean }) =>
      React.createElement("div", { "data-testid": "ddm-trigger" }, children ?? null),
    DropdownMenuContent: passthrough("ddm-content"),
    DropdownMenuLabel: passthrough("ddm-label"),
    DropdownMenuItem: ({
      children,
      "data-testid": tid,
    }: {
      children?: React.ReactNode;
      "data-testid"?: string;
    }) =>
      React.createElement(
        "div",
        { "data-testid": tid ?? "ddm-item" },
        children ?? null,
      ),
  },
});

mock.module("@/components/ui/button", {
  namedExports: {
    Button: ({
      children,
      "data-testid": tid,
    }: {
      children?: React.ReactNode;
      "data-testid"?: string;
    }) =>
      React.createElement(
        "button",
        { "data-testid": tid ?? "btn" },
        children ?? null,
      ),
  },
});

const { AdminStatusOverride } = await import("./admin-status-override");

test("AdminStatusOverride — hidden when the user is a clerk", () => {
  currentRole = "clerk";
  // Awaiting Response → in-flight (rank 1); New is pre-submit (rank
  // 0) so it would normally surface as a backwards override for an
  // admin. Clerks must see nothing regardless.
  currentTransitions = {
    validStatuses: ["New", "Awaiting Response", "Needs Review"],
  };
  const html = renderToStaticMarkup(
    React.createElement(AdminStatusOverride, {
      groupId: 1,
      currentStatus: "Awaiting Response",
    }),
  );
  assert.equal(
    html,
    "",
    "AdminStatusOverride must render nothing for clerks",
  );
});

test("AdminStatusOverride — admin sees the trigger and only backwards-rank overrides", () => {
  currentRole = "admin";
  // currentStatus="Awaiting Response" (in-flight rank=1). "New" and
  // "Needs Evidence" are pre-submit (rank=0) → backwards → admin
  // overrides. "Awaiting Response" itself and "Needs Review"
  // (response-pending rank=2) are same/forward → phase actions, NOT
  // listed here.
  currentTransitions = {
    validStatuses: [
      "New",
      "Needs Evidence",
      "Awaiting Response",
      "Needs Review",
    ],
  };
  const html = renderToStaticMarkup(
    React.createElement(AdminStatusOverride, {
      groupId: 1,
      currentStatus: "Awaiting Response",
    }),
  );
  assert.match(html, /data-testid="mini-admin-status-override-trigger"/);
  assert.match(html, /data-testid="mini-admin-status-override-New"/);
  assert.match(html, /data-testid="mini-admin-status-override-Needs Evidence"/);
  assert.ok(
    !/data-testid="mini-admin-status-override-Awaiting Response"/.test(html),
    "current status must not appear in the override list",
  );
  assert.ok(
    !/data-testid="mini-admin-status-override-Needs Review"/.test(html),
    "forward transitions must not appear in the admin override list",
  );
});

test("AdminStatusOverride — admin with no backwards transitions renders nothing", () => {
  currentRole = "admin";
  // currentStatus="New" (pre-submit, rank=0); only same/forward
  // statuses → no overrides to surface.
  currentTransitions = {
    validStatuses: ["New", "Needs Evidence", "Awaiting Response"],
  };
  const html = renderToStaticMarkup(
    React.createElement(AdminStatusOverride, {
      groupId: 1,
      currentStatus: "New",
    }),
  );
  assert.equal(html, "", "no overrides ⇒ component returns null");
});

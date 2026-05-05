// Regression coverage for the post-upload "Quick triage" bridge crash
// (Task #440). The bridge mounts immediately after a successful CSV
// import and renders the freshly-imported groups that have no source-
// provided error description.
//
// The original bug was a render crash: the bridge cast
// `useListInvoiceGroups().data` to `InvoiceGroupResponse[]` and called
// `.filter()` on it, but the list endpoint returns `{ groups, total,
// today, ... }` — never a bare array. Every other consumer in the app
// reads `data?.groups ?? []`; the bridge alone was wrong, which is why
// the very first real upload after the bridge shipped 500'd / white-
// screened the page.
//
// These tests pin two behaviours so that crash can never silently come
// back:
//   1. With the real `{ groups: [...] }` response shape the bridge
//      renders the row(s) — it does NOT throw.
//   2. When the list query errors, the bridge renders an inline retry
//      affordance (NOT the misleading "everything clean" empty state,
//      and NOT a thrown render).

import { test, mock } from "node:test";
import { strict as assert } from "node:assert";

mock.module("@tanstack/react-query", {
  namedExports: {
    useQueryClient: () => ({ invalidateQueries: () => {} }),
  },
});

mock.module("wouter", {
  namedExports: {
    Link: ({ href, children, ...rest }: { href: string; children: unknown }) =>
      ({ type: "a", props: { href, ...rest, children } }),
    useLocation: () => ["/", () => {}],
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

// Per-test override containers so each test can reshape the list query
// (success-with-groups vs error) without re-importing the module.
let listQueryState: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };
let errorTypesQueryState: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
} = { data: [], isLoading: false, isError: false };

mock.module("@workspace/api-client-react", {
  namedExports: {
    useImportClaims: inertMutation,
    useLookupErrorDetailMappings: inertMutation,
    useSaveErrorDetailMappings: inertMutation,
    useTriageInvoiceGroup: inertMutation,
    useMarkInvoiceGroupMasEligible: inertMutation,
    useListInvoiceGroups: () => ({
      ...listQueryState,
      isSuccess: !listQueryState.isError && !listQueryState.isLoading,
      error: listQueryState.isError ? new Error("boom") : null,
      refetch: () => Promise.resolve({ data: listQueryState.data } as never),
      queryKey: [] as never,
    }),
    useListErrorTypes: () => ({
      ...errorTypesQueryState,
      isSuccess:
        !errorTypesQueryState.isError && !errorTypesQueryState.isLoading,
      error: errorTypesQueryState.isError ? new Error("boom") : null,
      refetch: () =>
        Promise.resolve({ data: errorTypesQueryState.data } as never),
      queryKey: [] as never,
    }),
    getListClaimsQueryKey: () => ["listClaims"],
  },
});

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { PostUploadBridge } = await import("./import");

void React;

function render(): string {
  return renderToStaticMarkup(
    React.createElement(PostUploadBridge, { batchId: "import_999" }),
  );
}

test("PostUploadBridge handles the real `{ groups: [...] }` list response shape (regression for the cast-as-array crash)", () => {
  // Shape mirrors what `GET /api/invoice-groups` actually returns. The
  // earlier bridge code cast this object as `InvoiceGroupResponse[]` and
  // called `.filter()` on it — a TypeError that crashed the page on
  // every successful upload. If renderToStaticMarkup throws, this test
  // fails immediately.
  listQueryState = {
    data: {
      groups: [
        {
          id: 42,
          invoiceNumber: "INV-42",
          rideCount: 3,
          totalAmount: "150.00",
          clientNumber: "CLT-9",
          status: "Needs Review",
          errorDetails: null,
        },
      ],
      total: 1,
      today: "2026-05-05",
    },
    isLoading: false,
    isError: false,
  };
  errorTypesQueryState = {
    data: [{ id: 1, name: "Travel time" }],
    isLoading: false,
    isError: false,
  };

  const html = render();
  assert.match(html, /Quick triage · 1 of 1/);
  assert.match(html, /data-testid="bridge-row-42"/);
  assert.match(html, /INV-42/);
  // Money formatter must produce `$150.00` not `$NaN`.
  assert.match(html, /\$150\.00/);
});

test("PostUploadBridge stays alive (renders the empty state) when the API legitimately returns zero groups", () => {
  listQueryState = {
    data: { groups: [], total: 0, today: "2026-05-05" },
    isLoading: false,
    isError: false,
  };
  errorTypesQueryState = {
    data: [{ id: 1, name: "Travel time" }],
    isLoading: false,
    isError: false,
  };

  const html = render();
  assert.match(
    html,
    /Every imported group already has an error description from the source/,
  );
});

test("PostUploadBridge shows an inline retry — NOT the misleading 'all clean' empty state — when the list query errors", () => {
  listQueryState = { data: undefined, isLoading: false, isError: true };
  errorTypesQueryState = {
    data: [{ id: 1, name: "Travel time" }],
    isLoading: false,
    isError: false,
  };

  const html = render();
  // Note: renderToStaticMarkup escapes the apostrophe in "Couldn't" as
  // `&#x27;`, so we match either form.
  assert.match(html, /Couldn(?:'|&#x27;)t load the triage list/);
  assert.match(html, /data-testid="bridge-retry"/);
  // Critical: must NOT render the misleading empty-state copy.
  assert.equal(
    /Every imported group already has an error description/.test(html),
    false,
  );
});

test("PostUploadBridge also takes the retry branch when ONLY the error-types query fails (the picker is required for triage, so the bridge can't function without it)", () => {
  // The list query succeeds with a real group, but the error-types
  // picker errored. Without the picker the operator can't actually
  // triage the row, so the bridge must take the same retry-fallback
  // path as a list-query failure — NOT silently render rows with a
  // broken picker underneath.
  listQueryState = {
    data: {
      groups: [
        {
          id: 99,
          invoiceNumber: "INV-99",
          rideCount: 1,
          totalAmount: "10.00",
          clientNumber: null,
          status: "Needs Review",
          errorDetails: null,
        },
      ],
      total: 1,
      today: "2026-05-05",
    },
    isLoading: false,
    isError: false,
  };
  errorTypesQueryState = { data: undefined, isLoading: false, isError: true };

  const html = render();
  assert.match(html, /data-testid="bridge-retry"/);
  // The row must NOT render — the bridge degraded to the retry state.
  assert.equal(/data-testid="bridge-row-99"/.test(html), false);
});

test("PostUploadBridge tolerates a non-numeric totalAmount string instead of rendering '$NaN'", () => {
  listQueryState = {
    data: {
      groups: [
        {
          id: 7,
          invoiceNumber: "INV-7",
          rideCount: 1,
          totalAmount: "not-a-number",
          clientNumber: null,
          status: "Needs Review",
          errorDetails: null,
        },
      ],
      total: 1,
      today: "2026-05-05",
    },
    isLoading: false,
    isError: false,
  };
  errorTypesQueryState = {
    data: [{ id: 1, name: "Travel time" }],
    isLoading: false,
    isError: false,
  };

  const html = render();
  assert.match(html, /data-testid="bridge-row-7"/);
  assert.equal(/\$NaN/.test(html), false);
});

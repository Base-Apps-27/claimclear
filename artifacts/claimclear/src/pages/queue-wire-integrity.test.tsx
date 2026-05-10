// V5 (Task #649) — Wire integrity. Toggling a filter on the always-on
// strip must not cause `useInvoiceGroupEvents` to subscribe more than
// once per selected workflow. The hook is keyed on `selectedWorkflowId`
// alone (filter changes flow through `useUrlParams`, not through that
// subscription), so this test pins two structural invariants:
//   1. queue.tsx contains exactly one call site for
//      `useInvoiceGroupEvents`.
//   2. That call site is invoked with `selectedWorkflowId` and nothing
//      else (i.e. it does not depend on any of the filter accessors).

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "./queue.tsx"), "utf8");

const { dedupRowsById, buildChips, parseParityFilters } = await import(
  "@/lib/queue-filters"
);

test("queue.tsx subscribes to per-group events at exactly one call site", () => {
  const matches = src.match(/useInvoiceGroupEvents\s*\(/g) ?? [];
  // The shape match is intentionally loose so a refactor can add a
  // wrapping helper, but two independent call sites would mean filter
  // toggles can drive duplicate subscriptions and that's the bug we
  // want to catch.
  assert.equal(
    matches.length,
    1,
    `useInvoiceGroupEvents must be called exactly once; saw ${matches.length}`,
  );
});

test("useInvoiceGroupEvents is keyed only on selectedWorkflowId", () => {
  // Capture the argument expression. The implementation is allowed
  // either `selectedWorkflowId` or `selectedWorkflowId ?? undefined`,
  // but it must NOT reference any of the always-on filter values.
  const m = src.match(/useInvoiceGroupEvents\(([^)]*)\)/);
  assert.ok(m, "could not find the useInvoiceGroupEvents call site");
  const arg = m![1];
  assert.match(arg, /selectedWorkflowId/);
  for (const filterName of [
    "engagement",
    "expiring",
    "outlook",
    "errorTypeId",
    "draftReviewed",
    "showPastDeadline",
    "qSearch",
    "filters",
  ]) {
    assert.equal(
      arg.includes(filterName),
      false,
      `useInvoiceGroupEvents must not depend on '${filterName}'; saw arg = ${arg}`,
    );
  }
});

test("dedupRowsById: stable React keys — duplicates across status queries collapse to first hit", () => {
  type R = { id: number; status: string };
  const rows: R[] = [
    { id: 1, status: "New" },
    { id: 2, status: "Needs Evidence" },
    { id: 1, status: "Generating Email" },
    { id: 3, status: "On Hold" },
    { id: 2, status: "Portal Queued" },
  ];
  const out = dedupRowsById<R>(rows);
  assert.deepEqual(
    out.map((r) => [r.id, r.status]),
    [
      [1, "New"],
      [2, "Needs Evidence"],
      [3, "On Hold"],
    ],
  );
});

test("stale-chip regression: clearing a chip writes a null patch for its URL key", () => {
  const filters = parseParityFilters(
    (k) =>
      ({
        outlook: "ready_to_review",
        errorTypeId: "9",
      } as Record<string, string>)[k] ?? "",
    (k) => (k === "errorTypeId" ? ["9"] : []),
  );
  let last: Record<string, unknown> | null = null;
  const chips = buildChips(filters, [{ id: 9, name: "U" }], ((p: Record<string, unknown>) => {
    last = p;
  }) as never);
  chips.find((c) => c.id === "outlook-ready_to_review")!.onClear();
  assert.deepEqual(last, { outlook: null });
  chips.find((c) => c.id === "errorTypeId-9")!.onClear();
  assert.deepEqual(last, { errorTypeIds: [] });
});

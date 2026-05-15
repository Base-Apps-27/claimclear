// Workflow-level test for the Responses Awaiting Review bulk-approve
// flow. Drives the selection -> confirm -> mutation success ->
// list-refresh pipeline through the extracted helpers.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { QueryClient } from "@tanstack/react-query";
import {
  buildBulkApproveSuccessSummary,
  runBulkApproveSuccessSideEffects,
} from "./responses-awaiting-review-bulk-approve-flow";
import {
  getListInvoiceGroupsQueryKey,
  getGetInvoiceGroupQueryKey,
  getGetResponsesAwaitingReviewCountQueryKey,
} from "@workspace/api-client-react";

test("buildBulkApproveSuccessSummary: surfaces approved/skipped/failed counts and tile delta", () => {
  const summary = buildBulkApproveSuccessSummary({
    approved: 7,
    approvedItems: [{ id: 1 }, { id: 2 }],
    skipped: [{}, {}, {}],
    failed: [{}],
  });
  assert.match(summary, /^7 approved/);
  assert.match(summary, /3 skipped/);
  assert.match(summary, /1 failed/);
  assert.match(summary, /Awaiting attestation tile rises by 7/);
});

test("workflow: select -> confirm -> success drops selection, closes dialog, invalidates list+rows+count", async () => {
  const verdictPendingQuery = { macroPhase: "response-pending" as const, limit: 500 };
  const queryClient = new QueryClient();
  const invalidations: unknown[][] = [];
  const realInvalidate = queryClient.invalidateQueries.bind(queryClient);
  (queryClient as unknown as { invalidateQueries: (filters?: { queryKey?: unknown[] }) => Promise<void> }).invalidateQueries = (filters?: { queryKey?: unknown[] }) => {
    if (filters?.queryKey) invalidations.push(filters.queryKey);
    return realInvalidate(filters as Parameters<typeof realInvalidate>[0]);
  };

  let selected = new Set<number>([10, 20, 30]);
  let dialogOpen = true;
  const setSelectedGroupIds = (next: Set<number>) => { selected = next; };
  const setBulkConfirmOpen = (next: boolean) => { dialogOpen = next; };

  await runBulkApproveSuccessSideEffects({
    result: {
      approved: 2,
      approvedItems: [{ id: 10 }, { id: 20 }],
      skipped: [{}],
      failed: [],
    },
    queryClient,
    verdictPendingQuery,
    setSelectedGroupIds,
    setBulkConfirmOpen,
  });

  assert.equal(selected.size, 0, "selection should be cleared on success");
  assert.equal(dialogOpen, false, "confirm dialog should close on success");

  const keyJson = invalidations.map((k) => JSON.stringify(k));
  assert.ok(
    keyJson.some((k) => k === JSON.stringify(getListInvoiceGroupsQueryKey(verdictPendingQuery))),
    `list query should be invalidated. got=${keyJson.join("\n")}`,
  );
  assert.ok(
    keyJson.some((k) => k === JSON.stringify(getGetInvoiceGroupQueryKey(10))),
    "approved row #10 should be invalidated so it falls off the visible list",
  );
  assert.ok(
    keyJson.some((k) => k === JSON.stringify(getGetInvoiceGroupQueryKey(20))),
    "approved row #20 should be invalidated so it falls off the visible list",
  );
  assert.ok(
    keyJson.some((k) => k === JSON.stringify(getGetResponsesAwaitingReviewCountQueryKey())),
    "the awaiting-review count query should be invalidated so the dashboard tile catches up",
  );
});

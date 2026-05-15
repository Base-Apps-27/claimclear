// Pure workflow helpers for the Responses Awaiting Review bulk-approve
// flow. Extracted so the selection -> confirm -> success-summary ->
// list-refresh pipeline can be tested at the workflow level without
// rendering the entire page.

import type { QueryClient } from "@tanstack/react-query";
import {
  getListInvoiceGroupsQueryKey,
  getGetInvoiceGroupQueryKey,
  getGetResponsesAwaitingReviewCountQueryKey,
} from "@workspace/api-client-react";

export interface BulkApproveResultLike {
  approved: number;
  approvedItems: Array<{ id: number }>;
  skipped: Array<unknown>;
  failed: Array<unknown>;
}

export function buildBulkApproveSuccessSummary(result: BulkApproveResultLike): string {
  return `${result.approved} approved, ${result.skipped.length} skipped, ${result.failed.length} failed. Awaiting attestation tile rises by ${result.approved}.`;
}

export interface RunBulkApproveSuccessSideEffectsParams {
  result: BulkApproveResultLike;
  queryClient: QueryClient;
  verdictPendingQuery: Parameters<typeof getListInvoiceGroupsQueryKey>[0];
  setSelectedGroupIds: (next: Set<number>) => void;
  setBulkConfirmOpen: (next: boolean) => void;
}

export async function runBulkApproveSuccessSideEffects(
  params: RunBulkApproveSuccessSideEffectsParams,
): Promise<void> {
  params.setSelectedGroupIds(new Set());
  params.setBulkConfirmOpen(false);
  await params.queryClient.invalidateQueries({
    queryKey: getListInvoiceGroupsQueryKey(params.verdictPendingQuery),
  });
  for (const item of params.result.approvedItems) {
    await params.queryClient.invalidateQueries({
      queryKey: getGetInvoiceGroupQueryKey(item.id),
    });
  }
  await params.queryClient.invalidateQueries({
    queryKey: getGetResponsesAwaitingReviewCountQueryKey(),
  });
}

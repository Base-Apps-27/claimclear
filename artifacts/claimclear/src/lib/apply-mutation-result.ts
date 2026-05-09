import type { QueryClient } from "@tanstack/react-query";
import {
  getGetClaimQueryKey,
  getGetInvoiceGroupQueryKey,
  getListInvoiceGroupsQueryKey,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  InvoiceGroupResponse,
  InvoiceGroupDetailResponse,
} from "@workspace/api-client-react";

type DetailGroup = InvoiceGroupDetailResponse & { rides?: ClaimResponse[] };

export function applyLegMutationResult(
  qc: QueryClient,
  leg: ClaimResponse,
): void {
  qc.setQueryData(getGetClaimQueryKey(leg.id), leg);
  const groupId = leg.invoiceGroupId;
  if (groupId != null) {
    const key = getGetInvoiceGroupQueryKey(groupId);
    const cached = qc.getQueryData<DetailGroup | undefined>(key);
    if (cached && Array.isArray(cached.rides)) {
      const nextRides = cached.rides.map((r) => (r.id === leg.id ? leg : r));
      qc.setQueryData(key, { ...cached, rides: nextRides });
    }
    qc.invalidateQueries({ queryKey: key });
  }
  qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
}

export function applyGroupMutationResult(
  qc: QueryClient,
  group: InvoiceGroupResponse,
): void {
  const key = getGetInvoiceGroupQueryKey(group.id);
  const cached = qc.getQueryData<DetailGroup | undefined>(key);
  if (cached) {
    qc.setQueryData(key, { ...cached, ...group, rides: cached.rides });
  } else {
    qc.setQueryData(key, group);
  }
  qc.invalidateQueries({ queryKey: key });
  qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
}

// Invalidate every orval-keyed query touching a leg (and optionally
// its parent group). Replaces the legacy `["claim", id]` /
// `["invoice-group", id]` / `["claims"]` / `["invoice-groups"]`
// invalidations that were silent no-ops once the codebase moved to
// the orval-generated path-based query keys (`/api/claims/${id}`
// etc). Call this after any server mutation that changes a leg or
// its group so the mini workspace, detail pages, and list views all
// reflect the new state.
export function invalidateLegCache(
  qc: QueryClient,
  legId: number,
  groupId?: number | null,
): void {
  qc.invalidateQueries({ queryKey: getGetClaimQueryKey(legId) });
  if (groupId != null) {
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
  }
  qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
  // Catch any list-claims queries (queue, lookups) regardless of the
  // params hash on the cache key.
  qc.invalidateQueries({
    predicate: (q) =>
      typeof q.queryKey[0] === "string" &&
      (q.queryKey[0] as string).startsWith("/api/claims"),
  });
}

export function invalidateGroupCache(
  qc: QueryClient,
  groupId: number,
): void {
  qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
  qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
}

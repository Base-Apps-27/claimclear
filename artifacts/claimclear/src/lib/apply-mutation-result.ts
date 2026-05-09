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

// Task #689 — pure helpers extracted from RemoveHandledOfflineDialog
// so the gating predicates and the request payload can be exercised
// from node:test without spinning up jsdom or React. The dialog
// component imports these to drive its disabled→enabled transitions
// and the body it posts to POST /claims/:id/exclude.

export const HANDLED_OFFLINE_NOTE_MIN = 10;

export function trimmedNoteLength(note: string): number {
  return note.trim().length;
}

export function isHandledOfflineNoteValid(note: string): boolean {
  return trimmedNoteLength(note) >= HANDLED_OFFLINE_NOTE_MIN;
}

export function canSubmitHandledOffline(args: {
  note: string;
  confirmed: boolean;
  isPending: boolean;
}): boolean {
  return (
    isHandledOfflineNoteValid(args.note) &&
    args.confirmed &&
    !args.isPending
  );
}

export function buildHandledOfflinePayload(note: string): {
  reason: "handled_offline";
  note: string;
} {
  return { reason: "handled_offline", note: note.trim() };
}

// Minimal QueryClient surface the dialog touches on success. Kept
// here so tests can hand in a recording fake without pulling
// @tanstack/react-query into the test graph.
export interface HandledOfflineQueryClientLike {
  invalidateQueries: (opts: { queryKey: readonly unknown[] }) => unknown;
}

export interface HandledOfflineQueryKeyBuilders {
  getGetClaimQueryKey: (id: number) => readonly unknown[];
  getListClaimAuditLogsQueryKey: (id: number) => readonly unknown[];
  getGetInvoiceGroupQueryKey: (id: number) => readonly unknown[];
  getListInvoiceGroupsQueryKey: () => readonly unknown[];
}

// Side-effects fired after a successful handled_offline exclusion.
// Pulled out of the React component so the post-success contract
// (which caches get invalidated, that the dialog closes, that the
// parent's onRemoved fires) can be exercised from node:test without
// jsdom or a real QueryClient.
//
// Contract pinned by the dialog's onSuccess handler:
//   1. Invalidate the leg query (so the leg-detail header reflects
//      `excluded` immediately).
//   2. Invalidate the leg's audit-log list (so the activity timeline
//      gets the new claim_removed_handled_offline row without a
//      manual refresh).
//   3. If the dialog was opened with a groupId, invalidate that
//      invoice-group query (so the queue panel re-derives sub-status
//      and the row disappears from the actionable surface).
//   4. Always invalidate the invoice-group list (the queue's
//      bucketed counts reflect the row leaving Needs-classification).
//   5. Close the dialog and notify the parent surface (queue overflow
//      menu, leg-detail header) that the leg was removed.
export function runHandledOfflineSuccessSideEffects(args: {
  qc: HandledOfflineQueryClientLike;
  keys: HandledOfflineQueryKeyBuilders;
  claimId: number;
  groupId: number | null | undefined;
  onOpenChange: (open: boolean) => void;
  onRemoved?: () => void;
}): void {
  const { qc, keys, claimId, groupId, onOpenChange, onRemoved } = args;
  qc.invalidateQueries({ queryKey: keys.getGetClaimQueryKey(claimId) });
  qc.invalidateQueries({ queryKey: keys.getListClaimAuditLogsQueryKey(claimId) });
  if (groupId != null) {
    qc.invalidateQueries({ queryKey: keys.getGetInvoiceGroupQueryKey(groupId) });
  }
  qc.invalidateQueries({ queryKey: keys.getListInvoiceGroupsQueryKey() });
  onOpenChange(false);
  onRemoved?.();
}

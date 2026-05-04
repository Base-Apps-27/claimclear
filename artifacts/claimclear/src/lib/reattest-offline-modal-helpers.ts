// Task #335 — pure helpers extracted from invoice-group-detail-v2.tsx
// so the right-rail offline re-attest override flow (Task #333) can be
// regression-tested from node:test without spinning up jsdom.
//
// Mirrors the pattern set by per-leg-context-editor.tsx →
// per-leg-context-editor.test.tsx
// (pure helpers exported from / imported by the React component, then
// exercised from a sibling .test file).
//
// Backend contract for the override path is pinned in
// artifacts/api-server/src/__tests__/mas-reattest-offline.test.ts —
// these helpers must stay aligned with that contract:
//   - admin-only
//   - >=10-char trimmed note
//   - body posts { recordedOffline: true, offlineNote }

/** Trimmed-length gate that mirrors the server-side floor in
 *  mas-reattest-offline.test.ts (>= 10 trimmed chars). */
export function isOfflineReattestNoteValid(note: string): boolean {
  return note.trim().length >= 10;
}

/** Submit-button predicate. Stays disabled until ALL three are true:
 *  - the note clears the trimmed-length floor
 *  - the operator ticks the explicit confirm checkbox
 *  - the mutation is not currently in flight (prevents double-fire) */
export function canSubmitOfflineReattest(args: {
  note: string;
  confirmed: boolean;
  isPending: boolean;
}): boolean {
  return (
    isOfflineReattestNoteValid(args.note) &&
    args.confirmed &&
    !args.isPending
  );
}

/** Whether the right-rail "Mark as already re-attested" override surface
 *  (link + modal mount) should render. Admin-only AND only while the
 *  group still needs re-attestation; once `reattestCompletedAt` is
 *  stamped (organic completion or prior offline override), the
 *  override is gone. */
export function canShowOfflineReattestOverride(args: {
  isAdmin: boolean;
  reattestRequired: boolean;
  reattestCompletedAt: string | null | undefined;
}): boolean {
  return (
    args.isAdmin && args.reattestRequired && !args.reattestCompletedAt
  );
}

/** Body posted to POST /invoice-groups/:id/reattest/complete on the
 *  admin override path. Pinned shape (recordedOffline=true, trimmed
 *  note) — backend coverage in mas-reattest-offline.test.ts asserts
 *  the same contract from the server side. */
export function buildOfflineReattestPayload(note: string): {
  recordedOffline: true;
  offlineNote: string;
} {
  return { recordedOffline: true, offlineNote: note.trim() };
}

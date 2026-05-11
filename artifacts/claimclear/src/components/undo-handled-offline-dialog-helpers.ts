// Task #694 — pure helpers extracted from UndoHandledOfflineDialog so
// the gating predicates and the request payload can be exercised
// from node:test without spinning up jsdom or React. Mirrors the
// shape of `remove-handled-offline-dialog-helpers` so the entry +
// exit dialogs stay structurally identical.

export const UNDO_HANDLED_OFFLINE_NOTE_MIN = 10;

export function trimmedNoteLength(note: string): number {
  return note.trim().length;
}

export function isUndoHandledOfflineNoteValid(note: string): boolean {
  return trimmedNoteLength(note) >= UNDO_HANDLED_OFFLINE_NOTE_MIN;
}

export function canSubmitUndoHandledOffline(args: {
  note: string;
  confirmed: boolean;
  isPending: boolean;
}): boolean {
  return (
    isUndoHandledOfflineNoteValid(args.note) &&
    args.confirmed &&
    !args.isPending
  );
}

export function buildUndoHandledOfflinePayload(note: string): {
  note: string;
  undoHandledOffline: true;
} {
  return { note: note.trim(), undoHandledOffline: true };
}

// Predicate: did the most recent leg-exit/include audit entry come
// from the handled-offline removal path? Used by the leg-detail
// header to decide whether to surface the "Undo — re-include leg"
// trigger. The audit list is expected to already be sorted newest-
// first (claim-detail-v2 sorts by timestamp desc). The set of action
// keys we look at is the same one the server consults when validating
// the undo request, so the UI affordance and the backend check stay
// in lock-step.
const RELEVANT_EXIT_ACTIONS = new Set([
  "claim_removed_handled_offline",
  "claim_removed_handled_offline_undone",
  "leg_excluded",
  "leg_included",
]);

export function wasMostRecentExitHandledOffline(
  audits: ReadonlyArray<{ action: string }>,
): boolean {
  for (const a of audits) {
    if (RELEVANT_EXIT_ACTIONS.has(a.action)) {
      return a.action === "claim_removed_handled_offline";
    }
  }
  return false;
}

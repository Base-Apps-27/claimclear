// Task #694 — pin the pure helpers that gate the "Undo — re-include
// leg" affordance so future refactors of the dialog can't silently
// weaken the >=10-char note rule, the audit-history predicate, or
// the request payload shape. Mirrors the audit-action-meta tests
// (audit-action-meta-handled-offline.test.ts) for the entry path.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  UNDO_HANDLED_OFFLINE_NOTE_MIN,
  trimmedNoteLength,
  isUndoHandledOfflineNoteValid,
  canSubmitUndoHandledOffline,
  buildUndoHandledOfflinePayload,
  wasMostRecentExitHandledOffline,
} from "./undo-handled-offline-dialog-helpers";

test("UNDO_HANDLED_OFFLINE_NOTE_MIN matches the server-side trim-aware floor", () => {
  // The /claims/:id/include route enforces >=10 trimmed chars when
  // undoHandledOffline=true; the dialog must read the same number.
  assert.equal(UNDO_HANDLED_OFFLINE_NOTE_MIN, 10);
});

test("trimmedNoteLength ignores surrounding whitespace", () => {
  assert.equal(trimmedNoteLength("   hello   "), 5);
  assert.equal(trimmedNoteLength("\n\n  ten chars  \n"), 9);
  assert.equal(trimmedNoteLength(""), 0);
});

test("isUndoHandledOfflineNoteValid requires >=10 chars after trimming", () => {
  assert.equal(isUndoHandledOfflineNoteValid(""), false);
  assert.equal(isUndoHandledOfflineNoteValid("short"), false);
  // Exactly 9 trimmed chars — must still fail (matches server 400 path).
  assert.equal(isUndoHandledOfflineNoteValid("   ninechars   "), false);
  // Exactly 10 trimmed chars — boundary accepts.
  assert.equal(isUndoHandledOfflineNoteValid("   tenchars!!   "), true);
  assert.equal(
    isUndoHandledOfflineNoteValid("Refund was reversed — re-opening dispute path."),
    true,
  );
});

test("canSubmitUndoHandledOffline requires note + confirmation + not-pending", () => {
  const goodNote = "Refund was reversed — re-opening dispute path.";
  // Happy path.
  assert.equal(
    canSubmitUndoHandledOffline({ note: goodNote, confirmed: true, isPending: false }),
    true,
  );
  // Note too short — blocked.
  assert.equal(
    canSubmitUndoHandledOffline({ note: "short", confirmed: true, isPending: false }),
    false,
  );
  // Confirmation unchecked — blocked.
  assert.equal(
    canSubmitUndoHandledOffline({ note: goodNote, confirmed: false, isPending: false }),
    false,
  );
  // Already in flight — blocked (prevents double-submit).
  assert.equal(
    canSubmitUndoHandledOffline({ note: goodNote, confirmed: true, isPending: true }),
    false,
  );
});

test("buildUndoHandledOfflinePayload trims the note and pins the flag to true", () => {
  const payload = buildUndoHandledOfflinePayload("   re-opening dispute path   ");
  assert.equal(payload.note, "re-opening dispute path");
  assert.equal(payload.undoHandledOffline, true);
  // Type-level guard: the flag must be the literal `true`, not a
  // boolean — an accidental flip to `false` would route the request
  // through the legacy leg_included path on the server.
  const _typecheck: true = payload.undoHandledOffline;
  void _typecheck;
});

test("wasMostRecentExitHandledOffline ignores unrelated audit rows", () => {
  // The list is newest-first (claim-detail-v2 sorts by timestamp
  // desc). Unrelated rows (notes, evidence, classify, …) must not
  // mask the underlying exit/include timeline.
  const audits = [
    { action: "leg_note_added" },
    { action: "claim_evidence_added" },
    { action: "claim_removed_handled_offline" },
    { action: "leg_excluded" }, // older — should be eclipsed
  ];
  assert.equal(wasMostRecentExitHandledOffline(audits), true);
});

test("wasMostRecentExitHandledOffline returns false when no exit-class row exists", () => {
  // Brand new leg with only classification activity — nothing to undo.
  assert.equal(
    wasMostRecentExitHandledOffline([
      { action: "leg_note_added" },
      { action: "claim_classified" },
    ]),
    false,
  );
  // Empty audit list (e.g. fresh imports) must also short-circuit
  // to false rather than throwing.
  assert.equal(wasMostRecentExitHandledOffline([]), false);
});

test("wasMostRecentExitHandledOffline returns false when most recent exit was a legacy exclude", () => {
  // Excluded via clean_leg / cannot_dispute / out_of_scope etc.
  // The undo affordance must NOT show — the server would reject the
  // request anyway with a 409 expected/actual state shape.
  const audits = [
    { action: "leg_excluded" },
    { action: "claim_removed_handled_offline" }, // older — eclipsed
  ];
  assert.equal(wasMostRecentExitHandledOffline(audits), false);
});

test("wasMostRecentExitHandledOffline returns false after a successful undo (no double-undo)", () => {
  // Once the leg has been re-included via undo, the undo trigger
  // must disappear — the server gate would reject a second consecutive
  // undo (covered in per-leg-state.test.ts), so the UI must not lure
  // operators into a 409.
  const audits = [
    { action: "claim_removed_handled_offline_undone" },
    { action: "claim_removed_handled_offline" },
  ];
  assert.equal(wasMostRecentExitHandledOffline(audits), false);
});

test("wasMostRecentExitHandledOffline returns false after a plain re-include", () => {
  // Legacy leg_included (no flag) — undo would also be invalid here.
  const audits = [
    { action: "leg_included" },
    { action: "claim_removed_handled_offline" },
  ];
  assert.equal(wasMostRecentExitHandledOffline(audits), false);
});

// Pure-helper coverage for the include terminal's AI-clarification
// gate (Task #372). The state machine and gate predicates are
// factored out of the React component so the regression-relevant
// edges can be exercised without spinning up jsdom.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  canHandoff,
  canRequestReadback,
  readbackStatusTestId,
  type IncludeEditorMode,
} from "./include-terminal";

// ---------------------------------------------------------------------------
// canHandoff — the central guarantee: hand-off is blocked while the
// operator has unsaved typed text or is mid-clarification, and allowed
// when the input is empty (nothing to add) OR the input matches the
// raw text whose clarification has just been accepted.
// ---------------------------------------------------------------------------

test("canHandoff: empty input + saved-blank → allowed (the 'nothing to add' path)", () => {
  assert.equal(canHandoff({ mode: "edit", raw: "", lastSavedRaw: "" }), true);
});

test("canHandoff: typed text not yet accepted → blocked (the central guard of #372)", () => {
  // Operator typed something but hasn't run Check + Accept. Handing
  // off here would lose the note silently.
  assert.equal(
    canHandoff({ mode: "edit", raw: "Driver waited 47 min", lastSavedRaw: "" }),
    false,
  );
});

test("canHandoff: typed text equals lastSavedRaw → allowed (post-Accept resting state)", () => {
  // After Accept lands, raw stays in the textarea and lastSavedRaw is
  // updated to match — so handoff trips immediately without forcing
  // the operator to clear the box.
  const txt = "Driver waited 47 min";
  assert.equal(canHandoff({ mode: "edit", raw: txt, lastSavedRaw: txt }), true);
});

test("canHandoff: clear-after-Accept (raw=='' but lastSavedRaw!='') → allowed (review feedback fix)", () => {
  // Code-review regression guard: if the operator runs Check+Accept
  // ONCE (so lastSavedRaw is non-empty) and then clears the textarea,
  // canHandoff must STILL return true — empty input is always
  // handoff-eligible. Previously this was a dead-end (empty !==
  // lastSavedRaw blocked handoff and Check was disabled on empty).
  // To erase the SAVED context the operator uses the explicit
  // "Clear saved" button (see clearSaved mutation in include-terminal).
  assert.equal(
    canHandoff({ mode: "edit", raw: "", lastSavedRaw: "Driver waited 47 min" }),
    true,
  );
  // Whitespace-only counts as empty.
  assert.equal(
    canHandoff({ mode: "edit", raw: "   \n   ", lastSavedRaw: "Driver waited 47 min" }),
    true,
  );
});

test("canHandoff: blocked while checking (mid-readback)", () => {
  assert.equal(
    canHandoff({ mode: "checking", raw: "anything", lastSavedRaw: "" }),
    false,
  );
});

test("canHandoff: blocked while review pane is up (operator must Accept or Edit first)", () => {
  assert.equal(
    canHandoff({ mode: "review", raw: "anything", lastSavedRaw: "" }),
    false,
  );
});

test("canHandoff: blocked while accept POST is in flight", () => {
  assert.equal(
    canHandoff({ mode: "saving", raw: "anything", lastSavedRaw: "" }),
    false,
  );
});

// ---------------------------------------------------------------------------
// canRequestReadback — the "Check with AI" button is enabled only
// when there is non-empty raw text to send, and only in edit mode.
// ---------------------------------------------------------------------------

test("canRequestReadback: empty raw → disabled", () => {
  assert.equal(canRequestReadback({ mode: "edit", raw: "" }), false);
  assert.equal(canRequestReadback({ mode: "edit", raw: "   \n   " }), false);
});

test("canRequestReadback: non-empty raw in edit mode → enabled", () => {
  assert.equal(canRequestReadback({ mode: "edit", raw: "x" }), true);
});

test("canRequestReadback: any non-edit mode → disabled (avoid duplicate POSTs)", () => {
  for (const mode of ["checking", "review", "saving"] as IncludeEditorMode[]) {
    assert.equal(canRequestReadback({ mode, raw: "x" }), false);
  }
});

// ---------------------------------------------------------------------------
// readbackStatusTestId — purely for the inline status indicator. The
// "edit" mode shows no inline indicator (the testarea + Check button
// is the indicator).
// ---------------------------------------------------------------------------

test("readbackStatusTestId: edit → null", () => {
  assert.equal(readbackStatusTestId("edit"), null);
});

test("readbackStatusTestId: checking/review/saving each produce a distinct testid", () => {
  assert.equal(readbackStatusTestId("checking"), "sop-include-readback-checking");
  assert.equal(readbackStatusTestId("review"), "sop-include-readback-review");
  assert.equal(readbackStatusTestId("saving"), "sop-include-readback-saving");
});

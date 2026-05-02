// Pure-helper coverage for the include terminal's per-leg-context save
// flow. The handleBlur guard and the SaveStatus indicator state machine
// are factored out of the React component so we can exercise the
// regression-relevant edges without spinning up jsdom.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  shouldSaveContextDraft,
  saveStatusTestId,
} from "./include-terminal";

test("shouldSaveContextDraft fires when the operator typed something new", () => {
  assert.equal(
    shouldSaveContextDraft({
      draft: "Patient was reauthed on 04/12.",
      lastSaved: "",
      disabled: false,
      saving: false,
    }),
    true,
  );
});

test("shouldSaveContextDraft does NOT fire when draft equals last-saved (idempotent blur)", () => {
  assert.equal(
    shouldSaveContextDraft({
      draft: "• step — answer",
      lastSaved: "• step — answer",
      disabled: false,
      saving: false,
    }),
    false,
  );
});

test("shouldSaveContextDraft does NOT re-fire while a save is already in flight", () => {
  // Operator blurs, mutation starts (saving=true), operator clicks
  // somewhere else triggering another blur — we must NOT enqueue a
  // second POST. Guard #5: no optimistic-only writes.
  assert.equal(
    shouldSaveContextDraft({
      draft: "newer text",
      lastSaved: "",
      disabled: false,
      saving: true,
    }),
    false,
  );
});

test("shouldSaveContextDraft does NOT fire when the parent surface has disabled the editor", () => {
  // Submitted groups disable the editor — blurring then must be a no-op
  // even if the operator typed something before the lock landed.
  assert.equal(
    shouldSaveContextDraft({
      draft: "stale edit",
      lastSaved: "",
      disabled: true,
      saving: false,
    }),
    false,
  );
});

test("saveStatusTestId: in-flight wins over saved/dirty", () => {
  assert.equal(
    saveStatusTestId({ saving: true, saved: false, dirty: true }),
    "sop-include-context-saving",
  );
  assert.equal(
    saveStatusTestId({ saving: true, saved: true, dirty: false }),
    "sop-include-context-saving",
  );
});

test("saveStatusTestId: Saved indicator renders after a successful save", () => {
  assert.equal(
    saveStatusTestId({ saving: false, saved: true, dirty: false }),
    "sop-include-context-saved",
  );
});

test("saveStatusTestId: dirty indicator before the operator blurs", () => {
  assert.equal(
    saveStatusTestId({ saving: false, saved: false, dirty: true }),
    "sop-include-context-dirty",
  );
});

test("saveStatusTestId: nothing rendered in the steady-state (clean editor)", () => {
  assert.equal(
    saveStatusTestId({ saving: false, saved: false, dirty: false }),
    null,
  );
});

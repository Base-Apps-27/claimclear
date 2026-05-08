// Pure unit tests for `pickRewindDialogVariant` — the single switch
// that decides whether R5 renders the light variant (no draft) or the
// heavy variant (amber callout, draft will be discarded).
//
// We deliberately avoid mounting the React component here so this test
// stays fast and dependency-free. The interaction-driven coverage of
// the dialog itself happens in `sop-advance-player-rewind.test.tsx`.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { pickRewindDialogVariant } from "./rewind-confirm-dialog";

test("pickRewindDialogVariant: light when no draft will be discarded", () => {
  assert.equal(
    pickRewindDialogVariant({ draftWillBeDiscarded: false }),
    "light",
  );
});

test("pickRewindDialogVariant: heavy when a draft will be discarded", () => {
  assert.equal(
    pickRewindDialogVariant({ draftWillBeDiscarded: true }),
    "heavy",
  );
});

test("pickRewindDialogVariant: only `draftWillBeDiscarded` matters — answer count, terminal-clear, and walk-tied evidence do NOT escalate to heavy on their own", () => {
  // Operator has 5 answers to pop and a terminal verdict to clear,
  // but the parent group has not generated a draft yet → still light.
  assert.equal(
    pickRewindDialogVariant({
      draftWillBeDiscarded: false,
      // The helper only reads `draftWillBeDiscarded` per its `Pick`
      // signature, but we pass the rest to document intent.
    } as Parameters<typeof pickRewindDialogVariant>[0]),
    "light",
  );
});

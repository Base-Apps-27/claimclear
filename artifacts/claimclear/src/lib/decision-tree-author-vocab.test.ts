// Task #309 — author-time outcome vocabulary contract.
//
// Three things have to be true forever:
//   1. The new-author dropdown is exactly the post-#309 vocabulary
//      (`Ready`, `Place on Hold`, `Non-contestable`, `Non-issue`,
//      `Resolve Internally`). If a future refactor accidentally puts
//      `Send Dispute Email` back, this test fails — keeping the
//      "channel is owned by error_type, not the tree" decision sticky.
//   2. `OUTCOME_LABELS` keeps resolving the legacy keys
//      `portal_dispute` and `dispute` to a non-empty string. Read-compat
//      is forever (Guard #2): old trees that store either value MUST
//      render without throwing anywhere downstream.
//   3. `OUTCOME_LABELS["portal_dispute"]` is the relabeled "Ready" — not
//      the old "Submit Portal Dispute" literal. The relabel is the
//      mechanism that lets us reuse the legacy enum value as the
//      storage key for the new "Ready" author option without growing
//      the OutcomeType union (Guard #9).

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  OUTCOME_LABELS,
  OUTCOME_AUTHOR_OPTIONS,
  LEGACY_OUTCOME_TYPES,
} from "../components/decision-tree/types";

test("OUTCOME_AUTHOR_OPTIONS is the post-#309 new-author vocabulary", () => {
  // Storage values, in author-rail render order.
  assert.deepEqual([...OUTCOME_AUTHOR_OPTIONS], [
    "portal_dispute", // displayed as "Mark Ready"
    "hold",
    "cannot_dispute",
    "non_issue",
    "internal",
  ]);

  // Display labels: what the operator actually reads in the dropdown.
  // The set of *display strings* is the contract — if any of these
  // change, the drift surfaces here before it surfaces to users.
  const labels = OUTCOME_AUTHOR_OPTIONS.map((ot) => OUTCOME_LABELS[ot]);
  assert.deepEqual(labels, [
    "Mark Ready",
    "Place on Hold",
    "Drop from Dispute (Non-contestable)",
    "Drop from Dispute (Non-issue)",
    "Resolve Internally",
  ]);

  // Email-channel disputing is no longer an authorable option (the
  // channel is decided by the error_type template post-#309).
  assert.equal(OUTCOME_AUTHOR_OPTIONS.includes("dispute"), false);
});

test("OUTCOME_LABELS keeps legacy keys resolving (read-compat is forever)", () => {
  // Both legacy storage keys MUST resolve to a non-empty display
  // string. If an existing tree still has these values, the runtime
  // (player, terminals, picker) needs a label to render — never
  // crash, never blank.
  assert.equal(typeof OUTCOME_LABELS.portal_dispute, "string");
  assert.ok(OUTCOME_LABELS.portal_dispute.length > 0);
  assert.equal(typeof OUTCOME_LABELS.dispute, "string");
  assert.ok(OUTCOME_LABELS.dispute.length > 0);

  // The portal_dispute relabel: the legacy enum value is reused as
  // the storage key for the new "Mark Ready" author option (Task #556
  // re-framed the include outcome as the operator's "Mark Ready" move
  // on Claim Detail), so its label MUST be the new vocabulary string,
  // not the old "Submit Portal Dispute" literal.
  assert.equal(OUTCOME_LABELS.portal_dispute, "Mark Ready");
  assert.notEqual(OUTCOME_LABELS.portal_dispute, "Submit Portal Dispute");
});

test("OUTCOME_LABELS frozen snapshot — every key resolves, no silent drift", () => {
  // Frozen contract for the entire OUTCOME_LABELS map. If anything
  // here changes (a label tweak, a new OutcomeType variant, a typo
  // in the relabel), this single equality fails loudly so the
  // change is intentional and reviewable. Read-compat for legacy
  // keys is enforced by the literal presence of `portal_dispute`
  // and `dispute` in the snapshot.
  assert.deepEqual({ ...OUTCOME_LABELS }, {
    portal_dispute: "Mark Ready",
    dispute: "Send Dispute Email",
    internal: "Resolve Internally",
    hold: "Place on Hold",
    cannot_dispute: "Drop from Dispute (Non-contestable)",
    non_issue: "Drop from Dispute (Non-issue)",
  });
});

test("LEGACY_OUTCOME_TYPES hides email-dispute from the new-author dropdown", () => {
  // `dispute` is the truly-legacy storage value (no new-vocab
  // equivalent — it carried the email channel that error_type now
  // owns). It MUST be flagged legacy so the editor tags it "(legacy)"
  // when an existing node still stores it.
  assert.equal(LEGACY_OUTCOME_TYPES.has("dispute"), true);

  // `portal_dispute` is intentionally NOT in this set: it's been
  // repurposed as the storage key for the new "Ready" author option
  // (relabeled in OUTCOME_LABELS). Flagging it legacy here would
  // orphan "Ready" — there's no other OutcomeType variant for the
  // include role. See the long comment on LEGACY_OUTCOME_TYPES in
  // decision-tree/types.ts for the full reasoning.
  assert.equal(LEGACY_OUTCOME_TYPES.has("portal_dispute"), false);

  // Sanity: legacy values are never authorable for new options.
  for (const v of LEGACY_OUTCOME_TYPES) {
    assert.equal(
      OUTCOME_AUTHOR_OPTIONS.includes(v),
      false,
      `${v} is in LEGACY_OUTCOME_TYPES; it MUST NOT be in OUTCOME_AUTHOR_OPTIONS`,
    );
  }
});

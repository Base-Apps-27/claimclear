// Task #689 — pin the audit-action-meta entry that the activity
// timeline uses to render the per-leg "Removed — handled offline"
// exit. The backend writes a distinct `claim_removed_handled_offline`
// audit row (see the handled_offline branch in
// artifacts/api-server/src/routes/claims.ts:/exclude and the
// per-leg-state.test.ts coverage); this test pins the front-end
// mapping so a missing dictionary entry — or a fall-through to the
// title-cased default — is caught before it ships.
//
// Vocab note: per the task brief the action label is hard-coded in
// CLAIM_ACTION_META rather than routed through @workspace/vocab
// (vocab is on the task's blocklist), so this test asserts the
// literal label rather than going through `auditActionLabel`.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { Link2Off } from "lucide-react";
import {
  CLAIM_ACTION_META,
  humanizeAuditAction,
} from "./audit-action-meta";

test("CLAIM_ACTION_META has a claim_removed_handled_offline entry", () => {
  const meta = CLAIM_ACTION_META["claim_removed_handled_offline"];
  assert.ok(
    meta,
    "expected CLAIM_ACTION_META to register claim_removed_handled_offline",
  );
});

test("claim_removed_handled_offline uses the slate Link2Off status presentation", () => {
  // Slate (not rose) deliberately distinguishes this clean exit from
  // the destructive `leg_excluded` row, while the Link2Off icon
  // mirrors the trigger button on the leg-detail header.
  const meta = CLAIM_ACTION_META["claim_removed_handled_offline"];
  assert.equal(meta.icon, Link2Off);
  assert.equal(meta.iconClass, "text-slate-600");
  assert.equal(meta.category, "status");
});

test("claim_removed_handled_offline reads as 'Removed — handled offline' in the timeline", () => {
  const meta = CLAIM_ACTION_META["claim_removed_handled_offline"];
  assert.equal(meta.label, "Removed — handled offline");
  // Defensive: the label must mention 'offline' so a future rename
  // can't silently drift away from operator vocabulary.
  assert.match(meta.label, /offline/i);
});

test("humanizeAuditAction(claim) returns the registered meta — not the fallback — for claim_removed_handled_offline", () => {
  // Catches a regression where the entry is removed from
  // CLAIM_ACTION_META and humanizeAuditAction silently falls back to
  // the title-cased default ("Claim Removed Handled Offline").
  const humanized = humanizeAuditAction(
    "claim_removed_handled_offline",
    "claim",
  );
  assert.equal(humanized.icon, Link2Off);
  assert.equal(humanized.iconClass, "text-slate-600");
  assert.equal(humanized.category, "status");
  assert.equal(humanized.label, "Removed — handled offline");
  assert.ok(
    !/^Claim Removed Handled Offline$/.test(humanized.label),
    "must come from the registered meta, not the title-case fallback",
  );
});

test("claim_removed_handled_offline is distinct from the generic leg_excluded entry", () => {
  // The new exit emits its own audit action so the activity timeline
  // can tell handled-offline removals apart from operator exclusions
  // for cannot_dispute / out_of_scope / etc. If a regression renamed
  // it back onto leg_excluded, the dedicated entry would disappear.
  const keys = Object.keys(CLAIM_ACTION_META);
  assert.ok(keys.includes("claim_removed_handled_offline"));
  const generic = CLAIM_ACTION_META["leg_excluded"];
  if (generic) {
    const handled = CLAIM_ACTION_META["claim_removed_handled_offline"];
    assert.notEqual(
      generic.label,
      handled.label,
      "handled-offline label must differ from the generic exclude label",
    );
  }
});

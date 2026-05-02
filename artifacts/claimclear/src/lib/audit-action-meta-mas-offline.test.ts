// Task #333 — pin the audit-action-meta entry that the activity
// timeline uses to render the new admin "recorded offline" override
// for MAS re-attest. The backend writes a distinct
// `mas_reattest_recorded_offline` audit row (see the offline branch in
// invoice-groups.ts:/reattest/complete and the
// mas-reattest-offline.test.ts coverage); this test pins the
// front-end mapping so a mis-rename in vocab or a missing dictionary
// entry is caught before it ships.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { ShieldCheck } from "lucide-react";
import { auditActionLabel } from "@workspace/vocab";
import {
  GROUP_ACTION_META,
  humanizeAuditAction,
} from "./audit-action-meta";

test("GROUP_ACTION_META has a mas_reattest_recorded_offline entry", () => {
  const meta = GROUP_ACTION_META["mas_reattest_recorded_offline"];
  assert.ok(meta, "expected GROUP_ACTION_META to register mas_reattest_recorded_offline");
});

test("mas_reattest_recorded_offline meta uses the amber ShieldCheck status presentation", () => {
  // Amber tone matches the right-rail override modal chrome and
  // signals 'admin-applied bypass' rather than the standard green
  // success treatment used for organic completions.
  const meta = GROUP_ACTION_META["mas_reattest_recorded_offline"];
  assert.equal(meta.icon, ShieldCheck);
  assert.equal(meta.iconClass, "text-amber-600");
  assert.equal(meta.category, "status");
});

test("mas_reattest_recorded_offline label resolves through @workspace/vocab and reads as offline", () => {
  // Pulling the label through the canonical glossary catches drift if
  // someone renames the vocab entry without updating the meta table.
  const meta = GROUP_ACTION_META["mas_reattest_recorded_offline"];
  const label = auditActionLabel("mas_reattest_recorded_offline", "group");
  assert.equal(meta.label, label);
  assert.match(meta.label, /offline/i, "label should mention 'offline' so the timeline reads correctly");
});

test("humanizeAuditAction(group) returns the registered meta — not the fallback — for mas_reattest_recorded_offline", () => {
  // Catches a regression where the entry was removed from
  // GROUP_ACTION_META and humanizeAuditAction silently fell back to
  // the title-cased default.
  const humanized = humanizeAuditAction("mas_reattest_recorded_offline", "group");
  assert.equal(humanized.icon, ShieldCheck);
  assert.equal(humanized.iconClass, "text-amber-600");
  assert.equal(humanized.category, "status");
  assert.ok(
    !/^Mas Reattest Recorded Offline$/.test(humanized.label),
    "must come from vocab, not the title-case fallback",
  );
});

test("mas_reattest_recorded_offline is distinct from any standard mas completion key in GROUP_ACTION_META", () => {
  // The override path emits a distinct audit action so the activity
  // timeline can tell organic completions apart from admin overrides.
  // If a regression renamed it back onto the standard key, the
  // dedicated entry would disappear from the table.
  const keys = Object.keys(GROUP_ACTION_META);
  assert.ok(
    keys.includes("mas_reattest_recorded_offline"),
    "expected the offline-recorded key to be present in GROUP_ACTION_META",
  );
});

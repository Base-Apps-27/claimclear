import { test } from "node:test";
import { strict as assert } from "node:assert";
import { toneForRow, toneForStatus } from "./tone";

// Wave C T006-A foundation. The disposition column is the canonical
// Wave-C+ source for "what state is this leg in"; `toneForRow`
// projects that directly to a tone so row-aware components/pages
// (slice B) can avoid the legacy status string. These tests pin the
// precedence rules so the slice B migration doesn't quietly drift.

test("toneForRow — disposition wins when both are set", () => {
  // status would map to amber (Needs Evidence); disposition wins green.
  assert.equal(
    toneForRow({ disposition: "verdict_approved", status: "Needs Evidence" }),
    "green",
  );
});

test("toneForRow — `unclassified` default falls through to status ladder", () => {
  // `unclassified` is the DB default for legs whose writer hasn't
  // synced disposition yet; the row's status is the trustworthy
  // signal in that window. Same fallback rule as deriveLegSubStatus.
  assert.equal(toneForRow({ disposition: "unclassified", status: "Denied" }), "red");
});

test("toneForRow — missing/null disposition falls through to status ladder", () => {
  assert.equal(toneForRow({ status: "Resolved" }), "green");
  assert.equal(toneForRow({ disposition: null, status: "On Hold" }), "amber");
});

test("toneForRow — empty row collapses to muted", () => {
  assert.equal(toneForRow(null), "muted");
  assert.equal(toneForRow(undefined), "muted");
  assert.equal(toneForRow({}), "muted");
});

test("toneForRow — each canonical disposition maps to the documented tone family", () => {
  // Blue: active/actionable.
  assert.equal(toneForRow({ disposition: "awaiting_review" }), "blue");
  assert.equal(toneForRow({ disposition: "verdict_drafted" }), "blue");
  assert.equal(toneForRow({ disposition: "disposed_portal" }), "blue");
  assert.equal(toneForRow({ disposition: "disposed_email" }), "blue");
  // Amber: blocked / classifying.
  assert.equal(toneForRow({ disposition: "classifying" }), "amber");
  assert.equal(toneForRow({ disposition: "blocked" }), "amber");
  // Green: positive verdicts and MAS-side activity.
  assert.equal(toneForRow({ disposition: "verdict_approved" }), "green");
  assert.equal(toneForRow({ disposition: "verdict_partial" }), "green");
  assert.equal(toneForRow({ disposition: "attest_pending" }), "green");
  assert.equal(toneForRow({ disposition: "attest_queued" }), "green");
  assert.equal(toneForRow({ disposition: "attested" }), "green");
  assert.equal(toneForRow({ disposition: "attest_not_required" }), "green");
  assert.equal(toneForRow({ disposition: "final_reattested" }), "green");
  // Red: adverse terminals.
  assert.equal(toneForRow({ disposition: "verdict_denied" }), "red");
  assert.equal(toneForRow({ disposition: "final_denied" }), "red");
  // Muted: withdrawn / non-issue / duplicate / cancelled.
  assert.equal(toneForRow({ disposition: "duplicate" }), "muted");
  assert.equal(toneForRow({ disposition: "disposed_withdraw" }), "muted");
  assert.equal(toneForRow({ disposition: "disposed_nonissue" }), "muted");
  assert.equal(toneForRow({ disposition: "mas_cancelled" }), "muted");
  assert.equal(toneForRow({ disposition: "final_withdrawn" }), "muted");
  assert.equal(toneForRow({ disposition: "final_nonissue" }), "muted");
});

test("toneForRow — unknown disposition string falls through to status ladder (defensive)", () => {
  assert.equal(
    toneForRow({ disposition: "not_a_real_disposition", status: "Denied" }),
    "red",
  );
});

test("toneForStatus — unchanged for legacy callers", () => {
  // Pin the special cases that have no clean disposition counterpart
  // (Processed → purple) so a future refactor doesn't accidentally
  // collapse them into the disposition-driven ladder.
  assert.equal(toneForStatus("Processed"), "purple");
  assert.equal(toneForStatus("MAS Eligible"), "green");
  assert.equal(toneForStatus(null), "muted");
});

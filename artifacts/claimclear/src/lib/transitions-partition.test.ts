// Task #555 — unit coverage for the Transitions dropdown partitioner
// used by `invoice-group-detail-v2`. The reviewer flagged that the
// previous hardcoded "phaseStatuses = {MAS Eligible, On Hold}" set
// would silently leak any new server-allowed forward status into the
// admin-only override section, so these tests pin the new
// rank-based partition explicitly across the lifecycle.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { partitionTransitions } from "./transitions-partition";

test("partition: pre-submit current → forward statuses are phase actions, none override (admin)", () => {
  const out = partitionTransitions(
    "New",
    ["Needs Evidence", "Portal Queued", "MAS Eligible", "On Hold"],
    true,
  );
  assert.deepEqual(out.phaseActionStatuses.sort(), [
    "MAS Eligible",
    "Needs Evidence",
    "On Hold",
    "Portal Queued",
  ]);
  assert.deepEqual(out.overrideStatuses, []);
});

test("partition: in-flight current → backward 'Needs Evidence' is admin-only override", () => {
  const out = partitionTransitions(
    "Awaiting Response",
    ["Needs Evidence", "Ready to Review", "On Hold"],
    true,
  );
  assert.deepEqual(out.phaseActionStatuses.sort(), [
    "On Hold",
    "Ready to Review",
  ]);
  assert.deepEqual(out.overrideStatuses, ["Needs Evidence"]);
});

test("partition: non-admin viewer never sees override statuses", () => {
  const out = partitionTransitions(
    "Awaiting Response",
    ["Needs Evidence", "Ready to Review", "On Hold"],
    false,
  );
  assert.deepEqual(out.phaseActionStatuses.sort(), [
    "On Hold",
    "Ready to Review",
  ]);
  assert.deepEqual(out.overrideStatuses, []);
});

test("partition: a brand-new forward status (response-pending → mas) lands in phase actions automatically", () => {
  // Regression for the hardcoded set: "MAS Eligible" used to be the
  // only forward status the partition recognized. With rank-based
  // logic, any future status that maps to a >= phase will land in
  // phase actions without a code change.
  const out = partitionTransitions(
    "Ready to Review",
    ["MAS Eligible", "Resolved", "Denied"],
    true,
  );
  assert.deepEqual(out.phaseActionStatuses.sort(), [
    "Denied",
    "MAS Eligible",
    "Resolved",
  ]);
  assert.deepEqual(out.overrideStatuses, []);
});

test("partition: closed current → every other status is a backwards override (admin only)", () => {
  const out = partitionTransitions(
    "Resolved",
    ["New", "Awaiting Response", "MAS Eligible"],
    true,
  );
  assert.deepEqual(out.phaseActionStatuses, []);
  assert.deepEqual(out.overrideStatuses.sort(), [
    "Awaiting Response",
    "MAS Eligible",
    "New",
  ]);
});

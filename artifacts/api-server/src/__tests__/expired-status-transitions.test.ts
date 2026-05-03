import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  GROUP_EXPIRABLE_STATUSES,
  SYSTEM_CONTROLLED_GROUP_STATUSES,
  VALID_GROUP_STATUS_TRANSITIONS as GROUP_TRANSITIONS,
} from "../lib/group-transitions";
import {
  CLAIM_EXPIRABLE_STATUSES,
  VALID_MANUAL_STATUS_TRANSITIONS as CLAIM_TRANSITIONS,
} from "../lib/claim-transitions";

// Locks the spec'd "Expired" lifecycle in place: the eligible set, the
// reversibility paths, and the manual entry paths from every pre-submit
// status. A regression here means the nightly sweep would either retire
// the wrong rows or trap an operator with no way back to a live status.

test("GROUP_EXPIRABLE_STATUSES matches the spec'd pre-submit set", () => {
  assert.deepEqual(
    [...GROUP_EXPIRABLE_STATUSES].sort(),
    ["Generating Email", "Needs Evidence", "New", "On Hold"].sort(),
  );
});

test("CLAIM_EXPIRABLE_STATUSES adds Processed to the group set", () => {
  assert.ok(
    CLAIM_EXPIRABLE_STATUSES.includes("Processed"),
    "Processed must be eligible at the claim level (per spec)",
  );
  for (const s of GROUP_EXPIRABLE_STATUSES) {
    assert.ok(
      CLAIM_EXPIRABLE_STATUSES.includes(s),
      `claim eligibility must be a superset of group eligibility, missing ${s}`,
    );
  }
});

test("Every operator-reachable eligible status offers Expired as a manual destination", () => {
  // System-controlled statuses (e.g. "Generating Email") are eligible
  // for the sweep but cannot be manually transitioned by operators —
  // the sweep itself drives them to Expired via `systemOverride: true`.
  // We only require the manual-transition path for operator-reachable
  // pre-submit statuses.
  for (const src of GROUP_EXPIRABLE_STATUSES) {
    if (SYSTEM_CONTROLLED_GROUP_STATUSES.includes(src)) continue;
    const allowed = GROUP_TRANSITIONS[src] ?? [];
    assert.ok(
      allowed.includes("Expired"),
      `group status "${src}" must allow manual transition to Expired`,
    );
  }
});

test("Expired is reversible to New / Needs Review at both levels", () => {
  assert.deepEqual(
    [...(GROUP_TRANSITIONS["Expired"] ?? [])].sort(),
    ["Needs Review", "New"],
    "group revert path must be exactly New / Needs Review",
  );
  const claimRevert = (CLAIM_TRANSITIONS["Expired"] ?? []).slice().sort();
  assert.ok(
    claimRevert.includes("New") && claimRevert.includes("Needs Review"),
    `claim revert path must include New + Needs Review, got ${claimRevert.join(",")}`,
  );
});

test("Expired is a terminal-ish status: no path advances FORWARD into the live pipeline", () => {
  // The only allowed exits from Expired are the two revert targets.
  // Anything else (e.g. Resolved, Denied, Awaiting Response) would let
  // a retired row jump back into the active workflow without first
  // going through triage, which violates the spec.
  const groupExits = new Set(GROUP_TRANSITIONS["Expired"] ?? []);
  for (const dst of groupExits) {
    assert.ok(
      dst === "New" || dst === "Needs Review",
      `unexpected forward exit from Expired: ${dst}`,
    );
  }
});

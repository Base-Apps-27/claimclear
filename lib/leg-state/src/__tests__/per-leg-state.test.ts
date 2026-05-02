// Unit tests for the pure leg-state derivation + outcome role helpers.
//
// Runs in isolation (`pnpm --filter @workspace/leg-state test`) and gates
// the broader CI run so a precedence regression is caught at the package
// boundary.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  deriveLegSubStatus,
  outcomeRole,
  LEG_SUB_STATUSES,
  OUTCOME_ROLES,
} from "../index";

// ─────────────────────────────────────────────────────────────────────
// deriveLegSubStatus precedence ladder
// ─────────────────────────────────────────────────────────────────────

test("excluded beats every other state", () => {
  assert.equal(
    deriveLegSubStatus({
      includedInDispute: false,
      duplicateOfClaimId: 99,
      errorTypeId: "ET-1",
      holdReason: "evidence_pending",
      sopOutcome: "portal_dispute",
    }),
    "excluded",
  );
});

test("duplicate beats needs_classification, blocked, and any sopOutcome", () => {
  // Even with no error type set, a leg pointing at a primary derives to duplicate.
  assert.equal(
    deriveLegSubStatus({
      duplicateOfClaimId: 42,
      errorTypeId: null,
    }),
    "duplicate",
  );
  assert.equal(
    deriveLegSubStatus({
      duplicateOfClaimId: 42,
      errorTypeId: "ET-1",
      holdReason: "evidence_pending",
    }),
    "duplicate",
  );
  assert.equal(
    deriveLegSubStatus({
      duplicateOfClaimId: 42,
      errorTypeId: "ET-1",
      sopOutcome: "portal_dispute",
    }),
    "duplicate",
  );
});

test("needs_classification when no error type and no duplicate pointer", () => {
  assert.equal(
    deriveLegSubStatus({ includedInDispute: true, errorTypeId: null }),
    "needs_classification",
  );
});

test("blocked when holdReason is set (and not excluded/duplicate)", () => {
  assert.equal(
    deriveLegSubStatus({
      errorTypeId: "ET-1",
      holdReason: "evidence_pending",
    }),
    "blocked",
  );
});

test("blocked when sopOutcome is hold (parallel pause path)", () => {
  assert.equal(
    deriveLegSubStatus({ errorTypeId: "ET-1", sopOutcome: "hold" }),
    "blocked",
  );
});

test("investigating when error type set but no terminal outcome yet", () => {
  assert.equal(
    deriveLegSubStatus({ errorTypeId: "ET-1", sopOutcome: null }),
    "investigating",
  );
  assert.equal(
    deriveLegSubStatus({ errorTypeId: "ET-1", sopOutcome: undefined }),
    "investigating",
  );
});

test("ready when sopOutcome is portal_dispute or dispute", () => {
  assert.equal(
    deriveLegSubStatus({ errorTypeId: "ET-1", sopOutcome: "portal_dispute" }),
    "ready",
  );
  assert.equal(
    deriveLegSubStatus({ errorTypeId: "ET-1", sopOutcome: "dispute" }),
    "ready",
  );
});

test("dropped when sopOutcome is cannot_dispute or non_issue", () => {
  assert.equal(
    deriveLegSubStatus({ errorTypeId: "ET-1", sopOutcome: "cannot_dispute" }),
    "dropped",
  );
  assert.equal(
    deriveLegSubStatus({ errorTypeId: "ET-1", sopOutcome: "non_issue" }),
    "dropped",
  );
});

test("duplicate is part of LEG_SUB_STATUSES enum", () => {
  assert.ok(
    (LEG_SUB_STATUSES as readonly string[]).includes("duplicate"),
    "LEG_SUB_STATUSES must include 'duplicate' for downstream switches to compile",
  );
});

// ─────────────────────────────────────────────────────────────────────
// outcomeRole — the abstraction every UI/server consumer should use.
// ─────────────────────────────────────────────────────────────────────

test("outcomeRole maps both portal_dispute and dispute to 'include'", () => {
  assert.equal(outcomeRole({ sopOutcome: "portal_dispute" }), "include");
  assert.equal(outcomeRole({ sopOutcome: "dispute" }), "include");
});

test("outcomeRole maps each terminal sopOutcome to its role", () => {
  assert.equal(outcomeRole({ sopOutcome: "hold" }), "hold");
  assert.equal(outcomeRole({ sopOutcome: "cannot_dispute" }), "cannot_dispute");
  assert.equal(outcomeRole({ sopOutcome: "non_issue" }), "non_issue");
});

test("outcomeRole returns 'duplicate' whenever duplicateOfClaimId is set", () => {
  // Even if a stale sopOutcome is present on the row, the duplicate pointer wins —
  // the mark-as-duplicate endpoint discards any in-progress walk but stale data
  // must not bypass the role.
  assert.equal(
    outcomeRole({ duplicateOfClaimId: 1, sopOutcome: "portal_dispute" }),
    "duplicate",
  );
  assert.equal(outcomeRole({ duplicateOfClaimId: 7, sopOutcome: null }), "duplicate");
});

test("outcomeRole returns 'none' for empty/null/undefined/unknown sopOutcome", () => {
  assert.equal(outcomeRole({}), "none");
  assert.equal(outcomeRole({ sopOutcome: null }), "none");
  assert.equal(outcomeRole({ sopOutcome: undefined }), "none");
  assert.equal(outcomeRole({ sopOutcome: "" }), "none");
  assert.equal(outcomeRole({ sopOutcome: "garbage_value" }), "none");
});

test("OUTCOME_ROLES enum is the locked set", () => {
  assert.deepEqual(
    [...OUTCOME_ROLES].sort(),
    [
      "cannot_dispute",
      "duplicate",
      "hold",
      "include",
      "internal",
      "non_issue",
      "none",
    ],
  );
});

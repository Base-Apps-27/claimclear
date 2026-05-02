// Unit tests for the in-SOP sibling-detection eligibility helper. These
// pin the precedence ladder (Guard #4 — the SOP entry-point and the
// claim-detail-v2 header dialog must agree on which legs are valid
// primaries):
//
//   1. The leg itself is not already a duplicate.
//   2. The parent group is still in the pre-submit macro phase.
//   3. At least one sibling leg in the same invoice group is a
//      non-duplicate primary whose error type is trip-overriding.
//
// Returns the first candidate (sorted by confNumber) so the prompt's
// single-button shape stays deterministic.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  buildTripOverridingErrorTypeIds,
  findSiblingDuplicatePrimaryCandidates,
  siblingPromptEligibilityFor,
  type SiblingCandidateLeg,
  type SiblingErrorTypeLite,
} from "./sop-sibling-eligibility";

const ERROR_TYPES: SiblingErrorTypeLite[] = [
  { id: 1, tripOverriding: true },
  { id: 2, tripOverriding: false },
  { id: "3", tripOverriding: true },
];

const SIBLING_RIDES: SiblingCandidateLeg[] = [
  { id: 100, errorTypeId: 1, duplicateOfClaimId: null, confNumber: "CLM-A" },
  { id: 101, errorTypeId: 2, duplicateOfClaimId: null, confNumber: "CLM-B" },
  { id: 102, errorTypeId: 1, duplicateOfClaimId: 100, confNumber: "CLM-C" },
  { id: 103, errorTypeId: 3, duplicateOfClaimId: null, confNumber: "CLM-D" },
];

test("buildTripOverridingErrorTypeIds collects trip_overriding=true ids as strings", () => {
  const ids = buildTripOverridingErrorTypeIds(ERROR_TYPES);
  assert.equal(ids.size, 2);
  assert.ok(ids.has("1"));
  assert.ok(ids.has("3"));
  assert.ok(!ids.has("2"));
});

test("buildTripOverridingErrorTypeIds returns empty set for nullish input", () => {
  assert.equal(buildTripOverridingErrorTypeIds(undefined).size, 0);
  assert.equal(buildTripOverridingErrorTypeIds(null).size, 0);
  assert.equal(buildTripOverridingErrorTypeIds([]).size, 0);
});

test("findSiblingDuplicatePrimaryCandidates excludes self, duplicates, and non-trip-overriding", () => {
  const ids = buildTripOverridingErrorTypeIds(ERROR_TYPES);
  // self = 200, so all three rides above are siblings; only the
  // non-duplicate trip-overriding ones survive (CLM-A and CLM-D).
  const out = findSiblingDuplicatePrimaryCandidates({
    selfClaimId: 200,
    rides: SIBLING_RIDES,
    tripOverridingErrorTypeIds: ids,
  });
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((r) => r.confNumber),
    ["CLM-A", "CLM-D"],
  );
});

test("findSiblingDuplicatePrimaryCandidates excludes the self leg", () => {
  const ids = buildTripOverridingErrorTypeIds(ERROR_TYPES);
  // self = 100 — a primary in the list. It is filtered out.
  const out = findSiblingDuplicatePrimaryCandidates({
    selfClaimId: 100,
    rides: SIBLING_RIDES,
    tripOverridingErrorTypeIds: ids,
  });
  assert.deepEqual(
    out.map((r) => r.confNumber),
    ["CLM-D"],
  );
});

test("siblingPromptEligibilityFor: shows the first candidate when all gates pass", () => {
  const out = siblingPromptEligibilityFor({
    selfClaimId: 200,
    selfErrorTypeId: 1,
    selfDuplicateOfClaimId: null,
    groupMacroPhase: "pre-submit",
    rides: SIBLING_RIDES,
    errorTypes: ERROR_TYPES,
  });
  assert.ok(out, "expected the prompt to be eligible");
  assert.equal(out!.primary.confNumber, "CLM-A");
});

test("siblingPromptEligibilityFor: hidden when the leg is itself a duplicate", () => {
  const out = siblingPromptEligibilityFor({
    selfClaimId: 200,
    selfErrorTypeId: 1,
    selfDuplicateOfClaimId: 100,
    groupMacroPhase: "pre-submit",
    rides: SIBLING_RIDES,
    errorTypes: ERROR_TYPES,
  });
  assert.equal(out, null);
});

test("siblingPromptEligibilityFor: hidden when the group is post-submit", () => {
  const out = siblingPromptEligibilityFor({
    selfClaimId: 200,
    selfErrorTypeId: 1,
    selfDuplicateOfClaimId: null,
    groupMacroPhase: "submitted",
    rides: SIBLING_RIDES,
    errorTypes: ERROR_TYPES,
  });
  assert.equal(out, null);
});

test("siblingPromptEligibilityFor: hidden when no trip-overriding error types are configured", () => {
  const out = siblingPromptEligibilityFor({
    selfClaimId: 200,
    selfErrorTypeId: 1,
    selfDuplicateOfClaimId: null,
    groupMacroPhase: "pre-submit",
    rides: SIBLING_RIDES,
    errorTypes: [{ id: 1, tripOverriding: false }],
  });
  assert.equal(out, null);
});

test("siblingPromptEligibilityFor: hidden when no sibling leg matches", () => {
  const out = siblingPromptEligibilityFor({
    selfClaimId: 200,
    selfErrorTypeId: 1,
    selfDuplicateOfClaimId: null,
    groupMacroPhase: "pre-submit",
    rides: [
      { id: 100, errorTypeId: 2, duplicateOfClaimId: null, confNumber: "CLM-A" },
    ],
    errorTypes: ERROR_TYPES,
  });
  assert.equal(out, null);
});

test("siblingPromptEligibilityFor: hidden when self leg has no error type yet", () => {
  // Critical Guard: a leg in `needs_classification` (no errorTypeId) must
  // NEVER trigger the sibling-detection prompt. Without a self error type
  // the system has no basis to claim the legs share a trip-overriding
  // failure mode.
  const out = siblingPromptEligibilityFor({
    selfClaimId: 200,
    selfErrorTypeId: null,
    selfDuplicateOfClaimId: null,
    groupMacroPhase: "pre-submit",
    rides: SIBLING_RIDES,
    errorTypes: ERROR_TYPES,
  });
  assert.equal(out, null);
});

test("siblingPromptEligibilityFor: hidden when self leg's error type is NOT trip-overriding", () => {
  // The sibling-duplicate roll-up only makes sense when both legs share
  // a trip-overriding failure mode. A leg whose own error type is NOT
  // trip-overriding (e.g. a wait-time dispute) is a fundamentally
  // different SOP and must walk its own tree, even if a trip-overriding
  // primary exists in the same group.
  const out = siblingPromptEligibilityFor({
    selfClaimId: 200,
    selfErrorTypeId: 2, // tripOverriding=false in ERROR_TYPES
    selfDuplicateOfClaimId: null,
    groupMacroPhase: "pre-submit",
    rides: SIBLING_RIDES,
    errorTypes: ERROR_TYPES,
  });
  assert.equal(out, null);
});

test("siblingPromptEligibilityFor: accepts string-form selfErrorTypeId (id parity)", () => {
  // ERROR_TYPES contains id "3" as a string — the helper must coerce
  // self-leg ids the same way it coerces sibling ids so that surfaces
  // passing numeric and string ids both work.
  const out = siblingPromptEligibilityFor({
    selfClaimId: 200,
    selfErrorTypeId: "3",
    selfDuplicateOfClaimId: null,
    groupMacroPhase: "pre-submit",
    rides: SIBLING_RIDES,
    errorTypes: ERROR_TYPES,
  });
  assert.ok(out, "expected eligible when string-form id matches a trip-overriding error type");
  assert.equal(out!.primary.confNumber, "CLM-A");
});

test("siblingPromptEligibilityFor: deterministic — picks the first candidate by confNumber", () => {
  const out = siblingPromptEligibilityFor({
    selfClaimId: 200,
    selfErrorTypeId: 1,
    selfDuplicateOfClaimId: null,
    groupMacroPhase: "pre-submit",
    rides: [
      { id: 100, errorTypeId: 1, duplicateOfClaimId: null, confNumber: "CLM-Z" },
      { id: 101, errorTypeId: 1, duplicateOfClaimId: null, confNumber: "CLM-B" },
      { id: 102, errorTypeId: 3, duplicateOfClaimId: null, confNumber: "CLM-M" },
    ],
    errorTypes: ERROR_TYPES,
  });
  assert.ok(out);
  assert.equal(out!.primary.confNumber, "CLM-B");
});

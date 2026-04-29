import { test } from "node:test";
import { strict as assert } from "node:assert";

import { determineIssueType } from "../routes/portal-submissions";
import type { ErrorType } from "@workspace/db";

function makeErrorType(overrides: Partial<ErrorType>): ErrorType {
  return {
    id: 1,
    name: "GPS Deviation",
    category: null,
    description: null,
    guidance: null,
    recommendedActions: null,
    disputeReasonsLibrary: null,
    evidenceRequirements: null,
    decisionTree: null,
    emailTemplate: null,
    disputeInstructions: null,
    useGpsControlDeviation: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

test("determineIssueType: toggle ON → GPS Control Deviation", () => {
  const et = makeErrorType({ name: "GPS Deviation", useGpsControlDeviation: true });
  assert.equal(determineIssueType(et), "GPS Control Deviation");
});

test("determineIssueType: toggle OFF → Other Issue or Question", () => {
  const et = makeErrorType({ name: "GPS Deviation", useGpsControlDeviation: false });
  assert.equal(determineIssueType(et), "Other Issue or Question");
});

test("determineIssueType: name alone is never enough — toggle is the source of truth", () => {
  // 'GPS Deviation' name BUT toggle is off → must NOT route to the GPS form
  const gpsNamedButOff = makeErrorType({ name: "GPS Deviation", useGpsControlDeviation: false });
  assert.equal(determineIssueType(gpsNamedButOff), "Other Issue or Question");
});

test("determineIssueType: non-GPS error types default to Other Issue or Question", () => {
  for (const name of [
    "Invoice Number not in System",
    "Travel Time Error",
    "Attestation Timing",
    "Ineligible Enrollee",
    "Other",
  ]) {
    const et = makeErrorType({ name, useGpsControlDeviation: false });
    assert.equal(
      determineIssueType(et),
      "Other Issue or Question",
      `expected '${name}' (toggle off) to route to Other Issue or Question`,
    );
  }
});

test("determineIssueType: null error type → Other Issue or Question (safe default)", () => {
  assert.equal(determineIssueType(null), "Other Issue or Question");
});

test("determineIssueType: any plan can be routed to GPS form by enabling the toggle", () => {
  // Admin can opt in a custom/non-GPS-named error type (e.g., a future plan
  // whose name doesn't contain 'GPS') simply by flipping the toggle.
  const et = makeErrorType({ name: "Plan-Specific Geofencing Denial", useGpsControlDeviation: true });
  assert.equal(determineIssueType(et), "GPS Control Deviation");
});

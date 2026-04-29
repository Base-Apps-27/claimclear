import { test } from "node:test";
import { strict as assert } from "node:assert";

import { determineIssueType } from "../routes/portal-submissions";
import { FRESHDESK_ISSUE_TYPE_MAP } from "../bot/batch-worker";
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

// ---------------------------------------------------------------------------
// End-to-end routing chain: toggle → determineIssueType → bot ticket URL.
// The bot resolves which Freshdesk form to open by looking the issueType up
// in FRESHDESK_ISSUE_TYPE_MAP and navigating to
// `${PORTAL_URL}/support/tickets/new?ticket_form=<slug>`. These tests prove
// the toggle ultimately changes which form URL the bot navigates to.
// ---------------------------------------------------------------------------

test("chain: toggle ON → bot opens the GPS Control Deviation Freshdesk form", () => {
  const et = makeErrorType({ name: "GPS Deviation", useGpsControlDeviation: true });
  const issueType = determineIssueType(et);
  const formSlug = FRESHDESK_ISSUE_TYPE_MAP[issueType];
  assert.equal(issueType, "GPS Control Deviation");
  assert.equal(formSlug, "gps_control_deviation",
    "with toggle ON the bot must navigate to ?ticket_form=gps_control_deviation");
});

test("chain: toggle OFF → bot opens the Other Issue or Question Freshdesk form", () => {
  const et = makeErrorType({ name: "GPS Deviation", useGpsControlDeviation: false });
  const issueType = determineIssueType(et);
  const formSlug = FRESHDESK_ISSUE_TYPE_MAP[issueType];
  assert.equal(issueType, "Other Issue or Question");
  assert.equal(formSlug, "other_issue_or_question",
    "with toggle OFF the bot must navigate to ?ticket_form=other_issue_or_question");
});

test("chain: every issueType determineIssueType can return must be routable by the bot", () => {
  // Defensive: if a future issueType is added to determineIssueType but not
  // to FRESHDESK_ISSUE_TYPE_MAP, the bot would silently fall back to the
  // 'Other Issue or Question' slug. This test makes that drift loud.
  const togglesToTest = [true, false];
  for (const toggle of togglesToTest) {
    const issueType = determineIssueType(makeErrorType({ useGpsControlDeviation: toggle }));
    assert.ok(
      Object.prototype.hasOwnProperty.call(FRESHDESK_ISSUE_TYPE_MAP, issueType),
      `FRESHDESK_ISSUE_TYPE_MAP is missing an entry for issueType '${issueType}' (toggle=${toggle}) — the bot would fall back to the default form`,
    );
  }
});

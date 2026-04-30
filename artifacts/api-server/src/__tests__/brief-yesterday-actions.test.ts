import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  YESTERDAY_CLAIMS_CREATED_ACTIONS,
  YESTERDAY_DRAFTS_SUBMITTED_ACTIONS,
  YESTERDAY_RESPONSES_RECEIVED_ACTIONS,
  YESTERDAY_DECISIONS_LOGGED_ACTIONS,
} from "../lib/brief-personalization";

// These tests lock in the audit action keys counted by the daily brief's
// "Yesterday at a glance" tiles. The brief once silently broke when the app
// stopped writing some of the keys it was counting (e.g. portal submissions
// switched from `portal_submission_submitted` to `portal_submission_confirmed`),
// and "Yesterday at a glance" reported zero across the board even on busy
// days. Renames here should be deliberate: if you intentionally rename one of
// these audit actions, also flip the constant and update this test.

test("claimsCreated counts per-claim creates and bulk imports", () => {
  assert.deepEqual(
    [...YESTERDAY_CLAIMS_CREATED_ACTIONS].sort(),
    ["claim_created", "claims_imported"].sort(),
  );
});

test("draftsSubmitted counts the confirmed-submission audit event the bot writes", () => {
  // Confirmed (not "submitted") — the legacy `portal_submission_submitted` key
  // is no longer emitted by the portal submission flow.
  assert.deepEqual(
    [...YESTERDAY_DRAFTS_SUBMITTED_ACTIONS],
    ["portal_submission_confirmed"],
  );
});

test("responsesReceived counts the response_received audit event from the matcher", () => {
  // The previous whitelist counted `response_reassigned`, `response_unmatched`,
  // and `outbound_sent`, none of which represent a payor response landing.
  assert.deepEqual(
    [...YESTERDAY_RESPONSES_RECEIVED_ACTIONS],
    ["response_received"],
  );
});

test("decisionsLogged counts only outcome-bearing transitions", () => {
  // Generic status hops (e.g. New -> Awaiting Response) should not inflate
  // "decisions logged". Only events that actually record an outcome count.
  assert.deepEqual(
    [...YESTERDAY_DECISIONS_LOGGED_ACTIONS].sort(),
    ["outcome_changed", "group_outcome_changed", "group_status_and_outcome_changed"].sort(),
  );
});

test("whitelist does not reference legacy keys the app no longer writes", () => {
  const all = [
    ...YESTERDAY_CLAIMS_CREATED_ACTIONS,
    ...YESTERDAY_DRAFTS_SUBMITTED_ACTIONS,
    ...YESTERDAY_RESPONSES_RECEIVED_ACTIONS,
    ...YESTERDAY_DECISIONS_LOGGED_ACTIONS,
  ];
  const legacyKeys = [
    "portal_submission_submitted",
    "group_resolved",
    "group_denied",
    "outbound_sent",
    "response_reassigned",
    "response_unmatched",
  ];
  for (const k of legacyKeys) {
    assert.ok(
      !all.includes(k as (typeof all)[number]),
      `Whitelist still references legacy action "${k}" — the app no longer emits this key.`,
    );
  }
});

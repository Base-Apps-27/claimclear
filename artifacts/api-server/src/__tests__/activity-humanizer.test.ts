import { test } from "node:test";
import { strict as assert } from "node:assert";

import { humanizeAuditRow, type AuditRow } from "../lib/activity-humanizer";

function row(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 1,
    action: "group_edited",
    details: "",
    metadata: null,
    userEmail: "mae@example.com",
    userName: "Mae Rivera",
    timestamp: new Date("2026-04-29T12:34:56.000Z"),
    claimId: null,
    invoiceGroupId: 42,
    invoiceNumber: "12345",
    claimConfNumber: null,
    ...overrides,
  };
}

test("portal submission produces submitter + INV target", () => {
  const e = humanizeAuditRow(row({ action: "portal_submission_submitted" }));
  assert.equal(e.summary, "Mae Rivera submitted INV-12345 to the payor portal");
  assert.equal(e.tone, "neutral");
  assert.equal(e.href, "/invoice-groups/42");
});

test("group_outcome_changed -> Approved is good tone", () => {
  const e = humanizeAuditRow(row({
    action: "group_outcome_changed",
    metadata: { from: "Pending", to: "Approved" },
  }));
  assert.equal(e.tone, "good");
  assert.match(e.summary, /Mae Rivera approved INV-12345/);
});

test("group_outcome_changed -> Denied is bad tone", () => {
  const e = humanizeAuditRow(row({
    action: "group_outcome_changed",
    metadata: { from: "Pending", to: "Denied" },
  }));
  assert.equal(e.tone, "bad");
  assert.match(e.summary, /Mae Rivera marked denied INV-12345/);
});

test("import event renders count from metadata", () => {
  const e = humanizeAuditRow(row({
    action: "claims_imported",
    invoiceGroupId: null,
    invoiceNumber: null,
    metadata: { created: 23, groupsCreated: 4 },
  }));
  assert.match(e.summary, /imported 23 claims from job-status report/);
  assert.match(e.summary, /across 4 invoice groups/);
});

test("system actor falls back when no user is set", () => {
  const e = humanizeAuditRow(row({
    action: "bounce_received",
    userEmail: null,
    userName: null,
    metadata: { address: "billing@payor.com" },
  }));
  assert.equal(e.actor, "ClaimClear");
  assert.equal(e.actorRole, "system");
  assert.equal(e.tone, "bad");
  assert.match(e.summary, /Email to billing@payor.com bounced for INV-12345/);
});

test("response_received with approved outcome is good tone", () => {
  const e = humanizeAuditRow(row({
    action: "response_received",
    userEmail: null,
    userName: null,
    metadata: { outcome: "approved" },
  }));
  assert.equal(e.tone, "good");
  assert.match(e.summary, /Payor approved INV-12345/);
});

test("unknown action falls back to details and includes target", () => {
  const e = humanizeAuditRow(row({
    action: "some_new_action",
    details: "Did something exotic",
  }));
  assert.match(e.summary, /Did something exotic/);
  assert.match(e.summary, /INV-12345/);
});

test("unknown action without invoice number still includes target context", () => {
  const e = humanizeAuditRow(row({
    action: "some_new_action",
    details: "Did something exotic",
    invoiceGroupId: 77,
    invoiceNumber: null,
    claimId: null,
    claimConfNumber: null,
  }));
  assert.match(e.summary, /Did something exotic/);
  assert.match(e.summary, /invoice group #77/);
});

test("href falls back to claim path when only claimId is set", () => {
  const e = humanizeAuditRow(row({
    invoiceGroupId: null,
    invoiceNumber: null,
    claimId: 99,
    claimConfNumber: "C-9000",
    action: "claim_edited",
  }));
  assert.equal(e.href, "/claims/99");
  assert.match(e.summary, /claim C-9000/);
});

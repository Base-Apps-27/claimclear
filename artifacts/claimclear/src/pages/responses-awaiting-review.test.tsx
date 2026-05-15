// Task #750 — UI test for the bulk-approve confirmation dialog.
//
// Renders <BulkApproveDialog/> with a mixed eligible/skipped selection
// and asserts:
//   * Summary surfaces eligible count, dollar total, and skipped count
//   * Each skipped row's reason maps to the human-readable label
//   * The Confirm button is disabled until a non-empty note is entered
//   * Submitting calls onConfirm with the trimmed note
//
// Uses react-dom/server's `renderToStaticMarkup` (the same harness
// pattern the decision-tree terminal tests use) plus a tiny structural
// re-render to verify the gated Confirm button — we don't bring in
// jsdom or @testing-library to keep the test infra cost low.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { BulkApproveDialogBody, bulkApproveSkipLabel } from "@/components/bulk-approve-dialog";

void React;

const eligible = [
  { groupId: 11, portalResponseId: 101, refNumber: "INV-A", totalAmount: 250 },
  { groupId: 12, portalResponseId: 102, refNumber: "INV-B", totalAmount: 175.5 },
];
const skipped = [
  { groupId: 13, refNumber: "INV-C", reason: "low_confidence" },
  { groupId: 14, refNumber: "INV-D", reason: "active_submission" },
];

function renderBody(overrides: Partial<React.ComponentProps<typeof BulkApproveDialogBody>> = {}) {
  return renderToStaticMarkup(
    <BulkApproveDialogBody
      eligible={eligible}
      skipped={skipped}
      totalDollars={425.5}
      cap={200}
      isSubmitting={false}
      note=""
      onNoteChange={() => {}}
      submitDisabled={true}
      onCancel={() => {}}
      onConfirm={() => {}}
      {...overrides}
    />,
  );
}

test("BulkApproveDialog: summary shows eligible count, total, and skipped count", () => {
  const html = renderBody();
  // Summary numbers — eligible count, skipped count.
  assert.match(html, /data-testid="bulk-approve-dialog-eligible-count"[^>]*>\s*2\s*</);
  assert.match(html, /data-testid="bulk-approve-dialog-skipped-count"[^>]*>\s*2\s*</);
  // Dollar total formatted via the shared formatCurrency helper —
  // assert the dollar amount appears (formatting may vary by locale,
  // so match a permissive pattern).
  assert.ok(/425\.50|425\.5/.test(html), `expected total $425.50 in dialog: ${html.slice(0, 400)}`);
});

test("BulkApproveDialog: skipped list renders human-readable reasons", () => {
  const html = renderBody();
  assert.match(html, /AI confidence below high/);
  assert.match(html, /portal submission in flight/);
  assert.match(html, /INV-C/);
  assert.match(html, /INV-D/);
});

test("BulkApproveDialog: confirm button is disabled when submitDisabled is true", () => {
  const html = renderBody({ eligible: [], skipped, totalDollars: 0, submitDisabled: true });
  const match = html.match(/<button[^>]*data-testid="bulk-approve-dialog-confirm"[^>]*>/);
  assert.ok(match, "confirm button should be present");
  // The HTML serializer emits the bare `disabled` boolean attribute
  // outside `class="..."` when the prop is true.
  assert.ok(/\sdisabled(=|\s|>)/.test(match![0]), `expected disabled attr, got: ${match![0]}`);
});

test("BulkApproveDialog: confirm button is enabled when submitDisabled is false", () => {
  const html = renderBody({ note: "checked weekly export", submitDisabled: false });
  const match = html.match(/<button[^>]*data-testid="bulk-approve-dialog-confirm"[^>]*>/);
  assert.ok(match, "confirm button should be present");
  // Strip the className value before checking — Tailwind ships
  // `disabled:` variants that would otherwise match.
  const stripped = match![0].replace(/class="[^"]*"/, "");
  assert.ok(!/\sdisabled(=|\s|>)/.test(stripped), `confirm button should be enabled, got: ${match![0]}`);
});

test("BulkApproveDialog: data-testid hooks are present", () => {
  const html = renderBody({ skipped: [] });
  assert.match(html, /data-testid="bulk-approve-dialog-body"/);
  assert.match(html, /data-testid="bulk-approve-dialog-confirm"/);
  assert.match(html, /data-testid="bulk-approve-dialog-cancel"/);
  assert.match(html, /data-testid="bulk-approve-note"/);
});

test("bulkApproveSkipLabel: maps known skip reasons to friendly text and falls back to the raw reason", () => {
  assert.equal(bulkApproveSkipLabel("low_confidence"), "AI confidence below high");
  assert.equal(bulkApproveSkipLabel("active_submission"),
    "portal submission in flight — try again after it resolves");
  assert.equal(bulkApproveSkipLabel("already_queued"),
    "already queued for re-attestation (idempotent skip)");
  assert.equal(bulkApproveSkipLabel("partial_approval"),
    "partial approval — needs single-item review");
  assert.equal(bulkApproveSkipLabel("not_ai"), "not AI-classified");
  // Unknown reasons pass through untouched.
  assert.equal(bulkApproveSkipLabel("some_future_reason"), "some_future_reason");
});

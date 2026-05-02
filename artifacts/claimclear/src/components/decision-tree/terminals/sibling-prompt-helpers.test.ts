// Click-contract coverage for the in-SOP sibling-detection prompt. The
// "Mark as sibling duplicate" CTA passes a known-shape payload to the
// existing useMarkLegDuplicate mutation. Drift here would silently
// break the POST /claims/:id/duplicate-of contract — the snapshot keeps
// the wire shape pinned.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { buildMarkDuplicateRequest } from "./sibling-prompt";

test("buildMarkDuplicateRequest pins the wire shape useMarkLegDuplicate expects", () => {
  const req = buildMarkDuplicateRequest({ legId: 4321, primaryClaimId: 1234 });
  assert.deepEqual(req, {
    id: 4321,
    data: { primaryClaimId: 1234, note: null },
  });
});

test("buildMarkDuplicateRequest never carries a note (in-SOP prompt is one-click)", () => {
  // The header dialog has a free-text note field; the in-SOP one-click
  // prompt deliberately does not. Anyone adding a `note` here should
  // surface the change in this test rather than slip past review.
  const req = buildMarkDuplicateRequest({ legId: 1, primaryClaimId: 2 });
  assert.equal(req.data.note, null);
  const keys = Object.keys(req.data).sort();
  assert.deepEqual(keys, ["note", "primaryClaimId"]);
});

test("buildMarkDuplicateRequest is pure: same input → identical output", () => {
  const a = buildMarkDuplicateRequest({ legId: 99, primaryClaimId: 100 });
  const b = buildMarkDuplicateRequest({ legId: 99, primaryClaimId: 100 });
  assert.deepEqual(a, b);
});

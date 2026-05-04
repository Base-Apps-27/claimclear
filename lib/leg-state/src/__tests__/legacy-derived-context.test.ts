// Task #372: helper that recognises the auto-derived "• Q — A"
// breadcrumb the previous SOP-advance player wrote into per_leg_context.
// Pinning the contract here so server (prompt-leg-inputs), client
// (PerLegContextEditor seed, SOP transcript card) all agree on
// what counts as legacy-derived.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { isLegacyDerivedContext } from "../index";

test("isLegacyDerivedContext: null/undefined/empty → false", () => {
  assert.equal(isLegacyDerivedContext(null), false);
  assert.equal(isLegacyDerivedContext(undefined), false);
  assert.equal(isLegacyDerivedContext(""), false);
  assert.equal(isLegacyDerivedContext("   \n  "), false);
});

test("isLegacyDerivedContext: single bullet line is the canonical legacy shape", () => {
  assert.equal(isLegacyDerivedContext("• Was GPS available? — Yes"), true);
});

test("isLegacyDerivedContext: multi-line bullet list matches", () => {
  const v = [
    "• Was GPS available? — Yes",
    "• Did breadcrumbs match? — No",
    "• Reasonable explanation? — Yes",
  ].join("\n");
  assert.equal(isLegacyDerivedContext(v), true);
});

test("isLegacyDerivedContext: blank lines between bullets still match", () => {
  const v = "• Step one — yes\n\n• Step two — no\n";
  assert.equal(isLegacyDerivedContext(v), true);
});

test("isLegacyDerivedContext: any non-bullet line disqualifies", () => {
  // Operator-authored note that starts with a single bullet — the helper
  // must NOT swallow this; the second line breaks the pattern.
  const v = "• follow-up needed\nDriver confirmed late pickup at 9:15.";
  assert.equal(isLegacyDerivedContext(v), false);
});

test("isLegacyDerivedContext: prose that has no bullets at all → false", () => {
  assert.equal(
    isLegacyDerivedContext("Driver waited 47 minutes; member confirmed delay."),
    false,
  );
});

test("isLegacyDerivedContext: hyphen-bullet (-) is NOT the legacy prefix", () => {
  // The previous derivation used the U+2022 bullet (•). A markdown-style
  // dash bullet from the operator is real authored content and must
  // remain visible to downstream consumers.
  assert.equal(isLegacyDerivedContext("- Was GPS available? — Yes"), false);
});

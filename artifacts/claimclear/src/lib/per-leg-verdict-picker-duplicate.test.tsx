// Task #309 — picker behavior on Sibling Duplicate legs.
//
// The action rail filters duplicates out of `actionableRides` so the
// picker should never see one in normal flow. This test pins the
// defense-in-depth branch in the picker itself: if a duplicate leg
// reaches it, the picker MUST render a muted read-only card and MUST
// NOT throw. The card surfaces the primary CLM ref + verdict so the
// operator immediately understands why no per-leg pick is available.
//
// We also pin the inverse: a non-duplicate leg renders the normal
// verdict-picker UI (Approved / Denied buttons — per-leg verdicts are
// binary), proving the duplicate branch is gated on
// `outcomeRole(claim) === "duplicate"` and not an accidental
// short-circuit for all legs.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { PerLegVerdictPicker } from "../components/per-leg-verdict-picker";
import type { ClaimResponse } from "@workspace/api-client-react";

void React;

// Minimal ClaimResponse fixture — only the fields the picker reads.
// Everything else is filled with reasonable defaults via `as never`
// because the orval-generated type has dozens of fields irrelevant
// to this code path.
function fixtureLeg(overrides: Partial<ClaimResponse>): ClaimResponse {
  return {
    id: 1,
    confNumber: "CLM-1",
    errorTypeId: "et_eligibility",
    errorTypeName: "Eligibility",
    errorDetails: null,
    includedInDispute: true,
    duplicateOfClaimId: null,
    sopOutcome: null,
    latestVerdict: null,
    latestAiSuggestion: null,
    ...overrides,
  } as unknown as ClaimResponse;
}

test("picker renders the muted duplicate card when leg is a sibling duplicate", () => {
  const dup = fixtureLeg({
    id: 99,
    confNumber: "CLM-99",
    duplicateOfClaimId: 7,
  });
  const primary = fixtureLeg({
    id: 7,
    confNumber: "CLM-7",
    latestVerdict: { outcome: "Approved" } as never,
  });

  const html = renderToStaticMarkup(
    <PerLegVerdictPicker
      claim={dup}
      primaryClaim={primary}
      onConfirm={async () => {}}
    />,
  );

  // The muted card surface, the primary's CLM ref, and the verdict
  // are the three things this branch exists to communicate.
  assert.match(html, /data-testid="per-leg-verdict-duplicate-99"/);
  assert.match(html, /Sibling duplicate/);
  assert.match(html, /#CLM-7/);
  assert.match(html, /Primary verdict/);
  assert.match(html, /Approved/);
  // No verdict-pick buttons should render — duplicates derive their
  // verdict from the primary, never from a per-leg pick.
  assert.equal(html.includes("button-pick-approved-99"), false);
  assert.equal(html.includes("button-confirm-verdict-99"), false);
});

test("picker degrades gracefully when the primary leg isn't visible", () => {
  // Operator opened a different group view, paged out, etc. The
  // picker MUST NOT throw — fall back to a generic notice.
  const dup = fixtureLeg({
    id: 50,
    confNumber: "CLM-50",
    duplicateOfClaimId: 12345,
  });
  const html = renderToStaticMarkup(
    <PerLegVerdictPicker claim={dup} onConfirm={async () => {}} />,
  );
  assert.match(html, /data-testid="per-leg-verdict-duplicate-50"/);
  assert.match(html, /Verdict follows the primary leg/);
  // Falls back to the duplicateOfClaimId reference, not a crash.
  assert.match(html, /claim 12345/);
});

test("picker renders the normal verdict UI for a non-duplicate leg", () => {
  // Inverse guard: the duplicate branch must NOT short-circuit the
  // happy path. A regular leg should still see Approved/Denied
  // buttons (per-leg verdicts are binary).
  const normal = fixtureLeg({
    id: 11,
    confNumber: "CLM-11",
    sopOutcome: "portal_dispute" as never,
    duplicateOfClaimId: null,
  });
  const html = renderToStaticMarkup(
    <PerLegVerdictPicker claim={normal} onConfirm={async () => {}} />,
  );
  assert.match(html, /data-testid="per-leg-verdict-picker-11"/);
  assert.match(html, /button-pick-approved-11/);
  assert.match(html, /button-confirm-verdict-11/);
  assert.equal(html.includes("per-leg-verdict-duplicate-11"), false);
});

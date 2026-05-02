// Task #309 / Task #343 — picker behavior on Sibling Duplicate legs
// and the new draft-saving toggle UI.
//
// Two things are pinned here:
//
//  1. Sibling-duplicate guard (Task #309). The action rail filters
//     duplicates out of `actionableRides`, so under normal data flow
//     the picker never sees one. This test pins the defense-in-depth
//     branch: if a duplicate leg reaches it, the picker MUST render a
//     muted read-only card (no pick buttons) and MUST NOT throw. The
//     card surfaces the primary CLM ref + verdict so the operator
//     immediately understands why no per-leg pick is available.
//
//  2. Draft-saving toggle UI (Task #343). The picker is no longer a
//     two-step "pick then confirm" form — it's a pair of toggle pills
//     that save the operator's selection as a draft on click. There is
//     NO confirm button, NO note field, and NO "verdict recorded" card
//     on top of the pills. The lit-up state is seeded from the latest
//     draft (or older confirmed verdict) so the selection survives
//     refresh + navigation.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { PerLegVerdictPicker } from "../components/per-leg-verdict-picker";
import type { ClaimResponse, ClaimVerdictResponse } from "@workspace/api-client-react";

void React;

// React renders the props in source-declaration order, which puts
// `data-selected` BEFORE `data-testid` on the pill buttons. The
// regex helpers below match the two attributes in either order so the
// tests aren't brittle to React internals or future prop reorderings.
function assertSelected(html: string, testId: string) {
  assert.match(
    html,
    new RegExp(
      `(data-selected="true"[^>]*data-testid="${testId}"|data-testid="${testId}"[^>]*data-selected="true")`,
    ),
  );
}
function assertNotSelected(html: string, testId: string) {
  assert.match(
    html,
    new RegExp(
      `(data-selected="false"[^>]*data-testid="${testId}"|data-testid="${testId}"[^>]*data-selected="false")`,
    ),
  );
}

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
    latestDraft: null,
    latestAiSuggestion: null,
    ...overrides,
  } as unknown as ClaimResponse;
}

function fixtureVerdict(
  outcome: string,
  source: string,
  createdAt = "2026-05-01T12:00:00Z",
): ClaimVerdictResponse {
  return {
    id: Math.floor(Math.random() * 1e6),
    claimId: 1,
    outcome,
    source,
    createdAt,
  } as ClaimVerdictResponse;
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
      onSelect={async () => {}}
    />,
  );

  // The muted card surface, the primary's CLM ref, and the verdict
  // are the three things this branch exists to communicate.
  assert.match(html, /data-testid="per-leg-verdict-duplicate-99"/);
  assert.match(html, /Sibling duplicate/);
  assert.match(html, /#CLM-7/);
  assert.match(html, /Primary verdict/);
  assert.match(html, /Approved/);
  // No pick pills should render — duplicates derive their verdict
  // from the primary, never from a per-leg pick.
  assert.equal(html.includes("button-pick-approved-99"), false);
  assert.equal(html.includes("button-pick-denied-99"), false);
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
    <PerLegVerdictPicker claim={dup} onSelect={async () => {}} />,
  );
  assert.match(html, /data-testid="per-leg-verdict-duplicate-50"/);
  assert.match(html, /Verdict follows the primary leg/);
  // Falls back to the duplicateOfClaimId reference, not a crash.
  assert.match(html, /claim 12345/);
});

test("picker renders draft-saving toggle pills (no confirm button, no note) for a non-duplicate leg", () => {
  // Inverse guard: the duplicate branch must NOT short-circuit the
  // happy path. A regular leg should see Approved/Denied pills.
  // Task #343: critically, there must be NO "confirm verdict" button
  // and NO note field — selections save as drafts on click.
  const normal = fixtureLeg({
    id: 11,
    confNumber: "CLM-11",
    sopOutcome: "portal_dispute" as never,
    duplicateOfClaimId: null,
  });
  const html = renderToStaticMarkup(
    <PerLegVerdictPicker claim={normal} onSelect={async () => {}} />,
  );
  assert.match(html, /data-testid="per-leg-verdict-picker-11"/);
  assert.match(html, /button-pick-approved-11/);
  assert.match(html, /button-pick-denied-11/);
  assert.equal(html.includes("per-leg-verdict-duplicate-11"), false);
  // The legacy two-step UI is gone: no confirm button, no note,
  // no "verdict recorded" card.
  assert.equal(html.includes("button-confirm-verdict-11"), false);
  assert.equal(html.includes("verdict-note-11"), false);
  assert.equal(html.includes("verdict-recorded-11"), false);
});

test("picker seeds the lit-up pill from the latest draft when present", () => {
  // Task #343: drafts persist across refresh/navigation. On mount
  // the picker MUST light up the pill that matches the latest draft.
  // The page passes `latestDraft` as a prop alongside `claim`; the
  // test mirrors that to exercise the same code path.
  const draft = fixtureVerdict("Denied", "operator_draft");
  const leg = fixtureLeg({
    id: 21,
    confNumber: "CLM-21",
    latestDraft: draft,
  });
  const html = renderToStaticMarkup(
    <PerLegVerdictPicker
      claim={leg}
      latestDraft={draft}
      onSelect={async () => {}}
    />,
  );
  // Both pills present, but Denied is selected (data-selected="true").
  assertSelected(html, "button-pick-denied-21");
  assertNotSelected(html, "button-pick-approved-21");
});

test("picker prefers the newer of latestDraft and latestVerdict", () => {
  // Mixed-history case: an older operator_confirmed Approved followed
  // by a newer operator_draft Denied. The newer draft wins the lit pill.
  const confirmed = fixtureVerdict(
    "Approved",
    "operator_confirmed",
    "2026-05-01T10:00:00Z",
  );
  const draft = fixtureVerdict("Denied", "operator_draft", "2026-05-02T10:00:00Z");
  const leg = fixtureLeg({
    id: 22,
    confNumber: "CLM-22",
    latestVerdict: confirmed,
    latestDraft: draft,
  });
  const html = renderToStaticMarkup(
    <PerLegVerdictPicker
      claim={leg}
      latestVerdict={confirmed}
      latestDraft={draft}
      onSelect={async () => {}}
    />,
  );
  assertSelected(html, "button-pick-denied-22");
  assertNotSelected(html, "button-pick-approved-22");
});

test("picker falls back to latestVerdict when no draft exists", () => {
  const confirmed = fixtureVerdict("Approved", "operator_confirmed");
  const leg = fixtureLeg({
    id: 23,
    confNumber: "CLM-23",
    latestVerdict: confirmed,
    latestDraft: null,
  });
  const html = renderToStaticMarkup(
    <PerLegVerdictPicker
      claim={leg}
      latestVerdict={confirmed}
      latestDraft={null}
      onSelect={async () => {}}
    />,
  );
  assertSelected(html, "button-pick-approved-23");
});

test("picker MUST NOT preselect a pill when latestVerdict is an AI suggestion", () => {
  // Regression for the AI-only-fresh-review case. The backend's
  // `latestVerdict` is the newest *non-draft* row, which on a fresh
  // review group is the AI suggestion (operator hasn't picked yet).
  // If we lit up that pill, the operator who agrees with the AI
  // would have NO way to record a draft — clicking the lit pill is
  // a no-op by design (`handlePick` short-circuits on `picked === o`).
  // So both pills MUST render with data-selected="false" when the
  // only verdict on file is an `ai_suggested` row.
  const aiSuggested = fixtureVerdict("Approved", "ai_suggested");
  const leg = fixtureLeg({
    id: 24,
    confNumber: "CLM-24",
    latestVerdict: aiSuggested,
    latestDraft: null,
  });
  const html = renderToStaticMarkup(
    <PerLegVerdictPicker
      claim={leg}
      latestVerdict={aiSuggested}
      latestSuggestion={aiSuggested}
      latestDraft={null}
      onSelect={async () => {}}
    />,
  );
  // Neither pill is preselected — both render with data-selected="false".
  // Because the no-op guard is `if (picked === outcome) return;` and
  // `picked` is seeded from `seedSelectionFrom`, an unselected state
  // here is sufficient to prove the first click on either pill will
  // reach `onSelect` and save a draft.
  assertNotSelected(html, "button-pick-approved-24");
  assertNotSelected(html, "button-pick-denied-24");
});

test("picker still seeds from latestVerdict when its source is operator_confirmed", () => {
  // Inverse of the AI-suggestion case: a real prior operator
  // confirmation MUST still light up the pill (mixed group where one
  // leg was confirmed under the old behavior and the group hasn't
  // moved out of `response-pending` yet).
  const opConfirmed = fixtureVerdict("Denied", "operator_confirmed");
  const leg = fixtureLeg({
    id: 25,
    confNumber: "CLM-25",
    latestVerdict: opConfirmed,
    latestDraft: null,
  });
  const html = renderToStaticMarkup(
    <PerLegVerdictPicker
      claim={leg}
      latestVerdict={opConfirmed}
      latestDraft={null}
      onSelect={async () => {}}
    />,
  );
  assertSelected(html, "button-pick-denied-25");
  assertNotSelected(html, "button-pick-approved-25");
});

test("picker prefers a draft over an AI-suggested latestVerdict (newer-wins is moot when AI is the only alternative)", () => {
  // Belt-and-suspenders: even if the page passes both an AI
  // suggestion as `latestVerdict` AND a draft, the draft wins —
  // not because of newer-wins (createdAt could be either way), but
  // because AI suggestions are filtered out of the seed entirely.
  const aiOlder = fixtureVerdict("Approved", "ai_suggested", "2026-04-01T10:00:00Z");
  const draftNewer = fixtureVerdict("Denied", "operator_draft", "2026-05-01T10:00:00Z");
  const leg = fixtureLeg({
    id: 26,
    confNumber: "CLM-26",
    latestVerdict: aiOlder,
    latestDraft: draftNewer,
  });
  const html = renderToStaticMarkup(
    <PerLegVerdictPicker
      claim={leg}
      latestVerdict={aiOlder}
      latestSuggestion={aiOlder}
      latestDraft={draftNewer}
      onSelect={async () => {}}
    />,
  );
  assertSelected(html, "button-pick-denied-26");
  assertNotSelected(html, "button-pick-approved-26");
});

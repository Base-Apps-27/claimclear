// Task #309 / Task #343 / Task #344 — picker behavior on Sibling
// Duplicate legs, the draft-saving toggle UI, and the click-the-lit-
// pill clear affordance.
//
// Three things are pinned here:
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
//
//  3. Click-the-lit-pill clear (Task #344). When the page wires an
//     `onClear` callback, clicking the *already-selected* pill calls
//     it (DELETE /verdict/draft) so operators can unset a wrong pick
//     without first having to confirm the opposite verdict. Without
//     `onClear` wired, the click stays a forward-only no-op so legacy
//     callers don't accidentally toggle off.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PerLegVerdictPicker,
  canClearDraftPick,
} from "../components/per-leg-verdict-picker";
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

// Same in-either-order helpers for the Task #344 `data-clearable` flag.
// The lit pill stamps `data-clearable="true"` when (and only when) the
// page wired an `onClear` callback — that's the visual + machine
// contract the click-the-lit-pill clear path is gated on.
function assertClearable(html: string, testId: string) {
  assert.match(
    html,
    new RegExp(
      `(data-clearable="true"[^>]*data-testid="${testId}"|data-testid="${testId}"[^>]*data-clearable="true")`,
    ),
  );
}
function assertNotClearable(html: string, testId: string) {
  assert.match(
    html,
    new RegExp(
      `(data-clearable="false"[^>]*data-testid="${testId}"|data-testid="${testId}"[^>]*data-clearable="false")`,
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

// ─── Task #344 — click-the-lit-pill clear affordance ───────────────────

// Pure-helper coverage for the gate that the picker DOM (data-clearable
// + tooltip) and the click handler both branch off. Pinning the gate
// here gives the post-clear-resync paths the reviewer flagged a
// dependable contract: if the gate is honest, the click handler can
// never reach `setPicked(null)` on a leg that isn't actually backed by
// an `operator_draft` row, so the UI/backend divergence scenario the
// reviewer described becomes structurally unreachable.

test("canClearDraftPick: lit pill + draft + matching outcome + onClear → true", () => {
  const draft = fixtureVerdict("Approved", "operator_draft");
  assert.equal(
    canClearDraftPick({
      picked: "Approved",
      outcome: "Approved",
      latestDraft: draft,
      hasOnClear: true,
    }),
    true,
  );
});

test("canClearDraftPick: confirmed-only (no draft) is NOT clearable even when lit + onClear wired", () => {
  // The reviewer-flagged regression. A pill lit purely from an
  // `operator_confirmed` row MUST NOT advertise the affordance —
  // DELETE /verdict/draft would be a server-side no-op
  // (clearedCount: 0) and the optimistic `setPicked(null)` would
  // visually unset a pill backed by an append-only row the server
  // won't touch.
  assert.equal(
    canClearDraftPick({
      picked: "Approved",
      outcome: "Approved",
      latestDraft: null,
      hasOnClear: true,
    }),
    false,
  );
});

test("canClearDraftPick: draft outcome must match the pill outcome (no cross-pill clearable lighting)", () => {
  // Confirmed-Approved + draft-Denied combo. Under newer-wins the
  // picker would already be lighting up Denied as `picked`, so this
  // is a belt-and-suspenders guard against future seed-rule churn.
  // The Approved pill is NOT clearable because the draft on file is
  // a Denied draft.
  const denyDraft = fixtureVerdict("Denied", "operator_draft");
  assert.equal(
    canClearDraftPick({
      picked: "Approved",
      outcome: "Approved",
      latestDraft: denyDraft,
      hasOnClear: true,
    }),
    false,
  );
});

test("canClearDraftPick: unselected pill is never clearable (clicking it saves a draft instead)", () => {
  const draft = fixtureVerdict("Approved", "operator_draft");
  assert.equal(
    canClearDraftPick({
      picked: "Approved",
      outcome: "Denied",
      latestDraft: draft,
      hasOnClear: true,
    }),
    false,
  );
});

test("canClearDraftPick: omitted onClear ⇒ false (legacy forward-only callers preserved)", () => {
  const draft = fixtureVerdict("Approved", "operator_draft");
  assert.equal(
    canClearDraftPick({
      picked: "Approved",
      outcome: "Approved",
      latestDraft: draft,
      hasOnClear: false,
    }),
    false,
  );
});

test("Task #344: lit pill stamps data-clearable=\"true\" when onClear is wired", () => {
  // The page on Responses Awaiting Review wires an `onClear` callback
  // that calls DELETE /claims/:id/verdict/draft. Whenever a draft is
  // already on file (Approved here), the lit pill MUST advertise the
  // clear affordance so a click on it routes to the clear path
  // instead of the legacy no-op. The unselected pill is NEVER
  // clearable — it would save a draft on first click.
  const draft = fixtureVerdict("Approved", "operator_draft");
  const leg = fixtureLeg({
    id: 30,
    confNumber: "CLM-30",
    latestDraft: draft,
  });
  const html = renderToStaticMarkup(
    <PerLegVerdictPicker
      claim={leg}
      latestDraft={draft}
      onSelect={async () => {}}
      onClear={async () => {}}
    />,
  );
  assertSelected(html, "button-pick-approved-30");
  assertClearable(html, "button-pick-approved-30");
  // The unselected pill is never clearable — clicking it saves a draft.
  assertNotSelected(html, "button-pick-denied-30");
  assertNotClearable(html, "button-pick-denied-30");
  // Tooltip / aria-label surface the affordance so it's discoverable.
  assert.match(html, /Clear Approved pick/);
});

test("Task #344: confirmed-only selection (no draft on file) is NOT clearable even with onClear wired", () => {
  // Reviewer-flagged regression: a leg can be lit up purely from an
  // `operator_confirmed` row when no draft exists on top (e.g. a
  // mixed group where one leg was confirmed under the old behavior
  // and the group hasn't moved past response-pending). The clear
  // affordance MUST NOT advertise here — DELETE /verdict/draft would
  // be a no-op (clearedCount: 0) and an optimistic `setPicked(null)`
  // would visually unset a pill that's actually backed by an
  // append-only confirmed row the server won't touch.
  const confirmed = fixtureVerdict("Approved", "operator_confirmed");
  const leg = fixtureLeg({
    id: 33,
    confNumber: "CLM-33",
    latestVerdict: confirmed,
    latestDraft: null,
  });
  const html = renderToStaticMarkup(
    <PerLegVerdictPicker
      claim={leg}
      latestVerdict={confirmed}
      latestDraft={null}
      onSelect={async () => {}}
      onClear={async () => {}}
    />,
  );
  // Pill IS lit (the operator_confirmed row seeds the selection).
  assertSelected(html, "button-pick-approved-33");
  // …but the clear affordance MUST NOT light up.
  assertNotClearable(html, "button-pick-approved-33");
  // Tooltip falls back to the legacy "(already selected)" hint, NOT
  // the new "Clear …" affordance.
  assert.match(html, /Approved \(already selected\)/);
  assert.equal(html.includes("Clear Approved pick"), false);
});

test("Task #344: draft+confirmed same outcome → draft is the clearable one (mirrors what server clears)", () => {
  // When both a draft Approved and a confirmed Approved exist for
  // the same leg, the picker prefers the draft (Task #343 newer-wins
  // rule). The clear affordance lines up with what the DELETE
  // endpoint actually removes — the draft row — so the pill on the
  // outcome that matches `latestDraft.outcome` is the clearable one.
  const draft = fixtureVerdict("Approved", "operator_draft");
  const confirmed = fixtureVerdict("Approved", "operator_confirmed");
  const leg = fixtureLeg({
    id: 34,
    confNumber: "CLM-34",
    latestVerdict: confirmed,
    latestDraft: draft,
  });
  const html = renderToStaticMarkup(
    <PerLegVerdictPicker
      claim={leg}
      latestVerdict={confirmed}
      latestDraft={draft}
      onSelect={async () => {}}
      onClear={async () => {}}
    />,
  );
  assertSelected(html, "button-pick-approved-34");
  assertClearable(html, "button-pick-approved-34");
  assert.match(html, /Clear Approved pick/);
});

test("Task #344: lit pill is NOT clearable when onClear is omitted (legacy no-op contract preserved)", () => {
  // Backwards-compatibility guard: callers that don't opt into the
  // clear path get the original forward-only behavior. The lit pill
  // still renders selected, but data-clearable=\"false\" so a click
  // short-circuits without calling either callback.
  const draft = fixtureVerdict("Denied", "operator_draft");
  const leg = fixtureLeg({
    id: 31,
    confNumber: "CLM-31",
    latestDraft: draft,
  });
  const html = renderToStaticMarkup(
    <PerLegVerdictPicker
      claim={leg}
      latestDraft={draft}
      onSelect={async () => {}}
      // intentionally no onClear
    />,
  );
  assertSelected(html, "button-pick-denied-31");
  assertNotClearable(html, "button-pick-denied-31");
  // The legacy "(already selected)" hint stays in place.
  assert.match(html, /Denied \(already selected\)/);
  // No "Clear …" tooltip leaks into the DOM when the affordance is
  // not wired.
  assert.equal(html.includes("Clear Denied pick"), false);
});

test("Task #344: with no draft on file, neither pill is clearable even when onClear is wired", () => {
  // Belt-and-suspenders: data-clearable=\"true\" is gated on
  // `picked === outcome`, NOT just on `onClear` being wired. A fresh
  // group with no draft and only an AI suggestion (which doesn't
  // seed the pill) MUST render both pills as not-selected and
  // not-clearable so the first click on either one saves a draft
  // rather than no-opping or clearing.
  const aiSuggested = fixtureVerdict("Approved", "ai_suggested");
  const leg = fixtureLeg({
    id: 32,
    confNumber: "CLM-32",
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
      onClear={async () => {}}
    />,
  );
  assertNotSelected(html, "button-pick-approved-32");
  assertNotSelected(html, "button-pick-denied-32");
  assertNotClearable(html, "button-pick-approved-32");
  assertNotClearable(html, "button-pick-denied-32");
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

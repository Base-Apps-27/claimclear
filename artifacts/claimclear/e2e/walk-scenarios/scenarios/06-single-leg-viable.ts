// Scenario #6 — single-leg claim, viable.
//
// Edge case: a group with exactly one contested leg that walks to the
// portal-dispute terminal. Pins UI invariants that historically broke
// when callers assumed ≥2 legs (the segmented leg switcher and the
// "X of Y ready" counter on the phase pill / helper text).

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 80601;
const LEG_ID = 6001;

const TREE: DecisionTree = {
  rootId: "n1",
  nodes: [
    {
      id: "n1",
      question: "Is this leg disputable?",
      options: [{ label: "Viable" }, { label: "Non-issue" }],
    },
  ],
};

export const singleLegViable: WalkScenario = {
  name: "single-leg viable · 1 contested leg → portal",
  description:
    "One-leg invoice walked to viable. Asserts the segmented switcher " +
    "renders exactly one tab, the counter pluralises 'leg' correctly, " +
    "and the submitted group still carries a single ride.",
  seed: () =>
    buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-006",
      legs: [
        {
          id: LEG_ID,
          confNumber: "CLM-SOLO",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
      ],
    }),
  run: async (d) => {
    await d.openClaim();
    await d.expectPhase("triage");

    // Switcher invariant: exactly one tab rendered, addressed by the
    // canonical leg id, and it's the active selection from the start.
    const tabs = d.page.locator('[data-testid^="mini-leg-tab-"]');
    await expect(tabs).toHaveCount(1);
    const onlyTab = d.page.getByTestId(`mini-leg-tab-${LEG_ID}`);
    await expect(onlyTab).toBeVisible();
    await expect(onlyTab).toHaveText(/Leg 1/);
    await expect(onlyTab).toHaveAttribute("aria-selected", "true");

    // Counter invariant pre-walk: helper says "Walk all 1 leg…"
    // (singular) and the phase pill reads "0 of 1 ready". A regression
    // that hard-codes plural "legs" or assumes ≥2 fails here.
    const workspace = d.page.getByTestId("inline-group-workspace-mini");
    await expect(workspace).toContainText("Walk all 1 leg to unlock");
    await expect(workspace).toContainText("0 of 1 ready");

    await d.markLegViable(LEG_ID);
    await d.expectStage("generate");

    await d.generatePreview();
    await d.expectStage("review");
    await d.markReviewed();
    await d.expectStage("ready");
    await d.submit();

    await d.expectStage("submitted");
    await d.expectPhase("submitted");
  },
  expectedCallOrder: [
    `sop_advance_${LEG_ID}`,
    "stamp_preview",
    "mark_reviewed",
    "portal_submit",
  ],
  assert: (state) => {
    // Exactly one leg in the mock state, walked to the include terminal.
    expect(state.legs.size).toBe(1);
    const only = state.legs.get(LEG_ID);
    expect(only?.sopOutcome).toBe("portal_dispute");
    expect(only?.includedInDispute).toBe(true);
    expect(only?.dropReason).toBeNull();

    // Pre-flight stamps in place and submission landed.
    expect(state.previewGeneratedAt).not.toBeNull();
    expect(state.draftReviewedAt).not.toBeNull();
    expect(state.phase).toBe("submitted");

    // Submit body carries the canonical group id. (The server resolves
    // legs server-side from the group, so the body itself doesn't list
    // claim ids — the "1 leg" guarantee is the group's ride count.)
    expect(state.portalSubmissionBody).toMatchObject({
      invoiceGroupId: GROUP_ID,
    });
  },
};

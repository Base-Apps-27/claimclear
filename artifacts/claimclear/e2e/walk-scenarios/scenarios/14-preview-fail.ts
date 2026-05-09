// Scenario #14 — preview generation fails.
//
// Walk completes for every leg, the operator clicks Generate preview,
// and the stamp-preview-generated route returns 500. The UI must
// surface an inline error banner with a Retry CTA — never strand the
// hero on a stuck "generating…" spinner — and the group must NOT
// advance to the Review phase.
//
// See task #602 for the failure contract this pins.

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 80014;
const LEG_A_ID = 1401;
const LEG_B_ID = 1402;

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

export const previewFail: WalkScenario = {
  name: "scenario-14-preview-fail",
  description:
    "Preview generation returns 500 — UI surfaces an error banner with Retry, " +
    "spinner does not persist, and the group stays on the Generate hero.",
  seed: () =>
    buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-014",
      failPreviewWith: 500,
      legs: [
        {
          id: LEG_A_ID,
          confNumber: "CLM-14A",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
        {
          id: LEG_B_ID,
          confNumber: "CLM-14B",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
      ],
    }),
  run: async (d) => {
    await d.openClaim();
    await d.markLegViable(LEG_A_ID);
    await d.markLegViable(LEG_B_ID);
    await d.expectStage("generate");

    // Click Generate preview directly — `d.generatePreview()` waits
    // for the Review hero to mount, which would never happen here.
    const cta = d.page.getByTestId("mini-generate-preview");
    await expect(cta).toBeEnabled();
    await cta.click();

    // Error banner appears with a wired Retry button.
    const banner = d.page.getByTestId("mini-generate-preview-error");
    await expect(banner).toBeVisible();
    const retry = d.page.getByTestId("mini-generate-preview-retry");
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();

    // Spinner did not get stuck — the primary CTA is back to its
    // idle state (enabled, ready for another click).
    await expect(cta).toBeEnabled();

    // Group never advanced to the Review hero / phase.
    await expect(
      d.page.getByTestId("mini-mark-reviewed"),
    ).toHaveCount(0);
    await d.expectStage("generate");
    await d.expectPhase("triage");
  },
  expectedCallOrder: ["sop_advance_1401", "sop_advance_1402", "stamp_preview_fail"],
  assert: (state) => {
    // The failed POST was recorded, but no preview stamp landed and
    // the group stayed in the pre-submit Generate hero.
    expect(state.callOrder).toContain("stamp_preview_fail");
    expect(state.callOrder).not.toContain("stamp_preview");
    expect(state.previewGeneratedAt).toBeNull();
    expect(state.draftReviewedAt).toBeNull();
    expect(state.phase).toBe("triage");
  },
};

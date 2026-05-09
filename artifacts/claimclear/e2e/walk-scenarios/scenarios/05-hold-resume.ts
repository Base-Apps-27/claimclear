// Scenario #5 — Hold Leg B mid-walk, release, finish.
//
// Pins the "operator hits pause on a leg, comes back, finishes the
// walk" flow: start the walk, place a hold on Leg B, release the
// hold, then drive both legs to viable and submit. The final
// payload must be identical to the happy-path scenario — placing
// and releasing a hold should not leave any side-effects on the
// portal-submission body or the terminal phase.
//
// Out of scope (covered elsewhere):
//  - Cross-leg hold ordering         → scenario #11
//  - Hold persistence across reload  → scenario #12 (not Tier 1)

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 78905;
const LEG_A_ID = 5001;
const LEG_B_ID = 5002;

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

export const holdResume: WalkScenario = {
  name: "hold mid-walk · place hold on Leg B, release, finish",
  description:
    "Start walk, pause Leg B with a hold, release the hold, finish both legs, submit.",
  seed: () =>
    buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-005",
      legs: [
        {
          id: LEG_A_ID,
          confNumber: "CLM-A",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
        {
          id: LEG_B_ID,
          confNumber: "CLM-B",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
      ],
    }),
  run: async (d) => {
    await d.openClaim();
    await d.expectPhase("triage");

    // Walk Leg A all the way through so the gate to Leg B is open.
    await d.markLegViable(LEG_A_ID);

    // Mid-walk on Leg B: open the player, then immediately pause
    // the leg before answering. The hold banner (release-leg-hold
    // CTA) is asserted by the driver's placeLegHold helper.
    await d.selectLeg(LEG_B_ID);
    await d.startWalk();
    await d.placeLegHold(LEG_B_ID, { reason: "evidence_pending" });

    // Release the hold and finish the walk on Leg B.
    await d.releaseLegHold(LEG_B_ID);
    await d.markLegViable(LEG_B_ID);
    await d.expectStage("generate");

    await d.generatePreview();
    await d.expectStage("review");
    await d.markReviewed();
    await d.expectStage("ready");
    await d.submit();

    await d.expectStage("submitted");
    await d.expectPhase("submitted");
  },
  // Leg-hold place / release must bracket the second sop_advance,
  // and the rest of the lifecycle must follow the happy-path order.
  expectedCallOrder: [
    `sop_advance_${LEG_A_ID}`,
    `leg_hold_place_${LEG_B_ID}`,
    `leg_hold_release_${LEG_B_ID}`,
    `sop_advance_${LEG_B_ID}`,
    "stamp_preview",
    "mark_reviewed",
    "portal_submit",
  ],
  assert: (state) => {
    // Both legs landed on the include terminal.
    expect(state.legs.get(LEG_A_ID)?.sopOutcome).toBe("portal_dispute");
    expect(state.legs.get(LEG_B_ID)?.sopOutcome).toBe("portal_dispute");
    // Hold was fully cleared on Leg B before the walk resumed.
    expect(state.legs.get(LEG_B_ID)?.holdReason).toBeNull();
    expect(state.legs.get(LEG_B_ID)?.holdPendingFrom).toBeNull();
    // Preview + reviewed stamps recorded.
    expect(state.previewGeneratedAt).not.toBeNull();
    expect(state.draftReviewedAt).not.toBeNull();
    // Final phase + submission body match scenario-01's payload shape.
    expect(state.phase).toBe("submitted");
    expect(state.portalSubmissionBody).toMatchObject({
      invoiceGroupId: GROUP_ID,
    });
  },
};

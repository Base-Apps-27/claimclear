// Scenario #11 — hold every leg, resume in a different order.
//
// Stress-test the per-leg hold/restore state machine: place a hold on
// every leg in the invoice, then release them in REVERSE of the order
// they were held. Then walk every leg to viable, generate preview,
// mark reviewed, submit. Final state must be equivalent to the happy
// path (Submitted, payload carries all 3 legs).
//
// Pins the invariant that hold/release is per-leg and order-
// independent — the order legs are released in must NOT affect the
// final submitted payload.

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 88011;
const LEG_A_ID = 11001;
const LEG_B_ID = 11002;
const LEG_C_ID = 11003;

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

export const holdAllResumeOrder: WalkScenario = {
  name: "scenario-11-hold-all-resume-order",
  description:
    "Hold every leg, release in reverse order, then walk all to viable and submit.",
  seed: () =>
    buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-011",
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
        {
          id: LEG_C_ID,
          confNumber: "CLM-C",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
      ],
    }),
  run: async (d) => {
    await d.openClaim();
    await d.expectPhase("triage");

    // Hold every leg in A → B → C order.
    await d.placeLegHold(LEG_A_ID);
    await d.placeLegHold(LEG_B_ID);
    await d.placeLegHold(LEG_C_ID);

    // Release in REVERSE order: C → B → A.
    await d.releaseLegHold(LEG_C_ID);
    await d.releaseLegHold(LEG_B_ID);
    await d.releaseLegHold(LEG_A_ID);

    // Walk all three legs to viable (any order — pick one that
    // differs from both the hold and release orderings to drive the
    // point home that per-leg state is independent).
    await d.markLegViable(LEG_B_ID);
    await d.markLegViable(LEG_A_ID);
    await d.markLegViable(LEG_C_ID);
    await d.expectStage("generate");

    await d.generatePreview();
    await d.expectStage("review");
    await d.markReviewed();
    await d.expectStage("ready");
    await d.submit();

    await d.expectStage("submitted");
    await d.expectPhase("submitted");
  },
  // Pin both the hold ordering (A → B → C) and the resume ordering
  // (C → B → A), then the canonical submit tail. The runner asserts
  // this is a subsequence of state.callOrder.
  expectedCallOrder: [
    `leg_hold_place_${LEG_A_ID}`,
    `leg_hold_place_${LEG_B_ID}`,
    `leg_hold_place_${LEG_C_ID}`,
    `leg_hold_release_${LEG_C_ID}`,
    `leg_hold_release_${LEG_B_ID}`,
    `leg_hold_release_${LEG_A_ID}`,
    "stamp_preview",
    "mark_reviewed",
    "portal_submit",
  ],
  assert: (state) => {
    // Every leg landed on the include terminal regardless of
    // hold/release order.
    expect(state.legs.get(LEG_A_ID)?.sopOutcome).toBe("portal_dispute");
    expect(state.legs.get(LEG_B_ID)?.sopOutcome).toBe("portal_dispute");
    expect(state.legs.get(LEG_C_ID)?.sopOutcome).toBe("portal_dispute");
    // No leg should still be on hold after the walk completes.
    for (const leg of state.legs.values()) {
      expect(leg.holdReason).toBeNull();
      expect(leg.holdPendingFrom).toBeNull();
    }
    // Preview + reviewed stamps recorded, submit fired.
    expect(state.previewGeneratedAt).not.toBeNull();
    expect(state.draftReviewedAt).not.toBeNull();
    expect(state.phase).toBe("submitted");
    // Submit body carried the canonical group id — payload is
    // equivalent to the happy path.
    expect(state.portalSubmissionBody).toMatchObject({
      invoiceGroupId: GROUP_ID,
    });
  },
};

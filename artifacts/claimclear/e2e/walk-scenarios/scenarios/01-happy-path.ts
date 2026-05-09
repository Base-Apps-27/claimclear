// Scenario #1 — happy path: 2 viable legs → portal submission.
//
// Pins the canonical "everything works" Queue walk: two legs, both
// land on a portal-dispute terminal via the SOP player, the operator
// generates the preview, marks it reviewed, then submits to the
// portal. The harness asserts the call ledger so the ordering
// invariant (sop_advance × N → stamp_preview → mark_reviewed →
// portal_submit) survives any future refactor.

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 78901;
const LEG_A_ID = 1001;
const LEG_B_ID = 1002;

// One-question tree where the answer label is what the mock keys off
// to stamp the SOP outcome. Keep it small — bigger trees belong in
// scenarios that specifically exercise multi-step walks.
const TREE: DecisionTree = {
  rootId: "n1",
  nodes: [
    {
      id: "n1",
      question: "Is this leg disputable?",
      options: [
        { label: "Viable" },
        { label: "Non-issue" },
      ],
    },
  ],
};

export const happyPath: WalkScenario = {
  name: "happy path · 2 viable legs → portal",
  description:
    "Two-leg invoice, both legs walked to viable, preview generated, draft reviewed, submitted.",
  seed: () =>
    buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-001",
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

    await d.markLegViable(LEG_A_ID);
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
  // Declarative ordering — the runner asserts this is a subsequence
  // of state.callOrder. Pinning sop_advance(A) -> sop_advance(B) ->
  // stamp_preview -> mark_reviewed -> portal_submit guards against a
  // refactor that lets the operator submit a draft with unwalked legs.
  expectedCallOrder: [
    `sop_advance_${LEG_A_ID}`,
    `sop_advance_${LEG_B_ID}`,
    "stamp_preview",
    "mark_reviewed",
    "portal_submit",
  ],
  assert: (state) => {
    // Both legs landed on the include terminal.
    expect(state.legs.get(LEG_A_ID)?.sopOutcome).toBe("portal_dispute");
    expect(state.legs.get(LEG_B_ID)?.sopOutcome).toBe("portal_dispute");
    // Preview + reviewed stamps recorded.
    expect(state.previewGeneratedAt).not.toBeNull();
    expect(state.draftReviewedAt).not.toBeNull();
    // Final phase flipped on the portal-submit POST.
    expect(state.phase).toBe("submitted");
    // Submit body carried the canonical group id.
    expect(state.portalSubmissionBody).toMatchObject({
      invoiceGroupId: GROUP_ID,
    });
  },
};

// Scenario #9 — every leg marked non-issue → group auto-closes.
//
// Same end state as scenario #3 (close), but reached by walking every
// leg to a Non-issue terminal rather than failing viability. The
// closure reason code differs: `non_issue` here vs `cannot_dispute`
// for the not-viable path. Pinning both paths separately keeps a
// future refactor honest about *why* a group closed, not just *that*
// it closed.

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 80009;
const LEG_A_ID = 9001;
const LEG_B_ID = 9002;

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

export const allNonIssue: WalkScenario = {
  name: "all legs marked non-issue → close",
  description:
    "Two-leg invoice, both legs walked to a Non-issue terminal; group auto-closes with closureReason='non_issue'.",
  seed: () =>
    buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-009",
      legs: [
        {
          id: LEG_A_ID,
          confNumber: "CLM-NI-A",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
        {
          id: LEG_B_ID,
          confNumber: "CLM-NI-B",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
      ],
    }),
  run: async (d) => {
    await d.openClaim();
    await d.expectPhase("triage");

    await d.markLegNonIssue(LEG_A_ID);
    await d.markLegNonIssue(LEG_B_ID);
  },
  // Both per-leg sop_advance calls must precede the auto-close stamp.
  // The close fires on the second sop_advance, so it lands after
  // sop_advance_B in the ledger.
  expectedCallOrder: [
    `sop_advance_${LEG_A_ID}`,
    `sop_advance_${LEG_B_ID}`,
    "group_close_non_issue",
  ],
  assert: (state) => {
    expect(state.legs.get(LEG_A_ID)?.sopOutcome).toBe("non_issue");
    expect(state.legs.get(LEG_B_ID)?.sopOutcome).toBe("non_issue");
    // Closure stamped with the non-issue reason — distinct from the
    // not-viable path (`cannot_dispute`) used by scenario #3.
    expect(state.phase).toBe("closed");
    expect(state.closureReason).toBe("non_issue");
    expect(state.closureReason).not.toBe("cannot_dispute");
    // No portal submission was created — closure short-circuits the
    // generate/review/submit flow.
    expect(state.previewGeneratedAt).toBeNull();
    expect(state.draftReviewedAt).toBeNull();
    expect(state.portalSubmissionBody).toBeNull();
  },
};

// Scenario #7 — single contested leg fails viability → close-out path.
//
// One-leg invoice. The operator walks the leg, picks the closure
// terminal ("Cannot dispute"), and the workspace pivots to the
// "nothing left to dispute" outlook with the amber "Ready to close"
// pill. Pins:
//   - the close-the-leg route (`/sop-advance`) actually fires,
//   - the workspace flips to outlook=`nothing_to_do` / hero=`resolved`,
//   - the close-out copy renders cleanly (no "0 of 1 contested" or
//     other divide-by-zero artifacts that creep in when survivor
//     denominators aren't guarded).

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 78907;
const LEG_ID = 1701;

// Single-question tree. The "Cannot dispute" label is what the mock
// keys off (`OUTCOME_BY_ANSWER`) to stamp `sopOutcome=cannot_dispute`
// and `dropReason=cannot_dispute` on the leg, which is what the
// outlook derivation reads to land on `nothing_to_do`.
const TREE: DecisionTree = {
  rootId: "n1",
  nodes: [
    {
      id: "n1",
      question: "Is this leg disputable?",
      options: [
        { label: "Viable" },
        { label: "Cannot dispute" },
      ],
    },
  ],
};

export const singleLegNotViable: WalkScenario = {
  name: "single leg · not viable → close-out",
  description:
    "One-leg invoice walked to the cannot-dispute terminal; workspace flips to nothing_to_do with the close-out pill and no divide-by-zero copy.",
  seed: () =>
    buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-007",
      legs: [
        {
          id: LEG_ID,
          confNumber: "CLM-NV",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
      ],
    }),
  run: async (d) => {
    await d.openClaim();
    await d.expectPhase("triage");

    // Drive the SOP to the closure terminal. Reuses the harness
    // verb that already knows how to start the walk and click an
    // SOP option label — the "Non-issue" default is overridden so
    // the mock stamps `cannot_dispute` instead.
    await d.markLegNonIssue(LEG_ID, "Cannot dispute");

    // With the only leg dropped, outlook flips to `nothing_to_do`
    // and the active-leg hero settles on `resolved`. Both attrs
    // live on the workspace root, so we read them directly here
    // rather than adding a single-use driver verb.
    const workspace = d.page.getByTestId("inline-group-workspace-mini");
    await expect(workspace).toHaveAttribute("data-outlook", "nothing_to_do");
    await expect(workspace).toHaveAttribute("data-hero", "resolved");

    // Footer pill is the close-out CTA equivalent in the mini pane:
    // amber "Ready to close" chip + the "Nothing left to dispute"
    // helper. If the survivor-denominator guard regresses this is
    // where a "0 of 1 contested" / "NaN%" string surfaces.
    const pill = d.page.getByTestId("mini-phase-pill");
    await expect(pill).toBeVisible();
    await expect(pill).toContainText("Ready to close");
    await expect(workspace).toContainText(
      "Nothing left to dispute — close the invoice out as Withdrawn.",
    );

    // Divide-by-zero / empty-denominator regression guard. None of
    // these substrings should appear anywhere in the workspace when
    // every contested leg has been dropped.
    const workspaceText = (await workspace.textContent()) ?? "";
    expect(workspaceText).not.toMatch(/0 of 0/);
    expect(workspaceText).not.toMatch(/0 of 1 contested/i);
    expect(workspaceText).not.toMatch(/NaN/);
    expect(workspaceText).not.toMatch(/Infinity/);
    expect(workspaceText).not.toMatch(/undefined/);
  },
  // Close-the-leg route fires exactly once for the single leg —
  // the only commit-affecting POST in the whole walk.
  expectedCallOrder: [`sop_advance_${LEG_ID}`],
  assert: (state) => {
    // The cannot-dispute terminal stamped the leg + drop reason.
    const leg = state.legs.get(LEG_ID);
    expect(leg?.sopOutcome).toBe("cannot_dispute");
    expect(leg?.dropReason).toBe("cannot_dispute");
    // Phase stays in `triage` — the close-out itself is a separate
    // operator gesture from Full Details; this scenario only pins
    // the in-pane pivot to the close-out outlook.
    expect(state.phase).toBe("triage");
    // Submit was never wired up — the only POST that ran is the
    // single sop_advance. Belt-and-suspenders alongside
    // `expectedCallOrder` so a stray mutation slipping in here
    // shows up as an inequality instead of a subsequence pass.
    expect(state.callOrder).toEqual([`sop_advance_${LEG_ID}`]);
  },
};

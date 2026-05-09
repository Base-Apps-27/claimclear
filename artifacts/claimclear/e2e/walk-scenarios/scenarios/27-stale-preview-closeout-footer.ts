// Scenario #27 — stale preview + nothing_to_do outlook → default footer.
//
// Companion to scenario #26. Same edge case (preview stamped while
// the group still had a disputable leg, then the leg shape changed),
// but the post-flip outlook here is `nothing_to_do` instead of
// `reattest_only`: every leg landed on a cannot_dispute terminal so
// there is no survivor to re-attest and nothing to dispute.
//
// The hero derivation in `inline-group-workspace-mini.tsx` still
// resolves to `review` (the `previewGenerated && !forceWalk` branch
// wins before the `allWalked && outlook === "nothing_to_do"` branch
// is reached). PinnedFooter must therefore render the *default*
// footer with the close-affordance phase pill ("Ready to close",
// tone amber) — the close-out helper copy is what tells the operator
// to drop the invoice via Withdraw — Cannot Dispute on the detail
// rail (scenario #3 pins the actual close-out flow).
//
// Pinned invariants:
//   - data-hero="review", data-outlook="nothing_to_do" on first paint.
//   - The default-footer phase pill is present with the close-out
//     label ("Ready to close").
//   - The default-footer helper copy points the operator at the
//     Withdraw close-out (proves buildMiniPhase ran the
//     nothing_to_do branch, not the has_disputable branch).
//   - The Hold-invoice button is suppressed (the default footer
//     gates it on `outlook !== "nothing_to_do"`, so a regression
//     that wires Hold for the close-out lane would trip this).
//   - The review-footer "Mark reviewed" CTA is absent.
//   - The ready / default-footer "Submit" CTA is absent.

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 80427;
const LEG_A_ID = 27001;
const LEG_B_ID = 27002;

const TREE: DecisionTree = {
  rootId: "n1",
  nodes: [
    {
      id: "n1",
      question: "Is this leg disputable?",
      options: [{ label: "Viable" }, { label: "Cannot dispute" }],
    },
  ],
};

export const stalePreviewCloseoutFooter: WalkScenario = {
  name: "scenario-27-stale-preview-closeout-footer · review hero + nothing_to_do outlook → default footer",
  description:
    "Preview was stamped while the group was disputable; both legs subsequently landed on cannot_dispute terminals. Hero stays on review (previewGenerated wins), but the PinnedFooter must fall back to the default footer with a close affordance (Ready to close pill, no Mark reviewed, no Submit, no Hold invoice).",
  seed: () => {
    const state = buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-027",
      legs: [
        {
          id: LEG_A_ID,
          confNumber: "CLM-A27",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
        {
          id: LEG_B_ID,
          confNumber: "CLM-B27",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
      ],
      previewGeneratedAt: "2026-04-15T13:00:00.000Z",
    });
    // Both legs land on cannot_dispute — no disputable, no
    // survivor → outlook collapses to nothing_to_do. Note that this
    // path does NOT trigger the mock's auto-close cascade
    // (`maybeAutoCloseGroup` only fires the all-non_issue branch),
    // which keeps the group in `triage` rather than flipping
    // straight to `closed` and unmounting the workspace.
    for (const leg of state.legs.values()) {
      leg.sopOutcome = "cannot_dispute";
      leg.dropReason = "cannot_dispute";
    }
    return state;
  },
  run: async (d) => {
    const { page } = d;
    await d.openClaim();

    const workspace = page.getByTestId("inline-group-workspace-mini");
    await expect(workspace).toHaveAttribute("data-hero", "review");
    await expect(workspace).toHaveAttribute("data-outlook", "nothing_to_do");

    // Default footer renders — phase pill carries the close-out
    // label, helper copy points at Withdraw.
    await expect(page.getByTestId("mini-pinned-footer")).toBeVisible();
    const pill = page.getByTestId("mini-phase-pill");
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText(/Ready to close/i);
    await expect(page.getByTestId("mini-pinned-footer")).toContainText(
      /Withdrawn/i,
    );

    // No Mark reviewed (review footer doesn't mount), no Submit
    // CTA (gated on has_disputable), no Hold invoice (gated on
    // outlook !== "nothing_to_do" in the default footer).
    await expect(page.getByTestId("mini-mark-reviewed")).toHaveCount(0);
    await expect(page.getByTestId("mini-submit-cta")).toHaveCount(0);
    await expect(page.getByTestId("mini-place-group-hold")).toHaveCount(0);
  },
  assert: (state) => {
    expect(state.legs.get(LEG_A_ID)?.sopOutcome).toBe("cannot_dispute");
    expect(state.legs.get(LEG_B_ID)?.sopOutcome).toBe("cannot_dispute");
    // Pure render-posture check — no commit POSTs should fire.
    expect(state.callOrder).not.toContain("stamp_preview");
    expect(state.callOrder).not.toContain("mark_reviewed");
    expect(state.callOrder).not.toContain("portal_submit");
    expect(state.callOrder).not.toContain("group_close");
    // Group never auto-closed (mixed mock cascade only fires for
    // all-non_issue), so phase stayed in triage.
    expect(state.phase).toBe("triage");
  },
};

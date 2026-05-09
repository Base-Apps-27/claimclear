// Scenario #4 — Smoke #04: contested legs not viable, non-issue legs
// viable → reattest direct (Task #595).
//
// Three-leg invoice. The two contested legs walk to "Cannot dispute"
// (sopOutcome = cannot_dispute → dropped) and the lone non-issue leg
// walks to "Non-issue" (sopOutcome = non_issue → survivor). With no
// disputable legs left, the workspace's outlook flips to
// `reattest_only` so the operator never sees the Generate Preview /
// Submit pipeline. Parking the survivor on the Attestation Queue
// transitions the group to `awaiting_reattestation`, which the
// lifecycle-phase map collapses to the `mas-action-required`
// macroPhase.
//
// Pinned invariants:
//   - The workspace data-outlook becomes `reattest_only` after the
//     walk and the Generate-Preview hero never mounts.
//   - `stamp_preview` and `portal_submit` are absent from the call
//     ledger — there is no portal phase on this path.
//   - `bulk_queue_reattest` does fire and the group's macroPhase
//     resolves to `mas-action-required`.

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 80401;
const CONTESTED_A_ID = 4001;
const CONTESTED_B_ID = 4002;
const NON_ISSUE_ID = 4003;

// Two-option tree: "Cannot dispute" lands the leg on the
// cannot_dispute terminal (dropped), "Non-issue" lands it on the
// non_issue terminal (survivor). Mirrors `OUTCOME_BY_ANSWER` in
// `mock-builder.ts`.
const TREE: DecisionTree = {
  rootId: "n1",
  nodes: [
    {
      id: "n1",
      question: "Is this leg disputable?",
      options: [
        { label: "Cannot dispute" },
        { label: "Non-issue" },
      ],
    },
  ],
};

export const reattestDirect: WalkScenario = {
  name: "scenario-04-reattest-direct · contested not viable + non-issue viable → reattest queue",
  description:
    "Two contested legs fail viability (cannot_dispute), one non-issue leg survives. Walk routes the group to the Reattest queue without ever generating a portal preview.",
  seed: () =>
    buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-004",
      legs: [
        {
          id: CONTESTED_A_ID,
          confNumber: "CLM-CONTESTED-A",
          errorTypeId: "et_contested",
          errorTypeName: "Contested",
          tree: TREE,
        },
        {
          id: CONTESTED_B_ID,
          confNumber: "CLM-CONTESTED-B",
          errorTypeId: "et_contested",
          errorTypeName: "Contested",
          tree: TREE,
        },
        {
          id: NON_ISSUE_ID,
          confNumber: "CLM-NONISSUE",
          errorTypeId: "et_non_issue",
          errorTypeName: "Non-Issue Review",
          tree: TREE,
        },
      ],
    }),
  run: async (d) => {
    await d.openClaim();
    await d.expectPhase("triage");

    // Walk both contested legs to the cannot_dispute terminal — they
    // drop out of the dispute, leaving zero disputable legs.
    await d.markLegNonIssue(CONTESTED_A_ID, "Cannot dispute");
    await d.markLegNonIssue(CONTESTED_B_ID, "Cannot dispute");
    // Walk the non-issue leg to the non_issue terminal — survivor for
    // re-attestation.
    await d.markLegNonIssue(NON_ISSUE_ID, "Non-issue");

    // No disputable legs → outlook collapses to `reattest_only` and
    // the workspace stops surfacing portal-prep heroes. `resolved`
    // wins because every leg has a closed terminal stamped.
    const workspace = d.page.getByTestId("inline-group-workspace-mini");
    await expect(workspace).toHaveAttribute("data-outlook", "reattest_only");
    await d.expectStage("resolved");
    // Generate-Preview hero must never have mounted.
    await expect(d.page.getByTestId("mini-generate-preview")).toHaveCount(0);
    // Pinned-footer Submit-to-portal CTA is gated on
    // `outlook === "has_disputable"` — must not render here either.
    await expect(d.page.getByTestId("mini-submit-cta")).toHaveCount(0);

    // Operator parks the survivor on the Attestation Queue. Driven
    // through the harness directly because the Queue page workspace
    // doesn't host the Re-attest CTA (it lives on invoice-detail).
    await d.queueReattest();

    // After queueing, the group's phase flips to
    // `awaiting_reattestation`, which the lifecycle map exposes as
    // the `mas-action-required` macroPhase.
    expect(d.state.phase).toBe("awaiting_reattestation");
  },
  // Walk → reattest queue, never preview/submit. The runner asserts
  // this is a subsequence of state.callOrder.
  expectedCallOrder: [
    `sop_advance_${CONTESTED_A_ID}`,
    `sop_advance_${CONTESTED_B_ID}`,
    `sop_advance_${NON_ISSUE_ID}`,
    "bulk_queue_reattest",
  ],
  assert: (state) => {
    // Per-leg outcomes match the manifest.
    expect(state.legs.get(CONTESTED_A_ID)?.sopOutcome).toBe("cannot_dispute");
    expect(state.legs.get(CONTESTED_B_ID)?.sopOutcome).toBe("cannot_dispute");
    expect(state.legs.get(NON_ISSUE_ID)?.sopOutcome).toBe("non_issue");

    // The portal pipeline never fired — no preview stamped, no draft
    // reviewed, no portal-submission POST recorded.
    expect(state.previewGeneratedAt).toBeNull();
    expect(state.draftReviewedAt).toBeNull();
    expect(state.portalSubmissionBody).toBeNull();
    expect(state.callOrder).not.toContain("stamp_preview");
    expect(state.callOrder).not.toContain("mark_reviewed");
    expect(state.callOrder).not.toContain("portal_submit");

    // Reattest queue route fired and group landed in
    // mas-action-required (via phase=awaiting_reattestation).
    expect(state.callOrder).toContain("bulk_queue_reattest");
    expect(state.phase).toBe("awaiting_reattestation");
  },
};

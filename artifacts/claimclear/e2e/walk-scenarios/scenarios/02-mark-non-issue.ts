// Scenario #2 — mark one leg non-issue, queue the other.
//
// Two-leg invoice. The operator decides Leg A is a non-issue mid-walk
// (closed terminal, dropReason=non_issue), then completes a viable
// walk for Leg B. The dispute that ships should carry only Leg B —
// Leg A is dropped server-side via its closed terminal stamp. This
// scenario pins:
//   1. The closed-terminal flow does NOT block the operator from
//      finishing the surviving leg and submitting.
//   2. The submit body still posts cleanly (one MAS tracking id).
//   3. The leg ledger reflects Leg A as a non_issue exclusion and
//      Leg B as the portal_dispute that survived to the wire.

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 78902;
const LEG_A_ID = 2001;
const LEG_B_ID = 2002;

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

export const markOneNonIssue: WalkScenario = {
  name: "mark one leg non-issue · queue the other",
  description:
    "Two-leg invoice; Leg A walked to non-issue, Leg B walked to viable, then preview/review/submit.",
  seed: () =>
    buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-002",
      legs: [
        {
          id: LEG_A_ID,
          confNumber: "CLM-A2",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
        {
          id: LEG_B_ID,
          confNumber: "CLM-B2",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
      ],
    }),
  run: async (d) => {
    await d.openClaim();
    await d.expectPhase("triage");

    // Leg A: closed terminal (non-issue) — should not block Leg B.
    await d.markLegNonIssue(LEG_A_ID);
    // Leg B: viable terminal — once both legs are terminal the hero
    // flips to `generate`.
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
  // Pin the order: A's non-issue stamp -> B's viable stamp -> preview
  // -> reviewed -> portal submit. Guards against a refactor that
  // accidentally lets a closed leg leak into the dispute payload by
  // re-stamping after submit, or skips the preview/reviewed gates.
  expectedCallOrder: [
    `sop_advance_${LEG_A_ID}`,
    `sop_advance_${LEG_B_ID}`,
    "stamp_preview",
    "mark_reviewed",
    "portal_submit",
  ],
  assert: (state) => {
    const legA = state.legs.get(LEG_A_ID);
    const legB = state.legs.get(LEG_B_ID);
    // Leg A landed on the closed (non-issue) terminal — server will
    // drop it from the dispute.
    expect(legA?.sopOutcome).toBe("non_issue");
    expect(legA?.dropReason).toBe("non_issue");
    // Leg B is the surviving disputable leg.
    expect(legB?.sopOutcome).toBe("portal_dispute");
    expect(legB?.dropReason).toBeNull();

    // Preview + reviewed stamps recorded.
    expect(state.previewGeneratedAt).not.toBeNull();
    expect(state.draftReviewedAt).not.toBeNull();
    expect(state.phase).toBe("submitted");

    // One MAS tracking id — i.e. exactly one portal-submit POST.
    expect(
      state.callOrder.filter((l) => l === "portal_submit").length,
    ).toBe(1);

    // Submit body carried the canonical group id. The wire shape does
    // not enumerate legs; the server filters by the per-leg sopOutcome
    // ledger above, which we've already pinned.
    expect(state.portalSubmissionBody).toMatchObject({
      invoiceGroupId: GROUP_ID,
    });
  },
};

// Scenario #21 — zero evidence attached at walk start.
//
// Two-leg invoice where every leg's first SOP node carries a required
// evidence requirement and the leg has no evidence on file. The walk
// shouldn't silently advance past the viability check — the player
// must surface its "needs evidence" gate (sop-evidence-block +
// sop-evidence-blocked indicator) and refuse to stamp an outcome
// until the operator attaches something. Pins:
//   1. The Start-walk CTA on the workspace still routes the operator
//      INTO the player (not a blank/no-op) so they can see what they
//      need to attach.
//   2. The evidence-block surface renders on every leg, with the
//      blocked-advance indicator visible.
//   3. The option buttons are disabled, AND nothing reaches the
//      `/sop-advance` endpoint — i.e. no `sop_advance_${legId}` ever
//      lands in the call ledger and the leg's `sopOutcome` stays
//      null. Guards against a refactor that lets the gate render
//      cosmetically but still fires the mutation underneath.
//
// Out of scope: the actual evidence upload flow.

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 78921;
const LEG_A_ID = 21001;
const LEG_B_ID = 21002;

// First node carries a required image-evidence row, so the player's
// `evidenceReady` gate trips false on entry and the option buttons
// render disabled. The "Viable" label still maps to portal_dispute via
// OUTCOME_BY_ANSWER — but we expect it to never be stamped here.
const TREE: DecisionTree = {
  rootId: "n1",
  nodes: [
    {
      id: "n1",
      question: "Is this leg disputable?",
      evidenceRequirements: [
        {
          key: "auth_screenshot",
          label: "Authorization screenshot",
          required: true,
          acceptsImage: true,
          acceptsText: false,
        },
      ],
      options: [
        { label: "Viable" },
        { label: "Non-issue" },
      ],
    },
  ],
};

export const zeroEvidence: WalkScenario = {
  name: "scenario-21-zero-evidence · walk blocked when nothing attached",
  description:
    "Two-leg invoice with a required evidence row and zero attachments — the player must surface a needs-evidence gate and refuse to advance.",
  seed: () =>
    buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-021",
      legs: [
        {
          id: LEG_A_ID,
          confNumber: "CLM-A21",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
        {
          id: LEG_B_ID,
          confNumber: "CLM-B21",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
      ],
    }),
  run: async (d) => {
    await d.openClaim();
    await d.expectPhase("triage");

    for (const legId of [LEG_A_ID, LEG_B_ID]) {
      await d.selectLeg(legId);
      // Start-walk CTA must still route the operator into the player
      // — the gate lives inside the player, not at the workspace
      // level, so the operator can see WHAT to attach.
      await d.startWalk();

      // Evidence-block surface + blocked-advance indicator render.
      await expect(
        d.page.getByTestId("sop-evidence-block"),
      ).toBeVisible();
      await expect(
        d.page.getByTestId("sop-evidence-blocked"),
      ).toBeVisible();

      // Both option buttons are disabled by the evidence gate. Click
      // anyway with `force: true` to prove the disabled-state actually
      // suppresses the underlying advance mutation (a regression that
      // dropped `disabled` from the button without dropping the gate
      // logic would still let a real click through).
      const viable = d.page.getByTestId("sop-option-0");
      await expect(viable).toBeDisabled();
      await expect(d.page.getByTestId("sop-option-1")).toBeDisabled();
      await viable.click({ force: true }).catch(() => {
        /* `force` on a disabled button is a no-op in Playwright; we
         * swallow any actionability error so the assertion below is
         * what proves the gate held. */
      });
    }

    // Hero never advanced past the SOP step for either leg, and the
    // group is still parked in triage with no preview/reviewed/submit
    // ever firing.
    await d.expectStage("sop");
    await d.expectPhase("triage");
  },
  assert: (state) => {
    // No /sop-advance call ever landed for either leg, despite the
    // forced clicks above. This is the load-bearing assertion: the
    // gate must short-circuit the mutation, not just the visuals.
    expect(
      state.callOrder.some((l) => l === `sop_advance_${LEG_A_ID}`),
      `unexpected sop_advance for leg A in callOrder=${JSON.stringify(state.callOrder)}`,
    ).toBe(false);
    expect(
      state.callOrder.some((l) => l === `sop_advance_${LEG_B_ID}`),
      `unexpected sop_advance for leg B in callOrder=${JSON.stringify(state.callOrder)}`,
    ).toBe(false);

    // Per-leg state proves the gate held — both legs are still on
    // the root node with no outcome stamped.
    const legA = state.legs.get(LEG_A_ID);
    const legB = state.legs.get(LEG_B_ID);
    expect(legA?.sopOutcome).toBeNull();
    expect(legA?.sopAnswers).toEqual([]);
    expect(legB?.sopOutcome).toBeNull();
    expect(legB?.sopAnswers).toEqual([]);

    // Group never reached preview / review / submit.
    expect(state.previewGeneratedAt).toBeNull();
    expect(state.draftReviewedAt).toBeNull();
    expect(state.phase).toBe("triage");
    expect(state.portalSubmissionBody).toBeNull();
  },
};

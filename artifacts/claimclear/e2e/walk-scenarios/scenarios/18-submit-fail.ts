// Scenario #18 — Submit to portal fails (Smoke #18).
//
// Two-leg invoice walked all the way to Review-ready. The first
// portal-submission POST is rejected (mock primed with
// `submitFailWith: 500`); the operator sees the error UI, the group
// stays in pre-submit (NOT flipped to `submitted`), and a second
// click — once the failure is cleared — lands cleanly. Pins:
//   1. The submit-fail toast surfaces "Submit failed".
//   2. Group phase remains `triage` after the failure (no
//      half-submitted state).
//   3. Submit CTA re-enables so retry is possible.
//   4. The retry posts a second portal_submit and the group flips to
//      `submitted` exactly once.
//
// Out of scope: idempotency-key correctness on retry — see task.

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 80018;
const LEG_A_ID = 18001;
const LEG_B_ID = 18002;

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

export const submitFail: WalkScenario = {
  name: "submit to portal fails · error surfaces, retry succeeds",
  description:
    "Two-leg invoice walked to Review-ready; first submit POST returns 500, error UI surfaces, group stays pre-submit, retry succeeds.",
  seed: () => {
    const state = buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-018",
      legs: [
        {
          id: LEG_A_ID,
          confNumber: "CLM-A18",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
        {
          id: LEG_B_ID,
          confNumber: "CLM-B18",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
      ],
    });
    // Prime the manifest entry called for in the task: the first
    // submit POST is rejected with 500. The mock auto-clears this
    // flag after the failed call so the retry below succeeds.
    state.submitFailWith = 500;
    return state;
  },
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

    // First submit attempt — primed to fail with 500.
    const submitCta = d.page.getByTestId("mini-submit-cta");
    await expect(submitCta).toBeEnabled();
    await submitCta.click();

    // Error UI: the workspace surfaces failures via the global
    // toaster. Pinning the title text ("Submit failed") avoids
    // coupling to the toast component's internal markup.
    await expect(d.page.getByText("Submit failed")).toBeVisible({
      timeout: 10_000,
    });

    // Group did NOT flip — the inline workspace is still on the
    // ready-to-submit hero with the pre-submit phase, and the
    // server-side ledger never recorded a successful portal_submit.
    await d.expectStage("ready");
    await d.expectPhase("triage");
    expect(d.state.phase).toBe("triage");
    expect(
      d.state.callOrder.filter((l) => l === "portal_submit").length,
    ).toBe(0);
    expect(d.state.callOrder).toContain("portal_submit_fail_500");

    // Retry: the CTA re-enables once the mutation settles. The mock
    // already cleared `submitFailWith`, so this attempt lands on the
    // success branch and the group flips to `submitted`.
    await expect(submitCta).toBeEnabled({ timeout: 10_000 });
    await d.submit();
    await d.expectStage("submitted");
    await d.expectPhase("submitted");
  },
  // Pin the order: both legs walked, preview generated, draft
  // reviewed, the failed submit, then the successful retry.
  expectedCallOrder: [
    `sop_advance_${LEG_A_ID}`,
    `sop_advance_${LEG_B_ID}`,
    "stamp_preview",
    "mark_reviewed",
    "portal_submit_fail_500",
    "portal_submit",
  ],
  assert: (state) => {
    // Exactly one failed attempt and exactly one successful retry —
    // no double-submit, no half-submitted state.
    expect(
      state.callOrder.filter((l) => l === "portal_submit_fail_500").length,
    ).toBe(1);
    expect(
      state.callOrder.filter((l) => l === "portal_submit").length,
    ).toBe(1);

    // Final state is the same as the happy path: phase submitted,
    // both legs landed on the include terminal.
    expect(state.phase).toBe("submitted");
    expect(state.legs.get(LEG_A_ID)?.sopOutcome).toBe("portal_dispute");
    expect(state.legs.get(LEG_B_ID)?.sopOutcome).toBe("portal_dispute");

    // Submit body still carries the canonical group id on retry.
    expect(state.portalSubmissionBody).toMatchObject({
      invoiceGroupId: GROUP_ID,
    });
  },
};

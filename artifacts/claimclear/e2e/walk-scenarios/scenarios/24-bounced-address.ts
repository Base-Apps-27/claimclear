// Scenario #24 — bounced payor address blocks the submit.
//
// Two-leg invoice walked all the way to Review-ready. The payor's
// email has a hard-bounce on record, so the bounce-warning banner
// must render on the claim and the Submit CTA must be gated with
// the bounce reason surfaced as the disabled-state explanation.
// Pinned by Task #607; the bounce-detection mechanism that flips
// the flag belongs to Task #50 and is out of scope here.

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 78924;
const LEG_A_ID = 24001;
const LEG_B_ID = 24002;

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

const BOUNCED_EMAIL = "ap@payor.test";
const BOUNCE_REASON =
  "550 5.1.1 The email account that you tried to reach does not exist";

export const bouncedAddress: WalkScenario = {
  name: "bounced payor address · submit gated, banner + reason surfaced",
  description:
    "Two viable legs walked to Review-ready, but the payor email has a hard-bounce on record — the bounce banner renders, the submit CTA is disabled, and the reason is surfaced.",
  seed: () =>
    buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-024",
      payorEmailBounceState: {
        kind: "hard_bounced",
        email: BOUNCED_EMAIL,
        reason: BOUNCE_REASON,
        bouncedAt: "2026-04-10T12:00:00.000Z",
      },
      legs: [
        {
          id: LEG_A_ID,
          confNumber: "CLM-24A",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
        {
          id: LEG_B_ID,
          confNumber: "CLM-24B",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
      ],
    }),
  run: async (d) => {
    await d.openClaim();

    // Banner is on the claim from the very first render — it doesn't
    // wait for the operator to walk anything.
    const banner = d.page.getByTestId("mini-payor-bounce-banner");
    await expect(banner).toBeVisible();
    await expect(d.page.getByTestId("mini-payor-bounce-email")).toHaveText(
      BOUNCED_EMAIL,
    );
    await expect(d.page.getByTestId("mini-payor-bounce-reason")).toHaveText(
      BOUNCE_REASON,
    );

    // Walk both legs and progress through preview + review so the
    // ONLY remaining gate is the bounce. This proves the bounce
    // check isn't piggybacking on the readback / step gates.
    await d.markLegViable(LEG_A_ID);
    await d.markLegViable(LEG_B_ID);
    await d.expectStage("generate");
    await d.generatePreview();
    await d.expectStage("review");
    await d.markReviewed();
    // Hero lands on `ready` even with the bounce — the bounce gates
    // the submit button, not the lifecycle stage.
    await d.expectStage("ready");

    // Submit must be disabled and the disabled-reason copy must
    // mention the bounce so the operator understands why.
    const submitCta = d.page.getByTestId("mini-submit-cta");
    await expect(submitCta).toBeDisabled();
    const reason = d.page.getByTestId("mini-submit-disabled-reason");
    await expect(reason).toBeVisible();
    await expect(reason).toContainText(/hard-bounced/i);
    await expect(reason).toContainText(BOUNCED_EMAIL);
  },
  assert: (state) => {
    // Submit was never POSTed — the click never fired because the
    // CTA was disabled, so the call ledger has no portal_submit.
    expect(state.callOrder).not.toContain("portal_submit");
    expect(state.portalSubmissionBody).toBeNull();
    expect(state.phase).toBe("triage");
    // Walk + preview + review still recorded — the only gate is the
    // bounce, not anything earlier in the flow.
    expect(state.previewGeneratedAt).not.toBeNull();
    expect(state.draftReviewedAt).not.toBeNull();
  },
};

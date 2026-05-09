// Scenario #20 — service token expired mid-submit.
//
// Walks one viable leg to Review-ready, then fires Submit against a
// portal-submissions endpoint that returns 401 with the canonical
// service-token marker `{ code: "token_expired" }`. The UI must
// distinguish that from a generic submit failure and surface a
// dedicated re-auth CTA, and the group must NOT advance past Review
// (no phase flip, no destructive cache invalidation).
//
// Pins the user-visible behavior referenced by Task #57 (token
// reload without restart) without exercising the actual reload
// mechanism — that's intentionally out of scope here.

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 80020;
const LEG_ID = 2020;

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

export const tokenExpired: WalkScenario = {
  name: "scenario-20-token-expired",
  description:
    "Submit returns 401 token_expired; UI shows re-auth CTA and the group stays in Review.",
  seed: () =>
    buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-020",
      legs: [
        {
          id: LEG_ID,
          confNumber: "CLM-X",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
      ],
      submitFailure: { status: 401, code: "token_expired" },
    }),
  run: async (d) => {
    await d.openClaim();
    await d.markLegViable(LEG_ID);
    await d.generatePreview();
    await d.markReviewed();
    await d.expectStage("ready");

    // Fire Submit. The mock returns 401 + token_expired, so the
    // generic toast must NOT appear and the dedicated re-auth CTA
    // must render in the footer.
    await d.page.getByTestId("mini-submit-cta").click();
    await expect(d.page.getByTestId("mini-reauth-banner")).toBeVisible();
    await expect(d.page.getByTestId("mini-reauth-cta")).toBeVisible();

    // Group did not advance — still on the ready hero, still in
    // pre-submit phase. The reviewed-draft state is preserved so the
    // operator can retry once the service token is refreshed.
    await d.expectStage("ready");
  },
  expectedCallOrder: [
    `sop_advance_${LEG_ID}`,
    "stamp_preview",
    "mark_reviewed",
    "portal_submit_failed_401_token_expired",
  ],
  assert: (state) => {
    // Phase did NOT flip to submitted. The reviewed-draft stamps
    // remain so the operator can re-auth and retry.
    expect(state.phase).not.toBe("submitted");
    expect(state.previewGeneratedAt).not.toBeNull();
    expect(state.draftReviewedAt).not.toBeNull();
  },
};

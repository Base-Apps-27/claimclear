// Scenario #16 — edit narrative in Review, navigate away, come back.
//
// Pre-prepared invoice: both legs already walked to viable, preview
// already generated, draft NOT yet reviewed. The operator opens the
// detail page (which mounts the dispute-submission gauntlet), edits
// the dispute write-up textarea, saves the draft, navigates back to
// the queue list, then returns to the detail page.
//
// Pins:
//   1. The edit fires the POST /draft route (callOrder includes
//      "save_draft").
//   2. On return, the textarea hydrates from the persisted draft —
//      i.e. the operator sees their edited text, NOT the original
//      AI baseline that was there before.
//
// Hard-reload persistence and multi-user conflict are out of scope
// (see task #603); both could be follow-up scenarios.
//
// Mock convention: the harness exposes draft + AI-baseline fields on
// the group detail and a POST /api/invoice-groups/:id/draft handler
// that writes back into `WalkMockState`. See `mock-builder.ts`.

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 78903;
const LEG_A_ID = 3001;
const LEG_B_ID = 3002;

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

const AI_BASELINE_SUBJECT = "Dispute: INV-WALK-016";
const AI_BASELINE_BODY =
  "AI-generated baseline narrative. Original copy that the operator " +
  "should overwrite during the Review phase.";
const EDITED_BODY =
  "OPERATOR EDIT — replaced the baseline with a hand-written " +
  "narrative explaining why these two legs are eligible.";

export const narrativeEditPersist: WalkScenario = {
  name: "scenario-16-narrative-edit-persist",
  description:
    "Pre-prepared Review: both legs viable + preview stamped. Operator " +
    "edits the dispute write-up on the detail page, navigates to the " +
    "queue list, returns, and the textarea must show the edit (not the " +
    "AI baseline).",
  seed: () => {
    const state = buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-016",
      legs: [
        {
          id: LEG_A_ID,
          confNumber: "CLM-A16",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
        {
          id: LEG_B_ID,
          confNumber: "CLM-B16",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
      ],
      previewGeneratedAt: "2026-04-15T13:00:00.000Z",
      aiBaselineSubject: AI_BASELINE_SUBJECT,
      aiBaselineDescriptionHtml: AI_BASELINE_BODY,
    });
    // Pre-stamp both legs as viable so the gauntlet's outlook resolves
    // to `has_disputable` and the draft-review step renders on first
    // load — no SOP walk needed for this scenario.
    for (const leg of state.legs.values()) {
      leg.sopOutcome = "portal_dispute";
      leg.dropReason = null;
    }
    return state;
  },
  run: async (d) => {
    // Land directly on the canonical detail page where the gauntlet
    // textarea lives. The mini ReviewHero on /queue only exposes
    // "Mark reviewed" and "Regenerate preview"; the actual editable
    // narrative is on /invoice-groups/:id, so this scenario asserts
    // the persistence contract on that surface and skips the queue
    // workspace path covered by scenarios 01/02.
    await d.page.goto(`/invoice-groups/${GROUP_ID}`);

    const body = d.page.getByTestId("draft-body-input");
    await expect(body).toBeVisible({ timeout: 15_000 });
    // Sanity: the AI baseline is what's there before the edit.
    await expect(body).toHaveValue(AI_BASELINE_BODY);

    // Replace the baseline and persist via the Save draft button.
    await body.fill(EDITED_BODY);
    await d.page.getByTestId("draft-save").click();
    // Save success → the dirty hint is gone (button re-disables).
    await expect(d.page.getByTestId("draft-dirty-hint")).toHaveCount(0);

    // Navigate away to the queue list, then back to the detail page.
    await d.page.goto("/queue");
    await expect(
      d.page.locator("body"),
      "queue list page should render",
    ).toBeVisible();
    await d.page.goto(`/invoice-groups/${GROUP_ID}`);

    const bodyAgain = d.page.getByTestId("draft-body-input");
    await expect(bodyAgain).toBeVisible({ timeout: 15_000 });
    // The edit must survive the round-trip — the textarea hydrates
    // from the persisted draftDescriptionHtml, not the baseline.
    await expect(bodyAgain).toHaveValue(EDITED_BODY);
  },
  // The save_draft POST must have fired at least once during the
  // edit step. Anything between the open and the re-visit (re-fetches,
  // presence pings, etc.) is fine — this is a subsequence assertion.
  expectedCallOrder: ["save_draft"],
  assert: (state) => {
    // Persisted draft body matches what the operator typed.
    expect(state.draftDescriptionHtml).toBe(EDITED_BODY);
    // Subject was untouched in this scenario, so the persisted
    // subject mirrors the AI baseline that the gauntlet sent back.
    expect(state.draftSubject).toBe(AI_BASELINE_SUBJECT);
    // Exactly one save_draft call — no double-save / debounce churn.
    expect(
      state.callOrder.filter((l) => l === "save_draft").length,
    ).toBe(1);
  },
};

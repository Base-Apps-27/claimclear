// Scenario #3 — no legs viable → operator-driven close-out.
//
// Pins the "we walked it, nothing to dispute" lane: every leg lands on
// a Cannot-Dispute terminal via the SOP player, the Phase 2 generate-
// preview CTA stays absent (the dispute lane is gated on at least one
// disputable leg), the operator falls back to the structured Withdraw
// — Cannot Dispute closure on the detail-page rail, and the group
// drops out of the live queue once the closure PATCH lands.
//
// Out of scope: the all-Non-Issue close-out path (separate scenario
// #9). Both lanes share the same nothing_to_do outlook but emit a
// different closureReason / outcome combo, so they get their own pin.

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 78903;
const LEG_A_ID = 3001;
const LEG_B_ID = 3002;

// One-question tree where "Cannot dispute" is the terminal answer the
// mock keys off (see OUTCOME_BY_ANSWER in mock-builder.ts) to stamp
// sopOutcome=cannot_dispute and dropReason=cannot_dispute on the leg.
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

// Long-enough narrative to satisfy the closure dialog's NARRATIVE_MIN
// (currently 150 chars — we pad with deterministic copy so the
// scenario doesn't randomly tip over the gate if the minimum changes
// by a few characters).
const NARRATIVE =
  "Both legs were walked through the eligibility SOP and landed on " +
  "Cannot-Dispute terminals. There is no path to recover either claim, " +
  "so we are withdrawing the group instead of submitting an appeal.";

export const noLegsViableClose: WalkScenario = {
  name: "no legs viable · close as Cannot-Dispute",
  description:
    "Two-leg invoice, both legs walked to Cannot-Dispute, no preview/submit lane appears, operator closes via Withdraw — Cannot Dispute on the detail rail, group drops from the queue.",
  seed: () =>
    buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-003",
      legs: [
        {
          id: LEG_A_ID,
          confNumber: "CLM-A",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
        {
          id: LEG_B_ID,
          confNumber: "CLM-B",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
      ],
    }),
  run: async (d) => {
    const { page } = d;

    await d.openClaim();
    await d.expectPhase("triage");

    // Walk both legs to a Cannot-Dispute terminal. The mock stamps
    // sopOutcome=cannot_dispute, which makes deriveInvoiceDisputeOutlook
    // return "nothing_to_do" — the workspace settles on the resolved
    // hero and the Phase 2 dispute lane never opens.
    await d.markLegNonIssue(LEG_A_ID, "Cannot dispute");
    await d.markLegNonIssue(LEG_B_ID, "Cannot dispute");

    // Assertion #1: Phase 2 generate-preview CTA never materialises.
    // The mini workspace gates this button on outlook==="has_disputable",
    // so a regression that wires it up for the nothing-to-do lane would
    // trip this expectation immediately.
    await expect(page.getByTestId("mini-generate-preview")).toHaveCount(0);
    await expect(page.getByTestId("mini-submit-cta")).toHaveCount(0);

    // The detail-page rail is the canonical close-out surface for this
    // lane; navigate there to assert the closure CTA appears and to
    // run the structured intake.
    await page.goto(`/invoice-groups/${d.state.groupId}`);

    // Assertion #2: closure CTA is present on the rail.
    const closeCta = page.getByTestId("v2-group-close-cannot-dispute");
    await expect(closeCta).toBeVisible({ timeout: 10_000 });
    await closeCta.click();

    // Fill the structured closure intake. Field IDs match the testids
    // wired in closure-intake-dialog.tsx; we deliberately pick a tag
    // (it_system) that does NOT require a per-person sub-form.
    const dialog = page.getByTestId("closure-intake-dialog");
    await expect(dialog).toBeVisible();

    await page.getByTestId("closure-category-select").click();
    await page.getByRole("option", { name: "Duplicate claim" }).click();

    await page.getByTestId("closure-root-cause-select").click();
    await page.getByRole("option", { name: "Duplicate within batch" }).click();

    await page.getByTestId("closure-narrative").fill(NARRATIVE);
    await page.getByTestId("closure-tag-it_system").click();

    const submit = page.getByTestId("closure-submit-button");
    await expect(submit).toBeEnabled();
    await submit.click();

    // Assertion #4 setup — once the PATCH resolves, the group flips to
    // phase=closed and the queue list filter drops it. Re-navigate to
    // the queue and assert the workspace no longer mounts for this
    // group id (the queue page renders an empty state instead).
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await page.goto(`/queue?group=${d.state.groupId}`);
    await expect(page.getByTestId("inline-group-workspace-mini")).toHaveCount(
      0,
      { timeout: 10_000 },
    );
  },
  // Both legs walk → group_close. No stamp_preview / mark_reviewed /
  // portal_submit — the dispute lane never runs in this scenario, so
  // pinning their *absence* in the assert block below is the
  // ordering invariant we care about.
  expectedCallOrder: [
    `sop_advance_${LEG_A_ID}`,
    `sop_advance_${LEG_B_ID}`,
    "group_close",
  ],
  assert: (state) => {
    // Both legs landed on the cannot-dispute terminal.
    expect(state.legs.get(LEG_A_ID)?.sopOutcome).toBe("cannot_dispute");
    expect(state.legs.get(LEG_B_ID)?.sopOutcome).toBe("cannot_dispute");
    // Dispute lane never ran.
    expect(state.previewGeneratedAt).toBeNull();
    expect(state.draftReviewedAt).toBeNull();
    expect(state.callOrder).not.toContain("stamp_preview");
    expect(state.callOrder).not.toContain("mark_reviewed");
    expect(state.callOrder).not.toContain("portal_submit");
    // Closure PATCH carried the cannot_dispute → Withdrawn mapping
    // produced by the dialog's exhaustive switch.
    expect(state.phase).toBe("closed");
    expect(state.outcome).toBe("Withdrawn");
    expect(state.closureReason).toBe("cannot_dispute");
    expect(state.lastClosureBody).toMatchObject({
      outcome: "Withdrawn",
      closureReason: "cannot_dispute",
      closureCategory: "duplicate_claim",
    });
  },
};

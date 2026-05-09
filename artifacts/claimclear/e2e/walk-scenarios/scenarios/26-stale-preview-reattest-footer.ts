// Scenario #26 — stale preview + reattest_only outlook → default footer.
//
// Edge case the PinnedFooter refactor (Task #633 follow-up) has to
// keep working: the operator generated the preview while the invoice
// still had a disputable leg, then the leg state changed (e.g. a
// rewalked leg flipped to non_issue) and the outlook collapsed to
// `reattest_only`. `previewGeneratedAt` is still set, so the hero
// derivation in `inline-group-workspace-mini.tsx` lands on `review`
// (the `previewGenerated && !forceWalk` branch wins before the
// `allWalked && outlook === "reattest_only"` branch is even
// considered). PinnedFooter must therefore render the *default*
// footer — phase pill + helper copy + Hold-invoice — and must NOT
// surface the review-step "Mark reviewed" CTA or the ready-step
// "Queue for Portal" CTA, both of which are gated on
// `outlook === "has_disputable"`.
//
// Pinned invariants:
//   - data-hero="review", data-outlook="reattest_only" on first paint.
//   - The default-footer phase pill is present (label "Ready to
//     re-attest", tone blue — proves the reattest branch of
//     buildMiniPhase is in play, not the has_disputable branch).
//   - The review-footer "Mark reviewed" CTA is absent.
//   - The ready-footer / default-footer "Submit" CTA is absent (no
//     `mini-submit-cta` testid renders for non-has_disputable
//     outlooks).
//   - No commit-affecting POSTs fire (the mock's callOrder ledger
//     stays empty of stamp_preview / mark_reviewed / portal_submit /
//     bulk_queue_reattest — this scenario only asserts render
//     posture, it does not drive the reattest flow itself).

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 80426;
const SURVIVOR_LEG_ID = 26001;
const DROPPED_LEG_ID = 26002;

// Tree shape is irrelevant for this scenario — both legs are
// pre-stamped with terminal sopOutcomes in `seed`, so the SOP player
// never mounts. The tree still has to be present because
// `buildMockState` indexes it under `errorTypeId` for the
// `/api/error-types` stub.
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

export const stalePreviewReattestFooter: WalkScenario = {
  name: "scenario-26-stale-preview-reattest-footer · review hero + reattest_only outlook → default footer",
  description:
    "Preview was stamped while the group was disputable; a downstream leg flip drops the outlook to reattest_only. Hero stays on review (previewGenerated wins), but the PinnedFooter must fall back to the default footer (phase pill, no Mark reviewed / Queue for Portal).",
  seed: () => {
    const state = buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-026",
      legs: [
        {
          id: SURVIVOR_LEG_ID,
          confNumber: "CLM-SURVIVOR",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
        {
          id: DROPPED_LEG_ID,
          confNumber: "CLM-DROPPED",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
      ],
      // Pre-stamped preview — this is the whole point of the
      // scenario. Without it, hero would resolve to `reattest`
      // (the allWalked + reattest_only branch) and the default
      // footer would render trivially.
      previewGeneratedAt: "2026-04-15T13:00:00.000Z",
    });
    // Survivor: non_issue terminal → counts as a survivor in
    // `deriveInvoiceDisputeOutlook`, which keeps the outlook on
    // `reattest_only` rather than collapsing to `nothing_to_do`.
    const survivor = state.legs.get(SURVIVOR_LEG_ID)!;
    survivor.sopOutcome = "non_issue";
    survivor.dropReason = "non_issue";
    // Dropped: cannot_dispute terminal → not a survivor, not
    // disputable. Together with the non_issue leg this gives us a
    // mixed shape that pins the reattest_only branch (vs the all-
    // cannot_dispute shape pinned by scenario #27).
    const dropped = state.legs.get(DROPPED_LEG_ID)!;
    dropped.sopOutcome = "cannot_dispute";
    dropped.dropReason = "cannot_dispute";
    return state;
  },
  run: async (d) => {
    const { page } = d;
    await d.openClaim();

    const workspace = page.getByTestId("inline-group-workspace-mini");
    // The previewGenerated branch in the hero derivation wins before
    // the allWalked + reattest_only branch is even checked.
    await expect(workspace).toHaveAttribute("data-hero", "review");
    await expect(workspace).toHaveAttribute("data-outlook", "reattest_only");

    // Default footer renders (it's the only footer that exposes the
    // phase pill — the review and ready footers use their own
    // status pills).
    await expect(page.getByTestId("mini-pinned-footer")).toBeVisible();
    const pill = page.getByTestId("mini-phase-pill");
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText(/Ready to re-attest/i);

    // Neither the review-footer Mark reviewed CTA nor the ready /
    // default-footer Submit CTA may render — both are gated on
    // outlook === "has_disputable".
    await expect(page.getByTestId("mini-mark-reviewed")).toHaveCount(0);
    await expect(page.getByTestId("mini-submit-cta")).toHaveCount(0);
  },
  assert: (state) => {
    // Pre-stamped leg shapes survived the round trip.
    expect(state.legs.get(SURVIVOR_LEG_ID)?.sopOutcome).toBe("non_issue");
    expect(state.legs.get(DROPPED_LEG_ID)?.sopOutcome).toBe("cannot_dispute");
    // This scenario asserts render posture only — no commit-
    // affecting POSTs should have fired.
    expect(state.callOrder).not.toContain("stamp_preview");
    expect(state.callOrder).not.toContain("mark_reviewed");
    expect(state.callOrder).not.toContain("portal_submit");
    expect(state.callOrder).not.toContain("bulk_queue_reattest");
  },
};

// WalkDriver — the high-level verbs scenarios call to drive the
// Queue page workspace. Every selector here is an existing
// `data-testid` on a production component — the harness is
// deliberately read-only against `src/`.

import { expect, type Page } from "@playwright/test";
import type {
  InvoicePhase,
  WalkDriverApi,
  WalkMockState,
  WalkStage,
} from "./types";

export function buildDriver(page: Page, state: WalkMockState): WalkDriverApi {
  const workspace = () => page.getByTestId("inline-group-workspace-mini");

  async function openClaim(): Promise<void> {
    await page.goto(`/queue?group=${state.groupId}`);
    await expect(workspace()).toBeVisible({ timeout: 15_000 });
  }

  async function selectLeg(legId: number): Promise<void> {
    const tab = page.getByTestId(`mini-leg-tab-${legId}`);
    if (await tab.count()) {
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
    }
  }

  async function startWalk(): Promise<void> {
    const cta = page.getByTestId("mini-start-walk");
    if (await cta.count()) {
      await cta.click();
    }
    // Wait for the player to mount — either the question card or the
    // include-ready card if the leg is already terminal.
    await expect(page.getByTestId("sop-advance-player")).toBeVisible();
  }

  async function clickSopOption(label: string): Promise<void> {
    const buttons = page.locator('[data-testid^="sop-option-"]');
    const matching = buttons.filter({ hasText: label });
    await expect(matching.first()).toBeVisible();
    await matching.first().click();
  }

  async function markLegViable(legId: number, optionLabel = "Viable"): Promise<void> {
    await selectLeg(legId);
    // The hero may be `sop` (start-walk landing) or already showing
    // the question card; `startWalk` handles both.
    if (await page.getByTestId("mini-start-walk").count()) {
      await page.getByTestId("mini-start-walk").click();
    }
    await expect(page.getByTestId("sop-advance-player")).toBeVisible();
    await clickSopOption(optionLabel);
    await expect(page.getByTestId("sop-include-ready-card")).toBeVisible();
  }

  async function markLegNonIssue(
    legId: number,
    optionLabel = "Non-issue",
  ): Promise<void> {
    await selectLeg(legId);
    if (await page.getByTestId("mini-start-walk").count()) {
      await page.getByTestId("mini-start-walk").click();
    }
    await expect(page.getByTestId("sop-advance-player")).toBeVisible();
    await clickSopOption(optionLabel);
    // Closed terminal — the live player swaps in ClosedTerminalRewindCard.
    // Easiest cross-cut signal is the workspace `data-hero` flipping
    // off `sop`: it lands on `resolved` (or `generate` if all legs
    // walked).
    await expect(workspace()).not.toHaveAttribute("data-hero", "sop");
  }

  async function placeLegHold(
    legId: number,
    opts: { reason?: string; note?: string } = {},
  ): Promise<void> {
    await selectLeg(legId);
    await page.getByTestId("mini-place-leg-hold").click();
    // HoldReasonSelect exposes a stable trigger testid plus one
    // `hold-reason-{slug}` testid per `LegHoldReason` enum value
    // (evidence_pending | awaiting_external_party |
    // awaiting_member_response | awaiting_internal_review | other).
    // Default to `evidence_pending` so a scenario that just wants
    // "any valid reason" doesn't have to know the vocabulary.
    const reason = opts.reason ?? "evidence_pending";
    await page.getByTestId("hold-reason-select").click();
    await page.getByTestId(`hold-reason-${reason}`).click();
    // `other` requires a note; any explicit note also takes effect.
    if (opts.note || reason === "other") {
      await page
        .getByTestId("hold-note-input")
        .fill(opts.note ?? "harness-supplied note");
    }
    await page.getByTestId("mini-leg-hold-submit").click();
    await expect(page.getByTestId("mini-release-leg-hold")).toBeVisible();
  }

  async function releaseLegHold(legId: number): Promise<void> {
    await selectLeg(legId);
    await page.getByTestId("mini-release-leg-hold").click();
    await expect(page.getByTestId("mini-place-leg-hold")).toBeVisible();
  }

  async function generatePreview(): Promise<void> {
    const cta = page.getByTestId("mini-generate-preview");
    await expect(cta).toBeEnabled();
    await cta.click();
    // Hero swaps to `review` once `previewGeneratedAt` is on the
    // freshly-fetched group.
    await expect(page.getByTestId("mini-mark-reviewed")).toBeVisible();
  }

  async function markReviewed(): Promise<void> {
    const cta = page.getByTestId("mini-mark-reviewed");
    await expect(cta).toBeEnabled();
    await cta.click();
    // Hero swaps to `ready` and the footer Submit becomes enabled.
    await expect(page.getByTestId("mini-submit-cta")).toBeEnabled();
  }

  async function submit(): Promise<void> {
    const cta = page.getByTestId("mini-submit-cta");
    await expect(cta).toBeEnabled();
    await cta.click();
    // Submit success → group fetch returns `phase: 'submitted'` →
    // hero swaps to `submitted`.
    await expect(workspace()).toHaveAttribute("data-hero", "submitted", {
      timeout: 10_000,
    });
  }

  async function queueReattest(): Promise<void> {
    // Direct POST — no Reattest CTA exists on the Queue page workspace
    // (it lives on the invoice-detail `InvoiceGroupActionSlot`). Fire
    // from the page context so the request goes through the same
    // intercepted route handler the production client would hit.
    const url = `/api/invoice-groups/${state.groupId}/reattest/queue`;
    const status = await page.evaluate(async (u) => {
      const r = await fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      return r.status;
    }, url);
    if (status !== 200) {
      throw new Error(`queueReattest expected 200, got ${status}`);
    }
  }

  async function expectPhase(phase: InvoicePhase): Promise<void> {
    await expect(workspace()).toHaveAttribute("data-phase", phase);
  }

  async function expectStage(stage: WalkStage): Promise<void> {
    await expect(workspace()).toHaveAttribute("data-hero", stage);
  }

  return {
    page,
    state,
    openClaim,
    selectLeg,
    startWalk,
    markLegViable,
    markLegNonIssue,
    placeLegHold,
    releaseLegHold,
    generatePreview,
    markReviewed,
    submit,
    queueReattest,
    expectPhase,
    expectStage,
  };
}

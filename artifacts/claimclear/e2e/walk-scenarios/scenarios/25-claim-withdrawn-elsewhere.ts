// Scenario #25 — claim withdrawn elsewhere mid-walk.
//
// Pins the "someone else closed the group while User A was walking"
// gate: the operator drives the dispute lane all the way to ready-
// to-submit, then an external process (User B on a different page,
// or a backend job — the exact actor doesn't matter) flips the
// group to `closed` via the outcome PATCH. On the next refetch,
// User A's workspace MUST:
//   • show the "claim withdrawn" banner (mini-withdrawn-banner),
//   • drop the submit CTA so a withdrawn group can never be
//     accidentally submitted to the portal,
//   • drop the per-leg ChipStrip / walk affordances so the only
//     forward path is to navigate away (queue / full details).
//
// Out of scope (per task): the withdraw flow itself — we trigger
// the closure directly through the same PATCH endpoint the real UI
// would have called from a different surface, and just observe how
// the in-flight walk reacts.

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState } from "../mock-builder";
import type { WalkScenario, WalkMockState } from "../types";

const GROUP_ID = 78925;
const LEG_A_ID = 25001;
const LEG_B_ID = 25002;

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

// Long-enough narrative so the closure handler accepts the body
// shape the real intake dialog would send (the mock doesn't enforce
// it, but keeping the request body realistic future-proofs the test
// against a tighter mock).
const NARRATIVE =
  "Closed elsewhere while User A was walking — duplicate of an " +
  "already-disputed sibling claim, so we are withdrawing the group " +
  "rather than letting the parallel walk submit a stale draft.";

// Fire the same PATCH the structured closure intake would send,
// but from outside User A's tab — i.e. simulating User B (or a
// bot) closing the group from a different surface. The mock's
// outcome handler flips state.phase to "closed", which is what
// User A's next group GET will pick up.
async function externalWithdraw(state: WalkMockState, page: import("@playwright/test").Page) {
  const body = {
    outcome: "Withdrawn",
    closureReason: "cannot_dispute",
    closureCategory: "duplicate_claim",
    closureNarrative: NARRATIVE,
  };
  // Drive through `page.evaluate` so the request hits the same
  // intercepted route handler the real client would fire — keeps
  // the call ledger honest (group_close shows up in state.callOrder).
  const status = await page.evaluate(
    async ({ url, body }) => {
      const r = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return r.status;
    },
    { url: `/api/invoice-groups/${state.groupId}/outcome`, body },
  );
  if (status !== 200) {
    throw new Error(`externalWithdraw expected 200, got ${status}`);
  }
}

export const claimWithdrawnElsewhere: WalkScenario = {
  name: "scenario-25 · claim withdrawn elsewhere mid-walk",
  description:
    "Operator drives a 2-leg invoice to ready-to-submit; an external withdraw event lands on the group; the workspace surfaces a 'claim withdrawn' banner, hides the submit CTA, and removes walk affordances.",
  seed: () =>
    buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-025",
      legs: [
        {
          id: LEG_A_ID,
          confNumber: "CLM-25A",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
        {
          id: LEG_B_ID,
          confNumber: "CLM-25B",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
      ],
    }),
  run: async (d) => {
    const { page, state } = d;

    // 1. Drive the walk all the way to ready-to-submit. Submit is
    //    enabled at this point — pinning that pre-condition is what
    //    makes the post-withdraw assertions meaningful (we proved
    //    the gate would have been open absent the withdrawal).
    await d.openClaim();
    await d.expectPhase("triage");
    await d.markLegViable(LEG_A_ID);
    await d.markLegViable(LEG_B_ID);
    await d.expectStage("generate");
    await d.generatePreview();
    await d.expectStage("review");
    await d.markReviewed();
    await d.expectStage("ready");
    await expect(page.getByTestId("mini-submit-cta")).toBeEnabled();

    // 2. External withdraw lands. The mock flips state.phase to
    //    "closed" via the same outcome PATCH the real intake would
    //    have fired from a different surface.
    await externalWithdraw(state, page);

    // 3. Force the workspace to refetch. The production app sees
    //    the closure via the SSE stream (`useInvoiceGroupEvents`)
    //    that the harness intentionally aborts to stay hermetic.
    //    The deterministic equivalent is to invalidate the cached
    //    `useGetInvoiceGroup` query through the QueryClient that
    //    `src/App.tsx` exposes on `window.__ccQueryClient` for this
    //    exact purpose. The workspace stays mounted (the URL is
    //    untouched), refetches, and re-renders against the now-
    //    `phase: "closed"` detail.
    //
    //    `page.reload()` and a `?group=` toggle were both tried
    //    first; both lose the workspace because the queue list
    //    filter drops the closed group on remount and the page-
    //    level wiring then unmounts the panel before the closed
    //    detail can paint. Cache invalidation keeps the existing
    //    React tree in place, which is exactly the in-flight walk
    //    posture this scenario is meant to pin.
    await page.evaluate(() => {
      const qc = (
        window as unknown as {
          __ccQueryClient?: { invalidateQueries: (opts: unknown) => unknown };
        }
      ).__ccQueryClient;
      if (!qc) throw new Error("__ccQueryClient not exposed on window");
      return qc.invalidateQueries({ refetchType: "active" });
    });

    // 4. Banner appears, walk is gated.
    await expect(page.getByTestId("mini-withdrawn-banner")).toBeVisible({
      timeout: 10_000,
    });
    await d.expectStage("withdrawn");
    await d.expectPhase("closed");

    // Submit CTA is gone (outlook gate is short-circuited because
    // submitted=true once phase==="closed"). Belt-and-braces: assert
    // by both id and absence-of-clickable count to catch a regression
    // that re-renders it disabled instead of removing it.
    await expect(page.getByTestId("mini-submit-cta")).toHaveCount(0);

    // Per-leg walk affordances must be gone — chip strip is the
    // umbrella container; if it's absent, every chip + the leg-
    // hold button it owns is absent too.
    await expect(page.getByTestId("mini-chip-strip")).toHaveCount(0);
    await expect(page.getByTestId("mini-place-leg-hold")).toHaveCount(0);
    await expect(page.getByTestId("mini-place-group-hold")).toHaveCount(0);

    // Navigating away is the only forward path. Simulate the
    // operator clicking the workspace's Close affordance (which
    // clears `?group=` via `setSelectedWorkflowId(null)`); after
    // that the workspace unmounts and the queue list — under the
    // closed-group filter — collapses to inbox-zero (no row for
    // the just-closed group). A regression that re-includes the
    // group on the live queue would trip this `queue-inbox-zero`
    // expectation, mirroring scenario #3.
    await page.getByTestId("close-inline-workspace").click();
    await expect(page.getByTestId("inline-group-workspace-mini")).toHaveCount(
      0,
      { timeout: 10_000 },
    );
    await expect(page.getByTestId("queue-inbox-zero")).toBeVisible();
  },
  // Subsequence — the dispute lane ran in full before group_close
  // landed. Pinning this guards against a refactor that lets the
  // late-arriving close PATCH race ahead of the operator's review
  // stamp (which would mean we'd been ignoring a withdrawal).
  expectedCallOrder: [
    `sop_advance_${LEG_A_ID}`,
    `sop_advance_${LEG_B_ID}`,
    "stamp_preview",
    "mark_reviewed",
    "group_close",
  ],
  assert: (state) => {
    expect(state.legs.get(LEG_A_ID)?.sopOutcome).toBe("portal_dispute");
    expect(state.legs.get(LEG_B_ID)?.sopOutcome).toBe("portal_dispute");
    expect(state.previewGeneratedAt).not.toBeNull();
    expect(state.draftReviewedAt).not.toBeNull();
    // Critically — the portal submission was NEVER fired. The
    // withdraw event short-circuited the submit CTA before User A
    // could click it. This is the whole point of the gate.
    expect(state.portalSubmissionBody).toBeNull();
    expect(state.callOrder).not.toContain("portal_submit");
    // Closure landed and the phase flipped.
    expect(state.phase).toBe("closed");
    expect(state.outcome).toBe("Withdrawn");
    expect(state.closureReason).toBe("cannot_dispute");
  },
};

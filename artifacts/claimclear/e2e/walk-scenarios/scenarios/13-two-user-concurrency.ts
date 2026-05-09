// Scenario #13 — two users on the same claim (concurrency).
//
// Folds the original Task #92 work into the unified harness: User A
// and User B open the same invoice group from independent
// `BrowserContext`s, with the shared `WalkMockState.presence` ledger
// acting as the source of truth for "who's currently viewing what".
//
// What this pins:
//   • The work-claim presence route fires from both contexts on
//     mount (heartbeat POST + GET), and both rows land in the
//     ledger keyed by their respective user emails.
//   • User B's HumanPresenceBanner surfaces User A by name as a
//     concurrent viewer ("…is also viewing this group").
//   • User A's banner symmetrically surfaces User B once both are
//     mounted on the page.
//
// What this DOES NOT pin (intentionally — see follow-up task "Add a
// real two-browser test that proves Queued badges and disabled
// buttons render for the second user"): the future "Queued by [User
// A]" badge and disabled submit/walk CTAs. The current production
// presence UX is informational only (see the comment in
// `presence-banners.tsx` — every control on the page is still live
// for both viewers), so this scenario captures the wire-level
// presence flow today and the badge/disabled assertions land once
// that UI ships.

import { expect } from "@playwright/test";
import type { DecisionTree } from "../../../src/components/decision-tree/types";
import { buildMockState, OPERATOR_USER, OPERATOR_USER_TWO } from "../mock-builder";
import type { WalkScenario } from "../types";

const GROUP_ID = 78913;
const LEG_A_ID = 11301;
const LEG_B_ID = 11302;

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

export const twoUserConcurrency: WalkScenario = {
  name: "scenario-13 · two-user concurrency · presence visible to both",
  description:
    "User A starts walking a 2-leg claim while User B opens the same group from a second BrowserContext; both should see each other in the presence banner.",
  seed: () =>
    buildMockState({
      groupId: GROUP_ID,
      invoiceNumber: "INV-WALK-013",
      legs: [
        {
          id: LEG_A_ID,
          confNumber: "CLM-13A",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
        {
          id: LEG_B_ID,
          confNumber: "CLM-13B",
          errorTypeId: "et_eligibility",
          errorTypeName: "Eligibility",
          tree: TREE,
        },
      ],
    }),
  concurrent: {
    userA: OPERATOR_USER,
    userB: OPERATOR_USER_TWO,
  },
  runConcurrent: async (a, b) => {
    // 1. User A opens the claim and begins walking it. The
    //    presence heartbeat for invoice_group:GROUP_ID fires as
    //    soon as the workspace mounts.
    await a.openClaim();
    await a.expectPhase("triage");
    await a.markLegViable(LEG_A_ID);

    // The shared ledger should show User A as a viewer of this
    // group — proves the heartbeat handler upserted the row before
    // User B even opened a tab.
    const bucket = a.state.presence.get(`invoice_group:${GROUP_ID}`);
    expect(bucket, "presence ledger should have a bucket for this group").toBeDefined();
    expect(bucket?.has(OPERATOR_USER.email.toLowerCase())).toBe(true);

    // 2. User B opens the SAME group from a fresh BrowserContext.
    //    Their initial presence GET should see User A in the
    //    ledger (server-side self-exclusion mirror returns
    //    everyone-but-me).
    await b.openClaim();
    await b.expectPhase("triage");

    // Both viewers are now in the shared ledger.
    const bucketAfterB = b.state.presence.get(`invoice_group:${GROUP_ID}`);
    expect(bucketAfterB?.has(OPERATOR_USER.email.toLowerCase())).toBe(true);
    expect(bucketAfterB?.has(OPERATOR_USER_TWO.email.toLowerCase())).toBe(true);

    // 3. User B's UI should reflect that User A is also looking at
    //    this group. The HumanPresenceBanner has no test id, so
    //    pin the user-facing copy directly — it's the same string
    //    a real operator would read on screen.
    await expect(
      b.page.getByText(
        new RegExp(`${OPERATOR_USER.displayName}.*is also viewing this group`, "i"),
      ),
    ).toBeVisible({ timeout: 15_000 });

    // 4. Symmetric check — User A's banner should now see User B
    //    too, once the next presence refetch lands. The hook
    //    polls every 10s; nudge it by re-navigating to the same
    //    group so the query refires immediately rather than
    //    waiting out the interval.
    await a.openClaim();
    await expect(
      a.page.getByText(
        new RegExp(`${OPERATOR_USER_TWO.displayName}.*is also viewing this group`, "i"),
      ),
    ).toBeVisible({ timeout: 15_000 });
  },
  // Subsequence assertion — both heartbeats must have fired against
  // the presence route for the right resource. Other unrelated
  // calls (group GETs, leg sop-advance, …) are allowed to interleave.
  expectedCallOrder: [
    `presence_heartbeat_invoice_group_${GROUP_ID}_${OPERATOR_USER.email.toLowerCase()}`,
    `presence_heartbeat_invoice_group_${GROUP_ID}_${OPERATOR_USER_TWO.email.toLowerCase()}`,
  ],
  assert: (state) => {
    // Final ledger snapshot must contain both viewers.
    const bucket = state.presence.get(`invoice_group:${GROUP_ID}`);
    expect(bucket).toBeDefined();
    expect(bucket?.size).toBeGreaterThanOrEqual(2);
    expect(bucket?.has(OPERATOR_USER.email.toLowerCase())).toBe(true);
    expect(bucket?.has(OPERATOR_USER_TWO.email.toLowerCase())).toBe(true);

    // Sanity: User A actually progressed the walk before B
    // arrived, so the call order has both a real walk action and
    // both presence heartbeats — proving the two contexts shared
    // one ledger.
    expect(state.callOrder).toContain(`sop_advance_${LEG_A_ID}`);
  },
};

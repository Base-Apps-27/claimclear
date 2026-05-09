/**
 * Queue walk smoke harness — Task #591.
 *
 * Shared Playwright e2e undercarriage for ClaimClear's Queue page
 * walk scenarios. Every `/api/*` request is stubbed via `page.route`
 * against an in-memory `WalkMockState` so the suite has zero
 * dependency on the API server, the database, or any seed data.
 *
 * Touches existing `data-testid` attributes only — there are NO
 * production code changes for this harness. If a scenario needs a
 * new affordance, add the testid in the relevant component and pin
 * it here.
 *
 * ────────────────────────────────────────────────────────────────
 * How to add a new scenario (≤30 lines)
 * ────────────────────────────────────────────────────────────────
 *
 * 1. Create `e2e/walk-scenarios/scenarios/<NN>-<slug>.ts`:
 *
 *    ```ts
 *    import { expect } from "@playwright/test";
 *    import { buildMockState } from "../mock-builder";
 *    import type { WalkScenario } from "../types";
 *
 *    const GROUP_ID = 80001;
 *    const LEG_ID = 2001;
 *    const TREE = { rootId: "n1", nodes: [{ id: "n1",
 *      question: "Is this leg disputable?",
 *      options: [{ label: "Viable" }, { label: "Non-issue" }],
 *    }] };
 *
 *    export const myScenario: WalkScenario = {
 *      name: "my new scenario",
 *      description: "What this pins.",
 *      seed: () => buildMockState({ groupId: GROUP_ID,
 *        invoiceNumber: "INV-MINE",
 *        legs: [{ id: LEG_ID, confNumber: "CLM-X",
 *          errorTypeId: "et_eligibility", errorTypeName: "Eligibility",
 *          tree: TREE }] }),
 *      run: async (d) => {
 *        await d.openClaim();
 *        await d.markLegViable(LEG_ID);
 *        await d.generatePreview();
 *        await d.markReviewed();
 *        await d.submit();
 *      },
 *      assert: (state) => expect(state.phase).toBe("submitted"),
 *    };
 *    ```
 *
 * 2. Register it in `SCENARIOS` below. The runner picks it up.
 *
 * Driver verbs (see `walk-scenarios/walk-driver.ts`):
 *   openClaim · selectLeg · startWalk · markLegViable ·
 *   markLegNonIssue · placeLegHold · releaseLegHold ·
 *   generatePreview · markReviewed · submit · expectPhase
 *
 * Mock convention: SOP option labels map 1:1 to the stamped outcome
 * in `mock-builder.ts#OUTCOME_BY_ANSWER` ("Viable" → portal_dispute,
 * "Non-issue" → non_issue, "Cannot dispute" → cannot_dispute,
 * "Hold" → hold). Use those labels in your decision tree and the
 * harness will route you to the right terminal automatically.
 */

import { test, expect } from "@playwright/test";
import {
  installApiStubs,
  OPERATOR_USER,
  OPERATOR_USER_TWO,
} from "./walk-scenarios/mock-builder";
import { buildDriver } from "./walk-scenarios/walk-driver";
import type { WalkScenario } from "./walk-scenarios/types";
import { happyPath } from "./walk-scenarios/scenarios/01-happy-path";
import { markOneNonIssue } from "./walk-scenarios/scenarios/02-mark-non-issue";
import { holdResume } from "./walk-scenarios/scenarios/05-hold-resume";
import { allNonIssue } from "./walk-scenarios/scenarios/09-all-non-issue";
import { twoUserConcurrency } from "./walk-scenarios/scenarios/13-two-user-concurrency";

const SCENARIOS: WalkScenario[] = [
  happyPath,
  markOneNonIssue,
  holdResume,
  allNonIssue,
  twoUserConcurrency,
  // Add new scenarios here.
];

test.describe("queue walk smoke harness", () => {
  // Surface uncaught browser errors and unstubbed requests as test
  // attachments. Mirrors the diagnostic plumbing in the existing
  // responses-awaiting-review spec so failures stay debuggable.
  test.beforeEach(async ({ page }) => {
    const lines: string[] = [];
    page.on("pageerror", (err) => {
      lines.push(`[pageerror] ${err.message}\n${err.stack ?? ""}`);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        lines.push(`[console.${msg.type()}] ${msg.text().slice(0, 400)}`);
      }
    });
    page.on("requestfailed", (req) => {
      const url = req.url();
      if (!url.includes("/events")) {
        lines.push(
          `[reqfailed] ${req.method()} ${url} ${req.failure()?.errorText ?? ""}`,
        );
      }
    });
    (page as unknown as { __diagLines?: string[] }).__diagLines = lines;
  });

  test.afterEach(async ({ page }, testInfo) => {
    const lines =
      (page as unknown as { __diagLines?: string[] }).__diagLines ?? [];
    if (lines.length > 0 && testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("browser-events.txt", {
        body: lines.join("\n"),
        contentType: "text/plain",
      });
    }
  });

  for (const scenario of SCENARIOS) {
    test(scenario.name, async ({ page, browser }) => {
      const state = scenario.seed();

      if (scenario.concurrent) {
        // Two-context flow (Scenario #13). User A reuses the
        // default test fixture page; User B gets a fresh
        // BrowserContext so cookies/auth/session storage are
        // fully isolated. Both share the same in-memory
        // `WalkMockState` so cross-user effects (presence ledger,
        // call ordering) are observable from either side.
        if (!scenario.runConcurrent) {
          throw new Error(
            `Scenario "${scenario.name}" sets concurrent but has no runConcurrent`,
          );
        }
        const userA = scenario.concurrent.userA ?? OPERATOR_USER;
        const userB = scenario.concurrent.userB ?? OPERATOR_USER_TWO;
        await installApiStubs(page, state, { user: userA });
        const driverA = buildDriver(page, state);

        const contextB = await browser.newContext();
        const pageB = await contextB.newPage();
        try {
          await installApiStubs(pageB, state, { user: userB });
          const driverB = buildDriver(pageB, state);
          await scenario.runConcurrent(driverA, driverB);
        } finally {
          await contextB.close();
        }
      } else {
        if (!scenario.run) {
          throw new Error(`Scenario "${scenario.name}" has no run function`);
        }
        await installApiStubs(page, state, { user: OPERATOR_USER });
        const driver = buildDriver(page, state);
        await scenario.run(driver);
      }

      if (scenario.expectedCallOrder && scenario.expectedCallOrder.length > 0) {
        // Each label must appear in state.callOrder, in the given
        // relative order (additional unrelated calls between them
        // are fine — this is a subsequence assertion, not equality).
        let cursor = -1;
        for (const label of scenario.expectedCallOrder) {
          const next = state.callOrder.indexOf(label, cursor + 1);
          expect(
            next,
            `expected "${label}" after index ${cursor} in callOrder=${JSON.stringify(state.callOrder)}`,
          ).toBeGreaterThan(cursor);
          cursor = next;
        }
      }
      scenario.assert?.(state);
    });
  }
});

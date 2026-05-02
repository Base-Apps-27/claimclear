import { test, expect, type Page, type Route, type Request } from "@playwright/test";

/**
 * End-to-end coverage for the Step 3 → Step 4 commit flow on the
 * Responses Awaiting Review page (Task #343, follow-up to Task #322).
 *
 * What this spec pins:
 *
 *   1. Step 3 verdict picks land on the leg as `operator_draft` and
 *      survive a hard page reload before any Step 4 commit fires —
 *      the lit-up pills come back, and the group is still in the
 *      Review queue.
 *
 *   2. Each of the three Step 4 paths actually commits the drafts:
 *
 *        a. **Re-attest now** (all-approved mix) — the modal hits
 *           `promote-verdict-drafts` BEFORE `reattest/complete` and
 *           `awaiting-payor-again`, and the group leaves the queue.
 *
 *        b. **Queue for attestation** (all-approved mix) — the modal
 *           hits `promote-verdict-drafts` BEFORE the per-leg
 *           `attest/queue` fan-out, and the group leaves the queue.
 *
 *        c. **Close out as Denied by Payor** (all-denied mix) — the
 *           closure intake dialog's `beforeSubmit` hits
 *           `promote-verdict-drafts` BEFORE the closure
 *           `PATCH /outcome`, and the group leaves the queue.
 *
 * Every `/api/*` request is stubbed via `page.route()` so the suite
 * doesn't depend on the API server, the database, or any seed data.
 * SSE streams are aborted (the Step 4 flows don't depend on live
 * events). The mock state is shared across requests within a test so
 * the picker's seed-from-latestDraft path can be exercised by reload.
 */

const GROUP_ID = 78901;
const LEG_A_ID = 1001;
const LEG_B_ID = 1002;
const LEG_A_CONF = "CLM-A";
const LEG_B_CONF = "CLM-B";

interface UserShape {
  id: string;
  email: string;
  displayName: string | null;
  profileImageUrl: string | null;
  role: "admin" | "operator";
  status: "active";
}

const OPERATOR_USER: UserShape = {
  id: "user-operator-1",
  email: "operator@example.test",
  displayName: "Operator One",
  profileImageUrl: null,
  role: "operator",
  status: "active",
};

/**
 * Per-test mock state. Each request handler reads/writes this shape so
 * that:
 *   - `POST /claims/:id/verdict` updates the per-leg draft in memory,
 *   - the next `GET /api/invoice-groups/:id` reflects that draft on
 *     the leg's `latestDraft` slot (so the picker re-seeds its lit
 *     pill on reload),
 *   - any Step 4 commit (`reattest+awaiting-payor-again`,
 *     `attest/queue` fan-out, or `outcome` PATCH) flips `committed`
 *     so the next `GET /api/invoice-groups?macroPhase=response-pending`
 *     returns an empty list and the page swaps in its empty state.
 */
interface DraftRow {
  id: number;
  outcome: "Approved" | "Denied";
  createdAt: string;
}

interface MockState {
  legDrafts: Map<number, DraftRow>;
  draftRowIdSeq: number;
  /** Any Step-4 commit happened — group has left `response-pending`. */
  committed: boolean;
  promoteCount: number;
  reattestBody: unknown;
  awaitingPayorAgainCount: number;
  queueAttestationBodies: Array<{ claimId: number; body: unknown }>;
  outcomeBody: unknown;
  /**
   * Server-side ordering ledger. Each commit-affecting route appends
   * a label so tests can assert "promote ran first, then the
   * downstream action".
   */
  callOrder: string[];
}

function freshState(): MockState {
  return {
    legDrafts: new Map(),
    draftRowIdSeq: 1,
    committed: false,
    promoteCount: 0,
    reattestBody: null,
    awaitingPayorAgainCount: 0,
    queueAttestationBodies: [],
    outcomeBody: null,
    callOrder: [],
  };
}

function buildLeg(state: MockState, id: number, confNumber: string) {
  const draft = state.legDrafts.get(id);
  return {
    id,
    confNumber,
    invoiceGroupId: GROUP_ID,
    errorTypeId: "et_eligibility",
    errorTypeName: "Eligibility",
    errorDetails: "Member ID mismatch on the manifest",
    sopOutcome: "portal_dispute",
    includedInDispute: true,
    duplicateOfClaimId: null,
    outcome: "Pending",
    closureReason: null,
    isUrgent: false,
    confidenceScore: null,
    createdAt: "2026-04-01T12:00:00.000Z",
    updatedAt: "2026-04-15T12:00:00.000Z",
    latestVerdict: null,
    latestDraft: draft
      ? {
          id: draft.id,
          claimId: id,
          outcome: draft.outcome,
          source: "operator_draft",
          createdAt: draft.createdAt,
          note: null,
          confidence: null,
          reasoning: null,
          createdBy: OPERATOR_USER.email,
          inspectionTimeMs: null,
        }
      : null,
    latestAiSuggestion: null,
    dropReason: null,
    attestationState: "pending",
    attestationNote: null,
  };
}

function buildGroupListItem(state: MockState) {
  return {
    id: GROUP_ID,
    invoiceNumber: "INV-E2E-MULTI",
    clientNumber: "C-1",
    errorTypeId: "et_eligibility",
    errorTypeName: "Eligibility",
    status: "Needs Review",
    outcome: "Pending",
    rideCount: 2,
    totalAmount: "240.00",
    isUrgent: false,
    awaitingPayorAgainAt: null,
    macroPhase: "response-pending",
    createdAt: "2026-04-01T12:00:00.000Z",
    updatedAt: "2026-04-15T12:00:00.000Z",
  };
}

function buildGroupDetail(state: MockState) {
  return {
    ...buildGroupListItem(state),
    errorDetails:
      "Two legs disputed under eligibility — payor reply received.",
    closureReason: null,
    closureCategory: null,
    closureCategoryOther: null,
    closureRootCause: null,
    closureRootCauseOther: null,
    closureNarrative: null,
    closureAccountabilityTags: null,
    closureAccountabilityOther: null,
    closureDrivers: null,
    closureDispatchers: null,
    closureCommunicatedTo: null,
    closureReviewState: null,
    closureAddressedAt: null,
    closureAddressedBy: null,
    closureAddressedByEmail: null,
    closureReviewNotes: null,
    approvedAmount: null,
    holdReason: null,
    holdPendingFrom: null,
    holdPlacedAt: null,
    triageNotes: null,
    triagedAt: null,
    disputeEmailSent: true,
    disputeEmailSentAt: "2026-04-10T12:00:00.000Z",
    generatedEmailSubject: null,
    generatedEmailBody: null,
    generatedEmailAt: null,
    evidenceFiles: null,
    evidenceNotes: null,
    evidenceChecklist: null,
    payorEmail: "ap@payor.test",
    payorDenialReason: null,
    payorDenialReasonNote: null,
    payorDenialReasonAt: null,
    payorDenialReasonBy: null,
    importBatch: null,
    reattestRequired: false,
    reattestCompletedAt: null,
    reattestCompletedBy: null,
    reattestNote: null,
    isPartial: false,
    rides: [
      buildLeg(state, LEG_A_ID, LEG_A_CONF),
      buildLeg(state, LEG_B_ID, LEG_B_CONF),
    ],
    submissions: [],
    notes: [],
    auditLogs: [],
    responses: [
      {
        id: 5001,
        invoiceGroupId: GROUP_ID,
        responseType: "denial",
        senderName: "Payor AP",
        senderEmail: "ap@payor.test",
        subject: "Re: INV-E2E-MULTI",
        content: "We reviewed; please find our determination attached.",
        rawContent: "We reviewed; please find our determination attached.",
        bodyFormat: "text",
        receivedAt: "2026-04-15T10:00:00.000Z",
        aiSummary: "Payor returned a per-leg determination.",
        metadata: null,
      },
    ],
    packagingReadiness: undefined,
  };
}

/**
 * Wire up the universal `/api/*` interception. Mirrors the ordering
 * pattern from `reattest-offline-modal.spec.ts`: register the broad
 * catch-all FIRST, then layer narrower routes on top so the most
 * specific handlers win (Playwright matches in REVERSE registration
 * order — last-registered wins).
 */
async function installApiStubs(page: Page, state: MockState): Promise<void> {
  const json = (status: number, body: unknown) => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

  // Catch-all: an empty 200 so a stray fetch doesn't 404 + retry in a
  // loop. Anything more specific registered below wins.
  await page.route("**/api/**", (route: Route) =>
    route.fulfill(json(200, {})),
  );

  // SSE streams — the page opens EventSources for live updates, but
  // the Step 3/4 flow under test doesn't depend on any of them.
  // Aborting them is fine; the EventSource just retries silently.
  const abortSse = (route: Route) => route.abort();
  await page.route("**/api/invoice-groups/*/events*", abortSse);
  await page.route("**/api/invoice-groups/events*", abortSse);
  await page.route("**/api/claims/*/events*", abortSse);
  await page.route("**/api/claims/events*", abortSse);
  await page.route("**/api/system-events*", abortSse);
  await page.route("**/api/portal-submissions/batch-events*", abortSse);

  // Auth — useAuth polls this on mount.
  await page.route("**/api/auth/user", (route: Route) =>
    route.fulfill(json(200, { user: OPERATOR_USER })),
  );
  await page.route("**/api/auth/session-info", (route: Route) =>
    route.fulfill(
      json(200, {
        absoluteExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        idleExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }),
    ),
  );

  // Sidebar/badge counts — keep chrome quiet. The awaiting-review
  // count badge follows the same `committed` flag so the sidebar
  // also drops to 0 once Step 4 lands.
  await page.route("**/api/attestation-counts*", (route: Route) =>
    route.fulfill(json(200, { pending: 0, processed: 0 })),
  );
  await page.route("**/api/responses/awaiting-review/count*", (route: Route) =>
    route.fulfill(json(200, { count: state.committed ? 0 : 1 })),
  );
  await page.route("**/api/portal-submissions/queue-status*", (route: Route) =>
    route.fulfill(json(200, { queued: 0, running: 0 })),
  );

  // List endpoint — `/api/invoice-groups` followed by `?` or end of
  // URL. Distinguishes from `/api/invoice-groups/:id` which always
  // has a `/` after `invoice-groups`. Uses a regex so the query
  // string variations the orval client emits (`?macroPhase=...`)
  // all match the same handler.
  await page.route(/\/api\/invoice-groups(?:\?|$)/, (route: Route) => {
    const groups = state.committed ? [] : [buildGroupListItem(state)];
    return route.fulfill(json(200, { groups }));
  });

  // Per-group detail GET — registered BEFORE the more specific
  // sub-routes (valid-transitions, email-thread, promote, reattest,
  // awaiting-payor-again, outcome) so those last-registered handlers
  // take precedence.
  await page.route(
    `**/api/invoice-groups/${GROUP_ID}*`,
    (route: Route, request: Request) => {
      if (request.method() !== "GET") {
        return route.fallback();
      }
      return route.fulfill(json(200, buildGroupDetail(state)));
    },
  );

  // Per-group sub-reads — registered AFTER the detail glob.
  await page.route(
    `**/api/invoice-groups/${GROUP_ID}/valid-transitions*`,
    (route: Route) => route.fulfill(json(200, { transitions: [] })),
  );
  await page.route(
    `**/api/invoice-groups/${GROUP_ID}/email-thread*`,
    (route: Route) =>
      route.fulfill(
        // Empty thread → page falls through to InlineResponseFallback,
        // which is fine: the action rail still renders because there
        // IS a reviewable response.
        json(200, { messages: [], conversationIds: [], conversations: [] }),
      ),
  );

  // Step 4 — promote per-leg drafts to `operator_confirmed`.
  // Must run BEFORE every downstream commit (re-attest stamp / queue
  // fan-out / closure outcome). The handler appends "promote" to
  // `callOrder` so tests can assert ordering against the downstream
  // action that follows.
  await page.route(
    `**/api/invoice-groups/${GROUP_ID}/promote-verdict-drafts*`,
    async (route: Route, request: Request) => {
      if (request.method() !== "POST") return route.fallback();
      state.promoteCount += 1;
      state.callOrder.push("promote");
      const promotedClaimIds = Array.from(state.legDrafts.keys());
      return route.fulfill(
        json(200, {
          promotedCount: promotedClaimIds.length,
          promotedClaimIds,
        }),
      );
    },
  );

  // Step 4a — re-attest stamp.
  await page.route(
    `**/api/invoice-groups/${GROUP_ID}/reattest/complete*`,
    async (route: Route, request: Request) => {
      if (request.method() !== "POST") return route.fallback();
      try {
        state.reattestBody = request.postDataJSON();
      } catch {
        state.reattestBody = request.postData();
      }
      state.callOrder.push("reattest_complete");
      return route.fulfill(
        json(200, {
          ...buildGroupDetail(state),
          reattestCompletedAt: new Date().toISOString(),
          reattestCompletedBy: OPERATOR_USER.email,
        }),
      );
    },
  );

  // Step 4a (continued) — drop the row off the Review page.
  // This is what actually commits the group out of `response-pending`
  // for the re-attest path. We flip `committed` here so the next
  // list refetch returns an empty `groups` array.
  await page.route(
    `**/api/invoice-groups/${GROUP_ID}/awaiting-payor-again*`,
    async (route: Route, request: Request) => {
      if (request.method() !== "POST") return route.fallback();
      state.awaitingPayorAgainCount += 1;
      state.callOrder.push("awaiting_payor_again");
      state.committed = true;
      return route.fulfill(
        json(200, {
          ...buildGroupDetail(state),
          awaitingPayorAgainAt: new Date().toISOString(),
        }),
      );
    },
  );

  // Step 4c — closure outcome PATCH. The closure dialog routes here
  // after `beforeSubmit` (which calls promote-verdict-drafts).
  await page.route(
    `**/api/invoice-groups/${GROUP_ID}/outcome*`,
    async (route: Route, request: Request) => {
      const m = request.method();
      if (m !== "PATCH" && m !== "POST") return route.fallback();
      try {
        state.outcomeBody = request.postDataJSON();
      } catch {
        state.outcomeBody = request.postData();
      }
      state.callOrder.push("outcome_update");
      state.committed = true;
      return route.fulfill(
        json(200, {
          ...buildGroupDetail(state),
          status: "Denied",
          outcome: "Denied",
          closureReason: "denied_by_payor",
        }),
      );
    },
  );

  // Step 3 — per-leg verdict draft. Path: `/api/claims/:id/verdict`.
  // Stores the draft in `state.legDrafts` so the next detail GET
  // will surface it on the leg as `latestDraft`.
  await page.route(
    /\/api\/claims\/\d+\/verdict(?:\?|$)/,
    async (route: Route, request: Request) => {
      if (request.method() !== "POST") return route.fallback();
      const url = new URL(request.url());
      const m = url.pathname.match(/\/claims\/(\d+)\/verdict$/);
      if (!m) return route.fulfill(json(400, { error: "bad path" }));
      const claimId = Number(m[1]);
      let body: { source?: string; outcome?: string; note?: string | null } = {};
      try {
        body = request.postDataJSON();
      } catch {
        // ignore — we'll just fail validation below
      }
      const isDraft = body.source === "operator_draft";
      const isBinary = body.outcome === "Approved" || body.outcome === "Denied";
      if (isDraft && isBinary) {
        const id = state.draftRowIdSeq++;
        state.legDrafts.set(claimId, {
          id,
          outcome: body.outcome as "Approved" | "Denied",
          createdAt: new Date().toISOString(),
        });
      }
      return route.fulfill(
        json(200, {
          id: state.draftRowIdSeq,
          claimId,
          outcome: body.outcome,
          source: body.source ?? "operator_draft",
          createdAt: new Date().toISOString(),
          note: body.note ?? null,
          confidence: null,
          reasoning: null,
          createdBy: OPERATOR_USER.email,
          inspectionTimeMs: null,
        }),
      );
    },
  );

  // Step 4b — per-leg attestation queue fan-out. Path:
  // `/api/claims/:id/attest/queue`. The modal calls this once per
  // approved leg AFTER promote-verdict-drafts succeeds.
  await page.route(
    /\/api\/claims\/\d+\/attest\/queue(?:\?|$)/,
    async (route: Route, request: Request) => {
      if (request.method() !== "POST") return route.fallback();
      const url = new URL(request.url());
      const m = url.pathname.match(/\/claims\/(\d+)\/attest\/queue$/);
      const claimId = m ? Number(m[1]) : -1;
      let body: unknown = {};
      try {
        body = request.postDataJSON();
      } catch {
        body = request.postData();
      }
      state.queueAttestationBodies.push({ claimId, body });
      state.callOrder.push(`queue_attestation_${claimId}`);
      // The queue path also takes the group out of response-pending
      // (every leg now has a confirmed verdict + a queued attestation).
      // Once both legs have been queued, flip `committed` so the list
      // refetch returns an empty groups array and the empty state
      // shows.
      if (state.queueAttestationBodies.length >= 2) {
        state.committed = true;
      }
      return route.fulfill(
        json(200, {
          id: claimId,
          attestationState: "queued",
          attestationNote:
            body && typeof body === "object" && "note" in (body as object)
              ? (body as { note?: string }).note ?? null
              : null,
        }),
      );
    },
  );
}

test.describe("responses-awaiting-review · Step 3 → Step 4 commit", () => {
  // Same diagnostic plumbing as `reattest-offline-modal.spec.ts` —
  // surface uncaught browser errors and unstubbed requests as test
  // attachments so failures are debuggable.
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

  test("drafts persist across reload, then Re-attest now commits and removes the group", async ({
    page,
  }) => {
    const state = freshState();
    await installApiStubs(page, state);

    await page.goto(`/responses-awaiting-review`);

    // Page auto-selects the first row → DetailPane mounts → action
    // rail renders the per-leg picker. Wait for both pills to show.
    const pickA = page.getByTestId(`button-pick-approved-${LEG_A_ID}`);
    const pickB = page.getByTestId(`button-pick-approved-${LEG_B_ID}`);
    await expect(pickA).toBeVisible({ timeout: 10000 });
    await expect(pickB).toBeVisible();

    // Step 3: draft an "Approved" verdict on each leg. Each click
    // POSTs `/api/claims/:id/verdict` with `source: operator_draft`.
    await pickA.click();
    await expect(pickA).toHaveAttribute("data-selected", "true");
    await pickB.click();
    await expect(pickB).toHaveAttribute("data-selected", "true");

    // Drafts landed on the server-side mock state.
    expect(state.legDrafts.size).toBe(2);
    expect(state.legDrafts.get(LEG_A_ID)?.outcome).toBe("Approved");
    expect(state.legDrafts.get(LEG_B_ID)?.outcome).toBe("Approved");

    // No commit-affecting calls have happened yet — the group must
    // still be in the queue.
    expect(state.callOrder).toEqual([]);
    expect(state.committed).toBe(false);
    await expect(
      page.getByTestId(`awaiting-review-row-${GROUP_ID}`),
    ).toBeVisible();

    // Hard reload — the picker MUST seed its lit pill from the
    // server's `latestDraft` slot on the leg, otherwise drafts
    // would silently vanish on a refresh.
    await page.reload();
    await expect(
      page.getByTestId(`button-pick-approved-${LEG_A_ID}`),
    ).toHaveAttribute("data-selected", "true", { timeout: 10000 });
    await expect(
      page.getByTestId(`button-pick-approved-${LEG_B_ID}`),
    ).toHaveAttribute("data-selected", "true");
    await expect(
      page.getByTestId(`awaiting-review-row-${GROUP_ID}`),
    ).toBeVisible();

    // Step 4: open the re-attest modal (all_approved mix → Re-attest
    // lane is showing).
    await page.getByTestId("button-open-reattest").click();
    const modal = page.getByTestId("whats-next-reattest-modal");
    await expect(modal).toBeVisible();

    // Tick every checklist item so the "I'm done" submit enables.
    const checkboxes = modal.locator(
      '[data-testid^="reattest-checklist-checkbox-"]',
    );
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).click();
    }

    const submit = page.getByTestId("reattest-confirm-done");
    await expect(submit).toBeEnabled();
    await submit.click();

    // The modal closes and the page refetches the list. Once
    // `committed` flips on the server-side mock the list returns
    // empty and the page swaps in its empty state.
    await expect(page.getByTestId("empty-state")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByTestId(`awaiting-review-row-${GROUP_ID}`),
    ).toHaveCount(0);

    // Ordering: promote ran FIRST, then the re-attest stamp, then
    // the awaiting-payor-again drop. Without the promote-first
    // ordering the group could leave `response-pending` while still
    // carrying drafts.
    expect(state.promoteCount).toBe(1);
    const promoteIdx = state.callOrder.indexOf("promote");
    const reattestIdx = state.callOrder.indexOf("reattest_complete");
    const awaitingIdx = state.callOrder.indexOf("awaiting_payor_again");
    expect(promoteIdx).toBeGreaterThanOrEqual(0);
    expect(reattestIdx).toBeGreaterThan(promoteIdx);
    expect(awaitingIdx).toBeGreaterThan(reattestIdx);
    expect(state.committed).toBe(true);
  });

  test("Queue for attestation commits drafts before fan-out and removes the group", async ({
    page,
  }) => {
    const state = freshState();
    await installApiStubs(page, state);

    await page.goto(`/responses-awaiting-review`);

    const pickA = page.getByTestId(`button-pick-approved-${LEG_A_ID}`);
    const pickB = page.getByTestId(`button-pick-approved-${LEG_B_ID}`);
    await expect(pickA).toBeVisible({ timeout: 10000 });
    await pickA.click();
    await pickB.click();
    await expect(pickA).toHaveAttribute("data-selected", "true");
    await expect(pickB).toHaveAttribute("data-selected", "true");

    expect(state.legDrafts.size).toBe(2);
    expect(state.committed).toBe(false);
    await expect(
      page.getByTestId(`awaiting-review-row-${GROUP_ID}`),
    ).toBeVisible();

    // Open the modal, switch to the "Queue for attestation" tab,
    // then submit. No checklist gate on this tab — the queue note
    // is optional.
    await page.getByTestId("button-open-reattest").click();
    const modal = page.getByTestId("whats-next-reattest-modal");
    await expect(modal).toBeVisible();
    await page.getByTestId("reattest-tab-queue").click();
    await page.getByTestId("reattest-queue-confirm").click();

    // Group leaves the queue once both per-leg attest/queue calls
    // have landed (server-side mock flips `committed` on the second
    // call).
    await expect(page.getByTestId("empty-state")).toBeVisible({
      timeout: 10000,
    });

    // Ordering: promote ran FIRST, then both per-leg attest/queue
    // calls. The order between the two leg fan-out calls themselves
    // isn't pinned (Promise.all could race), but BOTH must come
    // after promote.
    expect(state.promoteCount).toBe(1);
    const promoteIdx = state.callOrder.indexOf("promote");
    const queueAIdx = state.callOrder.indexOf(
      `queue_attestation_${LEG_A_ID}`,
    );
    const queueBIdx = state.callOrder.indexOf(
      `queue_attestation_${LEG_B_ID}`,
    );
    expect(promoteIdx).toBeGreaterThanOrEqual(0);
    expect(queueAIdx).toBeGreaterThan(promoteIdx);
    expect(queueBIdx).toBeGreaterThan(promoteIdx);
    expect(state.queueAttestationBodies).toHaveLength(2);
    expect(state.committed).toBe(true);
  });

  test("Close out as Denied by Payor commits drafts and removes the group", async ({
    page,
  }) => {
    const state = freshState();
    await installApiStubs(page, state);

    await page.goto(`/responses-awaiting-review`);

    // Step 3: draft a "Denied" verdict on each leg so the mix is
    // `all_denied` and the close-out lane surfaces.
    const denyA = page.getByTestId(`button-pick-denied-${LEG_A_ID}`);
    const denyB = page.getByTestId(`button-pick-denied-${LEG_B_ID}`);
    await expect(denyA).toBeVisible({ timeout: 10000 });
    await denyA.click();
    await denyB.click();
    await expect(denyA).toHaveAttribute("data-selected", "true");
    await expect(denyB).toHaveAttribute("data-selected", "true");

    expect(state.legDrafts.size).toBe(2);
    expect(state.legDrafts.get(LEG_A_ID)?.outcome).toBe("Denied");
    expect(state.legDrafts.get(LEG_B_ID)?.outcome).toBe("Denied");
    expect(state.committed).toBe(false);

    // Open the close-out lane. Opening the dialog MUST NOT fire
    // promote — that only happens inside `beforeSubmit` after the
    // operator clicks Submit.
    await page.getByTestId("button-closure-denied-by-payor").click();
    const dialog = page.getByTestId("closure-intake-dialog");
    await expect(dialog).toBeVisible();
    expect(state.callOrder).toEqual([]);

    // Fill the closure intake form. Pick a category whose root-cause
    // list is non-empty so we don't have to special-case "other".
    await page.getByTestId("closure-category-select").click();
    await page
      .getByRole("option", { name: "GPS / tracking missing" })
      .click();
    await page.getByTestId("closure-root-cause-select").click();
    // Any of the GPS-missing root causes is fine — pick the first.
    await page.getByRole("option").first().click();

    // Narrative must be ≥150 trimmed characters per the dialog's
    // validation gate.
    const narrative =
      "The payor formally denied this invoice group across all legs and the operator confirmed there is no further evidence to dispute. Closing out as denied per payor instructions.";
    await page.getByTestId("closure-narrative").fill(narrative);

    // Pick an accountability tag that has no extra required
    // sub-fields (driver/dispatcher both require person-list
    // entries; "other" requires a free-text note). External payor is
    // a clean single click.
    await page.getByTestId("closure-tag-external_payor").click();

    await page.getByTestId("closure-submit-button").click();

    // Closure success → page invalidates the list → the empty
    // state surfaces.
    await expect(page.getByTestId("empty-state")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByTestId(`awaiting-review-row-${GROUP_ID}`),
    ).toHaveCount(0);

    // Ordering: promote ran FIRST (inside the launcher's
    // `beforeSubmit`), THEN the outcome PATCH.
    expect(state.promoteCount).toBe(1);
    const promoteIdx = state.callOrder.indexOf("promote");
    const outcomeIdx = state.callOrder.indexOf("outcome_update");
    expect(promoteIdx).toBeGreaterThanOrEqual(0);
    expect(outcomeIdx).toBeGreaterThan(promoteIdx);
    expect(state.committed).toBe(true);

    // The closure body carries the right shape — outcome=Denied
    // and closureReason=denied_by_payor (this is what tells the
    // backend this is a "payor said no" closure, not a manual
    // self-closure).
    const body = state.outcomeBody as Record<string, unknown> | null;
    expect(body).not.toBeNull();
    expect(body?.outcome).toBe("Denied");
    expect(body?.closureReason).toBe("denied_by_payor");
  });
});

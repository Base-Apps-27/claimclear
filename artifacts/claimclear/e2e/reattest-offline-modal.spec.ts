import { test, expect, type Page, type Route, type Request } from "@playwright/test";

/**
 * Visual end-to-end coverage for the offline-recording re-attest
 * override modal on the invoice-group detail page (Task #335,
 * follow-up to Task #333).
 *
 * Scope:
 *  1. Admin walks the right-rail "Mark as already re-attested" override
 *     link into the modal, verifies the submit button stays disabled
 *     until BOTH the >=10-char trimmed note AND the acknowledgement
 *     checkbox are populated, submits, and asserts:
 *       - the POST to `/api/invoice-groups/:id/reattest/complete`
 *         carries `{recordedOffline: true, offlineNote: "<trimmed>"}`
 *         (matches the contract pinned in
 *         artifacts/api-server/src/__tests__/mas-reattest-offline.test.ts),
 *       - the success toast surfaces with the documented copy,
 *       - the modal closes after the mutation resolves.
 *  2. A non-admin operator on the same group never sees the override
 *     link or the modal trigger — it must be entirely absent from the
 *     rendered DOM.
 *
 * Every `/api/*` request is stubbed via `page.route()` so the suite
 * doesn't depend on the API server, the database, or any seed data.
 * SSE streams are aborted (the modal flow doesn't depend on live
 * events).
 */

const GROUP_ID = 12345;

interface UserShape {
  id: string;
  email: string;
  displayName: string | null;
  profileImageUrl: string | null;
  role: "admin" | "operator";
  status: "active";
}

const ADMIN_USER: UserShape = {
  id: "user-admin-1",
  email: "admin@example.test",
  displayName: "Admin User",
  profileImageUrl: null,
  role: "admin",
  status: "active",
};

const OPERATOR_USER: UserShape = {
  id: "user-operator-1",
  email: "operator@example.test",
  displayName: "Operator User",
  profileImageUrl: null,
  role: "operator",
  status: "active",
};

/**
 * Build a minimal InvoiceGroupDetailResponse-compatible payload that
 * the right rail can render. The fields actually consulted by the
 * MAS-action card and the override-modal visibility gate are:
 *   - reattestRequired (true to surface the card)
 *   - reattestCompletedAt (null to surface the override link)
 *   - reattestNote / reattestCompletedBy (only used in completed view)
 *   - status / outcome / id / invoiceNumber (page chrome)
 *
 * Everything else is filled with safe defaults so the page doesn't
 * crash on missing arrays/maps.
 */
function buildGroupPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: GROUP_ID,
    invoiceNumber: "INV-E2E-1",
    clientNumber: null,
    errorDetails: null,
    errorTypeId: null,
    errorTypeName: null,
    status: "Awaiting Response",
    outcome: "Pending",
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
    rideCount: 1,
    totalAmount: "100.00",
    holdReason: null,
    holdPendingFrom: null,
    holdPlacedAt: null,
    triageNotes: null,
    triagedAt: null,
    disputeEmailSent: true,
    disputeEmailSentAt: "2026-04-01T12:00:00.000Z",
    generatedEmailSubject: null,
    generatedEmailBody: null,
    generatedEmailAt: null,
    evidenceFiles: null,
    evidenceNotes: null,
    evidenceChecklist: null,
    payorEmail: null,
    payorDenialReason: null,
    payorDenialReasonNote: null,
    payorDenialReasonAt: null,
    payorDenialReasonBy: null,
    awaitingPayorAgainAt: null,
    importBatch: null,
    reattestRequired: true,
    reattestCompletedAt: null,
    reattestCompletedBy: null,
    reattestNote: null,
    macroPhase: "in-flight",
    createdAt: "2026-04-01T12:00:00.000Z",
    updatedAt: "2026-04-01T12:00:00.000Z",
    isPartial: false,
    rides: [],
    submissions: [],
    notes: [],
    auditLogs: [],
    responses: [],
    packagingReadiness: undefined,
    ...overrides,
  };
}

/**
 * Wire up the universal `/api/*` interception. The test caller hands in
 * the user shape that should back `/api/auth/user` and a slot it can
 * later inspect for the captured POST body. We deliberately register
 * narrow patterns BEFORE the catch-all so order-dependent matching
 * works correctly.
 */
async function installApiStubs(
  page: Page,
  opts: {
    user: UserShape;
    /** Capture slot for the offline-reattest POST body. */
    capturedReattestBody: { value: unknown };
    /** If set, the reattest endpoint will reply with this status + body. */
    reattestResponse?: { status: number; body: unknown };
  },
): Promise<void> {
  const reattestResponse =
    opts.reattestResponse ??
    {
      status: 200,
      body: buildGroupPayload({
        reattestCompletedAt: "2026-05-02T12:00:00.000Z",
        reattestCompletedBy: opts.user.email,
        reattestNote: "captured-by-server-stub",
      }),
    };

  // NOTE on ordering: Playwright matches `page.route()` handlers in
  // REVERSE registration order (last-registered wins). Register the
  // broad catch-all FIRST so the more specific routes registered
  // afterward take precedence.

  // Catch-all: anything else under /api/* gets an empty 200 so a
  // stray fetch doesn't 404 + retry in a loop.
  await page.route("**/api/**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    }),
  );

  // SSE streams — the page opens EventSources for live updates, but
  // the modal flow under test doesn't depend on any events. Aborting
  // is fine: the EventSource just retries silently in the background.
  const abortSse = (route: Route) => route.abort();
  await page.route("**/api/invoice-groups/*/events*", abortSse);
  await page.route("**/api/invoice-groups/events*", abortSse);
  await page.route("**/api/claims/*/events*", abortSse);
  await page.route("**/api/claims/events*", abortSse);
  await page.route("**/api/system-events*", abortSse);
  await page.route("**/api/portal-submissions/batch-events*", abortSse);

  // Auth — the useAuth hook polls this on mount (and every 2 minutes).
  await page.route("**/api/auth/user", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: opts.user }),
    }),
  );
  await page.route("**/api/auth/session-info", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        absoluteExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        idleExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }),
    }),
  );

  // Sidebar badges — empty counts so the chrome renders without
  // pulling on real queues.
  await page.route("**/api/attestation-counts*", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ pending: 0, processed: 0 }),
    }),
  );
  await page.route("**/api/responses-awaiting-review-count*", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ count: 0 }),
    }),
  );
  await page.route("**/api/portal-submissions/queue-status*", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ queued: 0, running: 0 }),
    }),
  );

  // The detail GET — register BEFORE the more specific subroutes
  // (valid-transitions, email-thread, reattest/complete) so those
  // last-registered handlers take precedence over this glob.
  await page.route(
    `**/api/invoice-groups/${GROUP_ID}*`,
    (route: Route, request: Request) => {
      if (request.method() !== "GET") {
        return route.fallback();
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildGroupPayload()),
      });
    },
  );

  // Page-level reads — registered AFTER the detail glob so they win.
  await page.route(
    `**/api/invoice-groups/${GROUP_ID}/valid-transitions*`,
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ transitions: [] }),
      }),
  );
  await page.route(
    `**/api/invoice-groups/${GROUP_ID}/email-thread*`,
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        // EmailThreadResponse contract: the page reads
        // `thread.conversations.map(...)` via group-thread-adapter,
        // so all three list fields must be present.
        body: JSON.stringify({
          messages: [],
          conversationIds: [],
          conversations: [],
        }),
      }),
  );

  // The reattest POST — capture the body so the test can assert the
  // {recordedOffline, offlineNote} shape, then reply with whatever
  // the test configured. Registered LAST so it wins over the broader
  // detail glob above.
  await page.route(
    `**/api/invoice-groups/${GROUP_ID}/reattest/complete*`,
    async (route: Route, request: Request) => {
      if (request.method() === "POST") {
        try {
          opts.capturedReattestBody.value = request.postDataJSON();
        } catch {
          opts.capturedReattestBody.value = request.postData();
        }
      }
      await route.fulfill({
        status: reattestResponse.status,
        contentType: "application/json",
        body: JSON.stringify(reattestResponse.body),
      });
    },
  );
}

test.describe("invoice-group detail · offline re-attest override modal", () => {
  // Surface uncaught browser errors and unstubbed requests as test
  // attachments so failures are debuggable without re-running with a
  // local trace viewer. Aborted SSE streams are expected and filtered
  // out below.
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
    // Stash on the page object so afterEach can flush these lines as a
    // test attachment if (and only if) the test failed.
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

  test("admin walks the override modal end-to-end", async ({ page }) => {
    const captured: { value: unknown } = { value: null };
    await installApiStubs(page, {
      user: ADMIN_USER,
      capturedReattestBody: captured,
    });

    await page.goto(`/invoice-groups/${GROUP_ID}`);

    // The right-rail MAS-action card should render with the override
    // link visible to admins.
    const overrideLink = page.getByTestId("button-open-mark-reattested-offline");
    await expect(overrideLink).toBeVisible();
    await expect(page.getByTestId("group-reattest-pending")).toBeVisible();

    // Open the modal.
    await overrideLink.click();
    const modal = page.getByTestId("reattest-offline-modal");
    await expect(modal).toBeVisible();

    const noteField = page.getByTestId("textarea-offline-note");
    const confirmCheckbox = page.getByTestId("checkbox-offline-confirm");
    const submitBtn = page.getByTestId("button-submit-offline-reattest");

    // 1) Empty form — submit disabled.
    await expect(submitBtn).toBeDisabled();

    // 2) Short note (< 10 trimmed chars) + checkbox ticked — still
    //    disabled, regardless of confirmation.
    await noteField.fill("too short");
    await confirmCheckbox.check();
    await expect(confirmCheckbox).toBeChecked();
    await expect(submitBtn).toBeDisabled();

    // 3) Long-enough note but checkbox unticked — disabled again.
    await confirmCheckbox.uncheck();
    await noteField.fill("Filed via paper log on 2026-05-01.");
    await expect(submitBtn).toBeDisabled();

    // 4) Both populated — submit enables.
    await confirmCheckbox.check();
    await expect(submitBtn).toBeEnabled();

    // Submit and wait for the modal to close + success toast to
    // surface.
    await submitBtn.click();

    // The toast (radix) renders the title text — assert it appears.
    // Use `exact: true` so the locator binds to the visible title node
    // and not the screen-reader aria-live region (which prefixes the
    // text with "Notification " + appends the action label).
    await expect(
      page.getByText("Recorded as re-attested (offline)", { exact: true }),
    ).toBeVisible({ timeout: 5000 });

    // Modal should be closed once the mutation resolves and the
    // onSuccess handler runs.
    await expect(modal).toBeHidden({ timeout: 5000 });

    // Verify the request body matches the documented contract
    // ({recordedOffline: true, offlineNote: "<trimmed-note>"}).
    expect(captured.value).toEqual({
      recordedOffline: true,
      offlineNote: "Filed via paper log on 2026-05-01.",
    });
  });

  test("non-admin operator sees the MAS card but no override trigger", async ({
    page,
  }) => {
    const captured: { value: unknown } = { value: null };
    await installApiStubs(page, {
      user: OPERATOR_USER,
      capturedReattestBody: captured,
    });

    await page.goto(`/invoice-groups/${GROUP_ID}`);

    // The MAS-action card itself still renders for the operator —
    // it's the override link that must be admin-gated. Wait for the
    // pending block so we know the page mounted before we assert
    // absence.
    await expect(page.getByTestId("group-reattest-pending")).toBeVisible();

    // Critical: the override block (and the trigger button inside
    // it) must not exist in the rendered DOM for a non-admin.
    await expect(page.getByTestId("reattest-admin-overrides")).toHaveCount(0);
    await expect(
      page.getByTestId("button-open-mark-reattested-offline"),
    ).toHaveCount(0);
    // The override modal's mount is also gated, so its container
    // should never have been rendered either.
    await expect(page.getByTestId("reattest-offline-modal")).toHaveCount(0);

    // No POST to the reattest endpoint should ever have happened on
    // the non-admin path.
    expect(captured.value).toBeNull();
  });
});

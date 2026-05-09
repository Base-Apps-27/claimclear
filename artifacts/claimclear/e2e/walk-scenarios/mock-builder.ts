// WalkMockBuilder — wires `page.route('**/api/*', …)` handlers that
// read and mutate a single in-memory `WalkMockState` object. Mirrors
// the ordering convention from `responses-awaiting-review-step4.spec.ts`:
// register the broad catch-all FIRST so any narrower route layered on
// top wins (Playwright matches in REVERSE registration order).
//
// The handlers are deliberately thin — anything that's not a pure
// shape transform (e.g. "what sopOutcome does this answer stamp?")
// lives next to the constants below so a new scenario can override
// it without forking the whole file.

import type { Page, Route, Request } from "@playwright/test";
import type {
  HarnessUser,
  InvoicePhase,
  MockLegState,
  PresenceLedgerEntry,
  SopOutcome,
  WalkLegSeed,
  WalkMockState,
} from "./types";

/** Map an option label clicked by the operator → `sopOutcome` the
 *  server stamps. New scenarios can use option labels outside this
 *  set as long as they're shaped to land on the desired terminal. */
const OUTCOME_BY_ANSWER: Record<string, SopOutcome> = {
  Viable: "portal_dispute",
  "Non-issue": "non_issue",
  "Cannot dispute": "cannot_dispute",
  Hold: "hold",
};

const DROP_REASON_BY_OUTCOME: Record<SopOutcome, "non_issue" | "cannot_dispute" | null> = {
  portal_dispute: null,
  dispute: null,
  non_issue: "non_issue",
  cannot_dispute: "cannot_dispute",
  hold: null,
};

export const OPERATOR_USER: HarnessUser = {
  id: "user-operator-1",
  email: "operator@example.test",
  displayName: "Operator One",
};

export const OPERATOR_USER_TWO: HarnessUser = {
  id: "user-operator-2",
  email: "operator-two@example.test",
  displayName: "Operator Two",
};

function buildAuthUserPayload(user: HarnessUser) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    profileImageUrl: null,
    role: "operator" as const,
    status: "active" as const,
  };
}

/** Build a fresh `WalkMockState` seeded from the supplied legs. The
 *  group starts in `triage` (pre-submit) with the readback already
 *  confirmed so the preview gate is open as soon as every leg lands
 *  on a terminal. Scenarios that want a different starting phase or
 *  a missing readback can mutate the returned state before
 *  `installApiStubs` runs. */
export function buildMockState(args: {
  groupId: number;
  invoiceNumber: string;
  legs: WalkLegSeed[];
  initialPhase?: InvoicePhase;
  understandingReadbackAt?: string | null;
}): WalkMockState {
  const errorTypeIndex = new Map<
    string,
    { id: string; name: string; tree: WalkLegSeed["tree"] }
  >();
  for (const l of args.legs) {
    errorTypeIndex.set(l.errorTypeId, {
      id: l.errorTypeId,
      name: l.errorTypeName,
      tree: l.tree,
    });
  }
  const legs = new Map<number, MockLegState>();
  for (const l of args.legs) {
    legs.set(l.id, {
      id: l.id,
      confNumber: l.confNumber,
      errorTypeId: l.errorTypeId,
      errorTypeName: l.errorTypeName,
      sopNodeId: null,
      sopOutcome: null,
      sopAnswers: [],
      includedInDispute: true,
      dropReason: null,
      duplicateOfClaimId: null,
      holdReason: null,
      holdPendingFrom: null,
    });
  }
  return {
    groupId: args.groupId,
    invoiceNumber: args.invoiceNumber,
    phase: args.initialPhase ?? "triage",
    understandingReadbackAt:
      args.understandingReadbackAt === undefined
        ? "2026-04-15T12:00:00.000Z"
        : args.understandingReadbackAt,
    previewGeneratedAt: null,
    draftReviewedAt: null,
    holdReason: null,
    groupHoldPlacedAt: null,
    legs,
    callOrder: [],
    portalSubmissionBody: null,
    closureReason: null,
    errorTypeIndex,
    presence: new Map<string, Map<string, PresenceLedgerEntry>>(),
  };
}

function presenceKey(resourceType: string, resourceId: number): string {
  return `${resourceType}:${resourceId}`;
}

function getPresenceBucket(
  state: WalkMockState,
  resourceType: string,
  resourceId: number,
): Map<string, PresenceLedgerEntry> {
  const key = presenceKey(resourceType, resourceId);
  let bucket = state.presence.get(key);
  if (!bucket) {
    bucket = new Map();
    state.presence.set(key, bucket);
  }
  return bucket;
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildLeg(state: WalkMockState, leg: MockLegState) {
  return {
    id: leg.id,
    confNumber: leg.confNumber,
    invoiceGroupId: state.groupId,
    errorTypeId: leg.errorTypeId,
    errorTypeName: leg.errorTypeName,
    errorDetails: null,
    sopOutcome: leg.sopOutcome,
    sopNodeId: leg.sopNodeId,
    sopAnswers: leg.sopAnswers,
    includedInDispute: leg.includedInDispute,
    duplicateOfClaimId: leg.duplicateOfClaimId,
    outcome: "Pending",
    closureReason: null,
    isUrgent: false,
    confidenceScore: null,
    createdAt: "2026-04-01T12:00:00.000Z",
    updatedAt: nowIso(),
    latestVerdict: null,
    latestDraft: null,
    latestAiSuggestion: null,
    dropReason: leg.dropReason,
    attestationState: "pending",
    attestationNote: null,
    holdReason: leg.holdReason,
    holdPendingFrom: leg.holdPendingFrom,
    perLegContext: null,
    evidenceFiles: [],
    evidenceNotes: null,
    status:
      leg.holdReason != null
        ? "On Hold"
        : leg.sopOutcome === "non_issue" || leg.sopOutcome === "cannot_dispute"
          ? "Closed"
          : "New",
  };
}

function buildGroupListItem(state: WalkMockState) {
  const onHold = state.holdReason != null;
  const status = onHold
    ? "On Hold"
    : state.phase === "closed"
      ? "Closed"
      : state.phase === "submitted"
        ? "Submitted"
        : state.phase === "ready_to_submit"
          ? "Ready"
          : "New";
  return {
    id: state.groupId,
    invoiceNumber: state.invoiceNumber,
    clientNumber: "C-1",
    errorTypeId: "et_eligibility",
    errorTypeName: "Eligibility",
    status,
    outcome: "Pending",
    rideCount: state.legs.size,
    totalAmount: "240.00",
    isUrgent: false,
    awaitingPayorAgainAt: null,
    macroPhase: state.phase === "submitted" ? "in-flight" : "pre-submit",
    phase: state.phase,
    createdAt: "2026-04-01T12:00:00.000Z",
    updatedAt: nowIso(),
    holdReason: state.holdReason,
    holdPlacedAt: state.groupHoldPlacedAt,
  };
}

function buildGroupDetail(state: WalkMockState) {
  return {
    ...buildGroupListItem(state),
    errorDetails: "Smoke harness scenario",
    closureReason: state.closureReason,
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
    holdPendingFrom: null,
    triageNotes: null,
    triagedAt: null,
    disputeEmailSent: false,
    disputeEmailSentAt: null,
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
    understandingReadbackAt: state.understandingReadbackAt,
    previewGeneratedAt: state.previewGeneratedAt,
    draftReviewedAt: state.draftReviewedAt,
    rides: [...state.legs.values()].map((l) => buildLeg(state, l)),
    submissions: [],
    notes: [],
    auditLogs: [],
    responses: [],
    packagingReadiness: undefined,
  };
}

function buildErrorTypesList(state: WalkMockState) {
  return [...state.errorTypeIndex.values()].map((et) => ({
    id: et.id,
    name: et.name,
    description: null,
    decisionTree: et.tree,
    useDirectEmail: false,
    isActive: true,
  }));
}

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

/** Wire the harness's `/api/*` interceptors onto `page`. The order
 *  here matters: broad catch-all first, then narrower routes layered
 *  on top so the most specific handler wins. */
export async function installApiStubs(
  page: Page,
  state: WalkMockState,
  options: { user?: HarnessUser } = {},
): Promise<void> {
  const currentUser: HarnessUser = options.user ?? OPERATOR_USER;
  const currentEmailLower = currentUser.email.toLowerCase();
  // Catch-all so a stray fetch doesn't 404+retry in a loop.
  await page.route("**/api/**", (route: Route) =>
    route.fulfill(jsonResponse(200, {})),
  );

  // SSE streams — the page opens EventSources for live updates, but
  // none of the walk flows under test depend on them.
  const abortSse = (route: Route) => route.abort();
  await page.route("**/api/invoice-groups/*/events*", abortSse);
  await page.route("**/api/invoice-groups/events*", abortSse);
  await page.route("**/api/claims/*/events*", abortSse);
  await page.route("**/api/claims/events*", abortSse);
  await page.route("**/api/system-events*", abortSse);
  await page.route("**/api/portal-submissions/batch-events*", abortSse);

  // Auth / chrome polls.
  await page.route("**/api/auth/user", (route: Route) =>
    route.fulfill(jsonResponse(200, { user: buildAuthUserPayload(currentUser) })),
  );
  await page.route("**/api/auth/session-info", (route: Route) =>
    route.fulfill(
      jsonResponse(200, {
        absoluteExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        idleExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }),
    ),
  );
  await page.route("**/api/attestation-counts*", (route: Route) =>
    route.fulfill(jsonResponse(200, { pending: 0, processed: 0 })),
  );
  await page.route("**/api/responses/awaiting-review/count*", (route: Route) =>
    route.fulfill(jsonResponse(200, { count: 0 })),
  );
  await page.route("**/api/portal-submissions/queue-status*", (route: Route) =>
    route.fulfill(jsonResponse(200, { queued: 0, running: 0 })),
  );
  await page.route("**/api/macro-phase-rollup*", (route: Route) =>
    route.fulfill(jsonResponse(200, {})),
  );
  await page.route("**/api/needs-classification-inbox*", (route: Route) =>
    route.fulfill(jsonResponse(200, { groups: [] })),
  );
  // Presence wire — the harness backs the real `/api/presence/*`
  // contract with an in-memory ledger on `state.presence` so cross-
  // context scenarios (#13) can prove that two operators see each
  // other. Heartbeat upserts the requester; leave deletes them; GET
  // returns every other viewer (server-side self-exclusion mirror).
  await page.route(
    "**/api/presence/heartbeat",
    async (route: Route, request: Request) => {
      if (request.method() !== "POST") return route.fallback();
      let body: { resourceType?: string; resourceId?: number } = {};
      try {
        body = request.postDataJSON();
      } catch {
        // ignore
      }
      if (
        !body.resourceType ||
        typeof body.resourceId !== "number" ||
        !Number.isFinite(body.resourceId)
      ) {
        return route.fulfill(
          jsonResponse(400, { error: "resourceType and resourceId required" }),
        );
      }
      const bucket = getPresenceBucket(state, body.resourceType, body.resourceId);
      bucket.set(currentEmailLower, {
        userEmail: currentUser.email,
        userName: currentUser.displayName,
        lastHeartbeat: nowIso(),
      });
      state.callOrder.push(
        `presence_heartbeat_${body.resourceType}_${body.resourceId}_${currentEmailLower}`,
      );
      return route.fulfill(jsonResponse(200, { success: true }));
    },
  );
  await page.route(
    "**/api/presence/leave",
    async (route: Route, request: Request) => {
      if (request.method() !== "POST") return route.fallback();
      let body: { resourceType?: string; resourceId?: number } = {};
      try {
        body = request.postDataJSON();
      } catch {
        // ignore
      }
      if (
        !body.resourceType ||
        typeof body.resourceId !== "number" ||
        !Number.isFinite(body.resourceId)
      ) {
        return route.fulfill(
          jsonResponse(400, { error: "resourceType and resourceId required" }),
        );
      }
      const bucket = getPresenceBucket(state, body.resourceType, body.resourceId);
      bucket.delete(currentEmailLower);
      state.callOrder.push(
        `presence_leave_${body.resourceType}_${body.resourceId}_${currentEmailLower}`,
      );
      return route.fulfill(jsonResponse(200, { success: true }));
    },
  );
  await page.route(
    /\/api\/presence\/(claim|invoice_group)\/\d+(?:\?|$)/,
    (route: Route, request: Request) => {
      if (request.method() !== "GET") return route.fallback();
      const url = new URL(request.url());
      const m = url.pathname.match(
        /\/api\/presence\/(claim|invoice_group)\/(\d+)$/,
      );
      if (!m) return route.fulfill(jsonResponse(200, { viewers: [], botActivity: [] }));
      const bucket = getPresenceBucket(state, m[1], Number(m[2]));
      const viewers = [...bucket.values()].filter(
        (v) => v.userEmail.toLowerCase() !== currentEmailLower,
      );
      return route.fulfill(jsonResponse(200, { viewers, botActivity: [] }));
    },
  );
  await page.route("**/api/notes*", (route: Route) =>
    route.fulfill(jsonResponse(200, [])),
  );
  await page.route("**/api/error-types*", (route: Route, request: Request) => {
    if (request.method() !== "GET") return route.fallback();
    return route.fulfill(jsonResponse(200, buildErrorTypesList(state)));
  });

  // Invoice-groups list — distinguishes from `/api/invoice-groups/:id`
  // which always has a slash after `invoice-groups`.
  await page.route(/\/api\/invoice-groups(?:\?|$)/, (route: Route) =>
    route.fulfill(jsonResponse(200, { groups: [buildGroupListItem(state)] })),
  );

  // Per-group detail GET — registered BEFORE the more specific
  // sub-routes so the last-registered narrower handlers win.
  await page.route(
    `**/api/invoice-groups/${state.groupId}*`,
    (route: Route, request: Request) => {
      if (request.method() !== "GET") return route.fallback();
      return route.fulfill(jsonResponse(200, buildGroupDetail(state)));
    },
  );

  await page.route(
    `**/api/invoice-groups/${state.groupId}/valid-transitions*`,
    (route: Route) => route.fulfill(jsonResponse(200, { transitions: [] })),
  );
  await page.route(
    `**/api/invoice-groups/${state.groupId}/email-thread*`,
    (route: Route) =>
      route.fulfill(
        jsonResponse(200, {
          messages: [],
          conversationIds: [],
          conversations: [],
        }),
      ),
  );

  // Group-level hold (POST = place, DELETE = remove).
  await page.route(
    `**/api/invoice-groups/${state.groupId}/hold*`,
    async (route: Route, request: Request) => {
      const m = request.method();
      if (m === "POST") {
        try {
          const body = request.postDataJSON();
          state.holdReason = body?.reason ?? null;
        } catch {
          state.holdReason = null;
        }
        state.groupHoldPlacedAt = nowIso();
        state.callOrder.push("group_hold_place");
        return route.fulfill(jsonResponse(200, buildGroupDetail(state)));
      }
      if (m === "DELETE") {
        state.holdReason = null;
        state.groupHoldPlacedAt = null;
        state.callOrder.push("group_hold_release");
        return route.fulfill(jsonResponse(200, buildGroupDetail(state)));
      }
      return route.fallback();
    },
  );

  // Stamp-preview-generated POST.
  await page.route(
    `**/api/invoice-groups/${state.groupId}/stamp-preview-generated*`,
    async (route: Route, request: Request) => {
      if (request.method() !== "POST") return route.fallback();
      state.previewGeneratedAt = nowIso();
      // Any edit invalidates a prior reviewed stamp. Mirrors the
      // server contract noted in openapi.yaml.
      state.draftReviewedAt = null;
      state.callOrder.push("stamp_preview");
      return route.fulfill(jsonResponse(200, buildGroupDetail(state)));
    },
  );

  // Mark-draft-reviewed POST.
  await page.route(
    `**/api/invoice-groups/${state.groupId}/mark-draft-reviewed*`,
    async (route: Route, request: Request) => {
      if (request.method() !== "POST") return route.fallback();
      state.draftReviewedAt = nowIso();
      state.callOrder.push("mark_reviewed");
      return route.fulfill(jsonResponse(200, buildGroupDetail(state)));
    },
  );

  // Group bulk SOP advance — not used by the happy-path but stubbed
  // so an opt-in scenario doesn't fall through to the catch-all.
  await page.route(
    `**/api/invoice-groups/${state.groupId}/sop-advance*`,
    async (route: Route, request: Request) => {
      if (request.method() !== "POST") return route.fallback();
      let body: { nodeId?: string; answer?: string } = {};
      try {
        body = request.postDataJSON();
      } catch {
        // ignore
      }
      const succeeded: unknown[] = [];
      for (const leg of state.legs.values()) {
        if (leg.includedInDispute === false || leg.sopOutcome != null) continue;
        applySopAnswer(leg, body.nodeId ?? null, body.answer ?? "");
        succeeded.push(buildLeg(state, leg));
      }
      state.callOrder.push("group_sop_advance");
      maybeAutoCloseGroup(state);
      return route.fulfill(jsonResponse(200, { succeeded, skipped: [] }));
    },
  );

  // Portal-submission POST. Flips the group phase to `submitted`.
  await page.route(
    /\/api\/portal-submissions(?:\?|$)/,
    async (route: Route, request: Request) => {
      if (request.method() !== "POST") return route.fallback();
      try {
        state.portalSubmissionBody = request.postDataJSON();
      } catch {
        state.portalSubmissionBody = request.postData();
      }
      state.phase = "submitted";
      state.callOrder.push("portal_submit");
      return route.fulfill(
        jsonResponse(200, {
          id: 9999,
          invoiceGroupId: state.groupId,
          status: "queued",
          createdAt: nowIso(),
        }),
      );
    },
  );

  // Per-leg sop-advance POST — narrower than the catch-all, registered
  // last so it wins. The mock interprets the answer label via
  // `OUTCOME_BY_ANSWER` to decide what terminal to stamp.
  await page.route(
    /\/api\/claims\/\d+\/sop-advance(?:\?|$)/,
    async (route: Route, request: Request) => {
      if (request.method() !== "POST") return route.fallback();
      const url = new URL(request.url());
      const m = url.pathname.match(/\/claims\/(\d+)\/sop-advance$/);
      if (!m) return route.fulfill(jsonResponse(400, { error: "bad path" }));
      const legId = Number(m[1]);
      const leg = state.legs.get(legId);
      if (!leg) return route.fulfill(jsonResponse(404, { error: "no leg" }));
      let body: { nodeId?: string; answer?: string } = {};
      try {
        body = request.postDataJSON();
      } catch {
        // ignore
      }
      applySopAnswer(leg, body.nodeId ?? null, body.answer ?? "");
      state.callOrder.push(`sop_advance_${legId}`);
      maybeAutoCloseGroup(state);
      return route.fulfill(jsonResponse(200, buildLeg(state, leg)));
    },
  );

  // Per-leg hold (POST = place, DELETE = release).
  await page.route(
    /\/api\/claims\/\d+\/hold(?:\?|$)/,
    async (route: Route, request: Request) => {
      const url = new URL(request.url());
      const m = url.pathname.match(/\/claims\/(\d+)\/hold$/);
      if (!m) return route.fallback();
      const legId = Number(m[1]);
      const leg = state.legs.get(legId);
      if (!leg) return route.fulfill(jsonResponse(404, { error: "no leg" }));
      const method = request.method();
      if (method === "POST") {
        let body: { reason?: string; note?: string | null } = {};
        try {
          body = request.postDataJSON();
        } catch {
          // ignore
        }
        leg.holdReason = body.reason ?? "leg_held";
        leg.holdPendingFrom = nowIso();
        state.callOrder.push(`leg_hold_place_${legId}`);
        return route.fulfill(jsonResponse(200, buildLeg(state, leg)));
      }
      if (method === "DELETE") {
        leg.holdReason = null;
        leg.holdPendingFrom = null;
        state.callOrder.push(`leg_hold_release_${legId}`);
        return route.fulfill(jsonResponse(200, buildLeg(state, leg)));
      }
      return route.fallback();
    },
  );

  // Per-leg detail GET / list-claim-evidence / list-notes — narrow
  // enough to win over the catch-all.
  await page.route(
    /\/api\/claims\/\d+(?:\?|$)/,
    (route: Route, request: Request) => {
      if (request.method() !== "GET") return route.fallback();
      const url = new URL(request.url());
      const m = url.pathname.match(/\/claims\/(\d+)$/);
      if (!m) return route.fallback();
      const legId = Number(m[1]);
      const leg = state.legs.get(legId);
      if (!leg) return route.fulfill(jsonResponse(404, { error: "no leg" }));
      return route.fulfill(jsonResponse(200, buildLeg(state, leg)));
    },
  );
  await page.route(/\/api\/claims\/\d+\/evidence(?:\?|$)/, (route: Route) =>
    route.fulfill(jsonResponse(200, { evidence: [] })),
  );
  await page.route(/\/api\/claims\/\d+\/notes(?:\?|$)/, (route: Route) =>
    route.fulfill(jsonResponse(200, [])),
  );
}

/** Apply one operator answer to a leg's mock state. Mirrors what the
 *  server does for terminal answers — stamps `sopOutcome`, sets
 *  `dropReason` for closures, and records the answer on `sopAnswers`. */
function applySopAnswer(
  leg: MockLegState,
  nodeId: string | null,
  answer: string,
): void {
  if (nodeId) {
    leg.sopAnswers.push({ nodeId, answer, ts: nowIso() });
    leg.sopNodeId = nodeId;
  }
  const outcome = OUTCOME_BY_ANSWER[answer] ?? null;
  if (outcome) {
    leg.sopOutcome = outcome;
    leg.dropReason = DROP_REASON_BY_OUTCOME[outcome];
  }
}

/** Mirrors the server's auto-close cascade: when every active leg has
 *  landed on a non-disputable terminal (all `non_issue`, all
 *  `cannot_dispute`, or a mix), the group flips to `closed` with a
 *  closure reason that names the path taken. The reason for the
 *  uniform-non-issue path (`non_issue`) is intentionally distinct from
 *  the uniform-cannot-dispute path (`cannot_dispute`) so smoke
 *  scenarios can pin the difference. Mixed paths are left for a future
 *  scenario and are not auto-closed here. */
function maybeAutoCloseGroup(state: WalkMockState): void {
  if (state.phase === "closed") return;
  const active = [...state.legs.values()].filter(
    (l) => l.includedInDispute !== false,
  );
  if (active.length === 0) return;
  if (active.some((l) => l.sopOutcome == null)) return;

  const allNonIssue = active.every((l) => l.sopOutcome === "non_issue");
  const allCannotDispute = active.every(
    (l) => l.sopOutcome === "cannot_dispute",
  );
  if (allNonIssue) {
    state.phase = "closed";
    state.closureReason = "non_issue";
    state.callOrder.push("group_close_non_issue");
  } else if (allCannotDispute) {
    state.phase = "closed";
    state.closureReason = "cannot_dispute";
    state.callOrder.push("group_close_cannot_dispute");
  }
}

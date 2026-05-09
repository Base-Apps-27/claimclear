import type {
  ClaimResponse,
  InvoiceGroupResponse,
  PortalResponseItem,
} from "@workspace/api-client-react";
import { buildLegResolvedIndex, outcomeRole } from "@workspace/leg-state";
import { getGroupLifecyclePhaseFromGroup } from "./lifecycle-phase";

/**
 * Per-leg verdict derivation for the "What's next?" surface on the
 * Responses Awaiting Review page (Task #322 / Task #343).
 *
 * The legacy `postResponseActions` lane is gone. The flow is
 * verdict-derived: we look at every actionable leg, count how many
 * carry an Approved selection vs a Denied selection vs no selection
 * yet, and surface the right Step 4 affordances based on the
 * resulting mix.
 *
 * Source-of-truth rules — kept identical to the per-leg picker so the
 * "What's next?" card never disagrees with the rail above it:
 *   - Sibling-duplicate legs (`outcomeRole === "duplicate"`) are
 *     excluded entirely (their verdict follows the primary).
 *   - Excluded legs (`includedInDispute === false`) are excluded.
 *   - A "selection" is **either** an `operator_confirmed` row in
 *     `latestVerdict` **or** an `operator_draft` row in `latestDraft`
 *     (Task #343). When both exist for the same leg, the newer of the
 *     two wins — drafts are append-only and the picker writes them as
 *     the operator clicks. AI hints (`ai_suggested`) do NOT count
 *     toward the Step 4 unlock.
 */

export type VerdictMix =
  | "all_approved"
  | "all_denied"
  | "mixed"
  | "no_verdicts_yet";

export interface VerdictDerivation {
  /** Total actionable legs considered (post-exclusion, post-duplicate-filter). */
  total: number;
  /** Legs whose newest selection (draft or confirmed) is Approved/Partially Approved. */
  approvedCount: number;
  /** Legs whose newest selection (draft or confirmed) is Denied. */
  deniedCount: number;
  /** Legs without any operator selection yet (no draft, no confirmation). */
  pendingCount: number;
  /** Categorical mix used to drive UI affordances. */
  mix: VerdictMix;
  /** True when every actionable leg has at least one operator selection (draft OR confirmed). */
  allLegsHaveVerdict: boolean;
  /** The actionable approved legs (used to drive per-leg attestation queueing). */
  approvedLegs: ClaimResponse[];
  /** The actionable denied legs (used to gate the closure flow). */
  deniedLegs: ClaimResponse[];
}

const APPROVED_OUTCOMES = new Set<string>(["Approved", "Partially Approved"]);
const DENIED_OUTCOMES = new Set<string>(["Denied"]);

/**
 * Filter helper — kept exported so the page can use the same predicate
 * for "what does the picker show" and "what does the What's next? card
 * derive from".
 */
export function isActionableLeg(r: ClaimResponse): boolean {
  if (outcomeRole(r) === "duplicate") return false;
  if (r.includedInDispute === false) return false;
  return true;
}

export function legVerdictBucket(r: ClaimResponse): "approved" | "denied" | "pending" {
  // Task #343: a leg "has a selection" if it carries either an
  // `operator_confirmed` verdict in `latestVerdict` OR an
  // `operator_draft` row in `latestDraft`. When both exist (e.g. an
  // older confirmation plus a newer re-draft, or a draft saved
  // post-confirmation while still in `response-pending`), the newer
  // of the two wins. The denormalized backend already filters drafts
  // out of `latestVerdict`, so the two slots are independent.
  const draft = r.latestDraft;
  const confirmed =
    r.latestVerdict && r.latestVerdict.source === "operator_confirmed"
      ? r.latestVerdict
      : null;
  let pick: { outcome: string } | null = null;
  if (draft && confirmed) {
    pick =
      new Date(draft.createdAt).getTime() >= new Date(confirmed.createdAt).getTime()
        ? draft
        : confirmed;
  } else {
    pick = draft ?? confirmed ?? null;
  }
  if (!pick) return "pending";
  if (APPROVED_OUTCOMES.has(pick.outcome)) return "approved";
  if (DENIED_OUTCOMES.has(pick.outcome)) return "denied";
  return "pending";
}

export function deriveVerdictMix(rides: readonly ClaimResponse[]): VerdictDerivation {
  const actionable = rides.filter(isActionableLeg);
  const approvedLegs: ClaimResponse[] = [];
  const deniedLegs: ClaimResponse[] = [];
  let pending = 0;
  for (const r of actionable) {
    const b = legVerdictBucket(r);
    if (b === "approved") approvedLegs.push(r);
    else if (b === "denied") deniedLegs.push(r);
    else pending++;
  }
  const total = actionable.length;
  const approvedCount = approvedLegs.length;
  const deniedCount = deniedLegs.length;
  const allLegsHaveVerdict = total > 0 && pending === 0;

  let mix: VerdictMix;
  if (total === 0 || pending === total) {
    mix = "no_verdicts_yet";
  } else if (approvedCount > 0 && deniedCount === 0 && pending === 0) {
    mix = "all_approved";
  } else if (deniedCount > 0 && approvedCount === 0 && pending === 0) {
    mix = "all_denied";
  } else {
    // Anything with a confirmed approved + at least one confirmed denial,
    // OR any partial verdict coverage with at least one confirmed verdict
    // on either side, lands in "mixed". The card uses
    // `allLegsHaveVerdict` to decide whether to gate certain CTAs.
    mix = "mixed";
  }
  return {
    total,
    approvedCount,
    deniedCount,
    pendingCount: pending,
    mix,
    allLegsHaveVerdict,
    approvedLegs,
    deniedLegs,
  };
}

/**
 * Pull the AI-classified `newInvoiceNumber` (if any) off the freshest
 * portal-response metadata for the group. Surfaces as a small badge in
 * the "What's next?" card so the operator sees the suggestion without
 * having to scroll back into the email body.
 */
export function pickSuggestedNewInvoiceNumber(
  responses: readonly PortalResponseItem[] | undefined,
): string | null {
  if (!responses || responses.length === 0) return null;
  // Newest-first by receivedAt — same ordering convention as the
  // master list. Defensive: receivedAt may be missing on some rows.
  const sorted = [...responses].sort((a, b) => {
    const aT = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
    const bT = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
    return bT - aT;
  });
  for (const r of sorted) {
    const meta = r.metadata;
    if (!meta || typeof meta !== "object") continue;
    const v = (meta as Record<string, unknown>).newInvoiceNumber;
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

/**
 * Task #455 — same scan as `pickSuggestedNewInvoiceNumber` but also
 * returns the `portal_responses.id` of the response that supplied the
 * suggestion so the Re-attest commit can record it on the rename
 * audit row's `metadata.sourceResponseId`.
 */
export function pickSuggestedNewInvoiceNumberWithSource(
  responses: readonly PortalResponseItem[] | undefined,
): { invoiceNumber: string; sourceResponseId: number | null } | null {
  if (!responses || responses.length === 0) return null;
  const sorted = [...responses].sort((a, b) => {
    const aT = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
    const bT = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
    return bT - aT;
  });
  for (const r of sorted) {
    const meta = r.metadata;
    if (!meta || typeof meta !== "object") continue;
    const v = (meta as Record<string, unknown>).newInvoiceNumber;
    if (typeof v === "string" && v.trim().length > 0) {
      const id = typeof r.id === "number" && Number.isFinite(r.id) ? r.id : null;
      return { invoiceNumber: v.trim(), sourceResponseId: id };
    }
  }
  return null;
}

/**
 * Pull the AI-classified `suggestedPayorDenialReason` off the freshest
 * portal-response metadata. Returned as the raw code string — the
 * picker validates it against the @workspace/payor-denial-reasons
 * vocabulary before pre-selecting.
 */
export function pickSuggestedPayorDenialReason(
  responses: readonly PortalResponseItem[] | undefined,
): string | null {
  if (!responses || responses.length === 0) return null;
  const sorted = [...responses].sort((a, b) => {
    const aT = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
    const bT = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
    return bT - aT;
  });
  for (const r of sorted) {
    const meta = r.metadata;
    if (!meta || typeof meta !== "object") continue;
    const v = (meta as Record<string, unknown>).suggestedPayorDenialReason;
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

/**
 * `awaiting-payor-again` is a forward-only stamp: once it's set the
 * row drops off the Responses Awaiting Review page until the next
 * inbound payor response arrives. This helper is exposed so the card
 * can hide the "I replied — wait for payor again" button if the stamp
 * is already on the group (defensive — the row should already be
 * filtered out upstream, but the SSE refresh window can briefly show
 * a stale row).
 */
export function isAwaitingPayorAgain(group: InvoiceGroupResponse): boolean {
  return !!group.awaitingPayorAgainAt;
}

// ─────────────────────────────────────────────────────────────────────
// Re-attest eligibility — client-side mirror of the server gate on
// `POST /invoice-groups/:id/bulk-queue-reattest` AND
// `POST /invoice-groups/:id/complete-reattest`. Both endpoints share
// the same source-state contract (see invoice-groups.ts L3810-3852),
// which is reproduced here so the operator never sees a Re-attest CTA
// that 409s on submit.
//
// The server's macro-phase derivation (`getGroupMacroPhase` in
// api-server/src/lib/macro-phase.ts) is reproduced inline rather than
// reusing the client's `getGroupLifecyclePhaseFromGroup`, because the
// latter folds `awaiting-payout` into `mas-action-required` and would
// therefore mis-classify a re-attested group as eligible.
//
// Eligible iff:
//   - macroPhase = "response-pending" AND status = "Needs Review", OR
//   - macroPhase = "mas-action-required"
// ─────────────────────────────────────────────────────────────────────

type ReattestEligibility =
  | { ok: true }
  | { ok: false; reason: string };

const SERVER_PHASE_TO_MACRO: Record<string, string> = {
  triage: "pre-submit",
  ready_to_submit: "pre-submit",
  submitted: "in-flight",
  response_received: "response-pending",
  reviewed: "response-pending",
  awaiting_reattestation: "mas-action-required",
  closed: "closed",
};

function deriveServerMacroPhase(group: InvoiceGroupResponse): string {
  if (group.status === "On Hold") return "on-hold";
  if (group.reattestCompletedAt != null && group.phase !== "closed") {
    return "awaiting-payout";
  }
  if (group.phase && SERVER_PHASE_TO_MACRO[group.phase]) {
    return SERVER_PHASE_TO_MACRO[group.phase];
  }
  return "pre-submit";
}

export function canQueueOrCompleteReattest(
  group: InvoiceGroupResponse,
  // Optional Early Re-attest signal (Task #476). When the calling
  // surface has the legs in scope and has already derived
  // `outlook === "reattest_only"`, pass it in: the server's
  // `/reattest/queue` gate accepts that condition from any
  // non-terminal phase regardless of `phase`/`status` (see
  // invoice-groups.ts L3826-3905), and disabling the CTA on the
  // client when the server would accept is the wrong UX.
  outlook?: InvoiceDisputeOutlook,
): ReattestEligibility {
  const macro = deriveServerMacroPhase(group);
  if (macro === "mas-action-required") return { ok: true };
  if (macro === "response-pending" && group.status === "Needs Review") {
    return { ok: true };
  }
  // Early Re-attest: zero disputable legs + ≥1 survivor. Allowed
  // from any non-terminal/non-on-hold phase. The terminal cases
  // (closed, on-hold) still block below for the same reason the
  // server gate blocks them.
  if (
    outlook === "reattest_only"
    && macro !== "closed"
    && macro !== "on-hold"
  ) {
    return { ok: true };
  }
  // Map every blocking state to a plain-language explanation the
  // operator can act on without bouncing to engineering.
  if (macro === "on-hold") {
    return { ok: false, reason: "This invoice is on hold — release the hold before re-attesting." };
  }
  if (macro === "awaiting-payout") {
    return { ok: false, reason: "Re-attestation has already been recorded — waiting on payout, no further action here." };
  }
  if (macro === "closed") {
    return { ok: false, reason: "This invoice is closed — no further re-attestation is possible." };
  }
  if (macro === "in-flight") {
    return { ok: false, reason: "Waiting on the payor — re-attestation unlocks once a response lands and is routed for review." };
  }
  if (macro === "pre-submit") {
    return { ok: false, reason: "This invoice hasn't been submitted to the payor yet." };
  }
  // response-pending but status is "Ready to Review" — the response
  // has landed but hasn't been picked up for human review yet.
  return {
    ok: false,
    reason: "The payor response hasn't been routed for review yet — refresh in a moment, or pick it up from the Responses Awaiting Review page.",
  };
}

// ─────────────────────────────────────────────────────────────────────
// Task #476 — Invoice-level dispute outlook.
//
// Some invoices end triage with **zero dispute-worthy legs**: every leg
// is either Non-issue (the ride was fine, just needs to be re-attested
// in the payor portal) or Non-contestable / `cannot_dispute` /
// sibling-duplicate (nothing to argue). For these the entire dispute-
// submission section is dead weight — the only real action is to
// re-attest the survivors and cancel the dropped legs in the portal.
//
// This derivation lets the gauntlet's mount points decide on page load
// whether to render the dispute-submission section, the Re-attest CTA,
// or nothing.
//
//   - **Dispute-eligible leg** = `includedInDispute === true`, NOT a
//     sibling duplicate, NOT closed as `cannot_dispute` / `non_issue`,
//     AND verdict bucket is NOT `denied` from a prior payor response.
//     i.e. a leg that *would* go into a dispute submission today.
//   - **Survivor leg** = closure is `non_issue` OR verdict bucket is
//     `approved`. Needs re-attestation in the portal — feeds the
//     ReattestModal's `approvedLegs`.
//   - **Dropped leg** = closure is `cannot_dispute` OR sibling
//     duplicate. Goes into the modal's `deniedLegs` so the operator's
//     existing portal checklist tells them to cancel it.
//
// Outlook ladder:
//   - `has_disputable` if any dispute-eligible leg exists. Current
//     gauntlet behaviour is unchanged.
//   - else `reattest_only` if at least one survivor exists. Gauntlet
//     does NOT render; Re-attest CTA replaces it.
//   - else `nothing_to_do`. Neither renders; existing close-out path
//     takes over.
// ─────────────────────────────────────────────────────────────────────

export type InvoiceDisputeOutlook =
  | "has_disputable"
  | "reattest_only"
  | "nothing_to_do";

export interface InvoiceDisputeOutlookResult {
  outlook: InvoiceDisputeOutlook;
  /** Legs that need re-attestation in the portal (modal `approvedLegs`). */
  survivors: ClaimResponse[];
  /** Legs the operator should cancel in the portal (modal `deniedLegs`). */
  dropped: ClaimResponse[];
}

// ─────────────────────────────────────────────────────────────────────
// Task #555 — Generate Submission Preview gate state.
//
// The Generate Submission Preview CTA on invoice-group-detail-v2 is
// gated on FOUR conditions, in priority order:
//
//   1. `phase`        — group must still be in pre-submit. Mirrors the
//                       backend gate; once submitted the preview is
//                       moot. Reads `group.phase` via the canonical
//                       lifecycle-phase derivation.
//   2. `legs`         — at least one disputed leg must exist (the
//                       submission has nothing to write up otherwise).
//   3. `resolved`     — every disputed leg resolved (ready / dropped /
//                       excluded; sibling-duplicate legs follow their
//                       primary). Driven by the shared
//                       `buildLegResolvedIndex` so the UI gate cannot
//                       drift from the api-server's
//                       `evaluateDisputedLegsResolved`.
//   4. `readback`     — the operator has confirmed an understanding
//                       readback (#168). Required because the AI prompt
//                       relies on it to interpret the dispute reason.
//
// Returned object:
//   - `ok`               — green: every gate satisfied
//   - `missingGates`     — ordered list (highest-priority first) of
//                          gate keys that failed
//   - `reason`           — operator-facing tooltip copy naming the
//                          single highest-priority blocker
//   - `unresolvedSummary`— when the legs gate fails, a comma-separated
//                          breakdown of how many legs sit in each
//                          unresolved sub-status (drives the existing
//                          tooltip "(2 investigating, 1 blocked)")
// ─────────────────────────────────────────────────────────────────────

export type PreviewGateKey = "phase" | "legs" | "resolved" | "readback";

export interface PreviewGateState {
  ok: boolean;
  missingGates: PreviewGateKey[];
  reason: string | null;
  unresolvedSummary?: string;
  unresolvedCount: number;
}

interface PreviewGateGroup {
  status?: string | null;
  phase?: string | null;
  understandingReadbackAt?: string | null;
  reattestCompletedAt?: string | null;
}

export function derivePreviewGateState(
  group: PreviewGateGroup,
  allLegs: readonly ClaimResponse[],
): PreviewGateState {
  const phase = getGroupLifecyclePhaseFromGroup(group);
  const disputed = allLegs.filter((r) => r.includedInDispute !== false);
  const resolvedIndex = buildLegResolvedIndex(allLegs);
  const unresolved = disputed.filter((r) => !resolvedIndex.isLegResolved(r));
  const readbackConfirmed = !!group.understandingReadbackAt;

  const missingGates: PreviewGateKey[] = [];
  if (phase !== "pre-submit") missingGates.push("phase");
  if (disputed.length === 0) missingGates.push("legs");
  if (unresolved.length > 0) missingGates.push("resolved");
  if (!readbackConfirmed) missingGates.push("readback");

  let unresolvedSummary: string | undefined;
  if (unresolved.length > 0) {
    const counts = unresolved.reduce<Record<string, number>>((acc, r) => {
      const s = resolvedIndex.subStatusOf(r);
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});
    unresolvedSummary = Object.entries(counts)
      .map(([s, n]) => `${n} ${s.replace("_", " ")}`)
      .join(", ");
  }

  let reason: string | null = null;
  const top = missingGates[0];
  if (top === "phase") {
    reason = `Disabled because the group is past pre-submit (${group.status ?? "unknown status"}).`;
  } else if (top === "legs") {
    reason = "Disabled because this group has no legs included in the dispute.";
  } else if (top === "resolved") {
    reason = `Disabled because ${unresolved.length} leg${unresolved.length === 1 ? "" : "s"} still owe action (${unresolvedSummary ?? ""}).`;
  } else if (top === "readback") {
    reason = "Disabled because the understanding readback has not been confirmed yet.";
  }

  return {
    ok: missingGates.length === 0,
    missingGates,
    reason,
    unresolvedSummary,
    unresolvedCount: unresolved.length,
  };
}

export function deriveInvoiceDisputeOutlook(
  _group: InvoiceGroupResponse,
  legs: readonly ClaimResponse[],
): InvoiceDisputeOutlookResult {
  const survivors: ClaimResponse[] = [];
  const dropped: ClaimResponse[] = [];
  let hasDisputable = false;

  for (const leg of legs) {
    // Wave C: closure classification flows through `outcomeRole` (the
    // canonical helper in @workspace/leg-state), not the raw
    // `sopOutcome` column. `outcomeRole` already pre-empts duplicates,
    // but we keep a separate `isSiblingDuplicate` because a duplicate
    // leg is also dropped here (different bucket from cannot_dispute /
    // non_issue) and the role check would mask the underlying closure.
    const isSiblingDuplicate = leg.duplicateOfClaimId != null;
    const role = outcomeRole(leg);
    const isNonIssue = role === "non_issue";
    const isCannotDispute = role === "cannot_dispute";
    const verdict = legVerdictBucket(leg);

    if (isNonIssue || verdict === "approved") {
      survivors.push(leg);
    }
    if (isCannotDispute || isSiblingDuplicate) {
      dropped.push(leg);
    }

    if (
      leg.includedInDispute === true &&
      !isSiblingDuplicate &&
      !isCannotDispute &&
      !isNonIssue &&
      verdict !== "denied"
    ) {
      hasDisputable = true;
    }
  }

  if (hasDisputable) {
    return { outlook: "has_disputable", survivors, dropped };
  }
  if (survivors.length > 0) {
    return { outlook: "reattest_only", survivors, dropped };
  }
  return { outlook: "nothing_to_do", survivors, dropped };
}

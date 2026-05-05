import type { ClaimResponse, InvoiceGroupResponse, PortalResponseItem } from "@workspace/api-client-react";
import { outcomeRole } from "@workspace/leg-state";

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

function legVerdictBucket(r: ClaimResponse): "approved" | "denied" | "pending" {
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

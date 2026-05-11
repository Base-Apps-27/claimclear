// Per-row bulk-action eligibility for the invoice-group list endpoint
// (Task #702). Surfaces what every bulk-* endpoint already enforces so
// the UI can show "Queue 5 of 100 selected for portal submission" *before*
// the click and refuse to submit ineligible rows in the first place.
//
// Reason codes mirror the `skipped[]` reason strings the bulk endpoints
// emit so a single human-readable map covers both pre-click labels and
// the post-click skipped-toast.
//
// Parity contract:
// The leg-shape predicates (isLegNonIssue / isLegCannotDispute /
// isLegApprovedSurvivor / isLegHardSurvivor / isLegDisputable) are
// exported and reused by the bulk-reattest and bulk-close endpoints
// so list-side eligibility and write-side gates cannot drift. The
// reattest per-leg verdict-source check (see
// `isReattestEligibleLeg`) takes the verdict-confirmed leg-id set
// the caller looked up via batch query so list eligibility matches
// bulk-reattest's `eligibleLegs.length === 0` short-circuit exactly.

import { evaluateDisputedLegsResolved } from "./group-readiness";
import { computeGroupReadiness } from "./group-packaging";
import { getGroupMacroPhase, type GroupForMacroPhase } from "./macro-phase";

export type EligibilityAction =
  | "applyErrorType"
  | "submitToPortal"
  | "generateAndReview"
  | "reattest"
  | "close";

export interface EligibilityFlag {
  eligible: boolean;
  /** Stable reason code; null when `eligible === true`. */
  reason: string | null;
}

export type GroupEligibility = Record<EligibilityAction, EligibilityFlag>;

const OK: EligibilityFlag = { eligible: true, reason: null };

interface GroupForEligibility extends GroupForMacroPhase {
  status: string | null;
  isTourSample?: boolean | null;
  errorTypeId?: string | null;
  draftReviewedAt?: Date | string | null;
  draftDescriptionHtml?: string | null;
}

export interface LegForEligibility {
  id: number;
  includedInDispute: boolean | null;
  duplicateOfClaimId: number | null;
  disposition: string | null;
  sopOutcome: string | null;
  outcome: string | null;
  holdReason?: string | null;
  errorTypeId?: string | null;
  status?: string | null;
  attestationState?: string | null;
}

// ---- shared per-leg predicates (also used by bulk-reattest/bulk-close)

export function isLegNonIssue(leg: Pick<LegForEligibility, "disposition" | "sopOutcome">): boolean {
  return (
    leg.disposition === "disposed_nonissue" ||
    leg.disposition === "final_nonissue" ||
    leg.sopOutcome === "non_issue"
  );
}

export function isLegCannotDispute(leg: Pick<LegForEligibility, "disposition" | "sopOutcome">): boolean {
  return (
    leg.disposition === "disposed_withdraw" ||
    leg.disposition === "final_withdrawn" ||
    leg.sopOutcome === "cannot_dispute"
  );
}

export function isLegApprovedSurvivor(leg: Pick<LegForEligibility, "outcome">): boolean {
  return leg.outcome === "Approved" || leg.outcome === "Partially Approved";
}

export function isLegHardSurvivor(leg: Pick<LegForEligibility, "disposition" | "sopOutcome" | "outcome">): boolean {
  return isLegNonIssue(leg) || isLegApprovedSurvivor(leg);
}

export function isLegDisputable(
  leg: Pick<
    LegForEligibility,
    "includedInDispute" | "duplicateOfClaimId" | "disposition" | "sopOutcome" | "outcome"
  >,
): boolean {
  if (leg.includedInDispute !== true) return false;
  if (leg.duplicateOfClaimId != null) return false;
  if (isLegNonIssue(leg)) return false;
  if (isLegCannotDispute(leg)) return false;
  if (leg.outcome === "Denied") return false;
  return true;
}

/**
 * Mirrors bulk-reattest's per-leg `eligibleLegs` filter. Returns true
 * when this leg would be queued for re-attestation by the bulk
 * endpoint. Approved-survivor legs additionally require the latest
 * `claim_verdict` row to be `source=operator_confirmed` with an
 * Approved/Partial outcome — the caller passes that information via
 * `verdictConfirmedLegIds` (built once with a batch query).
 */
export function isReattestEligibleLeg(
  leg: LegForEligibility,
  verdictConfirmedLegIds: ReadonlySet<number>,
): boolean {
  if (leg.attestationState === "completed" || leg.attestationState === "queued") return false;
  if (leg.duplicateOfClaimId != null) return false;
  if (isLegNonIssue(leg)) return true;
  if (!isLegApprovedSurvivor(leg)) return false;
  return verdictConfirmedLegIds.has(leg.id);
}

export function computeGroupEligibility(
  group: GroupForEligibility,
  legs: ReadonlyArray<LegForEligibility>,
  hasActiveSubmission: boolean,
  verdictConfirmedLegIds: ReadonlySet<number> = new Set(),
): GroupEligibility {
  const isTourSample = group.isTourSample === true;
  const phase = getGroupMacroPhase(group);

  // Apply error type — universally eligible. The bulk-assign-error-type
  // endpoint does not gate on tour-sample / phase / readiness; any
  // group can have an error type tagged at any time.
  const applyErrorType: EligibilityFlag = OK;

  // Submit to portal — mirrors POST /invoice-groups/bulk-submit-to-portal.
  // (Endpoint does not gate on tour_sample, so list-side eligibility
  // doesn't either — keeps UI from being stricter than the server.)
  let submitToPortal: EligibilityFlag;
  if (phase !== "pre-submit") {
    submitToPortal = { eligible: false, reason: "not_pre_submit" };
  } else if (hasActiveSubmission) {
    submitToPortal = { eligible: false, reason: "already_submitted" };
  } else if (
    !group.errorTypeId &&
    !legs.some((l) => l.errorTypeId != null && l.errorTypeId !== "")
  ) {
    submitToPortal = { eligible: false, reason: "error_type_unset" };
  } else if (group.draftReviewedAt == null) {
    submitToPortal = { eligible: false, reason: "not_reviewed" };
  } else if (!(group.draftDescriptionHtml ?? "").trim()) {
    submitToPortal = { eligible: false, reason: "draft_empty" };
  } else {
    const r = evaluateDisputedLegsResolved(
      legs.map((l) => ({
        ...l,
        holdReason: l.holdReason ?? null,
      })),
    );
    submitToPortal = r.ok
      ? OK
      : { eligible: false, reason: "legs_unresolved" };
  }

  // Generate & mark for approval — mirrors POST /invoice-groups/bulk-generate-and-review.
  // (Endpoint does not gate on tour_sample, so list-side eligibility
  // doesn't either — keeps UI from being stricter than the server.)
  let generateAndReview: EligibilityFlag;
  if (group.draftReviewedAt != null) {
    generateAndReview = { eligible: false, reason: "already_reviewed" };
  } else {
    const readiness = computeGroupReadiness(
      group,
      legs.map((l) => ({
        ...l,
        holdReason: l.holdReason ?? null,
        errorTypeId: l.errorTypeId ?? null,
      })),
    );
    generateAndReview = readiness.ready
      ? OK
      : { eligible: false, reason: "not_packageable" };
  }

  // Re-attest — mirrors POST /invoice-groups/bulk-reattest exactly,
  // including the per-leg verdict-source check via the
  // `verdictConfirmedLegIds` set the caller passed in.
  let reattest: EligibilityFlag;
  const hasDisputable = legs.some(isLegDisputable);
  const hasSurvivor = legs.some(isLegHardSurvivor);
  if (isTourSample) {
    reattest = { eligible: false, reason: "tour_sample" };
  } else if (phase === "closed" || phase === "on-hold") {
    reattest = { eligible: false, reason: "terminal_phase" };
  } else if (hasDisputable) {
    reattest = { eligible: false, reason: "has_disputable_legs" };
  } else if (!hasSurvivor) {
    reattest = { eligible: false, reason: "no_survivors" };
  } else if (!legs.some((l) => isReattestEligibleLeg(l, verdictConfirmedLegIds))) {
    reattest = { eligible: false, reason: "no_eligible_legs" };
  } else {
    reattest = OK;
  }

  // Close — mirrors POST /invoice-groups/bulk-close.
  let close: EligibilityFlag;
  if (isTourSample) {
    close = { eligible: false, reason: "tour_sample" };
  } else if (phase === "closed") {
    close = { eligible: false, reason: "already_closed" };
  } else if (legs.length === 0) {
    close = { eligible: false, reason: "no_legs" };
  } else if (hasDisputable) {
    close = { eligible: false, reason: "has_disputable_legs" };
  } else if (hasSurvivor) {
    close = { eligible: false, reason: "has_survivors" };
  } else {
    close = OK;
  }

  return {
    applyErrorType,
    submitToPortal,
    generateAndReview,
    reattest,
    close,
  };
}

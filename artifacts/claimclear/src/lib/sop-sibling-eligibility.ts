// Sibling-duplicate eligibility — shared by the in-SOP prompt and the
// claim-detail-v2 header dialog so they can never disagree (Guard #4).

export interface SiblingErrorTypeLite {
  id: number | string;
  tripOverriding?: boolean | null;
}

export interface SiblingCandidateLeg {
  id: number;
  errorTypeId?: number | string | null;
  duplicateOfClaimId?: number | null;
  confNumber?: string | null;
  errorTypeName?: string | null;
}

export function buildTripOverridingErrorTypeIds(
  errorTypes: readonly SiblingErrorTypeLite[] | undefined | null,
): Set<string> {
  const set = new Set<string>();
  if (!errorTypes) return set;
  for (const t of errorTypes) {
    if (t.tripOverriding === true) set.add(String(t.id));
  }
  return set;
}

export function findSiblingDuplicatePrimaryCandidates(opts: {
  selfClaimId: number;
  rides: readonly SiblingCandidateLeg[] | undefined | null;
  tripOverridingErrorTypeIds: ReadonlySet<string>;
}): SiblingCandidateLeg[] {
  const { selfClaimId, rides, tripOverridingErrorTypeIds } = opts;
  if (!rides) return [];
  return rides
    .filter((r) => r.id !== selfClaimId)
    .filter((r) => r.duplicateOfClaimId == null)
    .filter(
      (r) =>
        r.errorTypeId != null &&
        tripOverridingErrorTypeIds.has(String(r.errorTypeId)),
    )
    .sort((a, b) => (a.confNumber || "").localeCompare(b.confNumber || ""));
}

// Eligibility predicate for the in-SOP sibling-detection prompt.
// Requires: pre-submit phase, self leg not already a duplicate, self
// leg's OWN error type is trip-overriding, and ≥1 other trip-overriding
// primary candidate in the same group.

export interface SiblingPromptEligibilityInput {
  selfClaimId: number;
  selfErrorTypeId?: number | string | null;
  selfDuplicateOfClaimId?: number | null;
  groupMacroPhase?: string | null;
  rides: readonly SiblingCandidateLeg[] | undefined | null;
  errorTypes: readonly SiblingErrorTypeLite[] | undefined | null;
}

export interface SiblingPromptEligibility {
  primary: SiblingCandidateLeg;
}

export function siblingPromptEligibilityFor(
  input: SiblingPromptEligibilityInput,
): SiblingPromptEligibility | null {
  if (input.selfDuplicateOfClaimId != null) return null;
  if (input.groupMacroPhase !== "pre-submit") return null;
  const ids = buildTripOverridingErrorTypeIds(input.errorTypes);
  if (ids.size === 0) return null;
  if (input.selfErrorTypeId == null) return null;
  if (!ids.has(String(input.selfErrorTypeId))) return null;
  const candidates = findSiblingDuplicatePrimaryCandidates({
    selfClaimId: input.selfClaimId,
    rides: input.rides,
    tripOverridingErrorTypeIds: ids,
  });
  if (candidates.length === 0) return null;
  return { primary: candidates[0] };
}

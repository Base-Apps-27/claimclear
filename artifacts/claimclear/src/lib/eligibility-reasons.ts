// Task #702 — single plain-English map for the bulk-action eligibility
// reason codes returned by `GET /invoice-groups` (per-row `eligibility`
// object) and the post-click `skipped[]` arrays from every bulk-*
// endpoint. Used by the rail action labels, the per-row "ineligible"
// tooltip, and the post-click toast so all three surfaces speak the
// same language.

export type EligibilityReason =
  | "tour_sample"
  | "not_pre_submit"
  | "already_submitted"
  | "error_type_unset"
  | "not_reviewed"
  | "draft_empty"
  | "legs_unresolved"
  | "already_reviewed"
  | "not_packageable"
  | "terminal_phase"
  | "has_disputable_legs"
  | "no_survivors"
  | "has_survivors"
  | "already_closed"
  | "no_legs"
  // Server-side bulk endpoints emit a few extra codes we never compute
  // on the list endpoint but should still translate when a `skipped[]`
  // entry surfaces them in the post-click toast.
  | "no_eligible_legs"
  | "no_legs_eligible"
  | "not_packageable_status"
  | "request_failed";

const REASONS: Record<EligibilityReason, string> = {
  tour_sample: "Tour-sample groups can't be acted on in bulk.",
  not_pre_submit: "Group has already moved past pre-submit.",
  already_submitted: "A portal submission is already in flight.",
  error_type_unset: "Error type isn't set yet.",
  not_reviewed: "Draft hasn't been marked reviewed.",
  draft_empty: "Dispute write-up is empty.",
  legs_unresolved: "Some disputed legs aren't resolved yet.",
  already_reviewed: "Draft is already marked reviewed.",
  not_packageable: "Write-up isn't ready to generate yet.",
  terminal_phase: "Group is closed or on hold.",
  has_disputable_legs: "Group still has disputable legs to work.",
  no_survivors: "No surviving legs left to re-attest.",
  has_survivors: "Surviving legs remain — can't close as withdrawn.",
  already_closed: "Group is already closed.",
  no_legs: "Group has no legs.",
  no_eligible_legs: "No legs are eligible for this action.",
  no_legs_eligible: "No legs are eligible for this action.",
  not_packageable_status: "Group's status doesn't allow packaging.",
  request_failed: "Request failed. Try again.",
};

/** Plain-English explanation for a reason code, with a sane fallback.
 *  A few server endpoints prefix a base code with extra context
 *  (e.g. `not_packageable: missing_error_type`); we strip the suffix
 *  so the toast still reads in plain English instead of a raw code. */
export function explainEligibilityReason(reason: string | null | undefined): string {
  if (!reason) return "Not eligible.";
  const base = reason.includes(":") ? reason.split(":")[0]!.trim() : reason;
  if (base in REASONS) return REASONS[base as EligibilityReason];
  if (reason in REASONS) return REASONS[reason as EligibilityReason];
  return reason;
}

export type ClosureCategory = {
  value: string;
  label: string;
};

export type ClosureRootCause = {
  value: string;
  label: string;
};

export const CLOSURE_CATEGORIES: ClosureCategory[] = [
  { value: "gps_missing", label: "GPS / tracking missing" },
  { value: "gps_partial", label: "GPS / tracking partial" },
  { value: "signature_missing", label: "Signature missing" },
  { value: "odometer_off", label: "Odometer off / mismatch" },
  { value: "documentation_lost", label: "Documentation lost" },
  { value: "member_unreachable", label: "Member unreachable" },
  { value: "wrong_error_type", label: "Wrong error type" },
  { value: "data_quirk", label: "Data quirk in upload" },
  { value: "already_paid", label: "Already paid" },
  { value: "duplicate_claim", label: "Duplicate claim" },
  { value: "other", label: "Other" },
];

const OTHER_ROOT_CAUSE: ClosureRootCause = {
  value: "other",
  label: "Other (specify)",
};

const GPS_MISSING_BASE: ClosureRootCause[] = [
  { value: "tracking_late_assigned_too_early", label: "Driver started tracking late — assigned too early before pickup" },
  { value: "tracking_late_forgot_at_pickup", label: "Driver started tracking late — forgot at pickup" },
  { value: "device_offline", label: "Driver device offline / no signal" },
  { value: "app_crashed", label: "Tracking app crashed mid-trip" },
  { value: "trip_never_assigned", label: "Trip never assigned to a tracked driver" },
  { value: "logs_empty_possible_bug", label: "Logs exist but are empty/corrupt — possible system bug" },
  { value: "unknown", label: "Unknown / cannot determine" },
];

export const ROOT_CAUSES_BY_CATEGORY: Record<string, ClosureRootCause[]> = {
  gps_missing: [...GPS_MISSING_BASE, OTHER_ROOT_CAUSE],
  gps_partial: [
    ...GPS_MISSING_BASE,
    { value: "pickup_dropoff_outside_radius", label: "Pickup or dropoff GPS recorded outside acceptable radius" },
    OTHER_ROOT_CAUSE,
  ],
  signature_missing: [
    { value: "member_refused", label: "Member refused to sign" },
    { value: "driver_forgot", label: "Driver forgot to capture" },
    { value: "tablet_failure", label: "Tablet/app failure at pickup" },
    { value: "captured_not_uploaded", label: "Captured but not uploaded" },
    { value: "logs_signature_absent_possible_bug", label: "Logs exist but signature absent — possible system bug" },
    { value: "unknown", label: "Unknown" },
    OTHER_ROOT_CAUSE,
  ],
  odometer_off: [
    { value: "wrong_start_odometer", label: "Driver entered wrong start odometer" },
    { value: "wrong_end_odometer", label: "Driver entered wrong end odometer" },
    { value: "not_captured", label: "Reading not captured" },
    { value: "calc_mismatch_gps", label: "Calculation mismatch with GPS path" },
    { value: "unknown", label: "Unknown" },
    OTHER_ROOT_CAUSE,
  ],
  documentation_lost: [
    { value: "trip_sheet_missing", label: "Trip sheet missing" },
    { value: "authorization_missing", label: "Authorization paperwork missing" },
    { value: "member_id_missing", label: "Member ID copy missing" },
    { value: "unknown", label: "Unknown" },
    OTHER_ROOT_CAUSE,
  ],
  member_unreachable: [
    { value: "phone_disconnected", label: "Phone disconnected" },
    { value: "member_moved", label: "Member moved" },
    { value: "wrong_number", label: "Wrong number on file" },
    { value: "no_response", label: "No response after multiple attempts" },
    OTHER_ROOT_CAUSE,
  ],
  wrong_error_type: [
    { value: "original_misclassified", label: "Original triage mis-classified" },
    { value: "payor_reason_changed", label: "Payor reason changed after re-review" },
    OTHER_ROOT_CAUSE,
  ],
  data_quirk: [
    { value: "date_format_mismatch", label: "Date format mismatch in upload" },
    { value: "duplicate_ride_row", label: "Duplicate ride row" },
    { value: "stale_roster", label: "Stale roster" },
    OTHER_ROOT_CAUSE,
  ],
  already_paid: [
    { value: "paid_prior_cycle", label: "Paid in prior cycle" },
    { value: "paid_different_invoice", label: "Paid under different invoice" },
    OTHER_ROOT_CAUSE,
  ],
  duplicate_claim: [
    { value: "duplicate_within_batch", label: "Duplicate within batch" },
    { value: "duplicate_across_batches", label: "Duplicate across batches" },
    OTHER_ROOT_CAUSE,
  ],
  other: [],
};

export type ClosureAccountabilityTag =
  | "driver"
  | "dispatcher"
  | "member"
  | "it_system"
  | "our_staff"
  | "external_payor"
  | "other";

export const CLOSURE_ACCOUNTABILITY_TAGS: { value: ClosureAccountabilityTag; label: string }[] = [
  { value: "driver", label: "Driver" },
  { value: "dispatcher", label: "Dispatcher / Assigning Agent" },
  { value: "member", label: "Member" },
  { value: "it_system", label: "IT / System" },
  { value: "our_staff", label: "Our Staff" },
  { value: "external_payor", label: "External / Payor System" },
  { value: "other", label: "Other" },
];

export type ClosureReasonKey = "not_contestable" | "non_issue" | "accepted_loss";

export const CLOSURE_REASON_BANNER: Record<
  ClosureReasonKey,
  { label: string; description: string; bannerClass: string; submitLabel: string; submitClass: string }
> = {
  not_contestable: {
    label: "Cannot Dispute",
    description:
      "We worked the case but the evidence we'd need doesn't exist or isn't recoverable. The dollars stay lost.",
    bannerClass: "bg-amber-50 border-amber-200 text-amber-900",
    submitLabel: "Mark Cannot Dispute",
    submitClass: "bg-amber-600 hover:bg-amber-700 text-white border-amber-700",
  },
  non_issue: {
    label: "Non-Issue",
    description:
      "On closer look, this isn't actually a billing error — nothing for us to dispute.",
    bannerClass: "bg-blue-50 border-blue-200 text-blue-900",
    submitLabel: "Mark Non-Issue",
    submitClass: "bg-blue-600 hover:bg-blue-700 text-white border-blue-700",
  },
  accepted_loss: {
    label: "Accepted Loss",
    description:
      "We received a denial and have decided to accept the loss rather than re-dispute. The dollars stay lost.",
    bannerClass: "bg-stone-50 border-stone-200 text-stone-900",
    submitLabel: "Mark Accepted Loss",
    submitClass: "bg-stone-700 hover:bg-stone-800 text-white border-stone-800",
  },
};

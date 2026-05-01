import type { GlossaryEntry } from "./domains";

// Per-leg hold reason. Underlying enum: `LEG_HOLD_REASONS` in
// `@workspace/leg-state` (mirrors the DB CHECK constraint).
export const HOLD_REASONS = [
  "evidence_pending",
  "awaiting_external_party",
  "awaiting_member_response",
  "awaiting_internal_review",
  "other",
] as const;

export type HoldReason = typeof HOLD_REASONS[number];

export const HOLD_REASON: Record<HoldReason, GlossaryEntry> = {
  evidence_pending: {
    enumValue: "evidence_pending",
    label: "Awaiting evidence",
    description: "Leg is parked because the evidence we need hasn't arrived yet.",
    domain: "hold_reason",
  },
  awaiting_external_party: {
    enumValue: "awaiting_external_party",
    label: "Awaiting external party (e.g. payor, hospital)",
    description: "Leg is parked because we're waiting on someone outside the organisation.",
    domain: "hold_reason",
  },
  awaiting_member_response: {
    enumValue: "awaiting_member_response",
    label: "Awaiting member response",
    description: "Leg is parked because we've reached out to the member and haven't heard back.",
    domain: "hold_reason",
  },
  awaiting_internal_review: {
    enumValue: "awaiting_internal_review",
    label: "Awaiting internal review (e.g. supervisor, MAS)",
    description: "Leg is parked pending a sign-off from someone inside the organisation.",
    domain: "hold_reason",
  },
  other: {
    enumValue: "other",
    label: "Other (specify below)",
    description: "Leg is parked for a reason that doesn't fit the standard buckets — must be explained in a note.",
    domain: "hold_reason",
  },
};

export function holdReasonLabel(reason: string): string {
  return HOLD_REASON[reason as HoldReason]?.label ?? reason;
}

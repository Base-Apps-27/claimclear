import type { GlossaryEntry } from "./domains";

// Verdict outcome — the response classification recorded against an
// inbound payor message during the Responses Awaiting Review queue.
// Underlying enum: `verdict_outcome` enum on the `claim_responses` row.

export const VERDICT_OUTCOMES = [
  "approved",
  "denied",
  "partially_approved",
  "needs_more_info",
  "no_decision",
] as const;

export type VerdictOutcome = typeof VERDICT_OUTCOMES[number];

export const VERDICT_OUTCOME: Record<VerdictOutcome, GlossaryEntry> = {
  approved: {
    enumValue: "approved",
    label: "Approved",
    description: "The payor approved the dispute.",
    domain: "verdict_outcome",
  },
  denied: {
    enumValue: "denied",
    label: "Denied",
    description: "The payor denied the dispute.",
    domain: "verdict_outcome",
  },
  partially_approved: {
    enumValue: "partially_approved",
    label: "Partially approved",
    description: "The payor approved part of the disputed amount.",
    domain: "verdict_outcome",
  },
  needs_more_info: {
    enumValue: "needs_more_info",
    label: "Needs more info",
    description: "The payor asked for additional information before making a decision.",
    domain: "verdict_outcome",
  },
  no_decision: {
    enumValue: "no_decision",
    label: "No decision",
    description: "Inbound message does not contain a verdict — typically a status update or acknowledgement.",
    domain: "verdict_outcome",
  },
};

export function verdictOutcomeLabel(outcome: string): string {
  return VERDICT_OUTCOME[outcome as VerdictOutcome]?.label ?? outcome;
}

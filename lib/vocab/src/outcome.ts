import type { GlossaryEntry } from "./domains";

// ─────────────────────────────────────────────────────────────────────────
// Group / claim outcome — terminal verdict on a workflow.
// Underlying enum: DB column `outcome` on `claims` / `invoice_groups`,
// surfaced through the OpenAPI spec at `lib/api-spec/openapi.yaml:3864`.
//
// IMPORTANT: the enum value `"Non-Issue"` (TitleCase, hyphenated) MUST
// stay as-is in API contracts and the database to avoid an API break.
// The *rendered* label is `"Non-issue"` (sentence case) at every UI
// surface — this glossary is what bridges the two.
// ─────────────────────────────────────────────────────────────────────────

export const OUTCOMES = [
  "Pending",
  "Approved",
  "Denied",
  "Partially Approved",
  "Non-Issue",
  "Withdrawn",
] as const;

export type Outcome = typeof OUTCOMES[number];

export const OUTCOME: Record<Outcome, GlossaryEntry> = {
  "Pending": {
    enumValue: "Pending",
    label: "Pending",
    description: "Outcome has not yet been determined. The claim is still being processed.",
    domain: "outcome",
  },
  "Approved": {
    enumValue: "Approved",
    label: "Approved",
    description: "The payor approved the dispute. Funds should be recovered.",
    domain: "outcome",
  },
  "Denied": {
    enumValue: "Denied",
    label: "Denied",
    description: "The payor returned a denial as the final outcome.",
    domain: "outcome",
  },
  "Partially Approved": {
    enumValue: "Partially Approved",
    label: "Partially Approved",
    description: "The payor approved part of the disputed amount. Review approved vs. claimed.",
    domain: "outcome",
  },
  "Non-Issue": {
    // enumValue stays TitleCase — it's the OpenAPI/DB value. The rendered
    // label is sentence case so it reads consistently across the UI.
    enumValue: "Non-Issue",
    label: "Non-issue",
    description: "Classified as non-issue. No action needed — financial impact set to $0.",
    domain: "outcome",
  },
  "Withdrawn": {
    enumValue: "Withdrawn",
    label: "Withdrawn",
    description: "Dispute was withdrawn before resolution. See the closure reason for context.",
    domain: "outcome",
  },
};

export function outcomeLabel(outcome: string | null | undefined): string {
  if (!outcome) return "";
  return OUTCOME[outcome as Outcome]?.label ?? outcome;
}

export function outcomeDescription(outcome: string): string | undefined {
  return OUTCOME[outcome as Outcome]?.description;
}

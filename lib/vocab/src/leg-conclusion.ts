import type { GlossaryEntry } from "./domains";

// ─────────────────────────────────────────────────────────────────────────
// Leg conclusion — the three-button vocabulary locked in by Task #265.
// Used on Queue Panel A (LegConclusionRow) and anywhere a leg is being
// concluded inline (not via the SOP walk).
//
// Underlying enum: the `reason` field on POST /claims/:id/conclude-leg
// and the `sopOutcome` column on the `claims` row.
//
// COLLISION DECISION: "Non-issue" (here) is the same canonical word as
// the *outcome* "Non-issue". They are semantically the same concept at
// two layers (one leg vs the whole claim/group), so unifying the label
// is intentional. The leg-level form is also used when the auto-non-
// issue-blank-sibling rule fires — same word, same meaning.
// ─────────────────────────────────────────────────────────────────────────

export const LEG_CONCLUSIONS = [
  "sop",
  "non_issue",
  "cannot_dispute",
] as const;

export type LegConclusion = typeof LEG_CONCLUSIONS[number];

export const LEG_CONCLUSION: Record<LegConclusion, GlossaryEntry> = {
  sop: {
    enumValue: "sop",
    label: "Open SOP",
    description: "Walk the existing SOP decision tree to investigate this leg.",
    domain: "leg_conclusion",
  },
  non_issue: {
    enumValue: "non_issue",
    label: "Non-issue",
    description: "Drop the leg as not actually a billing issue — nothing to dispute.",
    domain: "leg_conclusion",
  },
  cannot_dispute: {
    enumValue: "cannot_dispute",
    label: "Non-contestable",
    description: "Drop the leg as something we cannot push back on — evidence isn't recoverable.",
    domain: "leg_conclusion",
  },
};

export function legConclusionLabel(c: string): string {
  return LEG_CONCLUSION[c as LegConclusion]?.label ?? c;
}

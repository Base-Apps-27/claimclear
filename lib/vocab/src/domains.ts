// The set of operator-facing domains the glossary covers. Every term in
// the glossary belongs to exactly one domain so consumers can ask "what
// labels exist for X?" without scanning the whole index.
export type VocabDomain =
  | "claim_status"
  | "outcome"
  | "leg_sub_status"
  | "leg_conclusion"
  | "closure_reason"
  | "hold_reason"
  | "submission_stage"
  | "audit_action"
  | "verb"
  | "verdict_outcome"
  | "invoice_phase"
  | "claim_disposition";

export interface GlossaryEntry {
  /** Underlying enum value (DB / OpenAPI). MUST NOT be displayed directly. */
  enumValue: string;
  /** Canonical operator-facing label. Single source of truth. */
  label: string;
  /** One-line meaning shown in tooltips / docs. */
  description: string;
  /** Which domain this term lives in. */
  domain: VocabDomain;
}

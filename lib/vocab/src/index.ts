// @workspace/vocab — single source of truth for every operator-facing
// label in ClaimClear. The glossary keys labels by enum value so DB and
// OpenAPI never need to rename. Adding a new label? Add it here first,
// then call into the appropriate helper from your component.
//
// Companion docs: `docs/vocabulary.md` (rendered tables per domain).

export * from "./domains";
export * from "./claim-status";
export * from "./outcome";
export * from "./leg-sub-status";
export * from "./leg-conclusion";
export * from "./closure-reason";
export * from "./closure-review-state";
export * from "./hold-reason";
export * from "./submission-stage";
export * from "./audit-action";
export * from "./verbs";
export * from "./verdict-outcome";
export * from "./invoice-phase";
export * from "./claim-disposition";
export * from "./forbidden-literals";
export * from "./pii-headers";
// Task #888 — closure-responsibility labels (Agent/Driver/System/External/None
// → Contact Center Manager / Contractor Relations Coordinator / IT-COO).
// Re-exported from the shared package so every surface that mentions the
// new responsibility column reads from one source of truth.
export {
  CLOSURE_RESPONSIBILITIES,
  CLOSURE_RESPONSIBLE_ROLES,
  CLOSURE_RESPONSIBILITY_LABELS,
  CLOSURE_RESPONSIBLE_ROLE_LABELS,
  RESPONSIBILITY_TO_ROLE,
  closureResponsibilityLabel,
  closureResponsibleRoleLabel,
  roleForResponsibility,
  isClosureResponsibility,
  type ClosureResponsibility,
  type ClosureResponsibleRole,
} from "@workspace/closure-responsibility";

import type { GlossaryEntry, VocabDomain } from "./domains";
import { CLAIM_STATUS } from "./claim-status";
import { OUTCOME } from "./outcome";
import { LEG_SUB_STATUS } from "./leg-sub-status";
import { LEG_CONCLUSION } from "./leg-conclusion";
import { CLOSURE_REASON } from "./closure-reason";
import { HOLD_REASON } from "./hold-reason";
import { SUBMISSION_STAGE } from "./submission-stage";
import { AUDIT_ACTIONS } from "./audit-action";
import { VERB } from "./verbs";
import { VERDICT_OUTCOME } from "./verdict-outcome";
import { INVOICE_PHASE } from "./invoice-phase";
import { CLAIM_DISPOSITION } from "./claim-disposition";

// Flat catalogue of every glossary entry — used by docs generation and
// completeness tests. Keys are scoped by domain to avoid enum-value
// collisions across domains (e.g. "denied" exists in both outcome and
// verdict_outcome).
export const GLOSSARY: Array<GlossaryEntry & { key: string }> = [
  ...Object.entries(CLAIM_STATUS).map(([k, v]) => ({ ...v, key: `claim_status:${k}` })),
  ...Object.entries(OUTCOME).map(([k, v]) => ({ ...v, key: `outcome:${k}` })),
  ...Object.entries(LEG_SUB_STATUS).map(([k, v]) => ({ ...v, key: `leg_sub_status:${k}` })),
  ...Object.entries(LEG_CONCLUSION).map(([k, v]) => ({ ...v, key: `leg_conclusion:${k}` })),
  ...Object.entries(CLOSURE_REASON).map(([k, v]) => ({ ...v, key: `closure_reason:${k}` })),
  ...Object.entries(HOLD_REASON).map(([k, v]) => ({ ...v, key: `hold_reason:${k}` })),
  ...Object.entries(SUBMISSION_STAGE).map(([k, v]) => ({ ...v, key: `submission_stage:${k}` })),
  ...Object.entries(AUDIT_ACTIONS).map(([k, v]) => ({ ...v, key: `audit_action:${k}` })),
  ...Object.entries(VERB).map(([k, v]) => ({ ...v, key: `verb:${k}` })),
  ...Object.entries(VERDICT_OUTCOME).map(([k, v]) => ({ ...v, key: `verdict_outcome:${k}` })),
  ...Object.entries(INVOICE_PHASE).map(([k, v]) => ({ ...v, key: `invoice_phase:${k}` })),
  ...Object.entries(CLAIM_DISPOSITION).map(([k, v]) => ({ ...v, key: `claim_disposition:${k}` })),
];

export function entriesForDomain(domain: VocabDomain): GlossaryEntry[] {
  return GLOSSARY.filter((e) => e.domain === domain);
}

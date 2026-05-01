import type { GlossaryEntry } from "./domains";

// Operator verbs — short button labels that describe an action the user
// is about to take. Centralised so we don't end up with three buttons in
// three places that all want to say "Mark non-issue" but spell it
// differently.

export const VERBS = {
  markNonIssue: "Mark Non-issue",
  markCannotDispute: "Mark Non-contestable",
  withdrawFromDispute: "Withdraw from dispute",
  approveDispute: "Approve dispute",
  resolveGroup: "Resolve group",
  denyGroup: "Deny group",
  closeClaim: "Close claim",
  reopenClaim: "Re-open claim",
  reattest: "Re-attest in payor portal",
  queueForReattest: "Queue for re-attestation",
} as const;

export type VerbKey = keyof typeof VERBS;

export const VERB: Record<VerbKey, GlossaryEntry> = {
  markNonIssue: {
    enumValue: "markNonIssue",
    label: VERBS.markNonIssue,
    description: "Action: classify the leg / claim / group as non-issue.",
    domain: "verb",
  },
  markCannotDispute: {
    enumValue: "markCannotDispute",
    label: VERBS.markCannotDispute,
    description: "Action: drop the leg as non-contestable (no recoverable evidence).",
    domain: "verb",
  },
  withdrawFromDispute: {
    enumValue: "withdrawFromDispute",
    label: VERBS.withdrawFromDispute,
    description: "Action: pull the dispute back without sending it to the payor.",
    domain: "verb",
  },
  approveDispute: {
    enumValue: "approveDispute",
    label: VERBS.approveDispute,
    description: "Action: record an approved verdict on the dispute.",
    domain: "verb",
  },
  resolveGroup: {
    enumValue: "resolveGroup",
    label: VERBS.resolveGroup,
    description: "Action: mark the invoice group as resolved.",
    domain: "verb",
  },
  denyGroup: {
    enumValue: "denyGroup",
    label: VERBS.denyGroup,
    description: "Action: mark the invoice group as denied.",
    domain: "verb",
  },
  closeClaim: {
    enumValue: "closeClaim",
    label: VERBS.closeClaim,
    description: "Action: close the claim with a structured closure reason.",
    domain: "verb",
  },
  reopenClaim: {
    enumValue: "reopenClaim",
    label: VERBS.reopenClaim,
    description: "Action: re-open a previously closed claim.",
    domain: "verb",
  },
  reattest: {
    enumValue: "reattest",
    label: VERBS.reattest,
    description: "Action: confirm the attestation was already done in the payor portal.",
    domain: "verb",
  },
  queueForReattest: {
    enumValue: "queueForReattest",
    label: VERBS.queueForReattest,
    description: "Action: queue this case for the bot to re-attest in the portal.",
    domain: "verb",
  },
};

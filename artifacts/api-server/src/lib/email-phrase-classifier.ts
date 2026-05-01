// Phrase-anchored, abstain-capable inbound-email classifier.
//
// Replaces the legacy `\bapproved\b` / `\bdenied\b` / `\breceived\b` keyword
// regex in response-matcher. The legacy classifier matched single tokens
// against `subject + body`, so it kept firing on:
//   - the "approved" appearing inside our own quoted outbound dispute,
//   - the boilerplate "Ticket Under Review" template that uses neutral words,
//   - the standard Freshdesk acknowledgment that contained "received",
// and shovelled most boilerplate confirmations into Needs Review.
//
// The new classifier:
//   - operates on the NORMALIZED body only (never the subject — the subject
//     mirrors our outbound and leaks our own error-type label),
//   - looks for full multi-word phrases unique to known payor templates,
//   - applies explicit precedence so a real-decision phrase always wins
//     over a boilerplate phrase appearing in the same body,
//   - returns "unknown" when nothing matches, so the caller knows to fall
//     through to the AI backstop instead of guessing.
//
// Onboarding a new payor template is intentionally a one-line change: drop
// a new entry into SIGNATURES below. No new code paths needed.
//
// To prevent silent regressions, every body we have ever seen in production
// is pinned in `__tests__/__fixtures__/email-classifier-corpus.json` with
// its expected outcome. The regression test in
// `__tests__/email-phrase-classifier-corpus.test.ts` re-runs the classifier
// over every fixture and fails loudly with the email id, sender, subject,
// matched signatures, and expected vs. actual label.

import { logger } from "./logger";
import { normalizeInboundEmailBody } from "./email-body-normalize";

export type PhraseOutcome =
  | "approval"
  | "denial"
  | "partial_approval"
  | "info_request"
  | "acknowledgment";

export type PhraseClassifierOutcome = PhraseOutcome | "unknown";

export interface PhraseSignature {
  /** Tag for logging / test failure output. Must be unique per signature. */
  id: string;
  /** Phrase to look for. String → case-insensitive substring match. */
  phrase: string | RegExp;
  outcome: PhraseOutcome;
  confidence: "high" | "medium";
  /** Free-form payor name for telemetry; not used for matching. */
  payor?: string;
  /**
   * Production fixture id this signature was derived from (see
   * __tests__/__fixtures__/email-classifier-corpus.json). Documentation
   * only — keeps the trail from "production data → signature" navigable.
   */
  exampleId?: number;
}

// ---------------------------------------------------------------------------
// HOW TO ADD A NEW SIGNATURE
// ---------------------------------------------------------------------------
// 1. Find a body the classifier currently abstains on (look for new sender
//    domain or a fixture entry whose `expectedOutcome` is "unknown").
// 2. Identify a phrase that appears in EVERY instance of that template and
//    in NOTHING ELSE. Multi-word phrases beat single tokens — single tokens
//    are the noise floor; do not add `\bapproved\b`.
// 3. Add an entry below with a unique `id`, the `phrase`, the `outcome`,
//    `confidence`, optional `payor` and `exampleId`.
// 4. Add a labelled fixture row (or relabel the existing "unknown" row) in
//    `__tests__/__fixtures__/email-classifier-corpus.json` so the regression
//    test pins the new behaviour.
// 5. Run `pnpm --filter @workspace/api-server run test` and confirm the
//    corpus suite still passes.
// ---------------------------------------------------------------------------
export const SIGNATURES: PhraseSignature[] = [
  // ----- Decisions (high precedence) ---------------------------------------
  // Real GPS exemption decision, format is fixed and template-driven.
  {
    id: "mas_gps_exemption_approved",
    phrase: "GPS Exemption Request Approved",
    outcome: "approval",
    confidence: "high",
    payor: "Medical Answering Services",
    exampleId: 149,
  },
  {
    id: "mas_gps_exemption_denied",
    phrase: "GPS Exemption Request Denied",
    outcome: "denial",
    confidence: "high",
    payor: "Medical Answering Services",
    exampleId: 155,
  },
  // "Corrections - Ticket Closed" is the payor closing the ticket and
  // pointing us at the MAS portal correction flow. It is NOT boilerplate
  // — the operator needs to act on it (re-route through the portal). We
  // therefore route it through the actionable side per the task plan so
  // the matched group/claim flips to Needs Review.
  {
    id: "mas_corrections_ticket_closed",
    phrase: "Corrections - Ticket Closed",
    outcome: "approval",
    confidence: "high",
    payor: "Medical Answering Services",
    exampleId: 88,
  },
  // "At this time the invoice will remain cancelled/ineligible" — Naja's
  // hand-typed denial template. The "will remain cancelled" sub-string is
  // the unique anchor; the longer prefix is a nicer match for telemetry.
  {
    id: "mas_invoice_will_remain_cancelled",
    phrase: /At this time the invoice will remain/i,
    outcome: "denial",
    confidence: "high",
    payor: "Medical Answering Services",
    exampleId: 178,
  },
  {
    id: "mas_will_remain_cancelled",
    phrase: /will remain cancelled/i,
    outcome: "denial",
    confidence: "high",
    payor: "Medical Answering Services",
    exampleId: 178,
  },

  // ----- Acknowledgments (lower precedence) -------------------------------
  // The big three boilerplate templates that produced ~90% of the keyword
  // false positives in the production audit:
  {
    id: "mas_ticket_under_review",
    phrase: "Ticket Under Review",
    outcome: "acknowledgment",
    confidence: "high",
    payor: "Medical Answering Services",
    exampleId: 1,
  },
  {
    id: "mas_leg_flagged_howto",
    phrase: "To have a leg flagged for Incomplete GPS or GPS Deviation reviewed",
    outcome: "acknowledgment",
    confidence: "high",
    payor: "Medical Answering Services",
    exampleId: 112,
  },
  {
    id: "mas_correction_30_days",
    phrase: "Corrections can take up to 30 days before you receive a response",
    outcome: "acknowledgment",
    confidence: "high",
    payor: "Medical Answering Services",
    exampleId: 70,
  },
  // The standard Freshdesk auto-receipt — "your ticket has been created".
  // Almost all of these are already correctly tagged; pinning a signature
  // protects against future drift in case the template changes shape.
  {
    id: "mas_freshdesk_auto_ack",
    phrase: "We would like to acknowledge that we have received your request",
    outcome: "acknowledgment",
    confidence: "high",
    payor: "Medical Answering Services",
    exampleId: 5,
  },
];

// Outcome priority: a single body may match both "Ticket Under Review" and
// "GPS Exemption Request Approved"; in that case the decision must win.
// Lower number = higher priority.
const OUTCOME_PRIORITY: Record<PhraseOutcome, number> = {
  approval: 0,
  denial: 0,
  partial_approval: 0,
  info_request: 1,
  acknowledgment: 2,
};

export interface PhraseClassifierResult {
  outcome: PhraseClassifierOutcome;
  /** All signatures that matched, in declaration order, for telemetry. */
  matchedSignatureIds: string[];
  /**
   * The signature whose outcome was selected. `null` when `outcome` is
   * `"unknown"` (no matches) or when something prevented a winner.
   */
  selectedSignatureId: string | null;
  /** The cleaned body the classifier looked at (for logging / tests). */
  normalizedBody: string;
}

function phraseHits(body: string, phrase: string | RegExp): boolean {
  if (phrase instanceof RegExp) return phrase.test(body);
  // Plain string: case-insensitive substring match. Cheaper than regex on
  // long bodies and does not require escaping user-supplied phrases.
  return body.toLowerCase().includes(phrase.toLowerCase());
}

/**
 * Classify an inbound email body into one of the known phrase outcomes, or
 * return `"unknown"` so the caller can decide to escalate to the AI backstop.
 *
 * The function takes the RAW body (HTML or text) and runs normalization
 * itself — callers do not need to pre-clean. The cleaned body is returned
 * in the result so the call site can persist it for debugging.
 */
export function classifyByPhrase(rawBody: string): PhraseClassifierResult {
  const normalizedBody = normalizeInboundEmailBody(rawBody);
  if (!normalizedBody) {
    return {
      outcome: "unknown",
      matchedSignatureIds: [],
      selectedSignatureId: null,
      normalizedBody,
    };
  }

  const matches: PhraseSignature[] = [];
  for (const sig of SIGNATURES) {
    if (phraseHits(normalizedBody, sig.phrase)) matches.push(sig);
  }

  if (matches.length === 0) {
    return {
      outcome: "unknown",
      matchedSignatureIds: [],
      selectedSignatureId: null,
      normalizedBody,
    };
  }

  // Pick the highest-priority outcome; tie-break by declaration order
  // (earlier signatures win, which matches the visual top-to-bottom order
  // in the SIGNATURES list).
  let winner = matches[0];
  for (const m of matches.slice(1)) {
    if (OUTCOME_PRIORITY[m.outcome] < OUTCOME_PRIORITY[winner.outcome]) {
      winner = m;
    }
  }

  const result: PhraseClassifierResult = {
    outcome: winner.outcome,
    matchedSignatureIds: matches.map(m => m.id),
    selectedSignatureId: winner.id,
    normalizedBody,
  };

  logger.debug({
    matchedSignatureIds: result.matchedSignatureIds,
    selectedSignatureId: result.selectedSignatureId,
    outcome: result.outcome,
  }, "phrase classifier matched");

  return result;
}

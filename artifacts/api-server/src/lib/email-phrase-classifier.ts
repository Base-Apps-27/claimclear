// Acknowledgment-only phrase pre-filter for inbound payor emails.
//
// CONTRACT
// --------
// This classifier is intentionally narrow: it can ONLY return
// `"acknowledgment"` or `"unknown"`. Real decisions
// (`approval` / `denial` / `partial_approval` / `info_request`) are NEVER
// asserted from a hand-coded phrase — those must come from the LLM
// classifier in `inbound-email-classifier.ts`. The phrase matcher is here
// only as a free, deterministic short-circuit for the obvious 90% of
// boilerplate templates ("we received your ticket", "ticket under review",
// process-explanation autoresponders) so we don't spend tokens on them.
//
// Why the demotion (Task #314)
// ----------------------------
// An earlier iteration of this module also encoded decision phrases like
// "GPS Exemption Request Approved" and "Corrections - Ticket Closed". That
// let humans pre-decide payor intent — and pre-decide it wrong: e.g.
// "Corrections - Ticket Closed" is actually the payor closing the ticket
// and redirecting us to the MAS portal (an `info_request`), not an
// approval. The cure is to let a cheap LLM read every non-acknowledgment
// email instead of guessing from substrings.
//
// Onboarding a new acknowledgment template is intentionally a one-line
// change: drop a new entry into SIGNATURES below. Do NOT add signatures
// with non-acknowledgment outcomes — if you find yourself wanting to,
// improve the LLM system prompt instead.
//
// To prevent silent regressions, every body we have ever seen in production
// is pinned in `__tests__/__fixtures__/email-classifier-corpus.json` with
// its expected outcome. The regression test in
// `__tests__/email-phrase-classifier-corpus.test.ts` re-runs the classifier
// over every fixture: acknowledgment fixtures must match a signature, and
// every other fixture must abstain (return `"unknown"` so the LLM is
// invoked downstream).

import { logger } from "./logger";
import { normalizeInboundEmailBody } from "./email-body-normalize";

export type PhraseOutcome = "acknowledgment";

export type PhraseClassifierOutcome = PhraseOutcome | "unknown";

export interface PhraseSignature {
  /** Tag for logging / test failure output. Must be unique per signature. */
  id: string;
  /** Phrase to look for. String → case-insensitive substring match. */
  phrase: string | RegExp;
  /**
   * Always `"acknowledgment"`. Kept on the type so callers don't have to
   * special-case the singleton, and so future ack-only sub-buckets (if we
   * ever want them) can slot in without a wider refactor.
   */
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
// HOW TO ADD A NEW ACKNOWLEDGMENT SIGNATURE
// ---------------------------------------------------------------------------
// 1. Find an ack body the classifier currently abstains on (look for new
//    sender domain or a fixture entry whose `expectedOutcome` is
//    "acknowledgment" but whose `expectedSignature` is null).
// 2. Identify a phrase that appears in EVERY instance of that template and
//    in NOTHING ELSE. Multi-word phrases beat single tokens — single tokens
//    are the noise floor; do not add `\breceived\b`.
// 3. Add an entry below with a unique `id`, the `phrase`, `outcome:
//    "acknowledgment"`, `confidence`, optional `payor` and `exampleId`.
// 4. Add a labelled fixture row (or relabel the existing "unknown" row) in
//    `__tests__/__fixtures__/email-classifier-corpus.json` so the regression
//    test pins the new behaviour.
// 5. Run `pnpm --filter @workspace/api-server run test` and confirm the
//    corpus suite still passes.
//
// DO NOT add signatures with outcomes other than `"acknowledgment"`. The
// LLM in `inbound-email-classifier.ts` is the only path that produces
// decisions.
// ---------------------------------------------------------------------------
export const SIGNATURES: PhraseSignature[] = [
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
  // Duplicate-correction notification. The earliest cohort of dispute
  // submissions filed one ticket PER LEG instead of per invoice, which
  // produced 1,182+ duplicate Freshdesk tickets across 4-leg invoices.
  // The submission flow is now per-invoice, but those duplicate tickets
  // remain on the portal and MAS now responds to each one with this
  // template:
  //   "A previous correction was submitted for this on M/D/YY.
  //    Corrections can take up to 30 days before you receive a response.
  //    Corrections - Ticket Closed
  //    TPIssues.medanswering.com is not used for trip corrections.
  //    Instead, you must enter a correction through your MAS portal."
  // The 30-days line is already covered by `mas_correction_30_days`, so
  // most variants get tagged correctly today — but if MAS ever drops
  // the 30-days line we lose the ack and the LLM would (mis)classify
  // the "Corrections - Ticket Closed" tail as an `info_request`,
  // wrongly flipping the canonical per-invoice group into Ready to
  // Review. This second signature pins the duplicate-template head so
  // detection survives that drift. Outcome is `acknowledgment` because
  // the message is purely a "you already filed this" status ping — the
  // real response is on the canonical per-invoice ticket; nothing for
  // the operator to do here.
  {
    id: "mas_duplicate_correction_already_submitted",
    phrase: "previous correction was submitted",
    outcome: "acknowledgment",
    confidence: "high",
    payor: "Medical Answering Services",
    exampleId: 183,
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

export interface PhraseClassifierResult {
  outcome: PhraseClassifierOutcome;
  /** All signatures that matched, in declaration order, for telemetry. */
  matchedSignatureIds: string[];
  /**
   * The signature whose outcome was selected. `null` when `outcome` is
   * `"unknown"` (no matches).
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
 * Classify an inbound email body against the acknowledgment templates we
 * know about. Returns `"acknowledgment"` when any signature matches, or
 * `"unknown"` so the caller knows to escalate to the LLM classifier.
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

  // Every signature is an acknowledgment now; tie-break by declaration
  // order so the visual top-to-bottom order in SIGNATURES wins.
  const winner = matches[0];

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
  }, "phrase classifier matched (acknowledgment)");

  return result;
}

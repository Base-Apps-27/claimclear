import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  isPayorDenialReasonCode,
  PAYOR_DENIAL_REASON_CODES,
  type PayorDenialReasonCode,
} from "@workspace/payor-denial-reasons";
import { logger } from "./logger";

export type ClassifiedDecision =
  | "approval"
  | "denial"
  | "partial_approval"
  | "info_request"
  | "acknowledgment"
  | "other";

export interface ClassifiedInboundEmail {
  decision: ClassifiedDecision;
  summary: string;
  amount: string | null;
  deadline: string | null;
  requestedAction: string | null;
  confidence: "high" | "medium" | "low";
  /**
   * Task #321: when the payor's reply is itself a "submit a NEW invoice"
   * directive (e.g. MAS sends a Corrections - Ticket Closed redirect that
   * names the new invoice number), surface that number for the operator
   * picker. The classifier is a HINT only — the operator confirms before
   * we link anything.
   */
  newInvoiceNumber: string | null;
  /**
   * Task #321: AI hint at the lightweight payor-denial-reason category.
   * Mirrors the union from `@workspace/payor-denial-reasons`. The
   * classifier returns exactly one code or null when the email isn't a
   * denial / no clear category. Operator can override.
   */
  suggestedPayorDenialReason: PayorDenialReasonCode | null;
}

export interface InboundEmailContext {
  payorName?: string | null;
  errorTypeName?: string | null;
  confNumber?: string | null;
  claimAmount?: string | null;
  serviceDate?: string | null;
}

const SYSTEM_PROMPT = `You are an expert claims-dispute analyst at a Non-Emergency Medical Transportation (NEMT) provider.

You read inbound emails the provider receives in response to claim disputes. Your job is to:
1. Classify the email's actual intent (real decision vs. automated acknowledgment vs. request for more info).
2. Extract the key information a human reviewer would need at a glance.

Decision categories (one-line examples — match the spirit, not the exact words):
- "approval" — payor approved the claim for THIS invoice. Examples: "GPS Exemption Request Approved" (template header), "Your GPS Exemption Request for 1846045330 is approved", "the invoice will be made attestable", "your claim has been approved for $45.20".
- "denial" — payor denied the claim for THIS invoice. Examples: "GPS Exemption Request Denied", "Your GPS Exemption Request is denied", "the invoice will remain cancelled/ineligible as the enrollee was not active", "the dispute is denied".
- "partial_approval" — payor approved some legs/amount but not all (rare).
- "info_request" — payor needs us to do something else before they can decide, OR is closing this channel and redirecting us elsewhere. The operator has work to do, but no approval/denial was issued. Examples: "Corrections - Ticket Closed … you must enter a correction through your MAS portal" (payor closed the ticket, told us to refile via the portal), "Please provide GPS breadcrumbs for confirmation #X", "Submit this through the GPS Deviation Control category".
- "acknowledgment" — payor is just confirming receipt, queueing the dispute for review, or explaining how their dispute process works. NO decision yet, NO new action required from us. Examples: "We have received your request", "Ticket Under Review — this ticket will be reviewed for GPS compliance" (queued for review only), "To have a leg flagged for Incomplete GPS reviewed, you must submit one ticket per invoice…" (generic process explanation, not a per-ticket directive), "Corrections can take up to 30 days before you receive a response" (status ping).
- "other" — anything else (unrelated, unclear, internal forward, etc.).

Critical distinctions:
- "Corrections - Ticket Closed" with instructions to use the MAS portal is an "info_request", NOT an "approval" — the payor has closed the ticket and is redirecting us to a different workflow we must execute.
- Be strict about "acknowledgment". An email that explains process or confirms a queue position is an acknowledgment, even if it uses the words "approved", "denied", or "review" while doing so.
- Do NOT treat the text of our own quoted outbound dispute (which appears below the payor's reply, often after "On <date>, <name> wrote:") as decision evidence — only the payor's actual reply at the top of the message counts.
- If the email contains both a genuine decision AND boilerplate template text, classify as the decision.

When the email is a denial / pushback, ALSO emit a single best-fit code from
this fixed vocabulary as \`suggestedPayorDenialReason\` so the operator's
"Why did the payor deny?" picker on Responses Awaiting Review starts
pre-filled. Use null for non-denials, ambiguous denials, or when no
category clearly fits — never invent codes outside this set:
- "payor_rejected_gps"          — explicitly rejects our GPS / breadcrumbs / location proof.
- "payor_rejected_signature"    — explicitly rejects our signature / e-signature / driver attestation.
- "payor_reclassified_error"    — payor says the error category we filed under is wrong (e.g. "this is not a GPS issue, it's a signature issue").
- "payor_cited_benefit_rule"    — denial driven by member coverage / benefit / contract / authorization rules ("member not eligible", "service not covered").
- "payor_cited_timely_filing"   — denial driven by timely-filing window / submission deadline missed.
- "payor_no_clear_reason"       — payor says denied / not approved but gives no actionable reason.
- "payor_other"                 — denial with a clear reason that doesn't fit any category above.

When the payor's reply tells us to refile under a NEW invoice number
(e.g. "Corrections - Ticket Closed: please re-submit on invoice
1234567890" or any reply that explicitly names a different MAS invoice
number for us to use), emit that number as \`newInvoiceNumber\` (digits
only, exactly as printed). Otherwise null. The operator confirms before
the system links anything — be conservative and prefer null when unsure.

Always respond with valid JSON in this exact shape:
{
  "decision": "approval" | "denial" | "partial_approval" | "info_request" | "acknowledgment" | "other",
  "summary": "1-2 sentence plain-English summary of what the email actually says",
  "amount": "dollar amount mentioned, e.g. '$45.20', or null",
  "deadline": "any deadline mentioned, e.g. 'respond by 2026-05-15', or null",
  "requestedAction": "specific action the payor is asking us to take, or null",
  "confidence": "high" | "medium" | "low",
  "newInvoiceNumber": "the NEW invoice number to refile under, e.g. '1234567890', or null",
  "suggestedPayorDenialReason": "payor_rejected_gps" | "payor_rejected_signature" | "payor_reclassified_error" | "payor_cited_benefit_rule" | "payor_cited_timely_filing" | "payor_no_clear_reason" | "payor_other" | null
}`;

function buildUserPrompt(
  subject: string,
  body: string,
  context: InboundEmailContext,
): string {
  const ctxLines: string[] = [];
  if (context.payorName) ctxLines.push(`- Payor: ${context.payorName}`);
  if (context.confNumber) ctxLines.push(`- Claim confirmation #: ${context.confNumber}`);
  if (context.errorTypeName) ctxLines.push(`- Original error type: ${context.errorTypeName}`);
  if (context.claimAmount) ctxLines.push(`- Original claim amount: $${context.claimAmount}`);
  if (context.serviceDate) ctxLines.push(`- Service date: ${context.serviceDate}`);

  const ctxBlock = ctxLines.length > 0
    ? `Context (the dispute this email is replying to):\n${ctxLines.join("\n")}\n\n`
    : "";

  // Trim very long bodies — Claude can handle it, but most useful signal is at the top of the email
  const trimmedBody = body.length > 8000 ? body.slice(0, 8000) + "\n\n[...truncated]" : body;

  return `${ctxBlock}Email subject: ${subject || "(no subject)"}

Email body:
"""
${trimmedBody}
"""

Classify and extract per the schema in the system prompt. Respond with JSON only.`;
}

const VALID_DECISIONS: ClassifiedDecision[] = [
  "approval", "denial", "partial_approval", "info_request", "acknowledgment", "other",
];
const VALID_CONFIDENCE = new Set(["high", "medium", "low"] as const);

function nullableString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "n/a") return null;
  return trimmed;
}

/**
 * Parse and validate the raw text returned by the LLM into a typed
 * result. Exported so it can be unit-tested without an Anthropic call.
 *
 * Resilience contract (Task #321):
 *   - Malformed JSON does NOT throw — we degrade to
 *     `{ decision: "other", confidence: "low", summary: "(no summary)", ... null fields }`
 *     so the matcher can still record a row + ABSTAIN.
 *   - An invalid `decision` likewise degrades to "other" instead of
 *     throwing. The caller distinguishes "abstain" from "AI said other"
 *     via the `confidence` field — degraded results are stamped "low".
 *   - The new fields (`newInvoiceNumber`, `suggestedPayorDenialReason`)
 *     are best-effort: garbage input leaves them null. Additionally
 *     `suggestedPayorDenialReason` is forced to null when
 *     `decision !== "denial"` so the operator picker only shows hints
 *     for actual denials.
 */
export function parseClassifierResponse(rawText: string): ClassifiedInboundEmail {
  const degraded: ClassifiedInboundEmail = {
    decision: "other",
    summary: "(no summary)",
    amount: null,
    deadline: null,
    requestedAction: null,
    confidence: "low",
    newInvoiceNumber: null,
    suggestedPayorDenialReason: null,
  };

  let parsed: Record<string, unknown>;
  try {
    let jsonStr = rawText.trim();
    const fenced = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) jsonStr = fenced[1].trim();
    const out = JSON.parse(jsonStr);
    if (out === null || typeof out !== "object" || Array.isArray(out)) return degraded;
    parsed = out as Record<string, unknown>;
  } catch {
    // Malformed JSON: degrade rather than throw. Caller records the row
    // as `other` (low confidence) and skips the Needs Review transition
    // via the existing abstain path.
    return degraded;
  }

  const decisionRaw = String(parsed.decision ?? "").toLowerCase();
  const decision = (VALID_DECISIONS.includes(decisionRaw as ClassifiedDecision)
    ? (decisionRaw as ClassifiedDecision)
    : "other");
  // When we coerced an unknown decision to "other", downgrade confidence
  // so downstream consumers can tell this row was a degraded fall-back
  // rather than an AI-confident "other".
  const decisionDegraded = decision === "other" && decisionRaw !== "other";

  const confRaw = String(parsed.confidence ?? "medium").toLowerCase();
  let confidence: "high" | "medium" | "low" = (VALID_CONFIDENCE.has(confRaw as any)
    ? (confRaw as "high" | "medium" | "low")
    : "medium");
  if (decisionDegraded) confidence = "low";

  const summary = typeof parsed.summary === "string" && parsed.summary.trim().length > 0
    ? parsed.summary.trim()
    : "(no summary)";

  // newInvoiceNumber: keep digits-only, conservatively reject anything
  // that doesn't look like an invoice number so a hallucinated label
  // (e.g. a confirmation # or "TBD") never reaches the operator picker
  // pre-filled. Operator can still type one in by hand.
  const newInvoiceNumber = (() => {
    const raw = nullableString(parsed.newInvoiceNumber);
    if (!raw) return null;
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 6) return null; // MAS invoice numbers are 10 digits; allow some slack
    return digits;
  })();

  // suggestedPayorDenialReason: must be one of the codes from
  // `@workspace/payor-denial-reasons` (single source of truth). Anything
  // else — including "null" string, empty string, or a hallucinated code
  // — collapses to null so the operator picker stays blank.
  // ALSO forced to null unless `decision === "denial"` — pre-filling the
  // denial-reason picker on a non-denial would mislead the operator into
  // recording a reason for a payor reply that wasn't actually a denial.
  const suggestedPayorDenialReason = (() => {
    if (decision !== "denial") return null;
    const raw = parsed.suggestedPayorDenialReason;
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "n/a") return null;
    return isPayorDenialReasonCode(trimmed) ? trimmed : null;
  })();

  return {
    decision,
    summary,
    amount: nullableString(parsed.amount),
    deadline: nullableString(parsed.deadline),
    requestedAction: nullableString(parsed.requestedAction),
    confidence,
    newInvoiceNumber,
    suggestedPayorDenialReason,
  };
}

// Re-exported so callers don't need to depend on the package directly when
// they only want the union for narrowing.
export { PAYOR_DENIAL_REASON_CODES };

/**
 * AI-classify an inbound email. Best-effort: throws on failure. Callers
 * should catch and abstain — there is no longer a keyword fallback for
 * decisions (Task #314 demoted the phrase classifier to ack-only). The
 * `response-matcher` write path treats abstain as "leave the row at
 * `other` and DON'T transition the group", so a Haiku outage degrades
 * gracefully into a no-op rather than a wrong decision.
 */
export async function classifyInboundEmail(
  subject: string,
  body: string,
  context: InboundEmailContext = {},
): Promise<ClassifiedInboundEmail> {
  const prompt = buildUserPrompt(subject || "", body || "", context);

  // Cheap-by-default: Claude Haiku is the smallest model the AI Integrations
  // proxy exposes. The classifier only needs to emit a fixed-shape JSON
  // verdict, which Haiku handles easily — keeping the per-email cost an
  // order of magnitude below Sonnet so the LLM-first pipeline (Task #314)
  // stays cheaper than the keyword-first pipeline it replaced.
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((b: any) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Empty LLM response");
  }

  return parseClassifierResponse(textBlock.text);
}

/**
 * Wrapper that swallows errors and logs. Returns null when the AI call
 * fails so the caller can ABSTAIN (record the row as `other` without
 * transitioning the group) without disrupting the inbound-email pipeline.
 * Note: there is no keyword fallback path anymore — see Task #314.
 */
export async function tryClassifyInboundEmail(
  subject: string,
  body: string,
  context: InboundEmailContext = {},
): Promise<ClassifiedInboundEmail | null> {
  try {
    return await classifyInboundEmail(subject, body, context);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), subject },
      "AI inbound-email classification failed; abstaining (caller will record row as 'other' without transitioning the group)",
    );
    return null;
  }
}

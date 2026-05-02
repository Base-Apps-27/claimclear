import { anthropic } from "@workspace/integrations-anthropic-ai";
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

Always respond with valid JSON in this exact shape:
{
  "decision": "approval" | "denial" | "partial_approval" | "info_request" | "acknowledgment" | "other",
  "summary": "1-2 sentence plain-English summary of what the email actually says",
  "amount": "dollar amount mentioned, e.g. '$45.20', or null",
  "deadline": "any deadline mentioned, e.g. 'respond by 2026-05-15', or null",
  "requestedAction": "specific action the payor is asking us to take, or null",
  "confidence": "high" | "medium" | "low"
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
 * Parse and validate the raw text returned by the LLM into a typed result.
 * Exported so it can be unit-tested without an Anthropic call.
 */
export function parseClassifierResponse(rawText: string): ClassifiedInboundEmail {
  let jsonStr = rawText.trim();
  const fenced = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) jsonStr = fenced[1].trim();

  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

  const decision = String(parsed.decision || "").toLowerCase() as ClassifiedDecision;
  if (!VALID_DECISIONS.includes(decision)) {
    throw new Error(`Invalid decision from LLM: ${parsed.decision}`);
  }

  const confRaw = String(parsed.confidence || "medium").toLowerCase();
  const confidence = (VALID_CONFIDENCE.has(confRaw as any) ? confRaw : "medium") as
    | "high" | "medium" | "low";

  const summary = typeof parsed.summary === "string" && parsed.summary.trim().length > 0
    ? parsed.summary.trim()
    : "(no summary)";

  return {
    decision,
    summary,
    amount: nullableString(parsed.amount),
    deadline: nullableString(parsed.deadline),
    requestedAction: nullableString(parsed.requestedAction),
    confidence,
  };
}

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

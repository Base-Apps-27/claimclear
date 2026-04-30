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
1. Classify the email's actual intent (real decision vs. automated acknowledgment).
2. Extract the key information a human reviewer would need at a glance.

Critical distinctions:
- "acknowledgment" = the payor is just confirming they received our request. NO decision yet. Examples: "We have received your inquiry and will respond within 5 business days", "Your case has been logged as #12345", autoresponders.
- "info_request" = the payor needs MORE information from us before deciding. They are asking us to do something.
- "approval" / "denial" / "partial_approval" = an actual decision has been made.
- "other" = anything else (unrelated, unclear, internal forward, etc.).

Be strict about "acknowledgment" — if the email contains both an acknowledgment AND a real decision, classify as the decision. But if it is ONLY a confirmation of receipt with no decision content, it is an acknowledgment.

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
 * AI-classify an inbound email. Best-effort: throws on failure. Caller should
 * catch and fall back to keyword classification.
 */
export async function classifyInboundEmail(
  subject: string,
  body: string,
  context: InboundEmailContext = {},
): Promise<ClassifiedInboundEmail> {
  const prompt = buildUserPrompt(subject || "", body || "", context);

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
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
 * Wrapper that swallows errors and logs. Returns null when the AI call fails so
 * the caller can fall back to keyword classification without disrupting the
 * inbound-email pipeline.
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
      "AI inbound-email classification failed; falling back to keyword classifier",
    );
    return null;
  }
}

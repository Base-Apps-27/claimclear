import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, errorTypesTable, auditLogsTable, appSettingsTable } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { asyncHandler } from "../lib/asyncHandler";
import { broadcastPresenceEvent } from "../lib/sse";
import { registerBotProcess, unregisterBotProcess } from "../lib/bot-presence";
import {
  buildPromptLegInputs,
  loadGroupLegsForClaim,
  promptLegAuditCounters,
  type PromptLegInputsResult,
} from "../lib/prompt-leg-inputs";

const router: IRouter = Router();

function buildFallbackEmail(
  claim: typeof claimsTable.$inferSelect,
  errorType: typeof errorTypesTable.$inferSelect | null,
  disputeReason: string,
): { body: string } {
  const body = `Dear MAS Support Team,

I am writing to dispute the rejection of claim confirmation number ${claim.confNumber}, service date ${claim.date || "N/A"}, for client ${claim.clientNumber || "N/A"}.

Error cited: ${claim.errorDetails || "N/A"}

Reason for dispute: ${disputeReason}

${claim.evidenceNotes ? `Supporting evidence notes: ${claim.evidenceNotes}` : ""}

${errorType?.guidance ? `Per our standard operating procedures: ${errorType.guidance}` : ""}

We respectfully request that this claim be reviewed and reconsidered. The claim amount is $${claim.claimAmount || "0.00"}.

Thank you for your prompt attention to this matter.

Sincerely,
Transportation Provider`;
  return { body };
}

async function getDefaultDisputeInstructions(): Promise<string> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "default_dispute_instructions"));
  return row?.value || "";
}

/**
 * Pure prompt-assembly for the per-claim dispute email. Extracted so the
 * deterministic prompt-shape tests can assert on the assembled prompt
 * without invoking the LLM. The `promptLegInputs` argument MUST come from
 * `buildPromptLegInputs` — never read the per-leg-context column or the
 * duplicate-of-claim pointer column directly here (the helper is the single
 * source of truth for both).
 */
export function buildPerClaimEmailPrompt(opts: {
  claim: typeof claimsTable.$inferSelect;
  errorType: typeof errorTypesTable.$inferSelect | null;
  disputeReason: string;
  instructions: string;
  promptLegInputs: PromptLegInputsResult;
}): { prompt: string; systemPrompt: string } {
  const { claim, errorType, disputeReason, instructions, promptLegInputs } = opts;
  const annotationLines = promptLegInputs.perClaimAnnotationLines.get(claim.id) ?? [];
  // Insert per-leg / sibling-duplicate bullets directly into the bulleted
  // "Claim details" section. When the claim has neither per-leg context nor
  // any sibling-duplicate relationship this string is empty and the prompt
  // is byte-equivalent to the legacy version (Task #307 parity guard).
  const annotationBlock = annotationLines.length > 0 ? `\n${annotationLines.join("\n")}` : "";

  const prompt = `Write a professional dispute email for a rejected NEMT (Non-Emergency Medical Transportation) claim.

Claim details:
- Confirmation number: ${claim.confNumber}
- Service date: ${claim.date || "N/A"}
- Client number: ${claim.clientNumber || "N/A"}
- Car/vehicle number: ${claim.carNumber || "N/A"}
- Claim amount: $${claim.claimAmount || "0.00"}
- Error cited: ${claim.errorDetails || "N/A"}
- Error type: ${claim.errorTypeName || "Unknown"}${errorType?.description ? `\n- Error description: ${errorType.description}` : ""}${annotationBlock}

Reason for dispute (from workflow decision): ${disputeReason}

${claim.evidenceNotes ? `Evidence gathered: ${claim.evidenceNotes}` : ""}
${errorType?.guidance ? `SOP context: ${errorType.guidance}` : ""}

${instructions ? `IMPORTANT — Follow these guidelines for tone, content, and structure of the email:\n${instructions}` : ""}

Write a professional, concise dispute email addressed to "MAS Support Team". The email should:
- Sound natural and human — vary the phrasing each time, do NOT use a rigid template
- Clearly state the dispute reason using the information above
- Reference the specific evidence that supports the dispute
- Request reconsideration
- Be factual and persuasive without being adversarial
- Keep a professional but conversational tone

Return ONLY the email body text. Do not include a subject line, JSON wrapping, or any preamble.`;

  const systemPrompt = "You are a professional NEMT claims dispute specialist writing on behalf of a transportation provider. Write clear, factual, and persuasive dispute emails. Each email should read naturally — vary sentence structure, word choice, and phrasing so no two emails sound identical. Avoid boilerplate or robotic language. Return only the email body text — never a subject line, JSON wrapper, or preamble.";

  return { prompt, systemPrompt };
}

async function generateWithLLM(
  claim: typeof claimsTable.$inferSelect,
  errorType: typeof errorTypesTable.$inferSelect | null,
  disputeReason: string,
  promptLegInputs: PromptLegInputsResult,
): Promise<{ body: string }> {
  const defaultInstructions = await getDefaultDisputeInstructions();
  const instructions = errorType?.disputeInstructions || errorType?.emailTemplate || defaultInstructions;
  const { prompt, systemPrompt } = buildPerClaimEmailPrompt({ claim, errorType, disputeReason, instructions, promptLegInputs });

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    system: systemPrompt,
  });

  const textBlock = message.content.find((b: any) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("Empty LLM response");

  let body = textBlock.text.trim();
  // Defensive: strip optional fenced wrapping if the model added one.
  const fenced = body.match(/^```(?:text|markdown)?\s*([\s\S]*?)```\s*$/);
  if (fenced) body = fenced[1].trim();
  if (!body) throw new Error("Invalid LLM response format");

  return { body };
}

/**
 * Upgrade a user-authored reply draft via AI. Cleans up grammar,
 * punctuation, and structure only — meaning, tone, and all factual
 * details (numbers, dates, claim/invoice IDs, currency amounts, proper
 * nouns) are preserved verbatim. Returns plain text or HTML matching
 * the input format.
 */
const UPGRADE_REPLY_MAX_CHARS = 20000;

const UPGRADE_REPLY_SYSTEM_PROMPT = `You are an expert editor helping a Non-Emergency Medical Transportation (NEMT) claims operator polish an email reply they are about to send to a payor.

Your job is to rewrite the operator's draft to fix grammar, punctuation, spelling, and structural clarity ONLY.

Hard rules — never violate:
- Preserve the original meaning exactly. Do NOT add new claims, requests, justifications, or commitments. Do NOT remove substantive content.
- Preserve the writer's tone and voice. If they were brief, stay brief. If they were formal, stay formal. Do not make a casual reply formal or vice versa.
- Preserve every factual detail VERBATIM: numbers, dates, currency amounts, claim numbers, invoice numbers, confirmation numbers, ticket IDs, proper nouns (people, payors, organizations), addresses, email addresses, phone numbers, and URLs. Do not reword them, normalize them, or change capitalization.
- Match the input format. If the input contains HTML tags, return well-formed HTML using the same tag vocabulary the input used (e.g. <p>, <br>, <ul>, <li>, <strong>, <em>, <a>). If the input is plain text with no tags, return plain text.
- Do NOT translate or change languages.
- Do NOT add greetings, sign-offs, signatures, disclaimers, or commentary that wasn't in the original.
- Do NOT wrap the result in code fences, quotes, or explanations. Return ONLY the rewritten body.`;

function buildUpgradeReplyPrompt(body: string, subject?: string): string {
  const subjectLine = subject && subject.trim().length > 0
    ? `Subject (for context only — do not modify or reference): ${subject.trim()}\n\n`
    : "";
  return `${subjectLine}Rewrite the draft below to fix grammar, punctuation, and structure. Follow every rule from the system prompt. Return ONLY the rewritten body in the same format as the input.

Draft:
"""
${body}
"""`;
}

router.post("/ai/upgrade-reply", asyncHandler(async (req, res): Promise<void> => {
  const rawBody = req.body?.body;
  const rawSubject = req.body?.subject;
  if (typeof rawBody !== "string") {
    res.status(400).json({ error: "body is required" });
    return;
  }
  const trimmed = rawBody.trim();
  if (trimmed.length === 0) {
    res.status(400).json({ error: "body cannot be empty" });
    return;
  }
  if (rawBody.length > UPGRADE_REPLY_MAX_CHARS) {
    res.status(400).json({
      error: `body is too long (${rawBody.length} chars; max ${UPGRADE_REPLY_MAX_CHARS}).`,
    });
    return;
  }
  const subject = typeof rawSubject === "string" ? rawSubject : undefined;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      system: UPGRADE_REPLY_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: buildUpgradeReplyPrompt(rawBody, subject) },
      ],
    });

    const textBlock = message.content.find((b: any) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      res.status(502).json({ error: "AI returned an empty response." });
      return;
    }

    let upgradedBody = textBlock.text;
    // Strip optional fenced wrapping if the model added one despite instructions.
    const fenced = upgradedBody.match(/^```(?:html|text)?\s*([\s\S]*?)```\s*$/);
    if (fenced) upgradedBody = fenced[1];
    upgradedBody = upgradedBody.trim();

    if (upgradedBody.length === 0) {
      res.status(502).json({ error: "AI returned an empty rewrite." });
      return;
    }

    res.json({ upgradedBody });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `AI rewrite failed: ${msg}` });
  }
}));

router.post("/claims/:id/generate-email", asyncHandler(async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { disputeReason } = req.body;
  if (!disputeReason) { res.status(400).json({ error: "disputeReason is required" }); return; }

  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  let errorType: typeof errorTypesTable.$inferSelect | null = null;
  if (claim.errorTypeId) {
    const etId = parseInt(claim.errorTypeId, 10);
    if (!isNaN(etId)) {
      const [et] = await db.select().from(errorTypesTable).where(eq(errorTypesTable.id, etId));
      errorType = et || null;
    }
  }

  // Build prompt-leg inputs OUTSIDE the LLM try/catch (Task #307 guard #10).
  // Data-shape inconsistency must surface loud — the template fallback below
  // exists only for LLM/JSON parse failures, not for prompt-build failures.
  const { claim: claimRow, groupLegs, treesByLegId } = await loadGroupLegsForClaim(claim.id);
  const promptLegInputs = buildPromptLegInputs({ legs: [claimRow], groupLegs, treesByLegId });

  registerBotProcess("email_generation", id);
  broadcastPresenceEvent({
    type: "bot_started",
    resourceType: "claim", resourceId: id,
    userName: "AI Email Generator",
    userEmail: null,
    botProcess: "email_generation",
    timestamp: new Date().toISOString(),
  });

  try {
    let body: string;
    let generationMethod = "llm";

    try {
      const result = await generateWithLLM(claim, errorType, disputeReason, promptLegInputs);
      body = result.body;
    } catch {
      const fallback = buildFallbackEmail(claim, errorType, disputeReason);
      body = fallback.body;
      generationMethod = "template";
    }

    // Per-claim generator no longer authors a subject line. Clear any
    // stale `generatedEmailSubject` from prior runs so old LLM-authored
    // subjects don't linger on the row.
    const [updated] = await db.update(claimsTable).set({
      generatedEmailSubject: null,
      generatedEmailBody: body,
      generatedEmailAt: new Date().toISOString(),
    }).where(eq(claimsTable.id, id)).returning();

    await db.insert(auditLogsTable).values({
      claimId: id,
      action: "email_generated",
      details: `Dispute email generated via ${generationMethod}`,
      metadata: {
        generationMethod,
        ...promptLegAuditCounters(promptLegInputs),
      },
      userEmail: req.user?.email || null,
      userName: req.user?.displayName ?? null,
    });

    res.json(updated);
  } finally {
    unregisterBotProcess("email_generation", id);
    broadcastPresenceEvent({
      type: "bot_completed",
      resourceType: "claim", resourceId: id,
      userName: "AI Email Generator",
      userEmail: null,
      botProcess: "email_generation",
      timestamp: new Date().toISOString(),
    });
  }
}));

export default router;

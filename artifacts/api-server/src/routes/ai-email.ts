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
  type PromptLegInputsResult,
} from "../lib/prompt-leg-inputs";

const router: IRouter = Router();

function buildFallbackEmail(
  claim: typeof claimsTable.$inferSelect,
  errorType: typeof errorTypesTable.$inferSelect | null,
  disputeReason: string,
): { subject: string; body: string } {
  const subject = `Dispute for Claim ${claim.confNumber} - ${claim.errorTypeName || "Rejected Claim"}`;
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
  return { subject, body };
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

Respond with JSON in this exact format:
{"subject": "email subject line", "body": "full email body text"}`;

  const systemPrompt = "You are a professional NEMT claims dispute specialist writing on behalf of a transportation provider. Write clear, factual, and persuasive dispute emails. Each email should read naturally — vary sentence structure, word choice, and phrasing so no two emails sound identical. Avoid boilerplate or robotic language. Always respond with valid JSON containing subject and body fields.";

  return { prompt, systemPrompt };
}

async function generateWithLLM(
  claim: typeof claimsTable.$inferSelect,
  errorType: typeof errorTypesTable.$inferSelect | null,
  disputeReason: string,
  promptLegInputs: PromptLegInputsResult,
): Promise<{ subject: string; body: string }> {
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

  let jsonStr = textBlock.text.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();

  const parsed = JSON.parse(jsonStr) as { subject: string; body: string };
  if (!parsed.subject || !parsed.body) throw new Error("Invalid LLM response format");

  return parsed;
}

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
  const { claim: claimRow, groupLegs } = await loadGroupLegsForClaim(claim.id);
  const promptLegInputs = buildPromptLegInputs({ legs: [claimRow], groupLegs });

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
    let subject: string;
    let body: string;
    let generationMethod = "llm";

    try {
      const result = await generateWithLLM(claim, errorType, disputeReason, promptLegInputs);
      subject = result.subject;
      body = result.body;
    } catch {
      const fallback = buildFallbackEmail(claim, errorType, disputeReason);
      subject = fallback.subject;
      body = fallback.body;
      generationMethod = "template";
    }

    const [updated] = await db.update(claimsTable).set({
      generatedEmailSubject: subject,
      generatedEmailBody: body,
      generatedEmailAt: new Date().toISOString(),
    }).where(eq(claimsTable.id, id)).returning();

    await db.insert(auditLogsTable).values({
      claimId: id,
      action: "email_generated",
      details: `Dispute email generated via ${generationMethod}`,
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

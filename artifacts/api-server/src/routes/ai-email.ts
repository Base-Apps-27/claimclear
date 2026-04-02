import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, errorTypesTable, auditLogsTable } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";

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

async function generateWithLLM(
  claim: typeof claimsTable.$inferSelect,
  errorType: typeof errorTypesTable.$inferSelect | null,
  disputeReason: string,
): Promise<{ subject: string; body: string }> {
  const prompt = `Write a professional dispute email for a rejected NEMT (Non-Emergency Medical Transportation) claim.

Claim details:
- Confirmation number: ${claim.confNumber}
- Service date: ${claim.date || "N/A"}
- Client number: ${claim.clientNumber || "N/A"}
- Car/vehicle number: ${claim.carNumber || "N/A"}
- Claim amount: $${claim.claimAmount || "0.00"}
- Error cited: ${claim.errorDetails || "N/A"}
- Error type: ${claim.errorTypeName || "Unknown"}
${errorType?.description ? `- Error description: ${errorType.description}` : ""}

Reason for dispute: ${disputeReason}

${claim.evidenceNotes ? `Evidence gathered: ${claim.evidenceNotes}` : ""}
${errorType?.guidance ? `SOP guidance: ${errorType.guidance}` : ""}

Generate a professional, concise dispute email addressed to "MAS Support Team". The email should clearly state the dispute reason, reference the evidence, and request reconsideration.

Respond with JSON in this exact format:
{"subject": "email subject line", "body": "full email body text"}`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    system: "You are a professional NEMT claims dispute specialist. Write clear, factual, and persuasive dispute emails. Always respond with valid JSON containing subject and body fields.",
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

router.post("/claims/:id/generate-email", async (req, res): Promise<void> => {
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

  let subject: string;
  let body: string;
  let generationMethod = "llm";

  try {
    const result = await generateWithLLM(claim, errorType, disputeReason);
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
});

export default router;

import { Router, type IRouter } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router: IRouter = Router();

router.post("/error-types/analyze-sop", async (req, res): Promise<void> => {
  const { sopText, errorTypeName } = req.body;
  if (!sopText) {
    res.status(400).json({ error: "sopText is required" });
    return;
  }

  const prompt = `You are an expert in NEMT (Non-Emergency Medical Transportation) claims dispute resolution. Analyze the following Standard Operating Procedure (SOP) text and extract structured data for an error type configuration.

${errorTypeName ? `The error type being configured is: "${errorTypeName}"` : "Determine the appropriate error type name from the SOP."}

SOP Text:
---
${sopText}
---

Extract and generate the following fields. Be thorough and specific to NEMT claims disputes with MAS (Medical Answering Services).

Respond with valid JSON in exactly this format:
{
  "name": "Short error type name (e.g., 'GPS Control Deviation', 'Invoice Number Not in System')",
  "category": "Category grouping (e.g., 'GPS Issues', 'Billing', 'Scheduling', 'Attestation')",
  "description": "Clear 1-2 sentence description of what this error type means and when it occurs",
  "guidance": "Step-by-step staff guidance (numbered list) for handling this error type. Include what to check, what evidence to gather, and when to escalate.",
  "recommendedActions": "Bullet-point list of recommended actions staff should take",
  "disputeReasonsLibrary": [
    {
      "key": "reason_1",
      "label": "Short reason label",
      "description": "Detailed explanation of why this is a valid dispute reason, including key talking points"
    }
  ],
  "evidenceRequirements": [
    {
      "key": "ev_1",
      "label": "Evidence item description (e.g., 'GPS breadcrumb screenshot')",
      "required": true
    }
  ],
  "decisionTree": {
    "question": "First yes/no decision question based on the SOP?",
    "yesLabel": "Yes",
    "noLabel": "No",
    "yesAction": "Action if this is a leaf (e.g., 'Submit Portal Dispute')",
    "noAction": "Action if this is a leaf (e.g., 'Deny Claim Internally')",
    "yesChild": {
      "question": "Follow-up question if Yes branch needs more decisions?",
      "yesLabel": "Yes",
      "noLabel": "No",
      "yesAction": "Submit Portal Dispute",
      "noAction": "Place on Hold"
    },
    "noChild": null
  }
}

Important:
- Generate at least 2-3 dispute reasons with detailed key points
- Generate at least 2-3 evidence requirements
- The decision tree should be a nested structure with question/yesLabel/noLabel/yesAction/noAction/yesChild/noChild fields
- Each node has a "question" (the yes/no decision), "yesLabel"/"noLabel" (button labels), and either a child node (yesChild/noChild for further branching) or an action string (yesAction/noAction for terminal steps)
- If a branch has a child node, omit the action for that branch. If it has an action, omit the child.
- Common terminal actions: "Submit Portal Dispute", "Deny Claim Internally", "Place on Hold - [reason]", "Resolve - No Dispute Needed"
- Keep the tree to 3 levels deep maximum`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = message.content.find((b: any) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      res.status(500).json({ error: "No text response from AI" });
      return;
    }

    let jsonStr = textBlock.text.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    const disputeReasonsLibrary: Record<string, unknown> = {};
    if (Array.isArray(parsed.disputeReasonsLibrary)) {
      for (const r of parsed.disputeReasonsLibrary) {
        disputeReasonsLibrary[r.key] = { label: r.label, description: r.description };
      }
    }

    const evidenceRequirements: Record<string, unknown> = {};
    if (Array.isArray(parsed.evidenceRequirements)) {
      for (const e of parsed.evidenceRequirements) {
        evidenceRequirements[e.key] = { label: e.label, required: e.required };
      }
    }

    res.json({
      name: parsed.name || errorTypeName || "",
      category: parsed.category || "",
      description: parsed.description || "",
      guidance: parsed.guidance || "",
      recommendedActions: parsed.recommendedActions || "",
      disputeReasonsLibrary,
      evidenceRequirements,
      decisionTree: parsed.decisionTree || null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `SOP analysis failed: ${message}` });
  }
});

router.post("/error-types/build-tree-from-text", async (req, res): Promise<void> => {
  const { description, errorTypeName } = req.body;
  if (!description) {
    res.status(400).json({ error: "description is required" });
    return;
  }

  const prompt = `You are an expert in NEMT (Non-Emergency Medical Transportation) claims dispute resolution. Convert the following natural language workflow description into a structured decision tree.

${errorTypeName ? `This is for the error type: "${errorTypeName}"` : ""}

Workflow Description:
---
${description}
---

Create a nested decision tree in JSON format. The tree should use this structure:
{
  "question": "The yes/no or multi-choice question to ask",
  "yesLabel": "Label for the yes/affirmative option",
  "noLabel": "Label for the no/negative option",
  "yesAction": "Terminal action if yes is a leaf (e.g., 'Submit Portal Dispute')",
  "noAction": "Terminal action if no is a leaf",
  "yesChild": { ...nested node if yes leads to another question },
  "noChild": { ...nested node if no leads to another question }
}

Rules:
- Each node must have a clear "question" that staff can answer
- Use yesChild/noChild for branching, yesAction/noAction for terminal outcomes
- If a branch has a child node, do NOT include an action for that branch
- Common terminal actions: "Submit Portal Dispute", "Resolve Internally - Deny Claim", "Place on Hold - [reason]", "Send Dispute Email"
- Keep the tree practical and 2-4 levels deep
- Make questions specific and actionable for NEMT claims staff

Respond with ONLY the JSON object, no other text.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = message.content.find((b: any) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      res.status(500).json({ error: "No text response from AI" });
      return;
    }

    let jsonStr = textBlock.text.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== "object" || !parsed.question) {
      res.status(500).json({ error: "AI returned an invalid tree structure (missing root question)" });
      return;
    }
    res.json({ decisionTree: parsed });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Tree generation failed: ${message}` });
  }
});

export default router;

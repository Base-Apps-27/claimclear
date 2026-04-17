import { Router, type IRouter } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

function generateNodeId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

interface LegacyNode {
  question: string;
  helpText?: string;
  instructionText?: string;
  yesLabel?: string;
  noLabel?: string;
  yesAction?: string;
  noAction?: string;
  yesChild?: LegacyNode;
  noChild?: LegacyNode;
  evidenceRequirements?: { key: string; label: string; required: boolean; acceptsImage?: boolean; acceptsText?: boolean }[];
}

type OutcomeType = "portal_dispute" | "internal" | "hold" | "dispute";

interface TreeOption {
  label: string;
  childId?: string;
  outcomeType?: OutcomeType;
  outcomeLabel?: string;
}

interface TreeNode {
  id: string;
  question: string;
  helpText?: string;
  options: TreeOption[];
  evidenceRequirements?: { key: string; label: string; required: boolean }[];
}

interface DecisionTree {
  rootId: string;
  nodes: TreeNode[];
}

function mapOutcomeAction(action: string): OutcomeType {
  const lower = action.toLowerCase();
  if (lower.includes("portal") || lower.includes("submit dispute")) return "portal_dispute";
  if (lower.includes("hold")) return "hold";
  if (lower.includes("email") || lower.includes("send dispute")) return "dispute";
  if (lower.includes("deny") || lower.includes("internal") || lower.includes("resolve")) return "internal";
  return "portal_dispute";
}

function legacyToDecisionTree(legacy: LegacyNode): DecisionTree {
  const nodes: TreeNode[] = [];

  function convertNode(node: LegacyNode): string {
    const id = generateNodeId();
    const options: TreeOption[] = [];

    if (node.yesChild) {
      const cId = convertNode(node.yesChild);
      options.push({ label: node.yesLabel || "Yes", childId: cId });
    } else if (node.yesAction) {
      const outcomeType = mapOutcomeAction(node.yesAction);
      options.push({ label: node.yesLabel || "Yes", outcomeType, outcomeLabel: node.yesAction });
    }

    if (node.noChild) {
      const cId = convertNode(node.noChild);
      options.push({ label: node.noLabel || "No", childId: cId });
    } else if (node.noAction) {
      const outcomeType = mapOutcomeAction(node.noAction);
      options.push({ label: node.noLabel || "No", outcomeType, outcomeLabel: node.noAction });
    }

    const treeNode: TreeNode = { id, question: node.question, options };
    if (node.helpText) treeNode.helpText = node.helpText;
    if (node.instructionText) (treeNode as any).instructionText = node.instructionText;
    if (node.evidenceRequirements?.length) treeNode.evidenceRequirements = node.evidenceRequirements;
    nodes.push(treeNode);
    return id;
  }

  const rootId = convertNode(legacy);
  return { rootId, nodes };
}

router.post("/error-types/analyze-sop", asyncHandler(async (req, res): Promise<void> => {
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
    "helpText": "Guidance text explaining what to look for when answering this question (e.g., where to check in dispatch, what records to review)",
    "instructionText": "Step-by-step instructions for this decision point (e.g., 'Open the MAS portal > Navigate to Manage Trips > Search by invoice number')",
    "evidenceRequirements": [
      { "key": "evidence_key", "label": "What evidence to collect at this step", "required": true, "acceptsImage": true, "acceptsText": false }
    ],
    "yesLabel": "Yes",
    "noLabel": "No",
    "yesAction": "Action if this is a leaf (e.g., 'Submit Portal Dispute')",
    "noAction": "Action if this is a leaf (e.g., 'Deny Claim Internally')",
    "yesChild": {
      "question": "Follow-up question if Yes branch needs more decisions?",
      "helpText": "Context and guidance for this specific decision",
      "instructionText": "Detailed steps for how to determine the answer",
      "evidenceRequirements": [],
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
- EVERY node MUST include "helpText" with guidance on what to look for or check when answering that question
- EVERY node SHOULD include "instructionText" with step-by-step instructions for the decision point (e.g., where to navigate in the portal, what system to check)
- Include "evidenceRequirements" array on nodes where evidence should be collected. Each item has: key (snake_case identifier), label (human-readable description), required (boolean), acceptsImage (true if screenshot/photo evidence), acceptsText (true if text/written evidence)
- Each node has a "question" (the yes/no decision), "yesLabel"/"noLabel" (button labels), and either a child node (yesChild/noChild for further branching) or an action string (yesAction/noAction for terminal steps)
- If a branch has a child node, omit the action for that branch. If it has an action, omit the child.
- Common terminal actions: "Submit Portal Dispute", "Deny Claim Internally", "Place on Hold - [reason]", "Resolve - No Dispute Needed"
- Keep the tree to 3 levels deep maximum`;

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

  let decisionTree = null;
  if (parsed.decisionTree && typeof parsed.decisionTree === "object" && parsed.decisionTree.question) {
    decisionTree = legacyToDecisionTree(parsed.decisionTree as LegacyNode);
  }

  res.json({
    name: parsed.name || errorTypeName || "",
    category: parsed.category || "",
    description: parsed.description || "",
    guidance: parsed.guidance || "",
    recommendedActions: parsed.recommendedActions || "",
    disputeReasonsLibrary,
    evidenceRequirements,
    decisionTree,
  });
}));

router.post("/error-types/build-tree-from-text", asyncHandler(async (req, res): Promise<void> => {
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
  "helpText": "Guidance text explaining what to look for when answering this question (e.g., where to check in dispatch, what records to review, what constitutes a valid answer)",
  "instructionText": "Step-by-step instructions for this decision point (e.g., 'Open the MAS portal > Navigate to Manage Trips > Search by invoice number')",
  "evidenceRequirements": [
    { "key": "snake_case_key", "label": "Description of evidence to collect", "required": true, "acceptsImage": true, "acceptsText": false }
  ],
  "yesLabel": "Label for the yes/affirmative option",
  "noLabel": "Label for the no/negative option",
  "yesAction": "Terminal action if yes is a leaf (e.g., 'Submit Portal Dispute')",
  "noAction": "Terminal action if no is a leaf",
  "yesChild": { ...nested node if yes leads to another question },
  "noChild": { ...nested node if no leads to another question }
}

Rules:
- Each node must have a clear "question" that staff can answer
- EVERY node MUST include "helpText" with context about what to check or look for
- EVERY node SHOULD include "instructionText" with step-by-step instructions (where to navigate, what system to check, what to click)
- Include "evidenceRequirements" on nodes where evidence should be collected (screenshots, documents, written explanations). Each item needs: key (snake_case), label (human-readable), required (boolean), acceptsImage (true for screenshots/photos), acceptsText (true for written input)
- Use yesChild/noChild for branching, yesAction/noAction for terminal outcomes
- If a branch has a child node, do NOT include an action for that branch
- Common terminal actions: "Submit Portal Dispute", "Resolve Internally - Deny Claim", "Place on Hold - [reason]", "Send Dispute Email"
- Keep the tree practical and 2-4 levels deep
- Make questions specific and actionable for NEMT claims staff

Respond with ONLY the JSON object, no other text.`;

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

  const decisionTree = legacyToDecisionTree(parsed as LegacyNode);
  res.json({ decisionTree });
}));

interface SimplifyItem {
  id: string;
  field: string;
  text: string;
  shortLabel?: boolean;
}

router.post("/error-types/simplify-text", asyncHandler(async (req, res): Promise<void> => {
  const items = req.body?.items as SimplifyItem[] | undefined;
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "items array is required" });
    return;
  }

  const cleanItems = items
    .filter(it => it && typeof it.id === "string" && typeof it.text === "string" && it.text.trim().length > 0)
    .map(it => ({
      id: it.id,
      field: typeof it.field === "string" ? it.field : "",
      text: it.text,
      shortLabel: !!it.shortLabel,
    }));

  if (cleanItems.length === 0) {
    res.json({ suggestions: [] });
    return;
  }

  const prompt = `You are rewriting text for a software workflow used by NEMT (Non-Emergency Medical Transportation) claims staff. Many readers are ESL (English as a Second Language) speakers.

Rewrite each text item below to a 6th-grade U.S. reading level. Rules:
- Use short, simple sentences (aim for 12-18 words).
- Use common, everyday words. Replace jargon when you can, but PRESERVE these domain terms exactly: "GPS", "MAS", "NEMT", "portal", "attestation", "dispatch", "invoice", "breadcrumb", "drop-off", "pickup", "dispute", "claim", "leg".
- PRESERVE proper nouns, email addresses, URLs, button names, menu paths, and any text in quotes.
- Use active voice. Keep instructions in command form ("Open the portal", not "The portal should be opened").
- Keep the same meaning. Do NOT add new facts. Do NOT remove required steps or evidence references.
- For items marked "shortLabel": true, return at most 6 words and no trailing punctuation. These are button or option labels.
- If the text is already clear and at a 6th-grade level, return it unchanged.
- Never invent content for empty input. (We've already filtered those out.)

Respond with ONLY a JSON object in this exact shape, no prose, no code fences:
{
  "suggestions": [
    { "id": "<original id>", "text": "<rewritten text>" }
  ]
}

Items to rewrite:
${JSON.stringify(cleanItems.map(it => ({ id: it.id, field: it.field, shortLabel: it.shortLabel, text: it.text })), null, 2)}`;

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

  let jsonStr = (textBlock as any).text.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();

  let parsed: { suggestions?: { id: string; text: string }[] };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    res.status(500).json({ error: "AI returned invalid JSON" });
    return;
  }

  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions
        .filter(s => s && typeof s.id === "string" && typeof s.text === "string")
        .map(s => ({ id: s.id, text: s.text.trim() }))
    : [];

  res.json({ suggestions });
}));

export default router;

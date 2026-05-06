import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { errorTypesTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { denyClerk } from "../middlewares/denyClerk";

const router: IRouter = Router();

// Task #470 — Pivot B1 — server-side guarantee that bulk-eligible nodes
// can never bypass per-leg evidence/context. Mirrors the client-side
// `validateAppliesPerInvoice()` in
// `artifacts/claimclear/src/components/decision-tree/types.ts`. Kept
// inline (rather than imported across artifact boundaries) because the
// api-server cannot depend on claimclear sources.
//
// Returns the list of violations; the caller turns it into a 400 with
// stable codes the editor surfaces inline. The save is REJECTED — never
// silently coerced — so author intent stays the source of truth.
type AppliesPerInvoiceViolation = {
  nodeId: string;
  reason:
    | "node_has_evidence"
    | "node_requires_per_leg_context"
    | "child_has_evidence"
    | "child_requires_per_leg_context";
  offendingNodeId: string;
};
type DTNode = {
  id: string;
  options?: Array<{ label: string; childId?: string; outcomeType?: string }>;
  appliesPerInvoice?: boolean;
  requiresPerLegContext?: boolean;
  evidenceRequirements?: Array<unknown>;
};
type DTTree = { rootId?: string; nodes?: DTNode[] };

function validateAppliesPerInvoiceServer(tree: unknown): AppliesPerInvoiceViolation[] {
  const violations: AppliesPerInvoiceViolation[] = [];
  if (!tree || typeof tree !== "object") return violations;
  const t = tree as DTTree;
  if (!Array.isArray(t.nodes)) return violations;
  for (const node of t.nodes) {
    if (node?.appliesPerInvoice !== true) continue;
    if ((node.evidenceRequirements?.length ?? 0) > 0) {
      violations.push({ nodeId: node.id, reason: "node_has_evidence", offendingNodeId: node.id });
    }
    if (node.requiresPerLegContext === true) {
      violations.push({ nodeId: node.id, reason: "node_requires_per_leg_context", offendingNodeId: node.id });
    }
    for (const opt of node.options ?? []) {
      if (!opt.childId) continue;
      const child = t.nodes.find((n) => n.id === opt.childId);
      if (!child) continue;
      if ((child.evidenceRequirements?.length ?? 0) > 0) {
        violations.push({ nodeId: node.id, reason: "child_has_evidence", offendingNodeId: child.id });
      }
      if (child.requiresPerLegContext === true) {
        violations.push({ nodeId: node.id, reason: "child_requires_per_leg_context", offendingNodeId: child.id });
      }
    }
  }
  return violations;
}

// Read-only GETs stay open so clerk views can render error-type labels;
// write endpoints below are gated with denyClerk.

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

router.get("/error-types", asyncHandler(async (_req, res): Promise<void> => {
  const types = await db.select().from(errorTypesTable);
  res.json(types);
}));

router.post("/error-types", denyClerk, asyncHandler(async (req, res): Promise<void> => {
  const body = req.body;
  if (!body.name) { res.status(400).json({ error: "name is required" }); return; }

  if (body.decisionTree) {
    const violations = validateAppliesPerInvoiceServer(body.decisionTree);
    if (violations.length > 0) {
      res.status(400).json({
        code: "applies_per_invoice_invalid",
        error: "Decision tree has appliesPerInvoice nodes that conflict with evidence or per-leg context.",
        violations,
      });
      return;
    }
  }

  const [errorType] = await db.insert(errorTypesTable).values({
    name: body.name,
    category: body.category || null,
    description: body.description || null,
    guidance: body.guidance || null,
    recommendedActions: body.recommendedActions || null,
    disputeReasonsLibrary: body.disputeReasonsLibrary || null,
    evidenceRequirements: body.evidenceRequirements || null,
    decisionTree: body.decisionTree || null,
    emailTemplate: body.emailTemplate || null,
    disputeInstructions: body.disputeInstructions || null,
    useGpsControlDeviation: body.useGpsControlDeviation === true,
    useDirectEmail: body.useDirectEmail === true,
    tripOverriding: body.tripOverriding === true,
  }).returning();

  res.status(201).json(errorType);
}));

router.get("/error-types/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [errorType] = await db.select().from(errorTypesTable).where(eq(errorTypesTable.id, id));
  if (!errorType) { res.status(404).json({ error: "Error type not found" }); return; }

  res.json(errorType);
}));

router.patch("/error-types/:id", denyClerk, asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const updateData: Partial<typeof errorTypesTable.$inferInsert> = {};
  const fields = ["name", "category", "description", "guidance", "recommendedActions",
    "disputeReasonsLibrary", "evidenceRequirements", "decisionTree", "emailTemplate", "disputeInstructions"] as const;
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      (updateData as Record<string, unknown>)[f] = req.body[f];
    }
  }
  if (req.body.useGpsControlDeviation !== undefined) {
    updateData.useGpsControlDeviation = req.body.useGpsControlDeviation === true;
  }
  if (req.body.useDirectEmail !== undefined) {
    updateData.useDirectEmail = req.body.useDirectEmail === true;
  }
  if (req.body.tripOverriding !== undefined) {
    updateData.tripOverriding = req.body.tripOverriding === true;
  }

  if (req.body.decisionTree !== undefined && req.body.decisionTree !== null) {
    const violations = validateAppliesPerInvoiceServer(req.body.decisionTree);
    if (violations.length > 0) {
      res.status(400).json({
        code: "applies_per_invoice_invalid",
        error: "Decision tree has appliesPerInvoice nodes that conflict with evidence or per-leg context.",
        violations,
      });
      return;
    }
  }

  const [errorType] = await db.update(errorTypesTable).set(updateData).where(eq(errorTypesTable.id, id)).returning();
  if (!errorType) { res.status(404).json({ error: "Error type not found" }); return; }

  res.json(errorType);
}));

router.delete("/error-types/:id", denyClerk, asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [errorType] = await db.delete(errorTypesTable).where(eq(errorTypesTable.id, id)).returning();
  if (!errorType) { res.status(404).json({ error: "Error type not found" }); return; }

  res.sendStatus(204);
}));

export default router;

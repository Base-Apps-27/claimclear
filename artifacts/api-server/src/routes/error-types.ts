import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { errorTypesTable, errorTypeVersionsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { denyClerk } from "../middlewares/denyClerk";

// Task #772 — the db handle's type, exposed so `writeVersionSnapshot`
// can accept either the global `db` or a transaction handle of the
// same shape (drizzle's `db.transaction(tx => …)`). Matches the task
// brief's `writeVersionSnapshot(tx, errorType, createdBy)` signature.
type DbOrTx = typeof db;

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

// Task #772 — count nodes in a decision tree snapshot for the cheap
// listing column. Returns 0 for missing/invalid trees so callers don't
// have to special-case nulls.
function countTreeNodes(tree: unknown): number {
  if (!tree || typeof tree !== "object") return 0;
  const nodes = (tree as DTTree).nodes;
  return Array.isArray(nodes) ? nodes.length : 0;
}

// Task #772 — explicit JSON-serializable payload stored in
// `error_type_versions.snapshot`. Keeping this typed (rather than
// stuffing the raw drizzle row in via a cast) means the audit trail
// cannot silently accept malformed or non-JSON values, and any
// schema drift in `error_types` forces a deliberate update here.
//
// Timestamps are serialized as ISO strings — `jsonb` can store
// `Date` objects but they round-trip back as strings anyway, so we
// normalize at the write boundary to keep reads predictable.
type ErrorTypeVersionSnapshot = {
  id: number;
  name: string;
  category: string | null;
  description: string | null;
  guidance: string | null;
  recommendedActions: string | null;
  disputeReasonsLibrary: unknown;
  evidenceRequirements: unknown;
  decisionTree: unknown;
  emailTemplate: string | null;
  disputeInstructions: string | null;
  useGpsControlDeviation: boolean;
  useDirectEmail: boolean;
  tripOverriding: boolean;
  sourceSopText: string | null;
  createdAt: string;
  updatedAt: string;
};

function buildErrorTypeSnapshot(
  errorType: typeof errorTypesTable.$inferSelect,
): ErrorTypeVersionSnapshot {
  return {
    id: errorType.id,
    name: errorType.name,
    category: errorType.category,
    description: errorType.description,
    guidance: errorType.guidance,
    recommendedActions: errorType.recommendedActions,
    disputeReasonsLibrary: errorType.disputeReasonsLibrary,
    evidenceRequirements: errorType.evidenceRequirements,
    decisionTree: errorType.decisionTree,
    emailTemplate: errorType.emailTemplate,
    disputeInstructions: errorType.disputeInstructions,
    useGpsControlDeviation: errorType.useGpsControlDeviation,
    useDirectEmail: errorType.useDirectEmail,
    tripOverriding: errorType.tripOverriding,
    sourceSopText: errorType.sourceSopText,
    createdAt: errorType.createdAt.toISOString(),
    updatedAt: errorType.updatedAt.toISOString(),
  };
}

// Task #772 — append-only snapshot writer. Called after the main
// POST/PATCH write commits so an audit-write failure can never roll
// back the user's save. Failures are logged and swallowed (the save
// already succeeded — we must not surface an audit-write error as
// a failed save).
async function writeVersionSnapshot(
  tx: DbOrTx,
  req: Request,
  errorType: typeof errorTypesTable.$inferSelect,
  createdBy: string | null,
): Promise<void> {
  try {
    const snapshot = buildErrorTypeSnapshot(errorType);
    await tx.insert(errorTypeVersionsTable).values({
      errorTypeId: errorType.id,
      snapshot,
      treeNodeCount: countTreeNodes(errorType.decisionTree),
      createdBy,
      comment: null,
    });
  } catch (err) {
    req.log?.error?.({ err, errorTypeId: errorType.id }, "error_type_version_snapshot_failed");
  }
}

// Task #772 — Single source of truth for "patch this error type with
// a partial body". Both the public PATCH handler and the
// versions/:versionId/restore handler funnel through this helper, so
// validators, normalization (e.g. boolean coercion), the actual write
// and the audit snapshot all behave identically regardless of caller.
//
// Returns true if the response was sent (the helper writes 400 / 404
// directly so callers don't have to re-derive the response shape).
async function applyErrorTypeUpdate(
  req: Request,
  res: Response,
  id: number,
  body: Record<string, unknown>,
): Promise<boolean> {
  const updateData: Partial<typeof errorTypesTable.$inferInsert> = {};
  const fields = ["name", "category", "description", "guidance", "recommendedActions",
    "disputeReasonsLibrary", "evidenceRequirements", "decisionTree", "emailTemplate", "disputeInstructions",
    "sourceSopText"] as const;
  for (const f of fields) {
    if (body[f] !== undefined) {
      (updateData as Record<string, unknown>)[f] = body[f];
    }
  }
  if (body.useGpsControlDeviation !== undefined) {
    updateData.useGpsControlDeviation = body.useGpsControlDeviation === true;
  }
  if (body.useDirectEmail !== undefined) {
    updateData.useDirectEmail = body.useDirectEmail === true;
  }
  if (body.tripOverriding !== undefined) {
    updateData.tripOverriding = body.tripOverriding === true;
  }

  if (body.decisionTree !== undefined && body.decisionTree !== null) {
    const violations = validateAppliesPerInvoiceServer(body.decisionTree);
    if (violations.length > 0) {
      res.status(400).json({
        code: "applies_per_invoice_invalid",
        error: "Decision tree has appliesPerInvoice nodes that conflict with evidence or per-leg context.",
        violations,
      });
      return true;
    }
  }

  const [errorType] = await db.update(errorTypesTable).set(updateData).where(eq(errorTypesTable.id, id)).returning();
  if (!errorType) { res.status(404).json({ error: "Error type not found" }); return true; }

  await writeVersionSnapshot(db, req, errorType, req.user?.email ?? null);

  res.json(errorType);
  return true;
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
    sourceSopText: body.sourceSopText || null,
    useGpsControlDeviation: body.useGpsControlDeviation === true,
    useDirectEmail: body.useDirectEmail === true,
    tripOverriding: body.tripOverriding === true,
  }).returning();

  await writeVersionSnapshot(db, req, errorType, req.user?.email ?? null);

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

  await applyErrorTypeUpdate(req, res, id, req.body ?? {});
}));

router.delete("/error-types/:id", denyClerk, asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [errorType] = await db.delete(errorTypesTable).where(eq(errorTypesTable.id, id)).returning();
  if (!errorType) { res.status(404).json({ error: "Error type not found" }); return; }

  res.sendStatus(204);
}));

// Task #772 — SOP version history.
//
// GET lists the most recent 50 snapshots, newest first, with the cheap
// columns the UI needs to render a list (no snapshot blob).
router.get("/error-types/:id/versions", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const rows = await db
    .select({
      id: errorTypeVersionsTable.id,
      createdAt: errorTypeVersionsTable.createdAt,
      createdBy: errorTypeVersionsTable.createdBy,
      comment: errorTypeVersionsTable.comment,
      treeNodeCount: errorTypeVersionsTable.treeNodeCount,
    })
    .from(errorTypeVersionsTable)
    .where(eq(errorTypeVersionsTable.errorTypeId, id))
    .orderBy(desc(errorTypeVersionsTable.createdAt), desc(errorTypeVersionsTable.id))
    .limit(50);

  res.json(rows);
}));

// Task #847 — GET a single version row with its full snapshot blob,
// so the history drawer can render a side-by-side diff against the
// current draft (or another snapshot). Kept separate from the list
// endpoint above on purpose: listings stay cheap by omitting the
// snapshot, and the diff UI fetches the blob lazily per selected row.
router.get("/error-types/:id/versions/:versionId", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const versionId = parseId(req.params.versionId);
  if (isNaN(id) || isNaN(versionId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [version] = await db
    .select()
    .from(errorTypeVersionsTable)
    .where(eq(errorTypeVersionsTable.id, versionId));

  if (!version || version.errorTypeId !== id) {
    res.status(404).json({ error: "Version not found" });
    return;
  }

  res.json({
    id: version.id,
    createdAt: version.createdAt,
    createdBy: version.createdBy,
    comment: version.comment,
    treeNodeCount: version.treeNodeCount,
    snapshot: version.snapshot,
  });
}));

// POST restores a snapshot by funneling its fields through
// `applyErrorTypeUpdate` — the same internal update path the PATCH
// handler uses. That guarantees validators (e.g.
// `validateAppliesPerInvoiceServer`), boolean normalization and the
// post-write audit snapshot all run identically for restore and
// regular edits. Returns the updated error type.
router.post("/error-types/:id/versions/:versionId/restore", denyClerk, asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const versionId = parseId(req.params.versionId);
  if (isNaN(id) || isNaN(versionId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [version] = await db
    .select()
    .from(errorTypeVersionsTable)
    .where(eq(errorTypeVersionsTable.id, versionId));

  if (!version || version.errorTypeId !== id) {
    res.status(404).json({ error: "Version not found" });
    return;
  }

  const snap = version.snapshot as Record<string, unknown>;

  // Build a PATCH-shaped body from the snapshot — every patchable
  // column, no metadata (id / createdAt / updatedAt) — and hand it
  // off to the shared update path.
  const patchBody: Record<string, unknown> = {
    name: snap.name,
    category: snap.category ?? null,
    description: snap.description ?? null,
    guidance: snap.guidance ?? null,
    recommendedActions: snap.recommendedActions ?? null,
    disputeReasonsLibrary: snap.disputeReasonsLibrary ?? null,
    evidenceRequirements: snap.evidenceRequirements ?? null,
    decisionTree: snap.decisionTree ?? null,
    emailTemplate: snap.emailTemplate ?? null,
    disputeInstructions: snap.disputeInstructions ?? null,
    sourceSopText: snap.sourceSopText ?? null,
    useGpsControlDeviation: snap.useGpsControlDeviation === true,
    useDirectEmail: snap.useDirectEmail === true,
    tripOverriding: snap.tripOverriding === true,
  };

  await applyErrorTypeUpdate(req, res, id, patchBody);
}));

export default router;

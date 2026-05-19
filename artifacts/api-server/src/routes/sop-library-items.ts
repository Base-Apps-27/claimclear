import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { sopLibraryItemsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { denyClerk } from "../middlewares/denyClerk";

// Task #771 — shared SOP library (evidence requirements + decision-tree
// sub-trees). Mirrors the error-types route shape: read-only GETs are
// open so clerk views can render labels in the picker; writes are
// gated with denyClerk.

const router: IRouter = Router();

const ALLOWED_KINDS = new Set(["evidence_requirement", "sub_tree"]);

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

router.get("/sop-library-items", asyncHandler(async (_req, res): Promise<void> => {
  const items = await db.select().from(sopLibraryItemsTable);
  res.json(items);
}));

router.post("/sop-library-items", denyClerk, asyncHandler(async (req, res): Promise<void> => {
  const body = req.body ?? {};
  if (!body.label || typeof body.label !== "string") {
    res.status(400).json({ error: "label is required" });
    return;
  }
  if (!body.kind || !ALLOWED_KINDS.has(body.kind)) {
    res.status(400).json({ error: "kind must be 'evidence_requirement' or 'sub_tree'" });
    return;
  }
  if (body.payload === undefined || body.payload === null || typeof body.payload !== "object") {
    res.status(400).json({ error: "payload is required and must be an object" });
    return;
  }

  const [item] = await db.insert(sopLibraryItemsTable).values({
    kind: body.kind,
    label: body.label,
    description: body.description ?? null,
    payload: body.payload,
  }).returning();

  res.status(201).json(item);
}));

router.get("/sop-library-items/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [item] = await db.select().from(sopLibraryItemsTable).where(eq(sopLibraryItemsTable.id, id));
  if (!item) { res.status(404).json({ error: "SOP library item not found" }); return; }

  res.json(item);
}));

router.patch("/sop-library-items/:id", denyClerk, asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const updateData: Partial<typeof sopLibraryItemsTable.$inferInsert> = {};
  if (req.body.kind !== undefined) {
    if (!ALLOWED_KINDS.has(req.body.kind)) {
      res.status(400).json({ error: "kind must be 'evidence_requirement' or 'sub_tree'" });
      return;
    }
    updateData.kind = req.body.kind;
  }
  if (req.body.label !== undefined) {
    if (typeof req.body.label !== "string" || req.body.label.length === 0) {
      res.status(400).json({ error: "label must be a non-empty string" });
      return;
    }
    updateData.label = req.body.label;
  }
  if (req.body.description !== undefined) {
    updateData.description = req.body.description;
  }
  if (req.body.payload !== undefined) {
    if (req.body.payload === null || typeof req.body.payload !== "object") {
      res.status(400).json({ error: "payload must be an object" });
      return;
    }
    updateData.payload = req.body.payload;
  }

  const [item] = await db.update(sopLibraryItemsTable).set(updateData).where(eq(sopLibraryItemsTable.id, id)).returning();
  if (!item) { res.status(404).json({ error: "SOP library item not found" }); return; }

  res.json(item);
}));

router.delete("/sop-library-items/:id", denyClerk, asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [item] = await db.delete(sopLibraryItemsTable).where(eq(sopLibraryItemsTable.id, id)).returning();
  if (!item) { res.status(404).json({ error: "SOP library item not found" }); return; }

  res.sendStatus(204);
}));

export default router;

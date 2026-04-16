import { Router, type Request, type Response } from "express";
import { db, evidenceTypesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/evidence-types", async (_req: Request, res: Response) => {
  try {
    const evidenceTypes = await db.select().from(evidenceTypesTable).orderBy(evidenceTypesTable.name);
    res.json({ evidenceTypes });
  } catch (error) {
    _req.log.error({ err: error }, "Error listing evidence types");
    res.status(500).json({ error: "Failed to list evidence types" });
  }
});

router.post("/evidence-types", async (req: Request, res: Response) => {
  const { name, description, category, acceptsImage, acceptsText, instructionText, instructionImageUrl } = req.body;
  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  try {
    const [created] = await db.insert(evidenceTypesTable).values({
      name,
      description: description || null,
      category: category || null,
      acceptsImage: acceptsImage ?? true,
      acceptsText: acceptsText ?? false,
      instructionText: instructionText || null,
      instructionImageUrl: instructionImageUrl || null,
    }).returning();
    res.status(201).json(created);
  } catch (error) {
    req.log.error({ err: error }, "Error creating evidence type");
    res.status(500).json({ error: "Failed to create evidence type" });
  }
});

router.put("/evidence-types/:id", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid evidence type ID" });
    return;
  }
  const { name, description, category, acceptsImage, acceptsText, instructionText, instructionImageUrl } = req.body;
  try {
    const [updated] = await db.update(evidenceTypesTable)
      .set({
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description: description || null }),
        ...(category !== undefined && { category: category || null }),
        ...(acceptsImage !== undefined && { acceptsImage }),
        ...(acceptsText !== undefined && { acceptsText }),
        ...(instructionText !== undefined && { instructionText: instructionText || null }),
        ...(instructionImageUrl !== undefined && { instructionImageUrl: instructionImageUrl || null }),
      })
      .where(eq(evidenceTypesTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Evidence type not found" });
      return;
    }
    res.json(updated);
  } catch (error) {
    req.log.error({ err: error }, "Error updating evidence type");
    res.status(500).json({ error: "Failed to update evidence type" });
  }
});

router.delete("/evidence-types/:id", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid evidence type ID" });
    return;
  }
  try {
    await db.delete(evidenceTypesTable).where(eq(evidenceTypesTable.id, id));
    res.json({ success: true });
  } catch (error) {
    req.log.error({ err: error }, "Error deleting evidence type");
    res.status(500).json({ error: "Failed to delete evidence type" });
  }
});

export default router;

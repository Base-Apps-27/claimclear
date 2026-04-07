import { Router, type Request, type Response } from "express";
import { db, evidenceTypesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/evidence-types", async (_req: Request, res: Response) => {
  const evidenceTypes = await db.select().from(evidenceTypesTable).orderBy(evidenceTypesTable.name);
  res.json({ evidenceTypes });
});

router.post("/evidence-types", async (req: Request, res: Response) => {
  const { name, description, category, acceptsImage, acceptsText, instructionText, instructionImageUrl } = req.body;
  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
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
});

router.put("/evidence-types/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { name, description, category, acceptsImage, acceptsText, instructionText, instructionImageUrl } = req.body;
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
});

router.delete("/evidence-types/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  await db.delete(evidenceTypesTable).where(eq(evidenceTypesTable.id, id));
  res.json({ success: true });
});

export default router;

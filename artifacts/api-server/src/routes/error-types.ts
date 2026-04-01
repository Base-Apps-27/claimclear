import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { errorTypesTable } from "@workspace/db";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

router.get("/error-types", async (_req, res): Promise<void> => {
  const types = await db.select().from(errorTypesTable);
  res.json(types);
});

router.post("/error-types", async (req, res): Promise<void> => {
  const body = req.body;
  if (!body.name) { res.status(400).json({ error: "name is required" }); return; }

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
  }).returning();

  res.status(201).json(errorType);
});

router.get("/error-types/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [errorType] = await db.select().from(errorTypesTable).where(eq(errorTypesTable.id, id));
  if (!errorType) { res.status(404).json({ error: "Error type not found" }); return; }

  res.json(errorType);
});

router.patch("/error-types/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const updateData: Partial<typeof errorTypesTable.$inferInsert> = {};
  const fields = ["name", "category", "description", "guidance", "recommendedActions",
    "disputeReasonsLibrary", "evidenceRequirements", "decisionTree", "emailTemplate"] as const;
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      (updateData as Record<string, unknown>)[f] = req.body[f];
    }
  }

  const [errorType] = await db.update(errorTypesTable).set(updateData).where(eq(errorTypesTable.id, id)).returning();
  if (!errorType) { res.status(404).json({ error: "Error type not found" }); return; }

  res.json(errorType);
});

router.delete("/error-types/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [errorType] = await db.delete(errorTypesTable).where(eq(errorTypesTable.id, id)).returning();
  if (!errorType) { res.status(404).json({ error: "Error type not found" }); return; }

  res.sendStatus(204);
});

export default router;

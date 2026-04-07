import { Router, type Request, type Response } from "express";
import { db, claimEvidenceTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

router.get("/claims/:claimId/evidence", async (req: Request, res: Response) => {
  const claimId = parseInt(req.params.claimId, 10);
  const evidence = await db.select().from(claimEvidenceTable)
    .where(eq(claimEvidenceTable.claimId, claimId))
    .orderBy(claimEvidenceTable.collectedAt);
  res.json({ evidence });
});

router.post("/claims/:claimId/evidence", async (req: Request, res: Response) => {
  const claimId = parseInt(req.params.claimId, 10);
  const { evidenceTypeId, evidenceTypeName, treeNodeId, imageUrl, notes } = req.body;
  if (!evidenceTypeName) {
    res.status(400).json({ error: "evidenceTypeName is required" });
    return;
  }
  const user = (req as any).user;
  const [created] = await db.insert(claimEvidenceTable).values({
    claimId,
    evidenceTypeId: evidenceTypeId || null,
    evidenceTypeName,
    treeNodeId: treeNodeId || null,
    imageUrl: imageUrl || null,
    notes: notes || null,
    collectedBy: user?.displayName || user?.email || null,
  }).returning();
  res.status(201).json(created);
});

router.delete("/claims/:claimId/evidence/:evidenceId", async (req: Request, res: Response) => {
  const claimId = parseInt(req.params.claimId, 10);
  const evidenceId = parseInt(req.params.evidenceId, 10);
  await db.delete(claimEvidenceTable)
    .where(and(eq(claimEvidenceTable.id, evidenceId), eq(claimEvidenceTable.claimId, claimId)));
  res.json({ success: true });
});

export default router;

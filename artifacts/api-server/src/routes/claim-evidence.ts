import { Router, type Request, type Response } from "express";
import { db, claimEvidenceTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

router.get("/claims/:claimId/evidence", async (req: Request, res: Response) => {
  const claimId = parseInt(req.params.claimId, 10);
  if (isNaN(claimId)) {
    res.status(400).json({ error: "Invalid claim ID" });
    return;
  }
  try {
    const evidence = await db.select().from(claimEvidenceTable)
      .where(eq(claimEvidenceTable.claimId, claimId))
      .orderBy(claimEvidenceTable.collectedAt);
    res.json({ evidence });
  } catch (error) {
    req.log.error({ err: error }, "Error listing claim evidence");
    res.status(500).json({ error: "Failed to list claim evidence" });
  }
});

router.post("/claims/:claimId/evidence", async (req: Request, res: Response) => {
  const claimId = parseInt(req.params.claimId, 10);
  if (isNaN(claimId)) {
    res.status(400).json({ error: "Invalid claim ID" });
    return;
  }
  const { evidenceTypeId, evidenceTypeName, treeNodeId, imageUrl, notes } = req.body;
  if (!evidenceTypeName) {
    res.status(400).json({ error: "evidenceTypeName is required" });
    return;
  }
  try {
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
  } catch (error) {
    req.log.error({ err: error }, "Error adding claim evidence");
    res.status(500).json({ error: "Failed to add claim evidence" });
  }
});

router.delete("/claims/:claimId/evidence/:evidenceId", async (req: Request, res: Response) => {
  const claimId = parseInt(req.params.claimId, 10);
  const evidenceId = parseInt(req.params.evidenceId, 10);
  if (isNaN(claimId) || isNaN(evidenceId)) {
    res.status(400).json({ error: "Invalid claim or evidence ID" });
    return;
  }
  try {
    await db.delete(claimEvidenceTable)
      .where(and(eq(claimEvidenceTable.id, evidenceId), eq(claimEvidenceTable.claimId, claimId)));
    res.json({ success: true });
  } catch (error) {
    req.log.error({ err: error }, "Error deleting claim evidence");
    res.status(500).json({ error: "Failed to delete claim evidence" });
  }
});

export default router;

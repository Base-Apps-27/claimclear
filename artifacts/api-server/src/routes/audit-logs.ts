import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

router.get("/claims/:id/audit-logs", asyncHandler(async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const claimId = parseInt(raw, 10);
  if (isNaN(claimId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const logs = await db.select().from(auditLogsTable)
    .where(eq(auditLogsTable.claimId, claimId))
    .orderBy(desc(auditLogsTable.timestamp));

  res.json(logs);
}));

export default router;

import { Router, type IRouter } from "express";
import { eq, and, gt } from "drizzle-orm";
import { db } from "@workspace/db";
import { presenceLogsTable } from "@workspace/db";

const router: IRouter = Router();

router.post("/presence/heartbeat", async (req, res): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { claimId } = req.body;
  if (!claimId) { res.status(400).json({ error: "claimId is required" }); return; }

  const userEmail = req.user.email!;
  const userName = req.user.displayName ?? null;

  const existing = await db.select().from(presenceLogsTable)
    .where(and(
      eq(presenceLogsTable.claimId, claimId),
      eq(presenceLogsTable.userEmail, userEmail)
    ));

  if (existing.length > 0) {
    await db.update(presenceLogsTable).set({
      lastHeartbeat: new Date(),
      userName,
    }).where(eq(presenceLogsTable.id, existing[0].id));
  } else {
    await db.insert(presenceLogsTable).values({
      claimId,
      userEmail,
      userName,
      lastHeartbeat: new Date(),
    });
  }

  res.json({ success: true });
});

router.post("/presence/leave", async (req, res): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { claimId } = req.body;
  if (!claimId) { res.status(400).json({ error: "claimId is required" }); return; }

  await db.delete(presenceLogsTable).where(
    and(
      eq(presenceLogsTable.claimId, claimId),
      eq(presenceLogsTable.userEmail, req.user.email!)
    )
  );

  res.json({ success: true });
});

router.get("/presence/:claimId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.claimId) ? req.params.claimId[0] : req.params.claimId;
  const claimId = parseInt(raw, 10);
  if (isNaN(claimId)) { res.status(400).json({ error: "Invalid claimId" }); return; }

  const staleThreshold = new Date(Date.now() - 45 * 1000);

  const viewers = await db.select({
    userEmail: presenceLogsTable.userEmail,
    userName: presenceLogsTable.userName,
    lastHeartbeat: presenceLogsTable.lastHeartbeat,
  }).from(presenceLogsTable)
    .where(and(
      eq(presenceLogsTable.claimId, claimId),
      gt(presenceLogsTable.lastHeartbeat, staleThreshold)
    ));

  res.json(viewers);
});

export default router;

import { Router, type IRouter } from "express";
import { eq, and, gt, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { presenceLogsTable, portalSubmissionsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { broadcastPresenceEvent } from "../lib/sse";
import { getActiveBotProcesses } from "../lib/bot-presence";

const router: IRouter = Router();

router.post("/presence/heartbeat", asyncHandler(async (req, res): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { claimId } = req.body;
  if (!claimId) { res.status(400).json({ error: "claimId is required" }); return; }

  const userEmail = req.user.email!;
  const userName = req.user.displayName ?? null;

  const existing = await db.select({ id: presenceLogsTable.id })
    .from(presenceLogsTable)
    .where(and(
      eq(presenceLogsTable.claimId, claimId),
      eq(presenceLogsTable.userEmail, userEmail),
      gt(presenceLogsTable.lastHeartbeat, new Date(Date.now() - 45 * 1000))
    ));

  await db.execute(
    sql`INSERT INTO presence_logs (claim_id, user_email, user_name, last_heartbeat)
        VALUES (${claimId}, ${userEmail}, ${userName}, NOW())
        ON CONFLICT (claim_id, user_email) DO UPDATE
        SET last_heartbeat = NOW(), user_name = EXCLUDED.user_name`
  );

  if (existing.length === 0) {
    broadcastPresenceEvent({
      type: "viewer_joined",
      claimId,
      userName,
      userEmail,
      timestamp: new Date().toISOString(),
    });
  }

  res.json({ success: true });
}));

router.post("/presence/leave", asyncHandler(async (req, res): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { claimId } = req.body;
  if (!claimId) { res.status(400).json({ error: "claimId is required" }); return; }

  const userEmail = req.user.email!;
  const userName = req.user.displayName ?? null;

  await db.delete(presenceLogsTable).where(
    and(
      eq(presenceLogsTable.claimId, claimId),
      eq(presenceLogsTable.userEmail, userEmail)
    )
  );

  broadcastPresenceEvent({
    type: "viewer_left",
    claimId,
    userName,
    userEmail,
    timestamp: new Date().toISOString(),
  });

  res.json({ success: true });
}));

router.get("/presence/:claimId", asyncHandler(async (req, res): Promise<void> => {
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

  const activeSubmissions = await db.select({
    id: portalSubmissionsTable.id,
    status: portalSubmissionsTable.status,
    createdAt: portalSubmissionsTable.createdAt,
  }).from(portalSubmissionsTable)
    .where(and(
      eq(portalSubmissionsTable.claimId, claimId),
      eq(portalSubmissionsTable.status, "in_progress")
    ));

  const botActivity: Array<{
    type: string;
    submissionId: number;
    status: string;
    startedAt: string | null;
  }> = activeSubmissions.map(s => ({
    type: "portal_submission",
    submissionId: s.id,
    status: s.status,
    startedAt: s.createdAt?.toISOString() ?? null,
  }));

  const inMemoryProcesses = getActiveBotProcesses(claimId);
  for (const proc of inMemoryProcesses) {
    botActivity.push({
      type: proc.type,
      submissionId: 0,
      status: "in_progress",
      startedAt: proc.startedAt,
    });
  }

  res.json({ viewers, botActivity });
}));

export default router;

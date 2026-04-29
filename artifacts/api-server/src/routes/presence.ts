import { Router, type IRouter } from "express";
import { eq, and, gt, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { presenceLogsTable, portalSubmissionsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { broadcastPresenceEvent, type PresenceResourceType } from "../lib/sse";
import { getActiveBotProcesses } from "../lib/bot-presence";

const router: IRouter = Router();

const VALID_RESOURCE_TYPES: PresenceResourceType[] = ["claim", "invoice_group"];

function parseResourceType(raw: unknown): PresenceResourceType | null {
  if (typeof raw !== "string") return null;
  return VALID_RESOURCE_TYPES.includes(raw as PresenceResourceType)
    ? (raw as PresenceResourceType)
    : null;
}

router.post("/presence/heartbeat", asyncHandler(async (req, res): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const resourceType = parseResourceType(req.body?.resourceType);
  const resourceId = Number(req.body?.resourceId);
  if (!resourceType || !Number.isFinite(resourceId) || resourceId <= 0) {
    res.status(400).json({ error: "resourceType and resourceId are required" });
    return;
  }

  const userEmail = req.user.email!;
  const userName = req.user.displayName ?? null;

  const existing = await db.select({ id: presenceLogsTable.id })
    .from(presenceLogsTable)
    .where(and(
      eq(presenceLogsTable.resourceType, resourceType),
      eq(presenceLogsTable.resourceId, resourceId),
      eq(presenceLogsTable.userEmail, userEmail),
      gt(presenceLogsTable.lastHeartbeat, new Date(Date.now() - 45 * 1000))
    ));

  await db.execute(
    sql`INSERT INTO presence_logs (resource_type, resource_id, user_email, user_name, last_heartbeat)
        VALUES (${resourceType}, ${resourceId}, ${userEmail}, ${userName}, NOW())
        ON CONFLICT (resource_type, resource_id, user_email) DO UPDATE
        SET last_heartbeat = NOW(), user_name = EXCLUDED.user_name`
  );

  if (existing.length === 0) {
    broadcastPresenceEvent({
      type: "viewer_joined",
      resourceType,
      resourceId,
      userName,
      userEmail,
      timestamp: new Date().toISOString(),
    });
  }

  res.json({ success: true });
}));

router.post("/presence/leave", asyncHandler(async (req, res): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const resourceType = parseResourceType(req.body?.resourceType);
  const resourceId = Number(req.body?.resourceId);
  if (!resourceType || !Number.isFinite(resourceId) || resourceId <= 0) {
    res.status(400).json({ error: "resourceType and resourceId are required" });
    return;
  }

  const userEmail = req.user.email!;
  const userName = req.user.displayName ?? null;

  await db.delete(presenceLogsTable).where(
    and(
      eq(presenceLogsTable.resourceType, resourceType),
      eq(presenceLogsTable.resourceId, resourceId),
      eq(presenceLogsTable.userEmail, userEmail)
    )
  );

  broadcastPresenceEvent({
    type: "viewer_left",
    resourceType,
    resourceId,
    userName,
    userEmail,
    timestamp: new Date().toISOString(),
  });

  res.json({ success: true });
}));

router.get("/presence/:resourceType/:resourceId", asyncHandler(async (req, res): Promise<void> => {
  const rawType = Array.isArray(req.params.resourceType) ? req.params.resourceType[0] : req.params.resourceType;
  const resourceType = parseResourceType(rawType);
  if (!resourceType) { res.status(400).json({ error: "Invalid resourceType" }); return; }

  const rawId = Array.isArray(req.params.resourceId) ? req.params.resourceId[0] : req.params.resourceId;
  const resourceId = parseInt(rawId, 10);
  if (isNaN(resourceId)) { res.status(400).json({ error: "Invalid resourceId" }); return; }

  const staleThreshold = new Date(Date.now() - 45 * 1000);

  const viewers = await db.select({
    userEmail: presenceLogsTable.userEmail,
    userName: presenceLogsTable.userName,
    lastHeartbeat: presenceLogsTable.lastHeartbeat,
  }).from(presenceLogsTable)
    .where(and(
      eq(presenceLogsTable.resourceType, resourceType),
      eq(presenceLogsTable.resourceId, resourceId),
      gt(presenceLogsTable.lastHeartbeat, staleThreshold)
    ));

  const botActivity: Array<{
    type: string;
    submissionId: number;
    status: string;
    startedAt: string | null;
  }> = [];

  // Bot presence is only tracked for claim resources today: portal submissions
  // and AI email generation are recorded against claim IDs, so invoice-group
  // viewers don't see bot activity yet.
  if (resourceType === "claim") {
    const activeSubmissions = await db.select({
      id: portalSubmissionsTable.id,
      status: portalSubmissionsTable.status,
      createdAt: portalSubmissionsTable.createdAt,
    }).from(portalSubmissionsTable)
      .where(and(
        eq(portalSubmissionsTable.claimId, resourceId),
        eq(portalSubmissionsTable.status, "in_progress")
      ));

    for (const s of activeSubmissions) {
      botActivity.push({
        type: "portal_submission",
        submissionId: s.id,
        status: s.status,
        startedAt: s.createdAt?.toISOString() ?? null,
      });
    }

    const inMemoryProcesses = getActiveBotProcesses(resourceId);
    for (const proc of inMemoryProcesses) {
      botActivity.push({
        type: proc.type,
        submissionId: 0,
        status: "in_progress",
        startedAt: proc.startedAt,
      });
    }
  }

  res.json({ viewers, botActivity });
}));

export default router;

import { Router, type IRouter } from "express";
import { eq, and, gt, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { presenceLogsTable, portalSubmissionsTable, claimsTable } from "@workspace/db";
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

// Identity normalization for the presence path. The IdP can return the same
// human's email in different cases between sessions, and Postgres text
// equality is byte-exact. Normalizing on every write/read makes the unique
// constraint and the self-exclusion filter behave consistently regardless
// of historical casing.
function normalizeEmail(e: string | null | undefined): string {
  return (e ?? "").trim().toLowerCase();
}

router.post("/presence/heartbeat", asyncHandler(async (req, res): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const resourceType = parseResourceType(req.body?.resourceType);
  const resourceId = Number(req.body?.resourceId);
  if (!resourceType || !Number.isFinite(resourceId) || resourceId <= 0) {
    res.status(400).json({ error: "resourceType and resourceId are required" });
    return;
  }

  const userEmail = normalizeEmail(req.user.email);
  const userName = req.user.displayName ?? null;

  const existing = await db.select({ id: presenceLogsTable.id })
    .from(presenceLogsTable)
    .where(and(
      eq(presenceLogsTable.resourceType, resourceType),
      eq(presenceLogsTable.resourceId, resourceId),
      sql`LOWER(${presenceLogsTable.userEmail}) = ${userEmail}`,
      gt(presenceLogsTable.lastHeartbeat, new Date(Date.now() - 45 * 1000))
    ));

  // Try the normalized upsert first. If a legacy mixed-case row already
  // exists for the same (resource_type, resource_id, user) but a different
  // case, the unique constraint is on the raw column so the ON CONFLICT
  // target won't match and the INSERT raises 23505. Fall back to a
  // case-insensitive UPDATE that touches the existing legacy row in place.
  try {
    await db.execute(
      sql`INSERT INTO presence_logs (resource_type, resource_id, user_email, user_name, last_heartbeat)
          VALUES (${resourceType}, ${resourceId}, ${userEmail}, ${userName}, NOW())
          ON CONFLICT (resource_type, resource_id, user_email) DO UPDATE
          SET last_heartbeat = NOW(), user_name = EXCLUDED.user_name`
    );
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== "23505") throw err;
    await db.execute(
      sql`UPDATE presence_logs
          SET last_heartbeat = NOW(), user_name = ${userName}
          WHERE resource_type = ${resourceType}
            AND resource_id = ${resourceId}
            AND LOWER(user_email) = ${userEmail}`
    );
  }

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

  const userEmail = normalizeEmail(req.user.email);
  const userName = req.user.displayName ?? null;

  // Race-safe leave: if the same user just heartbeat-ed for the same
  // resource (e.g. queue ↔ detail navigation, where the unmounting page
  // fires `leave` after the mounting page has already fired `heartbeat`
  // for the same tuple), skip the delete so the live row stays put.
  // Using LOWER() for the email match also reaps any legacy mixed-case
  // rows the user previously left behind.
  const deleted = await db.execute(
    sql`DELETE FROM presence_logs
        WHERE resource_type = ${resourceType}
          AND resource_id = ${resourceId}
          AND LOWER(user_email) = ${userEmail}
          AND last_heartbeat < NOW() - INTERVAL '2 seconds'
        RETURNING id`
  );

  // node-postgres surfaces the affected row count as `rowCount`; Drizzle's
  // `db.execute` forwards the underlying result. Fall back to the rows
  // array if rowCount isn't exposed by the driver.
  const result = deleted as unknown as { rowCount?: number | null; rows?: unknown[] };
  const removed = (result.rowCount ?? result.rows?.length ?? 0) > 0;

  if (removed) {
    broadcastPresenceEvent({
      type: "viewer_left",
      resourceType,
      resourceId,
      userName,
      userEmail,
      timestamp: new Date().toISOString(),
    });
  }

  res.json({ success: true });
}));

router.get("/presence/:resourceType/:resourceId", asyncHandler(async (req, res): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const rawType = Array.isArray(req.params.resourceType) ? req.params.resourceType[0] : req.params.resourceType;
  const resourceType = parseResourceType(rawType);
  if (!resourceType) { res.status(400).json({ error: "Invalid resourceType" }); return; }

  const rawId = Array.isArray(req.params.resourceId) ? req.params.resourceId[0] : req.params.resourceId;
  const resourceId = parseInt(rawId, 10);
  if (isNaN(resourceId)) { res.status(400).json({ error: "Invalid resourceId" }); return; }

  const currentUserEmail = normalizeEmail(req.user.email);
  const staleThreshold = new Date(Date.now() - 45 * 1000);

  // Self-exclusion happens server-side so the API can never return the
  // requester to themselves. This structurally eliminates the "I'm
  // viewing myself" symptom regardless of any client-side filter bug.
  const viewers = await db.select({
    userEmail: presenceLogsTable.userEmail,
    userName: presenceLogsTable.userName,
    lastHeartbeat: presenceLogsTable.lastHeartbeat,
  }).from(presenceLogsTable)
    .where(and(
      eq(presenceLogsTable.resourceType, resourceType),
      eq(presenceLogsTable.resourceId, resourceId),
      gt(presenceLogsTable.lastHeartbeat, staleThreshold),
      sql`LOWER(${presenceLogsTable.userEmail}) <> ${currentUserEmail}`
    ));

  const botActivity: Array<{
    type: string;
    submissionId: number;
    status: string;
    startedAt: string | null;
  }> = [];

  // Bot presence covers both claim and invoice-group resources. Portal
  // submissions are now group-scoped, so when the resource is a claim we
  // resolve its invoice group first and report any active submissions on the
  // group; in-memory bot processes (AI email generation) remain per-claim.
  let groupIdForBots: number | null = null;
  if (resourceType === "invoice_group") {
    groupIdForBots = resourceId;
  } else if (resourceType === "claim") {
    const [claim] = await db.select({ invoiceGroupId: claimsTable.invoiceGroupId })
      .from(claimsTable)
      .where(eq(claimsTable.id, resourceId))
      .limit(1);
    groupIdForBots = claim?.invoiceGroupId ?? null;
  }

  if (groupIdForBots !== null) {
    const activeSubmissions = await db.select({
      id: portalSubmissionsTable.id,
      status: portalSubmissionsTable.status,
      createdAt: portalSubmissionsTable.createdAt,
    }).from(portalSubmissionsTable)
      .where(and(
        eq(portalSubmissionsTable.invoiceGroupId, groupIdForBots),
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
  }

  if (resourceType === "claim") {
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

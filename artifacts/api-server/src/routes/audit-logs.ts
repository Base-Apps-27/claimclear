import { Router, type IRouter } from "express";
import { eq, or } from "drizzle-orm";
import { db } from "@workspace/db";
import { auditLogsTable, claimsTable, invoiceGroupsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

router.get("/claims/:id/audit-logs", asyncHandler(async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const claimId = parseInt(raw, 10);
  if (isNaN(claimId)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Look up the claim's parent invoice group so we can also pull group-level
  // audit rows. Group actions (status changes, triage, evidence adds, etc.)
  // silently sync the child claims, so the claim's history page would otherwise
  // look empty when most of the real action happened at the group level.
  const [claim] = await db.select({
    invoiceGroupId: claimsTable.invoiceGroupId,
  }).from(claimsTable).where(eq(claimsTable.id, claimId));

  const groupId = claim?.invoiceGroupId ?? null;

  let invoiceNumber: string | null = null;
  if (groupId !== null) {
    const [group] = await db.select({ invoiceNumber: invoiceGroupsTable.invoiceNumber })
      .from(invoiceGroupsTable)
      .where(eq(invoiceGroupsTable.id, groupId));
    invoiceNumber = group?.invoiceNumber ?? null;
  }

  // Fetch claim-direct rows AND parent-group rows in a single query, then
  // tag/sort in memory. Keeps wire size small and avoids a second round-trip
  // for the common case where there's no parent group.
  const whereClause = groupId !== null
    ? or(eq(auditLogsTable.claimId, claimId), eq(auditLogsTable.invoiceGroupId, groupId))
    : eq(auditLogsTable.claimId, claimId);

  const rows = await db.select().from(auditLogsTable).where(whereClause);

  const enriched = rows.map((log) => {
    const isGroupRow = log.claimId == null && log.invoiceGroupId != null;
    return {
      ...log,
      viaGroup: isGroupRow,
      invoiceNumber: isGroupRow ? invoiceNumber : null,
    };
  });

  enriched.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    return tb - ta;
  });

  res.json(enriched);
}));

export default router;

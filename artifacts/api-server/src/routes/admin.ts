import { Router, type IRouter } from "express";
import { eq, inArray, isNull, and, gte, lte, desc, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, invoiceGroupsTable, auditLogsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAdmin } from "../middlewares/requireAdmin";
import { parseInvoiceNumber } from "../lib/parseInvoiceNumber";
import { isDayConcluded, tryEmitDayCompletedCelebration } from "../lib/day-complete";
import {
  actionKeysForCategory,
  categoryForAction,
  isActionCategory,
  labelForAction,
} from "../lib/audit-categories";

const router: IRouter = Router();

router.post("/admin/backfill-invoice-groups", requireAdmin, asyncHandler(async (req, res): Promise<void> => {
  const dryRun = req.body?.dryRun === true;

  const result = await db.transaction(async (tx) => {
  const orphanClaims = await tx
    .select()
    .from(claimsTable)
    .where(isNull(claimsTable.invoiceGroupId));

  let groupsCreated = 0;
  let groupsUpdated = 0;
  let claimsLinked = 0;
  const unparseable: { id: number; confNumber: string; refNumber: string | null }[] = [];

  const byInvoice = new Map<string, typeof orphanClaims>();
  for (const c of orphanClaims) {
    const inv = parseInvoiceNumber(c.refNumber);
    if (!inv) {
      unparseable.push({ id: c.id, confNumber: c.confNumber, refNumber: c.refNumber });
      continue;
    }
    if (!byInvoice.has(inv)) byInvoice.set(inv, []);
    byInvoice.get(inv)!.push(c);
  }

  const invoiceNumbers = Array.from(byInvoice.keys());
  const existingGroupsMap = new Map<string, number>();
  if (invoiceNumbers.length > 0) {
    const existing = await tx
      .select({ id: invoiceGroupsTable.id, invoiceNumber: invoiceGroupsTable.invoiceNumber })
      .from(invoiceGroupsTable)
      .where(inArray(invoiceGroupsTable.invoiceNumber, invoiceNumbers));
    for (const g of existing) existingGroupsMap.set(g.invoiceNumber, g.id);
  }

  for (const [invoiceNumber, claimsForInvoice] of byInvoice.entries()) {
    let groupId = existingGroupsMap.get(invoiceNumber);

    let allClaimsForGroup = claimsForInvoice;
    if (groupId != null) {
      const siblings = await tx
        .select()
        .from(claimsTable)
        .where(eq(claimsTable.invoiceGroupId, groupId));
      allClaimsForGroup = [...siblings, ...claimsForInvoice];
    }

    const errorDetailsSet = new Set<string>();
    let groupClientNumber: string | null = null;
    let totalAmount = 0;
    let groupErrorTypeId: string | null = null;
    let groupErrorTypeName: string | null = null;
    for (const r of allClaimsForGroup) {
      if (r.errorDetails && r.errorDetails.trim()) errorDetailsSet.add(r.errorDetails.trim());
      if (r.clientNumber && !groupClientNumber) groupClientNumber = r.clientNumber;
      if (r.claimAmount != null) totalAmount += parseFloat(String(r.claimAmount)) || 0;
      if (r.errorTypeId && !groupErrorTypeId) {
        groupErrorTypeId = r.errorTypeId;
        groupErrorTypeName = r.errorTypeName || null;
      }
    }
    const groupErrorDetails = Array.from(errorDetailsSet).join("; ") || null;

    if (groupId == null) {
      if (!dryRun) {
        const [newGroup] = await tx.insert(invoiceGroupsTable).values({
          invoiceNumber,
          clientNumber: groupClientNumber,
          errorDetails: groupErrorDetails,
          errorTypeId: groupErrorTypeId,
          errorTypeName: groupErrorTypeName,
          status: groupErrorDetails ? "New" : "Needs Review",
          outcome: "Pending",
          rideCount: allClaimsForGroup.length,
          totalAmount: String(totalAmount),
          importBatch: `backfill_${Date.now()}`,
        }).returning({ id: invoiceGroupsTable.id });
        groupId = newGroup.id;
      }
      groupsCreated++;
    } else {
      if (!dryRun) {
        await tx.update(invoiceGroupsTable).set({
          rideCount: allClaimsForGroup.length,
          totalAmount: String(totalAmount),
          ...(groupErrorDetails ? { errorDetails: groupErrorDetails } : {}),
          ...(groupErrorTypeId ? { errorTypeId: groupErrorTypeId, errorTypeName: groupErrorTypeName } : {}),
        }).where(eq(invoiceGroupsTable.id, groupId));
      }
      groupsUpdated++;
    }

    if (!dryRun && groupId != null) {
      await tx
        .update(claimsTable)
        .set({ invoiceGroupId: groupId })
        .where(inArray(claimsTable.id, claimsForInvoice.map(c => c.id)));
    }
    claimsLinked += claimsForInvoice.length;
  }

    return {
      dryRun,
      orphanClaimsFound: orphanClaims.length,
      claimsLinked,
      groupsCreated,
      groupsUpdated,
      unparseableCount: unparseable.length,
      unparseable: unparseable.slice(0, 50),
    };
  });

  res.json(result);
}));

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function buildAuditLogConditions(query: Record<string, unknown>) {
  const conditions = [] as ReturnType<typeof eq>[];
  const userEmail = typeof query.userEmail === "string" ? query.userEmail.trim() : "";
  if (userEmail) conditions.push(eq(auditLogsTable.userEmail, userEmail));
  const from = parseDate(query.from);
  const to = parseDate(query.to);
  if (from) conditions.push(gte(auditLogsTable.timestamp, from));
  if (to) conditions.push(lte(auditLogsTable.timestamp, to));
  const category = typeof query.category === "string" ? query.category : "";
  if (category && category !== "all" && isActionCategory(category)) {
    const actions = actionKeysForCategory(category);
    if (actions.length === 0) {
      conditions.push(sql`1=0`);
    } else {
      conditions.push(inArray(auditLogsTable.action, actions));
    }
  }
  return conditions;
}

router.get("/admin/audit-logs", requireAdmin, asyncHandler(async (req, res): Promise<void> => {
  const conditions = buildAuditLogConditions(req.query as Record<string, unknown>);
  const limitRaw = parseInt(String(req.query.limit ?? "50"), 10);
  const offsetRaw = parseInt(String(req.query.offset ?? "0"), 10);
  const limit = Math.min(Math.max(isNaN(limitRaw) ? 50 : limitRaw, 1), 500);
  const offset = Math.max(isNaN(offsetRaw) ? 0 : offsetRaw, 0);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLogsTable)
    .where(where);

  const rows = await db
    .select({
      id: auditLogsTable.id,
      claimId: auditLogsTable.claimId,
      invoiceGroupId: auditLogsTable.invoiceGroupId,
      action: auditLogsTable.action,
      details: auditLogsTable.details,
      metadata: auditLogsTable.metadata,
      userEmail: auditLogsTable.userEmail,
      userName: auditLogsTable.userName,
      timestamp: auditLogsTable.timestamp,
      claimConfNumber: claimsTable.confNumber,
      invoiceGroupNumber: invoiceGroupsTable.invoiceNumber,
    })
    .from(auditLogsTable)
    .leftJoin(claimsTable, eq(auditLogsTable.claimId, claimsTable.id))
    .leftJoin(invoiceGroupsTable, eq(auditLogsTable.invoiceGroupId, invoiceGroupsTable.id))
    .where(where)
    .orderBy(desc(auditLogsTable.timestamp))
    .limit(limit)
    .offset(offset);

  res.json({
    total,
    limit,
    offset,
    items: rows.map((r) => {
      const kind: "claim" | "group" | "unknown" = r.invoiceGroupId != null ? "group" : r.claimId != null ? "claim" : "unknown";
      return {
        ...r,
        category: categoryForAction(r.action, kind),
        actionLabel: labelForAction(r.action, kind),
      };
    }),
  });
}));

function csvEscape(value: unknown): string {
  if (value == null) return "";
  let s: string;
  if (value instanceof Date) {
    s = value.toISOString();
  } else if (typeof value === "object") {
    s = JSON.stringify(value);
  } else {
    s = String(value);
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

router.get("/admin/audit-logs.csv", requireAdmin, asyncHandler(async (req, res): Promise<void> => {
  const conditions = buildAuditLogConditions(req.query as Record<string, unknown>);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const userEmail = typeof req.query.userEmail === "string" ? req.query.userEmail.trim() : "";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = userEmail
    ? `audit-${userEmail.replace(/[^a-zA-Z0-9._-]/g, "_")}-${stamp}.csv`
    : `audit-${stamp}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const headers = [
    "timestamp",
    "user_email",
    "user_name",
    "action_key",
    "action_label",
    "category",
    "claim_id",
    "claim_conf_number",
    "invoice_group_id",
    "invoice_group_number",
    "details",
    "metadata_json",
  ];
  res.write(headers.join(",") + "\n");

  const CHUNK = 1000;
  let offset = 0;
  // Page through results in chunks so we never hold the entire result set in memory.
  while (true) {
    const chunk = await db
      .select({
        id: auditLogsTable.id,
        claimId: auditLogsTable.claimId,
        invoiceGroupId: auditLogsTable.invoiceGroupId,
        action: auditLogsTable.action,
        details: auditLogsTable.details,
        metadata: auditLogsTable.metadata,
        userEmail: auditLogsTable.userEmail,
        userName: auditLogsTable.userName,
        timestamp: auditLogsTable.timestamp,
        claimConfNumber: claimsTable.confNumber,
        invoiceGroupNumber: invoiceGroupsTable.invoiceNumber,
      })
      .from(auditLogsTable)
      .leftJoin(claimsTable, eq(auditLogsTable.claimId, claimsTable.id))
      .leftJoin(invoiceGroupsTable, eq(auditLogsTable.invoiceGroupId, invoiceGroupsTable.id))
      .where(where)
      .orderBy(desc(auditLogsTable.timestamp), desc(auditLogsTable.id))
      .limit(CHUNK)
      .offset(offset);

    for (const r of chunk) {
      const kind: "claim" | "group" | "unknown" = r.invoiceGroupId != null ? "group" : r.claimId != null ? "claim" : "unknown";
      const row = [
        r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
        r.userEmail ?? "",
        r.userName ?? "",
        r.action,
        labelForAction(r.action, kind),
        categoryForAction(r.action, kind),
        r.claimId ?? "",
        r.claimConfNumber ?? "",
        r.invoiceGroupId ?? "",
        r.invoiceGroupNumber ?? "",
        r.details ?? "",
        r.metadata ? JSON.stringify(r.metadata) : "",
      ].map(csvEscape).join(",");
      res.write(row + "\n");
    }
    if (chunk.length < CHUNK) break;
    offset += CHUNK;
  }
  res.end();
}));

// Manual day-complete trigger (Task #313). Admin-only debug helper used
// to verify the celebration end-to-end without forcing a real terminal
// transition: when `force=true` the celebration is emitted regardless of
// the day's true conclusion state (still subject to the partial unique
// index — the second call for the same day is a no-op). Without `force`
// it only emits when the day is actually concluded.
//
// Body: { date: "YYYY-MM-DD", force?: boolean }
router.post("/admin/day-complete-celebration", requireAdmin, asyncHandler(async (req, res): Promise<void> => {
  const date = typeof req.body?.date === "string" ? req.body.date.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date must be YYYY-MM-DD" });
    return;
  }
  const force = req.body?.force === true;

  if (!force) {
    const concluded = await isDayConcluded(date);
    if (!concluded) {
      res.status(409).json({ error: "Day is not concluded; pass force=true to override.", date });
      return;
    }
  }

  const result = await tryEmitDayCompletedCelebration({
    day: date,
    triggeredByGroupId: null,
    actor: { userEmail: req.user?.email ?? null, userName: req.user?.displayName ?? null },
  });
  res.json({ date, emitted: result.emitted, alreadyCelebrated: !result.emitted });
}));

export default router;

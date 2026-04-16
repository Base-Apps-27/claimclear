import { Router, type IRouter } from "express";
import { eq, inArray, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, invoiceGroupsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAdmin } from "../middlewares/requireAdmin";
import { parseInvoiceNumber } from "../lib/parseInvoiceNumber";

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

export default router;

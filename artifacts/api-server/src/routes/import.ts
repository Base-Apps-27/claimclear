import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, invoiceGroupsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

function parseInvoiceNumber(refNumber: string | undefined): string | null {
  if (!refNumber) return null;
  const trimmed = refNumber.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 1 && /^\d+$/.test(parts[0])) {
    return parts[0];
  }
  return null;
}

router.post("/import", asyncHandler(async (req, res): Promise<void> => {
  const { rows, duplicateAction } = req.body;
  const dupAction = duplicateAction || "skip";

  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "rows array is required" });
    return;
  }

  const batchId = `import_${Date.now()}`;
  let created = 0;
  let skipped = 0;
  let updated = 0;
  let groupsCreated = 0;
  const duplicates: string[] = [];

  const seenConfNumbers = new Set<string>();
  const validRows = rows
    .filter(row => {
      if (!row.confNumber) return false;
      const confStr = String(row.confNumber).trim();
      if (confStr.length === 0 || isNaN(Number(confStr))) return false;
      if (seenConfNumbers.has(confStr)) return false;
      seenConfNumbers.add(confStr);
      return true;
    })
    .map(row => ({ ...row, confNumber: String(row.confNumber).trim() }));

  const skippedCount = rows.length - validRows.length;
  skipped += skippedCount;

  if (validRows.length === 0) {
    res.json({ success: true, created: 0, skipped: rows.length, updated: 0, duplicates: [], total: rows.length, batchId, groupsCreated: 0 });
    return;
  }

  const confNumbers = validRows.map(r => r.confNumber);
  const existingClaims = await db.select({ id: claimsTable.id, confNumber: claimsTable.confNumber })
    .from(claimsTable)
    .where(inArray(claimsTable.confNumber, confNumbers));

  const existingMap = new Map(existingClaims.map(c => [c.confNumber, c.id]));

  const invoiceMap = new Map<string, typeof validRows>();
  const noInvoiceRows: typeof validRows = [];

  for (const row of validRows) {
    const invoiceNum = parseInvoiceNumber(row.refNumber);
    if (invoiceNum) {
      if (!invoiceMap.has(invoiceNum)) {
        invoiceMap.set(invoiceNum, []);
      }
      invoiceMap.get(invoiceNum)!.push(row);
    } else {
      noInvoiceRows.push(row);
    }
  }

  const existingInvoiceNumbers = Array.from(invoiceMap.keys());
  let existingGroupMap = new Map<string, number>();
  if (existingInvoiceNumbers.length > 0) {
    const existingGroups = await db.select({ id: invoiceGroupsTable.id, invoiceNumber: invoiceGroupsTable.invoiceNumber })
      .from(invoiceGroupsTable)
      .where(inArray(invoiceGroupsTable.invoiceNumber, existingInvoiceNumbers));
    existingGroupMap = new Map(existingGroups.map(g => [g.invoiceNumber, g.id]));
  }

  for (const [invoiceNumber, groupRows] of invoiceMap.entries()) {
    let groupId = existingGroupMap.get(invoiceNumber);

    const errorDetailsSet = new Set<string>();
    let groupClientNumber: string | null = null;
    let totalAmount = 0;
    let groupErrorTypeId: string | null = null;
    let groupErrorTypeName: string | null = null;

    for (const row of groupRows) {
      if (row.errorDetails && row.errorDetails.trim()) {
        errorDetailsSet.add(row.errorDetails.trim());
      }
      if (row.clientNumber && !groupClientNumber) {
        groupClientNumber = row.clientNumber;
      }
      if (row.claimAmount != null) {
        const amt = typeof row.claimAmount === "number" ? row.claimAmount : parseFloat(row.claimAmount) || 0;
        totalAmount += amt;
      }
      if (row.errorTypeId && !groupErrorTypeId) {
        groupErrorTypeId = row.errorTypeId;
        groupErrorTypeName = row.errorTypeName || null;
      }
    }

    const groupErrorDetails = Array.from(errorDetailsSet).join("; ") || null;
    const hasErrorDetails = !!groupErrorDetails;

    if (!groupId) {
      const [newGroup] = await db.insert(invoiceGroupsTable).values({
        invoiceNumber,
        clientNumber: groupClientNumber,
        errorDetails: groupErrorDetails,
        errorTypeId: groupErrorTypeId,
        errorTypeName: groupErrorTypeName,
        status: hasErrorDetails ? "New" : "Needs Review",
        outcome: "Pending",
        rideCount: groupRows.length,
        totalAmount: String(totalAmount),
        importBatch: batchId,
      }).returning({ id: invoiceGroupsTable.id });
      groupId = newGroup.id;
      groupsCreated++;
    } else {
      await db.update(invoiceGroupsTable).set({
        rideCount: groupRows.length,
        totalAmount: String(totalAmount),
        ...(groupErrorDetails ? { errorDetails: groupErrorDetails } : {}),
        ...(groupErrorTypeId ? { errorTypeId: groupErrorTypeId, errorTypeName: groupErrorTypeName } : {}),
      }).where(eq(invoiceGroupsTable.id, groupId));
    }

    for (const row of groupRows) {
      const existingId = existingMap.get(row.confNumber);

      if (existingId != null) {
        if (dupAction === "update") {
          const updateData: Partial<typeof claimsTable.$inferInsert> = { invoiceGroupId: groupId };
          if (row.date) updateData.date = row.date;
          if (row.refNumber) updateData.refNumber = row.refNumber;
          if (row.clientNumber) updateData.clientNumber = row.clientNumber;
          if (row.carNumber) updateData.carNumber = String(row.carNumber);
          if (row.errorDetails) updateData.errorDetails = row.errorDetails;
          if (row.claimAmount != null) {
            updateData.claimAmount = String(typeof row.claimAmount === "number" ? row.claimAmount : parseFloat(row.claimAmount) || 0);
          }
          await db.update(claimsTable).set(updateData).where(eq(claimsTable.id, existingId));
          updated++;
        } else {
          duplicates.push(row.confNumber);
          skipped++;
        }
      } else {
        await db.insert(claimsTable).values({
          invoiceGroupId: groupId,
          confNumber: row.confNumber,
          date: row.date || null,
          refNumber: row.refNumber || "",
          clientNumber: row.clientNumber || groupClientNumber || "",
          carNumber: String(row.carNumber || ""),
          errorDetails: row.errorDetails || "",
          errorTypeId: row.errorTypeId || null,
          errorTypeName: row.errorTypeName || null,
          claimAmount: row.claimAmount != null ? String(typeof row.claimAmount === "number" ? row.claimAmount : parseFloat(row.claimAmount) || 0) : null,
          status: "New",
          outcome: "Pending",
          importBatch: batchId,
          invoiceNumbers: invoiceNumber,
        });
        created++;
      }
    }
  }

  for (const row of noInvoiceRows) {
    const existingId = existingMap.get(row.confNumber);

    if (existingId != null) {
      if (dupAction === "update") {
        const updateData: Partial<typeof claimsTable.$inferInsert> = {};
        if (row.date) updateData.date = row.date;
        if (row.refNumber) updateData.refNumber = row.refNumber;
        if (row.clientNumber) updateData.clientNumber = row.clientNumber;
        if (row.carNumber) updateData.carNumber = String(row.carNumber);
        if (row.errorDetails) updateData.errorDetails = row.errorDetails;
        if (row.claimAmount != null) {
          updateData.claimAmount = String(typeof row.claimAmount === "number" ? row.claimAmount : parseFloat(row.claimAmount) || 0);
        }
        if (Object.keys(updateData).length > 0) {
          await db.update(claimsTable).set(updateData).where(eq(claimsTable.id, existingId));
          updated++;
        } else {
          skipped++;
        }
      } else {
        duplicates.push(row.confNumber);
        skipped++;
      }
    } else {
      await db.insert(claimsTable).values({
        confNumber: row.confNumber,
        date: row.date || null,
        refNumber: row.refNumber || "",
        clientNumber: row.clientNumber || "",
        carNumber: String(row.carNumber || ""),
        errorDetails: row.errorDetails || "",
        errorTypeId: row.errorTypeId || null,
        errorTypeName: row.errorTypeName || null,
        claimAmount: row.claimAmount != null ? String(typeof row.claimAmount === "number" ? row.claimAmount : parseFloat(row.claimAmount) || 0) : null,
        status: (!row.errorDetails || !row.errorDetails.trim()) ? "Needs Review" : "New",
        outcome: "Pending",
        importBatch: batchId,
      });
      created++;
    }
  }

  res.json({
    success: true,
    created,
    skipped,
    updated,
    duplicates,
    total: rows.length,
    batchId,
    groupsCreated,
    invoiceGroupCount: invoiceMap.size,
  });
}));

export default router;

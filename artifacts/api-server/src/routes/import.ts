import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

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
    res.json({ success: true, created: 0, skipped: rows.length, updated: 0, duplicates: [], total: rows.length, batchId });
    return;
  }

  const confNumbers = validRows.map(r => r.confNumber);
  const existingClaims = await db.select({ id: claimsTable.id, confNumber: claimsTable.confNumber })
    .from(claimsTable)
    .where(inArray(claimsTable.confNumber, confNumbers));

  const existingMap = new Map(existingClaims.map(c => [c.confNumber, c.id]));

  const toInsert: (typeof claimsTable.$inferInsert)[] = [];

  for (const row of validRows) {
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
      toInsert.push({
        confNumber: row.confNumber,
        date: row.date || null,
        refNumber: row.refNumber || "",
        clientNumber: row.clientNumber || "",
        carNumber: String(row.carNumber || ""),
        errorDetails: row.errorDetails || "",
        errorTypeId: row.errorTypeId || null,
        errorTypeName: row.errorTypeName || null,
        claimAmount: row.claimAmount != null ? String(typeof row.claimAmount === "number" ? row.claimAmount : parseFloat(row.claimAmount) || 0) : null,
        status: "New",
        outcome: "Pending",
        importBatch: batchId,
      });
    }
  }

  if (toInsert.length > 0) {
    const BATCH_SIZE = 100;
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const batch = toInsert.slice(i, i + BATCH_SIZE);
      await db.insert(claimsTable).values(batch);
    }
    created = toInsert.length;
  }

  res.json({
    success: true,
    created,
    skipped,
    updated,
    duplicates,
    total: rows.length,
    batchId,
  });
}));

export default router;

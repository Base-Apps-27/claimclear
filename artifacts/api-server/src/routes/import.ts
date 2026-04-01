import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable } from "@workspace/db";

const router: IRouter = Router();

router.post("/import", async (req, res): Promise<void> => {
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

  for (const row of rows) {
    if (!row.confNumber) { skipped++; continue; }
    const confStr = String(row.confNumber).trim();
    if (!confStr || isNaN(Number(confStr))) { skipped++; continue; }

    const existing = await db.select().from(claimsTable).where(eq(claimsTable.confNumber, confStr));

    if (existing.length > 0) {
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
          await db.update(claimsTable).set(updateData).where(eq(claimsTable.id, existing[0].id));
          updated++;
        } else {
          skipped++;
        }
      } else {
        duplicates.push(confStr);
        skipped++;
      }
      continue;
    }

    await db.insert(claimsTable).values({
      confNumber: confStr,
      date: row.date || null,
      refNumber: row.refNumber || "",
      clientNumber: row.clientNumber || "",
      carNumber: String(row.carNumber || ""),
      errorDetails: row.errorDetails || "",
      claimAmount: row.claimAmount != null ? String(typeof row.claimAmount === "number" ? row.claimAmount : parseFloat(row.claimAmount) || 0) : null,
      status: "New",
      outcome: "Pending",
      importBatch: batchId,
    });
    created++;
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
});

export default router;

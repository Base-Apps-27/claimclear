import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { errorDetailMappingsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

router.post("/error-detail-mappings/lookup", asyncHandler(async (req, res): Promise<void> => {
  const { errorDetails } = req.body;
  if (!Array.isArray(errorDetails) || errorDetails.length === 0) {
    res.json({ mappings: [] });
    return;
  }

  const normalized = errorDetails.map((t: string) => normalizeText(t));
  const uniqueNormalized = [...new Set(normalized)].filter(t => t.length > 0);

  if (uniqueNormalized.length === 0) {
    res.json({ mappings: [] });
    return;
  }

  const existing = await db.select()
    .from(errorDetailMappingsTable)
    .where(inArray(errorDetailMappingsTable.normalizedText, uniqueNormalized));

  const mappingMap = new Map(existing.map(m => [m.normalizedText, m]));

  const results = errorDetails.map((text: string) => {
    const norm = normalizeText(text);
    const match = mappingMap.get(norm);
    return {
      originalText: text,
      normalizedText: norm,
      matched: !!match,
      errorTypeId: match?.errorTypeId ?? null,
      errorTypeName: match?.errorTypeName ?? null,
    };
  });

  res.json({ mappings: results });
}));

router.post("/error-detail-mappings", asyncHandler(async (req, res): Promise<void> => {
  const { mappings } = req.body;
  if (!Array.isArray(mappings) || mappings.length === 0) {
    res.status(400).json({ error: "mappings array is required" });
    return;
  }

  const saved = [];
  for (const m of mappings) {
    if (!m.originalText || !m.errorTypeId || !m.errorTypeName) continue;

    const norm = normalizeText(m.originalText);
    if (!norm) continue;

    const existing = await db.select()
      .from(errorDetailMappingsTable)
      .where(eq(errorDetailMappingsTable.normalizedText, norm));

    if (existing.length > 0) {
      const [updated] = await db.update(errorDetailMappingsTable)
        .set({
          errorTypeId: m.errorTypeId,
          errorTypeName: m.errorTypeName,
          originalText: m.originalText,
        })
        .where(eq(errorDetailMappingsTable.normalizedText, norm))
        .returning();
      saved.push(updated);
    } else {
      const [created] = await db.insert(errorDetailMappingsTable)
        .values({
          normalizedText: norm,
          originalText: m.originalText,
          errorTypeId: m.errorTypeId,
          errorTypeName: m.errorTypeName,
        })
        .returning();
      saved.push(created);
    }
  }

  res.json({ saved });
}));

export default router;

import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { errorDetailMappingsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// Multi-detail handling (Task: classify multi-piece error descriptions,
// 2026-05-04): some imports arrive with semicolon-separated descriptions
// like "GPS pickup too far from residence; Travel time is too short for
// distance traveled". The `claims` table holds a single error_type_id
// per claim, so we still pick one — but instead of sending the whole
// string straight to the lookup (which would never match), we split on
// `;`, look each piece up, and only auto-classify when every piece
// resolves to the SAME error_type_id. Mixed/partial results fall back to
// the manual-pick path the operator already has.
function splitDetailIntoPieces(text: string): string[] {
  return text
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Priority-piece rule (Task: classify multi-piece error descriptions,
// 2026-05-04 follow-up): the per-piece consensus rule alone leaves the
// 90%+ of multi-detail combos that mix "travel time too short" with a
// GPS-pickup piece stuck in manual review, because the two pieces map
// to different error types. Operationally those claims all walk down
// the same remediation path as a pure travel-time claim, so when a
// multi-detail string contains a high-priority piece we let that piece
// win outright — even if the other pieces resolve to a different type.
//
// Order matters: the first entry wins if multiple priority pieces are
// present. Adding a new phrase here is intentionally a code change so
// that the priority semantics get reviewed in code review rather than
// being editable through the operator-facing mapping UI.
const PRIORITY_PIECE_NORMALIZED_TEXTS = [
  "travel time is too short for distance traveled",
];

router.post("/error-detail-mappings/lookup", asyncHandler(async (req, res): Promise<void> => {
  const { errorDetails } = req.body;
  if (!Array.isArray(errorDetails) || errorDetails.length === 0) {
    res.json({ mappings: [] });
    return;
  }

  // Build the union of (a) the whole-string normalization (covers the
  // single-piece case and any operator-saved mapping for the literal
  // multi-detail string) and (b) every piece of every multi-detail
  // string. One inArray() lookup against the union, then we resolve
  // each input row in JS.
  const wholeNormalized = errorDetails.map((t: string) => normalizeText(t));
  const pieceNormalizedByInput: string[][] = errorDetails.map((t: string) =>
    splitDetailIntoPieces(t).map((p) => normalizeText(p)),
  );
  const allKeys = new Set<string>();
  for (const k of wholeNormalized) if (k.length > 0) allKeys.add(k);
  for (const arr of pieceNormalizedByInput) for (const k of arr) if (k.length > 0) allKeys.add(k);

  if (allKeys.size === 0) {
    res.json({ mappings: [] });
    return;
  }

  const existing = await db.select()
    .from(errorDetailMappingsTable)
    .where(inArray(errorDetailMappingsTable.normalizedText, [...allKeys]));

  const mappingMap = new Map(existing.map(m => [m.normalizedText, m]));

  const results = errorDetails.map((text: string, i: number) => {
    const norm = wholeNormalized[i];
    // 1) Whole-string mapping always wins — operators can pin a literal
    //    multi-detail string to a specific type and that should override
    //    the per-piece consensus.
    const wholeMatch = mappingMap.get(norm);
    if (wholeMatch) {
      return {
        originalText: text,
        normalizedText: norm,
        matched: true,
        errorTypeId: wholeMatch.errorTypeId,
        errorTypeName: wholeMatch.errorTypeName,
        pieces: null,
      };
    }

    // 2) Priority-piece override (multi-detail only). If any piece is
    //    in the PRIORITY_PIECE_NORMALIZED_TEXTS list AND has a mapping,
    //    that mapping wins regardless of what the other pieces resolve
    //    to. Single-piece inputs skip this — they would just collapse
    //    to the consensus rule below with the same outcome.
    const pieceKeysForPriority = pieceNormalizedByInput[i];
    if (pieceKeysForPriority.length > 1) {
      for (const priorityKey of PRIORITY_PIECE_NORMALIZED_TEXTS) {
        if (!pieceKeysForPriority.includes(priorityKey)) continue;
        const priorityMatch = mappingMap.get(priorityKey);
        if (!priorityMatch) continue;
        return {
          originalText: text,
          normalizedText: norm,
          matched: true,
          errorTypeId: priorityMatch.errorTypeId,
          errorTypeName: priorityMatch.errorTypeName,
          pieces: pieceKeysForPriority.map((k) => {
            const mm = mappingMap.get(k) ?? null;
            return {
              normalizedText: k,
              matched: !!mm,
              errorTypeId: mm?.errorTypeId ?? null,
              errorTypeName: mm?.errorTypeName ?? null,
            };
          }),
        };
      }
    }

    // 3) Per-piece consensus for multi-detail strings. Single-piece
    //    inputs fall through here too but with a length-1 piece array,
    //    so the behaviour collapses back to "either matches or it
    //    doesn't" — identical to the pre-Task lookup for callers that
    //    never sent multi-detail strings.
    const pieceKeys = pieceNormalizedByInput[i];
    const piecesResolved = pieceKeys.map((k) => ({
      normalizedText: k,
      match: mappingMap.get(k) ?? null,
    }));
    const allMatched = piecesResolved.length > 0 && piecesResolved.every((p) => p.match !== null);
    const distinctTypes = new Set(piecesResolved.map((p) => p.match?.errorTypeId).filter((id): id is number => id != null));
    const consensus = allMatched && distinctTypes.size === 1
      ? piecesResolved[0].match
      : null;

    if (consensus) {
      return {
        originalText: text,
        normalizedText: norm,
        matched: true,
        errorTypeId: consensus.errorTypeId,
        errorTypeName: consensus.errorTypeName,
        // Surface the per-piece breakdown so the import UI can show
        // the operator how the auto-pick was derived.
        pieces: piecesResolved.map((p) => ({
          normalizedText: p.normalizedText,
          matched: !!p.match,
          errorTypeId: p.match?.errorTypeId ?? null,
          errorTypeName: p.match?.errorTypeName ?? null,
        })),
      };
    }

    // 3) Either the whole-string nor a clean per-piece consensus
    //    matched. Return matched=false but include the per-piece
    //    breakdown for multi-detail inputs so the UI can highlight
    //    which piece is missing a mapping (the most common reason a
    //    multi-detail string fails to auto-classify).
    return {
      originalText: text,
      normalizedText: norm,
      matched: false,
      errorTypeId: null,
      errorTypeName: null,
      pieces: pieceKeys.length > 1
        ? piecesResolved.map((p) => ({
            normalizedText: p.normalizedText,
            matched: !!p.match,
            errorTypeId: p.match?.errorTypeId ?? null,
            errorTypeName: p.match?.errorTypeName ?? null,
          }))
        : null,
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

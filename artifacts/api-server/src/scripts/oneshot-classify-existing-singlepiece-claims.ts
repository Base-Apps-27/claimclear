// One-shot backfill (2026-05-05).
//
// Companion to `oneshot-classify-existing-multidetail-claims.ts`. That
// script only walks claims with a semicolon in `error_details` (the
// multi-piece path). Single-piece legs that were imported BEFORE their
// matching mapping row existed never got auto-classified at import
// time, and the multi-detail backfill skips them by design — leaving
// them stranded in the Classification Inbox.
//
// Concrete case driving this run: 7 legs with the single-piece phrase
// "Travel time is too short for distance traveled". The mapping row
// (#14 → error_type_id 13) was added by oneshot-seed-travel-time-mapping
// AFTER these legs were imported, so the importer never saw it.
//
// Logic: for every disputed, unclassified leg whose error_details has
// no semicolon and matches a mapping by normalized whole-text, stamp
// the resolved type and record an audit row tagged with the backfill id.
//
// Idempotent: row update is guarded by `error_type_id IS NULL OR ''`.
//
// Run:
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-classify-existing-singlepiece-claims.ts [--apply]

import { and, eq, inArray, isNotNull, isNull, not, like, or, sql } from "drizzle-orm";
import {
  db,
  claimsTable,
  errorDetailMappingsTable,
  auditLogsTable,
} from "@workspace/db";

const BACKFILL_ID = "singlepiece_claims_classify_2026_05_05";

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

async function main() {
  const apply = process.argv.includes("--apply");

  const candidates = await db
    .select({
      id: claimsTable.id,
      confNumber: claimsTable.confNumber,
      errorDetails: claimsTable.errorDetails,
    })
    .from(claimsTable)
    .where(
      and(
        eq(claimsTable.includedInDispute, true),
        or(isNull(claimsTable.errorTypeId), eq(claimsTable.errorTypeId, "")),
        isNotNull(claimsTable.errorDetails),
        not(like(claimsTable.errorDetails, sql`'%;%'`)),
        sql`btrim(${claimsTable.errorDetails}) <> ''`,
      ),
    );

  console.log(`Found ${candidates.length} single-piece claims with no error_type_id.`);
  if (candidates.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const keys = new Set<string>();
  for (const c of candidates) {
    if (c.errorDetails) keys.add(normalizeText(c.errorDetails));
  }
  const mappingRows = keys.size > 0
    ? await db.select().from(errorDetailMappingsTable)
        .where(inArray(errorDetailMappingsTable.normalizedText, [...keys]))
    : [];
  const mappingMap = new Map(
    mappingRows.map((m) => [m.normalizedText, { errorTypeId: m.errorTypeId, errorTypeName: m.errorTypeName }]),
  );

  type Plan = {
    claimId: number;
    confNumber: string | null;
    errorDetails: string;
    errorTypeId: number;
    errorTypeName: string;
  };
  const willStamp: Plan[] = [];
  const unmapped: Record<string, number> = {};
  for (const c of candidates) {
    const key = normalizeText(c.errorDetails ?? "");
    const m = mappingMap.get(key);
    if (m) {
      willStamp.push({
        claimId: c.id,
        confNumber: c.confNumber,
        errorDetails: c.errorDetails ?? "",
        errorTypeId: m.errorTypeId,
        errorTypeName: m.errorTypeName,
      });
    } else {
      unmapped[key] = (unmapped[key] ?? 0) + 1;
    }
  }

  const byType: Record<string, number> = {};
  for (const p of willStamp) {
    const k = `${p.errorTypeId} ${p.errorTypeName}`;
    byType[k] = (byType[k] ?? 0) + 1;
  }

  console.log(`\n=== Plan ===`);
  console.log(`Will stamp:  ${willStamp.length}`);
  console.log(`Will skip:   ${candidates.length - willStamp.length} (no matching mapping)`);
  console.log(`\nBy resolved error type:`);
  for (const [k, v] of Object.entries(byType)) console.log(`  ${v.toString().padStart(4)} → ${k}`);
  if (Object.keys(unmapped).length > 0) {
    console.log(`\nUnmapped phrases (left in inbox):`);
    for (const [k, v] of Object.entries(unmapped)) console.log(`  ${v.toString().padStart(4)}  "${k}"`);
  }

  if (!apply) {
    console.log(`\n(dry-run — pass --apply to commit)`);
    return;
  }

  console.log(`\nApplying...`);
  let stamped = 0;
  for (const p of willStamp) {
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(claimsTable)
        .set({ errorTypeId: String(p.errorTypeId), errorTypeName: p.errorTypeName })
        .where(
          and(
            eq(claimsTable.id, p.claimId),
            or(isNull(claimsTable.errorTypeId), eq(claimsTable.errorTypeId, "")),
          ),
        )
        .returning({ id: claimsTable.id });
      if (!updated) return;

      await tx.insert(auditLogsTable).values({
        claimId: p.claimId,
        action: "error_type_assigned",
        details: `Error type assigned: ${p.errorTypeName} (backfill — single-piece whole-match)`,
        metadata: {
          errorTypeId: p.errorTypeId,
          errorTypeName: p.errorTypeName,
          source: "backfill",
          backfillId: BACKFILL_ID,
          matchReason: "whole",
          errorDetails: p.errorDetails,
        },
        userEmail: null,
        userName: null,
      });
      stamped += 1;
    });
  }

  console.log(`Stamped ${stamped} of ${willStamp.length} planned claims.`);
  console.log(`Done.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

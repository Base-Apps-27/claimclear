// One-shot backfill (Task: classify multi-piece error descriptions,
// 2026-05-04 follow-up).
//
// The lookup endpoint and importer now know how to resolve
// semicolon-separated `error_details` strings via the priority-piece
// rule (travel-time wins) plus per-piece consensus. That fix only
// helps FUTURE imports — the 165 multi-detail claims already sitting
// in prod don't get re-classified until someone re-imports them.
//
// This script reads every claim with `error_details LIKE '%;%'` and
// no `error_type_id`, runs the same lookup logic in-process, and
// stamps the resolved `error_type_id` / `error_type_name` directly on
// the claim. Each write inserts an `error_type_assigned` audit row
// (the same `action` the operator-facing bulk-assign endpoint uses)
// stamped with `metadata.backfillId` so the run is sliceable later.
//
// Prerequisites (must run before this script for it to do anything
// useful for the travel-time combos):
//   1. `oneshot-seed-travel-time-mapping.ts --apply` — creates the
//      "Travel Time Too Short for Distance Traveled" error type and
//      the corresponding mapping row that the priority rule depends on.
//
// Idempotent: the row update is guarded by `error_type_id IS NULL OR ''`,
// so re-running this script after the first pass is a no-op for the
// rows it already stamped.
//
// Run (against whichever DATABASE_URL is exported in the shell):
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-classify-existing-multidetail-claims.ts [--apply]

import { and, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import {
  db,
  claimsTable,
  errorDetailMappingsTable,
  auditLogsTable,
} from "@workspace/db";

const BACKFILL_ID = "multidetail_claims_classify_2026_05_04";

// Mirrors `routes/error-detail-mappings.ts` — kept in sync deliberately.
// If the priority list grows there, update this list too.
const PRIORITY_PIECE_NORMALIZED_TEXTS = [
  "travel time is too short for distance traveled",
];

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function splitDetailIntoPieces(text: string): string[] {
  return text
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type Mapping = { errorTypeId: number; errorTypeName: string };

function resolve(
  text: string,
  mappingMap: Map<string, Mapping>,
): { matched: true; errorTypeId: number; errorTypeName: string; reason: "whole" | "priority" | "consensus" }
  | { matched: false; reason: "no_pieces" | "missing_pieces" | "type_conflict" } {
  const norm = normalizeText(text);
  if (!norm) return { matched: false, reason: "no_pieces" };

  const whole = mappingMap.get(norm);
  if (whole) return { matched: true, errorTypeId: whole.errorTypeId, errorTypeName: whole.errorTypeName, reason: "whole" };

  const pieces = splitDetailIntoPieces(text).map((p) => normalizeText(p));
  if (pieces.length === 0) return { matched: false, reason: "no_pieces" };

  if (pieces.length > 1) {
    for (const priorityKey of PRIORITY_PIECE_NORMALIZED_TEXTS) {
      if (!pieces.includes(priorityKey)) continue;
      const m = mappingMap.get(priorityKey);
      if (!m) continue;
      return { matched: true, errorTypeId: m.errorTypeId, errorTypeName: m.errorTypeName, reason: "priority" };
    }
  }

  const resolved = pieces.map((k) => mappingMap.get(k) ?? null);
  if (resolved.some((m) => m === null)) return { matched: false, reason: "missing_pieces" };
  const distinctTypes = new Set(resolved.map((m) => m!.errorTypeId));
  if (distinctTypes.size === 1) {
    return { matched: true, errorTypeId: resolved[0]!.errorTypeId, errorTypeName: resolved[0]!.errorTypeName, reason: "consensus" };
  }
  return { matched: false, reason: "type_conflict" };
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
        like(claimsTable.errorDetails, sql`'%;%'`),
        or(isNull(claimsTable.errorTypeId), eq(claimsTable.errorTypeId, "")),
      ),
    );

  console.log(`Found ${candidates.length} multi-detail claims with no error_type_id.`);
  if (candidates.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // One mapping lookup covers every piece across every candidate.
  const allKeys = new Set<string>();
  for (const c of candidates) {
    if (!c.errorDetails) continue;
    allKeys.add(normalizeText(c.errorDetails));
    for (const p of splitDetailIntoPieces(c.errorDetails)) {
      allKeys.add(normalizeText(p));
    }
  }
  const mappingRows = allKeys.size > 0
    ? await db.select().from(errorDetailMappingsTable)
        .where(inArray(errorDetailMappingsTable.normalizedText, [...allKeys]))
    : [];
  const mappingMap = new Map<string, Mapping>(
    mappingRows.map((m) => [m.normalizedText, { errorTypeId: m.errorTypeId, errorTypeName: m.errorTypeName }]),
  );

  type Plan = {
    claimId: number;
    confNumber: string | null;
    errorDetails: string;
    errorTypeId: number;
    errorTypeName: string;
    reason: "whole" | "priority" | "consensus";
  };
  const willStamp: Plan[] = [];
  const skipReasons: Record<string, number> = {};
  for (const c of candidates) {
    const r = resolve(c.errorDetails ?? "", mappingMap);
    if (r.matched) {
      willStamp.push({
        claimId: c.id,
        confNumber: c.confNumber,
        errorDetails: c.errorDetails ?? "",
        errorTypeId: r.errorTypeId,
        errorTypeName: r.errorTypeName,
        reason: r.reason,
      });
    } else {
      skipReasons[r.reason] = (skipReasons[r.reason] ?? 0) + 1;
    }
  }

  const byReason: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const p of willStamp) {
    byReason[p.reason] = (byReason[p.reason] ?? 0) + 1;
    const k = `${p.errorTypeId} ${p.errorTypeName}`;
    byType[k] = (byType[k] ?? 0) + 1;
  }

  console.log(`\n=== Plan ===`);
  console.log(`Will stamp:  ${willStamp.length}`);
  console.log(`Will skip:   ${candidates.length - willStamp.length}`);
  console.log(`\nBy match reason:`);
  for (const [k, v] of Object.entries(byReason)) console.log(`  ${k.padEnd(10)} ${v}`);
  console.log(`\nBy resolved error type:`);
  for (const [k, v] of Object.entries(byType)) console.log(`  ${v.toString().padStart(4)} → ${k}`);
  if (Object.keys(skipReasons).length > 0) {
    console.log(`\nSkip reasons:`);
    for (const [k, v] of Object.entries(skipReasons)) console.log(`  ${k.padEnd(20)} ${v}`);
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
            // re-check inside the txn so a parallel manual classify
            // doesn't get stomped.
            or(isNull(claimsTable.errorTypeId), eq(claimsTable.errorTypeId, "")),
          ),
        )
        .returning({ id: claimsTable.id });
      if (!updated) return; // already classified by something else; skip.

      await tx.insert(auditLogsTable).values({
        claimId: p.claimId,
        action: "error_type_assigned",
        details: `Error type assigned: ${p.errorTypeName} (backfill — ${p.reason})`,
        metadata: {
          errorTypeId: p.errorTypeId,
          errorTypeName: p.errorTypeName,
          source: "backfill",
          backfillId: BACKFILL_ID,
          matchReason: p.reason,
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

// One-shot mapping policy change (2026-05-05).
//
// Collapse the four "GPS too far from X/Y" phrases into the existing
// umbrella error type 6 ("GPS Deviation Status"). Today each phrase
// points at its own granular type (3/4/5), which means a multi-piece
// errorDetails string like
//
//   "GPS pickup too far from medical facility; GPS destination too far from residence"
//
// resolves to two different types, fails the consensus rule in the
// multi-detail lookup, and lands in the Classification Inbox for
// manual triage. Operationally these are all the same workflow, so we
// fold them into a single bucket.
//
// Side-effect: this also fixes the longstanding bad mapping #11
// (`gps destination too far from residence`) which was incorrectly
// pointing at type 5 ("…from Medical Facility").
//
// Historical claims already classified under types 3/4/5 are NOT
// rewritten — only the mapping targets change, so future classifications
// (and the multi-detail backfill rerun that follows this script) land
// on type 6.
//
// Idempotent: each row update is a no-op if the mapping is already
// pointing at type 6.
//
// Run:
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-collapse-gps-deviation-mappings.ts [--apply]

import { eq, inArray } from "drizzle-orm";
import { db, errorDetailMappingsTable, errorTypesTable } from "@workspace/db";

const TARGET_ERROR_TYPE_ID = 6;
const TARGET_ERROR_TYPE_NAME = "GPS Deviation Status";

const MAPPING_IDS_TO_REPOINT = [5, 6, 9, 11];

async function main() {
  const apply = process.argv.includes("--apply");

  const [target] = await db.select().from(errorTypesTable).where(eq(errorTypesTable.id, TARGET_ERROR_TYPE_ID));
  if (!target) {
    console.error(`Target error type ${TARGET_ERROR_TYPE_ID} not found.`);
    process.exit(1);
  }
  if (target.name !== TARGET_ERROR_TYPE_NAME) {
    console.error(
      `Safety check failed: error_type ${TARGET_ERROR_TYPE_ID} is "${target.name}" (expected "${TARGET_ERROR_TYPE_NAME}"). Aborting.`,
    );
    process.exit(1);
  }

  const rows = await db
    .select()
    .from(errorDetailMappingsTable)
    .where(inArray(errorDetailMappingsTable.id, MAPPING_IDS_TO_REPOINT));

  if (rows.length !== MAPPING_IDS_TO_REPOINT.length) {
    console.error(
      `Safety check failed: expected ${MAPPING_IDS_TO_REPOINT.length} mappings (${MAPPING_IDS_TO_REPOINT.join(", ")}), found ${rows.length}. Aborting.`,
    );
    process.exit(1);
  }

  console.log(`=== Plan: repoint mappings → error_type_id ${TARGET_ERROR_TYPE_ID} (${TARGET_ERROR_TYPE_NAME}) ===`);
  for (const r of rows) {
    const change =
      r.errorTypeId === TARGET_ERROR_TYPE_ID
        ? "(already on target — no-op)"
        : `${r.errorTypeId} (${r.errorTypeName}) → ${TARGET_ERROR_TYPE_ID} (${TARGET_ERROR_TYPE_NAME})`;
    console.log(`  #${r.id} "${r.normalizedText}": ${change}`);
  }

  if (!apply) {
    console.log(`\n(dry-run — pass --apply to commit)`);
    return;
  }

  console.log(`\nApplying...`);
  let updated = 0;
  for (const r of rows) {
    if (r.errorTypeId === TARGET_ERROR_TYPE_ID) continue;
    await db
      .update(errorDetailMappingsTable)
      .set({ errorTypeId: TARGET_ERROR_TYPE_ID, errorTypeName: TARGET_ERROR_TYPE_NAME })
      .where(eq(errorDetailMappingsTable.id, r.id));
    updated++;
  }
  console.log(`Done. Updated ${updated} mapping row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

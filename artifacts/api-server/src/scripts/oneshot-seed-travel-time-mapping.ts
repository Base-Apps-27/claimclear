// One-shot seed (Task: classify multi-piece error descriptions,
// 2026-05-04 follow-up).
//
// Adds the dictionary entries needed to auto-classify the multi-detail
// claims that today fall through to manual triage:
//
//   1. Creates error_types row "Travel Time Too Short for Distance
//      Traveled" if it doesn't already exist. Idempotent on `name`.
//   2. Inserts an error_detail_mappings row from the normalized phrase
//      "travel time is too short for distance traveled" to that type.
//      Idempotent on `normalized_text` (which is the unique constraint).
//
// Together with the priority-piece rule in
// `routes/error-detail-mappings.ts`, this unlocks ~151 of the 165
// multi-detail claims sitting in the Classification Inbox today, and
// every future import of a multi-detail string containing the
// travel-time piece.
//
// Run (against whichever DATABASE_URL is exported in the shell):
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-seed-travel-time-mapping.ts [--apply]

import { eq } from "drizzle-orm";
import { db, errorTypesTable, errorDetailMappingsTable } from "@workspace/db";

const NEW_TYPE_NAME = "Travel Time Too Short for Distance Traveled";
const NEW_TYPE_CATEGORY = "GPS";
const NEW_TYPE_DESCRIPTION =
  "The reported travel time between pickup and destination is shorter than the recorded distance can plausibly support. Operationally remediated the same way as a GPS-pickup deviation: collect GPS screenshots of the pickup, destination, and route. Used as the priority piece when a multi-detail string mixes a travel-time issue with a GPS-pickup or GPS-destination piece.";

const MAPPING_NORMALIZED = "travel time is too short for distance traveled";
const MAPPING_ORIGINAL = "Travel time is too short for distance traveled";

async function main() {
  const apply = process.argv.includes("--apply");

  const existingType = await db
    .select()
    .from(errorTypesTable)
    .where(eq(errorTypesTable.name, NEW_TYPE_NAME));

  let typeId: number;
  let typeAction: "exists" | "create";
  if (existingType.length > 0) {
    typeId = existingType[0].id;
    typeAction = "exists";
  } else {
    typeAction = "create";
    if (apply) {
      const [created] = await db
        .insert(errorTypesTable)
        .values({
          name: NEW_TYPE_NAME,
          category: NEW_TYPE_CATEGORY,
          description: NEW_TYPE_DESCRIPTION,
        })
        .returning();
      typeId = created.id;
    } else {
      typeId = -1;
    }
  }

  const existingMapping = await db
    .select()
    .from(errorDetailMappingsTable)
    .where(eq(errorDetailMappingsTable.normalizedText, MAPPING_NORMALIZED));

  let mappingAction: "exists-correct" | "exists-needs-update" | "create";
  if (existingMapping.length === 0) {
    mappingAction = "create";
  } else if (existingMapping[0].errorTypeId === typeId && typeAction === "exists") {
    mappingAction = "exists-correct";
  } else {
    mappingAction = "exists-needs-update";
  }

  console.log("=== Plan ===");
  console.log(`Error type "${NEW_TYPE_NAME}": ${typeAction}` + (typeAction === "exists" ? ` (id=${typeId})` : ""));
  console.log(`Mapping "${MAPPING_NORMALIZED}": ${mappingAction}`);
  if (!apply) {
    console.log("\n(dry-run — pass --apply to commit)");
    return;
  }

  if (mappingAction === "create") {
    const [created] = await db
      .insert(errorDetailMappingsTable)
      .values({
        normalizedText: MAPPING_NORMALIZED,
        originalText: MAPPING_ORIGINAL,
        errorTypeId: typeId,
        errorTypeName: NEW_TYPE_NAME,
      })
      .returning();
    console.log(`  inserted mapping id=${created.id} → error_type_id=${typeId}`);
  } else if (mappingAction === "exists-needs-update") {
    const [updated] = await db
      .update(errorDetailMappingsTable)
      .set({ errorTypeId: typeId, errorTypeName: NEW_TYPE_NAME })
      .where(eq(errorDetailMappingsTable.normalizedText, MAPPING_NORMALIZED))
      .returning();
    console.log(`  updated mapping id=${updated.id} → error_type_id=${typeId}`);
  } else {
    console.log("  mapping already correct, no-op");
  }

  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

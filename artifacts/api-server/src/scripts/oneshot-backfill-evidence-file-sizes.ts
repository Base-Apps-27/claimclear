// One-shot backfill (Task #445, 2026-05-05).
//
// The Evidence card on the leg detail now shows a per-file size and
// flags anything over the 25 MB email cap, but legacy attachments
// stored without a `size` on `evidence_files` JSONB show up as
// "size unknown" — the size signal is read from
// `parentGroup.evidenceFiles[]` and `claim.evidenceFiles[]` (see
// `buildSizeMap` in `claim-detail-v2.tsx`).
//
// This script walks every `invoice_groups.evidence_files` and
// `claims.evidence_files` JSONB array, statting each `/objects/...`
// blob via `ObjectStorageService.getObjectEntityFile` + `getMetadata`,
// and writes the resulting byte count back into the JSONB row. Entries
// already carrying a numeric `size` are skipped. Entries whose blob is
// missing from object storage are left as-is and reported at the end
// (the Evidence card will keep rendering "size unknown" for those —
// confirmed gone, no further action this script can take).
//
// Idempotent: re-running after a successful pass is a no-op because
// every entry now carries a numeric `size`.
//
// Run (against whichever DATABASE_URL is exported in the shell):
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-backfill-evidence-file-sizes.ts [--apply]

import { eq, isNotNull } from "drizzle-orm";
import { db, invoiceGroupsTable, claimsTable } from "@workspace/db";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "../lib/objectStorage";

type EvidenceFileRef = {
  url: string;
  name?: string | null;
  size?: number | null;
};

const objectStorage = new ObjectStorageService();

// In-process cache so the same blob URL referenced by multiple rows
// (legs + their parent group routinely duplicate the same file) is
// only stat'd once per run.
const sizeCache = new Map<string, number | null>();

async function statBlobSize(rawUrl: string): Promise<number | null> {
  // Normalize legacy `https://storage.googleapis.com/<private-dir>/<id>`
  // shapes back into the `/objects/<id>` form the rest of the storage
  // helpers understand. Without this, older rows whose URLs were saved
  // before the route normalized on write would be reported as
  // missing-from-storage even when the blob is fine.
  const url = (() => {
    try {
      return objectStorage.normalizeObjectEntityPath(rawUrl);
    } catch {
      return rawUrl;
    }
  })();

  if (sizeCache.has(url)) return sizeCache.get(url) ?? null;

  if (!url.startsWith("/objects/")) {
    sizeCache.set(url, null);
    return null;
  }

  try {
    const file = await objectStorage.getObjectEntityFile(url);
    const [metadata] = await file.getMetadata();
    const raw = metadata.size;
    const size =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.length > 0
          ? parseInt(raw, 10)
          : NaN;
    if (!Number.isFinite(size) || size < 0) {
      sizeCache.set(url, null);
      return null;
    }
    sizeCache.set(url, size);
    return size;
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      sizeCache.set(url, null);
      return null;
    }
    throw err;
  }
}

type BackfillResult = {
  scanned: number;
  filled: number;
  missing: number;
  alreadyHadSize: number;
};

async function backfillTable(
  apply: boolean,
  table: typeof invoiceGroupsTable | typeof claimsTable,
  label: "invoice_groups" | "claims",
): Promise<BackfillResult> {
  const rows = await db
    .select({ id: table.id, evidenceFiles: table.evidenceFiles })
    .from(table)
    .where(isNotNull(table.evidenceFiles));

  const result: BackfillResult = {
    scanned: 0,
    filled: 0,
    missing: 0,
    alreadyHadSize: 0,
  };
  const missingUrls: Array<{ rowId: number; url: string }> = [];

  for (const row of rows) {
    const files = (row.evidenceFiles ?? []) as EvidenceFileRef[];
    if (!Array.isArray(files) || files.length === 0) continue;

    let rowChanged = false;
    const next: EvidenceFileRef[] = [];
    for (const f of files) {
      result.scanned += 1;
      // Defensive guard against malformed JSONB rows (missing `url`,
      // wrong shape, etc.) so a single bad entry doesn't abort the run.
      if (!f || typeof f !== "object" || typeof f.url !== "string" || f.url.length === 0) {
        next.push(f);
        continue;
      }
      if (typeof f.size === "number" && Number.isFinite(f.size)) {
        result.alreadyHadSize += 1;
        next.push(f);
        continue;
      }
      const size = await statBlobSize(f.url);
      if (size == null) {
        result.missing += 1;
        missingUrls.push({ rowId: row.id, url: f.url });
        next.push(f);
        continue;
      }
      result.filled += 1;
      rowChanged = true;
      next.push({ ...f, size });
    }

    if (rowChanged && apply) {
      await db
        .update(table)
        .set({ evidenceFiles: next })
        .where(eq(table.id, row.id));
    }
  }

  console.log(
    `[oneshot] ${label}: scanned ${result.scanned} entr${result.scanned === 1 ? "y" : "ies"} ` +
      `across ${rows.length} row(s) — ${result.alreadyHadSize} already had size, ` +
      `${result.filled} filled, ${result.missing} missing from storage`,
  );
  if (missingUrls.length > 0) {
    const sample = missingUrls.slice(0, 10);
    console.log(
      `[oneshot] ${label}: sample of missing-from-storage entries (up to 10):`,
    );
    for (const m of sample) {
      console.log(`  - row#${m.rowId} ${m.url}`);
    }
  }
  return result;
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    `[oneshot] Backfilling evidence_files sizes (${apply ? "APPLY" : "DRY RUN"}).`,
  );

  const groups = await backfillTable(apply, invoiceGroupsTable, "invoice_groups");
  const claims = await backfillTable(apply, claimsTable, "claims");

  const totals = {
    scanned: groups.scanned + claims.scanned,
    filled: groups.filled + claims.filled,
    missing: groups.missing + claims.missing,
    alreadyHadSize: groups.alreadyHadSize + claims.alreadyHadSize,
  };
  console.log(
    `[oneshot] Done. Totals: scanned=${totals.scanned} alreadyHadSize=${totals.alreadyHadSize} ` +
      `filled=${totals.filled} missing=${totals.missing}` +
      (apply ? "" : " — re-run with --apply to write changes."),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

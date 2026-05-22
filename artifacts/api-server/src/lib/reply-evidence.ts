/**
 * Helpers for the "Attach existing case files" reply-composer picker.
 *
 * The picker (`GET /invoice-groups/:id/reply-evidence`) and the
 * re-stage endpoint (`POST /storage/reply-attachments/stage-from-evidence`)
 * both need the same authoritative answer: "what storage-backed files
 * are already on this case?". This module owns that join so the two
 * routes can't drift apart on the membership check.
 *
 * Sources scanned:
 *   - `invoice_groups.evidence_files`
 *   - `claims.evidence_files` for every child claim of the group
 *   - The most recent `portal_submissions` row for the group:
 *       both `evidence_files` (snapshotted at draft time) and
 *       `attachment_urls` (string[]).
 *
 * Only entries whose URL starts with `/objects/` are surfaced — the
 * bot worker uses the same gate (see `collectGroupEvidenceUrls` in
 * `routes/portal-submissions.ts`) so external links never leak into a
 * code path that would try to re-upload them.
 */

import { eq, desc } from "drizzle-orm";
import {
  db,
  invoiceGroupsTable,
  claimsTable,
  portalSubmissionsTable,
} from "@workspace/db";

export type ReplyEvidenceSource = "group" | "claim" | "portal_submission";

export interface ReplyEvidenceItem {
  url: string;
  name: string;
  size: number | null;
  contentType: string | null;
  source: ReplyEvidenceSource;
  sources: ReplyEvidenceSource[];
  claimConfNumber: string | null;
}

// Order callers see groups in. Also defines the precedence used to pick
// the canonical `source` when a file is referenced from multiple rows
// (group beats claim beats portal submission).
const SOURCE_ORDER: ReplyEvidenceSource[] = [
  "group",
  "claim",
  "portal_submission",
];

const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function basename(url: string): string {
  const trimmed = url.split("?")[0].split("#")[0];
  const last = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function guessContentType(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_TO_MIME[ext] ?? null;
}

interface RawEvidenceFile {
  url?: string | null;
  name?: string | null;
  size?: number | null;
}

function isStorageBacked(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith("/objects/");
}

/**
 * Returns the case's existing storage-backed attachments, deduplicated
 * by URL. Each item records every source kind it was reached from so
 * the picker can show "shared between group + claim CLM-1234" badges
 * if we ever want that, while the `source` field still gives a single
 * primary label for the default grouping.
 *
 * Throws nothing — a missing group just produces an empty list (the
 * route layer returns 404 separately).
 */
export async function collectGroupReplyEvidence(
  groupId: number,
): Promise<ReplyEvidenceItem[]> {
  const [group] = await db
    .select({
      id: invoiceGroupsTable.id,
      evidenceFiles: invoiceGroupsTable.evidenceFiles,
    })
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.id, groupId))
    .limit(1);

  if (!group) return [];

  const claims = await db
    .select({
      id: claimsTable.id,
      confNumber: claimsTable.confNumber,
      evidenceFiles: claimsTable.evidenceFiles,
    })
    .from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, groupId));

  // The picker only re-surfaces the *latest* portal submission so the
  // list doesn't balloon for groups that were re-drafted several times
  // — the older drafts almost always reference the same URLs as the
  // current one anyway, so they'd dedupe to nothing.
  const [latestSubmission] = await db
    .select({
      id: portalSubmissionsTable.id,
      evidenceFiles: portalSubmissionsTable.evidenceFiles,
      attachmentUrls: portalSubmissionsTable.attachmentUrls,
    })
    .from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.invoiceGroupId, groupId))
    .orderBy(desc(portalSubmissionsTable.id))
    .limit(1);

  // url -> aggregated item. We walk sources in `SOURCE_ORDER` so the
  // first writer wins for the canonical `source` and metadata; later
  // sources just push onto `sources` and fill in missing name/size.
  const byUrl = new Map<string, ReplyEvidenceItem>();

  const ingest = (
    raw: RawEvidenceFile | null | undefined,
    source: ReplyEvidenceSource,
    claimConfNumber: string | null,
  ) => {
    if (!raw) return;
    const url = raw.url ?? null;
    if (!isStorageBacked(url)) return;

    const existing = byUrl.get(url);
    if (existing) {
      if (!existing.sources.includes(source)) {
        existing.sources.push(source);
      }
      if (!existing.name && raw.name) existing.name = raw.name;
      if (existing.size == null && typeof raw.size === "number") {
        existing.size = raw.size;
      }
      if (
        source === "claim" &&
        existing.source === "claim" &&
        !existing.claimConfNumber &&
        claimConfNumber
      ) {
        existing.claimConfNumber = claimConfNumber;
      }
      return;
    }

    const name =
      (typeof raw.name === "string" && raw.name.trim().length > 0
        ? raw.name
        : basename(url)) || basename(url);
    byUrl.set(url, {
      url,
      name,
      size: typeof raw.size === "number" ? raw.size : null,
      contentType: guessContentType(name),
      source,
      sources: [source],
      claimConfNumber: source === "claim" ? claimConfNumber : null,
    });
  };

  // Group-level evidence first (highest precedence).
  for (const f of group.evidenceFiles ?? []) {
    ingest(f, "group", null);
  }

  // Per-claim evidence.
  for (const c of claims) {
    for (const f of c.evidenceFiles ?? []) {
      ingest(f, "claim", c.confNumber ?? null);
    }
  }

  // Portal submission — both jsonb shapes.
  if (latestSubmission) {
    for (const f of latestSubmission.evidenceFiles ?? []) {
      ingest(f, "portal_submission", null);
    }
    for (const url of latestSubmission.attachmentUrls ?? []) {
      ingest({ url }, "portal_submission", null);
    }
  }

  // Stable output: by source precedence, then by name.
  const items = Array.from(byUrl.values());
  items.sort((a, b) => {
    const ai = SOURCE_ORDER.indexOf(a.source);
    const bi = SOURCE_ORDER.indexOf(b.source);
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });

  return items;
}

// One-shot backfill for Task #725. Walks every submitted portal_submission
// that has a real Freshdesk ticket id, scrapes the portal page, and POSTs
// any new conversation entries through `/api/responses/record-portal`.
//
// Default mode is dry-run — prints what would be created without writing.
// Pass `--apply` to actually post.
//
// The 19 priority group ids in `exports/silent-groups-2026-05-12.csv`
// are scraped first regardless of the rest of the queue order so the
// known-silent cohort gets cleared before we burn rate budget on the
// long tail.
//
// Output: a per-ticket line for every submission processed (submission id,
// group id, invoice number, scraped status, new responses found, group
// status delta, error if any) plus a JSONL log file under exports/ for
// post-mortem analysis.
//
// Usage:
//   pnpm --filter @workspace/api-server tsx scripts/portal-response-backfill.ts
//   pnpm --filter @workspace/api-server tsx scripts/portal-response-backfill.ts --apply
//   pnpm --filter @workspace/api-server tsx scripts/portal-response-backfill.ts --apply --limit 10
//   pnpm --filter @workspace/api-server tsx scripts/portal-response-backfill.ts --apply --statuses Awaiting\ Response,Resolved

import fs from "fs";
import path from "path";
import { db, portalSubmissionsTable, invoiceGroupsTable } from "@workspace/db";
import { and, eq, isNotNull, inArray } from "drizzle-orm";
import {
  syncPortalResponsesForSubmission,
  inProcessRecordPortalPoster,
  __setRecordPortalPosterForTests,
  type SyncOneResult,
} from "../src/lib/portal-response-sync";

// One-shot CLI runs without an API server in front of it, so we wire the
// in-process poster (calls processPortalResponse directly) before any
// scrape happens. This keeps backfill --apply fully self-contained.
__setRecordPortalPosterForTests(inProcessRecordPortalPoster);

// MAS rate-limit pacing for the one-shot backfill. Cron path already
// jitters via syncDuePortalSubmissions; the backfill must do the same so
// large runs (~hundreds of tickets) don't burst against the portal.
const PACE_MIN_MS = 750;
const PACE_MAX_MS = 3000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const jitterMs = () => PACE_MIN_MS + Math.floor(Math.random() * (PACE_MAX_MS - PACE_MIN_MS));

function parseSilentGroupIds(): number[] {
  const csvPath = path.resolve("exports/silent-groups-2026-05-12.csv");
  if (!fs.existsSync(csvPath)) {
    console.warn(`[backfill] Priority CSV not found at ${csvPath} — running without priority list`);
    return [];
  }
  const lines = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).filter(Boolean);
  const ids: number[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(",");
    const n = parseInt(cells[0] ?? "", 10);
    if (Number.isFinite(n)) ids.push(n);
  }
  return ids;
}

function getFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function getValueFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0 || idx >= process.argv.length - 1) return undefined;
  return process.argv[idx + 1];
}

function getNumberFlag(name: string): number | undefined {
  const v = getValueFlag(name);
  if (v === undefined) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

interface BackfillRow {
  submissionId: number;
  invoiceGroupId: number;
  invoiceNumber: string | null;
  portalTicketId: string | null;
  groupStatusBefore: string;
  groupStatusAfter: string | null;
  result: SyncOneResult;
}

async function fetchGroupStatus(invoiceGroupId: number): Promise<string | null> {
  const [g] = await db
    .select({ status: invoiceGroupsTable.status })
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.id, invoiceGroupId));
  return g?.status ?? null;
}

async function main(): Promise<void> {
  const dryRun = !getFlag("apply");
  const limit = getNumberFlag("limit");
  const statusesArg = getValueFlag("statuses");
  const statusesFilter = statusesArg
    ? statusesArg.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const priorityGroupIds = parseSilentGroupIds();
  console.log(
    `[backfill] mode=${dryRun ? "DRY-RUN" : "APPLY"} limit=${limit ?? "ALL"} statuses=${statusesFilter ? statusesFilter.join("|") : "ALL"} priority=${priorityGroupIds.length}`,
  );

  // Walk EVERY submitted portal_submission that has a real ticket id, not
  // only the ones whose group is currently Awaiting Response — the cron
  // narrows; the backfill widens. Synthetic `portal-<timestamp>` ids are
  // filtered in JS since they live in the same column.
  const baseWhere = statusesFilter
    ? and(
        eq(portalSubmissionsTable.status, "submitted"),
        isNotNull(portalSubmissionsTable.portalTicketId),
        inArray(invoiceGroupsTable.status, statusesFilter as Array<"Awaiting Response">),
      )
    : and(
        eq(portalSubmissionsTable.status, "submitted"),
        isNotNull(portalSubmissionsTable.portalTicketId),
      );

  const allRows = await db
    .select({
      submissionId: portalSubmissionsTable.id,
      invoiceGroupId: portalSubmissionsTable.invoiceGroupId,
      invoiceNumber: portalSubmissionsTable.invoiceNumber,
      portalTicketId: portalSubmissionsTable.portalTicketId,
      groupStatus: invoiceGroupsTable.status,
    })
    .from(portalSubmissionsTable)
    .innerJoin(invoiceGroupsTable, eq(portalSubmissionsTable.invoiceGroupId, invoiceGroupsTable.id))
    .where(baseWhere);

  const scrapable = allRows.filter((r) => r.portalTicketId && !/^portal-/i.test(r.portalTicketId));
  const synthetic = allRows.length - scrapable.length;
  console.log(`[backfill] ${allRows.length} candidate submission(s); ${synthetic} synthetic ticket id(s) skipped; ${scrapable.length} scrapable`);

  // Order: priority group ids first (in CSV order), then by submission id.
  const priorityOrder = new Map(priorityGroupIds.map((id, i) => [id, i] as const));
  const prioritySet = new Set(priorityGroupIds);
  scrapable.sort((a, b) => {
    const ap = prioritySet.has(a.invoiceGroupId) ? 0 : 1;
    const bp = prioritySet.has(b.invoiceGroupId) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    if (ap === 0) return priorityOrder.get(a.invoiceGroupId)! - priorityOrder.get(b.invoiceGroupId)!;
    return a.submissionId - b.submissionId;
  });

  const ordered = limit !== undefined ? scrapable.slice(0, limit) : scrapable;
  if (ordered.length === 0) {
    console.log("[backfill] Nothing to do.");
    return;
  }

  const logDir = path.resolve("exports");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `portal-response-backfill-${dryRun ? "dryrun" : "apply"}-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  console.log(`[backfill] writing per-ticket report to ${logPath}`);

  console.log("");
  console.log("submission_id  group_id  invoice         status_before     -> status_after     scraped     new  ticket           note");
  console.log("-------------  --------  --------------  ----------------     ----------------     -------     ---  ---------------  ----");

  const summary = { processed: 0, scraped: 0, errored: 0, skipped: 0, newResponses: 0, groupTransitions: 0 };
  for (let i = 0; i < ordered.length; i += 1) {
    const row = ordered[i];
    if (i > 0) await sleep(jitterMs());
    const before = row.groupStatus;
    const isPriority = prioritySet.has(row.invoiceGroupId);
    const result = await syncPortalResponsesForSubmission(row.submissionId, { dryRun });
    const after = await fetchGroupStatus(row.invoiceGroupId);
    const transitioned = after !== before;
    if (transitioned) summary.groupTransitions += 1;
    if (result.status === "scraped") summary.scraped += 1;
    else if (result.status === "error") summary.errored += 1;
    else summary.skipped += 1;
    summary.newResponses += result.newResponses;
    summary.processed += 1;

    const noteParts: string[] = [];
    if (isPriority) noteParts.push("PRIORITY");
    if (result.status === "error" && result.errorMessage) noteParts.push(`err=${result.errorMessage.slice(0, 60)}`);
    if (result.portalStatus) noteParts.push(`portal=${result.portalStatus}`);
    const note = noteParts.join(" ");

    const line = `${String(row.submissionId).padStart(13)}  ${String(row.invoiceGroupId).padStart(8)}  ${(row.invoiceNumber ?? "").padEnd(14)}  ${before.padEnd(16)}  -> ${(after ?? "?").padEnd(16)}  ${result.status.padEnd(7)}  ${String(result.newResponses).padStart(3)}  ${(row.portalTicketId ?? "").padEnd(15)}  ${note}`;
    console.log(line);

    const reportRow: BackfillRow = {
      submissionId: row.submissionId,
      invoiceGroupId: row.invoiceGroupId,
      invoiceNumber: row.invoiceNumber,
      portalTicketId: row.portalTicketId,
      groupStatusBefore: before,
      groupStatusAfter: after,
      result,
    };
    logStream.write(JSON.stringify({ ...reportRow, isPriority, transitioned }) + "\n");
  }

  logStream.end();
  console.log("");
  console.log(`[backfill] DONE  processed=${summary.processed}  scraped=${summary.scraped}  skipped=${summary.skipped}  errored=${summary.errored}  newResponses=${summary.newResponses}  groupTransitions=${summary.groupTransitions}`);
  if (dryRun) {
    console.log("[backfill] Dry-run complete. Re-run with --apply to POST scraped responses.");
  }
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});

/**
 * Portal-vs-DB verification harness — 2026-05-13 (one-shot, read-only)
 * ----------------------------------------------------------------------
 * Per stakeholder direction this is a one-time, exhaustive review of
 * every invoice in the duplicate-cluster upgrade cohort (213 groups,
 * 214 distinct real Freshdesk tickets). Going forward the daily portal-
 * sync cron supersedes this manual pull.
 *
 * What it does
 *   1. Pulls every (group, submission) pair tagged by the upgrade
 *      backfill (upgradeBackfillId='duplicate_cluster_response_upgrade_2026_05_13').
 *   2. Acquires `portalBrowserGate` and scrapes each distinct
 *      portal_ticket_id ONCE via `readPortalTicket()`.
 *   3. Re-classifies the carrier's latest verdict body via the same
 *      `tryClassifyInboundEmail()` Claude Haiku model used in the original
 *      upgrade so the chip comparison is apples-to-apples.
 *   4. Joins scraped state against DB state and emits a per-group diff
 *      record + a Markdown summary report.
 *
 * What it does NOT do
 *   - No DB writes. Zero side effects beyond refreshing
 *     `bot-session/state.json` (only on session expiry — same as the
 *     production cron).
 *   - No invoice_groups, portal_responses, or portal_submissions
 *     mutations. Mismatches surface in the report only — operators
 *     decide what (if anything) to remediate.
 *
 * Outputs
 *   exports/verify-against-portal-2026-05-13.jsonl     (per-group raw)
 *   exports/verify-against-portal-2026-05-13.md        (human summary)
 *
 * Cost / runtime
 *   - 214 scrapes × ~(1.5s settle + 750–3000ms jittered pace) ≈ 7–10 min
 *     wall clock holding the portal gate.
 *   - 213 LLM re-classifications (Claude Haiku) ≈ ~$0.20 total spend.
 *
 * Failure handling
 *   - Per-ticket errors are captured into the JSONL with `scrape_error`
 *     set; the run continues. Re-running is safe (the script does no
 *     mutation; it just regenerates the report).
 *
 * Usage
 *   cd artifacts/api-server
 *   DATABASE_URL="$PROD_DATABASE_URL" pnpm exec tsx \
 *     src/scripts/verify-against-portal-2026-05-13.ts
 *   # Optional flags:
 *   #   --limit N        cap at N groups (smoke runs)
 *   #   --skip-llm       skip re-classification (3× faster, no $$$)
 *   #   --only-mismatch  print only mismatch lines to stdout
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import { readPortalTicket, type PortalReaderResult } from "../bot/portal-reader";
import { portalBrowserGate } from "../lib/portal-browser-gate";
import { tryClassifyInboundEmail } from "../lib/inbound-email-classifier";
import { logger } from "../lib/logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPGRADE_BACKFILL_ID = "duplicate_cluster_response_upgrade_2026_05_13";
const JSONL_PATH = path.resolve(__dirname, "../../exports/verify-against-portal-2026-05-13.jsonl");
const SCRAPE_PATH = path.resolve(__dirname, "../../exports/verify-scrape-2026-05-13.jsonl");
const MD_PATH = path.resolve(__dirname, "../../exports/verify-against-portal-2026-05-13.md");

const PORTAL_USERNAME = (process.env.MAS_PORTAL_USERNAME ?? "").toLowerCase().trim();
const PACE_MIN_MS = 750;
const PACE_MAX_MS = 3000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const jitter = () => PACE_MIN_MS + Math.floor(Math.random() * (PACE_MAX_MS - PACE_MIN_MS));

function sha256(s: string | null | undefined): string | null {
  if (!s) return null;
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function normalize(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function getFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function getNumFlag(name: string): number | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i >= process.argv.length - 1) return undefined;
  const n = parseInt(process.argv[i + 1], 10);
  return Number.isFinite(n) ? n : undefined;
}

interface DbRow {
  groupId: number;
  invoiceNumber: string;
  groupStatus: string;
  groupPhase: string;
  groupReattestRequired: boolean;
  groupErrorTypeId: string | null;
  groupErrorTypeName: string | null;
  prId: number;
  prResponseType: string;
  prContent: string;
  prReceivedAt: string | null;
  prMetadata: Record<string, unknown>;
  submissions: Array<{
    submissionId: number;
    portalTicketId: string;
    status: string;
  }>;
}

async function loadCohort(limit?: number): Promise<DbRow[]> {
  const { rows: groupRows } = await pool.query(
    `
    SELECT ig.id              AS group_id,
           ig.invoice_number,
           ig.status::text    AS group_status,
           ig.phase::text     AS group_phase,
           COALESCE(ig.reattest_required, false) AS group_reattest_required,
           ig.error_type_id::text AS group_error_type_id,
           ig.error_type_name AS group_error_type_name,
           pr.id              AS pr_id,
           pr."responseType"::text AS pr_response_type,
           pr.content         AS pr_content,
           pr.received_at     AS pr_received_at,
           pr.metadata        AS pr_metadata
      FROM invoice_groups ig
      JOIN portal_responses pr
        ON pr.invoice_group_id = ig.id
       AND pr.metadata->>'upgradeBackfillId' = $1
     ORDER BY ig.id
     ${limit ? `LIMIT ${limit}` : ""}
    `,
    [UPGRADE_BACKFILL_ID],
  );

  if (groupRows.length === 0) return [];

  const groupIds = groupRows.map((r) => r.group_id);
  const { rows: subRows } = await pool.query(
    `SELECT id           AS submission_id,
            invoice_group_id AS group_id,
            portal_ticket_id,
            status::text AS status
       FROM portal_submissions
      WHERE invoice_group_id = ANY($1::int[])
        AND portal_ticket_id IS NOT NULL
        AND portal_ticket_id !~ '^portal-'
      ORDER BY id`,
    [groupIds],
  );
  const subsByGroup = new Map<number, DbRow["submissions"]>();
  for (const s of subRows) {
    if (!subsByGroup.has(s.group_id)) subsByGroup.set(s.group_id, []);
    subsByGroup.get(s.group_id)!.push({
      submissionId: s.submission_id,
      portalTicketId: s.portal_ticket_id,
      status: s.status,
    });
  }

  return groupRows.map((r): DbRow => ({
    groupId: r.group_id,
    invoiceNumber: r.invoice_number,
    groupStatus: r.group_status,
    groupPhase: r.group_phase,
    groupReattestRequired: r.group_reattest_required,
    groupErrorTypeId: r.group_error_type_id,
    groupErrorTypeName: r.group_error_type_name,
    prId: r.pr_id,
    prResponseType: r.pr_response_type,
    prContent: r.pr_content ?? "",
    prReceivedAt: r.pr_received_at ? new Date(r.pr_received_at).toISOString() : null,
    prMetadata: (r.pr_metadata as Record<string, unknown>) ?? {},
    submissions: subsByGroup.get(r.group_id) ?? [],
  }));
}

interface ScrapeRecord {
  ticketId: string;
  status: string | null;
  subject: string | null;
  messageCount: number;
  ourMessageCount: number;
  carrierMessageCount: number;
  latestCarrierBody: string | null;
  latestCarrierAuthor: string | null;
  latestCarrierEmail: string | null;
  latestCarrierPostedAt: string | null;
  scrapeError: string | null;
}

function classifyMessages(scraped: PortalReaderResult): ScrapeRecord {
  const ours: typeof scraped.messages = [];
  const carrier: typeof scraped.messages = [];
  for (const m of scraped.messages) {
    const email = (m.authorEmail ?? "").toLowerCase().trim();
    const isOurs = !!PORTAL_USERNAME && email === PORTAL_USERNAME;
    if (isOurs) ours.push(m);
    else carrier.push(m);
  }
  // Pick the LATEST carrier message by postedAt; fall back to last in array.
  const sortByPostedAt = (arr: typeof carrier) =>
    [...arr].sort((a, b) => {
      const ta = a.postedAt ? Date.parse(a.postedAt) : 0;
      const tb = b.postedAt ? Date.parse(b.postedAt) : 0;
      return tb - ta;
    });
  const latest = carrier.length > 0 ? sortByPostedAt(carrier)[0] : null;
  return {
    ticketId: scraped.ticketId,
    status: scraped.status,
    subject: scraped.subject,
    messageCount: scraped.messages.length,
    ourMessageCount: ours.length,
    carrierMessageCount: carrier.length,
    latestCarrierBody: latest?.bodyText ?? null,
    latestCarrierAuthor: latest?.authorName ?? null,
    latestCarrierEmail: latest?.authorEmail ?? null,
    latestCarrierPostedAt: latest?.postedAt ?? null,
    scrapeError: null,
  };
}

function loadScrapeCache(): Map<string, ScrapeRecord> {
  const out = new Map<string, ScrapeRecord>();
  if (!fs.existsSync(SCRAPE_PATH)) return out;
  const lines = fs.readFileSync(SCRAPE_PATH, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as ScrapeRecord;
      if (obj && typeof obj.ticketId === "string") out.set(obj.ticketId, obj);
    } catch { /* skip corrupt line */ }
  }
  return out;
}

async function scrapeAll(ticketIds: string[], chunkLimit: number | undefined): Promise<Map<string, ScrapeRecord>> {
  fs.mkdirSync(path.dirname(SCRAPE_PATH), { recursive: true });
  const cache = loadScrapeCache();
  const todo = ticketIds.filter((id) => !cache.has(id));
  const slice = chunkLimit !== undefined ? todo.slice(0, chunkLimit) : todo;
  console.log(`[scrape] cached=${cache.size}/${ticketIds.length}; this run will scrape ${slice.length} (chunkLimit=${chunkLimit ?? "ALL"})`);
  if (slice.length === 0) {
    console.log(`[scrape] nothing to do — all ${ticketIds.length} tickets already cached.`);
    return cache;
  }
  const total = slice.length;
  const append = fs.createWriteStream(SCRAPE_PATH, { flags: "a" });
  console.log(`[scrape] acquiring portalBrowserGate…`);
  const outcome = await portalBrowserGate.run(async () => {
    for (let i = 0; i < total; i += 1) {
      const ticketId = slice[i];
      if (i > 0) await sleep(jitter());
      let rec: ScrapeRecord;
      try {
        const scraped = await readPortalTicket(ticketId);
        rec = classifyMessages(scraped);
        if ((i + 1) % 5 === 0 || i === total - 1) {
          console.log(`[scrape] ${i + 1}/${total} done (last ticket ${ticketId} → status="${scraped.status}", msgs=${scraped.messages.length})`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ ticketId, err: msg }, "verify-against-portal: scrape failed");
        rec = {
          ticketId,
          status: null, subject: null,
          messageCount: 0, ourMessageCount: 0, carrierMessageCount: 0,
          latestCarrierBody: null, latestCarrierAuthor: null,
          latestCarrierEmail: null, latestCarrierPostedAt: null,
          scrapeError: msg,
        };
        console.log(`[scrape] ${i + 1}/${total} FAILED ${ticketId}: ${msg.slice(0, 100)}`);
      }
      cache.set(ticketId, rec);
      append.write(JSON.stringify(rec) + "\n");
    }
  });
  if (outcome.kind === "skipped") {
    append.end();
    throw new Error(`portalBrowserGate was busy (${outcome.reason}) — refusing to run; retry when the cron is idle`);
  }
  await outcome.result;
  await new Promise<void>((res) => append.end(res));
  return cache;
}

interface DiffRecord {
  groupId: number;
  invoiceNumber: string;
  db: {
    chip: string;
    contentHead: string;
    contentSha: string | null;
    receivedAt: string | null;
    phase: string;
    reattestRequired: boolean;
    errorTypeId: string | null;
    errorTypeName: string | null;
    groupStatus: string;
  };
  perTicket: Array<{
    submissionId: number;
    portalTicketId: string;
    dbSubmissionStatus: string;
    portalStatus: string | null;
    portalMessageCount: number;
    portalCarrierMessageCount: number;
    portalLatestCarrierAuthor: string | null;
    portalLatestCarrierPostedAt: string | null;
    portalLatestCarrierBodyHead: string | null;
    portalLatestCarrierBodySha: string | null;
    bodyMatchesDb: boolean;
    bodyOverlapWithDb: boolean;
    statusAgreement: "agree" | "disagree" | "unknown";
    scrapeError: string | null;
  }>;
  reclassification: {
    skipped: boolean;
    sourceTicketId: string | null;
    chip: string | null;
    confidence: number | null;
    abstain: boolean;
    matchesDbChip: boolean | null;
    error: string | null;
  };
  verdicts: {
    anyTicketBodyMatchesDb: boolean;
    anyTicketBodyOverlapsDb: boolean;
    anyTicketStatusAgreed: boolean;
    portalChipAgreesWithDb: boolean | null;
    overall: "match" | "soft_match" | "mismatch" | "scrape_failed" | "no_carrier_message";
  };
}

const SUBMITTED_STATUSES_OK_ON_PORTAL = new Set([
  "open", "pending", "awaiting your reply", "awaiting customer response",
  "customer responded",
]);
const CANCELLED_STATUSES_OK_ON_PORTAL = new Set([
  "closed", "resolved", "cancelled",
]);

function statusAgreement(dbSubStatus: string, portalStatus: string | null): "agree" | "disagree" | "unknown" {
  if (!portalStatus) return "unknown";
  const p = normalize(portalStatus);
  if (dbSubStatus === "submitted" && SUBMITTED_STATUSES_OK_ON_PORTAL.has(p)) return "agree";
  if (dbSubStatus === "cancelled" && CANCELLED_STATUSES_OK_ON_PORTAL.has(p)) return "agree";
  if (dbSubStatus === "submitted" && CANCELLED_STATUSES_OK_ON_PORTAL.has(p)) return "disagree"; // portal closed but we think open
  if (dbSubStatus === "cancelled" && SUBMITTED_STATUSES_OK_ON_PORTAL.has(p)) return "disagree"; // we cancelled but portal still open
  return "unknown";
}

async function buildDiff(rows: DbRow[], scraped: Map<string, ScrapeRecord>, skipLlm: boolean): Promise<DiffRecord[]> {
  const out: DiffRecord[] = [];
  let llmIdx = 0;
  for (const row of rows) {
    const dbContentNorm = normalize(row.prContent);

    // Per-ticket comparisons
    const perTicket = row.submissions.map((s) => {
      const sc = scraped.get(s.portalTicketId);
      const portalBody = sc?.latestCarrierBody ?? null;
      const portalBodyNorm = normalize(portalBody);
      const sha = sha256(portalBodyNorm || null);
      const exact = !!portalBodyNorm && portalBodyNorm === dbContentNorm;
      // Soft overlap: 50+ char substring of one in the other (catches portal
      // having appended a footer / signature / extra paragraph the carrier
      // added since we ingested).
      const overlap =
        !!portalBodyNorm && !!dbContentNorm &&
        (portalBodyNorm.includes(dbContentNorm.slice(0, Math.min(80, dbContentNorm.length))) ||
         dbContentNorm.includes(portalBodyNorm.slice(0, Math.min(80, portalBodyNorm.length))));
      return {
        submissionId: s.submissionId,
        portalTicketId: s.portalTicketId,
        dbSubmissionStatus: s.status,
        portalStatus: sc?.status ?? null,
        portalMessageCount: sc?.messageCount ?? 0,
        portalCarrierMessageCount: sc?.carrierMessageCount ?? 0,
        portalLatestCarrierAuthor: sc?.latestCarrierAuthor ?? null,
        portalLatestCarrierPostedAt: sc?.latestCarrierPostedAt ?? null,
        portalLatestCarrierBodyHead: portalBody ? portalBody.slice(0, 240) : null,
        portalLatestCarrierBodySha: sha,
        bodyMatchesDb: exact,
        bodyOverlapWithDb: overlap,
        statusAgreement: statusAgreement(s.status, sc?.status ?? null),
        scrapeError: sc?.scrapeError ?? null,
      };
    });

    // Pick the freshest carrier body across this group's tickets for re-classification
    const candidatesForReclass = perTicket
      .filter((t) => t.portalLatestCarrierBodyHead && !t.scrapeError)
      .sort((a, b) => {
        const ta = a.portalLatestCarrierPostedAt ? Date.parse(a.portalLatestCarrierPostedAt) : 0;
        const tb = b.portalLatestCarrierPostedAt ? Date.parse(b.portalLatestCarrierPostedAt) : 0;
        return tb - ta;
      });
    const reclassSource = candidatesForReclass[0] ?? null;
    const fullBodyForReclass = reclassSource
      ? scraped.get(reclassSource.portalTicketId)?.latestCarrierBody ?? null
      : null;

    let reclassification: DiffRecord["reclassification"] = {
      skipped: skipLlm,
      sourceTicketId: reclassSource?.portalTicketId ?? null,
      chip: null,
      confidence: null,
      abstain: false,
      matchesDbChip: null,
      error: null,
    };
    if (!skipLlm && fullBodyForReclass) {
      llmIdx += 1;
      try {
        const subject = `Re: Invoice ${row.invoiceNumber}`;
        const ctx = {
          invoiceNumber: row.invoiceNumber,
          carrier: scraped.get(reclassSource!.portalTicketId)?.latestCarrierAuthor ?? null,
        };
        const r = await tryClassifyInboundEmail(subject, fullBodyForReclass, ctx as any);
        if (!r) {
          reclassification.abstain = true;
        } else {
          reclassification.chip = r.result.decision;
          reclassification.confidence = r.result.confidence ?? null;
          reclassification.matchesDbChip = r.result.decision === row.prResponseType;
        }
        if (llmIdx % 25 === 0) console.log(`[reclassify] ${llmIdx} done`);
      } catch (err) {
        reclassification.error = err instanceof Error ? err.message : String(err);
      }
    }

    const anyExact = perTicket.some((t) => t.bodyMatchesDb);
    const anyOverlap = perTicket.some((t) => t.bodyOverlapWithDb);
    const anyStatusAgree = perTicket.some((t) => t.statusAgreement === "agree");
    const anyScrapeFailed = perTicket.every((t) => t.scrapeError);
    const anyCarrierMsg = perTicket.some((t) => (t.portalCarrierMessageCount ?? 0) > 0);

    let overall: DiffRecord["verdicts"]["overall"];
    if (anyScrapeFailed) overall = "scrape_failed";
    else if (!anyCarrierMsg) overall = "no_carrier_message";
    else if (anyExact && (reclassification.matchesDbChip !== false)) overall = "match";
    else if (anyOverlap && (reclassification.matchesDbChip !== false)) overall = "soft_match";
    else overall = "mismatch";

    out.push({
      groupId: row.groupId,
      invoiceNumber: row.invoiceNumber,
      db: {
        chip: row.prResponseType,
        contentHead: row.prContent.slice(0, 240),
        contentSha: sha256(dbContentNorm),
        receivedAt: row.prReceivedAt,
        phase: row.groupPhase,
        reattestRequired: row.groupReattestRequired,
        errorTypeId: row.groupErrorTypeId,
        errorTypeName: row.groupErrorTypeName,
        groupStatus: row.groupStatus,
      },
      perTicket,
      reclassification,
      verdicts: {
        anyTicketBodyMatchesDb: anyExact,
        anyTicketBodyOverlapsDb: anyOverlap,
        anyTicketStatusAgreed: anyStatusAgree,
        portalChipAgreesWithDb: reclassification.matchesDbChip,
        overall,
      },
    });
  }
  return out;
}

function writeJsonl(diffs: DiffRecord[]) {
  fs.mkdirSync(path.dirname(JSONL_PATH), { recursive: true });
  fs.writeFileSync(JSONL_PATH, diffs.map((d) => JSON.stringify(d)).join("\n") + "\n");
}

function writeMarkdown(diffs: DiffRecord[], elapsedSec: number, skipLlm: boolean) {
  const total = diffs.length;
  const buckets: Record<DiffRecord["verdicts"]["overall"], number> = {
    match: 0, soft_match: 0, mismatch: 0, scrape_failed: 0, no_carrier_message: 0,
  };
  let chipReclassMatches = 0, chipReclassMismatches = 0, chipReclassAbstain = 0, chipReclassSkipped = 0;
  let statusAgree = 0, statusDisagree = 0, statusUnknown = 0;
  for (const d of diffs) {
    buckets[d.verdicts.overall] += 1;
    if (d.reclassification.skipped) chipReclassSkipped += 1;
    else if (d.reclassification.abstain) chipReclassAbstain += 1;
    else if (d.reclassification.matchesDbChip === true) chipReclassMatches += 1;
    else if (d.reclassification.matchesDbChip === false) chipReclassMismatches += 1;
    for (const t of d.perTicket) {
      if (t.statusAgreement === "agree") statusAgree += 1;
      else if (t.statusAgreement === "disagree") statusDisagree += 1;
      else statusUnknown += 1;
    }
  }

  const mismatches = diffs.filter((d) => d.verdicts.overall === "mismatch");
  const scrapeFailures = diffs.filter((d) => d.verdicts.overall === "scrape_failed");
  const noCarrier = diffs.filter((d) => d.verdicts.overall === "no_carrier_message");
  const chipDisagreements = diffs.filter((d) => d.reclassification.matchesDbChip === false);
  const statusDisagrees = diffs.filter((d) => d.perTicket.some((t) => t.statusAgreement === "disagree"));

  const lines: string[] = [];
  lines.push(`# Portal-vs-DB Verification Report — 2026-05-13`);
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push(`Elapsed: ${elapsedSec.toFixed(1)}s`);
  lines.push(`Cohort: \`metadata->>upgradeBackfillId='${UPGRADE_BACKFILL_ID}'\` (213 invoice_groups, 214 distinct real Freshdesk tickets)`);
  lines.push(`Mode: read-only scrape + ${skipLlm ? "NO" : ""} LLM re-classification (Claude Haiku, same model used in the upgrade)`);
  lines.push("");
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| Verdict | Count | % |`);
  lines.push(`|---|---:|---:|`);
  for (const k of ["match", "soft_match", "mismatch", "scrape_failed", "no_carrier_message"] as const) {
    const n = buckets[k];
    lines.push(`| ${k} | ${n} | ${((n / total) * 100).toFixed(1)}% |`);
  }
  lines.push(`| **TOTAL** | **${total}** | 100% |`);
  lines.push("");
  lines.push(`### Chip re-classification (DB chip vs portal-body re-classified by Claude Haiku)`);
  lines.push("");
  lines.push(`| Outcome | Count |`);
  lines.push(`|---|---:|`);
  lines.push(`| Re-classifier agrees with stored chip | ${chipReclassMatches} |`);
  lines.push(`| Re-classifier DISAGREES with stored chip | ${chipReclassMismatches} |`);
  lines.push(`| Re-classifier abstained (LLM error) | ${chipReclassAbstain} |`);
  lines.push(`| Re-classification skipped | ${chipReclassSkipped} |`);
  lines.push("");
  lines.push(`### Submission status agreement (DB portal_submissions.status vs portal ticket status)`);
  lines.push("");
  lines.push(`| Outcome | Submissions |`);
  lines.push(`|---|---:|`);
  lines.push(`| Agree | ${statusAgree} |`);
  lines.push(`| Disagree | ${statusDisagree} |`);
  lines.push(`| Unknown / unmapped portal status | ${statusUnknown} |`);
  lines.push("");

  const renderMismatchTable = (title: string, items: DiffRecord[]) => {
    if (items.length === 0) return;
    lines.push(`## ${title} (${items.length})`);
    lines.push("");
    lines.push(`| Group | Invoice | DB chip | Re-classifier chip | DB body head | Portal body head | Notes |`);
    lines.push(`|---:|---|---|---|---|---|---|`);
    for (const d of items) {
      const head = d.perTicket.find((t) => t.portalLatestCarrierBodyHead);
      const notes: string[] = [];
      if (d.reclassification.matchesDbChip === false) notes.push(`chip drift`);
      if (d.perTicket.some((t) => t.statusAgreement === "disagree")) notes.push(`status drift`);
      if (d.reclassification.error) notes.push(`llm err`);
      lines.push(
        `| ${d.groupId} | ${d.invoiceNumber} | ${d.db.chip} | ${d.reclassification.chip ?? "(skipped/abstain)"} | ${(d.db.contentHead ?? "").replace(/\|/g, "\\|").slice(0, 80)} | ${(head?.portalLatestCarrierBodyHead ?? "").replace(/\|/g, "\\|").slice(0, 80)} | ${notes.join(", ")} |`,
      );
    }
    lines.push("");
  };
  renderMismatchTable("Mismatches (need eyes on)", mismatches);
  renderMismatchTable("Chip disagreements (re-classifier chose a different chip than the stored one)", chipDisagreements);
  renderMismatchTable("Status drifts (DB submission status disagrees with portal ticket status)", statusDisagrees);
  if (scrapeFailures.length > 0) {
    lines.push(`## Scrape failures (${scrapeFailures.length})`);
    lines.push("");
    for (const d of scrapeFailures) {
      const errs = d.perTicket.map((t) => `ticket=${t.portalTicketId} err=${t.scrapeError ?? ""}`).join("; ");
      lines.push(`- group=${d.groupId} invoice=${d.invoiceNumber}: ${errs}`);
    }
    lines.push("");
  }
  if (noCarrier.length > 0) {
    lines.push(`## No carrier message on portal (${noCarrier.length})`);
    lines.push("");
    lines.push(`These tickets were scraped successfully but the portal thread contains no message from a non-internal author. The DB has a verdict body for them — investigate whether the verdict came from a different ticket or a different channel (email, attachment, etc.).`);
    lines.push("");
    for (const d of noCarrier) {
      lines.push(`- group=${d.groupId} invoice=${d.invoiceNumber} db_chip=${d.db.chip} ticket(s)=${d.perTicket.map((t) => t.portalTicketId).join(",")}`);
    }
    lines.push("");
  }
  lines.push(`## Methodology`);
  lines.push("");
  lines.push(`- **Scrape:** Each distinct \`portal_submissions.portal_ticket_id\` was loaded once via \`readPortalTicket()\` (the same Playwright code that powers the production cron). The full message thread was parsed.`);
  lines.push(`- **Carrier vs ours:** Messages whose author email matches \`MAS_PORTAL_USERNAME\` (case-insensitive) are treated as our outbound; everything else is the carrier (the payor). The latest carrier message per ticket is the candidate verdict.`);
  lines.push(`- **Body comparison:** Whitespace-collapsed, lowercased SHA-256 of the candidate verdict vs the stored \`portal_responses.content\`. \`bodyMatchesDb\` requires an exact normalized match. \`bodyOverlapWithDb\` looks for an 80-char prefix overlap either direction (catches portal-side appended footers / signatures).`);
  lines.push(`- **Status comparison:** \`portal_submissions.status\` ('submitted'/'cancelled') is mapped to expected portal statuses. Open/Pending/Awaiting variants → submitted; Closed/Resolved/Cancelled → cancelled. Any other portal status is recorded as \`unknown\` (not a failure).`);
  lines.push(`- **Chip re-classification:** The latest carrier body across the group's tickets is fed back through \`tryClassifyInboundEmail()\` (Claude Haiku, the exact model used in the original upgrade). If the LLM verdict matches the stored \`portal_responses.responseType\`, the chip is confirmed; if not, it's flagged for review.`);
  lines.push(`- **Overall verdict:** \`match\` requires exact body + non-disagreeing chip; \`soft_match\` requires overlap body + non-disagreeing chip; \`mismatch\` is everything else with a carrier message; \`scrape_failed\` is when every ticket for the group failed to scrape; \`no_carrier_message\` is when the scrape succeeded but no non-internal message was found.`);
  lines.push("");
  lines.push(`## Raw data`);
  lines.push("");
  lines.push(`Per-group records: \`exports/verify-against-portal-2026-05-13.jsonl\`.`);

  fs.writeFileSync(MD_PATH, lines.join("\n"));
}

async function main() {
  const limit = getNumFlag("limit");
  const chunk = getNumFlag("chunk");
  const skipLlm = getFlag("skip-llm");
  const onlyMismatch = getFlag("only-mismatch");
  const diffOnly = getFlag("diff-only");
  const scrapeOnly = getFlag("scrape-only");

  console.log(`[verify] loading cohort (limit=${limit ?? "ALL"})…`);
  const rows = await loadCohort(limit);
  console.log(`[verify] ${rows.length} groups, ${rows.reduce((acc, r) => acc + r.submissions.length, 0)} scrapable submissions`);

  const distinctTickets = Array.from(
    new Set(rows.flatMap((r) => r.submissions.map((s) => s.portalTicketId))),
  );
  console.log(`[verify] ${distinctTickets.length} distinct portal tickets to scrape (cache: ${SCRAPE_PATH})`);
  if (!PORTAL_USERNAME && !diffOnly) {
    console.error(`[verify] WARN: MAS_PORTAL_USERNAME not set — cannot distinguish our messages from carrier messages. Aborting.`);
    process.exit(2);
  }

  const t0 = Date.now();
  let scraped: Map<string, ScrapeRecord>;
  if (diffOnly) {
    scraped = loadScrapeCache();
    const missing = distinctTickets.filter((id) => !scraped.has(id)).length;
    console.log(`[verify] diff-only mode: ${scraped.size} cached, ${missing} missing`);
  } else {
    scraped = await scrapeAll(distinctTickets, chunk);
  }
  console.log(`[verify] scrape phase complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const cachedAll = distinctTickets.every((id) => scraped.has(id));
  if (scrapeOnly || (!cachedAll && !diffOnly)) {
    const left = distinctTickets.filter((id) => !scraped.has(id)).length;
    console.log(`\n[verify] Stopping after scrape phase. ${scraped.size}/${distinctTickets.length} tickets cached; ${left} remaining.`);
    if (left > 0) console.log(`[verify] Run again with the same flags (or --chunk N) to continue; rerun with --diff-only when 0 remaining.`);
    await pool.end();
    return;
  }

  console.log(`[verify] building diff…`);
  const diffs = await buildDiff(rows, scraped, skipLlm);
  writeJsonl(diffs);
  const elapsed = (Date.now() - t0) / 1000;
  writeMarkdown(diffs, elapsed, skipLlm);

  console.log(`\n=== VERIFICATION SUMMARY ===`);
  const buckets: Record<string, number> = { match: 0, soft_match: 0, mismatch: 0, scrape_failed: 0, no_carrier_message: 0 };
  for (const d of diffs) buckets[d.verdicts.overall] += 1;
  for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(20)} ${v}`);
  console.log(`\n[verify] JSONL: ${JSONL_PATH}`);
  console.log(`[verify] Report: ${MD_PATH}`);

  if (onlyMismatch) {
    const mm = diffs.filter((d) => d.verdicts.overall === "mismatch");
    console.log(`\n=== MISMATCHES (${mm.length}) ===`);
    for (const d of mm) {
      console.log(`group=${d.groupId} invoice=${d.invoiceNumber} db_chip=${d.db.chip} reclass=${d.reclassification.chip ?? "?"} body_match=${d.verdicts.anyTicketBodyMatchesDb} overlap=${d.verdicts.anyTicketBodyOverlapsDb}`);
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error("[verify] fatal:", e);
  process.exit(1);
});

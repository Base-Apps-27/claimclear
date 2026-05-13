// One-shot resolver for the per-leg duplicate-submission cohort
// (2026-05-13).
//
// Background: the earliest dispute-submission flow filed one Freshdesk
// ticket PER LEG instead of per invoice. The invoice → invoice_group
// mapping is already 1-to-1 in our DB (no duplicate groups), but those
// per-leg tickets remained — each `invoice_groups` row now points at a
// stack of `portal_submissions` rows (one per leg-ticket). MAS replies
// to whichever ticket they treat as canonical and CLOSES the duplicate
// tickets with a "previous correction was submitted on M/D/YY"
// template message. Counts on prod 2026-05-13: 673 groups in
// 'Awaiting Response', 1,397 portal_submissions across 754 invoices —
// ~643 surplus duplicate tickets.
//
// Stuck-group definition: an `Awaiting Response` group is genuinely
// stuck only when EVERY one of its portal tickets has been closed by
// MAS. As long as one ticket is still Open on the MAS side, the
// real verdict will land there and the existing portal-reader flow
// will transition the group correctly.
//
// What this script does (operates at GROUP level, not submission
// level — there is no satellite/canonical link to write because the
// group is already correctly attached to its invoice):
//
//   1) DISCOVER: every invoice_group in 'Awaiting Response', with
//      all its portal_submissions (whether 1 or 15).
//   2) SCRAPE: open every ticket via `readPortalTicket`, capture
//      live `status` (Open / Closed / etc.) and the latest message
//      body. Pacing: 750–3000 ms jitter per ticket (matches the
//      established prod sweep cadence).
//   3) BUCKET each group:
//        canonical_open            ≥1 ticket still Open. No action —
//                                  existing flow will handle the verdict.
//        all_closed_all_duplicates Every ticket Closed AND every
//                                  latest message tagged as
//                                  `mas_duplicate_correction_already_submitted`
//                                  (or any acknowledgment phrase).
//                                  MAS resolved upstream without us
//                                  seeing a verdict; we'll never get
//                                  one here.
//        all_closed_with_verdict   Every ticket Closed BUT at least
//                                  one latest message is NOT an
//                                  acknowledgment (the real verdict
//                                  body landed on a now-closed
//                                  ticket and we missed harvesting
//                                  it).
//        scrape_error              At least one ticket failed to
//                                  scrape. Defer; operator re-runs.
//   4) PLAN: write the full bucket matrix to
//      exports/duplicate-cluster-plan-2026-05-13.csv for review.
//   5) APPLY (only with --apply):
//        all_closed_all_duplicates → invoice_groups.status='Resolved',
//          claims.status='Resolved', outcome='No Action Needed',
//          disposition='duplicate', portal_responses.processed=true.
//          Audit row carries metadata.satelliteTicketIds and
//          metadata.backfillId='duplicate_cluster_resolution_2026_05_13'.
//        all_closed_with_verdict   → invoice_groups.status='Ready to Review'
//          with an audit row pointing the operator at the substantive
//          ticket (so they can manually pre-fill the verdict). We
//          intentionally do NOT auto-record verdicts during a backfill;
//          one operator-review pass is the safer trade-off.
//
// Idempotent: re-running re-discovers from prod state; UPDATEs re-assert
// `status='Awaiting Response'` so a partial re-run only touches groups
// that still drift.
//
// Run (against PROD_DATABASE_URL):
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-resolve-duplicate-clusters-2026-05-13.ts \
//     [--apply] [--limit N] [--no-scrape] [--multi-only]
//
// Flags:
//   --apply      Execute the two safe actions (close $0 and surface to
//                operator review). Without --apply this is dry-run:
//                scrape + plan CSV only.
//   --limit N    Cap groups processed (handy for rehearsal).
//   --no-scrape  Skip the live scrape; infer live status from the
//                most-recent portal_response row's metadata.portalStatus
//                already in the DB. Faster but only safe when prod was
//                scraped recently.
//   --multi-only Restrict to groups with >1 portal_submission. Keeps
//                rehearsals focused on the per-leg duplicate cohort.

import * as fs from "node:fs";
import * as path from "node:path";
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { readPortalTicket } from "../bot/portal-reader";
import { classifyByPhrase } from "../lib/email-phrase-classifier";

const BACKFILL_ID = "duplicate_cluster_resolution_2026_05_13";
const ACTOR_EMAIL = "system@claimclear";
const ACTOR_NAME = "System (duplicate-cluster resolver 2026-05-13)";
const PLAN_CSV_PATH = path.resolve(
  process.cwd(),
  "exports",
  "duplicate-cluster-plan-2026-05-13.csv",
);
// Resumable scrape cache: each successful or errored ticket scrape is
// appended as one JSON line keyed by submission_id. Subsequent runs load
// this and skip already-scraped tickets, so the 723-ticket scrape can
// be chunked across many invocations (the bash sandbox kills detached
// processes, so we need to make progress per-call). Delete this file
// to force a full re-scrape.
const SCRAPE_CACHE_PATH = path.resolve(
  process.cwd(),
  "exports",
  "duplicate-cluster-scrape-cache-2026-05-13.jsonl",
);

interface SubmissionRow extends Record<string, unknown> {
  group_id: number;
  invoice_number: string | null;
  submission_id: number;
  portal_ticket_id: string | null;
  submitted_at: string | null;
}

interface ScrapedTicket {
  groupId: number;
  submissionId: number;
  ticketId: string;
  invoiceNumber: string | null;
  livePortalStatus: string | null;
  latestMessageSignatureId: string | null;
  latestMessageOutcome: string;
  latestMessageBodyPreview: string;
  scrapeError: string | null;
}

type GroupBucket =
  | "canonical_open"
  | "all_closed_all_duplicates"
  | "all_closed_with_verdict"
  | "scrape_error"
  | "needs_scrape"
  | "synthetic_only";

interface GroupPlan {
  groupId: number;
  invoiceNumber: string | null;
  bucket: GroupBucket;
  ticketCount: number;
  openTicketCount: number;
  verdictCarrierSubmissionId: number | null;
  tickets: ScrapedTicket[];
}

function jitterMs(): number { return 750 + Math.floor(Math.random() * 2250); }
async function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

function loadScrapeCache(): Map<number, ScrapedTicket> {
  const out = new Map<number, ScrapedTicket>();
  if (!fs.existsSync(SCRAPE_CACHE_PATH)) return out;
  const lines = fs.readFileSync(SCRAPE_CACHE_PATH, "utf8").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const t = JSON.parse(line) as ScrapedTicket;
      // Re-scrape entries that previously errored so transient failures
      // get another shot on the next chunk.
      if (t.scrapeError) continue;
      out.set(t.submissionId, t);
    } catch {
      // Skip malformed line — cache is append-only, partial writes get pruned on next successful append.
    }
  }
  return out;
}

function appendScrapeCache(t: ScrapedTicket): void {
  const dir = path.dirname(SCRAPE_CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(SCRAPE_CACHE_PATH, JSON.stringify(t) + "\n", "utf8");
}

// Tri-state: "open" | "closed" | "unknown". `unknown` (null/empty status
// string from `--no-scrape` mode where we have no portal_responses row
// for the submission yet) is intentionally not coerced into either side
// — the bucketing logic routes such tickets to `needs_scrape` so a
// live scrape can pin them down.
function classifyStatus(s: string | null): "open" | "closed" | "unknown" {
  if (!s) return "unknown";
  const lower = s.toLowerCase();
  if (lower.includes("closed") || lower.includes("resolved")) return "closed";
  return "open";
}

function isAcknowledgmentMessage(t: ScrapedTicket): boolean {
  // The dedicated duplicate-template signature is the strongest signal,
  // but any phrase-classifier acknowledgment outcome is enough to treat
  // the latest message as a "you already filed this" status ping.
  return t.latestMessageOutcome === "acknowledgment";
}

async function discoverGroups(multiOnly: boolean): Promise<Map<number, SubmissionRow[]>> {
  const res = await db.execute<SubmissionRow>(sql`
    SELECT g.id                 AS group_id,
           ps.invoice_number,
           ps.id                AS submission_id,
           ps.portal_ticket_id,
           ps.submitted_at::text AS submitted_at
      FROM invoice_groups g
      JOIN portal_submissions ps ON ps.invoice_group_id = g.id
     WHERE g.status::text = 'Awaiting Response'
       AND ps.portal_ticket_id IS NOT NULL
     ORDER BY g.id, ps.submitted_at NULLS LAST, ps.id;
  `);
  const rows = (res.rows ?? []) as SubmissionRow[];
  const groups = new Map<number, SubmissionRow[]>();
  for (const r of rows) {
    const arr = groups.get(r.group_id) ?? [];
    arr.push(r);
    groups.set(r.group_id, arr);
  }
  if (multiOnly) {
    for (const [gid, subs] of Array.from(groups.entries())) {
      if (subs.length < 2) groups.delete(gid);
    }
  }
  return groups;
}

interface DbInferredRow extends Record<string, unknown> {
  submission_id: number;
  portal_status: string | null;
  latest_body: string | null;
}

async function inferFromDb(submissionIds: number[]): Promise<Map<number, { status: string | null; body: string | null }>> {
  if (submissionIds.length === 0) return new Map();
  const res = await db.execute<DbInferredRow>(sql`
    SELECT DISTINCT ON (pr.submission_id)
           pr.submission_id,
           (pr.metadata ->> 'portalStatus') AS portal_status,
           pr.content                       AS latest_body
      FROM portal_responses pr
     WHERE pr.submission_id = ANY(${sql.raw(`ARRAY[${submissionIds.join(",")}]::int[]`)})
     ORDER BY pr.submission_id, pr.created_at DESC NULLS LAST, pr.id DESC;
  `);
  const rows = (res.rows ?? []) as DbInferredRow[];
  const out = new Map<number, { status: string | null; body: string | null }>();
  for (const r of rows) out.set(r.submission_id, { status: r.portal_status, body: r.latest_body });
  return out;
}

async function scrapeTicket(row: SubmissionRow): Promise<ScrapedTicket> {
  const ticketId = row.portal_ticket_id!;
  // Synthetic IDs (e.g. "portal-1777418252364") were minted client-side
  // when a submission was queued but the real Freshdesk ticket id was
  // never written back. They have no MAS-side presence — treat them as
  // permanent "no-op" tickets so they neither count as Open nor as
  // verdict carriers when bucketing the parent group.
  if (!/^\d+$/.test(ticketId)) {
    return {
      groupId: row.group_id, submissionId: row.submission_id, ticketId,
      invoiceNumber: row.invoice_number, livePortalStatus: "synthetic",
      latestMessageSignatureId: null, latestMessageOutcome: "synthetic",
      latestMessageBodyPreview: "", scrapeError: null,
    };
  }
  try {
    const parsed = await readPortalTicket(ticketId);
    const latestMsg = parsed.messages.at(-1);
    const phrase = latestMsg ? classifyByPhrase(latestMsg.bodyText) : null;
    return {
      groupId: row.group_id,
      submissionId: row.submission_id,
      ticketId,
      invoiceNumber: row.invoice_number,
      livePortalStatus: parsed.status,
      latestMessageSignatureId: phrase?.selectedSignatureId ?? null,
      latestMessageOutcome: phrase?.outcome ?? "unknown",
      latestMessageBodyPreview: latestMsg?.bodyText.slice(0, 160).replace(/\s+/g, " ") ?? "",
      scrapeError: null,
    };
  } catch (err) {
    return {
      groupId: row.group_id, submissionId: row.submission_id, ticketId,
      invoiceNumber: row.invoice_number, livePortalStatus: null,
      latestMessageSignatureId: null, latestMessageOutcome: "unknown",
      latestMessageBodyPreview: "",
      scrapeError: err instanceof Error ? err.message : String(err),
    };
  }
}

function bucketGroup(groupId: number, invoiceNumber: string | null, allTickets: ScrapedTicket[]): GroupPlan {
  const errored = allTickets.filter((t) => t.scrapeError !== null);
  if (errored.length > 0) {
    return { groupId, invoiceNumber, bucket: "scrape_error", ticketCount: allTickets.length,
      openTicketCount: 0, verdictCarrierSubmissionId: null, tickets: allTickets };
  }
  // Synthetic tickets never reached MAS — drop them from the decision
  // matrix when there's at least one real ticket alongside. But a group
  // with 100% synthetic tickets has NO real MAS-side evidence at all,
  // so we cannot conclude the duplicates were closed — defer to manual
  // review via `synthetic_only` (this guards against a vacuous-truth
  // bug that would otherwise auto-close those groups via fallthrough).
  const tickets = allTickets.filter((t) => t.livePortalStatus !== "synthetic");
  if (tickets.length === 0) {
    return { groupId, invoiceNumber, bucket: "synthetic_only", ticketCount: allTickets.length,
      openTicketCount: 0, verdictCarrierSubmissionId: null, tickets: allTickets };
  }
  const states = tickets.map((t) => classifyStatus(t.livePortalStatus));
  const openCount = states.filter((s) => s === "open").length;
  const closedCount = states.filter((s) => s === "closed").length;
  const unknownCount = states.filter((s) => s === "unknown").length;

  // Any explicitly-Open ticket means the canonical exists. Even if some
  // siblings are still 'unknown' (not yet scraped), the existing flow
  // will deliver the verdict on the open one — no action required.
  if (openCount > 0) {
    return { groupId, invoiceNumber, bucket: "canonical_open", ticketCount: allTickets.length,
      openTicketCount: openCount, verdictCarrierSubmissionId: null, tickets: allTickets };
  }
  // Anything less than full coverage of explicitly-Closed tickets is
  // unsafe to bucket as "all closed". Defer until a live scrape pins
  // every ticket's status. (Synthetic tickets are filtered out above
  // and don't count as 'unknown'.)
  if (closedCount !== tickets.length || unknownCount > 0) {
    return { groupId, invoiceNumber, bucket: "needs_scrape", ticketCount: allTickets.length,
      openTicketCount: 0, verdictCarrierSubmissionId: null, tickets: allTickets };
  }
  // Every ticket is explicitly Closed. Distinguish "all duplicate-template
  // acks" (safe to close at $0) from "carries a real verdict somewhere"
  // (route to operator review). A ticket counts as a verdict carrier when
  // its latest message is non-empty AND the phrase classifier did NOT
  // tag it as an acknowledgment.
  const verdictCarriers = tickets.filter((t) =>
    !isAcknowledgmentMessage(t) && t.latestMessageBodyPreview.length > 0,
  );
  if (verdictCarriers.length === 0) {
    return { groupId, invoiceNumber, bucket: "all_closed_all_duplicates", ticketCount: allTickets.length,
      openTicketCount: 0, verdictCarrierSubmissionId: null, tickets: allTickets };
  }
  return { groupId, invoiceNumber, bucket: "all_closed_with_verdict", ticketCount: allTickets.length,
    openTicketCount: 0, verdictCarrierSubmissionId: verdictCarriers[0].submissionId, tickets: allTickets };
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writePlanCsv(plans: GroupPlan[]): void {
  const dir = path.dirname(PLAN_CSV_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const header = [
    "group_id", "invoice_number", "bucket", "ticket_count", "open_ticket_count", "verdict_carrier_submission_id",
    "submission_id", "portal_ticket_id", "live_portal_status", "latest_message_signature", "latest_message_outcome",
    "scrape_error", "latest_body_preview",
  ].join(",");
  const lines = [header];
  for (const p of plans) {
    for (const t of p.tickets) {
      lines.push([
        p.groupId, p.invoiceNumber ?? "", p.bucket, p.ticketCount, p.openTicketCount, p.verdictCarrierSubmissionId ?? "",
        t.submissionId, t.ticketId, t.livePortalStatus ?? "", t.latestMessageSignatureId ?? "",
        t.latestMessageOutcome, t.scrapeError ?? "", t.latestMessageBodyPreview,
      ].map(csvEscape).join(","));
    }
  }
  fs.writeFileSync(PLAN_CSV_PATH, lines.join("\n") + "\n", "utf8");
}

interface ApplyStats { closedAt0: number; routedToReview: number; closedClaims: number; markedResponses: number; }

async function applyPlan(plans: GroupPlan[]): Promise<ApplyStats> {
  const stats: ApplyStats = { closedAt0: 0, routedToReview: 0, closedClaims: 0, markedResponses: 0 };
  const client = await pool.connect();
  try {
    for (const p of plans) {
      if (p.bucket !== "all_closed_all_duplicates" && p.bucket !== "all_closed_with_verdict") continue;
      await client.query("BEGIN");
      try {
        if (p.bucket === "all_closed_all_duplicates") {
          const groupUpd = await client.query(
            `UPDATE invoice_groups SET status = 'Resolved'::claim_status
              WHERE id = $1 AND status::text = 'Awaiting Response' RETURNING id`,
            [p.groupId],
          );
          if (groupUpd.rowCount === 0) { await client.query("ROLLBACK"); continue; }
          stats.closedAt0 += 1;

          const claimsUpd = await client.query(
            `UPDATE claims
                SET status      = 'Resolved'::claim_status,
                    outcome     = 'No Action Needed'::claim_outcome,
                    disposition = 'duplicate'::claim_disposition
              WHERE invoice_group_id = $1 AND status::text = 'Awaiting Response'
              RETURNING id, status::text AS prev_status, outcome::text AS prev_outcome, disposition::text AS prev_disposition`,
            [p.groupId],
          );
          stats.closedClaims += claimsUpd.rowCount ?? 0;

          const respUpd = await client.query(
            `UPDATE portal_responses SET processed = true
              WHERE invoice_group_id = $1 AND processed = false RETURNING id`,
            [p.groupId],
          );
          stats.markedResponses += respUpd.rowCount ?? 0;

          const groupAuditMeta = {
            backfillId: BACKFILL_ID,
            from: "Awaiting Response", to: "Resolved",
            source: "oneshot:duplicate_cluster_resolver",
            invoiceNumber: p.invoiceNumber,
            ticketCount: p.ticketCount,
            satelliteTicketIds: p.tickets.map((t) => t.ticketId),
            satelliteSubmissionIds: p.tickets.map((t) => t.submissionId),
            reason:
              "Per-leg duplicate-submission backfill: all portal tickets for this group were closed by MAS as " +
              "duplicates (template: 'previous correction was submitted on M/D/YY'). MAS resolved upstream " +
              "without surfacing a verdict to us; group is closed at $0 (No Action Needed).",
          };
          await client.query(
            `INSERT INTO audit_logs (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
             VALUES (NULL, $1, 'group_status_changed', $2, $3::jsonb, $4, $5)`,
            [p.groupId,
              `Closed at $0 — all ${p.ticketCount} portal tickets closed by MAS as duplicates`,
              JSON.stringify(groupAuditMeta), ACTOR_EMAIL, ACTOR_NAME],
          );

          for (const c of (claimsUpd.rows ?? []) as Array<{ id: number; prev_status: string; prev_outcome: string; prev_disposition: string }>) {
            const legAuditMeta = {
              backfillId: BACKFILL_ID,
              from: c.prev_status, to: "Resolved",
              previousOutcome: c.prev_outcome, newOutcome: "No Action Needed",
              previousDisposition: c.prev_disposition, newDisposition: "duplicate",
              source: "oneshot:duplicate_cluster_resolver",
              cascadedFromGroupId: p.groupId,
            };
            await client.query(
              `INSERT INTO audit_logs (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
               VALUES ($1, $2, 'claim_status_changed', $3, $4::jsonb, $5, $6)`,
              [c.id, p.groupId, `All MAS tickets closed as duplicates; $0 No Action Needed`,
                JSON.stringify(legAuditMeta), ACTOR_EMAIL, ACTOR_NAME],
            );
          }
        } else {
          // all_closed_with_verdict → route to Ready to Review
          const groupUpd = await client.query(
            `UPDATE invoice_groups SET status = 'Ready to Review'::claim_status
              WHERE id = $1 AND status::text = 'Awaiting Response' RETURNING id`,
            [p.groupId],
          );
          if (groupUpd.rowCount === 0) { await client.query("ROLLBACK"); continue; }
          stats.routedToReview += 1;

          const meta = {
            backfillId: BACKFILL_ID,
            from: "Awaiting Response", to: "Ready to Review",
            source: "oneshot:duplicate_cluster_resolver",
            invoiceNumber: p.invoiceNumber,
            ticketCount: p.ticketCount,
            verdictCarrierSubmissionId: p.verdictCarrierSubmissionId,
            verdictCarrierTicketId: p.tickets.find((t) => t.submissionId === p.verdictCarrierSubmissionId)?.ticketId ?? null,
            verdictPreview: p.tickets.find((t) => t.submissionId === p.verdictCarrierSubmissionId)?.latestMessageBodyPreview ?? null,
            reason:
              "Per-leg duplicate-submission backfill: all portal tickets for this group are closed by MAS, " +
              "but at least one carries substantive (non-acknowledgment) content — likely the real verdict " +
              "landed on a now-closed ticket. Routed to operator review for manual verdict capture.",
          };
          await client.query(
            `INSERT INTO audit_logs (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
             VALUES (NULL, $1, 'group_status_changed', $2, $3::jsonb, $4, $5)`,
            [p.groupId,
              `Routed to Ready to Review — verdict found on closed ticket #${meta.verdictCarrierTicketId ?? "?"}`,
              JSON.stringify(meta), ACTOR_EMAIL, ACTOR_NAME],
          );
        }
        await client.query("COMMIT");
      } catch (err) { await client.query("ROLLBACK"); throw err; }
    }
  } finally { client.release(); }
  return stats;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const noScrape = process.argv.includes("--no-scrape");
  const multiOnly = process.argv.includes("--multi-only");
  const limitArgIdx = process.argv.indexOf("--limit");
  const limit = limitArgIdx >= 0 ? Number(process.argv[limitArgIdx + 1] ?? "0") : 0;
  const maxArgIdx = process.argv.indexOf("--max-tickets");
  const maxTickets = maxArgIdx >= 0 ? Number(process.argv[maxArgIdx + 1] ?? "0") : 0;
  const planOnly = process.argv.includes("--plan-only");

  const cache = noScrape ? new Map<number, ScrapedTicket>() : loadScrapeCache();
  console.log(`[oneshot] Mode: ${apply ? "APPLY" : "DRY RUN"} | scrape=${!noScrape} | multi-only=${multiOnly} | limit=${limit || "none"} | max-tickets=${maxTickets || "none"} | cache=${cache.size}`);

  const groups = await discoverGroups(multiOnly);
  let entries = Array.from(groups.entries());
  const totalSubs = entries.reduce((a, [, v]) => a + v.length, 0);
  console.log(`[oneshot] Discovered ${entries.length} 'Awaiting Response' group(s) carrying ${totalSubs} portal ticket(s).`);

  if (limit > 0) { entries = entries.slice(0, limit); console.log(`[oneshot] --limit ${limit} → processing first ${entries.length} group(s).`); }
  if (entries.length === 0) { console.log("[oneshot] Nothing to do. Exiting."); return; }

  const plans: GroupPlan[] = [];
  let scrapeIdx = 0;
  let freshScrapes = 0;
  let stoppedEarly = false;
  for (const [groupId, rows] of entries) {
    const tickets: ScrapedTicket[] = [];
    if (noScrape) {
      const inferred = await inferFromDb(rows.map((r) => r.submission_id));
      for (const r of rows) {
        const hit = inferred.get(r.submission_id);
        const phrase = hit?.body ? classifyByPhrase(hit.body) : null;
        tickets.push({
          groupId: r.group_id, submissionId: r.submission_id, ticketId: r.portal_ticket_id ?? "",
          invoiceNumber: r.invoice_number, livePortalStatus: hit?.status ?? null,
          latestMessageSignatureId: phrase?.selectedSignatureId ?? null,
          latestMessageOutcome: phrase?.outcome ?? "unknown",
          latestMessageBodyPreview: hit?.body?.slice(0, 160).replace(/\s+/g, " ") ?? "",
          scrapeError: null,
        });
      }
    } else {
      for (const r of rows) {
        scrapeIdx += 1;
        const cached = cache.get(r.submission_id);
        if (cached) {
          tickets.push(cached);
          continue;
        }
        if (planOnly) {
          // Skip un-cached tickets entirely — caller is just rebuilding the plan
          // from whatever's cached; don't burn a chrome session.
          continue;
        }
        if (maxTickets > 0 && freshScrapes >= maxTickets) {
          stoppedEarly = true;
          break;
        }
        if (freshScrapes > 0) await sleep(jitterMs());
        const t = await scrapeTicket(r);
        appendScrapeCache(t);
        freshScrapes += 1;
        tickets.push(t);
        const tag = t.scrapeError ? `ERROR ${t.scrapeError.slice(0, 60)}` : `status=${t.livePortalStatus ?? "?"} sig=${t.latestMessageSignatureId ?? "-"}`;
        console.log(`[oneshot]   #${scrapeIdx}/${totalSubs} (fresh ${freshScrapes}) group=${groupId} ticket=${r.portal_ticket_id} ${tag}`);
      }
      if (stoppedEarly) break;
    }
    if (tickets.length === rows.length) {
      const plan = bucketGroup(groupId, rows[0]?.invoice_number ?? null, tickets);
      plans.push(plan);
      if (!noScrape) console.log(`[oneshot] group=${groupId} bucket=${plan.bucket} (${plan.openTicketCount}/${plan.ticketCount} open)`);
    } else {
      // Incomplete cache coverage for this group — emit an explicit
      // `needs_scrape` plan so it never silently disappears from the
      // accountability matrix. Carries whichever tickets we did manage
      // to scrape so the operator can see partial progress.
      const synthetic = rows
        .filter((r) => !tickets.some((t) => t.submissionId === r.submission_id))
        .map<ScrapedTicket>((r) => ({
          groupId: r.group_id, submissionId: r.submission_id,
          ticketId: r.portal_ticket_id ?? "",
          invoiceNumber: r.invoice_number, livePortalStatus: null,
          latestMessageSignatureId: null, latestMessageOutcome: "unknown",
          latestMessageBodyPreview: "",
          scrapeError: "not yet scraped (cache miss)",
        }));
      const plan: GroupPlan = {
        groupId, invoiceNumber: rows[0]?.invoice_number ?? null,
        bucket: "needs_scrape", ticketCount: rows.length,
        openTicketCount: 0, verdictCarrierSubmissionId: null,
        tickets: [...tickets, ...synthetic],
      };
      plans.push(plan);
      if (!noScrape) console.log(`[oneshot] group=${groupId} bucket=needs_scrape (incomplete cache: ${tickets.length}/${rows.length} scraped)`);
    }
  }
  if (stoppedEarly) {
    console.log(`[oneshot] --max-tickets ${maxTickets} reached after ${freshScrapes} fresh scrape(s). Re-run to continue. Cache size: ${cache.size + freshScrapes}/${totalSubs}.`);
    return;
  }

  const summary = plans.reduce<Record<GroupBucket, number>>((a, p) => { a[p.bucket] = (a[p.bucket] ?? 0) + 1; return a; },
    { canonical_open: 0, all_closed_all_duplicates: 0, all_closed_with_verdict: 0, scrape_error: 0, needs_scrape: 0, synthetic_only: 0 });
  console.log("[oneshot] Group buckets:", summary);

  writePlanCsv(plans);
  console.log(`[oneshot] Plan written to ${PLAN_CSV_PATH}`);

  if (!apply) { console.log("[oneshot] Dry run complete. Re-run with --apply after reviewing the CSV."); return; }

  console.log("[oneshot] Applying...");
  const stats = await applyPlan(plans);
  console.log("[oneshot] Apply complete:", stats);
}

main().then(() => process.exit(0)).catch((err) => { console.error("[oneshot] Fatal error:", err); process.exit(1); });

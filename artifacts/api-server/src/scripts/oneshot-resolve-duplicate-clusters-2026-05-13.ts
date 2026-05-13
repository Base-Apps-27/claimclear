// One-shot resolver for the per-leg duplicate-submission cohort
// (2026-05-13).
//
// Background: the earliest dispute-submission flow filed one Freshdesk
// ticket PER LEG instead of per invoice. 1,182+ portal_submissions
// landed across 4-leg invoices, so a single MAS invoice number now
// has multiple `invoice_groups` rows, all stuck at status='Awaiting
// Response'. MAS itself replies with a real verdict on whichever
// ticket they treat as canonical and CLOSES the duplicate tickets
// with a "previous correction was submitted on M/D/YY" template
// message. That leaves the satellite groups inert in our system
// forever — they will never receive a real verdict because MAS
// already closed their ticket.
//
// What this script does:
//   1) DISCOVER: query the connected DB for every invoice_number
//      that has >1 invoice_group sitting at 'Awaiting Response'.
//      Each such invoice_number is a "duplicate cluster".
//   2) SCRAPE: for every portal_submission in every cluster, open
//      the Freshdesk ticket via `readPortalTicket` and capture its
//      live `status` (Open / Closed / etc.) plus the latest message
//      body. Pacing: 750–3000 ms jitter per ticket, mirroring the
//      established prod-portal sweep.
//   3) CLASSIFY: per cluster
//        - exactly 1 ticket still Open  → that group is the canonical;
//          the rest are satellites.
//        - 0 tickets still Open         → DEFER (write `deferred_no_canonical`
//          to the plan; operator triages manually).
//        - 2+ tickets still Open        → DEFER (write
//          `deferred_multiple_open`; operator picks one).
//   4) PLAN: write the full cluster + decision matrix to
//      `exports/duplicate-cluster-plan-2026-05-13.csv` for review.
//   5) APPLY (only with --apply): for every cluster classified as
//      `ready_to_resolve`, close each satellite group:
//        - invoice_groups.status      → 'Resolved'
//        - claims.status              → 'Resolved'
//          claims.outcome             → 'No Action Needed'
//          claims.disposition         → 'duplicate'
//        - portal_responses.processed → true (where false)
//        - audit row on group + each leg, action='group_status_changed'
//          and 'claim_status_changed', metadata.backfillId =
//          'duplicate_cluster_resolution_2026_05_13' and
//          metadata.canonicalGroupId pointing at the still-open sibling
//          (so the link is preserved without a schema migration).
//      The canonical group is left untouched — it stays at
//      'Awaiting Response' so the next real reply from MAS lands
//      normally.
//
// Idempotent: re-running re-discovers the same clusters; the apply
// path's UPDATE re-asserts the satellite predicate (status='Awaiting
// Response') so a partial re-run only touches rows that still drift.
//
// Run (against whichever DATABASE_URL is exported in the shell;
// typically PROD_DATABASE_URL):
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-resolve-duplicate-clusters-2026-05-13.ts \
//     [--apply] [--limit N] [--no-scrape]
//
// Flags:
//   --apply       Execute closures on satellites. Without this the
//                 script is dry-run: scrape + plan CSV only.
//   --limit N     Cap the number of clusters processed (handy for
//                 rehearsal). Applied AFTER discovery.
//   --no-scrape   Skip the live portal scrape and infer canonical /
//                 satellite from the most-recent portal_response per
//                 ticket already in the DB. Faster but only safe to
//                 use when you've already scraped recently.

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

interface ClusterSubmissionRow extends Record<string, unknown> {
  invoice_number: string;
  group_id: number;
  group_status: string;
  submission_id: number;
  portal_ticket_id: string | null;
  submitted_at: string | null;
}

interface ScrapedTicket {
  groupId: number;
  submissionId: number;
  ticketId: string;
  invoiceNumber: string;
  livePortalStatus: string | null;
  latestMessageSignatureId: string | null;
  latestMessageOutcome: string;
  scrapeError: string | null;
}

type ClusterDecision =
  | "ready_to_resolve"
  | "deferred_no_canonical"
  | "deferred_multiple_open"
  | "skipped_singleton";

interface ClusterPlan {
  invoiceNumber: string;
  decision: ClusterDecision;
  canonicalGroupId: number | null;
  satelliteGroupIds: number[];
  tickets: ScrapedTicket[];
}

function jitterMs(): number {
  return 750 + Math.floor(Math.random() * 2250);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOpenStatus(s: string | null): boolean {
  if (!s) return false;
  const lower = s.toLowerCase();
  // Freshdesk's "open" family of states. We treat anything NOT in the
  // closed/resolved family as still-open so a typo'd tenant-specific
  // status doesn't accidentally classify a live ticket as a satellite.
  return !(lower.includes("closed") || lower.includes("resolved"));
}

async function discoverClusters(): Promise<Map<string, ClusterSubmissionRow[]>> {
  const res = await db.execute<ClusterSubmissionRow>(sql`
    WITH dupes AS (
      SELECT ps.invoice_number
        FROM portal_submissions ps
        JOIN invoice_groups g ON g.id = ps.invoice_group_id
       WHERE g.status::text = 'Awaiting Response'
         AND ps.invoice_number IS NOT NULL
       GROUP BY ps.invoice_number
      HAVING COUNT(DISTINCT g.id) > 1
    )
    SELECT ps.invoice_number,
           g.id                     AS group_id,
           g.status::text           AS group_status,
           ps.id                    AS submission_id,
           ps.portal_ticket_id,
           ps.submitted_at::text    AS submitted_at
      FROM portal_submissions ps
      JOIN invoice_groups g ON g.id = ps.invoice_group_id
      JOIN dupes d         ON d.invoice_number = ps.invoice_number
     WHERE g.status::text = 'Awaiting Response'
       AND ps.portal_ticket_id IS NOT NULL
     ORDER BY ps.invoice_number, ps.submitted_at NULLS LAST, ps.id;
  `);
  const rows = (res.rows ?? []) as ClusterSubmissionRow[];
  const clusters = new Map<string, ClusterSubmissionRow[]>();
  for (const row of rows) {
    const arr = clusters.get(row.invoice_number) ?? [];
    arr.push(row);
    clusters.set(row.invoice_number, arr);
  }
  return clusters;
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

async function scrapeTicket(row: ClusterSubmissionRow): Promise<ScrapedTicket> {
  const ticketId = row.portal_ticket_id!;
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
      scrapeError: null,
    };
  } catch (err) {
    return {
      groupId: row.group_id,
      submissionId: row.submission_id,
      ticketId,
      invoiceNumber: row.invoice_number,
      livePortalStatus: null,
      latestMessageSignatureId: null,
      latestMessageOutcome: "unknown",
      scrapeError: err instanceof Error ? err.message : String(err),
    };
  }
}

function classifyCluster(invoiceNumber: string, tickets: ScrapedTicket[]): ClusterPlan {
  if (tickets.length < 2) {
    return { invoiceNumber, decision: "skipped_singleton", canonicalGroupId: null, satelliteGroupIds: [], tickets };
  }
  const openTickets = tickets.filter((t) => isOpenStatus(t.livePortalStatus));
  if (openTickets.length === 0) {
    return { invoiceNumber, decision: "deferred_no_canonical", canonicalGroupId: null, satelliteGroupIds: [], tickets };
  }
  if (openTickets.length > 1) {
    return { invoiceNumber, decision: "deferred_multiple_open", canonicalGroupId: null, satelliteGroupIds: [], tickets };
  }
  const canonical = openTickets[0]!;
  const satellites = tickets.filter((t) => t.groupId !== canonical.groupId).map((t) => t.groupId);
  return {
    invoiceNumber,
    decision: "ready_to_resolve",
    canonicalGroupId: canonical.groupId,
    satelliteGroupIds: satellites,
    tickets,
  };
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writePlanCsv(plans: ClusterPlan[]): void {
  const dir = path.dirname(PLAN_CSV_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const header = [
    "invoice_number", "decision", "canonical_group_id", "group_id", "submission_id", "portal_ticket_id",
    "live_portal_status", "latest_message_signature", "latest_message_outcome", "is_canonical", "scrape_error",
  ].join(",");
  const lines = [header];
  for (const p of plans) {
    for (const t of p.tickets) {
      lines.push([
        p.invoiceNumber, p.decision, p.canonicalGroupId ?? "", t.groupId, t.submissionId, t.ticketId,
        t.livePortalStatus ?? "", t.latestMessageSignatureId ?? "", t.latestMessageOutcome,
        p.canonicalGroupId === t.groupId ? "yes" : "no", t.scrapeError ?? "",
      ].map(csvEscape).join(","));
    }
  }
  fs.writeFileSync(PLAN_CSV_PATH, lines.join("\n") + "\n", "utf8");
}

async function applyPlan(plans: ClusterPlan[]): Promise<{ closedGroups: number; closedClaims: number; markedResponses: number }> {
  let closedGroups = 0, closedClaims = 0, markedResponses = 0;
  const client = await pool.connect();
  try {
    for (const p of plans) {
      if (p.decision !== "ready_to_resolve" || p.canonicalGroupId === null) continue;
      for (const satGroupId of p.satelliteGroupIds) {
        await client.query("BEGIN");
        try {
          const groupUpd = await client.query(
            `UPDATE invoice_groups
                SET status = 'Resolved'::claim_status
              WHERE id = $1 AND status::text = 'Awaiting Response'
              RETURNING id, status::text AS old_status`,
            [satGroupId],
          );
          if (groupUpd.rowCount === 0) {
            await client.query("ROLLBACK");
            continue;
          }
          closedGroups += 1;

          const claimsUpd = await client.query(
            `UPDATE claims
                SET status      = 'Resolved'::claim_status,
                    outcome     = 'No Action Needed'::claim_outcome,
                    disposition = 'duplicate'::claim_disposition
              WHERE invoice_group_id = $1
                AND status::text = 'Awaiting Response'
              RETURNING id, status::text AS prev_status, outcome::text AS prev_outcome, disposition::text AS prev_disposition`,
            [satGroupId],
          );
          closedClaims += claimsUpd.rowCount ?? 0;

          const respUpd = await client.query(
            `UPDATE portal_responses
                SET processed = true
              WHERE invoice_group_id = $1
                AND processed = false
              RETURNING id`,
            [satGroupId],
          );
          markedResponses += respUpd.rowCount ?? 0;

          const groupAuditMeta = {
            backfillId: BACKFILL_ID,
            from: "Awaiting Response",
            to: "Resolved",
            source: "oneshot:duplicate_cluster_resolver",
            canonicalGroupId: p.canonicalGroupId,
            invoiceNumber: p.invoiceNumber,
            reason:
              "Per-leg duplicate-submission backfill: MAS already closed this ticket as a duplicate of the canonical group. " +
              "Real verdict will land on the canonical group; this satellite is closed at $0 (No Action Needed).",
          };
          await client.query(
            `INSERT INTO audit_logs
               (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
             VALUES
               (NULL, $1, 'group_status_changed', $2, $3::jsonb, $4, $5)`,
            [
              satGroupId,
              `Closed as duplicate of group #${p.canonicalGroupId} (invoice ${p.invoiceNumber})`,
              JSON.stringify(groupAuditMeta),
              ACTOR_EMAIL,
              ACTOR_NAME,
            ],
          );

          for (const c of (claimsUpd.rows ?? []) as Array<{ id: number; prev_status: string; prev_outcome: string; prev_disposition: string }>) {
            const legAuditMeta = {
              backfillId: BACKFILL_ID,
              from: c.prev_status,
              to: "Resolved",
              previousOutcome: c.prev_outcome,
              newOutcome: "No Action Needed",
              previousDisposition: c.prev_disposition,
              newDisposition: "duplicate",
              source: "oneshot:duplicate_cluster_resolver",
              cascadedFromGroupId: satGroupId,
              canonicalGroupId: p.canonicalGroupId,
            };
            await client.query(
              `INSERT INTO audit_logs
                 (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
               VALUES
                 ($1, $2, 'claim_status_changed', $3, $4::jsonb, $5, $6)`,
              [
                c.id,
                satGroupId,
                `Marked duplicate-of-canonical (group #${p.canonicalGroupId}); $0 No Action Needed`,
                JSON.stringify(legAuditMeta),
                ACTOR_EMAIL,
                ACTOR_NAME,
              ],
            );
          }

          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      }
    }
  } finally {
    client.release();
  }
  return { closedGroups, closedClaims, markedResponses };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const noScrape = process.argv.includes("--no-scrape");
  const limitArgIdx = process.argv.indexOf("--limit");
  const limit = limitArgIdx >= 0 ? Number(process.argv[limitArgIdx + 1] ?? "0") : 0;

  console.log(`[oneshot] Mode: ${apply ? "APPLY" : "DRY RUN"} | scrape=${!noScrape} | limit=${limit || "none"}`);

  const clusters = await discoverClusters();
  let entries = Array.from(clusters.entries());
  console.log(`[oneshot] Discovered ${entries.length} duplicate cluster(s) across ${entries.reduce((a, [, v]) => a + v.length, 0)} submission(s).`);

  if (limit > 0) {
    entries = entries.slice(0, limit);
    console.log(`[oneshot] --limit ${limit} → processing first ${entries.length} cluster(s).`);
  }

  if (entries.length === 0) {
    console.log("[oneshot] No duplicate clusters found. Exiting.");
    return;
  }

  const plans: ClusterPlan[] = [];
  let scrapeIdx = 0;
  for (const [invoiceNumber, rows] of entries) {
    const tickets: ScrapedTicket[] = [];
    if (noScrape) {
      const inferred = await inferFromDb(rows.map((r) => r.submission_id));
      for (const r of rows) {
        const hit = inferred.get(r.submission_id);
        const phrase = hit?.body ? classifyByPhrase(hit.body) : null;
        tickets.push({
          groupId: r.group_id,
          submissionId: r.submission_id,
          ticketId: r.portal_ticket_id ?? "",
          invoiceNumber,
          livePortalStatus: hit?.status ?? null,
          latestMessageSignatureId: phrase?.selectedSignatureId ?? null,
          latestMessageOutcome: phrase?.outcome ?? "unknown",
          scrapeError: null,
        });
      }
    } else {
      for (const r of rows) {
        if (scrapeIdx > 0) await sleep(jitterMs());
        scrapeIdx += 1;
        const t = await scrapeTicket(r);
        tickets.push(t);
        const tag = t.scrapeError ? `ERROR ${t.scrapeError.slice(0, 60)}` : `status=${t.livePortalStatus ?? "?"} sig=${t.latestMessageSignatureId ?? "-"}`;
        console.log(`[oneshot]   scraped ${scrapeIdx}: invoice=${invoiceNumber} group=${r.group_id} ticket=${r.portal_ticket_id} ${tag}`);
      }
    }
    plans.push(classifyCluster(invoiceNumber, tickets));
  }

  const summary = plans.reduce<Record<ClusterDecision, number>>((a, p) => { a[p.decision] = (a[p.decision] ?? 0) + 1; return a; }, {
    ready_to_resolve: 0, deferred_no_canonical: 0, deferred_multiple_open: 0, skipped_singleton: 0,
  });
  const satelliteCount = plans.reduce((a, p) => a + p.satelliteGroupIds.length, 0);
  console.log("[oneshot] Cluster decisions:", summary, `| satellites_to_close=${satelliteCount}`);

  writePlanCsv(plans);
  console.log(`[oneshot] Plan written to ${PLAN_CSV_PATH}`);

  if (!apply) {
    console.log("[oneshot] Dry run complete. Re-run with --apply after reviewing the CSV to execute satellite closures.");
    return;
  }

  console.log("[oneshot] Applying satellite closures...");
  const stats = await applyPlan(plans);
  console.log("[oneshot] Apply complete:", stats);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[oneshot] Fatal error:", err);
    process.exit(1);
  });

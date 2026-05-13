// Review report for the 83 invoice_groups that the duplicate-cluster
// resolver (backfillId='duplicate_cluster_resolution_2026_05_13') routed
// from 'Awaiting Response' → 'Ready to Review'.
//
// Why this exists: the post-hoc objection in the write-up was "some of
// those routed groups have reattest_required=true, so the closed-ticket
// 'verdict' I read may just be MAS confirming the operator's own
// cancellation." That heuristic almost certainly throws away real
// verdicts too. This script produces a per-group review packet so a
// human can decide group-by-group BEFORE anything is reversed.
//
// Output:
//   exports/duplicate-cluster-routed-review-2026-05-13.csv
//     One row per group with the columns most useful for spreadsheet
//     triage (verdict-carrier ticket id, reattest flag + when set, full
//     last-message body re-scraped live, suggested classification).
//   exports/duplicate-cluster-routed-review-2026-05-13.json
//     Full per-group payload including every sibling ticket's live state
//     and last message, every relevant audit row, and existing
//     portal_responses on the group. Use this when a CSV cell isn't
//     enough.
//
// Run (against PROD_DATABASE_URL):
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/review-duplicate-cluster-routed-to-review-2026-05-13.ts \
//     [--limit N] [--no-rescrape] [--max-tickets N]
//
// Read-only: this script never writes to the DB.

import * as fs from "node:fs";
import * as path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { readPortalTicket } from "../bot/portal-reader";
import { classifyByPhrase } from "../lib/email-phrase-classifier";

const BACKFILL_ID = "duplicate_cluster_resolution_2026_05_13";
const OUT_CSV = path.resolve(process.cwd(), "exports", "duplicate-cluster-routed-review-2026-05-13.csv");
const OUT_JSON = path.resolve(process.cwd(), "exports", "duplicate-cluster-routed-review-2026-05-13.json");

// Resumable rescrape cache so chunked runs make progress per-call.
const RESCRAPE_CACHE = path.resolve(
  process.cwd(),
  "exports",
  "duplicate-cluster-routed-review-rescrape-cache-2026-05-13.jsonl",
);

interface RoutingAuditRow extends Record<string, unknown> {
  group_id: number;
  routed_at: string;
  metadata: Record<string, unknown> | null;
}

interface GroupRow extends Record<string, unknown> {
  id: number;
  invoice_number: string;
  status: string;
  phase: string;
  reattest_required: boolean;
  reattest_completed_at: string | null;
  reattest_completed_by: string | null;
  reattest_note: string | null;
  error_type_name: string | null;
}

interface SubmissionRow extends Record<string, unknown> {
  submission_id: number;
  portal_ticket_id: string | null;
  submitted_at: string | null;
}

interface PortalResponseRow extends Record<string, unknown> {
  id: number;
  submission_id: number | null;
  created_at: string;
  processed: boolean;
  content: string | null;
  metadata: Record<string, unknown> | null;
}

interface ReattestAuditRow extends Record<string, unknown> {
  id: number;
  ts: string;
  action: string;
  details: string;
  user_email: string | null;
  metadata: Record<string, unknown> | null;
}

interface RescrapeRow {
  ticketId: string;
  livePortalStatus: string | null;
  latestMessageOutcome: string;
  latestMessageBody: string;
  latestMessagePostedAt: string | null;
  latestMessageAuthor: string | null;
  scrapeError: string | null;
}

function jitterMs(): number { return 750 + Math.floor(Math.random() * 2250); }
async function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

function loadRescrapeCache(): Map<string, RescrapeRow> {
  const out = new Map<string, RescrapeRow>();
  if (!fs.existsSync(RESCRAPE_CACHE)) return out;
  for (const line of fs.readFileSync(RESCRAPE_CACHE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as RescrapeRow;
      if (r.scrapeError) continue;
      out.set(r.ticketId, r);
    } catch { /* skip malformed */ }
  }
  return out;
}

function appendRescrapeCache(r: RescrapeRow): void {
  const dir = path.dirname(RESCRAPE_CACHE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(RESCRAPE_CACHE, JSON.stringify(r) + "\n", "utf8");
}

async function rescrapeTicket(ticketId: string): Promise<RescrapeRow> {
  if (!/^\d+$/.test(ticketId)) {
    return {
      ticketId, livePortalStatus: "synthetic", latestMessageOutcome: "synthetic",
      latestMessageBody: "", latestMessagePostedAt: null, latestMessageAuthor: null,
      scrapeError: null,
    };
  }
  try {
    const parsed = await readPortalTicket(ticketId);
    const last = parsed.messages.at(-1);
    const phrase = last ? classifyByPhrase(last.bodyText) : null;
    return {
      ticketId,
      livePortalStatus: parsed.status,
      latestMessageOutcome: phrase?.outcome ?? "unknown",
      latestMessageBody: last?.bodyText ?? "",
      latestMessagePostedAt: last?.postedAt ?? null,
      latestMessageAuthor: last?.authorName ?? null,
      scrapeError: null,
    };
  } catch (err) {
    return {
      ticketId, livePortalStatus: null, latestMessageOutcome: "unknown",
      latestMessageBody: "", latestMessagePostedAt: null, latestMessageAuthor: null,
      scrapeError: err instanceof Error ? err.message : String(err),
    };
  }
}

// Heuristic for the CSV's `suggested_class` column. Intentionally
// conservative — anything ambiguous routes to `mixed_or_unclear` so a
// human looks at it. The full body is in the JSON sidecar.
function suggestClass(body: string, outcome: string, status: string | null): "looks_like_real_verdict" | "looks_like_cancellation_only" | "mixed_or_unclear" {
  const lower = body.toLowerCase();
  const cancellationSignals = [
    "cancel", "withdrawn", "withdraw", "rescind", "rescinded",
    "closed by requester", "closed at requester", "closed per requester",
    "request to close", "no longer needed", "no further action",
  ];
  const verdictSignals = [
    "approved", "denied", "deny", "rejected", "rejection",
    "additional information", "more information needed",
    "supporting documentation", "please provide",
    "$", "amount", "payment", "reimburs",
    "fault", "responsibility", "deviation",
  ];
  const hasCancellation = cancellationSignals.some((s) => lower.includes(s));
  const hasVerdict = verdictSignals.some((s) => lower.includes(s));
  if (outcome === "acknowledgment") return "mixed_or_unclear";
  if (hasVerdict && !hasCancellation) return "looks_like_real_verdict";
  if (hasCancellation && !hasVerdict) return "looks_like_cancellation_only";
  return "mixed_or_unclear";
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  const noRescrape = process.argv.includes("--no-rescrape");
  const limitIdx = process.argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1] ?? "0") : 0;
  const maxIdx = process.argv.indexOf("--max-tickets");
  const maxTickets = maxIdx >= 0 ? Number(process.argv[maxIdx + 1] ?? "0") : 0;

  // 1) Pull every routing audit row this backfill produced.
  const routingRes = await db.execute<RoutingAuditRow>(sql`
    SELECT al.invoice_group_id AS group_id,
           al.timestamp::text  AS routed_at,
           al.metadata
      FROM audit_logs al
     WHERE al.action = 'group_status_changed'
       AND al.metadata->>'backfillId' = ${BACKFILL_ID}
       AND al.metadata->>'to'         = 'Ready to Review'
     ORDER BY al.invoice_group_id;
  `);
  const routing = (routingRes.rows ?? []) as RoutingAuditRow[];
  console.log(`[review] Found ${routing.length} groups routed to Ready to Review by ${BACKFILL_ID}.`);
  const groupIds = routing.map((r) => r.group_id);
  const trimmed = limit > 0 ? groupIds.slice(0, limit) : groupIds;

  if (trimmed.length === 0) {
    console.log("[review] Nothing to review. Exiting.");
    return;
  }

  // 2) Hydrate group state, submissions, portal_responses, reattest audit history.
  const idArr = sql.raw(`ARRAY[${trimmed.join(",")}]::int[]`);

  const groupsRes = await db.execute<GroupRow>(sql`
    SELECT id, invoice_number, status::text AS status, phase::text AS phase,
           reattest_required,
           reattest_completed_at::text AS reattest_completed_at,
           reattest_completed_by, reattest_note,
           error_type_name
      FROM invoice_groups WHERE id = ANY(${idArr});
  `);
  const groupById = new Map<number, GroupRow>();
  for (const g of (groupsRes.rows ?? []) as GroupRow[]) groupById.set(g.id, g);

  const subsRes = await db.execute<SubmissionRow & { invoice_group_id: number }>(sql`
    SELECT invoice_group_id, id AS submission_id, portal_ticket_id, submitted_at::text AS submitted_at
      FROM portal_submissions
     WHERE invoice_group_id = ANY(${idArr})
       AND portal_ticket_id IS NOT NULL
     ORDER BY invoice_group_id, submitted_at NULLS LAST, id;
  `);
  const subsByGroup = new Map<number, SubmissionRow[]>();
  for (const r of (subsRes.rows ?? []) as Array<SubmissionRow & { invoice_group_id: number }>) {
    const arr = subsByGroup.get(r.invoice_group_id) ?? [];
    arr.push({ submission_id: r.submission_id, portal_ticket_id: r.portal_ticket_id, submitted_at: r.submitted_at });
    subsByGroup.set(r.invoice_group_id, arr);
  }

  const respRes = await db.execute<PortalResponseRow & { invoice_group_id: number }>(sql`
    SELECT invoice_group_id, id, submission_id, created_at::text AS created_at,
           processed, content, metadata
      FROM portal_responses
     WHERE invoice_group_id = ANY(${idArr})
     ORDER BY invoice_group_id, created_at DESC NULLS LAST, id DESC;
  `);
  const respByGroup = new Map<number, PortalResponseRow[]>();
  for (const r of (respRes.rows ?? []) as Array<PortalResponseRow & { invoice_group_id: number }>) {
    const arr = respByGroup.get(r.invoice_group_id) ?? [];
    arr.push(r);
    respByGroup.set(r.invoice_group_id, arr);
  }

  // Reattest audit context: any audit row on the group whose action or
  // details mentions reattest, OR whose metadata sets reattest_required.
  // This lets a human see WHEN reattest_required=true was stamped and
  // by whom, which is the central question for the "is the closed
  // ticket really just a cancellation confirmation?" call.
  const reattestRes = await db.execute<ReattestAuditRow & { invoice_group_id: number }>(sql`
    SELECT invoice_group_id, id, timestamp::text AS ts, action, details,
           user_email, metadata
      FROM audit_logs
     WHERE invoice_group_id = ANY(${idArr})
       AND ( action ILIKE '%reattest%'
          OR details ILIKE '%reattest%'
          OR action ILIKE '%cancel%'
          OR details ILIKE '%cancel%'
          OR details ILIKE '%withdraw%' )
     ORDER BY invoice_group_id, timestamp;
  `);
  const reattestByGroup = new Map<number, ReattestAuditRow[]>();
  for (const r of (reattestRes.rows ?? []) as Array<ReattestAuditRow & { invoice_group_id: number }>) {
    const arr = reattestByGroup.get(r.invoice_group_id) ?? [];
    arr.push(r);
    reattestByGroup.set(r.invoice_group_id, arr);
  }

  // Per-leg snapshot — a group routed to "Ready to Review" might have
  // child legs in disparate states. The status/outcome/disposition tuple
  // per leg is the strongest signal that a real verdict was already
  // captured at the leg level vs. nothing happened beyond cancellation.
  interface ClaimSnapshotRow extends Record<string, unknown> {
    invoice_group_id: number;
    id: number;
    status: string;
    outcome: string;
    disposition: string | null;
    attestation_state: string | null;
  }
  const claimsRes = await db.execute<ClaimSnapshotRow>(sql`
    SELECT invoice_group_id, id,
           status::text       AS status,
           outcome::text      AS outcome,
           disposition::text  AS disposition,
           attestation_state::text AS attestation_state
      FROM claims
     WHERE invoice_group_id = ANY(${idArr})
     ORDER BY invoice_group_id, id;
  `);
  const claimsByGroup = new Map<number, ClaimSnapshotRow[]>();
  for (const r of (claimsRes.rows ?? []) as ClaimSnapshotRow[]) {
    const arr = claimsByGroup.get(r.invoice_group_id) ?? [];
    arr.push(r);
    claimsByGroup.set(r.invoice_group_id, arr);
  }

  // 3) Rescrape every verdict-carrier ticket (and every sibling, so the
  // JSON sidecar shows the full cluster picture). Cached on disk.
  const cache = noRescrape ? new Map<string, RescrapeRow>() : loadRescrapeCache();
  const allTicketIds = new Set<string>();
  for (const subs of subsByGroup.values()) {
    for (const s of subs) if (s.portal_ticket_id) allTicketIds.add(s.portal_ticket_id);
  }
  const toScrape = Array.from(allTicketIds).filter((tid) => !cache.has(tid));
  console.log(`[review] Tickets total=${allTicketIds.size} cached=${cache.size} to-scrape=${toScrape.length} (rescrape=${!noRescrape})`);
  let scraped = 0;
  if (!noRescrape) {
    for (const tid of toScrape) {
      if (maxTickets > 0 && scraped >= maxTickets) {
        console.log(`[review] Hit --max-tickets=${maxTickets}; deferring remaining scrapes to next run.`);
        break;
      }
      const row = await rescrapeTicket(tid);
      appendRescrapeCache(row);
      cache.set(tid, row);
      scraped += 1;
      if (/^\d+$/.test(tid)) await sleep(jitterMs());
      if (scraped % 25 === 0) console.log(`[review]   scraped ${scraped}/${toScrape.length}`);
    }
  }

  // 4) Build review packets.
  interface Packet {
    group_id: number;
    invoice_number: string | null;
    current_status: string;
    current_phase: string;
    reattest_required: boolean;
    reattest_completed_at: string | null;
    reattest_completed_by: string | null;
    reattest_note: string | null;
    error_type_name: string | null;
    routed_at: string;
    routed_by: string | null;
    verdict_carrier_ticket_id: string | null;
    verdict_carrier_submission_id: number | null;
    verdict_carrier_live_status: string | null;
    verdict_carrier_outcome: string;
    verdict_carrier_body: string;
    verdict_carrier_message_posted_at: string | null;
    verdict_carrier_message_author: string | null;
    sibling_ticket_count: number;
    open_ticket_count: number;
    closed_ticket_count: number;
    has_existing_portal_response: boolean;
    reattest_audit_count: number;
    earliest_reattest_audit_ts: string | null;
    earliest_reattest_audit_action: string | null;
    latest_reattest_audit_ts: string | null;
    latest_reattest_audit_action: string | null;
    leg_count: number;
    leg_status_summary: string;
    leg_outcome_summary: string;
    has_resolved_leg_with_outcome: boolean;
    suggested_class: "looks_like_real_verdict" | "looks_like_cancellation_only" | "mixed_or_unclear";
    sibling_tickets: Array<{ ticket_id: string; submission_id: number; live_status: string | null; outcome: string; body_preview: string; posted_at: string | null; author: string | null }>;
    legs: Array<{ id: number; status: string; outcome: string; disposition: string | null; attestation_state: string | null }>;
    portal_responses: PortalResponseRow[];
    reattest_audit_log: ReattestAuditRow[];
  }
  const packets: Packet[] = [];

  for (const r of routing) {
    if (limit > 0 && packets.length >= limit) break;
    const meta = r.metadata ?? {};
    const carrierTicketId = (meta as Record<string, unknown>).verdictCarrierTicketId as string | null ?? null;
    const carrierSubId = (meta as Record<string, unknown>).verdictCarrierSubmissionId as number | null ?? null;
    const g = groupById.get(r.group_id);
    const subs = subsByGroup.get(r.group_id) ?? [];
    const liveStates = subs.map((s) => cache.get(s.portal_ticket_id ?? ""));
    const open = liveStates.filter((s) => s && s.livePortalStatus && !/closed|resolved/i.test(s.livePortalStatus) && s.livePortalStatus !== "synthetic").length;
    const closed = liveStates.filter((s) => s && s.livePortalStatus && /closed|resolved/i.test(s.livePortalStatus)).length;
    const carrier = carrierTicketId ? cache.get(carrierTicketId) : undefined;
    const body = carrier?.latestMessageBody ?? "";
    const outcome = carrier?.latestMessageOutcome ?? "unknown";
    const liveStatus = carrier?.livePortalStatus ?? null;
    const reattestRows = reattestByGroup.get(r.group_id) ?? [];
    const portalResponses = respByGroup.get(r.group_id) ?? [];
    const legs = claimsByGroup.get(r.group_id) ?? [];

    const statusCounts: Record<string, number> = {};
    const outcomeCounts: Record<string, number> = {};
    for (const l of legs) {
      statusCounts[l.status] = (statusCounts[l.status] ?? 0) + 1;
      outcomeCounts[l.outcome] = (outcomeCounts[l.outcome] ?? 0) + 1;
    }
    const summarize = (m: Record<string, number>): string =>
      Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}:${v}`).join("|");

    packets.push({
      group_id: r.group_id,
      invoice_number: g?.invoice_number ?? null,
      current_status: g?.status ?? "?",
      current_phase: g?.phase ?? "?",
      reattest_required: g?.reattest_required ?? false,
      reattest_completed_at: g?.reattest_completed_at ?? null,
      reattest_completed_by: g?.reattest_completed_by ?? null,
      reattest_note: g?.reattest_note ?? null,
      error_type_name: g?.error_type_name ?? null,
      routed_at: r.routed_at,
      routed_by: ((meta as Record<string, unknown>).source as string) ?? null,
      verdict_carrier_ticket_id: carrierTicketId,
      verdict_carrier_submission_id: carrierSubId,
      verdict_carrier_live_status: liveStatus,
      verdict_carrier_outcome: outcome,
      verdict_carrier_body: body,
      verdict_carrier_message_posted_at: carrier?.latestMessagePostedAt ?? null,
      verdict_carrier_message_author: carrier?.latestMessageAuthor ?? null,
      sibling_ticket_count: subs.length,
      open_ticket_count: open,
      closed_ticket_count: closed,
      has_existing_portal_response: portalResponses.some((p) => !((p.metadata as Record<string, unknown> | null)?.synthetic === true)),
      reattest_audit_count: reattestRows.length,
      earliest_reattest_audit_ts: reattestRows[0]?.ts ?? null,
      earliest_reattest_audit_action: reattestRows[0]?.action ?? null,
      latest_reattest_audit_ts: reattestRows.at(-1)?.ts ?? null,
      latest_reattest_audit_action: reattestRows.at(-1)?.action ?? null,
      leg_count: legs.length,
      leg_status_summary: summarize(statusCounts),
      leg_outcome_summary: summarize(outcomeCounts),
      has_resolved_leg_with_outcome: legs.some((l) => l.status === "Resolved" && l.outcome !== "Pending"),
      suggested_class: suggestClass(body, outcome, liveStatus),
      sibling_tickets: subs.map((s) => {
        const c = cache.get(s.portal_ticket_id ?? "");
        return {
          ticket_id: s.portal_ticket_id ?? "",
          submission_id: s.submission_id,
          live_status: c?.livePortalStatus ?? null,
          outcome: c?.latestMessageOutcome ?? "unknown",
          body_preview: (c?.latestMessageBody ?? "").slice(0, 240).replace(/\s+/g, " "),
          posted_at: c?.latestMessagePostedAt ?? null,
          author: c?.latestMessageAuthor ?? null,
        };
      }),
      legs: legs.map((l) => ({
        id: l.id, status: l.status, outcome: l.outcome,
        disposition: l.disposition, attestation_state: l.attestation_state,
      })),
      portal_responses: portalResponses,
      reattest_audit_log: reattestRows,
    });
  }

  // 5) Emit CSV + JSON.
  const dir = path.dirname(OUT_CSV);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const header = [
    "group_id", "invoice_number", "suggested_class",
    "reattest_required", "reattest_completed_at", "reattest_completed_by", "reattest_note",
    "current_status", "current_phase", "error_type_name",
    "verdict_carrier_ticket_id", "verdict_carrier_live_status", "verdict_carrier_outcome",
    "verdict_carrier_message_posted_at", "verdict_carrier_message_author",
    "sibling_ticket_count", "open_ticket_count", "closed_ticket_count",
    "has_existing_portal_response", "reattest_audit_count",
    "earliest_reattest_audit_ts", "earliest_reattest_audit_action",
    "latest_reattest_audit_ts", "latest_reattest_audit_action",
    "leg_count", "leg_status_summary", "leg_outcome_summary", "has_resolved_leg_with_outcome",
    "routed_at", "verdict_carrier_body",
  ].join(",");
  const rows = [header];
  for (const p of packets) {
    rows.push([
      p.group_id, p.invoice_number ?? "", p.suggested_class,
      p.reattest_required, p.reattest_completed_at ?? "", p.reattest_completed_by ?? "", p.reattest_note ?? "",
      p.current_status, p.current_phase, p.error_type_name ?? "",
      p.verdict_carrier_ticket_id ?? "", p.verdict_carrier_live_status ?? "", p.verdict_carrier_outcome,
      p.verdict_carrier_message_posted_at ?? "", p.verdict_carrier_message_author ?? "",
      p.sibling_ticket_count, p.open_ticket_count, p.closed_ticket_count,
      p.has_existing_portal_response, p.reattest_audit_count,
      p.earliest_reattest_audit_ts ?? "", p.earliest_reattest_audit_action ?? "",
      p.latest_reattest_audit_ts ?? "", p.latest_reattest_audit_action ?? "",
      p.leg_count, p.leg_status_summary, p.leg_outcome_summary, p.has_resolved_leg_with_outcome,
      p.routed_at, p.verdict_carrier_body.replace(/\s+/g, " "),
    ].map(csvEscape).join(","));
  }
  fs.writeFileSync(OUT_CSV, rows.join("\n") + "\n", "utf8");
  fs.writeFileSync(OUT_JSON, JSON.stringify(packets, null, 2), "utf8");

  // Summary table to stdout.
  const counts: Record<string, number> = {};
  for (const p of packets) counts[p.suggested_class] = (counts[p.suggested_class] ?? 0) + 1;
  console.log(`[review] Wrote ${packets.length} packet(s).`);
  console.log(`[review] CSV : ${OUT_CSV}`);
  console.log(`[review] JSON: ${OUT_JSON}`);
  console.log(`[review] Suggested-class breakdown:`, counts);
  const reattestTrue = packets.filter((p) => p.reattest_required).length;
  console.log(`[review] reattest_required=true on ${reattestTrue}/${packets.length} groups.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[review] FAILED:", err);
  process.exit(1);
});

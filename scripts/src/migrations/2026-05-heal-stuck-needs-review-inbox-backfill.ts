// One-shot backfill for Task #299: heal invoice groups whose status got
// stuck in `Needs Review` or `Ready to Review` after the Tasks #283/#284
// reclassification backfills demoted their email responses to
// `acknowledgment`. Those groups now have no reviewable response on file
// (just acknowledgments / abstains / nothing) but were left in a stuck
// status because the prior reclassifier's strict safety checks refused
// to silently revert. They render as blank "Response details unavailable"
// rows in the Stage 2 inbox.
//
// What this script does
// ---------------------
//   1. Selects every invoice group currently in `Needs Review` or
//      `Ready to Review`.
//   2. Skips groups that have at least one reviewable portal_response on
//      file (`approval`, `denial`, `partial_approval`, `info_request`,
//      `other`) linked directly via `invoice_group_id`. These belong in
//      the inbox — there is something for staff to triage. The set of
//      reviewable types matches `pickLatestReviewableResponse` in
//      artifacts/claimclear/src/components/queue-response-review-panel.tsx.
//   3. For each remaining (stuck) group, walks its `audit_logs`
//      (`action='group_status_changed'`) backward from now and looks at
//      the `from` field on each row — that is the status the group held
//      *before* the transition. The most recent `from` value that is in
//      the manual-revert target set
//        { Awaiting Response, Needs Evidence, On Hold, New }
//      is the chosen target. If no such value exists (e.g. the only
//      prior statuses are system-controlled like `Generating Email` /
//      `Portal Queued`, or the group has no group_status_changed audit
//      rows at all), the script defaults to `Awaiting Response`.
//   4. Calls `transitionGroupStatus({ systemOverride: true, ... })` to
//      flip the status. The shared helper writes the standard
//      `group_status_changed` audit row + status-change note + cascades
//      to disputed children, exactly the same way an operator-driven
//      revert would.
//   5. Writes a SEPARATE `audit_logs` row tagged
//      `action='inbox_heal_applied'` with rich metadata for traceability:
//      the chosen prior status, the chosen target, the count of
//      portal_responses considered (broken down by responseType), the
//      list of response ids (capped for size safety), the source string,
//      and the registered `backfillId`. This row appears on the group's
//      audit timeline so staff can see why the group moved.
//   6. Inserts a short group note pointing at the heal so reviewers can
//      see "Stuck Inbox Heal: reverted to <target> — see audit entry".
//
// Idempotency
// -----------
//   Step 1's filter is on the CURRENT status. Once a group has been
//   healed (status moved out of `Needs Review` / `Ready to Review`), it
//   no longer matches and a re-run reports 0 candidates.
//
// Flags
// -----
//   --apply               actually write changes (default = dry-run)
//   --limit N             cap to the first N candidates after sorting
//   --group-id N          only heal the named group id (overrides --limit)
//
// Run
// ---
//   pnpm --filter @workspace/scripts run backfill:heal-stuck-needs-review-inbox
//   pnpm --filter @workspace/scripts run backfill:heal-stuck-needs-review-inbox -- --apply
//   pnpm --filter @workspace/scripts run backfill:heal-stuck-needs-review-inbox -- --apply --limit 10
//   pnpm --filter @workspace/scripts run backfill:heal-stuck-needs-review-inbox -- --apply --group-id 4711

import {
  db,
  pool,
  invoiceGroupsTable,
  portalResponsesTable,
  auditLogsTable,
  notesTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { transitionGroupStatus, type GroupStatus } from "@workspace/api-server/src/lib/group-transitions";
import { BACKFILL_IDS } from "./_backfill-audit";

export const BACKFILL_ID = BACKFILL_IDS.healStuckNeedsReviewInbox;
const SOURCE = "heal_stuck_needs_review_inbox_backfill";

const SYSTEM_ACTOR = {
  userEmail: "system@heal-stuck-needs-review-inbox-backfill",
  userName: "Stuck Inbox Heal",
};

// Match `pickLatestReviewableResponse` in
// artifacts/claimclear/src/components/queue-response-review-panel.tsx —
// this is the contract the inbox UI uses to decide what counts as a
// real payor verdict on file. Acknowledgments / abstains do NOT qualify.
const REVIEWABLE_RESPONSE_TYPES = [
  "approval",
  "denial",
  "partial_approval",
  "info_request",
  "other",
] as const;
type ReviewableResponseType = (typeof REVIEWABLE_RESPONSE_TYPES)[number];

// Statuses that the inbox treats as "stuck after a reclassification".
const STUCK_STATUSES: GroupStatus[] = ["Needs Review", "Ready to Review"];

// Statuses we are willing to revert TO. System-controlled statuses
// (`Portal Queued`, `Generating Email`, `Ready to Review`) and terminal
// statuses (`Resolved`, `Denied`) are intentionally excluded — they
// either can't be set manually or would mask a closed-out group.
const VALID_REVERT_TARGETS: GroupStatus[] = [
  "Awaiting Response",
  "Needs Evidence",
  "On Hold",
  "New",
];

const DEFAULT_TARGET: GroupStatus = "Awaiting Response";

// Cap on how many response ids stash into per-group audit metadata —
// keeps the JSONB write bounded if some pathological group has a huge
// thread.
const MAX_AUDIT_RESPONSE_IDS = 200;

interface CliFlags {
  apply: boolean;
  limit: number | null;
  groupId: number | null;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { apply: false, limit: null, groupId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    else if (a === "--apply") flags.apply = true;
    else if (a === "--limit") flags.limit = Number.parseInt(argv[++i], 10);
    else if (a.startsWith("--limit=")) flags.limit = Number.parseInt(a.slice("--limit=".length), 10);
    else if (a === "--group-id") flags.groupId = Number.parseInt(argv[++i], 10);
    else if (a.startsWith("--group-id=")) flags.groupId = Number.parseInt(a.slice("--group-id=".length), 10);
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: backfill:heal-stuck-needs-review-inbox [--apply] [--limit N] [--group-id ID]",
          "",
          "Default: dry-run plan, no writes.",
          "",
          "Flags:",
          "  --apply         Commit the status reverts + per-group audit/note rows.",
          "  --limit N       Cap to the first N stuck candidates (staged rollout).",
          "  --group-id N    Only consider the named group id (overrides --limit).",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (flags.limit !== null && Number.isNaN(flags.limit)) throw new Error("--limit must be a number");
  if (flags.groupId !== null && Number.isNaN(flags.groupId)) throw new Error("--group-id must be a number");
  return flags;
}

interface StuckGroup {
  id: number;
  invoiceNumber: string | null;
  status: string;
}

async function fetchStuckGroups(flags: CliFlags): Promise<StuckGroup[]> {
  const conditions = [inArray(invoiceGroupsTable.status, STUCK_STATUSES)];
  if (flags.groupId !== null) conditions.push(eq(invoiceGroupsTable.id, flags.groupId));

  let q = db
    .select({
      id: invoiceGroupsTable.id,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
      status: invoiceGroupsTable.status,
    })
    .from(invoiceGroupsTable)
    .where(and(...conditions))
    .orderBy(invoiceGroupsTable.id)
    .$dynamic();
  if (flags.groupId === null && flags.limit !== null) q = q.limit(flags.limit);

  const rows = await q;
  return rows as StuckGroup[];
}

interface ResponseRow {
  id: number;
  responseType: string;
}

async function fetchGroupResponses(groupId: number): Promise<ResponseRow[]> {
  // Group-scoped only — matches what the detail endpoint returns and what
  // the inbox UI's pickLatestReviewableResponse helper consumes.
  const rows = await db
    .select({
      id: portalResponsesTable.id,
      responseType: portalResponsesTable.responseType,
    })
    .from(portalResponsesTable)
    .where(eq(portalResponsesTable.invoiceGroupId, groupId));
  return rows.map((r) => ({ id: r.id, responseType: String(r.responseType) }));
}

function bucketResponses(rows: ResponseRow[]): {
  countsByType: Record<string, number>;
  reviewableIds: number[];
  consideredIds: number[];
  hasReviewable: boolean;
} {
  const countsByType: Record<string, number> = {};
  const reviewableIds: number[] = [];
  for (const r of rows) {
    countsByType[r.responseType] = (countsByType[r.responseType] ?? 0) + 1;
    if ((REVIEWABLE_RESPONSE_TYPES as readonly string[]).includes(r.responseType)) {
      reviewableIds.push(r.id);
    }
  }
  return {
    countsByType,
    reviewableIds,
    consideredIds: rows.map((r) => r.id),
    hasReviewable: reviewableIds.length > 0,
  };
}

interface PriorStatusPick {
  target: GroupStatus;
  source: "audit_trail" | "default";
  // Audit row id that supplied the prior status (for traceability).
  fromAuditId: number | null;
  // The raw `from` value off the audit row, before mapping/filtering.
  rawPriorStatus: string | null;
}

async function pickPriorStatus(groupId: number): Promise<PriorStatusPick> {
  // The spec is intentionally narrow: find the *most recent* `from` on
  // a group_status_changed row whose value is not itself a stuck
  // status (i.e. ignore the trail of in-place Needs Review / Ready to
  // Review reshuffles). That single value is the prior status. Then:
  //   - if it is in the manual-revert set → revert to it,
  //   - else default to Awaiting Response.
  // We deliberately do NOT scan further back looking for an older
  // "good" value once we've found a recent system-controlled one — a
  // group that just came out of Portal Queued / Generating Email
  // shouldn't be sent back to whatever it held before that automation
  // ran.
  const rows = await db
    .select({
      id: auditLogsTable.id,
      metadata: auditLogsTable.metadata,
      timestamp: auditLogsTable.timestamp,
    })
    .from(auditLogsTable)
    .where(and(
      eq(auditLogsTable.invoiceGroupId, groupId),
      eq(auditLogsTable.action, "group_status_changed"),
    ))
    .orderBy(desc(auditLogsTable.timestamp), desc(auditLogsTable.id));

  // Find the most recent `from` that is itself a non-stuck status.
  // Stuck-status `from` rows just record the inbox shuffling between
  // Needs Review / Ready to Review and aren't useful as a target.
  const STUCK_SET = new Set<string>(STUCK_STATUSES);
  for (const r of rows) {
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    const from = typeof md.from === "string" ? md.from : null;
    if (!from) continue;
    if (STUCK_SET.has(from)) continue;

    // First non-stuck `from` decides the outcome — no further lookback.
    if ((VALID_REVERT_TARGETS as readonly string[]).includes(from)) {
      return {
        target: from as GroupStatus,
        source: "audit_trail",
        fromAuditId: r.id,
        rawPriorStatus: from,
      };
    }
    // The most recent prior non-stuck status is system-controlled
    // (Generating Email / Portal Queued) or terminal (Resolved /
    // Denied) — fall through to the default, but stash the raw value
    // so the audit trail records WHY we defaulted.
    return {
      target: DEFAULT_TARGET,
      source: "default",
      fromAuditId: null,
      rawPriorStatus: from,
    };
  }

  // Either no audit rows at all, or every prior `from` was itself a
  // stuck status (group has only ever shuffled inside Needs Review /
  // Ready to Review). Default with the most recent raw value (if any)
  // stashed for traceability.
  return {
    target: DEFAULT_TARGET,
    source: "default",
    fromAuditId: null,
    rawPriorStatus: rows.length > 0
      ? (() => {
          const md = (rows[0].metadata ?? {}) as Record<string, unknown>;
          return typeof md.from === "string" ? md.from : null;
        })()
      : null,
  };
}

interface PerGroupSummary {
  groupId: number;
  invoiceNumber: string | null;
  priorStatus: string;
  targetStatus: GroupStatus;
  targetSource: "audit_trail" | "default";
  countsByType: Record<string, number>;
  consideredResponseIds: number[];
  rawPriorStatus: string | null;
  fromAuditId: number | null;
}

interface ReportTotals {
  scanned: number;
  skippedHasReviewable: number;
  healed: number;
  healedDefaulted: number;
  healedFromAudit: number;
}

export interface HealReport {
  perGroup: PerGroupSummary[];
  skippedHasReviewable: { groupId: number; invoiceNumber: string | null; reviewableIds: number[] }[];
  totals: ReportTotals;
  applied: boolean;
}

function newReport(): HealReport {
  return {
    perGroup: [],
    skippedHasReviewable: [],
    totals: {
      scanned: 0,
      skippedHasReviewable: 0,
      healed: 0,
      healedDefaulted: 0,
      healedFromAudit: 0,
    },
    applied: false,
  };
}

export interface HealOptions {
  apply: boolean;
  limit?: number;
  groupId?: number;
  /** Suppress per-row console output (used by tests). */
  silent?: boolean;
}

export async function runBackfill(opts: HealOptions): Promise<HealReport> {
  const flags: CliFlags = {
    apply: opts.apply,
    limit: opts.limit ?? null,
    groupId: opts.groupId ?? null,
  };
  const log = opts.silent ? () => undefined : (msg: string) => console.log(msg);
  const report = newReport();

  const stuck = await fetchStuckGroups(flags);
  report.totals.scanned = stuck.length;
  log(`[scan] ${stuck.length} group(s) currently in {Needs Review, Ready to Review}`);

  for (const g of stuck) {
    const responses = await fetchGroupResponses(g.id);
    const buckets = bucketResponses(responses);

    if (buckets.hasReviewable) {
      report.totals.skippedHasReviewable++;
      report.skippedHasReviewable.push({
        groupId: g.id,
        invoiceNumber: g.invoiceNumber,
        reviewableIds: buckets.reviewableIds,
      });
      log(
        `  ✓ group#${g.id} (#${g.invoiceNumber ?? "(no-invoice)"}) status=${g.status} has ${buckets.reviewableIds.length} reviewable response(s) — keep in inbox`,
      );
      continue;
    }

    const pick = await pickPriorStatus(g.id);
    const summary: PerGroupSummary = {
      groupId: g.id,
      invoiceNumber: g.invoiceNumber,
      priorStatus: g.status,
      targetStatus: pick.target,
      targetSource: pick.source,
      countsByType: buckets.countsByType,
      consideredResponseIds: buckets.consideredIds,
      rawPriorStatus: pick.rawPriorStatus,
      fromAuditId: pick.fromAuditId,
    };
    report.perGroup.push(summary);
    report.totals.healed++;
    if (pick.source === "default") report.totals.healedDefaulted++;
    else report.totals.healedFromAudit++;

    const typesSummary = Object.keys(buckets.countsByType).length === 0
      ? "(no responses on file)"
      : Object.entries(buckets.countsByType).map(([k, v]) => `${k}=${v}`).join(", ");
    const reasonLabel = pick.source === "audit_trail"
      ? `prior status from audit#${pick.fromAuditId}`
      : `defaulted (no usable prior status${pick.rawPriorStatus ? `, last seen=${pick.rawPriorStatus}` : ""})`;
    log(
      `  ↩ group#${g.id} (#${g.invoiceNumber ?? "(no-invoice)"}): ${g.status} → ${pick.target}; responses=${responses.length} [${typesSummary}]; ${reasonLabel}`,
    );

    if (!flags.apply) continue;

    await applyHeal(summary);
  }

  report.applied = flags.apply;
  return report;
}

async function applyHeal(s: PerGroupSummary): Promise<void> {
  const reason =
    `Stuck inbox heal (${BACKFILL_ID}): reverting from ${s.priorStatus} to ${s.targetStatus}. ` +
    `Group has no reviewable portal_responses on file — only ` +
    (Object.keys(s.countsByType).length === 0
      ? "(no responses)"
      : Object.entries(s.countsByType).map(([k, v]) => `${k}=${v}`).join(", ")) +
    `. Target chosen via ${s.targetSource === "audit_trail"
      ? `audit#${s.fromAuditId} (most recent prior non-review status)`
      : `default (no usable prior status in audit trail)`}.`;

  await transitionGroupStatus({
    groupId: s.groupId,
    newStatus: s.targetStatus,
    source: SOURCE,
    reason,
    actor: SYSTEM_ACTOR,
    systemOverride: true,
  });

  // Separate audit row carrying the rich metadata. Lives on the group's
  // timeline so reviewers see exactly why we moved it.
  const truncatedIds = s.consideredResponseIds.slice(0, MAX_AUDIT_RESPONSE_IDS);
  const auditRow = await db
    .insert(auditLogsTable)
    .values({
      claimId: null,
      invoiceGroupId: s.groupId,
      action: "inbox_heal_applied",
      details:
        `Stuck Inbox Heal: status ${s.priorStatus} → ${s.targetStatus} ` +
        `(no reviewable response on file). ` +
        `Considered ${s.consideredResponseIds.length} portal_response(s); target source: ${s.targetSource}.`,
      metadata: {
        backfillId: BACKFILL_ID,
        source: SOURCE,
        priorStatus: s.priorStatus,
        targetStatus: s.targetStatus,
        targetSource: s.targetSource,
        // The raw prior status off the most recent audit row, for
        // traceability when targetSource === 'default' (so reviewers can
        // see what status was actually most recent vs. what we picked).
        mostRecentPriorAuditStatus: s.rawPriorStatus,
        // The audit_logs.id whose `from` field supplied the chosen
        // target — null when defaulted.
        chosenFromAuditId: s.fromAuditId,
        consideredResponseIdCount: s.consideredResponseIds.length,
        consideredResponseIds: truncatedIds,
        consideredResponseIdsTruncated:
          s.consideredResponseIds.length > MAX_AUDIT_RESPONSE_IDS,
        responseTypeCounts: s.countsByType,
      },
      userEmail: SYSTEM_ACTOR.userEmail,
      userName: SYSTEM_ACTOR.userName,
    })
    .returning({ id: auditLogsTable.id });

  await db.insert(notesTable).values({
    claimId: null,
    invoiceGroupId: s.groupId,
    type: "system",
    content:
      `Stuck Inbox Heal applied: status reverted from ${s.priorStatus} to ${s.targetStatus} ` +
      `because no reviewable response was on file (only ` +
      (Object.keys(s.countsByType).length === 0
        ? "no responses"
        : Object.entries(s.countsByType).map(([k, v]) => `${k}=${v}`).join(", ")) +
      `). See audit entry #${auditRow[0]?.id ?? "?"} (action=inbox_heal_applied).`,
    author: SYSTEM_ACTOR.userName,
  });
}

function printReport(report: HealReport, mode: "dry-run" | "apply"): void {
  console.log("\n===== STUCK INBOX HEAL — VERIFICATION REPORT =====");
  console.log(`mode:                                  ${mode}`);
  console.log(`groups scanned (in stuck statuses):    ${report.totals.scanned}`);
  console.log(`  skipped — has reviewable response:   ${report.totals.skippedHasReviewable}`);
  console.log(`  healed total:                        ${report.totals.healed}`);
  console.log(`    of which from audit trail:         ${report.totals.healedFromAudit}`);
  console.log(`    of which defaulted:                ${report.totals.healedDefaulted}`);

  if (report.perGroup.length > 0) {
    // Per-target breakdown so a reviewer can see where the heals landed.
    const byTarget = new Map<string, number>();
    for (const s of report.perGroup) {
      byTarget.set(s.targetStatus, (byTarget.get(s.targetStatus) ?? 0) + 1);
    }
    console.log("\nheals by target status:");
    for (const [t, n] of [...byTarget.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  → ${t}`);
    }
  }

  if (mode === "dry-run") {
    console.log("\nNo writes performed. Re-run with --apply to commit.");
  } else if (report.totals.healed === 0) {
    console.log("\nNothing to do — no stuck groups found.");
  } else {
    console.log(
      `\n✓ Healed ${report.totals.healed} group(s); each has a `
      + `group_status_changed audit row, an inbox_heal_applied audit row, and a system note.`,
    );
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const mode = flags.apply ? "apply" : "dry-run";
  console.log(
    `[backfill] mode=${mode}` +
    (flags.limit !== null ? ` limit=${flags.limit}` : "") +
    (flags.groupId !== null ? ` groupId=${flags.groupId}` : ""),
  );
  const report = await runBackfill({
    apply: flags.apply,
    limit: flags.limit ?? undefined,
    groupId: flags.groupId ?? undefined,
  });
  printReport(report, mode);
}

const isMain = (() => {
  return (
    !!process.argv[1] &&
    process.argv[1].endsWith("2026-05-heal-stuck-needs-review-inbox-backfill.ts")
  );
})();

if (isMain) {
  main()
    .then(() => pool.end().then(() => process.exit(0)))
    .catch((err) => {
      console.error("[backfill] FAILED", err);
      pool.end().finally(() => process.exit(1));
    });
}

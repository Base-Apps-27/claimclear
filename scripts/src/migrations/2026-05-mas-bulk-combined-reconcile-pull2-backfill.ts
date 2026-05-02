// One-shot 2026-05-02 follow-up to
// `2026-05-mas-bulk-combined-non-issue-backfill.ts`. The first run worked
// off a partial MAS export — only ~90 rows came back, and multi-leg
// invoices that had at least one Eligible leg were silently misreported
// as fully Cancelled/Combined because only the Combined legs showed up
// in the export. A follow-up MAS pull on the same 95 invoices returned
// the full 165-leg breakdown and reclassified 12 of the closures as
// Eligible while flagging 14 additional invoices we missed entirely.
//
// This script reconciles the in-database state against the new
// authoritative pull. It does TWO things:
//
//   (A) REVERT the 12 mistakenly-closed groups
//       Move every group whose new MAS verdict is `Eligible` from
//       `Resolved/Non-Issue` back to `Needs Review/Pending` so an
//       operator picks it up in the Classify inbox and decides what to
//       do with it.
//
//       Safety gate: only revert groups whose most recent closure was
//       written by the previous bulk-combined backfill (`backfillId =
//       2026-05-mas-bulk-combined-non-issue` on an audit_logs row of
//       action `mas_bulk_combined_classified`). Any group closed by a
//       human operator or by some other process is left strictly alone.
//
//       The revert runs through `transitionGroupStatus({systemOverride:
//       true})` because `Resolved → Needs Review` IS a valid manual
//       transition, but we still want to bypass the active-submission
//       and held-leg checks (those guards are written for the live
//       operator UI; this is a backfill correcting our own mistake).
//       The transition also resets `outcome` to `Pending` and clears
//       `closure_reason`, `triage_notes`, `triaged_at`, restoring the
//       group to the same shape it had before the first backfill ran.
//       The previous backfill set `total_amount = "0"`; this script
//       restores it to the sum of `claim_amount` across all legs (the
//       same recompute the importer does at line 149 of
//       `routes/import.ts`). Legs themselves are never touched (the
//       previous backfill never touched them either — see the
//       `syncChildRides` short-circuit on `error_type_id IS NULL`).
//
//   (B) CLOSE the 14 newly-flagged Combined groups
//       Identical to the first backfill: route each through
//       `transitionGroupStatusAndOutcome({newStatus: "Resolved",
//       newOutcome: "Non-Issue", closureReason: "non_issue"})` with
//       the same `extraFields` / `childFields` payload the operator
//       triage UI uses. Tagged with the new `backfillId` so the two
//       waves are distinguishable in audit history.
//
// Idempotency
// -----------
//   Both halves gate on the CURRENT row state:
//     - REVERT considers only groups currently in `Resolved/Non-Issue`
//       AND tagged by the previous backfill's audit row.
//     - CLOSE considers only groups currently in `Needs Review`.
//   Once a group has been moved by this run (or by anything else), it
//   no longer matches and a re-run reports it as skipped.
//
// Flags
// -----
//   --apply        commit the changes (default = dry-run)
//   --input PATH   path to the TSV (default:
//                  .local/data/mas-bulk-classify-2026-05-pull2.tsv)
//   --limit N      cap each phase to N matched candidates
//   --only revert  skip the close phase
//   --only close   skip the revert phase
//
// Run
// ---
//   pnpm --filter @workspace/scripts run backfill:mas-bulk-combined-reconcile-pull2
//   pnpm --filter @workspace/scripts run backfill:mas-bulk-combined-reconcile-pull2 -- --apply
//   pnpm --filter @workspace/scripts run backfill:mas-bulk-combined-reconcile-pull2 -- --apply --only revert

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  db,
  pool,
  invoiceGroupsTable,
  claimsTable,
  auditLogsTable,
  notesTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import {
  transitionGroupStatus,
  transitionGroupStatusAndOutcome,
} from "@workspace/api-server/src/lib/group-transitions";
import { BACKFILL_IDS } from "./_backfill-audit";

export const BACKFILL_ID = BACKFILL_IDS.masBulkCombinedReconcilePull2;
const PRIOR_BACKFILL_ID = BACKFILL_IDS.masBulkCombinedNonIssue;
const SOURCE = "mas_bulk_combined_reconcile_pull2_backfill";
const DEFAULT_INPUT = ".local/data/mas-bulk-classify-2026-05-pull2.tsv";
const COMBINED_RE = /^cancelled\s*\/\s*combined$/i;
const ELIGIBLE_RE = /^eligible$/i;

const SYSTEM_ACTOR = {
  userEmail: "system@mas-bulk-combined-reconcile-pull2-backfill",
  userName: "MAS Bulk Combined Reconcile (pull 2)",
};

type Phase = "revert" | "close";

interface CliFlags {
  apply: boolean;
  input: string;
  limit: number | null;
  only: Phase | null;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { apply: false, input: DEFAULT_INPUT, limit: null, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    else if (a === "--apply") flags.apply = true;
    else if (a === "--input") flags.input = argv[++i];
    else if (a.startsWith("--input=")) flags.input = a.slice("--input=".length);
    else if (a === "--limit") flags.limit = Number.parseInt(argv[++i], 10);
    else if (a.startsWith("--limit=")) flags.limit = Number.parseInt(a.slice("--limit=".length), 10);
    else if (a === "--only") flags.only = argv[++i] as Phase;
    else if (a.startsWith("--only=")) flags.only = a.slice("--only=".length) as Phase;
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: backfill:mas-bulk-combined-reconcile-pull2 [--apply] [--input PATH] [--limit N] [--only revert|close]",
          "",
          "Default: dry-run plan, no writes.",
          "",
          "Reconciles in-database state against the second (authoritative) MAS pull:",
          "  REVERT — groups whose new verdict is Eligible but were closed by the prior",
          "           bulk-combined backfill: Resolved/Non-Issue → Needs Review/Pending.",
          "  CLOSE  — groups whose new verdict is Cancelled/Combined and that are still",
          "           in Needs Review: → Resolved/Non-Issue (closureReason=non_issue).",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (flags.limit !== null && Number.isNaN(flags.limit)) throw new Error("--limit must be a number");
  if (flags.only !== null && flags.only !== "revert" && flags.only !== "close") {
    throw new Error('--only must be "revert" or "close"');
  }
  return flags;
}

interface InputRow {
  lineNumber: number;
  invoiceNumber: string;
  status: string;
  verdict: "combined" | "eligible";
}

interface ParsedInput {
  combined: InputRow[];
  eligible: InputRow[];
  unrecognized: InputRow[];
  emptyRows: number;
}

function parseInput(path: string): ParsedInput {
  const absPath = resolve(process.cwd(), path);
  const raw = readFileSync(absPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const combined: InputRow[] = [];
  const eligible: InputRow[] = [];
  const unrecognized: InputRow[] = [];
  let emptyRows = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { emptyRows++; continue; }
    const cells = line.split("\t").map((c) => c.trim());
    if (cells.length < 2) continue;
    const [invoiceNumber, status] = cells;
    if (!invoiceNumber || invoiceNumber === "invoice_number") continue;

    const base = { lineNumber: i + 1, invoiceNumber, status };
    if (COMBINED_RE.test(status)) combined.push({ ...base, verdict: "combined" });
    else if (ELIGIBLE_RE.test(status)) eligible.push({ ...base, verdict: "eligible" });
    else unrecognized.push({ ...base, verdict: "combined" }); // verdict tag ignored downstream
  }

  return { combined, eligible, unrecognized, emptyRows };
}

interface RevertCandidate {
  row: InputRow;
  groupId: number;
  status: string;
  outcome: string;
  totalAmountBefore: string | null;
  priorBackfillAuditId: number;
  restoredTotalAmount: string;
  legCount: number;
}

interface RevertSkip {
  row: InputRow;
  reason:
    | "no_group_for_invoice"
    | "not_in_resolved_non_issue"
    | "not_closed_by_prior_backfill";
  currentStatus?: string;
  currentOutcome?: string;
  groupId?: number;
}

async function buildRevertPlan(eligibleRows: InputRow[]): Promise<{
  candidates: RevertCandidate[];
  skipped: RevertSkip[];
}> {
  const skipped: RevertSkip[] = [];
  const candidates: RevertCandidate[] = [];
  if (eligibleRows.length === 0) return { candidates, skipped };

  const invoiceNumbers = eligibleRows.map((r) => r.invoiceNumber);
  const groups = await db
    .select({
      id: invoiceGroupsTable.id,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
      status: invoiceGroupsTable.status,
      outcome: invoiceGroupsTable.outcome,
      totalAmount: invoiceGroupsTable.totalAmount,
    })
    .from(invoiceGroupsTable)
    .where(inArray(invoiceGroupsTable.invoiceNumber, invoiceNumbers));

  const byInvoice = new Map<string, typeof groups[number]>();
  for (const g of groups) {
    if (g.invoiceNumber == null) continue;
    byInvoice.set(g.invoiceNumber, g);
  }

  for (const row of eligibleRows) {
    const g = byInvoice.get(row.invoiceNumber);
    if (!g) {
      skipped.push({ row, reason: "no_group_for_invoice" });
      continue;
    }
    if (g.status !== "Resolved" || g.outcome !== "Non-Issue") {
      skipped.push({
        row,
        reason: "not_in_resolved_non_issue",
        currentStatus: g.status,
        currentOutcome: g.outcome,
        groupId: g.id,
      });
      continue;
    }

    const priorAudit = await db
      .select({ id: auditLogsTable.id })
      .from(auditLogsTable)
      .where(sql`
        ${auditLogsTable.invoiceGroupId} = ${g.id}
        AND ${auditLogsTable.action} = 'mas_bulk_combined_classified'
        AND ${auditLogsTable.metadata}->>'backfillId' = ${PRIOR_BACKFILL_ID}
      `)
      .orderBy(sql`${auditLogsTable.id} DESC`)
      .limit(1);

    if (priorAudit.length === 0) {
      skipped.push({
        row,
        reason: "not_closed_by_prior_backfill",
        currentStatus: g.status,
        currentOutcome: g.outcome,
        groupId: g.id,
      });
      continue;
    }

    // Recompute total_amount from leg sum — same shape as importer
    // (routes/import.ts:136-149). The previous backfill never touched
    // legs (syncChildRides short-circuits on error_type_id IS NULL),
    // so leg amounts are still the original values.
    const legs = await db
      .select({ claimAmount: claimsTable.claimAmount })
      .from(claimsTable)
      .where(eq(claimsTable.invoiceGroupId, g.id));
    let restored = 0;
    for (const l of legs) {
      if (l.claimAmount != null) restored += parseFloat(String(l.claimAmount)) || 0;
    }

    candidates.push({
      row,
      groupId: g.id,
      status: g.status,
      outcome: g.outcome,
      totalAmountBefore: g.totalAmount as string | null,
      priorBackfillAuditId: priorAudit[0].id,
      restoredTotalAmount: restored.toFixed(2),
      legCount: legs.length,
    });
  }

  return { candidates, skipped };
}

interface CloseCandidate {
  row: InputRow;
  groupId: number;
  status: string;
  outcome: string;
}

interface CloseSkip {
  row: InputRow;
  reason: "no_group_for_invoice" | "not_in_needs_review";
  currentStatus?: string;
  currentOutcome?: string;
  groupId?: number;
}

async function buildClosePlan(combinedRows: InputRow[]): Promise<{
  candidates: CloseCandidate[];
  skipped: CloseSkip[];
}> {
  const skipped: CloseSkip[] = [];
  const candidates: CloseCandidate[] = [];
  if (combinedRows.length === 0) return { candidates, skipped };

  const invoiceNumbers = combinedRows.map((r) => r.invoiceNumber);
  const groups = await db
    .select({
      id: invoiceGroupsTable.id,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
      status: invoiceGroupsTable.status,
      outcome: invoiceGroupsTable.outcome,
    })
    .from(invoiceGroupsTable)
    .where(inArray(invoiceGroupsTable.invoiceNumber, invoiceNumbers));

  const byInvoice = new Map<string, typeof groups[number]>();
  for (const g of groups) {
    if (g.invoiceNumber == null) continue;
    byInvoice.set(g.invoiceNumber, g);
  }

  for (const row of combinedRows) {
    const g = byInvoice.get(row.invoiceNumber);
    if (!g) {
      skipped.push({ row, reason: "no_group_for_invoice" });
      continue;
    }
    if (g.status !== "Needs Review") {
      skipped.push({
        row,
        reason: "not_in_needs_review",
        currentStatus: g.status,
        currentOutcome: g.outcome,
        groupId: g.id,
      });
      continue;
    }
    candidates.push({ row, groupId: g.id, status: g.status, outcome: g.outcome });
  }

  return { candidates, skipped };
}

async function applyRevert(c: RevertCandidate): Promise<void> {
  const reason =
    `MAS pull 2 (${BACKFILL_ID}) reclassified invoice ${c.row.invoiceNumber} as Eligible. ` +
    `Reverting prior bulk-combined closure (audit#${c.priorBackfillAuditId}) — back to Needs Review/Pending ` +
    `so an operator can attest or re-classify per the manifest. Restoring total_amount=${c.restoredTotalAmount} ` +
    `(sum of ${c.legCount} leg claim_amount(s)).`;

  await transitionGroupStatus({
    groupId: c.groupId,
    newStatus: "Needs Review",
    source: SOURCE,
    reason,
    actor: SYSTEM_ACTOR,
    systemOverride: true,
    extraFields: {
      outcome: "Pending",
      closureReason: null,
      totalAmount: c.restoredTotalAmount,
      triageNotes: null,
      triagedAt: null,
    },
  });

  const auditRow = await db
    .insert(auditLogsTable)
    .values({
      claimId: null,
      invoiceGroupId: c.groupId,
      action: "mas_bulk_combined_reverted_after_pull2",
      details:
        `MAS Bulk Combined Reconcile (pull 2): invoice ${c.row.invoiceNumber} reopened from ` +
        `Resolved/Non-Issue back to Needs Review/Pending because the second MAS pull returned ` +
        `Eligible. Prior closure backfill audit row was #${c.priorBackfillAuditId}.`,
      metadata: {
        backfillId: BACKFILL_ID,
        priorBackfillId: PRIOR_BACKFILL_ID,
        priorBackfillAuditId: c.priorBackfillAuditId,
        source: SOURCE,
        invoiceNumber: c.row.invoiceNumber,
        masStatus: c.row.status,
        priorStatus: c.status,
        priorOutcome: c.outcome,
        priorTotalAmount: c.totalAmountBefore,
        restoredTotalAmount: c.restoredTotalAmount,
        legCount: c.legCount,
        targetStatus: "Needs Review",
        targetOutcome: "Pending",
      },
      userEmail: SYSTEM_ACTOR.userEmail,
      userName: SYSTEM_ACTOR.userName,
    })
    .returning({ id: auditLogsTable.id });

  await db.insert(notesTable).values({
    claimId: null,
    invoiceGroupId: c.groupId,
    type: "system",
    content:
      `Reopened: a follow-up MAS pull on 2026-05-02 reclassified invoice ${c.row.invoiceNumber} ` +
      `as Eligible. The earlier bulk-Combined closure was based on a partial export and is now ` +
      `incorrect — group restored to Needs Review/Pending so an operator can refer to the ` +
      `original manifest and decide. See audit entry #${auditRow[0]?.id ?? "?"} ` +
      `(action=mas_bulk_combined_reverted_after_pull2).`,
    author: SYSTEM_ACTOR.userName,
  });
}

async function applyClose(c: CloseCandidate): Promise<void> {
  const triageNotes =
    `MAS portal verdict (pull 2): Cancelled/Combined for invoice ${c.row.invoiceNumber}. ` +
    `Bulk-classified as non-issue from the 2026-05-02 follow-up MAS pull. Backfill: ${BACKFILL_ID}.`;

  const result = await transitionGroupStatusAndOutcome({
    groupId: c.groupId,
    newStatus: "Resolved",
    newOutcome: "Non-Issue",
    source: SOURCE,
    reason: `Classified as non-issue (MAS Cancelled/Combined, pull 2): ${triageNotes}`,
    actor: SYSTEM_ACTOR,
    // systemOverride: pull2 is the authoritative MAS verdict, so the close must
    // succeed even when an operator-placed "On Hold" leg sits on the group
    // (e.g. group#155 / invoice 1855950650 has leg 329 on hold with reason
    // "Invoice combined with 1855140030. Attested already." — that hold note
    // is itself the operator's prior agreement with pull2's Cancelled/Combined
    // verdict). syncChildRides explicitly excludes On Hold legs, so the held
    // leg's hold_reason / hold_placed_at / status remain untouched and the
    // group simply closes around it.
    systemOverride: true,
    extraFields: {
      triageNotes,
      triagedAt: new Date().toISOString(),
      totalAmount: "0",
    },
    childFields: {
      claimAmount: "0",
      approvedAmount: "0",
    },
    closureReason: "non_issue",
  });

  if (!result.success) {
    throw new Error(`transitionGroupStatusAndOutcome returned non-success for group ${c.groupId}`);
  }

  const auditRow = await db
    .insert(auditLogsTable)
    .values({
      claimId: null,
      invoiceGroupId: c.groupId,
      action: "mas_bulk_combined_classified",
      details:
        `MAS Bulk Combined Import (pull 2): invoice ${c.row.invoiceNumber} closed as ` +
        `Resolved/Non-Issue because the second MAS pull returned Cancelled/Combined.`,
      metadata: {
        backfillId: BACKFILL_ID,
        priorBackfillId: PRIOR_BACKFILL_ID,
        source: SOURCE,
        invoiceNumber: c.row.invoiceNumber,
        masStatus: c.row.status,
        priorStatus: c.status,
        priorOutcome: c.outcome,
        targetStatus: "Resolved",
        targetOutcome: "Non-Issue",
        closureReason: "non_issue",
      },
      userEmail: SYSTEM_ACTOR.userEmail,
      userName: SYSTEM_ACTOR.userName,
    })
    .returning({ id: auditLogsTable.id });

  await db.insert(notesTable).values({
    claimId: null,
    invoiceGroupId: c.groupId,
    type: "system",
    content:
      `Closed via MAS bulk Combined import (pull 2): the second MAS pull returned ` +
      `Cancelled/Combined for invoice ${c.row.invoiceNumber}. See audit entry ` +
      `#${auditRow[0]?.id ?? "?"} (action=mas_bulk_combined_classified).`,
    author: SYSTEM_ACTOR.userName,
  });
}

interface RunReport {
  parsed: ParsedInput;
  revertCandidates: RevertCandidate[];
  revertSkipped: RevertSkip[];
  closeCandidates: CloseCandidate[];
  closeSkipped: CloseSkip[];
  reverted: number;
  closed: number;
  revertFailures: { row: InputRow; groupId: number; error: string }[];
  closeFailures: { row: InputRow; groupId: number; error: string }[];
  applied: boolean;
  only: Phase | null;
}

export interface RunOptions {
  apply: boolean;
  input?: string;
  limit?: number;
  only?: Phase | null;
  silent?: boolean;
}

export async function runBackfill(opts: RunOptions): Promise<RunReport> {
  const flags: CliFlags = {
    apply: opts.apply,
    input: opts.input ?? DEFAULT_INPUT,
    limit: opts.limit ?? null,
    only: opts.only ?? null,
  };
  const log = opts.silent ? () => undefined : (msg: string) => console.log(msg);

  const parsed = parseInput(flags.input);
  log(
    `[parse] file=${flags.input} combined=${parsed.combined.length} ` +
    `eligible=${parsed.eligible.length} unrecognized=${parsed.unrecognized.length} ` +
    `empty=${parsed.emptyRows}`,
  );

  const revertPlan = flags.only === "close"
    ? { candidates: [], skipped: [] }
    : await buildRevertPlan(parsed.eligible);
  const closePlan = flags.only === "revert"
    ? { candidates: [], skipped: [] }
    : await buildClosePlan(parsed.combined);

  const revertCandidates = flags.limit === null ? revertPlan.candidates : revertPlan.candidates.slice(0, flags.limit);
  const closeCandidates = flags.limit === null ? closePlan.candidates : closePlan.candidates.slice(0, flags.limit);

  log(
    `[plan] revert=${revertCandidates.length} (skipped=${revertPlan.skipped.length}) ` +
    `close=${closeCandidates.length} (skipped=${closePlan.skipped.length})`,
  );

  let reverted = 0;
  let closed = 0;
  const revertFailures: RunReport["revertFailures"] = [];
  const closeFailures: RunReport["closeFailures"] = [];

  for (const c of revertCandidates) {
    log(
      `  ↺ revert group#${c.groupId} (#${c.row.invoiceNumber}): Resolved/Non-Issue → Needs Review/Pending; ` +
      `restore total_amount=${c.totalAmountBefore} → ${c.restoredTotalAmount} (${c.legCount} legs); ` +
      `prior backfill audit#${c.priorBackfillAuditId}`,
    );
    if (!flags.apply) continue;
    try {
      await applyRevert(c);
      reverted++;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      revertFailures.push({ row: c.row, groupId: c.groupId, error: msg });
      log(`    ✗ FAILED revert group#${c.groupId}: ${msg}`);
    }
  }

  for (const c of closeCandidates) {
    log(
      `  ✓ close group#${c.groupId} (#${c.row.invoiceNumber}): Needs Review/Pending → Resolved/Non-Issue ` +
      `(closureReason=non_issue)`,
    );
    if (!flags.apply) continue;
    try {
      await applyClose(c);
      closed++;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      closeFailures.push({ row: c.row, groupId: c.groupId, error: msg });
      log(`    ✗ FAILED close group#${c.groupId}: ${msg}`);
    }
  }

  return {
    parsed,
    revertCandidates,
    revertSkipped: revertPlan.skipped,
    closeCandidates,
    closeSkipped: closePlan.skipped,
    reverted,
    closed,
    revertFailures,
    closeFailures,
    applied: flags.apply,
    only: flags.only,
  };
}

function printReport(report: RunReport, mode: "dry-run" | "apply"): void {
  console.log("\n===== MAS BULK COMBINED RECONCILE (PULL 2) — VERIFICATION REPORT =====");
  console.log(`mode:                                         ${mode}`);
  console.log(`only:                                         ${report.only ?? "(both phases)"}`);
  console.log(`input combined rows:                          ${report.parsed.combined.length}`);
  console.log(`input eligible rows:                          ${report.parsed.eligible.length}`);
  console.log(`input unrecognized status rows:               ${report.parsed.unrecognized.length}`);

  console.log(`\n-- REVERT phase (Eligible verdict → reopen prior closures) --`);
  console.log(`  candidates planned:                         ${report.revertCandidates.length}`);
  console.log(`  skipped — no group for invoice:             ${report.revertSkipped.filter((s) => s.reason === "no_group_for_invoice").length}`);
  console.log(`  skipped — not in Resolved/Non-Issue:        ${report.revertSkipped.filter((s) => s.reason === "not_in_resolved_non_issue").length}`);
  console.log(`  skipped — not closed by prior backfill:     ${report.revertSkipped.filter((s) => s.reason === "not_closed_by_prior_backfill").length}`);
  if (mode === "apply") {
    console.log(`  reverted:                                   ${report.reverted}`);
    console.log(`  failed:                                     ${report.revertFailures.length}`);
  }

  console.log(`\n-- CLOSE phase (Combined verdict → close as Non-Issue) --`);
  console.log(`  candidates planned:                         ${report.closeCandidates.length}`);
  console.log(`  skipped — no group for invoice:             ${report.closeSkipped.filter((s) => s.reason === "no_group_for_invoice").length}`);
  console.log(`  skipped — not in Needs Review:              ${report.closeSkipped.filter((s) => s.reason === "not_in_needs_review").length}`);
  if (mode === "apply") {
    console.log(`  closed:                                     ${report.closed}`);
    console.log(`  failed:                                     ${report.closeFailures.length}`);
  }

  if (report.parsed.unrecognized.length > 0) {
    console.log("\nUnrecognized status rows (skipped entirely):");
    for (const r of report.parsed.unrecognized) {
      console.log(`  - line ${r.lineNumber}: ${r.invoiceNumber} → ${r.status}`);
    }
  }

  if (report.revertSkipped.length > 0) {
    console.log("\nRevert phase — skipped detail:");
    for (const s of report.revertSkipped) {
      const tail = s.groupId
        ? ` group#${s.groupId} is ${s.currentStatus}/${s.currentOutcome}`
        : "";
      console.log(`  - ${s.row.invoiceNumber} (${s.reason})${tail}`);
    }
  }

  if (report.closeSkipped.length > 0) {
    console.log("\nClose phase — skipped detail:");
    for (const s of report.closeSkipped) {
      const tail = s.groupId
        ? ` group#${s.groupId} is ${s.currentStatus}/${s.currentOutcome}`
        : "";
      console.log(`  - ${s.row.invoiceNumber} (${s.reason})${tail}`);
    }
  }

  if (report.revertFailures.length > 0) {
    console.log("\nRevert failures:");
    for (const f of report.revertFailures) {
      console.log(`  - group#${f.groupId} invoice ${f.row.invoiceNumber}: ${f.error}`);
    }
  }
  if (report.closeFailures.length > 0) {
    console.log("\nClose failures:");
    for (const f of report.closeFailures) {
      console.log(`  - group#${f.groupId} invoice ${f.row.invoiceNumber}: ${f.error}`);
    }
  }

  if (mode === "dry-run") {
    console.log("\nNo writes performed. Re-run with --apply to commit.");
  } else {
    console.log(
      `\n✓ Reverted ${report.reverted} group(s); closed ${report.closed} group(s). ` +
      `Each gets a transition audit row, a per-action reconcile audit row, and a system note.`,
    );
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const mode = flags.apply ? "apply" : "dry-run";
  console.log(
    `[backfill] mode=${mode} input=${flags.input}` +
    (flags.limit !== null ? ` limit=${flags.limit}` : "") +
    (flags.only !== null ? ` only=${flags.only}` : ""),
  );
  const report = await runBackfill({
    apply: flags.apply,
    input: flags.input,
    limit: flags.limit ?? undefined,
    only: flags.only,
  });
  printReport(report, mode);
}

const isMain = (() => {
  return (
    !!process.argv[1] &&
    process.argv[1].endsWith("2026-05-mas-bulk-combined-reconcile-pull2-backfill.ts")
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

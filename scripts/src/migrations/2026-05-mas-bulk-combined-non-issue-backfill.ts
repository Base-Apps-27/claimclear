// One-shot 2026-05-02: bulk-close invoice groups whose MAS portal
// verdict is `Cancelled/Combined` — i.e. the ride was already covered
// by another approved invoice, so there is nothing for ClaimClear to
// dispute. Same effect as opening each group in the UI and clicking
// "Classify as non-issue", just driven from a list.
//
// Why this script exists
// ----------------------
//   On 2026-05-02 the operator pulled MAS portal statuses for every
//   group sitting in the Classify inbox. ~85 of them came back as
//   "Cancelled/Combined" (one came back "Eligible", which is the
//   opposite verdict — those are intentionally ignored here so an
//   operator can classify them with the right error type). Doing 85
//   single-click triages by hand was the original ask; this script
//   does the same writes in one go with a dry-run gate.
//
// What this script does
// ---------------------
//   1. Parses the input TSV with the columns MEMBER, INVOICE, STATUS.
//      Whitespace-only fields are tolerated (the source spreadsheet
//      pads cells with spaces). Rows whose STATUS is anything other
//      than `Cancelled/Combined` (case-insensitive) are recorded as
//      `skippedNotCombined` and never touched.
//   2. Dedupes the remaining rows by invoice_number — the input
//      contains duplicates from the spreadsheet pivot.
//   3. Matches each invoice_number to an invoice_groups row whose
//      current status is `Needs Review`. Anything not found, or
//      currently in some other status, is reported and skipped — we
//      will never re-touch a group that has already moved on.
//   4. For each match, calls
//      `transitionGroupStatusAndOutcome({ newStatus: "Resolved",
//        newOutcome: "Non-Issue", closureReason: "non_issue", ... })`
//      with `extraFields = { totalAmount: "0", triageNotes,
//      triagedAt }` and `childFields = { claimAmount: "0",
//      approvedAmount: "0" }` — exactly the payload the operator
//      triage endpoint constructs for the `non_issue` branch (see
//      artifacts/api-server/src/routes/invoice-groups.ts:952-969). We
//      do NOT pass `systemOverride: true`: `Needs Review → Resolved`
//      with outcome `Non-Issue` is a fully valid manual transition,
//      so the normal safety checks (active submissions, held legs,
//      etc.) all run.
//   5. Writes a separate `audit_logs` row tagged
//      `action='mas_bulk_combined_classified'` with the input
//      member, invoice number, and MAS status preserved in
//      `metadata`, plus the standard `backfillId`. Inserts a system
//      note linking back to the audit row so the per-group timeline
//      reads "Closed via MAS bulk Combined import — see audit
//      entry #N".
//
// Idempotency
// -----------
//   Matching is gated on the CURRENT status being `Needs Review`. Once
//   a group has been closed by this run (or by anything else) it no
//   longer matches, and a re-run reports it under
//   `skippedNotInNeedsReview`.
//
// Flags
// -----
//   --apply               actually write changes (default = dry-run)
//   --input PATH          path to the TSV (default:
//                         .local/data/mas-bulk-classify-2026-05.tsv)
//   --limit N             cap to the first N matched candidates
//
// Run
// ---
//   pnpm --filter @workspace/scripts run backfill:mas-bulk-combined-non-issue
//   pnpm --filter @workspace/scripts run backfill:mas-bulk-combined-non-issue -- --apply
//   pnpm --filter @workspace/scripts run backfill:mas-bulk-combined-non-issue -- --apply --limit 5

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  db,
  pool,
  invoiceGroupsTable,
  auditLogsTable,
  notesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { transitionGroupStatusAndOutcome } from "@workspace/api-server/src/lib/group-transitions";
import { BACKFILL_IDS } from "./_backfill-audit";

export const BACKFILL_ID = BACKFILL_IDS.masBulkCombinedNonIssue;
const SOURCE = "mas_bulk_combined_non_issue_backfill";
const DEFAULT_INPUT = ".local/data/mas-bulk-classify-2026-05.tsv";
const COMBINED_STATUS_RE = /^cancelled\s*\/\s*combined$/i;

const SYSTEM_ACTOR = {
  userEmail: "system@mas-bulk-combined-non-issue-backfill",
  userName: "MAS Bulk Combined Import",
};

interface CliFlags {
  apply: boolean;
  input: string;
  limit: number | null;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { apply: false, input: DEFAULT_INPUT, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    else if (a === "--apply") flags.apply = true;
    else if (a === "--input") flags.input = argv[++i];
    else if (a.startsWith("--input=")) flags.input = a.slice("--input=".length);
    else if (a === "--limit") flags.limit = Number.parseInt(argv[++i], 10);
    else if (a.startsWith("--limit=")) flags.limit = Number.parseInt(a.slice("--limit=".length), 10);
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: backfill:mas-bulk-combined-non-issue [--apply] [--input PATH] [--limit N]",
          "",
          "Default: dry-run plan, no writes.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (flags.limit !== null && Number.isNaN(flags.limit)) throw new Error("--limit must be a number");
  return flags;
}

interface InputRow {
  lineNumber: number;
  member: string;
  invoiceNumber: string;
  status: string;
}

interface ParsedInput {
  combinedRows: InputRow[];
  nonCombinedRows: InputRow[];
  emptyRows: number;
  duplicateInvoiceCount: number;
}

function parseInput(path: string): ParsedInput {
  const absPath = resolve(process.cwd(), path);
  const raw = readFileSync(absPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const combinedRows: InputRow[] = [];
  const nonCombinedRows: InputRow[] = [];
  let emptyRows = 0;
  const seenInvoices = new Set<string>();
  let duplicateInvoiceCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { emptyRows++; continue; }

    const cells = line.split("\t").map((c) => c.trim());
    if (cells.length < 3) continue;

    const [member, invoiceNumber, status] = cells;
    if (!invoiceNumber || invoiceNumber.toUpperCase() === "INVOICE") continue;

    const row: InputRow = { lineNumber: i + 1, member, invoiceNumber, status };
    if (!COMBINED_STATUS_RE.test(status)) {
      nonCombinedRows.push(row);
      continue;
    }

    if (seenInvoices.has(invoiceNumber)) { duplicateInvoiceCount++; continue; }
    seenInvoices.add(invoiceNumber);
    combinedRows.push(row);
  }

  return { combinedRows, nonCombinedRows, emptyRows, duplicateInvoiceCount };
}

interface MatchedGroup {
  row: InputRow;
  groupId: number;
  status: string;
  outcome: string;
}

interface UnmatchedRow {
  row: InputRow;
  reason: "no_group_for_invoice" | "not_in_needs_review";
  currentStatus?: string;
  currentOutcome?: string;
  groupId?: number;
}

async function matchInvoicesToGroups(rows: InputRow[]): Promise<{
  matched: MatchedGroup[];
  unmatched: UnmatchedRow[];
}> {
  const invoiceNumbers = rows.map((r) => r.invoiceNumber);
  const groups = invoiceNumbers.length === 0
    ? []
    : await db
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

  const matched: MatchedGroup[] = [];
  const unmatched: UnmatchedRow[] = [];
  for (const row of rows) {
    const g = byInvoice.get(row.invoiceNumber);
    if (!g) {
      unmatched.push({ row, reason: "no_group_for_invoice" });
      continue;
    }
    if (g.status !== "Needs Review") {
      unmatched.push({
        row,
        reason: "not_in_needs_review",
        currentStatus: g.status,
        currentOutcome: g.outcome,
        groupId: g.id,
      });
      continue;
    }
    matched.push({ row, groupId: g.id, status: g.status, outcome: g.outcome });
  }

  return { matched, unmatched };
}

interface ReportTotals {
  inputLines: number;
  inputCombinedRows: number;
  inputNonCombinedRows: number;
  inputDuplicates: number;
  uniqueCombinedInvoices: number;
  matched: number;
  unmatchedNoGroup: number;
  unmatchedNotInNeedsReview: number;
  closed: number;
  failed: number;
}

interface RunReport {
  totals: ReportTotals;
  matched: MatchedGroup[];
  unmatched: UnmatchedRow[];
  nonCombined: InputRow[];
  failures: { row: InputRow; groupId: number; error: string }[];
  applied: boolean;
}

export interface RunOptions {
  apply: boolean;
  input?: string;
  limit?: number;
  silent?: boolean;
}

export async function runBackfill(opts: RunOptions): Promise<RunReport> {
  const flags: CliFlags = {
    apply: opts.apply,
    input: opts.input ?? DEFAULT_INPUT,
    limit: opts.limit ?? null,
  };
  const log = opts.silent ? () => undefined : (msg: string) => console.log(msg);

  const parsed = parseInput(flags.input);
  log(
    `[parse] file=${flags.input} combined=${parsed.combinedRows.length} ` +
    `non-combined=${parsed.nonCombinedRows.length} duplicates=${parsed.duplicateInvoiceCount} ` +
    `empty=${parsed.emptyRows}`,
  );

  const { matched: allMatched, unmatched } = await matchInvoicesToGroups(parsed.combinedRows);
  const matched = flags.limit === null ? allMatched : allMatched.slice(0, flags.limit);

  const totals: ReportTotals = {
    inputLines: parsed.combinedRows.length + parsed.nonCombinedRows.length,
    inputCombinedRows: parsed.combinedRows.length,
    inputNonCombinedRows: parsed.nonCombinedRows.length,
    inputDuplicates: parsed.duplicateInvoiceCount,
    uniqueCombinedInvoices: parsed.combinedRows.length,
    matched: matched.length,
    unmatchedNoGroup: unmatched.filter((u) => u.reason === "no_group_for_invoice").length,
    unmatchedNotInNeedsReview: unmatched.filter((u) => u.reason === "not_in_needs_review").length,
    closed: 0,
    failed: 0,
  };

  const failures: RunReport["failures"] = [];

  for (const m of matched) {
    log(
      `  ✓ group#${m.groupId} (#${m.row.invoiceNumber}, member ${m.row.member}): ` +
      `Needs Review/Pending → Resolved/Non-Issue (closureReason=non_issue)`,
    );
    if (!flags.apply) continue;
    try {
      await applyClose(m);
      totals.closed++;
    } catch (err: any) {
      totals.failed++;
      const msg = err?.message ?? String(err);
      failures.push({ row: m.row, groupId: m.groupId, error: msg });
      log(`    ✗ FAILED group#${m.groupId}: ${msg}`);
    }
  }

  return {
    totals,
    matched,
    unmatched,
    nonCombined: parsed.nonCombinedRows,
    failures,
    applied: flags.apply,
  };
}

async function applyClose(m: MatchedGroup): Promise<void> {
  const triageNotes =
    `MAS portal verdict: Cancelled/Combined for invoice ${m.row.invoiceNumber} ` +
    `(member ${m.row.member}). Bulk-classified as non-issue from the 2026-05-02 ` +
    `MAS pull. Backfill: ${BACKFILL_ID}.`;

  const result = await transitionGroupStatusAndOutcome({
    groupId: m.groupId,
    newStatus: "Resolved",
    newOutcome: "Non-Issue",
    source: SOURCE,
    reason: `Classified as non-issue (MAS Cancelled/Combined): ${triageNotes}`,
    actor: SYSTEM_ACTOR,
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
    throw new Error(`transitionGroupStatusAndOutcome returned non-success for group ${m.groupId}`);
  }

  const auditRow = await db
    .insert(auditLogsTable)
    .values({
      claimId: null,
      invoiceGroupId: m.groupId,
      action: "mas_bulk_combined_classified",
      details:
        `MAS Bulk Combined Import: invoice ${m.row.invoiceNumber} (member ${m.row.member}) ` +
        `closed as Resolved/Non-Issue because the MAS portal returned Cancelled/Combined.`,
      metadata: {
        backfillId: BACKFILL_ID,
        source: SOURCE,
        member: m.row.member,
        invoiceNumber: m.row.invoiceNumber,
        masStatus: m.row.status,
        priorStatus: m.status,
        priorOutcome: m.outcome,
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
    invoiceGroupId: m.groupId,
    type: "system",
    content:
      `Closed via MAS bulk Combined import: portal returned Cancelled/Combined for invoice ` +
      `${m.row.invoiceNumber} (member ${m.row.member}). See audit entry #${auditRow[0]?.id ?? "?"} ` +
      `(action=mas_bulk_combined_classified).`,
    author: SYSTEM_ACTOR.userName,
  });
}

function printReport(report: RunReport, mode: "dry-run" | "apply"): void {
  console.log("\n===== MAS BULK COMBINED → NON-ISSUE — VERIFICATION REPORT =====");
  console.log(`mode:                                         ${mode}`);
  console.log(`input rows total:                             ${report.totals.inputLines}`);
  console.log(`  rows tagged Cancelled/Combined:             ${report.totals.inputCombinedRows} (after dedupe of ${report.totals.inputDuplicates} duplicate invoice(s))`);
  console.log(`  rows tagged something else (skipped):       ${report.totals.inputNonCombinedRows}`);
  console.log(`unique combined invoices to match:            ${report.totals.uniqueCombinedInvoices}`);
  console.log(`  matched & in Needs Review:                  ${report.totals.matched}`);
  console.log(`  unmatched — no group for invoice:           ${report.totals.unmatchedNoGroup}`);
  console.log(`  unmatched — not in Needs Review:            ${report.totals.unmatchedNotInNeedsReview}`);
  if (mode === "apply") {
    console.log(`closed (Resolved/Non-Issue):                  ${report.totals.closed}`);
    console.log(`failed:                                       ${report.totals.failed}`);
  }

  if (report.nonCombined.length > 0) {
    console.log("\nSkipped rows (status != Cancelled/Combined):");
    for (const r of report.nonCombined) {
      console.log(`  - line ${r.lineNumber}: ${r.member} ${r.invoiceNumber} → ${r.status}`);
    }
  }

  const noGroup = report.unmatched.filter((u) => u.reason === "no_group_for_invoice");
  if (noGroup.length > 0) {
    console.log("\nUnmatched — no invoice_group exists for invoice number:");
    for (const u of noGroup) {
      console.log(`  - line ${u.row.lineNumber}: ${u.row.member} ${u.row.invoiceNumber}`);
    }
  }

  const wrongStatus = report.unmatched.filter((u) => u.reason === "not_in_needs_review");
  if (wrongStatus.length > 0) {
    console.log("\nUnmatched — found but not in Needs Review (skipped, no write):");
    for (const u of wrongStatus) {
      console.log(`  - line ${u.row.lineNumber}: ${u.row.member} ${u.row.invoiceNumber} → group#${u.groupId} is ${u.currentStatus}/${u.currentOutcome}`);
    }
  }

  if (report.failures.length > 0) {
    console.log("\nWrite failures:");
    for (const f of report.failures) {
      console.log(`  - group#${f.groupId} invoice ${f.row.invoiceNumber}: ${f.error}`);
    }
  }

  if (mode === "dry-run") {
    console.log("\nNo writes performed. Re-run with --apply to commit.");
  } else if (report.totals.closed === 0) {
    console.log("\nNothing was closed.");
  } else {
    console.log(
      `\n✓ Closed ${report.totals.closed} group(s); each has a group_status_changed audit row, ` +
      `a mas_bulk_combined_classified audit row, and a system note.`,
    );
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const mode = flags.apply ? "apply" : "dry-run";
  console.log(
    `[backfill] mode=${mode} input=${flags.input}` +
    (flags.limit !== null ? ` limit=${flags.limit}` : ""),
  );
  const report = await runBackfill({
    apply: flags.apply,
    input: flags.input,
    limit: flags.limit ?? undefined,
  });
  printReport(report, mode);
}

const isMain = (() => {
  return (
    !!process.argv[1] &&
    process.argv[1].endsWith("2026-05-mas-bulk-combined-non-issue-backfill.ts")
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

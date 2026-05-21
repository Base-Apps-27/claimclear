// Portal orphan re-link backfill (Task #804).
//
// Generalizes the 2026-05-21 one-off SQL in
// `exports/link-orphan-portal-tickets-2026-05-21.sql` into a repeatable
// process. The submit-bot's retry path used to drop the previous portal
// ticket id when it created a new one on retry, leaving the earlier
// portal ticket "orphaned" — present on the portal but invisible to
// the scrape cron because nothing in `portal_submissions` pointed at it.
//
// This script:
//   1. Loads the portal index JSONL files under
//      `artifacts/api-server/exports/portal-index-batch-*.jsonl`
//      (one row per portal ticket observed during the index sweep).
//   2. Extracts an invoice number from each ticket subject via
//      `Invoice #(\d+)`.
//   3. Joins against `portal_submissions` (grouped by invoice number)
//      to classify every portal ticket as one of:
//        - tracked              — the orphan id is already pointed at by
//                                 a portal_submissions row on the same
//                                 invoice; nothing to do.
//        - already-linked       — a prior backfill run already inserted
//                                 a re-link row for this orphan id.
//        - orphan-with-sibling  — portal has the ticket but no
//                                 portal_submissions row references it;
//                                 at least one tracked sibling row
//                                 exists on the same invoice to clone.
//        - orphan-no-sibling    — orphan on portal, no sibling on file;
//                                 needs manual review (we will not
//                                 fabricate a portal_submissions row
//                                 from nothing).
//        - ambiguous            — the orphan id already appears in
//                                 `portal_submissions` but tied to a
//                                 DIFFERENT invoice number; flagged for
//                                 manual review, never auto-linked.
//        - no-invoice           — subject did not match `Invoice #\d+`;
//                                 logged for the operator and skipped.
//   4. Writes a JSONL dry-run report under
//      `artifacts/api-server/exports/orphan-backfill-report-<ts>.jsonl`
//      with one line per portal ticket and the classification, plus a
//      summary count to the console.
//   5. With `--apply`, inserts backfill `portal_submissions` rows for
//      every `orphan-with-sibling` ticket by cloning the most-recent
//      tracked sibling (by `submitted_at`, NULLs last) and swapping in
//      the orphan's `portal_ticket_id`. `last_scraped_at` is NULLed so
//      the existing scrape cron picks the row up on its next pass.
//
// Idempotency
//   The INSERT is guarded by `NOT EXISTS (… WHERE portal_ticket_id =
//   orphan AND invoice_number = invoice)`, so re-running with `--apply`
//   when nothing new has been observed inserts zero rows. The dry-run
//   report on a subsequent run will reclassify previously-backfilled
//   orphans as `already-linked`.
//
// Out of scope
//   * Fixing the underlying retry-overwrite bug (see the separate
//     "Submit-bot retry preserves prior portal ticket id" task).
//   * Scraping the orphan tickets themselves — the scrape cron pulls
//     them in on its next pass once the row exists.
//   * Touching `invoice_groups.triage_notes` or phase. The original
//     one-off SQL stamped triage notes for 4 specific invoices; that
//     was a human-curated narrative tied to specific portal decisions
//     and is intentionally NOT generalized here.
//
// Run
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/backfill-orphan-portal-tickets.ts [--apply] \
//     [--input "portal-index-batch-*.jsonl"] \
//     [--out exports/orphan-backfill-report-<ts>.jsonl]
//
// --input is resolved relative to `artifacts/api-server/exports/`, or
// you can pass an absolute path. Default pattern matches the four
// `portal-index-batch-*.jsonl` files produced by `scan-portal-index.ts`.
//
// Default is a DRY RUN that only writes the report. Pass `--apply` to
// also execute the INSERT against the connected DATABASE_URL. Re-running
// with `--apply` is safe: the dry-run report should show "already-linked"
// for previously-backfilled orphans on subsequent runs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inArray, sql } from "drizzle-orm";
import { db, portalSubmissionsTable } from "@workspace/db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPORTS_DIR = path.resolve(__dirname, "../../exports");

function getStrFlag(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i >= process.argv.length - 1) return fallback;
  return process.argv[i + 1];
}

type Classification =
  | "tracked"
  | "already-linked"
  | "orphan-with-sibling"
  | "orphan-no-sibling"
  | "ambiguous"
  | "no-invoice";

type IndexRow = {
  ticketId: string;
  subject: string | null;
  status: string | null;
  invoiceNumber: string | null;
  sourceFile: string;
};

type ReportRow = {
  ticketId: string;
  invoiceNumber: string | null;
  portalStatus: string | null;
  classification: Classification;
  siblingTicketId: string | null;
  siblingSubmissionId: number | null;
  ambiguousInvoiceNumbers: string[] | null;
  suggestedAction: "insert" | "already-linked" | "skip-no-sibling" | "manual-review" | "skip-tracked";
  note: string | null;
};

const INVOICE_RE = /Invoice\s*#\s*(\d+)/i;

function resolveInputFiles(pattern: string): string[] {
  // Support either an explicit path or a simple `*` glob anchored in
  // EXPORTS_DIR. We avoid pulling in the `glob` package to keep the
  // script's dependency surface minimal — the only pattern this script
  // is ever invoked with is `portal-index-batch-*.jsonl`.
  if (path.isAbsolute(pattern) && fs.existsSync(pattern)) return [pattern];
  const direct = path.resolve(EXPORTS_DIR, pattern);
  if (!pattern.includes("*") && fs.existsSync(direct)) return [direct];
  const dir = path.dirname(direct);
  const base = path.basename(direct);
  const re = new RegExp(
    "^" + base.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
  );
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => re.test(name))
    .map((name) => path.join(dir, name))
    .sort();
}

function loadIndexRows(patterns: string[]): IndexRow[] {
  const files = patterns.flatMap((p) => resolveInputFiles(p)).sort();
  if (files.length === 0) {
    throw new Error(
      `backfill-orphan-portal-tickets: no input files matched ${patterns.join(", ")}`,
    );
  }
  const rows: IndexRow[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let parsed: { ticketId?: string; subject?: string | null; status?: string | null; error?: string };
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed.error || !parsed.ticketId) continue;
      // De-dup by ticketId — same ticket can appear across overlapping
      // batches if an operator re-ran a page range.
      if (seen.has(parsed.ticketId)) continue;
      seen.add(parsed.ticketId);
      const m = parsed.subject ? parsed.subject.match(INVOICE_RE) : null;
      rows.push({
        ticketId: parsed.ticketId,
        subject: parsed.subject ?? null,
        status: parsed.status ?? null,
        invoiceNumber: m ? m[1] : null,
        sourceFile: path.basename(file),
      });
    }
  }
  return rows;
}

type PortalSubmissionLite = {
  id: number;
  invoiceNumber: string | null;
  portalTicketId: string | null;
  submittedAt: string | null;
};

async function loadSubmissionsForInvoices(invoices: string[]): Promise<PortalSubmissionLite[]> {
  if (invoices.length === 0) return [];
  const rows = await db
    .select({
      id: portalSubmissionsTable.id,
      invoiceNumber: portalSubmissionsTable.invoiceNumber,
      portalTicketId: portalSubmissionsTable.portalTicketId,
      submittedAt: portalSubmissionsTable.submittedAt,
    })
    .from(portalSubmissionsTable)
    .where(inArray(portalSubmissionsTable.invoiceNumber, invoices));
  return rows;
}

async function loadSubmissionsForTicketIds(ticketIds: string[]): Promise<PortalSubmissionLite[]> {
  if (ticketIds.length === 0) return [];
  const rows = await db
    .select({
      id: portalSubmissionsTable.id,
      invoiceNumber: portalSubmissionsTable.invoiceNumber,
      portalTicketId: portalSubmissionsTable.portalTicketId,
      submittedAt: portalSubmissionsTable.submittedAt,
    })
    .from(portalSubmissionsTable)
    .where(inArray(portalSubmissionsTable.portalTicketId, ticketIds));
  return rows;
}

// Most-recent sibling by submitted_at desc, NULLs last. submitted_at is
// stored as text in this schema (cron-supplied ISO strings), so a plain
// string compare is the right ordering.
function pickMostRecentSibling(siblings: PortalSubmissionLite[]): PortalSubmissionLite | null {
  if (siblings.length === 0) return null;
  const sorted = [...siblings].sort((a, b) => {
    const av = a.submittedAt ?? "";
    const bv = b.submittedAt ?? "";
    if (av === bv) return b.id - a.id;
    if (!av) return 1;
    if (!bv) return -1;
    return bv.localeCompare(av);
  });
  return sorted[0];
}

function classify(args: {
  row: IndexRow;
  submissionsByInvoice: Map<string, PortalSubmissionLite[]>;
  submissionsByTicketId: Map<string, PortalSubmissionLite[]>;
}): ReportRow {
  const { row, submissionsByInvoice, submissionsByTicketId } = args;

  if (!row.invoiceNumber) {
    return {
      ticketId: row.ticketId,
      invoiceNumber: null,
      portalStatus: row.status,
      classification: "no-invoice",
      siblingTicketId: null,
      siblingSubmissionId: null,
      ambiguousInvoiceNumbers: null,
      suggestedAction: "manual-review",
      note: "Subject did not match Invoice #\\d+",
    };
  }

  const existingForTicket = submissionsByTicketId.get(row.ticketId) ?? [];
  const sameInvoiceExisting = existingForTicket.filter((s) => s.invoiceNumber === row.invoiceNumber);
  const otherInvoiceExisting = existingForTicket.filter((s) => s.invoiceNumber !== row.invoiceNumber);

  // Refuse to auto-link if the orphan id is already used for a different
  // invoice — the task description requires manual review for that case.
  if (otherInvoiceExisting.length > 0) {
    return {
      ticketId: row.ticketId,
      invoiceNumber: row.invoiceNumber,
      portalStatus: row.status,
      classification: "ambiguous",
      siblingTicketId: null,
      siblingSubmissionId: null,
      ambiguousInvoiceNumbers: Array.from(
        new Set(otherInvoiceExisting.map((s) => s.invoiceNumber).filter((v): v is string => !!v)),
      ),
      suggestedAction: "manual-review",
      note: "portal_ticket_id already present in portal_submissions for a different invoice",
    };
  }

  const siblings = (submissionsByInvoice.get(row.invoiceNumber) ?? []).filter(
    (s) => s.portalTicketId !== row.ticketId,
  );

  if (sameInvoiceExisting.length > 0) {
    // Distinguish "this is the row we already track" (tracked) from "we
    // already inserted a backfill row for this orphan" (already-linked).
    // The tracked-sibling case has at least one OTHER sibling row on
    // the same invoice; the pure backfill case typically does too, but
    // either way the visible outcome — "row exists, scrape cron will
    // handle it" — is the same. We label "already-linked" when there is
    // ALSO a different sibling, since that's the post-backfill shape;
    // "tracked" when this is the only row on the invoice.
    const classification: Classification = siblings.length > 0 ? "already-linked" : "tracked";
    return {
      ticketId: row.ticketId,
      invoiceNumber: row.invoiceNumber,
      portalStatus: row.status,
      classification,
      siblingTicketId: siblings[0]?.portalTicketId ?? null,
      siblingSubmissionId: sameInvoiceExisting[0].id,
      ambiguousInvoiceNumbers: null,
      suggestedAction: classification === "already-linked" ? "already-linked" : "skip-tracked",
      note: null,
    };
  }

  // Orphan: portal has it, portal_submissions does not.
  const sibling = pickMostRecentSibling(siblings);
  if (!sibling) {
    return {
      ticketId: row.ticketId,
      invoiceNumber: row.invoiceNumber,
      portalStatus: row.status,
      classification: "orphan-no-sibling",
      siblingTicketId: null,
      siblingSubmissionId: null,
      ambiguousInvoiceNumbers: null,
      suggestedAction: "skip-no-sibling",
      note: "No portal_submissions row exists for this invoice — cannot synthesize a backfill from nothing",
    };
  }
  return {
    ticketId: row.ticketId,
    invoiceNumber: row.invoiceNumber,
    portalStatus: row.status,
    classification: "orphan-with-sibling",
    siblingTicketId: sibling.portalTicketId,
    siblingSubmissionId: sibling.id,
    ambiguousInvoiceNumbers: null,
    suggestedAction: "insert",
    note: null,
  };
}

async function applyInserts(toInsert: ReportRow[]): Promise<number> {
  if (toInsert.length === 0) return 0;
  // Mirrors the one-off SQL: clone the sibling row, swap in the orphan
  // portal_ticket_id, null last_scraped_at*, status='submitted', attempts=0,
  // submitted_at/created_at/updated_at = NOW().
  //
  // Idempotency / safety guards:
  //   * NOT EXISTS check is on portal_ticket_id ALONE (no invoice
  //     predicate) — the task requires refusing to insert if the orphan
  //     id is already present for ANY invoice, so the same ticket id
  //     cannot end up linked to two invoices even if state shifted
  //     between dry-run and --apply.
  //   * `ps.invoice_number = expected_invoice` is asserted alongside
  //     `ps.id = sibling_id` so a swapped/edited sibling row can't be
  //     cloned onto the wrong invoice.
  //
  // All eligible rows are sent in a single batched INSERT via a VALUES
  // join — one round-trip, atomic relative to the connection.
  const rows = toInsert.filter(
    (r): r is ReportRow & { invoiceNumber: string; siblingSubmissionId: number } =>
      !!r.siblingSubmissionId && !!r.invoiceNumber,
  );
  if (rows.length === 0) return 0;
  const valuesSql = sql.join(
    rows.map(
      (r) => sql`(${r.siblingSubmissionId}::int, ${r.invoiceNumber}::text, ${r.ticketId}::text)`,
    ),
    sql`, `,
  );
  const result = await db.execute(sql`
    INSERT INTO portal_submissions (
      status, issue_type, subject, requester_email, transportation_provider_name,
      phone_number, invoice_number, gps_breadcrumbs_available, description_html,
      attachment_urls, conf_number, service_date, ref_number, client_number,
      car_number, claim_amount, error_type_name, error_details, dispute_reason,
      evidence_notes, evidence_files, portal_ticket_id, error_message,
      submitted_at, attempts, created_at, updated_at, invoice_group_id,
      description_history, description_editor_email, description_editor_name,
      max_attempts, special_circumstances, understanding_readback,
      understanding_readback_at, legs, last_scraped_at, last_scrape_outcome,
      last_scrape_error
    )
    SELECT
      'submitted', ps.issue_type, ps.subject, ps.requester_email, ps.transportation_provider_name,
      ps.phone_number, ps.invoice_number, ps.gps_breadcrumbs_available, ps.description_html,
      ps.attachment_urls, ps.conf_number, ps.service_date, ps.ref_number, ps.client_number,
      ps.car_number, ps.claim_amount, ps.error_type_name, ps.error_details, ps.dispute_reason,
      ps.evidence_notes, ps.evidence_files,
      m.orphan, NULL,
      NOW()::text, 0, NOW(), NOW(),
      ps.invoice_group_id, ps.description_history, ps.description_editor_email,
      ps.description_editor_name, ps.max_attempts, ps.special_circumstances,
      ps.understanding_readback, ps.understanding_readback_at, ps.legs,
      NULL, NULL, NULL
    FROM portal_submissions ps
    JOIN (VALUES ${valuesSql}) AS m(sibling_id, invoice, orphan)
      ON ps.id = m.sibling_id
    WHERE ps.invoice_number = m.invoice
      AND NOT EXISTS (
        SELECT 1 FROM portal_submissions x
        WHERE x.portal_ticket_id = m.orphan
      )
  `);
  // drizzle node-postgres returns the QueryResult; rowCount is the
  // canonical "rows affected". A count lower than rows.length means the
  // NOT EXISTS guard tripped for some entries (already inserted, or
  // the orphan id surfaced on a different invoice since the dry-run) —
  // that's idempotency / cross-invoice safety working.
  return (result as { rowCount?: number | null }).rowCount ?? 0;
}

function writeReport(rows: ReportRow[], outPath: string): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const lines = rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length > 0 ? "\n" : "");
  fs.writeFileSync(outPath, lines);
}

function writeApplySql(rows: ReportRow[], outPath: string): void {
  // Sibling file the operator can hand-run against prod. Mirrors the
  // shape of `link-orphan-portal-tickets-2026-05-21.sql` but trimmed to
  // just the insert (no triage_notes — that part was case-specific).
  //
  // Sibling selection is keyed on `portal_submissions.id` (not on the
  // sibling's portal_ticket_id) so the SQL clones from the EXACT row
  // the classifier picked as the most-recent sibling. Joining by
  // (invoice, sibling_portal_ticket_id) like the original one-off SQL
  // would silently fan out and clone every row sharing that ticket id
  // on the invoice — a real risk now that we generalize the
  // "multiple siblings → pick most recent" rule.
  const inserts = rows.filter(
    (r): r is ReportRow & { invoiceNumber: string; siblingSubmissionId: number } =>
      r.suggestedAction === "insert" && !!r.invoiceNumber && r.siblingSubmissionId != null,
  );
  const header = `-- Portal orphan re-link backfill (generated ${new Date().toISOString()}).\n` +
    `-- Generated by artifacts/api-server/src/scripts/backfill-orphan-portal-tickets.ts\n` +
    `-- Re-running this script is safe: the NOT EXISTS guard makes the\n` +
    `-- INSERT idempotent on (invoice_number, portal_ticket_id).\n` +
    `-- Sibling rows are pinned by portal_submissions.id (the row the\n` +
    `-- classifier picked as the most-recent sibling by submitted_at),\n` +
    `-- so the clone is deterministic even when multiple rows share the\n` +
    `-- same sibling portal_ticket_id on an invoice.\n\n`;
  if (inserts.length === 0) {
    fs.writeFileSync(outPath, header + "-- No orphan-with-sibling rows to backfill.\n");
    return;
  }
  const values = inserts
    .map((r) => `  (${r.siblingSubmissionId}, '${r.invoiceNumber}', '${r.ticketId}')`)
    .join(",\n");
  const body = `BEGIN;\n\nINSERT INTO portal_submissions (\n` +
    `  status, issue_type, subject, requester_email, transportation_provider_name,\n` +
    `  phone_number, invoice_number, gps_breadcrumbs_available, description_html,\n` +
    `  attachment_urls, conf_number, service_date, ref_number, client_number,\n` +
    `  car_number, claim_amount, error_type_name, error_details, dispute_reason,\n` +
    `  evidence_notes, evidence_files, portal_ticket_id, error_message,\n` +
    `  submitted_at, attempts, created_at, updated_at, invoice_group_id,\n` +
    `  description_history, description_editor_email, description_editor_name,\n` +
    `  max_attempts, special_circumstances, understanding_readback,\n` +
    `  understanding_readback_at, legs, last_scraped_at, last_scrape_outcome,\n` +
    `  last_scrape_error\n` +
    `)\n` +
    `SELECT\n` +
    `  'submitted', ps.issue_type, ps.subject, ps.requester_email, ps.transportation_provider_name,\n` +
    `  ps.phone_number, ps.invoice_number, ps.gps_breadcrumbs_available, ps.description_html,\n` +
    `  ps.attachment_urls, ps.conf_number, ps.service_date, ps.ref_number, ps.client_number,\n` +
    `  ps.car_number, ps.claim_amount, ps.error_type_name, ps.error_details, ps.dispute_reason,\n` +
    `  ps.evidence_notes, ps.evidence_files,\n` +
    `  m.orphan, NULL, NOW()::text, 0, NOW(), NOW(),\n` +
    `  ps.invoice_group_id, ps.description_history, ps.description_editor_email,\n` +
    `  ps.description_editor_name, ps.max_attempts, ps.special_circumstances,\n` +
    `  ps.understanding_readback, ps.understanding_readback_at, ps.legs,\n` +
    `  NULL, NULL, NULL\n` +
    `FROM portal_submissions ps\n` +
    `JOIN (VALUES\n${values}\n) AS m(sibling_id, invoice, orphan)\n` +
    `  ON ps.id = m.sibling_id\n` +
    `WHERE ps.invoice_number = m.invoice\n` +
    `  AND NOT EXISTS (\n` +
    `    -- Refuse to insert if the orphan ticket id is already present\n` +
    `    -- for ANY invoice. This is both idempotency (re-running this\n` +
    `    -- SQL is a no-op) and the task's cross-invoice safety guard\n` +
    `    -- (the orphan id must never land on two different invoices).\n` +
    `    SELECT 1 FROM portal_submissions x\n` +
    `    WHERE x.portal_ticket_id = m.orphan\n` +
    `  );\n\n` +
    `-- Verify before commit:\n` +
    `SELECT invoice_number, portal_ticket_id\n` +
    `  FROM portal_submissions\n` +
    ` WHERE portal_ticket_id IN (${inserts.map((r) => `'${r.ticketId}'`).join(", ")})\n` +
    ` ORDER BY invoice_number, portal_ticket_id;\n\n` +
    `COMMIT;\n`;
  fs.writeFileSync(outPath, header + body);
}

async function main(): Promise<number> {
  const apply = process.argv.includes("--apply");
  const inputPattern = getStrFlag("input") ?? "portal-index-batch-*.jsonl";
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultOut = path.join(EXPORTS_DIR, `orphan-backfill-report-${ts}.jsonl`);
  const outPath = path.resolve(getStrFlag("out", defaultOut)!);
  const sqlOutPath = outPath.replace(/\.jsonl$/, ".sql");

  console.log(
    `[orphan-backfill] mode=${apply ? "APPLY" : "DRY-RUN"} input=${inputPattern} out=${outPath}`,
  );

  const indexRows = loadIndexRows([inputPattern]);
  console.log(`[orphan-backfill] loaded ${indexRows.length} portal ticket rows from index JSONLs`);

  const invoiceNumbers = Array.from(
    new Set(indexRows.map((r) => r.invoiceNumber).filter((v): v is string => !!v)),
  );
  const ticketIds = indexRows.map((r) => r.ticketId);

  const [byInvoice, byTicket] = await Promise.all([
    loadSubmissionsForInvoices(invoiceNumbers),
    loadSubmissionsForTicketIds(ticketIds),
  ]);
  console.log(
    `[orphan-backfill] loaded ${byInvoice.length} portal_submissions rows across ${invoiceNumbers.length} invoice(s); ${byTicket.length} match by portal_ticket_id`,
  );

  const submissionsByInvoice = new Map<string, PortalSubmissionLite[]>();
  for (const s of byInvoice) {
    if (!s.invoiceNumber) continue;
    const list = submissionsByInvoice.get(s.invoiceNumber) ?? [];
    list.push(s);
    submissionsByInvoice.set(s.invoiceNumber, list);
  }
  const submissionsByTicketId = new Map<string, PortalSubmissionLite[]>();
  for (const s of byTicket) {
    if (!s.portalTicketId) continue;
    const list = submissionsByTicketId.get(s.portalTicketId) ?? [];
    list.push(s);
    submissionsByTicketId.set(s.portalTicketId, list);
  }

  const report = indexRows.map((row) =>
    classify({ row, submissionsByInvoice, submissionsByTicketId }),
  );

  // Stable order: classification severity, then invoice, then ticket.
  const order: Record<Classification, number> = {
    "ambiguous": 0,
    "orphan-with-sibling": 1,
    "orphan-no-sibling": 2,
    "no-invoice": 3,
    "already-linked": 4,
    "tracked": 5,
  };
  report.sort((a, b) => {
    if (order[a.classification] !== order[b.classification]) {
      return order[a.classification] - order[b.classification];
    }
    if ((a.invoiceNumber ?? "") !== (b.invoiceNumber ?? "")) {
      return (a.invoiceNumber ?? "").localeCompare(b.invoiceNumber ?? "");
    }
    return a.ticketId.localeCompare(b.ticketId);
  });

  const counts: Record<Classification, number> = {
    "tracked": 0,
    "already-linked": 0,
    "orphan-with-sibling": 0,
    "orphan-no-sibling": 0,
    "ambiguous": 0,
    "no-invoice": 0,
  };
  for (const r of report) counts[r.classification] += 1;

  writeReport(report, outPath);
  writeApplySql(report, sqlOutPath);
  console.log(`[orphan-backfill] wrote dry-run report: ${outPath}`);
  console.log(`[orphan-backfill] wrote prod-ready SQL:  ${sqlOutPath}`);
  console.log(
    `[orphan-backfill] summary: ` +
      Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(" "),
  );

  if (!apply) {
    console.log(
      `[orphan-backfill] DRY-RUN complete. Re-run with --apply to insert ${counts["orphan-with-sibling"]} backfill row(s).`,
    );
    return 0;
  }

  const toInsert = report.filter((r) => r.suggestedAction === "insert");
  console.log(`[orphan-backfill] APPLY: inserting up to ${toInsert.length} backfill row(s)…`);
  const inserted = await applyInserts(toInsert);
  console.log(
    `[orphan-backfill] APPLY done. inserted=${inserted} skipped-by-NOT-EXISTS=${toInsert.length - inserted}`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

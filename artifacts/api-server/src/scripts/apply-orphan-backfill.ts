import { Client } from "pg";

const ORPHANS: Array<{ invoice: string; sibling: string; orphan: string }> = [
  { invoice: "1880499200", sibling: "92029", orphan: "92002" },
  { invoice: "1854504290", sibling: "92027", orphan: "91984" },
  { invoice: "1854504290", sibling: "92027", orphan: "91769" },
  { invoice: "1870389070", sibling: "92030", orphan: "91986" },
  { invoice: "1871101850", sibling: "92031", orphan: "92003" },
  { invoice: "1871101850", sibling: "92031", orphan: "91979" },
  { invoice: "1880992690", sibling: "92434", orphan: "92389" },
];

const BACKFILL_TAG = "[2026-05-21 orphan-backfill]";
const TRIAGE_NOTES: Array<{ invoiceGroupId: number; note: string }> = [
  {
    invoiceGroupId: 1262,
    note:
      `${BACKFILL_TAG} Linked orphan portal tickets #91769 and #91984 (sibling #92027, invoice 1854504290). Earlier bot retries created new portal tickets without recording prior ids; scrape cron will now pick them up.`,
  },
  {
    invoiceGroupId: 1241,
    note:
      `${BACKFILL_TAG} Linked orphan portal ticket #91986 (sibling #92030, invoice 1870389070). Portal status DENIED — Pickup Location Deviation, Leg 405063839, 4.42mi outside 0.90mi range.`,
  },
  {
    invoiceGroupId: 1245,
    note:
      `${BACKFILL_TAG} Linked orphan portal tickets #91979 and #92003 (sibling #92031, invoice 1871101850). Portal status APPROVED on both.`,
  },
  {
    invoiceGroupId: 1765,
    note:
      `${BACKFILL_TAG} Linked orphan portal ticket #92002 (sibling #92029, invoice 1880499200). Portal status APPROVED.`,
  },
];

async function main() {
  const url = process.env.PROD_DATABASE_URL;
  if (!url) throw new Error("PROD_DATABASE_URL not set");
  const apply = process.argv.includes("--apply");

  const c = new Client({ connectionString: url });
  await c.connect();
  console.log(`Connected to prod. Mode: ${apply ? "APPLY (will COMMIT)" : "DRY-RUN (will ROLLBACK)"}`);

  try {
    await c.query("BEGIN");

    // Show current state
    const before = await c.query(
      `SELECT portal_ticket_id, invoice_number, status
         FROM portal_submissions
        WHERE portal_ticket_id = ANY($1)
        ORDER BY portal_ticket_id`,
      [ORPHANS.map((o) => o.orphan)],
    );
    console.log(`\nBefore: ${before.rowCount} rows exist for the 7 orphan ticket ids`);
    for (const r of before.rows) console.log(`  ${r.portal_ticket_id} inv=${r.invoice_number} status=${r.status}`);

    // INSERT orphan rows
    const ins = await c.query(
      `
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
        m.orphan, NULL, NOW(), 0, NOW(), NOW(),
        ps.invoice_group_id, ps.description_history, ps.description_editor_email,
        ps.description_editor_name, ps.max_attempts, ps.special_circumstances,
        ps.understanding_readback, ps.understanding_readback_at, ps.legs,
        NULL, NULL, NULL
      FROM portal_submissions ps
      JOIN (VALUES
        ('1880499200','92029','92002'),
        ('1854504290','92027','91984'),
        ('1854504290','92027','91769'),
        ('1870389070','92030','91986'),
        ('1871101850','92031','92003'),
        ('1871101850','92031','91979'),
        ('1880992690','92434','92389')
      ) AS m(invoice, sibling, orphan)
        ON ps.invoice_number = m.invoice AND ps.portal_ticket_id = m.sibling
      WHERE NOT EXISTS (
        SELECT 1 FROM portal_submissions x
         WHERE x.portal_ticket_id = m.orphan AND x.invoice_number = m.invoice
      )
      RETURNING id, invoice_number, portal_ticket_id, invoice_group_id
      `,
    );
    console.log(`\nINSERT: ${ins.rowCount} new portal_submissions rows`);
    for (const r of ins.rows)
      console.log(`  +id=${r.id} inv=${r.invoice_number} portal=${r.portal_ticket_id} ig=${r.invoice_group_id}`);

    // Triage notes
    let noteUpdates = 0;
    for (const t of TRIAGE_NOTES) {
      const upd = await c.query(
        `
        UPDATE invoice_groups
           SET triage_notes = COALESCE(triage_notes, '') ||
             CASE WHEN COALESCE(triage_notes,'') = '' THEN '' ELSE E'\n' END || $2,
               updated_at = NOW()
         WHERE id = $1
           AND (triage_notes IS NULL OR triage_notes NOT LIKE '%' || $3 || '%')
         RETURNING id
        `,
        [t.invoiceGroupId, t.note, BACKFILL_TAG],
      );
      noteUpdates += upd.rowCount ?? 0;
      console.log(`  triage_notes invoice_group=${t.invoiceGroupId}: ${upd.rowCount} updated`);
    }

    // After state
    const after = await c.query(
      `SELECT portal_ticket_id, invoice_number, status,
              (last_scraped_at IS NULL) AS unscraped
         FROM portal_submissions
        WHERE portal_ticket_id = ANY($1)
        ORDER BY portal_ticket_id`,
      [ORPHANS.map((o) => o.orphan)],
    );
    console.log(`\nAfter: ${after.rowCount} rows now tied to the 7 orphan ticket ids`);
    for (const r of after.rows)
      console.log(`  ${r.portal_ticket_id} inv=${r.invoice_number} status=${r.status} unscraped=${r.unscraped}`);

    // Expectation check: 7 distinct orphan ids should all be present now
    const distinct = new Set(after.rows.map((r) => r.portal_ticket_id));
    if (distinct.size !== 7) {
      throw new Error(`Expected 7 distinct orphan portal_ticket_ids present, got ${distinct.size}`);
    }

    if (apply) {
      await c.query("COMMIT");
      console.log(`\nCOMMITTED. inserted=${ins.rowCount}, triage_note_updates=${noteUpdates}`);
    } else {
      await c.query("ROLLBACK");
      console.log(`\nROLLED BACK (dry-run). Re-run with --apply to commit.`);
    }
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("FAILED, rolled back:", (e as Error).message);
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

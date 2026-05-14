// Repair script: delete the 6 Freshdesk-404-page rows that were saved
// as if they were carrier replies (prod portal_responses ids 711, 712,
// 713, 714, 715, 735 — all created 2026-05-13 between 13:45 and 13:47).
//
// This is a sister script to `repair-280char-portal-responses-2026-05-13.ts`
// and addresses a SECOND variant of the page-chrome contamination
// caught while reviewing that fix:
//
//   * The original repair targeted `LENGTH(content)=280 AND content LIKE
//     '%/* theme */%'`, i.e. the inline-CSS / `window.store` shape of
//     the Freshdesk shell.
//   * After it ran, 19 rows at 280 chars remained. 6 of those are a
//     different shape: the Freshdesk 404 page body
//     ("The page you were looking for doesn't exist (404)…"). These
//     happen when the portal returns a 404 for a ticket id (deleted,
//     wrong tenant, malformed, or expired session).
//   * The other 13 are real carrier emails truncated mid-sentence by
//     the now-removed `slice(0, 280)`. Those are NOT garbage — only
//     incomplete — and are intentionally NOT touched here. A separate
//     "re-scrape and replace" job is the right fix for those.
//
// Code-side fixes (already in this same change):
//   1. `portal-reader.ts` — early return on `httpStatus >= 400` from
//      `page.goto`, plus a body-fingerprint guard at the top of
//      `parsePortalTicketHtml` that catches "doesn't exist (404)" and
//      `<title>Page not found</title>`.
//   2. `portal-response-sync.ts` — page-chrome guard broadened to
//      include the 404 body fingerprint as a third defensive layer.
//
// Phase reverts: all 5 affected invoice_groups (301, 308, 312, 316,
// 321) ALSO have at least one real, non-garbage `portal_responses`
// row, so deleting the 6 garbage rows does NOT leave any group
// stranded with zero responses. The current `phase='response_received'
// / status='Ready to Review'` on each group is correct (a real reply
// exists). This script therefore does NOT touch `invoice_groups`.
//
// Usage
// -----
//   tsx src/scripts/repair-404-portal-responses-2026-05-13.ts            # dry-run
//   tsx src/scripts/repair-404-portal-responses-2026-05-13.ts --apply    # commit
//
// `DATABASE_URL` must point at the database to repair. Run against
// `$PROD_DATABASE_URL` for production.

import { pool as dbPool } from "@workspace/db";

interface PoolLike {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}
interface PoolClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  release(): void;
}
const pool = dbPool as unknown as PoolLike;

const FOUR_OH_FOUR_FINGERPRINT = "%The page you were looking for%doesn%t exist%";

interface SurveyRow {
  response_id: number;
  invoice_group_id: number | null;
  submission_id: number | null;
  created_at: string;
  group_phase: string | null;
  group_status: string | null;
  other_responses_on_group: number;
}

async function survey(client: PoolClient): Promise<SurveyRow[]> {
  const r = await client.query(
    `
    SELECT pr.id AS response_id,
           pr.invoice_group_id,
           pr.submission_id,
           pr.created_at,
           ig.phase  AS group_phase,
           ig.status AS group_status,
           (
             SELECT COUNT(*)::int
             FROM portal_responses pr2
             WHERE pr2.invoice_group_id = pr.invoice_group_id
               AND pr2.id <> pr.id
               AND NOT (LENGTH(pr2.content)=280 AND pr2.content LIKE $1)
           ) AS other_responses_on_group
    FROM portal_responses pr
    LEFT JOIN invoice_groups ig ON ig.id = pr.invoice_group_id
    WHERE LENGTH(pr.content) = 280
      AND pr.content LIKE $1
    ORDER BY pr.id
    `,
    [FOUR_OH_FOUR_FINGERPRINT],
  );
  return r.rows as SurveyRow[];
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "APPLY (will commit)" : "dry-run (read-only)";
  console.log(`# Repair: 404-page portal-response contamination (2026-05-13)`);
  console.log(`# Mode: ${mode}\n`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const before = await survey(client);
    console.log(`## Survey (before)`);
    console.log(`Rows to delete: ${before.length}`);
    for (const row of before) {
      console.log(
        `  - response_id=${row.response_id}  invoice_group=${row.invoice_group_id}  submission=${row.submission_id}  group_phase=${row.group_phase}/${row.group_status}  other_real_responses_on_group=${row.other_responses_on_group}`,
      );
    }
    console.log("");

    if (before.length === 0) {
      console.log("Nothing to repair. Exiting.");
      await client.query("ROLLBACK");
      return;
    }

    // Safety check: every row must have at least one OTHER real
    // response on the same invoice_group. If any group has zero other
    // real responses, deleting the 404 row would leave the group at
    // `response_received` with an empty queue — abort and surface for
    // manual review instead of silently corrupting state.
    const stranded = before.filter(
      (r) => r.invoice_group_id !== null && r.other_responses_on_group === 0,
    );
    if (stranded.length > 0) {
      console.error(
        `ERROR: ${stranded.length} row(s) would leave their invoice_group with zero real responses.`,
      );
      console.error(`Refusing to apply. Investigate manually:`);
      for (const s of stranded) {
        console.error(
          `  - response_id=${s.response_id}  invoice_group=${s.invoice_group_id}`,
        );
      }
      await client.query("ROLLBACK");
      process.exitCode = 1;
      return;
    }

    const ids = before.map((r) => r.response_id);
    const del = await client.query(
      `DELETE FROM portal_responses WHERE id = ANY($1::int[])`,
      [ids],
    );
    console.log(`Deleted ${del.rowCount ?? 0} portal_responses row(s): [${ids.join(", ")}]`);

    const after = await survey(client);
    if (after.length !== 0) {
      console.error(`ERROR: post-condition failed — ${after.length} 404 rows still present.`);
      await client.query("ROLLBACK");
      process.exitCode = 1;
      return;
    }
    console.log(`\n## Post-condition`);
    console.log(`Remaining 404-page rows: 0`);

    if (apply) {
      await client.query("COMMIT");
      console.log(`\n# COMMITTED.`);
    } else {
      await client.query("ROLLBACK");
      console.log(`\n# DRY-RUN: rolled back. Re-run with --apply to commit.`);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => undefined));

// One-shot data-repair for the 2026-05 portal-response contamination.
//
// Background
// ----------
// `parsePortalTicketHtml` in `src/bot/portal-reader.ts` used to carry a
// "last-resort fallback": when neither Path A (`fw-comment-item`) nor
// Path B (`id="note_X"`) matched, it would synthesise a single fake
// "message" by hashing `stripTags(html)` of the entire page. For
// tickets with no carrier reply, that fake body was just the page
// chrome — the Freshdesk `<title>`, the inline `/* theme */` CSS
// variables, the `window.cspNonce` and `window.store = { ... }`
// bootstrap globals — which the LLM classifier obediently labelled
// `acknowledgment` (or, on really weird truncations, `other`). Combined
// with a hard `slice(0, 280)` in `portal-response-sync.ts:450`, every
// such row landed in the DB with `LENGTH(content) = 280` and a body
// that started with the page title and ran into the inline theme CSS.
//
// Survey at the time this script was authored:
//   - 722 rows in `portal_responses` matching the page-chrome
//     fingerprint (`LENGTH(content)=280 AND content LIKE '%/* theme */%'`),
//     all created in 2026-05.
//   - 45 distinct invoice_groups affected.
//   - Every affected group has ONLY garbage responses — there is no
//     real-response row to preserve. (Verified by the dry-run survey
//     query inside this script.)
//   - 25 of those groups were falsely promoted to
//     `phase='response_received' / status='Ready to Review'` because
//     `processPortalResponse` honoured the AI's `acknowledgment` /
//     `other` chip on the noise. They need to revert to
//     `phase='submitted' / status='Awaiting Response'`.
//   - 20 groups stayed at `submitted / Awaiting Response`; their
//     phase doesn't need to move.
//
// What this script does
// ---------------------
// 1. Re-runs the survey so the operator sees the *current* counts (not
//    the snapshot baked into this comment).
// 2. ABORTS LOUDLY if any affected group has even one non-garbage
//    response. The "delete + revert" repair is only safe when every
//    response on the group is garbage; mixing real and fake responses
//    on the same group means we'd need a per-row policy decision,
//    which this script intentionally does not encode.
// 3. In a single transaction, with --apply:
//      a. DELETE the garbage rows.
//      b. For groups that landed at `response_received / Ready to Review`
//         purely because of garbage, UPDATE phase='submitted',
//         status='Awaiting Response', phase_entered_at=NOW().
// 4. Re-runs the survey at the end and asserts zero garbage rows
//    remain. The script's stdout (printed list of every deleted row id
//    + every reverted group id) IS the audit trail; capture it when
//    invoking the script if you want a durable record.
//
// What this script DOES NOT do
// ----------------------------
// - Re-scrape any tickets. The parser fix and the page-chrome guard in
//   `portal-response-sync.ts` mean the next regular sync cron will
//   pick up real carrier replies (if any exist) without further
//   intervention. Re-scraping 45 tickets here would require taking
//   the portal browser gate, which conflicts with the live submit/
//   reader bots and is out of scope for a data-repair script.
// - Touch any group that has a mix of real and garbage responses (see
//   guard #2 above).
// - Run outside a single transaction. The DELETE + UPDATE must be
//   atomic so the operator queue never observes a half-applied repair.
//
// Usage
// -----
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/repair-280char-portal-responses-2026-05-13.ts
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/repair-280char-portal-responses-2026-05-13.ts --apply
//
// `DATABASE_URL` must point at the database to repair. Run against
// `$PROD_DATABASE_URL` for production.

import { pool as dbPool } from "@workspace/db";

// `dbPool` is re-exported from `@workspace/db` whose published types
// resolve to `void` in this consumer's tsconfig. Cast through a small
// structural shape so the script compiles without taking a hard
// dependency on `@types/pg` (which isn't a direct dep of
// `@workspace/api-server`).
interface PoolLike {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}
interface PoolClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  release(): void;
}
const pool = dbPool as unknown as PoolLike;

const PAGE_CHROME_FINGERPRINT = "%/* theme */%";

interface RepairSurvey {
  totalGarbageRows: number;
  affectedGroups: number;
  groupsWithMixedResponses: number;
  groupsToRevertPhase: number;
  groupsAlreadySubmitted: number;
}

async function survey(client: PoolClient): Promise<RepairSurvey> {
  // The mixed-response check uses `portal_responses.invoice_group_id`
  // directly (not the join through `portal_submissions`) so that any
  // real response on the affected group is counted — including
  // email-matched rows whose `submission_id` is NULL but whose
  // `invoice_group_id` is set by `processPortalResponse`. The narrower
  // join would silently miss those and let us revert phase on a group
  // that actually has a real response.
  const r = await client.query(
    `
    WITH garbage AS (
      SELECT id, invoice_group_id FROM portal_responses
      WHERE LENGTH(content)=280 AND content LIKE $1
    ),
    affected AS (
      -- Two sources for an "affected" group:
      --   (a) the garbage row itself carries invoice_group_id (the
      --       portal-sync path always populates it);
      --   (b) belt-and-braces: derive it via portal_submissions in
      --       case any garbage row was inserted by an older code path
      --       that left invoice_group_id NULL on the response itself.
      SELECT invoice_group_id AS group_id FROM garbage WHERE invoice_group_id IS NOT NULL
      UNION
      SELECT ps.invoice_group_id AS group_id
      FROM garbage g JOIN portal_submissions ps ON ps.id = g.invoice_group_id
      WHERE ps.invoice_group_id IS NOT NULL
    ),
    response_counts AS (
      SELECT pr.invoice_group_id AS group_id,
             COUNT(*) FILTER (WHERE NOT (LENGTH(pr.content)=280 AND pr.content LIKE $1)) AS non_garbage,
             COUNT(*) FILTER (WHERE LENGTH(pr.content)=280 AND pr.content LIKE $1) AS garbage
      FROM portal_responses pr
      WHERE pr.invoice_group_id IN (SELECT group_id FROM affected)
      GROUP BY pr.invoice_group_id
    )
    SELECT
      (SELECT COUNT(*) FROM garbage)::int                                             AS total_garbage_rows,
      (SELECT COUNT(*) FROM affected)::int                                             AS affected_groups,
      (SELECT COUNT(*) FROM response_counts WHERE non_garbage > 0)::int                AS groups_with_mixed,
      (SELECT COUNT(*) FROM invoice_groups
        WHERE id IN (SELECT group_id FROM affected)
          AND phase = 'response_received')::int                                        AS groups_to_revert,
      (SELECT COUNT(*) FROM invoice_groups
        WHERE id IN (SELECT group_id FROM affected)
          AND phase = 'submitted')::int                                                AS groups_already_submitted
    `,
    [PAGE_CHROME_FINGERPRINT],
  );
  const row = r.rows[0] as {
    total_garbage_rows: number;
    affected_groups: number;
    groups_with_mixed: number;
    groups_to_revert: number;
    groups_already_submitted: number;
  };
  return {
    totalGarbageRows: row.total_garbage_rows,
    affectedGroups: row.affected_groups,
    groupsWithMixedResponses: row.groups_with_mixed,
    groupsToRevertPhase: row.groups_to_revert,
    groupsAlreadySubmitted: row.groups_already_submitted,
  };
}

interface RepairPlan {
  garbageResponseIds: number[];
  groupsToRevertIds: number[];
  groupsToLeaveAlone: number[];
}

async function loadPlan(client: PoolClient): Promise<RepairPlan> {
  const garbage = await client.query(
    `SELECT id FROM portal_responses
     WHERE LENGTH(content)=280 AND content LIKE $1
     ORDER BY id`,
    [PAGE_CHROME_FINGERPRINT],
  );
  const groups = await client.query(
    `SELECT DISTINCT ig.id, ig.phase
     FROM invoice_groups ig
     JOIN portal_submissions ps ON ps.invoice_group_id = ig.id
     JOIN portal_responses pr ON pr.submission_id = ps.id
     WHERE LENGTH(pr.content)=280 AND pr.content LIKE $1
     ORDER BY ig.id`,
    [PAGE_CHROME_FINGERPRINT],
  );
  const garbageRows = garbage.rows as Array<{ id: number }>;
  const groupRows = groups.rows as Array<{ id: number; phase: string }>;
  return {
    garbageResponseIds: garbageRows.map((r) => r.id),
    groupsToRevertIds: groupRows.filter((g) => g.phase === "response_received").map((g) => g.id),
    groupsToLeaveAlone: groupRows.filter((g) => g.phase !== "response_received").map((g) => g.id),
  };
}

async function applyRepair(
  client: PoolClient,
  plan: RepairPlan,
): Promise<{ deleted: number; phaseReverted: number }> {
  if (plan.garbageResponseIds.length === 0) {
    return { deleted: 0, phaseReverted: 0 };
  }

  const del = await client.query(
    `DELETE FROM portal_responses WHERE id = ANY($1::int[])`,
    [plan.garbageResponseIds],
  );

  let reverted = 0;
  if (plan.groupsToRevertIds.length > 0) {
    const upd = await client.query(
      `UPDATE invoice_groups
         SET phase = 'submitted',
             status = 'Awaiting Response',
             phase_entered_at = NOW(),
             updated_at = NOW()
       WHERE id = ANY($1::int[])
         AND phase = 'response_received'`,
      [plan.groupsToRevertIds],
    );
    reverted = upd.rowCount ?? 0;
  }

  return { deleted: del.rowCount ?? 0, phaseReverted: reverted };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set. Refusing to run.");
    process.exit(2);
  }

  const client = await pool.connect();
  try {
    console.log(`# Repair: 280-char portal-response contamination (2026-05-13)`);
    console.log(`# Mode: ${apply ? "APPLY (write)" : "dry-run (read-only)"}`);
    console.log("");

    const before = await survey(client);
    console.log("## Survey (before)");
    console.log(JSON.stringify(before, null, 2));
    console.log("");

    if (before.totalGarbageRows === 0) {
      console.log("Nothing to repair. Exiting.");
      return;
    }
    if (before.groupsWithMixedResponses > 0) {
      console.error(
        `ABORT: ${before.groupsWithMixedResponses} group(s) have BOTH garbage and real responses.`,
      );
      console.error(
        "       This script's delete-then-revert policy only handles the all-garbage case.",
      );
      console.error("       Investigate manually before re-running.");
      process.exit(3);
    }

    const plan = await loadPlan(client);
    console.log("## Plan");
    console.log(`  - Delete ${plan.garbageResponseIds.length} portal_responses row(s)`);
    console.log(`  - Revert ${plan.groupsToRevertIds.length} invoice_group(s) from`);
    console.log(`    'response_received / Ready to Review' to 'submitted / Awaiting Response'`);
    console.log(`  - Leave ${plan.groupsToLeaveAlone.length} invoice_group(s) alone (already at 'submitted')`);
    console.log(`  - Group IDs to revert: ${plan.groupsToRevertIds.join(", ") || "(none)"}`);
    console.log("");

    if (!apply) {
      console.log("Dry-run complete. Re-run with --apply to make the changes.");
      return;
    }

    await client.query("BEGIN");
    try {
      const result = await applyRepair(client, plan);
      console.log("## Apply");
      console.log(`  - Deleted ${result.deleted} portal_responses row(s)`);
      console.log(`  - Reverted ${result.phaseReverted} invoice_group phase(s)`);

      const after = await survey(client);
      if (after.totalGarbageRows !== 0) {
        throw new Error(
          `Post-condition failed: ${after.totalGarbageRows} garbage row(s) still present after delete. Rolling back.`,
        );
      }

      await client.query("COMMIT");
      console.log("");
      console.log("## Survey (after)");
      console.log(JSON.stringify(after, null, 2));
      console.log("");
      console.log("Repair committed.");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});

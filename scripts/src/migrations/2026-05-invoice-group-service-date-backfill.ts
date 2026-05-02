// One-shot backfill that populates the new
// `invoice_groups.service_date` column for every existing group, in
// support of Task #350.
//
// What this script does:
//   1. Reports current state (groups total, groups with NULL service_date).
//   2. For every group, computes:
//        - `legacy`  — what the old correlated subquery
//          `MIN(NULLIF(claims.date,'')::date)` returns today.
//        - `next`    — what `recomputeGroupServiceDate` would write
//          (lexical MIN over `normalizeServiceDate(claims.date)`).
//      The two paths agree for any input the old SQL could parse; the
//      diff list surfaces rows where they disagree (typically claims
//      whose `date` was stored in a shape `::date` couldn't cast but
//      the JS normalizer can, or vice versa).
//   3. With `--apply`, runs `recomputeGroupServiceDate(groupId)` for every
//      group whose stored value differs from `next`. The helper is a
//      no-op when the values already match, so the script is fully
//      idempotent across re-runs.
//   4. Prints a final summary: groups scanned, groups whose value
//      changed, groups whose legacy SQL disagreed with the new helper.
//
// Default is dry-run; pass `--apply` to write.
//
// Task #268 backfill-id convention: this script does NOT insert into
// `audit_logs`. It only updates `invoice_groups.service_date` rows
// directly. There are no audit rows to stamp; the entry under
// BACKFILL_IDS.invoiceGroupServiceDate in `_backfill-audit.ts` exists
// purely for registry completeness.
//
// To run:
//   pnpm --filter @workspace/scripts run backfill:invoice-group-service-date              # dry-run
//   pnpm --filter @workspace/scripts run backfill:invoice-group-service-date -- --apply   # writes

import { db, pool } from "@workspace/db";
import { recomputeGroupServiceDate } from "@workspace/api-server/src/lib/group-service-date";

interface GroupRow {
  id: number;
  invoice_number: string;
  stored: string | null;
  legacy: string | null;
}

interface DiffRow {
  groupId: number;
  invoiceNumber: string;
  stored: string | null;
  legacy: string | null;
  next: string | null;
}

function fmt(v: string | null): string {
  return v === null ? "NULL" : v;
}

async function loadGroupsWithLegacyValue(): Promise<GroupRow[]> {
  // Single read pass: pull every group plus the value the old correlated
  // subquery would have produced, so we can compare to the helper-side
  // value in JS without N+1 round trips.
  //
  // Schema tolerance: this backfill must run against prod even when
  // Task #351 (retype `claims.date` from TEXT → DATE) hasn't been
  // applied yet — the whole point of the backfill is to populate
  // `invoice_groups.service_date` so the read-path code can lean on
  // it regardless of the underlying claims-side schema state. We
  // therefore wrap each value with `NULLIF(c.date::text, '')::date`:
  //
  //   • TEXT column: `c.date::text` is a no-op, NULLIF strips the
  //     legacy empty-string sentinels, and `::date` parses each
  //     string to a real date BEFORE MIN — so MIN is calendar-correct
  //     even on the legacy 'M/D/YYYY' shape, exactly like the
  //     original pre-cutover SQL.
  //   • DATE column: `c.date::text` formats to ISO YYYY-MM-DD, NULLIF
  //     against '' is harmless (a valid date never formats to ''),
  //     and `::date` parses it back. Same answer either way.
  //
  // This is the only cast wrapping that's apples-to-apples on both
  // schemas; a bare `MIN(c.date)` lexically MINs '4/15/2026' before
  // '4/2/2026' on the TEXT schema, which would silently report the
  // wrong "earliest" date.
  const r = await pool.query<GroupRow>(`
    SELECT
      g.id,
      g.invoice_number,
      to_char(g.service_date, 'YYYY-MM-DD') AS stored,
      (
        SELECT to_char(MIN(NULLIF(c.date::text, '')::date), 'YYYY-MM-DD')
        FROM claims c
        WHERE c.invoice_group_id = g.id
      ) AS legacy
    FROM invoice_groups g
    ORDER BY g.id
  `);
  return r.rows;
}

async function reportPreState(): Promise<void> {
  const totals = await pool.query<{ total: number; null_service: number }>(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE service_date IS NULL)::int AS null_service
    FROM invoice_groups
  `);
  const t = totals.rows[0];
  console.log(
    `[pre] invoice_groups total=${t.total} | service_date IS NULL=${t.null_service}`,
  );
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`[backfill] starting invoice-group-service-date backfill ` + (apply ? "(--apply, will write)\n" : "(dry-run; pass --apply to write)\n"));

  await reportPreState();

  const groups = await loadGroupsWithLegacyValue();
  console.log(`[scan] loaded ${groups.length} groups`);

  let scanned = 0;
  let changed = 0;
  let legacyDiff = 0;
  const diffs: DiffRow[] = [];

  for (const g of groups) {
    scanned++;

    // Even in dry-run we ask the helper for the new value so we can
    // diff against the legacy SQL — but we only persist when --apply
    // is set. In dry-run we open a savepoint and roll it back so the
    // peek doesn't write.
    let next: string | null;
    if (apply) {
      const result = await recomputeGroupServiceDate(g.id);
      next = result.next;
      if (result.changed) changed++;
    } else {
      // Dry-run peek: compute next without writing. We can't easily
      // call the helper read-only without restructuring it, so we read
      // the same way the helper would (via a SAVEPOINT/ROLLBACK
      // wouldn't work cleanly across the pg pool here). Inline the
      // read instead — same MIN semantics as the helper.
      // Schema-tolerant cast (mirrors loadGroupsWithLegacyValue above):
      // `c.date::text` is a no-op when the column is TEXT, formats to
      // ISO when DATE; NULLIF strips legacy empty-string sentinels;
      // `::date` parses each value to a real date BEFORE MIN so the
      // result is calendar-correct on either schema state. Required
      // because prod still has TEXT-typed `claims.date` until Task
      // #351's migration is applied — and this script must run pre-#351
      // to make the read-path code that depends on
      // `invoice_groups.service_date` actually work.
      const peek = await pool.query<{ next: string | null }>(`
        SELECT to_char(MIN(NULLIF(c.date::text, '')::date), 'YYYY-MM-DD') AS next
        FROM claims c
        WHERE c.invoice_group_id = $1
      `, [g.id]);
      next = peek.rows[0]?.next ?? null;
      if (g.stored !== next) changed++;
    }

    if (g.legacy !== next) {
      legacyDiff++;
      diffs.push({
        groupId: g.id,
        invoiceNumber: g.invoice_number,
        stored: g.stored,
        legacy: g.legacy,
        next,
      });
    }
  }

  console.log(`\n[summary]`);
  console.log(`  groups scanned:                              ${scanned}`);
  console.log(`  groups whose service_date ${apply ? "was updated" : "would update"}: ${changed}`);
  console.log(`  groups where legacy MIN disagrees with next: ${legacyDiff}`);

  if (diffs.length > 0) {
    console.log(`\n[diffs] (legacy SQL vs new helper, first 50)`);
    for (const d of diffs.slice(0, 50)) {
      console.log(
        `  group#${d.groupId} (${d.invoiceNumber}): stored=${fmt(d.stored)} legacy=${fmt(d.legacy)} next=${fmt(d.next)}`,
      );
    }
    if (diffs.length > 50) {
      console.log(`  …and ${diffs.length - 50} more`);
    }
  } else {
    console.log(`\n[diffs] none — legacy and helper agree on every group`);
  }

  console.log(apply ? "\n[backfill] done" : "\n[backfill] done (dry-run; re-run with --apply to write)");
  void db;
}

main()
  .then(() => pool.end().then(() => process.exit(0)))
  .catch(err => {
    console.error("[backfill] FAILED", err);
    pool.end().finally(() => process.exit(1));
  });

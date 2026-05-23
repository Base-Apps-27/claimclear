// Task #838 — daily purge sweep for the soft-delete + 30-day undo
// design. Hard-deletes claims/groups whose soft-delete stamp is older
// than 30 days, and clears the discarded-draft snapshot on groups
// whose `draft_discarded_at` is past the same window.
//
// `audit_logs.claim_id` and `audit_logs.invoice_group_id` are both
// `ON DELETE SET NULL`, so hard-deleting the parent row leaves the
// historical audit trail intact (rows just become unanchored). That
// means the purge is a true "forget the row, keep the story" sweep —
// no rewrite of older audit rows is needed.
//
// Returns a structured summary the cron wrapper logs into
// `cron_runs.metadata` for system-health visibility.

import { and, isNotNull, lt, or, sql } from "drizzle-orm";
import { db, claimsTable, invoiceGroupsTable } from "@workspace/db";

export const REMOVALS_RETENTION_DAYS = 30;

export interface RemovalsPurgeResult {
  claimsWithdrawnPurged: number;
  claimsRemovedOfflinePurged: number;
  groupsWithdrawnPurged: number;
  groupDraftSnapshotsCleared: number;
}

export async function purgeExpiredRemovals(
  now: Date = new Date(),
): Promise<RemovalsPurgeResult> {
  const cutoff = new Date(now.getTime() - REMOVALS_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Hard-delete claims whose only remaining undo signal is past the
  // retention window. We delete when EITHER stamp is past the cutoff
  // and the other is null-or-also-past — i.e. there is no remaining
  // soft-delete window that the row still belongs to.
  const withdrawnDeleted = await db
    .delete(claimsTable)
    .where(
      and(
        isNotNull(claimsTable.withdrawnAt),
        lt(claimsTable.withdrawnAt, cutoff),
        or(
          sql`${claimsTable.removedOfflineAt} IS NULL`,
          lt(claimsTable.removedOfflineAt, cutoff),
        ),
      ),
    )
    .returning({ id: claimsTable.id });

  const removedOfflineDeleted = await db
    .delete(claimsTable)
    .where(
      and(
        isNotNull(claimsTable.removedOfflineAt),
        lt(claimsTable.removedOfflineAt, cutoff),
        or(
          sql`${claimsTable.withdrawnAt} IS NULL`,
          lt(claimsTable.withdrawnAt, cutoff),
        ),
      ),
    )
    .returning({ id: claimsTable.id });

  const groupsWithdrawnDeleted = await db
    .delete(invoiceGroupsTable)
    .where(
      and(
        isNotNull(invoiceGroupsTable.withdrawnAt),
        lt(invoiceGroupsTable.withdrawnAt, cutoff),
      ),
    )
    .returning({ id: invoiceGroupsTable.id });

  // Discarded drafts are a snapshot on an otherwise-live group row —
  // we clear the three snapshot columns rather than dropping the
  // group itself. After the clear the group disappears from the
  // Recent-Removals listing because `draft_discarded_at` is null.
  const draftSnapshotsCleared = await db
    .update(invoiceGroupsTable)
    .set({
      draftDiscardedAt: null,
      draftDiscardedSubject: null,
      draftDiscardedDescriptionHtml: null,
    })
    .where(
      and(
        isNotNull(invoiceGroupsTable.draftDiscardedAt),
        lt(invoiceGroupsTable.draftDiscardedAt, cutoff),
      ),
    )
    .returning({ id: invoiceGroupsTable.id });

  return {
    claimsWithdrawnPurged: withdrawnDeleted.length,
    claimsRemovedOfflinePurged: removedOfflineDeleted.length,
    groupsWithdrawnPurged: groupsWithdrawnDeleted.length,
    groupDraftSnapshotsCleared: draftSnapshotsCleared.length,
  };
}

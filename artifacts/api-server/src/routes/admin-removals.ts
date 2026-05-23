// Task #838 — admin "Recent removals" surface.
//
// Lists every row carrying a soft-delete stamp (`claims.withdrawn_at`,
// `claims.removed_offline_at`, `invoice_groups.withdrawn_at`,
// `invoice_groups.draft_discarded_at`) inside the 30-day undo window
// and exposes a Restore button per kind that reverses the action and
// writes a dedicated `*_restored` audit row so the activity timeline
// keeps a coherent "what came back, and when" trail.
//
// Each listed item carries the original removal record's actor (email
// / display name) and reason note, sourced from the most recent
// matching audit row, so operators reviewing the page can answer
// "who removed this and why?" without leaving the page.
//
// Restore is reversible by construction: every restore stores the
// originating removal audit row's id in `metadata.restoredFromAuditLogId`
// so the activity timeline can link the restored row back to the
// removal it undoes.
//
// Restore handlers route through the existing canonical paths
// (`transitionClaimStatusAndOutcome`, `transitionGroupStatusAndOutcome`,
// `excludeLegCore`'s inverse via direct re-include) so derived-field
// caches, state-event emissions, and downstream side effects stay
// consistent with the normal include/transition flows.
//
// Anything older than the window has already been hard-deleted (rows)
// or had its snapshot columns cleared (discarded drafts) by the
// `removals_purge` cron, so the listing is bounded by construction.

import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
} from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAdmin } from "../middlewares/requireAdmin";
import { REMOVALS_RETENTION_DAYS } from "../lib/removals-purge";
import { transitionClaimStatusAndOutcome } from "../lib/claim-transitions";
import { transitionGroupStatusAndOutcome } from "../lib/group-transitions";
import { refreshClaimDenormalizedCache, refreshGroupDerivedFields } from "../lib/denormalized-cache";
import { recomputeGroupServiceDate } from "../lib/group-service-date";
import { emitStateEvent } from "../lib/state-events";

const router: IRouter = Router();

type RemovalKind =
  | "claim_withdrawn"
  | "claim_removed_offline"
  | "group_withdrawn"
  | "group_draft_discarded";

// Maps each removal kind to the canonical audit-log action(s) the
// original destructive op writes. The Recent-Removals listing joins
// each soft-deleted row against the most recent matching audit row
// so the response can carry actor + reason note + a stable
// `auditLogId` for the Restore handler to link back to.
const REMOVAL_AUDIT_ACTIONS: Record<RemovalKind, readonly string[]> = {
  claim_withdrawn: ["claim_outcome_changed", "status_and_outcome_changed"],
  claim_removed_offline: ["claim_removed_handled_offline"],
  group_withdrawn: ["group_outcome_changed", "group_status_and_outcome_changed"],
  group_draft_discarded: ["group_draft_discarded"],
};

interface RemovalItem {
  kind: RemovalKind;
  // Stable composite id used by the Restore button. `<kind>:<numericId>`
  // keeps the kind in the URL so the route handler never has to guess
  // which column to clear.
  id: string;
  refId: number;
  ref: string;
  type: string;
  removedAt: string;
  expiresAt: string;
  actorEmail: string | null;
  actorName: string | null;
  reasonNote: string | null;
  auditLogId: number | null;
  label: string;
  detail: string | null;
}

function cutoffDate(now: Date = new Date()): Date {
  return new Date(now.getTime() - REMOVALS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function expiry(stamp: Date): string {
  return new Date(stamp.getTime() + REMOVALS_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// Look up the most recent audit row that matches the removal action
// for a given claim/group id. Used to enrich the listing with actor
// and reason note, and to pin a stable `auditLogId` that the restore
// handler can store as `restoredFromAuditLogId` in its metadata.
async function findRemovalAudit(
  kind: RemovalKind,
  opts: { claimId?: number; groupId?: number; afterStamp: Date },
): Promise<{ id: number; userEmail: string | null; userName: string | null; reasonNote: string | null } | null> {
  const actions = REMOVAL_AUDIT_ACTIONS[kind];
  const whereParts = [
    inArray(auditLogsTable.action, actions as unknown as string[]),
    // Pin to audit rows written at-or-after the soft-delete stamp so
    // we never misattribute an older outcome flip to this removal.
    sql`${auditLogsTable.timestamp} >= ${opts.afterStamp}`,
  ];
  if (opts.claimId != null) whereParts.push(eq(auditLogsTable.claimId, opts.claimId));
  if (opts.groupId != null) whereParts.push(eq(auditLogsTable.invoiceGroupId, opts.groupId));

  const [row] = await db
    .select({
      id: auditLogsTable.id,
      userEmail: auditLogsTable.userEmail,
      userName: auditLogsTable.userName,
      details: auditLogsTable.details,
      metadata: auditLogsTable.metadata,
    })
    .from(auditLogsTable)
    .where(and(...whereParts))
    .orderBy(desc(auditLogsTable.timestamp))
    .limit(1);
  if (!row) return null;

  // Extract a human reason note from the audit row. Different removal
  // paths stash the note in slightly different shapes — handled_offline
  // puts it in `metadata.note`, withdraw outcome flips put it in
  // `metadata.reason` / `details` — so we look in both.
  const md = (row.metadata ?? {}) as Record<string, unknown>;
  const note =
    (typeof md.note === "string" ? md.note : null) ??
    (typeof md.reason === "string" ? md.reason : null) ??
    (typeof md.cannotDisputeReason === "string" ? md.cannotDisputeReason : null) ??
    (typeof row.details === "string" ? row.details : null);

  return {
    id: row.id,
    userEmail: row.userEmail,
    userName: row.userName,
    reasonNote: note,
  };
}

// GET /api/admin/removals — Recent removals listing.
router.get("/admin/removals", requireAdmin, asyncHandler(async (_req, res) => {
  const cutoff = cutoffDate();

  const claimRows = await db
    .select({
      id: claimsTable.id,
      confNumber: claimsTable.confNumber,
      withdrawnAt: claimsTable.withdrawnAt,
      removedOfflineAt: claimsTable.removedOfflineAt,
      closureReason: claimsTable.closureReason,
    })
    .from(claimsTable)
    .where(
      sql`(
        (${claimsTable.withdrawnAt} IS NOT NULL AND ${claimsTable.withdrawnAt} >= ${cutoff})
        OR
        (${claimsTable.removedOfflineAt} IS NOT NULL AND ${claimsTable.removedOfflineAt} >= ${cutoff})
      )`,
    );

  const groupRows = await db
    .select({
      id: invoiceGroupsTable.id,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
      withdrawnAt: invoiceGroupsTable.withdrawnAt,
      draftDiscardedAt: invoiceGroupsTable.draftDiscardedAt,
      draftDiscardedSubject: invoiceGroupsTable.draftDiscardedSubject,
    })
    .from(invoiceGroupsTable)
    .where(
      sql`(
        (${invoiceGroupsTable.withdrawnAt} IS NOT NULL AND ${invoiceGroupsTable.withdrawnAt} >= ${cutoff})
        OR
        (${invoiceGroupsTable.draftDiscardedAt} IS NOT NULL AND ${invoiceGroupsTable.draftDiscardedAt} >= ${cutoff})
      )`,
    );

  // Enrich each removed row with actor + reason note from the audit
  // log. We resolve one audit row per (kind, refId) and pin it to the
  // soft-delete stamp so older outcome flips can't shadow the actual
  // removal author.
  async function buildItem(args: {
    kind: RemovalKind;
    refId: number;
    refLabel: string;
    typeLabel: string;
    label: string;
    detail: string | null;
    stamp: Date;
    isGroup: boolean;
  }): Promise<RemovalItem> {
    const audit = await findRemovalAudit(args.kind, {
      claimId: args.isGroup ? undefined : args.refId,
      groupId: args.isGroup ? args.refId : undefined,
      afterStamp: args.stamp,
    });
    return {
      kind: args.kind,
      id: `${args.kind}:${args.refId}`,
      refId: args.refId,
      ref: args.refLabel,
      type: args.typeLabel,
      removedAt: args.stamp.toISOString(),
      expiresAt: expiry(args.stamp),
      actorEmail: audit?.userEmail ?? null,
      actorName: audit?.userName ?? null,
      reasonNote: audit?.reasonNote ?? null,
      auditLogId: audit?.id ?? null,
      label: args.label,
      detail: args.detail,
    };
  }

  const items: RemovalItem[] = [];
  for (const c of claimRows) {
    if (c.withdrawnAt) {
      items.push(await buildItem({
        kind: "claim_withdrawn",
        refId: c.id,
        refLabel: c.confNumber,
        typeLabel: "Claim withdrawn",
        label: `Claim ${c.confNumber}`,
        detail: "Withdrawn (Cannot Dispute)",
        stamp: c.withdrawnAt,
        isGroup: false,
      }));
    }
    if (c.removedOfflineAt) {
      items.push(await buildItem({
        kind: "claim_removed_offline",
        refId: c.id,
        refLabel: c.confNumber,
        typeLabel: "Claim — handled offline",
        label: `Claim ${c.confNumber}`,
        detail: "Removed — handled offline",
        stamp: c.removedOfflineAt,
        isGroup: false,
      }));
    }
  }
  for (const g of groupRows) {
    if (g.withdrawnAt) {
      items.push(await buildItem({
        kind: "group_withdrawn",
        refId: g.id,
        refLabel: g.invoiceNumber,
        typeLabel: "Invoice withdrawn",
        label: `Invoice ${g.invoiceNumber}`,
        detail: "Withdrawn (Cannot Dispute)",
        stamp: g.withdrawnAt,
        isGroup: true,
      }));
    }
    if (g.draftDiscardedAt) {
      items.push(await buildItem({
        kind: "group_draft_discarded",
        refId: g.id,
        refLabel: g.invoiceNumber,
        typeLabel: "Discarded draft",
        label: `Invoice ${g.invoiceNumber}`,
        detail: g.draftDiscardedSubject ? `Draft discarded — ${g.draftDiscardedSubject}` : "Draft discarded",
        stamp: g.draftDiscardedAt,
        isGroup: true,
      }));
    }
  }

  items.sort((a, b) => b.removedAt.localeCompare(a.removedAt));

  res.json({
    items,
    retentionDays: REMOVALS_RETENTION_DAYS,
  });
}));

// POST /api/admin/removals/:kind/:id/restore — Restore a removed row.
//
// Routes through the existing canonical paths (transition helpers, the
// same column writes the live undo paths perform) so derived-field
// caches, state-event emissions, and downstream side effects stay
// consistent with the normal include/transition flows. Every restore
// stores `restoredFromAuditLogId` in metadata pointing at the original
// removal audit row so the activity timeline can link the two.
router.post(
  "/admin/removals/:kind/:id/restore",
  requireAdmin,
  asyncHandler(async (req, res): Promise<void> => {
    const kind = String(req.params.kind) as RemovalKind;
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const actor = {
      userEmail: req.user?.email ?? null,
      userName: req.user?.displayName ?? null,
    };

    switch (kind) {
      case "claim_withdrawn": {
        const [before] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
        if (!before) { res.status(404).json({ error: "Claim not found" }); return; }
        if (before.withdrawnAt == null) {
          res.status(409).json({ error: "Claim is not in a withdrawn state" });
          return;
        }
        const removalAudit = await findRemovalAudit("claim_withdrawn", {
          claimId: id, afterStamp: before.withdrawnAt,
        });
        // Route through the canonical status+outcome transition so
        // every derived-cache + state-event refresh fires identically
        // to a manual unwind — withdrawn_at is cleared by the
        // transition helper when outcome leaves Withdrawn.
        await transitionClaimStatusAndOutcome({
          claimId: id,
          newStatus: "Needs Review",
          newOutcome: "Pending",
          source: "admin_restore",
          reason: "Restored from admin Recent removals (undo of Withdrawn)",
          actor,
          systemOverride: true,
        });
        const [restored] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
        const [auditRow] = await db.insert(auditLogsTable).values({
          claimId: id,
          invoiceGroupId: restored?.invoiceGroupId ?? null,
          action: "claim_withdraw_restored",
          details: "Withdraw undone via admin Recent removals",
          metadata: {
            kind,
            previousWithdrawnAt: before.withdrawnAt.toISOString(),
            restoredFromAuditLogId: removalAudit?.id ?? null,
            originalActorEmail: removalAudit?.userEmail ?? null,
            originalReasonNote: removalAudit?.reasonNote ?? null,
          },
          userEmail: actor.userEmail,
          userName: actor.userName,
        }).returning({ id: auditLogsTable.id });
        res.json({ ok: true, kind, id, restored, restoredFromAuditLogId: removalAudit?.id ?? null, auditLogId: auditRow?.id ?? null });
        return;
      }
      case "claim_removed_offline": {
        const [before] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
        if (!before) { res.status(404).json({ error: "Claim not found" }); return; }
        if (before.removedOfflineAt == null) {
          res.status(409).json({ error: "Claim is not in a handled-offline removed state" });
          return;
        }
        const removalAudit = await findRemovalAudit("claim_removed_offline", {
          claimId: id, afterStamp: before.removedOfflineAt,
        });
        // Mirror the side-effect pipeline of the live undo path
        // (POST /claims/:id/include with undoHandledOffline=true):
        // flip the column, refresh denormalized caches, recompute the
        // group's service date, emit the same `leg.included` state
        // event. The dedicated `claim_removed_handled_offline_undone`
        // audit row carries the restore linkage.
        const [restored] = await db
          .update(claimsTable)
          .set({ removedOfflineAt: null, includedInDispute: true })
          .where(eq(claimsTable.id, id))
          .returning();
        await refreshClaimDenormalizedCache(id);
        if (restored?.invoiceGroupId != null) {
          await refreshGroupDerivedFields(restored.invoiceGroupId);
          await recomputeGroupServiceDate(restored.invoiceGroupId);
        }
        await emitStateEvent({
          eventKey: "leg.included",
          claimId: id,
          invoiceGroupId: restored?.invoiceGroupId ?? null,
          actorUserId: actor.userEmail,
          metadata: { source: "admin_restore" },
        });
        const [auditRow] = await db.insert(auditLogsTable).values({
          claimId: id,
          invoiceGroupId: restored?.invoiceGroupId ?? null,
          action: "claim_removed_handled_offline_undone",
          details: "Handled-offline removal undone via admin Recent removals",
          metadata: {
            kind,
            previousRemovedOfflineAt: before.removedOfflineAt.toISOString(),
            source: "admin_restore",
            restoredFromAuditLogId: removalAudit?.id ?? null,
            originalActorEmail: removalAudit?.userEmail ?? null,
            originalReasonNote: removalAudit?.reasonNote ?? null,
          },
          userEmail: actor.userEmail,
          userName: actor.userName,
        }).returning({ id: auditLogsTable.id });
        res.json({ ok: true, kind, id, restored, restoredFromAuditLogId: removalAudit?.id ?? null, auditLogId: auditRow?.id ?? null });
        return;
      }
      case "group_withdrawn": {
        const [before] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
        if (!before) { res.status(404).json({ error: "Invoice group not found" }); return; }
        if (before.withdrawnAt == null) {
          res.status(409).json({ error: "Group is not in a withdrawn state" });
          return;
        }
        const removalAudit = await findRemovalAudit("group_withdrawn", {
          groupId: id, afterStamp: before.withdrawnAt,
        });
        // Canonical unwind through the group transition helper —
        // refreshes group-derived fields, fans out to children, emits
        // the canonical `group_status_and_outcome_changed` audit + wire
        // event so SSE subscribers see the same shape as a manual flip.
        await transitionGroupStatusAndOutcome({
          groupId: id,
          newStatus: "Needs Review",
          newOutcome: "Pending",
          source: "admin_restore",
          reason: "Restored from admin Recent removals (undo of Withdrawn)",
          actor,
          systemOverride: true,
        });
        const [restored] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
        const [auditRow] = await db.insert(auditLogsTable).values({
          invoiceGroupId: id,
          action: "group_withdraw_restored",
          details: "Group withdraw undone via admin Recent removals",
          metadata: {
            kind,
            previousWithdrawnAt: before.withdrawnAt.toISOString(),
            restoredFromAuditLogId: removalAudit?.id ?? null,
            originalActorEmail: removalAudit?.userEmail ?? null,
            originalReasonNote: removalAudit?.reasonNote ?? null,
          },
          userEmail: actor.userEmail,
          userName: actor.userName,
        }).returning({ id: auditLogsTable.id });
        res.json({ ok: true, kind, id, restored, restoredFromAuditLogId: removalAudit?.id ?? null, auditLogId: auditRow?.id ?? null });
        return;
      }
      case "group_draft_discarded": {
        const [before] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id));
        if (!before) { res.status(404).json({ error: "Invoice group not found" }); return; }
        if (before.draftDiscardedAt == null) {
          res.status(409).json({ error: "Group has no discarded draft to restore" });
          return;
        }
        const removalAudit = await findRemovalAudit("group_draft_discarded", {
          groupId: id, afterStamp: before.draftDiscardedAt,
        });
        // Discarded-draft restore is a column-level operation on the
        // live group row (the draft columns ARE the live UX state) —
        // there's no transition helper to route through. We refresh
        // group-derived fields after the write so downstream
        // readiness/gate computations pick up the repopulated draft.
        const [restored] = await db
          .update(invoiceGroupsTable)
          .set({
            draftSubject: before.draftDiscardedSubject,
            draftDescriptionHtml: before.draftDiscardedDescriptionHtml,
            draftEditedAt: new Date(),
            draftEditedBy: actor.userEmail,
            draftReviewedAt: null,
            draftReviewedBy: null,
            draftDiscardedAt: null,
            draftDiscardedSubject: null,
            draftDiscardedDescriptionHtml: null,
          })
          .where(eq(invoiceGroupsTable.id, id))
          .returning();
        await refreshGroupDerivedFields(id);
        await emitStateEvent({
          eventKey: "group.draft_edited",
          invoiceGroupId: id,
          actorUserId: actor.userEmail,
          metadata: {
            source: "admin_restore",
            restoredFromAuditLogId: removalAudit?.id ?? null,
          },
        });
        const [auditRow] = await db.insert(auditLogsTable).values({
          invoiceGroupId: id,
          action: "group_draft_discard_restored",
          details: "Dispute draft restored via admin Recent removals",
          metadata: {
            kind,
            previousDiscardedAt: before.draftDiscardedAt.toISOString(),
            restoredFromAuditLogId: removalAudit?.id ?? null,
            originalActorEmail: removalAudit?.userEmail ?? null,
            originalReasonNote: removalAudit?.reasonNote ?? null,
            restoredSubjectLength: before.draftDiscardedSubject?.length ?? 0,
            restoredDescriptionLength: before.draftDiscardedDescriptionHtml?.length ?? 0,
          },
          userEmail: actor.userEmail,
          userName: actor.userName,
        }).returning({ id: auditLogsTable.id });
        res.json({ ok: true, kind, id, restored, restoredFromAuditLogId: removalAudit?.id ?? null, auditLogId: auditRow?.id ?? null });
        return;
      }
      default: {
        res.status(400).json({ error: `Unknown removal kind: ${kind}` });
        return;
      }
    }
  }),
);

export default router;

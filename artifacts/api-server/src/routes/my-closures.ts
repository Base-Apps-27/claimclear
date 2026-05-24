// /api/my-closures — Task #889 Responsible-Party self-serve portal.
//
// Surface contract (one named action per endpoint, per
// endpoint-action-contract):
//   GET    /api/my-closures              — list closures routed to this user's
//                                          responsible role(s)
//   POST   /api/my-closures/:kind/:id/address  — mark addressed (≥10-char note)
//   POST   /api/my-closures/:kind/:id/reopen   — reopen within 24h of the
//                                                user's own acknowledgement
//
// Authoritative role check: roles are re-read from `users.responsible_roles`
// on every request rather than trusting the session-cached AuthUser so an
// admin revocation takes effect on the next request, not on the next login.
//
// Refusal paths (400/403/404/409) must not mutate any row.

import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  usersTable,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
} from "@workspace/db";
import {
  CLOSURE_RESPONSIBILITIES,
  RESPONSIBILITY_TO_ROLE,
  type ClosureResponsibility,
  type ClosureResponsibleRole,
} from "@workspace/closure-responsibility";
import { asyncHandler } from "../lib/asyncHandler";
import { getResponsibleRoles, hasResponsibleRole } from "../lib/role";
import { fetchAllRows, type WithdrawalRow } from "./withdrawals";
import { broadcastClaimEvent, broadcastGroupEvent } from "../lib/sse";
import { scheduleResponsiblePartyDigest } from "../lib/responsible-party-notify";

const router: IRouter = Router();

const ADDRESS_NOTE_MIN_LENGTH = 10;
const SELF_REOPEN_WINDOW_MS = 24 * 60 * 60 * 1000;

// Pull current responsible_roles from DB so admin revocations take effect
// immediately. Returns `null` for unauthenticated requests; callers should
// 401 in that case (requireAuth is already mounted upstream but we guard
// once here as a belt-and-braces against future router-reshuffles).
async function loadCurrentRoles(req: Request): Promise<ClosureResponsibleRole[] | null> {
  if (!req.isAuthenticated() || !req.user?.id) return null;
  const [row] = await db
    .select({ responsibleRoles: usersTable.responsibleRoles })
    .from(usersTable)
    .where(eq(usersTable.id, String(req.user.id)));
  if (!row) return [];
  return getResponsibleRoles(row.responsibleRoles);
}

function responsibilitiesForRoles(roles: ClosureResponsibleRole[]): ClosureResponsibility[] {
  return CLOSURE_RESPONSIBILITIES.filter(r =>
    roles.includes(RESPONSIBILITY_TO_ROLE[r]),
  );
}

// Reusable row lookup that scopes to the user's roles. Returns:
//   { ok: true, row }  if the row exists AND is reachable by this user
//   { ok: false, code } otherwise — caller forwards code to res.status.
type RowLookup =
  | { ok: true; row: WithdrawalRow }
  | { ok: false; code: 400 | 403 | 404; error: string };

async function findScopedRow(
  kind: "claim" | "invoice_group",
  id: number,
  roles: ClosureResponsibleRole[],
): Promise<RowLookup> {
  if (roles.length === 0) {
    return { ok: false, code: 403, error: "No responsible roles assigned" };
  }
  const responsibilities = responsibilitiesForRoles(roles);
  if (responsibilities.length === 0) {
    return { ok: false, code: 403, error: "No closure responsibilities mapped to roles" };
  }

  // Use the shared withdrawals fetcher so /my-closures and /withdrawals
  // can never diverge on which rows count as "in scope". `hideAddressed`
  // off because addressed rows must still be reachable to support reopen.
  const rows = await fetchAllRows({
    closureResponsibility: responsibilities.join(","),
    hideAddressed: "false",
  });
  const row = rows.find(r => r.kind === kind && r.id === id);
  if (!row) {
    // Distinguish "exists but wrong role" from "does not exist" so the
    // client gets the right message — but never reveal *which*
    // responsibility a foreign row carries.
    const exists = kind === "claim"
      ? (await db.select({ id: claimsTable.id }).from(claimsTable).where(eq(claimsTable.id, id))).length > 0
      : (await db.select({ id: invoiceGroupsTable.id }).from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id))).length > 0;
    if (exists) {
      return { ok: false, code: 403, error: "Closure not assigned to your role" };
    }
    return { ok: false, code: 404, error: "Closure not found" };
  }
  return { ok: true, row };
}

// ─── GET /api/my-closures ─────────────────────────────────────────────────
router.get("/my-closures", asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const roles = await loadCurrentRoles(req);
  if (roles === null) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (roles.length === 0) {
    res.json({ rows: [], roles: [], counts: { total: 0, awaiting: 0, addressed: 0 } });
    return;
  }

  // Task #889 spec: multi-role users MUST pass ?role=<role_id>;
  // server returns 400 if missing, 403 if the user doesn't hold the
  // role they requested. Single-role users may omit it.
  const requestedRole = typeof req.query.role === "string" ? req.query.role.trim() : "";
  let activeRoles: ClosureResponsibleRole[];
  if (roles.length > 1) {
    if (!requestedRole) {
      res.status(400).json({ error: "role query parameter is required for multi-role users", roles });
      return;
    }
    if (!roles.includes(requestedRole as ClosureResponsibleRole)) {
      res.status(403).json({ error: "You do not hold the requested role" });
      return;
    }
    activeRoles = [requestedRole as ClosureResponsibleRole];
  } else if (requestedRole && !roles.includes(requestedRole as ClosureResponsibleRole)) {
    res.status(403).json({ error: "You do not hold the requested role" });
    return;
  } else {
    activeRoles = roles;
  }

  const responsibilities = responsibilitiesForRoles(activeRoles);
  if (responsibilities.length === 0) {
    res.json({ rows: [], roles, activeRoles, counts: { total: 0, awaiting: 0, addressed: 0, addressedLast30d: 0 } });
    return;
  }

  const rows = await fetchAllRows({
    closureResponsibility: responsibilities.join(","),
    hideAddressed: "false",
  });

  const cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const addressedLast30d = rows.filter(r => {
    if (!r.addressed || !r.closureAddressedAt) return false;
    const t = new Date(r.closureAddressedAt).getTime();
    return Number.isFinite(t) && t >= cutoff30d;
  }).length;

  res.json({
    rows,
    roles,
    activeRoles,
    counts: {
      total: rows.length,
      awaiting: rows.filter(r => !r.addressed).length,
      addressed: rows.filter(r => r.addressed).length,
      addressedLast30d,
    },
  });
}));

// ─── POST /api/my-closures/:kind/:id/address ──────────────────────────────
router.post("/my-closures/:kind/:id/address", asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const kindParam = req.params.kind;
  const id = parseInt(req.params.id as string, 10);
  if ((kindParam !== "claim" && kindParam !== "invoice_group") || !Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid kind or id" });
    return;
  }
  const kind = kindParam as "claim" | "invoice_group";

  const body = req.body ?? {};
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const updatedAtFromClient = typeof body.updatedAt === "string" ? body.updatedAt : null;
  if (note.length < ADDRESS_NOTE_MIN_LENGTH) {
    res.status(400).json({ error: `note must be at least ${ADDRESS_NOTE_MIN_LENGTH} characters` });
    return;
  }

  const roles = await loadCurrentRoles(req);
  if (roles === null) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const lookup = await findScopedRow(kind, id, roles);
  if (!lookup.ok) {
    res.status(lookup.code).json({ error: lookup.error });
    return;
  }
  const row = lookup.row;

  if (row.addressed) {
    res.status(409).json({
      error: "Closure already addressed",
      reviewState: row.closureReviewState,
      addressedAt: row.closureAddressedAt,
      addressedBy: row.closureAddressedBy,
    });
    return;
  }

  // Stale-write guard: if the client passed the row's updatedAt snapshot,
  // refuse if the row has moved underneath them so the operator-side
  // closure-review handler and this portal don't clobber each other.
  if (updatedAtFromClient) {
    const tableUpdatedAt = kind === "claim"
      ? (await db.select({ updatedAt: claimsTable.updatedAt }).from(claimsTable).where(eq(claimsTable.id, id)))[0]?.updatedAt
      : (await db.select({ updatedAt: invoiceGroupsTable.updatedAt }).from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)))[0]?.updatedAt;
    if (tableUpdatedAt && new Date(updatedAtFromClient).getTime() < tableUpdatedAt.getTime()) {
      res.status(409).json({ error: "Closure was updated by someone else — please refresh" });
      return;
    }
  }

  const now = new Date();
  const userEmail = req.user?.email ?? null;
  const userName = req.user?.displayName ?? null;

  const update: Record<string, unknown> = {
    closureReviewState: "acknowledged_by_party",
    closureAddressedAt: now,
    closureAddressedBy: userName,
    closureAddressedByEmail: userEmail,
    // Persist the supervisor's note alongside whatever operator-side
    // notes already exist by appending — preserving prior history.
    closureReviewNotes: appendPortalNote(row.closureReviewNotes, note, userName, now),
    updatedAt: now,
  };

  if (kind === "claim") {
    const [updated] = await db
      .update(claimsTable)
      .set(update)
      .where(and(
        eq(claimsTable.id, id),
        // Null-safe CAS: legacy rows have NULL closure_review_state and
        // would otherwise miss the predicate (eq(col, '') is never true).
        row.closureReviewState == null
          ? isNull(claimsTable.closureReviewState)
          : eq(claimsTable.closureReviewState, row.closureReviewState),
      ))
      .returning({ id: claimsTable.id });
    if (!updated) {
      // Conditional update missed — the row's review state changed
      // between our read and our write. Race condition; refuse without
      // mutating anything else.
      res.status(409).json({ error: "Closure state changed — please refresh" });
      return;
    }
    await db.insert(auditLogsTable).values({
      claimId: id,
      action: "closure_addressed_by_responsible_party",
      details: note,
      userEmail,
      userName,
      metadata: {
        // Task #889 spec contract: every portal-side audit row carries
        // role/note/scope so downstream consumers (digest, compliance
        // export) don't need to re-derive provenance from the action
        // string.
        scope: "self_serve_portal",
        role: row.closureResponsibility ? RESPONSIBILITY_TO_ROLE[row.closureResponsibility as ClosureResponsibility] ?? null : null,
        note,
        source: "my_closures",
        closureResponsibility: row.closureResponsibility,
        previousReviewState: row.closureReviewState,
      },
    });
    broadcastClaimEvent({ type: "claim_edited", claimId: id, userName, userEmail, timestamp: now.toISOString() });
  } else {
    const [updated] = await db
      .update(invoiceGroupsTable)
      .set(update)
      .where(and(
        eq(invoiceGroupsTable.id, id),
        row.closureReviewState == null
          ? isNull(invoiceGroupsTable.closureReviewState)
          : eq(invoiceGroupsTable.closureReviewState, row.closureReviewState),
      ))
      .returning({ id: invoiceGroupsTable.id });
    if (!updated) {
      res.status(409).json({ error: "Closure state changed — please refresh" });
      return;
    }
    await db.insert(auditLogsTable).values({
      invoiceGroupId: id,
      action: "closure_addressed_by_responsible_party",
      details: note,
      userEmail,
      userName,
      metadata: {
        scope: "self_serve_portal",
        role: row.closureResponsibility ? RESPONSIBILITY_TO_ROLE[row.closureResponsibility as ClosureResponsibility] ?? null : null,
        note,
        source: "my_closures",
        closureResponsibility: row.closureResponsibility,
        previousReviewState: row.closureReviewState,
      },
    });
    broadcastGroupEvent({ type: "group_edited", invoiceGroupId: id, userName, userEmail, timestamp: now.toISOString() });
  }

  res.json({
    ok: true,
    kind,
    id,
    reviewState: "acknowledged_by_party",
    addressedAt: now.toISOString(),
    addressedBy: userName,
    addressedByEmail: userEmail,
  });
}));

// ─── POST /api/my-closures/:kind/:id/reopen ───────────────────────────────
// Self-reopen is permitted only within 24h of the user's OWN
// acknowledgement. Past that window, only an operator can reopen via the
// Withdrawals page (out of scope here).
router.post("/my-closures/:kind/:id/reopen", asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const kindParam = req.params.kind;
  const id = parseInt(req.params.id as string, 10);
  if ((kindParam !== "claim" && kindParam !== "invoice_group") || !Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid kind or id" });
    return;
  }
  const kind = kindParam as "claim" | "invoice_group";

  const body = req.body ?? {};
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length < ADDRESS_NOTE_MIN_LENGTH) {
    res.status(400).json({ error: `note must be at least ${ADDRESS_NOTE_MIN_LENGTH} characters` });
    return;
  }

  const roles = await loadCurrentRoles(req);
  if (roles === null) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const lookup = await findScopedRow(kind, id, roles);
  if (!lookup.ok) {
    res.status(lookup.code).json({ error: lookup.error });
    return;
  }
  const row = lookup.row;
  const userEmail = req.user?.email ?? null;

  if (row.closureReviewState !== "acknowledged_by_party") {
    res.status(409).json({ error: "Only portal-acknowledged closures can be reopened from here" });
    return;
  }
  if (!row.closureAddressedByEmail || (userEmail ?? "").toLowerCase() !== row.closureAddressedByEmail.toLowerCase()) {
    res.status(403).json({ error: "Only the user who acknowledged this closure may reopen it" });
    return;
  }
  if (!row.closureAddressedAt) {
    res.status(409).json({ error: "Missing acknowledgement timestamp — cannot reopen" });
    return;
  }
  const acknowledgedAt = new Date(row.closureAddressedAt).getTime();
  if (Number.isNaN(acknowledgedAt) || Date.now() - acknowledgedAt > SELF_REOPEN_WINDOW_MS) {
    res.status(403).json({ error: "Self-reopen window (24h) has expired" });
    return;
  }

  const now = new Date();
  const userName = req.user?.displayName ?? null;
  // Task #889 spec: reopen clears the same acknowledgement fields back
  // to pending. The reopen note is captured on the audit row (below)
  // rather than appended to closure_review_notes, so the per-row text
  // doesn't grow indefinitely on repeated ack/reopen cycles.
  const update: Record<string, unknown> = {
    closureReviewState: "pending",
    closureAddressedAt: null,
    closureAddressedBy: null,
    closureAddressedByEmail: null,
    closureReviewNotes: null,
    updatedAt: now,
  };

  if (kind === "claim") {
    const [updated] = await db
      .update(claimsTable)
      .set(update)
      .where(and(eq(claimsTable.id, id), eq(claimsTable.closureReviewState, "acknowledged_by_party")))
      .returning({ id: claimsTable.id });
    if (!updated) {
      res.status(409).json({ error: "Closure state changed — please refresh" });
      return;
    }
    await db.insert(auditLogsTable).values({
      claimId: id,
      action: "closure_reopened_by_responsible_party",
      details: note,
      userEmail,
      userName,
      metadata: {
        scope: "self_serve_portal",
        role: row.closureResponsibility ? RESPONSIBILITY_TO_ROLE[row.closureResponsibility as ClosureResponsibility] ?? null : null,
        note,
        source: "my_closures",
        closureResponsibility: row.closureResponsibility,
      },
    });
    broadcastClaimEvent({ type: "claim_edited", claimId: id, userName, userEmail, timestamp: now.toISOString() });
  } else {
    const [updated] = await db
      .update(invoiceGroupsTable)
      .set(update)
      .where(and(eq(invoiceGroupsTable.id, id), eq(invoiceGroupsTable.closureReviewState, "acknowledged_by_party")))
      .returning({ id: invoiceGroupsTable.id });
    if (!updated) {
      res.status(409).json({ error: "Closure state changed — please refresh" });
      return;
    }
    await db.insert(auditLogsTable).values({
      invoiceGroupId: id,
      action: "closure_reopened_by_responsible_party",
      details: note,
      userEmail,
      userName,
      metadata: {
        scope: "self_serve_portal",
        role: row.closureResponsibility ? RESPONSIBILITY_TO_ROLE[row.closureResponsibility as ClosureResponsibility] ?? null : null,
        note,
        source: "my_closures",
        closureResponsibility: row.closureResponsibility,
      },
    });
    broadcastGroupEvent({ type: "group_edited", invoiceGroupId: id, userName, userEmail, timestamp: now.toISOString() });
  }

  // Re-notify the responsible-party digest so the row reappears in the
  // batched email. Skipped silently if the feature flag is off.
  scheduleResponsiblePartyDigest({
    kind,
    id,
    responsibility: row.closureResponsibility,
  });

  res.json({ ok: true, kind, id, reviewState: "pending" });
}));

// Append a portal-side note to the existing closureReviewNotes field
// (preserving operator notes verbatim). Uses a small machine-readable
// separator so future ingestion / audit-rendering can split if needed.
function appendPortalNote(
  existing: string | null,
  note: string,
  userName: string | null,
  at: Date,
): string {
  const stamp = `[${at.toISOString()} · ${userName ?? "responsible party"}]`;
  const block = `${stamp} ${note}`;
  if (!existing || !existing.trim()) return block;
  return `${existing.trim()}\n\n${block}`;
}

// Used by /my-closures freshly-acknowledged hook so the digest mailer
// re-fires only for rows that genuinely flipped state. Exported as a
// no-op when the responsible-party-notify env flag is off — see
// `lib/responsible-party-notify.ts`.
export function scheduleAddressDigest(_args: { kind: "claim" | "invoice_group"; id: number; responsibility: string | null }) {
  return scheduleResponsiblePartyDigest(_args);
}

export default router;

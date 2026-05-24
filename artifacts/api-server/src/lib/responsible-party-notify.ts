// Task #889 — debounced digest mailer for the Responsible-Party portal.
//
// Behaviour: every fresh closure assigned to a responsible role kicks
// `scheduleResponsiblePartyDigest()`. The mailer holds the email for
// `DEBOUNCE_MS` (10 min by default) so a burst of closures arriving in
// the same window lands as one batched email per recipient.
//
// In-memory state — the digest queue does NOT survive a process restart.
// That's acceptable for v1 because the portal's GET endpoint is the
// authoritative inbox; the email is just a heads-up.
//
// Gated by `NOTIFY_RESPONSIBLE_PARTY_ENABLED=true`. When off (the test
// environment default) `schedule…()` is a no-op that returns immediately
// — keeps integration tests free of email side-effects without
// per-test stubbing.

import { db, usersTable } from "@workspace/db";
import {
  RESPONSIBILITY_TO_ROLE,
  closureResponsibilityLabel,
  type ClosureResponsibility,
} from "@workspace/closure-responsibility";
import { logger } from "./logger";

const DEBOUNCE_MS = Number(process.env.RESPONSIBLE_PARTY_DEBOUNCE_MS ?? 10 * 60 * 1000);

function enabled(): boolean {
  return process.env.NOTIFY_RESPONSIBLE_PARTY_ENABLED === "true";
}

type QueueEntry = {
  kind: "claim" | "invoice_group";
  id: number;
  responsibility: string;
};

// One debounce slot per role — the role is the fan-out unit (every user
// holding that role gets the same digest). Storing by role keeps the
// map small and lets a multi-role user receive at most one email per
// role per window.
const queueByRole: Map<string, QueueEntry[]> = new Map();
const timerByRole: Map<string, NodeJS.Timeout> = new Map();

export function scheduleResponsiblePartyDigest(args: {
  kind: "claim" | "invoice_group";
  id: number;
  responsibility: string | null;
}): void {
  if (!enabled()) return;
  if (!args.responsibility) return;
  const role = RESPONSIBILITY_TO_ROLE[args.responsibility as ClosureResponsibility];
  if (!role) return;

  const existing = queueByRole.get(role) ?? [];
  // Dedupe by (kind, id) so the same closure re-fired twice in one
  // window doesn't show up as two entries in the email.
  const next = existing.filter(e => !(e.kind === args.kind && e.id === args.id));
  next.push({ kind: args.kind, id: args.id, responsibility: args.responsibility });
  queueByRole.set(role, next);

  // Reset the timer — that's what makes the burst land as a single email.
  const existingTimer = timerByRole.get(role);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(() => {
    flushRole(role).catch(err => logger.error({ err, role }, "Responsible-party digest flush failed"));
  }, DEBOUNCE_MS);
  timerByRole.set(role, timer);
}

async function flushRole(role: string): Promise<void> {
  const entries = queueByRole.get(role) ?? [];
  queueByRole.delete(role);
  timerByRole.delete(role);
  if (entries.length === 0) return;

  // Lazy-import the email sender so this module stays cheap to load in
  // tests that never set the flag (and don't link the email package).
  const { sendEmailWithContext } = await import("./email-send.js").catch(() => ({ sendEmailWithContext: null as any }));
  if (!sendEmailWithContext) {
    logger.warn({ role, count: entries.length }, "Responsible-party digest: email sender unavailable; dropping batch");
    return;
  }

  // Resolve recipients — every user holding this role gets the digest.
  // Reads from DB so admin grants / revokes between bursts are honoured.
  const allUsers = await db.select().from(usersTable);
  const recipients = allUsers.filter(u =>
    Array.isArray(u.responsibleRoles) && (u.responsibleRoles as string[]).includes(role),
  );
  if (recipients.length === 0) {
    logger.info({ role, count: entries.length }, "Responsible-party digest: no recipients");
    return;
  }

  const lines = entries.map(e => {
    const label = closureResponsibilityLabel(e.responsibility);
    return `• ${e.kind === "claim" ? "Claim" : "Invoice group"} #${e.id} — ${label}`;
  }).join("\n");

  const subject = `ClaimClear — ${entries.length} closure${entries.length === 1 ? "" : "s"} awaiting your follow-through`;
  const body = `You have new closures routed to your responsibility queue.\n\n${lines}\n\nReview them at /my-closures.`;

  for (const u of recipients) {
    if (!u.email) continue;
    try {
      await sendEmailWithContext({
        to: u.email,
        subject,
        text: body,
        context: { source: "responsible_party_digest", role },
      });
    } catch (err) {
      logger.error({ err, role, userId: u.id }, "Responsible-party digest send failed");
    }
  }
}

// Exposed for tests so they can verify the queue without sending email.
export function _drainQueueForTest(): Map<string, QueueEntry[]> {
  const snapshot = new Map(queueByRole);
  queueByRole.clear();
  for (const t of timerByRole.values()) clearTimeout(t);
  timerByRole.clear();
  return snapshot;
}

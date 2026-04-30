/**
 * Helpers for the per-claim email-thread view.
 *
 * Conversation grouping, sibling-claim tagging, and status computation are kept
 * here as pure functions so they're easy to unit-test without spinning up the
 * Express app or hitting Microsoft Graph. The HTTP route in
 * `routes/response-tracker.ts` calls into these.
 */

import type { PortalResponse, OutboundEmail, Claim } from "@workspace/db";

export type ThreadStatus =
  | "awaiting_their_reply"
  | "needs_review"
  | "acknowledged_pending"
  | "resolved";

export type ThreadDirection = "inbound" | "outbound";

export interface ThreadMessage {
  id: string;
  direction: ThreadDirection;
  conversationId: string | null;
  subject: string | null;
  sender: string;
  senderEmail: string | null;
  bodyPreview: string | null;
  timestamp: string;

  // Inbound-only metadata. Carrying these on every message (with nulls for
  // outbound) keeps the OpenAPI schema flat and avoids a discriminated union.
  responseId: number | null;
  responseType: string | null;
  processed: boolean | null;
  aiSummary: string | null;
  extractedAmount: string | null;
  extractedDeadline: string | null;
  requestedAction: string | null;
  classifierSource: string | null;
  matchedVia: string | null;
  matchConfidence: string | null;

  // Sibling-claim tagging. Set when this message belongs to a different claim
  // than the one being viewed but in the same Outlook conversation
  // (e.g. one thread covering multiple legs of an invoice-group dispute).
  claimId: number | null;
  siblingClaimRef: string | null;
  siblingClaimId: number | null;
}

export interface ThreadConversation {
  conversationId: string;
  status: ThreadStatus;
  lastActivityAt: string;
  latestUnprocessedInboundId: number | null;
  latestSubject: string | null;
  latestInboundSender: string | null;
  messages: ThreadMessage[];
}

export interface SiblingClaimLookup {
  /** Map of claim id → human-readable ref (refNumber || confNumber || `#id`). */
  refsById: Map<number, string>;
}

export function buildSiblingLookup(claims: Pick<Claim, "id" | "refNumber" | "confNumber">[]): SiblingClaimLookup {
  const refsById = new Map<number, string>();
  for (const c of claims) {
    refsById.set(c.id, c.refNumber || c.confNumber || `#${c.id}`);
  }
  return { refsById };
}

/**
 * Convert a portal_responses row into a thread message. `currentClaimId` is the
 * claim being viewed — when this row's claimId differs, we tag it as a
 * sibling so the UI can render an "↳ also covers INV-1234" pill.
 */
export function inboundToMessage(
  r: PortalResponse,
  currentClaimId: number,
  lookup: SiblingClaimLookup,
): ThreadMessage {
  const isSibling = r.claimId !== null && r.claimId !== currentClaimId;
  const siblingRef = isSibling ? lookup.refsById.get(r.claimId!) ?? `#${r.claimId}` : null;
  return {
    id: `in-${r.id}`,
    direction: "inbound",
    conversationId: r.conversationId,
    subject: r.subject,
    sender: r.senderName || r.senderEmail || "Unknown",
    senderEmail: r.senderEmail,
    bodyPreview: r.content,
    timestamp: toIso(r.receivedAt),
    responseId: r.id,
    responseType: r.responseType,
    processed: r.processed,
    aiSummary: r.aiSummary,
    extractedAmount: r.extractedAmount,
    extractedDeadline: r.extractedDeadline,
    requestedAction: r.requestedAction,
    classifierSource: r.classifierSource,
    matchedVia: r.matchedVia,
    matchConfidence: r.matchConfidence,
    claimId: r.claimId,
    siblingClaimRef: siblingRef,
    siblingClaimId: isSibling ? r.claimId : null,
  };
}

export function outboundToMessage(
  o: OutboundEmail,
  currentClaimId: number,
  lookup: SiblingClaimLookup,
): ThreadMessage {
  const isSibling = o.claimId !== null && o.claimId !== currentClaimId;
  const siblingRef = isSibling ? lookup.refsById.get(o.claimId!) ?? `#${o.claimId}` : null;
  return {
    id: `out-${o.id}`,
    direction: "outbound",
    conversationId: o.conversationId,
    subject: o.subject,
    sender: o.sentByUserName || o.sentByUserEmail || "ClaimClear",
    senderEmail: o.sentByUserEmail,
    bodyPreview: o.bodyPreview,
    timestamp: toIso(o.sentAt),
    responseId: null,
    responseType: null,
    processed: null,
    aiSummary: null,
    extractedAmount: null,
    extractedDeadline: null,
    requestedAction: null,
    classifierSource: null,
    matchedVia: null,
    matchConfidence: null,
    claimId: o.claimId,
    siblingClaimRef: siblingRef,
    siblingClaimId: isSibling ? o.claimId : null,
  };
}

function toIso(v: Date | string | null | undefined): string {
  if (v === null || v === undefined) return new Date(0).toISOString();
  if (v instanceof Date) return v.toISOString();
  return new Date(v).toISOString();
}

/**
 * Compute the per-thread status pill from the latest message + current claim
 * outcome. Mirrors the four-state model documented on the OpenAPI schema:
 * resolved (claim is closed) > needs_review (real inbound, unprocessed)
 * > acknowledged_pending (latest inbound is an ack) > awaiting_their_reply
 * (we sent last).
 */
export function computeThreadStatus(
  messages: ThreadMessage[],
  isClaimResolved: boolean,
): ThreadStatus {
  if (isClaimResolved) return "resolved";
  if (messages.length === 0) return "awaiting_their_reply";

  // Find the latest message in time order. Messages are caller-sorted but we
  // tolerate any input order to keep this pure.
  const latest = [...messages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  )[messages.length - 1];

  if (latest.direction === "outbound") return "awaiting_their_reply";

  // Latest is inbound. Acknowledgments are silent receipts ("we got your
  // request"); they should NOT show up as Needs Review even if unprocessed,
  // because we never auto-transition the claim for them. Real responses do.
  if (latest.responseType === "acknowledgment") return "acknowledged_pending";
  if (latest.processed === false) return "needs_review";

  // Inbound but already processed — next ball is in their court.
  return "awaiting_their_reply";
}

/**
 * Group a flat list of inbound + outbound messages by conversationId, sort
 * messages within each conversation chronologically, and compute the per-
 * conversation status pill.
 *
 * Messages with no conversationId are bucketed into a synthetic key per row
 * (so each shows as its own thread) — this preserves the legacy behaviour of
 * the old card before threading was wired up.
 */
export function groupByConversation(
  messages: ThreadMessage[],
  isClaimResolved: boolean,
): ThreadConversation[] {
  const buckets = new Map<string, ThreadMessage[]>();
  for (const msg of messages) {
    const key = msg.conversationId || `__none__${msg.id}`;
    const arr = buckets.get(key);
    if (arr) arr.push(msg);
    else buckets.set(key, [msg]);
  }

  const conversations: ThreadConversation[] = [];
  for (const [key, msgs] of buckets) {
    msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const latest = msgs[msgs.length - 1];

    // Latest unprocessed inbound is what the Approve/Deny/Mark Reviewed buttons
    // attach to. We deliberately ignore acknowledgments here — staff should
    // not be asked to review "we got your request" notes.
    const latestUnprocessedInbound = [...msgs]
      .reverse()
      .find(
        (m) =>
          m.direction === "inbound" &&
          m.processed === false &&
          m.responseType !== "acknowledgment",
      );

    // Last inbound's sender is what we prefill the Reply composer's "To" with.
    const lastInbound = [...msgs].reverse().find((m) => m.direction === "inbound");

    conversations.push({
      conversationId: key.startsWith("__none__") ? "" : key,
      status: computeThreadStatus(msgs, isClaimResolved),
      lastActivityAt: latest.timestamp,
      latestUnprocessedInboundId: latestUnprocessedInbound?.responseId ?? null,
      latestSubject: latest.subject,
      latestInboundSender: lastInbound?.senderEmail ?? null,
      messages: msgs,
    });
  }

  // Most-recent-activity descending so the most relevant thread shows up
  // first when there are multiple parallel threads on one claim.
  conversations.sort(
    (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
  );
  return conversations;
}

/**
 * Group a thread's messages into either a single message block or a run of
 * consecutive acknowledgments. Used by the UI to collapse chatty payer
 * auto-responders behind a single "Show N acknowledgments" toggle. Pure so
 * it can be unit-tested without React.
 */
export type ThreadBlock =
  | { kind: "msg"; msg: ThreadMessage }
  | { kind: "acks"; msgs: ThreadMessage[] };

export function groupAcknowledgmentBlocks(messages: ThreadMessage[]): ThreadBlock[] {
  const out: ThreadBlock[] = [];
  for (const m of messages) {
    const isAck = m.responseType === "acknowledgment";
    const last = out[out.length - 1];
    if (isAck && last && last.kind === "acks") {
      last.msgs.push(m);
    } else if (isAck) {
      out.push({ kind: "acks", msgs: [m] });
    } else {
      out.push({ kind: "msg", msg: m });
    }
  }
  return out;
}

/**
 * Strip leading "Re:" / "Fwd:" prefixes so the reply composer doesn't stack
 * them ("Re: Re: Re:"). Outlook's createReply adds its own "Re:".
 */
export function stripReplyPrefixes(subject: string | null | undefined): string {
  if (!subject) return "";
  return subject
    .trim()
    .replace(/^(?:re|fwd?|fw)\s*:\s*/gi, "")
    .replace(/^(?:re|fwd?|fw)\s*:\s*/gi, "")
    .trim();
}

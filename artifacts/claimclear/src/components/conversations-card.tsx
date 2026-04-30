// Threaded "Conversations" card. Replaces the old Responses + Email Thread
// pair on claim detail. Status pill, inline AI summaries, sibling pills,
// in-app Reply.

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import DOMPurify from "dompurify";
import {
  Mail, Send, MessagesSquare, CheckCircle, X, Eye, Reply,
  ArrowRightLeft, AlertTriangle, Loader2, ChevronDown, ChevronUp,
  Paperclip,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/format";
import { closureReasonLabel } from "@/lib/closure-reasons";
import type {
  EmailThreadConversation,
  EmailThreadMessage,
  PortalResponseItem,
  ClaimResponse,
} from "@workspace/api-client-react";

type ThreadStatus = EmailThreadConversation["status"];

/**
 * One row in the Reply composer's "Attach files" picker. We pull these from
 * the claim's collected evidence on the parent page (see claim-detail.tsx)
 * so the picker mirrors what staff see in the Evidence card. Items without
 * an `imageUrl` (e.g. notes-only evidence) are filtered out by the parent
 * so they never appear here.
 */
export interface ReplyEvidenceOption {
  id: number;
  label: string;
  fileName: string | null;
}

interface ConversationsCardProps {
  conversations: EmailThreadConversation[];
  /** Used to look up full body / rawContent / bodyFormat for THIS claim's inbound messages. */
  claimResponses: PortalResponseItem[];
  claim: Pick<ClaimResponse, "closureReason">;
  /**
   * Evidence files available to attach to a reply. Empty when the claim has
   * no file-backed evidence; the picker collapses to a hint in that case.
   */
  availableEvidence: ReplyEvidenceOption[];
  isReplying: boolean;
  onApprove: (responseId: number) => Promise<void> | void;
  onDeny: (responseId: number) => Promise<void> | void;
  onMarkReviewed: (resp: PortalResponseItem) => Promise<void> | void;
  onReassign: (resp: PortalResponseItem) => void;
  onReply: (input: {
    conversationId: string;
    subject: string;
    bodyText: string;
    to: string[];
    cc: string[];
    evidenceIds: number[];
  }) => Promise<EmailThreadMessage>;
}

const STATUS_META: Record<ThreadStatus, { label: string; className: string; tip: string }> = {
  resolved: {
    label: "Resolved",
    className: "bg-emerald-100 text-emerald-800 border-emerald-300",
    tip: "This claim is closed. The thread is read-only.",
  },
  needs_review: {
    label: "Needs Review",
    className: "bg-yellow-100 text-yellow-900 border-yellow-300",
    tip: "Latest message from the payer is unprocessed. Approve, Deny, or Mark Reviewed below.",
  },
  acknowledged_pending: {
    label: "Acknowledged — awaiting decision",
    className: "bg-slate-100 text-slate-700 border-slate-300",
    tip: "Payer acknowledged receipt but hasn't replied with a decision yet.",
  },
  awaiting_their_reply: {
    label: "Awaiting their reply",
    className: "bg-blue-100 text-blue-800 border-blue-300",
    tip: "We sent the last message. Ball is in their court.",
  },
};

function stripReplyPrefixes(subject: string | null | undefined): string {
  if (!subject) return "";
  return subject
    .trim()
    .replace(/^(?:re|fwd?|fw)\s*:\s*/gi, "")
    .replace(/^(?:re|fwd?|fw)\s*:\s*/gi, "")
    .trim();
}

export function ConversationsCard(props: ConversationsCardProps) {
  const { conversations, claim } = props;
  if (!conversations || conversations.length === 0) return null;

  const totalMessages = conversations.reduce((acc, c) => acc + c.messages.length, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessagesSquare className="h-5 w-5" />
          Conversations
          <Badge variant="secondary">{totalMessages}</Badge>
        </CardTitle>
        {claim.closureReason && (
          <CardDescription data-testid="responses-closure-reason" className="pt-1">
            Closure reason: <span className="font-medium">{closureReasonLabel(claim.closureReason)}</span>
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {conversations.map((conv, idx) => {
          // Expand any thread that needs the user's attention (Needs Review,
          // unprocessed inbound), plus the most-recent thread so there's
          // always something open. Resolved/quiet threads stay collapsed.
          const needsAttention =
            conv.status === "needs_review" ||
            conv.latestUnprocessedInboundId !== null;
          return (
            <ConversationThread
              key={conv.conversationId || `__none__${idx}`}
              conversation={conv}
              initiallyExpanded={needsAttention || idx === 0}
              {...props}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

interface ConversationThreadProps extends ConversationsCardProps {
  conversation: EmailThreadConversation;
  initiallyExpanded: boolean;
}

type Block =
  | { kind: "msg"; msg: EmailThreadMessage }
  | { kind: "acks"; msgs: EmailThreadMessage[] };

/**
 * Pure: collapse runs of consecutive acknowledgment messages into a single
 * "acks" block. Exported for unit tests; mirrors the server's
 * `groupAcknowledgmentBlocks` helper.
 */
export function groupAcknowledgmentBlocks(messages: EmailThreadMessage[]): Block[] {
  const out: Block[] = [];
  for (const m of messages) {
    const isAck = m.responseType === "acknowledgment";
    const last = out[out.length - 1];
    if (isAck && last && last.kind === "acks") last.msgs.push(m);
    else if (isAck) out.push({ kind: "acks", msgs: [m] });
    else out.push({ kind: "msg", msg: m });
  }
  return out;
}

function ConversationThread({
  conversation,
  initiallyExpanded,
  claimResponses,
  availableEvidence,
  isReplying,
  onApprove,
  onDeny,
  onMarkReviewed,
  onReassign,
  onReply,
}: ConversationThreadProps) {
  const meta = STATUS_META[conversation.status];
  const [expanded, setExpanded] = useState(initiallyExpanded);

  // Optimistic append: when we successfully send a reply, append the returned
  // outbound message immediately so the user sees their reply in the thread
  // before the next refetch arrives. Cleared whenever conversation.messages
  // changes (i.e. fresh data has landed).
  const [optimistic, setOptimistic] = useState<EmailThreadMessage[]>([]);
  useEffect(() => {
    setOptimistic((cur) =>
      cur.filter((o) => !conversation.messages.some((m) => m.id === o.id)),
    );
  }, [conversation.messages]);
  const visibleMessages = useMemo(
    () => [...conversation.messages, ...optimistic].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    ),
    [conversation.messages, optimistic],
  );

  const blocks = useMemo(() => groupAcknowledgmentBlocks(visibleMessages), [visibleMessages]);

  // Anchor for Approve / Deny / Mark Reviewed: latest unprocessed real inbound.
  const actionableInbound = useMemo(() => {
    if (conversation.latestUnprocessedInboundId === null) return null;
    return (
      conversation.messages.find(
        (m) => m.responseId === conversation.latestUnprocessedInboundId,
      ) ?? null
    );
  }, [conversation]);
  const actionableResp = useMemo(
    () => (actionableInbound ? claimResponses.find((r) => r.id === actionableInbound.responseId) : null),
    [actionableInbound, claimResponses],
  );

  // Reply composer state. Lives per-thread so opening one doesn't disturb
  // a draft in another.
  const [replyOpen, setReplyOpen] = useState(false);
  const lastInbound = useMemo(
    () => [...conversation.messages].reverse().find((m) => m.direction === "inbound"),
    [conversation.messages],
  );
  const lastSubject = conversation.latestSubject ?? lastInbound?.subject ?? "";
  const defaultTo = conversation.latestInboundSender ?? "";

  const [replyTo, setReplyTo] = useState(defaultTo);
  const [replyCc, setReplyCc] = useState("");
  const [replySubject, setReplySubject] = useState(`Re: ${stripReplyPrefixes(lastSubject)}`);
  const [replyBody, setReplyBody] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  // Selected evidence ids for the Attach files picker. Stored as a Set for
  // cheap toggling in the UI; serialized to an array when we hand off to
  // the reply mutation.
  const [replyEvidenceIds, setReplyEvidenceIds] = useState<Set<number>>(new Set());

  const openReply = () => {
    setReplyOpen(true);
    // Re-prime fields each time so a stale draft doesn't survive a refresh.
    setReplyTo(defaultTo);
    setReplyCc("");
    setReplySubject(`Re: ${stripReplyPrefixes(lastSubject)}`);
    setReplyBody("");
    setReplyError(null);
    setReplyEvidenceIds(new Set());
  };

  const toggleEvidenceId = (id: number) => {
    setReplyEvidenceIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitReply = async () => {
    if (!conversation.conversationId) {
      setReplyError("This thread has no Outlook conversationId yet — wait for the next inbox poll, then reply.");
      return;
    }
    const to = replyTo.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const cc = replyCc.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (to.length === 0) { setReplyError("At least one recipient is required."); return; }
    if (replyBody.trim().length === 0) { setReplyError("Reply body cannot be empty."); return; }
    setReplyError(null);
    try {
      const created = await onReply({
        conversationId: conversation.conversationId,
        subject: replySubject.trim() || `Re: ${stripReplyPrefixes(lastSubject)}`,
        bodyText: replyBody,
        to,
        cc,
        evidenceIds: Array.from(replyEvidenceIds),
      });
      // Append immediately so the user sees the reply before refetch lands.
      // The useEffect above clears it once the next fetch returns the row.
      if (created && !conversation.messages.some((m) => m.id === created.id)) {
        setOptimistic((cur) => [...cur, created]);
      }
      setReplyOpen(false);
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Failed to send reply.");
    }
  };

  return (
    <div className="border rounded-lg bg-slate-50/50 dark:bg-slate-900/20">
      {/* Thread header — collapsible, status pill + subject summary. */}
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <button
          type="button"
          className="flex items-start gap-2 min-w-0 flex-1 text-left hover:opacity-80"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronUp className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className={`text-xs cursor-help ${meta.className}`}>
                      {meta.label}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{meta.tip}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span className="text-xs text-muted-foreground">
                {conversation.messages.length} message{conversation.messages.length === 1 ? "" : "s"}
                {" · "}
                Last: {formatDateTime(conversation.lastActivityAt)}
              </span>
            </div>
            {(conversation.latestSubject || lastSubject) && (
              <p className="text-sm font-medium mt-1 truncate" title={conversation.latestSubject ?? lastSubject}>
                {conversation.latestSubject ?? lastSubject}
              </p>
            )}
          </div>
        </button>
        {conversation.status !== "resolved" && (
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-8 shrink-0"
            onClick={() => { setExpanded(true); openReply(); }}
            disabled={replyOpen}
          >
            <Reply className="h-3 w-3 mr-1" /> Reply
          </Button>
        )}
      </div>

      {/* Bubbles. */}
      {expanded && (
        <div className="px-4 py-3 space-y-2">
          {blocks.map((block, blockIdx) => {
            if (block.kind === "msg") {
              const msg = block.msg;
              return (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  fullResp={msg.responseId ? claimResponses.find((r) => r.id === msg.responseId) ?? null : null}
                  onReassign={onReassign}
                />
              );
            }
            return <AcknowledgmentRun key={`acks-${blockIdx}`} msgs={block.msgs} />;
          })}
        </div>
      )}

      {/* Tagging only classifies the response; verdict happens below. */}
      {expanded && actionableInbound && actionableResp && (
        <div className="border-t border-slate-200 dark:border-slate-800 px-4 py-3 bg-white/60 dark:bg-slate-950/30">
          <div className="text-xs text-muted-foreground mb-2">
            Tag the latest payer message so a human can review it. The verdict still happens below — these buttons don&apos;t resolve or deny the claim.
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm" variant="outline"
              className="text-xs h-7 bg-green-100 hover:bg-green-200 text-green-800 border-green-300"
              onClick={() => onApprove(actionableResp.id)}
              title="Tag this response as an Approval hint and send it to human review. Does not resolve the claim."
            >
              <CheckCircle className="h-3 w-3 mr-1" /> Tag as Approval
            </Button>
            <Button
              size="sm" variant="outline"
              className="text-xs h-7 bg-red-100 hover:bg-red-200 text-red-800 border-red-300"
              onClick={() => onDeny(actionableResp.id)}
              title="Tag this response as a Denial hint and send it to human review. Does not deny the claim."
            >
              <X className="h-3 w-3 mr-1" /> Tag as Denial
            </Button>
            <Button
              size="sm" variant="outline"
              className="text-xs h-7"
              onClick={() => onMarkReviewed(actionableResp)}
              title="Keep the existing tag and mark the response reviewed. The claim stays in Needs Review until you pick a verdict below."
            >
              <Eye className="h-3 w-3 mr-1" /> Mark Reviewed
            </Button>
          </div>
        </div>
      )}

      {/* Reply composer. */}
      {expanded && replyOpen && (
        <div className="border-t border-slate-200 dark:border-slate-800 px-4 py-3 bg-blue-50/40 dark:bg-blue-950/10 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <Label htmlFor="reply-to" className="text-xs">To</Label>
              <Input
                id="reply-to"
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
                placeholder="recipient@example.com"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label htmlFor="reply-cc" className="text-xs">CC (optional)</Label>
              <Input
                id="reply-cc"
                value={replyCc}
                onChange={(e) => setReplyCc(e.target.value)}
                placeholder="cc1@example.com, cc2@example.com"
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="reply-subject" className="text-xs">Subject</Label>
            <Input
              id="reply-subject"
              value={replySubject}
              onChange={(e) => setReplySubject(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label htmlFor="reply-body" className="text-xs">Message</Label>
            <Textarea
              id="reply-body"
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              rows={6}
              placeholder="Write your reply…"
              className="text-sm font-sans"
            />
          </div>
          <div className="space-y-1.5" data-testid="reply-attach-picker">
            <Label className="text-xs flex items-center gap-1.5">
              <Paperclip className="h-3 w-3" />
              Attach files
              {replyEvidenceIds.size > 0 && (
                <span className="text-muted-foreground font-normal">
                  ({replyEvidenceIds.size} selected)
                </span>
              )}
            </Label>
            {availableEvidence.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No file-backed evidence on this claim yet. Add evidence in the
                Evidence card to attach it to a reply.
              </p>
            ) : (
              <ul className="border rounded-md bg-white/70 dark:bg-slate-900/40 divide-y max-h-40 overflow-y-auto">
                {availableEvidence.map((ev) => {
                  const checked = replyEvidenceIds.has(ev.id);
                  return (
                    <li key={ev.id}>
                      <label className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 shrink-0"
                          checked={checked}
                          onChange={() => toggleEvidenceId(ev.id)}
                          data-testid={`reply-attach-checkbox-${ev.id}`}
                        />
                        <span className="font-medium truncate" title={ev.label}>
                          {ev.label}
                        </span>
                        {ev.fileName && (
                          <span className="text-muted-foreground truncate" title={ev.fileName}>
                            — {ev.fileName}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {replyError && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{replyError}</span>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setReplyOpen(false)} disabled={isReplying}>
              Cancel
            </Button>
            <Button size="sm" onClick={submitReply} disabled={isReplying}>
              {isReplying ? (
                <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Sending…</>
              ) : (
                <><Send className="h-3 w-3 mr-1" /> Send Reply</>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface MessageBubbleProps {
  msg: EmailThreadMessage;
  /** Full PortalResponseItem if this inbound belongs to the current claim. Sibling-claim messages get null and just show the preview. */
  fullResp: PortalResponseItem | null;
  onReassign: (resp: PortalResponseItem) => void;
}

/**
 * Renders a clickable pill that navigates to the sibling claim the message
 * also covers. We render as a real link rather than text so staff can quickly
 * jump between legs of a multi-claim group dispute.
 */
function SiblingPill({ msg }: { msg: EmailThreadMessage }) {
  if (!msg.siblingClaimRef) return null;
  const inner = (
    <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100 cursor-pointer">
      ↳ also covers {msg.siblingClaimRef}
    </Badge>
  );
  if (msg.siblingClaimId !== null && msg.siblingClaimId !== undefined) {
    return <Link href={`/claims/${msg.siblingClaimId}`}>{inner}</Link>;
  }
  return inner;
}

/**
 * One-line collapsed marker for a run of consecutive acknowledgment messages,
 * with a "Show N acknowledgments" toggle. Keeps chatty auto-responders from
 * dominating the visual thread but lets staff drill in if they need details.
 */
function AcknowledgmentRun({ msgs }: { msgs: EmailThreadMessage[] }) {
  const [open, setOpen] = useState(false);
  const last = msgs[msgs.length - 1];
  if (msgs.length === 1) {
    const m = msgs[0];
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 bg-slate-100/70 dark:bg-slate-800/40 rounded border border-slate-200 dark:border-slate-700">
        <CheckCircle className="h-3 w-3" />
        <span className="font-medium">Acknowledged</span>
        <span className="opacity-70 truncate">— {m.sender}</span>
        <SiblingPill msg={m} />
        <span className="ml-auto opacity-60 shrink-0">{formatDateTime(m.timestamp)}</span>
      </div>
    );
  }
  return (
    <div className="border border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/40 rounded">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800/60 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <CheckCircle className="h-3 w-3 shrink-0" />
        <span className="font-medium">
          {open ? "Hide" : "Show"} {msgs.length} acknowledgments
        </span>
        <span className="opacity-70">— last: {last.sender}</span>
        {open ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
      </button>
      {open && (
        <ul className="px-3 pb-2 space-y-1 text-xs text-slate-600 dark:text-slate-400">
          {msgs.map((m) => (
            <li key={m.id} className="flex items-center gap-2">
              <span className="opacity-70 truncate">{m.sender}</span>
              <SiblingPill msg={m} />
              <span className="ml-auto opacity-60 shrink-0">{formatDateTime(m.timestamp)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MessageBubble({ msg, fullResp, onReassign }: MessageBubbleProps) {
  const isOutbound = msg.direction === "outbound";
  const isSibling = msg.siblingClaimRef !== null;

  const [expanded, setExpanded] = useState(false);

  const bubbleColor = isOutbound
    ? "bg-blue-50 border-blue-200 ml-8"
    : isSibling
      ? "bg-violet-50/60 border-violet-200 mr-8"
      : "bg-white border-slate-200 mr-8";

  // Body: prefer full PortalResponseItem (rawContent + bodyFormat) when this is
  // an inbound on the current claim; fall back to bodyPreview for outbound and
  // sibling-claim messages.
  const bodyText = fullResp
    ? (fullResp.rawContent && fullResp.rawContent.trim().length > 0
        ? fullResp.rawContent
        : (fullResp.content || ""))
    : (msg.bodyPreview || "");
  const isHtml = fullResp?.bodyFormat === "html";
  const isLong = bodyText.length > 400 || bodyText.split("\n").length > 6;
  const sanitizedHtml = isHtml
    ? DOMPurify.sanitize(bodyText, {
        ALLOWED_TAGS: ["p", "br", "strong", "em", "u", "b", "i", "ul", "ol", "li", "a", "blockquote", "pre", "code", "h1", "h2", "h3", "h4", "h5", "h6", "span", "div"],
        ALLOWED_ATTR: ["href", "target", "rel"],
      })
    : "";

  return (
    <div className={`border rounded-lg p-3 ${bubbleColor}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm min-w-0">
          {isOutbound ? <Send className="h-4 w-4 text-blue-700 shrink-0" /> : <Mail className="h-4 w-4 text-slate-700 shrink-0" />}
          <span className="font-medium">{isOutbound ? "Sent" : "Received"}</span>
          <span className="text-xs opacity-70 truncate">
            {msg.sender}
            {msg.senderEmail && msg.senderEmail !== msg.sender ? ` <${msg.senderEmail}>` : ""}
          </span>
          <SiblingPill msg={msg} />
          {!isOutbound && msg.classifierSource === "ai" && (
            <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">
              AI summarized
            </Badge>
          )}
          {!isOutbound && msg.processed === false && (
            <Badge variant="secondary" className="text-[10px] bg-yellow-100 text-yellow-800">
              Unprocessed
            </Badge>
          )}
        </div>
        <span className="text-xs opacity-60 shrink-0">{formatDateTime(msg.timestamp)}</span>
      </div>

      {msg.subject && <p className="text-sm font-medium mt-1">{msg.subject}</p>}

      {/* AI summary inline — same style as the old card so users don't have
          to relearn anything. */}
      {!isOutbound && msg.aiSummary && (
        <div className="text-sm bg-violet-50/60 border border-violet-200 rounded-md p-2.5 mt-2">
          <div className="text-[11px] uppercase tracking-wide text-violet-700 mb-1">Summary</div>
          <div className="leading-snug text-slate-800">{msg.aiSummary}</div>
          {(msg.requestedAction || msg.extractedAmount || msg.extractedDeadline) && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
              {msg.requestedAction && (<span><strong>They want:</strong> {msg.requestedAction}</span>)}
              {msg.extractedAmount && (<span><strong>Amount:</strong> {msg.extractedAmount}</span>)}
              {msg.extractedDeadline && (<span><strong>Deadline:</strong> {msg.extractedDeadline}</span>)}
            </div>
          )}
        </div>
      )}

      {isOutbound && msg.attachmentNames && msg.attachmentNames.length > 0 && (
        <div
          className="mt-2 flex items-start gap-1.5 text-xs text-blue-900 bg-blue-100/60 border border-blue-200 rounded px-2 py-1.5"
          data-testid="reply-attached-files"
        >
          <Paperclip className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <span className="font-medium">
              Attached {msg.attachmentNames.length} file{msg.attachmentNames.length === 1 ? "" : "s"}:
            </span>{" "}
            <span className="break-all">{msg.attachmentNames.join(", ")}</span>
          </div>
        </div>
      )}

      {bodyText && (
        <div className="mt-2 space-y-1">
          {isHtml ? (
            <div
              className={`text-sm bg-white/70 border border-slate-200 rounded-md p-2.5 break-words font-sans overflow-y-auto prose prose-sm max-w-none ${
                expanded ? "max-h-[32rem]" : "max-h-32"
              }`}
              dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
            />
          ) : (
            <div
              className={`text-sm bg-white/70 border border-slate-200 rounded-md p-2.5 whitespace-pre-wrap break-words font-sans overflow-y-auto ${
                expanded ? "max-h-[32rem]" : "max-h-32"
              }`}
            >
              {bodyText}
            </div>
          )}
          {isLong && (
            <Button
              size="sm" variant="ghost"
              className="h-6 px-2 text-xs opacity-70 hover:opacity-100"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Show less" : "Show full message"}
            </Button>
          )}
        </div>
      )}

      {/* Footer metadata — match confidence + reassign action; only meaningful
          for inbound messages we have a full PortalResponseItem for. */}
      {!isOutbound && fullResp && (
        <div className="flex items-center gap-3 text-xs opacity-60 mt-2 flex-wrap">
          {msg.matchedVia && (<span>Matched: {msg.matchedVia}</span>)}
          {msg.matchConfidence && (() => {
            const conf = String(msg.matchConfidence).toLowerCase();
            const confColors: Record<string, string> = {
              high: "bg-green-100 text-green-800 border-green-300",
              medium: "bg-amber-100 text-amber-800 border-amber-300",
              low: "bg-red-100 text-red-800 border-red-300",
            };
            return (
              <Badge variant="outline" className={`text-[10px] capitalize ${confColors[conf] || ""}`}>
                {conf} confidence
              </Badge>
            );
          })()}
          <Button
            size="sm" variant="ghost"
            className="text-xs h-6 px-2 ml-auto opacity-70 hover:opacity-100"
            onClick={() => onReassign(fullResp)}
          >
            <ArrowRightLeft className="h-3 w-3 mr-1" /> Not the right claim?
          </Button>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { resolveBodyRender } from "@/lib/email-body-render";
import { useUpgradeReplyDraft } from "@workspace/api-client-react";
import {
  MAX_REPLY_ATTACHMENT_FILES,
  MAX_REPLY_ATTACHMENT_IMAGES,
  REPLY_ATTACHMENT_ALLOWED_MIME_SET,
  REPLY_ATTACHMENT_IMAGE_MIME_SET,
  REPLY_ATTACHMENT_TOTAL_BYTES,
} from "@workspace/api-zod";
import { useToast } from "@/hooks/use-toast";
import {
  Mail,
  MailOpen,
  CornerDownRight,
  Reply,
  Inbox,
  Paperclip,
  Send,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Loader2,
  Undo2,
  Wand2,
  X,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import { RichTextEditor } from "./rich-text-editor";
import { extractClipboardFiles } from "@/components/decision-tree/evidence-paste";

export interface GroupEmailMessage {
  id: string;
  direction: "inbound" | "outbound";
  senderName: string;
  senderEmail: string;
  subject: string;
  bodyHtml: string;
  /**
   * Original body format reported by the API. When `"html"` we prefer
   * rendering `bodyHtml`; when `"text"` we render `bodyPreview` as plain
   * text. The defensive fallback in `resolveBodyRender` will still
   * upgrade plain-text rows to HTML if their content clearly looks like
   * markup, so an ingestion regression doesn't print raw tags.
   */
  bodyFormat?: "html" | "text";
  bodyPreview: string;
  timestamp: string;
  attachments: string[];
  /**
   * Task #713 — structured per-attachment download metadata. When present
   * the bubble renders chips that link to the file in object storage; when
   * null we fall back to plain `attachments` filename labels.
   */
  attachmentLinks?: GroupEmailAttachment[] | null;
  mentionedLegIds: { id: number; label: string }[];
  unread?: boolean;
  responseType?: string | null;
}

export interface GroupEmailAttachment {
  name: string;
  size: number | null;
  contentType: string;
  downloadUrl: string;
}

/**
 * Reply-composer payload shape exported so callers can type the mutation.
 *
 * Task #713 trust-boundary fix: the composer no longer sends raw
 * `objectPath` / `contentType` / `size`. Instead it forwards an opaque
 * `stagedId` returned by `PUT /api/storage/reply-attachments/stage`. The
 * server resolves that id to the authoritative storage key + MIME and
 * never trusts client-supplied filenames or types.
 */
export interface ReplyAttachmentInput {
  stagedId: string;
}

export interface GroupConversation {
  conversationId: string;
  subject: string;
  status: "awaiting_their_reply" | "needs_review" | "acknowledged_pending" | "resolved";
  lastActivityAt: string;
  messages: GroupEmailMessage[];
}

interface Props {
  conversations: GroupConversation[];
  groupInvoiceNumber: string;
  isSyncing?: boolean;
  isSending?: boolean;
  onSyncInbox?: () => void;
  onReply?: (input: {
    conversationId: string;
    subject: string;
    bodyHtml: string;
    to: string[];
    cc: string[];
    attachments: ReplyAttachmentInput[];
  }) => Promise<void>;
  /**
   * When true, render only the inner conversation list — no Card chrome and
   * no header. The caller is expected to wrap the output in their own
   * card/header. Used by the densified invoice-group detail surface so the
   * cc-card from the page provides the chrome.
   */
  bare?: boolean;
}

const STATUS_META: Record<
  GroupConversation["status"],
  { label: string; bg: string; fg: string }
> = {
  awaiting_their_reply: {
    label: "Awaiting payor reply",
    bg: "hsl(45 93% 95%)",
    fg: "hsl(45 93% 30%)",
  },
  needs_review: {
    label: "Needs review",
    bg: "hsl(45 93% 95%)",
    fg: "hsl(45 93% 30%)",
  },
  acknowledged_pending: {
    label: "Acknowledged — pending",
    bg: "hsl(210 40% 96%)",
    fg: "hsl(210 40% 40%)",
  },
  resolved: { label: "Resolved", bg: "hsl(142 70% 95%)", fg: "hsl(142 70% 30%)" },
};

export function GroupCommunicationThread({
  conversations,
  groupInvoiceNumber,
  isSyncing,
  isSending,
  onSyncInbox,
  onReply,
  bare,
}: Props) {
  const totalMessages = conversations.reduce(
    (acc, c) => acc + c.messages.length,
    0,
  );
  const unreadCount = conversations.reduce(
    (acc, c) => acc + c.messages.filter((m) => m.unread).length,
    0,
  );
  const needsReply = conversations.some(
    (c) => c.status === "needs_review" || c.status === "awaiting_their_reply",
  );

  const inner = (
    <>
      {conversations.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No email conversations linked to {groupInvoiceNumber} yet. Messages
          will appear once inbox sync picks up replies.
        </p>
      ) : (
        conversations.map((conv) => (
          <ConversationSection
            key={conv.conversationId}
            conversation={conv}
            isSending={isSending}
            onReply={onReply}
            needsReply={needsReply}
          />
        ))
      )}
    </>
  );

  if (bare) {
    // D2 polish (Task #767+) — in bare mode the card chrome is provided
    // by the right-rail page-level CcCard, which sits in a narrow column.
    // Cap the inner thread at a fixed max-height with internal scroll so a
    // long inbound email doesn't push the rest of the rail (Group evidence,
    // Notes, Activity) hundreds of pixels down the page.
    return (
      <div
        className="space-y-4 max-h-[520px] overflow-y-auto pr-1"
        data-testid="group-communication-thread"
      >
        {inner}
      </div>
    );
  }

  return (
    <Card data-testid="group-communication-thread">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Communication
            <Badge variant="secondary" className="text-xs">
              {totalMessages} message{totalMessages === 1 ? "" : "s"}
            </Badge>
            {unreadCount > 0 && (
              <Badge
                variant="outline"
                className="text-xs bg-amber-100 text-amber-800 border-amber-300"
              >
                {unreadCount} unread
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {onSyncInbox && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8"
                onClick={onSyncInbox}
                disabled={isSyncing}
              >
                {isSyncing ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Inbox className="h-3 w-3 mr-1" />
                )}
                Sync inbox
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">{inner}</CardContent>
    </Card>
  );
}

function ConversationSection({
  conversation,
  isSending,
  onReply,
  needsReply,
}: {
  conversation: GroupConversation;
  isSending?: boolean;
  onReply?: Props["onReply"];
  needsReply: boolean;
}) {
  const meta = STATUS_META[conversation.status];
  const [expanded, setExpanded] = useState(true);
  const [replyOpen, setReplyOpen] = useState(false);

  const lastInbound = useMemo(
    () =>
      [...conversation.messages]
        .reverse()
        .find((m) => m.direction === "inbound"),
    [conversation.messages],
  );

  const daysSinceActivity = useMemo(() => {
    const diff =
      Date.now() - new Date(conversation.lastActivityAt).getTime();
    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    return d > 0 ? `${d}d` : "today";
  }, [conversation.lastActivityAt]);

  return (
    <div className="border rounded-lg overflow-hidden" id="invoice-thread">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left bg-muted/30 hover:bg-muted/50 border-b"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="text-sm font-semibold truncate flex-1">
          {conversation.subject}
        </span>
        <Badge
          variant="outline"
          className="text-[11px] shrink-0"
          style={{ background: meta.bg, color: meta.fg }}
        >
          <Clock className="h-2.5 w-2.5 mr-1" />
          {meta.label} · {daysSinceActivity}
        </Badge>
        <span className="text-xs text-muted-foreground shrink-0">
          {conversation.messages.length} msg
          {conversation.messages.length === 1 ? "" : "s"}
        </span>
      </button>

      {expanded && (
        <>
          <div className="divide-y">
            {conversation.messages.map((msg) => (
              <MessageRow key={msg.id} msg={msg} />
            ))}
          </div>

          {conversation.status !== "resolved" && onReply && (
            <>
              {/* D2 polish — always-visible reply affordance. Both the
                  placeholder input and the blue send icon open the
                  full-thread modal composer so it's obvious how to
                  respond at a glance. */}
              <div className="border-t bg-muted/30 p-2 flex gap-2 items-center">
                <button
                  type="button"
                  onClick={() => setReplyOpen(true)}
                  className="flex-1 text-left text-xs px-3 py-2 rounded border bg-background text-muted-foreground hover:border-primary transition-colors"
                  data-testid="group-thread-reply-trigger"
                >
                  Reply to thread…
                </button>
                <button
                  type="button"
                  onClick={() => setReplyOpen(true)}
                  className="inline-flex items-center justify-center rounded px-2.5 py-2 bg-primary text-primary-foreground hover:opacity-90"
                  title="Reply to thread"
                  data-testid="group-thread-reply-send-trigger"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>

              <GroupCommunicationReplyDialog
                open={replyOpen}
                onOpenChange={setReplyOpen}
                conversation={conversation}
                isSending={isSending}
                onReply={onReply}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Controlled reply dialog that pairs the **full prior conversation**
 * (every message rendered in full via `MessageRow`) with the existing
 * `ReplyComposer` below it. Used by both `ConversationSection`'s
 * "Reply to thread…" affordance and the invoice-group detail page's
 * compact Communication card's "Open thread" button.
 *
 * When `scrollToMessageId` is supplied (e.g. via the
 * `#response-{id}` deep-link landing on the detail page), the
 * conversation panel auto-scrolls to that message after the dialog
 * opens. Anything else just lands at the top of the conversation.
 */
export function GroupCommunicationReplyDialog({
  open,
  onOpenChange,
  conversation,
  isSending,
  onReply,
  scrollToMessageId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: GroupConversation;
  isSending?: boolean;
  onReply: NonNullable<Props["onReply"]>;
  scrollToMessageId?: string | null;
}) {
  const lastInbound = useMemo(
    () =>
      [...conversation.messages]
        .reverse()
        .find((m) => m.direction === "inbound"),
    [conversation.messages],
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // After the dialog mounts (and any time the target id changes while
  // open), find the target message row inside the scrollable panel and
  // bring it into view. Wrapped in rAF so we run after the dialog's
  // initial paint — without it the row's offsetTop is 0 because the
  // portal hasn't laid out yet.
  useEffect(() => {
    if (!open) return;
    const panel = scrollRef.current;
    if (!panel) return;
    const raf = requestAnimationFrame(() => {
      if (scrollToMessageId) {
        const target = panel.querySelector<HTMLElement>(
          `[data-testid="group-thread-msg-${scrollToMessageId}"]`,
        );
        if (target) {
          target.scrollIntoView({ behavior: "auto", block: "start" });
          return;
        }
      }
      panel.scrollTop = 0;
    });
    return () => cancelAnimationFrame(raf);
  }, [open, scrollToMessageId, conversation.messages.length]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl w-[min(960px,95vw)] p-0 gap-0 max-h-[92vh] flex flex-col"
        data-testid="group-thread-reply-dialog"
      >
        <DialogHeader className="px-5 py-3 border-b shrink-0">
          <DialogTitle className="text-base flex items-center gap-2">
            <Reply className="h-4 w-4" />
            Reply — {conversation.subject}
            <Badge variant="secondary" className="text-xs ml-1">
              {conversation.messages.length} message
              {conversation.messages.length === 1 ? "" : "s"}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        {/* Conversation panel — scrolls independently so the composer
            below always stays visible. Reuses MessageRow so the full
            bodies render exactly as they do in the embedded bare
            thread, with no 320-char truncation. */}
        <div
          ref={scrollRef}
          className="flex-1 min-h-[200px] overflow-y-auto border-b bg-muted/10 divide-y"
          data-testid="group-thread-reply-dialog-conversation"
        >
          {conversation.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground italic px-5 py-4">
              No messages on this thread yet.
            </p>
          ) : (
            conversation.messages.map((msg) => (
              <MessageRow key={msg.id} msg={msg} />
            ))
          )}
        </div>
        {/* Composer keeps all of its existing behavior (To/CC/Subject/
            rich-text body/attachments/AI upgrade) — only its position
            changed from "the whole dialog body" to "below the
            conversation panel". */}
        <div className="shrink-0 overflow-y-auto max-h-[55vh]">
          <ReplyComposer
            conversationId={conversation.conversationId}
            defaultTo={lastInbound?.senderEmail ?? ""}
            defaultSubject={`Re: ${conversation.subject.replace(/^re:\s*/i, "")}`}
            isSending={isSending}
            onSend={async (input) => {
              await onReply(input);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MessageRow({ msg }: { msg: GroupEmailMessage }) {
  const isInbound = msg.direction === "inbound";

  // resolveBodyRender picks between sanitized HTML and plain text. The
  // defensive fallback inside also catches the case where a plain-text
  // body somehow contains raw HTML markup, so the renderer never prints
  // literal `<html>` / `<table>` tags as text. See `lib/email-body-render.ts`.
  const rendered = useMemo(
    () =>
      resolveBodyRender({
        bodyHtml: msg.bodyHtml,
        bodyFormat: msg.bodyFormat,
        bodyPreview: msg.bodyPreview,
      }),
    [msg.bodyHtml, msg.bodyFormat, msg.bodyPreview],
  );

  return (
    <div
      className={`px-4 py-3 flex gap-3 ${msg.unread ? "bg-blue-50/60 dark:bg-blue-950/20" : ""}`}
      data-testid={`group-thread-msg-${msg.id}`}
    >
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{
          background: isInbound ? "hsl(45 93% 95%)" : "hsl(270 60% 95%)",
          color: isInbound ? "hsl(45 93% 30%)" : "hsl(270 60% 40%)",
        }}
      >
        {isInbound ? (
          msg.unread ? (
            <Mail className="w-3.5 h-3.5" />
          ) : (
            <MailOpen className="w-3.5 h-3.5" />
          )
        ) : (
          <CornerDownRight className="w-3.5 h-3.5" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap mb-0.5">
          <span className="font-semibold text-sm">{msg.senderName}</span>
          <span className="text-[11px] text-muted-foreground">
            {msg.senderEmail}
          </span>
          {msg.unread && (
            <Badge className="text-[10px] bg-blue-100 text-blue-800 border-blue-300">
              New
            </Badge>
          )}
          <span className="text-xs ml-auto text-muted-foreground shrink-0">
            {formatDateTime(msg.timestamp)}
          </span>
        </div>
        <div className="text-xs font-medium mb-1">{msg.subject}</div>

        {/*
          The message body grows to fit its content — no inner scroll cap
          and no "Show full message" toggle. The page itself does the
          scrolling so operators can read the entire payor reply without
          chasing a hidden viewport. Both consumers (the responses-awaiting-
          review page and the invoice-group detail page) benefit; that's
          intentional per Task #262.
        */}
        {rendered.kind === "html" ? (
          <div
            data-testid={`group-thread-msg-${msg.id}-html`}
            className="email-body text-sm bg-background border rounded-md p-2.5 break-words prose prose-sm max-w-none overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />
        ) : (
          <div
            data-testid={`group-thread-msg-${msg.id}-text`}
            className="text-sm bg-background border rounded-md p-2.5 whitespace-pre-wrap break-words"
          >
            {rendered.text}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap text-[11px] mt-2">
          {msg.attachmentLinks && msg.attachmentLinks.length > 0
            ? msg.attachmentLinks.map((a) => (
                <a
                  key={`${a.downloadUrl}|${a.name}`}
                  href={a.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  data-testid={`group-thread-attachment-link-${msg.id}`}
                  title={a.size != null ? `${a.name} · ${formatBytes(a.size)}` : a.name}
                >
                  <Paperclip className="w-2.5 h-2.5" />
                  <span className="font-mono">{a.name}</span>
                  {a.size != null && (
                    <span className="text-[10px] opacity-70">
                      {formatBytes(a.size)}
                    </span>
                  )}
                </a>
              ))
            : msg.attachments.length > 0 &&
              msg.attachments.map((a) => (
                <span
                  key={a}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                >
                  <Paperclip className="w-2.5 h-2.5" />
                  <span className="font-mono">{a}</span>
                </span>
              ))}
          {msg.mentionedLegIds.length > 0 && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              Mentions:
              {msg.mentionedLegIds.map((leg) => (
                <Link key={leg.id} href={`/claims/${leg.id}`}>
                  <span className="font-mono font-semibold text-primary hover:underline cursor-pointer">
                    {leg.label}
                  </span>
                </Link>
              ))}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface ReplyChip {
  /** Stable client-side id used as React key + remove handle. */
  id: string;
  name: string;
  size: number;
  contentType: string;
  /** "uploading" while the PUT is in flight; "ready" once the server has
   *  returned a `stagedId`; "error" if the upload failed (chip stays so
   *  the user can remove it and try again). */
  status: "uploading" | "ready" | "error";
  /** 0-100 progress hint while uploading. */
  progress: number;
  /** Server-issued staging id, present iff status === "ready". This — not
   *  the storage path — is what gets sent on the reply payload. */
  stagedId: string | null;
  /** Friendly error message for the chip's tooltip when status === "error". */
  errorMessage: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ReplyComposer({
  conversationId,
  defaultTo,
  defaultSubject,
  isSending,
  onSend,
  onCancel,
}: {
  conversationId: string;
  defaultTo: string;
  defaultSubject: string;
  isSending?: boolean;
  onSend: (input: {
    conversationId: string;
    subject: string;
    bodyHtml: string;
    to: string[];
    cc: string[];
    attachments: ReplyAttachmentInput[];
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [bodyHtml, setBodyHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [chips, setChips] = useState<ReplyChip[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Stable id generator for chips. `crypto.randomUUID` isn't available in
  // every preview / iframe sandbox, so we fall back to a counter.
  const chipIdCounter = useRef(0);
  const nextChipId = useCallback(() => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    chipIdCounter.current += 1;
    return `chip-${Date.now()}-${chipIdCounter.current}`;
  }, []);

  const totalBytes = chips.reduce((sum, c) => sum + c.size, 0);
  const imageCount = chips.filter((c) =>
    REPLY_ATTACHMENT_IMAGE_MIME_SET.has(c.contentType),
  ).length;
  const isUploading = chips.some((c) => c.status === "uploading");

  const removeChip = useCallback((id: string) => {
    setChips((prev) => {
      const target = prev.find((c) => c.id === id);
      // Best-effort tell the server to drop the staged blob so the
      // 24h janitor doesn't have to. Ignored on failure — the
      // janitor will sweep it eventually.
      if (target?.stagedId) {
        void fetch(
          `/api/storage/reply-attachments/stage/${encodeURIComponent(target.stagedId)}`,
          { method: "DELETE", credentials: "include" },
        ).catch(() => {});
      }
      return prev.filter((c) => c.id !== id);
    });
  }, []);

  /**
   * Validates each candidate file against the centralized reply-attachment
   * limits, then kicks off a streaming PUT to
   * `/api/storage/reply-attachments/stage` per file. The endpoint runs the
   * authoritative MIME / size validation server-side and returns an opaque
   * `stagedId` we attach to the chip — only that id is sent on the reply
   * payload. Files that fail validation never become chips; files that
   * fail the network call become error chips so the operator can remove
   * them and retry without losing the rest of the draft.
   *
   * Caps enforced here (mirrored on the server):
   *   - up to MAX_REPLY_ATTACHMENT_IMAGES image files (PNG/JPG/GIF/WebP)
   *   - up to MAX_REPLY_ATTACHMENT_FILES total chips
   *   - REPLY_ATTACHMENT_TOTAL_BYTES combined size
   */
  const ingestFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      const accepted: File[] = [];
      let runningCount = chips.length;
      let runningImages = imageCount;
      let runningBytes = totalBytes;
      const rejections: string[] = [];

      for (const f of files) {
        if (runningCount >= MAX_REPLY_ATTACHMENT_FILES) {
          rejections.push(`Skipped "${f.name}" — max ${MAX_REPLY_ATTACHMENT_FILES} attachments per reply.`);
          continue;
        }
        if (!REPLY_ATTACHMENT_ALLOWED_MIME_SET.has(f.type)) {
          rejections.push(`Skipped "${f.name}" — only PNG, JPG, GIF, WebP, and PDF are allowed.`);
          continue;
        }
        const isImage = REPLY_ATTACHMENT_IMAGE_MIME_SET.has(f.type);
        if (isImage && runningImages >= MAX_REPLY_ATTACHMENT_IMAGES) {
          rejections.push(
            `Skipped "${f.name}" — max ${MAX_REPLY_ATTACHMENT_IMAGES} image attachments per reply.`,
          );
          continue;
        }
        if (runningBytes + f.size > REPLY_ATTACHMENT_TOTAL_BYTES) {
          rejections.push(
            `Skipped "${f.name}" — total size would exceed ${formatBytes(REPLY_ATTACHMENT_TOTAL_BYTES)}.`,
          );
          continue;
        }
        accepted.push(f);
        runningCount += 1;
        runningBytes += f.size;
        if (isImage) runningImages += 1;
      }

      if (rejections.length > 0) {
        setError(rejections.join(" "));
      } else {
        setError(null);
      }

      if (accepted.length === 0) return;

      const newChips: ReplyChip[] = accepted.map((f) => ({
        id: nextChipId(),
        name: f.name,
        size: f.size,
        contentType: f.type,
        status: "uploading" as const,
        progress: 5,
        stagedId: null,
        errorMessage: null,
      }));
      setChips((prev) => [...prev, ...newChips]);

      // Fire one streaming PUT per file to the staging endpoint. We don't
      // have native progress events on `fetch` without ReadableStream
      // wiring, so we jump to 60% during the request and 100% on success —
      // matching how the rest of the app already handles object-storage
      // uploads.
      newChips.forEach(async (chip, idx) => {
        const file = accepted[idx];
        try {
          setChips((prev) =>
            prev.map((c) => (c.id === chip.id ? { ...c, progress: 60 } : c)),
          );
          const resp = await fetch("/api/storage/reply-attachments/stage", {
            method: "PUT",
            credentials: "include",
            headers: {
              "Content-Type": file.type,
              "x-upload-name": file.name,
            },
            body: file,
          });
          if (!resp.ok) {
            const body = (await resp.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error || `Upload failed (${resp.status})`);
          }
          const data = (await resp.json()) as {
            stagedId: string;
            size: number;
            contentType: string;
          };
          setChips((prev) =>
            prev.map((c) =>
              c.id === chip.id
                ? {
                    ...c,
                    status: "ready",
                    progress: 100,
                    stagedId: data.stagedId,
                    // Trust the server's recorded size/type from now on
                    // so chip totals match what the server will enforce.
                    size: data.size || c.size,
                    contentType: data.contentType || c.contentType,
                  }
                : c,
            ),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : "Upload failed";
          setChips((prev) =>
            prev.map((c) =>
              c.id === chip.id
                ? { ...c, status: "error", progress: 0, errorMessage: message }
                : c,
            ),
          );
        }
      });
    },
    [chips.length, imageCount, totalBytes, nextChipId],
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    ingestFiles(Array.from(list));
    // Reset so picking the same file twice still fires onChange.
    e.target.value = "";
  };

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      // Pass every clipboard file through `ingestFiles` (don't pre-filter
      // by MIME) so the operator sees the same inline rejection message
      // they'd get from picker / drop. Silently dropping pasted PSDs etc.
      // looked like the paste did nothing.
      const files = extractClipboardFiles(e.clipboardData, { acceptPdf: true });
      if (files.length === 0) return;
      e.preventDefault();
      ingestFiles(files);
    },
    [ingestFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDraggingOver(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length > 0) ingestFiles(files);
    },
    [ingestFiles],
  );

  const handleDragOver = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault();
      setIsDraggingOver(true);
    }
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) setIsDraggingOver(false);
  };
  // Stash of the pre-upgrade draft so we can offer a one-step Undo back
  // to exactly what the user typed. Cleared on send/cancel and replaced
  // every time the user upgrades again.
  const [previousBodyHtml, setPreviousBodyHtml] = useState<string | null>(null);
  // Bumping the editor key after a programmatic body swap (upgrade or
  // undo) is the simplest way to make the uncontrolled TipTap editor
  // pick up the new content — RichTextEditor only reads `content` on
  // initial mount.
  const [editorKey, setEditorKey] = useState(0);
  const { toast } = useToast();
  const upgradeMutation = useUpgradeReplyDraft();

  const bodyPlainCheck = bodyHtml.replace(/<[^>]*>/g, "").trim();
  const canUpgrade = bodyPlainCheck.length > 0 && !upgradeMutation.isPending && !isSending;

  const handleUpgrade = async () => {
    if (!canUpgrade) return;
    const original = bodyHtml;
    try {
      const { upgradedBody } = await upgradeMutation.mutateAsync({
        data: { body: original, subject: subject.trim() || defaultSubject },
      });
      if (typeof upgradedBody !== "string" || upgradedBody.trim().length === 0) {
        throw new Error("AI returned an empty rewrite.");
      }
      setPreviousBodyHtml(original);
      setBodyHtml(upgradedBody);
      setEditorKey((k) => k + 1);
      setError(null);
      toast({
        title: "Draft upgraded",
        description: "Review the changes and click Undo if you'd rather keep your original wording.",
        duration: 4000,
      });
    } catch (err) {
      // Original draft is preserved (we never touched bodyHtml on failure).
      const msg = err instanceof Error ? err.message : "Couldn't upgrade the draft.";
      toast({
        title: "Upgrade failed",
        description: msg,
        variant: "destructive",
      });
    }
  };

  const handleUndoUpgrade = () => {
    if (previousBodyHtml === null) return;
    setBodyHtml(previousBodyHtml);
    setPreviousBodyHtml(null);
    setEditorKey((k) => k + 1);
  };

  const handleSend = async () => {
    const toList = to
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (toList.length === 0) {
      setError("At least one recipient is required.");
      return;
    }
    const plainCheck = bodyHtml.replace(/<[^>]*>/g, "").trim();
    if (!plainCheck) {
      setError("Reply body cannot be empty.");
      return;
    }
    if (isUploading) {
      setError("Please wait for attachments to finish uploading.");
      return;
    }
    // Drop any error chips silently — they never made it to storage so
    // there's nothing to send. Operators see the chip turn red and can
    // remove it themselves; we don't want to surprise them by sending a
    // reply with fewer attachments than they expected.
    const readyAttachments: ReplyAttachmentInput[] = chips
      .filter((c) => c.status === "ready" && c.stagedId)
      .map((c) => ({ stagedId: c.stagedId as string }));
    const errorChipCount = chips.filter((c) => c.status === "error").length;
    if (errorChipCount > 0) {
      setError(
        `${errorChipCount} attachment${errorChipCount === 1 ? "" : "s"} failed to upload. Remove them or retry before sending.`,
      );
      return;
    }
    setError(null);
    try {
      await onSend({
        conversationId,
        subject: subject.trim() || defaultSubject,
        bodyHtml,
        to: toList,
        cc: cc
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean),
        attachments: readyAttachments,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send reply.",
      );
    }
  };

  return (
    <div
      className={`px-4 py-3 space-y-2 bg-blue-50/30 dark:bg-blue-950/10 ${isDraggingOver ? "ring-2 ring-primary ring-inset" : ""}`}
      data-testid="group-thread-reply-composer"
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
        Compose reply
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <Label htmlFor="group-reply-to" className="text-xs">
            To
          </Label>
          <Input
            id="group-reply-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@example.com"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label htmlFor="group-reply-cc" className="text-xs">
            CC (optional)
          </Label>
          <Input
            id="group-reply-cc"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            placeholder="cc@example.com"
            className="h-8 text-sm"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="group-reply-subject" className="text-xs">
          Subject
        </Label>
        <Input
          id="group-reply-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="h-8 text-sm"
        />
      </div>
      <div>
        <Label className="text-xs">Message</Label>
        <RichTextEditor
          key={editorKey}
          content={bodyHtml}
          onUpdate={setBodyHtml}
          placeholder="Write your reply… mention legs with CLM-XXXX to link them."
        />
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Sparkles className="h-3 w-3" />
        Rich text formatting — bold, italic, lists, links, and quotes are
        supported.
      </div>
      <div data-testid="group-thread-attachments">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={Array.from(REPLY_ATTACHMENT_ALLOWED_MIME_SET).join(",")}
          className="hidden"
          onChange={handleFileInputChange}
          data-testid="group-thread-attach-file-input"
        />
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={
              isSending ||
              chips.length >= MAX_REPLY_ATTACHMENT_FILES ||
              totalBytes >= REPLY_ATTACHMENT_TOTAL_BYTES
            }
            data-testid="group-thread-attach-button"
          >
            <Paperclip className="h-3 w-3 mr-1" /> Attach files
          </Button>
          <span className="text-muted-foreground">
            {chips.length} / {MAX_REPLY_ATTACHMENT_FILES} files · {imageCount} /{" "}
            {MAX_REPLY_ATTACHMENT_IMAGES} images ·{" "}
            {formatBytes(totalBytes)} / {formatBytes(REPLY_ATTACHMENT_TOTAL_BYTES)}
          </span>
          <span className="text-muted-foreground hidden sm:inline">
            · Drop files or paste from clipboard
          </span>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {chips.map((chip) => {
              const isImage = chip.contentType.startsWith("image/");
              const isError = chip.status === "error";
              const isUploadingChip = chip.status === "uploading";
              return (
                <span
                  key={chip.id}
                  data-testid={`group-thread-attachment-chip-${chip.id}`}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] max-w-full ${
                    isError
                      ? "bg-destructive/10 border-destructive/30 text-destructive"
                      : isUploadingChip
                        ? "bg-muted border-muted-foreground/20 text-muted-foreground"
                        : "bg-background border-border text-foreground"
                  }`}
                  title={
                    isError
                      ? chip.errorMessage || "Upload failed"
                      : `${chip.name} · ${formatBytes(chip.size)}`
                  }
                >
                  {isUploadingChip ? (
                    <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  ) : isImage ? (
                    <ImageIcon className="h-3 w-3 shrink-0" />
                  ) : (
                    <FileText className="h-3 w-3 shrink-0" />
                  )}
                  <span className="truncate max-w-[180px]">{chip.name}</span>
                  <span className="text-[10px] opacity-70 shrink-0">
                    {formatBytes(chip.size)}
                  </span>
                  {isUploadingChip && (
                    <span className="text-[10px] opacity-70 shrink-0">
                      {chip.progress}%
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeChip(chip.id)}
                    disabled={isSending}
                    className="ml-0.5 hover:bg-muted-foreground/10 rounded p-0.5 shrink-0"
                    aria-label={`Remove ${chip.name}`}
                    data-testid={`group-thread-attachment-remove-${chip.id}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>
      {error && (
        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded p-2">
          {error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2 pt-1 flex-wrap">
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={isSending}
        >
          Cancel
        </Button>
        {previousBodyHtml !== null && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleUndoUpgrade}
            disabled={upgradeMutation.isPending || isSending}
            data-testid="group-thread-undo-upgrade"
            title="Restore your original draft"
          >
            <Undo2 className="h-3 w-3 mr-1" /> Undo upgrade
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={handleUpgrade}
          disabled={!canUpgrade}
          data-testid="group-thread-upgrade-with-ai"
          title={
            bodyPlainCheck.length === 0
              ? "Write a draft first, then I'll polish it."
              : "Polish grammar and structure without changing meaning."
          }
        >
          {upgradeMutation.isPending ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Upgrading…
            </>
          ) : (
            <>
              <Wand2 className="h-3 w-3 mr-1" /> Upgrade with AI
            </>
          )}
        </Button>
        <Button
          size="sm"
          onClick={handleSend}
          disabled={isSending || upgradeMutation.isPending || isUploading}
          data-testid="group-thread-send-reply"
          title={isUploading ? "Waiting for attachment uploads to finish…" : undefined}
        >
          {isSending ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Sending…
            </>
          ) : isUploading ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Uploading…
            </>
          ) : (
            <>
              <Send className="h-3 w-3 mr-1" /> Send reply
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

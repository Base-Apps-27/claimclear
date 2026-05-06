import { useMemo, useState } from "react";
import { Link } from "wouter";
import { resolveBodyRender } from "@/lib/email-body-render";
import { useUpgradeReplyDraft } from "@workspace/api-client-react";
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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/format";
import { RichTextEditor } from "./rich-text-editor";

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
  mentionedLegIds: { id: number; label: string }[];
  unread?: boolean;
  responseType?: string | null;
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
    return (
      <div className="space-y-4" data-testid="group-communication-thread">
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
            <div className="border-t">
              {!replyOpen ? (
                <div className="px-4 py-2.5 flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => setReplyOpen(true)}
                    data-testid="group-thread-reply-trigger"
                  >
                    <Reply className="h-3 w-3 mr-1" /> Reply to thread
                  </Button>
                </div>
              ) : (
                <ReplyComposer
                  conversationId={conversation.conversationId}
                  defaultTo={lastInbound?.senderEmail ?? ""}
                  defaultSubject={`Re: ${conversation.subject.replace(/^re:\s*/i, "")}`}
                  isSending={isSending}
                  onSend={async (input) => {
                    await onReply(input);
                    setReplyOpen(false);
                  }}
                  onCancel={() => setReplyOpen(false)}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
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
          {msg.attachments.length > 0 &&
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
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [bodyHtml, setBodyHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
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
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send reply.",
      );
    }
  };

  return (
    <div
      className="px-4 py-3 space-y-2 bg-blue-50/30 dark:bg-blue-950/10"
      data-testid="group-thread-reply-composer"
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
        <Button size="sm" onClick={handleSend} disabled={isSending || upgradeMutation.isPending}>
          {isSending ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Sending…
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

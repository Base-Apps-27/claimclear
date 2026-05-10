// ChipDrawerOverlay — right-edge floating drawer for the chip-panel
// content. Originally lived inside `inline-group-workspace-mini.tsx`;
// moved here in Task #678 so the per-leg detail page can mount the same
// drawer when the operator clicks the "Open group ↗" arrow on the
// Parent invoice card.
//
// All `data-testid="chip-drawer-*"` ids are preserved so existing
// render tests keep passing.

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useExcludeLeg,
  useGetInvoiceGroupEmailThread,
  useReplyToInvoiceGroupEmailConversation,
  useListClaimNotes,
  useCreateClaimNote,
  useDeleteNote,
  useMarkLegDuplicate,
  getGetInvoiceGroupQueryKey,
  getListInvoiceGroupsQueryKey,
  getListClaimNotesQueryKey,
  getGetInvoiceGroupEmailThreadQueryKey,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  InvoiceGroupDetailResponse,
  EmailThreadConversation,
  EmailThreadMessage,
  NoteResponse,
} from "@workspace/api-client-react";
import {
  buildLegResolvedIndex,
  deriveLegSubStatus,
} from "@workspace/leg-state";
import { legSubStatusLabel } from "@workspace/vocab";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  Copy,
  HelpCircle,
  Link2Off,
  Loader2,
  MessageSquare,
  Paperclip,
  StickyNote,
  Tag,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RefNumber } from "@/components/ref-number";
import { EvidenceFileList } from "@/components/evidence-file-list";
import { ActivityFeed } from "@/components/activity-feed";
import type { ActionCategory } from "@/lib/audit-action-meta";
import { formatCurrency } from "@/lib/format";
import { HideForClerk } from "@/lib/role";
import { useToast, successToast } from "@/hooks/use-toast";

export type ChipKey = "evidence" | "notes" | "comms" | "activity";

export type DetailGroup = InvoiceGroupDetailResponse & {
  previewGeneratedAt?: string | null;
  draftReviewedAt?: string | null;
  holdReason?: string | null;
  payorEmailBounceState?: {
    kind: "hard_bounced";
    email: string;
    reason: string;
    bouncedAt: string;
  } | null;
};

export const CHIP_LABEL: Record<ChipKey, string> = {
  evidence: "Evidence",
  notes: "Notes",
  comms: "Comms",
  activity: "Activity",
};

export const CHIP_ICON: Record<ChipKey, React.FC<{ className?: string }>> = {
  evidence: Paperclip,
  notes: StickyNote,
  comms: MessageSquare,
  activity: Activity,
};

export function legStateIcon(
  leg: ClaimResponse,
  resolvedIndex: ReturnType<typeof buildLegResolvedIndex>,
) {
  if (leg.includedInDispute === false) {
    return <XCircle className="w-3 h-3" aria-label="excluded" />;
  }
  if (resolvedIndex.isLegResolved(leg)) {
    return <CheckCircle2 className="w-3 h-3" aria-label="resolved" />;
  }
  if (!leg.errorTypeName) {
    return <HelpCircle className="w-3 h-3" aria-label="needs classification" />;
  }
  return <Circle className="w-3 h-3" aria-label="pending" />;
}

export function ChipDrawerOverlay({
  openChip,
  leg,
  detail,
  rides,
  resolvedIndex,
  groupId,
  onSelectLeg,
  onOpenClassify,
  onOpenMarkDuplicate,
  onClose,
}: {
  openChip: ChipKey;
  leg: ClaimResponse;
  detail: DetailGroup;
  rides: ClaimResponse[];
  resolvedIndex: ReturnType<typeof buildLegResolvedIndex>;
  groupId: number;
  onSelectLeg: ((id: number) => void) | null;
  onOpenClassify: () => void;
  onOpenMarkDuplicate: () => void;
  onClose: () => void;
}) {
  const evidenceFiles = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ url: string; size?: number | null }> = [];
    for (const f of [...(detail.evidenceFiles ?? []), ...(leg.evidenceFiles ?? [])]) {
      const ref = f as { url?: string; size?: number } | null | undefined;
      const url = ref?.url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, size: ref?.size ?? null });
    }
    const groupRows = (detail as { groupEvidence?: Array<{ imageUrl?: string | null }> }).groupEvidence ?? [];
    const legRows = (leg as { evidence?: Array<{ imageUrl?: string | null }> }).evidence ?? [];
    for (const r of [...groupRows, ...legRows]) {
      const url = r?.imageUrl;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, size: null });
    }
    return out;
  }, [detail.evidenceFiles, leg.evidenceFiles, (detail as { groupEvidence?: unknown }).groupEvidence, (leg as { evidence?: unknown }).evidence]);
  const evidenceUrls = useMemo(() => evidenceFiles.map((f) => f.url), [evidenceFiles]);
  const evidenceSizeMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of evidenceFiles) {
      if (f.size != null && f.size > 0) m.set(f.url, f.size);
    }
    return m;
  }, [evidenceFiles]);
  const inlineNote = (leg.evidenceNotes ?? "").trim();
  const fullHref = `/invoice-groups/${detail.id}?leg=${leg.id}`;
  const activeLegIndex = rides.findIndex((r) => r.id === leg.id);

  const legSubStatus = deriveLegSubStatus(leg);
  const legStatusLabel = legSubStatusLabel(legSubStatus);

  const qc = useQueryClient();
  const { toast } = useToast();
  const excludeMutation = useExcludeLeg();

  function onExclude() {
    excludeMutation.mutate(
      { id: leg.id, data: { reason: "other" as const, note: "Excluded via drawer" } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
          qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
          successToast({ title: "Done", description: "Leg excluded from dispute." });
        },
        onError: (e: unknown) =>
          toast({ title: "Exclude failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
      },
    );
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/10"
        onClick={onClose}
        data-testid="chip-drawer-backdrop"
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label={`${CHIP_LABEL[openChip]} — quick view`}
        data-testid={`chip-drawer-${openChip}`}
        className="cc-scope cc-mini fixed right-3 top-1/2 z-50 -translate-y-1/2 w-[360px] max-w-[calc(100vw-1.5rem)] max-h-[85vh] flex flex-col gap-2 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-xl border bg-card shadow-2xl p-2.5 flex flex-col gap-1.5 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Link href={fullHref}>
              <a
                aria-label="Open invoice group in full view"
                title="Open invoice group in full view"
                className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-50 text-blue-600 border border-blue-200 shrink-0 hover:bg-blue-100"
                data-testid="chip-drawer-open-invoice"
              >
                <ArrowUpRight className="w-3 h-3" />
              </a>
            </Link>
            <RefNumber
              value={detail.invoiceNumber}
              variant="inline"
              className="text-xs font-semibold flex-1 min-w-0 truncate"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={onClose}
              aria-label="Close drawer"
              title="Close"
              data-testid="chip-drawer-close"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
            {(detail as DetailGroup & { payorEmail?: string }).payorEmail && (
              <>
                <span className="text-[11px]">{(detail as DetailGroup & { payorEmail?: string }).payorEmail}</span>
                <span>·</span>
              </>
            )}
            <HideForClerk>
              <span className="font-semibold text-foreground text-xs">
                {formatCurrency(detail.totalAmount)}
              </span>
              <span>·</span>
            </HideForClerk>
            <span>
              {detail.rideCount} leg{detail.rideCount === 1 ? "" : "s"}
            </span>
          </div>
          {rides.length > 0 && onSelectLeg != null && (
            <div
              className="cc-segmented w-full"
              role="tablist"
              aria-label="Legs"
              data-testid="chip-drawer-leg-tabs"
            >
              {rides.map((r, i) => {
                const isActive = r.id === leg.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={isActive ? "is-active" : ""}
                    onClick={() => onSelectLeg(r.id)}
                    data-testid={`chip-drawer-leg-tab-${r.id}`}
                  >
                    Leg {i + 1} {legStateIcon(r, resolvedIndex)}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-card shadow-2xl p-2.5 flex flex-col gap-1.5 shrink-0">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-mono text-[15px] font-bold tracking-tight flex-1 min-w-0 truncate leading-tight">
              {leg.confNumber ?? `Leg ${activeLegIndex + 1}`}
            </span>
            {rides.length > 0 && (
              <span className="text-[11px] text-muted-foreground shrink-0">
                Leg {activeLegIndex + 1} of {rides.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
            {leg.errorTypeName ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5">
                <AlertTriangle className="w-3 h-3" />
                {leg.errorTypeName}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground border px-2 py-0.5">
                <HelpCircle className="w-3 h-3" />
                Unclassified
              </span>
            )}
            {leg.date && (
              <span className="text-muted-foreground">{leg.date}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
            <HideForClerk>
              <span className="text-[13px] font-semibold">
                {formatCurrency(leg.claimAmount ?? "0")}
              </span>
            </HideForClerk>
            <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 text-[11px] ml-auto">
              {legStatusLabel}
            </span>
          </div>
          {leg.includedInDispute === false && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground border px-2 py-0.5">
                <XCircle className="w-3 h-3" /> Excluded
              </span>
            </div>
          )}
          <div className="flex items-center gap-1 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                onOpenClassify();
                onClose();
              }}
              data-testid="chip-drawer-reclassify"
            >
              <Tag className="w-3 h-3 mr-1" />
              {leg.errorTypeName ? "Reclassify" : "Classify"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                onOpenMarkDuplicate();
                onClose();
              }}
              disabled={!!leg.duplicateOfClaimId}
              data-testid="chip-drawer-mark-duplicate"
            >
              <Copy className="w-3 h-3 mr-1" />
              Mark duplicate
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={onExclude}
              disabled={excludeMutation.isPending || leg.includedInDispute === false}
              data-testid="chip-drawer-exclude"
            >
              <Link2Off className="w-3 h-3 mr-1" />
              Exclude
            </Button>
          </div>
        </div>

        <div className="rounded-xl border bg-card shadow-2xl flex flex-col flex-1 min-h-0 overflow-hidden">
          <header className="flex items-center gap-2 border-b px-3 py-1.5 shrink-0">
            {(() => { const Icon = CHIP_ICON[openChip]; return <Icon className="w-3.5 h-3.5 text-foreground" />; })()}
            <span className="text-xs font-semibold">{CHIP_LABEL[openChip]}</span>
            {(() => {
              let count = 0;
              if (openChip === "evidence") count = evidenceUrls.length;
              else if (openChip === "notes") count = (detail.notes ?? []).length + (inlineNote ? 1 : 0);
              else if (openChip === "activity") count = (detail.auditLogs ?? []).length;
              return count > 0 ? (
                <span className="inline-flex items-center justify-center rounded bg-blue-50 text-blue-700 text-[10px] font-semibold px-1.5 py-0.5 leading-none">
                  {count}
                </span>
              ) : null;
            })()}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 ml-auto shrink-0"
              onClick={onClose}
              aria-label="Close section"
              data-testid="chip-drawer-section-close"
            >
              <X className="h-3 w-3" />
            </Button>
          </header>
          <div className="overflow-auto p-3 flex-1 min-h-0">
            {openChip === "evidence" && <EvidenceFileList urls={evidenceUrls} sizeMap={evidenceSizeMap} />}
            {openChip === "notes" && (
              <NotesPanel leg={leg} inlineNote={inlineNote} />
            )}
            {openChip === "comms" && <CommsPanel groupId={groupId} />}
            {openChip === "activity" && (
              <ActivityPanel detail={detail} groupId={groupId} legId={leg.id} />
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function NotesPanel({
  leg,
  inlineNote,
}: {
  leg: ClaimResponse;
  inlineNote: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: notes, isLoading } = useListClaimNotes(leg.id);
  const create = useCreateClaimNote();
  const remove = useDeleteNote();
  const [draft, setDraft] = useState("");
  // Task #681 — delete-note now requires an explicit confirm step.
  // Ported from the per-leg detail page (claim-detail-v2.tsx) so the
  // canonical notes surface (this drawer) gates accidental deletes
  // the same way the audit-only detail page used to.
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<number | null>(null);

  function refreshNotes() {
    qc.invalidateQueries({ queryKey: getListClaimNotesQueryKey(leg.id) });
  }

  function submit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    create.mutate(
      { id: leg.id, data: { content: trimmed } },
      {
        onSuccess: () => {
          setDraft("");
          refreshNotes();
          successToast({ title: "Done", description: "Note added" });
        },
        onError: (e: unknown) =>
          toast({
            title: "Add note failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  function confirmDelete() {
    const noteId = pendingDeleteNoteId;
    if (noteId == null || remove.isPending) return;
    remove.mutate(
      { id: noteId },
      {
        onSuccess: () => {
          setPendingDeleteNoteId(null);
          refreshNotes();
          successToast({ title: "Done", description: "Note deleted" });
        },
        onError: (e: unknown) =>
          toast({
            title: "Delete failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  return (
    <div className="text-xs space-y-2" data-testid="mini-notes-panel">
      {inlineNote && (
        <div className="rounded border bg-muted/40 p-2 whitespace-pre-wrap">
          <div className="font-medium text-muted-foreground mb-0.5">
            Evidence note
          </div>
          {inlineNote}
        </div>
      )}
      {isLoading ? (
        <div className="text-muted-foreground">Loading notes…</div>
      ) : (notes ?? []).length === 0 ? (
        <div className="text-muted-foreground">No notes yet.</div>
      ) : (
        <ul className="space-y-1.5">
          {(notes ?? []).map((n: NoteResponse) => (
            <li
              key={n.id}
              className="rounded border p-2 flex items-start gap-2"
              data-testid={`mini-note-${n.id}`}
            >
              <div className="flex-1 min-w-0">
                <div className="whitespace-pre-wrap">{n.content}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {n.author ?? "—"}
                  {n.createdAt ? ` · ${new Date(n.createdAt).toLocaleString()}` : ""}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5"
                onClick={() => setPendingDeleteNoteId(n.id)}
                disabled={remove.isPending}
                aria-label="Delete note"
                data-testid={`mini-note-delete-${n.id}`}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-1.5">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note for the team…"
          rows={2}
          data-testid="mini-note-composer"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={submit}
            disabled={!draft.trim() || create.isPending}
            data-testid="mini-note-submit"
          >
            {create.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : null}
            Add note
          </Button>
        </div>
      </div>

      <AlertDialog
        open={pendingDeleteNoteId != null}
        onOpenChange={(open) => { if (!open) setPendingDeleteNoteId(null); }}
      >
        <AlertDialogContent data-testid="mini-note-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>
              The note will be removed from the leg and an audit row
              will record who deleted it. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="mini-note-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={remove.isPending}
              data-testid="mini-note-delete-confirm-action"
            >
              {remove.isPending ? "Deleting…" : "Delete note"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CommsPanel({ groupId }: { groupId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: thread, isLoading } = useGetInvoiceGroupEmailThread(groupId);
  const reply = useReplyToInvoiceGroupEmailConversation();
  const [body, setBody] = useState("");

  const conversations: EmailThreadConversation[] = useMemo(() => {
    return thread?.conversations ?? [];
  }, [thread]);
  const latest: EmailThreadConversation | undefined = conversations[0];

  function send() {
    if (!latest) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    reply.mutate(
      {
        id: groupId,
        conversationId: latest.conversationId,
        data: {
          subject: latest.latestSubject ?? "Re: invoice dispute",
          bodyText: trimmed,
          to: latest.latestInboundSender ? [latest.latestInboundSender] : [],
        },
      },
      {
        onSuccess: () => {
          setBody("");
          qc.invalidateQueries({
            queryKey: getGetInvoiceGroupEmailThreadQueryKey(groupId),
          });
          successToast({ title: "Done", description: "Reply sent" });
        },
        onError: (e: unknown) =>
          toast({
            title: "Send failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  return (
    <div className="text-xs space-y-2" data-testid="mini-comms-panel">
      {isLoading ? (
        <div className="text-muted-foreground">Loading messages…</div>
      ) : conversations.length === 0 ? (
        <div className="text-muted-foreground">No payor messages yet.</div>
      ) : (
        <div className="space-y-1.5">
          <div className="font-medium text-muted-foreground">
            Latest conversation
          </div>
          <ul className="space-y-1.5 max-h-48 overflow-y-auto">
            {(latest?.messages ?? []).slice(-4).map((m: EmailThreadMessage) => (
              <li
                key={m.id}
                className="rounded border p-2"
                data-testid={`mini-comms-msg-${m.id}`}
              >
                <div className="text-[10px] text-muted-foreground">
                  {m.direction === "outbound" ? "→ " : "← "}
                  {m.sender}
                  {m.timestamp ? ` · ${new Date(m.timestamp).toLocaleString()}` : ""}
                </div>
                {m.subject && (
                  <div className="font-medium truncate">{m.subject}</div>
                )}
                <div className="whitespace-pre-wrap line-clamp-3">
                  {m.bodyPreview ?? ""}
                </div>
              </li>
            ))}
          </ul>
          {latest && (
            <div className="space-y-1.5">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Reply to the latest message…"
                rows={2}
                data-testid="mini-comms-composer"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={send}
                  disabled={!body.trim() || reply.isPending}
                  data-testid="mini-comms-send"
                >
                  {reply.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  ) : null}
                  Send reply
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityPanel({
  detail,
  groupId,
  legId,
}: {
  detail: DetailGroup;
  groupId: number;
  legId: number;
}) {
  const [filter, setFilter] = useState<ActionCategory | "all">("all");
  const auditLogs = (detail.auditLogs ?? []) as React.ComponentProps<typeof ActivityFeed>["auditLogs"];
  const notes = (detail.notes ?? []) as React.ComponentProps<typeof ActivityFeed>["notes"];
  return (
    <div className="text-xs space-y-2" data-testid="mini-activity-panel">
      <ActivityFeed
        auditLogs={auditLogs}
        notes={notes}
        kind="group"
        filter={filter}
        onFilterChange={setFilter}
        title="Activity"
        className="border-0 shadow-none bg-transparent"
        maxHeightClass="max-h-[40vh]"
        testId="drawer-activity-feed"
      />
      <div className="flex justify-end pt-1 border-t">
        <Link
          href={`/invoice-groups/${groupId}?leg=${legId}#activity`}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          aria-label="Open invoice group activity in full view"
          title="Open invoice group activity in full view"
        >
          Open full activity view <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}

export function MarkDuplicateDialog({
  open,
  onOpenChange,
  legId,
  groupId,
  rides,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  legId: number;
  groupId: number;
  rides: ClaimResponse[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const mutation = useMarkLegDuplicate();
  const [primaryId, setPrimaryId] = useState("");
  const [note, setNote] = useState("");

  const siblings = rides.filter((r) => r.id !== legId);

  function submit() {
    const id = Number(primaryId);
    if (!Number.isFinite(id) || id <= 0) return;
    mutation.mutate(
      { id: legId, data: { primaryClaimId: id, note: note || null } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
          qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
          successToast({ title: "Done", description: "Leg marked as duplicate." });
          onOpenChange(false);
          setPrimaryId("");
          setNote("");
        },
        onError: (e: unknown) =>
          toast({ title: "Mark duplicate failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Mark as sibling duplicate</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <div>
            <label className="font-medium block mb-1">Primary leg (original)</label>
            {siblings.length > 0 ? (
              <select
                className="w-full border rounded px-2 py-1.5 text-xs bg-background"
                value={primaryId}
                onChange={(e) => setPrimaryId(e.target.value)}
              >
                <option value="">Select a leg…</option>
                {siblings.map((s, i) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.confNumber ?? `Leg ${i + 1}`} (#{s.id})
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-muted-foreground">No sibling legs available.</div>
            )}
          </div>
          <div>
            <label className="font-medium block mb-1">Note (optional)</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why is this a duplicate?"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={!primaryId || mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
            Mark duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


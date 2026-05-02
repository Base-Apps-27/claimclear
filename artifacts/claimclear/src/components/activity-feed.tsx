import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { Filter, Mail, StickyNote } from "lucide-react";
import {
  humanizeAuditAction,
  ACTION_CATEGORY_LABELS,
  type ActionCategory,
} from "@/lib/audit-action-meta";
import { closureReasonLabel } from "@/lib/closure-reasons";
import { summarizePreflightMetadata } from "@/lib/prompt-context-counters";

type ActivityAuditLog = {
  id: number;
  action: string;
  details?: string | null;
  timestamp?: string;
  userName?: string | null;
  userEmail?: string | null;
  viaGroup?: boolean;
  invoiceGroupId?: number | null;
  invoiceNumber?: string | null;
  metadata?: Record<string, unknown> | null;
};

type ClosureMetadata = {
  closureReason?: string | null;
  closureCategory?: string | null;
  closureCategoryOther?: string | null;
  closureRootCause?: string | null;
  closureRootCauseOther?: string | null;
  closureNarrative?: string | null;
  closureAccountabilityTags?: string[] | null;
  closureAccountabilityOther?: string | null;
  closureDrivers?: Array<{ name?: string | null; id?: string | null }> | null;
  closureDispatchers?: Array<{ name?: string | null; id?: string | null }> | null;
  closureCommunicatedTo?: string | null;
};

function readClosureBlock(metadata: unknown): ClosureMetadata | null {
  if (!metadata || typeof metadata !== "object") return null;
  const c = (metadata as Record<string, unknown>).closure;
  if (!c || typeof c !== "object") return null;
  return c as ClosureMetadata;
}

function readReviewBlock(metadata: unknown): { closureCommunicatedTo?: string | null; closureReviewNotes?: string | null } | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const communicatedTo = typeof m.closureCommunicatedTo === "string" ? m.closureCommunicatedTo : null;
  const reviewNotes = typeof m.closureReviewNotes === "string" ? m.closureReviewNotes : null;
  if (!communicatedTo && !reviewNotes) return null;
  return { closureCommunicatedTo: communicatedTo, closureReviewNotes: reviewNotes };
}

function namesList(
  people: Array<{ name?: string | null; id?: string | null }> | null | undefined,
): string {
  if (!people || people.length === 0) return "";
  return people
    .map((p) => (p?.name ?? "").trim())
    .filter((n) => n.length > 0)
    .join(", ");
}

type ActivityNote = {
  id: number;
  type?: string | null;
  content: string;
  author?: string | null;
  emailSubject?: string | null;
  createdAt?: string;
};

export interface ActivityFeedProps {
  auditLogs: ActivityAuditLog[];
  notes: ActivityNote[];
  /** Whether the host entity is a claim or invoice group — drives icon/label
   *  selection for direct (non-`viaGroup`) audit rows. */
  kind: "claim" | "group";
  filter: ActionCategory | "all";
  onFilterChange: (value: ActionCategory | "all") => void;
  title?: string;
  className?: string;
  testId?: string;
  maxHeightClass?: string;
}

type FeedItem =
  | {
      kind: "audit";
      id: number;
      timestamp: string | undefined;
      log: ActivityAuditLog;
      category: ActionCategory;
      sourceKind: "claim" | "group";
    }
  | { kind: "note"; id: number; timestamp: string | undefined; note: ActivityNote };

export function ActivityFeed({
  auditLogs,
  notes,
  kind,
  filter,
  onFilterChange,
  title = "Activity",
  className,
  testId = "list-activity-feed",
  maxHeightClass = "max-h-[400px]",
}: ActivityFeedProps) {
  const feed: FeedItem[] = [
    ...auditLogs.map((log): FeedItem => {
      // A claim-detail feed may include rows that originated at the parent
      // group level. Always interpret those with the group action vocabulary
      // so labels read correctly ("Evidence collected" rather than a fallback).
      const sourceKind: "claim" | "group" = log.viaGroup ? "group" : kind;
      const meta = humanizeAuditAction(log.action, sourceKind);
      return {
        kind: "audit",
        id: log.id,
        timestamp: log.timestamp,
        log,
        category: meta.category,
        sourceKind,
      };
    }),
    ...notes.map((note): FeedItem => ({
      kind: "note",
      id: note.id,
      timestamp: note.createdAt,
      note,
    })),
  ].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });

  const filtered = filter === "all"
    ? feed
    : feed.filter((item) =>
        item.kind === "audit"
          ? item.category === filter
          : filter === "communication",
      );

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">{title}</CardTitle>
        <Select value={filter} onValueChange={(v) => onFilterChange(v as ActionCategory | "all")}>
          <SelectTrigger className="h-7 w-[170px] text-xs" data-testid="select-activity-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ACTION_CATEGORY_LABELS) as Array<ActionCategory | "all">).map((key) => (
              <SelectItem key={key} value={key} className="text-xs">
                {ACTION_CATEGORY_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          filter === "all" ? (
            <EmptyState
              icon={StickyNote}
              title="No activity yet"
              description={`Status changes, notes, and edits on this ${kind === "group" ? "group" : "claim"} will appear here.`}
              className="py-6"
            />
          ) : (
            <EmptyState
              icon={Filter}
              title="No matching activity"
              description="Try a different category to see more activity."
              primaryAction={{ label: "Clear filter", onClick: () => onFilterChange("all") }}
              className="py-6"
            />
          )
        ) : (
          <div className={`space-y-3 ${maxHeightClass} overflow-y-auto`} data-testid={testId}>
            {filtered.map((item) => {
              if (item.kind === "audit") {
                const meta = humanizeAuditAction(item.log.action, item.sourceKind);
                const Icon = meta.icon;
                const isViaGroup = !!item.log.viaGroup;
                const closure =
                  item.log.action === "outcome_changed"
                    ? readClosureBlock(item.log.metadata)
                    : null;
                const review =
                  item.log.action === "closure_addressed" ||
                  item.log.action === "closure_review_updated"
                    ? readReviewBlock(item.log.metadata)
                    : null;
                // Preflight per-leg-context audit counters (Task #311):
                // surface what extra context the AI prompt actually saw
                // when the operator ran the readback so reviewers can
                // tell at a glance whether per-leg findings or sibling
                // duplicate rollups influenced the AI's understanding.
                const preflight =
                  item.log.action === "portal_understanding_preflight"
                    ? summarizePreflightMetadata(item.log.metadata)
                    : null;
                const driverNames = closure ? namesList(closure.closureDrivers) : "";
                const dispatcherNames = closure ? namesList(closure.closureDispatchers) : "";
                const reasonLabel = closure?.closureReason
                  ? closureReasonLabel(closure.closureReason)
                  : "";
                const categoryLabel = closure?.closureCategory === "other"
                  ? (closure.closureCategoryOther?.trim() || "Other")
                  : (closure?.closureCategory ?? "");
                const rootCauseLabel = closure?.closureRootCause === "other"
                  ? (closure.closureRootCauseOther?.trim() || "Other")
                  : (closure?.closureRootCause ?? "");
                return (
                  <div
                    key={`audit-${item.id}`}
                    className="flex gap-2 border-l-2 border-muted pl-3 py-1"
                    data-testid={isViaGroup ? `activity-via-group-${item.id}` : `activity-audit-${item.id}`}
                  >
                    <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${meta.iconClass}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium flex items-center gap-1 flex-wrap">
                        <span>{meta.label}</span>
                        {isViaGroup && item.log.invoiceGroupId != null && (
                          <Link
                            href={`/invoice-groups/${item.log.invoiceGroupId}`}
                            className="inline-flex"
                            data-testid={`badge-via-group-${item.id}`}
                          >
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 px-1.5 font-normal border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800"
                            >
                              via INV-{item.log.invoiceNumber ?? item.log.invoiceGroupId}
                            </Badge>
                          </Link>
                        )}
                      </p>
                      {item.log.details && (
                        <p className="text-xs text-muted-foreground break-words">{item.log.details}</p>
                      )}
                      {closure && (
                        <div
                          className="mt-1.5 rounded border border-muted bg-muted/30 px-2 py-1.5 text-xs space-y-1"
                          data-testid={`activity-closure-${item.id}`}
                        >
                          {reasonLabel && (
                            <div className="flex gap-1.5 flex-wrap">
                              <span className="font-semibold text-muted-foreground">Reason:</span>
                              <span className="text-foreground">{reasonLabel}</span>
                            </div>
                          )}
                          {categoryLabel && (
                            <div className="flex gap-1.5 flex-wrap">
                              <span className="font-semibold text-muted-foreground">Category:</span>
                              <span className="text-foreground">{categoryLabel}</span>
                            </div>
                          )}
                          {rootCauseLabel && (
                            <div className="flex gap-1.5 flex-wrap">
                              <span className="font-semibold text-muted-foreground">Root cause:</span>
                              <span className="text-foreground">{rootCauseLabel}</span>
                            </div>
                          )}
                          {closure.closureAccountabilityTags && closure.closureAccountabilityTags.length > 0 && (
                            <div className="flex gap-1.5 flex-wrap items-center">
                              <span className="font-semibold text-muted-foreground">Tags:</span>
                              <div className="flex flex-wrap gap-1">
                                {closure.closureAccountabilityTags.map((t) => (
                                  <Badge
                                    key={t}
                                    variant="outline"
                                    className="text-[10px] py-0 px-1.5 font-normal"
                                  >
                                    {t === "other" && closure.closureAccountabilityOther
                                      ? closure.closureAccountabilityOther
                                      : t}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {closure.closureNarrative && (
                            <div>
                              <div className="font-semibold text-muted-foreground">Narrative:</div>
                              <p className="font-mono text-[11px] leading-snug text-muted-foreground whitespace-pre-wrap break-words">
                                {closure.closureNarrative}
                              </p>
                            </div>
                          )}
                          {driverNames && (
                            <div className="flex gap-1.5 flex-wrap">
                              <span className="font-semibold text-muted-foreground">Driver:</span>
                              <span className="text-foreground">{driverNames}</span>
                            </div>
                          )}
                          {dispatcherNames && (
                            <div className="flex gap-1.5 flex-wrap">
                              <span className="font-semibold text-muted-foreground">Dispatcher:</span>
                              <span className="text-foreground">{dispatcherNames}</span>
                            </div>
                          )}
                          {closure.closureCommunicatedTo && (
                            <div className="flex gap-1.5 flex-wrap">
                              <span className="font-semibold text-muted-foreground">Communicated to:</span>
                              <span className="text-foreground">{closure.closureCommunicatedTo}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {preflight && (
                        <div
                          className="mt-1.5 rounded border border-violet-200 bg-violet-50 px-2 py-1.5 text-xs space-y-1 dark:border-violet-900 dark:bg-violet-950/40"
                          data-testid={`activity-preflight-context-${item.id}`}
                        >
                          <div className="font-semibold text-violet-700 dark:text-violet-300">
                            AI prompt context
                          </div>
                          <p className="text-violet-900 dark:text-violet-200">
                            {preflight.text}.
                          </p>
                        </div>
                      )}
                      {review && (review.closureCommunicatedTo || review.closureReviewNotes) && (
                        <div
                          className="mt-1.5 rounded border border-muted bg-muted/30 px-2 py-1.5 text-xs space-y-1"
                          data-testid={`activity-closure-review-${item.id}`}
                        >
                          {review.closureCommunicatedTo && (
                            <div className="flex gap-1.5 flex-wrap">
                              <span className="font-semibold text-muted-foreground">Communicated to:</span>
                              <span className="text-foreground">{review.closureCommunicatedTo}</span>
                            </div>
                          )}
                          {review.closureReviewNotes && (
                            <div>
                              <div className="font-semibold text-muted-foreground">Review notes:</div>
                              <p className="font-mono text-[11px] leading-snug text-muted-foreground whitespace-pre-wrap break-words">
                                {review.closureReviewNotes}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                      <p className="text-[10px] text-muted-foreground/60">
                        <span>{item.log.userName || item.log.userEmail || "System"} · </span>
                        {item.timestamp ? new Date(item.timestamp).toLocaleString() : ""}
                      </p>
                    </div>
                  </div>
                );
              }
              const isEmail = item.note.type === "email";
              const Icon = isEmail ? Mail : StickyNote;
              return (
                <div
                  key={`note-${item.id}`}
                  className="flex gap-2 border-l-2 border-muted pl-3 py-1"
                  data-testid={`activity-note-${item.id}`}
                >
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${isEmail ? "text-blue-600" : "text-amber-600"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">
                      {isEmail ? "Email note" : "Note added"}
                      {item.note.emailSubject && (
                        <span className="text-muted-foreground font-normal"> · {item.note.emailSubject}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">{item.note.content}</p>
                    <p className="text-[10px] text-muted-foreground/60">
                      {item.note.author && <span>{item.note.author} · </span>}
                      {item.timestamp ? new Date(item.timestamp).toLocaleString() : ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

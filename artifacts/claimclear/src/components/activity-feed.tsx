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
};

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

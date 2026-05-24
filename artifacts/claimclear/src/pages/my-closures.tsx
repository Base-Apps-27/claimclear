// Task #889 — Responsible-Party self-serve portal page.
//
// The page is gated by `users.responsible_roles` (jsonb array). A
// signed-in user with at least one assigned role sees only the
// closures routed to that role, can mark them addressed with a
// ≥10-char note, and can reopen their own acknowledgement within 24h.
// Multi-role users see a small role switcher; everyone else lands on
// a quiet empty state explaining that the page is intentionally
// restricted.
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useListMyClosures,
  useAddressMyClosure,
  useReopenMyClosure,
  getListMyClosuresQueryKey,
} from "@workspace/api-client-react";
import type {
  WithdrawalRow,
  ListMyClosuresParams,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  closureReasonLabel,
  closureResponsibleRoleLabel,
  type ClosureResponsibleRole,
} from "@workspace/vocab";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Inbox, ShieldCheck, CheckCircle2, RotateCcw, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/cohesion";
import { TONE_STYLE, type Tone } from "@/components/cohesion/tone";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/format";
import { useUrlParams } from "@/lib/use-url-params";
import { useToast, successToast } from "@/hooks/use-toast";
import { AcknowledgeDialog, type AcknowledgeMode } from "@/components/acknowledge-dialog";
import { useActiveResponsibleRole } from "@/hooks/use-active-responsible-role";

// Task #889 spec — every closed-at line is paired with a human "X days
// ago" companion so the supervisor doesn't have to do date math. Kept
// local (not pulled from date-fns) to avoid bundling a 50kB lib just
// for one helper.
function relativeAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  return `${months} months ago`;
}

const REASON_TONE: Record<string, Tone> = {
  cannot_dispute: "amber",
  non_issue: "blue",
  denied_by_payor: "red",
};

interface DialogState {
  row: WithdrawalRow;
  mode: AcknowledgeMode;
}

export default function MyClosuresPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { get, set } = useUrlParams();
  const [, navigate] = useLocation();

  const roleParam = get("role");
  const { roles, activeRole, hasAccess } = useActiveResponsibleRole(roleParam);

  const listParams: ListMyClosuresParams = {
    role: activeRole ?? undefined,
  };

  const { data, isLoading, isError } = useListMyClosures(listParams, {
    query: {
      queryKey: getListMyClosuresQueryKey(listParams),
      enabled: hasAccess,
      refetchInterval: 30_000,
    },
  });

  const rows: WithdrawalRow[] = data?.rows ?? [];
  const counts = (data?.counts ?? { total: 0, awaiting: 0, addressed: 0, addressedLast30d: 0 }) as {
    total: number; awaiting: number; addressed: number; addressedLast30d?: number;
  };
  const addressedLast30d = counts.addressedLast30d ?? 0;

  // Task #889 — tab model from spec: Outstanding (default, oldest
  // first), Addressed (last 90 days), All time. Each tab is bounded by
  // the active role's responsibility (handled server-side already).
  type TabKey = "outstanding" | "addressed90" | "all";
  const tab = ((get("tab") as TabKey) || "outstanding");
  const SELF_REOPEN_WINDOW_MS = 24 * 60 * 60 * 1000;
  const cutoff90d = Date.now() - 90 * 24 * 60 * 60 * 1000;

  const tabRows: WithdrawalRow[] = useMemo(() => {
    if (tab === "outstanding") {
      return rows
        .filter(r => !r.addressed)
        .sort((a, b) => {
          const da = a.closedAt ? new Date(a.closedAt).getTime() : 0;
          const db = b.closedAt ? new Date(b.closedAt).getTime() : 0;
          return da - db; // oldest first
        });
    }
    if (tab === "addressed90") {
      return rows.filter(r => {
        if (!r.addressed || !r.closureAddressedAt) return false;
        const t = new Date(r.closureAddressedAt).getTime();
        return Number.isFinite(t) && t >= cutoff90d;
      });
    }
    return rows;
  }, [rows, tab, cutoff90d]);

  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const address = useAddressMyClosure();
  const reopen = useReopenMyClosure();
  const isPending = address.isPending || reopen.isPending;

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListMyClosuresQueryKey() });

  const handleSubmit = async (note: string) => {
    if (!dialog) return;
    setDialogError(null);
    try {
      if (dialog.mode === "address") {
        await address.mutateAsync({ kind: dialog.row.kind, id: dialog.row.id, data: { note } });
        successToast({ title: "__VERB__", description: "Marked addressed" });
      } else {
        await reopen.mutateAsync({ kind: dialog.row.kind, id: dialog.row.id, data: { note } });
        successToast({ title: "__VERB__", description: "Reopened for review" });
      }
      setDialog(null);
      refresh();
    } catch (err) {
      // The mutation error from orval carries an HTTP status; surface
      // the most useful messages (403/409) inline so the supervisor
      // knows whether to retry, refresh, or stop.
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setDialogError("This closure isn't routed to your role anymore. Refresh to see the latest list.");
      } else if (status === 409) {
        setDialogError("This closure changed since you opened the dialog. Refresh and try again.");
      } else {
        setDialogError("Something went wrong. Please try again.");
        toast({ title: "Save failed", description: "Please try again.", variant: "destructive" });
      }
    }
  };

  // Access gate — friendly, not a hard 403. The router still mounts
  // the page; if the user has no responsible role, we explain.
  if (!hasAccess) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <EmptyState
          icon={ShieldCheck}
          title="No closures assigned to you"
          description="The My Closures portal is only visible to supervisors assigned a responsible role. Ask an administrator if you think you should have access."
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <PageHeader
        title="My Closures"
        sub={
          activeRole
            ? `Closures routed to ${closureResponsibleRoleLabel(activeRole)}.`
            : "Closures routed to your responsible role."
        }
      />

      <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {roles.length > 1 && roles.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={r === activeRole ? "default" : "outline"}
              onClick={() => set({ role: r })}
              data-testid={`role-tab-${r}`}
            >
              {closureResponsibleRoleLabel(r)}
            </Button>
          ))}
        </div>
        {/* Task #889 spec status strip: Outstanding · Addressed (last
            30 days) · Total ever (this role). */}
        <div className="text-xs text-muted-foreground flex items-center gap-3" data-testid="my-closures-status-strip">
          <span data-testid="count-outstanding"><span className="font-semibold text-foreground">{counts.awaiting}</span> outstanding</span>
          <span>·</span>
          <span data-testid="count-addressed-30d"><span className="font-semibold text-foreground">{addressedLast30d}</span> addressed (last 30 days)</span>
          <span>·</span>
          <span data-testid="count-total-ever"><span className="font-semibold text-foreground">{counts.total}</span> total ever</span>
        </div>
      </div>

      {/* Tab model — Outstanding / Addressed (90d) / All time. */}
      <div className="mt-3 inline-flex items-center gap-1 border rounded-md p-0.5 bg-muted/40" role="tablist" data-testid="my-closures-tabs">
        {([
          { key: "outstanding", label: `Outstanding (${counts.awaiting})` },
          { key: "addressed90", label: `Addressed 90d (${addressedLast30d})` },
          { key: "all",         label: `All time (${counts.total})` },
        ] as { key: TabKey; label: string }[]).map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => set({ tab: t.key === "outstanding" ? null : t.key })}
            data-testid={`tab-${t.key}`}
            className={
              "px-3 py-1 text-xs font-medium rounded transition-colors " +
              (tab === t.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {isLoading && Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}

        {isError && !isLoading && (
          <Card><CardContent className="py-6 text-sm text-red-600">Failed to load your closures.</CardContent></Card>
        )}

        {!isLoading && !isError && tabRows.length === 0 && (
          <EmptyState
            icon={Inbox}
            title="Nothing waiting on you"
            description="Items land here when the dispute team records a closure tagged to your role."
          />
        )}

        {!isLoading && !isError && tabRows.map((row) => {
          const tone = REASON_TONE[row.closureReason] ?? "muted";
          const accent = TONE_STYLE[tone];
          const detailHref = row.kind === "claim" ? `/claims/${row.id}` : `/invoice-groups/${row.id}`;
          const acknowledged = row.closureReviewState === "acknowledged_by_party";
          const closed = row.closureReviewState === "closed";
          const addressed = row.addressed;
          const closedRel = relativeAgo(row.closedAt);
          const ackRel = relativeAgo(row.closureAddressedAt);

          // Task #889 spec: in the Outstanding/All tabs, rows that
          // have already been acknowledged by THIS party collapse to a
          // thin one-line summary so the supervisor's eye is drawn to
          // the rows that still need work. The Addressed-90d tab
          // shows them in this collapsed form too.
          if (acknowledged && tab !== "outstanding") {
            const ackAt = row.closureAddressedAt ? new Date(row.closureAddressedAt).getTime() : 0;
            const withinWindow = ackAt > 0 && (Date.now() - ackAt) < SELF_REOPEN_WINDOW_MS;
            return (
              <Card key={`${row.kind}:${row.id}`} data-testid={`my-closure-row-${row.kind}-${row.id}`} className="border-blue-200 bg-blue-50/40">
                <CardContent className="py-2.5 px-4 flex items-center gap-3 flex-wrap">
                  <CheckCircle2 className="h-4 w-4 text-blue-700 shrink-0" />
                  <span className="text-xs uppercase tracking-wide text-blue-800 font-semibold shrink-0">Addressed</span>
                  <span className="text-sm font-medium truncate" title={row.identifier}>{row.identifier}</span>
                  {row.clientNumber && (
                    <span className="text-xs text-muted-foreground shrink-0">Member #{row.clientNumber}</span>
                  )}
                  <span className="text-xs text-muted-foreground shrink-0">
                    {ackRel ?? formatDate(row.closureAddressedAt ?? row.closedAt ?? "")}
                  </span>
                  <span className="ml-auto flex items-center gap-2 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => navigate(detailHref)} data-testid={`open-${row.kind}-${row.id}`}>
                      Open <ExternalLink className="h-3.5 w-3.5 ml-1" />
                    </Button>
                    {withinWindow && (
                      <Button size="sm" variant="outline" onClick={() => { setDialogError(null); setDialog({ row, mode: "reopen" }); }} data-testid={`reopen-${row.kind}-${row.id}`}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reopen
                      </Button>
                    )}
                  </span>
                </CardContent>
              </Card>
            );
          }

          return (
            <Card key={`${row.kind}:${row.id}`} data-testid={`my-closure-row-${row.kind}-${row.id}`}>
              <CardContent className="py-4 px-4 flex gap-4 flex-wrap items-start">
                <div className="w-1 self-stretch rounded" style={{ background: accent.fg }} aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge style={{ background: accent.bg, color: accent.fg, borderColor: accent.fg }} className="border text-[10px] uppercase font-bold tracking-wide">
                      {closureReasonLabel(row.closureReason)}
                    </Badge>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                      {row.kind === "claim" ? "Claim" : "Invoice Group"}
                    </span>
                    {acknowledged && (
                      <Badge className="bg-blue-100 text-blue-800 border border-blue-300 text-[10px] uppercase">
                        Acknowledged by party
                      </Badge>
                    )}
                    {closed && (
                      <Badge className="bg-green-100 text-green-800 border border-green-300 text-[10px] uppercase">
                        Closed
                      </Badge>
                    )}
                  </div>
                  <div className="font-semibold tracking-tight truncate" title={row.identifier}>{row.identifier}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                    {row.clientNumber && (
                      <span data-testid={`member-${row.kind}-${row.id}`}>Member #{row.clientNumber}</span>
                    )}
                    {row.amount && <><span>·</span><span className="tabular-nums">{formatCurrency(row.amount)}</span></>}
                    {row.closedAt && (
                      <>
                        <span>·</span>
                        <span>
                          Closed {formatDate(row.closedAt)}
                          {closedRel && <span className="text-muted-foreground/70"> ({closedRel})</span>}
                        </span>
                      </>
                    )}
                    {row.errorTypeName && <><span>·</span><span>{row.errorTypeName}</span></>}
                  </div>
                  {/* Task #889 spec: narrative shown in full, not
                      truncated — this is the whole reason the
                      responsible party is on the page. */}
                  {row.errorDetails && (
                    <p className="text-sm mt-2 whitespace-pre-wrap" data-testid={`narrative-${row.kind}-${row.id}`}>
                      {row.errorDetails}
                    </p>
                  )}
                  {/* Task #889 spec: "Specifics" line surfaces the
                      operator note (closureCommunicatedTo / closureNarrative
                      flowed through to closureReviewNotes operator-side)
                      so the supervisor sees exactly what was communicated
                      out without opening the detail page. */}
                  {row.closureCommunicatedTo && !acknowledged && (
                    <p className="text-xs mt-2 text-muted-foreground" data-testid={`specifics-${row.kind}-${row.id}`}>
                      <span className="font-semibold uppercase tracking-wide">Specifics:</span>{" "}
                      <span className="whitespace-pre-wrap">{row.closureCommunicatedTo}</span>
                    </p>
                  )}
                  {row.closureReviewNotes && acknowledged && (
                    <p className="text-xs mt-2 text-muted-foreground italic whitespace-pre-wrap">
                      Your note: {row.closureReviewNotes}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={() => navigate(detailHref)} data-testid={`open-${row.kind}-${row.id}`}>
                    Open <ExternalLink className="h-3.5 w-3.5 ml-1" />
                  </Button>
                  {!addressed && !acknowledged && (
                    <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => { setDialogError(null); setDialog({ row, mode: "address" }); }} data-testid={`address-${row.kind}-${row.id}`}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark addressed
                    </Button>
                  )}
                  {/* Task #889 spec: Reopen affordance disappears 24h
                      after the user's own acknowledgement. Past the
                      window only an operator can reopen via the
                      Withdrawals admin page. */}
                  {acknowledged && (() => {
                    const ackAt = row.closureAddressedAt ? new Date(row.closureAddressedAt).getTime() : 0;
                    const withinWindow = ackAt > 0 && (Date.now() - ackAt) < SELF_REOPEN_WINDOW_MS;
                    if (!withinWindow) return null;
                    return (
                      <Button size="sm" variant="outline" onClick={() => { setDialogError(null); setDialog({ row, mode: "reopen" }); }} data-testid={`reopen-${row.kind}-${row.id}`}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reopen
                      </Button>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AcknowledgeDialog
        open={!!dialog}
        mode={dialog?.mode ?? "address"}
        identifier={dialog?.row.identifier ?? ""}
        isPending={isPending}
        errorMessage={dialogError}
        onCancel={() => { setDialog(null); setDialogError(null); }}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

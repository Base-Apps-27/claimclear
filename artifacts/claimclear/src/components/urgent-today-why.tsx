// "Why?" line + activity panel for the File-today hero.
//
// Surfaces, next to the urgent-count number on both the Dashboard
// hero and the Queue urgency hero:
//   • a one-line explanation of what's going on right now
//     ("3 left to file · 4 cleared today by Avery, Tom"),
//   • an inline SVG sparkline of the day's snapshots so an operator
//     can see at a glance whether the queue is getting better or worse,
//   • a Sheet that opens to a full activity panel listing the
//     currently-urgent groups and the today-cleared transitions.
//
// Both heroes mount the same component pointed at the same endpoint
// (Task #298). When there is nothing to say (no snapshots and no
// activity), the component renders nothing.

import { useState } from "react";
import { Link } from "wouter";
import {
  useGetDashboardUrgentTodayTransitions,
  getGetDashboardUrgentTodayTransitionsQueryKey,
  type UrgentTodayTransitions,
} from "@workspace/api-client-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
import { ChevronRight, Activity } from "lucide-react";
import { deriveUrgentTodayWhy } from "@/lib/urgent-today-why";
import { RefNumber } from "@/components/ref-number";

type Tone = "red" | "amber" | "green";

interface Props {
  tone: Tone;
  /** Optional: override the live urgentCount with the hero's number so it never
   *  visibly disagrees during a refetch. */
  urgentCountOverride?: number;
  /** Optional test id to scope the rendered Why-line. */
  testid?: string;
  /**
   * Task #410 — when the panel is mounted on the Queue, the host can pass
   * its `selectWorkflow` callback so clicking a currently-urgent row
   * selects that group inside the Queue's inline workspace instead of
   * navigating away to the standalone invoice-group detail page. When
   * omitted (e.g. the Dashboard hero), rows fall back to a `/queue?group=<id>`
   * link so the operator still lands on the Queue with the group preselected
   * rather than on the detail page.
   */
  onSelectUrgentGroup?: (id: number) => void;
}

const toneFg: Record<Tone, string> = {
  red: "hsl(var(--cc-red-fg))",
  amber: "hsl(var(--cc-amber-fg))",
  green: "hsl(var(--cc-green-fg))",
};

const sparkColor: Record<Tone, string> = {
  red: "hsl(var(--destructive))",
  amber: "hsl(var(--cc-amber-fg))",
  green: "hsl(var(--cc-green-fg))",
};

function formatActorList(actors: string[]): string {
  if (actors.length === 0) return "system";
  if (actors.length === 1) return actors[0];
  if (actors.length === 2) return `${actors[0]} and ${actors[1]}`;
  return `${actors[0]}, ${actors[1]}, +${actors.length - 2}`;
}

function Sparkline({ points, tone }: { points: { urgentCount: number }[]; tone: Tone }) {
  if (points.length < 2) return null;
  // Normalise to a 60×16 viewBox — width matches the few-words inline area.
  const W = 60;
  const H = 16;
  const max = Math.max(1, ...points.map(p => p.urgentCount));
  const min = Math.min(0, ...points.map(p => p.urgentCount));
  const span = Math.max(1, max - min);
  const step = points.length > 1 ? W / (points.length - 1) : 0;
  const path = points
    .map((p, i) => {
      const x = i * step;
      // Higher urgent count = lower y so the line goes UP when the
      // queue gets worse — matches the "alarm rising" intuition.
      const y = H - ((p.urgentCount - min) / span) * H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={`Urgent-today snapshots, ${points.length} points`}
      className="inline-block align-middle ml-1 opacity-80"
      data-testid="urgent-today-sparkline"
    >
      <path d={path} fill="none" stroke={sparkColor[tone]} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function UrgentTodayWhyLine({ tone, urgentCountOverride, testid, onSelectUrgentGroup }: Props) {
  // Task #410 — Sheet open state is controlled here so the inner panel
  // can close it after a row click without depending on Radix's
  // SheetClose context (which is incompatible with the panel being
  // unit-tested in isolation).
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useGetDashboardUrgentTodayTransitions({
    query: {
      queryKey: getGetDashboardUrgentTodayTransitionsQueryKey(),
      // Cheap auto-refresh so the sparkline trends in near-real-time.
      refetchInterval: 60_000,
      staleTime: 30_000,
    },
  });

  if (isLoading || !data) return null;

  const urgentCount = urgentCountOverride ?? data.urgentCount;
  const cleared = data.clearedSummary.total;
  const actors = data.clearedSummary.actors ?? [];
  const snapshots = data.snapshots ?? [];

  // Server-authoritative "nothing was ever urgent today" guard. The
  // snapshot job may run on calm days too; we don't want to render
  // "quiet day — nothing on the file-today clock" when the truth is
  // simply that nothing was due today and nothing was cleared. Falls
  // back to client-side detection for older API builds without the
  // `wasUrgentToday` field.
  const wasUrgentToday =
    typeof data.wasUrgentToday === "boolean"
      ? data.wasUrgentToday
      : urgentCount > 0 ||
        cleared > 0 ||
        snapshots.some(s => s.urgentCount > 0);

  // Pure copy decision — both Dashboard and Queue heroes mount this
  // same component, so this single call site guarantees parity.
  const decision = deriveUrgentTodayWhy({
    urgentCount,
    cleared,
    actorList: formatActorList(actors),
    wasUrgentToday,
    maxUrgentToday: data.maxUrgentToday ?? Math.max(0, ...snapshots.map(s => s.urgentCount)),
  });

  if (decision.kind === "hidden") return null;
  const summary = decision.summary;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          data-testid={testid ?? "urgent-today-why"}
          className="text-xs underline-offset-2 hover:underline inline-flex items-center gap-1 opacity-90 hover:opacity-100"
          style={{ color: toneFg[tone] }}
          aria-label="Why this number? See today's filing-clock activity"
        >
          <span>Why?</span>
          <span className="opacity-80">{summary}</span>
          <Sparkline points={snapshots} tone={tone} />
          <ChevronRight className="h-3 w-3 opacity-70" />
        </button>
      </SheetTrigger>
      <UrgentTodayActivityPanel
        onSelectUrgentGroup={onSelectUrgentGroup}
        onClose={() => setOpen(false)}
      />
    </Sheet>
  );
}

/**
 * Sheet body. Exported separately so a future caller can mount it from
 * a different trigger (e.g. a keyboard shortcut). Today only the
 * `UrgentTodayWhyLine` mounts it.
 *
 * `onSelectUrgentGroup` (Task #410): when provided, currently-urgent rows
 * become an in-page selection action — used by the Queue to jump into its
 * inline workspace. When omitted (Dashboard hero), the rows fall back to
 * a `/queue?group=<id>` link so the operator still lands on the Queue
 * with the chosen group preselected, never on the standalone
 * invoice-group detail page.
 *
 * `onClose` (Task #410): the parent passes a setter that closes the
 * surrounding Sheet so a row click both jumps and dismisses the panel.
 * Defaults to a noop so the panel can be unit-tested standalone.
 */
export function UrgentTodayActivityPanel({
  onSelectUrgentGroup,
  onClose,
}: {
  onSelectUrgentGroup?: (id: number) => void;
  onClose?: () => void;
} = {}) {
  return (
    <SheetContent className="sm:max-w-md flex flex-col gap-4 overflow-y-auto" data-testid="urgent-today-panel">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4" /> File-today activity
        </SheetTitle>
      </SheetHeader>
      <UrgentTodayActivityPanelBody
        onSelectUrgentGroup={onSelectUrgentGroup}
        onClose={onClose}
      />
    </SheetContent>
  );
}

/**
 * Pure panel body — does the data fetch and renders the lists, but
 * does NOT mount Radix Dialog primitives (SheetContent / SheetHeader).
 * Exported for unit tests so the rendering of the currently-urgent
 * vs. cleared-today rows can be asserted without paying for the full
 * Dialog/Portal/focus-scope dance in jsdom. Production callers should
 * use `UrgentTodayActivityPanel` (which wraps this body in SheetContent
 * + SheetHeader).
 */
export function UrgentTodayActivityPanelBody({
  onSelectUrgentGroup,
  onClose,
}: {
  onSelectUrgentGroup?: (id: number) => void;
  onClose?: () => void;
} = {}) {
  const { data } = useGetDashboardUrgentTodayTransitions({
    query: {
      queryKey: getGetDashboardUrgentTodayTransitionsQueryKey(),
      refetchInterval: 60_000,
      staleTime: 30_000,
    },
  });

  return (
    <SkeletonSwap
      loading={!data}
      skeleton={
        <div className="space-y-3 p-1" data-testid="urgent-today-panel-skeleton">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-16 w-full" />
        </div>
      }
    >
      {data ? (
    <>
      <div className="text-xs text-muted-foreground -mt-2" data-testid="urgent-today-panel-date">
        {data.today}
      </div>
      <section data-testid="urgent-today-panel-currently">
        <div className="text-xs uppercase tracking-wide font-bold mb-2 text-muted-foreground">
          Currently urgent ({data.urgentCount} of {data.totalActionable})
        </div>
        {data.currentlyUrgent.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nothing on the file-today clock.</div>
        ) : (
          <ul className="space-y-1">
            {data.currentlyUrgent.slice(0, 20).map((g: UrgentTodayTransitions["currentlyUrgent"][number]) => (
              <li key={g.id} className="text-sm flex items-center justify-between gap-2 border-b border-border/50 py-1">
                <div className="flex items-center gap-1 min-w-0">
                  {onSelectUrgentGroup ? (
                    // Queue-mounted: in-page jump via host `selectWorkflow`.
                    // Container is role=button (not a real <button>) so
                    // RefNumber's nested copy button is valid HTML.
                    <span
                      role="button"
                      tabIndex={0}
                      className="hover:underline truncate cursor-pointer"
                      data-testid={`urgent-today-current-${g.id}`}
                      onClick={() => {
                        onSelectUrgentGroup(g.id);
                        onClose?.();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectUrgentGroup(g.id);
                          onClose?.();
                        }
                      }}
                      style={{ color: "inherit" }}
                    >
                      <RefNumber value={g.invoiceNumber} variant="inline" />
                    </span>
                  ) : (
                    // Dashboard-mounted: navigate to /queue with the
                    // group preselected via `?group=<id>`.
                    <Link
                      href={`/queue?group=${g.id}`}
                      className="hover:underline truncate"
                      data-testid={`urgent-today-current-${g.id}`}
                      onClick={() => onClose?.()}
                    >
                      <RefNumber value={g.invoiceNumber} variant="inline" />
                    </Link>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {g.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="urgent-today-panel-cleared">
        <div className="text-xs uppercase tracking-wide font-bold mb-2 text-muted-foreground">
          Cleared today ({data.clearedSummary.total})
        </div>
        {data.clearedToday.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nothing cleared yet today.</div>
        ) : (
          <ul className="space-y-1">
            {data.clearedToday.slice(0, 20).map((r: UrgentTodayTransitions["clearedToday"][number]) => (
              <li
                key={r.id}
                className="text-sm border-b border-border/50 py-1.5 space-y-0.5"
                data-testid={`urgent-today-cleared-row-${r.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 flex items-center gap-2">
                    {r.invoiceGroupId != null && r.invoiceNumber ? (
                      <Link
                        href={`/invoice-groups/${r.invoiceGroupId}`}
                        className="hover:underline"
                        data-testid={`urgent-today-cleared-${r.id}`}
                      >
                        <RefNumber value={r.invoiceNumber} variant="inline" />
                      </Link>
                    ) : (
                      <span className="font-mono text-muted-foreground">—</span>
                    )}
                    {r.clientNumber && (
                      <span
                        className="text-xs text-muted-foreground"
                        data-testid={`urgent-today-cleared-payor-${r.id}`}
                      >
                        · {r.clientNumber}
                      </span>
                    )}
                  </div>
                  <span
                    className="text-xs text-muted-foreground shrink-0 tabular-nums"
                    data-testid={`urgent-today-cleared-time-${r.id}`}
                  >
                    {r.timestampET}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {r.fromStatus} → {r.toStatus}
                    {r.source && (
                      <span
                        className="ml-2 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                        data-testid={`urgent-today-cleared-source-${r.id}`}
                      >
                        {r.source}
                      </span>
                    )}
                  </span>
                  <span className="truncate max-w-[8rem]">{r.actor ?? "system"}</span>
                </div>
                {r.reason && (
                  <div
                    className="text-xs text-muted-foreground italic truncate"
                    data-testid={`urgent-today-cleared-reason-${r.id}`}
                  >
                    “{r.reason}”
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.snapshots.length > 0 && (
        <section data-testid="urgent-today-panel-snapshots">
          <div className="text-xs uppercase tracking-wide font-bold mb-2 text-muted-foreground">
            Today's snapshots ({data.snapshots.length})
          </div>
          <div className="text-xs text-muted-foreground">
            Latest: {data.snapshots[data.snapshots.length - 1]?.urgentCount ?? 0} urgent /
            {" "}{data.snapshots[data.snapshots.length - 1]?.totalActionable ?? 0} actionable
          </div>
        </section>
      )}
    </>
      ) : null}
    </SkeletonSwap>
  );
}

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
void React;
import { useRowSettle } from "@/hooks/use-row-settle";
import { useServerDayRolloverInvalidator, latestTodayKey } from "@/lib/server-day-rollover";
import { useInvoiceGroupsListEvents, useInvoiceGroupEvents } from "@/hooks/use-claim-events";
import {
  useListInvoiceGroups,
  useListErrorTypes,
  getListInvoiceGroupsQueryKey,
} from "@workspace/api-client-react";
import type {
  InvoiceGroupResponse,
  NeedsClassificationInboxGroup,
  ListInvoiceGroupsOutlook,
  ListInvoiceGroupsParams,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StateBadge } from "@/components/state-badge";
import { RefNumber } from "@/components/ref-number";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate } from "@/lib/format";
import { HideForClerk } from "@/lib/role";
import {
  AlertCircle,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Filter,
  Inbox,
  Loader2,
  PauseCircle,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  parseExpiringParam,
  filterByExpiringParam,
  formatDeadlineLabel,
  computeAggregateUrgentCount,
  emptyStateCopy,
  type ExpiringFilter,
  type DeadlineTier,
} from "@/lib/queue-urgency";
import { countUrgentRows } from "@/lib/urgent-count";
import { ClassifyDialog } from "@/components/classify-dialog";
import { usePresence } from "@/hooks/use-presence";
import { HumanPresenceBanner } from "@/components/presence-banners";
import { useUrlParams } from "@/lib/use-url-params";
import {
  readEngagementMode,
  type EngagementMode,
} from "@/components/engagement-filter-controls";
import { InlineGroupWorkspaceMini } from "@/components/inline-group-workspace-mini";
import { legSubStatusDisplayLabel, closureReasonLabel } from "@workspace/vocab";
import {
  parseOutlook,
  parseDraftReviewed,
  parseExcludeReason,
  laneForRow,
  buildChips,
  appliedFacetCount,
  dedupRowsById,
  legacyUrlRewrites,
  VALID_OUTLOOK,
  OUTLOOK_LABEL,
  type ParityFilters,
  type OutlookFilter,
  type DraftReviewedFilter,
  type ErrorTypeOption,
} from "@/lib/queue-filters";

// ───────────────────────────────────────────────────────────────────────
// Task #649 — Queue page redesign: Lane Stack + always-on filters.
//
// Three lanes replace the three tabs (`On the clock` / `This week &
// later` / `On hold`). Every URL filter has exactly one on-screen
// control; the active-filter chip row never renders chips that can't
// be cleared from the page itself. The row card drops currency and
// leads with the four-cell leg-state breakdown so the operator sees
// what determines the next action.
// ───────────────────────────────────────────────────────────────────────

type LaneId = "clock" | "week" | "hold";
const LANE_TESTID: Record<LaneId, string> = {
  clock: "queue-lane-on-the-clock",
  week: "queue-lane-this-week",
  hold: "queue-lane-on-hold",
};
const LANE_LABEL: Record<LaneId, string> = {
  clock: "On the clock",
  week: "This week & later",
  hold: "On hold",
};
// Portal-Queued groups were removed from the lane stack (operator
// asked to hide already-submitted groups from the Queue entirely —
// they live in the Response Tracker / Portal Submissions surfaces
// now). Both the clock and week lanes are pure "actionable" buckets,
// so they share the empty-state copy. The lane key union no longer
// carries `portal-queued` — `emptyStateCopy` was narrowed to match.
const LANE_EMPTY_KEY: Record<LaneId, "actionable" | "on-hold"> = {
  clock: "actionable",
  week: "actionable",
  hold: "on-hold",
};

// Pure parsers, serializers, lane partition, chip builder, and facet
// counter live in `@/lib/queue-filters` so the parity test suite can
// import them without dragging in queue.tsx's React+presence+auth tree.

// ── Tier pill copy ────────────────────────────────────────────────────
const TIER_LABEL: Record<DeadlineTier, string> = {
  today: "TODAY",
  tomorrow: "TMRW",
  soon: "≤3D",
  week: "≤7D",
  later: "LATER",
  overdue: "OVRDUE",
};

function tierClasses(tier: DeadlineTier): { bg: string; fg: string; border: string } {
  switch (tier) {
    case "today":
    case "overdue":
      return { bg: "hsl(var(--destructive))", fg: "white", border: "hsl(var(--destructive))" };
    case "tomorrow":
      return {
        bg: "hsl(var(--cc-amber-bg))",
        fg: "hsl(var(--cc-amber-fg))",
        border: "hsl(var(--cc-amber-border))",
      };
    case "soon":
      return {
        bg: "hsl(48 96% 92%)",
        fg: "hsl(var(--cc-amber-fg))",
        border: "hsl(var(--cc-amber-border))",
      };
    case "week":
    case "later":
      return {
        bg: "hsl(var(--muted))",
        fg: "hsl(var(--muted-foreground))",
        border: "hsl(var(--border))",
      };
  }
}

// ── 4-cell breakdown (Ready / Investigating / Non-contestable / Non-issue) ──
type BreakdownBucket = {
  id: "ready" | "investigating" | "non-contestable" | "non-issue";
  label: string;
  countKey: string;
  dotColor: string;
};
const BREAKDOWN_BUCKETS: readonly BreakdownBucket[] = [
  { id: "ready", label: "Ready", countKey: "ready", dotColor: "hsl(var(--cc-green-fg))" },
  {
    id: "investigating",
    label: "Investigating",
    countKey: "investigating",
    dotColor: "hsl(var(--cc-amber-fg))",
  },
  {
    id: "non-contestable",
    // Task #649 — `dropped` legs render as "Non-contestable" everywhere.
    // Pulled from `@workspace/vocab.legSubStatusDisplayLabel("dropped")`
    // so the row, the chip, and the title all say the same thing.
    label: legSubStatusDisplayLabel("dropped"),
    countKey: "dropped",
    dotColor: "hsl(var(--cc-purple-fg))",
  },
  {
    id: "non-issue",
    // Pulled from `@workspace/vocab.closureReasonLabel("non_issue")`
    // so the bucket label tracks the shared vocab single source of
    // truth alongside the `dropped → Non-contestable` cell above.
    label: closureReasonLabel("non_issue"),
    countKey: "excluded",
    dotColor: "hsl(var(--muted-foreground))",
  },
];

// ── QueueRow ──────────────────────────────────────────────────────────
function QueueRow({
  group,
  isSelected,
  onSelect,
  compact,
  isSettling,
}: {
  group: InvoiceGroupResponse;
  isSelected: boolean;
  onSelect: (id: number) => void;
  compact: boolean;
  isSettling: boolean;
}) {
  const counts = (group.legSubStatusCounts ?? {}) as Record<string, number>;
  const needsClassification = counts.needs_classification ?? 0;
  const investigating = counts.investigating ?? 0;
  const blocked = counts.blocked ?? 0;
  const ready = counts.ready ?? 0;
  const previewGenerated = !!group.previewGeneratedAt;
  const allDisputableSettled =
    investigating === 0 && blocked === 0 && needsClassification === 0;
  const readyToGenerate = allDisputableSettled && ready > 0 && !previewGenerated;

  const onHold = group.status === "On Hold";
  const labelInfo = formatDeadlineLabel(group);
  const tier: DeadlineTier = labelInfo?.tier ?? "later";
  const t = tierClasses(tier);

  const dateText = labelInfo
    ? labelInfo.label.split("·").slice(1).join("·").trim() || labelInfo.label
    : "";

  // Settled (red/amber) accent border on the left edge for clock-lane
  // rows. Hold rows always get the muted dashed treatment regardless
  // of tier.
  const accentColor = onHold
    ? "hsl(var(--border))"
    : tier === "today" || tier === "overdue"
      ? "hsl(var(--destructive))"
      : tier === "tomorrow"
        ? "hsl(var(--cc-amber-fg))"
        : "transparent";

  return (
    <button
      type="button"
      onClick={() => onSelect(group.id)}
      data-testid={`queue-row-${group.id}`}
      data-mode={compact ? "compact" : "wide"}
      data-tier={tier}
      data-on-hold={onHold ? "true" : "false"}
      data-needs-classification={needsClassification > 0 ? "true" : "false"}
      data-ready-to-generate={readyToGenerate ? "true" : "false"}
      className={`w-full text-left rounded-md border bg-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        isSelected ? "ring-2 ring-primary border-primary" : "hover:bg-accent/40"
      } ${onHold ? "opacity-90" : ""} ${isSettling ? "cc-row-settling" : ""}`}
      style={{
        borderLeft: `4px solid ${accentColor}`,
        borderStyle: onHold ? "dashed" : undefined,
        background: onHold ? "hsl(var(--muted) / 0.4)" : undefined,
      }}
    >
      <div className={`flex flex-col ${compact ? "gap-1 px-2 py-2" : "gap-2 px-3 py-2.5"}`}>
        {/* Top line: tier pill + invoice + rides + ready/needs badges + error */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span
            data-testid={`queue-row-tier-pill-${group.id}`}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ background: t.bg, color: t.fg, border: `1px solid ${t.border}` }}
            title={labelInfo?.tooltip}
          >
            <span>{TIER_LABEL[tier]}</span>
            {dateText && <span className="opacity-90 font-semibold">· {dateText}</span>}
          </span>
          <RefNumber
            value={group.invoiceNumber}
            variant="inline"
            className="font-semibold text-sm"
          />
          {!compact && (
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {group.rideCount} ride{group.rideCount !== 1 ? "s" : ""}
            </span>
          )}
          {!compact && onHold && (
            <span className="text-[11px] italic text-muted-foreground" aria-hidden>
              · on hold
            </span>
          )}
          {/* Portal-Queued badge removed alongside the lane-stack
              filtering: submitted groups no longer appear in the
              Queue at all (they live in the Response Tracker). */}
          <span className="flex-1 min-w-0" />
          {needsClassification > 0 && (
            <Badge
              variant="outline"
              data-testid={`queue-row-needs-classification-${group.id}`}
              className="text-[10px] font-bold inline-flex items-center gap-1"
              style={{
                background: "hsl(var(--cc-red-bg))",
                color: "hsl(var(--cc-red-fg))",
                borderColor: "hsl(var(--cc-red-border))",
              }}
            >
              <AlertCircle className="h-3 w-3" />
              Needs classification {needsClassification}
            </Badge>
          )}
          {readyToGenerate && (
            <Badge
              variant="outline"
              data-testid={`queue-row-ready-to-generate-${group.id}`}
              className="text-[10px] font-semibold inline-flex items-center gap-1"
              style={{
                background: "hsl(var(--cc-green-bg))",
                color: "hsl(var(--cc-green-fg))",
                borderColor: "hsl(var(--cc-green-border))",
              }}
            >
              <Sparkles className="h-3 w-3" />
              Ready to generate
            </Badge>
          )}
          {onHold && group.holdReason && (
            <span
              data-testid={`queue-row-on-hold-pill-${group.id}`}
              className="text-[10px] italic text-muted-foreground rounded-full border border-border px-2 py-0.5 truncate max-w-[160px]"
              title={group.holdReason}
            >
              {group.holdReason}
            </span>
          )}
        </div>

        {/* Bottom line: 4-cell breakdown + error chip */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span
            data-testid={`queue-row-breakdown-${group.id}`}
            className="inline-flex items-center gap-2 flex-wrap text-[12px] font-semibold"
          >
            {BREAKDOWN_BUCKETS.map((b) => {
              const n = counts[b.countKey] ?? 0;
              return (
                <span
                  key={b.id}
                  data-testid={`queue-row-breakdown-cell-${b.id}-${group.id}`}
                  className={`inline-flex items-center gap-1 ${
                    n === 0 ? "opacity-35 font-medium" : ""
                  }`}
                  title={`${b.label}: ${n}`}
                >
                  <span
                    aria-hidden
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: b.dotColor }}
                  />
                  <span className="tabular-nums">{n}</span>
                  {!compact && (
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {b.label}
                    </span>
                  )}
                </span>
              );
            })}
          </span>
          <span className="flex-1 min-w-0" />
          {group.errorTypeName && (
            <span
              data-testid={`queue-row-error-chip-${group.id}`}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold truncate max-w-[220px]"
              style={{
                background: "hsl(var(--cc-purple-bg))",
                color: "hsl(var(--cc-purple-fg))",
                border: "1px solid hsl(var(--cc-purple-border))",
              }}
              title={group.errorTypeName}
            >
              {group.errorTypeName}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Filter strip pieces ───────────────────────────────────────────────
function Segmented({
  testid,
  mode,
  options,
  onChange,
}: {
  testid: string;
  mode: string;
  options: { value: string; label: string; testid: string }[];
  onChange: (next: string) => void;
}) {
  return (
    <div
      role="group"
      data-testid={testid}
      data-mode={mode}
      className="inline-flex rounded-md border border-border overflow-hidden shadow-sm"
    >
      {options.map((opt, i) => {
        const active = mode === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            data-testid={opt.testid}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={
              "px-2.5 py-1 text-xs font-semibold transition-colors " +
              (i > 0 ? "border-l border-border " : "") +
              (active
                ? "bg-primary text-primary-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]"
                : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function FiltersPopover({
  filters,
  errorTypeOptions,
  onChange,
}: {
  filters: ParityFilters;
  errorTypeOptions: ErrorTypeOption[];
  onChange: (patch: Partial<ParityFilters>) => void;
}) {
  const expiringHas = (key: "today" | "tomorrow") => {
    const f = filters.expiring;
    if (key === "today") return f === "urgent" || f === "today-tomorrow";
    return f === "tomorrow" || f === "today-tomorrow";
  };
  const toggleExpiring = (key: "today" | "tomorrow" | "soon") => {
    const cur = filters.expiring;
    if (key === "soon") {
      onChange({ expiring: cur === "soon" ? null : "soon" });
      return;
    }
    const haveToday = expiringHas("today");
    const haveTomorrow = expiringHas("tomorrow");
    const nextToday = key === "today" ? !haveToday : haveToday;
    const nextTomorrow = key === "tomorrow" ? !haveTomorrow : haveTomorrow;
    let next: ExpiringFilter = null;
    if (nextToday && nextTomorrow) next = "today-tomorrow";
    else if (nextToday) next = "urgent";
    else if (nextTomorrow) next = "tomorrow";
    onChange({ expiring: next });
  };
  const toggleErrorType = (id: string) => {
    const set = new Set(filters.errorTypeIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange({ errorTypeIds: Array.from(set) });
  };
  return (
    <div className="space-y-4 text-sm" data-testid="queue-filters-popover-content">
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Expiring
        </div>
        {/*
          "Stuck after submission" was removed from the Queue's filter
          surface: submitted groups are no longer fetched into the lane
          stack, so the chip could never match a row. The `stuck` mode
          itself is still a real backend filter and is surfaced by the
          Dashboard's "Stuck after submission" hero card (which links
          to /portal-submissions where the rows actually live).
        */}
        {[
          { id: "today" as const, label: "Today", testid: "queue-filter-expiring-today" },
          { id: "tomorrow" as const, label: "Tomorrow", testid: "queue-filter-expiring-tomorrow" },
          { id: "soon" as const, label: "Due in 2–3 days", testid: "queue-filter-expiring-soon" },
        ].map((row) => {
          const active =
            row.id === "today"
              ? expiringHas("today")
              : row.id === "tomorrow"
                ? expiringHas("tomorrow")
                : filters.expiring === "soon";
          return (
            <label
              key={row.id}
              className="flex items-center gap-2 cursor-pointer"
              data-testid={`${row.testid}-row`}
            >
              <input
                type="checkbox"
                checked={active}
                onChange={() => toggleExpiring(row.id)}
                data-testid={row.testid}
              />
              <span>{row.label}</span>
            </label>
          );
        })}
      </div>
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Outlook
        </div>
        {VALID_OUTLOOK.map((o) => {
          const active = filters.outlook === o;
          return (
            <label key={o} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={active}
                onChange={() => onChange({ outlook: active ? null : o })}
                data-testid={`queue-filter-outlook-${o}`}
              />
              <span>{OUTLOOK_LABEL[o]}</span>
            </label>
          );
        })}
      </div>
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Draft reviewed
        </div>
        <Segmented
          testid="queue-filter-draft-reviewed-segmented"
          mode={filters.draftReviewed ?? "any"}
          options={[
            { value: "any", label: "Any", testid: "queue-filter-draft-any" },
            { value: "reviewed", label: "Reviewed", testid: "queue-filter-draft-reviewed" },
            { value: "unreviewed", label: "Unreviewed", testid: "queue-filter-draft-unreviewed" },
          ]}
          onChange={(next) =>
            onChange({ draftReviewed: next === "any" ? null : (next as DraftReviewedFilter) })
          }
        />
      </div>
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Removed
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.excludeReason === "handled_offline"}
            onChange={() =>
              onChange({
                excludeReason:
                  filters.excludeReason === "handled_offline" ? null : "handled_offline",
              })
            }
            data-testid="queue-filter-excludeReason-handled_offline"
          />
          <span>Handled offline</span>
        </label>
      </div>
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Error type
        </div>
        <div className="max-h-40 overflow-y-auto pr-1 space-y-1">
          {errorTypeOptions.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">No error types loaded.</div>
          ) : (
            errorTypeOptions.map((et) => {
              const idStr = String(et.id);
              const active = filters.errorTypeIds.includes(idStr);
              return (
                <label key={et.id} className="flex items-center gap-2 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleErrorType(idStr)}
                    data-testid={`queue-filter-errorTypeId-${idStr}`}
                  />
                  <span className="truncate">{et.name}</span>
                </label>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── Lane stack ────────────────────────────────────────────────────────
function LaneSection({
  laneId,
  rows,
  total,
  collapsed,
  onToggle,
  selectedId,
  onSelect,
  compact,
  emptyFilter,
  isSettling,
}: {
  laneId: LaneId;
  rows: InvoiceGroupResponse[];
  total: number;
  collapsed: boolean;
  onToggle: () => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  compact: boolean;
  emptyFilter: ExpiringFilter;
  isSettling: (id: number) => boolean;
}) {
  const Icon = laneId === "clock" ? Clock : laneId === "week" ? CalendarDays : PauseCircle;
  const headerColor =
    laneId === "clock"
      ? "hsl(var(--destructive))"
      : laneId === "hold"
        ? "hsl(var(--muted-foreground))"
        : "hsl(var(--foreground))";
  const pillTone = laneId === "clock" ? "destructive" : "muted";
  return (
    <section
      data-testid={LANE_TESTID[laneId]}
      className="space-y-2"
    >
      <button
        type="button"
        onClick={onToggle}
        data-testid={`queue-lane-header-${laneId}`}
        data-collapsed={collapsed ? "true" : "false"}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/40 transition-colors text-left sticky top-0 z-10 bg-background"
        style={{ color: headerColor }}
        title="Click to collapse/expand. Tier legend: TODAY = file before EOD; TMRW = day-1; ≤3D = 2–3 days; ≤7D = within a week; LATER = past a week."
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs font-bold uppercase tracking-wider">{LANE_LABEL[laneId]}</span>
        <span
          data-testid={`queue-lane-count-${laneId}`}
          className="inline-flex items-center justify-center text-[11px] font-semibold rounded-full px-2 py-0.5"
          style={{
            background:
              pillTone === "destructive"
                ? "hsl(var(--cc-red-bg))"
                : "hsl(var(--muted))",
            color:
              pillTone === "destructive"
                ? "hsl(var(--cc-red-fg))"
                : "hsl(var(--muted-foreground))",
            border: `1px solid ${
              pillTone === "destructive"
                ? "hsl(var(--cc-red-border))"
                : "hsl(var(--border))"
            }`,
          }}
        >
          {total}
        </span>
      </button>
      {!collapsed && (
        <div className={compact ? "space-y-1" : "space-y-2"}>
          {rows.length === 0 ? (
            <Card>
              <CardContent className="py-6">
                <EmptyState
                  icon={Inbox}
                  title="Nothing here right now"
                  description={emptyStateCopy(LANE_EMPTY_KEY[laneId], emptyFilter)}
                  className="py-2"
                />
              </CardContent>
            </Card>
          ) : (
            rows.map((g) => (
              <QueueRow
                key={g.id}
                group={g}
                isSelected={selectedId === g.id}
                onSelect={onSelect}
                compact={compact}
                isSettling={isSettling(g.id)}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Main page
// ───────────────────────────────────────────────────────────────────────
export default function Queue() {
  useInvoiceGroupsListEvents();
  const queryClient = useQueryClient();
  const { get, getAll, set, searchParams } = useUrlParams();

  // ── Legacy URL rewrite (Task #649) ──────────────────────────────────
  // Delegated to the shared `legacyUrlRewrites` helper so queue.tsx
  // and the parity tests share one source of truth for the legacy
  // mappings (`?readyToReview=true` → `?outlook=ready_to_review`,
  // `?qActionable|qPortalQueued|qOnHold=…` → `?qSearch=…`, and
  // stripping the now-meaningless `?tab=` token).
  useEffect(() => {
    const updates = legacyUrlRewrites((k) => searchParams.get(k));
    if (updates) set(updates, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── URL-derived filter state ────────────────────────────────────────
  const filters: ParityFilters = {
    engagement: readEngagementMode(get("engagement")),
    expiring: parseExpiringParam(get("expiring")),
    outlook: parseOutlook(get("outlook")),
    errorTypeIds: getAll("errorTypeId"),
    draftReviewed: parseDraftReviewed(get("draftReviewed")),
    excludeReason: parseExcludeReason(get("excludeReason")),
    showPastDeadline: get("showPastDeadline") === "true",
    qSearch: get("qSearch"),
  };

  const applyFilters = (patch: Partial<ParityFilters>) => {
    const updates: Record<string, string | null> = {};
    if ("engagement" in patch) {
      updates.engagement = patch.engagement === "all" ? "all" : null;
    }
    if ("expiring" in patch) {
      updates.expiring = patch.expiring ?? null;
    }
    if ("outlook" in patch) {
      updates.outlook = patch.outlook ?? null;
    }
    if ("errorTypeIds" in patch) {
      const ids = patch.errorTypeIds ?? [];
      updates.errorTypeId = ids.length === 0 ? null : ids.join(",");
    }
    if ("draftReviewed" in patch) {
      updates.draftReviewed = patch.draftReviewed ?? null;
    }
    if ("excludeReason" in patch) {
      updates.excludeReason = patch.excludeReason ?? null;
    }
    if ("showPastDeadline" in patch) {
      updates.showPastDeadline = patch.showPastDeadline ? "true" : null;
    }
    if ("qSearch" in patch) {
      const q = patch.qSearch ?? "";
      updates.qSearch = q === "" ? null : q;
    }
    set(updates, false);
  };

  // ── Selection / inbox / triage URL state ────────────────────────────
  const groupParam = Number.parseInt(get("group"), 10);
  const selectedWorkflowId: number | null =
    Number.isFinite(groupParam) && groupParam > 0 ? groupParam : null;
  const inboxOpen = get("inbox") === "open";
  const triageParam = Number.parseInt(get("triage"), 10);
  const selectedTriageId: number | null =
    Number.isFinite(triageParam) && triageParam > 0 ? triageParam : null;

  const setSelectedWorkflowId = (id: number | null) =>
    set({ group: id == null ? null : String(id) }, false);
  const setInboxOpen = (open: boolean) => set({ inbox: open ? "open" : null }, false);
  const setSelectedTriageId = (id: number | null) =>
    set({ triage: id == null ? null : String(id) }, false);

  const [successMessage, setSuccessMessage] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);

  useInvoiceGroupEvents(selectedWorkflowId ?? undefined);
  const { viewers } = usePresence("invoice_group", selectedWorkflowId ?? undefined);

  const workflowPanelRef = useRef<HTMLDivElement>(null);
  const selectWorkflow = (id: number) => {
    setSelectedWorkflowId(id);
    window.requestAnimationFrame(() => {
      workflowPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const selectTriage = (id: number) => setSelectedTriageId(id);

  // ── Lane API queries ─────────────────────────────────────────────────
  // Server-side filtering for the modes the API understands. The Task
  // #452 client modes (tomorrow, today-tomorrow) and the new Task #649
  // facets (errorTypeId, draftReviewed, outlook) are applied through
  // existing `ListInvoiceGroups` params where possible; everything else
  // narrows client-side.
  // `stuck` is intentionally NOT forwarded as a lane query param: the
  // Queue doesn't fetch submitted groups, so passing it would only
  // narrow the actionable lanes to the empty set. The `stuck` mode
  // lives on the Dashboard / Portal Submissions surfaces instead.
  const expiringForLanes: "urgent" | "soon" | undefined =
    filters.expiring === "urgent" || filters.expiring === "soon"
      ? filters.expiring
      : undefined;
  const includeExpiredForLanes =
    filters.showPastDeadline ||
    filters.expiring === "urgent" ||
    filters.expiring === "today-tomorrow"
      ? true
      : undefined;
  const outlookForLanes: ListInvoiceGroupsOutlook | undefined = filters.outlook ?? undefined;
  const errorTypeForLanes: string | undefined =
    filters.errorTypeIds.length > 0 ? filters.errorTypeIds.join(",") : undefined;
  const draftReviewedForLanes: boolean | undefined =
    filters.draftReviewed === "reviewed"
      ? true
      : filters.draftReviewed === "unreviewed"
        ? false
        : undefined;

  const excludeReasonForLanes = filters.excludeReason ?? undefined;

  const baseQueryShape = {
    limit: 500 as const,
    expiring: expiringForLanes,
    includeExpired: includeExpiredForLanes,
    outlook: outlookForLanes,
    errorTypeId: errorTypeForLanes,
    draftReviewed: draftReviewedForLanes,
    excludeReason: excludeReasonForLanes,
  } satisfies Partial<ListInvoiceGroupsParams>;

  const newParams = { status: "New", ...baseQueryShape } as const;
  const needsEvidenceParams = { status: "Needs Evidence", ...baseQueryShape } as const;
  const generatingEmailParams = { status: "Generating Email", ...baseQueryShape } as const;
  // Portal-Queued is intentionally NOT fetched into the lane stack:
  // submitted groups belong on the Response Tracker, not the Queue.
  const onHoldParams = { status: "On Hold", ...baseQueryShape } as const;
  // The Lane Stack is a stable three-lane shape (clock / week / hold),
  // so the hold lane is always rendered and its query is always
  // active. The engagement filter narrows what the row hydrator does
  // with each row, but it does NOT remove the hold lane from the DOM.
  const showHoldLane = true;

  const newQuery = useListInvoiceGroups(newParams, {
    query: { queryKey: getListInvoiceGroupsQueryKey(newParams), refetchOnWindowFocus: true },
  });
  const needsEvidenceQuery = useListInvoiceGroups(needsEvidenceParams, {
    query: {
      queryKey: getListInvoiceGroupsQueryKey(needsEvidenceParams),
      refetchOnWindowFocus: true,
    },
  });
  const generatingEmailQuery = useListInvoiceGroups(generatingEmailParams, {
    query: {
      queryKey: getListInvoiceGroupsQueryKey(generatingEmailParams),
      refetchOnWindowFocus: true,
    },
  });
  const onHoldQuery = useListInvoiceGroups(onHoldParams, {
    query: {
      queryKey: getListInvoiceGroupsQueryKey(onHoldParams),
      refetchOnWindowFocus: true,
      enabled: showHoldLane,
    },
  });

  const newGroups = newQuery.data?.groups || [];
  const needsGroups = needsEvidenceQuery.data?.groups || [];
  const generatingEmailGroups = generatingEmailQuery.data?.groups || [];
  const onHoldGroups = onHoldQuery.data?.groups || [];

  // ── Error types for the popover facet ────────────────────────────────
  const errorTypesQuery = useListErrorTypes();
  const errorTypeOptions: ErrorTypeOption[] = useMemo(() => {
    const data = (errorTypesQuery.data ?? []) as Array<{ id: number; name: string }>;
    return data.map((e) => ({ id: e.id, name: e.name }));
  }, [errorTypesQuery.data]);

  // ── Inbox payload ────────────────────────────────────────────────────
  const inboxParams = {
    status: "Needs Review",
    limit: 0,
    include: "needs_classification",
  } as const;
  const inboxQuery = useListInvoiceGroups(inboxParams, {
    query: { queryKey: getListInvoiceGroupsQueryKey(inboxParams), refetchOnWindowFocus: true },
  });
  const inboxGroups: NeedsClassificationInboxGroup[] =
    inboxQuery.data?.needsClassificationInbox?.groups ?? [];
  const inboxTotal = inboxQuery.data?.needsClassificationInbox?.total ?? 0;
  const inboxByStatus: Record<string, number> =
    inboxQuery.data?.needsClassificationInbox?.byStatus ?? {};

  // ── Combined row set + client-side narrowing ─────────────────────────
  const sortByUrgency = (rows: InvoiceGroupResponse[]) =>
    [...rows].sort((a, b) => {
      const aUrgent = a.isUrgent ? 1 : 0;
      const bUrgent = b.isUrgent ? 1 : 0;
      if (aUrgent !== bUrgent) return bUrgent - aUrgent;
      const aDays = a.effectiveDaysLeft ?? Number.POSITIVE_INFINITY;
      const bDays = b.effectiveDaysLeft ?? Number.POSITIVE_INFINITY;
      return aDays - bDays;
    });

  const dedupedAll = useMemo(
    () =>
      dedupRowsById<InvoiceGroupResponse>([
        ...newGroups,
        ...needsGroups,
        ...generatingEmailGroups,
        ...(showHoldLane ? onHoldGroups : []),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      newGroups,
      needsGroups,
      generatingEmailGroups,
      onHoldGroups,
      showHoldLane,
    ],
  );

  const needsClientFilter =
    filters.expiring === "tomorrow" || filters.expiring === "today-tomorrow";
  const expiringNarrowed = needsClientFilter
    ? filterByExpiringParam(dedupedAll, filters.expiring)
    : dedupedAll;

  const matchesSearch = (g: InvoiceGroupResponse, q: string) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    const haystacks = [g.invoiceNumber, g.clientNumber, g.errorTypeName];
    return haystacks.some((v) => typeof v === "string" && v.toLowerCase().includes(s));
  };
  const searched = useMemo(
    () => expiringNarrowed.filter((g) => matchesSearch(g, filters.qSearch)),
    [expiringNarrowed, filters.qSearch],
  );
  const sorted = useMemo(() => sortByUrgency(searched), [searched]);

  const lanesRows: Record<LaneId, InvoiceGroupResponse[]> = useMemo(() => {
    const out: Record<LaneId, InvoiceGroupResponse[]> = { clock: [], week: [], hold: [] };
    for (const g of sorted) {
      out[laneForRow(g)].push(g);
    }
    return out;
  }, [sorted]);

  // Per-lane settle (Task #490)
  const clockSettle = useRowSettle(lanesRows.clock, (g) => g.id, selectedWorkflowId);
  const weekSettle = useRowSettle(lanesRows.week, (g) => g.id, selectedWorkflowId);
  const holdSettle = useRowSettle(lanesRows.hold, (g) => g.id, selectedWorkflowId);

  // Lane collapse state from URL
  const collapsedSet = useMemo(() => new Set(getAll("laneCollapsed")), [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps
  const isCollapsed = (id: LaneId) => collapsedSet.has(id);
  const toggleLane = (id: LaneId) => {
    const next = new Set(collapsedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ laneCollapsed: next.size === 0 ? null : Array.from(next).join(",") }, false);
  };

  // Counts
  const openCount = lanesRows.clock.length + lanesRows.week.length;
  const onHoldCount = lanesRows.hold.length;
  const urgentCount =
    filters.expiring === "urgent"
      ? sorted.length
      : computeAggregateUrgentCount(sorted);

  // Selected row summary (for workspace pane header)
  const selectedWorkflowGroupSummary = selectedWorkflowId
    ? dedupedAll.find((g) => g.id === selectedWorkflowId) ?? null
    : null;

  // Day rollover invalidator
  const serverToday = latestTodayKey(
    newQuery.data?.today,
    needsEvidenceQuery.data?.today,
    generatingEmailQuery.data?.today,
    onHoldQuery.data?.today,
    inboxQuery.data?.today,
  );
  useServerDayRolloverInvalidator(serverToday);

  // Drop a stale ?triage=<id> if the inbox no longer surfaces that group
  useEffect(() => {
    if (!inboxQuery.data) return;
    if (selectedTriageId && !inboxGroups.some((g) => g.id === selectedTriageId)) {
      setSelectedTriageId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTriageId, inboxGroups, inboxQuery.data]);

  useEffect(() => {
    if (!successMessage) return;
    const t = setTimeout(() => setSuccessMessage(""), 4000);
    return () => clearTimeout(t);
  }, [successMessage]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
  };

  const compact = selectedWorkflowId != null;

  // Per-chip match counts — for each active chip, count rows in the
  // pre-filter dedupedAll set whose row state satisfies that chip's
  // predicate. Server-side facets (outlook, errorTypeId, draftReviewed)
  // already constrained dedupedAll, so their counts equal the visible
  // total — still informative because the chip then advertises "this
  // is what the API returned for this filter alone".
  const chipCounts = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    if (filters.engagement !== "needs") {
      out["engagement-all"] = dedupedAll.length;
    }
    const exp = filters.expiring;
    if (exp === "urgent" || exp === "today-tomorrow") {
      out["expiring-today"] = dedupedAll.filter(
        (r) => !!r.isUrgent && !r.submittedStuck,
      ).length;
    }
    if (exp === "tomorrow" || exp === "today-tomorrow") {
      out["expiring-tomorrow"] = dedupedAll.filter(
        (r) => !r.submittedStuck && !r.isUrgent && r.effectiveDaysLeft === 1,
      ).length;
    }
    if (exp === "soon") {
      out["expiring-soon"] = dedupedAll.filter(
        (r) =>
          !r.submittedStuck &&
          !r.isUrgent &&
          (r.effectiveDaysLeft ?? Number.POSITIVE_INFINITY) <= 3,
      ).length;
    }
    // No `expiring=stuck` count branch: the chip is no longer
    // exposed in the Queue (see the filter popover comment).
    if (filters.outlook) {
      out[`outlook-${filters.outlook}`] = dedupedAll.length;
    }
    for (const idStr of filters.errorTypeIds) {
      out[`errorTypeId-${idStr}`] = dedupedAll.filter(
        (r) => String(r.errorTypeId ?? "") === idStr,
      ).length;
    }
    if (filters.draftReviewed) {
      out[`draftReviewed-${filters.draftReviewed}`] = dedupedAll.length;
    }
    if (filters.excludeReason === "handled_offline") {
      out["excludeReason-handled_offline"] = dedupedAll.length;
    }
    if (filters.showPastDeadline) {
      out["showPastDeadline"] = dedupedAll.filter(
        (r) => (r.effectiveDaysLeft ?? Number.POSITIVE_INFINITY) < 0,
      ).length;
    }
    if (filters.qSearch.trim()) {
      out["qSearch"] = searched.length;
    }
    return out;
  }, [dedupedAll, filters, searched]);

  const chips = buildChips(filters, errorTypeOptions, applyFilters, chipCounts);
  const facetCount = appliedFacetCount(filters);

  return (
    <div
      className="space-y-4"
      data-testid="queue-page-root"
      data-mode={compact ? "compact" : "wide"}
    >
      <div className={`grid grid-cols-1 gap-6 ${compact ? "lg:grid-cols-3" : ""}`}>
        <div
          data-testid="queue-rail-shell"
          data-mode={compact ? "compact" : "wide"}
          className={`space-y-3 ${compact ? "lg:col-span-1 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-2 lg:sticky lg:top-4 lg:self-start" : ""}`}
        >
          {/* Title strip */}
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-0.5">
              <h2 className="text-xl font-bold tracking-tight">Invoice queue</h2>
              <p className="text-xs text-muted-foreground">
                {openCount} open · {onHoldCount} on hold
              </p>
            </div>
            {compact && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedWorkflowId(null)}
                title="Close workspace and expand queue"
                data-testid="queue-rail-expand"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Urgency hero — clickable, toggles ?expiring=urgent */}
          {urgentCount > 0 && (
            <button
              type="button"
              data-testid="queue-urgency-hero"
              onClick={() =>
                applyFilters({
                  expiring: filters.expiring === "urgent" ? null : "urgent",
                })
              }
              className="w-full rounded-md border-2 px-3 py-2 flex items-center gap-3 text-left hover:opacity-90 transition-opacity"
              style={{
                background: "hsl(var(--cc-red-bg))",
                borderColor: "hsl(var(--cc-red-border))",
                color: "hsl(var(--cc-red-fg))",
              }}
              aria-pressed={filters.expiring === "urgent"}
            >
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <div className="flex items-baseline gap-2 min-w-0 flex-1">
                <span
                  className="text-2xl font-bold tabular-nums"
                  data-testid="queue-urgency-hero-count"
                >
                  {urgentCount}
                </span>
                <span className="text-xs font-semibold">
                  must file today · EOD deadline · click a row to start a Walk
                </span>
              </div>
            </button>
          )}

          {/* Classification Inbox strip */}
          <ClassificationInboxStrip
            open={inboxOpen}
            onToggle={() => setInboxOpen(!inboxOpen)}
            loading={inboxQuery.isLoading}
            groups={inboxGroups}
            total={inboxTotal}
            byStatus={inboxByStatus}
            selectedId={selectedTriageId}
            onSelect={selectTriage}
          />

          {/* Filter strip */}
          <div
            className="rounded-md border bg-card"
            data-testid="queue-filter-strip"
          >
            <div className="flex items-center gap-2 flex-wrap p-2">
              <Segmented
                testid="queue-engagement-segmented"
                mode={filters.engagement}
                options={[
                  { value: "needs", label: "Needs", testid: "queue-engagement-needs" },
                  { value: "all", label: "All", testid: "queue-engagement-all" },
                ]}
                onChange={(v) => applyFilters({ engagement: v as EngagementMode })}
              />
              <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    data-testid="queue-filters-popover-trigger"
                    data-applied-count={String(facetCount)}
                  >
                    <Filter className="h-3.5 w-3.5" />
                    Filters
                    {facetCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="ml-0.5 h-4 px-1.5 text-[10px] font-bold"
                      >
                        {facetCount}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80">
                  <FiltersPopover
                    filters={filters}
                    errorTypeOptions={errorTypeOptions}
                    onChange={applyFilters}
                  />
                </PopoverContent>
              </Popover>
              <Segmented
                testid="queue-past-deadline-segmented"
                mode={filters.showPastDeadline ? "show" : "hide"}
                options={[
                  { value: "hide", label: "Hide past-deadline", testid: "queue-past-deadline-hide" },
                  { value: "show", label: "Show past-deadline", testid: "queue-past-deadline-show" },
                ]}
                onChange={(v) => applyFilters({ showPastDeadline: v === "show" })}
              />
              <div className="flex items-center gap-1.5 flex-1 min-w-[200px] rounded-md border border-border bg-background px-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  data-testid="queue-search-input"
                  value={filters.qSearch}
                  onChange={(e) => applyFilters({ qSearch: e.target.value })}
                  placeholder="Search invoice, client, error type…"
                  className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
                />
              </div>
            </div>
            <div
              data-testid="queue-active-filter-chips"
              className="flex items-center gap-1.5 flex-wrap px-2 py-1.5 border-t border-border bg-muted/30 min-h-[32px]"
            >
              {chips.length === 0 && (
                <span className="text-[11px] text-muted-foreground italic">
                  No filters active.
                </span>
              )}
              {chips.map((chip) => (
                <span
                  key={chip.id}
                  data-testid={`queue-active-filter-chip-${chip.id}`}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium"
                >
                  <span>{chip.label}</span>
                  {typeof chip.count === "number" && (
                    <span
                      data-testid={`queue-active-filter-chip-${chip.id}-count`}
                      className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground"
                    >
                      {chip.count}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={chip.onClear}
                    aria-label={`Clear ${chip.label}`}
                    data-testid={`queue-active-filter-chip-${chip.id}-clear`}
                    className="rounded-full p-0.5 hover:bg-muted"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {chips.length >= 2 && (
                <button
                  type="button"
                  data-testid="queue-active-filter-clear-all"
                  onClick={() =>
                    applyFilters({
                      engagement: "needs",
                      expiring: null,
                      outlook: null,
                      errorTypeIds: [],
                      draftReviewed: null,
                      excludeReason: null,
                      showPastDeadline: false,
                      qSearch: "",
                    })
                  }
                  className="text-[11px] underline-offset-2 hover:underline text-muted-foreground hover:text-foreground"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          {successMessage && (
            <div className="bg-green-50 border border-green-200 rounded-md px-3 py-2 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-sm text-green-800">{successMessage}</span>
            </div>
          )}

          {selectedTriageId != null && (
            <ClassifyDialog
              open
              onOpenChange={(open) => {
                if (!open) setSelectedTriageId(null);
              }}
              groupId={selectedTriageId}
              onCompleted={(message) => {
                setSuccessMessage(message);
                invalidate();
              }}
            />
          )}

          {/* Lane stack */}
          <div className="space-y-4">
            {(["clock", "week", "hold"] as LaneId[]).map((laneId) => {
              const settle =
                laneId === "clock"
                  ? clockSettle
                  : laneId === "week"
                    ? weekSettle
                    : holdSettle;
              return (
                <LaneSection
                  key={laneId}
                  laneId={laneId}
                  rows={settle.slots.map((s) => s.item)}
                  total={lanesRows[laneId].length}
                  collapsed={isCollapsed(laneId)}
                  onToggle={() => toggleLane(laneId)}
                  selectedId={selectedWorkflowId}
                  onSelect={selectWorkflow}
                  compact={compact}
                  emptyFilter={filters.expiring}
                  isSettling={(id) =>
                    settle.slots.find((s) => s.item.id === id)?.isSettling ?? false
                  }
                />
              );
            })}
          </div>
        </div>

        {selectedWorkflowId && (
          <div ref={workflowPanelRef} className="scroll-mt-4 lg:col-span-2">
            <div className="space-y-3 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:space-y-0 lg:flex lg:flex-col lg:gap-3">
              <div className="flex items-center justify-between gap-2 lg:shrink-0">
                <h3 className="text-lg font-semibold">
                  Process Invoice Group
                  {selectedWorkflowGroupSummary && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      <RefNumber
                        value={selectedWorkflowGroupSummary.invoiceNumber}
                        variant="inline"
                      />{" "}
                      · {selectedWorkflowGroupSummary.status}
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedWorkflowId(null)}
                    data-testid="close-inline-workspace"
                  >
                    Close
                  </Button>
                </div>
              </div>
              <div className="lg:shrink-0">
                <HumanPresenceBanner viewers={viewers} resourceLabel="group" />
              </div>
              <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
                <InlineGroupWorkspaceMini groupId={selectedWorkflowId} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Classification Inbox (preserved verbatim from the prior implementation —
// strip + expand row + per-status breakdown). Renders in the rail at
// fixed position whether the inbox is open or closed.
// ───────────────────────────────────────────────────────────────────────
interface ClassificationInboxStripProps {
  open: boolean;
  onToggle: () => void;
  loading: boolean;
  groups: NeedsClassificationInboxGroup[];
  total: number;
  byStatus: Record<string, number>;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function ClassificationInboxStrip({
  open,
  onToggle,
  loading,
  groups,
  total,
  byStatus,
  selectedId,
  onSelect,
}: ClassificationInboxStripProps) {
  const hasWork = total > 0;
  return (
    <div
      data-testid="queue-classification-inbox-strip"
      data-tour="queue-classification-inbox"
      className="rounded-md border"
      style={{
        background: hasWork ? "hsl(var(--cc-amber-bg))" : "hsl(var(--muted) / 0.4)",
        borderColor: hasWork ? "hsl(var(--cc-amber-border))" : "hsl(var(--border))",
        color: hasWork ? "hsl(var(--cc-amber-fg))" : "hsl(var(--muted-foreground))",
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
        <AlertCircle className="h-4 w-4" />
        <span className="text-sm font-semibold">Classification Inbox</span>
        {hasWork ? (
          <Badge variant="secondary" data-testid="badge-classification-count">
            {total} unclassified
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]" data-testid="classification-inbox-empty">
            All caught up
          </Badge>
        )}
        <ClassificationInboxStatusBreakdown byStatus={byStatus} />
        <span className="flex-1" />
        {hasWork && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            data-testid="classification-inbox-toggle"
            className="text-xs font-semibold underline-offset-2 hover:underline inline-flex items-center gap-1"
          >
            {open ? (
              <>
                Hide <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                Open <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        )}
      </div>
      {hasWork && open && (
        <div className="border-t border-border bg-background p-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Imported groups with claims that have no Error Type yet. Pick a label and the
            qualifying claim auto-advances to Build Case; blank-description sibling claims are
            auto-excluded.
          </p>
          {loading ? (
            <div
              className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"
              data-testid="classification-inbox-loading"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading triage queue…
            </div>
          ) : (
            <div
              className="space-y-2 max-h-96 overflow-y-auto pr-1"
              data-testid="queue-list-needs-review"
            >
              {groups.map((g) => (
                <ClassificationInboxRow
                  key={g.id}
                  group={g}
                  isSelected={selectedId === g.id}
                  onSelect={() => onSelect(g.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ClassificationInboxStatusBreakdown({
  byStatus,
}: {
  byStatus: Record<string, number>;
}) {
  const entries = Object.entries(byStatus).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  if (entries.length === 1 && entries[0][0] === "Needs Review") return null;
  return (
    <span
      className="text-xs flex items-center gap-1.5 flex-wrap"
      data-testid="classification-inbox-by-status"
    >
      {entries.map(([status, n], idx) => (
        <span
          key={status}
          data-testid={`classification-inbox-status-${status.replace(/\s+/g, "-").toLowerCase()}`}
          className="flex items-center gap-1"
        >
          {idx > 0 && <span aria-hidden className="opacity-50">·</span>}
          <span className="tabular-nums font-medium">{n}</span>
          <span>{status}</span>
        </span>
      ))}
    </span>
  );
}

function ClassificationInboxRow({
  group,
  isSelected,
  onSelect,
}: {
  group: NeedsClassificationInboxGroup;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const qualifying = group.qualifyingSiblingCount;
  const blank = group.needsClassificationCount;
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`inbox-group-${group.invoiceNumber}`}
      aria-pressed={isSelected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`w-full text-left rounded-lg border bg-card transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        isSelected ? "ring-2 ring-primary border-primary" : "hover:bg-accent/50"
      }`}
    >
      <div className="py-3 px-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <RefNumber value={group.invoiceNumber} variant="inline" className="font-semibold" />
            <StateBadge variant="status" value={group.status} className="text-[10px]" />
            {group.allBlank ? (
              <Badge
                variant="outline"
                className="text-[10px]"
                style={{
                  background: "hsl(var(--cc-amber-bg))",
                  color: "hsl(var(--cc-amber-fg))",
                  borderColor: "hsl(var(--cc-amber-border))",
                }}
              >
                All blank — review carefully
              </Badge>
            ) : qualifying > 0 ? (
              <Badge variant="secondary" className="text-[10px]">
                {qualifying} qualifying
              </Badge>
            ) : null}
            {blank > 0 && !group.allBlank && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                {blank} blank
              </Badge>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
        <ul className="space-y-1 text-xs">
          {group.claims.slice(0, 4).map((c) => (
            <li
              key={c.id}
              className="flex items-start gap-2 rounded-md bg-muted/30 px-2 py-1.5"
              data-testid={`inbox-claim-${c.id}`}
            >
              <span className="font-mono text-muted-foreground shrink-0">
                {c.confNumber || `#${c.id}`}
              </span>
              <span className="text-muted-foreground shrink-0">
                {c.date ? formatDate(c.date) : "—"}
              </span>
              <HideForClerk>
                <span className="tabular-nums text-muted-foreground shrink-0">
                  {/* Currency intentionally omitted from the inbox row to
                      stay consistent with the queue rows (Task #649 drops
                      the dollar from the rail). */}
                </span>
              </HideForClerk>
              <span
                className={`flex-1 truncate ${c.isBlank ? "italic text-muted-foreground" : ""}`}
              >
                {c.isBlank ? "(blank — auto-exclude on classify)" : c.errorDetails ?? ""}
              </span>
            </li>
          ))}
          {group.claims.length > 4 && (
            <li className="text-[11px] text-muted-foreground italic px-2">
              +{group.claims.length - 4} more claim{group.claims.length - 4 === 1 ? "" : "s"} —
              open to triage.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}


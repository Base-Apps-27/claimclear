import { useEffect, useMemo, useRef, useState } from "react";
import { useRowSettle } from "@/hooks/use-row-settle";
import { useServerDayRolloverInvalidator, latestTodayKey } from "@/lib/server-day-rollover";
import { Link } from "wouter";
import { useInvoiceGroupsListEvents, useInvoiceGroupEvents } from "@/hooks/use-claim-events";
import {
  useListInvoiceGroups,
  useGetInvoiceGroup,
  useGetMacroPhaseRollup,
  getGetMacroPhaseRollupQueryKey,
  getListInvoiceGroupsQueryKey,
  getGetInvoiceGroupQueryKey,
} from "@workspace/api-client-react";
import { macroPhaseLabel } from "@/lib/lifecycle-phase";
import { GroupActionChecklist } from "@/components/attestation/group-action-checklist";
import type {
  InvoiceGroupResponse,
  NeedsClassificationInboxGroup,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StateBadge } from "@/components/state-badge";
import { PreSubmitBreakdown } from "@/components/pre-submit-breakdown";
import { RefNumber } from "@/components/ref-number";
import { UrgentTodayWhyLine } from "@/components/urgent-today-why";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/format";
import { HideForClerk } from "@/lib/role";
import {
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  AlertTriangle,
  Filter,
  Inbox,
  Loader2,
  PauseCircle,
  Sparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  parseExpiringParam,
  filterByExpiringParam,
  formatDeadlineLabel,
  formatTabBadge,
  computeAggregateUrgentCount,
  emptyStateCopy,
  type ExpiringFilter,
  type DeadlineTier,
} from "@/lib/queue-urgency";
import { countUrgentRows } from "@/lib/urgent-count";
import { ClassifyDialog } from "@/components/classify-dialog";
import { ListTableHeaderStrip } from "@/components/list-table/faceted-filter/list-table-header-strip";
import { UrgentTodayBadge } from "@/components/urgent-today-badge";
import { usePresence } from "@/hooks/use-presence";
import { HumanPresenceBanner } from "@/components/presence-banners";
import { useUrlParams } from "@/lib/use-url-params";
import {
  NeedsEngagementToggle,
  readEngagementMode,
} from "@/components/engagement-filter-controls";
import { InvoiceGroupActionSlot } from "@/components/invoice-group-action-slot";
import { LegConclusionList } from "@/components/leg-conclusion-row";
import { InlineGroupWorkspaceMini } from "@/components/inline-group-workspace-mini";
import { CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { ClaimResponse, InvoiceGroupDetailResponse } from "@workspace/api-client-react";

// Workflow tabs only — Needs Review is intentionally NOT a tab here.
// Triage lives in the Classification Inbox above the workflow grid.
// "Awaiting Response" was removed in Task #232: those groups are still
// visible on /responses-awaiting-review when something needs a verdict.
const VALID_TABS = ["actionable", "mas-action-required", "portal-queued", "on-hold"] as const;
type QueueTab = typeof VALID_TABS[number];
const DEFAULT_TAB: QueueTab = "actionable";

/**
 * Big urgency hero at the top of the Queue. Mirrors the Dashboard's
 * "File today" card so the operator who clicked through doesn't lose
 * context. Three states:
 * - red    → urgent groups exist; file-today crunch, intensified
 *            (full-width + sticky) when arrived via `?expiring=urgent`.
 * - amber  → on the `?expiring=soon` view; softer signal, no sticky.
 * - green  → urgentCount === 0; calm "all clear" relief state.
 */
function QueueUrgencyHero({
  urgentCount,
  stuckCount,
  soonCount,
  tomorrowCount,
  filter,
  onSelectUrgentGroup,
}: {
  urgentCount: number;
  /** Task #352 — Portal Queued groups whose deadline slipped without ack. */
  stuckCount: number;
  soonCount: number;
  /** Task #452 — count of day-1 (tomorrow) rows visible across the
   *  on-clock lanes; drives the tomorrow-only and today-tomorrow heroes. */
  tomorrowCount: number;
  filter: ExpiringFilter;
  /** Task #410 — Queue's `selectWorkflow`, threaded down to the
   *  File-today activity panel so currently-urgent rows jump to the
   *  inline workspace instead of leaving the Queue. */
  onSelectUrgentGroup: (id: number) => void;
}) {
  // Task #452 — dedicated hero for the "tomorrow" filter: amber tone,
  // softer than today's red but stronger than the 2–3-day "soon" view
  // because tomorrow is the next thing on the clock.
  if (filter === "tomorrow") {
    return (
      <div
        data-testid="queue-urgency-hero"
        data-tone="amber"
        className="rounded-lg border-2 px-5 py-4 flex items-center gap-4"
        style={{
          background: "hsl(var(--cc-amber-bg))",
          borderColor: "hsl(var(--cc-amber-border))",
          color: "hsl(var(--cc-amber-fg))",
        }}
      >
        <AlertTriangle className="h-6 w-6 shrink-0" style={{ color: "hsl(var(--cc-amber-fg))" }} />
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span
              className="text-3xl font-bold tabular-nums"
              data-testid="queue-urgency-hero-count"
            >
              {tomorrowCount}
            </span>
            <span className="text-sm">due tomorrow · stage them today so EOD doesn't catch you</span>
          </div>
        </div>
      </div>
    );
  }

  // Task #452 — combined today+tomorrow hero. Fires both for the
  // explicit `today-tomorrow` filter (the Dashboard click-through) AND
  // for the default no-filter view, so the Queue baseline matches the
  // Dashboard's "X due today · Y due tomorrow" framing instead of
  // dropping to a green "0" the moment urgent is empty but tomorrow
  // still has rows. Differences between the two modes:
  //   • Explicit `today-tomorrow`: sticky+intensified red, with the
  //     "from the Dashboard" callout — matches the click-through
  //     intent that the operator deliberately chose this view.
  //   • Default (no filter): same combined copy, calmer chrome
  //     (no sticky, no callout) — this is the always-on baseline.
  // When BOTH counts are 0 we fall through to the green "all clear"
  // branch at the bottom of the function so the relief state still
  // reads correctly.
  if (filter === null || filter === "today-tomorrow") {
    const total = urgentCount + tomorrowCount;
    const intensified = filter === "today-tomorrow";
    if (urgentCount > 0) {
      return (
        <div
          data-testid="queue-urgency-hero"
          data-tour="queue-urgency-hero"
          data-tone="red"
          data-intensified={intensified ? "true" : undefined}
          className={`rounded-lg border-2 px-5 py-4 flex items-center gap-4 ${
            intensified ? "sticky top-0 z-20 shadow-lg" : ""
          }`}
          style={{
            background: "hsl(var(--cc-red-bg))",
            borderColor: "hsl(var(--cc-red-border))",
            color: "hsl(var(--cc-red-fg))",
          }}
        >
          <AlertTriangle className="h-7 w-7 shrink-0" style={{ color: "hsl(var(--destructive))" }} />
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span
                className="text-4xl font-bold tabular-nums"
                style={{ color: "hsl(var(--destructive))" }}
                data-testid="queue-urgency-hero-count"
              >
                {total}
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-semibold">
                  {urgentCount} due today · {tomorrowCount} due tomorrow
                </span>
                <span className="text-xs opacity-80">
                  {intensified
                    ? `Combined "file today or tomorrow" view from the Dashboard. Today's red rows must ship before EOD; tomorrow's amber rows are next on the clock.`
                    : `Today's red rows must ship before EOD; tomorrow's amber rows are next on the clock.`}
                </span>
              </div>
            </div>
            <UrgentTodayWhyLine
              tone="red"
              urgentCountOverride={urgentCount}
              testid="queue-urgent-today-why-red"
              onSelectUrgentGroup={onSelectUrgentGroup}
            />
          </div>
        </div>
      );
    }
    if (tomorrowCount > 0) {
      // Tomorrow rows but no today — render the amber tomorrow-only
      // hero so the operator still sees what's coming up next.
      return (
        <div
          data-testid="queue-urgency-hero"
          data-tour="queue-urgency-hero"
          data-tone="amber"
          className="rounded-lg border-2 px-5 py-4 flex items-center gap-4"
          style={{
            background: "hsl(var(--cc-amber-bg))",
            borderColor: "hsl(var(--cc-amber-border))",
            color: "hsl(var(--cc-amber-fg))",
          }}
        >
          <AlertTriangle className="h-6 w-6 shrink-0" style={{ color: "hsl(var(--cc-amber-fg))" }} />
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span
                className="text-3xl font-bold tabular-nums"
                data-testid="queue-urgency-hero-count"
              >
                {tomorrowCount}
              </span>
              <span className="text-sm">
                due tomorrow · nothing must file today yet
              </span>
            </div>
          </div>
        </div>
      );
    }
    // total === 0 → fall through to the green "all clear" branch below.
    void total;
  }

  // Task #352 — "stuck after submission" filter state. Amber-orange tone
  // distinct from the pre-submit urgency red — the action here is "chase
  // confirmation", not "file now".
  if (filter === "stuck") {
    return (
      <div
        data-testid="queue-urgency-hero"
        data-tone="amber"
        className="rounded-lg border-2 px-5 py-4 flex items-center gap-4"
        style={{
          background: "hsl(var(--cc-amber-bg))",
          borderColor: "hsl(var(--cc-amber-border))",
          color: "hsl(var(--cc-amber-fg))",
        }}
      >
        <Clock className="h-6 w-6 shrink-0" style={{ color: "hsl(var(--cc-amber-fg))" }} />
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span
              className="text-3xl font-bold tabular-nums"
              data-testid="queue-urgency-hero-count"
            >
              {soonCount}
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-semibold">
                submitted but unconfirmed past deadline
              </span>
              <span className="text-xs opacity-80">
                Chase portal confirmation — do not re-file. Clock was satisfied at submission.
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (filter === "soon") {
    return (
      <div
        data-testid="queue-urgency-hero"
        data-tone="amber"
        className="rounded-lg border-2 px-5 py-4 flex items-center gap-4"
        style={{
          background: "hsl(var(--cc-amber-bg))",
          borderColor: "hsl(var(--cc-amber-border))",
          color: "hsl(var(--cc-amber-fg))",
        }}
      >
        <AlertTriangle className="h-6 w-6 shrink-0" style={{ color: "hsl(var(--cc-amber-fg))" }} />
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span
              className="text-3xl font-bold tabular-nums"
              data-testid="queue-urgency-hero-count"
            >
              {soonCount}
            </span>
            <span className="text-sm">due in the next 3 days · stay ahead of the clock</span>
          </div>
          <UrgentTodayWhyLine
            tone="amber"
            testid="queue-urgent-today-why-amber"
            onSelectUrgentGroup={onSelectUrgentGroup}
          />
        </div>
      </div>
    );
  }

  if (urgentCount > 0) {
    const intensified = filter === "urgent";
    return (
      <div
        data-testid="queue-urgency-hero"
        data-tone="red"
        data-intensified={intensified ? "true" : undefined}
        className={`rounded-lg border-2 px-5 py-4 flex items-center gap-4 ${
          intensified ? "sticky top-0 z-20 shadow-lg" : ""
        }`}
        style={{
          background: "hsl(var(--cc-red-bg))",
          borderColor: "hsl(var(--cc-red-border))",
          color: "hsl(var(--cc-red-fg))",
        }}
      >
        <AlertTriangle className="h-7 w-7 shrink-0" style={{ color: "hsl(var(--destructive))" }} />
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span
              className="text-4xl font-bold tabular-nums"
              style={{ color: "hsl(var(--destructive))" }}
              data-testid="queue-urgency-hero-count"
            >
              {urgentCount}
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-semibold">
                {urgentCount === 1 ? "group" : "groups"} must be submitted before EOD
              </span>
              <span className="text-xs opacity-80">
                File today across Action Required, Portal Queued, and On Hold.
              </span>
            </div>
          </div>
          <UrgentTodayWhyLine
            tone="red"
            urgentCountOverride={urgentCount}
            testid="queue-urgent-today-why-red"
            onSelectUrgentGroup={onSelectUrgentGroup}
          />
        </div>
      </div>
    );
  }

  // Green "all clear" relief state — calm white-to-green gradient so it
  // celebrates the cleared file-today queue without screaming.
  // Task #352: if there are stuck-after-submission groups, surface a
  // secondary amber hint inside the green hero so the operator doesn't
  // miss the parallel tier when urgentCount happens to be 0.
  return (
    <div
      data-testid="queue-urgency-hero"
      data-tour="queue-urgency-hero"
      data-tone="green"
      className="rounded-lg border-2 px-5 py-4 flex items-center gap-4"
      style={{
        background:
          "linear-gradient(90deg, hsl(var(--card)) 0%, hsl(var(--cc-green-bg)) 100%)",
        borderColor: "hsl(var(--cc-green-border))",
        color: "hsl(var(--cc-green-fg))",
      }}
    >
      <Sparkles className="h-6 w-6 shrink-0" style={{ color: "hsl(var(--cc-green-fg))" }} />
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span
            className="text-3xl font-bold tabular-nums"
            style={{ color: "hsl(var(--cc-green-fg))" }}
            data-testid="queue-urgency-hero-count"
          >
            0
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">All clear — nothing must file today.</span>
            <span className="text-xs opacity-80">
              File-today queue is empty. Work the next tier so it stays that way.
            </span>
          </div>
        </div>
        <UrgentTodayWhyLine
          tone="green"
          urgentCountOverride={0}
          testid="queue-urgent-today-why-green"
          onSelectUrgentGroup={onSelectUrgentGroup}
        />
        {stuckCount > 0 && (
          <div
            className="mt-1 flex items-center gap-1.5 text-xs font-medium"
            style={{ color: "hsl(var(--cc-amber-fg))" }}
            data-testid="queue-stuck-secondary-hint"
          >
            <Clock className="h-3 w-3" />
            {stuckCount} submitted but stuck after deadline — check the{" "}
            <a
              href="/queue?tab=portal-queued&expiring=stuck"
              className="underline underline-offset-2"
            >
              Portal Queued tab
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Single chip element — visual atom used by `ExpiringFilterChip` to
 * render one tone-coded pill per active filter "side" (Today /
 * Tomorrow / Soon / Stuck). Each chip has its own clear button so the
 * operator can drop one side of the today+tomorrow combination
 * without losing the other.
 */
function FilterChipPill({
  tone,
  label,
  testid,
  clearLabel,
  onClear,
}: {
  tone: "red" | "amber" | "amber-soft";
  label: string;
  testid: string;
  clearLabel: string;
  onClear: () => void;
}) {
  const palette =
    tone === "red"
      ? {
          bg: "hsl(var(--cc-red-bg))",
          border: "hsl(var(--cc-red-border))",
          fg: "hsl(var(--cc-red-fg))",
        }
      : {
          bg: "hsl(var(--cc-amber-bg))",
          border: "hsl(var(--cc-amber-border))",
          fg: "hsl(var(--cc-amber-fg))",
        };
  return (
    <span
      data-testid={testid}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
      style={{
        background: palette.bg,
        borderColor: palette.border,
        color: palette.fg,
        opacity: tone === "amber-soft" ? 0.85 : 1,
      }}
    >
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={clearLabel}
        data-testid={`${testid}-clear`}
        className="rounded-full p-0.5 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-1"
        style={{ color: palette.fg }}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/**
 * Inline filter chip area below the hero — lets the operator see (and
 * adjust) the `?expiring=` filter without spelunking the URL bar.
 *
 * Task #452 — when "today" and "tomorrow" are both active (the
 * `today-tomorrow` mode the Dashboard's "File today or tomorrow" hero
 * links to) we render one chip per side with its own clear button, so
 * dropping "today" leaves you on "tomorrow" alone (and vice-versa)
 * without leaving the page. When only one of them is active, we
 * surface a small "+ Tomorrow" / "+ Today" affordance to add the other
 * side in a single click. Soon / Stuck remain single-chip.
 */
function ExpiringFilterChip({
  filter,
  todayCount,
  tomorrowCount,
  count,
  onSetFilter,
}: {
  filter: NonNullable<ExpiringFilter>;
  /** Count of today/urgent rows actually visible — drives the chip and
   *  is used for the "+ Today" affordance copy when only tomorrow is on. */
  todayCount: number;
  /** Count of tomorrow rows actually visible — drives the chip and the
   *  "+ Tomorrow" affordance copy when only today is on. */
  tomorrowCount: number;
  /** Total count for non-today/tomorrow filters (soon, stuck). */
  count: number;
  /** Apply a new filter mode in place. Pass `null` to clear. */
  onSetFilter: (next: ExpiringFilter) => void;
}) {
  // Soon / Stuck — one chip, no add-other affordance.
  if (filter === "soon" || filter === "stuck") {
    return (
      <div className="flex items-center gap-2 flex-wrap" data-testid="expiring-filter-chip">
        <span className="text-xs text-muted-foreground">Showing:</span>
        <FilterChipPill
          tone="amber"
          testid={filter === "stuck" ? "expiring-filter-chip-stuck" : "expiring-filter-chip-soon"}
          label={
            filter === "stuck"
              ? `Stuck after submission (${count})`
              : `Due within 3 days (${count})`
          }
          clearLabel="Clear filter"
          onClear={() => onSetFilter(null)}
        />
        <button
          type="button"
          onClick={() => onSetFilter(null)}
          className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          Clear filter
        </button>
      </div>
    );
  }

  // Today / Tomorrow / both — multi-chip rendering with per-side
  // clear buttons and a single-click affordance to add the other side.
  const showToday = filter === "urgent" || filter === "today-tomorrow";
  const showTomorrow = filter === "tomorrow" || filter === "today-tomorrow";
  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="expiring-filter-chip">
      <span className="text-xs text-muted-foreground">Showing:</span>
      {showToday && (
        <FilterChipPill
          tone="red"
          testid="expiring-filter-chip-today"
          label={`Today (${todayCount})`}
          clearLabel="Remove Today filter"
          // Clearing "Today" while Tomorrow is also active drops to
          // tomorrow-only; clearing it when it's the only active side
          // clears the filter entirely.
          onClear={() => onSetFilter(filter === "today-tomorrow" ? "tomorrow" : null)}
        />
      )}
      {showTomorrow && (
        <FilterChipPill
          tone="amber"
          testid="expiring-filter-chip-tomorrow"
          label={`Tomorrow (${tomorrowCount})`}
          clearLabel="Remove Tomorrow filter"
          onClear={() => onSetFilter(filter === "today-tomorrow" ? "urgent" : null)}
        />
      )}
      {filter === "urgent" && (
        <button
          type="button"
          data-testid="expiring-filter-add-tomorrow"
          onClick={() => onSetFilter("today-tomorrow")}
          className="text-xs font-medium underline-offset-2 hover:underline"
          style={{ color: "hsl(var(--cc-amber-fg))" }}
        >
          + Tomorrow
        </button>
      )}
      {filter === "tomorrow" && (
        <button
          type="button"
          data-testid="expiring-filter-add-today"
          onClick={() => onSetFilter("today-tomorrow")}
          className="text-xs font-medium underline-offset-2 hover:underline"
          style={{ color: "hsl(var(--cc-red-fg))" }}
        >
          + Today
        </button>
      )}
      <button
        type="button"
        data-testid="expiring-filter-chip-clear"
        onClick={() => onSetFilter(null)}
        className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
      >
        Clear filter
      </button>
    </div>
  );
}

/**
 * On-clock tab badge with optional urgent split.
 *
 * - No filter      → "<total>" + red "<N> urgent" pill (when applicable).
 * - ?expiring=urgent → just the red urgent count (totals would lie since
 *   the filter is hiding non-urgent rows).
 * - ?expiring=soon → just the amber soon count for this lane (urgent
 *   pill would mismatch — soon rows are non-urgent by definition).
 */
function TabBadgeSplit({
  total,
  urgent,
  matching,
  filterMode,
  testid,
}: {
  total: number;
  urgent: number;
  /** Count of rows in this lane that match the active filter mode —
   *  used for soon / tomorrow / today-tomorrow badges. */
  matching: number;
  filterMode: ExpiringFilter;
  testid?: string;
}) {
  const badge = formatTabBadge(total, urgent, filterMode, matching);
  if (
    !badge.total &&
    !badge.urgent &&
    !badge.soon &&
    !badge.tomorrow &&
    !badge.todayTomorrow
  )
    return null;
  return (
    <span className="ml-2 inline-flex items-center gap-1" data-testid={testid}>
      {badge.total != null && (
        <Badge variant="secondary" data-testid={testid ? `${testid}-total` : undefined}>
          {badge.total}
        </Badge>
      )}
      {badge.urgent != null && (
        <Badge
          variant="outline"
          data-testid={testid ? `${testid}-urgent` : undefined}
          style={{
            background: "hsl(var(--cc-red-bg))",
            borderColor: "hsl(var(--cc-red-border))",
            color: "hsl(var(--destructive))",
            fontWeight: 700,
          }}
        >
          {badge.urgent}
        </Badge>
      )}
      {badge.soon != null && (
        <Badge
          variant="outline"
          data-testid={testid ? `${testid}-soon` : undefined}
          style={{
            background: "hsl(var(--cc-amber-bg))",
            borderColor: "hsl(var(--cc-amber-border))",
            color: "hsl(var(--cc-amber-fg))",
            fontWeight: 700,
            opacity: 0.85,
          }}
        >
          {badge.soon}
        </Badge>
      )}
      {badge.tomorrow != null && (
        <Badge
          variant="outline"
          data-testid={testid ? `${testid}-tomorrow` : undefined}
          style={{
            background: "hsl(var(--cc-amber-bg))",
            borderColor: "hsl(var(--cc-amber-border))",
            color: "hsl(var(--cc-amber-fg))",
            fontWeight: 700,
          }}
        >
          {badge.tomorrow}
        </Badge>
      )}
      {badge.todayTomorrow != null && (
        <Badge
          variant="outline"
          data-testid={testid ? `${testid}-today-tomorrow` : undefined}
          style={{
            background: "hsl(var(--cc-amber-bg))",
            borderColor: "hsl(var(--cc-red-border))",
            color: "hsl(var(--destructive))",
            fontWeight: 700,
          }}
        >
          {badge.todayTomorrow}
        </Badge>
      )}
    </span>
  );
}

/**
 * Per-tab empty state for the Queue lanes. Wraps the shared
 * `EmptyState` component so the Queue feels consistent with the rest
 * of the app (claims/groups list pages). Copy is tab-specific:
 *  - actionable   → celebratory ("you're all caught up")
 *  - portal-queued → neutral ("nothing staged for the bots")
 *  - on-hold      → neutral ("nothing parked right now")
 * When an `?expiring=` filter is active we instead render a neutral
 * "no rows match this filter" state with a Clear-filter action,
 * reusing the centralised `emptyStateCopy` text so the operator
 * understands which slice they're looking at.
 */
function QueueTabEmptyState({
  lane,
  filter,
}: {
  lane: "actionable" | "mas-action-required" | "portal-queued" | "on-hold";
  filter: ExpiringFilter;
}) {
  const { set } = useUrlParams();
  const testid = `queue-empty-${lane}`;

  if (filter !== null) {
    return (
      <div data-testid={testid} data-empty-variant="filtered">
        <EmptyState
          icon={Filter}
          title="No groups match this filter"
          description={emptyStateCopy(lane, filter)}
          primaryAction={{
            label: "Clear filter",
            variant: "outline",
            onClick: () => set({ expiring: null }, false),
          }}
        />
      </div>
    );
  }

  let icon: LucideIcon;
  let title: string;
  let description: string;
  if (lane === "actionable") {
    icon = CheckCircle2;
    title = "You're all caught up";
    description = "Nothing in Action Required needs your attention right now. Enjoy the calm.";
  } else if (lane === "portal-queued") {
    icon = Inbox;
    title = "Nothing staged for the bots";
    description = "Drafts ready for portal submission will appear here when they're queued.";
  } else {
    icon = PauseCircle;
    title = "Nothing parked on hold";
    description = "Groups you manually pause or that get blocked will show up here.";
  }

  return (
    <div data-testid={testid} data-empty-variant="default">
      <EmptyState icon={icon} title={title} description={description} />
    </div>
  );
}

export default function Queue() {
  useInvoiceGroupsListEvents();
  const queryClient = useQueryClient();
  const { get, set } = useUrlParams();

  const tabParam = get("tab");
  // "Needs engagement" toggle — defaults to `needs`. When pressed, the
  // Portal Queued and On Hold lanes are hidden from the tab strip
  // (those are managed/parked, not engagement-needed). Operator must
  // press "All" to widen back. Same URL param shape as Claims and
  // Invoice Groups so a single toggle in the URL flows everywhere.
  const engagementMode = readEngagementMode(get("engagement"));
  const VISIBLE_TABS: readonly QueueTab[] =
    engagementMode === "needs"
      ? (["actionable", "mas-action-required"] as const)
      : VALID_TABS;
  const rawTab: QueueTab = (VALID_TABS as readonly string[]).includes(tabParam)
    ? (tabParam as QueueTab)
    : DEFAULT_TAB;
  // If engagement filter hides the requested tab, fall back to the
  // default actionable lane so the operator never lands on a tab
  // that the filter strip is hiding.
  const activeTab: QueueTab = (VISIBLE_TABS as readonly string[]).includes(rawTab)
    ? rawTab
    : DEFAULT_TAB;

  // `?expiring=urgent|soon` is the link payload from the Dashboard's
  // "File today" hero (urgent) and "+ N in next 3 days" footer (soon).
  // Anything else collapses to null so a stale share link can't pin the
  // queue to a state that no longer exists.
  const expiringFilter: ExpiringFilter = parseExpiringParam(get("expiring"));
  const setExpiringFilter = (next: ExpiringFilter) =>
    set({ expiring: next == null ? null : next }, false);
  const clearExpiringFilter = () => setExpiringFilter(null);

  // URL-persisted: which workflow group is open in the inline workspace,
  // whether the Classification Inbox is expanded, and which triage row's
  // modal is open. `?triage=<id>` mirrors `?group=` so a refresh, hot
  // reload, or shared link reopens the triage modal on the same inbox
  // row instead of dropping the operator back to the list.
  const groupParam = Number.parseInt(get("group"), 10);
  const selectedWorkflowId: number | null = Number.isFinite(groupParam) && groupParam > 0 ? groupParam : null;
  const inboxOpen = get("inbox") === "open";
  const triageParam = Number.parseInt(get("triage"), 10);
  const selectedTriageId: number | null =
    Number.isFinite(triageParam) && triageParam > 0 ? triageParam : null;

  const [successMessage, setSuccessMessage] = useState("");

  // Per-tab search state. Each tab keeps its own term so switching
  // tabs doesn't surprise the operator with a stale filter applied
  // somewhere they can't see. Matches invoice number, client number,
  // and error type name (consistent with the Invoice Groups list).
  // Persisted via the URL (`?qActionable=…`, `?qPortalQueued=…`,
  // `?qOnHold=…`) so refreshing the page or sharing the link restores
  // the same filtered view — consistent with the other Queue filters
  // (tab, urgency, engagement, past-deadline) which all round-trip
  // through the URL.
  const searchActionable = get("qActionable");
  const searchMasAction = get("qMasAction");
  const searchPortalQueued = get("qPortalQueued");
  const searchOnHold = get("qOnHold");
  const setSearchActionable = (value: string) => {
    set({ qActionable: value === "" ? null : value }, false);
  };
  const setSearchMasAction = (value: string) => {
    set({ qMasAction: value === "" ? null : value }, false);
  };
  const setSearchPortalQueued = (value: string) => {
    set({ qPortalQueued: value === "" ? null : value }, false);
  };
  const setSearchOnHold = (value: string) => {
    set({ qOnHold: value === "" ? null : value }, false);
  };

  useInvoiceGroupEvents(selectedWorkflowId ?? undefined);
  // Presence is intentionally informational-only: the `viewers` array
  // feeds the HumanPresenceBanner so an operator can see who else is
  // looking at the group, but presence NEVER disables any control. The
  // previous "lock everything when another viewer is present" behavior
  // caused mutual deadlocks (each viewer locked the other out, neither
  // could advance the invoice) and was scrapped in favor of a soft
  // visual badge. See HumanPresenceBanner copy for the user-facing
  // wording. The downstream gauntlet / leg row / claim detail no
  // longer accept a `lockReason` prop at all — phase guards and
  // resolution checks are now the only things that disable controls.
  const { viewers } = usePresence("invoice_group", selectedWorkflowId ?? undefined);

  const workflowPanelRef = useRef<HTMLDivElement>(null);

  const setSelectedWorkflowId = (id: number | null) => {
    set({ group: id == null ? null : String(id) }, false);
  };
  const setInboxOpen = (open: boolean) => {
    set({ inbox: open ? "open" : null }, false);
  };
  const setSelectedTriageId = (id: number | null) => {
    set({ triage: id == null ? null : String(id) }, false);
  };

  const selectWorkflow = (id: number) => {
    setSelectedWorkflowId(id);
    window.requestAnimationFrame(() => {
      workflowPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  // Triage selection drives a modal dialog (see ClassificationInbox +
  // Dialog below). No scroll-into-view needed — the dialog pops up
  // centered over the page and the inbox stays put behind it.
  const selectTriage = (id: number) => {
    setSelectedTriageId(id);
  };

  const handleTabChange = (value: string) => {
    setSuccessMessage("");
    // Selection is intentionally preserved across tab changes — the
    // operator may want to keep a workspace open while quickly checking
    // counts in another tab. URL-backed `?group=` is the source of truth.
    if (value === DEFAULT_TAB) {
      set({ tab: null }, false);
    } else {
      set({ tab: value }, false);
    }
  };

  // Bumped limits so the visible list isn't capped while a real total is
  // available — the tab/section badges use server `total`, not array length.
  //
  // `refetchOnWindowFocus: true` is scoped here (the global QueryClient
  // disables it by default) so the Queue can never drift from the
  // Dashboard the way it did before Task #290 — when an operator left
  // the Queue open, hit lunch, and returned after the deadline tipped,
  // cached rows kept yesterday's `isUrgent: false` while the Dashboard
  // (freshly fetched on its own mount) showed the new urgent count.
  // Refetching on focus + on day rollover (see effect below) keeps both
  // surfaces in sync without a manual refresh.
  // Push the active deadline filter into each lane query so `data.total`
  // is the authoritative count of filter-matching rows. `urgent`/`stuck`
  // intentionally include past-deadline rows so they additionally need
  // `includeExpired: true` to bypass the default past-deadline guard;
  // `soon` does not (its SQL is strictly future). The "Show past-deadline"
  // toggle below also flips `includeExpired` regardless of filter mode.
  // Server-side narrowing only applies to filters the API understands
  // (urgent / soon / stuck). The Task #452 modes (tomorrow,
  // today-tomorrow) are derived from `isUrgent` / `effectiveDaysLeft`
  // alone, so we leave the lane queries unfiltered server-side and
  // narrow client-side via `filterByExpiringParam` below.
  const expiringForLanes: "urgent" | "soon" | "stuck" | undefined =
    expiringFilter === "urgent" ||
    expiringFilter === "soon" ||
    expiringFilter === "stuck"
      ? expiringFilter
      : undefined;
  const showPastDeadline = get("showPastDeadline") === "true";
  // `today-tomorrow` includes urgent rows (which can be past-due), so
  // tell the server to surface past-deadline rows too — otherwise the
  // combined view would silently drop rows the operator just clicked
  // through from the Dashboard.
  const includeExpiredForLanes =
    showPastDeadline ||
    expiringFilter === "urgent" ||
    expiringFilter === "stuck" ||
    expiringFilter === "today-tomorrow"
      ? true
      : undefined;
  const newParams = { status: "New", limit: 500, expiring: expiringForLanes, includeExpired: includeExpiredForLanes } as const;
  const needsEvidenceParams = { status: "Needs Evidence", limit: 500, expiring: expiringForLanes, includeExpired: includeExpiredForLanes } as const;
  // `Generating Email` is a real, pre-submit, on-clock invoice-group
  // status. The dedicated package CTA was retired — the submission
  // gauntlet's preview/submit path is now the only writer that flips a
  // group into this status. Existing groups parked here pre-cutover (or
  // the rare future writer) still need to fold into Action Required so
  // the Dashboard can never count an urgent group the operator has
  // nowhere to act on.
  const generatingEmailParams = { status: "Generating Email", limit: 500, expiring: expiringForLanes, includeExpired: includeExpiredForLanes } as const;
  const portalQueuedParams = { status: "Portal Queued", limit: 500, expiring: expiringForLanes, includeExpired: includeExpiredForLanes } as const;
  const onHoldParams = { status: "On Hold", limit: 500, expiring: expiringForLanes, includeExpired: includeExpiredForLanes } as const;
  const newQuery = useListInvoiceGroups(newParams, {
    query: { queryKey: getListInvoiceGroupsQueryKey(newParams), refetchOnWindowFocus: true },
  });
  const needsEvidenceQuery = useListInvoiceGroups(needsEvidenceParams, {
    query: { queryKey: getListInvoiceGroupsQueryKey(needsEvidenceParams), refetchOnWindowFocus: true },
  });
  const generatingEmailQuery = useListInvoiceGroups(generatingEmailParams, {
    query: { queryKey: getListInvoiceGroupsQueryKey(generatingEmailParams), refetchOnWindowFocus: true },
  });
  const portalQueuedQuery = useListInvoiceGroups(portalQueuedParams, {
    query: { queryKey: getListInvoiceGroupsQueryKey(portalQueuedParams), refetchOnWindowFocus: true },
  });
  const onHoldQuery = useListInvoiceGroups(onHoldParams, {
    query: { queryKey: getListInvoiceGroupsQueryKey(onHoldParams), refetchOnWindowFocus: true },
  });
  // Task #559 — dedicated MAS Action Required lane. Driven by the
  // shared `macroPhase=mas-action-required` server filter so the lane,
  // the Dashboard tile, the sidebar badge, and the Invoice Groups
  // filter all read from the same `buildMacroPhaseCondition` source
  // and can never disagree about who's in the bucket.
  const masActionParams = {
    macroPhase: "mas-action-required",
    limit: 500,
    expiring: expiringForLanes,
    includeExpired: includeExpiredForLanes,
  } as const;
  const masActionQuery = useListInvoiceGroups(masActionParams, {
    query: { queryKey: getListInvoiceGroupsQueryKey(masActionParams), refetchOnWindowFocus: true },
  });

  const newGroups = newQuery.data?.groups || [];
  const needsGroups = needsEvidenceQuery.data?.groups || [];
  const generatingEmailGroups = generatingEmailQuery.data?.groups || [];
  const portalQueuedGroups = portalQueuedQuery.data?.groups || [];
  const onHoldGroups = onHoldQuery.data?.groups || [];
  const masActionGroups = masActionQuery.data?.groups || [];

  const actionableTotal =
    (newQuery.data?.total ?? 0) +
    (needsEvidenceQuery.data?.total ?? 0) +
    (generatingEmailQuery.data?.total ?? 0);
  const portalQueuedTotal = portalQueuedQuery.data?.total ?? 0;
  const onHoldTotal = onHoldQuery.data?.total ?? 0;
  const masActionTotal = masActionQuery.data?.total ?? 0;
  // Task #559 — the lane header count is sourced from the shared
  // `/macro-phase/rollup` endpoint so it agrees byte-for-byte with the
  // sidebar badge and Dashboard tile. The lane query above still
  // drives the rendered list (it carries the urgency/expired filter
  // params), but the chip in the tab header is a strict mirror of the
  // rollup so cross-surface counts can't drift.
  const macroPhaseRollupQuery = useGetMacroPhaseRollup({
    query: {
      queryKey: getGetMacroPhaseRollupQueryKey(),
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
    },
  });
  const masActionRollupTotal =
    macroPhaseRollupQuery.data?.counts?.masActionRequired ?? masActionTotal;

  // Classification Inbox: piggybacks on `GET /invoice-groups` via
  // `?include=needs_classification`. We pass a tiny status filter
  // (`Needs Review`) and `limit=0` because we only care about the
  // embedded `needsClassificationInbox` payload — not the list itself.
  // Single round trip, single query key, no fork between counts and
  // payload. Same focus-refetch treatment as the lane queries — the
  // Needs Review inbox sits on the same page and the operator expects
  // it to stay current after a tab refocus.
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
  // Task #419 — per-status group count, surfaced under the inbox total.
  // The server returns entries pre-sorted (desc count, then status name
  // asc) so we just iterate Object.entries in order.
  const inboxByStatus: Record<string, number> =
    inboxQuery.data?.needsClassificationInbox?.byStatus ?? {};

  // Within each on-clock list, sort urgent rows to the top, then by remaining
  // days asc. The API already returns rows in service-date asc order, which is
  // the right baseline; this just biases urgent items above stale-but-not-due
  // ones in the same view.
  const sortByUrgency = (rows: InvoiceGroupResponse[]) =>
    [...rows].sort((a, b) => {
      const aUrgent = a.isUrgent ? 1 : 0;
      const bUrgent = b.isUrgent ? 1 : 0;
      if (aUrgent !== bUrgent) return bUrgent - aUrgent;
      const aDays = a.effectiveDaysLeft ?? Number.POSITIVE_INFINITY;
      const bDays = b.effectiveDaysLeft ?? Number.POSITIVE_INFINITY;
      return aDays - bDays;
    });

  // Unfiltered, sorted lists drive the urgent split badges (so the
  // "62 urgent" hint still reflects reality even when the operator has
  // narrowed the visible set with `?expiring=`).
  //
  // Action Required = New ∪ Needs Evidence ∪ Generating Email — every
  // pre-submit, on-clock group lands here so the Dashboard's "must file
  // today" hero count and the Queue's `?expiring=urgent` view can never
  // disagree about what's actionable. (See dashboard.ts comment.)
  const actionableAll = sortByUrgency([
    ...newGroups,
    ...needsGroups,
    ...generatingEmailGroups,
  ]);
  const portalQueuedAll = sortByUrgency(portalQueuedGroups);
  const onHoldAll = sortByUrgency(onHoldGroups);
  const masActionAll = sortByUrgency(masActionGroups);

  // Past-deadline rows + `?expiring=` filtering are server-side for the
  // urgent / soon / stuck modes (the API understands those tokens). The
  // Task #452 modes (`tomorrow`, `today-tomorrow`) are narrowed
  // client-side via `filterByExpiringParam` so the visible list, the
  // chip count, the tab badges, and the empty-state copy all reflect
  // the same set of rows.
  const needsClientFilter =
    expiringFilter === "tomorrow" || expiringFilter === "today-tomorrow";
  const actionableGroups = needsClientFilter
    ? filterByExpiringParam(actionableAll, expiringFilter)
    : actionableAll;
  const portalQueuedSorted = needsClientFilter
    ? filterByExpiringParam(portalQueuedAll, expiringFilter)
    : portalQueuedAll;
  const onHoldSorted = needsClientFilter
    ? filterByExpiringParam(onHoldAll, expiringFilter)
    : onHoldAll;
  const masActionSorted = needsClientFilter
    ? filterByExpiringParam(masActionAll, expiringFilter)
    : masActionAll;

  // Client-side search overlay — narrows the already-filtered lane
  // sets (urgency / engagement / past-deadline filters stay upstream).
  // Matches invoice number, client number, and error type name,
  // case-insensitive substring (consistent with the Invoice Groups
  // list page's search).
  const matchesSearch = (g: InvoiceGroupResponse, query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const haystacks = [g.invoiceNumber, g.clientNumber, g.errorTypeName];
    return haystacks.some(
      (v) => typeof v === "string" && v.toLowerCase().includes(q),
    );
  };
  const actionableVisible = useMemo(
    () => actionableGroups.filter((g) => matchesSearch(g, searchActionable)),
    [actionableGroups, searchActionable],
  );
  const portalQueuedVisible = useMemo(
    () => portalQueuedSorted.filter((g) => matchesSearch(g, searchPortalQueued)),
    [portalQueuedSorted, searchPortalQueued],
  );
  const onHoldVisible = useMemo(
    () => onHoldSorted.filter((g) => matchesSearch(g, searchOnHold)),
    [onHoldSorted, searchOnHold],
  );
  const masActionVisible = useMemo(
    () => masActionSorted.filter((g) => matchesSearch(g, searchMasAction)),
    [masActionSorted, searchMasAction],
  );

  // Task #490 — soften row removal across the three lanes. Each lane
  // tracks its own settling ghosts so a completion in Action Required
  // doesn't ripple into Portal Queued / On Hold. The hook keys off
  // `selectedWorkflowId` (the URL `?group=` param) — when the
  // previously-selected row leaves a lane the row holds its slot for
  // ~360ms while the success-tint settle plays, then unmounts.
  const actionableSettle = useRowSettle(
    actionableVisible,
    (g) => g.id,
    selectedWorkflowId,
  );
  const portalQueuedSettle = useRowSettle(
    portalQueuedVisible,
    (g) => g.id,
    selectedWorkflowId,
  );
  const onHoldSettle = useRowSettle(
    onHoldVisible,
    (g) => g.id,
    selectedWorkflowId,
  );
  const masActionSettle = useRowSettle(
    masActionVisible,
    (g) => g.id,
    selectedWorkflowId,
  );

  // Lane urgent / stuck / soon counts. When an `?expiring=` filter is
  // active and the API understands it, the lane is server-narrowed so
  // `data.total` IS the filter-matching count. With no filter (or with
  // a Task #452 client-only mode), urgent/stuck splits derive from the
  // array (within the existing `limit: 500` ceiling).
  const actionableUrgent = expiringFilter === "urgent"
    ? actionableTotal
    : actionableAll.filter(g => g.isUrgent).length;
  const portalQueuedUrgent = expiringFilter === "urgent"
    ? portalQueuedTotal
    : portalQueuedAll.filter(g => g.isUrgent).length;
  const onHoldUrgent = expiringFilter === "urgent"
    ? onHoldTotal
    : onHoldAll.filter(g => g.isUrgent).length;
  const masActionUrgent = expiringFilter === "urgent"
    ? masActionTotal
    : masActionAll.filter(g => g.isUrgent).length;
  // Hero count: filing-clock counter, mirrors the Dashboard's
  // "must file today" hero. Portal Queued is intentionally EXCLUDED
  // because the filing clock is satisfied the moment a group is
  // packaged into Portal Queued — Portal Queued rows whose deadline
  // then slips are surfaced separately as `stuckCount`. Without this
  // exclusion the Queue would keep counting submitted-but-unconfirmed
  // groups while the Dashboard had already dropped them, and the two
  // surfaces would disagree until the external portal acknowledged
  // the submission. See `GROUP_EXPIRING_ACTIONABLE_STATUSES` on the
  // server (which the Dashboard hero uses) — it is exactly
  // `{ New, Needs Evidence, Generating Email, On Hold }`.
  //
  // Under `?expiring=urgent` the lane queries are server-narrowed,
  // so the sum of Action Required + On Hold totals IS the urgent
  // count; otherwise delegate to the shared helper.
  const urgentCount = expiringFilter === "urgent"
    ? actionableTotal + onHoldTotal
    : computeAggregateUrgentCount(actionableAll, onHoldAll);

  // Task #352 — "Stuck after submission" count. Only Portal Queued
  // can carry `submittedStuck=true`.
  const stuckCount = expiringFilter === "stuck"
    ? portalQueuedTotal
    : portalQueuedAll.filter(g => g.submittedStuck).length;

  // Per-lane filter-matching counts that drive the tab badges. For
  // server-narrowed modes (soon) this is just the lane total; for the
  // Task #452 client-side modes (tomorrow, today-tomorrow) we count
  // the post-filter array.
  const actionableMatchingCount =
    expiringFilter === "soon"
      ? actionableTotal
      : needsClientFilter
        ? actionableGroups.length
        : 0;
  const portalQueuedMatchingCount =
    expiringFilter === "soon"
      ? portalQueuedTotal
      : needsClientFilter
        ? portalQueuedSorted.length
        : 0;
  const onHoldMatchingCount =
    expiringFilter === "soon"
      ? onHoldTotal
      : needsClientFilter
        ? onHoldSorted.length
        : 0;
  const masActionMatchingCount =
    expiringFilter === "soon"
      ? masActionTotal
      : needsClientFilter
        ? masActionSorted.length
        : 0;

  // Sum of authoritative server totals so the visible-set chip never
  // undercounts when a lane has more matches than the 500-row payload.
  // For the client-side modes we sum the filtered arrays instead.
  const visibleFilteredCount = needsClientFilter
    ? actionableMatchingCount + masActionMatchingCount + portalQueuedMatchingCount + onHoldMatchingCount
    : actionableTotal + masActionTotal + portalQueuedTotal + onHoldTotal;

  // Today / Tomorrow split for the hero and the multi-chip filter UI
  // under today-tomorrow / tomorrow / urgent. Portal Queued is excluded
  // for the same reason as `urgentCount` above: the filing clock is
  // satisfied at Portal Queued, so a packaged group should drop out of
  // the today/tomorrow numbers immediately, matching the Dashboard's
  // "File today or tomorrow" hero. The Portal Queued tab badge keeps
  // its own counts so an operator working that lane still sees what's
  // slipping there.
  const filterTodayCount =
    expiringFilter === "urgent"
      ? actionableTotal + onHoldTotal
      : countUrgentRows(actionableGroups, onHoldSorted);
  const filterTomorrowCount =
    expiringFilter === "tomorrow"
      ? actionableMatchingCount + onHoldMatchingCount
      : [actionableGroups, onHoldSorted]
          .flat()
          .filter(g => !g.isUrgent && g.effectiveDaysLeft === 1).length;

  const allGroups = [
    ...actionableAll,
    ...masActionAll,
    ...portalQueuedAll,
    ...onHoldAll,
  ];
  const selectedWorkflowGroupSummary = selectedWorkflowId
    ? allGroups.find(g => g.id === selectedWorkflowId) || null
    : null;

  // No auto-selection on the queue page. The operator decides which invoice
  // to open by clicking a row — even when only one candidate exists. Selection
  // is still URL-driven, so a deep link with `?group=<id>` opens that row;
  // bare `/queue` lands in the empty state.

  useEffect(() => {
    if (!successMessage) return;
    const t = setTimeout(() => setSuccessMessage(""), 4000);
    return () => clearTimeout(t);
  }, [successMessage]);

  // Drop a stale `?triage=<id>` if the inbox no longer surfaces that
  // group — same posture as the other URL-derived filters: a shared
  // link or refresh that points at something gone falls back to the
  // empty state instead of pinning a phantom modal open. Gated on the
  // inbox query actually returning data so the param survives the
  // initial load when the modal is reopened from the URL.
  useEffect(() => {
    if (!inboxQuery.data) return;
    if (selectedTriageId && !inboxGroups.some(g => g.id === selectedTriageId)) {
      setSelectedTriageId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTriageId, inboxGroups, inboxQuery.data]);

  const invalidate = () => {
    // Single key — both the workflow tabs and the embedded inbox live
    // under `getListInvoiceGroupsQueryKey()` now that the inbox rides on
    // the `?include=needs_classification` payload.
    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
  };

  // Day-rollover invalidator (Task #294, replaces Task #290's local
  // midnight `setTimeout`). The server embeds a `today` key on every
  // deadline-driven response; when the value changes vs. the previously-
  // seen one, `useServerDayRolloverInvalidator` invalidates every
  // deadline-driven query family (lane queries, dashboard summary) so
  // the per-row `isUrgent` / `effectiveDaysLeft` flags refresh against
  // the new "today". No client clock involved — the focus refetch on
  // these queries is what surfaces the new server `today` in the first
  // place, which then cascades the invalidation. We pick the *latest*
  // `today` across every lane (not just the first non-null one) so that
  // if any single lane has already seen the new day — e.g. one lane
  // refetched on focus while another is still serving yesterday's
  // cached payload — we react immediately rather than waiting for the
  // preferred-order lane to catch up.
  const serverToday = latestTodayKey(
    newQuery.data?.today,
    needsEvidenceQuery.data?.today,
    generatingEmailQuery.data?.today,
    portalQueuedQuery.data?.today,
    onHoldQuery.data?.today,
    inboxQuery.data?.today,
  );
  useServerDayRolloverInvalidator(serverToday);

  // Per-row deadline pill — renders for *every* on-clock row that has
  // an `effectiveDaysLeft`, including rows past a week. Before Task #274
  // anything beyond the 7-day window rendered nothing, so the legend
  // promised tiers the operator never saw. Tier styling lines up
  // exactly with the legend wording on the Action Required tab.
  const renderDeadlineHint = (group: InvoiceGroupResponse) => {
    const labelInfo = formatDeadlineLabel(group);
    if (!labelInfo) return null;
    // Task #452 — red is reserved for today / overdue ("must file
    // before EOD"). Tomorrow gets the strong amber pill so it reads as
    // the most urgent of the yellows. The 2–3-day "soon" band keeps an
    // amber palette but at reduced opacity so it visibly steps down
    // from "tomorrow"; week / later stay in the muted band.
    const tierStyles: Record<DeadlineTier, React.CSSProperties> = {
      today: {
        background: "hsl(var(--destructive))",
        color: "white",
        borderColor: "hsl(var(--destructive))",
      },
      overdue: {
        background: "hsl(var(--destructive))",
        color: "white",
        borderColor: "hsl(var(--destructive))",
      },
      tomorrow: {
        background: "hsl(var(--cc-amber-bg))",
        color: "hsl(var(--cc-amber-fg))",
        borderColor: "hsl(var(--cc-amber-border))",
      },
      soon: {
        background: "hsl(var(--cc-amber-bg))",
        color: "hsl(var(--cc-amber-fg))",
        borderColor: "hsl(var(--cc-amber-border))",
        opacity: 0.7,
      },
      week: {
        background: "hsl(var(--muted))",
        color: "hsl(var(--muted-foreground))",
        borderColor: "transparent",
      },
      later: {
        background: "hsl(var(--muted))",
        color: "hsl(var(--muted-foreground))",
        borderColor: "transparent",
      },
    };
    return (
      <span
        data-testid={`deadline-hint-${group.invoiceNumber}`}
        data-tier={labelInfo.tier}
        className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap"
        style={tierStyles[labelInfo.tier]}
        title={labelInfo.tooltip}
      >
        {labelInfo.label}
      </span>
    );
  };

  const renderGroupRow = (
    group: InvoiceGroupResponse,
    opts: {
      onSelect: (id: number) => void;
      selectedId: number | null;
      showDeadline?: boolean;
      isSettling?: boolean;
      isJustSelected?: boolean;
    },
  ) => {
    const isSelected = opts.selectedId === group.id;
    const meta = group.errorTypeName ? (
      <span className="text-muted-foreground truncate min-w-0" title={group.errorTypeName}>
        {group.errorTypeName}
      </span>
    ) : null;
    // Urgent rows get the strong red row treatment: tinted background,
    // red left border, larger TODAY badge, currency in red. Non-urgent
    // rows that match an active deadline filter get a softer amber tint
    // so the filter context reads on the row itself, not just the chip.
    // Task #452 — under `tomorrow` / `today-tomorrow` we tint the day-1
    // rows in amber; under `soon` we keep the legacy 1..3 day tint.
    const days = group.effectiveDaysLeft;
    const isTomorrowRow = !group.isUrgent && days === 1;
    const isSoonBandRow =
      !group.isUrgent && days != null && days >= 1 && days <= 3;
    const tintAsTomorrow =
      isTomorrowRow &&
      (expiringFilter === "tomorrow" || expiringFilter === "today-tomorrow");
    const tintAsSoon = expiringFilter === "soon" && isSoonBandRow;
    let rowStyle: React.CSSProperties = {};
    if (group.isUrgent) {
      rowStyle = {
        background: "hsl(var(--cc-red-bg))",
        borderColor: "hsl(var(--cc-red-border))",
        borderLeftWidth: 4,
        borderLeftColor: "hsl(var(--destructive))",
      };
    } else if (tintAsTomorrow || tintAsSoon) {
      rowStyle = {
        background: "hsl(var(--cc-amber-bg))",
        borderColor: "hsl(var(--cc-amber-border))",
        borderLeftWidth: 4,
        borderLeftColor: "hsl(var(--cc-amber-fg))",
        // The 2–3-day band tints softer than the day-1 band so the
        // hierarchy of yellows reads correctly when both are visible.
        ...(tintAsSoon && !isTomorrowRow ? { opacity: 0.9 } : {}),
      };
    }
    return (
      <button
        key={group.id}
        type="button"
        data-testid={`queue-row-${group.invoiceNumber}`}
        data-urgent={group.isUrgent ? "true" : undefined}
        data-settling={opts.isSettling ? "true" : undefined}
        aria-pressed={isSelected}
        disabled={opts.isSettling}
        onClick={() => opts.onSelect(group.id)}
        style={rowStyle}
        className={`w-full text-left rounded-lg border bg-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          isSelected ? "ring-2 ring-primary border-primary" : "hover:bg-accent/50"
        } ${opts.isSettling ? "cc-row-settling" : ""} ${opts.isJustSelected ? "cc-row-just-selected" : ""}`}
      >
        {/*
          Two-row layout that gracefully wraps on narrow widths (Task #290).
          Before this change the left cluster used `shrink-0` against a
          `flex-1` right cluster, so on viewports around 375–430 px the
          status badge and the per-row deadline pill (the
          `renderDeadlineHint` output) silently disappeared off the right
          edge of the row. The fix is structural rather than a media
          query: each row is split into a top line that always wraps
          its own children (badge / invoice# / ride count / status / pill)
          and a bottom line that holds the error-type meta + currency +
          chevron. `min-w-0` on the inner clusters lets the truncating
          `meta` span actually truncate instead of forcing horizontal
          overflow that would push the pill out of view.
        */}
        <div className="py-3 px-6 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
            <div className="whitespace-nowrap flex items-center gap-2">
              <UrgentTodayBadge
                isUrgent={group.isUrgent}
                submittedStuck={group.submittedStuck}
                size={group.isUrgent || group.submittedStuck ? "md" : "sm"}
              />
              <RefNumber value={group.invoiceNumber} variant="inline" className="font-semibold" />
              <span className="text-muted-foreground ml-1 text-sm">{group.rideCount} ride{group.rideCount !== 1 ? "s" : ""}</span>
            </div>
            <StateBadge
              variant="phase"
              value={group.phase}
              tooltipExtra={`Status: ${group.status}`}
            />
            <PreSubmitBreakdown group={group} />
            {opts.showDeadline && renderDeadlineHint(group)}
          </div>
          <div className="flex items-center gap-4 text-sm min-w-0 justify-between">
            <div className="min-w-0 flex-1 truncate">{meta}</div>
            <div className="flex items-center gap-4 shrink-0">
              <HideForClerk>
                <span
                  className={`whitespace-nowrap ${group.isUrgent ? "font-bold" : "font-medium"}`}
                  style={group.isUrgent ? { color: "hsl(var(--destructive))" } : undefined}
                >
                  {formatCurrency(group.totalAmount)}
                </span>
              </HideForClerk>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </div>
          </div>
        </div>
      </button>
    );
  };

  // Inbox-zero (Task #493) — true when EVERY lane and the triage inbox
  // are loaded and empty, no deadline filter is active, and no per-tab
  // search is narrowing the list. Drives an exclusive empty-state
  // branch below: when true, the controls / classification inbox /
  // tabs / workspace block is replaced by a single "all caught up"
  // EmptyState card so the operator never stares at a wall of empty
  // tabs.
  const isInboxZero =
    !inboxQuery.isLoading &&
    !newQuery.isLoading &&
    !needsEvidenceQuery.isLoading &&
    !generatingEmailQuery.isLoading &&
    !portalQueuedQuery.isLoading &&
    !onHoldQuery.isLoading &&
    inboxTotal === 0 &&
    actionableTotal === 0 &&
    masActionTotal === 0 &&
    portalQueuedTotal === 0 &&
    onHoldTotal === 0 &&
    !masActionQuery.isLoading &&
    expiringFilter === null &&
    !searchActionable &&
    !searchMasAction &&
    !searchPortalQueued &&
    !searchOnHold;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">Invoice queue</h2>
        <p className="text-muted-foreground">
          Operator workspace. Triage every group with an unclassified leg in the <span className="font-medium">Classification Inbox</span> (across all statuses), then work the <span className="font-medium">Action Required</span> tab. Earliest service date first; red badges mark groups that must file today.
        </p>
      </div>

      <QueueUrgencyHero
        urgentCount={urgentCount}
        stuckCount={stuckCount}
        soonCount={visibleFilteredCount}
        tomorrowCount={filterTomorrowCount}
        filter={expiringFilter}
        onSelectUrgentGroup={selectWorkflow}
      />

      {isInboxZero ? (
        /* Inbox-zero (Task #493). When the page has truly nothing to do —
           no triage backlog, no actionable / portal-queued / on-hold rows,
           no active deadline filter, no search narrowing — replace the
           tabs/controls block entirely with a warm "all caught up"
           EmptyState so the operator never sees a wall of empty tabs.
           Per-tab empty states (Task #47) still cover the partial case
           where one tab happens to be empty while another holds work. */
        <Card data-testid="queue-inbox-zero">
          <CardContent className="p-0">
            <EmptyState
              icon={Sparkles}
              title="All caught up — nice work."
              description="The queue is empty. No triage backlog, nothing on the clock, nothing parked. Check back as new work imports."
              primaryAction={{
                label: "Refresh",
                variant: "outline",
                onClick: () =>
                  queryClient.invalidateQueries({
                    queryKey: getListInvoiceGroupsQueryKey(),
                  }),
              }}
              secondaryAction={{
                label: "View completed today",
                href: "/groups?completedToday=true",
                variant: "ghost",
              }}
              className="py-16"
            />
          </CardContent>
        </Card>
      ) : (
        <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          {expiringFilter && (
            <ExpiringFilterChip
              filter={expiringFilter}
              todayCount={filterTodayCount}
              tomorrowCount={filterTomorrowCount}
              count={visibleFilteredCount}
              onSetFilter={setExpiringFilter}
            />
          )}
        </div>
        <button
          type="button"
          onClick={() => set({ showPastDeadline: showPastDeadline ? null : "true" }, false)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          data-testid="queue-show-past-deadline-toggle"
        >
          {showPastDeadline ? "Hide past-deadline rows" : "Show past-deadline rows"}
        </button>
      </div>

      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-md px-4 py-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-800">{successMessage}</span>
        </div>
      )}

      {/* Classification Inbox — collapsible, claim-aware. Defaults
          collapsed because most days nothing imports; expanded state is
          URL-persisted (?inbox=open) so a refresh keeps it open while
          someone's actively working through it. The triage workspace
          itself opens in a modal dialog (below) so the inbox list stays
          in place when a row is picked. */}
      <ClassificationInbox
        open={inboxOpen}
        onToggle={() => setInboxOpen(!inboxOpen)}
        loading={inboxQuery.isLoading}
        groups={inboxGroups}
        total={inboxTotal}
        byStatus={inboxByStatus}
        selectedId={selectedTriageId}
        onSelect={selectTriage}
      />

      {/* Task #412: Triage workspace now uses the shared
          ClassifyDialog so the queue, leg-row Classify button, and
          claim-detail "Classify this leg" / "Change" all open the
          exact same modal (with the persistent instruction banner +
          identical UX). Selection is still URL-persisted via
          `?triage=<id>` — the dialog opens whenever the URL holds a
          triage id and clears the param when closed. */}
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

      <div className={`grid grid-cols-1 gap-6 ${selectedWorkflowId ? "lg:grid-cols-3" : ""}`}>
        <div className={`space-y-4 ${selectedWorkflowId ? "lg:col-span-1" : ""}`}>
          <div className="flex flex-wrap items-center gap-3 mb-3" data-tour="queue-engagement-strip">
            <NeedsEngagementToggle
              mode={engagementMode}
              onChange={(next) => set({ engagement: next === "needs" ? null : "all", tab: null }, false)}
              testidPrefix="engagement-toggle-queue"
            />
            {engagementMode === "needs" && (
              <span className="text-xs text-muted-foreground" data-testid="engagement-hint-queue">
                Portal Queued &amp; On Hold lanes hidden — press <span className="font-medium text-foreground">All</span> to show them. MAS Action Required stays visible because those groups still need engagement.
              </span>
            )}
          </div>
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="max-w-full overflow-x-auto">
              <TabsTrigger value="actionable" data-testid="tab-actionable" data-tour="queue-tab-actionable">
                Action Required
                <TabBadgeSplit
                  total={actionableTotal}
                  urgent={actionableUrgent}
                  matching={actionableMatchingCount}
                  filterMode={expiringFilter}
                  testid="tab-badge-actionable"
                />
              </TabsTrigger>
              {(VISIBLE_TABS as readonly string[]).includes("mas-action-required") && (
                <TabsTrigger value="mas-action-required" data-testid="tab-mas-action-required">
                  {macroPhaseLabel("mas-action-required")}
                  <TabBadgeSplit
                    total={masActionRollupTotal}
                    urgent={masActionUrgent}
                    matching={masActionMatchingCount}
                    filterMode={expiringFilter}
                    testid="tab-badge-mas-action-required"
                  />
                </TabsTrigger>
              )}
              {(VISIBLE_TABS as readonly string[]).includes("portal-queued") && (
                <TabsTrigger value="portal-queued" data-testid="tab-portal-queued">
                  Portal Queued
                  <TabBadgeSplit
                    total={portalQueuedTotal}
                    urgent={portalQueuedUrgent}
                    matching={portalQueuedMatchingCount}
                    filterMode={expiringFilter}
                    testid="tab-badge-portal-queued"
                  />
                </TabsTrigger>
              )}
              {(VISIBLE_TABS as readonly string[]).includes("on-hold") && (
                <TabsTrigger value="on-hold" data-testid="tab-on-hold">
                  On Hold
                  <TabBadgeSplit
                    total={onHoldTotal}
                    urgent={onHoldUrgent}
                    matching={onHoldMatchingCount}
                    filterMode={expiringFilter}
                    testid="tab-badge-on-hold"
                  />
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="actionable" className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground" data-testid="tab-purpose-actionable">
                <span className="font-medium text-foreground">New + Needs Evidence + Generating Email.</span> Pre-submit groups you can act on right now. Sorted earliest service date first.{" "}
                <span className="font-semibold" style={{ color: "hsl(var(--destructive))" }}>Today</span> = must file before EOD,{" "}
                <span className="font-semibold" style={{ color: "hsl(var(--cc-amber-fg))" }}>Tomorrow</span> = day-1,{" "}
                <span className="font-semibold" style={{ color: "hsl(var(--cc-amber-fg))", opacity: 0.7 }}>≤3d</span> = 2–3 days out,{" "}
                <span className="font-semibold text-muted-foreground">≤7d</span> = within a week, neutral = anything past a week. Every row shows its tier.
              </p>
              {actionableGroups.length === 0 ? (
                <Card>
                  <CardContent className="py-6">
                    <QueueTabEmptyState lane="actionable" filter={expiringFilter} />
                  </CardContent>
                </Card>
              ) : (
                <>
                  <ListTableHeaderStrip
                    searchValue={searchActionable}
                    onSearchChange={setSearchActionable}
                    searchPlaceholder="Search invoice #, client #, or error type…"
                    searchTestId="queue-search-actionable"
                    matchingCount={actionableVisible.length}
                    matchingNoun={{ one: "group", other: "groups" }}
                  />
                  {actionableVisible.length === 0 ? (
                    <Card>
                      <CardContent
                        className="py-12 text-center text-muted-foreground space-y-3"
                        data-testid="queue-search-empty-actionable"
                      >
                        No groups match “{searchActionable}” in this tab.
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1" data-testid="queue-list-actionable">
                      {actionableSettle.slots.map((s) => renderGroupRow(s.item, { onSelect: selectWorkflow, selectedId: selectedWorkflowId, showDeadline: true, isSettling: s.isSettling, isJustSelected: actionableSettle.isJustSelected(s.item.id) }))}
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="mas-action-required" className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground" data-testid="tab-purpose-mas-action-required">
                <span className="font-medium text-foreground">Approved with per-leg MAS cancels and/or group re-attestation owed.</span> Select a row to walk the checklist inline — the rest of the page becomes the workspace for that group.
              </p>
              {masActionSorted.length === 0 ? (
                <Card>
                  <CardContent className="py-6">
                    <QueueTabEmptyState lane="mas-action-required" filter={expiringFilter} />
                  </CardContent>
                </Card>
              ) : (
                <>
                  <ListTableHeaderStrip
                    searchValue={searchMasAction}
                    onSearchChange={setSearchMasAction}
                    searchPlaceholder="Search invoice #, client #, or error type…"
                    searchTestId="queue-search-mas-action-required"
                    matchingCount={masActionVisible.length}
                    matchingNoun={{ one: "group", other: "groups" }}
                  />
                  {masActionVisible.length === 0 ? (
                    <Card>
                      <CardContent
                        className="py-12 text-center text-muted-foreground space-y-3"
                        data-testid="queue-search-empty-mas-action-required"
                      >
                        No groups match “{searchMasAction}” in this tab.
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1" data-testid="queue-list-mas-action-required">
                      {masActionSettle.slots.map((s) => renderGroupRow(s.item, { onSelect: selectWorkflow, selectedId: selectedWorkflowId, showDeadline: true, isSettling: s.isSettling, isJustSelected: masActionSettle.isJustSelected(s.item.id) }))}
                    </div>
                  )}
                  {selectedWorkflowId !== null && (
                    <MasActionInlineChecklist groupId={selectedWorkflowId} />
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="portal-queued" className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground" data-testid="tab-purpose-portal-queued">
                <span className="font-medium text-foreground">Drafted, waiting for the next portal submission batch.</span> The clock is still running — every row shows its deadline tier.
              </p>
              {portalQueuedSorted.length === 0 ? (
                <Card>
                  <CardContent className="py-6">
                    <QueueTabEmptyState lane="portal-queued" filter={expiringFilter} />
                  </CardContent>
                </Card>
              ) : (
                <>
                  <ListTableHeaderStrip
                    searchValue={searchPortalQueued}
                    onSearchChange={setSearchPortalQueued}
                    searchPlaceholder="Search invoice #, client #, or error type…"
                    searchTestId="queue-search-portal-queued"
                    matchingCount={portalQueuedVisible.length}
                    matchingNoun={{ one: "group", other: "groups" }}
                  />
                  {portalQueuedVisible.length === 0 ? (
                    <Card>
                      <CardContent
                        className="py-12 text-center text-muted-foreground space-y-3"
                        data-testid="queue-search-empty-portal-queued"
                      >
                        No groups match “{searchPortalQueued}” in this tab.
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1" data-testid="queue-list-portal-queued">
                      {portalQueuedSettle.slots.map((s) => renderGroupRow(s.item, { onSelect: selectWorkflow, selectedId: selectedWorkflowId, showDeadline: true, isSettling: s.isSettling, isJustSelected: portalQueuedSettle.isJustSelected(s.item.id) }))}
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="on-hold" className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground" data-testid="tab-purpose-on-hold">
                <span className="font-medium text-foreground">Manually parked or blocked.</span> Still on the deadline clock — every row shows its deadline tier. Resume from the workflow when you're unblocked.
              </p>
              {onHoldSorted.length === 0 ? (
                <Card>
                  <CardContent className="py-6">
                    <QueueTabEmptyState lane="on-hold" filter={expiringFilter} />
                  </CardContent>
                </Card>
              ) : (
                <>
                  <ListTableHeaderStrip
                    searchValue={searchOnHold}
                    onSearchChange={setSearchOnHold}
                    searchPlaceholder="Search invoice #, client #, or error type…"
                    searchTestId="queue-search-on-hold"
                    matchingCount={onHoldVisible.length}
                    matchingNoun={{ one: "group", other: "groups" }}
                  />
                  {onHoldVisible.length === 0 ? (
                    <Card>
                      <CardContent
                        className="py-12 text-center text-muted-foreground space-y-3"
                        data-testid="queue-search-empty-on-hold"
                      >
                        No groups match “{searchOnHold}” in this tab.
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1" data-testid="queue-list-on-hold">
                      {onHoldSettle.slots.map((s) => renderGroupRow(s.item, { onSelect: selectWorkflow, selectedId: selectedWorkflowId, showDeadline: true, isSettling: s.isSettling, isJustSelected: onHoldSettle.isJustSelected(s.item.id) }))}
                    </div>
                  )}
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {selectedWorkflowId && (
          <div ref={workflowPanelRef} className="scroll-mt-4 lg:col-span-2">
            <div className="space-y-3 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:space-y-0 lg:flex lg:flex-col lg:gap-3">
              <div className="flex items-center justify-between gap-2 lg:shrink-0">
                <h3 className="text-lg font-semibold">
                  Process Invoice Group
                  {selectedWorkflowGroupSummary && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      <RefNumber value={selectedWorkflowGroupSummary.invoiceNumber} variant="inline" /> · {selectedWorkflowGroupSummary.status}
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-1">
                  <Link href={`/invoice-groups/${selectedWorkflowId}`}>
                    <Button variant="ghost" size="sm">
                      Full Details <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </Link>
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
              {/* Scrollable body — flex-1 + min-h-0 lets the inner
                  region take the leftover panel height and scroll on
                  large screens, so the bottom action buttons (Save
                  draft / Mark reviewed / Submit to portal) stay
                  reachable even when a leg is expanded and the
                  worktree + submission preview push the content well
                  past the viewport. On smaller breakpoints there's no
                  sticky/height cap, so the panel just flows down the
                  page. */}
              <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
                <InlineGroupWorkspaceMini groupId={selectedWorkflowId} />
              </div>
            </div>
          </div>
        )}

        {!selectedWorkflowId && (
          <div
            className="cc-scope hidden lg:block lg:col-span-2"
            data-testid="queue-no-selection"
          >
            <div className="lg:sticky lg:top-4 flex items-center justify-center min-h-[420px] py-12 px-6 rounded-xl border border-dashed"
              style={{
                background:
                  "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--cc-blue-bg) / 0.35) 100%)",
                borderColor: "hsl(var(--cc-blue-border))",
              }}
            >
              <div className="max-w-sm w-full flex flex-col items-center text-center gap-4">
                <div
                  className="flex items-center justify-center w-14 h-14 rounded-full"
                  style={{
                    background: "hsl(var(--cc-blue-bg))",
                    color: "hsl(var(--cc-blue-fg))",
                    border: "1px solid hsl(var(--cc-blue-border))",
                  }}
                >
                  <FileText className="h-6 w-6" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-semibold tracking-tight">
                    Select an invoice to get started
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Pick any group from the list on the left to open it here.
                    The wizard walks you leg by leg, then helps you draft and
                    submit the dispute without leaving this view.
                  </p>
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <Inbox className="h-3 w-3" />
                  <span>
                    Nothing selected · the queue stays in place while you work.
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}

// Classification Inbox — claim-aware preview of what's sitting in
// "Needs Review" without an Error Type yet. Each group expands to show
// the underlying claims with errorDetails so the operator can see, at a
// glance, whether anything qualifies before opening triage. Picking a
// row opens the triage workspace in a modal dialog rendered by the
// parent Queue component, so the inbox itself stays in place.
interface ClassificationInboxProps {
  open: boolean;
  onToggle: () => void;
  loading: boolean;
  groups: NeedsClassificationInboxGroup[];
  total: number;
  /** Task #419 — per-status group count, surfaced under the total so
   *  operators can see at a glance why an unfamiliar group (one whose
   *  parent is no longer "Needs Review") is appearing. */
  byStatus: Record<string, number>;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function ClassificationInbox({
  open,
  onToggle,
  loading,
  groups,
  total,
  byStatus,
  selectedId,
  onSelect,
}: ClassificationInboxProps) {
  // Empty inbox is the common case — render a subdued, non-expandable
  // strip so the operator's eye skips it. Anything > 0 makes the card
  // expandable and the count badge prominent.
  const hasWork = total > 0;
  return (
    <div className="space-y-3" data-testid="triage-inbox" data-tour="queue-classification-inbox">
      <Card className={hasWork ? "" : "bg-muted/30"}>
        <CardContent className="p-4 space-y-3">
          {hasWork ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              className="w-full flex items-center justify-between gap-3 flex-wrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
              data-testid="classification-inbox-toggle"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Inbox className="h-5 w-5 text-muted-foreground" />
                <h3 className="text-lg font-semibold">Classification Inbox</h3>
                <Badge variant="secondary" data-testid="badge-classification-count">
                  {total} to classify
                </Badge>
                {/* Task #419 — per-status group count breakdown. Lets
                    operators see at a glance why an unfamiliar group
                    (one whose parent is no longer "Needs Review") is
                    appearing now that Task #412 broadened the cohort
                    beyond Needs Review only. Server pre-sorts the
                    entries (desc count, then status name asc) so we
                    iterate Object.entries directly. */}
                <ClassificationInboxStatusBreakdown byStatus={byStatus} />
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {open ? (
                  <>
                    Hide <ChevronUp className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    Show <ChevronDown className="h-4 w-4" />
                  </>
                )}
              </div>
            </button>
          ) : (
            <div
              className="flex items-center gap-2 text-muted-foreground"
              data-testid="classification-inbox-empty"
            >
              <Inbox className="h-4 w-4" />
              <span className="text-sm">Classification Inbox</span>
              <Badge variant="outline" className="text-[10px]">All caught up</Badge>
            </div>
          )}
          {hasWork && open && (
            <>
              <p className="text-xs text-muted-foreground">
                Imported groups with claims that have no Error Type yet. Pick a label and the
                qualifying claim auto-advances to Build Case; blank-description sibling claims
                are auto-excluded.
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Task #419 — per-status group count strip rendered next to the
// "{N} to classify" badge. Renders nothing when the breakdown is
// empty (initial load) or has only a single entry that already
// matches the parent total (no extra information). The dot separator
// matches the spec example: `5 Needs Review · 2 Generating Email`.
function ClassificationInboxStatusBreakdown({
  byStatus,
}: {
  byStatus: Record<string, number>;
}) {
  const entries = Object.entries(byStatus).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  // A single bucket where the only status is "Needs Review" is the
  // historical pre-#412 cohort — the breakdown would just repeat the
  // total badge in different words. Suppress to avoid visual noise.
  if (entries.length === 1 && entries[0][0] === "Needs Review") return null;
  return (
    <span
      className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap"
      data-testid="classification-inbox-by-status"
    >
      {entries.map(([status, n], idx) => (
        <span
          key={status}
          data-testid={`classification-inbox-status-${status.replace(/\s+/g, "-").toLowerCase()}`}
          className="flex items-center gap-1"
        >
          {idx > 0 && <span aria-hidden className="text-muted-foreground/50">·</span>}
          <span className="tabular-nums font-medium text-foreground">{n}</span>
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
    // Container is a div (not <button>) because RefNumber renders a
    // nested copy <button>; <button> within <button> is invalid HTML.
    // We keep the same row-click + keyboard semantics via role/tabIndex
    // and aria-pressed.
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
                style={{ background: "hsl(var(--cc-amber-bg))", color: "hsl(var(--cc-amber-fg))", borderColor: "hsl(var(--cc-amber-border))" }}
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
                  {formatCurrency(c.claimAmount ?? "0")}
                </span>
              </HideForClerk>
              <span className={`flex-1 truncate ${c.isBlank ? "italic text-muted-foreground" : ""}`}>
                {c.isBlank ? "(blank — auto-exclude on classify)" : (c.errorDetails ?? "")}
              </span>
            </li>
          ))}
          {group.claims.length > 4 && (
            <li className="text-[11px] text-muted-foreground italic px-2">
              +{group.claims.length - 4} more claim{group.claims.length - 4 === 1 ? "" : "s"} — open to triage.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

/**
 * Inline MAS checklist for the Queue's MAS Action Required lane
 * (task #559). Loads the selected group's detail and mounts the
 * shared `GroupActionChecklist` so the operator can record per-leg
 * MAS cancels and the group re-attestation without leaving the
 * queue. The mutations inside `GroupActionChecklist` already
 * invalidate the macro-phase rollup family, so the row falls out of
 * the lane on its own once everything's done.
 */
function MasActionInlineChecklist({ groupId }: { groupId: number }) {
  const detailQuery = useGetInvoiceGroup(groupId, {
    query: { queryKey: getGetInvoiceGroupQueryKey(groupId) },
  });
  const detail = detailQuery.data;
  if (!detail) {
    return (
      <Card data-testid={`mas-action-inline-checklist-loading-${groupId}`}>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Loading checklist for invoice group #{groupId}…
        </CardContent>
      </Card>
    );
  }
  return (
    <Card data-testid={`mas-action-inline-checklist-${groupId}`}>
      <CardHeader>
        <CardTitle className="text-base">
          MAS checklist · {detail.invoiceNumber ?? `#${detail.id}`}
        </CardTitle>
        <CardDescription>
          Cancel each approved leg in MAS, then re-attest the group.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <GroupActionChecklist detail={detail} bucketKey={`queue-mas-${detail.id}`} />
      </CardContent>
    </Card>
  );
}

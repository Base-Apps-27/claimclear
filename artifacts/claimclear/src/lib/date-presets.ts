import type { FacetDatePreset } from "@/components/list-table/faceted-filter";

// Format a Date as a local-time YYYY-MM-DD string. We use local time (not UTC)
// because the Service / Created date inputs are also local dates — the operator
// thinks "today" in their own timezone, not in UTC.
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

// The "common" preset set used by date-range facets. Pages pick the subset they
// want via the named exports below. Each preset resolves at click time so
// "Today" is always today, even if the popover stays open across midnight.
export const DATE_PRESETS = {
  today: {
    label: "Today",
    resolve: () => {
      const today = toIsoDate(startOfToday());
      return { from: today, to: today };
    },
  },
  last7Days: {
    label: "Last 7 days",
    resolve: () => {
      const today = startOfToday();
      return { from: toIsoDate(addDays(today, -6)), to: toIsoDate(today) };
    },
  },
  last30Days: {
    label: "Last 30 days",
    resolve: () => {
      const today = startOfToday();
      return { from: toIsoDate(addDays(today, -29)), to: toIsoDate(today) };
    },
  },
  thisMonth: {
    label: "This month",
    resolve: () => {
      const today = startOfToday();
      return {
        from: toIsoDate(startOfMonth(today)),
        to: toIsoDate(endOfMonth(today)),
      };
    },
  },
  lastMonth: {
    label: "Last month",
    resolve: () => {
      const today = startOfToday();
      const lastMonthAnchor = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return {
        from: toIsoDate(startOfMonth(lastMonthAnchor)),
        to: toIsoDate(endOfMonth(lastMonthAnchor)),
      };
    },
  },
} satisfies Record<string, FacetDatePreset>;

// Service Date is a backward-looking range (the date care was provided), so
// "Today" rarely matches anything — leave it out. "Last month" is useful for
// reviewing claims tied to last billing cycle.
export const SERVICE_DATE_PRESETS: FacetDatePreset[] = [
  DATE_PRESETS.last7Days,
  DATE_PRESETS.last30Days,
  DATE_PRESETS.thisMonth,
  DATE_PRESETS.lastMonth,
];

// Created Date is "when did this record land in our system" — operators
// frequently want to see what came in today or this week, so include "Today".
export const CREATED_DATE_PRESETS: FacetDatePreset[] = [
  DATE_PRESETS.today,
  DATE_PRESETS.last7Days,
  DATE_PRESETS.last30Days,
  DATE_PRESETS.thisMonth,
];

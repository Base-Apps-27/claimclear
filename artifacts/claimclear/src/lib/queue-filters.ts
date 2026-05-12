// Task #649 — pure helpers for the Queue page's always-on filter
// strip. Extracted into its own module so the parity test suite can
// import them without pulling in queue.tsx's React + presence + auth
// dependency tree.

import type {
  InvoiceGroupResponse,
  ListInvoiceGroupsOutlook,
  ListInvoiceGroupsExcludeReason,
} from "@workspace/api-client-react";
import { readEngagementMode, type EngagementMode } from "@/components/engagement-filter-controls";
import { parseExpiringParam, type ExpiringFilter } from "@/lib/queue-urgency";

export type LaneId = "clock" | "week" | "hold";

export type OutlookFilter = ListInvoiceGroupsOutlook | null;
export type DraftReviewedFilter = "reviewed" | "unreviewed" | null;
// Task #693 — "Removed — handled offline" sub-filter. Pinned to the
// single API enum value (`handled_offline`) so the chip and the URL
// token can never drift from the server. `null` = chip cleared.
export type ExcludeReasonFilter = ListInvoiceGroupsExcludeReason | null;

export const VALID_OUTLOOK: ListInvoiceGroupsOutlook[] = [
  "ready_to_review",
  "reattest_only",
  "nothing_to_do",
];
export const OUTLOOK_LABEL: Record<ListInvoiceGroupsOutlook, string> = {
  ready_to_review: "Ready to review",
  reattest_only: "Re-attest only",
  nothing_to_do: "Nothing to do",
};

export interface ParityFilters {
  engagement: EngagementMode;
  expiring: ExpiringFilter;
  outlook: OutlookFilter;
  errorTypeIds: string[];
  draftReviewed: DraftReviewedFilter;
  excludeReason: ExcludeReasonFilter;
  showPastDeadline: boolean;
  qSearch: string;
}

export function parseOutlook(raw: string): OutlookFilter {
  return (VALID_OUTLOOK as string[]).includes(raw) ? (raw as OutlookFilter) : null;
}
export function parseDraftReviewed(raw: string): DraftReviewedFilter {
  return raw === "reviewed" || raw === "unreviewed" ? raw : null;
}
export function parseExcludeReason(raw: string): ExcludeReasonFilter {
  return raw === "handled_offline" ? "handled_offline" : null;
}

export function parseParityFilters(
  get: (k: string) => string,
  getAll: (k: string) => string[],
): ParityFilters {
  return {
    engagement: readEngagementMode(get("engagement")),
    expiring: parseExpiringParam(get("expiring")),
    outlook: parseOutlook(get("outlook")),
    errorTypeIds: getAll("errorTypeId"),
    draftReviewed: parseDraftReviewed(get("draftReviewed")),
    excludeReason: parseExcludeReason(get("excludeReason")),
    showPastDeadline: get("showPastDeadline") === "true",
    qSearch: get("qSearch"),
  };
}

export function serializeParityPatch(
  patch: Partial<ParityFilters>,
): Record<string, string | null> {
  const updates: Record<string, string | null> = {};
  if ("engagement" in patch) updates.engagement = patch.engagement === "all" ? "all" : null;
  if ("expiring" in patch) updates.expiring = patch.expiring ?? null;
  if ("outlook" in patch) updates.outlook = patch.outlook ?? null;
  if ("errorTypeIds" in patch) {
    const ids = patch.errorTypeIds ?? [];
    updates.errorTypeId = ids.length === 0 ? null : ids.join(",");
  }
  if ("draftReviewed" in patch) updates.draftReviewed = patch.draftReviewed ?? null;
  if ("excludeReason" in patch) updates.excludeReason = patch.excludeReason ?? null;
  if ("showPastDeadline" in patch)
    updates.showPastDeadline = patch.showPastDeadline ? "true" : null;
  if ("qSearch" in patch) updates.qSearch = (patch.qSearch ?? "") === "" ? null : patch.qSearch!;
  return updates;
}

export function legacyUrlRewrites(
  read: (k: string) => string | null,
): Record<string, string | null> | null {
  const updates: Record<string, string | null> = {};
  let changed = false;
  if (read("readyToReview") === "true") {
    if (!read("outlook")) updates.outlook = "ready_to_review";
    updates.readyToReview = null;
    changed = true;
  }
  const legacySearch =
    read("qActionable") || read("qPortalQueued") || read("qOnHold");
  if (legacySearch != null && legacySearch !== "") {
    if (!read("qSearch")) updates.qSearch = legacySearch;
    updates.qActionable = null;
    updates.qPortalQueued = null;
    updates.qOnHold = null;
    changed = true;
  }
  if (read("tab")) {
    updates.tab = null;
    changed = true;
  }
  return changed ? updates : null;
}

export function laneForRow(group: InvoiceGroupResponse): LaneId {
  if (group.status === "On Hold") return "hold";
  // `effectiveDaysLeft` <= 1 (today / tomorrow) belongs in the clock
  // lane regardless of status. Everything else (including overdue rows
  // explicitly opted-in via `?showPastDeadline=true`) flows into the
  // week-and-later lane unless the group is parked on hold.
  const days = group.effectiveDaysLeft;
  if (group.isUrgent || days === 0 || days === 1) return "clock";
  return "week";
}

export interface ChipDescriptor {
  id: string;
  label: string;
  count?: number;
  onClear: () => void;
}

export interface ErrorTypeOption {
  id: number;
  name: string;
}

// Stable de-dupe by id, preserving first occurrence — used to keep
// React row keys stable across `?group=` rail toggles and across
// status transitions where a row briefly appears in two queries.
export function dedupRowsById<T extends { id: number }>(rows: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

export function buildChips(
  filters: ParityFilters,
  errorTypeOptions: ErrorTypeOption[],
  apply: (patch: Partial<ParityFilters>) => void,
  counts?: Record<string, number>,
): ChipDescriptor[] {
  const chips: ChipDescriptor[] = [];
  const withCount = (chip: ChipDescriptor): ChipDescriptor => {
    if (counts && Object.prototype.hasOwnProperty.call(counts, chip.id)) {
      return { ...chip, count: counts[chip.id] };
    }
    return chip;
  };
  if (filters.engagement !== "needs") {
    chips.push(withCount({
      id: "engagement-all",
      label: "Engagement: All",
      onClear: () => apply({ engagement: "needs" }),
    }));
  }
  const exp = filters.expiring;
  if (exp === "urgent" || exp === "today-tomorrow") {
    chips.push(withCount({
      id: "expiring-today",
      label: "Today",
      onClear: () => apply({ expiring: exp === "today-tomorrow" ? "tomorrow" : null }),
    }));
  }
  if (exp === "tomorrow" || exp === "today-tomorrow") {
    chips.push(withCount({
      id: "expiring-tomorrow",
      label: "Tomorrow",
      onClear: () => apply({ expiring: exp === "today-tomorrow" ? "urgent" : null }),
    }));
  }
  if (exp === "soon") {
    chips.push(withCount({
      id: "expiring-soon",
      label: "Due in 2–3 days",
      onClear: () => apply({ expiring: null }),
    }));
  }
  // No `expiring=stuck` chip: the Queue's filter surface no longer
  // exposes the stuck mode (submitted groups aren't fetched into the
  // lane stack). The mode itself stays in the URL vocabulary because
  // the backend and the Dashboard's "Stuck after submission" surface
  // still use it.
  if (filters.outlook) {
    chips.push(withCount({
      id: `outlook-${filters.outlook}`,
      label: `Outlook: ${OUTLOOK_LABEL[filters.outlook]}`,
      onClear: () => apply({ outlook: null }),
    }));
  }
  for (const idStr of filters.errorTypeIds) {
    const opt = errorTypeOptions.find((o) => String(o.id) === idStr);
    chips.push(withCount({
      id: `errorTypeId-${idStr}`,
      label: `Error: ${opt?.name ?? `#${idStr}`}`,
      onClear: () =>
        apply({ errorTypeIds: filters.errorTypeIds.filter((x) => x !== idStr) }),
    }));
  }
  if (filters.draftReviewed) {
    chips.push(withCount({
      id: `draftReviewed-${filters.draftReviewed}`,
      label: `Draft: ${filters.draftReviewed === "reviewed" ? "Reviewed" : "Unreviewed"}`,
      onClear: () => apply({ draftReviewed: null }),
    }));
  }
  if (filters.excludeReason === "handled_offline") {
    chips.push(withCount({
      id: "excludeReason-handled_offline",
      label: "Removed: Handled offline",
      onClear: () => apply({ excludeReason: null }),
    }));
  }
  if (filters.showPastDeadline) {
    chips.push(withCount({
      id: "showPastDeadline",
      label: "Showing past-deadline",
      onClear: () => apply({ showPastDeadline: false }),
    }));
  }
  if (filters.qSearch.trim()) {
    chips.push(withCount({
      id: "qSearch",
      label: `Search: "${filters.qSearch.trim()}"`,
      onClear: () => apply({ qSearch: "" }),
    }));
  }
  return chips;
}

export function appliedFacetCount(filters: ParityFilters): number {
  let n = 0;
  if (filters.expiring) n += filters.expiring === "today-tomorrow" ? 2 : 1;
  if (filters.outlook) n += 1;
  if (filters.errorTypeIds.length > 0) n += filters.errorTypeIds.length;
  if (filters.draftReviewed) n += 1;
  if (filters.excludeReason) n += 1;
  return n;
}

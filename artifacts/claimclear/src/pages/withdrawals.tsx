import { useState, useMemo, useEffect } from "react";
import {
  useListWithdrawals,
  useBulkAddressWithdrawals,
  getListWithdrawalsQueryKey,
  getExportWithdrawalsCsvUrl,
  ListWithdrawalsSort,
  ListWithdrawalsDir,
  ListWithdrawalsHideAddressed,
  ListWithdrawalsAwaitingParty,
} from "@workspace/api-client-react";
import type {
  ListWithdrawalsParams,
  WithdrawalRow,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { X, Download, Inbox, Filter, CheckCircle2, RotateCcw, ClipboardCopy, Check, Loader2, Calendar as CalendarIcon, Eye, Users } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { useUrlParams } from "@/lib/use-url-params";
import { useRowBreath } from "@/hooks/use-breath";
import { SortableHeader } from "@/components/list-table/sortable-header";
import { FilterChipStrip, type FilterChip } from "@/components/list-table/filter-chip-strip";
import { PaginationFooter, type PageSize } from "@/components/list-table/pagination-footer";
import {
  ListTableHeaderStrip,
  FacetCheckboxList,
  FacetDateRange,
  FacetSearchableCheckboxList,
  type FacetedFilterCategory,
  type FacetOption,
} from "@/components/list-table/faceted-filter";
import {
  PageHeader,
  FilterStrip,
  type FilterStripTab,
  StatusStrip,
  StatusDot,
} from "@/components/cohesion";
import { TONE_STYLE, type Tone } from "@/components/cohesion/tone";
import { EmptyState } from "@/components/empty-state";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
import { useToast, successToast } from "@/hooks/use-toast";
import { useClipboardCopy } from "@/hooks/use-clipboard-copy";
import { WithdrawalReviewDrawer } from "@/components/withdrawal-review-drawer";
import { closureReasonLabel } from "@workspace/vocab";

type TabKey = "all" | "cannot_dispute" | "non_issue" | "denied_by_payor";

// Tab labels come from the glossary so any rename ripples through here
// automatically. The "All" tab is the only locally-owned label.
const TABS: { key: TabKey; label: string; reasons: string[] }[] = [
  { key: "all",              label: "All",                              reasons: [] },
  { key: "cannot_dispute",   label: closureReasonLabel("cannot_dispute"),   reasons: ["cannot_dispute"] },
  { key: "non_issue",        label: closureReasonLabel("non_issue"),        reasons: ["non_issue"] },
  { key: "denied_by_payor",  label: closureReasonLabel("denied_by_payor"),  reasons: ["denied_by_payor"] },
];

const REASON_TONE: Record<string, Tone> = {
  cannot_dispute: "amber",
  non_issue: "blue",
  denied_by_payor: "red",
};

function rowKey(r: WithdrawalRow): string {
  return `${r.kind}:${r.id}`;
}

export default function WithdrawalsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { get, getAll, set } = useUrlParams();

  const search = get("q");
  const sortCol = get("sort") || "closedAt";
  const sortDir = ((get("dir") || "desc") as "asc" | "desc");
  const page = Math.max(1, parseInt(get("page") || "1", 10));
  const pageSize = (([25, 50, 100, 200].includes(parseInt(get("ps") || "50", 10))
    ? parseInt(get("ps") || "50", 10)
    : 50) as PageSize);

  const reasons = getAll("reason");
  const closedFrom = get("closedFrom");
  const closedTo = get("closedTo");
  const closedByIds = getAll("closedBy");
  const hideAddressed = get("hideAddressed") !== "false"; // default true
  // Task #889 — when on, restricts the list to closures that the
  // responsible party has acknowledged but operations hasn't closed
  // yet. Stored as a single URL flag so it survives reloads/shares.
  const awaitingParty = get("awaitingParty") === "true";

  const activeTab: TabKey = (() => {
    if (reasons.length === 1) {
      const t = TABS.find((x) => x.reasons[0] === reasons[0]);
      if (t) return t.key;
    }
    return "all";
  })();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerRow, setDrawerRow] = useState<WithdrawalRow | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const listParams: ListWithdrawalsParams = {
    search: search || undefined,
    reason: reasons.length > 0 ? reasons.join(",") : undefined,
    hideAddressed: hideAddressed ? ListWithdrawalsHideAddressed.true : ListWithdrawalsHideAddressed.false,
    closedFrom: closedFrom || undefined,
    closedTo: closedTo || undefined,
    closedBy: closedByIds.length > 0 ? closedByIds.join(",") : undefined,
    awaitingParty: awaitingParty ? ListWithdrawalsAwaitingParty.true : undefined,
    sort: sortCol as typeof ListWithdrawalsSort[keyof typeof ListWithdrawalsSort],
    dir: sortDir as typeof ListWithdrawalsDir[keyof typeof ListWithdrawalsDir],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };

  const { data, isLoading, isError } = useListWithdrawals(listParams, {
    query: { queryKey: getListWithdrawalsQueryKey(listParams) },
  });

  const rows: WithdrawalRow[] = data?.rows ?? [];
  const total = data?.total ?? 0;
  const counts = data?.counts ?? { cannot_dispute: 0, non_issue: 0, denied_by_payor: 0, addressed: 0 };
  const closers = data?.closers ?? [];

  const closerLabel = (c: { id: string; displayName?: string | null; email?: string | null }): string =>
    c.displayName?.trim() || c.email || c.id;

  // Make sure currently-selected closer ids stay visible in the facet even
  // if the server's options list rotates them out (e.g. another filter
  // narrowed the dataset to no rows from that closer). Without this, the
  // applied chip for the closer would have no toggle in the popover.
  const closerOptions: FacetOption[] = useMemo(() => {
    const seen = new Map<string, FacetOption>();
    for (const c of closers) {
      seen.set(c.id, { id: c.id, label: closerLabel(c) });
    }
    for (const id of closedByIds) {
      if (!seen.has(id)) seen.set(id, { id, label: id, italic: true });
    }
    return Array.from(seen.values());
  }, [closers, closedByIds]);

  const closerLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of closerOptions) m.set(o.id, o.label);
    return m;
  }, [closerOptions]);

  // Keep drawer in sync with refreshed data so saved fields appear
  useEffect(() => {
    if (!drawerRow) return;
    const updated = rows.find((r) => r.kind === drawerRow.kind && r.id === drawerRow.id);
    if (updated && updated !== drawerRow) setDrawerRow(updated);
  }, [rows, drawerRow]);

  const bulk = useBulkAddressWithdrawals();
  // Bulk-action shimmer (Task #494): pulse the affected rows in
  // unison after a successful bulk address/reopen so the change
  // reads as one confirmed sweep instead of silent success.
  const rowBreath = useRowBreath<string>();

  const handleTabChange = (key: TabKey) => {
    const t = TABS.find((x) => x.key === key);
    if (!t) return;
    set({ reason: t.reasons.length ? t.reasons.join(",") : null, page: null }, false);
  };

  const handleSort = (key: string, dir: "asc" | "desc" | "") => {
    set({ sort: key || null, dir: dir || null, page: null }, false);
  };

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(rowKey(r)));
  const anySelected = selected.size > 0;

  const toggleAllPage = () => {
    if (allOnPageSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        rows.forEach((r) => next.delete(rowKey(r)));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        rows.forEach((r) => next.add(rowKey(r)));
        return next;
      });
    }
  };

  const toggleRow = (r: WithdrawalRow) => {
    const k = rowKey(r);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(rowKey(r))),
    [rows, selected]
  );

  const csvUrl = getExportWithdrawalsCsvUrl({
    search: search || undefined,
    reason: reasons.length > 0 ? reasons.join(",") : undefined,
    hideAddressed: hideAddressed ? "true" : "false",
    closedFrom: closedFrom || undefined,
    closedTo: closedTo || undefined,
    closedBy: closedByIds.length > 0 ? closedByIds.join(",") : undefined,
    sort: sortCol as typeof ListWithdrawalsSort[keyof typeof ListWithdrawalsSort],
    dir: sortDir as typeof ListWithdrawalsDir[keyof typeof ListWithdrawalsDir],
  } as Parameters<typeof getExportWithdrawalsCsvUrl>[0]);

  const handleBulkAddress = async (addressed: boolean) => {
    if (selectedRows.length === 0) return;
    try {
      const res = await bulk.mutateAsync({
        data: {
          items: selectedRows.map((r) => ({
            kind: r.kind as "claim" | "invoice_group",
            id: r.id,
          })),
          addressed,
        },
      });
      // Verb variety (Task #494): swap the static "Marked"/"Reopened"
      // title for a friendlier verb pulled from the success-verb pool
      // and keep the count in the description so the operator still
      // sees how many rows the bulk action touched.
      successToast({
        title: "__VERB__",
        description: addressed
          ? `Marked ${res.updated} addressed`
          : `Reopened ${res.updated}`,
      });
      rowBreath.triggerForIds(selectedRows.map(rowKey));
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
    } catch {
      toast({ title: "Bulk update failed", description: "Please try again.", variant: "destructive" });
    }
  };

  // Standardized copy chirp (Task #494): drives the Check-icon swap
  // on the "Copy summary" button via the shared useClipboardCopy
  // hook so this surface flashes the same way every other copy
  // affordance does (ref-numbers, addresses, etc).
  const summaryCopy = useClipboardCopy();
  const handleCopySummary = async () => {
    const subject = selectedRows.length > 0 ? selectedRows : rows;
    if (subject.length === 0) return;
    const lines = subject.map((r) => {
      const reason = closureReasonLabel(r.closureReason);
      const amt = r.amount ? formatCurrency(r.amount) : "—";
      const closed = r.closedAt ? formatDate(r.closedAt) : "—";
      const noteBit = r.closureReviewNotes ? ` — ${r.closureReviewNotes}` : "";
      return `• [${reason}] ${r.kind === "claim" ? "Claim" : "Group"} ${r.identifier} · ${amt} · closed ${closed}${noteBit}`;
    });
    const text = `Withdrawals summary (${subject.length} item${subject.length === 1 ? "" : "s"}):\n${lines.join("\n")}`;
    const ok = await summaryCopy.copy(text);
    if (ok) {
      successToast({ title: "__VERB__", description: `Copied ${subject.length} to clipboard` });
    } else {
      toast({ title: "Copy failed", description: "Clipboard access denied.", variant: "destructive" });
    }
  };

  const clearFilters = () => {
    set(
      { q: null, reason: null, closedFrom: null, closedTo: null, closedBy: null, hideAddressed: null, awaitingParty: null, page: null },
      false,
    );
  };

  const chips = useMemo((): FilterChip[] => {
    const out: FilterChip[] = [];
    if (search) out.push({ key: "q", label: `Search: "${search}"`, onRemove: () => set({ q: null, page: null }, false) });
    if (reasons.length > 0 && activeTab === "all") {
      const labels = reasons.map((r) => closureReasonLabel(r)).join(", ");
      out.push({ key: "reason", label: `Reason: ${labels}`, onRemove: () => set({ reason: null, page: null }, false) });
    }
    if (closedFrom || closedTo) {
      const lbl = closedFrom && closedTo
        ? `Closed: ${closedFrom} – ${closedTo}`
        : closedFrom
          ? `Closed ≥ ${closedFrom}`
          : `Closed ≤ ${closedTo}`;
      out.push({ key: "closed", label: lbl, onRemove: () => set({ closedFrom: null, closedTo: null, page: null }, false) });
    }
    if (closedByIds.length > 0) {
      const labels = closedByIds.map((id) => closerLookup.get(id) ?? id).join(", ");
      out.push({
        key: "closedBy",
        label: `Closed by: ${labels}`,
        onRemove: () => set({ closedBy: null, page: null }, false),
      });
    }
    if (!hideAddressed) {
      out.push({
        key: "showAddressed",
        label: "Including addressed",
        onRemove: () => set({ hideAddressed: null, page: null }, false),
      });
    }
    if (awaitingParty) {
      out.push({
        key: "awaitingParty",
        label: "Awaiting party follow-through",
        onRemove: () => set({ awaitingParty: null, page: null }, false),
      });
    }
    return out;
  }, [search, reasons, activeTab, closedFrom, closedTo, closedByIds, closerLookup, hideAddressed, awaitingParty, set]);

  const tabs: FilterStripTab<TabKey>[] = TABS.map((t) => ({
    key: t.key,
    label: t.label,
    count:
      t.key === "cannot_dispute"   ? counts.cannot_dispute
      : t.key === "non_issue"      ? counts.non_issue
      : t.key === "denied_by_payor" ? counts.denied_by_payor
      : counts.cannot_dispute + counts.non_issue + counts.denied_by_payor,
  }));

  // Per-category applied counts drive both the rail badges and the trigger
  // total. A date range with at least one bound counts as 1 (per the
  // pattern's applied-count rule of thumb). The "Including addressed"
  // toggle counts as 1 only when it diverges from the default (hide).
  const closedDateCount = closedFrom || closedTo ? 1 : 0;
  const closedByCount = closedByIds.length;
  const visibilityCount = !hideAddressed ? 1 : 0;
  // Task #889 — surface awaiting-party flag in the rail total so the
  // operator sees at a glance that the list is narrowed.
  const awaitingPartyCount = awaitingParty ? 1 : 0;
  const totalAppliedFilters = closedDateCount + closedByCount + visibilityCount + awaitingPartyCount;

  const toggleClosedBy = (id: string, next: boolean) => {
    const nextIds = next
      ? (closedByIds.includes(id) ? closedByIds : [...closedByIds, id])
      : closedByIds.filter((v) => v !== id);
    set({ closedBy: nextIds.length > 0 ? nextIds.join(",") : null, page: null }, false);
  };

  const filterCategories: FacetedFilterCategory[] = useMemo(() => [
    {
      id: "followThrough",
      label: "Follow-through",
      icon: Eye,
      appliedCount: awaitingPartyCount,
      render: () => (
        <FacetCheckboxList
          heading="Responsible-party status"
          options={[{ id: "awaiting", label: "Awaiting party follow-through" }]}
          selected={awaitingParty ? ["awaiting"] : []}
          onToggle={(_id, next) =>
            set({ awaitingParty: next ? "true" : null, page: null }, false)
          }
          hint="Show only closures the responsible party hasn't acknowledged yet."
          testIdPrefix="facet-awaitingParty"
        />
      ),
    },
    {
      id: "closedDate",
      label: "Closed Date",
      icon: CalendarIcon,
      appliedCount: closedDateCount,
      render: () => (
        <FacetDateRange
          value={{ from: closedFrom, to: closedTo }}
          onChange={(v) =>
            set(
              {
                closedFrom: v.from || null,
                closedTo: v.to || null,
                page: null,
              },
              false,
            )
          }
          testIdPrefix="facet-closedDate"
        />
      ),
    },
    {
      id: "closedBy",
      label: "Closed by",
      icon: Users,
      appliedCount: closedByCount,
      render: () => (
        <FacetSearchableCheckboxList
          options={closerOptions}
          selected={closedByIds}
          onToggle={toggleClosedBy}
          placeholder="Filter closers..."
          pinSelected
          emptyMessage="No closers in this view yet."
          testIdPrefix="facet-closedBy"
        />
      ),
    },
    {
      id: "visibility",
      label: "Visibility",
      icon: Eye,
      appliedCount: visibilityCount,
      render: () => (
        <FacetCheckboxList
          heading="Addressed items"
          options={[
            { id: "include", label: "Include addressed items" },
          ]}
          selected={!hideAddressed ? ["include"] : []}
          onToggle={(_id, next) =>
            set({ hideAddressed: next ? "false" : null, page: null }, false)
          }
          hint="By default addressed items are hidden so the queue shows only outstanding follow-ups."
          testIdPrefix="facet-visibility"
        />
      ),
    },
  ], [closedDateCount, closedByCount, visibilityCount, awaitingPartyCount, awaitingParty, closedFrom, closedTo, closerOptions, closedByIds, hideAddressed, set]);

  const colCount = 8;

  return (
    <div className="space-y-4" data-testid="withdrawals-page">
      <PageHeader
        title="Withdrawals"
        sub={`${total} closure${total === 1 ? "" : "s"} awaiting review · capture lessons learned and confirm who was told`}
        accent="amber"
      />

      <div className="flex flex-wrap items-center gap-3">
        <FilterStrip
          tabs={tabs}
          active={activeTab}
          onChange={handleTabChange as (k: string) => void}
          accent="amber"
          ariaLabel="Filter withdrawals by reason"
        />
      </div>

      <StatusStrip>
        <StatusDot tone="amber" />
        <span className="font-medium text-foreground">Cannot Dispute</span>
        <span className="tabular-nums text-muted-foreground">{counts.cannot_dispute}</span>
        <span className="text-muted-foreground">·</span>
        <StatusDot tone="blue" />
        <span className="font-medium text-foreground">Non-Issue</span>
        <span className="tabular-nums text-muted-foreground">{counts.non_issue}</span>
        <span className="text-muted-foreground">·</span>
        <StatusDot tone="muted" />
        <span className="font-medium text-foreground">Denied by Payor</span>
        <span className="tabular-nums text-muted-foreground">{counts.denied_by_payor}</span>
        <span className="text-muted-foreground">·</span>
        <StatusDot tone="green" />
        <span className="font-medium text-foreground">Addressed</span>
        <span className="tabular-nums text-muted-foreground">{counts.addressed}</span>
        <span className="text-muted-foreground">·</span>
        {/* Task #889 — informational dot. Acknowledged-by-party means
            the responsible supervisor confirmed follow-through. */}
        <StatusDot tone="blue" />
        <span className="font-medium text-foreground">Acknowledged by party</span>
        <span className="tabular-nums text-muted-foreground">{(counts as { acknowledgedByParty?: number }).acknowledgedByParty ?? 0}</span>
      </StatusStrip>

      <ListTableHeaderStrip
        searchValue={search}
        onSearchChange={(v) => set({ q: v || null, page: null }, false)}
        searchPlaceholder="Search by ID, member, error, narrative…"
        searchTestId="input-search-withdrawals"
        matchingCount={total}
        matchingNoun={{ one: "closure", other: "closures" }}
        filterOpen={filterOpen}
        onFilterOpenChange={setFilterOpen}
        filterCategories={filterCategories}
        totalApplied={totalAppliedFilters}
        onClearAllFilters={clearFilters}
        extras={
          <Button asChild variant="outline" size="sm" data-testid="withdrawals-export-csv">
            <a href={csvUrl} download>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </a>
          </Button>
        }
      >
        <Card>
          <FilterChipStrip
            chips={chips}
            onClearAll={clearFilters}
          />

          {anySelected && (
            <div
              className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200"
              data-testid="withdrawals-bulk-bar"
            >
              <div className="text-sm font-medium text-amber-900">
                {selected.size} selected
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={() => handleBulkAddress(true)}
                  disabled={bulk.isPending}
                  className="bg-green-600 hover:bg-green-700"
                  data-testid="withdrawals-mark-addressed"
                >
                  {bulk.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                  Mark addressed
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleBulkAddress(false)}
                  disabled={bulk.isPending}
                  data-testid="button-bulk-reopen"
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reopen
                </Button>
                <Button size="sm" variant="outline" onClick={handleCopySummary} data-testid="button-copy-summary">
                  {summaryCopy.copied ? (
                    <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />
                  ) : (
                    <ClipboardCopy className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {summaryCopy.copied ? "Copied" : "Copy summary"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  <X className="h-3.5 w-3.5 mr-1.5" /> Clear
                </Button>
              </div>
            </div>
          )}

          <CardContent className="p-0">
            <SkeletonSwap
              loading={isLoading}
              skeleton={
                <div className="p-4 space-y-2" data-testid="withdrawals-table-skeleton">
                  {[1, 2, 3, 4, 5, 6].map(i => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              }
            >
            <div className="overflow-auto max-h-[calc(100vh-22rem)]">
              <table className="w-full text-sm text-left" data-testid="withdrawals-table">
                <thead className="text-xs text-muted-foreground bg-muted/50 uppercase border-b sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 w-10">
                      <Checkbox
                        checked={allOnPageSelected}
                        onCheckedChange={toggleAllPage}
                        aria-label="Select all"
                        data-testid="checkbox-select-all"
                      />
                    </th>
                    <th className="px-4 py-3 font-medium">
                      <SortableHeader label="Reason" sortKey="reason" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-4 py-3 font-medium">
                      <SortableHeader label="Type" sortKey="kind" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-4 py-3 font-medium">
                      <SortableHeader label="Identifier" sortKey="identifier" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-4 py-3 font-medium">Error / category</th>
                    <th className="px-4 py-3 font-medium">
                      <SortableHeader label="Amount" sortKey="amount" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-4 py-3 font-medium">
                      <SortableHeader label="Closed" sortKey="closedAt" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-4 py-3 font-medium text-right">
                      <SortableHeader label="Status" sortKey="addressed" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isError ? (
                    <tr><td colSpan={colCount} className="px-4 py-8 text-center text-destructive">Failed to load withdrawals.</td></tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={colCount} className="px-4 py-0">
                        {(search || chips.length > 0) ? (
                          <EmptyState
                            icon={Filter}
                            title="No withdrawals match your filters"
                            description="Try removing a filter, adjusting your search, or showing addressed items."
                            primaryAction={{
                              label: "Clear filters",
                              onClick: clearFilters,
                            }}
                          />
                        ) : (
                          <EmptyState
                            icon={Inbox}
                            title="Nothing to review"
                            description="When claims or groups are closed as Cannot Dispute, Non-Issue, or Denied by Payor, they will appear here for follow-up."
                          />
                        )}
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => {
                      const tone = REASON_TONE[r.closureReason] ?? "muted";
                      const accentColor = TONE_STYLE[tone].fg;
                      const accentBg = TONE_STYLE[tone].bg;
                      const k = rowKey(r);
                      const isSel = selected.has(k);
                      return (
                        <tr
                          key={k}
                          className={`border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer ${rowBreath.rowClassName(k)}`}
                          style={isSel ? { background: accentBg } : undefined}
                          data-testid={`withdrawals-row-${r.kind}-${r.id}`}
                          onClick={() => setDrawerRow(r)}
                        >
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={isSel}
                              onCheckedChange={() => toggleRow(r)}
                              aria-label={`Select ${r.identifier}`}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              style={{ background: accentBg, color: accentColor, borderColor: accentColor }}
                              className="border text-[10px] uppercase tracking-wide font-bold"
                            >
                              {closureReasonLabel(r.closureReason)}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground capitalize">
                            {r.kind === "invoice_group" ? "Group" : "Claim"}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs font-medium" style={{ color: accentColor }}>
                            {r.identifier}
                          </td>
                          <td className="px-4 py-3 max-w-[280px]">
                            <div className="text-xs truncate" title={r.errorTypeName ?? ""}>
                              {r.errorTypeName ?? <span className="text-muted-foreground italic">Unassigned</span>}
                            </div>
                            {r.closureCategory && (
                              <div className="text-[10px] text-muted-foreground truncate" title={r.closureCategory}>
                                {r.closureCategory}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 font-medium tabular-nums whitespace-nowrap">
                            {r.amount ? formatCurrency(r.amount) : "—"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                            {r.closedAt ? formatDate(r.closedAt) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {r.addressed ? (
                              <Badge className="bg-green-100 text-green-800 border border-green-300 text-[10px] uppercase font-bold">
                                Addressed
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">Pending</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            </SkeletonSwap>
            <PaginationFooter
              total={total}
              page={page}
              pageSize={pageSize}
              onPageChange={(p) => set({ page: String(p) }, false)}
              onPageSizeChange={(s) => set({ ps: String(s), page: null }, false)}
            />
          </CardContent>
        </Card>
      </ListTableHeaderStrip>

      <WithdrawalReviewDrawer row={drawerRow} onClose={() => setDrawerRow(null)} />
    </div>
  );
}

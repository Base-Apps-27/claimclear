import { useState, useMemo, useEffect } from "react";
import {
  useListWithdrawals,
  useBulkAddressWithdrawals,
  getListWithdrawalsQueryKey,
  getExportWithdrawalsCsvUrl,
  ListWithdrawalsSort,
  ListWithdrawalsDir,
  ListWithdrawalsHideAddressed,
} from "@workspace/api-client-react";
import type {
  ListWithdrawalsParams,
  WithdrawalRow,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Search, X, Download, Inbox, Filter, CheckCircle2, RotateCcw, ClipboardCopy, Loader2 } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { useUrlParams } from "@/lib/use-url-params";
import { SortableHeader } from "@/components/list-table/sortable-header";
import { FilterChipStrip, type FilterChip } from "@/components/list-table/filter-chip-strip";
import { PaginationFooter, type PageSize } from "@/components/list-table/pagination-footer";
import {
  PageHeader,
  FilterStrip,
  type FilterStripTab,
  StatusStrip,
  StatusDot,
} from "@/components/cohesion";
import { TONE_STYLE, type Tone } from "@/components/cohesion/tone";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { WithdrawalReviewDrawer } from "@/components/withdrawal-review-drawer";

type TabKey = "all" | "not_contestable" | "non_issue" | "accepted_loss";

const TABS: { key: TabKey; label: string; reasons: string[] }[] = [
  { key: "all",             label: "All",            reasons: [] },
  { key: "not_contestable", label: "Cannot Dispute", reasons: ["not_contestable"] },
  { key: "non_issue",       label: "Non-Issue",      reasons: ["non_issue"] },
  { key: "accepted_loss",   label: "Accepted Loss",  reasons: ["accepted_loss"] },
];

const REASON_TONE: Record<string, Tone> = {
  not_contestable: "amber",
  non_issue: "blue",
  accepted_loss: "muted",
};

const REASON_LABEL: Record<string, string> = {
  not_contestable: "Cannot Dispute",
  non_issue: "Non-Issue",
  accepted_loss: "Accepted Loss",
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
  const hideAddressed = get("hideAddressed") !== "false"; // default true

  const activeTab: TabKey = (() => {
    if (reasons.length === 1) {
      const t = TABS.find((x) => x.reasons[0] === reasons[0]);
      if (t) return t.key;
    }
    return "all";
  })();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerRow, setDrawerRow] = useState<WithdrawalRow | null>(null);

  const listParams: ListWithdrawalsParams = {
    search: search || undefined,
    reason: reasons.length > 0 ? reasons.join(",") : undefined,
    hideAddressed: hideAddressed ? ListWithdrawalsHideAddressed.true : ListWithdrawalsHideAddressed.false,
    closedFrom: closedFrom || undefined,
    closedTo: closedTo || undefined,
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
  const counts = data?.counts ?? { not_contestable: 0, non_issue: 0, accepted_loss: 0, addressed: 0 };

  // Keep drawer in sync with refreshed data so saved fields appear
  useEffect(() => {
    if (!drawerRow) return;
    const updated = rows.find((r) => r.kind === drawerRow.kind && r.id === drawerRow.id);
    if (updated && updated !== drawerRow) setDrawerRow(updated);
  }, [rows, drawerRow]);

  const bulk = useBulkAddressWithdrawals();

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
      toast({
        title: addressed ? `Marked ${res.updated} addressed` : `Reopened ${res.updated}`,
      });
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
    } catch {
      toast({ title: "Bulk update failed", description: "Please try again.", variant: "destructive" });
    }
  };

  const handleCopySummary = async () => {
    const subject = selectedRows.length > 0 ? selectedRows : rows;
    if (subject.length === 0) return;
    const lines = subject.map((r) => {
      const reason = REASON_LABEL[r.closureReason] ?? r.closureReason;
      const amt = r.amount ? formatCurrency(r.amount) : "—";
      const closed = r.closedAt ? formatDate(r.closedAt) : "—";
      const noteBit = r.closureReviewNotes ? ` — ${r.closureReviewNotes}` : "";
      return `• [${reason}] ${r.kind === "claim" ? "Claim" : "Group"} ${r.identifier} · ${amt} · closed ${closed}${noteBit}`;
    });
    const text = `Withdrawals summary (${subject.length} item${subject.length === 1 ? "" : "s"}):\n${lines.join("\n")}`;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `Copied ${subject.length} to clipboard` });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard access denied.", variant: "destructive" });
    }
  };

  const chips = useMemo((): FilterChip[] => {
    const out: FilterChip[] = [];
    if (search) out.push({ key: "q", label: `Search: "${search}"`, onRemove: () => set({ q: null, page: null }, false) });
    if (reasons.length > 0 && activeTab === "all") {
      const labels = reasons.map((r) => REASON_LABEL[r] ?? r).join(", ");
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
    if (!hideAddressed) {
      out.push({
        key: "showAddressed",
        label: "Including addressed",
        onRemove: () => set({ hideAddressed: null, page: null }, false),
      });
    }
    return out;
  }, [search, reasons, activeTab, closedFrom, closedTo, hideAddressed, set]);

  const tabs: FilterStripTab<TabKey>[] = TABS.map((t) => ({
    key: t.key,
    label: t.label,
    count:
      t.key === "not_contestable" ? counts.not_contestable
      : t.key === "non_issue"     ? counts.non_issue
      : t.key === "accepted_loss" ? counts.accepted_loss
      : counts.not_contestable + counts.non_issue + counts.accepted_loss,
  }));

  const colCount = 8;

  return (
    <div className="space-y-4" data-testid="withdrawals-page">
      <PageHeader
        title="Withdrawals"
        sub={`${total} closure${total === 1 ? "" : "s"} awaiting review · capture lessons learned and confirm who was told`}
        accent="amber"
      />

      <div className="flex flex-wrap items-center gap-3">
        <FilterStrip<TabKey>
          tabs={tabs}
          active={activeTab}
          onChange={handleTabChange}
          accent="amber"
          ariaLabel="Filter withdrawals by reason"
        />
      </div>

      <StatusStrip>
        <StatusDot tone="amber" />
        <span className="font-medium text-foreground">Cannot Dispute</span>
        <span className="tabular-nums text-muted-foreground">{counts.not_contestable}</span>
        <span className="text-muted-foreground">·</span>
        <StatusDot tone="blue" />
        <span className="font-medium text-foreground">Non-Issue</span>
        <span className="tabular-nums text-muted-foreground">{counts.non_issue}</span>
        <span className="text-muted-foreground">·</span>
        <StatusDot tone="muted" />
        <span className="font-medium text-foreground">Accepted Loss</span>
        <span className="tabular-nums text-muted-foreground">{counts.accepted_loss}</span>
        <span className="text-muted-foreground">·</span>
        <StatusDot tone="green" />
        <span className="font-medium text-foreground">Addressed</span>
        <span className="tabular-nums text-muted-foreground">{counts.addressed}</span>
      </StatusStrip>

      <Card>
        <CardHeader className="p-4 border-b flex flex-row items-center justify-between space-y-0 gap-3 flex-wrap">
          <div className="relative w-72 flex-shrink-0">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by ID, member, error, narrative…"
              className="pl-9 pr-8"
              value={search}
              onChange={(e) => set({ q: e.target.value || null, page: null }, false)}
              data-testid="input-search-withdrawals"
            />
            {search && (
              <button
                onClick={() => set({ q: null, page: null }, false)}
                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <Checkbox
                checked={hideAddressed}
                onCheckedChange={(v) =>
                  set({ hideAddressed: v ? null : "false", page: null }, false)
                }
                data-testid="checkbox-hide-addressed"
              />
              Hide addressed
            </label>
            <a href={csvUrl} download>
              <Button variant="outline" size="sm" data-testid="withdrawals-export-csv">
                <Download className="mr-2 h-4 w-4" /> Export CSV
              </Button>
            </a>
          </div>
        </CardHeader>

        <FilterChipStrip
          chips={chips}
          onClearAll={() =>
            set(
              { q: null, reason: null, closedFrom: null, closedTo: null, hideAddressed: null, page: null },
              false
            )
          }
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
                <ClipboardCopy className="h-3.5 w-3.5 mr-1.5" /> Copy summary
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                <X className="h-3.5 w-3.5 mr-1.5" /> Clear
              </Button>
            </div>
          </div>
        )}

        <CardContent className="p-0">
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
                {isLoading ? (
                  <tr><td colSpan={colCount} className="px-4 py-8 text-center text-muted-foreground">Loading withdrawals…</td></tr>
                ) : isError ? (
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
                            onClick: () =>
                              set(
                                { q: null, reason: null, closedFrom: null, closedTo: null, hideAddressed: null, page: null },
                                false
                              ),
                          }}
                        />
                      ) : (
                        <EmptyState
                          icon={Inbox}
                          title="Nothing to review"
                          description="When claims or groups are closed as Cannot Dispute, Non-Issue, or Accepted Loss, they will appear here for follow-up."
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
                        className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
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
                            {REASON_LABEL[r.closureReason]}
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
          <PaginationFooter
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={(p) => set({ page: String(p) }, false)}
            onPageSizeChange={(s) => set({ ps: String(s), page: null }, false)}
          />
        </CardContent>
      </Card>

      <WithdrawalReviewDrawer row={drawerRow} onClose={() => setDrawerRow(null)} />
    </div>
  );
}

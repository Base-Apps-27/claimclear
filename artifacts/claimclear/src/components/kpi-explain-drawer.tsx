// Task #834 — "Why this number?" drawer for dashboard KPIs.
//
// Reusable side panel that opens off a small "(i)" affordance next to
// each hero KPI on the Dashboard. The drawer lists the exact rows
// composing the number and, in the footer, the plain-English predicate
// the server used to compute it. Source of truth is the
// `/dashboard/explain/:kpiKey` endpoint, which reuses the same filter
// logic as `/dashboard/summary` so the drawer count and the tile count
// can never disagree (parity is asserted by a contract test in the
// api-server suite).
import { Link } from "wouter";
import { Info, ChevronRight } from "lucide-react";
import {
  useGetDashboardExplain,
  getGetDashboardExplainQueryKey,
  type DashboardExplainKpiKey,
  type DashboardExplainRow,
} from "@workspace/api-client-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";

interface Props {
  kpiKey: DashboardExplainKpiKey;
  /** The display string rendered on the host KPI tile (e.g. "5" for
   *  a count tile, "$1,234.56" for a dollar tile). Shown next to the
   *  title inside the drawer so the operator immediately sees "drawer
   *  says N, tile said N" — no mental reconciliation required. The
   *  drawer prefers the server's `valueDisplay` once loaded; this
   *  prop is the optimistic fallback while the query is in-flight
   *  and the failure-state value if the request errors. */
  displayValue: string | number;
  /** Optional override for the drawer title. Defaults to the
   *  server-provided KPI label. */
  titleOverride?: string;
  /** Optional test id scope (the trigger button gets `<scope>-trigger`,
   *  the drawer content gets `<scope>-content`). */
  testid?: string;
}

export function KpiExplainDrawer({
  kpiKey,
  displayValue,
  titleOverride,
  testid,
}: Props) {
  const triggerTestId = testid ? `${testid}-trigger` : `kpi-explain-trigger-${kpiKey}`;
  const contentTestId = testid ? `${testid}-content` : `kpi-explain-content-${kpiKey}`;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={`Why is this number ${displayValue}?`}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline rounded-sm focus:outline-none focus:ring-2 focus:ring-ring/40 px-1 -mx-1"
          data-testid={triggerTestId}
        >
          <Info className="w-3 h-3" />
          <span>Why?</span>
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
        <KpiExplainBody
          kpiKey={kpiKey}
          displayValue={displayValue}
          titleOverride={titleOverride}
          contentTestId={contentTestId}
        />
      </SheetContent>
    </Sheet>
  );
}

function KpiExplainBody({
  kpiKey,
  displayValue,
  titleOverride,
  contentTestId,
}: {
  kpiKey: DashboardExplainKpiKey;
  displayValue: string | number;
  titleOverride?: string;
  contentTestId: string;
}) {
  const { data, isLoading, isError } = useGetDashboardExplain(kpiKey, {
    query: { queryKey: getGetDashboardExplainQueryKey(kpiKey) },
  });

  const title = titleOverride ?? data?.label ?? "Why this number?";
  // Always render the same display string as the host KPI tile. The
  // server's `valueDisplay` is the source of truth once loaded ("5" for
  // count tiles, "$1,234.56" for dollar tiles); the host-supplied
  // `displayValue` is the optimistic fallback while the request is
  // in-flight. We deliberately do NOT fall back to `rows.length` —
  // that would silently relabel a dollar tile as a count.
  const value = data?.valueDisplay ?? String(displayValue);
  const rows: DashboardExplainRow[] = data?.rows ?? [];
  const amountTotal = data?.amountTotal ?? null;

  return (
    <div className="flex flex-col h-full" data-testid={contentTestId}>
      <SheetHeader className="px-6 pt-6 pb-3 border-b border-border">
        <SheetTitle className="flex items-baseline gap-2">
          <span>{title}</span>
          <span
            className="text-2xl font-bold tabular-nums text-foreground"
            data-testid={`${contentTestId}-value`}
          >
            {value}
          </span>
        </SheetTitle>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto">
        <SkeletonSwap
          loading={isLoading}
          skeleton={
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          }
        >
          {isError ? (
            <div className="p-6 text-sm text-muted-foreground">
              Couldn't load the breakdown. Close this drawer and try again.
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              Nothing contributes to this number right now.
            </div>
          ) : (
            <ul className="divide-y divide-border" data-testid={`${contentTestId}-rows`}>
              {rows.map(r => (
                <li key={`${r.kind}-${r.id}`}>
                  <Link
                    href={r.href}
                    className="flex items-start gap-3 px-6 py-3 hover:bg-muted/40 transition-colors"
                    data-testid={`${contentTestId}-row-${r.kind}-${r.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-mono font-medium truncate">
                        {r.ref}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        {[
                          r.payor,
                          r.serviceDate ? formatDate(r.serviceDate) : null,
                          r.status,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      <div className="text-xs mt-1 text-foreground/80">
                        {r.reason}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground mt-1 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SkeletonSwap>
      </div>

      <div
        className="px-6 py-3 text-xs text-muted-foreground border-t border-border bg-muted/40 space-y-1"
        data-testid={`${contentTestId}-predicate`}
      >
        {amountTotal !== null && (
          <div data-testid={`${contentTestId}-amount-total`}>
            <span className="font-semibold text-foreground/80">Σ contributions:</span>{" "}
            ${amountTotal}{" "}
            <span className="text-muted-foreground/80">
              ({rows.length} group{rows.length === 1 ? "" : "s"})
            </span>
          </div>
        )}
        <div>
          <span className="font-semibold text-foreground/80">Filter logic:</span>{" "}
          {data?.predicateText ?? "Loading…"}
        </div>
      </div>
    </div>
  );
}

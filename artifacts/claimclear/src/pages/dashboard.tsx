import { Link } from "wouter";
import {
  AlertTriangle,
  ChevronRight,
  TrendingUp,
  Activity,
  Sparkles,
  Mail,
  Stamp,
  Server,
  Inbox,
} from "lucide-react";
import {
  useGetDashboardSummary,
  getGetDashboardSummaryQueryKey,
  useGetDashboardActivity,
  getGetDashboardActivityQueryKey,
  useGetResponsesAwaitingReviewCount,
  getGetResponsesAwaitingReviewCountQueryKey,
  useGetAttestationCounts,
  getGetAttestationCountsQueryKey,
  useListInvoiceGroups,
  getListInvoiceGroupsQueryKey,
  type DashboardActivityEvent,
  type InvoiceGroupResponse,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { useDashboardLiveUpdates } from "@/hooks/use-claim-events";
import { PageHeader } from "@/components/cohesion";
import { WorkerHealthBanner } from "@/components/worker-health-banner";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoTooltip } from "@/components/info-tooltip";
import { formatCurrency, formatDate } from "@/lib/format";

// Recent activity rows use a 3-color signal: good / bad / neutral.
function dotColorForTone(tone: DashboardActivityEvent["tone"]): string {
  if (tone === "good") return "hsl(var(--cc-success))";
  if (tone === "bad") return "hsl(var(--destructive))";
  return "hsl(var(--muted-foreground))";
}

function dotLabelForTone(tone: DashboardActivityEvent["tone"]): string {
  if (tone === "good") return "Positive event";
  if (tone === "bad") return "Negative event";
  return "Neutral event";
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString();
}

function firstNameFromUser(user: { displayName?: string | null; firstName?: string | null; email?: string | null } | null | undefined): string {
  if (!user) return "there";
  const first = (user as { firstName?: string | null }).firstName;
  if (first) return first;
  const display = user.displayName;
  if (display) return display.split(/\s+/)[0];
  if (user.email) return user.email.split("@")[0];
  return "there";
}

type KpiTone = "neutral" | "danger" | "good";

function KpiTile({
  label,
  value,
  sub,
  tone = "neutral",
  tooltip,
  testid,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: KpiTone;
  tooltip?: string;
  testid?: string;
}) {
  const valueColor =
    tone === "good"
      ? "hsl(var(--cc-success))"
      : tone === "danger"
        ? "hsl(var(--destructive))"
        : "hsl(var(--foreground))";
  return (
    <div className="rounded-md border border-border bg-card p-4" data-testid={testid}>
      <div className="text-[11px] uppercase tracking-wide font-semibold mb-1.5 text-muted-foreground flex items-center gap-1">
        {label}
        {tooltip && <InfoTooltip content={tooltip} />}
      </div>
      <div className="text-3xl font-bold tabular-nums" style={{ color: valueColor }}>
        {value}
      </div>
      {sub && <div className="text-xs mt-1.5 text-muted-foreground">{sub}</div>}
    </div>
  );
}

type HeroTone = "red" | "blue" | "amber";

interface HeroCardProps {
  tone: HeroTone;
  eyebrow: string;
  count: number;
  title: string;
  icon: React.ReactNode;
  seeAllHref: string;
  items: React.ReactNode;
  itemsEmpty?: React.ReactNode;
  isLoading?: boolean;
  footer?: React.ReactNode;
  testid?: string;
}

function heroToneVars(tone: HeroTone): {
  bg: string;
  border: string;
  fg: string;
  accent: string;
} {
  if (tone === "red") {
    return {
      bg: "hsl(var(--cc-red-bg))",
      border: "hsl(var(--cc-red-border))",
      fg: "hsl(var(--cc-red-fg))",
      accent: "hsl(var(--destructive))",
    };
  }
  if (tone === "blue") {
    return {
      bg: "hsl(var(--cc-blue-bg))",
      border: "hsl(var(--cc-blue-border))",
      fg: "hsl(var(--cc-blue-fg))",
      accent: "hsl(var(--primary))",
    };
  }
  return {
    bg: "hsl(var(--cc-amber-bg))",
    border: "hsl(var(--cc-amber-border))",
    fg: "hsl(var(--cc-amber-fg))",
    accent: "hsl(var(--cc-amber-fg))",
  };
}

function HeroCard({
  tone,
  eyebrow,
  count,
  title,
  icon,
  seeAllHref,
  items,
  itemsEmpty,
  isLoading,
  footer,
  testid,
}: HeroCardProps) {
  const t = heroToneVars(tone);
  return (
    <div
      className="rounded-md overflow-hidden flex flex-col bg-card"
      style={{ borderColor: t.border, borderWidth: 2, borderStyle: "solid" }}
      data-testid={testid}
    >
      <div
        className="px-4 py-2.5 flex items-center justify-between"
        style={{ background: t.bg, borderBottom: `1px solid ${t.border}` }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: t.accent }}>{icon}</span>
          <span
            className="text-[11px] uppercase tracking-wide font-bold"
            style={{ color: t.fg }}
          >
            {eyebrow}
          </span>
        </div>
        <Link
          href={seeAllHref}
          className="text-xs font-medium hover:underline"
          style={{ color: t.fg }}
        >
          See all →
        </Link>
      </div>
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-baseline gap-2">
          <span
            className="text-3xl font-bold tabular-nums"
            style={{ color: t.accent }}
            data-testid={testid ? `${testid}-count` : undefined}
          >
            {count}
          </span>
          <span className="text-sm text-muted-foreground">{title}</span>
        </div>
      </div>
      <div className="flex-1">
        {isLoading ? (
          <div className="px-4 py-3 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : count === 0 ? (
          <div
            className="px-4 py-6 text-xs text-center text-muted-foreground"
            style={{ borderTop: "1px solid hsl(var(--border))" }}
          >
            {itemsEmpty ?? "Nothing here right now."}
          </div>
        ) : (
          items
        )}
      </div>
      {footer && (
        <div
          className="px-4 py-2 text-xs text-muted-foreground"
          style={{
            borderTop: "1px solid hsl(var(--border))",
            background: "hsl(var(--muted))",
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}

function HeroRow({
  to,
  primary,
  sub,
  right,
  testid,
}: {
  to: string;
  primary: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  testid?: string;
}) {
  return (
    <Link
      href={to}
      className="px-4 py-2 flex items-center justify-between hover:bg-muted/40 transition-colors"
      style={{ borderTop: "1px solid hsl(var(--border))" }}
      data-testid={testid}
    >
      <div className="min-w-0">
        <div className="text-sm font-mono font-medium truncate">{primary}</div>
        {sub && <div className="text-xs mt-0.5 text-muted-foreground">{sub}</div>}
      </div>
      {right && (
        <div className="text-sm tabular-nums ml-3 shrink-0">{right}</div>
      )}
    </Link>
  );
}

function buildStartHint(args: {
  fileTodayCount: number;
  topFileTodayInvoice: string | null;
  responsesCount: number;
  reattestCount: number;
}): React.ReactNode {
  const { fileTodayCount, topFileTodayInvoice, responsesCount, reattestCount } = args;
  if (fileTodayCount > 0 && topFileTodayInvoice) {
    return (
      <>
        Start with filing — <span className="font-mono">{topFileTodayInvoice}</span> expires today.
      </>
    );
  }
  if (responsesCount > 0) {
    return <>Start with reviewing payor responses.</>;
  }
  if (reattestCount > 0) {
    return <>Start with the MAS reattest queue.</>;
  }
  return <>You're caught up — nothing on the clock today.</>;
}

export default function Dashboard() {
  const { user } = useAuth();
  const firstName = firstNameFromUser(user);
  useDashboardLiveUpdates();

  const { data: summary, isLoading } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey() },
  });
  const { data: activity } = useGetDashboardActivity(
    { limit: 15 },
    { query: { queryKey: getGetDashboardActivityQueryKey({ limit: 15 }) } },
  );
  const { data: reviewCount } = useGetResponsesAwaitingReviewCount({
    query: { queryKey: getGetResponsesAwaitingReviewCountQueryKey() },
  });
  const { data: attestationCounts } = useGetAttestationCounts({
    query: { queryKey: getGetAttestationCountsQueryKey() },
  });

  // Top items for the "Responses to review" hero card.
  const responsesQueryArgs = { macroPhase: "response-pending", limit: 3 } as const;
  const { data: responsesData, isLoading: responsesLoading } = useListInvoiceGroups(
    responsesQueryArgs,
    { query: { queryKey: getListInvoiceGroupsQueryKey(responsesQueryArgs) } },
  );

  // Top items for the "MAS reattest pending" hero card.
  const reattestQueryArgs = { macroPhase: "mas-action-required", limit: 3 } as const;
  const { data: reattestData, isLoading: reattestLoading } = useListInvoiceGroups(
    reattestQueryArgs,
    { query: { queryKey: getListInvoiceGroupsQueryKey(reattestQueryArgs) } },
  );

  if (isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Command Center"
          sub={`Welcome back, ${firstName} — loading what's moving today…`}
          accent="blue"
        />
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const pipeline = summary.pipeline;
  const amounts = summary.amounts;
  const stats = summary.stats;
  const totalGroups = stats.total ?? 0;

  // "File today" — only items with effectiveDaysLeft === 0 (past-due is hidden).
  const fileTodayItems = summary.expiringGroups
    .filter(g => g.effectiveDaysLeft === 0)
    .slice(0, 3);
  const fileTodayCount = summary.expiringGroups.filter(
    g => g.effectiveDaysLeft === 0,
  ).length;
  const fileSoonItems = summary.expiringGroups.filter(
    g => g.effectiveDaysLeft >= 1 && g.effectiveDaysLeft <= 3,
  );
  const fileSoonTotal = fileSoonItems.reduce(
    (s, g) => s + (parseFloat(g.totalAmount ?? "0") || 0),
    0,
  );

  const responsesCount = reviewCount?.count ?? 0;
  const responsesItems: InvoiceGroupResponse[] = (responsesData?.groups ?? []).slice(0, 3);

  const reattestCount =
    (attestationCounts?.pending ?? 0) + (attestationCounts?.queued ?? 0);
  const reattestItems: InvoiceGroupResponse[] = (reattestData?.groups ?? []).slice(0, 3);

  // Personalized opening line for the readout card.
  const startHint = buildStartHint({
    fileTodayCount,
    topFileTodayInvoice: fileTodayItems[0]?.invoiceNumber ?? null,
    responsesCount,
    reattestCount,
  });

  if (totalGroups === 0) {
    return (
      <div className="space-y-5 pb-8">
        <PageHeader
          title="Command Center"
          sub={`Welcome back, ${firstName} — here's what's moving today.`}
          accent="blue"
        />
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Inbox}
              title="Welcome to ClaimClear"
              description="No claims yet. Import a MAS report to populate the pipeline, or create your first claim manually."
              primaryAction={{ label: "Import claims", href: "/import" }}
              secondaryAction={{ label: "Connect a portal", href: "/settings" }}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Command Center"
        sub={`Welcome back, ${firstName} — here's what's moving today.`}
        accent="blue"
      />

      {/* PERSONALIZED READOUT — the one-line summary of what's on Danny's plate */}
      <div
        className="rounded-md border border-border bg-card px-5 py-4"
        data-testid="readout-card"
      >
        <div className="text-base flex items-center gap-2 flex-wrap">
          <Sparkles className="w-4 h-4 text-muted-foreground" />
          <span>
            You have{" "}
            <span
              className="font-bold tabular-nums"
              style={{ color: "hsl(var(--destructive))" }}
              data-testid="readout-file-count"
            >
              {fileTodayCount}
            </span>{" "}
            to file,{" "}
            <span
              className="font-bold tabular-nums"
              style={{ color: "hsl(var(--primary))" }}
              data-testid="readout-responses-count"
            >
              {responsesCount}
            </span>{" "}
            response{responsesCount === 1 ? "" : "s"} to review, and{" "}
            <span
              className="font-bold tabular-nums"
              style={{ color: "hsl(var(--cc-amber-fg))" }}
              data-testid="readout-reattest-count"
            >
              {reattestCount}
            </span>{" "}
            reattest{reattestCount === 1 ? "" : "s"} pending.
          </span>
        </div>
        <div className="text-sm mt-1 text-muted-foreground" data-testid="readout-hint">
          {startHint}
        </div>
      </div>

      {/* SYSTEM HEALTH BANNER — only renders when degraded/failed */}
      <WorkerHealthBanner />

      {/* UNIVERSAL KPIs — always-on numbers across all roles */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label="Invoices pending"
          value={(pipeline.needsEvidence ?? 0) + (pipeline.awaitingResponse ?? 0)}
          sub={`${pipeline.needsEvidence ?? 0} need evidence · ${pipeline.awaitingResponse ?? 0} awaiting response`}
          tooltip="Open invoice groups still in flight: those needing evidence and those waiting on a payor response."
          testid="kpi-invoices-pending"
        />
        <KpiTile
          label="Total exposure"
          value={formatCurrency(amounts.totalExposure)}
          sub="claim + ~70% vendor prepay"
          tone="danger"
          tooltip="Estimated total financial exposure including claim amounts plus ~70% vendor prepayment."
          testid="kpi-total-exposure"
        />
        <KpiTile
          label="Recovered"
          value={formatCurrency(amounts.totalApproved)}
          sub={
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              {formatCurrency(amounts.totalClaimed)} claimed across {totalGroups} groups
            </span>
          }
          tone="good"
          tooltip="Total dollar amount approved/recovered from disputes."
          testid="kpi-recovered"
        />
        <KpiTile
          label="Lost"
          value={formatCurrency(amounts.totalLost)}
          sub={`${stats.denied} denied · ${stats.withdrawn} withdrawn`}
          tooltip="Claimed dollars on invoice groups that were denied by the payor."
          testid="kpi-lost"
        />
      </div>

      {/* TODAY'S WORK — three hero columns: file today / respond / reattest */}
      <div>
        <div className="text-xs uppercase tracking-wide font-bold mb-2 text-muted-foreground">
          Today's work
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <HeroCard
            tone="red"
            icon={<AlertTriangle className="w-4 h-4" />}
            eyebrow="File today"
            count={fileTodayCount}
            title={
              fileTodayCount === 1
                ? "must be submitted before EOD"
                : "must be submitted before EOD"
            }
            seeAllHref="/queue?expiring=urgent"
            isLoading={false}
            itemsEmpty="No filings due today. Nice."
            items={fileTodayItems.map(g => (
              <HeroRow
                key={g.id}
                to={`/invoice-groups/${g.id}`}
                testid={`file-today-row-${g.id}`}
                primary={g.invoiceNumber}
                sub={
                  <>
                    {formatDate(g.earliestDate)} · {g.status}
                  </>
                }
                right={formatCurrency(g.totalAmount)}
              />
            ))}
            footer={
              fileSoonItems.length > 0 ? (
                <Link
                  href="/queue?expiring=soon"
                  className="hover:underline"
                  data-testid="file-soon-footer"
                >
                  + <span className="font-mono font-semibold">{fileSoonItems.length}</span> more in next 3 days · {formatCurrency(fileSoonTotal)}
                </Link>
              ) : null
            }
            testid="hero-file-today"
          />

          <HeroCard
            tone="blue"
            icon={<Mail className="w-4 h-4" />}
            eyebrow="Responses to review"
            count={responsesCount}
            title="payor responses awaiting outcome"
            seeAllHref="/responses-awaiting-review"
            isLoading={responsesLoading}
            itemsEmpty="No responses waiting on a verdict."
            items={responsesItems.map(g => (
              <HeroRow
                key={g.id}
                to={`/responses-awaiting-review/${g.id}`}
                testid={`response-row-${g.id}`}
                primary={g.invoiceNumber}
                sub={
                  <>
                    {formatDate(g.earliestDate)} · {g.status}
                  </>
                }
                right={formatCurrency(g.totalAmount)}
              />
            ))}
            footer={
              responsesCount > responsesItems.length ? (
                <Link
                  href="/responses-awaiting-review"
                  className="hover:underline"
                >
                  + {responsesCount - responsesItems.length} more in queue
                </Link>
              ) : null
            }
            testid="hero-responses"
          />

          <HeroCard
            tone="amber"
            icon={<Stamp className="w-4 h-4" />}
            eyebrow="MAS reattest pending"
            count={reattestCount}
            title="awaiting billing admin in MAS portal"
            seeAllHref="/attestation-queue"
            isLoading={reattestLoading}
            itemsEmpty="No reattests in the queue."
            items={reattestItems.map(g => (
              <HeroRow
                key={g.id}
                to={`/invoice-groups/${g.id}`}
                testid={`reattest-row-${g.id}`}
                primary={g.invoiceNumber}
                sub={
                  <>
                    {formatDate(g.earliestDate)} · {g.status}
                  </>
                }
                right={formatCurrency(g.totalAmount)}
              />
            ))}
            footer={
              <Link
                href="/attestation-queue"
                className="hover:underline"
                data-testid="reattest-footer"
              >
                Open Attestation Queue →
              </Link>
            }
            testid="hero-reattest"
          />
        </div>
      </div>

      {/* RECENT ACTIVITY */}
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: "1px solid hsl(var(--border))" }}
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="w-4 h-4" /> Recent activity
          </div>
          <Link
            href="/admin/users/activity"
            className="text-xs text-primary hover:underline"
          >
            See all →
          </Link>
        </div>
        <div data-testid="recent-activity-list">
          {!activity ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
          ) : activity.events.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No recent activity yet. Classify a claim or import a job-status report to get started.
            </div>
          ) : (
            activity.events.slice(0, 8).map((event, i, arr) => {
              const summaryNode = (
                <span className="text-sm flex-1 truncate text-foreground">
                  {event.summary}
                </span>
              );
              return (
                <div
                  key={event.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                  style={{
                    borderBottom: i === arr.length - 1 ? "none" : "1px solid hsl(var(--border))",
                  }}
                  data-testid={`recent-row-${event.id}`}
                  data-tone={event.tone}
                >
                  <span
                    aria-hidden="true"
                    title={dotLabelForTone(event.tone)}
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: dotColorForTone(event.tone) }}
                  />
                  {event.href ? (
                    <Link
                      href={event.href}
                      className="flex-1 truncate hover:underline"
                      data-testid={`recent-row-link-${event.id}`}
                    >
                      {summaryNode}
                    </Link>
                  ) : (
                    <div className="flex-1 truncate">{summaryNode}</div>
                  )}
                  <span
                    className="text-xs text-muted-foreground flex-shrink-0 tabular-nums"
                    title={new Date(event.timestamp).toLocaleString()}
                  >
                    {formatRelativeTime(event.timestamp)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Footer hint — past-due moved to the Queue page */}
      <Link
        href="/queue?expiring=overdue"
        className="flex items-center gap-2 text-xs px-1 text-muted-foreground hover:text-foreground transition-colors"
        data-testid="past-due-hint"
      >
        <Server className="w-3 h-3" />
        Past-due items are no longer shown here. View them on the Queue page.
        <ChevronRight className="w-3 h-3" />
      </Link>
    </div>
  );
}

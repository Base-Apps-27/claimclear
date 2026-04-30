import { Link } from "wouter";
import {
  AlertTriangle,
  Bot,
  ChevronRight,
  TrendingUp,
  Send,
  Activity,
  Sparkles,
  Upload,
  FilePlus,
  FileText,
  Inbox,
  XCircle,
  MinusCircle,
} from "lucide-react";
import {
  useGetDashboardSummary,
  getGetDashboardSummaryQueryKey,
  useGetDashboardActivity,
  getGetDashboardActivityQueryKey,
  type DashboardActivityEvent,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { PageHeader, Section } from "@/components/cohesion";
import { WorkerHealthBanner } from "@/components/worker-health-banner";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
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

type HeroTone = "neutral" | "danger" | "good";

function HeroTile({
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
  tone?: HeroTone;
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

function QuickActionLink({ href, icon: Icon, children }: { href: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-card border border-border hover:bg-muted transition-colors"
    >
      <Icon className="h-3 w-3" />
      {children}
    </Link>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const firstName = firstNameFromUser(user);
  const { data: summary, isLoading } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey() },
  });
  const { data: activity } = useGetDashboardActivity(
    { limit: 15 },
    { query: { queryKey: getGetDashboardActivityQueryKey({ limit: 15 }) } },
  );

  if (isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Command Center"
          sub={`Welcome back, ${firstName} — loading what's moving today…`}
          accent="blue"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const pipeline = summary.pipeline;
  const amounts = summary.amounts;
  const stats = summary.stats;
  const portalWorker = summary.portalWorker;
  const portalStats = summary.portalStats;
  const expiringTop = summary.expiringGroups.slice(0, 3);

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Command Center"
        sub={`Welcome back, ${firstName} — here's what's moving today.`}
        accent="blue"
      />

      {/* System health banner — only renders when degraded/failed */}
      <WorkerHealthBanner />

      {/* Worker-health one-liner — slim neutral card */}
      <div
        className="rounded-md border border-border bg-card flex items-center gap-2 px-4 py-2 text-sm flex-wrap"
        data-testid="worker-health-oneliner"
      >
        <span
          aria-hidden="true"
          className="w-1.5 h-1.5 rounded-full inline-block flex-shrink-0"
          style={{
            background: portalWorker.isRunning
              ? "hsl(var(--primary))"
              : portalWorker.lastRun?.status === "failed"
                ? "hsl(var(--destructive))"
                : "hsl(var(--cc-success))",
          }}
        />
        <span className="font-medium">
          Portal worker · {
            portalWorker.isRunning
              ? "Running"
              : portalWorker.lastRun?.status === "failed"
                ? "Last run failed"
                : portalWorker.lastRun
                  ? "Idle"
                  : "Never run"
          }
        </span>
        <span className="text-muted-foreground">
          · {portalWorker.pendingDueCount} due · {portalWorker.overdueCount} overdue
          {portalWorker.lastRun?.triggeredBy && (
            <> · last triggered by {portalWorker.lastRun.triggeredBy}</>
          )}
        </span>
        <Link href="/system-health" className="ml-auto text-xs text-primary font-medium">
          System health →
        </Link>
      </div>

      {(stats.total ?? 0) === 0 ? (
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
      ) : (
        <>
          {/* Hero tiles — neutral by default; only Total Exposure (red) and Recovered (green) are colored */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <HeroTile
              label="Needs evidence"
              value={pipeline.needsEvidence ?? 0}
              sub="invoice groups requiring manual review"
              tooltip="Number of invoice groups that require evidence gathering before a dispute can be filed."
              testid="hero-needs-evidence"
            />
            <HeroTile
              label="Awaiting response"
              value={pipeline.awaitingResponse ?? 0}
              sub="submitted to payor portals"
              tooltip="Invoice groups submitted to the payor portal and waiting for the payor to respond."
              testid="hero-awaiting-response"
            />
            <HeroTile
              label="Total exposure"
              value={formatCurrency(amounts.totalExposure)}
              sub="claim + ~70% vendor prepay (approx.)"
              tone="danger"
              tooltip="Estimated total financial exposure including the claim amounts plus approximately 70% for vendor prepayment costs."
              testid="hero-total-exposure"
            />
            <HeroTile
              label="Recovered"
              value={formatCurrency(amounts.totalApproved)}
              sub={`${formatCurrency(amounts.totalClaimed)} claimed across ${stats.total ?? 0} groups`}
              tone="good"
              tooltip="Total dollar amount successfully recovered through approved disputes."
              testid="hero-recovered"
            />
          </div>

          {/* Expiring Soon — the loud block */}
          <div
            className="rounded-md overflow-hidden bg-card"
            style={{
              borderColor: "hsl(var(--cc-red-border))",
              borderWidth: 2,
              borderStyle: "solid",
            }}
            data-testid="card-expiring-soon"
          >
            <div
              className="px-5 py-3 flex items-center justify-between flex-wrap gap-2"
              style={{
                background: "hsl(var(--cc-red-bg))",
                borderBottom: "1px solid hsl(var(--cc-red-border))",
              }}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" style={{ color: "hsl(var(--destructive))" }} />
                <span className="text-sm font-bold uppercase tracking-wide" style={{ color: "hsl(var(--cc-red-fg))" }}>
                  Expiring Soon
                </span>
                <span className="text-xs" style={{ color: "hsl(var(--cc-red-fg))", opacity: 0.85 }}>
                  · filing deadline within 10 days · {summary.urgentCount} urgent
                </span>
              </div>
              <Link
                href="/invoice-groups"
                className="text-xs font-medium"
                style={{ color: "hsl(var(--cc-red-fg))" }}
              >
                See all {summary.expiringGroups.length} →
              </Link>
            </div>
            {expiringTop.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No invoice groups expiring soon.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3" data-testid="expiring-list">
                {expiringTop.map((group, i) => {
                  const isUrgent = group.isUrgent || group.effectiveDaysLeft <= 1;
                  return (
                    <div
                      key={group.id}
                      className="p-4 flex flex-col gap-2"
                      style={{
                        borderRight: i < expiringTop.length - 1 ? "1px solid hsl(var(--border))" : "none",
                        borderBottom: "none",
                      }}
                      data-testid={`expiring-row-${group.id}`}
                      data-urgent={isUrgent ? "true" : "false"}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="font-mono text-xs font-bold px-2 py-0.5 rounded"
                          style={{
                            background: isUrgent ? "hsl(var(--destructive))" : "hsl(var(--muted))",
                            color: isUrgent ? "white" : "hsl(var(--foreground))",
                          }}
                        >
                          {group.effectiveDaysLeft}d left
                        </span>
                        <Link
                          href={`/invoice-groups/${group.id}`}
                          className="font-mono text-sm font-semibold hover:underline"
                          style={{ color: "hsl(var(--cc-purple-fg))" }}
                        >
                          {group.invoiceNumber}
                        </Link>
                        <StatusBadge status={group.status} className="text-[10px] px-1.5 py-0" />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(group.earliestDate)} · {group.rideCount} ride{group.rideCount === 1 ? "" : "s"}
                      </div>
                      <div className="flex items-center justify-between mt-auto pt-1">
                        <span className="text-lg font-bold tabular-nums">{formatCurrency(group.totalAmount)}</span>
                        <Link
                          href={`/invoice-groups/${group.id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          Open <ChevronRight className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bot / portal row — fully neutral 3-up */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="bot-portal-row">
            <div className="rounded-md border border-border bg-card p-3.5">
              <div className="flex items-center gap-2 text-xs uppercase font-semibold mb-2 text-muted-foreground">
                <Bot className="w-3.5 h-3.5" />Portal worker
              </div>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background: portalWorker.isRunning
                      ? "hsl(var(--primary))"
                      : portalWorker.lastRun?.status === "failed"
                        ? "hsl(var(--destructive))"
                        : "hsl(var(--cc-success))",
                  }}
                />
                <span className="text-sm font-medium">
                  {portalWorker.isRunning
                    ? "Running"
                    : portalWorker.lastRun?.status === "failed"
                      ? "Last run failed"
                      : portalWorker.lastRun
                        ? "Idle · ready"
                        : "Never run"}
                </span>
              </div>
              <div className="text-xs mt-1 text-muted-foreground">
                {portalWorker.pendingDueCount} pending due · {portalWorker.overdueCount} overdue
              </div>
            </div>
            <div className="rounded-md border border-border bg-card p-3.5">
              <div className="flex items-center gap-2 text-xs uppercase font-semibold mb-2 text-muted-foreground">
                <Send className="w-3.5 h-3.5" />Portal queue
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums">{portalStats.pending}</span>
                <span className="text-xs text-muted-foreground">pending submissions</span>
              </div>
              <Link href="/portal-submissions" className="text-xs mt-1 inline-block text-primary hover:underline">
                Open queue →
              </Link>
            </div>
            <div className="rounded-md border border-border bg-card p-3.5">
              <div className="flex items-center gap-2 text-xs uppercase font-semibold mb-2 text-muted-foreground">
                <TrendingUp className="w-3.5 h-3.5" />Bot success rate
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums">{portalStats.successRate}%</span>
                <span className="text-xs text-muted-foreground">
                  {portalStats.submitted} ok · {portalStats.failed} failed
                </span>
              </div>
              <div className="text-xs mt-1 text-muted-foreground">last 50 submissions</div>
            </div>
          </div>

          {/* 1+2 lower deck — Closed claims (1) + Recent activity (2) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <Section title="Closed claims" className="lg:col-span-1" icon={<XCircle className="w-4 h-4" />}>
              <div className="space-y-3">
                <div data-testid="closure-denied-by-payer">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs uppercase font-semibold text-muted-foreground flex items-center gap-1">
                      Denied by payer
                      <InfoTooltip content="Invoice groups the payer formally denied through a recorded portal or email response." />
                    </span>
                    <span className="text-xs text-muted-foreground">final</span>
                  </div>
                  <div className="text-2xl font-bold tabular-nums" data-testid="stat-denied-total">
                    {stats.denied}
                    <span className="text-sm font-normal text-muted-foreground ml-2">
                      ({stats.deniedByReason.payer_denied} payer denied
                      {stats.deniedByReason.other > 0 ? ` · ${stats.deniedByReason.other} other` : ""})
                    </span>
                  </div>
                </div>
                <div className="border-t border-border" />
                <div data-testid="closure-withdrawn">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs uppercase font-semibold text-muted-foreground flex items-center gap-1">
                      <MinusCircle className="w-3 h-3" />
                      Withdrawn (closed by us)
                      <InfoTooltip content="Invoice groups we chose to close internally — Not Contestable or Accepted Loss." />
                    </span>
                    <span className="text-xs text-muted-foreground">not pursued</span>
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-muted-foreground" data-testid="stat-withdrawn-total">
                    {stats.withdrawn}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {stats.withdrawnByReason.not_contestable} not contestable · {stats.withdrawnByReason.accepted_loss} accepted loss
                    {stats.withdrawnByReason.other > 0 && ` · ${stats.withdrawnByReason.other} other`}
                  </div>
                </div>
              </div>
            </Section>

            <Section
              title="Recent activity"
              icon={<Activity className="w-4 h-4" />}
              action={
                <Link href="/admin/users/activity" className="text-xs text-primary hover:underline">
                  See all →
                </Link>
              }
              padded={false}
              className="lg:col-span-2"
            >
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
            </Section>
          </div>

          {/* Quick actions — flat strip */}
          <div
            className="rounded-md p-1 flex items-center gap-1 flex-wrap"
            style={{ background: "hsl(var(--muted))" }}
            data-testid="quick-actions-strip"
          >
            <span className="text-[10px] uppercase font-semibold px-3 text-muted-foreground">
              Quick actions
            </span>
            <QuickActionLink href="/queue?tab=needs-review" icon={Sparkles}>
              Classification queue
            </QuickActionLink>
            <QuickActionLink href="/import" icon={Upload}>
              Import job-status report
            </QuickActionLink>
            <QuickActionLink href="/claims/new" icon={FilePlus}>
              New claim
            </QuickActionLink>
            <QuickActionLink href="/portal-submissions" icon={Send}>
              Portal queue ({portalStats.pending})
            </QuickActionLink>
            <QuickActionLink href="/insights" icon={FileText}>
              Open insights
            </QuickActionLink>
          </div>
        </>
      )}
    </div>
  );
}

import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  useGetAttestationCounts,
  getGetAttestationCountsQueryKey,
  useGetResponsesAwaitingReviewCount,
  getGetResponsesAwaitingReviewCountQueryKey,
} from "@workspace/api-client-react";
import { SessionCountdown } from "@/components/session-countdown";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WrapTooltip } from "@/components/info-tooltip";
import { BatchStatusPill } from "@/components/batch-status-pill";
import { StreakPipAvatar, useStreakPipLiveUpdates } from "@/components/streak-pip-avatar";
import { 
  LayoutDashboard, 
  ListTodo, 
  Files, 
  Upload, 
  AlertCircle, 
  Send, 
  Settings, 
  BarChart3,
  LogOut,
  LogIn,
  Clock,
  ShieldX,
  FolderOpen,
  HeartPulse,
  FileMinus,
  ShieldCheck,
  Eye
} from "lucide-react";

type NavBadge = { count: number; tone: "amber" | "blue"; label: string };
type NavItem = {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  badgeCount?: number;
  badgeTone?: "amber" | "blue";
  badges?: NavBadge[];
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const navDescriptions: Record<string, string> = {
  "Dashboard": "Overview of dispute pipeline, recovery metrics, bot status, and expiring claims.",
  "Queue": "Process claims step-by-step through the dispute workflow: review, evidence, decision, submit.",
  "Responses Awaiting Review": "Stage-2 inbox: payor sent something back and a verdict is owed. Master/detail review with response thread, AI hint, and verdict actions.",
  "Invoice Groups": "View and manage rides grouped by invoice number — the primary unit for disputes.",
  "All Claims": "Browse, search, and filter the complete claims database.",
  "Withdrawals": "Review closed claims and groups (withdrawn, non-issue, accepted loss) — capture lessons, who was told, and mark addressed.",
  "Import": "Upload CSV or Excel files to bulk-import claims from Job Claim Status reports.",
  "Error Types": "Configure error classifications, SOPs, evidence requirements, and decision trees.",
  "Portal Submissions": "Monitor automated MAS portal submissions and bot activity.",
  "Insights": "Recovery analytics and pattern detection — trend lines, repeat-offender drivers and members, error-type breakdowns, and team performance.",
  "Settings": "Account settings, user management, daily brief triggers, and bot instance health.",
  "System Health": "Admin-only view of cron job runs, connector probes, and unmatched email bounces.",
};

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, isAuthenticated, sessionExpiry, login, logout } = useAuth();

  const isAdmin = user?.role === "admin";

  // Mounts the SSE listener that bumps the personal "claims processed
  // today" counter the moment the current user moves a leg into
  // Processed. Lives at the layout level so it's active on every
  // signed-in surface — the pip stays accurate whether you process a
  // claim from the queue, the claim detail, or the invoice group.
  useStreakPipLiveUpdates();

  // Nav badge for the Attestation Queue: pending = approved verdicts that
  // landed and have not been actioned (amber, urgent), queued = parked for a
  // user with portal access (blue, less urgent). We surface them as a single
  // composite "amber+blue" pill, so the team always knows there's something
  // owed off-system without the layout having to compute math.
  const { data: attestationCounts } = useGetAttestationCounts({
    query: {
      queryKey: getGetAttestationCountsQueryKey(),
      refetchInterval: 60_000,
      enabled: isAuthenticated && user?.status === "active",
    },
  });
  const pendingAttest = attestationCounts?.pending ?? 0;
  const queuedAttest = attestationCounts?.queued ?? 0;

  // Live counter for the "Responses Awaiting Review" entry. Polls every
  // 60s — same cadence as attestation counts — and only when the user is
  // signed in and active so we don't burn polls on the auth screen.
  const { data: awaitingReviewCount } = useGetResponsesAwaitingReviewCount({
    query: {
      queryKey: getGetResponsesAwaitingReviewCountQueryKey(),
      refetchInterval: 60_000,
      enabled: isAuthenticated && user?.status === "active",
    },
  });
  const responsesAwaitingReview = awaitingReviewCount?.count ?? 0;
  // The MAS-action sub-badge was retired alongside the MAS tab on the
  // Responses Awaiting Review page — MAS work now opens from each
  // group's detail page via the "I'm re-attesting now" modal, so the
  // sidebar only carries the one verdict-pending count.
  const responsesAwaitingReviewBadges: NavBadge[] = responsesAwaitingReview > 0
    ? [{ count: responsesAwaitingReview, tone: "amber" as const, label: "Verdict pending" }]
    : [];
  // The Attestation Queue is single-bucket now (pending + queued share
  // one list with per-row state badges), so we collapse the two
  // sub-badges into a single "to re-attest" pill that mirrors what the
  // user sees on the page itself.
  const totalAttest = pendingAttest + queuedAttest;
  const attestBadges: NavBadge[] = totalAttest > 0
    ? [{ count: totalAttest, tone: "amber" as const, label: "To re-attest" }]
    : [];

  const adminItems: NavItem[] = [
    { label: "Insights", href: "/insights", icon: BarChart3 },
    ...(isAdmin ? [{ label: "System Health", href: "/system-health", icon: HeartPulse }] : []),
  ];

  const navSections: NavSection[] = [
    {
      label: "Today",
      items: [
        { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
        { label: "Queue", href: "/queue", icon: ListTodo },
        {
          label: "Responses Awaiting Review",
          href: "/responses-awaiting-review",
          icon: Eye,
          badges: responsesAwaitingReviewBadges,
        },
        {
          label: "Attestation Queue",
          href: "/attestation-queue",
          icon: ShieldCheck,
          badges: attestBadges,
        },
      ],
    },
    {
      label: "Browse",
      items: [
        { label: "Invoice Groups", href: "/invoice-groups", icon: FolderOpen },
        { label: "All Claims", href: "/claims", icon: Files },
        { label: "Withdrawals", href: "/withdrawals", icon: FileMinus },
      ],
    },
    {
      label: "Submissions",
      items: [
        { label: "Portal Submissions", href: "/portal-submissions", icon: Send },
      ],
    },
    {
      label: "Setup",
      items: [
        { label: "Import", href: "/import", icon: Upload },
        { label: "Error Types", href: "/error-types", icon: AlertCircle },
        { label: "Settings", href: "/settings", icon: Settings },
      ],
    },
    {
      label: "Admin",
      items: adminItems,
    },
  ];

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Card className="w-full max-w-md mx-4">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-xl bg-[#1B2A4A] flex items-center justify-center">
                <svg width="40" height="40" viewBox="0 0 100 100" fill="none">
                  <path d="M50 8 C50 8 20 55 20 70 C20 85 33 95 50 95 C67 95 80 85 80 70 C80 55 50 8 50 8Z" fill="none" stroke="white" strokeWidth="6"/>
                  <path d="M35 72 L50 45 L65 72" fill="none" stroke="white" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M65 72 C72 60 78 65 82 58" fill="none" stroke="#E85D3A" strokeWidth="5" strokeLinecap="round"/>
                </svg>
              </div>
            </div>
            <CardTitle className="text-2xl">Agape ClaimClear</CardTitle>
            <p className="text-muted-foreground text-sm mt-1">NEMT Claims Dispute Command Center</p>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            {sessionExpiry === "expired_idle" && (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3 w-full text-center">
                <div className="flex items-center justify-center gap-2 text-amber-800 font-medium text-sm">
                  <Clock className="h-4 w-4" />
                  Session timed out due to inactivity
                </div>
                <p className="text-xs text-amber-600 mt-1">For security, sessions expire after 30 minutes of inactivity.</p>
              </div>
            )}
            {sessionExpiry === "expired_absolute" && (
              <div className="bg-blue-50 border border-blue-200 rounded-md p-3 w-full text-center">
                <div className="flex items-center justify-center gap-2 text-blue-800 font-medium text-sm">
                  <Clock className="h-4 w-4" />
                  Session expired
                </div>
                <p className="text-xs text-blue-600 mt-1">For security, sessions expire after 8 hours. Please sign in again.</p>
              </div>
            )}
            {!sessionExpiry && (
              <p className="text-sm text-muted-foreground text-center">
                Sign in with your Replit account to access the dashboard.
              </p>
            )}
            <Button onClick={() => login()} size="lg" className="w-full gap-2">
              <LogIn className="h-5 w-5" />
              Sign In with Replit
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (user.status === "pending") {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Card className="w-full max-w-md mx-4">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-xl bg-amber-100 flex items-center justify-center">
                <Clock className="h-8 w-8 text-amber-600" />
              </div>
            </div>
            <CardTitle className="text-xl">Access Request Submitted</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <p className="text-sm text-muted-foreground text-center">
              Your request to access Agape ClaimClear has been submitted. An administrator will review and approve your access shortly.
            </p>
            <div className="text-sm text-muted-foreground bg-muted rounded-md p-3 w-full">
              <div className="flex justify-between"><span>Account</span><span className="font-medium">{user.email}</span></div>
              <div className="flex justify-between mt-1"><span>Status</span><span className="font-medium text-amber-600">Pending Approval</span></div>
            </div>
            <Button variant="outline" onClick={() => logout()} className="w-full gap-2">
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (user.status === "denied") {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <Card className="w-full max-w-md mx-4">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-xl bg-red-100 flex items-center justify-center">
                <ShieldX className="h-8 w-8 text-red-600" />
              </div>
            </div>
            <CardTitle className="text-xl">Access Denied</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <p className="text-sm text-muted-foreground text-center">
              Your access request has been denied. Please contact an administrator if you believe this is an error.
            </p>
            <Button variant="outline" onClick={() => logout()} className="w-full gap-2">
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen w-full flex bg-background">
        <Sidebar className="border-r border-sidebar-border">
          <SidebarHeader className="p-4 border-b border-sidebar-border">
            <div className="flex items-center gap-2.5 font-bold text-xl text-sidebar-foreground tracking-tight">
              <div className="w-8 h-8 flex items-center justify-center shrink-0">
                <svg width="28" height="28" viewBox="0 0 100 100" fill="none">
                  <path d="M50 8 C50 8 20 55 20 70 C20 85 33 95 50 95 C67 95 80 85 80 70 C80 55 50 8 50 8Z" fill="none" stroke="white" strokeWidth="7"/>
                  <path d="M35 72 L50 45 L65 72" fill="none" stroke="white" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M65 72 C72 60 78 65 82 58" fill="none" stroke="#E85D3A" strokeWidth="6" strokeLinecap="round"/>
                </svg>
              </div>
              <span>Agape <span className="font-normal text-sidebar-foreground/60 text-base">ClaimClear</span></span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            {navSections.map((section) => {
              if (section.items.length === 0) return null;
              return (
                <SidebarGroup key={section.label}>
                  <SidebarGroupLabel className="uppercase tracking-wider text-[10px] text-sidebar-foreground/50">
                    {section.label}
                  </SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {section.items.map((item) => (
                        <SidebarMenuItem key={item.href}>
                          <WrapTooltip content={navDescriptions[item.label] || item.label} side="right">
                            <SidebarMenuButton
                              asChild
                              isActive={location === item.href || location.startsWith(`${item.href}/`)}
                              tooltip={item.label}
                            >
                              <Link href={item.href} className="flex items-center gap-3">
                                <item.icon className="w-5 h-5" />
                                <span className="flex-1">{item.label}</span>
                                {item.badges && item.badges.length > 0 ? (
                                  <span className="ml-auto inline-flex items-center gap-1">
                                    {item.badges.map((b, i) => (
                                      <span
                                        key={i}
                                        title={b.label}
                                        aria-label={`${b.label}: ${b.count}`}
                                        className={
                                          "inline-flex items-center justify-center rounded-full text-[11px] font-semibold leading-none px-1.5 min-w-[20px] h-5 " +
                                          (b.tone === "amber"
                                            ? "bg-amber-500 text-amber-50"
                                            : "bg-blue-500 text-blue-50")
                                        }
                                        data-testid={`nav-badge-${item.href.replace(/\//g, "")}-${b.tone}`}
                                      >
                                        {b.count > 99 ? "99+" : b.count}
                                      </span>
                                    ))}
                                  </span>
                                ) : item.badgeCount && item.badgeCount > 0 ? (
                                  <span
                                    className={
                                      "ml-auto inline-flex items-center justify-center rounded-full text-[11px] font-semibold leading-none px-1.5 min-w-[20px] h-5 " +
                                      (item.badgeTone === "amber"
                                        ? "bg-amber-500 text-amber-50"
                                        : "bg-blue-500 text-blue-50")
                                    }
                                    data-testid={`nav-badge-${item.href.replace(/\//g, "")}`}
                                  >
                                    {item.badgeCount > 99 ? "99+" : item.badgeCount}
                                  </span>
                                ) : null}
                              </Link>
                            </SidebarMenuButton>
                          </WrapTooltip>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              );
            })}
          </SidebarContent>
          <SidebarFooter className="border-t border-sidebar-border p-4">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3 overflow-hidden">
                <StreakPipAvatar
                  imageUrl={user.profileImageUrl}
                  fallback={user.displayName?.charAt(0) || user.email.charAt(0).toUpperCase()}
                />
                <div className="flex flex-col overflow-hidden">
                  <span className="text-sm font-medium text-sidebar-foreground truncate">
                    {user.displayName || "User"}
                  </span>
                  <span className="text-xs text-sidebar-foreground/70 truncate">
                    {user.email}
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => logout()} className="text-sidebar-foreground hover:bg-sidebar-accent shrink-0">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </SidebarFooter>
        </Sidebar>
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 border-b bg-card flex items-center px-4 sticky top-0 z-10 shrink-0">
            <SidebarTrigger className="mr-4" />
            <h1 className="font-semibold text-sm text-muted-foreground">NEMT Claims Dispute Command Center</h1>
            <div className="ml-auto flex items-center gap-3">
              <BatchStatusPill />
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6 md:p-8">
            <div className="max-w-7xl mx-auto h-full">
              {children}
            </div>
          </main>
        </div>
        <SessionCountdown />
      </div>
    </SidebarProvider>
  );
}

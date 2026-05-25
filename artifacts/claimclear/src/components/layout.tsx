import { Link, useLocation } from "wouter";
import { useEffect } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import {
  useListAttestationPending,
  getListAttestationPendingQueryKey,
  useGetResponsesAwaitingReviewCount,
  getGetResponsesAwaitingReviewCountQueryKey,
  useGetMacroPhaseRollup,
  getGetMacroPhaseRollupQueryKey,
} from "@workspace/api-client-react";
import { SessionCountdown } from "@/components/session-countdown";
import { countDistinctAttestationGroups } from "@/lib/attestation-counts";
import { useSystemEvents } from "@/hooks/use-system-events";
import { useSessionMilestonesLifecycle, useSessionProcessedCount } from "@/hooks/use-session-milestones";
import { useWelcomeBackWinsToast } from "@/hooks/use-welcome-back-toast";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WrapTooltip } from "@/components/info-tooltip";
import { BatchStatusPill } from "@/components/batch-status-pill";
import { StateLegend } from "@/components/state-legend";
import { HeaderSearch } from "@/components/header-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { getDisplayTimezone, getDisplayTimezoneShort } from "@/lib/time";
import { macroPhaseLabel } from "@/lib/lifecycle-phase";
import { cn } from "@/lib/utils";
import { useAdminTour } from "@/tour/admin-tour";
import { HelpPopover } from "@/tour/help-popover";
import { HelpCircle } from "lucide-react";
import { StreakPipAvatar, useStreakPipLiveUpdates } from "@/components/streak-pip-avatar";
import { ActivityHoverCard } from "@/components/activity-hover-card";
import { StateBadge } from "@/components/state-badge";
import { useRecentGroupVisits } from "@/hooks/use-recent-group-visits";
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
  Inbox,
  UserCog,
  Eye,
  Pin,
  PinOff,
  MoreHorizontal,
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
  "Dashboard": "Overview of dispute pipeline, recovery metrics, bot status, and expiring invoices.",
  "Queue": "Process invoices step-by-step through the dispute workflow: review, evidence, decision, submit.",
  "Responses Awaiting Review": "Stage-2 inbox: payor sent something back and a verdict is owed. Master/detail review with response thread, AI hint, and verdict actions.",
  "All Invoices": "Browse, search, and filter every invoice (the dispute unit).",
  "Withdrawals": "Review closed claims and groups (withdrawn, non-issue, accepted loss) — capture lessons, who was told, and mark addressed.",
  "My Closures": "Closures routed to you (responsible-party portal). Acknowledge what you've fixed with a short note.",
  "Responsible Roles": "Admin — assign which supervisors own follow-through on closures.",
  "Import": "Upload CSV or Excel files to bulk-import invoices and the legs that belong to them.",
  "Error Types": "Configure error classifications, SOPs, evidence requirements, and decision trees.",
  "Portal Submissions": "Monitor automated MAS portal submissions and bot activity.",
  "Insights": "Recovery analytics and pattern detection — trend lines, repeat-offender drivers and members, error-type breakdowns, and team performance.",
  "Settings": "Account settings, user management, daily brief triggers, and bot instance health.",
  "System Health": "Admin-only view of cron job runs, connector probes, and unmatched email bounces.",
};

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, isAuthenticated, sessionExpiry, login, logout } = useAuth();
  const { startTour, isAvailable: tourAvailable } = useAdminTour();

  const isAdmin = user?.role === "admin";
  const isClerk = user?.role === "clerk";

  // Mounts the SSE listener that bumps the personal "legs processed
  // today" counter the moment the current user moves a leg into
  // Processed. Lives at the layout level so it's active on every
  // signed-in surface — the pip stays accurate whether you process a
  // claim from the queue, the claim detail, or the invoice group.
  useStreakPipLiveUpdates();

  // Day-complete celebration listener (Task #313). One open EventSource
  // per authenticated tab; fires confetti + toast when the day flips to
  // fully concluded. Disabled on the auth screen so we don't leak an SSE
  // connection past sign-out.
  useSystemEvents({ enabled: isAuthenticated && user?.status === "approved" });
  // Task #491 — clear "claims processed this session" counters on
  // sign-out so milestone badges don't carry over between operators
  // sharing the same browser.
  useSessionMilestonesLifecycle({
    enabled: isAuthenticated && user?.status === "approved",
  });

  // Task #780 (F) — quiet "welcome back" toast that fires once per
  // browser session per calendar day if there have been any approvals
  // in the resolution-anchored window. Acknowledges the team's
  // progress on the spot, even if every other celebration source
  // stays quiet for the rest of the session. No confetti — the
  // wins-hero on the dashboard is the visual celebration; this is
  // the toast that says "we see you."
  useWelcomeBackWinsToast({
    enabled: isAuthenticated && user?.status === "approved",
  });

  // Nav badge for the Attestation Queue. Task #430 changed the surface
  // from per-leg rows to per-invoice-group rows, so the badge now
  // counts distinct invoice groups across the pending+queued lists
  // instead of raw leg counts. We hit the same two list endpoints the
  // Open tab uses so the number on the rail always matches the number
  // of rows the operator will land on.
  const attestActive = isAuthenticated && user?.status === "approved";
  const { data: pendingList } = useListAttestationPending(
    { state: "pending" },
    {
      query: {
        queryKey: getListAttestationPendingQueryKey({ state: "pending" }),
        refetchInterval: 60_000,
        enabled: attestActive,
      },
    },
  );
  const { data: queuedList } = useListAttestationPending(
    { state: "queued" },
    {
      query: {
        queryKey: getListAttestationPendingQueryKey({ state: "queued" }),
        refetchInterval: 60_000,
        enabled: attestActive,
      },
    },
  );
  // Shared helper with the Attestation Queue page (Task #893) so the
  // sidebar badge and the page's Open header / tab badge / Queue
  // section header are derived from one canonical group-counting
  // routine and cannot drift.
  const distinctAttestGroups = countDistinctAttestationGroups([
    pendingList,
    queuedList,
  ]);

  // Live counter for the "Responses Awaiting Review" entry. Polls every
  // 60s — same cadence as attestation counts — and only when the user is
  // signed in and active so we don't burn polls on the auth screen.
  const { data: awaitingReviewCount } = useGetResponsesAwaitingReviewCount({
    query: {
      queryKey: getGetResponsesAwaitingReviewCountQueryKey(),
      refetchInterval: 60_000,
      enabled: isAuthenticated && user?.status === "approved",
    },
  });
  const responsesAwaitingReview = awaitingReviewCount?.count ?? 0;
  const responsesAwaitingReviewBadges: NavBadge[] = responsesAwaitingReview > 0
    ? [{ count: responsesAwaitingReview, tone: "amber" as const, label: "Verdict pending" }]
    : [];
  // Task #430: badge counts distinct invoice groups (the new row unit
  // on the Open tab), not raw legs. Tooltip stays short — the surface
  // itself is labelled "Attestation Queue", so the pluralised noun is
  // enough context.
  const attestBadges: NavBadge[] = distinctAttestGroups > 0
    ? [{
        count: distinctAttestGroups,
        tone: "amber" as const,
        label: distinctAttestGroups === 1 ? "group to re-attest" : "groups to re-attest",
      }]
    : [];

  // Insights is shown to every approved user; clerks see it with money
  // tiles masked out (HideForClerk wrappers inside the page itself).
  // System Health remains admin-only.
  const adminItems: NavItem[] = [
    { label: "Insights", href: "/insights", icon: BarChart3 },
    ...(isAdmin
      ? [
          { label: "Responsible Roles", href: "/admin/responsible-roles", icon: UserCog },
          { label: "System Health", href: "/system-health", icon: HeartPulse },
        ]
      : []),
  ];

  // Task #889 — gate the My Closures entry on the new
  // `users.responsible_roles` array surfaced via /auth/user. Users
  // with no assigned role never see the link at all.
  const responsibleRoles = user?.responsibleRoles ?? [];
  const myClosuresItems: NavItem[] = responsibleRoles.length > 0
    ? [{ label: "My Closures", href: "/my-closures", icon: Inbox }]
    : [];
  // Task #889 round-3 — portal-only isolation gated on the explicit
  // `users.is_portal_only` boolean (migration 0055). Admins flip it
  // when granting access to someone who ONLY needs the portal;
  // existing operator users who also get assigned a responsible role
  // keep full operator access. Admins/clerks always keep dual access
  // even if the flag was set in error.
  const isPortalOnly = !!user?.isPortalOnly && !isAdmin && !isClerk;

  // Setup section — Import, Error Types, Settings — is admin/user
  // only. Clerks lose the whole section (the empty-array filter in
  // the render block below collapses it without an empty header).
  const setupItems: NavItem[] = isClerk
    ? []
    : [
        { label: "Import", href: "/import", icon: Upload },
        { label: "Error Types", href: "/error-types", icon: AlertCircle },
        { label: "Settings", href: "/settings", icon: Settings },
      ];

  const navSections: NavSection[] = isPortalOnly ? [
    { label: "Today", items: myClosuresItems },
  ] : [
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
        { label: "All Invoices", href: "/invoice-groups", icon: FolderOpen },
        { label: "Withdrawals", href: "/withdrawals", icon: FileMinus },
        ...myClosuresItems,
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
      items: setupItems,
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
        <Sidebar className="border-r border-sidebar-border" data-tour="sidebar">
          <SidebarHeader className="p-4 border-b border-sidebar-border">
            <div className="flex items-center gap-2.5 font-bold text-xl text-sidebar-foreground tracking-tight">
              <div className="w-8 h-8 flex items-center justify-center shrink-0">
                <svg width="28" height="28" viewBox="0 0 100 100" fill="none" className="cc-logo-wink">
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
            <RecentlyViewedSection userId={user.id} />
            {/* Help section — discoverable manual trigger for the guided
                walkthrough. Lives in the sidebar (not just the header)
                because operators expect "replay the tour" to be a nav
                item, not a tiny header icon. */}
            {tourAvailable && (
              <SidebarGroup>
                <SidebarGroupLabel className="uppercase tracking-wider text-[10px] text-sidebar-foreground/50">
                  Help
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <WrapTooltip
                        content="Replay the guided walkthrough — the same tour new teammates see on their first sign-in."
                        side="right"
                      >
                        <SidebarMenuButton
                          onClick={() => startTour()}
                          tooltip="Take the tour"
                          data-tour="sidebar-take-tour"
                          data-testid="sidebar-take-tour"
                        >
                          <HelpCircle className="w-5 h-5" />
                          <span className="flex-1">Take the tour</span>
                        </SidebarMenuButton>
                      </WrapTooltip>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <StateLegend />
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </SidebarContent>
          <SidebarFooter className="border-t border-sidebar-border p-4">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3 overflow-hidden">
                {/* The avatar always represents the signed-in user, so
                    wrapping it in `ActivityHoverCard` here is safe.
                    Do NOT reuse the wrapper around other-user avatars
                    elsewhere (e.g. activity-feed actors) — the card is
                    self-only by contract (Task #522). */}
                <ActivityHoverCard side="right" align="end">
                  <StreakPipAvatar
                    imageUrl={user.profileImageUrl}
                    fallback={user.displayName?.charAt(0) || user.email.charAt(0).toUpperCase()}
                  />
                </ActivityHoverCard>
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
            <HeaderSearch />
            <div className="ml-auto flex items-center gap-3">
              <DisplayTimezoneChip />
              <SessionPaceBadge />
              {tourAvailable && <HelpPopover />}
              <ThemeToggle />
              <BatchStatusPill />
            </div>
          </header>
          <FullBleedAwareMain>{children}</FullBleedAwareMain>
        </div>
        <SessionCountdown />
      </div>
    </SidebarProvider>
  );
}

// Workspace-style pages (the SOP full-page editor) need to span the
// full viewport width and height — no max-w cap, no outer padding —
// because they manage their own multi-pane chrome. Every other route
// keeps the centered, padded container that the rest of the app reads
// as "content page". Match on the route prefix instead of asking pages
// to opt in, so we never miss a sibling route added later under the
// same workspace umbrella.
const FULL_BLEED_PREFIXES = ["/admin/sops/"];
function FullBleedAwareMain({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const isFullBleed = FULL_BLEED_PREFIXES.some((p) => location.startsWith(p));
  if (isFullBleed) {
    return (
      <main className="flex-1 overflow-hidden min-h-0" data-tour="page-main">
        {children}
      </main>
    );
  }
  return (
    <main className="flex-1 overflow-auto p-6 md:p-8" data-tour="page-main">
      <div className="max-w-7xl mx-auto h-full">{children}</div>
    </main>
  );
}

// Task #839 — sidebar rail of the last 10 invoice groups this
// operator opened. Per-user (localStorage keyed on user id), local-only
// (no backend round trip on each navigation), updates live as the
// operator navigates between detail pages. Hidden until there's at
// least one entry so first-time operators don't see an empty rail.
function RecentlyViewedSection({ userId }: { userId: string | undefined }) {
  const { visits, togglePin, clearRecents, applyPhaseUpdates, justUpdatedIds } =
    useRecentGroupVisits(userId);
  useRailPhaseReconciler(applyPhaseUpdates);
  if (visits.length === 0) return null;
  return (
    <SidebarGroup data-testid="sidebar-recently-viewed" className="relative">
      <SidebarGroupLabel className="uppercase tracking-wider text-[10px] text-sidebar-foreground/50">
        Recently Viewed
      </SidebarGroupLabel>
      {/* Task #851 — overflow menu on the rail header so operators can
          wipe the per-user list (e.g. before a screenshare) without
          digging through settings. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarGroupAction
            aria-label="Recently viewed options"
            data-testid="sidebar-recents-menu"
          >
            <MoreHorizontal />
          </SidebarGroupAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem
            onSelect={() => clearRecents()}
            data-testid="sidebar-recents-clear"
          >
            Clear recents
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SidebarGroupContent>
        <SidebarMenu>
          {visits.map((v) => (
            <SidebarMenuItem
              key={v.id}
              // Task #882 — brief, soft background flash on the row
              // whenever `applyPhaseUpdates` actually changed this
              // entry's cached phase. Catches the eye on a glance back
              // at the sidebar without blocking the row's click target
              // (`pointer-events-none` on the absolute overlay below)
              // and auto-clears after ~2s via the hook's cue timers.
              data-just-updated={justUpdatedIds.has(v.id) ? "true" : undefined}
              className={cn(
                "relative",
                justUpdatedIds.has(v.id) &&
                  "before:pointer-events-none before:absolute before:inset-0 before:rounded-md before:bg-sidebar-accent/60 before:animate-pulse",
              )}
              data-testid={`sidebar-recent-row-${v.id}`}
            >
              <SidebarMenuButton
                asChild
                tooltip={`Invoice ${v.invoiceNumber}${v.clientNumber ? ` · ${v.clientNumber}` : ""}`}
                className="h-auto"
              >
                <Link
                  href={`/invoice-groups/${v.id}`}
                  className="flex items-center gap-2 pr-7"
                  data-testid={`sidebar-recent-${v.id}`}
                >
                  <span className="flex-1 min-w-0 flex flex-col leading-tight">
                    <span className="font-mono text-xs truncate text-sidebar-foreground">
                      {v.invoiceNumber}
                    </span>
                    {v.clientNumber && (
                      <span className="text-[10px] text-sidebar-foreground/60 truncate">
                        {v.clientNumber}
                      </span>
                    )}
                  </span>
                  {v.phase && (
                    <span className="ml-auto shrink-0 scale-[0.85] origin-right">
                      <StateBadge variant="phase" value={v.phase} />
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
              {/* Per-row pin affordance. Pinned entries are exempt from
                  the 10-entry FIFO cap (Task #851). Shown persistently
                  when pinned so operators can see which rows are
                  protected at a glance; reveals on hover otherwise to
                  keep the rail uncluttered. */}
              <SidebarMenuAction
                showOnHover={!v.pinned}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  togglePin(v.id);
                }}
                aria-label={v.pinned ? `Unpin ${v.invoiceNumber}` : `Pin ${v.invoiceNumber}`}
                title={v.pinned ? "Unpin" : "Pin"}
                data-testid={`sidebar-recent-pin-${v.id}`}
                data-pinned={v.pinned ? "true" : "false"}
              >
                {v.pinned ? <PinOff /> : <Pin />}
              </SidebarMenuAction>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

// Task #852 — opportunistically refresh the Recently Viewed rail's
// cached phase pills using payloads already flowing through the React
// Query cache. The rail snapshots a group's phase at visit time, so
// if a teammate (or a portal event) moves a group forward while the
// operator is sitting on the dashboard / queue / list, the pill goes
// stale until the operator re-visits the detail page. By subscribing
// to the QueryCache and harvesting `{id, phase}` pairs from list
// (`/api/invoice-groups`) and detail (`/api/invoice-groups/{id}`)
// responses as they land, we keep the rail honest with zero extra
// HTTP requests. Cross-tab updates continue to flow through the
// existing `storage` event in `useRecentGroupVisits`.
type RailReconcileFn = (
  updates: Iterable<{ id: number; phase?: string | null }>,
  options?: { cue?: boolean },
) => void;

function useRailPhaseReconciler(applyPhaseUpdates: RailReconcileFn) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const harvest = (query: Query, options?: { cue?: boolean }) => {
      const key = query.queryKey;
      if (!Array.isArray(key) || typeof key[0] !== "string") return;
      const path = key[0] as string;
      const data = query.state.data as unknown;
      if (!data) return;
      if (path === "/api/invoice-groups") {
        const groups = (data as { groups?: unknown }).groups;
        if (!Array.isArray(groups)) return;
        const updates: { id: number; phase?: string | null }[] = [];
        for (const g of groups) {
          if (g && typeof g === "object") {
            const { id, phase } = g as { id?: unknown; phase?: unknown };
            if (typeof id === "number") {
              updates.push({
                id,
                phase: typeof phase === "string" ? phase : null,
              });
            }
          }
        }
        if (updates.length > 0) applyPhaseUpdates(updates, options);
      } else if (path.startsWith("/api/invoice-groups/")) {
        // Detail endpoint key is `["/api/invoice-groups/{id}"]` —
        // ignore nested sub-resources (history, threads, etc.) which
        // share the prefix but carry extra path segments.
        const rest = path.slice("/api/invoice-groups/".length);
        if (rest.length === 0 || rest.includes("/")) return;
        const idNum = Number(rest);
        if (!Number.isInteger(idNum)) return;
        const phase = (data as { phase?: unknown }).phase;
        applyPhaseUpdates(
          [{ id: idNum, phase: typeof phase === "string" ? phase : null }],
          options,
        );
      }
    };

    // Reconcile against whatever is already in the cache when the
    // sidebar mounts (e.g. the operator navigated from the queue to
    // the dashboard — the list query already lives in the cache).
    // Pass `cue: false` so this mount-time sync doesn't flash rows
    // for changes the operator has likely already seen elsewhere
    // (Task #882). Live updates from the cache subscription below
    // still flash normally.
    for (const q of cache.getAll()) harvest(q, { cue: false });

    const unsub = cache.subscribe((event) => {
      if (event.type === "updated" && event.action?.type === "success") {
        harvest(event.query);
      }
    });
    return () => unsub();
  }, [queryClient, applyPhaseUpdates]);
}

// Display-timezone chip (#562). Tiny header label so operators always
// know which timezone every date / time / urgency call across the app
// is rendered in. The whole operator app standardises on one display
// TZ — see `lib/time/index.ts`.
function DisplayTimezoneChip() {
  const tz = getDisplayTimezone();
  const short = getDisplayTimezoneShort();
  return (
    <WrapTooltip
      content={`All dates, times, and urgency math across this app are rendered in ${tz}. The whole team works from a single display timezone — operators never need to mentally convert between Dashboard, Queue, lists, charts, and the daily brief.`}
      side="bottom"
    >
      <span
        data-testid="display-tz-chip"
        aria-label={`Display timezone: ${tz}`}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 h-7 text-[11px] font-medium uppercase tracking-wide text-muted-foreground cursor-help"
      >
        <Clock className="h-3 w-3" aria-hidden />
        <span className="tabular-nums">{short}</span>
      </span>
    </WrapTooltip>
  );
}

// Top-bar pace badge (Task #500). Sibling to the milestone celebrations
// from Task #491 — same source of truth (`useSessionProcessedCount`),
// just always-visible between the 10/25/50 confetti beats so operators
// can feel their pace at a glance. Hidden when count is 0 to keep the
// empty-state header uncluttered.
function SessionPaceBadge() {
  const count = useSessionProcessedCount();
  if (count <= 0) return null;
  // The header session-pace badge always reflects the signed-in
  // user's own session count — never another user's — so wrapping it
  // in `ActivityHoverCard` is safe by the same contract as the
  // sidebar avatar. Open downward from the header (Task #522).
  return (
    <ActivityHoverCard side="bottom" align="end">
      <WrapTooltip
        content={`${count} ${count === 1 ? "claim" : "claims"} processed in this session — hover for your activity history.`}
        side="bottom"
      >
        <span
          data-testid="session-pace-badge"
          aria-label={`${count} processed today`}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 h-7 text-xs font-medium text-muted-foreground cursor-default"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
          <span className="tabular-nums text-foreground">{count}</span>
          <span className="hidden sm:inline">processed today</span>
        </span>
      </WrapTooltip>
    </ActivityHoverCard>
  );
}

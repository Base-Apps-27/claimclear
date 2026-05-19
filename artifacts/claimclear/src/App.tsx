import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation, useParams } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setOnSessionExpired, useGetClaim, getGetClaimQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import type { ComponentType } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout";
import { HistoryTracker } from "@/components/back-bar";
import { AdminTourProvider } from "@/tour/admin-tour";
import Dashboard from "@/pages/dashboard";
import ClaimNew from "@/pages/claim-new";
import InvoiceNew from "@/pages/invoice-new";
import Queue from "@/pages/queue";
import Import from "@/pages/import";
import ErrorTypes from "@/pages/error-types";
import SopFullPageEditor from "@/pages/sop-full-page-editor";
import PortalSubmissions from "@/pages/portal-submissions";
import Insights from "@/pages/insights";
import InvoiceGroupsList from "@/pages/invoice-groups";
import InvoiceGroupDetail from "@/pages/invoice-group-detail";
import Withdrawals from "@/pages/withdrawals";
import ResponsesAwaitingReview from "@/pages/responses-awaiting-review";
import AttestationQueue from "@/pages/attestation-queue";
import Settings from "@/pages/settings";
import AdminUserActivity from "@/pages/admin-user-activity";
import SystemHealth from "@/pages/system-health";
import NotFound from "@/pages/not-found";
import ClerkNotAvailable from "@/pages/clerk-not-available";
import { isClerk } from "@/lib/role";
import { useKonamiDarkMode } from "@/hooks/use-easter-eggs";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error && typeof error === "object" && "status" in error && (error as { status: number }).status === 401) {
          window.location.reload();
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

// Route guard for setup/admin pages — clerks see ClerkNotAvailable
// instead of triggering a 403 cascade from the underlying queries.
function DenyClerk({ component: Component }: { component: ComponentType }) {
  const { user } = useAuth();
  if (isClerk(user)) return <ClerkNotAvailable />;
  return <Component />;
}

// Reset scroll to the top of the document on every route change.
// Without this, navigating from a deeply-scrolled list page (Queue,
// Invoice Groups, Claims) into a different page leaves the new page
// scrolled to whatever offset the previous page had — which especially
// hurts the platform tour, where the operator lands on a page already
// scrolled past the anchor the tour wants to spotlight. Mount-once,
// no UI; runs after each successful navigation.
function ScrollToTopOnRouteChange() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

// Legacy /claims/:id bookmarks: look up the leg's parent invoice group
// and redirect to the group page (the leg's column renders inline there).
// Falls back to the invoice-groups list if the lookup 404s or the leg has
// no group. We don't render any chrome — this is purely a router hop.
function ClaimToGroupRedirect() {
  const params = useParams<{ id: string }>();
  const legId = Number(params.id);
  const enabled = Number.isFinite(legId) && legId > 0;
  const { data: claim, isLoading, isError, error } = useGetClaim(legId, {
    query: { queryKey: getGetClaimQueryKey(legId), enabled },
  });
  if (!enabled) return <Redirect to="/invoice-groups" />;
  if (isLoading) return null;
  // Only fall back to the list on a real 404 / missing-parent case. Transient
  // failures (network, 5xx, auth) should NOT silently drop the deep-link user;
  // surface a small retry instead so they can recover or refresh.
  if (isError) {
    const status =
      (error as { status?: number; response?: { status?: number } } | undefined)?.status ??
      (error as { response?: { status?: number } } | undefined)?.response?.status;
    if (status === 404) return <Redirect to="/invoice-groups" />;
    return (
      <div className="p-6 text-sm" data-testid="claim-redirect-error">
        Couldn't load that leg. <a className="underline" href={window.location.pathname}>Retry</a>{" · "}
        <a className="underline" href="/invoice-groups">Back to invoice groups</a>
      </div>
    );
  }
  const groupId = (claim as { invoiceGroupId?: number | null } | undefined)?.invoiceGroupId;
  return groupId ? <Redirect to={`/invoice-groups/${groupId}`} /> : <Redirect to="/invoice-groups" />;
}

function Router() {
  return (
    <AdminTourProvider>
    <ScrollToTopOnRouteChange />
    <AppLayout>
      <Switch>
        <Route path="/" component={() => <Redirect to="/dashboard" />} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/queue" component={Queue} />
        <Route path="/queue-preview" component={() => <Redirect to="/queue" />} />
        <Route path="/queue-v3" component={() => <Redirect to="/queue" />} />
        <Route path="/queue-mini" component={() => <Redirect to="/queue" />} />
        <Route path="/attestation-queue" component={AttestationQueue} />
        <Route path="/responses-awaiting-review" component={ResponsesAwaitingReview} />
        <Route path="/responses-awaiting-review/:id" component={ResponsesAwaitingReview} />
        <Route path="/review" component={() => <Redirect to="/queue?tab=needs-review" />} />
        <Route path="/invoice-groups" component={InvoiceGroupsList} />
        <Route path="/invoice-groups/:id" component={InvoiceGroupDetail} />
        <Route path="/claims" component={() => <Redirect to="/invoice-groups" />} />
        <Route path="/withdrawals" component={Withdrawals} />
        <Route path="/claims/new" component={ClaimNew} />
        <Route path="/invoices/new" component={() => <DenyClerk component={InvoiceNew} />} />
        <Route path="/claims/:id" component={ClaimToGroupRedirect} />
        <Route path="/import" component={() => <DenyClerk component={Import} />} />
        <Route path="/error-types" component={() => <DenyClerk component={ErrorTypes} />} />
        <Route path="/admin/sops/:errorTypeId/edit" component={() => <DenyClerk component={SopFullPageEditor} />} />
        <Route path="/portal-submissions" component={PortalSubmissions} />
        <Route path="/insights" component={Insights} />
        <Route path="/summary" component={() => <Redirect to="/insights" />} />
        <Route path="/settings" component={() => <DenyClerk component={Settings} />} />
        <Route path="/admin/users/activity" component={() => <DenyClerk component={AdminUserActivity} />} />
        <Route path="/system-health" component={() => <DenyClerk component={SystemHealth} />} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
    </AdminTourProvider>
  );
}

function SessionInterceptor() {
  const { clearAuth } = useAuth();
  useEffect(() => {
    setOnSessionExpired(() => clearAuth());
    return () => setOnSessionExpired(null);
  }, [clearAuth]);
  return null;
}

// Expose the shared QueryClient on `window` so the Playwright walk
// harness can drive cache invalidation from inside `page.evaluate`
// without round-tripping through the URL or React state. This mirrors
// the SSE-driven `useInvoiceGroupEvents` invalidation that the harness
// intentionally aborts to stay hermetic — see scenario-25
// (`25-claim-withdrawn-elsewhere.ts`) for the canonical caller. The
// hook is harmless in production: it's a single property assignment
// on `window` and the QueryClient is already a long-lived singleton.
if (typeof window !== "undefined") {
  (window as unknown as { __ccQueryClient?: QueryClient }).__ccQueryClient =
    queryClient;
}

function App() {
  // Easter egg (Task #494): Konami code (↑↑↓↓←→←→BA) toggles dark
  // mode. Mount-once, no UI; silently no-ops while typing in inputs
  // and on any error so the gag can never break a real interaction.
  useKonamiDarkMode();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <SessionInterceptor />
          {/* Tracks in-app navigations so the BackBar can decide between
              window.history.back() (true N-1) and a logical-parent fallback
              for deep-link landings. Mount-once, no UI. */}
          <HistoryTracker />
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setOnSessionExpired } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import type { ComponentType } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout";
import { HistoryTracker } from "@/components/back-bar";
import { AdminTourProvider } from "@/tour/admin-tour";
import Dashboard from "@/pages/dashboard";
import ClaimsList from "@/pages/claims";
import ClaimDetail from "@/pages/claim-detail";
import ClaimNew from "@/pages/claim-new";
import Queue from "@/pages/queue";
import Import from "@/pages/import";
import ErrorTypes from "@/pages/error-types";
import PortalSubmissions from "@/pages/portal-submissions";
import Insights from "@/pages/insights";
import InvoiceGroupsList from "@/pages/invoice-groups";
import InvoiceGroupDetail from "@/pages/invoice-group-detail";
import Withdrawals from "@/pages/withdrawals";
import AttestationQueue from "@/pages/attestation-queue";
import ResponsesAwaitingReview from "@/pages/responses-awaiting-review";
import Settings from "@/pages/settings";
import AdminUserActivity from "@/pages/admin-user-activity";
import SystemHealth from "@/pages/system-health";
import NotFound from "@/pages/not-found";
import ClerkNotAvailable from "@/pages/clerk-not-available";
import { isClerk } from "@/lib/role";

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

function Router() {
  return (
    <AdminTourProvider>
    <ScrollToTopOnRouteChange />
    <AppLayout>
      <Switch>
        <Route path="/" component={() => <Redirect to="/dashboard" />} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/queue" component={Queue} />
        <Route path="/attestation-queue" component={AttestationQueue} />
        <Route path="/responses-awaiting-review" component={ResponsesAwaitingReview} />
        <Route path="/responses-awaiting-review/:id" component={ResponsesAwaitingReview} />
        <Route path="/review" component={() => <Redirect to="/queue?tab=needs-review" />} />
        <Route path="/invoice-groups" component={InvoiceGroupsList} />
        <Route path="/invoice-groups/:id" component={InvoiceGroupDetail} />
        <Route path="/claims" component={ClaimsList} />
        <Route path="/withdrawals" component={Withdrawals} />
        <Route path="/claims/new" component={ClaimNew} />
        <Route path="/claims/:id" component={ClaimDetail} />
        <Route path="/import" component={() => <DenyClerk component={Import} />} />
        <Route path="/error-types" component={() => <DenyClerk component={ErrorTypes} />} />
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

function App() {
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

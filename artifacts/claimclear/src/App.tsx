import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setOnSessionExpired } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout";
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
import Settings from "@/pages/settings";
import AdminUserActivity from "@/pages/admin-user-activity";
import SystemHealth from "@/pages/system-health";
import NotFound from "@/pages/not-found";

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

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={() => <Redirect to="/dashboard" />} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/queue" component={Queue} />
        <Route path="/attestation-queue" component={AttestationQueue} />
        <Route path="/review" component={() => <Redirect to="/queue?tab=needs-review" />} />
        <Route path="/invoice-groups" component={InvoiceGroupsList} />
        <Route path="/invoice-groups/:id" component={InvoiceGroupDetail} />
        <Route path="/claims" component={ClaimsList} />
        <Route path="/withdrawals" component={Withdrawals} />
        <Route path="/claims/new" component={ClaimNew} />
        <Route path="/claims/:id" component={ClaimDetail} />
        <Route path="/import" component={Import} />
        <Route path="/error-types" component={ErrorTypes} />
        <Route path="/portal-submissions" component={PortalSubmissions} />
        <Route path="/insights" component={Insights} />
        <Route path="/summary" component={() => <Redirect to="/insights" />} />
        <Route path="/settings" component={Settings} />
        <Route path="/admin/users/activity" component={AdminUserActivity} />
        <Route path="/system-health" component={SystemHealth} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
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
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

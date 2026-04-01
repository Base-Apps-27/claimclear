import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import Summary from "@/pages/summary";
import Settings from "@/pages/settings";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={() => <Redirect to="/dashboard" />} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/queue" component={Queue} />
        <Route path="/claims" component={ClaimsList} />
        <Route path="/claims/new" component={ClaimNew} />
        <Route path="/claims/:id" component={ClaimDetail} />
        <Route path="/import" component={Import} />
        <Route path="/error-types" component={ErrorTypes} />
        <Route path="/portal-submissions" component={PortalSubmissions} />
        <Route path="/summary" component={Summary} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

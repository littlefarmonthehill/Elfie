import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useServiceWorker } from "@/hooks/use-service-worker";
import { useAuth } from "@/hooks/useAuth";
import Home from "@/pages/home";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import PendingApproval from "@/pages/pending-approval";
import PlatformAdmin from "@/pages/platform-admin";
import NotFound from "@/pages/not-found";

function Router() {
  const { isAuthenticated, isApproved, isLoading, superAdmin } = useAuth();

  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />

      <Route path="/platform-admin">
        {isLoading ? (
          <div className="min-h-screen flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-4">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          </div>
        ) : !isAuthenticated || !superAdmin ? (
          <Redirect to="/" />
        ) : (
          <PlatformAdmin />
        )}
      </Route>

      <Route path="/admin">
        <Redirect to="/" />
      </Route>

      <Route path="/">
        {isLoading ? (
          <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-lego-red/20">
            <div className="flex flex-col items-center gap-4">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-lego-blue border-t-transparent" />
              <p className="text-sm text-gray-400">Loading...</p>
            </div>
          </div>
        ) : !isAuthenticated ? (
          <Redirect to="/login" />
        ) : !isApproved ? (
          <PendingApproval />
        ) : (
          <Home />
        )}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useServiceWorker();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useServiceWorker } from "@/hooks/use-service-worker";
import { useAuth } from "@/hooks/useAuth";
import { useSSE } from "@/hooks/use-sse";
import Home from "@/pages/home";
import Signup from "@/pages/signup";
import Landing from "@/pages/landing";
import PendingApproval from "@/pages/pending-approval";
import PlatformAdmin from "@/pages/platform-admin";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";

// Thin wrapper: mounts the SSE connection only for fully authenticated users.
// useSSE() opens a persistent /api/events connection so every team member's
// browser receives live cache-invalidation signals when another user makes a change.
function AuthenticatedHome() {
  useSSE();
  return <Home />;
}

function Router() {
  const { isAuthenticated, isApproved, isLoading, superAdmin } = useAuth();

  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/landing" component={Landing} />
      <Route path="/signup" component={Signup} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />

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
          <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-950 via-indigo-950 to-gray-950">
            <div className="flex flex-col items-center gap-4">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
            </div>
          </div>
        ) : !isAuthenticated ? (
          <Landing />
        ) : !isApproved ? (
          <PendingApproval />
        ) : (
          <AuthenticatedHome />
        )}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useServiceWorker();

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;

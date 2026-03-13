import { lazy, Suspense } from "react";
import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useServiceWorker } from "@/hooks/use-service-worker";
import { useAuth } from "@/hooks/useAuth";
import Landing from "@/pages/landing";
import NotFound from "@/pages/not-found";

const Home = lazy(() => import("@/pages/home"));
const Signup = lazy(() => import("@/pages/signup"));
const PendingApproval = lazy(() => import("@/pages/pending-approval"));
const PlatformAdmin = lazy(() => import("@/pages/platform-admin"));

function Router() {
  const { isAuthenticated, isApproved, isLoading, superAdmin } = useAuth();

  return (
    <Switch>
      <Route path="/login"><Redirect to="/" /></Route>
      <Route path="/landing" component={Landing} />
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
          <Home />
        )}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

const LazyFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-950 via-indigo-950 to-gray-950">
    <div className="flex flex-col items-center gap-4">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
    </div>
  </div>
);

function App() {
  useServiceWorker();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Suspense fallback={<LazyFallback />}>
          <Router />
        </Suspense>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

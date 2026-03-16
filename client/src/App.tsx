import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useServiceWorker } from "@/hooks/use-service-worker";
import { useAuth } from "@/hooks/useAuth";
import Home from "@/pages/home";
import Signup from "@/pages/signup";
import Landing from "@/pages/landing";
import PendingApproval from "@/pages/pending-approval";
import PlatformAdmin from "@/pages/platform-admin";
import NotFound from "@/pages/not-found";

function SpinnerScreen({ dark }: { dark?: boolean }) {
  return (
    <div className={`min-h-screen flex items-center justify-center ${dark ? "bg-gradient-to-br from-purple-950 via-indigo-950 to-gray-950" : "bg-background"}`}>
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
    </div>
  );
}

function StartupScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-950 via-indigo-950 to-gray-950">
      <div className="flex flex-col items-center gap-6 text-center px-4">
        <div className="h-14 w-14 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
        <div className="flex flex-col gap-2">
          <p className="text-white text-lg font-semibold">E.L.F.I.E. is warming up</p>
          <p className="text-purple-300 text-sm">Running startup checks — this takes about a minute after a fresh deploy.</p>
        </div>
      </div>
    </div>
  );
}

function useServerReady(enabled: boolean) {
  const { data } = useQuery<{ ready: boolean }>({
    queryKey: ["/api/ready"],
    enabled,
    refetchInterval: (query) => (query.state.data?.ready ? false : 2000),
    retry: false,
    staleTime: 0,
    queryFn: async () => {
      const res = await fetch("/api/ready", { credentials: "include" });
      if (!res.ok) return { ready: false };
      return res.json();
    },
  });
  return data?.ready === true;
}

function Router() {
  const { isAuthenticated, isApproved, isLoading, superAdmin } = useAuth();

  // Poll /api/ready only when the user is logged in — unauthenticated users
  // land on the public landing page which needs no data routes.
  const serverReady = useServerReady(!isLoading && isAuthenticated);

  if (isLoading) {
    return <SpinnerScreen dark />;
  }

  // Authenticated but server still initializing migrations — show startup screen
  // instead of loading an app full of 503 empty states.
  if (isAuthenticated && !serverReady) {
    return <StartupScreen />;
  }

  return (
    <Switch>
      <Route path="/login"><Redirect to="/" /></Route>
      <Route path="/landing" component={Landing} />
      <Route path="/signup" component={Signup} />

      <Route path="/platform-admin">
        {!isAuthenticated || !superAdmin ? (
          <Redirect to="/" />
        ) : (
          <PlatformAdmin />
        )}
      </Route>

      <Route path="/admin">
        <Redirect to="/" />
      </Route>

      <Route path="/">
        {!isAuthenticated ? (
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

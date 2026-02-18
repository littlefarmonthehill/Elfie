import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useServiceWorker } from "@/hooks/use-service-worker";
import { useAuth } from "@/hooks/useAuth";
import Home from "@/pages/home";
import Landing from "@/pages/landing";
import Shop from "@/pages/shop";
import Events from "@/pages/events";
import Deals from "@/pages/deals";
import Community from "@/pages/community";
import Search from "@/pages/search";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import PendingApproval from "@/pages/pending-approval";
import NotFound from "@/pages/not-found";

// Email/Password Authentication with Role-Based Routing
function Router() {
  const { isAuthenticated, isApproved, isLoading, isAdmin } = useAuth();

  return (
    <Switch>
      {/* Public routes - anyone can access (render immediately without waiting for auth) */}
      <Route path="/showroom" component={Shop} />
      <Route path="/events" component={Events} />
      <Route path="/deals" component={Deals} />
      <Route path="/community" component={Community} />
      <Route path="/search" component={Search} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />

      {/* Protected routes - show loading while checking authentication */}
      <Route path="/admin">
        {isLoading ? (
          <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-lego-red/20">
            <div className="flex flex-col items-center gap-4">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-lego-blue border-t-transparent" />
              <p className="text-sm text-gray-400">Loading...</p>
            </div>
          </div>
        ) : (
          <Home />
        )}
      </Route>

      {/* Landing page - public */}
      <Route path="/home">
        <Landing />
      </Route>

      {/* Root route - redirect to showroom as the new home page */}
      <Route path="/">
        {isLoading ? (
          <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-lego-red/20">
            <div className="flex flex-col items-center gap-4">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-lego-blue border-t-transparent" />
              <p className="text-sm text-gray-400">Loading...</p>
            </div>
          </div>
        ) : !isAuthenticated ? (
          <Redirect to="/showroom" />
        ) : !isApproved ? (
          <PendingApproval />
        ) : isAdmin ? (
          <Redirect to="/admin" />
        ) : (
          <Redirect to="/showroom" />
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

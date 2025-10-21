import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useServiceWorker } from "@/hooks/use-service-worker";
import { useAuth } from "@/hooks/useAuth";
import Home from "@/pages/home";
import Shop from "@/pages/shop";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import PendingApproval from "@/pages/pending-approval";
import NotFound from "@/pages/not-found";

// Email/Password Authentication with Role-Based Routing
function Router() {
  const { isAuthenticated, isApproved, isLoading, isAdmin } = useAuth();

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-lego-red/20">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-lego-blue border-t-transparent" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <Switch>
      {/* Public routes - anyone can access */}
      <Route path="/shop" component={Shop} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />

      {!isAuthenticated ? (
        <>
          {/* Not logged in - redirect to shop */}
          <Route path="/">
            <Redirect to="/shop" />
          </Route>
        </>
      ) : !isApproved ? (
        <>
          {/* Logged in but not approved - show pending approval page */}
          <Route path="/" component={PendingApproval} />
          <Route path="/admin">
            <Redirect to="/" />
          </Route>
        </>
      ) : (
        <>
          {/* Logged in and approved - role-based routing */}
          {isAdmin ? (
            <>
              {/* Admin/Employee routes */}
              <Route path="/admin" component={Home} />
              <Route path="/">
                <Redirect to="/admin" />
              </Route>
            </>
          ) : (
            <>
              {/* Customer routes */}
              <Route path="/">
                <Redirect to="/shop" />
              </Route>
              <Route path="/admin">
                <Redirect to="/shop" />
              </Route>
            </>
          )}
        </>
      )}
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

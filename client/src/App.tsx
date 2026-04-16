import { Switch, Route, Redirect } from "wouter";
import { useState, useCallback } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useServiceWorker } from "@/hooks/use-service-worker";
import { useAuth } from "@/hooks/useAuth";
import { useSSE } from "@/hooks/use-sse";
import { useHardwareScanner } from "@/hooks/use-hardware-scanner";
import { WarehouseScanPanel } from "@/components/WarehouseScanPanel";
import Home from "@/pages/home";
import Signup from "@/pages/signup";
import Landing from "@/pages/landing";
import PendingApproval from "@/pages/pending-approval";
import PlatformAdmin from "@/pages/platform-admin";
import PlatformPage from "@/pages/platform";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";

// Thin wrapper: mounts SSE + global hardware scanner listener.
// useSSE() opens a persistent /api/events connection so every team member's
// browser receives live cache-invalidation signals when another user makes a change.
// useHardwareScanner intercepts BIN:/LOT: codes from a barcode scanner anywhere in the app.
function AuthenticatedHome() {
  useSSE();
  const [scanPanelOpen, setScanPanelOpen] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | undefined>();

  const handleScan = useCallback((code: string) => {
    const upper = code.toUpperCase();
    if (upper.startsWith("BIN:") || upper.startsWith("LOT:")) {
      setPendingCode(code);
      setScanPanelOpen(true);
    }
  }, []);

  useHardwareScanner({ onScan: handleScan, disabled: scanPanelOpen });

  return (
    <>
      <Home />
      {scanPanelOpen && (
        <WarehouseScanPanel
          initialCode={pendingCode}
          onClose={() => { setScanPanelOpen(false); setPendingCode(undefined); }}
        />
      )}
    </>
  );
}

function Router() {
  const { isAuthenticated, isApproved, isLoading, superAdmin, user } = useAuth();
  const isPureSuperAdmin = superAdmin && !(user as any)?.orgId;

  const loadingScreen = (color = '#7C3AED') => (
    <div className="min-h-screen flex items-center justify-center bg-[#04080F]">
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-t-transparent" style={{ borderColor: color, borderTopColor: 'transparent' }} />
      </div>
    </div>
  );

  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/landing" component={Landing} />
      <Route path="/signup" component={Signup} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />

      <Route path="/platform">
        {isLoading ? loadingScreen('#9B5DE5') : !isAuthenticated || !superAdmin ? (
          <Redirect to="/" />
        ) : (
          <PlatformPage />
        )}
      </Route>

      <Route path="/platform-admin">
        {isLoading ? loadingScreen() : !isAuthenticated || !superAdmin ? (
          <Redirect to="/" />
        ) : (
          <PlatformAdmin />
        )}
      </Route>

      <Route path="/admin">
        <Redirect to="/" />
      </Route>

      <Route path="/">
        {isLoading ? loadingScreen() : !isAuthenticated ? (
          <Landing />
        ) : !isApproved ? (
          <PendingApproval />
        ) : isPureSuperAdmin ? (
          <Redirect to="/platform" />
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

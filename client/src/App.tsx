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
import { ScanSessionProvider, useScanSession } from "@/contexts/ScanSessionContext";
import DetailModal, { DetailData } from "@/components/DetailModal";
import { useToast } from "@/hooks/use-toast";
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
//
// Default scan behavior:
//   - LOT:<id>  → opens the Inventory Detail modal for that lot
//   - BIN:<name> → opens the Bin Detail modal for that bin
function AuthenticatedHome() {
  return (
    <ScanSessionProvider>
      <AuthenticatedHomeInner />
    </ScanSessionProvider>
  );
}

function AuthenticatedHomeInner() {
  useSSE();
  const { toast } = useToast();
  const { active: scanSessionActive } = useScanSession();
  const [scanDetail, setScanDetail] = useState<{ open: boolean; data: DetailData | null }>({
    open: false,
    data: null,
  });

  const closeScanDetail = useCallback(() => setScanDetail({ open: false, data: null }), []);

  const openInventoryById = useCallback(async (id: number | string) => {
    setScanDetail({
      open: true,
      data: { type: "inventory", data: { id, loading: true } as any },
    });
    try {
      const invRes = await fetch(`/api/inventory/${id}`);
      if (!invRes.ok) return;
      const inventoryData = await invRes.json();
      setScanDetail({
        open: true,
        data: { type: "inventory", data: { ...inventoryData, loadingPriceOMagic: true } },
      });
      const params = new URLSearchParams();
      if (inventoryData.colorId) params.append("color_id", String(inventoryData.colorId));
      if (inventoryData.newOrUsed) params.append("new_or_used", inventoryData.newOrUsed);
      const priceUrl = `/api/inventory/price-guide/${inventoryData.itemNo}/${inventoryData.itemType}${params.toString() ? `?${params}` : ""}`;
      const priceRes = await fetch(priceUrl);
      const priceOMagic = priceRes.ok ? await priceRes.json() : null;
      setScanDetail({
        open: true,
        data: { type: "inventory", data: { ...inventoryData, priceOMagic, loadingPriceOMagic: false } },
      });
    } catch { /* keep current state */ }
  }, []);

  const handleScanItemClick = useCallback((type: 'order' | 'inventory', id: number | string) => {
    if (type === 'inventory') openInventoryById(id);
  }, [openInventoryById]);

  const handleScan = useCallback(async (code: string) => {
    const upper = code.toUpperCase();
    if (!(upper.startsWith("BIN:") || upper.startsWith("LOT:"))) return;

    try {
      const res = await fetch(`/api/warehouse/scan/resolve?code=${encodeURIComponent(code)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Scan not recognized" }));
        toast({ title: "Scan failed", description: err.error ?? "Not found", variant: "destructive" });
        return;
      }
      const resolved = await res.json();

      if (resolved.type === "bin") {
        setScanDetail({
          open: true,
          data: {
            type: "bin",
            data: {
              binId: resolved.id,
              name: resolved.name,
              shelfName: resolved.shelfName,
              aisleName: resolved.aisleName,
              itemCount: resolved.itemCount,
            },
          },
        });
        return;
      }

      if (resolved.type === "lot") {
        await openInventoryById(resolved.id);
      }
    } catch {
      toast({ title: "Scan failed", description: "Network error", variant: "destructive" });
    }
  }, [toast, openInventoryById]);

  useHardwareScanner({ onScan: handleScan, disabled: scanDetail.open || scanSessionActive });

  return (
    <>
      <Home />
      <DetailModal
        open={scanDetail.open}
        onClose={closeScanDetail}
        detail={scanDetail.data}
        onItemClick={handleScanItemClick}
      />
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

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  CalendarClock,
  SlidersHorizontal,
  X,
  ChevronRight,
  ShoppingCart,
  Package,
  Globe,
  Activity,
} from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";

interface OrderSyncPanelProps {
  onOpenSettings?: (section?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'billing') => void;
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function SyncStatusIcon({ status }: { status?: string }) {
  if (status === 'success') return <CheckCircle2 className="w-2.5 h-2.5" />;
  if (status === 'partial') return <AlertTriangle className="w-2.5 h-2.5" />;
  if (status === 'error' || status === 'failed') return <XCircle className="w-2.5 h-2.5" />;
  if (status === 'in_progress') return <Loader2 className="w-2.5 h-2.5 animate-spin" />;
  return <Clock className="w-2.5 h-2.5" />;
}

function statusColor(status?: string) {
  if (status === 'success') return 'text-green-400';
  if (status === 'partial') return 'text-yellow-400';
  if (status === 'error' || status === 'failed') return 'text-red-400';
  if (status === 'in_progress') return 'text-blue-400';
  return 'text-gray-500';
}

export default function OrderSyncPanel({ onOpenSettings }: OrderSyncPanelProps) {
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: syncStatuses } = useQuery<any>({
    queryKey: ['/api/sync/statuses'],
    refetchInterval: 15000,
  });

  const { data: orderSyncStatus } = useQuery<any>({
    queryKey: ['/api/order-sync/status'],
    refetchInterval: 30000,
  });

  const blMeta = syncStatuses?.bricklink_orders;
  const boMeta = syncStatuses?.brickowl_orders;

  const isRunning = syncStatuses?.running?.bricklink_orders || syncStatuses?.running?.brickowl_orders ||
    blMeta?.lastSyncStatus === 'in_progress' || boMeta?.lastSyncStatus === 'in_progress';

  const prevIsRunningRef = useRef(isRunning);
  useEffect(() => {
    const wasRunning = prevIsRunningRef.current;
    prevIsRunningRef.current = isRunning;
    if (wasRunning && !isRunning) {
      queryClient.invalidateQueries({ queryKey: ['/api/sync/statuses'] });
      queryClient.invalidateQueries({ queryKey: ['/api/order-sync/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders/stats'] });
    }
  }, [isRunning]);

  const blSyncMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/sync/bricklink/orders', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sync/statuses'] });
      toast({ title: 'BrickLink order sync started', description: 'Orders are syncing in the background.' });
    },
    onError: (err: any) => {
      toast({ title: 'Sync failed', description: err?.message || 'Could not start BrickLink order sync.', variant: 'destructive' });
    },
  });

  const boSyncMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/sync/brickowl/orders', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sync/statuses'] });
      toast({ title: 'BrickOwl order sync started', description: 'Orders are syncing in the background.' });
    },
    onError: (err: any) => {
      toast({ title: 'Sync failed', description: err?.message || 'Could not start BrickOwl order sync.', variant: 'destructive' });
    },
  });

  const allSyncMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/sync/all-platforms/orders', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sync/statuses'] });
      toast({ title: 'Order sync started', description: 'Syncing orders from all platforms.' });
    },
    onError: (err: any) => {
      toast({ title: 'Sync failed', description: err?.message || 'Could not start order sync.', variant: 'destructive' });
    },
  });

  const isSyncing = blSyncMutation.isPending || boSyncMutation.isPending || allSyncMutation.isPending || isRunning;

  const latestSyncTime = (() => {
    const times = [blMeta?.lastSyncTime, boMeta?.lastSyncTime].filter(Boolean);
    if (!times.length) return null;
    return times.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  })();

  const overallStatus = (() => {
    const statuses = [blMeta?.lastSyncStatus, boMeta?.lastSyncStatus].filter(Boolean);
    if (statuses.some(s => s === 'in_progress')) return 'in_progress';
    if (statuses.some(s => s === 'error' || s === 'failed')) return 'error';
    if (statuses.some(s => s === 'partial')) return 'partial';
    if (statuses.every(s => s === 'success')) return 'success';
    if (statuses.some(s => s === 'success')) return 'partial';
    return undefined;
  })();

  const summary = orderSyncStatus?.summary;
  const platforms = orderSyncStatus?.platforms ?? [];

  return (
    <>
      <button
        onClick={() => setDrawerOpen(true)}
        className="w-full text-left rounded-lg border border-blue-500/40 bg-gradient-to-br from-blue-950/50 to-gray-950/70 p-3 space-y-2 hover-elevate"
        data-testid="order-sync-panel"
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="text-xs font-semibold text-blue-100">Order Sync</span>
            {isRunning && (
              <span className="flex items-center gap-1 text-[10px] text-blue-400">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                syncing…
              </span>
            )}
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {summary && (
            <span className="text-[10px] text-gray-400">
              <span className="text-white font-mono font-semibold">{summary.totalOrders?.toLocaleString() ?? '—'}</span>
              {' '}orders
            </span>
          )}
          {summary?.pendingOrders > 0 && (
            <span className="text-[10px] text-gray-400">
              <span className="text-orange-300 font-mono font-semibold">{summary.pendingOrders.toLocaleString()}</span>
              {' '}pending
            </span>
          )}
          {overallStatus ? (
            <span className={`flex items-center gap-1 text-[10px] ${statusColor(overallStatus)}`}>
              <SyncStatusIcon status={overallStatus} />
              {overallStatus === 'success' ? 'Up to date' :
               overallStatus === 'in_progress' ? 'Syncing…' :
               overallStatus === 'error' ? 'Sync error' :
               overallStatus === 'partial' ? 'Partial sync' : overallStatus}
              {latestSyncTime && (
                <span className="text-gray-500 ml-0.5">· {relTime(latestSyncTime)}</span>
              )}
            </span>
          ) : (
            <span className="text-[10px] text-gray-500">Never synced</span>
          )}
        </div>
      </button>

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent className="bg-gray-950 border-gray-800 h-[75vh] flex flex-col rounded-t-2xl">
          <DrawerHeader className="p-0 flex-shrink-0">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-600" />
            </div>
            <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-gray-800">
              <ShoppingCart className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <DrawerTitle className="text-sm font-semibold text-gray-100 flex-1">
                Order Sync
              </DrawerTitle>
              <DrawerClose
                className="ml-2 text-gray-500 hover:text-gray-200 transition-colors"
                data-testid="button-close-order-sync-drawer"
              >
                <X className="w-5 h-5" />
                <span className="sr-only">Close</span>
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto min-h-0 px-4 pt-3 pb-6 space-y-4">
            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="secondary"
                disabled={isSyncing}
                onClick={() => allSyncMutation.mutate()}
                data-testid="button-order-sync-all"
              >
                {isSyncing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                )}
                {isRunning ? 'Syncing…' : 'Sync All'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setDrawerOpen(false); onOpenSettings?.('automation'); }}
                data-testid="button-order-sync-schedule"
              >
                <CalendarClock className="w-3.5 h-3.5 mr-1.5" />
                Schedule
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setDrawerOpen(false); onOpenSettings?.('platforms'); }}
                data-testid="button-order-sync-settings"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
                Settings
              </Button>
            </div>

            <Separator className="bg-gray-700/60" />

            {/* Per-platform status */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 px-0.5">Platforms</p>

              {/* BrickLink */}
              <div className="rounded-lg border border-gray-700/60 bg-gray-900/50 p-3 space-y-2" data-testid="order-sync-bricklink">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Package className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                    <span className="text-xs font-semibold text-gray-100">BrickLink</span>
                    {blMeta?.lastSyncStatus === 'in_progress' && (
                      <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px] px-2"
                    disabled={isSyncing}
                    onClick={() => blSyncMutation.mutate()}
                    data-testid="button-order-sync-bricklink"
                  >
                    {blSyncMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                    ) : (
                      <RefreshCw className="w-3 h-3 mr-1" />
                    )}
                    Sync
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Orders', value: platforms.find((p: any) => p.name === 'BrickLink')?.stats?.totalOrders },
                    { label: 'Pending', value: platforms.find((p: any) => p.name === 'BrickLink')?.stats?.pendingOrders },
                    { label: 'Items', value: platforms.find((p: any) => p.name === 'BrickLink')?.stats?.totalItems },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded bg-gray-800/60 px-2 py-1.5 text-center">
                      <p className="text-base font-mono font-bold text-orange-300">
                        {value != null ? Number(value).toLocaleString() : '—'}
                      </p>
                      <p className="text-[9px] text-gray-500 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
                {blMeta && (
                  <div className={`flex items-center gap-1.5 text-[10px] ${statusColor(blMeta.lastSyncStatus)}`}>
                    <SyncStatusIcon status={blMeta.lastSyncStatus} />
                    <span>
                      {blMeta.lastSyncStatus === 'success' ? `+${blMeta.recordsAdded ?? 0} added` :
                       blMeta.lastSyncStatus === 'in_progress' ? 'Syncing…' :
                       blMeta.errorMessage ?? blMeta.lastSyncStatus ?? 'Unknown'}
                    </span>
                    {blMeta.lastSyncTime && (
                      <span className="text-gray-500 ml-0.5">· {relTime(blMeta.lastSyncTime)}</span>
                    )}
                  </div>
                )}
                {!blMeta && (
                  <p className="text-[10px] text-gray-500">Never synced</p>
                )}
              </div>

              {/* BrickOwl */}
              <div className="rounded-lg border border-gray-700/60 bg-gray-900/50 p-3 space-y-2" data-testid="order-sync-brickowl">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span className="text-xs font-semibold text-gray-100">BrickOwl</span>
                    {boMeta?.lastSyncStatus === 'in_progress' && (
                      <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px] px-2"
                    disabled={isSyncing}
                    onClick={() => boSyncMutation.mutate()}
                    data-testid="button-order-sync-brickowl"
                  >
                    {boSyncMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                    ) : (
                      <RefreshCw className="w-3 h-3 mr-1" />
                    )}
                    Sync
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Orders', value: platforms.find((p: any) => p.name === 'BrickOwl')?.stats?.totalOrders },
                    { label: 'Pending', value: platforms.find((p: any) => p.name === 'BrickOwl')?.stats?.pendingOrders },
                    { label: 'Items', value: platforms.find((p: any) => p.name === 'BrickOwl')?.stats?.totalItems },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded bg-gray-800/60 px-2 py-1.5 text-center">
                      <p className="text-base font-mono font-bold text-cyan-300">
                        {value != null ? Number(value).toLocaleString() : '—'}
                      </p>
                      <p className="text-[9px] text-gray-500 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
                {boMeta && (
                  <div className={`flex items-center gap-1.5 text-[10px] ${statusColor(boMeta.lastSyncStatus)}`}>
                    <SyncStatusIcon status={boMeta.lastSyncStatus} />
                    <span>
                      {boMeta.lastSyncStatus === 'success' ? `+${boMeta.recordsAdded ?? 0} added` :
                       boMeta.lastSyncStatus === 'in_progress' ? 'Syncing…' :
                       boMeta.errorMessage ?? boMeta.lastSyncStatus ?? 'Unknown'}
                    </span>
                    {boMeta.lastSyncTime && (
                      <span className="text-gray-500 ml-0.5">· {relTime(boMeta.lastSyncTime)}</span>
                    )}
                  </div>
                )}
                {!boMeta && (
                  <p className="text-[10px] text-gray-500">Never synced</p>
                )}
              </div>
            </div>

            <Separator className="bg-gray-700/60" />

            {/* What this sync does */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 px-0.5">About This Sync</p>
              <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 p-3 space-y-1.5">
                {[
                  { icon: ShoppingCart, text: 'Pulls new and updated orders from BrickLink and BrickOwl into E.L.F.I.E.' },
                  { icon: Activity,     text: 'Detects status changes, new items, and payment updates' },
                  { icon: Package,      text: 'Powers the fulfillment queue and shipped orders views' },
                ].map(({ icon: Icon, text }, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Icon className="w-3 h-3 text-blue-400/70 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-gray-400">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

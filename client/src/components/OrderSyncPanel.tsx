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

type Platform = 'bricklink' | 'brickowl';

interface OrderSyncPanelProps {
  platform: Platform;
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

function statusColor(status?: string) {
  if (status === 'success') return 'text-green-400';
  if (status === 'partial') return 'text-yellow-400';
  if (status === 'error' || status === 'failed') return 'text-red-400';
  if (status === 'in_progress') return 'text-blue-400';
  return 'text-gray-500';
}

function StatusIcon({ status, className }: { status?: string; className?: string }) {
  const cls = className ?? 'w-2.5 h-2.5';
  if (status === 'success') return <CheckCircle2 className={cls} />;
  if (status === 'partial') return <AlertTriangle className={cls} />;
  if (status === 'error' || status === 'failed') return <XCircle className={cls} />;
  if (status === 'in_progress') return <Loader2 className={`${cls} animate-spin`} />;
  return <Clock className={cls} />;
}

const PLATFORM_CONFIG: Record<Platform, {
  label: string;
  syncId: string;
  syncRoute: string;
  Icon: React.ElementType;
  accentText: string;
  accentBorder: string;
  accentBg: string;
  accentIcon: string;
  testId: string;
}> = {
  bricklink: {
    label: 'BrickLink',
    syncId: 'bricklink_orders',
    syncRoute: '/api/sync/bricklink/orders',
    Icon: Package,
    accentText: 'text-orange-100',
    accentBorder: 'border-orange-500/40',
    accentBg: 'from-orange-950/50 to-gray-950/70',
    accentIcon: 'text-orange-400',
    testId: 'order-sync-bricklink-panel',
  },
  brickowl: {
    label: 'BrickOwl',
    syncId: 'brickowl_orders',
    syncRoute: '/api/sync/brickowl/orders',
    Icon: Globe,
    accentText: 'text-cyan-100',
    accentBorder: 'border-cyan-500/40',
    accentBg: 'from-cyan-950/50 to-gray-950/70',
    accentIcon: 'text-cyan-400',
    testId: 'order-sync-brickowl-panel',
  },
};

export default function OrderSyncPanel({ platform, onOpenSettings }: OrderSyncPanelProps) {
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const cfg = PLATFORM_CONFIG[platform];

  const { data: syncStatuses } = useQuery<any>({
    queryKey: ['/api/sync/statuses'],
    refetchInterval: 15000,
  });

  const { data: orderSyncStatus } = useQuery<any>({
    queryKey: ['/api/order-sync/status'],
    refetchInterval: 30000,
  });

  const meta = syncStatuses?.[cfg.syncId];
  const isRunning = meta?.lastSyncStatus === 'in_progress' ||
    syncStatuses?.running?.[cfg.syncId];

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

  const syncMutation = useMutation({
    mutationFn: () => apiRequest('POST', cfg.syncRoute, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sync/statuses'] });
      toast({ title: `${cfg.label} order sync started`, description: 'Orders are syncing in the background.' });
    },
    onError: (err: any) => {
      toast({ title: 'Sync failed', description: err?.message || `Could not start ${cfg.label} order sync.`, variant: 'destructive' });
    },
  });

  const isSyncing = syncMutation.isPending || isRunning;

  const platformData = orderSyncStatus?.platforms?.find((p: any) => p.name === cfg.label);
  const stats = platformData?.stats;

  const Icon = cfg.Icon;

  return (
    <>
      <button
        onClick={() => setDrawerOpen(true)}
        className={`w-full text-left rounded-lg border ${cfg.accentBorder} bg-gradient-to-br ${cfg.accentBg} p-3 space-y-2 hover-elevate`}
        data-testid={cfg.testId}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Icon className={`w-3.5 h-3.5 ${cfg.accentIcon} shrink-0`} />
            <span className={`text-xs font-semibold ${cfg.accentText}`}>{cfg.label} — Orders</span>
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
          {stats != null && (
            <span className="text-[10px] text-gray-400">
              <span className="text-white font-mono font-semibold">{Number(stats.totalOrders).toLocaleString()}</span>
              {' '}orders
            </span>
          )}
          {stats?.pendingOrders > 0 && (
            <span className="text-[10px] text-gray-400">
              <span className="text-orange-300 font-mono font-semibold">{Number(stats.pendingOrders).toLocaleString()}</span>
              {' '}pending
            </span>
          )}
          {meta ? (
            <span className={`flex items-center gap-1 text-[10px] ${statusColor(meta.lastSyncStatus)}`}>
              <StatusIcon status={meta.lastSyncStatus} />
              {meta.lastSyncStatus === 'success'
                ? `+${meta.recordsAdded ?? 0} added`
                : meta.lastSyncStatus === 'in_progress'
                ? 'Syncing…'
                : meta.errorMessage ?? meta.lastSyncStatus ?? 'Unknown'}
              {meta.lastSyncTime && (
                <span className="text-gray-500 ml-0.5">· {relTime(meta.lastSyncTime)}</span>
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
              <Icon className={`w-4 h-4 ${cfg.accentIcon} flex-shrink-0`} />
              <DrawerTitle className="text-sm font-semibold text-gray-100 flex-1">
                {cfg.label} — Order Sync
              </DrawerTitle>
              <DrawerClose
                className="ml-2 text-gray-500 hover:text-gray-200 transition-colors"
                data-testid={`button-close-${platform}-order-sync-drawer`}
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
                onClick={() => syncMutation.mutate()}
                data-testid={`button-order-sync-${platform}`}
              >
                {isSyncing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                )}
                {isRunning ? 'Syncing…' : 'Sync Now'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setDrawerOpen(false); onOpenSettings?.('automation'); }}
                data-testid={`button-${platform}-order-sync-schedule`}
              >
                <CalendarClock className="w-3.5 h-3.5 mr-1.5" />
                Schedule
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setDrawerOpen(false); onOpenSettings?.('platforms'); }}
                data-testid={`button-${platform}-order-sync-settings`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
                Settings
              </Button>
            </div>

            <Separator className="bg-gray-700/60" />

            {/* Live progress indicator */}
            {isRunning && (
              <div className="space-y-2 rounded-lg border border-blue-500/30 bg-blue-950/20 p-3">
                <div className="flex items-center gap-2 text-xs text-blue-300">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span className="font-medium">Sync in progress</span>
                </div>
              </div>
            )}

            {/* Last sync summary */}
            {meta && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 px-0.5">Last Sync</p>
                <div className="rounded-lg border border-gray-700/60 bg-gray-900/50 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={meta.lastSyncStatus} className={`w-4 h-4 shrink-0 ${statusColor(meta.lastSyncStatus)}`} />
                    <span className={`text-sm font-medium ${statusColor(meta.lastSyncStatus)}`}>
                      {meta.lastSyncStatus === 'success'   ? 'Completed successfully' :
                       meta.lastSyncStatus === 'in_progress' ? 'In progress…'          :
                       meta.lastSyncStatus === 'error'     ? 'Failed'                  :
                       meta.lastSyncStatus ?? 'Unknown'}
                    </span>
                    {meta.lastSyncTime && (
                      <span className="text-[10px] text-gray-500 ml-auto">{relTime(meta.lastSyncTime)}</span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Orders',  value: stats?.totalOrders  },
                      { label: 'Pending', value: stats?.pendingOrders },
                      { label: 'Added',   value: meta.recordsAdded   },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded bg-gray-800/60 px-2 py-1.5 text-center">
                        <p className={`text-base font-mono font-bold ${cfg.accentIcon}`}>
                          {value != null ? Number(value).toLocaleString() : '—'}
                        </p>
                        <p className="text-[9px] text-gray-500 mt-0.5">{label}</p>
                      </div>
                    ))}
                  </div>

                  {meta.errorMessage && meta.lastSyncStatus !== 'success' && (
                    <div className="flex items-start gap-1.5 rounded border border-red-500/30 bg-red-950/20 px-2 py-1.5">
                      <XCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-red-300/80">{meta.errorMessage}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!meta && !isRunning && (
              <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 p-4 text-center">
                <p className="text-sm text-gray-400">No sync history yet</p>
                <p className="text-[10px] text-gray-500 mt-1">Run a sync to pull {cfg.label} orders into E.L.F.I.E.</p>
              </div>
            )}

            <Separator className="bg-gray-700/60" />

            {/* About */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 px-0.5">About This Sync</p>
              <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 p-3 space-y-1.5">
                {[
                  { icon: ShoppingCart, text: `Pulls new and updated orders from ${cfg.label} into E.L.F.I.E.` },
                  { icon: Activity,     text: 'Detects status changes, new items, and payment updates' },
                  { icon: Package,      text: 'Powers the fulfillment queue and shipped orders views' },
                ].map(({ icon: ItemIcon, text }, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <ItemIcon className={`w-3 h-3 ${cfg.accentIcon} opacity-70 shrink-0 mt-0.5`} />
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

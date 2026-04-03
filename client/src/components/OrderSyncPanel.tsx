import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  CalendarClock,
  ChevronDown,
  X,
  ChevronRight,
  ArrowLeft,
  ShoppingCart,
  Package,
  Globe,
  Activity,
  AlertCircle,
} from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";

export type OrderSyncPlatform = 'bricklink' | 'brickowl' | 'ebay';

interface OrderSyncPanelProps {
  platform: OrderSyncPlatform;
  onOpenSettings?: (section?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'billing', focusTarget?: 'schedulerInventory' | 'schedulerOrders' | 'schedulerChannel' | 'channelSync') => void;
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

export const PLATFORM_CONFIG: Record<OrderSyncPlatform, {
  label: string;
  syncId: string;
  syncRoute: string;
  Icon: React.ElementType;
  accentText: string;
  accentBorder: string;
  accentBg: string;
  accentIcon: string;
  testId: string;
  sidebar: {
    activeButton: string;
    idleButton: string;
    activeIcon: string;
    idleIcon: string;
    iconColor: string;
    labelColor: string;
    activeArrow: string;
  };
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
    sidebar: {
      activeButton: 'border-blue-400/70 bg-blue-900/50 shadow-[0_0_10px_rgba(59,130,246,0.2)]',
      idleButton: 'border-blue-500/30 bg-blue-950/30',
      activeIcon: 'bg-blue-800/70 ring-blue-400/60',
      idleIcon: 'bg-blue-900/60 ring-blue-500/40',
      iconColor: 'text-blue-300',
      labelColor: 'text-blue-100',
      activeArrow: 'text-blue-400',
    },
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
    sidebar: {
      activeButton: 'border-cyan-400/70 bg-cyan-900/50 shadow-[0_0_10px_rgba(34,211,238,0.2)]',
      idleButton: 'border-cyan-500/30 bg-cyan-950/30',
      activeIcon: 'bg-cyan-800/70 ring-cyan-400/60',
      idleIcon: 'bg-cyan-900/60 ring-cyan-500/40',
      iconColor: 'text-cyan-300',
      labelColor: 'text-cyan-100',
      activeArrow: 'text-cyan-400',
    },
  },
  ebay: {
    label: 'eBay',
    syncId: 'ebay_orders',
    syncRoute: '/api/sync/ebay/orders',
    Icon: ShoppingCart,
    accentText: 'text-yellow-100',
    accentBorder: 'border-yellow-500/40',
    accentBg: 'from-yellow-950/50 to-gray-950/70',
    accentIcon: 'text-yellow-400',
    testId: 'order-sync-ebay-panel',
    sidebar: {
      activeButton: 'border-yellow-400/70 bg-yellow-900/50 shadow-[0_0_10px_rgba(234,179,8,0.2)]',
      idleButton: 'border-yellow-500/30 bg-yellow-950/30',
      activeIcon: 'bg-yellow-800/70 ring-yellow-400/60',
      idleIcon: 'bg-yellow-900/60 ring-yellow-500/40',
      iconColor: 'text-yellow-300',
      labelColor: 'text-yellow-100',
      activeArrow: 'text-yellow-400',
    },
  },
};

// Date presets for "Sync From…" picker
const DATE_PRESETS = [
  { label: '7 days',  days: 7   },
  { label: '30 days', days: 30  },
  { label: '90 days', days: 90  },
  { label: '6 months', days: 180 },
  { label: 'All time', days: null },
] as const;

function presetToDate(days: number | null): string | undefined {
  if (days === null) return undefined; // all time → no sinceDate
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatDisplayDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function OrderSyncPanel({ platform, onOpenSettings }: OrderSyncPanelProps) {
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<number | null | 'custom'>(30); // days or null (all time) or 'custom'
  const [customDate, setCustomDate] = useState('');
  const [changeDetail, setChangeDetail] = useState<'added' | 'updated' | null>(null);
  const cfg = PLATFORM_CONFIG[platform];

  const { data: syncStatuses } = useQuery<any>({
    queryKey: ['/api/sync/statuses'],
    refetchInterval: 15000,
  });

  const { data: orderSyncStatus } = useQuery<any>({
    queryKey: ['/api/order-sync/status'],
    refetchInterval: 30000,
  });

  const { data: orgIntegrationsList = [] } = useQuery<any[]>({
    queryKey: ['/api/org/integrations'],
    enabled: platform === 'ebay',
  });
  const isEbaySandbox = platform === 'ebay' &&
    ((orgIntegrationsList as any[]).find((i: any) => i.channel === 'ebay')?.credentials as any)?.environment === 'sandbox';

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
    mutationFn: (opts: { fullSync?: boolean; sinceDate?: string } = {}) =>
      apiRequest('POST', cfg.syncRoute, opts),
    onSuccess: (_data, opts) => {
      queryClient.invalidateQueries({ queryKey: ['/api/sync/statuses'] });
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders/stats'] });
      setShowFromPicker(false);
      const fromLabel = opts.sinceDate
        ? `from ${formatDisplayDate(opts.sinceDate)}`
        : opts.fullSync ? 'from the beginning' : null;
      toast({
        title: `${cfg.label} order sync started`,
        description: fromLabel
          ? `Syncing orders ${fromLabel} — this may take a moment.`
          : 'Orders are syncing in the background.',
      });
    },
    onError: (err: any) => {
      toast({ title: 'Sync failed', description: err?.message || `Could not start ${cfg.label} order sync.`, variant: 'destructive' });
    },
  });

  const isSyncing = syncMutation.isPending || isRunning;

  const { data: recentOrders, isLoading: recentOrdersLoading } = useQuery<any>({
    queryKey: ['/api/sync/orders/recent', platform, changeDetail],
    queryFn: () => apiRequest('GET', `/api/sync/orders/recent?platform=${platform}&type=${changeDetail}&limit=30`),
    enabled: drawerOpen && changeDetail !== null,
  });

  const progressRoute = platform === 'bricklink'
    ? '/api/sync/bricklink/orders/progress'
    : platform === 'brickowl'
    ? '/api/sync/brickowl/orders/progress'
    : null;

  const { data: progressData } = useQuery<{ status: string; currentStep: string; progress: number; processed: number; total: number }>({
    queryKey: [progressRoute ?? 'no-progress'],
    refetchInterval: isSyncing && progressRoute ? 2000 : false,
    enabled: isSyncing && !!progressRoute,
  });

  const progressPct = progressData?.progress ?? 0;
  const showProgress = isSyncing;

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
            {isEbaySandbox && (
              <span className="text-[9px] font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded px-1.5 py-0.5 uppercase tracking-wide shrink-0">
                Sandbox
              </span>
            )}
            {isSyncing && (
              <span className="flex items-center gap-1 text-[10px] text-blue-400">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                syncing…
              </span>
            )}
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
        </div>

        {showProgress && (
          <div className="space-y-1" data-testid={`${cfg.testId}-progress`}>
            <Progress value={progressPct} className="h-1.5" />
            <div className="flex justify-between text-[10px] text-gray-500">
              <span>
                {progressData?.currentStep
                  ? progressData.currentStep
                  : 'Syncing…'}
              </span>
              <span className="tabular-nums">{progressPct}%</span>
            </div>
          </div>
        )}

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

      <Drawer open={drawerOpen} onOpenChange={(open) => { setDrawerOpen(open); if (!open) { setShowFromPicker(false); setChangeDetail(null); } }}>
        <DrawerContent className="bg-gray-950 border-gray-800 h-[75vh] flex flex-col rounded-t-2xl">
          <DrawerHeader className="p-0 flex-shrink-0">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-600" />
            </div>
            <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-gray-800">
              {changeDetail ? (
                <button onClick={() => setChangeDetail(null)} className="text-gray-400 hover:text-gray-200 transition-colors flex-shrink-0" data-testid={`button-back-${platform}-change-detail`}>
                  <ArrowLeft className="w-4 h-4" />
                </button>
              ) : (
                <Icon className={`w-4 h-4 ${cfg.accentIcon} flex-shrink-0`} />
              )}
              <DrawerTitle className="text-sm font-semibold text-gray-100 flex-1 flex items-center gap-2">
                {changeDetail === 'added' ? `Recently Added — ${cfg.label}`
                  : changeDetail === 'updated' ? `Recently Updated — ${cfg.label}`
                  : `${cfg.label} — Order Sync`}
                {isEbaySandbox && !changeDetail && (
                  <span className="text-[9px] font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded px-1.5 py-0.5 uppercase tracking-wide">
                    Sandbox
                  </span>
                )}
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
            {/* Recent orders sub-view */}
            {changeDetail && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 flex-1">
                    {changeDetail === 'added' ? 'Most recently added' : 'Most recently updated'}
                  </p>
                  <span className="text-[10px] text-gray-600">up to 30</span>
                </div>
                {recentOrdersLoading ? (
                  <div className="flex items-center gap-2 py-6 justify-center text-gray-500 text-xs">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading…
                  </div>
                ) : !recentOrders?.items?.length ? (
                  <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 p-4 text-center text-xs text-gray-500">No orders found</div>
                ) : (
                  <div className="space-y-1">
                    {recentOrders.items.map((order: any) => (
                      <div key={order.id} className="flex items-center gap-3 rounded-md bg-gray-900/50 px-2.5 py-2" data-testid={`row-order-change-${order.id}`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[10px] font-mono font-semibold ${cfg.accentIcon}`}>#{order.orderNumber}</span>
                            {order.customerUsername && (
                              <span className="text-[9px] text-gray-400 truncate">{order.customerUsername}</span>
                            )}
                            <span className="text-[9px] text-gray-600 capitalize">{order.orderStatus}</span>
                          </div>
                          {changeDetail === 'updated' && order.previousStatus && order.previousStatus !== order.orderStatus && (
                            <p className="text-[9px] font-mono mt-0.5">
                              <span className="text-red-400/80">{order.previousStatus}</span>
                              <span className="text-gray-600"> → </span>
                              <span className="text-green-400/80">{order.orderStatus}</span>
                            </p>
                          )}
                          {changeDetail === 'updated' && (!order.previousStatus || order.previousStatus === order.orderStatus) && (
                            <p className="text-[9px] text-gray-600 mt-0.5 italic">details updated</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[10px] font-mono font-semibold text-white">${parseFloat(order.orderTotal).toFixed(2)}</p>
                          <p className="text-[9px] text-gray-500">
                            {new Date(changeDetail === 'updated' ? (order.updatedAt ?? order.syncedAt) : order.syncedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Main drawer content — hidden when sub-view is active */}
            {!changeDetail && (<>

            {/* Action buttons */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isSyncing}
                  onClick={() => { setShowFromPicker(false); syncMutation.mutate({}); }}
                  data-testid={`button-order-sync-${platform}`}
                >
                  {isSyncing && !showFromPicker ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  {isRunning ? 'Syncing…' : 'Sync Now'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isSyncing}
                  onClick={() => setShowFromPicker(v => !v)}
                  data-testid={`button-order-sync-from-${platform}`}
                  className={showFromPicker ? 'toggle-elevate toggle-elevated' : 'toggle-elevate'}
                >
                  <CalendarClock className="w-3.5 h-3.5 mr-1.5" />
                  Sync From…
                  <ChevronDown className={`w-3 h-3 ml-1 transition-transform ${showFromPicker ? 'rotate-180' : ''}`} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setDrawerOpen(false); onOpenSettings?.('platforms', 'schedulerOrders'); }}
                  data-testid={`button-${platform}-order-sync-schedule`}
                >
                  <CalendarClock className="w-3.5 h-3.5 mr-1.5" />
                  Schedule
                </Button>
              </div>

              {/* Inline "Sync From…" date picker */}
              {showFromPicker && (() => {
                const isAllTime = selectedPreset === null;
                const activeSinceDate = selectedPreset === 'custom'
                  ? customDate
                  : selectedPreset !== null
                  ? presetToDate(selectedPreset)
                  : undefined;

                return (
                  <div className="rounded-lg border border-gray-700/60 bg-gray-900/60 p-3 space-y-3">
                    {/* Preset chips */}
                    <div className="flex flex-wrap gap-1.5">
                      {DATE_PRESETS.map(p => {
                        const active = selectedPreset === p.days;
                        return (
                          <button
                            key={p.label}
                            onClick={() => { setSelectedPreset(p.days); setCustomDate(''); }}
                            className={`text-[11px] px-2.5 py-1 rounded-md border font-medium transition-colors ${
                              active
                                ? `${cfg.accentBorder} ${cfg.accentText} bg-gray-800`
                                : 'border-gray-700/60 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                            }`}
                            data-testid={`button-preset-${p.label.replace(' ', '-').toLowerCase()}-${platform}`}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => setSelectedPreset('custom')}
                        className={`text-[11px] px-2.5 py-1 rounded-md border font-medium transition-colors ${
                          selectedPreset === 'custom'
                            ? `${cfg.accentBorder} ${cfg.accentText} bg-gray-800`
                            : 'border-gray-700/60 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                        }`}
                        data-testid={`button-preset-custom-${platform}`}
                      >
                        Custom
                      </button>
                    </div>

                    {/* Custom date input */}
                    {selectedPreset === 'custom' && (
                      <input
                        type="date"
                        value={customDate}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={e => setCustomDate(e.target.value)}
                        className="w-full text-xs bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-gray-200 focus:outline-none focus:border-gray-500"
                        data-testid={`input-custom-date-${platform}`}
                      />
                    )}

                    {/* All-time warning */}
                    {isAllTime && (
                      <div className="flex items-start gap-1.5 rounded-md border border-yellow-500/30 bg-yellow-950/20 px-2.5 py-2">
                        <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                        <p className="text-[10px] text-yellow-300/80">
                          This re-processes every order ever received and may take several minutes.
                        </p>
                      </div>
                    )}

                    {/* Confirm + Cancel */}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isSyncing || (selectedPreset === 'custom' && !customDate)}
                        onClick={() => {
                          if (isAllTime) {
                            syncMutation.mutate({ fullSync: true });
                          } else if (activeSinceDate) {
                            syncMutation.mutate({ sinceDate: activeSinceDate });
                          }
                        }}
                        data-testid={`button-confirm-sync-from-${platform}`}
                      >
                        {syncMutation.isPending ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                        )}
                        {isAllTime
                          ? 'Sync all orders'
                          : activeSinceDate
                          ? `Sync from ${formatDisplayDate(activeSinceDate)}`
                          : 'Pick a date'}
                      </Button>
                      <button
                        onClick={() => setShowFromPicker(false)}
                        className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
                        data-testid={`button-cancel-sync-from-${platform}`}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>

            <Separator className="bg-gray-700/60" />

            {/* Live progress indicator */}
            {showProgress && (
              <div className="space-y-2 rounded-lg border border-blue-500/30 bg-blue-950/20 p-3">
                <div className="flex items-center gap-2 text-xs text-blue-300">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span className="font-medium">Sync in progress</span>
                </div>
                {progressData && (
                  <>
                    <Progress value={progressPct} className="h-2" />
                    <div className="flex justify-between text-[10px] text-gray-400">
                      <span>{progressData.currentStep || 'Starting…'}</span>
                      {progressPct > 0 && (
                        <span className="tabular-nums font-mono">{progressPct}%</span>
                      )}
                    </div>
                  </>
                )}
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

                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: 'Orders',  value: stats?.totalOrders,    color: cfg.accentIcon, clickable: false },
                      { label: 'Pending', value: stats?.pendingOrders,  color: 'text-orange-300', clickable: false },
                      { label: 'Added',   value: meta.recordsAdded,     color: 'text-green-400',  clickable: true, type: 'added'   as const },
                      { label: 'Updated', value: meta.recordsUpdated,   color: 'text-yellow-300', clickable: true, type: 'updated' as const },
                    ].map(({ label, value, color, clickable, type }) =>
                      clickable ? (
                        <button key={label} onClick={() => setChangeDetail(type!)} className="rounded bg-gray-800/60 px-2 py-1.5 text-center hover-elevate active-elevate-2 w-full" data-testid={`button-${platform}-stat-${label.toLowerCase()}`}>
                          <p className={`text-base font-mono font-bold ${color}`}>{value != null ? Number(value).toLocaleString() : '—'}</p>
                          <p className="text-[9px] text-gray-500 mt-0.5 flex items-center justify-center gap-0.5">{label}<ChevronRight className="w-2.5 h-2.5 text-gray-600" /></p>
                        </button>
                      ) : (
                        <div key={label} className="rounded bg-gray-800/60 px-2 py-1.5 text-center">
                          <p className={`text-base font-mono font-bold ${color}`}>{value != null ? Number(value).toLocaleString() : '—'}</p>
                          <p className="text-[9px] text-gray-500 mt-0.5">{label}</p>
                        </div>
                      )
                    )}
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
            </>)}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

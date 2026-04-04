import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ShoppingCart, Truck, PackageCheck,
  Sparkles, Info, Globe, AlertTriangle, CheckCircle2,
  Loader2, RefreshCw, X, ArrowRight, Crosshair,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from "@/components/ui/drawer";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import MetricCard from "./MetricCard";
import { DateRangeValue, CollapsibleDatePicker } from "./DateRangeSelector";
import OrderSyncPanel, { PLATFORM_CONFIG, OrderSyncPlatform } from "./OrderSyncPanel";

// Order-sync channels that appear dynamically in the "Selling Channels" sidebar.
// BrickLink is always present as a fixed button; entries here are additional channel platforms.
const ORDER_SYNC_CHANNEL_KEYS: OrderSyncPlatform[] = ['brickowl', 'ebay'];

interface OrderStats {
  totalOrders: number;
  pendingOrders: number;
  shippedOrders: number;
  returnedOrders: number;
  pendingRevenue: number;
  monthRevenue: number;
  avgLotsPerOrder: number;
}

type OrdersDrawerKey = 'fulfillment' | 'shipped' | 'bricklinksync' | `ordersync-${string}` | null;

interface OrdersDashboardProps {
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
  activeDrawer: OrdersDrawerKey;
  onDrawerChange: (drawer: OrdersDrawerKey) => void;
  dateRange?: DateRangeValue;
  onOpenSettings?: (section?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'billing', focusTarget?: 'channelSync' | 'schedulerInventory' | 'schedulerOrders' | 'schedulerChannel') => void;
  desktopMode?: boolean;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SyncQueueItem {
  id: number;
  blInventoryId: number;
  targetPlatform: string;
  sourcePlatform: string;
  sourceOrderId: string | null;
  quantityDelta: number;
  status: 'pending' | 'done' | 'abandoned';
  retryCount: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
  itemNo: string | null;
}

interface SyncQueueResponse {
  success: boolean;
  items: SyncQueueItem[];
  stats: { pending: number; abandoned: number; done: number; total: number };
}

// ── Qty Sync Queue Panel ──────────────────────────────────────────────────────

function QtySyncQueuePanel() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<SyncQueueResponse>({
    queryKey: ['/api/sync-queue'],
    refetchInterval: 30000,
    staleTime: 0,
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'done' | 'abandoned' }) =>
      apiRequest('PATCH', `/api/sync-queue/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sync-queue'] });
      toast({ title: "Queue item updated" });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/sync-queue/${id}/retry`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sync-queue'] });
      toast({ title: "Retry triggered", description: "The item has been re-queued for immediate retry." });
    },
  });

  const stats = data?.stats;
  const items = data?.items ?? [];
  const hasPending = (stats?.pending ?? 0) > 0;
  const hasAbandoned = (stats?.abandoned ?? 0) > 0;

  if (!hasPending && !hasAbandoned && !isLoading) return null;

  const activeItems = items.filter(i => i.status === 'pending' || i.status === 'abandoned');
  const doneItems = items.filter(i => i.status === 'done');

  const fmtDelta = (delta: number) => delta < 0 ? `${delta}` : `+${delta}`;

  const fmtTime = (ts: string | null) => {
    if (!ts) return null;
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <>
      <div
        className={cn(
          "relative border rounded-lg p-2.5 cursor-pointer hover-elevate",
          hasAbandoned
            ? "bg-red-500/10 border-red-500/30"
            : "bg-amber-500/10 border-amber-500/30"
        )}
        onClick={() => setOpen(true)}
        data-testid="card-sync-queue"
      >
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gray-400/15 to-transparent rounded-t-lg" />
        <div className="flex items-center gap-2">
          <div className={cn("p-1.5 rounded-md ring-1", hasAbandoned ? "bg-red-500/20 ring-red-500/40" : "bg-amber-500/20 ring-amber-500/40")}>
            {hasPending && !hasAbandoned
              ? <Loader2 className="w-3 h-3 text-amber-300 animate-spin" />
              : <AlertTriangle className={cn("w-3 h-3", hasAbandoned ? "text-red-300" : "text-amber-300")} />
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className={cn("text-xs font-semibold", hasAbandoned ? "text-red-300" : "text-amber-300")}>
              Qty Sync Queue
            </p>
            <p className="text-[10px] text-gray-400 leading-tight">
              {hasPending && `${stats!.pending} pending retry${stats!.pending !== 1 ? 's' : ''}`}
              {hasPending && hasAbandoned && ' · '}
              {hasAbandoned && `${stats!.abandoned} need${stats!.abandoned === 1 ? 's' : ''} manual fix`}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {hasAbandoned && (
              <Badge variant="outline" className="text-[9px] bg-red-500/20 border-red-500/50 text-red-300 no-default-active-elevate">
                Action Required
              </Badge>
            )}
            {hasPending && !hasAbandoned && (
              <Badge variant="outline" className="text-[9px] bg-amber-500/20 border-amber-400/72 text-amber-300 no-default-active-elevate">
                Retrying
              </Badge>
            )}
          </div>
        </div>
      </div>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="bg-gray-950 border-gray-800 max-h-[92vh] flex flex-col rounded-t-2xl">
          <DrawerHeader className="p-0 flex-shrink-0">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-600" />
            </div>
            <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-gray-800">
              <RefreshCw className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <DrawerTitle className="text-sm font-semibold text-gray-100 flex-1">Qty Sync Queue</DrawerTitle>
              <DrawerClose asChild>
                <button className="ml-2 text-gray-500 hover:text-gray-200 transition-colors" data-testid="button-close-sync-queue">
                  <X className="w-5 h-5" />
                </button>
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto px-4 pt-3 pb-6 min-h-0 space-y-4">

            {/* Legend */}
            <p className="text-[11px] text-gray-500 leading-relaxed">
              When a qty update to BrickLink or BrickOwl fails (e.g. the platform is down), it lands here.
              The scheduler retries automatically on each sync cycle. Items that fail 10 times need a manual fix.
            </p>

            {/* Active items */}
            {activeItems.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">Pending / Needs Action</p>
                {activeItems.map(item => (
                  <div
                    key={item.id}
                    className={cn(
                      "rounded-lg border p-3 space-y-2",
                      item.status === 'abandoned'
                        ? "bg-red-500/10 border-red-500/30"
                        : "bg-amber-500/8 border-amber-500/25"
                    )}
                    data-testid={`sync-queue-item-${item.id}`}
                  >
                    <div className="flex items-start gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {item.status === 'abandoned'
                          ? <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
                          : <Loader2 className="w-3 h-3 text-amber-400 animate-spin flex-shrink-0" />
                        }
                        <span className="text-xs font-mono text-gray-200">
                          {item.itemNo ?? `inv#${item.blInventoryId}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-gray-400">
                        <span className="text-gray-500">{item.sourcePlatform}</span>
                        <ArrowRight className="w-2.5 h-2.5" />
                        <span className={cn("font-medium", item.targetPlatform === 'BrickOwl' ? "text-blue-300" : "text-orange-300")}>
                          {item.targetPlatform}
                        </span>
                      </div>
                      <div className="ml-auto flex items-center gap-1.5">
                        {item.status === 'abandoned' ? (
                          <Badge variant="outline" className="text-[9px] bg-red-500/20 border-red-500/50 text-red-300 no-default-active-elevate">
                            Manual Fix Needed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] bg-amber-500/20 border-amber-400/72 text-amber-300 no-default-active-elevate">
                            Attempt {item.retryCount + 1}/10
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500">
                      <span>Qty: <span className={cn("font-mono font-medium", item.quantityDelta < 0 ? "text-red-300" : "text-green-300")}>{fmtDelta(item.quantityDelta)}</span></span>
                      {item.sourceOrderId && <span>Order: <span className="text-gray-300">{item.sourceOrderId}</span></span>}
                      {item.lastAttemptAt && <span>Last tried: {fmtTime(item.lastAttemptAt)}</span>}
                    </div>

                    {item.lastError && (
                      <p className="text-[10px] text-red-400/80 bg-red-500/10 rounded px-2 py-1 font-mono break-all leading-tight">
                        {item.lastError}
                      </p>
                    )}

                    <div className="flex gap-1.5 flex-wrap">
                      {item.status === 'abandoned' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-[10px] h-6 px-2 border-amber-500/40 text-amber-300"
                          onClick={() => retryMutation.mutate(item.id)}
                          disabled={retryMutation.isPending}
                          data-testid={`button-retry-${item.id}`}
                        >
                          {retryMutation.isPending ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
                          Retry Now
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-6 px-2 border-gray-600 text-gray-400"
                        onClick={() => resolveMutation.mutate({ id: item.id, status: 'done' })}
                        disabled={resolveMutation.isPending}
                        data-testid={`button-resolve-${item.id}`}
                      >
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        Mark Fixed
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Recently completed */}
            {doneItems.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">Recently Healed</p>
                {doneItems.slice(0, 10).map(item => (
                  <div key={item.id} className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg bg-green-500/8 border border-green-500/20" data-testid={`sync-queue-done-${item.id}`}>
                    <CheckCircle2 className="w-3 h-3 text-green-400 flex-shrink-0" />
                    <span className="text-[10px] font-mono text-gray-300">{item.itemNo ?? `inv#${item.blInventoryId}`}</span>
                    <ArrowRight className="w-2 h-2 text-gray-600 flex-shrink-0" />
                    <span className="text-[10px] text-gray-400">{item.targetPlatform}</span>
                    <span className="ml-auto text-[10px] text-green-400">Synced</span>
                  </div>
                ))}
              </div>
            )}

            {activeItems.length === 0 && doneItems.length === 0 && (
              <p className="text-center text-sm text-gray-500 py-8">No items in queue</p>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

export default function OrdersDashboard({ onItemClick, activeDrawer, onDrawerChange, dateRange: initialDateRange = 'mtd', onOpenSettings, desktopMode }: OrdersDashboardProps) {
  const [dateRange, setDateRange] = useState<DateRangeValue>(initialDateRange);
  const [panelTab, setPanelTab] = useState<'systems' | 'uplink'>('systems');

  const { data: stats, isLoading: statsLoading } = useQuery<OrderStats>({
    queryKey: ['/api/orders/stats', dateRange],
    queryFn: async () => {
      const url = dateRange === 'all' ? '/api/orders/stats' : `/api/orders/stats?range=${dateRange}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch order stats');
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
  });

  const { data: fulfillmentStats } = useQuery<{ unfulfilled: number; feedbackPending: number }>({
    queryKey: ['/api/fulfillment/stats'],
    staleTime: 60 * 1000,
  });

  const { data: syncStatuses } = useQuery<any>({
    queryKey: ['/api/sync/statuses'],
    refetchInterval: 15000,
  });

  const hasOrderChannelErrors = ['bricklink_orders', 'brickowl_orders', 'ebay_orders'].some(
    id => ['error', 'failed'].includes(syncStatuses?.[id]?.lastSyncStatus)
  );

  const { data: workflowSummary } = useQuery<{ byStatus: Record<string, number> }>({
    queryKey: ['/api/orders/workflow-summary'],
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });

  const { data: adjustments } = useQuery<{
    totalRefunds: number;
    refundedOrderCount: number;
    totalFees: number;
    totalShipping: number;
  }>({
    queryKey: ['/api/orders/adjustments/summary', dateRange],
    queryFn: async () => {
      const res = await fetch(`/api/orders/adjustments/summary?dateRange=${dateRange}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch adjustments');
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
  });

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);

  const formatNumber = (value: number) =>
    new Intl.NumberFormat('en-US').format(value);

  const formatPct = (value: number) =>
    `${value.toFixed(1)}%`;

  const aov = stats && stats.totalOrders > 0 ? stats.monthRevenue / stats.totalOrders : 0;
  const fulfilledOrders = stats ? stats.shippedOrders + (stats.returnedOrders ?? 0) : 0;
  const fulfillmentRate = stats && stats.totalOrders > 0 ? (fulfilledOrders / stats.totalOrders) * 100 : 0;
  const returnRate = stats && stats.totalOrders > 0 && adjustments
    ? (adjustments.refundedOrderCount / stats.totalOrders) * 100
    : 0;

  if (statsLoading) {
    return (
      <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-orange/5 to-transparent rounded-lg border border-lego-orange/10 shadow-[0_0_15px_rgba(251,146,60,0.1)]">
        <div className="flex items-center justify-center py-8">
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-lego-orange border-t-transparent" />
            <p className="text-xs text-gray-500">Loading orders...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
        <div className="p-2 space-y-3 bg-gradient-to-br from-lego-orange/10 to-lego-orange/3 rounded-lg border border-lego-orange/35 shadow-[0_0_22px_rgba(251,146,60,0.18)]">
      <div className="space-y-3">

        {/* ── Orders Info ── */}
        <div className={cn("relative bg-gradient-to-b from-orange-900/40 to-gray-900/88 border border-orange-400/65 rounded-lg shadow-[0_0_28px_rgba(249,115,22,0.25)] overflow-hidden", "p-2.5")} data-testid="section-orders-overview">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-orange-300/85 to-transparent" />
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-md bg-orange-900/60 ring-1 ring-orange-500/50 shadow-[0_0_10px_rgba(249,115,22,0.25)] shrink-0">
              <ShoppingCart className={cn("w-3 h-3 text-orange-200", "md:w-4 md:h-4")} />
            </div>
            <h3 className={cn("text-xs font-semibold text-orange-200 uppercase tracking-wide min-w-0", "md:text-sm")}>Orders</h3>
            <CollapsibleDatePicker
              value={dateRange}
              onChange={setDateRange}
              accentClass="text-orange-400/70 hover:text-orange-300"
              testId="button-orders-date-picker"
            />
          </div>
          <div className={cn("grid grid-cols-3 gap-1.5", "mb-1.5")} data-testid="section-orders-counts">
            <MetricCard label="Total" value={stats ? formatNumber(stats.totalOrders) : '—'} color="orange" data-testid="metric-total-orders" />
            <MetricCard label="Pending" value={stats ? formatNumber(stats.pendingOrders) : '—'} color="orange" data-testid="metric-pending-orders" />
            <MetricCard label="Shipped" value={stats ? formatNumber(stats.shippedOrders) : '—'} color="green" data-testid="metric-shipped-orders" />
          </div>
          <div className="grid grid-cols-4 gap-1.5" data-testid="section-orders-kpis">
            <MetricCard label="Avg Order" value={stats ? formatCurrency(aov) : '—'} color="orange" data-testid="metric-aov" />
            <MetricCard label="Avg Lots" value={stats ? stats.avgLotsPerOrder.toFixed(1) : '—'} color="orange" data-testid="metric-avg-lots" />
            <MetricCard label="Fulfill Rate" value={stats ? formatPct(fulfillmentRate) : '—'} color="green" data-testid="metric-fulfillment-rate" />
            <MetricCard label="Return Rate" value={adjustments ? formatPct(returnRate) : '—'} color={returnRate > 5 ? 'red' : 'yellow'} data-testid="metric-return-rate" />
          </div>
        </div>

        {/* ── DIRECTIVE ─ Focus panel ── */}
        <div className="relative rounded-lg border border-amber-500/25 bg-gradient-to-b from-amber-950/25 to-gray-900/70 overflow-hidden" data-testid="section-directive-orders">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-400/55 to-transparent" />
          <div className="px-3 pt-2.5 pb-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <Crosshair className="w-2.5 h-2.5 text-amber-400/70 flex-shrink-0" />
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-amber-400/80">Directive</span>
              <div className="flex-1 h-px bg-amber-500/20" />
            </div>
            <div className="grid grid-cols-6 gap-1" data-testid="directive-workflow-grid">
              {([
                { key: 'unpaid',     label: 'Unpaid',  badge: 'bg-orange-900/50 text-orange-300 border-orange-700/40', dot: 'bg-orange-500' },
                { key: 'new',        label: 'New',     badge: 'bg-gray-800/60 text-gray-300 border-gray-600/40',       dot: 'bg-gray-500' },
                { key: 'processing', label: 'In Prog', badge: 'bg-blue-900/50 text-blue-300 border-blue-700/40',       dot: 'bg-blue-500' },
                { key: 'bump',       label: 'Bump',    badge: 'bg-amber-900/50 text-amber-300 border-amber-700/40',    dot: 'bg-amber-400' },
                { key: 'issue',      label: 'Issue',   badge: 'bg-red-900/50 text-red-300 border-red-700/40',          dot: 'bg-red-500' },
                { key: 'on_hold',    label: 'Hold',    badge: 'bg-purple-900/50 text-purple-300 border-purple-700/40', dot: 'bg-purple-500' },
              ] as const).map(({ key, label, badge, dot }) => {
                const count = workflowSummary?.byStatus?.[key] ?? 0;
                const isActive = count > 0;
                return (
                  <button
                    key={key}
                    onClick={() => onDrawerChange('fulfillment')}
                    data-testid={`directive-status-${key}`}
                    className={cn(
                      "flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 border transition-all hover-elevate",
                      isActive ? `${badge} shadow-sm` : "bg-gray-900/30 border-gray-800/40 text-gray-700"
                    )}
                  >
                    <span className={cn("text-sm font-bold font-mono leading-none", isActive ? "" : "text-gray-700")}>
                      {workflowSummary ? count : '·'}
                    </span>
                    <span className="text-[7px] uppercase tracking-wide leading-none text-center opacity-80">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── SYSTEMS / UPLINK tab panel ── */}
        <div className="relative bg-gradient-to-b from-gray-800/75 to-gray-900/95 border border-gray-400/60 rounded-lg shadow-[0_0_20px_rgba(255,255,255,0.08)] overflow-hidden p-2.5" data-testid="section-panel-tabs">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gray-100/65 to-transparent" />

          {/* Retro control panel tab strip */}
          <div className="flex rounded-md border border-gray-500/30 bg-black/50 p-0.5 gap-0.5 mb-3 shadow-inner" data-testid="control-panel-tabs">
            <button
              onClick={() => setPanelTab('systems')}
              data-testid="tab-systems"
              className={cn(
                "relative flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded transition-all duration-200 text-[10px] font-bold uppercase tracking-widest",
                panelTab === 'systems'
                  ? "bg-gray-700/90 text-gray-100 shadow-[0_0_14px_rgba(255,255,255,0.07)]"
                  : "text-gray-600 hover:text-gray-400"
              )}
            >
              <Sparkles className="w-3 h-3 flex-shrink-0" />
              Systems
              {panelTab === 'systems' && (
                <span className="absolute bottom-0 inset-x-3 h-px bg-gradient-to-r from-transparent via-gray-300/70 to-transparent" />
              )}
            </button>
            <button
              onClick={() => setPanelTab('uplink')}
              data-testid="tab-uplink"
              className={cn(
                "relative flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded transition-all duration-200 text-[10px] font-bold uppercase tracking-widest",
                panelTab === 'uplink'
                  ? "bg-gray-700/90 text-gray-100 shadow-[0_0_14px_rgba(255,255,255,0.07)]"
                  : "text-gray-600 hover:text-gray-400"
              )}
            >
              <Globe className="w-3 h-3 flex-shrink-0" />
              Uplink
              {hasOrderChannelErrors && panelTab !== 'uplink' && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" data-testid="badge-channel-errors" />
              )}
              {panelTab === 'uplink' && (
                <span className="absolute bottom-0 inset-x-3 h-px bg-gradient-to-r from-transparent via-gray-300/70 to-transparent" />
              )}
            </button>
          </div>

          {/* SYSTEMS — Tools grid */}
          {panelTab === 'systems' && (
          <div className={cn("grid grid-cols-2", "gap-2")} data-testid="section-order-tools">

            {/* Fulfillment & Shipping */}
            <button
              onClick={() => onDrawerChange('fulfillment')}
              data-testid="tool-fulfillment"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-orange-400/72 bg-gradient-to-br from-orange-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", "p-3")}
              style={{ '--tool-glow-color': 'rgba(249,115,22,0.35)' } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-orange-800/75 p-1.5 ring-1 ring-orange-400/65 shadow-[0_0_10px_rgba(249,115,22,0.22)]">
                  <Truck className={cn("w-3.5 h-3.5 text-orange-200", "md:w-5 md:h-5 lg:w-4 lg:h-4")} />
                </div>
                <span className={cn("text-xs font-bold text-orange-100 leading-tight flex-1", "md:text-sm")}>Fulfillment</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <span
                      role="button"
                      onClick={(e) => e.stopPropagation()}
                      className="text-orange-600/60 hover:text-orange-400 transition-colors"
                      data-testid="info-fulfillment"
                    >
                      <Info className="w-3 h-3" />
                    </span>
                  </PopoverTrigger>
                  <PopoverContent side="top" className="w-60 text-xs text-gray-300 bg-gray-900 border-gray-700 p-2.5">
                    Pick, pack, and ship pending orders. Includes label generation and tracking.
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem] justify-end" data-testid="fulfillment-stats">
                {(fulfillmentStats?.unfulfilled ?? 0) > 0 && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-600/30" data-testid="fulfillment-count">
                    {formatNumber(fulfillmentStats!.unfulfilled)} to fulfill
                  </span>
                )}
                {(fulfillmentStats?.feedbackPending ?? 0) > 0 && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-600/30" data-testid="feedback-count">
                    {formatNumber(fulfillmentStats!.feedbackPending)} feedback
                  </span>
                )}
                {fulfillmentStats && fulfillmentStats.unfulfilled === 0 && fulfillmentStats.feedbackPending === 0 && (
                  <span className="text-[9px] text-green-400/70">All caught up</span>
                )}
              </div>
            </button>

            {/* Shipped Orders */}
            <button
              onClick={() => onDrawerChange('shipped')}
              data-testid="tool-shipped"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-green-400/72 bg-gradient-to-br from-green-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", "p-3")}
              style={{ '--tool-glow-color': 'rgba(34,197,94,0.35)' } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-green-800/75 p-1.5 ring-1 ring-green-400/65 shadow-[0_0_10px_rgba(34,197,94,0.22)]">
                  <PackageCheck className={cn("w-3.5 h-3.5 text-green-200", "md:w-5 md:h-5 lg:w-4 lg:h-4")} />
                </div>
                <span className={cn("text-xs font-bold text-green-100 leading-tight flex-1", "md:text-sm")}>Shipped Orders</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <span
                      role="button"
                      onClick={(e) => e.stopPropagation()}
                      className="text-green-600/60 hover:text-green-400 transition-colors"
                      data-testid="info-shipped"
                    >
                      <Info className="w-3 h-3" />
                    </span>
                  </PopoverTrigger>
                  <PopoverContent side="top" className="w-60 text-xs text-gray-300 bg-gray-900 border-gray-700 p-2.5">
                    Review completed shipments, tracking history, and delivery confirmations.
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem] justify-end" data-testid="shipped-stats">
                {(stats?.shippedOrders ?? 0) > 0 ? (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-600/30" data-testid="shipped-count">
                    {formatNumber(stats!.shippedOrders)} shipped
                  </span>
                ) : stats ? (
                  <span className="text-[9px] text-gray-500/70">No shipments yet</span>
                ) : null}
              </div>
            </button>

          </div>
          )}

          {/* UPLINK — Order Channels */}
          {panelTab === 'uplink' && (
            <div className="flex flex-col gap-2" data-testid="section-order-channels">
              <OrderSyncPanel platform="bricklink" onOpenSettings={onOpenSettings} />
              {ORDER_SYNC_CHANNEL_KEYS.map(key => (
                <OrderSyncPanel key={key} platform={key} onOpenSettings={onOpenSettings} />
              ))}
              <QtySyncQueuePanel />
            </div>
          )}
        </div>

      </div>

    </div>
  );
}

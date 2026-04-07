import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ShoppingCart, PackageCheck, BarChart2, Activity,
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
import DashboardNotifications, { useSyncIssueCount } from "./DashboardNotifications";
import { DateRangeValue, CollapsibleDatePicker } from "./DateRangeSelector";
import OrderSyncPanel, { PLATFORM_CONFIG, OrderSyncPlatform } from "./OrderSyncPanel";
import { type SalesDrawer } from "./SalesDashboard";

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
  onSalesDrawer?: (drawer: SalesDrawer) => void;
  dateRange?: DateRangeValue;
  onOpenSettings?: (section?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'billing', focusTarget?: 'channelSync' | 'schedulerInventory' | 'schedulerOrders' | 'schedulerChannel') => void;
  desktopMode?: boolean;
  tvSplit?: 'left' | 'right';
  compact?: boolean;
  /** Deep-link to this tab on mount / when value changes. */
  initialPanelTab?: 'systems' | 'uplink';
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
        <div className={cn("flex items-center", isCompact ? "gap-1" : "gap-2")}>
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
            <p className="text-xs text-gray-400 leading-tight">
              {hasPending && `${stats!.pending} pending retry${stats!.pending !== 1 ? 's' : ''}`}
              {hasPending && hasAbandoned && ' · '}
              {hasAbandoned && `${stats!.abandoned} need${stats!.abandoned === 1 ? 's' : ''} manual fix`}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {hasAbandoned && (
              <Badge variant="outline" className="text-[11px] bg-red-500/20 border-red-500/50 text-red-300 no-default-active-elevate">
                Action Required
              </Badge>
            )}
            {hasPending && !hasAbandoned && (
              <Badge variant="outline" className="text-[11px] bg-amber-500/20 border-amber-400/72 text-amber-300 no-default-active-elevate">
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
                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Pending / Needs Action</p>
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
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        <span className="text-gray-500">{item.sourcePlatform}</span>
                        <ArrowRight className="w-2.5 h-2.5" />
                        <span className={cn("font-medium", item.targetPlatform === 'BrickOwl' ? "text-blue-300" : "text-orange-300")}>
                          {item.targetPlatform}
                        </span>
                      </div>
                      <div className="ml-auto flex items-center gap-1.5">
                        {item.status === 'abandoned' ? (
                          <Badge variant="outline" className="text-[11px] bg-red-500/20 border-red-500/50 text-red-300 no-default-active-elevate">
                            Manual Fix Needed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[11px] bg-amber-500/20 border-amber-400/72 text-amber-300 no-default-active-elevate">
                            Attempt {item.retryCount + 1}/10
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                      <span>Qty: <span className={cn("font-mono font-medium", item.quantityDelta < 0 ? "text-red-300" : "text-green-300")}>{fmtDelta(item.quantityDelta)}</span></span>
                      {item.sourceOrderId && <span>Order: <span className="text-gray-300">{item.sourceOrderId}</span></span>}
                      {item.lastAttemptAt && <span>Last tried: {fmtTime(item.lastAttemptAt)}</span>}
                    </div>

                    {item.lastError && (
                      <p className="text-xs text-red-400/80 bg-red-500/10 rounded px-2 py-1 font-mono break-all leading-tight">
                        {item.lastError}
                      </p>
                    )}

                    <div className="flex gap-1.5 flex-wrap">
                      {item.status === 'abandoned' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-6 px-2 border-amber-500/40 text-amber-300"
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
                        className="text-xs h-6 px-2 border-gray-600 text-gray-400"
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
                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Recently Healed</p>
                {doneItems.slice(0, 10).map(item => (
                  <div key={item.id} className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg bg-green-500/8 border border-green-500/20" data-testid={`sync-queue-done-${item.id}`}>
                    <CheckCircle2 className="w-3 h-3 text-green-400 flex-shrink-0" />
                    <span className="text-xs font-mono text-gray-300">{item.itemNo ?? `inv#${item.blInventoryId}`}</span>
                    <ArrowRight className="w-2 h-2 text-gray-600 flex-shrink-0" />
                    <span className="text-xs text-gray-400">{item.targetPlatform}</span>
                    <span className="ml-auto text-xs text-green-400">Synced</span>
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

export default function OrdersDashboard({ onItemClick, activeDrawer, onDrawerChange, onSalesDrawer, dateRange: initialDateRange = 'mtd', onOpenSettings, desktopMode, tvSplit, compact, initialPanelTab }: OrdersDashboardProps) {
  const isCompact = !!(tvSplit || compact);
  const [dateRange, setDateRange] = useState<DateRangeValue>(initialDateRange);
  const [panelTab, setPanelTab] = useState<'systems' | 'uplink'>(initialPanelTab ?? 'systems');

  useEffect(() => {
    if (initialPanelTab) setPanelTab(initialPanelTab);
  }, [initialPanelTab]);

  const ordersSyncIssueCount = useSyncIssueCount(['orders']);

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
        <div className={isCompact ? "p-2 space-y-2 h-full overflow-y-auto" : "p-2 space-y-3 bg-gradient-to-br from-lego-orange/10 to-lego-orange/3 rounded-lg border border-lego-orange/35 shadow-[0_0_22px_rgba(251,146,60,0.18)]"}>
      {(!tvSplit || tvSplit === 'left') && <>

        {/* ── Sales Info ── */}
        <div className={cn("relative bg-gradient-to-b from-orange-900/40 to-gray-900/88 border border-orange-400/65 rounded-lg shadow-[0_0_28px_rgba(249,115,22,0.25)] overflow-hidden", isCompact ? "p-2" : "p-1 md:p-2.5")} data-testid="section-orders-overview">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-orange-300/85 to-transparent" />
          <div className={cn("flex items-center", isCompact ? "gap-1.5 mb-1.5" : "gap-2 mb-2")}>
            <div className={cn("rounded-md bg-orange-900/60 ring-1 ring-orange-500/50 shadow-[0_0_10px_rgba(249,115,22,0.25)] shrink-0", isCompact ? "p-1.5" : "p-1.5")}>
              <ShoppingCart className={cn("text-orange-200", isCompact ? "w-3.5 h-3.5" : "w-3 h-3 md:w-4 md:h-4")} />
            </div>
            <h3 className={cn("font-semibold text-orange-200 uppercase tracking-wide min-w-0", isCompact ? "text-xs" : "text-xs md:text-sm")}>Sales</h3>
            <CollapsibleDatePicker
              value={dateRange}
              onChange={setDateRange}
              accentClass="text-orange-400/70 hover:text-orange-300"
              testId="button-orders-date-picker"
            />
          </div>
          {/* Row 1 — Sales / Financial */}
          <div className={cn("grid grid-cols-4", isCompact ? "gap-1.5 mb-1.5" : "gap-1.5 mb-1.5")} data-testid="section-orders-sales">
            <MetricCard label="Revenue" value={stats ? `$${Math.round(stats.monthRevenue).toLocaleString()}` : '—'} color="green" compact={isCompact} data-testid="metric-orders-revenue" />
            <MetricCard label="Refunds" value={adjustments ? (adjustments.totalRefunds > 0 ? `-$${Math.round(adjustments.totalRefunds).toLocaleString()}` : '$0') : '—'} color="red" compact={isCompact} data-testid="metric-orders-refunds" />
            <MetricCard label="Shipping" value={adjustments ? `$${Math.round(adjustments.totalShipping).toLocaleString()}` : '—'} color="orange" compact={isCompact} data-testid="metric-orders-shipping" />
            <MetricCard label="Avg Order" value={stats ? formatCurrency(aov) : '—'} color="orange" compact={isCompact} data-testid="metric-aov" />
          </div>
          {/* Row 2 — Orders / Operational */}
          <div className={cn("grid grid-cols-4", isCompact ? "gap-1.5" : "gap-1.5")} data-testid="section-orders-ops">
            <MetricCard label="Total Orders" value={stats ? formatNumber(stats.totalOrders) : '—'} color="orange" compact={isCompact} data-testid="metric-total-orders" />
            <MetricCard label="Avg Lots" value={stats ? stats.avgLotsPerOrder.toFixed(1) : '—'} color="orange" compact={isCompact} data-testid="metric-avg-lots" />
            <MetricCard label="Fulfill Rate" value={stats ? formatPct(fulfillmentRate) : '—'} color="green" compact={isCompact} data-testid="metric-fulfillment-rate" />
            <MetricCard label="Return Rate" value={adjustments ? formatPct(returnRate) : '—'} color={returnRate > 5 ? 'red' : 'yellow'} compact={isCompact} data-testid="metric-return-rate" />
          </div>
        </div>

        {/* ── COMMAND CENTRAL ─ Focus panel ── */}
        {(() => {
          const totalActive = (workflowSummary?.byStatus?.new ?? 0)
            + (workflowSummary?.byStatus?.processing ?? 0)
            + (workflowSummary?.byStatus?.unpaid ?? 0)
            + (workflowSummary?.byStatus?.bump ?? 0)
            + (workflowSummary?.byStatus?.issue ?? 0)
            + (workflowSummary?.byStatus?.on_hold ?? 0);
          const hasAction = totalActive > 0;
          return (
        <div
          className={cn(
            "relative rounded-lg border cursor-pointer hover-elevate active-elevate-2 transition-all",
            isCompact ? "p-2" : "p-1 md:p-2.5",
            hasAction
              ? "border-orange-400/60 bg-gradient-to-b from-gray-700/55 to-gray-900/95 shadow-[0_3px_0_rgba(0,0,0,0.55),0_0_18px_rgba(249,115,22,0.25)]"
              : "border-gray-600/55 bg-gradient-to-b from-gray-800/50 to-gray-900/92 shadow-[0_3px_0_rgba(0,0,0,0.45),0_0_10px_rgba(249,115,22,0.10)]"
          )}
          data-testid="section-command-central-orders"
          onClick={() => onDrawerChange('fulfillment')}
        >
          {/* Top accent bar */}
          <div className={cn(
            "absolute top-0 left-0 right-0 h-[2px] rounded-t-lg",
            hasAction
              ? "bg-gradient-to-r from-orange-600/50 via-orange-400/80 to-orange-600/50"
              : "bg-gradient-to-r from-transparent via-gray-500/30 to-transparent"
          )} />

          {/* Header */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <div className={cn(
              "rounded-md ring-1 shrink-0 p-1",
              hasAction
                ? "bg-orange-800/65 ring-orange-500/55 shadow-[0_0_6px_rgba(249,115,22,0.3)]"
                : "bg-gray-800/70 ring-gray-600/40"
            )}>
              <Crosshair className={cn("w-3 h-3", hasAction ? "text-orange-300" : "text-gray-500")} />
            </div>
            <h3 className="text-[10px] font-semibold uppercase tracking-wide flex-1 text-gray-400">Command Central</h3>
            {hasAction ? (
              <div className="flex items-center gap-1 shrink-0">
                <div className="relative w-1.5 h-1.5 shrink-0">
                  <div className="absolute inset-0 rounded-full bg-orange-400/50 animate-ping" />
                  <div className="relative w-1.5 h-1.5 rounded-full bg-orange-400" />
                </div>
                <span className="text-[9px] font-semibold text-orange-300/80 font-mono">{totalActive} active</span>
              </div>
            ) : (
              <span className="text-[9px] text-gray-600 shrink-0">all clear</span>
            )}
          </div>

          {/* Workflow row — New → In Prog → Feedback */}
          <div className="grid grid-cols-3 gap-1 mb-1" data-testid="directive-workflow-grid">
            {([
              { key: 'new',        label: 'New',     lampColor: 'rgba(156,163,175,0.85)', activeClass: 'bg-gray-800/95 border-gray-400/60 text-gray-200',  isFeedback: false },
              { key: 'processing', label: 'In Prog', lampColor: 'rgba(96,165,250,0.85)',  activeClass: 'bg-blue-950/95 border-blue-400/60 text-blue-200',  isFeedback: false },
              { key: 'feedback',   label: 'Fdbk',    lampColor: 'rgba(45,212,191,0.85)',  activeClass: 'bg-teal-950/95 border-teal-400/60 text-teal-200',  isFeedback: true  },
            ] as const).map(({ key, label, lampColor, activeClass, isFeedback }) => {
              const count = isFeedback
                ? (fulfillmentStats?.feedbackPending ?? 0)
                : (workflowSummary?.byStatus?.[key] ?? 0);
              const isActive = count > 0;
              return (
                <button
                  key={key}
                  onClick={(e) => { e.stopPropagation(); onDrawerChange('fulfillment'); }}
                  data-testid={`directive-status-${key}`}
                  style={isActive ? { '--lamp-color': lampColor } as React.CSSProperties : undefined}
                  className={cn(
                    "relative overflow-hidden flex flex-col items-center justify-center rounded-md border min-h-[36px] py-1 cursor-pointer transition-colors",
                    isActive ? cn("panel-lamp-active", activeClass) : "bg-gray-950/90 border-gray-700/35"
                  )}
                >
                  {/* Pressed-in: dark inset at top, light lip at bottom */}
                  <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-b from-black/40 to-transparent pointer-events-none" />
                  <div className="absolute inset-x-0 bottom-0 h-px bg-white/10 pointer-events-none" />
                  <span className={cn("font-mono font-bold leading-none text-sm", isActive ? "text-white" : "text-gray-700")}>
                    {(workflowSummary || isFeedback) ? (count > 0 ? count : '0') : '—'}
                  </span>
                  <span className={cn("uppercase tracking-widest leading-none mt-0.5 text-[7px] font-semibold", isActive ? "opacity-60" : "opacity-20")}>{label}</span>
                </button>
              );
            })}
          </div>

          {/* Exceptions separator */}
          <div className="flex items-center gap-1 mb-1">
            <div className="flex-1 h-px bg-red-900/25" />
            <span className="text-[6px] font-mono uppercase tracking-widest text-red-400/35">exceptions</span>
            <div className="flex-1 h-px bg-red-900/25" />
          </div>

          {/* Exception row — Unpaid · Bump · Issue · Hold */}
          <div className="grid grid-cols-4 gap-1">
            {([
              { key: 'unpaid',  label: 'Unpaid', lampColor: 'rgba(249,115,22,0.85)',  activeClass: 'bg-orange-950/95 border-orange-400/60 text-orange-200'  },
              { key: 'bump',    label: 'Bump',   lampColor: 'rgba(251,191,36,0.85)',  activeClass: 'bg-amber-950/95 border-amber-400/60 text-amber-200'    },
              { key: 'issue',   label: 'Issue',  lampColor: 'rgba(248,113,113,0.85)', activeClass: 'bg-red-950/95 border-red-400/60 text-red-200'           },
              { key: 'on_hold', label: 'Hold',   lampColor: 'rgba(192,132,252,0.85)', activeClass: 'bg-purple-950/95 border-purple-400/60 text-purple-200'  },
            ] as const).map(({ key, label, lampColor, activeClass }) => {
              const count = workflowSummary?.byStatus?.[key] ?? 0;
              const isActive = count > 0;
              return (
                <button
                  key={key}
                  onClick={(e) => { e.stopPropagation(); onDrawerChange('fulfillment'); }}
                  data-testid={`directive-status-${key}`}
                  style={isActive ? { '--lamp-color': lampColor } as React.CSSProperties : undefined}
                  className={cn(
                    "relative overflow-hidden flex flex-col items-center justify-center rounded-md border min-h-[28px] py-0.5 cursor-pointer transition-colors",
                    isActive ? cn("panel-lamp-active", activeClass) : "bg-gray-950/90 border-gray-700/35"
                  )}
                >
                  <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-b from-black/40 to-transparent pointer-events-none" />
                  <div className="absolute inset-x-0 bottom-0 h-px bg-white/10 pointer-events-none" />
                  <span className={cn("font-mono font-bold leading-none text-xs", isActive ? "text-white" : "text-gray-700")}>
                    {workflowSummary ? (count > 0 ? count : '0') : '—'}
                  </span>
                  <span className={cn("uppercase tracking-widest leading-none mt-0.5 text-[6px] font-semibold", isActive ? "opacity-60" : "opacity-20")}>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
          );
        })()}
      </>}
      {(!tvSplit || tvSplit === 'right') && <>

        {/* ── SYSTEMS / UPLINK tab panel ── */}
        <div className={cn("relative bg-gradient-to-b from-gray-800/75 to-gray-900/95 border border-gray-400/60 rounded-lg shadow-[0_0_20px_rgba(255,255,255,0.08)] overflow-hidden", isCompact ? "p-2" : "p-1 md:p-2.5")} data-testid="section-panel-tabs">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gray-100/65 to-transparent" />

          {/* Retro control panel tab strip */}
          <div className={cn("flex rounded-md border border-gray-500/30 bg-black/50 p-0.5 gap-0.5 shadow-inner", isCompact ? "mb-2" : "mb-3")} data-testid="control-panel-tabs">
            <button
              onClick={() => setPanelTab('systems')}
              data-testid="tab-systems"
              className={cn(
                "relative flex-1 flex items-center justify-center rounded transition-all duration-200 text-xs font-bold uppercase tracking-widest",
                isCompact ? "gap-1 py-1" : "gap-1.5 py-1.5",
                panelTab === 'systems'
                  ? "bg-gray-700/90 text-gray-100 shadow-[0_0_14px_rgba(255,255,255,0.07)]"
                  : "text-gray-400 hover:text-gray-200"
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
                "relative flex-1 flex items-center justify-center rounded transition-all duration-200 text-xs font-bold uppercase tracking-widest",
                isCompact ? "gap-1 py-1" : "gap-1.5 py-1.5",
                panelTab === 'uplink'
                  ? "bg-gray-700/90 text-gray-100 shadow-[0_0_14px_rgba(255,255,255,0.07)]"
                  : "text-gray-400 hover:text-gray-200"
              )}
            >
              <Globe className="w-3 h-3 flex-shrink-0" />
              Channels
              {(hasOrderChannelErrors || ordersSyncIssueCount > 0) && panelTab !== 'uplink' && (
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse flex-shrink-0" data-testid="badge-channel-errors" />
              )}
              {panelTab === 'uplink' && (
                <span className="absolute bottom-0 inset-x-3 h-px bg-gradient-to-r from-transparent via-gray-300/70 to-transparent" />
              )}
            </button>
          </div>

          {/* SYSTEMS — Tools grid */}
          {panelTab === 'systems' && (
          <div className={cn("flex flex-col", isCompact ? "gap-1.5" : "gap-2")} data-testid="section-order-tools">

            {/* Tool cards row */}
            <div className={cn("grid grid-cols-2", isCompact ? "gap-1.5" : "gap-2")}>

              {/* Platform Performance */}
              <button
                onClick={() => onSalesDrawer?.('platform-perf')}
                data-testid="tool-platform-performance"
                className={cn("group flex flex-col gap-1.5 rounded-lg border border-orange-400/72 bg-gradient-to-br from-orange-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", isCompact ? "p-2" : "p-1.5 md:p-3")}
                style={{ '--tool-glow-color': 'rgba(249,115,22,0.35)' } as React.CSSProperties}
              >
                <div className={cn("flex items-center", isCompact ? "gap-1" : "gap-1.5")}>
                  <div className={cn("rounded-lg bg-orange-800/75 flex-shrink-0", isCompact ? "p-1.5" : "p-1 md:p-1.5", "ring-1 ring-orange-400/65 shadow-[0_0_10px_rgba(249,115,22,0.22)]")}>
                    <BarChart2 className="w-3 h-3 text-orange-200" />
                  </div>
                  <span className="text-[11px] font-bold text-orange-100 leading-tight flex-1 min-w-0">By Platform</span>
                </div>
                <p className="text-[10px] text-orange-300/60 leading-snug">Sales by marketplace</p>
              </button>

              {/* Sales Chart */}
              <button
                onClick={() => onSalesDrawer?.('chart')}
                data-testid="tool-sales-chart"
                className={cn("group flex flex-col gap-1.5 rounded-lg border border-teal-400/72 bg-gradient-to-br from-teal-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", isCompact ? "p-2" : "p-1.5 md:p-3")}
                style={{ '--tool-glow-color': 'rgba(20,184,166,0.35)' } as React.CSSProperties}
              >
                <div className={cn("flex items-center", isCompact ? "gap-1" : "gap-1.5")}>
                  <div className={cn("rounded-lg bg-teal-800/75 flex-shrink-0", isCompact ? "p-1.5" : "p-1 md:p-1.5", "ring-1 ring-teal-400/65 shadow-[0_0_10px_rgba(20,184,166,0.22)]")}>
                    <Activity className="w-3 h-3 text-teal-200" />
                  </div>
                  <span className="text-[11px] font-bold text-teal-100 leading-tight flex-1 min-w-0">Sales Chart</span>
                </div>
                <p className="text-[10px] text-teal-300/60 leading-snug">Revenue trend</p>
              </button>

              {/* Shipped Orders */}
              <button
                onClick={() => onDrawerChange('shipped')}
                data-testid="tool-shipped"
                className={cn("group flex flex-col gap-1.5 rounded-lg border border-green-400/72 bg-gradient-to-br from-green-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", isCompact ? "p-2" : "p-1.5 md:p-3")}
                style={{ '--tool-glow-color': 'rgba(34,197,94,0.35)' } as React.CSSProperties}
              >
                <div className={cn("flex items-center", isCompact ? "gap-1" : "gap-1.5")}>
                  <div className={cn("rounded-lg bg-green-800/75 flex-shrink-0", isCompact ? "p-1.5" : "p-1 md:p-1.5", "ring-1 ring-green-400/65 shadow-[0_0_10px_rgba(34,197,94,0.22)]")}>
                    <PackageCheck className="w-3 h-3 text-green-200" />
                  </div>
                  <span className="text-[11px] font-bold text-green-100 leading-tight flex-1 min-w-0">Shipped</span>
                </div>
                <div className="flex flex-wrap gap-1" data-testid="shipped-stats">
                  {(stats?.shippedOrders ?? 0) > 0 ? (
                    <span className="text-[10px] font-semibold px-1 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-600/30" data-testid="shipped-count">
                      {formatNumber(stats!.shippedOrders)} shipped
                    </span>
                  ) : stats ? (
                    <span className="text-[10px] text-gray-500/70">None yet</span>
                  ) : null}
                </div>
              </button>

            </div>
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
              {isCompact && <DashboardNotifications groupKeys={['orders']} />}

            </div>
          )}
        </div>
      </>}

    </div>
  );
}

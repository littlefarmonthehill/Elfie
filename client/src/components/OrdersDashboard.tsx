import { useQuery } from "@tanstack/react-query";
import {
  ShoppingCart, Truck, PackageCheck,
  Sparkles, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import MetricCard from "./MetricCard";
import { DateRangeValue } from "./DateRangeSelector";

interface OrderStats {
  totalOrders: number;
  pendingOrders: number;
  shippedOrders: number;
  pendingRevenue: number;
  monthRevenue: number;
  avgLotsPerOrder: number;
}

interface OrdersDashboardProps {
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
  activeDrawer: 'fulfillment' | 'shipped' | null;
  onDrawerChange: (drawer: 'fulfillment' | 'shipped' | null) => void;
  dateRange?: DateRangeValue;
  onOpenSettings?: (section?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'users' | 'billing') => void;
  dateRangeSlot?: React.ReactNode;
}

export default function OrdersDashboard({ onItemClick, activeDrawer, onDrawerChange, dateRange = 'mtd', onOpenSettings, dateRangeSlot }: OrdersDashboardProps) {
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

  const { data: fulfillmentStats } = useQuery<{ unfulfilled: number }>({
    queryKey: ['/api/fulfillment/stats'],
    staleTime: 2 * 60 * 1000,
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
  const fulfillmentRate = stats && stats.totalOrders > 0 ? (stats.shippedOrders / stats.totalOrders) * 100 : 0;
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
        <div className="p-2 space-y-3 bg-gradient-to-br from-lego-orange/5 to-transparent rounded-lg border border-lego-orange/10 shadow-[0_0_15px_rgba(251,146,60,0.1)]">
      <div className="space-y-3">

        {/* ── Orders Info ── */}
        <div className={cn("relative bg-gradient-to-b from-orange-950/25 to-gray-900/85 border border-orange-500/40 rounded-lg shadow-[0_0_22px_rgba(249,115,22,0.12)] overflow-hidden", "p-2.5")} data-testid="section-orders-overview">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-orange-400/50 to-transparent" />
          <div className={cn("flex flex-wrap items-center gap-2", "mb-2")}>
            <div className="p-1.5 rounded-md bg-orange-900/60 ring-1 ring-orange-500/50 shadow-[0_0_10px_rgba(249,115,22,0.25)]">
              <ShoppingCart className={cn("w-3 h-3 text-orange-200", "md:w-4 md:h-4")} />
            </div>
            <h3 className={cn("text-xs font-semibold text-orange-200 uppercase tracking-wide", "md:text-sm lg:text-base")}>Orders</h3>
            {dateRangeSlot && <div className="ml-auto max-w-full overflow-x-auto">{dateRangeSlot}</div>}
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

        {/* ── Tools ── */}
        <div className={cn("relative bg-gradient-to-b from-gray-800/45 to-gray-900/85 border border-gray-600/50 rounded-lg shadow-[0_0_16px_rgba(255,255,255,0.03)] overflow-hidden", "p-2.5")} data-testid="section-order-tools">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gray-400/25 to-transparent" />
          <div className={cn("flex items-center gap-2", "mb-2")}>
            <div className="p-1.5 rounded-md bg-gray-700/60 ring-1 ring-gray-500/40">
              <Sparkles className={cn("w-3 h-3 text-gray-200", "md:w-4 md:h-4")} />
            </div>
            <h3 className={cn("text-xs font-semibold text-gray-200 uppercase tracking-wide", "md:text-sm lg:text-base")}>Tools</h3>
          </div>
          <div className={cn("grid grid-cols-2", "gap-2")}>

            {/* Fulfillment & Shipping */}
            <button
              onClick={() => onDrawerChange('fulfillment')}
              data-testid="tool-fulfillment"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-orange-500/50 bg-gradient-to-br from-orange-950/65 to-gray-950/80 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", "p-3")}
              style={{ '--tool-glow-color': 'rgba(249,115,22,0.35)' } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-orange-900/70 p-1.5 ring-1 ring-orange-500/45 shadow-[0_0_10px_rgba(249,115,22,0.22)]">
                  <Truck className={cn("w-3.5 h-3.5 text-orange-200", "md:w-5 md:h-5")} />
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
                {(stats?.pendingOrders ?? 0) > 0 ? (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-600/30" data-testid="fulfillment-count">
                    {formatNumber(stats!.pendingOrders)} pending
                  </span>
                ) : stats ? (
                  <span className="text-[9px] text-green-400/70">All caught up</span>
                ) : null}
              </div>
            </button>

            {/* Shipped Orders */}
            <button
              onClick={() => onDrawerChange('shipped')}
              data-testid="tool-shipped"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-green-500/50 bg-gradient-to-br from-green-950/65 to-gray-950/80 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", "p-3")}
              style={{ '--tool-glow-color': 'rgba(34,197,94,0.35)' } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-green-900/70 p-1.5 ring-1 ring-green-500/45 shadow-[0_0_10px_rgba(34,197,94,0.22)]">
                  <PackageCheck className={cn("w-3.5 h-3.5 text-green-200", "md:w-5 md:h-5")} />
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
        </div>

      </div>

    </div>
  );
}

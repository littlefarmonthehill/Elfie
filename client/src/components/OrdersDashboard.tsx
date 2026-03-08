import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle, ShoppingCart, TrendingUp, Truck, PackageCheck, X,
  Sparkles, Info, ArrowRight, Package, Clock, DollarSign,
} from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import MetricCard from "./MetricCard";
import FulfillmentTool from "./FulfillmentTool";
import ShippedOrdersTool from "./ShippedOrdersTool";

interface Order {
  id: string;
  orderNumber: string;
  orderDate: string;
  orderStatus: string;
  orderTotal: string;
  netTotal: string;
  customerUsername: string;
  items: any[];
}

interface OrderStats {
  totalOrders: number;
  pendingOrders: number;
  shippedOrders: number;
  pendingRevenue: number;
  monthRevenue: number;
}

function OrderAmount({ order }: { order: Order }) {
  const gross = Number(order.orderTotal || 0);
  const net = Number(order.netTotal ?? order.orderTotal ?? 0);
  const hasAdj = Math.abs(gross - net) >= 0.01;
  return (
    <span className="flex flex-col items-end ml-2 flex-shrink-0">
      <span className="text-lego-green font-mono font-medium text-xs md:text-base lg:text-lg">
        ${net.toFixed(2)}
      </span>
      {hasAdj && (
        <span className="text-gray-500 font-mono text-[10px] md:text-xs line-through leading-none">
          ${gross.toFixed(2)}
        </span>
      )}
    </span>
  );
}

interface OrdersDashboardProps {
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
  activeDrawer: 'fulfillment' | 'shipped' | null;
  onDrawerChange: (drawer: 'fulfillment' | 'shipped' | null) => void;
}

export default function OrdersDashboard({ onItemClick, activeDrawer, onDrawerChange }: OrdersDashboardProps) {
  const { data: stats, isLoading: statsLoading } = useQuery<OrderStats>({
    queryKey: ['/api/orders/stats'],
    staleTime: 2 * 60 * 1000,
  });

  const { data: fulfillmentStats } = useQuery<{ unfulfilled: number }>({
    queryKey: ['/api/fulfillment/stats'],
    staleTime: 2 * 60 * 1000,
  });

  const { data, isLoading } = useQuery<{
    pending: Order[];
    recentShipments: Order[];
    highValue: Order[];
  }>({
    queryKey: ['/api/orders/dashboard'],
  });

  const pendingOrders = data?.pending || [];
  const recentShipments = data?.recentShipments || [];
  const highValueOrders = data?.highValue || [];

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

  const formatNumber = (value: number) =>
    new Intl.NumberFormat('en-US').format(value);

  if (isLoading && statsLoading) {
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
    <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-orange/5 to-transparent rounded-lg border border-lego-orange/10 shadow-[0_0_15px_rgba(251,146,60,0.1)]">
      <div className="space-y-1.5">

        {/* ── Orders Info ── */}
        <div className="bg-gray-900/50 border border-orange-500/20 rounded-lg p-3" data-testid="section-orders-overview">
          <div className="flex items-center gap-2 mb-2.5">
            <ShoppingCart className="w-3.5 h-3.5 md:w-5 md:h-5 text-orange-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-orange-400 uppercase tracking-wide">Orders</h3>
          </div>
          <div className="grid grid-cols-3 gap-1.5 mb-2" data-testid="section-orders-counts">
            <MetricCard label="Total" value={stats ? formatNumber(stats.totalOrders) : '—'} color="orange" data-testid="metric-total-orders" />
            <MetricCard label="Pending" value={stats ? formatNumber(stats.pendingOrders) : '—'} color="orange" data-testid="metric-pending-orders" />
            <MetricCard label="Shipped" value={stats ? formatNumber(stats.shippedOrders) : '—'} color="green" data-testid="metric-shipped-orders" />
          </div>
          <div className="grid grid-cols-2 gap-1.5" data-testid="section-orders-revenue">
            <MetricCard label="Pending Revenue" value={stats ? formatCurrency(stats.pendingRevenue) : '$0.00'} color="orange" data-testid="metric-pending-revenue" />
            <MetricCard label="Month Revenue" value={stats ? formatCurrency(stats.monthRevenue) : '$0.00'} color="green" data-testid="metric-month-revenue" />
          </div>
        </div>

        {/* ── Tools ── */}
        <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-3" data-testid="section-order-tools">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-3.5 h-3.5 md:w-5 md:h-5 text-gray-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-gray-400 uppercase tracking-wide">Tools</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">

            {/* Fulfillment & Shipping */}
            <button
              onClick={() => onDrawerChange('fulfillment')}
              data-testid="tool-fulfillment"
              className="group flex flex-col gap-1.5 rounded-lg border border-orange-700/40 bg-orange-950/40 p-3 text-left hover-elevate active-elevate-2 transition-all"
            >
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-orange-900/60 p-1.5">
                  <Truck className="w-3.5 h-3.5 md:w-5 md:h-5 text-orange-300" />
                </div>
                <span className="text-xs md:text-sm font-bold text-orange-200 leading-tight flex-1">Fulfillment</span>
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
              <div className="flex flex-wrap gap-1 min-h-[1.25rem]" data-testid="fulfillment-stats">
                {(fulfillmentStats?.unfulfilled ?? 0) > 0 ? (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-600/30" data-testid="fulfillment-count">
                    {fulfillmentStats!.unfulfilled} need action
                  </span>
                ) : fulfillmentStats ? (
                  <span className="text-[9px] text-green-400/70">All caught up</span>
                ) : null}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] md:text-xs text-orange-400 font-medium">Open tool</span>
                <ArrowRight className="w-3 h-3 md:w-4 md:h-4 text-orange-500/60 group-hover:text-orange-300 transition-colors" />
              </div>
            </button>

            {/* Shipped Orders */}
            <button
              onClick={() => onDrawerChange('shipped')}
              data-testid="tool-shipped"
              className="group flex flex-col gap-1.5 rounded-lg border border-green-700/40 bg-green-950/40 p-3 text-left hover-elevate active-elevate-2 transition-all"
            >
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-green-900/60 p-1.5">
                  <PackageCheck className="w-3.5 h-3.5 md:w-5 md:h-5 text-green-300" />
                </div>
                <span className="text-xs md:text-sm font-bold text-green-200 leading-tight flex-1">Shipped Orders</span>
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
              <div className="flex flex-wrap gap-1 min-h-[1.25rem]" data-testid="shipped-stats">
                {(stats?.shippedOrders ?? 0) > 0 ? (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-600/30" data-testid="shipped-count">
                    {formatNumber(stats!.shippedOrders)} shipped total
                  </span>
                ) : stats ? (
                  <span className="text-[9px] text-gray-500/70">No shipments yet</span>
                ) : null}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] md:text-xs text-green-400 font-medium">Open tool</span>
                <ArrowRight className="w-3 h-3 md:w-4 md:h-4 text-green-500/60 group-hover:text-green-300 transition-colors" />
              </div>
            </button>

          </div>
        </div>

        {/* ── Action Items — Pending Orders ── */}
        <div className="bg-gray-900/50 border border-orange-500/20 rounded-lg p-3 md:p-5 lg:p-6" data-testid="section-pending-orders">
          <div className="flex items-center gap-1.5 md:gap-2 mb-2 md:mb-3">
            <AlertCircle className="w-3.5 h-3.5 md:w-5 md:h-5 text-orange-400" />
            <h3 className="text-xs md:text-base font-semibold text-orange-400 uppercase tracking-wide">Action Items — Pending</h3>
          </div>
          <div className="space-y-1.5">
            {pendingOrders.length > 0 ? (
              pendingOrders.map((order) => (
                <div
                  key={order.id}
                  onClick={() => onItemClick?.('order', order.id)}
                  className="flex justify-between items-center hover-elevate rounded px-2 py-1 cursor-pointer"
                  data-testid={`pending-order-${order.id}`}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <ShoppingCart className="w-3.5 h-3.5 md:w-5 md:h-5 text-orange-400 flex-shrink-0" />
                    <span className="text-gray-200 font-mono text-xs md:text-base font-medium">#{order.orderNumber}</span>
                    <span className="text-gray-400 text-[11px] md:text-sm">{order.customerUsername}</span>
                  </div>
                  <OrderAmount order={order} />
                </div>
              ))
            ) : (
              <div className="text-[11px] md:text-sm text-gray-500 italic">No pending orders</div>
            )}
          </div>
        </div>

        {/* ── Recent Activity — Shipped Orders ── */}
        <div className="bg-gray-900/50 border border-blue-500/20 rounded-lg p-3 md:p-5 lg:p-6" data-testid="section-recent-shipments">
          <div className="flex items-center gap-1.5 md:gap-2 mb-2 md:mb-3">
            <Package className="w-3.5 h-3.5 md:w-5 md:h-5 text-blue-400" />
            <h3 className="text-xs md:text-base font-semibold text-blue-400 uppercase tracking-wide">Recent Activity — Shipped</h3>
          </div>
          <div className="space-y-1.5">
            {recentShipments.length > 0 ? (
              recentShipments.map((order) => (
                <div
                  key={order.id}
                  onClick={() => onItemClick?.('order', order.id)}
                  className="flex justify-between items-center hover-elevate rounded px-2 py-1 cursor-pointer"
                  data-testid={`shipped-order-${order.id}`}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-green-400 flex-shrink-0" />
                    <span className="text-gray-200 font-mono text-xs md:text-base font-medium">#{order.orderNumber}</span>
                    <span className="text-gray-400 text-[11px] md:text-sm">{order.customerUsername}</span>
                  </div>
                  <OrderAmount order={order} />
                </div>
              ))
            ) : (
              <div className="text-[11px] md:text-sm text-gray-500 italic">No recent shipments</div>
            )}
          </div>
        </div>

        {/* ── Highlights — High Value Orders ── */}
        <div className="bg-gray-900/50 border border-green-500/20 rounded-lg p-3 md:p-5 lg:p-6" data-testid="section-high-value-orders">
          <div className="flex items-center gap-1.5 md:gap-2 mb-2 md:mb-3">
            <TrendingUp className="w-3.5 h-3.5 md:w-5 md:h-5 text-green-400" />
            <h3 className="text-xs md:text-base font-semibold text-green-400 uppercase tracking-wide">Highlights — Top Value</h3>
          </div>
          <div className="space-y-1.5">
            {highValueOrders.length > 0 ? (
              highValueOrders.map((order) => (
                <div
                  key={order.id}
                  onClick={() => onItemClick?.('order', order.id)}
                  className="flex justify-between items-center hover-elevate rounded px-2 py-1 cursor-pointer"
                  data-testid={`high-value-order-${order.id}`}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <TrendingUp className="w-3.5 h-3.5 md:w-5 md:h-5 text-green-400 flex-shrink-0" />
                    <span className="text-gray-200 font-mono text-xs md:text-base font-medium">#{order.orderNumber}</span>
                    <span className="text-gray-400 text-[11px] md:text-sm">{order.customerUsername}</span>
                  </div>
                  <OrderAmount order={order} />
                </div>
              ))
            ) : (
              <div className="text-[11px] md:text-sm text-gray-500 italic">No orders to display</div>
            )}
          </div>
        </div>

      </div>

      {/* ── Fulfillment Drawer ── */}
      <Drawer open={activeDrawer === 'fulfillment'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[90vh]">
          <DrawerHeader className="relative">
            <DrawerTitle className="flex items-center gap-2 text-base md:text-lg">
              <Truck className="w-5 h-5 text-orange-400" />
              Fulfillment and Shipping
            </DrawerTitle>
            <DrawerClose className="absolute right-4 top-4" data-testid="button-close-fulfillment">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DrawerClose>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-4 flex-1">
            <FulfillmentTool />
          </div>
        </DrawerContent>
      </Drawer>

      {/* ── Shipped Orders Drawer ── */}
      <Drawer open={activeDrawer === 'shipped'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[90vh]">
          <DrawerHeader className="relative">
            <DrawerTitle className="flex items-center gap-2 text-base md:text-lg">
              <PackageCheck className="w-5 h-5 text-green-400" />
              Shipped Orders
            </DrawerTitle>
            <DrawerClose className="absolute right-4 top-4" data-testid="button-close-shipped">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DrawerClose>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-4 flex-1">
            <ShippedOrdersTool />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

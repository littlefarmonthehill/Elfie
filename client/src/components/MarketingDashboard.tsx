import { useQuery } from "@tanstack/react-query";
import {
  Users, TrendingUp, Star, Target, Sparkles, Info, ArrowRight,
  Megaphone, Heart, Trophy, X,
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
import { DateRangeValue } from "./DateRangeSelector";

interface Order {
  id: string;
  orderNumber: string;
  orderDate: string;
  orderStatus: string;
  orderTotal: string;
  customerUsername: string;
}

interface CustomerData {
  customerUsername: string;
  totalRevenue: number;
  orderCount: number;
  lastOrderDate: string;
}

export type MarketingDrawer = 'attract' | 'delight' | 'reward' | null;

interface MarketingDashboardProps {
  dateRange?: DateRangeValue;
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
  activeDrawer: MarketingDrawer;
  onDrawerChange: (drawer: MarketingDrawer) => void;
}

export default function MarketingDashboard({ dateRange = 'mtd', onItemClick, activeDrawer, onDrawerChange }: MarketingDashboardProps) {
  const parseOrderTotal = (v: string | null | undefined): number => {
    if (!v) return 0;
    const parsed = parseFloat(v.replace(/[^0-9.-]/g, ''));
    return isNaN(parsed) ? 0 : parsed;
  };

  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ['/api/orders', 'marketing', dateRange],
    queryFn: async () => {
      const response = await fetch(`/api/orders?range=${dateRange}&lean=true`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch orders');
      return response.json();
    },
    staleTime: 30000,
  });

  const getCustomerData = (): CustomerData[] => {
    const map = new Map<string, CustomerData>();
    orders.filter(o => !['cancelled', 'Cancelled'].includes(o.orderStatus)).forEach(order => {
      const customer = order.customerUsername || 'Unknown';
      const revenue = parseOrderTotal(order.orderTotal);
      if (map.has(customer)) {
        const e = map.get(customer)!;
        e.totalRevenue += revenue;
        e.orderCount += 1;
        if (new Date(order.orderDate) > new Date(e.lastOrderDate)) e.lastOrderDate = order.orderDate;
      } else {
        map.set(customer, { customerUsername: customer, totalRevenue: revenue, orderCount: 1, lastOrderDate: order.orderDate });
      }
    });
    return Array.from(map.values());
  };

  const customerData = getCustomerData();

  const getCustomerOrderId = (username: string): string | null => {
    const sorted = orders
      .filter(o => o.customerUsername === username && !['cancelled', 'Cancelled'].includes(o.orderStatus))
      .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
    return sorted[0]?.id ?? null;
  };

  const topCustomers = [...customerData].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 6);
  const repeatCustomers = customerData.filter(c => c.orderCount > 1).sort((a, b) => b.orderCount - a.orderCount).slice(0, 6);
  const recentNewCustomers = customerData
    .filter(c => {
      const days = (Date.now() - new Date(c.lastOrderDate).getTime()) / 86400000;
      return c.orderCount === 1 && days <= 30;
    })
    .sort((a, b) => new Date(b.lastOrderDate).getTime() - new Date(a.lastOrderDate).getTime())
    .slice(0, 6);

  const totalCustomers = customerData.length;
  const repeatCustomerCount = customerData.filter(c => c.orderCount > 1).length;
  const newLast30 = customerData.filter(c => {
    const days = (Date.now() - new Date(c.lastOrderDate).getTime()) / 86400000;
    return c.orderCount === 1 && days <= 30;
  }).length;
  const repeatRate = totalCustomers > 0 ? (repeatCustomerCount / totalCustomers * 100).toFixed(1) : '0.0';
  const avgOrders = totalCustomers > 0 ? (orders.length / totalCustomers).toFixed(1) : '0.0';

  if (isLoading) {
    return (
      <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-yellow/5 to-transparent rounded-lg border border-lego-yellow/10 shadow-[0_0_15px_rgba(234,179,8,0.1)]">
        <div className="flex items-center justify-center py-8">
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-yellow-400 border-t-transparent" />
            <p className="text-xs text-gray-500">Loading customer data...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-yellow/5 to-transparent rounded-lg border border-lego-yellow/10 shadow-[0_0_15px_rgba(234,179,8,0.1)]">
      <div className="space-y-1.5">

        {/* ── Customer Overview ── */}
        <div className="bg-gray-900/50 border border-yellow-500/20 rounded-lg p-3" data-testid="section-customer-overview">
          <div className="flex items-center gap-2 mb-2.5">
            <Users className="w-3.5 h-3.5 md:w-5 md:h-5 text-yellow-400" />
            <h3 className="text-xs md:text-base font-semibold text-yellow-400 uppercase tracking-wide">Customers</h3>
          </div>
          <div className="grid grid-cols-3 gap-1.5 mb-2" data-testid="section-customer-counts">
            <MetricCard label="Total" value={String(totalCustomers)} color="yellow" data-testid="metric-total-customers" />
            <MetricCard label="Repeat" value={String(repeatCustomerCount)} color="green" data-testid="metric-repeat-customers" />
            <MetricCard label="New (30d)" value={String(newLast30)} color="blue" data-testid="metric-new-customers" />
          </div>
          <div className="grid grid-cols-2 gap-1.5" data-testid="section-customer-rates">
            <MetricCard label="Repeat Rate" value={`${repeatRate}%`} color="green" data-testid="metric-repeat-rate" />
            <MetricCard label="Avg Orders" value={avgOrders} color="yellow" data-testid="metric-avg-orders" />
          </div>
        </div>

        {/* ── Tools ── */}
        <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-3" data-testid="section-marketing-tools">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-3.5 h-3.5 md:w-5 md:h-5 text-gray-400" />
            <h3 className="text-xs md:text-base font-semibold text-gray-400 uppercase tracking-wide">Tools</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">

            {/* Attract */}
            <button
              onClick={() => onDrawerChange('attract')}
              data-testid="tool-attract"
              className="group flex flex-col gap-1.5 rounded-lg border border-indigo-700/40 bg-indigo-950/40 p-3 text-left hover-elevate active-elevate-2 transition-all"
            >
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-indigo-900/60 p-1.5">
                  <Megaphone className="w-3.5 h-3.5 md:w-5 md:h-5 text-indigo-300" />
                </div>
                <span className="text-xs md:text-sm font-bold text-indigo-200 leading-tight flex-1">Attract New Customers</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <span
                      role="button"
                      onClick={(e) => e.stopPropagation()}
                      className="text-indigo-600/60 hover:text-indigo-400 transition-colors"
                      data-testid="info-attract"
                    >
                      <Info className="w-3 h-3" />
                    </span>
                  </PopoverTrigger>
                  <PopoverContent side="top" className="w-64 text-xs text-gray-300 bg-gray-900 border-gray-700 p-2.5">
                    Tools to grow your customer base — promotions, store visibility, and new buyer campaigns.
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem]">
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-600/25">
                  Coming soon
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] md:text-xs text-indigo-400 font-medium">Open tool</span>
                <ArrowRight className="w-3 h-3 md:w-4 md:h-4 text-indigo-500/60 group-hover:text-indigo-300 transition-colors" />
              </div>
            </button>

            {/* Delight */}
            <button
              onClick={() => onDrawerChange('delight')}
              data-testid="tool-delight"
              className="group flex flex-col gap-1.5 rounded-lg border border-cyan-700/40 bg-cyan-950/40 p-3 text-left hover-elevate active-elevate-2 transition-all"
            >
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-cyan-900/60 p-1.5">
                  <Heart className="w-3.5 h-3.5 md:w-5 md:h-5 text-cyan-300" />
                </div>
                <span className="text-xs md:text-sm font-bold text-cyan-200 leading-tight flex-1">Delight Current Customers</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <span
                      role="button"
                      onClick={(e) => e.stopPropagation()}
                      className="text-cyan-600/60 hover:text-cyan-400 transition-colors"
                      data-testid="info-delight"
                    >
                      <Info className="w-3 h-3" />
                    </span>
                  </PopoverTrigger>
                  <PopoverContent side="top" className="w-64 text-xs text-gray-300 bg-gray-900 border-gray-700 p-2.5">
                    Keep buyers coming back — post-purchase follow-ups, personalized offers, and satisfaction tracking.
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem]">
                {repeatCustomerCount > 0 ? (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-600/30">
                    {repeatCustomerCount} repeat buyers
                  </span>
                ) : (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-600/25">
                    Coming soon
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] md:text-xs text-cyan-400 font-medium">Open tool</span>
                <ArrowRight className="w-3 h-3 md:w-4 md:h-4 text-cyan-500/60 group-hover:text-cyan-300 transition-colors" />
              </div>
            </button>

            {/* Reward */}
            <button
              onClick={() => onDrawerChange('reward')}
              data-testid="tool-reward"
              className="group col-span-2 flex flex-col gap-1.5 rounded-lg border border-amber-700/40 bg-amber-950/40 p-3 text-left hover-elevate active-elevate-2 transition-all"
            >
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-amber-900/60 p-1.5">
                  <Trophy className="w-3.5 h-3.5 md:w-5 md:h-5 text-amber-300" />
                </div>
                <span className="text-xs md:text-sm font-bold text-amber-200 leading-tight flex-1">Reward Loyal &amp; High Spenders</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <span
                      role="button"
                      onClick={(e) => e.stopPropagation()}
                      className="text-amber-600/60 hover:text-amber-400 transition-colors"
                      data-testid="info-reward"
                    >
                      <Info className="w-3 h-3" />
                    </span>
                  </PopoverTrigger>
                  <PopoverContent side="top" className="w-64 text-xs text-gray-300 bg-gray-900 border-gray-700 p-2.5">
                    VIP perks, loyalty tiers, and exclusive discounts for your highest-value customers.
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem]">
                {topCustomers.length > 0 ? (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-600/30">
                    {topCustomers.length} top spenders
                  </span>
                ) : (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-600/25">
                    Coming soon
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] md:text-xs text-amber-400 font-medium">Open tool</span>
                <ArrowRight className="w-3 h-3 md:w-4 md:h-4 text-amber-500/60 group-hover:text-amber-300 transition-colors" />
              </div>
            </button>

          </div>
        </div>

        {/* ── Highlights — Top Customers ── */}
        <div className="bg-gray-900/50 border border-green-500/20 rounded-lg p-3 md:p-4" data-testid="section-top-customers">
          <div className="flex items-center gap-2 mb-2">
            <Star className="w-3.5 h-3.5 md:w-5 md:h-5 text-green-400" />
            <h3 className="text-xs md:text-base font-semibold text-green-400 uppercase tracking-wide">Highlights — Top by Revenue</h3>
          </div>
          <div className="space-y-1.5">
            {topCustomers.length > 0 ? (
              topCustomers.map((customer, idx) => (
                <div
                  key={customer.customerUsername + idx}
                  onClick={() => { const id = getCustomerOrderId(customer.customerUsername); if (id) onItemClick?.('order', id); }}
                  className="flex justify-between items-center hover-elevate rounded px-2 py-1 cursor-pointer"
                  data-testid={`top-customer-${idx}`}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Star className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                    <span className="text-gray-200 text-xs md:text-base font-medium">{customer.customerUsername}</span>
                    <span className="text-gray-400 text-[11px] md:text-sm">{customer.orderCount} {customer.orderCount === 1 ? 'order' : 'orders'}</span>
                  </div>
                  <span className="text-lego-green font-mono font-medium text-xs md:text-base ml-2 flex-shrink-0">${customer.totalRevenue.toFixed(2)}</span>
                </div>
              ))
            ) : (
              <div className="text-[11px] text-gray-500 italic">No customer data available</div>
            )}
          </div>
        </div>

        {/* ── Action Items — Repeat Customers ── */}
        <div className="bg-gray-900/50 border border-blue-500/20 rounded-lg p-3 md:p-4" data-testid="section-repeat-customers">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-3.5 h-3.5 md:w-5 md:h-5 text-blue-400" />
            <h3 className="text-xs md:text-base font-semibold text-blue-400 uppercase tracking-wide">Action Items — Engage Repeat Buyers</h3>
          </div>
          <div className="space-y-1.5">
            {repeatCustomers.length > 0 ? (
              repeatCustomers.map((customer, idx) => (
                <div
                  key={customer.customerUsername + idx}
                  onClick={() => { const id = getCustomerOrderId(customer.customerUsername); if (id) onItemClick?.('order', id); }}
                  className="flex justify-between items-center hover-elevate rounded px-2 py-1 cursor-pointer"
                  data-testid={`repeat-customer-${idx}`}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Users className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                    <span className="text-gray-200 text-xs md:text-base font-medium">{customer.customerUsername}</span>
                    <span className="text-gray-400 text-[11px] md:text-sm">{customer.orderCount}x buyer</span>
                  </div>
                  <span className="text-lego-green font-mono font-medium text-xs md:text-base ml-2 flex-shrink-0">${customer.totalRevenue.toFixed(2)}</span>
                </div>
              ))
            ) : (
              <div className="text-[11px] text-gray-500 italic">No repeat customers yet</div>
            )}
          </div>
        </div>

        {/* ── Recent Activity — New Customers ── */}
        <div className="bg-gray-900/50 border border-purple-500/20 rounded-lg p-3 md:p-4" data-testid="section-new-customers">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-3.5 h-3.5 md:w-5 md:h-5 text-purple-400" />
            <h3 className="text-xs md:text-base font-semibold text-purple-400 uppercase tracking-wide">Recent Activity — New (Last 30 Days)</h3>
          </div>
          <div className="space-y-1.5">
            {recentNewCustomers.length > 0 ? (
              recentNewCustomers.map((customer, idx) => (
                <div
                  key={customer.customerUsername + idx}
                  onClick={() => { const id = getCustomerOrderId(customer.customerUsername); if (id) onItemClick?.('order', id); }}
                  className="flex justify-between items-center hover-elevate rounded px-2 py-1 cursor-pointer"
                  data-testid={`new-customer-${idx}`}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full bg-purple-400 flex-shrink-0" />
                    <span className="text-gray-200 text-xs md:text-base font-medium">{customer.customerUsername}</span>
                    <span className="text-gray-400 text-[11px] md:text-sm">{new Date(customer.lastOrderDate).toLocaleDateString()}</span>
                  </div>
                  <span className="text-lego-green font-mono font-medium text-xs md:text-base ml-2 flex-shrink-0">${customer.totalRevenue.toFixed(2)}</span>
                </div>
              ))
            ) : (
              <div className="text-[11px] text-gray-500 italic">No new customers in last 30 days</div>
            )}
          </div>
        </div>

      </div>

      {/* ── Attract Drawer ── */}
      <Drawer open={activeDrawer === 'attract'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[90vh]">
          <DrawerHeader className="relative">
            <DrawerTitle className="flex items-center gap-2 text-base md:text-lg">
              <Megaphone className="w-5 h-5 text-indigo-400" />
              Attract New Customers
            </DrawerTitle>
            <DrawerClose className="absolute right-4 top-4" data-testid="button-close-attract">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DrawerClose>
          </DrawerHeader>
          <div className="flex flex-col items-center justify-center flex-1 px-4 pb-8 gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Megaphone className="w-7 h-7 text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-200">Coming Soon</h3>
            <p className="text-sm text-gray-400 max-w-sm">
              Campaigns, store promotions, and new buyer acquisition tools are on the roadmap. Stay tuned.
            </p>
          </div>
        </DrawerContent>
      </Drawer>

      {/* ── Delight Drawer ── */}
      <Drawer open={activeDrawer === 'delight'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[90vh]">
          <DrawerHeader className="relative">
            <DrawerTitle className="flex items-center gap-2 text-base md:text-lg">
              <Heart className="w-5 h-5 text-cyan-400" />
              Delight Current Customers
            </DrawerTitle>
            <DrawerClose className="absolute right-4 top-4" data-testid="button-close-delight">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DrawerClose>
          </DrawerHeader>
          <div className="flex flex-col items-center justify-center flex-1 px-4 pb-8 gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <Heart className="w-7 h-7 text-cyan-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-200">Coming Soon</h3>
            <p className="text-sm text-gray-400 max-w-sm">
              Post-purchase follow-ups, personalized recommendations, and satisfaction tracking are in development.
            </p>
          </div>
        </DrawerContent>
      </Drawer>

      {/* ── Reward Drawer ── */}
      <Drawer open={activeDrawer === 'reward'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[90vh]">
          <DrawerHeader className="relative">
            <DrawerTitle className="flex items-center gap-2 text-base md:text-lg">
              <Trophy className="w-5 h-5 text-amber-400" />
              Reward Loyal &amp; High Spenders
            </DrawerTitle>
            <DrawerClose className="absolute right-4 top-4" data-testid="button-close-reward">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DrawerClose>
          </DrawerHeader>
          <div className="flex flex-col items-center justify-center flex-1 px-4 pb-8 gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Trophy className="w-7 h-7 text-amber-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-200">Coming Soon</h3>
            <p className="text-sm text-gray-400 max-w-sm">
              VIP tiers, loyalty programs, and exclusive perks for your highest-value customers are coming.
            </p>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

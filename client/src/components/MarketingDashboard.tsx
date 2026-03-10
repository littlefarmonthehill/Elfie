import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users, Sparkles, Info,
  Megaphone, UserPlus, RefreshCcw, Trophy, X, Search, MapPin, Mail, ShoppingBag, DollarSign, Calendar,
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
  customerEmail?: string | null;
  shipTo?: string | null;
}

interface CustomerData {
  customerUsername: string;
  totalRevenue: number;
  orderCount: number;
  lastOrderDate: string;
  firstOrderDate: string;
  mostRecentOrderId: string;
  customerEmail: string;
  shipName: string;
  shipCity: string;
  shipState: string;
  shipCountry: string;
}

export type MarketingDrawer = 'attract' | 'engage-new' | 'engage-repeat' | 'engage-top' | null;

interface MarketingDashboardProps {
  dateRange?: DateRangeValue;
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
  activeDrawer: MarketingDrawer;
  onDrawerChange: (drawer: MarketingDrawer) => void;
}

function parseShipTo(raw: string | null | undefined): { name: string; city: string; state: string; country: string } {
  if (!raw) return { name: '', city: '', state: '', country: '' };
  try {
    const p = JSON.parse(raw);
    return {
      name: p.name || p.full_name || '',
      city: p.city || '',
      state: p.state || p.stateOrProvince || '',
      country: p.country || p.countryCode || '',
    };
  } catch {
    return { name: '', city: '', state: '', country: '' };
  }
}

function fmtCurrency(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function CustomerRow({
  customer,
  rank,
  subtitle,
  badge,
  accentClass,
  onClick,
}: {
  customer: CustomerData;
  rank?: number;
  subtitle: string;
  badge?: string;
  accentClass: string;
  onClick: () => void;
}) {
  const hasLocation = customer.shipCity || customer.shipCountry;
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 px-4 py-3 hover-elevate active-elevate-2 border-b border-gray-700/40 last:border-0 transition-colors"
      data-testid={`customer-row-${customer.customerUsername}`}
    >
      {rank !== undefined && (
        <span className={`shrink-0 mt-0.5 text-[11px] font-bold w-5 text-center ${accentClass}`}>
          #{rank}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-100 truncate">{customer.customerUsername}</span>
          {badge && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${accentClass} bg-transparent border-current/30`}>
              {badge}
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {customer.customerEmail && (
            <span className="flex items-center gap-1 text-[10px] text-gray-600">
              <Mail className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate max-w-[160px]">{customer.customerEmail}</span>
            </span>
          )}
          {hasLocation && (
            <span className="flex items-center gap-1 text-[10px] text-gray-600">
              <MapPin className="h-2.5 w-2.5 shrink-0" />
              {[customer.shipCity, customer.shipState, customer.shipCountry].filter(Boolean).join(', ')}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function CustomerListDrawer({
  open,
  onClose,
  title,
  icon: Icon,
  accentColor,
  customers,
  renderSubtitle,
  renderBadge,
  showRank,
  searchQuery,
  onSearchChange,
  onCustomerClick,
  emptyMessage,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon: React.ElementType;
  accentColor: string;
  customers: CustomerData[];
  renderSubtitle: (c: CustomerData) => string;
  renderBadge?: (c: CustomerData) => string | undefined;
  showRank?: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onCustomerClick: (c: CustomerData) => void;
  emptyMessage: string;
}) {
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return customers;
    const q = searchQuery.toLowerCase();
    return customers.filter(c =>
      c.customerUsername.toLowerCase().includes(q) ||
      c.customerEmail.toLowerCase().includes(q) ||
      c.shipName.toLowerCase().includes(q) ||
      c.shipCity.toLowerCase().includes(q) ||
      c.shipState.toLowerCase().includes(q) ||
      c.shipCountry.toLowerCase().includes(q)
    );
  }, [customers, searchQuery]);

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="h-[90vh] flex flex-col">
        <DrawerHeader className="relative border-b border-gray-700/60 pb-3 shrink-0">
          <DrawerTitle className="flex items-center gap-2 text-base md:text-lg">
            <Icon className={`w-5 h-5 ${accentColor}`} />
            {title}
          </DrawerTitle>
          <DrawerClose className="absolute right-4 top-4" data-testid={`button-close-${title.toLowerCase().replace(/\s+/g, '-')}`}>
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DrawerClose>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by username, email, city, country…"
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-md text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
              data-testid={`input-search-${title.toLowerCase().replace(/\s+/g, '-')}`}
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <p className="text-[11px] text-gray-600 mt-1.5">
            {filtered.length} of {customers.length} customer{customers.length !== 1 ? 's' : ''}
            {searchQuery ? ' match' : ''}
          </p>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
              <Icon className={`w-10 h-10 ${accentColor} opacity-30`} />
              <p className="text-sm text-gray-400">
                {searchQuery ? `No customers match "${searchQuery}"` : emptyMessage}
              </p>
            </div>
          ) : (
            <div>
              {filtered.map((c, i) => (
                <CustomerRow
                  key={c.customerUsername}
                  customer={c}
                  rank={showRank ? i + 1 : undefined}
                  subtitle={renderSubtitle(c)}
                  badge={renderBadge?.(c)}
                  accentClass={accentColor}
                  onClick={() => onCustomerClick(c)}
                />
              ))}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export default function MarketingDashboard({ dateRange = 'mtd', onItemClick, activeDrawer, onDrawerChange }: MarketingDashboardProps) {
  const [newSearch, setNewSearch] = useState('');
  const [repeatSearch, setRepeatSearch] = useState('');
  const [topSearch, setTopSearch] = useState('');

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

  const customerData = useMemo((): CustomerData[] => {
    const map = new Map<string, CustomerData>();
    orders.filter(o => !['cancelled', 'Cancelled'].includes(o.orderStatus)).forEach(order => {
      const username = order.customerUsername || 'Unknown';
      const revenue = parseOrderTotal(order.orderTotal);
      const ship = parseShipTo(order.shipTo);
      const orderDate = order.orderDate;

      if (map.has(username)) {
        const e = map.get(username)!;
        e.totalRevenue += revenue;
        e.orderCount += 1;
        if (new Date(orderDate) > new Date(e.lastOrderDate)) {
          e.lastOrderDate = orderDate;
          e.mostRecentOrderId = order.id;
        }
        if (new Date(orderDate) < new Date(e.firstOrderDate)) {
          e.firstOrderDate = orderDate;
        }
        if (!e.customerEmail && order.customerEmail) e.customerEmail = order.customerEmail;
        if (!e.shipCity && ship.city) { e.shipCity = ship.city; e.shipState = ship.state; e.shipCountry = ship.country; e.shipName = ship.name; }
      } else {
        map.set(username, {
          customerUsername: username,
          totalRevenue: revenue,
          orderCount: 1,
          lastOrderDate: orderDate,
          firstOrderDate: orderDate,
          mostRecentOrderId: order.id,
          customerEmail: order.customerEmail || '',
          shipName: ship.name,
          shipCity: ship.city,
          shipState: ship.state,
          shipCountry: ship.country,
        });
      }
    });
    return Array.from(map.values());
  }, [orders]);

  const newCustomers = useMemo(() =>
    [...customerData]
      .filter(c => c.orderCount === 1)
      .sort((a, b) => new Date(b.lastOrderDate).getTime() - new Date(a.lastOrderDate).getTime()),
    [customerData]
  );

  const repeatCustomers = useMemo(() =>
    [...customerData]
      .filter(c => c.orderCount > 1)
      .sort((a, b) => new Date(b.lastOrderDate).getTime() - new Date(a.lastOrderDate).getTime()),
    [customerData]
  );

  const topSpenders = useMemo(() =>
    [...customerData]
      .sort((a, b) => b.totalRevenue - a.totalRevenue),
    [customerData]
  );

  const totalCustomers = customerData.length;
  const repeatCustomerCount = repeatCustomers.length;
  const newLast30 = customerData.filter(c => {
    const days = (Date.now() - new Date(c.lastOrderDate).getTime()) / 86400000;
    return c.orderCount === 1 && days <= 30;
  }).length;
  const repeatRate = totalCustomers > 0 ? (repeatCustomerCount / totalCustomers * 100).toFixed(1) : '0.0';
  const avgOrders = totalCustomers > 0 ? (orders.length / totalCustomers).toFixed(1) : '0.0';

  const handleCustomerClick = (customer: CustomerData) => {
    onDrawerChange(null);
    if (onItemClick && customer.mostRecentOrderId) {
      onItemClick('order', customer.mostRecentOrderId);
    }
  };

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
        <div className="relative bg-gradient-to-b from-yellow-950/20 to-gray-900/85 border border-yellow-500/40 rounded-lg p-3 shadow-[0_0_22px_rgba(234,179,8,0.10)] overflow-hidden" data-testid="section-customer-overview">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-yellow-400/50 to-transparent" />
          <div className="flex items-center gap-2 mb-2.5">
            <div className="p-1.5 rounded-md bg-yellow-900/60 ring-1 ring-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.22)]">
              <Users className="w-3 h-3 md:w-4 md:h-4 text-yellow-200" />
            </div>
            <h3 className="text-xs md:text-base font-semibold text-yellow-200 uppercase tracking-wide">Customers</h3>
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
        <div className="relative bg-gradient-to-b from-gray-800/45 to-gray-900/85 border border-gray-600/50 rounded-lg p-3 shadow-[0_0_16px_rgba(255,255,255,0.03)] overflow-hidden" data-testid="section-marketing-tools">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gray-400/25 to-transparent" />
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-md bg-gray-700/60 ring-1 ring-gray-500/40">
              <Sparkles className="w-3 h-3 md:w-4 md:h-4 text-gray-200" />
            </div>
            <h3 className="text-xs md:text-base font-semibold text-gray-200 uppercase tracking-wide">Tools</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">

            {/* Attract */}
            <button
              onClick={() => onDrawerChange('attract')}
              data-testid="tool-attract"
              className="group flex flex-col gap-1.5 rounded-lg border border-indigo-500/50 bg-gradient-to-br from-indigo-950/65 to-gray-950/80 p-3 text-left hover-elevate active-elevate-2 transition-all shadow-[0_0_14px_rgba(99,102,241,0.09)]"
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-indigo-900/70 p-1.5 ring-1 ring-indigo-500/45 shadow-[0_0_10px_rgba(99,102,241,0.22)]">
                  <Megaphone className="w-3.5 h-3.5 md:w-5 md:h-5 text-indigo-200" />
                </div>
                <span className="text-xs md:text-sm font-bold text-indigo-100 leading-tight flex-1">Attract New Customers</span>
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
            </button>

            {/* Engage New */}
            <button
              onClick={() => onDrawerChange('engage-new')}
              data-testid="tool-engage-new"
              className="group flex flex-col gap-1.5 rounded-lg border border-cyan-500/50 bg-gradient-to-br from-cyan-950/65 to-gray-950/80 p-3 text-left hover-elevate active-elevate-2 transition-all shadow-[0_0_14px_rgba(6,182,212,0.09)]"
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-cyan-900/70 p-1.5 ring-1 ring-cyan-500/45 shadow-[0_0_10px_rgba(6,182,212,0.22)]">
                  <UserPlus className="w-3.5 h-3.5 md:w-5 md:h-5 text-cyan-200" />
                </div>
                <span className="text-xs md:text-sm font-bold text-cyan-100 leading-tight flex-1">Engage New Customers</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <span
                      role="button"
                      onClick={(e) => e.stopPropagation()}
                      className="text-cyan-600/60 hover:text-cyan-400 transition-colors"
                      data-testid="info-engage-new"
                    >
                      <Info className="w-3 h-3" />
                    </span>
                  </PopoverTrigger>
                  <PopoverContent side="top" className="w-64 text-xs text-gray-300 bg-gray-900 border-gray-700 p-2.5">
                    Reach out to first-time buyers — onboarding messages, welcome offers, and early engagement prompts.
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem]">
                {newCustomers.length > 0 ? (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-600/30">
                    {newCustomers.length} new buyers
                  </span>
                ) : (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-600/25">
                    No data yet
                  </span>
                )}
              </div>
            </button>

            {/* Engage Repeat */}
            <button
              onClick={() => onDrawerChange('engage-repeat')}
              data-testid="tool-engage-repeat"
              className="group flex flex-col gap-1.5 rounded-lg border border-blue-500/50 bg-gradient-to-br from-blue-950/65 to-gray-950/80 p-3 text-left hover-elevate active-elevate-2 transition-all shadow-[0_0_14px_rgba(59,130,246,0.09)]"
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-blue-900/70 p-1.5 ring-1 ring-blue-500/45 shadow-[0_0_10px_rgba(59,130,246,0.22)]">
                  <RefreshCcw className="w-3.5 h-3.5 md:w-5 md:h-5 text-blue-200" />
                </div>
                <span className="text-xs md:text-sm font-bold text-blue-100 leading-tight flex-1">Engage Repeating Customers</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <span
                      role="button"
                      onClick={(e) => e.stopPropagation()}
                      className="text-blue-600/60 hover:text-blue-400 transition-colors"
                      data-testid="info-engage-repeat"
                    >
                      <Info className="w-3 h-3" />
                    </span>
                  </PopoverTrigger>
                  <PopoverContent side="top" className="w-64 text-xs text-gray-300 bg-gray-900 border-gray-700 p-2.5">
                    Keep loyal buyers engaged — personalized follow-ups, exclusive offers, and re-order reminders.
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem]">
                {repeatCustomerCount > 0 ? (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-600/30">
                    {repeatCustomerCount} repeat buyers
                  </span>
                ) : (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-600/25">
                    No data yet
                  </span>
                )}
              </div>
            </button>

            {/* Engage Top */}
            <button
              onClick={() => onDrawerChange('engage-top')}
              data-testid="tool-engage-top"
              className="group flex flex-col gap-1.5 rounded-lg border border-amber-500/50 bg-gradient-to-br from-amber-950/65 to-gray-950/80 p-3 text-left hover-elevate active-elevate-2 transition-all shadow-[0_0_14px_rgba(245,158,11,0.09)]"
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-amber-900/70 p-1.5 ring-1 ring-amber-500/45 shadow-[0_0_10px_rgba(245,158,11,0.22)]">
                  <Trophy className="w-3.5 h-3.5 md:w-5 md:h-5 text-amber-200" />
                </div>
                <span className="text-xs md:text-sm font-bold text-amber-100 leading-tight flex-1">Engage Top Spenders</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <span
                      role="button"
                      onClick={(e) => e.stopPropagation()}
                      className="text-amber-600/60 hover:text-amber-400 transition-colors"
                      data-testid="info-engage-top"
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
                {topSpenders.length > 0 ? (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-600/30">
                    {topSpenders.length} customers ranked
                  </span>
                ) : (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-600/25">
                    No data yet
                  </span>
                )}
              </div>
            </button>

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

      {/* ── Engage New Drawer ── */}
      <CustomerListDrawer
        open={activeDrawer === 'engage-new'}
        onClose={() => onDrawerChange(null)}
        title="New Customers"
        icon={UserPlus}
        accentColor="text-cyan-400"
        customers={newCustomers}
        renderSubtitle={c => `First order ${fmtDate(c.firstOrderDate)} · ${fmtCurrency(c.totalRevenue)}`}
        renderBadge={c => {
          const days = (Date.now() - new Date(c.lastOrderDate).getTime()) / 86400000;
          return days <= 7 ? 'This week' : days <= 30 ? 'This month' : undefined;
        }}
        searchQuery={newSearch}
        onSearchChange={setNewSearch}
        onCustomerClick={handleCustomerClick}
        emptyMessage="No new customers in this date range."
      />

      {/* ── Engage Repeat Drawer ── */}
      <CustomerListDrawer
        open={activeDrawer === 'engage-repeat'}
        onClose={() => onDrawerChange(null)}
        title="Repeating Customers"
        icon={RefreshCcw}
        accentColor="text-blue-400"
        customers={repeatCustomers}
        renderSubtitle={c => `${c.orderCount} orders · ${fmtCurrency(c.totalRevenue)} · last ${fmtDate(c.lastOrderDate)}`}
        renderBadge={c => c.orderCount >= 5 ? `${c.orderCount}x buyer` : undefined}
        searchQuery={repeatSearch}
        onSearchChange={setRepeatSearch}
        onCustomerClick={handleCustomerClick}
        emptyMessage="No repeat customers in this date range."
      />

      {/* ── Engage Top Drawer ── */}
      <CustomerListDrawer
        open={activeDrawer === 'engage-top'}
        onClose={() => onDrawerChange(null)}
        title="Top Spenders"
        icon={Trophy}
        accentColor="text-amber-400"
        customers={topSpenders}
        renderSubtitle={c => `${fmtCurrency(c.totalRevenue)} · ${c.orderCount} order${c.orderCount !== 1 ? 's' : ''} · last ${fmtDate(c.lastOrderDate)}`}
        renderBadge={c => c.totalRevenue >= 500 ? 'VIP' : undefined}
        showRank
        searchQuery={topSearch}
        onSearchChange={setTopSearch}
        onCustomerClick={handleCustomerClick}
        emptyMessage="No customer data in this date range."
      />
    </div>
  );
}

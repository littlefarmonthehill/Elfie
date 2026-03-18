import { useState, useMemo, useDeferredValue } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserPlus, RefreshCcw, Trophy, Megaphone, Search, X, Info, Calendar, Mail, MapPin, Users, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ToolDrawer } from "@/components/ui/tool-drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import MetricCard from "./MetricCard";
import DateRangeSelector, { DateRangeValue, CollapsibleDatePicker } from "./DateRangeSelector";

interface CustomerStats {
  most_recent_order_id: string;
  customer_username: string;
  customer_email: string | null;
  ship_to: string | null;
  order_count: number;
  total_revenue: number | string;
  last_order_date: string | Date;
  first_order_date: string | Date;
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
  renderDrawerOnly?: boolean;
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

function toDateStr(v: string | Date | null | undefined): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function toNum(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

function mapRow(row: CustomerStats): CustomerData {
  const ship = parseShipTo(row.ship_to);
  return {
    customerUsername: row.customer_username || 'Unknown',
    totalRevenue: toNum(row.total_revenue),
    orderCount: Number(row.order_count) || 0,
    lastOrderDate: toDateStr(row.last_order_date),
    firstOrderDate: toDateStr(row.first_order_date),
    mostRecentOrderId: row.most_recent_order_id,
    customerEmail: row.customer_email || '',
    shipName: ship.name,
    shipCity: ship.city,
    shipState: ship.state,
    shipCountry: ship.country,
  };
}

function fmtCurrency(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtDate(dateStr: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDaysSince(dateStr: string): string {
  if (!dateStr) return '';
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

const PAGE_SIZE = 50;

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
          <span className="flex items-center gap-1 text-[10px] text-gray-500">
            <Calendar className="h-2.5 w-2.5 shrink-0" />
            {fmtDaysSince(customer.lastOrderDate)}
          </span>
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

function CustomerListPanel({
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
  isLoading,
  dateRangeSlot,
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
  isLoading?: boolean;
  dateRangeSlot?: React.ReactNode;
}) {
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(searchQuery);
  const isStale = searchQuery !== deferredSearch;

  const filtered = useMemo(() => {
    if (!deferredSearch.trim()) return customers;
    const q = deferredSearch.toLowerCase();
    return customers.filter(c =>
      c.customerUsername.toLowerCase().includes(q) ||
      c.customerEmail.toLowerCase().includes(q) ||
      c.shipName.toLowerCase().includes(q) ||
      c.shipCity.toLowerCase().includes(q) ||
      c.shipState.toLowerCase().includes(q) ||
      c.shipCountry.toLowerCase().includes(q)
    );
  }, [customers, deferredSearch]);

  const displayed = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = displayed.length < filtered.length;

  if (!open) return null;

  const searchBar = (
    <div className="px-4 py-2 border-b border-white/5 shrink-0 space-y-2">
      {dateRangeSlot && (
        <div className="flex justify-center" data-testid={`date-range-${title.toLowerCase().replace(/\s+/g, '-')}`}>
          {dateRangeSlot}
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
        <input
          type="text"
          placeholder="Search by username, email, city, country…"
          value={searchQuery}
          onChange={e => { onSearchChange(e.target.value); setPage(1); }}
          className="w-full pl-9 pr-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-md text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
          data-testid={`input-search-${title.toLowerCase().replace(/\s+/g, '-')}`}
        />
        {searchQuery && (
          <button
            onClick={() => { onSearchChange(''); setPage(1); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <p className={`text-[11px] mt-1.5 transition-opacity ${isStale ? 'opacity-40' : 'opacity-100'} text-gray-600`}>
        {isLoading ? 'Loading…' : `${filtered.length} of ${customers.length} customer${customers.length !== 1 ? 's' : ''}${searchQuery ? ' match' : ''}`}
      </p>
    </div>
  );

  return (
    <ToolDrawer
      icon={Icon as any}
      iconColor={accentColor}
      title={title}
      onClose={() => { onClose(); setPage(1); }}
      closeTestId={`button-close-${title.toLowerCase().replace(/\s+/g, '-')}`}
      subHeader={searchBar}
      contentClassName="flex-1 overflow-y-auto min-h-0 pt-2"
    >
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-current border-t-transparent opacity-40" style={{ color: 'inherit' }} />
            <p className="text-sm text-gray-500">Loading customers…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
            <Icon className={`w-10 h-10 ${accentColor} opacity-30`} />
            <p className="text-sm text-gray-400">
              {searchQuery ? `No customers match "${deferredSearch}"` : emptyMessage}
            </p>
          </div>
        ) : (
          <div>
            {displayed.map((c, i) => (
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
            {hasMore && (
              <div className="py-4 flex justify-center border-t border-gray-700/40">
                <button
                  onClick={() => setPage(p => p + 1)}
                  className="text-xs text-gray-400 hover:text-gray-200 px-4 py-2 rounded-md border border-gray-700 hover-elevate"
                  data-testid="button-load-more"
                >
                  Show {Math.min(PAGE_SIZE, filtered.length - displayed.length)} more of {filtered.length - displayed.length} remaining
                </button>
              </div>
            )}
          </div>
        )}
    </ToolDrawer>
  );
}

export default function MarketingDashboard({ dateRange: parentDateRange = 'mtd', onItemClick, activeDrawer, onDrawerChange, renderDrawerOnly }: MarketingDashboardProps) {
  const [newSearch, setNewSearch] = useState('');
  const [repeatSearch, setRepeatSearch] = useState('');
  const [topSearch, setTopSearch] = useState('');

  const [newDateRange, setNewDateRange] = useState<DateRangeValue>('mtd');
  const [repeatDateRange, setRepeatDateRange] = useState<DateRangeValue>('mtd');
  const [topDateRange, setTopDateRange] = useState<DateRangeValue>('mtd');
  const [localDateRange, setLocalDateRange] = useState<DateRangeValue>(parentDateRange);

  const dateRange = renderDrawerOnly
    ? (activeDrawer === 'engage-new' ? newDateRange
      : activeDrawer === 'engage-repeat' ? repeatDateRange
      : activeDrawer === 'engage-top' ? topDateRange
      : parentDateRange)
    : localDateRange;

  const { data: rawStats = [], isLoading } = useQuery<CustomerStats[]>({
    queryKey: ['/api/orders/customer-stats', dateRange],
    queryFn: async () => {
      const response = await fetch(`/api/orders/customer-stats?range=${dateRange}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch customer stats');
      return response.json();
    },
    staleTime: 300000,
  });

  const customerData = useMemo(() => rawStats.map(mapRow), [rawStats]);

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
    [...customerData].sort((a, b) => b.totalRevenue - a.totalRevenue),
    [customerData]
  );

  const totalCustomers = customerData.length;
  const repeatCustomerCount = repeatCustomers.length;
  const newLast30 = customerData.filter(c => {
    const days = (Date.now() - new Date(c.lastOrderDate).getTime()) / 86400000;
    return c.orderCount === 1 && days <= 30;
  }).length;
  const repeatRate = totalCustomers > 0 ? (repeatCustomerCount / totalCustomers * 100).toFixed(1) : '0.0';
  const totalOrders = customerData.reduce((sum, c) => sum + c.orderCount, 0);
  const avgOrders = totalCustomers > 0 ? (totalOrders / totalCustomers).toFixed(1) : '0.0';

  const handleCustomerClick = (customer: CustomerData) => {
    onDrawerChange(null);
    if (onItemClick && customer.mostRecentOrderId) {
      onItemClick('order', customer.mostRecentOrderId);
    }
  };

  if (renderDrawerOnly) {
    return (
      <>
        {activeDrawer === 'attract' && (
          <ToolDrawer icon={Megaphone} iconColor="text-indigo-400" title="Attract New Customers" onClose={() => onDrawerChange(null)} closeTestId="button-close-attract" contentClassName="flex flex-col items-center justify-center flex-1 px-4 pb-8 gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Megaphone className="w-7 h-7 text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-200">Coming Soon</h3>
            <p className="text-sm text-gray-400 max-w-sm">Campaigns, store promotions, and new buyer acquisition tools are on the roadmap.</p>
          </ToolDrawer>
        )}
        <CustomerListPanel
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
          isLoading={isLoading}
          dateRangeSlot={<DateRangeSelector value={newDateRange} onChange={setNewDateRange} compact scaled />}
        />
        <CustomerListPanel
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
          isLoading={isLoading}
          dateRangeSlot={<DateRangeSelector value={repeatDateRange} onChange={setRepeatDateRange} compact scaled />}
        />
        <CustomerListPanel
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
          isLoading={isLoading}
          dateRangeSlot={<DateRangeSelector value={topDateRange} onChange={setTopDateRange} compact scaled />}
        />
      </>
    );
  }

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
        <div className="p-2 space-y-3 bg-gradient-to-br from-lego-yellow/5 to-transparent rounded-lg border border-lego-yellow/10 shadow-[0_0_15px_rgba(234,179,8,0.1)]">
      <div className="space-y-3">

        {/* ── Customer Overview ── */}
        <div className={cn("relative bg-gradient-to-b from-yellow-950/20 to-gray-900/85 border border-yellow-500/40 rounded-lg shadow-[0_0_22px_rgba(234,179,8,0.10)]", "p-2.5")} data-testid="section-customer-overview">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-yellow-400/50 to-transparent" />
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-md bg-yellow-900/60 ring-1 ring-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.22)] shrink-0">
              <Users className={cn("w-3 h-3 text-yellow-200", "md:w-4 md:h-4")} />
            </div>
            <h3 className={cn("text-xs font-semibold text-yellow-200 uppercase tracking-wide min-w-0", "md:text-sm lg:text-base")}>Customers</h3>
            <CollapsibleDatePicker
              value={localDateRange}
              onChange={setLocalDateRange}
              accentClass="text-yellow-400/70 hover:text-yellow-300"
              testId="button-customers-date-picker"
            />
          </div>
          <div className={cn("grid grid-cols-3 gap-1.5", "mb-2")} data-testid="section-customer-counts">
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
        <div className={cn("relative bg-gradient-to-b from-gray-800/45 to-gray-900/85 border border-gray-600/50 rounded-lg shadow-[0_0_16px_rgba(255,255,255,0.03)] overflow-hidden", "p-2.5")} data-testid="section-marketing-tools">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gray-400/25 to-transparent" />
          <div className={cn("flex items-center gap-2", "mb-2")}>
            <div className="p-1.5 rounded-md bg-gray-700/60 ring-1 ring-gray-500/40">
              <Sparkles className={cn("w-3 h-3 text-gray-200", "md:w-4 md:h-4")} />
            </div>
            <h3 className={cn("text-xs font-semibold text-gray-200 uppercase tracking-wide", "md:text-sm lg:text-base")}>Tools</h3>
          </div>
          <div className={cn("grid grid-cols-2", "gap-2")}>

            {/* Attract */}
            <button
              onClick={() => onDrawerChange('attract')}
              data-testid="tool-attract"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-indigo-500/50 bg-gradient-to-br from-indigo-950/65 to-gray-950/80 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", "p-3")}
              style={{ '--tool-glow-color': 'rgba(99,102,241,0.35)' } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-indigo-900/70 p-1.5 ring-1 ring-indigo-500/45 shadow-[0_0_10px_rgba(99,102,241,0.22)]">
                  <Megaphone className={cn("w-3.5 h-3.5 text-indigo-200", "md:w-5 md:h-5")} />
                </div>
                <span className={cn("text-xs font-bold text-indigo-100 leading-tight flex-1", "md:text-sm")}>Attract New Customers</span>
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
              <div className="flex flex-wrap gap-1 min-h-[1.25rem] justify-end">
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-600/25">
                  Coming soon
                </span>
              </div>
            </button>

            {/* Engage New */}
            <button
              onClick={() => onDrawerChange('engage-new')}
              data-testid="tool-engage-new"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-cyan-500/50 bg-gradient-to-br from-cyan-950/65 to-gray-950/80 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", "p-3")}
              style={{ '--tool-glow-color': 'rgba(6,182,212,0.35)' } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-cyan-900/70 p-1.5 ring-1 ring-cyan-500/45 shadow-[0_0_10px_rgba(6,182,212,0.22)]">
                  <UserPlus className={cn("w-3.5 h-3.5 text-cyan-200", "md:w-5 md:h-5")} />
                </div>
                <span className={cn("text-xs font-bold text-cyan-100 leading-tight flex-1", "md:text-sm")}>New Customers</span>
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
                    First-time buyers — see who bought recently and track whether they return for a second order.
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem] justify-end">
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
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-blue-500/50 bg-gradient-to-br from-blue-950/65 to-gray-950/80 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", "p-3")}
              style={{ '--tool-glow-color': 'rgba(59,130,246,0.35)' } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-blue-900/70 p-1.5 ring-1 ring-blue-500/45 shadow-[0_0_10px_rgba(59,130,246,0.22)]">
                  <RefreshCcw className={cn("w-3.5 h-3.5 text-blue-200", "md:w-5 md:h-5")} />
                </div>
                <span className={cn("text-xs font-bold text-blue-100 leading-tight flex-1", "md:text-sm")}>Repeat Customers</span>
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
                    Buyers who have ordered more than once — your most loyal customers and best candidates for re-engagement.
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem] justify-end">
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
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-amber-500/50 bg-gradient-to-br from-amber-950/65 to-gray-950/80 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", "p-3")}
              style={{ '--tool-glow-color': 'rgba(245,158,11,0.35)' } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-amber-900/70 p-1.5 ring-1 ring-amber-500/45 shadow-[0_0_10px_rgba(245,158,11,0.22)]">
                  <Trophy className={cn("w-3.5 h-3.5 text-amber-200", "md:w-5 md:h-5")} />
                </div>
                <span className={cn("text-xs font-bold text-amber-100 leading-tight flex-1", "md:text-sm")}>Top Spenders</span>
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
                    Your highest-value customers ranked by total spend — ideal for priority service or special offers.
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem] justify-end">
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

    </div>
  );
}

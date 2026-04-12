import { useState, useMemo, useDeferredValue } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  UserPlus, RefreshCcw, Trophy, Search, X, Calendar, Mail, MapPin,
  Users, Sparkles, Crosshair, RotateCw, Crown, Activity, Tag,
  BookOpen, Share2, ArrowRight, Heart, Zap, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolDrawer } from "@/components/ui/tool-drawer";
import { StationTool } from "./StationTool";
import MetricCard from "./MetricCard";
import DateRangeSelector, { DateRangeValue, CollapsibleDatePicker } from "./DateRangeSelector";

// ── Types ─────────────────────────────────────────────────────────────────────

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

export type MarketingDrawer =
  | 'engage-new'
  | 'engage-repeat'
  | 'engage-top'
  | 'customer-health'
  | 'part-preferences'
  | 'campaign-log'
  | 'referral-program'
  | null;

interface MarketingDashboardProps {
  dateRange?: DateRangeValue;
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
  activeDrawer: MarketingDrawer;
  onDrawerChange: (drawer: MarketingDrawer) => void;
  renderDrawerOnly?: boolean;
  tvSplit?: 'left' | 'right';
  compact?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseShipTo(raw: string | null | undefined) {
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

function daysSince(dateStr: string): number {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

const PAGE_SIZE = 50;

// ── Customer Row ──────────────────────────────────────────────────────────────

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
            <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full border ${accentClass} bg-transparent border-current/30`}>
              {badge}
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <Calendar className="h-2.5 w-2.5 shrink-0" />
            {fmtDaysSince(customer.lastOrderDate)}
          </span>
          {customer.customerEmail && (
            <span className="flex items-center gap-1 text-xs text-gray-600">
              <Mail className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate max-w-[160px]">{customer.customerEmail}</span>
            </span>
          )}
          {hasLocation && (
            <span className="flex items-center gap-1 text-xs text-gray-600">
              <MapPin className="h-2.5 w-2.5 shrink-0" />
              {[customer.shipCity, customer.shipState, customer.shipCountry].filter(Boolean).join(', ')}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Customer List Panel ───────────────────────────────────────────────────────

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
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-current border-t-transparent opacity-40" />
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

// ── Customer Health Drawer ────────────────────────────────────────────────────

function CustomerHealthDrawer({ open, onClose, customers }: {
  open: boolean;
  onClose: () => void;
  customers: CustomerData[];
}) {
  if (!open) return null;

  const now = Date.now();
  const active30 = customers.filter(c => daysSince(c.lastOrderDate) <= 30);
  const atRisk = customers.filter(c => { const d = daysSince(c.lastOrderDate); return d > 30 && d <= 90; });
  const dormant = customers.filter(c => { const d = daysSince(c.lastOrderDate); return d > 90 && d <= 180; });
  const lost = customers.filter(c => daysSince(c.lastOrderDate) > 180);

  const total = customers.length;
  const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0;

  const cohorts = [
    { label: 'Active', sublabel: 'ordered in last 30d', count: active30.length, pct: pct(active30.length), color: 'bg-green-500', textColor: 'text-green-400' },
    { label: 'At Risk', sublabel: '31–90 days inactive', count: atRisk.length, pct: pct(atRisk.length), color: 'bg-amber-500', textColor: 'text-amber-400' },
    { label: 'Dormant', sublabel: '91–180 days inactive', count: dormant.length, pct: pct(dormant.length), color: 'bg-orange-600', textColor: 'text-orange-400' },
    { label: 'Lapsed', sublabel: 'over 180 days inactive', count: lost.length, pct: pct(lost.length), color: 'bg-red-700', textColor: 'text-red-400' },
  ];

  const repeatCount = customers.filter(c => c.orderCount > 1).length;
  const avgRevenue = total > 0 ? customers.reduce((s, c) => s + c.totalRevenue, 0) / total : 0;
  const avgOrders = total > 0 ? customers.reduce((s, c) => s + c.orderCount, 0) / total : 0;

  return (
    <ToolDrawer
      icon={Activity}
      iconColor="text-green-400"
      title="Customer Health"
      onClose={onClose}
      closeTestId="button-close-customer-health"
      contentClassName="flex-1 overflow-y-auto px-4 pt-4 pb-6 space-y-4"
    >
      <p className="text-xs text-gray-500 leading-relaxed">
        Tracks the lifecycle health of your entire customer base — who's active, who's drifting, and who you may be losing.
      </p>

      {/* Health bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Overall Health</span>
          <span className="text-[10px] text-gray-500">{total} total customers</span>
        </div>
        <div className="flex rounded-full overflow-hidden h-3 bg-gray-800">
          {cohorts.map(c => c.pct > 0 && (
            <div key={c.label} className={`${c.color} h-full transition-all`} style={{ width: `${c.pct}%` }} />
          ))}
        </div>
        <div className="flex gap-3 mt-2 flex-wrap">
          {cohorts.map(c => (
            <div key={c.label} className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${c.color}`} />
              <span className="text-[10px] text-gray-500">{c.label} {c.pct}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cohort breakdown */}
      <div className="space-y-2">
        {cohorts.map(c => (
          <div key={c.label} className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-3 py-2.5">
            <div className={`w-2.5 h-2.5 rounded-full ${c.color} shrink-0`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-gray-200">{c.label}</div>
              <div className="text-[10px] text-gray-500">{c.sublabel}</div>
            </div>
            <div className="text-right shrink-0">
              <div className={`text-sm font-mono font-bold ${c.textColor}`}>{c.count}</div>
              <div className="text-[10px] text-gray-600">{c.pct}%</div>
            </div>
          </div>
        ))}
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-2 pt-1">
        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
          <div className="text-[10px] text-gray-500 mb-1">Repeat Rate</div>
          <div className="text-lg font-mono font-bold text-yellow-400">
            {total > 0 ? Math.round((repeatCount / total) * 100) : 0}%
          </div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
          <div className="text-[10px] text-gray-500 mb-1">Avg LTV</div>
          <div className="text-lg font-mono font-bold text-green-400">
            {fmtCurrency(avgRevenue)}
          </div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
          <div className="text-[10px] text-gray-500 mb-1">Avg Orders</div>
          <div className="text-lg font-mono font-bold text-blue-400">
            {avgOrders.toFixed(1)}
          </div>
        </div>
      </div>

      {/* Win-back opportunity */}
      {atRisk.length > 0 && (
        <div className="border border-amber-500/25 bg-amber-900/15 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-3 h-3 text-amber-400 shrink-0" />
            <span className="text-xs font-semibold text-amber-300">Win-Back Opportunity</span>
          </div>
          <p className="text-[11px] text-gray-400 leading-relaxed">
            {atRisk.length} customer{atRisk.length !== 1 ? 's are' : ' is'} in the 31–90 day window — the best time to re-engage before they go dormant. Reach out personally or send a top-of-mind message highlighting new stock.
          </p>
        </div>
      )}
    </ToolDrawer>
  );
}

// ── Part Preferences Drawer ───────────────────────────────────────────────────

function PartPreferencesDrawer({ open, onClose, topSpenders }: {
  open: boolean;
  onClose: () => void;
  topSpenders: CustomerData[];
}) {
  if (!open) return null;

  return (
    <ToolDrawer
      icon={Tag}
      iconColor="text-purple-400"
      title="Part Preferences"
      onClose={onClose}
      closeTestId="button-close-part-preferences"
      contentClassName="flex-1 overflow-y-auto px-4 pt-4 pb-6 space-y-4"
    >
      <p className="text-xs text-gray-500 leading-relaxed">
        Tracks what categories and colors each customer tends to buy — the foundation of your VIP Concierge program. When you know a customer builds in dark bluish gray tiles, you can reach out the moment you stock them.
      </p>

      <div className="border border-purple-500/20 bg-purple-900/15 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Crown className="w-3.5 h-3.5 text-purple-400 shrink-0" />
          <span className="text-xs font-semibold text-purple-300">VIP Concierge Ready</span>
        </div>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          Your top {Math.min(topSpenders.length, 10)} customers by spend are your VIP Concierge candidates. As part category data becomes available through deeper BrickLink integration, their preferred categories and colors will appear here — enabling proactive outreach the moment matching stock arrives.
        </p>
      </div>

      <div className="space-y-2">
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Your Top Buyers</div>
        {topSpenders.slice(0, 8).map((c, i) => (
          <div key={c.customerUsername} className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-3 py-2">
            <span className="text-[11px] font-bold text-amber-400 w-5 shrink-0">#{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-gray-200 truncate">{c.customerUsername}</div>
              <div className="text-[10px] text-gray-500">{c.orderCount} orders · last {fmtDaysSince(c.lastOrderDate)}</div>
            </div>
            <div className="text-xs font-mono font-bold text-green-400 shrink-0">{fmtCurrency(c.totalRevenue)}</div>
          </div>
        ))}
      </div>

      <div className="border border-gray-700/40 bg-gray-800/30 rounded-lg p-3">
        <div className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mb-2">Coming with deeper integration</div>
        <div className="space-y-1.5">
          {['Part category preferences (plates, tiles, technic beams…)', 'Color preferences (dark bluish gray, sand green…)', 'Proactive stock match alerts', 'Per-customer wish list tracking'].map(item => (
            <div key={item} className="flex items-start gap-2">
              <div className="w-1 h-1 rounded-full bg-gray-600 mt-1.5 shrink-0" />
              <span className="text-[11px] text-gray-400">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </ToolDrawer>
  );
}

// ── Campaign Log Drawer ───────────────────────────────────────────────────────

function CampaignLogDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <ToolDrawer
      icon={BookOpen}
      iconColor="text-cyan-400"
      title="Campaign Log"
      onClose={onClose}
      closeTestId="button-close-campaign-log"
      contentClassName="flex-1 overflow-y-auto px-4 pt-4 pb-6 space-y-4"
    >
      <p className="text-xs text-gray-500 leading-relaxed">
        A running history of every marketing campaign you've run — who was reached, what was sent, and what came back.
      </p>

      <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
        <div className="w-14 h-14 rounded-full bg-cyan-900/30 border border-cyan-500/20 flex items-center justify-center">
          <BookOpen className="w-6 h-6 text-cyan-500/50" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-300 mb-1">No campaigns logged yet</p>
          <p className="text-xs text-gray-500 max-w-xs leading-relaxed">
            Once you run your first Top of Mind, Win-Back, or New Customer campaign, results will appear here — reach, responses, and any orders attributed.
          </p>
        </div>
      </div>

      <div className="border border-gray-700/40 bg-gray-800/30 rounded-lg p-3">
        <div className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mb-2">Tracked per campaign</div>
        <div className="space-y-1.5">
          {['Customers reached & channel used', 'Orders placed after outreach (7-day window)', 'Revenue attributed', 'Win-Back conversion rate', 'Days since last campaign per segment'].map(item => (
            <div key={item} className="flex items-start gap-2">
              <div className="w-1 h-1 rounded-full bg-gray-600 mt-1.5 shrink-0" />
              <span className="text-[11px] text-gray-400">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </ToolDrawer>
  );
}

// ── Referral Program Drawer ───────────────────────────────────────────────────

function ReferralProgramDrawer({ open, onClose, topSpenders }: {
  open: boolean;
  onClose: () => void;
  topSpenders: CustomerData[];
}) {
  if (!open) return null;

  return (
    <ToolDrawer
      icon={Share2}
      iconColor="text-pink-400"
      title="Referral Program"
      onClose={onClose}
      closeTestId="button-close-referral-program"
      contentClassName="flex-1 overflow-y-auto px-4 pt-4 pb-6 space-y-4"
    >
      <p className="text-xs text-gray-500 leading-relaxed">
        Your referral program gives existing customers a unique ID to share. When someone new orders using that ID, the referring customer earns store credit or cash back — automatically tracked here.
      </p>

      <div className="border border-pink-500/20 bg-pink-900/15 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Heart className="w-3.5 h-3.5 text-pink-400 shrink-0" />
          <span className="text-xs font-semibold text-pink-300">Word of Mouth is Your Best Channel</span>
        </div>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          AFOL communities are tight-knit. A recommendation from a trusted builder carries far more weight than any ad. Your premium service — fast dispatch, depth of parts, breadth of selection — is what earns referrals.
        </p>
      </div>

      <div className="space-y-2">
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Best Referral Candidates</div>
        <p className="text-[11px] text-gray-500">Your most loyal customers are your best referrers. These are the ones worth inviting first:</p>
        {topSpenders.slice(0, 5).map((c, i) => (
          <div key={c.customerUsername} className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-3 py-2">
            <span className="text-[11px] font-bold text-pink-400 w-5 shrink-0">#{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-gray-200 truncate">{c.customerUsername}</div>
              <div className="text-[10px] text-gray-500">{c.orderCount} orders · {fmtCurrency(c.totalRevenue)} lifetime</div>
            </div>
            <div className="shrink-0">
              <span className="text-[10px] font-mono text-gray-600 bg-gray-700/50 px-2 py-0.5 rounded">No code yet</span>
            </div>
          </div>
        ))}
      </div>

      <div className="border border-gray-700/40 bg-gray-800/30 rounded-lg p-3">
        <div className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mb-2">Program setup — coming soon</div>
        <div className="space-y-1.5">
          {['Generate unique referral codes per customer', 'Set reward amount (store credit or cash back)', 'Track referral orders and attribution', 'Automated reward notifications'].map(item => (
            <div key={item} className="flex items-start gap-2">
              <div className="w-1 h-1 rounded-full bg-gray-600 mt-1.5 shrink-0" />
              <span className="text-[11px] text-gray-400">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </ToolDrawer>
  );
}

// ── Segment Campaign Card ─────────────────────────────────────────────────────

function SegmentCard({
  icon: Icon,
  label,
  campaignName,
  count,
  metric,
  metricLabel,
  accentBorder,
  accentBg,
  accentIcon,
  accentText,
  accentDot,
  onClick,
  testId,
  isCompact,
}: {
  icon: React.ElementType;
  label: string;
  campaignName: string;
  count: number;
  metric: string;
  metricLabel: string;
  accentBorder: string;
  accentBg: string;
  accentIcon: string;
  accentText: string;
  accentDot: string;
  onClick: () => void;
  testId: string;
  isCompact: boolean;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "group relative flex flex-col items-start gap-1.5 rounded-lg border text-left hover-elevate active-elevate-2 transition-all w-full",
        accentBorder,
        isCompact ? "p-2" : "p-2.5"
      )}
      style={{ background: accentBg }}
    >
      <div className={cn("absolute top-0 left-0 right-0 h-[1.5px] rounded-t-lg", accentDot)} />
      <div className="flex items-center justify-between w-full gap-1">
        <div className={cn("p-1 rounded-md ring-1", accentIcon)}>
          <Icon className={cn("text-current", isCompact ? "w-2.5 h-2.5" : "w-3 h-3")} />
        </div>
        <div className="flex items-center gap-1">
          <div
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: accentText.includes('cyan') ? 'rgba(6,182,212,0.9)' : accentText.includes('blue') ? 'rgba(59,130,246,0.9)' : 'rgba(245,158,11,0.9)', boxShadow: `0 0 5px currentColor` }}
          />
          <span className="font-mono text-[8px] uppercase tracking-widest text-gray-500">Active</span>
        </div>
      </div>
      <div className={cn("font-mono font-bold text-white leading-none", isCompact ? "text-base" : "text-xl")}>{count}</div>
      <div className={cn("font-mono uppercase tracking-widest leading-tight", accentText, isCompact ? "text-[8px]" : "text-[9px]")}>{label}</div>
      <div className="text-[10px] text-gray-500 leading-tight">{metric} {metricLabel}</div>
      <div className={cn("font-mono text-[8px] uppercase tracking-widest text-gray-600 mt-0.5 flex items-center gap-1 group-hover:opacity-100 opacity-70 transition-opacity")}>
        {campaignName}
        <ArrowRight className="w-2 h-2" />
      </div>
    </button>
  );
}

// ── Signal Row ────────────────────────────────────────────────────────────────

function SignalRow({
  label,
  description,
  count,
  lampColor,
  isActive,
  onAction,
  actionLabel,
  testId,
}: {
  label: string;
  description: string;
  count: number;
  lampColor: string;
  isActive: boolean;
  onAction: () => void;
  actionLabel: string;
  testId: string;
}) {
  return (
    <div className="flex items-center gap-2.5" data-testid={testId}>
      <div
        className={cn("w-2.5 h-2.5 rounded-full shrink-0 ring-1", isActive ? "ring-white/20" : "bg-gray-600/50 ring-gray-500/40")}
        style={isActive ? {
          backgroundColor: lampColor,
          boxShadow: `0 0 7px ${lampColor}, 0 0 14px ${lampColor}55`,
        } : undefined}
      />
      <div className="flex-1 min-w-0">
        <div className={cn("font-mono text-[9px] uppercase tracking-wide leading-none", isActive ? "text-gray-200" : "text-gray-500")}>{label}</div>
        <div className="text-[10px] text-gray-600 mt-0.5 truncate">{description}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn("font-mono text-[10px] font-bold", isActive ? "text-white" : "text-gray-500")}>{count}</span>
        {isActive && (
          <button
            onClick={onAction}
            className="font-mono text-[8px] uppercase tracking-widest px-2 py-0.5 rounded border border-gray-600/60 bg-gray-800/60 text-gray-400 hover-elevate active-elevate-2 transition-all"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function MarketingDashboard({
  dateRange: parentDateRange = 'mtd',
  onItemClick,
  activeDrawer,
  onDrawerChange,
  renderDrawerOnly,
  tvSplit,
  compact,
}: MarketingDashboardProps) {
  const isCompact = !!(tvSplit || compact);
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
    const d = daysSince(c.lastOrderDate);
    return c.orderCount === 1 && d <= 30;
  }).length;
  const repeatRate = totalCustomers > 0 ? (repeatCustomerCount / totalCustomers * 100).toFixed(1) : '0.0';
  const totalOrders = customerData.reduce((sum, c) => sum + c.orderCount, 0);
  const avgOrders = totalCustomers > 0 ? (totalOrders / totalCustomers).toFixed(1) : '0.0';

  // ── Marketing Signals ──────────────────────────────────────────────────────

  const winBackCandidates = useMemo(() =>
    customerData.filter(c => { const d = daysSince(c.lastOrderDate); return d >= 60 && d <= 90; }),
    [customerData]
  );

  const lapsingCandidates = useMemo(() =>
    customerData.filter(c => { const d = daysSince(c.lastOrderDate); return d >= 45 && d < 60; }),
    [customerData]
  );

  const newFollowUp = useMemo(() =>
    customerData.filter(c => { const d = daysSince(c.lastOrderDate); return c.orderCount === 1 && d >= 30 && d <= 60; }),
    [customerData]
  );

  const vipAttention = useMemo(() =>
    topSpenders.slice(0, 10).filter(c => daysSince(c.lastOrderDate) >= 30),
    [topSpenders]
  );

  const totalSignals = (winBackCandidates.length > 0 ? 1 : 0)
    + (lapsingCandidates.length > 0 ? 1 : 0)
    + (newFollowUp.length > 0 ? 1 : 0)
    + (vipAttention.length > 0 ? 1 : 0);

  const hasSignals = totalSignals > 0;

  // ── Loyalty metrics ────────────────────────────────────────────────────────

  const loyaltyAvgGap = useMemo(() => {
    if (repeatCustomers.length === 0) return null;
    const gaps = repeatCustomers
      .filter(c => c.firstOrderDate && c.lastOrderDate && c.firstOrderDate !== c.lastOrderDate)
      .map(c => {
        const span = (new Date(c.lastOrderDate).getTime() - new Date(c.firstOrderDate).getTime()) / 86400000;
        return c.orderCount > 1 ? Math.round(span / (c.orderCount - 1)) : null;
      })
      .filter((g): g is number => g !== null && g > 0);
    if (gaps.length === 0) return null;
    return Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  }, [repeatCustomers]);

  const vipAvgSpend = useMemo(() => {
    const top = topSpenders.slice(0, 10);
    if (top.length === 0) return 0;
    return top.reduce((s, c) => s + c.totalRevenue, 0) / top.length;
  }, [topSpenders]);

  const vipInactiveCount = vipAttention.length;

  const handleCustomerClick = (customer: CustomerData) => {
    onDrawerChange(null);
    if (onItemClick && customer.mostRecentOrderId) {
      onItemClick('order', customer.mostRecentOrderId);
    }
  };

  // ── Drawer-only render (for TV split / Bridge) ─────────────────────────────

  if (renderDrawerOnly) {
    return (
      <>
        <CustomerListPanel
          open={activeDrawer === 'engage-new'}
          onClose={() => onDrawerChange(null)}
          title="New Customers"
          icon={UserPlus}
          accentColor="text-cyan-400"
          customers={newCustomers}
          renderSubtitle={c => `First order ${fmtDate(c.firstOrderDate)} · ${fmtCurrency(c.totalRevenue)}`}
          renderBadge={c => {
            const d = daysSince(c.lastOrderDate);
            return d <= 7 ? 'This week' : d <= 30 ? 'This month' : undefined;
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
          title="Loyalty Buyers"
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
          title="VIP Concierge"
          icon={Crown}
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
        <CustomerHealthDrawer
          open={activeDrawer === 'customer-health'}
          onClose={() => onDrawerChange(null)}
          customers={customerData}
        />
        <PartPreferencesDrawer
          open={activeDrawer === 'part-preferences'}
          onClose={() => onDrawerChange(null)}
          topSpenders={topSpenders}
        />
        <CampaignLogDrawer
          open={activeDrawer === 'campaign-log'}
          onClose={() => onDrawerChange(null)}
        />
        <ReferralProgramDrawer
          open={activeDrawer === 'referral-program'}
          onClose={() => onDrawerChange(null)}
          topSpenders={topSpenders}
        />
      </>
    );
  }

  if (isLoading) {
    return (
      <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-yellow/12 to-lego-yellow/3 rounded-lg border border-lego-yellow/38 shadow-[0_0_22px_rgba(234,179,8,0.20)]">
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
    <div className={isCompact ? "p-2 space-y-2 h-full overflow-y-auto" : "p-2 space-y-3 bg-gradient-to-br from-lego-yellow/12 to-lego-yellow/3 rounded-lg border border-lego-yellow/38 shadow-[0_0_22px_rgba(234,179,8,0.20)]"}>

      {/* ── LEFT: Customer Overview + Segment Cards ── */}
      {(!tvSplit || tvSplit === 'left') && <>

        {/* Customer Overview metrics */}
        <div
          className={cn("relative bg-gradient-to-b from-yellow-900/38 to-gray-900/88 border border-yellow-400/65 rounded-lg shadow-[0_0_28px_rgba(234,179,8,0.26)]", isCompact ? "p-2" : "p-2 md:p-3")}
          data-testid="section-customer-overview"
        >
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-yellow-300/85 to-transparent" />
          <div className={cn("flex items-center", isCompact ? "gap-1.5 mb-1.5" : "gap-2 mb-2")}>
            <div className={cn("rounded-md bg-yellow-900/60 ring-1 ring-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.22)] shrink-0", isCompact ? "p-1.5" : "p-1.5")}>
              <Users className={cn("text-yellow-200", isCompact ? "w-3.5 h-3.5" : "w-3 h-3 md:w-4 md:h-4")} />
            </div>
            <h3 className={cn("font-semibold text-yellow-200 uppercase tracking-wide min-w-0", isCompact ? "text-xs" : "text-xs md:text-sm")}>Marketing</h3>
            <CollapsibleDatePicker
              value={localDateRange}
              onChange={setLocalDateRange}
              accentClass="text-yellow-400/70 hover:text-yellow-300"
              testId="button-customers-date-picker"
            />
          </div>
          <div className={cn("grid grid-cols-3", isCompact ? "gap-1.5 mb-1.5" : "gap-1.5 mb-2")} data-testid="section-customer-counts">
            <MetricCard label="Total" value={String(totalCustomers)} color="yellow" compact={isCompact} data-testid="metric-total-customers" />
            <MetricCard label="Repeat" value={String(repeatCustomerCount)} color="green" compact={isCompact} data-testid="metric-repeat-customers" />
            <MetricCard label="New (30d)" value={String(newLast30)} color="blue" compact={isCompact} data-testid="metric-new-customers" />
          </div>
          <div className={cn("grid grid-cols-2", isCompact ? "gap-1.5" : "gap-1.5")} data-testid="section-customer-rates">
            <MetricCard label="Repeat Rate" value={`${repeatRate}%`} color="green" compact={isCompact} data-testid="metric-repeat-rate" />
            <MetricCard label="Avg Orders" value={avgOrders} color="yellow" compact={isCompact} data-testid="metric-avg-orders" />
          </div>
        </div>

        {/* Segment Campaign Cards */}
        <div
          className={cn("relative rounded-lg border border-yellow-400/45 shadow-[0_3px_0_rgba(0,0,0,0.45),0_0_14px_rgba(245,194,0,0.10)]", isCompact ? "p-2" : "p-2 md:p-3")}
          style={{ background: 'linear-gradient(175deg, rgba(113,63,18,0.35) 0%, rgba(17,24,39,0.88) 100%)' }}
          data-testid="section-segment-cards"
        >
          <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-lg bg-gradient-to-r from-transparent via-yellow-400/35 to-transparent" />
          <div className={cn("flex items-center gap-1.5", isCompact ? "mb-2" : "mb-2.5")}>
            <div className="rounded bg-yellow-900/60 ring-1 ring-yellow-500/50 shrink-0 p-1">
              <ShieldCheck className="w-3 h-3 text-yellow-200" />
            </div>
            <h3 className="text-[10px] font-semibold text-yellow-200/80 uppercase tracking-widest flex-1">Customer Campaigns</h3>
          </div>
          <div className={cn("grid grid-cols-3", isCompact ? "gap-1.5" : "gap-2")} data-testid="section-segment-campaign-grid">

            <SegmentCard
              icon={UserPlus}
              label="New"
              campaignName="Welcome & Service"
              count={newCustomers.length}
              metric={`${newLast30}`}
              metricLabel="in 30d"
              accentBorder="border-cyan-500/35"
              accentBg="linear-gradient(175deg, rgba(8,145,178,0.20) 0%, rgba(17,24,39,0.85) 100%)"
              accentIcon="bg-cyan-900/60 ring-cyan-500/40 text-cyan-300"
              accentText="text-cyan-400/80"
              accentDot="bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent"
              onClick={() => onDrawerChange('engage-new')}
              testId="card-segment-new"
              isCompact={isCompact}
            />

            <SegmentCard
              icon={RotateCw}
              label="Loyalty"
              campaignName="We Know You"
              count={repeatCustomers.length}
              metric={loyaltyAvgGap !== null ? `${loyaltyAvgGap}d` : '—'}
              metricLabel="avg gap"
              accentBorder="border-blue-500/35"
              accentBg="linear-gradient(175deg, rgba(37,99,235,0.20) 0%, rgba(17,24,39,0.85) 100%)"
              accentIcon="bg-blue-900/60 ring-blue-500/40 text-blue-300"
              accentText="text-blue-400/80"
              accentDot="bg-gradient-to-r from-transparent via-blue-400/40 to-transparent"
              onClick={() => onDrawerChange('engage-repeat')}
              testId="card-segment-loyalty"
              isCompact={isCompact}
            />

            <SegmentCard
              icon={Crown}
              label="VIP"
              campaignName="Concierge"
              count={Math.min(topSpenders.length, 10)}
              metric={fmtCurrency(vipAvgSpend)}
              metricLabel="avg LTV"
              accentBorder="border-amber-500/35"
              accentBg="linear-gradient(175deg, rgba(180,83,9,0.22) 0%, rgba(17,24,39,0.85) 100%)"
              accentIcon="bg-amber-900/60 ring-amber-500/40 text-amber-300"
              accentText="text-amber-400/80"
              accentDot="bg-gradient-to-r from-transparent via-amber-400/40 to-transparent"
              onClick={() => onDrawerChange('engage-top')}
              testId="card-segment-vip"
              isCompact={isCompact}
            />

          </div>
        </div>
      </>}

      {/* ── RIGHT: Marketing Signals + Station ── */}
      {(!tvSplit || tvSplit === 'right') && <>

        {/* Marketing Signals — Command Central */}
        <div
          className={cn(
            "relative rounded-lg border transition-all",
            isCompact ? "p-2.5" : "p-2 md:p-3",
            hasSignals
              ? "border-yellow-400/55 shadow-[0_3px_0_rgba(0,0,0,0.55),0_0_18px_rgba(234,179,8,0.20)]"
              : "border-yellow-400/25 shadow-[0_3px_0_rgba(0,0,0,0.45),0_0_10px_rgba(234,179,8,0.08)]"
          )}
          style={{ background: 'linear-gradient(175deg, rgba(113,63,18,0.40) 0%, rgba(17,24,39,0.88) 100%)' }}
          data-testid="section-marketing-signals"
        >
          <div className={cn(
            "absolute top-0 left-0 right-0 h-[2px] rounded-t-lg",
            hasSignals
              ? "bg-gradient-to-r from-yellow-700/50 via-yellow-400/75 to-yellow-700/50"
              : "bg-gradient-to-r from-transparent via-gray-500/25 to-transparent"
          )} />

          {/* Header */}
          <div className="flex items-center gap-2 flex-wrap mb-2.5">
            <div className={cn(
              "rounded-md ring-1 shrink-0 p-1 bg-yellow-900/55 ring-yellow-500/40",
              hasSignals && "shadow-[0_0_6px_rgba(234,179,8,0.28)]"
            )}>
              <Crosshair className="w-3 h-3 text-yellow-200" />
            </div>
            <h3 className="text-[10px] font-semibold uppercase tracking-widest flex-1 text-yellow-200/80">Marketing Signals</h3>
            {hasSignals ? (
              <div className="flex items-center gap-1 shrink-0">
                <div className="relative w-1.5 h-1.5 shrink-0">
                  <div className="absolute inset-0 rounded-full bg-yellow-400/50 animate-ping" />
                  <div className="relative w-1.5 h-1.5 rounded-full bg-yellow-400" />
                </div>
                <span className="text-[9px] font-semibold text-yellow-300/80 font-mono">{totalSignals} signal{totalSignals !== 1 ? 's' : ''}</span>
              </div>
            ) : (
              <span className="text-[9px] text-gray-600 shrink-0 font-mono">all clear</span>
            )}
          </div>

          {/* Signal rows */}
          <div className="space-y-2.5">
            <SignalRow
              label="Win-Back Window"
              description="60–90 days inactive · optimal re-engage timing"
              count={winBackCandidates.length}
              lampColor="rgba(251,146,60,0.9)"
              isActive={winBackCandidates.length > 0}
              onAction={() => onDrawerChange('engage-repeat')}
              actionLabel="View"
              testId="signal-win-back"
            />
            <div className="h-px bg-gradient-to-r from-transparent via-gray-700/40 to-transparent" />
            <SignalRow
              label="Lapsing Soon"
              description="45–59 days inactive · closing in on win-back zone"
              count={lapsingCandidates.length}
              lampColor="rgba(250,204,21,0.9)"
              isActive={lapsingCandidates.length > 0}
              onAction={() => onDrawerChange('engage-repeat')}
              actionLabel="View"
              testId="signal-lapsing"
            />
            <div className="h-px bg-gradient-to-r from-transparent via-gray-700/40 to-transparent" />
            <SignalRow
              label="New Follow-Up"
              description="1 order · 30–60 days ago · prime 2nd purchase window"
              count={newFollowUp.length}
              lampColor="rgba(6,182,212,0.9)"
              isActive={newFollowUp.length > 0}
              onAction={() => onDrawerChange('engage-new')}
              actionLabel="View"
              testId="signal-new-followup"
            />
            <div className="h-px bg-gradient-to-r from-transparent via-gray-700/40 to-transparent" />
            <SignalRow
              label="VIP Attention"
              description="Top 10 spenders · inactive 30+ days"
              count={vipInactiveCount}
              lampColor="rgba(167,139,250,0.9)"
              isActive={vipInactiveCount > 0}
              onAction={() => onDrawerChange('engage-top')}
              actionLabel="View"
              testId="signal-vip-attention"
            />
          </div>
        </div>

        {/* Marketing Station */}
        <div
          className={cn("relative rounded-lg border border-yellow-400/45 shadow-[0_3px_0_rgba(0,0,0,0.45),0_0_14px_rgba(245,194,0,0.12)]", isCompact ? "p-2" : "p-2 md:p-3")}
          style={{ background: 'linear-gradient(175deg, rgba(113,63,18,0.38) 0%, rgba(17,24,39,0.88) 100%)' }}
          data-testid="section-marketing-station"
        >
          <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-lg bg-gradient-to-r from-transparent via-yellow-400/40 to-transparent" />
          <div className={cn("flex items-center gap-2", isCompact ? "mb-2" : "mb-2.5")}>
            <div className="rounded-md ring-1 shrink-0 p-1 bg-yellow-900/55 ring-yellow-500/40">
              <Sparkles className="w-3 h-3 text-yellow-200" />
            </div>
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-yellow-200/80">Marketing Station</h3>
          </div>
          <div className={cn("grid grid-cols-2", isCompact ? "gap-1.5" : "gap-2")}>

            <StationTool
              icon={Activity}
              label="Customer Health"
              hex="#22c55e"
              glowRgb="34,197,94"
              isCompact={isCompact}
              onClick={() => onDrawerChange('customer-health')}
              testId="tool-customer-health"
            />

            <StationTool
              icon={Tag}
              label="Part Preferences"
              hex="#a855f7"
              glowRgb="168,85,247"
              isCompact={isCompact}
              onClick={() => onDrawerChange('part-preferences')}
              testId="tool-part-preferences"
            />

            <StationTool
              icon={BookOpen}
              label="Campaign Log"
              hex="#06b6d4"
              glowRgb="6,182,212"
              isCompact={isCompact}
              onClick={() => onDrawerChange('campaign-log')}
              testId="tool-campaign-log"
            />

            <StationTool
              icon={Share2}
              label="Referral Program"
              hex="#ec4899"
              glowRgb="236,72,153"
              isCompact={isCompact}
              onClick={() => onDrawerChange('referral-program')}
              testId="tool-referral-program"
            />

          </div>
        </div>

      </>}

      {/* Drawers — rendered inline when not in drawer-only mode */}
      <CustomerListPanel
        open={activeDrawer === 'engage-new'}
        onClose={() => onDrawerChange(null)}
        title="New Customers"
        icon={UserPlus}
        accentColor="text-cyan-400"
        customers={newCustomers}
        renderSubtitle={c => `First order ${fmtDate(c.firstOrderDate)} · ${fmtCurrency(c.totalRevenue)}`}
        renderBadge={c => {
          const d = daysSince(c.lastOrderDate);
          return d <= 7 ? 'This week' : d <= 30 ? 'This month' : undefined;
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
        title="Loyalty Buyers"
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
        title="VIP Concierge"
        icon={Crown}
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
      <CustomerHealthDrawer
        open={activeDrawer === 'customer-health'}
        onClose={() => onDrawerChange(null)}
        customers={customerData}
      />
      <PartPreferencesDrawer
        open={activeDrawer === 'part-preferences'}
        onClose={() => onDrawerChange(null)}
        topSpenders={topSpenders}
      />
      <CampaignLogDrawer
        open={activeDrawer === 'campaign-log'}
        onClose={() => onDrawerChange(null)}
      />
      <ReferralProgramDrawer
        open={activeDrawer === 'referral-program'}
        onClose={() => onDrawerChange(null)}
        topSpenders={topSpenders}
      />
    </div>
  );
}

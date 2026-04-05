import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format, subMonths, subYears, addYears, startOfMonth, parseISO, startOfDay, getYear, startOfWeek } from "date-fns";
import { TrendingUp, Target, GitCompare, BarChart2, Info, ArrowRight, X, Activity, Radar, DollarSign, ShoppingCart, AlertTriangle, Lightbulb, TrendingDown, Eye, EyeOff, Users, Package, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import MetricCard from "./MetricCard";
import DateRangeSelector, { DateRangeValue, CollapsibleDatePicker } from "./DateRangeSelector";
import PlatformPerformance from "./PlatformPerformance";
import PlatformOrdersDrawer from "./PlatformOrdersDrawer";
import { Button } from "@/components/ui/button";
import { ToolDrawer } from "@/components/ui/tool-drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import AcquisitionEvaluator from "@/components/AcquisitionEvaluator";

type TimePeriod = 'mtd' | 'ytd' | '1y' | '5y';

export type SalesDrawer = 'chart' | 'platform-perf' | 'business-intel' | 'acquisition-evaluator' | null;

interface BusinessInsight {
  id: string;
  orgId: string;
  category: string;
  urgency: string;
  title: string;
  summary: string;
  details: any;
  sourceType: string | null;
  sourceRef: string | null;
  dismissed: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  pricing: { icon: DollarSign, color: 'text-yellow-400', bg: 'bg-yellow-900/30', label: 'Pricing' },
  acquisition: { icon: ShoppingCart, color: 'text-blue-400', bg: 'bg-blue-900/30', label: 'Acquisition' },
  overstock: { icon: Package, color: 'text-orange-400', bg: 'bg-orange-900/30', label: 'Overstock' },
  restock: { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-900/30', label: 'Restock' },
  revenue: { icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-900/30', label: 'Revenue' },
  velocity: { icon: Activity, color: 'text-purple-400', bg: 'bg-purple-900/30', label: 'Velocity' },
  channel: { icon: BarChart2, color: 'text-indigo-400', bg: 'bg-indigo-900/30', label: 'Channel' },
  new_customer: { icon: Users, color: 'text-cyan-400', bg: 'bg-cyan-900/30', label: 'New Customer' },
  top_spender: { icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-900/30', label: 'Top Spender' },
  dormant: { icon: EyeOff, color: 'text-amber-400', bg: 'bg-amber-900/30', label: 'Dormant' },
  opportunity: { icon: Lightbulb, color: 'text-green-400', bg: 'bg-green-900/30', label: 'Opportunity' },
  risk: { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-900/30', label: 'Risk' },
  trend: { icon: TrendingUp, color: 'text-purple-400', bg: 'bg-purple-900/30', label: 'Trend' },
  customer: { icon: Users, color: 'text-cyan-400', bg: 'bg-cyan-900/30', label: 'Customer' },
};

const URGENCY_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  high: { label: 'High', variant: 'destructive' },
  medium: { label: 'Med', variant: 'secondary' },
  low: { label: 'Low', variant: 'outline' },
};

type OpArea = 'product' | 'sales' | 'customer';
const OP_AREA_CONFIG: Record<OpArea, { label: string; icon: React.ElementType; color: string; borderColor: string; categories: string[] }> = {
  product: { label: 'Product & Inventory', icon: Package, color: 'text-yellow-400', borderColor: 'border-yellow-500/30', categories: ['pricing', 'acquisition', 'overstock', 'restock', 'risk'] },
  sales: { label: 'Orders & Sales', icon: TrendingUp, color: 'text-green-400', borderColor: 'border-green-500/30', categories: ['revenue', 'velocity', 'channel', 'trend', 'opportunity'] },
  customer: { label: 'Customer Intelligence', icon: Users, color: 'text-cyan-400', borderColor: 'border-cyan-500/30', categories: ['new_customer', 'top_spender', 'dormant', 'customer'] },
};

function getOpArea(category: string): OpArea {
  for (const [area, cfg] of Object.entries(OP_AREA_CONFIG)) {
    if (cfg.categories.includes(category)) return area as OpArea;
  }
  return 'product';
}

function InsightCard({ insight, isExpanded, onToggle, onDismiss, dismissPending }: {
  insight: BusinessInsight; isExpanded: boolean; onToggle: () => void; onDismiss: () => void; dismissPending: boolean;
}) {
  const catCfg = CATEGORY_CONFIG[insight.category] || CATEGORY_CONFIG.trend;
  const urgCfg = URGENCY_CONFIG[insight.urgency] || URGENCY_CONFIG.medium;
  const CatIcon = catCfg.icon;
  const details = insight.details as {
    affectedItems?: string[]; customers?: string[]; priceGap?: number;
    currentPrice?: number; recommendedPrice?: number; potentialRevenue?: number; source?: string;
  } | null;

  return (
    <div
      className={cn("rounded-lg border border-gray-700/50 transition-colors", catCfg.bg)}
      data-testid={`insight-card-${insight.id}`}
    >
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-start gap-2.5 text-left"
        data-testid={`insight-toggle-${insight.id}`}
      >
        <div className={cn("mt-0.5 shrink-0", catCfg.color)}>
          <CatIcon className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-medium text-gray-200 leading-tight">{insight.title}</span>
            <Badge variant={urgCfg.variant} className="text-[9px] px-1.5 py-0 h-4 shrink-0">{urgCfg.label}</Badge>
          </div>
          <p className={cn("text-[11px] text-gray-400 leading-snug", !isExpanded && "line-clamp-2")}>{insight.summary}</p>
        </div>
        <div className="mt-0.5 shrink-0 text-gray-600">
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </div>
      </button>
      {isExpanded && (
        <div className="px-3 pb-2.5 space-y-2 border-t border-gray-700/40">
          {details?.affectedItems && details.affectedItems.length > 0 && (
            <div className="pt-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Items</p>
              <div className="flex flex-wrap gap-1">
                {details.affectedItems.slice(0, 12).map((item, idx) => (
                  <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800/60 text-gray-300 border border-gray-700/40">{item}</span>
                ))}
                {details.affectedItems.length > 12 && (
                  <span className="text-[10px] text-gray-500">+{details.affectedItems.length - 12} more</span>
                )}
              </div>
            </div>
          )}
          {details?.customers && details.customers.length > 0 && (
            <div className="pt-1">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Customers</p>
              <div className="flex flex-wrap gap-1">
                {details.customers.slice(0, 8).map((name, idx) => (
                  <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800/60 text-cyan-300 border border-cyan-700/30">{name}</span>
                ))}
                {details.customers.length > 8 && (
                  <span className="text-[10px] text-gray-500">+{details.customers.length - 8} more</span>
                )}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            {details?.currentPrice != null && details?.recommendedPrice != null && Number.isFinite(Number(details.currentPrice)) && Number.isFinite(Number(details.recommendedPrice)) && (
              <p className="text-[10px] text-gray-400">
                <span className="text-gray-500">Price:</span> <span className="text-red-400/80">${Number(details.currentPrice).toFixed(2)}</span>
                <span className="text-gray-600 mx-0.5">&rarr;</span>
                <span className="text-green-400">${Number(details.recommendedPrice).toFixed(2)}</span>
              </p>
            )}
            {details?.priceGap != null && Number.isFinite(Number(details.priceGap)) && (
              <p className="text-[10px] text-gray-400">
                <span className="text-gray-500">Gap:</span> <span className={Number(details.priceGap) > 0 ? 'text-green-400' : 'text-red-400'}>{Number(details.priceGap) > 0 ? '+' : ''}{Number(details.priceGap).toFixed(1)}%</span>
              </p>
            )}
            {details?.potentialRevenue != null && Number.isFinite(Number(details.potentialRevenue)) && (
              <p className="text-[10px] text-gray-400">
                <span className="text-gray-500">Revenue Potential:</span> <span className="text-green-400">${Number(details.potentialRevenue).toFixed(2)}</span>
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-gray-700/30">
            <div className="flex items-center gap-2">
              <span className={cn("text-[9px] capitalize", catCfg.color)}>{catCfg.label}</span>
              <span className="text-[9px] text-gray-600">{new Date(insight.createdAt).toLocaleDateString()}</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[10px] text-gray-500"
              onClick={(e) => { e.stopPropagation(); onDismiss(); }}
              disabled={dismissPending}
              data-testid={`dismiss-insight-${insight.id}`}
            >
              <EyeOff className="w-3 h-3 mr-1" />
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function BusinessIntelDrawer({ onClose }: { onClose: () => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [collapsedAreas, setCollapsedAreas] = useState<Record<string, boolean>>({});

  const { data: insights = [], isLoading } = useQuery<BusinessInsight[]>({
    queryKey: ['/api/business-intel'],
  });

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('POST', `/api/business-intel/${id}/dismiss`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/business-intel'] });
    },
  });

  const urgencyOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const groupedByArea: Record<OpArea, BusinessInsight[]> = { product: [], sales: [], customer: [] };
  for (const insight of insights) {
    const area = getOpArea(insight.category);
    groupedByArea[area].push(insight);
  }
  for (const area of Object.keys(groupedByArea) as OpArea[]) {
    groupedByArea[area].sort((a, b) => (urgencyOrder[a.urgency] ?? 2) - (urgencyOrder[b.urgency] ?? 2));
  }

  const toggleArea = (area: string) => setCollapsedAreas(prev => ({ ...prev, [area]: !prev[area] }));

  return (
    <ToolDrawer icon={Radar} iconColor="text-cyan-400" title="Business Intel" onClose={onClose} closeTestId="button-close-business-intel" contentClassName="px-4 pt-4 pb-4">
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Radar className="w-6 h-6 text-cyan-400 animate-pulse" />
        </div>
      ) : insights.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 px-6 text-center space-y-3">
          <div className="rounded-full bg-cyan-900/40 p-3 ring-1 ring-cyan-500/30">
            <Radar className="w-6 h-6 text-cyan-400" />
          </div>
          <p className="text-xs text-gray-400 max-w-sm leading-relaxed">
            No insights yet. Enable the Business Intel scheduler in Platform Settings to start generating automated analysis.
          </p>
        </div>
      ) : (
        <div className="space-y-3 p-2">
          {(Object.entries(OP_AREA_CONFIG) as [OpArea, typeof OP_AREA_CONFIG[OpArea]][]).map(([area, cfg]) => {
            const areaInsights = groupedByArea[area];
            if (areaInsights.length === 0) return null;
            const AreaIcon = cfg.icon;
            const isCollapsed = collapsedAreas[area];
            const highCount = areaInsights.filter(i => i.urgency === 'high').length;

            return (
              <div key={area} className={cn("rounded-lg border", cfg.borderColor)} data-testid={`area-${area}`}>
                <button
                  onClick={() => toggleArea(area)}
                  className="w-full px-3 py-2 flex items-center gap-2 text-left"
                  data-testid={`area-toggle-${area}`}
                >
                  <AreaIcon className={cn("w-4 h-4 shrink-0", cfg.color)} />
                  <span className={cn("text-xs font-semibold flex-1", cfg.color)}>{cfg.label}</span>
                  <span className="text-[10px] text-gray-500">{areaInsights.length}</span>
                  {highCount > 0 && (
                    <Badge variant="destructive" className="text-[9px] px-1.5 py-0 h-4">{highCount} urgent</Badge>
                  )}
                  {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-600 shrink-0" />}
                </button>
                {!isCollapsed && (
                  <div className="px-2 pb-2 space-y-1.5">
                    {areaInsights.map(insight => (
                      <InsightCard
                        key={insight.id}
                        insight={insight}
                        isExpanded={expandedId === insight.id}
                        onToggle={() => setExpandedId(expandedId === insight.id ? null : insight.id)}
                        onDismiss={() => dismissMutation.mutate(insight.id)}
                        dismissPending={dismissMutation.isPending}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </ToolDrawer>
  );
}

interface SalesDashboardProps {
  period: TimePeriod;
  dateRange?: DateRangeValue;
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
  activeDrawer?: SalesDrawer;
  onDrawerChange?: (drawer: SalesDrawer) => void;
  renderDrawerOnly?: boolean;
  tvSplit?: 'left' | 'right';
}

interface Order {
  id: string;
  orderNumber: string;
  marketplace: string | null;
  orderDate: string;
  orderStatus: string;
  orderTotal: string;
  customerUsername: string;
}

export default function SalesDashboard({ period, dateRange: parentDateRange = 'mtd', onItemClick, activeDrawer, onDrawerChange, renderDrawerOnly, tvSplit }: SalesDashboardProps) {
  const [chartDateRange, setChartDateRange] = useState<DateRangeValue>('mtd');
  const [perfDateRange, setPerfDateRange] = useState<DateRangeValue>('mtd');
  const [localDateRange, setLocalDateRange] = useState<DateRangeValue>(parentDateRange);

  const dateRange = renderDrawerOnly
    ? (activeDrawer === 'chart' ? chartDateRange
      : activeDrawer === 'platform-perf' ? perfDateRange
      : parentDateRange)
    : localDateRange;

  const [platformDrawer, setPlatformDrawer] = useState<{ open: boolean; platform: string; productLine?: string }>({
    open: false,
    platform: '',
    productLine: undefined,
  });

  const currentYear = new Date().getFullYear();
  const [compareMode, setCompareMode] = useState(false);
  const [comparisonType, setComparisonType] = useState<'year' | 'platform'>('year');
  const [selectedCompareYears, setSelectedCompareYears] = useState<number[]>([currentYear - 1, currentYear - 2]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  
  // Helper function to safely parse dates with fallback
  const safeParseDate = (dateString: string): Date => {
    try {
      const date = parseISO(dateString);
      if (!isNaN(date.getTime())) return date;
      return new Date(dateString);
    } catch {
      return new Date(dateString);
    }
  };
  
  // Helper function to parse order totals that may have currency formatting
  const parseOrderTotal = (orderTotal: string | null | undefined): number => {
    if (!orderTotal) return 0;
    // Remove currency symbols, thousands separators, and other non-numeric chars except digits, minus, and decimal
    const cleaned = orderTotal.replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  };
  
  // Build query URL with date range parameter
  const buildQueryUrl = (baseUrl: string) => {
    return `${baseUrl}?range=${dateRange}`;
  };

  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ['/api/orders/summary', dateRange],
    queryFn: async () => {
      const url = buildQueryUrl('/api/orders/summary');
      console.log(`[SalesDashboard] Fetching orders with dateRange="${dateRange}", URL: ${url}`);
      const startTime = Date.now();
      const response = await fetch(url);
      const fetchTime = Date.now() - startTime;
      console.log(`[SalesDashboard] Response received in ${fetchTime}ms, status: ${response.status}`);
      
      if (!response.ok) {
        console.error(`[SalesDashboard] Response not OK: ${response.status} ${response.statusText}`);
        throw new Error('Failed to fetch orders');
      }
      
      const data = await response.json();
      console.log(`[SalesDashboard] Received ${data.length} orders for dateRange="${dateRange}"`, {
        isArray: Array.isArray(data),
        firstOrder: data[0]?.id,
        dataType: typeof data
      });
      return data;
    },
    staleTime: 30000,
  });

  // Fetch adjustment summary (refunds + fees + shipping) for the selected date range
  const { data: adjustmentSummary } = useQuery<{
    totalRefunds: number;
    refundedOrderCount: number;
    totalFees: number;
    bricklinkFees: number;
    stripeFees: number;
    totalShipping: number;
    shippedOrderCount: number;
    avgShippingPerOrder: number;
  }>({
    queryKey: ['/api/orders/adjustments/summary', dateRange],
    queryFn: async () => {
      const response = await fetch(`/api/orders/adjustments/summary?dateRange=${dateRange}`);
      if (!response.ok) throw new Error('Failed to fetch adjustment summary');
      return response.json();
    },
    staleTime: 60000,
  });

  // Fetch per-order refund totals for chart deduction
  const { data: refundsByOrder = {} } = useQuery<Record<string, number>>({
    queryKey: ['/api/orders/adjustments/by-order', dateRange],
    queryFn: async () => {
      const response = await fetch(`/api/orders/adjustments/by-order?dateRange=${dateRange}`);
      if (!response.ok) throw new Error('Failed to fetch per-order refunds');
      return response.json();
    },
    staleTime: 60000,
  });


  // Get available years from orders
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    orders.forEach(order => {
      const year = getYear(safeParseDate(order.orderDate));
      years.add(year);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [orders]);

  // Filter selected years to only include years with actual data
  // This ensures UI, chart, and metrics only show years from availableYears
  const validCompareYears = useMemo(() => {
    const nonCurrentYears = availableYears.filter(y => y !== currentYear);
    return selectedCompareYears.filter(y => nonCurrentYears.includes(y));
  }, [selectedCompareYears, availableYears, currentYear]);

  // Filter orders based on date range
  const getFilteredOrders = () => {
    if (dateRange === 'all') {
      console.log(`[SalesDashboard] Filtering with dateRange="all", returning ${orders.length} orders`);
      return orders;
    }

    if (dateRange === 'mtd') {
      // Month-to-Date: from start of current month to today
      const startOfCurrentMonth = startOfMonth(new Date());
      return orders.filter(order => {
        const orderDate = safeParseDate(order.orderDate);
        return orderDate >= startOfCurrentMonth;
      });
    }

    if (dateRange === 'lastmonth') {
      // Last Month: entire previous calendar month
      const startOfLastMonth = startOfMonth(subMonths(new Date(), 1));
      const startOfCurrentMonth = startOfMonth(new Date());
      return orders.filter(order => {
        const orderDate = safeParseDate(order.orderDate);
        return orderDate >= startOfLastMonth && orderDate < startOfCurrentMonth;
      });
    }

    if (dateRange === 'prevyear') {
      const startOfPrevYear = new Date(new Date().getFullYear() - 1, 0, 1);
      const startOfCurrentYear = new Date(new Date().getFullYear(), 0, 1);
      return orders.filter(order => {
        const orderDate = safeParseDate(order.orderDate);
        return orderDate >= startOfPrevYear && orderDate < startOfCurrentYear;
      });
    }

    const monthsToShow = dateRange === '1year' ? 12 : 3;
    
    // Start from the beginning of the month (N-1) months ago
    // This ensures we get exactly N months: current month + (N-1) prior months
    const cutoffDate = startOfMonth(subMonths(new Date(), monthsToShow - 1));
    
    return orders.filter(order => {
      const orderDate = safeParseDate(order.orderDate);
      return orderDate >= cutoffDate;
    });
  };

  const filteredOrders = getFilteredOrders();
  
  // Debug logging for revenue calculations
  console.log(`[SalesDashboard] filteredOrders.length = ${filteredOrders.length}`);
  console.log(`[SalesDashboard] Sample order totals:`, filteredOrders.slice(0, 3).map(o => o.orderTotal));

  // Get available platforms from FILTERED orders (only show platforms with data in selected date range)
  const availablePlatforms = useMemo(() => {
    const platforms = new Set<string>();
    filteredOrders.forEach(order => {
      const platform = order.marketplace || 'Unknown';
      platforms.add(platform);
    });
    return Array.from(platforms).sort();
  }, [filteredOrders]);

  // Filter selected platforms to only include platforms with actual data
  const validPlatforms = useMemo(() => {
    return selectedPlatforms.filter(p => availablePlatforms.includes(p));
  }, [selectedPlatforms, availablePlatforms]);

  const platformOrders = filteredOrders.filter(order => (order.marketplace || 'Unknown') === platformDrawer.platform);

  // Calculate sales data with intelligent granularity based on date range
  const getSalesData = () => {
    if (filteredOrders.length === 0) {
      return [];
    }

    // MTD and Last Month: show daily data
    if (dateRange === 'mtd' || dateRange === 'lastmonth') {
      let startDate: Date, endDate: Date;
      
      if (dateRange === 'mtd') {
        startDate = startOfMonth(new Date());
        endDate = new Date();
      } else {
        // Last month
        startDate = startOfMonth(subMonths(new Date(), 1));
        endDate = startOfMonth(new Date());
      }
      
      const dayCount = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      
      const days = Array.from({ length: dayCount }, (_, i) => {
        const dayDate = new Date(startDate);
        dayDate.setDate(startDate.getDate() + i);
        return {
          date: format(dayDate, 'MMM d'),
          day: startOfDay(dayDate),
          sales: 0,
        };
      });

      // Aggregate orders into days
      filteredOrders.forEach(order => {
        const gross = parseOrderTotal(order.orderTotal);
        const total = Math.max(0, gross - (refundsByOrder[order.id] || 0));
        if (gross > 0) {
          const orderDay = startOfDay(safeParseDate(order.orderDate));
          const dayData = days.find(d => d.day.getTime() === orderDay.getTime());
          if (dayData) {
            dayData.sales += total;
          }
        }
      });

      return days.map(({ date, sales }) => ({
        date,
        sales: Math.round(sales),
      }));
    }

    // 3 months: show weekly data
    if (dateRange === '3months') {
      const monthsBack = 2;
      const startDate = startOfMonth(subMonths(new Date(), monthsBack));
      const endDate = new Date();
      
      // Get start of first week
      const firstWeek = startOfWeek(startDate, { weekStartsOn: 0 }); // Sunday
      const weekCount = Math.ceil((endDate.getTime() - firstWeek.getTime()) / (1000 * 60 * 60 * 24 * 7));
      
      const weeks = Array.from({ length: weekCount }, (_, i) => {
        const weekDate = new Date(firstWeek);
        weekDate.setDate(firstWeek.getDate() + (i * 7));
        return {
          date: format(weekDate, 'MMM d'),
          week: startOfWeek(weekDate, { weekStartsOn: 0 }),
          sales: 0,
        };
      });

      // Aggregate orders into weeks
      filteredOrders.forEach(order => {
        const gross = parseOrderTotal(order.orderTotal);
        const total = Math.max(0, gross - (refundsByOrder[order.id] || 0));
        if (gross > 0) {
          const orderDate = safeParseDate(order.orderDate);
          const orderWeek = startOfWeek(orderDate, { weekStartsOn: 0 });
          const weekData = weeks.find(w => w.week.getTime() === orderWeek.getTime());
          if (weekData) {
            weekData.sales += total;
          }
        }
      });

      return weeks.map(({ date, sales }) => ({
        date,
        sales: Math.round(sales),
      }));
    }

    let months: Array<{ date: string; month: Date; sales: number }>;
    
    if (dateRange === 'all') {
      // For 'all time', use the actual earliest to latest order dates
      // Filter out invalid dates to prevent NaN/Invalid Date issues
      const orderDates = filteredOrders
        .map(o => {
          // Try parseISO first, then fallback to new Date()
          try {
            const date = safeParseDate(o.orderDate);
            return !isNaN(date.getTime()) ? date : new Date(o.orderDate);
          } catch {
            return new Date(o.orderDate);
          }
        })
        .filter(d => !isNaN(d.getTime())); // Remove invalid dates
      
      if (orderDates.length === 0) {
        // No valid dates - this shouldn't happen, but log it
        console.error('SalesDashboard: No valid order dates found in "all" timeframe', {
          totalOrders: filteredOrders.length,
          sampleDates: filteredOrders.slice(0, 3).map(o => o.orderDate)
        });
        return [];
      }
      
      const earliestOrderDate = new Date(Math.min(...orderDates.map(d => d.getTime())));
      const latestOrderDate = new Date(Math.max(...orderDates.map(d => d.getTime())));
      
      // Calculate year span
      const startYear = earliestOrderDate.getFullYear();
      const endYear = latestOrderDate.getFullYear();
      const yearSpan = endYear - startYear + 1;
      
      // If data spans more than 2 years, aggregate by year instead of month
      if (yearSpan > 2) {
        // Generate yearly data points
        const years = Array.from({ length: yearSpan }, (_, i) => {
          const year = startYear + i;
          return {
            date: year.toString(),
            month: new Date(year, 0, 1), // Jan 1st of each year
            sales: 0,
          };
        });
        
        // Aggregate orders by year
        filteredOrders.forEach(order => {
          const gross = parseOrderTotal(order.orderTotal);
          const total = Math.max(0, gross - (refundsByOrder[order.id] || 0));
          if (gross > 0) {
            let orderDate: Date;
            try {
              orderDate = safeParseDate(order.orderDate);
              if (isNaN(orderDate.getTime())) {
                orderDate = new Date(order.orderDate);
              }
            } catch {
              orderDate = new Date(order.orderDate);
            }
            
            if (!isNaN(orderDate.getTime())) {
              const orderYear = orderDate.getFullYear();
              const yearData = years.find(y => y.date === orderYear.toString());
              if (yearData) {
                yearData.sales += total;
              }
            }
          }
        });
        
        return years.map(({ date, sales }) => ({
          date,
          sales: Math.round(sales),
        }));
      }
      
      // For 2 years or less, show monthly data
      const startMonth = startOfMonth(earliestOrderDate);
      const endMonth = startOfMonth(latestOrderDate);
      
      // Calculate months between earliest and latest
      const monthDiff = (endMonth.getFullYear() - startMonth.getFullYear()) * 12 + 
                        (endMonth.getMonth() - startMonth.getMonth()) + 1;
      
      // Generate months from start to latest
      months = Array.from({ length: monthDiff }, (_, i) => {
        const monthDate = new Date(startMonth);
        monthDate.setMonth(startMonth.getMonth() + i);
        return {
          date: format(monthDate, 'MMM yyyy'),
          month: startOfMonth(monthDate),
          sales: 0,
        };
      });
    } else if (dateRange === 'prevyear') {
      // Previous year: all 12 months of last calendar year
      const prevYear = new Date().getFullYear() - 1;
      months = Array.from({ length: 12 }, (_, i) => {
        const monthDate = new Date(prevYear, i, 1);
        return {
          date: format(monthDate, 'MMM yyyy'),
          month: startOfMonth(monthDate),
          sales: 0,
        };
      });
    } else {
      // For 1 year: use monthly data (rolling 12 months), otherwise 3 months
      const monthsToShow = dateRange === '1year' ? 12 : 3;
      
      months = Array.from({ length: monthsToShow }, (_, i) => {
        const date = subMonths(new Date(), monthsToShow - 1 - i);
        return {
          date: format(date, 'MMM yyyy'),
          month: startOfMonth(date),
          sales: 0,
        };
      });
    }

    // Aggregate orders into months
    filteredOrders.forEach(order => {
      const gross = parseOrderTotal(order.orderTotal);
      const total = Math.max(0, gross - (refundsByOrder[order.id] || 0));
      if (gross > 0) {
        // Use fallback date parser to handle various date formats
        let orderDate: Date;
        try {
          orderDate = safeParseDate(order.orderDate);
          if (isNaN(orderDate.getTime())) {
            orderDate = new Date(order.orderDate);
          }
        } catch {
          orderDate = new Date(order.orderDate);
        }
        
        // Skip if still invalid
        if (isNaN(orderDate.getTime())) {
          console.warn('Invalid order date:', order.orderDate, 'for order:', order.id);
          return;
        }
        
        const orderMonth = startOfMonth(orderDate);
        const monthData = months.find(m => m.month.getTime() === orderMonth.getTime());
        if (monthData) {
          monthData.sales += total;
        }
      }
    });

    return months.map(({ date, sales }) => ({
      date,
      sales: Math.round(sales),
    }));
  };

  // Year comparison data generation - respects date range filter
  const getYearComparisonData = () => {
    const years = [currentYear, ...validCompareYears];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Determine the date range boundaries for comparison
    let startDate: Date, endDate: Date;
    const now = new Date();
    
    if (dateRange === 'mtd') {
      startDate = startOfMonth(now);
      endDate = now;
    } else if (dateRange === '3months') {
      // 3 months = current month + 2 prior months
      startDate = startOfMonth(subMonths(now, 2));
      endDate = now;
    } else if (dateRange === '1year') {
      // 12 months = current month + 11 prior months
      startDate = startOfMonth(subMonths(now, 11));
      endDate = now;
    } else if (dateRange === 'prevyear') {
      // Previous calendar year: Jan 1 to Dec 31
      startDate = new Date(now.getFullYear() - 1, 0, 1);
      endDate = new Date(now.getFullYear() - 1, 11, 31);
    } else {
      // 'all' - get oldest order date
      const oldestOrder = orders.reduce((oldest, order) => {
        const orderDate = safeParseDate(order.orderDate);
        return !oldest || orderDate < oldest ? orderDate : oldest;
      }, null as Date | null);
      startDate = oldestOrder || subYears(now, 10);
      endDate = now;
    }
    
    // Create data structure only for months within the date range
    const comparisonData: Array<{
      month: string;
      monthIndex: number;
      bucketDate: Date;  // Full date for accurate matching
      [key: string]: string | number | Date;
    }> = [];
    
    // Generate month buckets from startDate to endDate
    let currentDate = startOfMonth(startDate);
    const endMonth = startOfMonth(endDate);
    
    // Initialize bucket with all years
    const initialBucketData: Record<string, number> = { [`${currentYear}`]: 0 };
    validCompareYears.forEach(year => {
      initialBucketData[`${year}`] = 0;
    });
    
    while (currentDate <= endMonth) {
      const monthIndex = currentDate.getMonth();
      const monthYear = currentDate.getFullYear();
      const monthLabel = dateRange === 'mtd' 
        ? monthNames[monthIndex]  // Just month name for MTD
        : `${monthNames[monthIndex]} ${monthYear.toString().slice(-2)}`; // Month + year for longer ranges
      
      comparisonData.push({
        month: monthLabel,
        monthIndex,
        bucketDate: new Date(currentDate),  // Store full date for matching
        ...initialBucketData,
      });
      
      currentDate = subMonths(currentDate, -1); // Add 1 month
    }

    // Aggregate orders by year and month, respecting the same date range window
    orders.forEach(order => {
      const total = parseOrderTotal(order.orderTotal);
      if (total <= 0) return;
      
      const orderDate = safeParseDate(order.orderDate);
      const year = getYear(orderDate);
      
      // Only process orders from the comparison years
      if (!years.includes(year)) return;
      
      // Apply same date range filter logic for each year
      // For example, if we're looking at Oct 1-13 this year, only include Oct 1-13 for previous years
      const yearDiff = currentYear - year;
      const compareStartDate = subYears(startDate, yearDiff);
      const compareEndDate = subYears(endDate, yearDiff);
      
      if (orderDate >= compareStartDate && orderDate <= compareEndDate) {
        // Find the bucket for this order's month by matching the year-adjusted month
        const orderMonth = startOfMonth(orderDate);
        // Shift the order date to current year's timeline for bucket matching
        // For older years, we need to ADD years to bring them forward to current year timeline
        const adjustedMonth = addYears(orderMonth, yearDiff);
        
        const bucketIndex = comparisonData.findIndex(bucket => {
          const bucketDateObj = bucket.bucketDate as Date;
          return bucketDateObj.getTime() === adjustedMonth.getTime();
        });
        
        if (bucketIndex !== -1) {
          const monthData = comparisonData[bucketIndex];
          const currentValue = monthData[`${year}`] as number || 0;
          monthData[`${year}`] = currentValue + total;
        }
      }
    });

    // Round values and return
    return comparisonData.map(d => {
      const roundedData: Record<string, any> = {
        month: d.month,
        monthIndex: d.monthIndex,
        bucketDate: d.bucketDate,
        [`${currentYear}`]: Math.round((d[`${currentYear}`] as number) || 0),
      };
      selectedCompareYears.forEach(year => {
        roundedData[`${year}`] = Math.round((d[`${year}`] as number) || 0);
      });
      return roundedData;
    });
  };

  // Platform comparison data generation - respects date range filter
  const getPlatformComparisonData = () => {
    const platforms = validPlatforms;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Determine the date range boundaries
    let startDate: Date, endDate: Date;
    const now = new Date();
    
    if (dateRange === 'mtd') {
      startDate = startOfMonth(now);
      endDate = now;
    } else if (dateRange === '3months') {
      startDate = startOfMonth(subMonths(now, 2));
      endDate = now;
    } else if (dateRange === '1year') {
      startDate = startOfMonth(subMonths(now, 11));
      endDate = now;
    } else if (dateRange === 'prevyear') {
      startDate = new Date(now.getFullYear() - 1, 0, 1);
      endDate = new Date(now.getFullYear() - 1, 11, 31);
    } else {
      // 'all' - get oldest order date
      const oldestOrder = orders.reduce((oldest, order) => {
        const orderDate = safeParseDate(order.orderDate);
        return !oldest || orderDate < oldest ? orderDate : oldest;
      }, null as Date | null);
      startDate = oldestOrder || subYears(now, 10);
      endDate = now;
    }
    
    // Create data structure for months within the date range
    const comparisonData: Array<{
      month: string;
      monthIndex: number;
      bucketDate: Date;
      [key: string]: string | number | Date;
    }> = [];
    
    // Generate month buckets from startDate to endDate
    let currentDate = startOfMonth(startDate);
    const endMonth = startOfMonth(endDate);
    
    // Initialize bucket with all platforms
    const initialBucketData: Record<string, number> = {};
    platforms.forEach(platform => {
      initialBucketData[platform] = 0;
    });
    
    while (currentDate <= endMonth) {
      const monthIndex = currentDate.getMonth();
      const monthYear = currentDate.getFullYear();
      const monthLabel = dateRange === 'mtd' 
        ? monthNames[monthIndex]
        : `${monthNames[monthIndex]} ${monthYear.toString().slice(-2)}`;
      
      comparisonData.push({
        month: monthLabel,
        monthIndex,
        bucketDate: new Date(currentDate), // Store full date for accurate matching
        ...initialBucketData,
      });
      
      currentDate = subMonths(currentDate, -1); // Add 1 month
    }

    // Aggregate orders by platform and month
    filteredOrders.forEach(order => {
      const total = parseOrderTotal(order.orderTotal);
      if (total <= 0) return;
      
      const platform = order.marketplace || 'Unknown';
      if (!platforms.includes(platform)) return;
      
      const orderDate = safeParseDate(order.orderDate);
      const orderMonth = startOfMonth(orderDate);
      
      const bucketIndex = comparisonData.findIndex(bucket => {
        const bucketDateObj = bucket.bucketDate as Date;
        return bucketDateObj.getTime() === orderMonth.getTime();
      });
      
      if (bucketIndex !== -1) {
        const monthData = comparisonData[bucketIndex];
        const currentValue = monthData[platform] as number || 0;
        monthData[platform] = currentValue + total;
      }
    });

    // Round values and return
    return comparisonData.map(d => {
      const roundedData: Record<string, any> = {
        month: d.month,
        monthIndex: d.monthIndex,
        bucketDate: d.bucketDate,
      };
      platforms.forEach(platform => {
        roundedData[platform] = Math.round((d[platform] as number) || 0);
      });
      return roundedData;
    });
  };

  // Calculate total revenue and average
  const totalRevenue = filteredOrders.reduce((sum, order) => {
    const orderTotal = parseOrderTotal(order.orderTotal);
    return sum + orderTotal;
  }, 0);
  const averageOrderValue = filteredOrders.length > 0 ? totalRevenue / filteredOrders.length : 0;
  
  // Debug revenue calculation
  console.log(`[SalesDashboard] Revenue Calculation for dateRange="${dateRange}":`, {
    filteredOrdersCount: filteredOrders.length,
    totalRevenue: totalRevenue,
    averageOrderValue: averageOrderValue,
    sampleOrderTotals: filteredOrders.slice(0, 5).map(o => ({
      id: o.id,
      orderTotal: o.orderTotal,
      parsed: parseOrderTotal(o.orderTotal)
    }))
  });

  const data = getSalesData();
  const average = data.length > 0 ? Math.round(data.reduce((sum, d) => sum + d.sales, 0) / data.length) : 0;
  
  // Debug chart data
  console.log(`[SalesDashboard] Chart Data for dateRange="${dateRange}":`, {
    dataPointsCount: data.length,
    averagePerPeriod: average,
    totalInChart: data.reduce((sum, d) => sum + d.sales, 0),
    sampleData: data.slice(0, 3)
  });
  
  // Diagnostic warnings - visible on page
  const warnings: string[] = [];
  if (dateRange === 'all' && orders.length > 0 && filteredOrders.length === 0) {
    warnings.push(`⚠️ DATE FILTER ERROR: ${orders.length} orders fetched but 0 filtered for "all" range`);
  }
  if (filteredOrders.length > 0 && totalRevenue === 0 && filteredOrders.some(o => parseFloat(o.orderTotal ?? '0') > 0)) {
    warnings.push(`⚠️ REVENUE PARSING ERROR: ${filteredOrders.length} orders but $0 revenue. Sample: ${filteredOrders[0]?.orderTotal}`);
  }
  if (filteredOrders.length > 0 && data.length === 0) {
    warnings.push(`⚠️ CHART DATA ERROR: ${filteredOrders.length} orders but 0 chart data points generated`);
  }
  if (dateRange === 'all' && orders.length === 0) {
    warnings.push(`⚠️ NO ORDERS FETCHED: Backend returned 0 orders for "all" range`);
  }

  if (isLoading) {
    return (
      <div className="p-2 space-y-1.5">
        <div className="relative bg-gradient-to-b from-green-900/40 to-gray-900/88 border border-green-400/65 rounded-lg shadow-[0_0_28px_rgba(34,197,94,0.28)] overflow-hidden p-3">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-green-400/60 to-transparent" />
          <div className="text-xs text-gray-400 animate-pulse">Loading sales data...</div>
        </div>
      </div>
    );
  }

  const comparisonData = compareMode 
    ? (comparisonType === 'year' ? getYearComparisonData() : getPlatformComparisonData())
    : [];
  const comparisonYears = [currentYear, ...validCompareYears];
  
  // Platform colors - matching PlatformPerformance component
  const PLATFORM_COLORS: Record<string, string> = {
    'BrickLink': '#FF8C00',
    'eBay': '#E53238',
    'Amazon': '#FF9900',
    'Etsy': '#F1641E',
    'Facebook': '#1877F2',
    'Unknown': '#6B7280',
    'Other': '#9CA3AF',
  };
  
  // Colors for year lines in comparison chart - dynamic palette
  const colorPalette = [
    'hsl(140 70% 50%)',  // Green for current year
    'hsl(200 70% 50%)',  // Blue
    'hsl(280 70% 50%)',  // Purple
    'hsl(30 70% 50%)',   // Orange
    'hsl(340 70% 50%)',  // Pink
    'hsl(180 70% 50%)',  // Cyan
    'hsl(60 70% 50%)',   // Yellow
    'hsl(260 70% 50%)',  // Violet
  ];
  
  const yearColors: Record<number, string> = {
    [currentYear]: colorPalette[0],
  };
  validCompareYears.forEach((year, index) => {
    yearColors[year] = colorPalette[(index + 1) % colorPalette.length];
  });

  const closeDrawer = () => onDrawerChange?.(null);

  if (renderDrawerOnly) {
    return (
      <>
        {activeDrawer === 'chart' && (
          <ToolDrawer icon={Activity} iconColor="text-green-400" title="Sales Chart" onClose={closeDrawer} closeTestId="button-close-sales-chart" contentClassName="flex-1 overflow-y-auto px-4 pt-4 pb-4 space-y-3">
              <div className="flex justify-center" data-testid="chart-date-range">
                <DateRangeSelector value={chartDateRange} onChange={setChartDateRange} compact scaled />
              </div>
              <div className="bg-black/20 rounded-lg p-3">
                {!compareMode ? (
                  <>
                    <div className="mb-1 text-xs text-gray-400">
                      Average: <span className="text-lego-green font-mono font-semibold">${average.toLocaleString()}</span>
                      <span className="ml-2 text-gray-500">Total Revenue: ${Math.round(totalRevenue).toLocaleString()}</span>
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="date" stroke="#9CA3AF" style={{ fontSize: '10px' }} />
                        <YAxis stroke="#9CA3AF" style={{ fontSize: '10px' }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '6px', fontSize: '12px' }}
                          labelStyle={{ color: '#D1D5DB' }}
                          formatter={(value: number) => [`$${value.toLocaleString()}`, 'Net Revenue']}
                        />
                        <Line type="monotone" dataKey="sales" name="Net Revenue" stroke="hsl(140 70% 50%)" strokeWidth={2} dot={{ fill: 'hsl(140 70% 50%)', r: 1 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </>
                ) : comparisonType === 'year' ? (
                  <>
                    <div className="mb-1 text-xs text-gray-400">
                      <span className="text-lego-green font-semibold">Year-over-Year Comparison</span>
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={comparisonData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="month" stroke="#9CA3AF" style={{ fontSize: '10px' }} />
                        <YAxis stroke="#9CA3AF" style={{ fontSize: '10px' }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '6px', fontSize: '12px' }}
                          labelStyle={{ color: '#D1D5DB' }}
                        />
                        <Legend wrapperStyle={{ fontSize: '10px' }} />
                        {comparisonYears.map(year => (
                          <Line
                            key={year}
                            type="monotone"
                            dataKey={`${year}`}
                            stroke={yearColors[year]}
                            strokeWidth={2}
                            dot={{ fill: yearColors[year], r: 1 }}
                            name={year.toString()}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </>
                ) : (
                  <>
                    <div className="mb-1 text-xs text-gray-400">
                      <span className="text-lego-green font-semibold">Platform Comparison</span>
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={comparisonData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="month" stroke="#9CA3AF" style={{ fontSize: '10px' }} />
                        <YAxis stroke="#9CA3AF" style={{ fontSize: '10px' }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '6px', fontSize: '12px' }}
                          labelStyle={{ color: '#D1D5DB' }}
                        />
                        <Legend wrapperStyle={{ fontSize: '10px' }} />
                        {validPlatforms.map(platform => (
                          <Line
                            key={platform}
                            type="monotone"
                            dataKey={platform}
                            stroke={PLATFORM_COLORS[platform] || PLATFORM_COLORS['Other']}
                            strokeWidth={2}
                            dot={{ fill: PLATFORM_COLORS[platform] || PLATFORM_COLORS['Other'], r: 1 }}
                            name={platform}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </>
                )}
              </div>

              {/* Compare Controls */}
              <div className="flex flex-wrap items-center gap-2 border border-green-500/15 rounded-lg bg-black/15 px-2 py-1.5">
                <button
                  onClick={() => setCompareMode(!compareMode)}
                  className={`flex items-center gap-1.5 text-[10px] md:text-sm font-bold py-1 px-2 rounded transition-all ${
                    compareMode
                      ? 'bg-green-600/30 text-green-200 border border-green-500/40'
                      : 'text-gray-400 border border-gray-600/30 hover:border-green-500/30 hover:text-green-300'
                  }`}
                  data-testid="button-toggle-compare"
                >
                  <GitCompare className="w-3 h-3 md:w-4 md:h-4" />
                  Compare
                </button>
                {compareMode && (
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setComparisonType('year')}
                      className={`text-[10px] md:text-xs font-semibold py-0.5 px-2 rounded transition-all ${
                        comparisonType === 'year'
                          ? 'bg-green-600/30 text-green-200 border border-green-500/40'
                          : 'text-gray-400 border border-gray-600/30 hover:text-green-300'
                      }`}
                      data-testid="button-compare-year"
                    >
                      By Year
                    </button>
                    {availablePlatforms.length > 1 && (
                      <button
                        onClick={() => setComparisonType('platform')}
                        className={`text-[10px] md:text-xs font-semibold py-0.5 px-2 rounded transition-all ${
                          comparisonType === 'platform'
                            ? 'bg-green-600/30 text-green-200 border border-green-500/40'
                            : 'text-gray-400 border border-gray-600/30 hover:text-green-300'
                        }`}
                        data-testid="button-compare-platform"
                      >
                        By Platform
                      </button>
                    )}
                  </div>
                )}

                {compareMode && comparisonType === 'year' && availableYears.length > 0 && (
                  <div className="flex items-center gap-2 overflow-x-auto w-full">
                    <span className="text-[9px] md:text-xs text-gray-500 flex-shrink-0">vs</span>
                    <div className="flex gap-1.5 flex-nowrap">
                      {(() => {
                        const nonCurrentYears = availableYears.filter(y => y !== currentYear);
                        const sorted = [
                          ...[...validCompareYears].sort((a, b) => b - a),
                          ...nonCurrentYears.filter(y => !validCompareYears.includes(y)).sort((a, b) => b - a),
                        ];
                        return sorted.map(year => {
                          const isSelected = selectedCompareYears.includes(year);
                          return (
                            <button
                              key={year}
                              onClick={() => {
                                if (isSelected) setSelectedCompareYears(selectedCompareYears.filter(y => y !== year));
                                else setSelectedCompareYears([...selectedCompareYears, year].sort((a, b) => b - a));
                              }}
                              aria-pressed={isSelected}
                              className={`text-[9px] md:text-xs font-bold py-1 px-2 rounded transition-all flex-shrink-0 ${isSelected ? 'bg-blue-600 text-white border border-blue-500' : 'bg-gray-800 text-gray-400 border border-gray-700 hover-elevate'}`}
                              data-testid={`year-toggle-drawer-${year}`}
                            >
                              {year}
                            </button>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}

                {compareMode && comparisonType === 'platform' && availablePlatforms.length > 0 && (
                  <div className="flex items-center gap-2 overflow-x-auto w-full">
                    <span className="text-[9px] md:text-xs text-gray-500 flex-shrink-0">select</span>
                    <div className="flex gap-1.5 flex-nowrap">
                      {(() => {
                        const sorted = [
                          ...[...validPlatforms].sort((a, b) => a.localeCompare(b)),
                          ...availablePlatforms.filter(p => !validPlatforms.includes(p)).sort((a, b) => a.localeCompare(b)),
                        ];
                        return sorted.map(platform => {
                          const isSelected = selectedPlatforms.includes(platform);
                          return (
                            <button
                              key={platform}
                              onClick={() => {
                                if (isSelected) setSelectedPlatforms(selectedPlatforms.filter(p => p !== platform));
                                else setSelectedPlatforms([...selectedPlatforms, platform].sort((a, b) => a.localeCompare(b)));
                              }}
                              aria-pressed={isSelected}
                              className={`text-[9px] md:text-xs font-bold py-1 px-2 rounded transition-all flex-shrink-0 ${isSelected ? 'bg-blue-600 text-white border border-blue-500' : 'bg-gray-800 text-gray-400 border border-gray-700 hover-elevate'}`}
                              data-testid={`platform-toggle-drawer-${platform.toLowerCase().replace(/\s+/g, '-')}`}
                            >
                              {platform}
                            </button>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {compareMode && comparisonType === 'year' && validCompareYears.length > 0 && (
                <div className="bg-black/20 rounded-lg p-3" data-testid="section-yoy-metrics-drawer">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1 rounded bg-purple-900/50 ring-1 ring-purple-500/40 shadow-[0_0_6px_rgba(168,85,247,0.25)]">
                      <TrendingUp className="w-3 h-3 text-purple-300" />
                    </div>
                    <h3 className="text-[10px] md:text-sm font-semibold text-purple-300 uppercase tracking-wide">Year-over-Year Growth</h3>
                  </div>
                  <div className={`grid gap-2 ${validCompareYears.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    {(() => {
                      const yearTotals = comparisonYears.reduce((acc, year) => {
                        acc[year] = comparisonData.reduce((sum, m) => sum + ((m[`${year}`] as number) || 0), 0);
                        return acc;
                      }, {} as Record<number, number>);
                      return validCompareYears.map(compareYear => {
                        const growth = yearTotals[compareYear] > 0 ? ((yearTotals[currentYear] - yearTotals[compareYear]) / yearTotals[compareYear]) * 100 : 0;
                        return (
                          <div key={compareYear} className="bg-gray-800/50 rounded p-2">
                            <div className="text-[9px] md:text-xs text-gray-500 mb-1">{currentYear} vs {compareYear}</div>
                            <div className={`text-sm font-mono font-bold ${growth >= 0 ? 'text-green-400' : 'text-red-400'}`}>{growth >= 0 ? '+' : ''}{growth.toFixed(1)}%</div>
                            <div className="text-[9px] md:text-xs text-gray-400 mt-1">${Math.round(yearTotals[currentYear]).toLocaleString()} vs ${Math.round(yearTotals[compareYear]).toLocaleString()}</div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}

              {compareMode && comparisonType === 'platform' && validPlatforms.length > 0 && (
                <div className="bg-black/20 rounded-lg p-3" data-testid="section-platform-metrics-drawer">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1 rounded bg-purple-900/50 ring-1 ring-purple-500/40 shadow-[0_0_6px_rgba(168,85,247,0.25)]">
                      <TrendingUp className="w-3 h-3 text-purple-300" />
                    </div>
                    <h3 className="text-[10px] md:text-sm font-semibold text-purple-300 uppercase tracking-wide">Platform Comparison</h3>
                  </div>
                  <div className={`grid gap-2 ${validPlatforms.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    {(() => {
                      const totals = validPlatforms.reduce((acc, p) => { acc[p] = comparisonData.reduce((s, m) => s + ((m[p] as number) || 0), 0); return acc; }, {} as Record<string, number>);
                      const totalRev = Object.values(totals).reduce((s, v) => s + v, 0);
                      return validPlatforms.map(platform => (
                        <div key={platform} className="bg-gray-800/50 rounded p-2">
                          <div className="flex items-center gap-1 mb-1">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[platform] || PLATFORM_COLORS['Other'] }} />
                            <div className="text-[9px] md:text-xs text-gray-500">{platform}</div>
                          </div>
                          <div className="text-sm font-mono font-bold text-white">${Math.round(totals[platform]).toLocaleString()}</div>
                          <div className="text-[9px] md:text-xs text-gray-400 mt-1">{(totalRev > 0 ? (totals[platform] / totalRev) * 100 : 0).toFixed(1)}% of total</div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}

              {/* Orders Table */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-4 h-4 text-green-400" />
                  <h4 className="text-sm font-semibold text-gray-200">Orders</h4>
                  <span className="text-xs text-gray-500">{filteredOrders.length} total</span>
                </div>
                <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-gray-700">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-gray-800 text-gray-400 uppercase">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium">Order</th>
                        <th className="px-2 py-1.5 text-left font-medium">Date</th>
                        <th className="px-2 py-1.5 text-left font-medium">Customer</th>
                        <th className="px-2 py-1.5 text-left font-medium">Platform</th>
                        <th className="px-2 py-1.5 text-left font-medium">Status</th>
                        <th className="px-2 py-1.5 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {filteredOrders.map((order) => (
                        <tr
                          key={order.id}
                          className="hover:bg-gray-800/40 cursor-pointer transition-colors"
                          onClick={() => onItemClick?.('order', order.id)}
                          data-testid={`row-order-${order.id}`}
                        >
                          <td className="px-2 py-1.5 font-mono text-green-300">{order.orderNumber || order.id}</td>
                          <td className="px-2 py-1.5 text-gray-400">{format(parseISO(order.orderDate), 'MMM d, yyyy')}</td>
                          <td className="px-2 py-1.5 text-gray-300">{order.customerUsername}</td>
                          <td className="px-2 py-1.5 text-gray-400">{order.marketplace || '—'}</td>
                          <td className="px-2 py-1.5">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                              order.orderStatus === 'Shipped' ? 'bg-green-500/20 text-green-300' :
                              order.orderStatus === 'Pending' ? 'bg-yellow-500/20 text-yellow-300' :
                              'bg-gray-500/20 text-gray-300'
                            }`}>{order.orderStatus}</span>
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-gray-200">${parseFloat(order.orderTotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                      {filteredOrders.length === 0 && (
                        <tr><td colSpan={6} className="px-2 py-6 text-center text-gray-500">No orders in this period</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
          </ToolDrawer>
        )}

        {activeDrawer === 'platform-perf' && (
          <ToolDrawer icon={BarChart2} iconColor="text-orange-400" title="Platform Performance" onClose={closeDrawer} closeTestId="button-close-platform-performance">
            <div className="flex justify-center mb-3" data-testid="platform-perf-date-range">
              <DateRangeSelector value={perfDateRange} onChange={setPerfDateRange} compact scaled />
            </div>
            <PlatformPerformance
              orders={filteredOrders}
              onPlatformClick={(platform) => {
                setPlatformDrawer({ open: true, platform, productLine: undefined });
              }}
            />
          </ToolDrawer>
        )}

        {activeDrawer === 'acquisition-evaluator' && (
          <ToolDrawer icon={Package} iconColor="text-violet-400" title="Acquisition Evaluator" onClose={closeDrawer} closeTestId="button-close-acquisition-evaluator" contentClassName="flex-1 overflow-y-auto px-4 pt-4 pb-4">
            <AcquisitionEvaluator />
          </ToolDrawer>
        )}
        {activeDrawer === 'business-intel' && (
          <BusinessIntelDrawer onClose={closeDrawer} />
        )}

        <PlatformOrdersDrawer
          open={platformDrawer.open}
          onClose={() => setPlatformDrawer({ open: false, platform: '', productLine: undefined })}
          platform={platformDrawer.platform}
          orders={platformOrders}
          onOrderClick={(orderId) => onItemClick?.('order', orderId)}
        />
      </>
    );
  }

  return (
        <div className={tvSplit ? "p-2 xl:p-3 space-y-3 h-full overflow-y-auto" : "p-2 space-y-3 bg-gradient-to-br from-green-500/5 to-transparent rounded-lg border border-green-500/10 shadow-[0_0_15px_rgba(34,197,94,0.1)]"}>
      {(!tvSplit || tvSplit === 'left') && <>
      {/* Diagnostic Warnings */}
      {warnings.length > 0 && (
        <div className="bg-red-900/30 border-2 border-red-500 rounded-lg p-3" data-testid="diagnostic-warnings">
          <div className="text-red-400 font-bold text-sm mb-2">DIAGNOSTIC WARNINGS:</div>
          {warnings.map((warning, idx) => (
            <div key={idx} className="text-red-300 text-xs font-mono mb-1">{warning}</div>
          ))}
          <div className="text-red-400 text-xs mt-2">
            Debug Info: dateRange={dateRange}, orders={orders.length}, filtered={filteredOrders.length}, revenue=${totalRevenue.toFixed(2)}
          </div>
        </div>
      )}
      
      {/* ── Top Metrics ── */}
      <div className={cn("relative bg-gradient-to-b from-green-900/40 to-gray-900/88 border border-green-400/65 rounded-lg shadow-[0_0_28px_rgba(34,197,94,0.25)] overflow-hidden", "p-2.5")} data-testid="section-sales-overview">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-green-400/50 to-transparent" />
        <div className="flex items-center gap-2 mb-2">
          <div className="p-1.5 rounded-md bg-green-900/60 ring-1 ring-green-500/50 shadow-[0_0_10px_rgba(34,197,94,0.25)] shrink-0">
            <TrendingUp className="w-3 h-3 md:w-4 md:h-4 text-green-200" />
          </div>
          <h3 className="text-xs font-semibold text-green-200 uppercase tracking-wide min-w-0 md:text-sm">Insights</h3>
          <CollapsibleDatePicker
            value={localDateRange}
            onChange={setLocalDateRange}
            accentClass="text-green-400/70 hover:text-green-300"
            testId="button-insights-date-picker"
          />
        </div>
        <div className={cn("grid grid-cols-3 gap-1.5", "mb-2")} data-testid="section-sales-metrics">
          <MetricCard label="Orders" value={filteredOrders.length} color="green" data-testid="metric-sales-orders" />
          <MetricCard label="Gross Revenue" value={`$${Math.round(totalRevenue).toLocaleString()}`} color="green" data-testid="metric-sales-gross" />
          <MetricCard label="Avg Order" value={`$${averageOrderValue.toFixed(2)}`} color="green" data-testid="metric-sales-avg" />
        </div>
        {adjustmentSummary && (
          <div className="grid grid-cols-3 gap-1.5">
            <MetricCard label="Net Revenue" value={`$${Math.max(0, totalRevenue - adjustmentSummary.totalRefunds).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color="green" data-testid="metric-sales-net" />
            <MetricCard label="Refunds" value={adjustmentSummary.totalRefunds > 0 ? `-$${adjustmentSummary.totalRefunds.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '$0'} color="red" data-testid="metric-sales-refunds" />
            <MetricCard label="Shipping" value={adjustmentSummary.totalShipping > 0 ? `-$${adjustmentSummary.totalShipping.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '$0'} color="yellow" data-testid="metric-sales-shipping" />
          </div>
        )}
      </div>
      </>}
      {(!tvSplit || tvSplit === 'right') && <>

      {/* ── Tools Section ── */}
      <div className={cn("relative bg-gradient-to-b from-gray-700/62 to-gray-900/92 border border-gray-400/60 rounded-lg shadow-[0_0_20px_rgba(255,255,255,0.08)] overflow-hidden", "p-2.5")}>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gray-200/55 to-transparent" />
          <div className={cn("flex items-center gap-2", "mb-2")}>
            <div className="p-1.5 rounded-md bg-gray-600/70 ring-1 ring-gray-300/55 shrink-0">
              <BarChart2 className="w-3 h-3 md:w-4 md:h-4 text-gray-200" />
            </div>
            <h3 className="text-xs font-semibold text-gray-200 uppercase tracking-wide md:text-sm">Systems</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onDrawerChange?.('business-intel')}
              data-testid="tool-business-intel"
              className={cn("col-span-2 group flex flex-col gap-1.5 rounded-lg border border-cyan-400/72 bg-gradient-to-br from-cyan-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", "p-3")}
              style={{ '--tool-glow-color': 'rgba(6,182,212,0.35)' } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-cyan-800/75 p-1.5 ring-1 ring-cyan-400/65 shadow-[0_0_10px_rgba(6,182,212,0.22)]">
                  <Radar className={cn("w-3.5 h-3.5 text-cyan-200", "md:w-5 md:h-5 lg:w-4 lg:h-4")} />
                </div>
                <span className={cn("text-xs font-bold text-cyan-100 leading-tight flex-1", "md:text-sm")}>Business Intel</span>
                <ArrowRight className="w-3 h-3 text-cyan-500/60 group-hover:text-cyan-400 transition-colors" />
              </div>
              <p className="text-[10px] md:text-xs text-cyan-300/60 leading-snug">Market-driven insights for your business</p>
            </button>
            <button
              onClick={() => onDrawerChange?.('chart')}
              data-testid="tool-sales-chart"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-green-400/72 bg-gradient-to-br from-green-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", "p-3")}
              style={{ '--tool-glow-color': 'rgba(34,197,94,0.35)' } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-green-800/75 p-1.5 ring-1 ring-green-400/65 shadow-[0_0_10px_rgba(34,197,94,0.22)]">
                  <Activity className={cn("w-3.5 h-3.5 text-green-200", "md:w-5 md:h-5 lg:w-4 lg:h-4")} />
                </div>
                <span className={cn("text-xs font-bold text-green-100 leading-tight flex-1", "md:text-sm")}>Sales Chart</span>
                <ArrowRight className="w-3 h-3 text-green-500/60 group-hover:text-green-400 transition-colors" />
              </div>
              {<p className="text-[10px] md:text-xs text-green-300/60 leading-snug">Revenue trend &amp; year-over-year comparison</p>}
            </button>
            <button
              onClick={() => onDrawerChange?.('platform-perf')}
              data-testid="tool-platform-performance"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-orange-400/72 bg-gradient-to-br from-orange-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", "p-3")}
              style={{ '--tool-glow-color': 'rgba(249,115,22,0.35)' } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-orange-800/75 p-1.5 ring-1 ring-orange-400/65 shadow-[0_0_10px_rgba(249,115,22,0.22)]">
                  <BarChart2 className={cn("w-3.5 h-3.5 text-orange-200", "md:w-5 md:h-5 lg:w-4 lg:h-4")} />
                </div>
                <span className={cn("text-xs font-bold text-orange-100 leading-tight flex-1", "md:text-sm")}>Platform Performance</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <span role="button" onClick={(e) => e.stopPropagation()} className="text-orange-600/60 hover:text-orange-400 transition-colors" data-testid="info-platform-performance">
                      <Info className="w-3 h-3" />
                    </span>
                  </PopoverTrigger>
                  <PopoverContent side="top" className="w-64 text-xs text-gray-300 bg-gray-900 border-gray-700 p-2.5">
                    Breakdown of sales by marketplace — order counts, revenue, and channel share for the selected date range.
                  </PopoverContent>
                </Popover>
              </div>
              {(
              <div className="flex flex-wrap gap-1 min-h-[1.25rem] justify-end">
                {availablePlatforms.length > 0 ? (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-600/30">
                    {availablePlatforms.length} active {availablePlatforms.length === 1 ? 'platform' : 'platforms'}
                  </span>
                ) : (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-600/25">
                    No data
                  </span>
                )}
              </div>
              )}
              {(
              <div className="flex items-center justify-between">
                <span className="text-[10px] md:text-xs text-orange-300 font-medium">Open tool</span>
                <ArrowRight className="w-3 h-3 md:w-4 md:h-4 text-orange-400/70 group-hover:text-orange-200 transition-colors" />
              </div>
              )}
            </button>
            <button
              onClick={() => onDrawerChange?.('acquisition-evaluator')}
              data-testid="tool-acquisition-evaluator"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-violet-400/72 bg-gradient-to-br from-violet-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", "p-3")}
              style={{ '--tool-glow-color': 'rgba(139,92,246,0.35)' } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-violet-800/75 p-1.5 ring-1 ring-violet-400/65 shadow-[0_0_10px_rgba(139,92,246,0.22)]">
                  <Package className={cn("w-3.5 h-3.5 text-violet-200", "md:w-5 md:h-5 lg:w-4 lg:h-4")} />
                </div>
                <span className={cn("text-xs font-bold text-violet-100 leading-tight flex-1", "md:text-sm")}>Acquisition Evaluator</span>
                <ArrowRight className="w-3 h-3 text-violet-500/60 group-hover:text-violet-400 transition-colors" />
              </div>
              <p className="text-[10px] md:text-xs text-violet-300/60 leading-snug">Analyze a seller's inventory against your stock</p>
            </button>
          </div>
        </div>
      </>}

      {/* ── Platform Orders Drawer ── */}
      <PlatformOrdersDrawer
        open={platformDrawer.open}
        onClose={() => setPlatformDrawer({ open: false, platform: '', productLine: undefined })}
        platform={platformDrawer.platform}
        orders={platformOrders}
        onOrderClick={(orderId) => onItemClick?.('order', orderId)}
      />
    </div>
  );
}


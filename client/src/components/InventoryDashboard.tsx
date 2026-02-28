import { useState } from "react";
import MetricCard from "./MetricCard";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { InfoIcon, AlertCircle, Package, TrendingUp, Clock, Sparkles, Warehouse, RefreshCw, Info, Square, BarChart2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import PriceOMaticDashboard from "./PriceOMaticDashboard";
import WarehouseManagement from "./WarehouseManagement";
import PlatformSyncTool from "./PlatformSyncTool";

interface InventoryStats {
  totalLots: number;
  totalParts: number;
  totalValue: number;
  totalCost: number;
  totalColors: number;
  totalCategories: number;
}

interface InventoryItem {
  id: number;
  inventoryId: number;
  quantity: number;
  unitPrice: string;
  colorName: string;
  item: {
    no: string;
    name: string;
  };
}

interface RecentInventoryItem {
  id: number;
  inventoryId: number;
  itemNo: string;
  itemName: string | null;
  colorId: number | null;
  colorName: string | null;
  colorRgb: string | null;
  quantity: number;
  unitPrice: string | null;
  newOrUsed: string;
  syncedAt: string;
  updatedAt: string;
}

// ── API Call Schedule Chart ────────────────────────────────────────────────
interface ApiCallScheduleProps {
  buckets: { hourStart: string; rollsOffAt: string; calls: number }[];
  callsLast24h: number;
  ceiling: number;
  timezone?: string;
}

function ApiCallSchedule({ buckets, callsLast24h, ceiling, timezone = 'America/Chicago' }: ApiCallScheduleProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const availableNow = Math.max(0, ceiling - callsLast24h);
  const pct = Math.min(callsLast24h / ceiling, 1);
  const maxCalls = Math.max(...buckets.map(b => b.calls), 1);

  // Sort non-empty buckets by rolloff time to build the cumulative schedule
  const rolloffEvents = [...buckets]
    .filter(b => b.calls > 0)
    .sort((a, b) => new Date(a.rollsOffAt).getTime() - new Date(b.rollsOffAt).getTime());

  let cumFreed = 0;
  const schedule = rolloffEvents.map((b, idx) => {
    cumFreed += b.calls;
    const availableAfter = Math.min(ceiling, availableNow + cumFreed);
    const prevAvail = idx === 0 ? availableNow : Math.min(ceiling, availableNow + (cumFreed - b.calls));
    return { ...b, freed: b.calls, availableAfter, isFirstFull: availableAfter >= ceiling && prevAvail < ceiling };
  });

  const fullRestoreRow = schedule.find(s => s.isFirstFull);

  // Human-readable time in the configured timezone
  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    const tz = timezone;
    const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', timeZone: tz };
    const time = d.toLocaleTimeString([], opts);
    // Compute today/tomorrow in the user's timezone
    const nowStr = new Date().toLocaleDateString('en-US', { timeZone: tz });
    const tomorrowDate = new Date(Date.now() + 86400000);
    const tomorrowStr = tomorrowDate.toLocaleDateString('en-US', { timeZone: tz });
    const dStr = d.toLocaleDateString('en-US', { timeZone: tz });
    if (dStr === nowStr) return time;
    if (dStr === tomorrowStr) return `${time} tomorrow`;
    return `${time} ${d.toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: tz })}`;
  };

  const fmtAxisTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: timezone });

  const progressColor = pct >= 0.9 ? 'bg-red-500' : pct >= 0.6 ? 'bg-orange-500' : 'bg-blue-500';

  const barColor = (calls: number) => {
    if (calls === 0) return 'bg-gray-700/50';
    if (calls < ceiling * 0.1) return 'bg-blue-500/70';
    if (calls < ceiling * 0.3) return 'bg-orange-500/70';
    return 'bg-red-500/70';
  };

  const availColor = (avail: number) => {
    const r = avail / ceiling;
    if (r >= 0.9) return 'text-emerald-400';
    if (r >= 0.5) return 'text-blue-400';
    if (r >= 0.25) return 'text-orange-400';
    return 'text-gray-400';
  };

  const hovered = hoveredIdx !== null ? buckets[hoveredIdx] : null;

  return (
    <div className="space-y-3">

      {/* Header: free now + when full quota returns */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-gray-200">API Quota — Rolling 24h</div>
          <div className="text-[11px] mt-0.5">
            <span className={pct >= 0.9 ? 'text-red-400' : pct >= 0.6 ? 'text-orange-400' : 'text-emerald-400'}>
              {availableNow.toLocaleString()} free now
            </span>
            <span className="text-gray-600"> · {callsLast24h.toLocaleString()}/{ceiling.toLocaleString()} used</span>
          </div>
        </div>
        {fullRestoreRow ? (
          <div className="text-right flex-shrink-0">
            <div className="text-[9px] text-gray-500 uppercase tracking-wide">Full quota at</div>
            <div className="text-[11px] font-semibold text-emerald-400 leading-tight">{fmtTime(fullRestoreRow.rollsOffAt)}</div>
          </div>
        ) : availableNow >= ceiling ? (
          <span className="text-[11px] text-emerald-400 font-semibold flex-shrink-0">Full quota</span>
        ) : null}
      </div>

      {/* Quota usage bar */}
      <div className="h-1.5 w-full rounded-full bg-gray-700">
        <div className={`h-full rounded-full transition-all ${progressColor}`} style={{ width: `${pct * 100}%` }} />
      </div>

      {/* 24-hour history chart */}
      <div>
        <div className="text-[9px] text-gray-600 uppercase tracking-wide mb-1">Call History (last 24h)</div>
        <div className="flex items-end gap-px h-10" onMouseLeave={() => setHoveredIdx(null)}>
          {buckets.map((b, i) => {
            const height = b.calls === 0 ? 2 : Math.max(3, Math.round((b.calls / maxCalls) * 40));
            return (
              <div
                key={b.hourStart}
                className="flex-1 flex flex-col justify-end cursor-default"
                onMouseEnter={() => setHoveredIdx(i)}
              >
                <div
                  className={`w-full rounded-sm ${barColor(b.calls)} ${hoveredIdx === i ? 'opacity-100 ring-1 ring-white/20' : 'opacity-75'}`}
                  style={{ height: `${height}px` }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[9px] text-gray-600 font-mono mt-0.5">
          {[0, 6, 12, 18, 23].map(i => (
            <span key={i}>{buckets[i] ? fmtAxisTime(buckets[i].hourStart) : ''}</span>
          ))}
        </div>
        {hovered && hovered.calls > 0 && (
          <div className="text-[10px] text-gray-400 mt-1 font-mono leading-tight">
            {fmtAxisTime(hovered.hourStart)}: <span className="text-gray-200">{hovered.calls.toLocaleString()} calls</span>
            {' '}· frees at <span className="text-gray-200">{fmtTime(hovered.rollsOffAt)}</span>
          </div>
        )}
        {hovered && hovered.calls === 0 && (
          <div className="text-[10px] text-gray-600 mt-1">No calls this hour</div>
        )}
      </div>

      {/* Cumulative capacity recovery schedule */}
      {schedule.length > 0 && (
        <div>
          <div className="text-[9px] text-gray-500 uppercase tracking-wide mb-1.5">
            Capacity Recovery Schedule
          </div>
          <div className="space-y-px pr-0.5">
            {/* Show current available as first row for context */}
            <div className="relative rounded px-2 py-1 bg-gray-800/60">
              <div className="relative flex items-center justify-between gap-2">
                <span className="text-[11px] text-gray-500">Now</span>
                <span className={`text-[11px] font-mono font-semibold ${availColor(availableNow)}`}>
                  {availableNow.toLocaleString()} free
                </span>
              </div>
            </div>
            {schedule.map((s) => {
              const availRatio = s.availableAfter / ceiling;
              return (
                <div
                  key={s.hourStart}
                  className={`relative rounded overflow-hidden px-2 py-1 ${s.isFirstFull ? 'ring-1 ring-emerald-500/50' : ''}`}
                  style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
                >
                  {/* Filled background bar shows relative capacity */}
                  <div
                    className="absolute left-0 top-0 bottom-0 rounded-sm pointer-events-none"
                    style={{
                      width: `${Math.min(availRatio * 100, 100)}%`,
                      backgroundColor: availRatio >= 0.9 ? 'rgba(16,185,129,0.12)' : availRatio >= 0.5 ? 'rgba(59,130,246,0.12)' : 'rgba(249,115,22,0.10)',
                    }}
                  />
                  <div className="relative flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[11px] text-gray-300">{fmtTime(s.rollsOffAt)}</span>
                      {s.isFirstFull && (
                        <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wide">Full</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-gray-600 font-mono">+{s.freed.toLocaleString()}</span>
                      <span className={`text-[11px] font-mono font-semibold w-16 text-right ${availColor(s.availableAfter)}`}>
                        {s.availableAfter.toLocaleString()} free
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {schedule.length === 0 && availableNow >= ceiling && (
        <div className="text-[11px] text-emerald-400 text-center py-1">
          Full quota available — ready to run anytime.
        </div>
      )}
    </div>
  );
}
// ──────────────────────────────────────────────────────────────────────────────

interface InventoryDashboardProps {
  onItemClick?: (type: 'order' | 'inventory', id: number | string, initialTab?: string) => void;
  activeDrawer: 'priceomatic' | 'warehouse' | 'platformsync' | null;
  onDrawerChange: (drawer: 'priceomatic' | 'warehouse' | 'platformsync' | null) => void;
}

export default function InventoryDashboard({ onItemClick, activeDrawer, onDrawerChange }: InventoryDashboardProps) {
  const { toast } = useToast();

  // POM sync state lifted here so buttons live in the header row
  const { data: pomSyncStatus } = useQuery<{
    success: boolean;
    data: {
      lastSyncStatus: string;
      callsLast24h?: number;
      oldestCallTime?: string | null;
      newestCallTime?: string | null;
      hourlyBuckets?: { hourStart: string; rollsOffAt: string; calls: number }[];
      liveProgress?: { active: boolean; itemsProcessed: number; itemsTotal: number; apiCallsAtStart: number };
    };
  }>({
    queryKey: ['/api/sync/priceomatic/status'],
    refetchInterval: activeDrawer === 'priceomatic' ? 3000 : false,
    staleTime: 0, // always refetch on interval — overrides global staleTime: Infinity
  });
  const pomStatus = pomSyncStatus?.data;
  const isPomSyncRunning = pomStatus?.lastSyncStatus === 'in_progress';
  const apiCeiling = 4500;

  const { data: appSettings } = useQuery<{ timezone?: string }>({
    queryKey: ['/api/settings'],
    staleTime: 60000,
  });
  const configuredTimezone = appSettings?.timezone || 'America/Chicago';

  const pomSyncMutation = useMutation({
    mutationFn: async () => apiRequest('POST', '/api/sync/priceomatic', {}),
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ['/api/sync/priceomatic/status'] });
      queryClient.refetchQueries({ queryKey: ['/api/priceomatic/insights'] });
      toast({ title: "Sync Started", description: "Price analysis running in background" });
    },
    onError: (error: Error) => {
      toast({ title: "Sync Failed", description: error.message, variant: "destructive" });
    },
  });

  const pomStopMutation = useMutation({
    mutationFn: async () => apiRequest('POST', '/api/sync/priceomatic/stop', {}),
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ['/api/sync/priceomatic/status'] });
      toast({ title: "Stop Signal Sent", description: "Sync will halt before the next item." });
    },
    onError: (error: Error) => {
      toast({ title: "Stop Failed", description: error.message, variant: "destructive" });
    },
  });

  const { data: stats, isLoading } = useQuery<InventoryStats>({
    queryKey: ['/api/inventory/stats'],
  });

  // Fetch top value items
  const { data: topValueItems = [] } = useQuery<InventoryItem[]>({
    queryKey: ['/api/inventory', 'top-value'],
    select: (data: InventoryItem[]) => 
      data
        .filter(item => item.unitPrice && !isNaN(Number(item.unitPrice)))
        .sort((a, b) => Number(b.unitPrice) - Number(a.unitPrice))
        .slice(0, 6)
  });

  // Fetch newly added items
  const { data: newItems = [] } = useQuery<RecentInventoryItem[]>({
    queryKey: ['/api/inventory/recent-updates', 'new'],
    queryFn: async () => {
      const response = await fetch('/api/inventory/recent-updates?type=new&limit=4');
      if (!response.ok) throw new Error('Failed to fetch new items');
      return response.json();
    }
  });

  // Fetch recently updated items
  const { data: updatedItems = [] } = useQuery<RecentInventoryItem[]>({
    queryKey: ['/api/inventory/recent-updates', 'updated'],
    queryFn: async () => {
      const response = await fetch('/api/inventory/recent-updates?type=updated&limit=4');
      if (!response.ok) throw new Error('Failed to fetch updated items');
      return response.json();
    }
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('en-US').format(value);
  };

  const safeFormatDate = (dateString: string | null | undefined): string => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'N/A';
    return formatDistanceToNow(date, { addSuffix: true });
  };

  const profitPotential = stats ? stats.totalValue - stats.totalCost : 0;

  if (isLoading) {
    return (
      <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-blue/5 to-transparent rounded-lg border border-lego-blue/10 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
        <div className="flex items-center justify-center py-8">
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-lego-blue border-t-transparent" data-testid="loading-spinner"></div>
            <p className="text-xs text-gray-500">Loading inventory stats...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-blue/5 to-transparent rounded-lg border border-lego-blue/10 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
      <div className="space-y-1.5">
        <div className="bg-gray-900/50 border border-blue-500/20 rounded-lg p-3" data-testid="section-inventory-info">
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-blue-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-blue-400 uppercase tracking-wide">Inventory Info</h3>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            <MetricCard label="Lots" value={stats ? formatNumber(stats.totalLots) : '0'} color="blue" data-testid="metric-lots" />
            <MetricCard label="Parts" value={stats ? formatNumber(stats.totalParts) : '0'} color="blue" data-testid="metric-parts" />
            <MetricCard label="Colors" value={stats ? formatNumber(stats.totalColors) : '0'} color="blue" data-testid="metric-colors" />
            <MetricCard label="Categories" value={stats ? formatNumber(stats.totalCategories) : '0'} color="blue" data-testid="metric-categories" />
          </div>
        </div>

        <div className="bg-gray-900/50 border border-cyan-500/20 rounded-lg p-3" data-testid="section-values">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-cyan-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-cyan-400 uppercase tracking-wide">Values</h3>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="text-gray-500 hover:text-gray-400" data-testid="button-cost-info">
                  <InfoIcon className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-xs">
                  <strong>My Cost</strong> tracking is not available via BrickLink's API. 
                  To track costs, you'll need to manually add them in this app. 
                  (Cost tracking feature coming soon!)
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <MetricCard label="My Cost" value={stats ? formatCurrency(stats.totalCost) : '$0.00'} color="red" data-testid="metric-cost" />
            <MetricCard label="Listed" value={stats ? formatCurrency(stats.totalValue) : '$0.00'} color="blue" data-testid="metric-listed" />
            <MetricCard label="Profit Potential" value={formatCurrency(profitPotential)} color="green" data-testid="metric-profit" />
          </div>
        </div>

        {/* Highlights - Top Value Items */}
        <div className="bg-gray-900/50 border border-green-500/20 rounded-lg p-3 md:p-4" data-testid="section-top-value">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-green-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-green-400 uppercase tracking-wide">Highlights - Highest Value Items</h3>
          </div>
          <div className="space-y-1.5">
            {topValueItems.length > 0 ? (
              topValueItems.map((item) => (
                <div 
                  key={item.id} 
                  onClick={() => onItemClick?.('inventory', item.inventoryId)}
                  className="flex justify-between items-start hover-elevate rounded px-2 py-1 cursor-pointer"
                  data-testid={`top-value-${item.id}`}
                >
                  <div className="flex gap-2 flex-1 min-w-0">
                    <TrendingUp className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-green-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-gray-200 font-mono text-xs md:text-base lg:text-lg font-medium">
                        {item.item.no}
                      </div>
                      <div className="flex gap-1.5 text-[11px] md:text-sm lg:text-base text-gray-400 mt-0.5">
                        <span>{item.colorName}</span>
                        <span>•</span>
                        <span>Qty: {item.quantity}</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-lego-green font-mono font-medium text-xs md:text-base lg:text-lg ml-2 flex-shrink-0">@${Number(item.unitPrice).toFixed(2)}</span>
                </div>
              ))
            ) : (
              <div className="text-[11px] text-gray-500 italic">No items to display</div>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-gray-900/50 border border-blue-500/20 rounded-lg p-3 md:p-4" data-testid="section-recent-updates">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-blue-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-blue-400 uppercase tracking-wide">Recent Activity</h3>
          </div>
          
          {newItems.length > 0 || updatedItems.length > 0 ? (
            <div className="space-y-3">
              {/* Newly Added Items */}
              {newItems.length > 0 && (
                <div>
                  <h4 className="text-[9px] md:text-xs font-bold text-gray-500 uppercase mb-1.5 tracking-wide">New Items</h4>
                  <div className="space-y-1">
                    {newItems.map((item) => (
                      <div 
                        key={item.id} 
                        onClick={() => onItemClick?.('inventory', item.inventoryId)}
                        className="flex justify-between items-start hover-elevate rounded px-2 py-1 cursor-pointer"
                        data-testid={`new-item-${item.id}`}
                      >
                        <div className="flex gap-2 flex-1 min-w-0">
                          <Package className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-green-400 flex-shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="text-gray-200 truncate text-xs md:text-base lg:text-lg font-medium">
                              {item.itemNo} {item.itemName && `- ${item.itemName}`}
                            </div>
                            <div className="flex gap-1.5 text-[11px] md:text-sm lg:text-base text-gray-400 mt-0.5">
                              <span>{item.colorName || 'N/A'}</span>
                              <span>•</span>
                              <span>{item.newOrUsed === 'N' ? 'New' : 'Used'}</span>
                              <span>•</span>
                              <span>{safeFormatDate(item.syncedAt)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Updated Items */}
              {updatedItems.length > 0 && (
                <div>
                  <h4 className="text-[9px] md:text-xs font-bold text-gray-500 uppercase mb-1.5 tracking-wide">Updated Items</h4>
                  <div className="space-y-1">
                    {updatedItems.map((item) => (
                      <div 
                        key={item.id} 
                        onClick={() => onItemClick?.('inventory', item.inventoryId)}
                        className="flex justify-between items-start hover-elevate rounded px-2 py-1 cursor-pointer"
                        data-testid={`recent-update-${item.id}`}
                      >
                        <div className="flex gap-2 flex-1 min-w-0">
                          <div className="w-2.5 h-2.5 md:w-3 md:h-3 lg:w-3.5 lg:h-3.5 rounded-full bg-blue-400 flex-shrink-0 mt-1" />
                          <div className="flex-1 min-w-0">
                            <div className="text-gray-200 truncate text-xs md:text-base lg:text-lg font-medium">
                              {item.itemNo} {item.itemName && `- ${item.itemName}`}
                            </div>
                            <div className="flex gap-1.5 text-[11px] md:text-sm lg:text-base text-gray-400 mt-0.5">
                              <span>{item.colorName || 'N/A'}</span>
                              <span>•</span>
                              <span>{item.newOrUsed === 'N' ? 'New' : 'Used'}</span>
                              <span>•</span>
                              <span>{safeFormatDate(item.updatedAt)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[9px] md:text-xs text-gray-500 italic">No recent activity</div>
          )}
        </div>
      </div>

      {/* Price-O-Matic Drawer */}
      <Drawer open={activeDrawer === 'priceomatic'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[92dvh] flex flex-col">
          <DrawerHeader>
            <DrawerTitle className="flex items-center justify-between gap-2 text-base md:text-lg">
              {/* Left: title + info inline */}
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-5 h-5 text-purple-400 flex-shrink-0" />
                <span>Price-o-Matic</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="icon" variant="ghost" className="w-6 h-6" data-testid="button-pom-info">
                      <Info className="w-3.5 h-3.5 text-gray-500" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent side="bottom" align="start" className="w-80 bg-gray-900 border-gray-700 p-3">
                    <h3 className="text-xs font-bold text-purple-400 mb-2">How It Works</h3>
                    <ul className="text-xs text-gray-300 space-y-1.5">
                      <li>• Fetches item details, avg listed price + <strong className="text-purple-300">85th-percentile sold price</strong> from BrickLink — 3 API calls per item.</li>
                      <li>• Applies your premium formula (Settings) to compute a suggested price, then applies cost floor and minimum price if configured.</li>
                      <li>• Items priced <strong className="text-red-300">too high</strong> are losing sales; <strong className="text-orange-300">too low</strong> are leaving margin on the table.</li>
                      <li>• Stops automatically at the daily API call ceiling to preserve your quota.</li>
                      <li>• Items with 0 stock are skipped. Formula changes apply instantly.</li>
                    </ul>
                    <p className="text-[10px] text-gray-500 pt-2 mt-2 border-t border-gray-700">Does not auto-reprice. You review each flag and decide what to change.</p>
                  </PopoverContent>
                </Popover>
              </div>
              {/* Right: stop (if running) + sync with badge */}
              <div className="flex items-center gap-1">
                {isPomSyncRunning && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={() => pomStopMutation.mutate()} disabled={pomStopMutation.isPending} size="icon" variant="destructive" data-testid="button-stop-sync">
                        <Square className="w-3.5 h-3.5 fill-current" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      {pomStopMutation.isPending ? 'Stopping...' : 'Stop Sync'}
                    </TooltipContent>
                  </Tooltip>
                )}
                {/* API schedule popover */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="icon" variant="ghost" data-testid="button-api-schedule" className="relative">
                      <BarChart2 className="w-4 h-4 text-gray-500" />
                      {pomStatus?.callsLast24h !== undefined && (
                        <span className={`absolute -top-1 -right-1 text-[9px] font-mono font-bold px-1 py-0.5 rounded-full leading-none pointer-events-none ${
                          pomStatus.callsLast24h >= apiCeiling * 0.9 ? 'bg-red-500/20 text-red-400' :
                          pomStatus.callsLast24h >= apiCeiling * 0.6 ? 'bg-orange-500/20 text-orange-400' :
                          'bg-gray-700 text-gray-400'
                        }`}>
                          {pomStatus.callsLast24h >= 1000
                            ? `${(pomStatus.callsLast24h / 1000).toFixed(1)}k`
                            : pomStatus.callsLast24h}
                        </span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent side="bottom" align="end" className="w-96 p-3 max-h-[80vh] overflow-y-auto">
                    <ApiCallSchedule
                      buckets={pomStatus?.hourlyBuckets ?? []}
                      callsLast24h={pomStatus?.callsLast24h ?? 0}
                      ceiling={apiCeiling}
                      timezone={configuredTimezone}
                    />
                  </PopoverContent>
                </Popover>
                {/* Sync button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={() => pomSyncMutation.mutate()} disabled={isPomSyncRunning || pomSyncMutation.isPending} size="icon" variant="ghost" data-testid="button-sync">
                      <RefreshCw className={`w-4 h-4 text-gray-500 ${pomSyncMutation.isPending ? 'animate-spin' : ''}`} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {isPomSyncRunning ? 'Syncing in progress...' : 'Run Price-o-Matic Sync'}
                  </TooltipContent>
                </Tooltip>
              </div>
            </DrawerTitle>
          </DrawerHeader>

          {/* Live sync progress — shown only when a sync is running */}
          {isPomSyncRunning && (() => {
            const lp = pomStatus?.liveProgress;
            const itemsProcessed = lp?.itemsProcessed ?? 0;
            const itemsTotal = lp?.itemsTotal ?? 0;
            const callsNow = pomStatus?.callsLast24h ?? 0;
            const callsAtStart = lp?.apiCallsAtStart ?? callsNow;
            const callsThisRun = Math.max(0, callsNow - callsAtStart);
            const itemPct = itemsTotal > 0 ? Math.min(100, (itemsProcessed / itemsTotal) * 100) : 0;
            const callPct = Math.min(100, (callsNow / apiCeiling) * 100);
            return (
              <div className="px-4 pb-3 space-y-2 border-b border-gray-700/50" data-testid="pom-sync-progress">
                {/* Items progress */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-gray-400">Items synced</span>
                    <span className="text-[11px] font-mono text-purple-300">
                      {itemsProcessed.toLocaleString()}{itemsTotal > 0 ? ` / ${itemsTotal.toLocaleString()}` : ''}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500 rounded-full transition-all duration-500"
                      style={{ width: `${itemPct}%` }}
                    />
                  </div>
                </div>
                {/* API calls progress */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-gray-400">API calls today</span>
                    <span className={`text-[11px] font-mono ${
                      callPct >= 90 ? 'text-red-400' : callPct >= 60 ? 'text-orange-400' : 'text-gray-300'
                    }`}>
                      {callsNow.toLocaleString()} / {apiCeiling.toLocaleString()}
                      {callsThisRun > 0 && <span className="text-gray-500 ml-1">(+{callsThisRun.toLocaleString()} this run)</span>}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        callPct >= 90 ? 'bg-red-500' : callPct >= 60 ? 'bg-orange-400' : 'bg-green-500'
                      }`}
                      style={{ width: `${callPct}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="overflow-y-auto px-4 pb-4 flex-1">
            <PriceOMaticDashboard onItemClick={(type, id) => onItemClick?.(type, id, 'pricing')} isSyncRunning={isPomSyncRunning} />
          </div>
        </DrawerContent>
      </Drawer>

      {/* Warehouse Management Drawer */}
      <Drawer open={activeDrawer === 'warehouse'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[90vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2 text-base md:text-lg">
              <Warehouse className="w-5 h-5 text-blue-400" />
              Warehouse Management
            </DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-4 flex-1">
            <WarehouseManagement onItemClick={onItemClick} />
          </div>
        </DrawerContent>
      </Drawer>

      {/* Platform Sync Drawer */}
      <Drawer open={activeDrawer === 'platformsync'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[90vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2 text-base md:text-lg">
              <RefreshCw className="w-5 h-5 text-purple-400" />
              Sync Inventory
            </DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-4 flex-1">
            <PlatformSyncTool />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

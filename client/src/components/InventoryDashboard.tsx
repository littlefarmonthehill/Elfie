import { useState, useRef, useEffect, ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { InfoIcon, Package, Sparkles, ScanSearch, Globe, ChevronLeft, ChevronRight, Search, X, Activity, Link, ArrowRight, Layers } from "lucide-react";
import ChannelSyncPanel from "./ChannelSyncPanel";
import BrickLinkSyncPanel from "./BrickLinkSyncPanel";
import InventoryHealthPanel from "./InventoryHealthPanel";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface InventoryStats {
  totalLots: number;
  totalParts: number;
  totalValue: number;
  totalCost: number;
  totalColors: number;
  totalCategories: number;
}

interface InventoryDashboardProps {
  onItemClick?: (type: 'order' | 'inventory', id: number | string, initialTab?: string) => void;
  activeDrawer: 'priceomatic' | 'platformsync' | 'brickanalyzer' | 'inventoryhealth' | 'bricklinksync' | `channelsync-${string}` | 'bulkinator' | null;
  onDrawerChange: (drawer: 'priceomatic' | 'platformsync' | 'brickanalyzer' | 'inventoryhealth' | 'bricklinksync' | `channelsync-${string}` | 'bulkinator' | null) => void;
  onOpenSettings?: (section?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'billing' | 'priceomatic', focusTarget?: 'channelSync' | 'schedulerInventory' | 'schedulerOrders' | 'schedulerChannel') => void;
  desktopMode?: boolean;
  onBrowseOpen?: (type: 'lots' | 'parts' | 'categories') => void;
}

type BrowseType = 'lots' | 'parts' | 'categories';

type InvSyncChannel = 'brickowl';

const CHANNEL_SYNC_KEYS: InvSyncChannel[] = ['brickowl'];

const CHANNEL_SYNC_CONFIG: Record<InvSyncChannel, {
  label: string;
  Icon: ComponentType<{ className?: string }>;
  sidebar: {
    activeButton: string;
    idleButton: string;
    activeIcon: string;
    idleIcon: string;
    iconColor: string;
    labelColor: string;
    activeArrow: string;
  };
}> = {
  brickowl: {
    label: 'BrickOwl',
    Icon: Globe,
    sidebar: {
      activeButton: 'border-green-400/70 bg-green-900/50 shadow-[0_0_10px_rgba(34,197,94,0.2)]',
      idleButton: 'border-green-500/30 bg-green-950/30',
      activeIcon: 'bg-green-800/70 ring-green-400/60',
      idleIcon: 'bg-green-900/60 ring-green-500/40',
      iconColor: 'text-green-300',
      labelColor: 'text-green-100',
      activeArrow: 'text-green-400',
    },
  },
};

function RetroTogglePin({ active, onClick, label, testId }: {
  active: boolean;
  onClick: () => void;
  label: string;
  testId: string;
}) {
  return (
    <button onClick={onClick} data-testid={testId} className="flex flex-col items-center gap-1.5 select-none">
      {/* Bezel ring */}
      <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-200 ${
        active
          ? 'border-green-500/70 bg-gray-900 shadow-[0_0_10px_rgba(34,197,94,0.45),0_0_22px_rgba(34,197,94,0.18)]'
          : 'border-gray-600 bg-gray-900 shadow-[0_2px_5px_rgba(0,0,0,0.5)]'
      }`}>
        {/* Button cap */}
        <div className={`w-6 h-6 rounded-full transition-all duration-200 ${
          active
            ? 'bg-green-500 translate-y-px shadow-[inset_0_2px_4px_rgba(0,0,0,0.35),0_0_6px_rgba(34,197,94,0.7)]'
            : 'bg-gray-600 -translate-y-px shadow-[0_2px_4px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.12)]'
        }`} />
      </div>
      {/* Label */}
      <span className={`text-[10px] font-medium transition-colors duration-200 ${
        active ? 'text-green-300' : 'text-gray-500'
      }`}>{label}</span>
    </button>
  );
}

export default function InventoryDashboard({ onItemClick, activeDrawer, onDrawerChange, onOpenSettings, desktopMode, onBrowseOpen }: InventoryDashboardProps) {

  const { toast } = useToast();

  const [mobileInvChannel, setMobileInvChannel] = useState<string>('bricklink');
  const [browseDrawer, setBrowseDrawer] = useState<BrowseType | null>(null);
  const [browseVisible, setBrowseVisible] = useState(false);
  const [browsePage, setBrowsePage] = useState(0);
  const [browseSearch, setBrowseSearch] = useState('');
  const [browseSearchInput, setBrowseSearchInput] = useState('');

  const openBrowse = (type: BrowseType) => {
    setBrowseDrawer(type);
    setBrowseSearchInput('');
    requestAnimationFrame(() => requestAnimationFrame(() => setBrowseVisible(true)));
  };
  const closeBrowse = () => {
    setBrowseVisible(false);
    setTimeout(() => setBrowseDrawer(null), 320);
  };

  // Swipe-down to dismiss
  const swipeStartY = useRef(0);
  const swipeDelta = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const onTouchStart = (e: React.TouchEvent) => { swipeStartY.current = e.touches[0].clientY; swipeDelta.current = 0; };
  const onTouchMove = (e: React.TouchEvent) => {
    const dy = e.touches[0].clientY - swipeStartY.current;
    if (dy > 0) { swipeDelta.current = dy; if (panelRef.current) panelRef.current.style.transform = `translateY(${dy}px)`; }
  };
  const onTouchEnd = () => {
    if (panelRef.current) panelRef.current.style.transform = '';
    if (swipeDelta.current > 80) closeBrowse();
  };

  useEffect(() => {
    const t = setTimeout(() => setBrowseSearch(browseSearchInput), 350);
    return () => clearTimeout(t);
  }, [browseSearchInput]);

  useEffect(() => {
    setBrowsePage(0);
  }, [browseSearch, browseDrawer]);


  const { data: appSettings } = useQuery<{ timezone?: string }>({
    queryKey: ['/api/settings'],
    staleTime: 60000,
  });
  const configuredTimezone = appSettings?.timezone || 'America/Chicago';

  const { data: stats, isLoading } = useQuery<InventoryStats>({
    queryKey: ['/api/inventory/stats'],
  });

  const { data: toolStats } = useQuery<{ warehouseUnassigned: number; binsNotOnShelves: number; shelvesNotInAisles: number; pendingScans: number }>({
    queryKey: ['/api/inventory/tool-stats'],
    staleTime: 2 * 60 * 1000,
  });

  const { data: pomInsights } = useQuery<{
    data: {
      tooHigh: any[]; tooLow: any[]; wellPriced: any[];
      summary: { total: number; tooHigh: number; tooLow: number; wellPriced: number };
    };
  }>({
    queryKey: ['/api/priceomatic/insights'],
    staleTime: 10 * 60 * 1000,
  });

  const { data: browseData, isLoading: browseLoading } = useQuery<{
    rows: any[];
    total: number;
    page: number;
    limit: number;
  }>({
    queryKey: ['/api/inventory/browse', browseDrawer, browsePage, browseSearch],
    queryFn: () => {
      if (!browseDrawer) return Promise.resolve({ rows: [], total: 0, page: 0, limit: 100 });
      const params = new URLSearchParams({ type: browseDrawer, page: String(browsePage), search: browseSearch });
      return fetch(`/api/inventory/browse?${params}`).then(r => r.json());
    },
    enabled: !!browseDrawer,
    staleTime: 30000,
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

  const soldAvgValue = stats?.soldAvgValue ?? 0;

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
        <div className={cn("bg-gradient-to-br from-lego-blue/10 to-lego-blue/3 rounded-lg border border-lego-blue/35 shadow-[0_0_22px_rgba(59,130,246,0.18)] p-2 space-y-3")}>
      <div className={cn("space-y-3")}>

        {/* Combined Inventory Info + Values */}
        <div
          className="relative rounded-lg border border-blue-400/65 shadow-[0_0_30px_rgba(59,130,246,0.28)] overflow-hidden p-3"
          style={{ background: 'linear-gradient(175deg, #0f2240 0%, #0a1630 100%)' }}
          data-testid="section-inventory-overview"
        >
          {/* Top shine line */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-300/90 to-transparent" />

          {/* Header */}
          <div className="flex items-center gap-2.5 mb-3">
            <div className="p-1.5 rounded-lg bg-blue-800/70 ring-1 ring-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.32)]">
              <Package className="w-4 h-4 md:w-5 md:h-5 lg:w-4 lg:h-4 text-blue-100" />
            </div>
            <h3 className="text-sm font-bold text-white uppercase tracking-widest">Inventory</h3>
            <div className="ml-auto">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-gray-600 hover:text-gray-400 transition-colors" data-testid="button-cost-info">
                    <InfoIcon className="h-3.5 w-3.5" />
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
          </div>

          {/* Top row: Lots, Parts, Categories */}
          <div className="grid grid-cols-3 gap-2 mb-2" data-testid="section-inventory-info">
            {([
              { key: 'lots', label: 'Lots', value: stats ? formatNumber(stats.totalLots) : '—' },
              { key: 'parts', label: 'Parts', value: stats ? formatNumber(stats.totalParts) : '—' },
              { key: 'categories', label: 'Categories', value: stats ? formatNumber(stats.totalCategories) : '—' },
            ] as const).map(({ key, label, value }) => (
              <button
                key={key}
                onClick={() => desktopMode && onBrowseOpen ? onBrowseOpen(key) : openBrowse(key)}
                data-testid={`metric-${key}`}
                className="relative group flex flex-col text-left hover-elevate active-elevate-2 rounded-lg border border-blue-500/55 bg-[#0e2245]/88 p-2.5 md:p-3"
              >
                <span className="text-[9px] md:text-[10px] text-gray-400 mb-1 leading-tight">{label}</span>
                <span className="text-base md:text-xl font-bold font-mono text-lego-blue leading-none">{value}</span>
                <span className="absolute top-2 right-2 flex items-center justify-center w-5 h-5 rounded-full bg-lego-blue/20 group-hover:bg-lego-blue/40 transition-colors">
                  <ChevronRight className="w-3 h-3 text-white" />
                </span>
              </button>
            ))}
          </div>

          {/* Bottom row: My Cost, Listed, Profit Potential */}
          <div className="grid grid-cols-3 gap-2" data-testid="section-values">
            <div className="rounded-lg border border-red-400/65 bg-[#1a0e14]/90 p-2.5 md:p-3" data-testid="metric-cost">
              <div className="text-[9px] md:text-[10px] text-gray-200 mb-1 leading-tight">My Cost</div>
              <div className="text-sm md:text-base font-bold font-mono text-lego-red leading-none truncate">
                {stats ? formatCurrency(stats.totalCost) : '$0.00'}
              </div>
            </div>
            <div className="rounded-lg border border-blue-400/55 bg-[#0e2245]/88 p-2.5 md:p-3" data-testid="metric-listed">
              <div className="text-[9px] md:text-[10px] text-gray-200 mb-1 leading-tight">Listed</div>
              <div className="text-sm md:text-base font-bold font-mono text-lego-blue leading-none truncate">
                {stats ? formatCurrency(stats.totalValue) : '$0.00'}
              </div>
            </div>
            <div className="rounded-lg border border-green-400/65 bg-[#0a1e12]/90 p-2.5 md:p-3" data-testid="metric-sold-avg">
              <div className="text-[9px] md:text-[10px] text-gray-200 mb-1 leading-tight">Mkt Sold Avg</div>
              <div className="text-sm md:text-base font-bold font-mono text-lego-green leading-none truncate">
                {soldAvgValue > 0 ? formatCurrency(soldAvgValue) : '—'}
              </div>
            </div>
          </div>
        </div>

        {/* Tools — Primary Workflows */}
        <div className={cn("relative bg-gradient-to-b from-gray-700/62 to-gray-900/92 border border-gray-400/60 rounded-lg shadow-[0_0_20px_rgba(255,255,255,0.08)] overflow-hidden", "p-2.5 xl:p-3")} data-testid="section-tools">
          <div className={cn("absolute top-0 left-0 right-0 bg-gradient-to-r from-transparent via-gray-100/65 to-transparent", "h-px")} />
          <div className={cn("flex items-center gap-2", "mb-2 xl:mb-2.5")}>
            <div className="p-1.5 rounded-md bg-gray-600/70 ring-1 ring-gray-300/55">
              <Sparkles className={cn("w-3 h-3 text-gray-200", "md:w-4 md:h-4")} />
            </div>
            <h3 className={cn("text-xs font-semibold text-gray-200 uppercase tracking-wide", "md:text-sm")}>Tools</h3>
          </div>
          <div className={cn("grid grid-cols-2", "gap-2")}>

            {/* Price-O-Matic */}
            <button
              onClick={() => onDrawerChange('priceomatic')}
              data-testid="tool-priceomatic"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-purple-400/72 bg-gradient-to-br from-purple-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", "p-3")}
              style={{ '--tool-glow-color': 'rgba(168,85,247,0.35)' } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-purple-800/75 p-1.5 ring-1 ring-purple-400/65 shadow-[0_0_10px_rgba(168,85,247,0.22)]">
                  <Sparkles className={cn("w-3.5 h-3.5 text-purple-200", "md:w-5 md:h-5 lg:w-4 lg:h-4")} />
                </div>
                <span className={cn("text-xs font-bold text-purple-100 leading-tight flex-1", "md:text-sm")}>Price-O-Matic</span>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem] justify-end" data-testid="pom-action-stats">
                {(pomInsights?.data?.summary?.tooHigh ?? 0) + (pomInsights?.data?.summary?.tooLow ?? 0) > 0 ? (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-600/30">
                    {(pomInsights!.data.summary.tooHigh + pomInsights!.data.summary.tooLow)} to review
                  </span>
                ) : pomInsights ? (
                  <span className="text-[9px] text-green-400/70">All well-priced</span>
                ) : null}
              </div>
            </button>

            {/* List-O-Matic */}
            <button
              onClick={() => onDrawerChange('platformsync')}
              data-testid="tool-listomatic"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-green-400/72 bg-gradient-to-br from-green-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", "p-3")}
              style={{ '--tool-glow-color': 'rgba(34,197,94,0.35)' } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-green-800/75 p-1.5 ring-1 ring-green-400/65 shadow-[0_0_10px_rgba(34,197,94,0.22)]">
                  <Globe className={cn("w-3.5 h-3.5 text-green-200", "md:w-5 md:h-5 lg:w-4 lg:h-4")} />
                </div>
                <span className={cn("text-xs font-bold text-green-100 leading-tight flex-1", "md:text-sm")}>List-O-Matic</span>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem] justify-end" data-testid="listomatic-action-stats">
                <span className="text-[9px] text-green-400/70">Sync across channels</span>
              </div>
            </button>

            {/* Brick Spotter 3000 */}
            <button
              onClick={() => onDrawerChange('brickanalyzer')}
              data-testid="tool-brickspotter"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-amber-400/72 bg-gradient-to-br from-amber-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", "p-3")}
              style={{ '--tool-glow-color': 'rgba(245,158,11,0.35)' } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-amber-800/75 p-1.5 ring-1 ring-amber-400/65 shadow-[0_0_10px_rgba(245,158,11,0.22)]">
                  <ScanSearch className={cn("w-3.5 h-3.5 text-amber-200", "md:w-5 md:h-5 lg:w-4 lg:h-4")} />
                </div>
                <span className={cn("text-xs font-bold text-amber-100 leading-tight flex-1", "md:text-sm")}>Brick Spotter</span>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem] justify-end" data-testid="brickspotter-action-stats">
                {(toolStats?.pendingScans ?? 0) > 0 ? (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-600/30">
                    {toolStats!.pendingScans} pending scans
                  </span>
                ) : toolStats ? (
                  <span className="text-[9px] text-green-400/70">Ready to scan</span>
                ) : null}
              </div>
            </button>

            {/* Inventory Health */}
            <button
              onClick={() => onDrawerChange('inventoryhealth')}
              data-testid="tool-inventoryhealth"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-cyan-400/72 bg-gradient-to-br from-cyan-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", "p-3")}
              style={{ '--tool-glow-color': 'rgba(6,182,212,0.35)' } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-cyan-800/75 p-1.5 ring-1 ring-cyan-400/65 shadow-[0_0_10px_rgba(6,182,212,0.22)]">
                  <Activity className={cn("w-3.5 h-3.5 text-cyan-200", "md:w-5 md:h-5 lg:w-4 lg:h-4")} />
                </div>
                <span className={cn("text-xs font-bold text-cyan-100 leading-tight flex-1", "md:text-sm")}>Inventory Health</span>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem] justify-end" data-testid="inventoryhealth-action-stats">
                <span className="text-[9px] text-cyan-400/70">Audit your stock</span>
              </div>
            </button>

            {/* Bulkinator */}
            <button
              onClick={() => onDrawerChange('bulkinator')}
              data-testid="tool-bulkinator"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-orange-400/72 bg-gradient-to-br from-orange-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", "p-3")}
              style={{ '--tool-glow-color': 'rgba(249,115,22,0.35)' } as React.CSSProperties}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-orange-800/75 p-1.5 ring-1 ring-orange-400/65 shadow-[0_0_10px_rgba(249,115,22,0.22)]">
                  <Layers className={cn("w-3.5 h-3.5 text-orange-200", "md:w-5 md:h-5 lg:w-4 lg:h-4")} />
                </div>
                <span className={cn("text-xs font-bold text-orange-100 leading-tight flex-1", "md:text-sm")}>Bulkinator</span>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem] justify-end" data-testid="bulkinator-action-stats">
                <span className="text-[9px] text-orange-400/70">Bundle lots for BO</span>
              </div>
            </button>

          </div>

        </div>

        {/* Selling Channels */}
        <div className={cn("relative bg-gradient-to-b from-gray-700/62 to-gray-900/92 border border-gray-400/60 rounded-lg shadow-[0_0_20px_rgba(255,255,255,0.08)] overflow-hidden", "p-2.5")} data-testid="section-selling-channels">
          <div className={cn("absolute top-0 left-0 right-0 bg-gradient-to-r from-transparent via-gray-100/65 to-transparent", "h-px")} />
          <div className={cn("flex items-center gap-2", "mb-2")}>
            <div className="p-1.5 rounded-md bg-gray-600/70 ring-1 ring-gray-300/55">
              <Globe className={cn("w-3 h-3 text-gray-200", "md:w-4 md:h-4")} />
            </div>
            <h3 className={cn("text-xs font-semibold text-gray-200 uppercase tracking-wide", "md:text-sm")}>Selling Channels</h3>
          </div>
          {desktopMode ? (
            <div className="flex flex-col divide-y divide-gray-700/40">
              {/* BrickLink — always first */}
              <div className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0" data-testid="channel-row-bricklink">
                <div className="p-1 rounded bg-blue-900/60 ring-1 ring-blue-500/40 shrink-0">
                  <Link className="w-3 h-3 text-blue-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-blue-100">BrickLink</div>
                  <div className="text-[9px] text-gray-500">Inventory sync</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400" title="Connected" />
                  <button
                    onClick={() => onDrawerChange(activeDrawer === 'bricklinksync' ? null : 'bricklinksync')}
                    data-testid="button-bricklink-sync"
                    className={cn("p-1 rounded transition-colors hover-elevate", activeDrawer === 'bricklinksync' ? "text-blue-400" : "text-gray-500")}
                  >
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {/* Per-channel rows */}
              {CHANNEL_SYNC_KEYS.map(key => {
                const cfg = CHANNEL_SYNC_CONFIG[key];
                const sb = cfg.sidebar;
                const drawerKey = `channelsync-${key}` as const;
                const active = activeDrawer === drawerKey;
                const ChannelIcon = cfg.Icon;
                return (
                  <div key={key} className="flex items-center gap-2 py-1.5 last:pb-0" data-testid={`channel-row-${key}`}>
                    <div className="p-1 rounded ring-1 shrink-0" style={{ background: 'rgba(0,0,0,0.3)' }}>
                      <ChannelIcon className={`w-3 h-3 ${sb.iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-semibold ${sb.labelColor}`}>{cfg.label}</div>
                      <div className="text-[9px] text-gray-500">Inventory sync</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400" title="Connected" />
                      <button
                        onClick={() => onDrawerChange(active ? null : drawerKey)}
                        data-testid={`button-inv-${key}-sync`}
                        className={cn("p-1 rounded transition-colors hover-elevate", active ? sb.activeArrow : "text-gray-500")}
                      >
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {/* Channel pill selector — same pattern as OrdersDashboard mobile */}
              {CHANNEL_SYNC_KEYS.length > 0 && (
                <div className="flex items-center gap-5 flex-wrap pl-8 pt-0.5">
                  {(['bricklink', ...CHANNEL_SYNC_KEYS]).map(key => {
                    const label = key === 'bricklink' ? 'BrickLink' : (CHANNEL_SYNC_CONFIG[key as InvSyncChannel]?.label ?? key);
                    return (
                      <RetroTogglePin
                        key={key}
                        active={mobileInvChannel === key}
                        onClick={() => setMobileInvChannel(key)}
                        label={label}
                        testId={`button-mobile-inv-pin-${key}`}
                      />
                    );
                  })}
                </div>
              )}
              {mobileInvChannel === 'bricklink'
                ? <BrickLinkSyncPanel onOpenSettings={onOpenSettings} />
                : <ChannelSyncPanel onOpenSettings={onOpenSettings} initialChannel={mobileInvChannel} />
              }
            </div>
          )}
        </div>



      </div>

      {/* Browse Sheet — Lots / Parts / Categories
          Mounted as fixed inset-0 (immune to iOS keyboard repositioning) but LOOKS like
          a bottom sheet: backdrop fade + panel slide-up, swipe-down to dismiss. */}
      {browseDrawer && (
        <div className="fixed inset-0 z-50" data-testid="overlay-browse">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black transition-opacity duration-300"
            style={{ opacity: browseVisible ? 0.55 : 0 }}
            onClick={closeBrowse}
          />

          {/* Sheet panel — slides up from bottom */}
          <div
            ref={panelRef}
            className="absolute bottom-0 left-0 right-0 flex flex-col bg-gray-950 rounded-t-2xl transition-transform duration-300 ease-out"
            style={{
              height: '92%',
              transform: browseVisible ? 'translateY(0)' : 'translateY(100%)',
              willChange: 'transform',
            }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            {/* Drag handle */}
            <div className="flex-shrink-0 flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-600" />
            </div>

            {/* Header */}
            <div className="flex-shrink-0 flex items-center gap-2 px-4 pt-2 pb-2 border-b border-gray-800">
              <Package className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span className="text-sm font-semibold text-gray-100 flex-1">
                {browseDrawer === 'lots' ? 'Inventory Lots' : browseDrawer === 'parts' ? 'Parts by Quantity' : 'Categories'}
              </span>
              {browseData && (
                <span className="text-xs text-gray-500">{browseData.total.toLocaleString()} total</span>
              )}
              <button
                onClick={closeBrowse}
                className="ml-2 text-gray-500 hover:text-gray-200 transition-colors"
                data-testid="button-browse-close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search bar */}
            <div className="flex-shrink-0 px-4 pt-3 pb-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
                <Input
                  value={browseSearchInput}
                  onChange={(e) => setBrowseSearchInput(e.target.value)}
                  placeholder={browseDrawer === 'categories' ? 'Search categories…' : 'Search by lot ID, part #, name, or color…'}
                  className="pl-8 pr-8 text-xs h-9 bg-gray-900 border-gray-700"
                  data-testid="input-browse-search"
                />
                {browseSearchInput && (
                  <button
                    onClick={() => setBrowseSearchInput('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto px-4 pt-2 min-h-0">
              {browseLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                </div>
              ) : browseData && browseData.rows.length === 0 ? (
                <div className="py-12 text-center text-gray-500 text-sm">No results found</div>
              ) : browseDrawer === 'categories' ? (
                <div className="divide-y divide-gray-800">
                  {browseData?.rows.map((row: any, i: number) => (
                    <div key={row.categoryId ?? i} className="flex items-center justify-between py-2.5" data-testid={`row-category-${row.categoryId}`}>
                      <span className="text-xs text-gray-200">{row.categoryName ?? 'Uncategorized'}</span>
                      <div className="flex items-center gap-3 text-right">
                        <span className="text-[10px] text-gray-500">{Number(row.lotCount).toLocaleString()} lots</span>
                        <span className="text-xs font-mono text-blue-300 min-w-[3rem] text-right">{Number(row.totalQty).toLocaleString()} pcs</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {browseData?.rows.map((row: any) => (
                    <div
                      key={row.id}
                      className="flex items-center gap-3 py-2.5 cursor-pointer hover-elevate rounded-md"
                      data-testid={`row-lot-${row.id}`}
                      onClick={() => onItemClick?.('inventory', row.id)}
                    >
                      {row.colorRgb && (
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-gray-600"
                          style={{ backgroundColor: `#${row.colorRgb}` }}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-mono text-gray-300">{row.itemNo}</span>
                          {row.newOrUsed === 'U' && <span className="text-[9px] px-1 py-0 rounded bg-yellow-900/40 text-yellow-400 border border-yellow-700/30">Used</span>}
                          <span className="text-[9px] font-mono text-gray-600">#{row.id}</span>
                        </div>
                        <div className="text-[10px] text-gray-500 truncate">{row.itemName ?? row.colorName ?? ''}{row.itemName && row.colorName ? ` · ${row.colorName}` : ''}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs font-mono text-blue-300">{Number(row.quantity).toLocaleString()}</div>
                        {row.unitPrice && <div className="text-[10px] text-gray-500">${Number(row.unitPrice).toFixed(3)}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pagination */}
            {browseData && browseData.total > browseData.limit && (
              <div className="flex-shrink-0 border-t border-gray-800 px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  {(browsePage * 100 + 1).toLocaleString()}–{Math.min((browsePage + 1) * 100, browseData.total).toLocaleString()} of {browseData.total.toLocaleString()}
                </span>
                <div className="flex items-center gap-2">
                  <Button size="icon" variant="ghost" disabled={browsePage === 0} onClick={() => setBrowsePage(p => p - 1)} data-testid="button-browse-prev">
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" disabled={(browsePage + 1) * 100 >= browseData.total} onClick={() => setBrowsePage(p => p + 1)} data-testid="button-browse-next">
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!desktopMode && (
        <InventoryHealthPanel
          open={activeDrawer === 'inventoryhealth'}
          onOpenChange={(open) => { if (!open) onDrawerChange(null); }}
          onItemClick={onItemClick}
        />
      )}

    </div>
  );
}

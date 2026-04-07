import { useState, useRef, useEffect, ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { InfoIcon, Package, Sparkles, ScanSearch, Globe, ChevronLeft, ChevronRight, Search, X, Activity, Layers, Crosshair, TrendingDown, TrendingUp } from "lucide-react";
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
  activeDrawer: 'priceomatic' | 'platformsync' | 'brickanalyzer' | 'inventoryhealth' | 'bricklinksync' | `channelsync-${string}` | 'bundletron' | null;
  onDrawerChange: (drawer: 'priceomatic' | 'platformsync' | 'brickanalyzer' | 'inventoryhealth' | 'bricklinksync' | `channelsync-${string}` | 'bundletron' | null) => void;
  onOpenSettings?: (section?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'billing' | 'priceomatic', focusTarget?: 'channelSync' | 'schedulerInventory' | 'schedulerOrders' | 'schedulerChannel') => void;
  desktopMode?: boolean;
  onBrowseOpen?: (type: 'lots' | 'parts' | 'categories') => void;
  tvSplit?: 'left' | 'right';
  compact?: boolean;
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


export default function InventoryDashboard({ onItemClick, activeDrawer, onDrawerChange, onOpenSettings, desktopMode, onBrowseOpen, tvSplit, compact }: InventoryDashboardProps) {
  const isCompact = !!(tvSplit || compact);

  const { toast } = useToast();

  const [browseDrawer, setBrowseDrawer] = useState<BrowseType | null>(null);
  const [browseVisible, setBrowseVisible] = useState(false);
  const [browsePage, setBrowsePage] = useState(0);
  const [browseSearch, setBrowseSearch] = useState('');
  const [browseSearchInput, setBrowseSearchInput] = useState('');
  const [panelTab, setPanelTab] = useState<'systems' | 'uplink'>('systems');

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

  const { data: syncStatuses } = useQuery<any>({
    queryKey: ['/api/sync/statuses'],
    refetchInterval: 15000,
  });

  const hasChannelErrors = (() => {
    if (!syncStatuses) return false;
    const blErr = ['error', 'failed'].includes(syncStatuses.inventory?.lastSyncStatus);
    const chErr = Object.values(syncStatuses.channels ?? {}).some(
      (c: any) => ['error', 'failed'].includes(c?.lastSyncStatus)
    );
    return blErr || chErr;
  })();

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
        <div className={isCompact ? "p-2 space-y-2 h-full overflow-y-auto" : cn("bg-gradient-to-br from-lego-blue/10 to-lego-blue/3 rounded-lg border border-lego-blue/35 shadow-[0_0_22px_rgba(59,130,246,0.18)] p-2 space-y-3")}>
      {(!tvSplit || tvSplit === 'left') && <>

        {/* Combined Inventory Info + Values */}
        <div
          className={cn("relative rounded-lg border border-blue-400/65 shadow-[0_0_30px_rgba(59,130,246,0.28)] overflow-hidden", isCompact ? "p-2" : "p-3")}
          style={{ background: 'linear-gradient(175deg, #0f2240 0%, #0a1630 100%)' }}
          data-testid="section-inventory-overview"
        >
          {/* Top shine line */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-300/90 to-transparent" />

          {/* Header */}
          <div className={cn("flex items-center", isCompact ? "gap-1.5" : "gap-2", isCompact ? "mb-1.5" : "mb-3")}>
            <div className={cn("rounded-md bg-blue-800/70 ring-1 ring-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.32)] shrink-0", isCompact ? "p-1.5" : "p-1.5")}>
              <Package className="w-3 h-3 text-blue-200" />
            </div>
            <h3 className="text-xs font-semibold text-blue-200 uppercase tracking-wide">Inventory</h3>
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
          <div className={cn("grid grid-cols-3", isCompact ? "gap-1.5 mb-1.5" : "gap-1.5 mb-1.5")} data-testid="section-inventory-info">
            {([
              { key: 'lots', label: 'Lots', value: stats ? formatNumber(stats.totalLots) : '—' },
              { key: 'parts', label: 'Parts', value: stats ? formatNumber(stats.totalParts) : '—' },
              { key: 'categories', label: 'Categories', value: stats ? formatNumber(stats.totalCategories) : '—' },
            ] as const).map(({ key, label, value }) => (
              <button
                key={key}
                onClick={() => desktopMode && onBrowseOpen ? onBrowseOpen(key) : openBrowse(key)}
                data-testid={`metric-${key}`}
                className={cn("relative group flex flex-col text-left hover-elevate active-elevate-2 rounded-md border border-lego-blue/50 bg-gray-800/70", isCompact ? "p-1.5" : "p-1.5 md:p-2.5")}
              >
                <span className={cn("text-gray-300 mb-0.5 leading-tight", isCompact ? "text-xs" : "text-[11px] md:text-xs")}>{label}</span>
                <span className={cn("font-semibold font-mono text-lego-blue leading-none", isCompact ? "text-sm" : "text-xs md:text-base")}>{value}</span>
                <span className="absolute top-1.5 right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-lego-blue/20 group-hover:bg-lego-blue/40 transition-colors">
                  <ChevronRight className="w-2.5 h-2.5 text-white" />
                </span>
              </button>
            ))}
          </div>

          {/* Bottom row: My Cost, Listed, Mkt Sold Avg */}
          <div className={cn("grid grid-cols-3", isCompact ? "gap-1.5" : "gap-1.5")} data-testid="section-values">
            <div className={cn("rounded-md border border-lego-red/50 bg-gray-800/70", isCompact ? "p-1.5" : "p-1.5 md:p-2.5")} data-testid="metric-cost">
              <div className={cn("text-gray-300 mb-0.5 leading-tight", isCompact ? "text-xs" : "text-[11px] md:text-xs")}>My Cost</div>
              <div className={cn("font-semibold font-mono text-lego-red leading-none truncate", isCompact ? "text-sm" : "text-xs md:text-base")}>
                {stats ? formatCurrency(stats.totalCost) : '$0.00'}
              </div>
            </div>
            <div className={cn("rounded-md border border-lego-blue/50 bg-gray-800/70", isCompact ? "p-1.5" : "p-1.5 md:p-2.5")} data-testid="metric-listed">
              <div className={cn("text-gray-300 mb-0.5 leading-tight", isCompact ? "text-xs" : "text-[11px] md:text-xs")}>Listed</div>
              <div className={cn("font-semibold font-mono text-lego-blue leading-none truncate", isCompact ? "text-sm" : "text-xs md:text-base")}>
                {stats ? formatCurrency(stats.totalValue) : '$0.00'}
              </div>
            </div>
            <div className={cn("rounded-md border border-lego-green/50 bg-gray-800/70", isCompact ? "p-1.5" : "p-1.5 md:p-2.5")} data-testid="metric-sold-avg">
              <div className={cn("text-gray-300 mb-0.5 leading-tight", isCompact ? "text-xs" : "text-[11px] md:text-xs")}>Mkt Sold Avg</div>
              <div className={cn("font-semibold font-mono text-lego-green leading-none truncate", isCompact ? "text-sm" : "text-xs md:text-base")}>
                {soldAvgValue > 0 ? formatCurrency(soldAvgValue) : '—'}
              </div>
            </div>
          </div>
        </div>

        {/* ── COMMAND CENTRAL ─ Focus panel ── */}
        <div className="relative rounded-lg border border-blue-400/65 shadow-[0_0_30px_rgba(59,130,246,0.28)] overflow-hidden" style={{ background: 'linear-gradient(175deg, #0f2240 0%, #0a1630 100%)' }} data-testid="section-command-central-inventory">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-300/90 to-transparent" />
          <div className={cn(isCompact ? "px-2.5 pt-2 pb-2 space-y-1.5" : "px-3 pt-2.5 pb-2.5 space-y-1.5")}>
            <div className={cn("flex items-center", isCompact ? "gap-1.5 mb-1" : "gap-2 mb-1")}>
              <div className={cn("rounded-md bg-blue-800/70 ring-1 ring-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.32)] shrink-0", isCompact ? "p-1.5" : "p-1.5")}>
                <Crosshair className="w-3 h-3 text-blue-200" />
              </div>
              <h3 className="text-xs font-semibold text-blue-200 uppercase tracking-wide">Command Central</h3>
            </div>

            {/* Pricing signal */}
            <div className={cn("flex items-center gap-2", isCompact ? "" : "min-h-[1.5rem]")}>
              <span className="text-[11px] text-gray-400 uppercase tracking-widest w-16 flex-shrink-0">Pricing</span>
              {pomInsights ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {(pomInsights.data?.summary?.tooLow ?? 0) > 0 && (
                    <button
                      onClick={() => onDrawerChange('priceomatic')}
                      data-testid="directive-underpriced"
                      className="flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/25 hover-elevate"
                    >
                      <TrendingDown className="w-2.5 h-2.5" />
                      {pomInsights.data.summary.tooLow} underpriced
                    </button>
                  )}
                  {(pomInsights.data?.summary?.tooHigh ?? 0) > 0 && (
                    <button
                      onClick={() => onDrawerChange('priceomatic')}
                      data-testid="directive-overpriced"
                      className="flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/25 hover-elevate"
                    >
                      <TrendingUp className="w-2.5 h-2.5" />
                      {pomInsights.data.summary.tooHigh} overpriced
                    </button>
                  )}
                  {!(pomInsights.data?.summary?.tooLow > 0) && !(pomInsights.data?.summary?.tooHigh > 0) && (
                    <span className="text-[11px] text-green-400/60">All well-priced</span>
                  )}
                </div>
              ) : (
                <span className="text-[11px] text-gray-700">—</span>
              )}
            </div>

            {/* Channel sync signal */}
            <div className={cn("flex items-center gap-2", isCompact ? "" : "min-h-[1.5rem]")}>
              <span className="text-[11px] text-gray-400 uppercase tracking-widest w-16 flex-shrink-0">Channels</span>
              {hasChannelErrors ? (
                <button
                  onClick={() => setPanelTab('uplink')}
                  data-testid="directive-channel-error"
                  className="flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/25 hover-elevate"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                  Sync issues detected
                </button>
              ) : syncStatuses ? (
                <span className="text-[11px] text-green-400/80">All channels nominal</span>
              ) : (
                <span className="text-[11px] text-gray-700">—</span>
              )}
            </div>
          </div>
        </div>
      </>}
      {(!tvSplit || tvSplit === 'right') && <>

        {/* SYSTEMS / UPLINK tab panel */}
        <div className={cn("relative bg-gradient-to-b from-gray-800/75 to-gray-900/95 border border-gray-400/60 rounded-lg shadow-[0_0_20px_rgba(255,255,255,0.08)] overflow-hidden", isCompact ? "p-2" : "p-2.5 xl:p-3")} data-testid="section-panel-tabs">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gray-100/65 to-transparent" />

          {/* Retro control panel tab strip */}
          <div className={cn("flex rounded-md border border-gray-500/30 bg-black/50 p-0.5 gap-0.5 shadow-inner", isCompact ? "mb-2" : "mb-3")} data-testid="control-panel-tabs">
            <button
              onClick={() => setPanelTab('systems')}
              data-testid="tab-systems"
              className={cn(
                "relative flex-1 flex items-center justify-center gap-1 py-1 rounded transition-all duration-200 text-xs font-bold uppercase tracking-widest",
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
                "relative flex-1 flex items-center justify-center gap-1 py-1 rounded transition-all duration-200 text-xs font-bold uppercase tracking-widest",
                panelTab === 'uplink'
                  ? "bg-gray-700/90 text-gray-100 shadow-[0_0_14px_rgba(255,255,255,0.07)]"
                  : "text-gray-400 hover:text-gray-200"
              )}
            >
              <Globe className="w-3 h-3 flex-shrink-0" />
              Channels
              {hasChannelErrors && panelTab !== 'uplink' && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" data-testid="badge-channel-errors" />
              )}
              {panelTab === 'uplink' && (
                <span className="absolute bottom-0 inset-x-3 h-px bg-gradient-to-r from-transparent via-gray-300/70 to-transparent" />
              )}
            </button>
          </div>

          {/* SYSTEMS — Tools grid */}
          {panelTab === 'systems' && (
          <div className={cn("grid grid-cols-2", isCompact ? "gap-1.5" : "gap-2")} data-testid="section-tools">

            {/* Price-O-Matic */}
            <button
              onClick={() => onDrawerChange('priceomatic')}
              data-testid="tool-priceomatic"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-purple-400/72 bg-gradient-to-br from-purple-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", isCompact ? "p-2" : "p-2.5 md:p-3")}
              style={{ '--tool-glow-color': 'rgba(168,85,247,0.35)' } as React.CSSProperties}
            >
              <div className={cn("flex items-center", isCompact ? "gap-1.5" : "gap-2")}>
                <div className={cn("rounded-lg bg-purple-800/75", isCompact ? "p-1.5" : "p-1 md:p-1.5", "ring-1 ring-purple-400/65 shadow-[0_0_10px_rgba(168,85,247,0.22)]")}>
                  <Sparkles className={cn("text-purple-200", isCompact ? "w-3.5 h-3.5" : "w-3.5 h-3.5 md:w-5 md:h-5 lg:w-4 lg:h-4")} />
                </div>
                <span className={cn("font-bold text-purple-100 leading-tight flex-1", isCompact ? "text-xs" : "text-xs md:text-sm")}>Price-O-Matic</span>
              </div>
              <div className={cn("flex flex-wrap gap-1 justify-end", isCompact ? "min-h-[1rem]" : "min-h-[1.25rem]")} data-testid="pom-action-stats">
                {(pomInsights?.data?.summary?.tooHigh ?? 0) + (pomInsights?.data?.summary?.tooLow ?? 0) > 0 ? (
                  <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-600/30">
                    {(pomInsights!.data.summary.tooHigh + pomInsights!.data.summary.tooLow)} to review
                  </span>
                ) : pomInsights ? (
                  <span className="text-[11px] text-green-400/70">All well-priced</span>
                ) : null}
              </div>
            </button>

            {/* List-O-Matic */}
            <button
              onClick={() => onDrawerChange('platformsync')}
              data-testid="tool-listomatic"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-green-400/72 bg-gradient-to-br from-green-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", isCompact ? "p-2" : "p-2.5 md:p-3")}
              style={{ '--tool-glow-color': 'rgba(34,197,94,0.35)' } as React.CSSProperties}
            >
              <div className={cn("flex items-center", isCompact ? "gap-1.5" : "gap-2")}>
                <div className={cn("rounded-lg bg-green-800/75", isCompact ? "p-1.5" : "p-1 md:p-1.5", "ring-1 ring-green-400/65 shadow-[0_0_10px_rgba(34,197,94,0.22)]")}>
                  <Globe className={cn("text-green-200", isCompact ? "w-3.5 h-3.5" : "w-3.5 h-3.5 md:w-5 md:h-5 lg:w-4 lg:h-4")} />
                </div>
                <span className={cn("font-bold text-green-100 leading-tight flex-1", isCompact ? "text-xs" : "text-xs md:text-sm")}>List-O-Matic</span>
              </div>
              <div className={cn("flex flex-wrap gap-1 justify-end", isCompact ? "min-h-[1rem]" : "min-h-[1.25rem]")} data-testid="listomatic-action-stats">
                <span className="text-[11px] text-green-400/70">Sync across channels</span>
              </div>
            </button>

            {/* Brick Spotter 3000 */}
            <button
              onClick={() => onDrawerChange('brickanalyzer')}
              data-testid="tool-brickspotter"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-amber-400/72 bg-gradient-to-br from-amber-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", isCompact ? "p-2" : "p-2.5 md:p-3")}
              style={{ '--tool-glow-color': 'rgba(245,158,11,0.35)' } as React.CSSProperties}
            >
              <div className={cn("flex items-center", isCompact ? "gap-1.5" : "gap-2")}>
                <div className={cn("rounded-lg bg-amber-800/75", isCompact ? "p-1.5" : "p-1 md:p-1.5", "ring-1 ring-amber-400/65 shadow-[0_0_10px_rgba(245,158,11,0.22)]")}>
                  <ScanSearch className={cn("text-amber-200", isCompact ? "w-3.5 h-3.5" : "w-3.5 h-3.5 md:w-5 md:h-5 lg:w-4 lg:h-4")} />
                </div>
                <span className={cn("font-bold text-amber-100 leading-tight flex-1", isCompact ? "text-xs" : "text-xs md:text-sm")}>Brick Spotter</span>
              </div>
              <div className={cn("flex flex-wrap gap-1 justify-end", isCompact ? "min-h-[1rem]" : "min-h-[1.25rem]")} data-testid="brickspotter-action-stats">
                {(toolStats?.pendingScans ?? 0) > 0 ? (
                  <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-600/30">
                    {toolStats!.pendingScans} pending scans
                  </span>
                ) : toolStats ? (
                  <span className="text-[11px] text-green-400/70">Ready to scan</span>
                ) : null}
              </div>
            </button>

            {/* Inventory Health */}
            <button
              onClick={() => onDrawerChange('inventoryhealth')}
              data-testid="tool-inventoryhealth"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-cyan-400/72 bg-gradient-to-br from-cyan-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", isCompact ? "p-2" : "p-2.5 md:p-3")}
              style={{ '--tool-glow-color': 'rgba(6,182,212,0.35)' } as React.CSSProperties}
            >
              <div className={cn("flex items-center", isCompact ? "gap-1.5" : "gap-2")}>
                <div className={cn("rounded-lg bg-cyan-800/75", isCompact ? "p-1.5" : "p-1 md:p-1.5", "ring-1 ring-cyan-400/65 shadow-[0_0_10px_rgba(6,182,212,0.22)]")}>
                  <Activity className={cn("text-cyan-200", isCompact ? "w-3.5 h-3.5" : "w-3.5 h-3.5 md:w-5 md:h-5 lg:w-4 lg:h-4")} />
                </div>
                <span className={cn("font-bold text-cyan-100 leading-tight flex-1", isCompact ? "text-xs" : "text-xs md:text-sm")}>Inventory Health</span>
              </div>
              <div className={cn("flex flex-wrap gap-1 justify-end", isCompact ? "min-h-[1rem]" : "min-h-[1.25rem]")} data-testid="inventoryhealth-action-stats">
                <span className="text-[11px] text-cyan-400/70">Audit your stock</span>
              </div>
            </button>

            {/* BundleTron */}
            <button
              onClick={() => onDrawerChange('bundletron')}
              data-testid="tool-bundletron"
              className={cn("group flex flex-col gap-1.5 rounded-lg border border-orange-400/72 bg-gradient-to-br from-orange-900/60 to-gray-900/88 text-left hover-elevate active-elevate-2 transition-all cockpit-tool-btn", isCompact ? "p-2" : "p-2.5 md:p-3")}
              style={{ '--tool-glow-color': 'rgba(249,115,22,0.35)' } as React.CSSProperties}
            >
              <div className={cn("flex items-center", isCompact ? "gap-1.5" : "gap-2")}>
                <div className={cn("rounded-lg bg-orange-800/75", isCompact ? "p-1.5" : "p-1 md:p-1.5", "ring-1 ring-orange-400/65 shadow-[0_0_10px_rgba(249,115,22,0.22)]")}>
                  <Layers className={cn("text-orange-200", isCompact ? "w-3.5 h-3.5" : "w-3.5 h-3.5 md:w-5 md:h-5 lg:w-4 lg:h-4")} />
                </div>
                <span className={cn("font-bold text-orange-100 leading-tight flex-1", isCompact ? "text-xs" : "text-xs md:text-sm")}>BundleTron</span>
              </div>
              <div className={cn("flex flex-wrap gap-1 justify-end", isCompact ? "min-h-[1rem]" : "min-h-[1.25rem]")} data-testid="bundletron-action-stats">
                <span className="text-[11px] text-orange-400/70">Bundle lots for BO</span>
              </div>
            </button>

          </div>
          )}

          {/* UPLINK — Selling Channels */}
          {panelTab === 'uplink' && (
            <div className="flex flex-col gap-2" data-testid="section-selling-channels">
              <BrickLinkSyncPanel onOpenSettings={onOpenSettings} />
              <ChannelSyncPanel channel="brickowl" onOpenSettings={onOpenSettings} />
              <ChannelSyncPanel channel="ebay" onOpenSettings={onOpenSettings} />
            </div>
          )}
        </div>
      </>}

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
                        <span className="text-xs text-gray-500">{Number(row.lotCount).toLocaleString()} lots</span>
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
                          {row.newOrUsed === 'U' && <span className="text-[11px] px-1 py-0 rounded bg-yellow-900/40 text-yellow-400 border border-yellow-700/30">Used</span>}
                          <span className="text-[11px] font-mono text-gray-600">#{row.id}</span>
                        </div>
                        <div className="text-xs text-gray-500 truncate">{row.itemName ?? row.colorName ?? ''}{row.itemName && row.colorName ? ` · ${row.colorName}` : ''}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs font-mono text-blue-300">{Number(row.quantity).toLocaleString()}</div>
                        {row.unitPrice && <div className="text-xs text-gray-500">${Number(row.unitPrice).toFixed(3)}</div>}
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
                <div className={cn("flex items-center", isCompact ? "gap-1" : "gap-2")}>
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

      {!desktopMode && !tvSplit && (
        <InventoryHealthPanel
          open={activeDrawer === 'inventoryhealth'}
          onOpenChange={(open) => { if (!open) onDrawerChange(null); }}
          onItemClick={onItemClick}
        />
      )}

    </div>
  );
}

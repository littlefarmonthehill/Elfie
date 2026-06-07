import { useState, useRef, useEffect, ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { InfoIcon, Sparkles, ScanSearch, Globe, ChevronLeft, ChevronRight, Search, X, Activity, Layers, Crosshair, TrendingDown, Rocket, ListOrdered, Gauge, Bot, Atom, Warehouse, Check } from "lucide-react";
import { StationTool } from "./StationTool";
import ChannelSyncPanel from "./ChannelSyncPanel";
import BrickLinkSyncPanel from "./BrickLinkSyncPanel";
import DashboardNotifications, { useSyncIssueCount } from "./DashboardNotifications";
import InventoryHealthPanel from "./InventoryHealthPanel";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useFeature, useFeatures, type Stage } from "@/hooks/use-feature";
import { useAuth } from "@/hooks/useAuth";
import { StageTag } from "@/components/BetaTag";

interface InventoryStats {
  totalLots: number;
  totalParts: number;
  totalValue: number;
  totalCost: number;
  totalColors: number;
  totalCategories: number;
  newParts: number;
  usedParts: number;
}

interface InventoryDashboardProps {
  onItemClick?: (type: 'order' | 'inventory', id: number | string, initialTab?: string) => void;
  activeDrawer: 'priceomatic' | 'platformsync' | 'brickanalyzer' | 'inventoryhealth' | 'bricklinksync' | `channelsync-${string}` | 'bundletron' | 'acquisition-evaluator' | 'warehouse' | null;
  onDrawerChange: (drawer: 'priceomatic' | 'platformsync' | 'brickanalyzer' | 'inventoryhealth' | 'bricklinksync' | `channelsync-${string}` | 'bundletron' | 'acquisition-evaluator' | 'warehouse' | null) => void;
  onOpenSettings?: (section?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'billing' | 'priceomatic', focusTarget?: 'channelSync' | 'schedulerInventory' | 'schedulerOrders' | 'schedulerChannel') => void;
  desktopMode?: boolean;
  onBrowseOpen?: (type: 'lots' | 'parts' | 'categories') => void;
  tvSplit?: 'left' | 'right';
  compact?: boolean;
  /** Deep-link to this tab on mount / when value changes. */
  initialPanelTab?: 'systems' | 'uplink';
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


export default function InventoryDashboard({ onItemClick, activeDrawer, onDrawerChange, onOpenSettings, desktopMode, onBrowseOpen, tvSplit, compact, initialPanelTab }: InventoryDashboardProps) {
  const isCompact = !!(tvSplit || compact);

  const { toast } = useToast();

  // Beta feature gating — these tools are hidden unless the org has opted in
  // (or the user is a super admin). See the Beta Features panel in Settings.
  const showBrickSpotter = useFeature('inv_brick_spotter');
  const showInventoryHealth = useFeature('inv_health');
  const showBundleTron = useFeature('inv_bundletron');
  const showAcquisition = useFeature('inv_acquisition');
  const showListOMatic = useFeature('inv_list_o_matic');
  const showPriceOMatic = useFeature('inv_price_o_matic');
  const showCargoBay = useFeature('inv_cargo_bay');
  const showEbayChannel = useFeature('channel_ebay');
  // Beta badges are an at-a-glance, super-admin-only cue; opted-in regular
  // users still get the feature but see no badge.
  const { actualSuperAdmin } = useAuth();
  // Show the maturity badge (Alpha/Beta) to super admins on each gated launcher.
  // Use actualSuperAdmin so the badge still shows while previewing as a regular
  // user (effective superAdmin is false in preview mode).
  const { stages: featureStages } = useFeatures();
  const tagStage = (k: string): Stage | undefined => (actualSuperAdmin ? featureStages[k] : undefined);

  const [browseDrawer, setBrowseDrawer] = useState<BrowseType | null>(null);
  const [browseVisible, setBrowseVisible] = useState(false);
  const [browsePage, setBrowsePage] = useState(0);
  const [browseSearch, setBrowseSearch] = useState('');
  const [browseSearchInput, setBrowseSearchInput] = useState('');
  const [panelTab, setPanelTab] = useState<'systems' | 'uplink'>(initialPanelTab ?? 'systems');

  useEffect(() => {
    if (initialPanelTab) setPanelTab(initialPanelTab);
  }, [initialPanelTab]);

  const inventorySyncIssueCount = useSyncIssueCount(['product']);

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
      items: any[];
      summary: { total: number };
    };
  }>({
    queryKey: ['/api/priceomatic/insights'],
    staleTime: 10 * 60 * 1000,
  });

  const { data: pomDeepSpace } = useQuery<{ success: boolean; keys: string[] }>({
    queryKey: ['/api/priceomatic/deep-space'],
    staleTime: 5 * 60 * 1000,
  });

  const { data: pomFutureMissions } = useQuery<{ success: boolean; keys: string[] }>({
    queryKey: ['/api/priceomatic/future-missions'],
    staleTime: 5 * 60 * 1000,
  });

  const { data: lomCategories } = useQuery<{
    success: boolean;
    categories: { id: number; name: string; sortingPhase: string | null }[];
    fileLotCounts: { unassignedLots: number; filingQueueLots: number; total: number };
    rtfLotCounts?: { unfiled: number; byRtf: { rtfBin: string; count: number }[] };
  }>({
    queryKey: ['/api/listomatc/category-phases'],
    staleTime: 5 * 60 * 1000,
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

  const soldAvgValue = (stats as any)?.soldAvgValue ?? 0;

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
          className={cn("relative rounded-lg border border-blue-400/65 shadow-[0_0_30px_rgba(59,130,246,0.28)] overflow-hidden", isCompact ? "p-2" : "p-2 md:p-3")}
          style={{ background: 'linear-gradient(175deg, #0f2240 0%, #0a1630 100%)' }}
          data-testid="section-inventory-overview"
        >
          {/* Top shine line */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-300/90 to-transparent" />

          {/* Header */}
          <div className={cn("flex items-center", isCompact ? "gap-1.5 mb-1.5" : "gap-2 mb-2")}>
            <div className={cn("rounded-md bg-blue-800/70 ring-1 ring-blue-500/60 shadow-[0_0_14px_rgba(59,130,246,0.32)] shrink-0", isCompact ? "p-1.5" : "p-1.5")}>
              <Layers className="w-3 h-3 text-blue-200" />
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

          {/* Top row: Lots, Parts, New/Used condition split */}
          <div className={cn("grid grid-cols-3", isCompact ? "gap-1.5 mb-1.5" : "gap-1.5 mb-1.5")} data-testid="section-inventory-info">
            {([
              { key: 'lots', label: 'Lots', value: stats ? formatNumber(stats.totalLots) : '—' },
              { key: 'parts', label: 'Parts', value: stats ? formatNumber(stats.totalParts) : '—' },
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
            {/* New / Used condition split — non-clickable info card */}
            {(() => {
              const total = (stats?.newParts ?? 0) + (stats?.usedParts ?? 0);
              const newPct = total > 0 ? Math.round(((stats?.newParts ?? 0) / total) * 100) : null;
              const usedPct = newPct !== null ? 100 - newPct : null;
              return (
                <div
                  data-testid="metric-condition"
                  className={cn("flex flex-col rounded-md border border-lego-blue/50 bg-gray-800/70", isCompact ? "p-1.5" : "p-1.5 md:p-2.5")}
                >
                  <span className={cn("text-gray-300 mb-0.5 leading-tight", isCompact ? "text-xs" : "text-[11px] md:text-xs")}>N / U</span>
                  {newPct !== null ? (
                    <span className={cn("font-semibold font-mono leading-none", isCompact ? "text-sm" : "text-xs md:text-base")}>
                      <span className="text-lego-blue">{newPct}%</span>
                      <span className="text-gray-500 mx-0.5">·</span>
                      <span className="text-yellow-400">{usedPct}%</span>
                    </span>
                  ) : (
                    <span className={cn("font-semibold font-mono text-gray-600 leading-none", isCompact ? "text-sm" : "text-xs md:text-base")}>—</span>
                  )}
                </div>
              );
            })()}
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
        {(() => {
          const missionCount   = pomFutureMissions?.keys?.length ?? 0;
          const deepSpaceCount = pomDeepSpace?.keys?.length ?? 0;
          const totalPomItems  = pomInsights?.data?.summary?.total ?? 0;
          const inOrbitCount   = Math.max(0, totalPomItems - missionCount - deepSpaceCount);
          const lomCount = (phase: string) =>
            (lomCategories?.categories ?? []).filter(c => c.sortingPhase === phase).length;
          const fileCount = lomCategories?.fileLotCounts?.total ?? 0;
          // Filing breakdown — drives the right side of the List-o-Matic row.
          // "Unfiled" = lots with no bin AND no rtf hint (brand-new, nobody
          // knows where they are). "byRtf" = one entry per pre-file tote
          // that currently has bags in it (rtf 0, rtf 3, …); empty totes
          // are filtered out server-side so the row stays tidy.
          const unfiledCount = lomCategories?.rtfLotCounts?.unfiled ?? 0;
          const rtfBuckets = lomCategories?.rtfLotCounts?.byRtf ?? [];
          // Lamp colors cycled across rtf bubbles — same palette family as
          // the rest of the row so the section still reads as a unit.
          const RTF_LAMPS = [
            'rgba(74,222,128,0.9)',   // green
            'rgba(96,165,250,0.9)',   // blue
            'rgba(251,191,36,0.9)',   // amber
            'rgba(192,132,252,0.9)',  // purple
            'rgba(244,114,182,0.9)',  // pink
            'rgba(56,189,248,0.9)',   // sky
            'rgba(251,146,60,0.9)',   // orange
            'rgba(167,139,250,0.9)',  // violet
          ];
          const pomHasActivity  = totalPomItems > 0;
          const lomHasActivity  = ['category','subcategory','finalsort','listing'].some(p => lomCount(p) > 0) || fileCount > 0;

          const PipelineRow = ({
            buttonIcon,
            buttonLabel,
            buttonStyle,
            buttonBorderClass,
            onButtonClick,
            testId,
            statuses,
            trailingContent,
            stage,
          }: {
            buttonIcon: React.ReactNode;
            buttonLabel: string;
            buttonStyle: React.CSSProperties;
            buttonBorderClass: string;
            onButtonClick: () => void;
            testId: string;
            statuses: { key: string; label: string; count: number; lampColor: string }[];
            trailingContent?: React.ReactNode;
            stage?: Stage;
          }) => (
            <div className="flex items-stretch gap-3">
              <button
                onClick={() => onButtonClick()}
                data-testid={testId}
                style={buttonStyle}
                className={`flex flex-col items-center justify-center rounded-md border px-2 shrink-0 gap-1 self-stretch w-[88px] transition-transform duration-75 active:translate-y-[2px] cursor-pointer ${buttonBorderClass}`}
              >
                {buttonIcon}
                <span className="font-mono text-[8px] font-bold uppercase tracking-wide leading-none whitespace-nowrap">{buttonLabel}</span>
                {stage && <StageTag stage={stage} className="mt-0.5" />}
              </button>
              <div className="flex-1 relative pt-1 pb-1.5">
                <div className="absolute left-0 right-0 top-[18px] h-px bg-gradient-to-r from-gray-700/10 via-gray-500/30 to-gray-700/10 pointer-events-none" />
                <div className="flex items-start">
                  {statuses.map(({ key, label, count, lampColor }) => {
                    const isActive = count > 0;
                    return (
                      <div
                        key={key}
                        data-testid={`directive-inv-${key}`}
                        className="flex-1 flex flex-col items-center gap-0.5 py-0"
                      >
                        <span className={cn("font-mono text-[9px] uppercase tracking-wide leading-none whitespace-nowrap", isActive ? "text-gray-300" : "text-gray-400")}>{label}</span>
                        <div
                          style={isActive ? {
                            '--lamp-color': lampColor,
                            backgroundColor: lampColor,
                            boxShadow: `0 0 7px ${lampColor}, 0 0 16px ${lampColor}55`,
                          } as React.CSSProperties : undefined}
                          className={cn(
                            "w-3 h-3 rounded-full z-10 ring-1 shrink-0",
                            isActive ? "panel-lamp-active ring-white/20" : "bg-gray-600/50 ring-gray-500/40"
                          )}
                        />
                        <span className={cn("font-mono text-[8px] font-bold leading-none", isActive ? "text-white" : "text-gray-400")}>{count}</span>
                      </div>
                    );
                  })}
                  {trailingContent}
                </div>
              </div>
            </div>
          );

          return (
            <div
              className={cn(
                "relative rounded-lg border transition-all",
                isCompact ? "p-3" : "p-2 md:p-3",
                pomHasActivity || lomHasActivity
                  ? "border-blue-400/55 shadow-[0_3px_0_rgba(0,0,0,0.55),0_0_18px_rgba(59,130,246,0.18)]"
                  : "border-gray-600/55 shadow-[0_3px_0_rgba(0,0,0,0.45),0_0_10px_rgba(59,130,246,0.08)]"
              )}
              style={{ background: 'linear-gradient(175deg, #0f2240 0%, #0a1630 100%)' }}
              data-testid="section-command-central-inventory"
            >
              <div className={cn("absolute top-0 left-0 right-0 h-[2px] rounded-t-lg", pomHasActivity || lomHasActivity ? "bg-gradient-to-r from-blue-600/40 via-blue-400/70 to-blue-600/40" : "bg-gradient-to-r from-transparent via-gray-500/25 to-transparent")} />

              <div className="space-y-3">
              {/* Header */}
              <div className="flex items-center gap-1.5 mb-0.5">
                <div className="rounded bg-blue-800/70 ring-1 ring-blue-500/55 shrink-0 p-1">
                  <Crosshair className="w-3 h-3 text-blue-200" />
                </div>
                <h3 className="text-[10px] font-semibold text-blue-200/80 uppercase tracking-widest flex-1">Command Central</h3>
              </div>

              {/* Price-o-Matic pipeline */}
              {showPriceOMatic && (
              <PipelineRow
                buttonIcon={<Rocket className="w-3.5 h-3.5 text-blue-200" />}
                buttonLabel="Price-o-Matic"
                stage={tagStage('inv_price_o_matic')}
                buttonStyle={{
                  background: 'linear-gradient(180deg, rgba(37,99,235,0.45) 0%, rgba(29,78,216,0.28) 100%)',
                  boxShadow: '0 3px 0 rgba(15,35,100,0.65), inset 0 1px 0 rgba(147,197,253,0.10)',
                }}
                buttonBorderClass="border-blue-500/55"
                onButtonClick={() => onDrawerChange('priceomatic')}
                testId="button-inv-priceomatic"
                statuses={[
                  { key: 'in-orbit',   label: 'In Orbit',   count: inOrbitCount,   lampColor: 'rgba(56,189,248,0.9)'  },
                  { key: 'mission',    label: 'Mission',     count: missionCount,   lampColor: 'rgba(251,191,36,0.9)'  },
                  { key: 'deep-space', label: 'Deep Space',  count: deepSpaceCount, lampColor: 'rgba(167,139,250,0.9)' },
                ]}
              />
              )}

              <div className="h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />

              {/* List-o-Matic pipeline */}
              {showListOMatic && (
              <PipelineRow
                buttonIcon={<ListOrdered className="w-3.5 h-3.5 text-teal-200" />}
                buttonLabel="List-o-Matic"
                stage={tagStage('inv_list_o_matic')}
                buttonStyle={{
                  background: 'linear-gradient(180deg, rgba(13,148,136,0.45) 0%, rgba(15,118,110,0.28) 100%)',
                  boxShadow: '0 3px 0 rgba(5,60,55,0.65), inset 0 1px 0 rgba(153,246,228,0.10)',
                }}
                buttonBorderClass="border-teal-500/55"
                onButtonClick={() => onDrawerChange('platformsync')}
                testId="button-inv-listomatic"
                statuses={[
                  // Filing section only: a fixed "Unfiled" bubble (lots
                  // with no bin and no rtf marker) followed by one bubble
                  // per active rtf tote. Empty totes are dropped server-
                  // side so the row only shows work that exists.
                  { key: 'lom-unf', label: 'Unfiled', count: unfiledCount, lampColor: 'rgba(248,113,113,0.9)' },
                  ...rtfBuckets.map((b, i) => ({
                    key: `lom-rtf-${b.rtfBin}`,
                    label: `rtf ${b.rtfBin}`,
                    count: b.count,
                    lampColor: RTF_LAMPS[i % RTF_LAMPS.length],
                  })),
                ]}
                trailingContent={rtfBuckets.length === 0 ? (
                  // Inbox-zero hug for the rtf section — when every tote is
                  // drained the row otherwise looks oddly empty, so tell the
                  // filer outright that there's nothing waiting.
                  <div
                    className="flex-1 flex items-center justify-center gap-1.5 px-2 py-0"
                    data-testid="status-rtf-all-filed"
                  >
                    <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span className="font-mono text-[9px] uppercase tracking-wide text-emerald-300/90 whitespace-nowrap">
                      All rtf filed
                    </span>
                  </div>
                ) : undefined}
              />
              )}
              </div>
            </div>
          );
        })()}
      </>}
      {(!tvSplit || tvSplit === 'right') && <>

        {/* SYSTEMS / UPLINK tab panel */}
        <div className={cn("relative rounded-lg border border-blue-400/45 shadow-[0_3px_0_rgba(0,0,0,0.45),0_0_14px_rgba(59,130,246,0.12)]", isCompact ? "p-2" : "p-2.5 xl:p-3")} style={{ background: 'linear-gradient(175deg, #0f2240 0%, #0a1630 100%)' }} data-testid="section-panel-tabs">
          <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-lg bg-gradient-to-r from-transparent via-blue-400/40 to-transparent" />

          {/* CC-style header row */}
          <div className={cn("flex items-center gap-2", isCompact ? "mb-2" : "mb-2.5")} data-testid="control-panel-tabs">
            <div className="rounded-md ring-1 shrink-0 p-1 bg-blue-900/55 ring-blue-500/40">
              <Sparkles className="w-3 h-3 text-blue-200" />
            </div>
            <h3 className="text-[10px] font-semibold uppercase tracking-wide flex-1 text-blue-200/80">
              {panelTab === 'systems' ? 'Inventory Station' : 'Selling Channels'}
            </h3>
            <div className="flex items-center rounded border border-gray-700/60 bg-black/40 overflow-hidden shrink-0">
              <button
                onClick={() => setPanelTab('systems')}
                data-testid="tab-systems"
                className={cn(
                  "font-mono text-[9px] font-bold uppercase tracking-[0.1em] px-2 py-0.5 transition-colors duration-150",
                  panelTab === 'systems' ? "bg-gray-700/80 text-gray-200" : "text-gray-600 hover:text-gray-400"
                )}
              >Station</button>
              <div className="w-px self-stretch bg-gray-700/60" />
              <button
                onClick={() => setPanelTab('uplink')}
                data-testid="tab-uplink"
                className={cn(
                  "relative flex items-center gap-1 font-mono text-[9px] font-bold uppercase tracking-[0.1em] px-2 py-0.5 transition-colors duration-150",
                  panelTab === 'uplink' ? "bg-gray-700/80 text-gray-200" : "text-gray-600 hover:text-gray-400"
                )}
              >
                Channels
                {(hasChannelErrors || inventorySyncIssueCount > 0) && panelTab !== 'uplink' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse flex-shrink-0" data-testid="badge-channel-errors" />
                )}
              </button>
            </div>
          </div>

          {/* STATION — Tools grid */}
          {panelTab === 'systems' && (
          <div className={cn("grid grid-cols-2", isCompact ? "gap-1.5" : "gap-2")} data-testid="section-tools">

            {showBrickSpotter && (
            <StationTool
              icon={Crosshair}
              label="Brick Spotter"
              hex="#f59e0b"
              glowRgb="245,158,11"
              isCompact={isCompact}
              onClick={() => onDrawerChange('brickanalyzer')}
              stage={tagStage('inv_brick_spotter')}
              testId="tool-brickspotter"
            />
            )}

            {showInventoryHealth && (
            <StationTool
              icon={Gauge}
              label="Inventory Health"
              hex="#06b6d4"
              glowRgb="6,182,212"
              isCompact={isCompact}
              onClick={() => onDrawerChange('inventoryhealth')}
              stage={tagStage('inv_health')}
              testId="tool-inventoryhealth"
            />
            )}

            {showBundleTron && (
            <StationTool
              icon={Bot}
              label="BundleTron"
              hex="#f97316"
              glowRgb="249,115,22"
              isCompact={isCompact}
              onClick={() => onDrawerChange('bundletron')}
              stage={tagStage('inv_bundletron')}
              testId="tool-bundletron"
            />
            )}

            {showAcquisition && (
            <StationTool
              icon={Atom}
              label="Acquisition Evaluator"
              hex="#8b5cf6"
              glowRgb="139,92,246"
              isCompact={isCompact}
              onClick={() => onDrawerChange('acquisition-evaluator')}
              stage={tagStage('inv_acquisition')}
              testId="tool-acquisition-evaluator"
            />
            )}

            {showCargoBay && (
            <StationTool
              icon={Warehouse}
              label="Cargo Bay"
              hex="#10b981"
              glowRgb="16,185,129"
              isCompact={isCompact}
              onClick={() => onDrawerChange('warehouse')}
              stage={tagStage('inv_cargo_bay')}
              testId="tool-cargo-bay"
            />
            )}

          </div>
          )}

          {/* UPLINK — Selling Channels */}
          {panelTab === 'uplink' && (
            <div className="flex flex-col gap-2" data-testid="section-selling-channels">
              <BrickLinkSyncPanel onOpenSettings={onOpenSettings} />
              <ChannelSyncPanel channel="brickowl" onOpenSettings={onOpenSettings} />
              {showEbayChannel && <ChannelSyncPanel channel="ebay" onOpenSettings={onOpenSettings} />}
              {isCompact && <DashboardNotifications groupKeys={['product']} />}
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
              <Layers className="w-4 h-4 text-blue-400 flex-shrink-0" />
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
                          {row.alternateOf && <span className="text-[10px] px-1 py-0 rounded bg-purple-900/40 text-purple-300 border border-purple-700/30" title={`Alternate of ${row.alternateOf}`}>Alt</span>}
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

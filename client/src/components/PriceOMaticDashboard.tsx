import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {  
  Sparkles,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  RefreshCw,
  ChevronDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PomSpotLookup } from "@/components/PomSpotLookup";

interface SyncStatus {
  id: string;
  lastSyncStatus: string;
  lastSyncTime: string | null;
  recordsUpdated: number;
  errorMessage?: string | null;
  callsLast24h?: number;
}

interface PricingInsight {
  inventoryId: number;
  itemNo: string;
  itemName: string | null;
  itemType: string;
  colorId: number | null;
  colorName: string | null;
  newOrUsed: string;
  currentPrice: string;
  myCost?: string | null;
  suggestedPrice: string;
  marketPrice?: string;
  floorApplied?: 'cost' | 'min' | 'none';
  stockAvgPrice: string;
  soldMaxPrice?: string | null;
  marketPeakSoldPrice?: string | null;
  opportunityScore: number | null;
  variance: number;
  quantity: number;
  lastFetched: string;
  category: 'too_high' | 'too_low' | 'good';
}

interface InsightsData {
  tooHigh: PricingInsight[];
  tooLow: PricingInsight[];
  wellPriced: PricingInsight[];
  summary: {
    total: number;
    tooHigh: number;
    tooLow: number;
    wellPriced: number;
  };
}

interface GroupedInsight {
  key: string;
  itemNo: string;
  itemName: string | null;
  colorId: number | null;
  colorName: string | null;
  marketPeakSoldPrice: number | null;
  newLot: PricingInsight | null;
  usedLot: PricingInsight | null;
  newScore: number;
  usedScore: number;
}

interface PriceOMaticDashboardProps {
  onItemClick?: (type: 'inventory' | 'order', id: number) => void;
}

export default function PriceOMaticDashboard({ onItemClick }: PriceOMaticDashboardProps) {
  const { toast } = useToast();
  const [selectedCategory, setSelectedCategory] = useState<'too-high' | 'too-low' | 'good'>('too-high');
  const [itemsToShow, setItemsToShow] = useState(50);
  const [refreshingItems, setRefreshingItems] = useState<Set<number>>(new Set());
  const [sortField, setSortField] = useState<'new' | 'used'>('new');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const refreshItemMutation = useMutation({
    mutationFn: async (item: { itemNo: string; itemType: string; colorId: number | null; newOrUsed: string; inventoryId: number }) => {
      const params = new URLSearchParams({
        partNo: item.itemNo,
        itemType: item.itemType,
        newOrUsed: item.newOrUsed,
        forceRefresh: 'true',
      });
      if (item.colorId != null) params.set('colorId', item.colorId.toString());
      return await apiRequest("GET", `/api/pom/spot-lookup?${params}`);
    },
    onMutate: (item) => {
      setRefreshingItems(prev => new Set([...prev, item.inventoryId]));
    },
    onSettled: (_data, _err, item) => {
      setRefreshingItems(prev => { const next = new Set(prev); next.delete(item.inventoryId); return next; });
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ['/api/priceomatic/insights'] });
      toast({ title: "Refreshed", description: "Price data updated from BrickLink" });
    },
    onError: () => {
      toast({ title: "Refresh failed", description: "Could not reach BrickLink", variant: "destructive" });
    },
  });

  const { data: insights, isLoading: insightsLoading } = useQuery<{ success: boolean; data: InsightsData }>({
    queryKey: ['/api/priceomatic/insights'],
    refetchOnMount: 'always',
    staleTime: 0,
  });

  const { data: settingsData } = useQuery<any>({
    queryKey: ['/api/settings'],
  });

  const insightsData = insights?.data;
  const tooHighPct = settingsData?.pomTooHighThreshold ?? 20;
  const tooLowPct = settingsData?.pomTooLowThreshold ?? 20;

  const formatCurrency = (value: string | number | null | undefined) => {
    if (value == null) return '—';
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    }).format(num);
  };

  const scoreColor = (score: number | null) => {
    if (score === null) return 'text-gray-600';
    if (score >= 2.0) return 'text-emerald-400';
    if (score >= 1.5) return 'text-orange-400';
    if (score >= 1.0) return 'text-yellow-500';
    return 'text-gray-500';
  };

  const getSelectedGroups = (): GroupedInsight[] => {
    if (!insightsData) return [];

    // Merge all lots so sibling conditions are visible in any filter view
    const allItems = [...insightsData.tooHigh, ...insightsData.tooLow, ...insightsData.wellPriced];

    const map = new Map<string, GroupedInsight>();
    for (const item of allItems) {
      const key = `${item.itemNo}_${item.colorId ?? 'null'}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          itemNo: item.itemNo,
          itemName: item.itemName,
          colorId: item.colorId,
          colorName: item.colorName,
          marketPeakSoldPrice: item.marketPeakSoldPrice != null ? parseFloat(String(item.marketPeakSoldPrice)) : null,
          newLot: null,
          usedLot: null,
          newScore: 0,
          usedScore: 0,
        });
      }
      const g = map.get(key)!;
      if (item.newOrUsed === 'N') {
        g.newLot = item;
        g.newScore = item.opportunityScore ?? 0;
      } else {
        g.usedLot = item;
        g.usedScore = item.opportunityScore ?? 0;
      }
    }

    let groups = Array.from(map.values());

    // Filter: group qualifies if at least one lot matches the selected category
    if (selectedCategory === 'too-high') {
      groups = groups.filter(g =>
        g.newLot?.category === 'too_high' || g.usedLot?.category === 'too_high'
      );
    } else if (selectedCategory === 'too-low') {
      groups = groups.filter(g =>
        g.newLot?.category === 'too_low' || g.usedLot?.category === 'too_low'
      );
    } else {
      groups = groups.filter(g =>
        (g.newLot == null || g.newLot.category === 'good') &&
        (g.usedLot == null || g.usedLot.category === 'good')
      );
    }

    // Sort by selected condition score; groups with no lot for that condition go last
    return groups.sort((a, b) => {
      const aHas = sortField === 'new' ? a.newLot != null : a.usedLot != null;
      const bHas = sortField === 'new' ? b.newLot != null : b.usedLot != null;
      if (!aHas && bHas) return 1;
      if (aHas && !bHas) return -1;
      const aScore = sortField === 'new' ? a.newScore : a.usedScore;
      const bScore = sortField === 'new' ? b.newScore : b.usedScore;
      return sortDir === 'desc' ? bScore - aScore : aScore - bScore;
    });
  };

  const selectedGroups = getSelectedGroups();

  useEffect(() => {
    setItemsToShow(50);
  }, [selectedCategory, sortField, sortDir]);

  const SortButton = ({ field, label }: { field: 'new' | 'used'; label: string }) => {
    const active = sortField === field;
    const toggle = () => {
      if (active) {
        setSortDir(d => d === 'desc' ? 'asc' : 'desc');
      } else {
        setSortField(field);
        setSortDir('desc');
      }
    };
    return (
      <button
        onClick={toggle}
        className={`flex items-center gap-0.5 text-[9px] uppercase tracking-wider rounded px-1.5 py-0.5 transition-colors ${
          active ? 'bg-purple-500/20 text-purple-300' : 'text-gray-600 hover:text-gray-400'
        }`}
        data-testid={`button-sort-${field}`}
      >
        {label}
        {active && (sortDir === 'desc'
          ? <ArrowDown className="w-2.5 h-2.5" />
          : <ArrowUp className="w-2.5 h-2.5" />
        )}
      </button>
    );
  };

  return (
    <div className="space-y-4">

      {/* Spot Price Lookup */}
      <PomSpotLookup formatCurrency={formatCurrency} />

      {/* Filter tiles */}
      <div className="flex gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setSelectedCategory('too-high')}
              data-testid="stat-too-high"
              className={`flex-1 flex items-center justify-between gap-2 p-3 rounded-lg text-xs hover-elevate whitespace-nowrap cursor-pointer ${
                selectedCategory === 'too-high'
                  ? 'bg-red-500/20 border-2 border-red-500/50'
                  : 'bg-gray-800/30 border-2 border-gray-700'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <TrendingUp className={`w-3.5 h-3.5 flex-shrink-0 ${selectedCategory === 'too-high' ? 'text-red-400' : 'text-gray-500'}`} />
                <span className={`text-xs font-semibold ${selectedCategory === 'too-high' ? 'text-red-300' : 'text-gray-400'}`}>Too High</span>
              </div>
              {insightsLoading ? (
                <Skeleton className="h-5 w-6" />
              ) : (
                <span className={`text-base font-mono font-bold tabular-nums ${selectedCategory === 'too-high' ? 'text-red-400' : 'text-gray-300'}`}>
                  {insightsData?.summary.tooHigh ?? 0}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-56 text-xs">
            Items priced more than {tooHighPct}% above suggested — losing sales to cheaper competitors. Click to review.
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setSelectedCategory('too-low')}
              data-testid="stat-too-low"
              className={`flex-1 flex items-center justify-between gap-2 p-3 rounded-lg text-xs hover-elevate whitespace-nowrap cursor-pointer ${
                selectedCategory === 'too-low'
                  ? 'bg-orange-500/20 border-2 border-orange-500/50'
                  : 'bg-gray-800/30 border-2 border-gray-700'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <TrendingDown className={`w-3.5 h-3.5 flex-shrink-0 ${selectedCategory === 'too-low' ? 'text-orange-400' : 'text-gray-500'}`} />
                <span className={`text-xs font-semibold ${selectedCategory === 'too-low' ? 'text-orange-300' : 'text-gray-400'}`}>Too Low</span>
              </div>
              {insightsLoading ? (
                <Skeleton className="h-5 w-6" />
              ) : (
                <span className={`text-base font-mono font-bold tabular-nums ${selectedCategory === 'too-low' ? 'text-orange-400' : 'text-gray-300'}`}>
                  {insightsData?.summary.tooLow ?? 0}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-56 text-xs">
            Items priced more than {tooLowPct}% below suggested — leaving margin on the table. Click to review.
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setSelectedCategory('good')}
              data-testid="stat-good"
              className={`flex-1 flex items-center justify-between gap-2 p-3 rounded-lg text-xs hover-elevate whitespace-nowrap cursor-pointer ${
                selectedCategory === 'good'
                  ? 'bg-green-500/20 border-2 border-green-500/50'
                  : 'bg-gray-800/30 border-2 border-gray-700'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <CheckCircle className={`w-3.5 h-3.5 flex-shrink-0 ${selectedCategory === 'good' ? 'text-green-400' : 'text-gray-500'}`} />
                <span className={`text-xs font-semibold ${selectedCategory === 'good' ? 'text-green-300' : 'text-gray-400'}`}>On Target</span>
              </div>
              {insightsLoading ? (
                <Skeleton className="h-5 w-6" />
              ) : (
                <span className={`text-base font-mono font-bold tabular-nums ${selectedCategory === 'good' ? 'text-green-400' : 'text-gray-300'}`}>
                  {insightsData?.summary.wellPriced ?? 0}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-56 text-xs">
            Items within ±{Math.max(tooHighPct, tooLowPct)}% of suggested — optimal range, no action needed. Click to review.
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Item list */}
      {insightsData && (
        <div className="space-y-1.5">
          {selectedGroups.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-xs">No items in this category</p>
            </div>
          ) : (
            <>
              {/* Column headers with sort controls */}
              <div className="flex items-center gap-1 px-2 pb-0.5">
                <span className="text-[9px] uppercase tracking-wider text-gray-600 flex-1 min-w-0">Color · Peak</span>
                {/* New column */}
                <div className="flex items-center gap-0.5 w-[108px] justify-end">
                  <SortButton field="new" label="New" />
                  <span className="text-[9px] text-gray-700 w-3 text-center">/</span>
                  <span className="text-[9px] uppercase tracking-wider text-gray-700 w-10 text-right">Score</span>
                </div>
                {/* Used column */}
                <div className="flex items-center gap-0.5 w-[108px] justify-end">
                  <SortButton field="used" label="Used" />
                  <span className="text-[9px] text-gray-700 w-3 text-center">/</span>
                  <span className="text-[9px] uppercase tracking-wider text-gray-700 w-10 text-right">Score</span>
                </div>
                <span className="text-[9px] uppercase tracking-wider text-gray-600 w-5 text-right">Qty</span>
              </div>

              {selectedGroups.slice(0, itemsToShow).map((group) => {
                const primaryLot = group.newLot ?? group.usedLot;
                return (
                  <div
                    key={group.key}
                    className="group bg-gray-900/50 border border-gray-700 rounded-lg px-2 py-1.5 hover-elevate active-elevate-2 cursor-pointer"
                    data-testid={`item-group-${group.key}`}
                    onClick={() => {
                      if (primaryLot) onItemClick?.('inventory', primaryLot.inventoryId);
                    }}
                  >
                    {/* Row 1: Part number + Item name + refresh */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono text-[10px] text-white flex-shrink-0">{group.itemNo}</span>
                      <p className="text-xs text-gray-400 truncate flex-1 min-w-0">{group.itemName || 'Unknown Item'}</p>
                      {primaryLot && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const lots = [group.newLot, group.usedLot].filter(Boolean) as PricingInsight[];
                                lots.forEach(lot => refreshItemMutation.mutate({
                                  inventoryId: lot.inventoryId,
                                  itemNo: lot.itemNo,
                                  itemType: lot.itemType,
                                  colorId: lot.colorId,
                                  newOrUsed: lot.newOrUsed,
                                }));
                              }}
                              disabled={[group.newLot, group.usedLot].some(l => l && refreshingItems.has(l.inventoryId))}
                              className="invisible group-hover:visible text-gray-600 hover:text-purple-400 disabled:text-gray-700 transition-colors flex-shrink-0"
                              data-testid={`button-refresh-group-${group.key}`}
                            >
                              <RefreshCw className={`w-2.5 h-2.5 ${[group.newLot, group.usedLot].some(l => l && refreshingItems.has(l.inventoryId)) ? 'animate-spin text-purple-400 visible' : ''}`} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="text-xs">
                            Refresh BrickLink price data (3 API calls per condition)
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>

                    {/* Row 2: Color · Peak sold | New price / score | Used price / score | qty */}
                    <div className="flex items-center gap-1 mt-0.5 min-w-0">
                      {/* Color + market peak */}
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <span className="text-[10px] text-gray-500 truncate">{group.colorName || '—'}</span>
                        {group.marketPeakSoldPrice != null && (
                          <span className="text-[9px] text-gray-600 flex-shrink-0">
                            · peak {formatCurrency(group.marketPeakSoldPrice)}
                          </span>
                        )}
                      </div>

                      {/* New: price / score */}
                      <div
                        className="flex items-center gap-1 w-[108px] justify-end flex-shrink-0"
                        onClick={(e) => { if (group.newLot) { e.stopPropagation(); onItemClick?.('inventory', group.newLot.inventoryId); } }}
                      >
                        {group.newLot ? (
                          <>
                            <span className="text-[10px] font-mono text-gray-300">{formatCurrency(group.newLot.currentPrice)}</span>
                            <span className="text-[9px] text-gray-700">/</span>
                            <span className={`text-[10px] font-mono font-bold w-10 text-right ${scoreColor(group.newLot.opportunityScore)}`}>
                              {group.newLot.opportunityScore != null ? `${group.newLot.opportunityScore}×` : '—'}
                            </span>
                          </>
                        ) : (
                          <span className="text-[10px] text-gray-700 w-full text-right">—</span>
                        )}
                      </div>

                      {/* Used: price / score */}
                      <div
                        className="flex items-center gap-1 w-[108px] justify-end flex-shrink-0"
                        onClick={(e) => { if (group.usedLot) { e.stopPropagation(); onItemClick?.('inventory', group.usedLot.inventoryId); } }}
                      >
                        {group.usedLot ? (
                          <>
                            <span className="text-[10px] font-mono text-gray-300">{formatCurrency(group.usedLot.currentPrice)}</span>
                            <span className="text-[9px] text-gray-700">/</span>
                            <span className={`text-[10px] font-mono font-bold w-10 text-right ${scoreColor(group.usedLot.opportunityScore)}`}>
                              {group.usedLot.opportunityScore != null ? `${group.usedLot.opportunityScore}×` : '—'}
                            </span>
                          </>
                        ) : (
                          <span className="text-[10px] text-gray-700 w-full text-right">—</span>
                        )}
                      </div>

                      {/* Qty (sum of all conditions) */}
                      <span className="text-[10px] font-mono text-gray-500 w-5 text-right flex-shrink-0">
                        ×{(group.newLot?.quantity ?? 0) + (group.usedLot?.quantity ?? 0)}
                      </span>
                    </div>
                  </div>
                );
              })}

              {selectedGroups.length > itemsToShow && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setItemsToShow(prev => prev + 50)}
                  className="w-full gap-2"
                  data-testid="button-show-more"
                >
                  <ChevronDown className="w-4 h-4" />
                  Show More ({selectedGroups.length - itemsToShow} remaining)
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {!insightsData && !insightsLoading && (
        <div className="text-center py-12">
          <Sparkles className="w-10 h-10 text-purple-400 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-white mb-1">No Data Yet</h3>
          <p className="text-xs text-gray-400 mb-3">
            Run your first sync to analyze pricing
          </p>
          <p className="text-xs text-gray-500">Use the refresh button in the header to run your first sync.</p>
        </div>
      )}
    </div>
  );
}

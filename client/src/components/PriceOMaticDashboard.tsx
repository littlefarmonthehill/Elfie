import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {  
  Sparkles,
  RefreshCw,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  DollarSign,
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
  isSyncRunning?: boolean;
}

export default function PriceOMaticDashboard({ onItemClick, isSyncRunning }: PriceOMaticDashboardProps) {
  const { toast } = useToast();
  const [itemsToShow, setItemsToShow] = useState(25);
  const [refreshingItems, setRefreshingItems] = useState<Set<number>>(new Set());
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [pricingData, setPricingData] = useState<Map<string, { n: string | null; u: string | null }>>(new Map());
  const [pricingLoading, setPricingLoading] = useState<Set<string>>(new Set());

  const fetchPricingMutation = useMutation({
    mutationFn: async (group: GroupedInsight) => {
      const lots = [
        group.newLot ? { lot: group.newLot, condition: 'n' as const } : null,
        group.usedLot ? { lot: group.usedLot, condition: 'u' as const } : null,
      ].filter(Boolean) as { lot: PricingInsight; condition: 'n' | 'u' }[];

      const results: { n: string | null; u: string | null } = { n: null, u: null };
      await Promise.all(lots.map(async ({ lot, condition }) => {
        const data = await apiRequest("POST", "/api/priceomatic/fetch-pricing", {
          itemNo: lot.itemNo,
          itemType: lot.itemType,
          colorId: lot.colorId,
          newOrUsed: lot.newOrUsed,
        });
        results[condition] = data.suggestedPrice ?? null;
      }));
      return { key: group.key, results };
    },
    onMutate: (group) => {
      setPricingLoading(prev => new Set([...prev, group.key]));
    },
    onSettled: (_data, _err, group) => {
      setPricingLoading(prev => { const next = new Set(prev); next.delete(group.key); return next; });
    },
    onSuccess: ({ key, results }) => {
      setPricingData(prev => new Map(prev).set(key, results));
    },
    onError: () => {
      toast({ title: "Pricing failed", description: "Could not fetch suggested price from BrickLink", variant: "destructive" });
    },
  });

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
    refetchInterval: isSyncRunning ? 5000 : false,
  });

  const { data: settingsData } = useQuery<any>({
    queryKey: ['/api/settings'],
  });

  const insightsData = insights?.data;

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

    // Merge all lots (all categories) into unified groups
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

    const groups = Array.from(map.values());

    // Sort by the highest score between N and U for each group
    return groups.sort((a, b) => {
      const aScore = Math.max(a.newScore, a.usedScore);
      const bScore = Math.max(b.newScore, b.usedScore);
      return sortDir === 'desc' ? bScore - aScore : aScore - bScore;
    });
  };

  const selectedGroups = getSelectedGroups();

  useEffect(() => {
    setItemsToShow(25);
  }, [sortDir]);

  const ScoreSortButton = () => (
    <button
      onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
      className="flex items-center gap-0.5 text-[9px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-500/20 text-purple-300 whitespace-nowrap w-[52px]"
      data-testid="button-sort-score"
    >
      Score
      {sortDir === 'desc'
        ? <ArrowDown className="w-2.5 h-2.5 ml-0.5" />
        : <ArrowUp className="w-2.5 h-2.5 ml-0.5" />
      }
    </button>
  );

  return (
    <div className="space-y-4">

      {/* Spot Price Lookup */}
      <PomSpotLookup formatCurrency={formatCurrency} />

      {/* Item list */}
      {insightsData && (
        <div className="space-y-1.5">
          {selectedGroups.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-xs">No items found</p>
            </div>
          ) : (
            <>
              {/* Column headers */}
              <div className="flex items-center gap-1 px-2 pb-0.5">
                <ScoreSortButton />
                <div className="flex-1 min-w-0" />
                <span className="text-[9px] uppercase tracking-wider text-gray-400 w-14 text-right flex-shrink-0">N Cur</span>
                <span className="text-[9px] uppercase tracking-wider text-gray-400 w-[52px] text-right flex-shrink-0">N Score</span>
                <span className="text-[9px] uppercase tracking-wider text-gray-400 w-14 text-right flex-shrink-0">U Cur</span>
                <span className="text-[9px] uppercase tracking-wider text-gray-400 w-[52px] text-right flex-shrink-0">U Score</span>
                <span className="w-5 flex-shrink-0" />
              </div>

              {selectedGroups.slice(0, itemsToShow).map((group) => {
                const primaryLot = group.newLot ?? group.usedLot;
                return (
                  <div
                    key={group.key}
                    className="group relative bg-gradient-to-br from-blue-950/50 via-slate-800/70 to-blue-900/30 border border-blue-700/25 rounded-lg px-2 py-1.5 cursor-pointer shadow-[0_2px_8px_rgba(15,40,100,0.35),inset_0_1px_0_rgba(147,197,253,0.07)] hover:shadow-[0_4px_14px_rgba(15,40,100,0.5),inset_0_1px_0_rgba(147,197,253,0.12)] hover:border-blue-600/40 transition-shadow duration-150"
                    data-testid={`item-group-${group.key}`}
                    onClick={() => {
                      if (primaryLot) onItemClick?.('inventory', primaryLot.inventoryId);
                    }}
                  >
                    {/* Row 1: Part number + Item name + buttons */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono text-[10px] text-blue-200/80 flex-shrink-0">{group.itemNo}</span>
                      <p className="text-xs text-slate-300 truncate flex-1 min-w-0">{group.itemName || 'Unknown Item'}</p>
                      {primaryLot && (
                        <div className="invisible group-hover:visible flex items-center gap-0.5 flex-shrink-0">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  fetchPricingMutation.mutate(group);
                                }}
                                disabled={pricingLoading.has(group.key)}
                                className="text-gray-600 hover:text-purple-400 disabled:text-gray-700 transition-colors"
                                data-testid={`button-price-group-${group.key}`}
                              >
                                <DollarSign className={`w-2.5 h-2.5 ${pricingLoading.has(group.key) ? 'animate-pulse text-purple-400' : ''}`} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-xs">
                              Get suggested price (2 API calls)
                            </TooltipContent>
                          </Tooltip>
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
                                className="text-gray-600 hover:text-gray-400 disabled:text-gray-700 transition-colors"
                                data-testid={`button-refresh-group-${group.key}`}
                              >
                                <RefreshCw className={`w-2.5 h-2.5 ${[group.newLot, group.usedLot].some(l => l && refreshingItems.has(l.inventoryId)) ? 'animate-spin text-purple-400' : ''}`} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-xs">
                              Refresh score data (2 API calls per condition)
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      )}
                    </div>

                    {/* Row 2: Qty · Color · Peak — full width, no score */}
                    <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                      <span className="text-[10px] font-mono text-slate-400 flex-shrink-0">
                        ×{(group.newLot?.quantity ?? 0) + (group.usedLot?.quantity ?? 0)}
                      </span>
                      <span className="text-[10px] text-slate-400 truncate min-w-0 flex-1">{group.colorName || '—'}</span>
                      {group.marketPeakSoldPrice != null && (
                        <span className="text-[9px] text-blue-400/70 flex-shrink-0 whitespace-nowrap">
                          peak {formatCurrency(group.marketPeakSoldPrice)}
                        </span>
                      )}
                    </div>

                    {/* Row 3: Score (left) | N Cur | N Score | U Cur | U Score */}
                    <div className="flex items-center gap-1 mt-0.5 min-w-0">
                      {/* Overall best score — left-aligned, matches header sort button */}
                      {(() => {
                        const maxScore = Math.max(group.newScore ?? 0, group.usedScore ?? 0);
                        const hasScore = (group.newLot?.opportunityScore != null) || (group.usedLot?.opportunityScore != null);
                        return (
                          <span className={`text-[11px] font-mono font-bold flex-shrink-0 w-[52px] ${hasScore ? scoreColor(maxScore) : 'text-slate-600'}`}>
                            {hasScore ? `${maxScore}×` : '—'}
                          </span>
                        );
                      })()}
                      <div className="flex-1 min-w-0" />

                      {/* New: current price + suggested if fetched */}
                      <div
                        className="flex flex-col items-end w-14 flex-shrink-0 cursor-pointer"
                        onClick={(e) => { if (group.newLot) { e.stopPropagation(); onItemClick?.('inventory', group.newLot.inventoryId); } }}
                      >
                        {group.newLot ? (
                          <>
                            <span className="text-[10px] font-mono text-slate-300 leading-tight">{formatCurrency(group.newLot.currentPrice)}</span>
                            {pricingData.get(group.key)?.n && (
                              <span className="text-[9px] font-mono text-purple-400 leading-tight">{formatCurrency(pricingData.get(group.key)!.n)}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-[10px] text-slate-700">—</span>
                        )}
                      </div>

                      {/* New score */}
                      <span className={`text-[10px] font-mono font-bold text-right flex-shrink-0 w-[52px] ${group.newLot ? scoreColor(group.newLot.opportunityScore) : 'text-slate-700'}`}>
                        {group.newLot?.opportunityScore != null ? `${group.newLot.opportunityScore}×` : '—'}
                      </span>

                      {/* Used: current price + suggested if fetched */}
                      <div
                        className="flex flex-col items-end w-14 flex-shrink-0 cursor-pointer"
                        onClick={(e) => { if (group.usedLot) { e.stopPropagation(); onItemClick?.('inventory', group.usedLot.inventoryId); } }}
                      >
                        {group.usedLot ? (
                          <>
                            <span className="text-[10px] font-mono text-slate-300 leading-tight">{formatCurrency(group.usedLot.currentPrice)}</span>
                            {pricingData.get(group.key)?.u && (
                              <span className="text-[9px] font-mono text-purple-400 leading-tight">{formatCurrency(pricingData.get(group.key)!.u)}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-[10px] text-slate-700">—</span>
                        )}
                      </div>

                      {/* Used score */}
                      <span className={`text-[10px] font-mono font-bold text-right flex-shrink-0 w-[52px] ${group.usedLot ? scoreColor(group.usedLot.opportunityScore) : 'text-slate-700'}`}>
                        {group.usedLot?.opportunityScore != null ? `${group.usedLot.opportunityScore}×` : '—'}
                      </span>

                      {/* Spacer to keep widths consistent with header */}
                      <span className="w-5 flex-shrink-0" />
                    </div>
                  </div>
                );
              })}

              {selectedGroups.length > itemsToShow && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setItemsToShow(prev => prev + 25)}
                  className="w-full gap-2"
                  data-testid="button-show-more"
                >
                  <ChevronDown className="w-4 h-4" />
                  Show 25 more ({selectedGroups.length - itemsToShow} remaining)
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

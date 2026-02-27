import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {  
  Sparkles,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  RefreshCw,
  AlertCircle,
  ChevronDown,

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
  variance: number;
  quantity: number;
  lastFetched: string;
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

interface PriceOMaticDashboardProps {
  onItemClick?: (type: 'inventory' | 'order', id: number) => void;
}

export default function PriceOMaticDashboard({ onItemClick }: PriceOMaticDashboardProps) {
  const { toast } = useToast();
  const [selectedCategory, setSelectedCategory] = useState<'too-high' | 'too-low' | 'good'>('too-high');
  const [itemsToShow, setItemsToShow] = useState(50);
  const [refreshingItems, setRefreshingItems] = useState<Set<number>>(new Set());

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

  // Fetch pricing insights — always refetch on mount so opening the panel shows current data
  const { data: insights, isLoading: insightsLoading } = useQuery<{ success: boolean; data: InsightsData }>({
    queryKey: ['/api/priceomatic/insights'],
    refetchOnMount: 'always',
    staleTime: 0,
  });

  // Fetch settings to get real thresholds
  const { data: settingsData } = useQuery<any>({
    queryKey: ['/api/settings'],
  });


  const insightsData = insights?.data;

  // Pull real thresholds from settings, fall back to safe defaults
  const tooHighPct = settingsData?.pomTooHighThreshold ?? 20;
  const tooLowPct = settingsData?.pomTooLowThreshold ?? 20;
  const batchSize = settingsData?.pomBatchSize ?? 1500;

  const formatCurrency = (value: string | number) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    }).format(num);
  };

  // Get items for selected category, sorted by variance descending
  const getSelectedItems = (): PricingInsight[] => {
    if (!insightsData) return [];
    
    let items: PricingInsight[] = [];
    if (selectedCategory === 'too-high') items = [...insightsData.tooHigh];
    if (selectedCategory === 'too-low') items = [...insightsData.tooLow];
    if (selectedCategory === 'good') items = [...insightsData.wellPriced];
    
    return items.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
  };

  const selectedItems = getSelectedItems();

  useEffect(() => {
    setItemsToShow(50);
  }, [selectedCategory]);

  return (
    <div className="space-y-4">

      {/* Spot Price Lookup */}
      <PomSpotLookup formatCurrency={formatCurrency} />

      {/* Filter tiles — single line each, Warehouse drawer pattern */}
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
          {selectedItems.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-xs">No items in this category</p>
            </div>
          ) : (
            <>
              {/* Column labels for row 2 */}
              <div className="flex items-center gap-2 px-2 pb-0.5">
                <span className="text-[9px] uppercase tracking-wider text-gray-600 flex-1 min-w-0">Color</span>
                <span className="text-[9px] uppercase tracking-wider text-gray-600 w-14 text-right">Current</span>
                <span className="text-[9px] text-gray-700 w-3 text-center">→</span>
                <span className="text-[9px] uppercase tracking-wider text-gray-600 w-20 text-right">Suggested</span>
                <span className="text-[9px] uppercase tracking-wider text-gray-600 w-10 text-right">Var%</span>
                <span className="text-[9px] uppercase tracking-wider text-gray-600 w-6 text-right">Qty</span>
              </div>

              {selectedItems.slice(0, itemsToShow).map((item) => (
                <div
                  key={item.inventoryId}
                  onClick={() => onItemClick?.('inventory', item.inventoryId)}
                  className="group bg-gray-900/50 border border-gray-700 rounded-lg px-2 py-1.5 hover-elevate active-elevate-2 cursor-pointer"
                  data-testid={`item-${item.inventoryId}`}
                >
                  {/* Row 1: Part number + Item name */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-[10px] text-white flex-shrink-0">{item.itemNo}</span>
                    <p className="text-xs text-gray-400 truncate flex-1 min-w-0">{item.itemName || 'Unknown Item'}</p>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            refreshItemMutation.mutate({
                              inventoryId: item.inventoryId,
                              itemNo: item.itemNo,
                              itemType: item.itemType,
                              colorId: item.colorId,
                              newOrUsed: item.newOrUsed,
                            });
                          }}
                          disabled={refreshingItems.has(item.inventoryId)}
                          className="invisible group-hover:visible text-gray-600 hover:text-purple-400 disabled:text-gray-700 transition-colors flex-shrink-0"
                          data-testid={`button-refresh-item-${item.inventoryId}`}
                        >
                          <RefreshCw className={`w-2.5 h-2.5 ${refreshingItems.has(item.inventoryId) ? 'animate-spin text-purple-400 visible' : ''}`} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-xs">
                        Refresh BrickLink price data for this item (3 API calls)
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  {/* Row 2: Color · current → suggested · variance · qty */}
                  <div className="flex items-center gap-2 mt-0.5 min-w-0">
                    <span className="text-[10px] text-gray-500 flex-1 min-w-0 truncate">{item.colorName || '—'}</span>
                    <span className="text-[10px] font-mono text-gray-300 w-14 text-right">{formatCurrency(item.currentPrice)}</span>
                    <span className="text-[10px] text-gray-600 w-3 text-center">→</span>
                    <span className="text-[10px] font-mono text-purple-400 w-20 text-right">
                      {formatCurrency(item.suggestedPrice)}
                      {item.floorApplied === 'cost' && <span className="text-emerald-500 ml-0.5">↑</span>}
                      {item.floorApplied === 'min' && <span className="text-blue-400 ml-0.5">↑</span>}
                    </span>
                    <span className={`text-[10px] font-mono font-bold w-10 text-right ${
                      item.variance > 0 ? 'text-red-400' : item.variance < 0 ? 'text-orange-400' : 'text-green-400'
                    }`}>
                      {item.variance > 0 ? '+' : ''}{item.variance}%
                    </span>
                    <span className="text-[10px] font-mono text-gray-500 w-6 text-right">×{item.quantity}</span>
                  </div>
                </div>
              ))}
              {selectedItems.length > itemsToShow && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setItemsToShow(prev => prev + 50)}
                  className="w-full gap-2"
                  data-testid="button-show-more"
                >
                  <ChevronDown className="w-4 h-4" />
                  Show More ({selectedItems.length - itemsToShow} remaining)
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

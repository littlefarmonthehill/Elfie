import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {  
  Sparkles,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  Info,
  Square,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
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

  // Fetch sync status
  const { data: syncStatus } = useQuery<{ success: boolean; data: SyncStatus }>({
    queryKey: ['/api/sync/priceomatic/status'],
    refetchInterval: 10000,
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

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/sync/priceomatic', { maxItems: 1500 });
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ['/api/sync/priceomatic/status'] });
      queryClient.refetchQueries({ queryKey: ['/api/priceomatic/insights'] });
      
      toast({
        title: "Sync Started",
        description: "Price analysis running in background",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/sync/priceomatic/stop', {});
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ['/api/sync/priceomatic/status'] });
      toast({ title: "Stop Signal Sent", description: "Sync will halt before the next item." });
    },
    onError: (error: Error) => {
      toast({ title: "Stop Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleSync = () => {
    syncMutation.mutate();
  };

  const handleStop = () => {
    stopMutation.mutate();
  };

  const status = syncStatus?.data;
  const insightsData = insights?.data;

  const isSyncRunning = syncMutation.isPending || status?.lastSyncStatus === 'in_progress';

  // Pull real thresholds from settings, fall back to safe defaults
  const tooHighPct = settingsData?.pomTooHighThreshold ?? 20;
  const tooLowPct = settingsData?.pomTooLowThreshold ?? 20;
  const apiCeiling = settingsData?.pomApiCallLimit ?? 4500;
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
    <div className="flex flex-col h-full">
    {/* ── Fixed top section ── */}
    <div className="flex-shrink-0 px-4 pt-3 pb-2 space-y-2">
      {/* Header row: title + inline API count on left, icons on right */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <Sparkles className="w-4 h-4 text-purple-400 flex-shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white leading-tight">Price-o-Matic</h2>
              {status?.callsLast24h !== undefined && (
                <span className={`text-[10px] font-mono leading-tight ${
                  status.callsLast24h >= apiCeiling * 0.9 ? 'text-red-400' :
                  status.callsLast24h >= apiCeiling * 0.6 ? 'text-orange-400' :
                  'text-gray-600'
                }`}>
                  {status.callsLast24h.toLocaleString()}/{(apiCeiling / 1000).toFixed(1)}k calls
                </span>
              )}
            </div>
            {/* Lightweight sync status below the title */}
            {status && status.lastSyncStatus !== 'never' ? (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 inline-block ${
                  status.lastSyncStatus === 'success' ? 'bg-green-400' :
                  status.lastSyncStatus === 'in_progress' ? 'bg-blue-400' :
                  status.lastSyncStatus === 'partial' ? 'bg-orange-400' :
                  status.lastSyncStatus === 'stopped' ? 'bg-yellow-400' :
                  'bg-red-400'
                }`} />
                <span className="text-[10px] text-gray-500 leading-tight">
                  {status.lastSyncStatus === 'success' && 'Sync complete'}
                  {status.lastSyncStatus === 'partial' && 'Partial sync'}
                  {status.lastSyncStatus === 'in_progress' && 'Syncing...'}
                  {status.lastSyncStatus === 'stopped' && 'Stopped'}
                  {status.lastSyncStatus === 'failed' && 'Sync failed'}
                  {status.lastSyncTime && (
                    <> · {formatDistanceToNow(new Date(status.lastSyncTime), { addSuffix: true })}</>
                  )}
                  {status.recordsUpdated > 0 && (
                    <span className="text-purple-500"> · {status.recordsUpdated.toLocaleString()} items</span>
                  )}
                </span>
              </div>
            ) : (
              <p className="text-[10px] text-gray-600 leading-tight mt-0.5">Smart Pricing Insights</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Popover>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" data-testid="button-pom-info">
                <Info className="w-4 h-4 text-gray-500" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-80 bg-gray-900 border-gray-700 p-3">
              <h3 className="text-xs font-bold text-purple-400 mb-2">How It Works</h3>
              <ul className="text-xs text-gray-300 space-y-1.5">
                <li>• Fetches item details, avg listed price + <strong className="text-purple-300">85th-percentile sold price</strong> from BrickLink — 3 API calls per item.</li>
                <li>• Applies your premium formula (Settings) to compute a suggested price, then applies cost floor and minimum price if configured</li>
                <li>• Processes up to <strong className="text-white">{batchSize.toLocaleString()}</strong> stale items per run</li>
                <li>• <strong className="text-red-300">{tooHighPct}%+ above suggested</strong> = Too High · <strong className="text-orange-300">{tooLowPct}%+ below</strong> = Too Low</li>
                <li>• Stops at <strong className="text-white">{apiCeiling.toLocaleString()}</strong> API calls to preserve your daily quota</li>
                <li>• Items with 0 stock are skipped. Formula changes apply instantly.</li>
              </ul>
              <p className="text-[10px] text-gray-500 pt-2 mt-2 border-t border-gray-700">Does not auto-reprice. You review each flag and decide what to change.</p>
            </PopoverContent>
          </Popover>
          {isSyncRunning && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={handleStop} disabled={stopMutation.isPending} size="icon" variant="destructive" data-testid="button-stop-sync">
                  <Square className="w-3.5 h-3.5 fill-current" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                {stopMutation.isPending ? 'Stopping...' : 'Stop Sync'}
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={handleSync} disabled={isSyncRunning} size="icon" variant="ghost" data-testid="button-sync">
                <RefreshCw className={`w-4 h-4 text-gray-500 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-56 text-xs">
              {isSyncRunning ? 'Syncing in progress...' : 'Refresh Market Data — fetches BrickLink price data for stale items (3 API calls each). Does not change your prices.'}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Spot Price Lookup */}
      <PomSpotLookup formatCurrency={formatCurrency} />

      {/* Summary Cards — full-width 3-column row */}
      <div className="grid grid-cols-3 gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Card 
              className={`px-3 py-2.5 cursor-pointer hover-elevate active-elevate-2 ${
                selectedCategory === 'too-high' 
                  ? 'bg-red-500/20 border-red-500/40' 
                  : 'bg-red-500/8 border-red-500/20'
              }`}
              onClick={() => setSelectedCategory('too-high')}
              data-testid="stat-too-high"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <TrendingUp className="w-2.5 h-2.5 text-red-400 flex-shrink-0" />
                    <p className="text-[9px] uppercase tracking-widest text-red-400 font-medium">Too High</p>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1 leading-none">Losing sales</p>
                </div>
                <div className="w-9 text-right flex-shrink-0">
                  {insightsLoading ? (
                    <Skeleton className="h-5 w-8 ml-auto" />
                  ) : (
                    <p className="text-xl font-mono font-bold text-red-400 tabular-nums">{insightsData?.summary.tooHigh ?? 0}</p>
                  )}
                </div>
              </div>
            </Card>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-56 text-xs">
            Items priced more than {tooHighPct}% above the suggested price. Buyers can likely find it cheaper elsewhere, hurting your sell-through rate. Click to review.
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Card 
              className={`px-3 py-2.5 cursor-pointer hover-elevate active-elevate-2 ${
                selectedCategory === 'too-low' 
                  ? 'bg-orange-500/20 border-orange-500/40' 
                  : 'bg-orange-500/8 border-orange-500/20'
              }`}
              onClick={() => setSelectedCategory('too-low')}
              data-testid="stat-too-low"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <TrendingDown className="w-2.5 h-2.5 text-orange-400 flex-shrink-0" />
                    <p className="text-[9px] uppercase tracking-widest text-orange-400 font-medium">Too Low</p>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1 leading-none">Leaving margin</p>
                </div>
                <div className="w-9 text-right flex-shrink-0">
                  {insightsLoading ? (
                    <Skeleton className="h-5 w-8 ml-auto" />
                  ) : (
                    <p className="text-xl font-mono font-bold text-orange-400 tabular-nums">{insightsData?.summary.tooLow ?? 0}</p>
                  )}
                </div>
              </div>
            </Card>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-56 text-xs">
            Items priced more than {tooLowPct}% below the suggested price. You're selling at an unnecessary discount — consider raising the price. Click to review.
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Card 
              className={`px-3 py-2.5 cursor-pointer hover-elevate active-elevate-2 ${
                selectedCategory === 'good' 
                  ? 'bg-green-500/20 border-green-500/40' 
                  : 'bg-green-500/8 border-green-500/20'
              }`}
              onClick={() => setSelectedCategory('good')}
              data-testid="stat-good"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <CheckCircle className="w-2.5 h-2.5 text-green-400 flex-shrink-0" />
                    <p className="text-[9px] uppercase tracking-widest text-green-400 font-medium">On Target</p>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1 leading-none">Optimal range</p>
                </div>
                <div className="w-9 text-right flex-shrink-0">
                  {insightsLoading ? (
                    <Skeleton className="h-5 w-8 ml-auto" />
                  ) : (
                    <p className="text-xl font-mono font-bold text-green-400 tabular-nums">{insightsData?.summary.wellPriced ?? 0}</p>
                  )}
                </div>
              </div>
            </Card>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-56 text-xs">
            Items within ±{Math.max(tooHighPct, tooLowPct)}% of the suggested price. In the optimal margin-to-competitiveness zone — no action needed.
          </TooltipContent>
        </Tooltip>

      </div>
    </div>
    {/* ── Scrollable bottom section: item list ── */}
    <div className="flex-1 overflow-y-auto min-h-0 px-4 pb-4 space-y-3">

      {/* Item List */}
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
                    <span className="font-mono text-[10px] text-gray-500 flex-shrink-0">{item.itemNo}</span>
                    <p className="text-xs text-white truncate flex-1 min-w-0">{item.itemName || 'Unknown Item'}</p>
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
          <Button onClick={handleSync} disabled={syncMutation.isPending} size="sm" className="gap-2">
            <RefreshCw className="w-3 h-3" />
            Start First Sync
          </Button>
        </div>
      )}
    </div>
    </div>
  );
}

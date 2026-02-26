import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {  
  Sparkles,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  RefreshCw,
  AlertCircle,
  Clock,
  Zap,
  ChevronDown,
  Info,
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
      queryClient.invalidateQueries({ queryKey: ['/api/priceomatic/insights'] });
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

  // Fetch pricing insights
  const { data: insights, isLoading: insightsLoading } = useQuery<{ success: boolean; data: InsightsData }>({
    queryKey: ['/api/priceomatic/insights'],
  });

  // Fetch settings to get real thresholds
  const { data: settingsData } = useQuery<any>({
    queryKey: ['/api/settings'],
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/sync/priceomatic', { maxItems: 1500 });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sync/priceomatic/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/priceomatic/insights'] });
      
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

  const handleSync = () => {
    syncMutation.mutate();
  };

  const status = syncStatus?.data;
  const insightsData = insights?.data;

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
    <div className="space-y-4 p-4 touch-pan-y">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <div>
            <h2 className="text-base font-bold text-white">Price-o-Matic</h2>
            <p className="text-[10px] md:text-sm text-gray-400">Smart Pricing Insights</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" data-testid="button-pom-info">
                <Info className="w-4 h-4 text-gray-400" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-80 bg-gray-900 border-gray-700 p-3">
              <h3 className="text-xs font-bold text-purple-400 mb-2">How It Works</h3>
              <ul className="text-xs text-gray-300 space-y-1.5">
                <li>• Fetches item details, avg listed price + <strong className="text-purple-300">85th-percentile sold price</strong> from BrickLink — 3 API calls per item. The 85th percentile filters cheap outlier sales for a truer market reference.</li>
                <li>• Applies your premium formula (Settings) to compute a suggested price, then applies cost floor and minimum price if configured</li>
                <li>• Processes up to <strong className="text-white">{batchSize.toLocaleString()}</strong> stale items per run — all tiers compete fairly, T1 items go first only within the stale pool</li>
                <li>• <strong className="text-red-300">{tooHighPct}%+ above suggested</strong> = Too High (losing sales to cheaper competitors)</li>
                <li>• <strong className="text-orange-300">{tooLowPct}%+ below suggested</strong> = Too Low (leaving margin on the table)</li>
                <li>• Stops at <strong className="text-white">{apiCeiling.toLocaleString()}</strong> API calls to preserve your daily BrickLink quota</li>
                <li>• Items with 0 stock are skipped — no calls wasted on unlisted inventory</li>
                <li>• Formula changes apply instantly — no re-sync needed</li>
              </ul>
              <p className="text-[10px] text-gray-500 pt-2 mt-2 border-t border-gray-700">Does not auto-reprice. You review each flag and decide what to change.</p>
            </PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={handleSync}
                disabled={syncMutation.isPending || status?.lastSyncStatus === 'in_progress'}
                size="sm"
                className="gap-2"
                data-testid="button-sync"
              >
                <RefreshCw className={`w-3 h-3 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                {syncMutation.isPending ? 'Refreshing...' : 'Refresh Market Data'}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-56 text-xs">
              Refreshes local POM price data from BrickLink for stale items across all tiers (3 API calls each: item details, stock guide, sold guide). Does not change your BrickLink prices. Skips items with 0 stock.
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Spot Price Lookup */}
      <PomSpotLookup formatCurrency={formatCurrency} />

      {/* Summary Cards — full-width 4-column row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Card 
              className={`p-2.5 cursor-pointer hover-elevate active-elevate-2 ${
                selectedCategory === 'too-high' 
                  ? 'bg-red-500/20 border-red-500/50' 
                  : 'bg-red-500/10 border-red-500/30'
              }`}
              onClick={() => setSelectedCategory('too-high')}
              data-testid="stat-too-high"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <TrendingUp className="w-3.5 h-3.5 text-red-400" />
                <p className="text-[9px] md:text-xs text-red-400 uppercase">Too High</p>
              </div>
              <p className="text-xl font-mono font-bold text-red-400">{insightsData?.summary.tooHigh || 0}</p>
              <p className="text-xs text-gray-500">Losing sales</p>
            </Card>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-56 text-xs">
            Items priced more than {tooHighPct}% above the suggested price. Buyers can likely find it cheaper elsewhere, hurting your sell-through rate. Click to review.
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Card 
              className={`p-2.5 cursor-pointer hover-elevate active-elevate-2 ${
                selectedCategory === 'too-low' 
                  ? 'bg-orange-500/20 border-orange-500/50' 
                  : 'bg-orange-500/10 border-orange-500/30'
              }`}
              onClick={() => setSelectedCategory('too-low')}
              data-testid="stat-too-low"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <TrendingDown className="w-3.5 h-3.5 text-orange-400" />
                <p className="text-[9px] md:text-xs text-orange-400 uppercase">Too Low</p>
              </div>
              <p className="text-xl font-mono font-bold text-orange-400">{insightsData?.summary.tooLow || 0}</p>
              <p className="text-xs text-gray-500">Leaving margin</p>
            </Card>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-56 text-xs">
            Items priced more than {tooLowPct}% below the suggested price. You're selling at an unnecessary discount — consider raising the price. Click to review.
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Card 
              className={`p-2.5 cursor-pointer hover-elevate active-elevate-2 ${
                selectedCategory === 'good' 
                  ? 'bg-green-500/20 border-green-500/50' 
                  : 'bg-green-500/10 border-green-500/30'
              }`}
              onClick={() => setSelectedCategory('good')}
              data-testid="stat-good"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                <p className="text-[9px] md:text-xs text-green-400 uppercase">Well Priced</p>
              </div>
              <p className="text-xl font-mono font-bold text-green-400">{insightsData?.summary.wellPriced || 0}</p>
              <p className="text-xs text-gray-500">Optimal range</p>
            </Card>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-56 text-xs">
            Items within ±{Math.max(tooHighPct, tooLowPct)}% of the suggested price. In the optimal margin-to-competitiveness zone — no action needed.
          </TooltipContent>
        </Tooltip>

        <Card className="p-2.5 bg-gray-900/50 border-gray-700" data-testid="stat-total">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Zap className="w-3.5 h-3.5 text-purple-400" />
            <p className="text-[9px] md:text-xs text-gray-400 uppercase">Total</p>
          </div>
          <p className="text-xl font-mono font-bold text-white">{insightsData?.summary.total || 0}</p>
          <p className="text-xs text-gray-500">Items analyzed</p>
        </Card>
      </div>

      {/* Sync Status */}
      {status && status.lastSyncStatus !== 'never' && (
        <Card className="p-3 bg-gray-900/50 border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                status.lastSyncStatus === 'success' ? 'bg-green-500/20' :
                status.lastSyncStatus === 'partial' ? 'bg-orange-500/20' :
                status.lastSyncStatus === 'in_progress' ? 'bg-blue-500/20' :
                'bg-red-500/20'
              }`}>
                {status.lastSyncStatus === 'success' && <CheckCircle className="w-4 h-4 text-green-400" />}
                {status.lastSyncStatus === 'partial' && <AlertCircle className="w-4 h-4 text-orange-400" />}
                {status.lastSyncStatus === 'in_progress' && <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />}
                {status.lastSyncStatus === 'failed' && <AlertCircle className="w-4 h-4 text-red-400" />}
              </div>
              <div>
                <p className="text-xs font-semibold text-white">
                  {status.lastSyncStatus === 'success' && 'Sync Completed'}
                  {status.lastSyncStatus === 'partial' && 'Partial Sync'}
                  {status.lastSyncStatus === 'in_progress' && 'Syncing...'}
                  {status.lastSyncStatus === 'failed' && 'Sync Failed'}
                </p>
                <p className="text-[9px] md:text-xs text-gray-400">
                  {status.lastSyncTime && formatDistanceToNow(new Date(status.lastSyncTime), { addSuffix: true })}
                </p>
              </div>
            </div>
            {status.recordsUpdated !== undefined && status.recordsUpdated > 0 && (
              <div className="text-right">
                <p className="text-lg font-mono font-bold text-purple-400">{status.recordsUpdated}</p>
                <p className="text-xs text-gray-500 uppercase">Items</p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Item List */}
      {insightsData && (
        <div className="space-y-2">
          {/* Column headers with info tooltips */}
          {selectedItems.length > 0 && (
            <div className="flex items-center px-1.5 mb-1 gap-2">
              <p className="flex-1 min-w-0 text-[9px] uppercase tracking-wider text-gray-600">Item</p>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="flex items-center gap-1 w-16 justify-end">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-2.5 h-2.5 text-gray-600 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-48 text-xs">
                      Your current price in BrickLink for this listing.
                    </TooltipContent>
                  </Tooltip>
                  <p className="text-[9px] uppercase tracking-wider text-gray-600">Current</p>
                </div>
                <div className="flex items-center gap-1 w-16 justify-end">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-2.5 h-2.5 text-gray-600 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64 text-xs">
                      Suggested price uses BrickLink avg listed price and 85th-percentile sold price, then applies your premium formula (base %, scarcity tiers, market dynamics). Adjust in Settings → Price-o-Matic.
                    </TooltipContent>
                  </Tooltip>
                  <p className="text-[9px] uppercase tracking-wider text-gray-600">Suggested</p>
                </div>
                <div className="flex items-center gap-1 w-14 justify-end">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-2.5 h-2.5 text-gray-600 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-48 text-xs">
                      How far your current price deviates from the suggested price. Positive = priced above; negative = priced below.
                    </TooltipContent>
                  </Tooltip>
                  <p className="text-[9px] uppercase tracking-wider text-gray-600">Variance</p>
                </div>
                <p className="text-[9px] uppercase tracking-wider text-gray-600 w-8 text-right">Qty</p>
              </div>
            </div>
          )}

          {selectedItems.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-xs">No items in this category</p>
            </div>
          ) : (
            <>
              {selectedItems.slice(0, itemsToShow).map((item) => (
                <div
                  key={item.inventoryId}
                  onClick={() => onItemClick?.('inventory', item.inventoryId)}
                  className="group bg-gray-900/50 border border-gray-700 rounded-lg p-1.5 hover-elevate active-elevate-2 cursor-pointer"
                  data-testid={`item-${item.inventoryId}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-xs text-white truncate">{item.itemName || 'Unknown Item'}</p>
                        <span className="text-[10px] md:text-sm font-mono text-gray-400 flex-shrink-0">{item.itemNo}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] md:text-sm text-gray-400">{item.newOrUsed === 'N' ? 'New' : 'Used'}</span>
                        {item.colorName && (
                          <>
                            <span className="text-gray-600">•</span>
                            <span className="text-[10px] md:text-sm text-gray-400">{item.colorName}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
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
                            className="invisible group-hover:visible text-gray-500 hover:text-purple-400 disabled:text-gray-600 transition-colors p-0.5 flex-shrink-0"
                            data-testid={`button-refresh-item-${item.inventoryId}`}
                          >
                            <RefreshCw className={`w-3 h-3 ${refreshingItems.has(item.inventoryId) ? 'animate-spin text-purple-400' : ''}`} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">
                          Refresh BrickLink price data for this item (3 API calls)
                        </TooltipContent>
                      </Tooltip>
                      <div className="w-16 text-right">
                        <p className="text-[10px] md:text-sm font-mono text-white">{formatCurrency(item.currentPrice)}</p>
                      </div>
                      <div className="w-16 text-right">
                        <p className="text-[10px] md:text-sm font-mono text-purple-400">{formatCurrency(item.suggestedPrice)}</p>
                        {item.floorApplied === 'cost' && (
                          <p className="text-[8px] text-emerald-500 leading-none">cost floor</p>
                        )}
                        {item.floorApplied === 'min' && (
                          <p className="text-[8px] text-blue-500 leading-none">min price</p>
                        )}
                      </div>
                      <div className="w-14 text-right">
                        <p className={`text-[10px] md:text-sm font-mono font-bold ${
                          item.variance > 0 ? 'text-red-400' : item.variance < 0 ? 'text-orange-400' : 'text-green-400'
                        }`}>
                          {item.variance > 0 ? '+' : ''}{item.variance}%
                        </p>
                      </div>
                      <div className="w-8 text-right">
                        <p className="text-[10px] md:text-sm font-mono text-gray-300">{item.quantity}</p>
                      </div>
                    </div>
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
  );
}

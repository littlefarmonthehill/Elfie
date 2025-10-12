import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {  
  Sparkles,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  RefreshCw,
  AlertCircle,
  Clock,
  Zap,
  ChevronDown
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";

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
  colorName: string | null;
  newOrUsed: string;
  currentPrice: string;
  suggestedPrice: string;
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

  // Fetch sync status
  const { data: syncStatus } = useQuery<{ success: boolean; data: SyncStatus }>({
    queryKey: ['/api/sync/priceomatic/status'],
    refetchInterval: 10000,
  });

  // Fetch pricing insights
  const { data: insights, isLoading: insightsLoading } = useQuery<{ success: boolean; data: InsightsData }>({
    queryKey: ['/api/priceomatic/insights'],
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
    
    // Sort by variance descending (absolute value)
    return items.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
  };

  const selectedItems = getSelectedItems();

  // Reset items to show when category changes
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
            <p className="text-[10px] text-gray-400">Smart Pricing Insights</p>
          </div>
        </div>
        <Button
          onClick={handleSync}
          disabled={syncMutation.isPending || status?.lastSyncStatus === 'in_progress'}
          size="sm"
          className="gap-2"
          data-testid="button-sync"
        >
          <RefreshCw className={`w-3 h-3 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
          {syncMutation.isPending ? 'Syncing...' : 'Update Prices'}
        </Button>
      </div>

      {/* Compact Summary Cards & How It Works */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Stats - Now Clickable for Filtering */}
        <div className="grid grid-cols-2 gap-2">
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
              <p className="text-[9px] text-red-400 uppercase">Too High</p>
            </div>
            <p className="text-xl font-mono font-bold text-red-400">{insightsData?.summary.tooHigh || 0}</p>
            <p className="text-[8px] text-gray-500">Losing sales</p>
          </Card>
          
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
              <p className="text-[9px] text-orange-400 uppercase">Too Low</p>
            </div>
            <p className="text-xl font-mono font-bold text-orange-400">{insightsData?.summary.tooLow || 0}</p>
            <p className="text-[8px] text-gray-500">Losing profit</p>
          </Card>
          
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
              <p className="text-[9px] text-green-400 uppercase">Well Priced</p>
            </div>
            <p className="text-xl font-mono font-bold text-green-400">{insightsData?.summary.wellPriced || 0}</p>
            <p className="text-[8px] text-gray-500">Optimal range</p>
          </Card>
          
          <Card className="p-2.5 bg-gray-900/50 border-gray-700" data-testid="stat-total">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Zap className="w-3.5 h-3.5 text-purple-400" />
              <p className="text-[9px] text-gray-400 uppercase">Total</p>
            </div>
            <p className="text-xl font-mono font-bold text-white">{insightsData?.summary.total || 0}</p>
            <p className="text-[8px] text-gray-500">Items analyzed</p>
          </Card>
        </div>

        {/* How It Works */}
        <Card className="p-3 bg-purple-500/10 border-purple-500/30">
          <h3 className="text-xs font-bold text-purple-400 mb-1.5">How It Works</h3>
          <ul className="text-[10px] text-gray-300 space-y-0.5">
            <li>• Analyzes 1,500 items/day on 14-day cycle</li>
            <li>• 20%+ above = Too High (losing sales)</li>
            <li>• 20%+ below = Too Low (losing profit)</li>
            <li>• Stops at 4,500 API calls to preserve quota</li>
          </ul>
        </Card>
      </div>

      {/* Sync Status - Only show if synced before */}
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
                <p className="text-[9px] text-gray-400">
                  {status.lastSyncTime && formatDistanceToNow(new Date(status.lastSyncTime), { addSuffix: true })}
                </p>
              </div>
            </div>
            {status.recordsUpdated !== undefined && status.recordsUpdated > 0 && (
              <div className="text-right">
                <p className="text-lg font-mono font-bold text-purple-400">{status.recordsUpdated}</p>
                <p className="text-[8px] text-gray-500 uppercase">Items</p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Single Item List */}
      {insightsData && (
        <div className="space-y-2">
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
                  className="bg-gray-900/50 border border-gray-700 rounded-lg p-1.5 hover-elevate active-elevate-2 cursor-pointer"
                  data-testid={`item-${item.inventoryId}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-xs text-white truncate">{item.itemName || 'Unknown Item'}</p>
                        <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">{item.itemNo}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[10px] text-gray-400">{item.newOrUsed === 'N' ? 'New' : 'Used'}</span>
                        {item.colorName && (
                          <>
                            <span className="text-gray-600">•</span>
                            <span className="text-[10px] text-gray-400">{item.colorName}</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <p className="text-[7px] text-gray-500">Current</p>
                          <p className="text-[10px] font-mono text-white">{formatCurrency(item.currentPrice)}</p>
                        </div>
                        <div className="flex-1">
                          <p className="text-[7px] text-gray-500">Suggested</p>
                          <p className="text-[10px] font-mono text-purple-400">{formatCurrency(item.suggestedPrice)}</p>
                        </div>
                        <div className="flex-1">
                          <p className="text-[7px] text-gray-500">Variance</p>
                          <p className={`text-[10px] font-mono font-bold ${
                            item.variance > 0 ? 'text-red-400' : item.variance < 0 ? 'text-orange-400' : 'text-green-400'
                          }`}>
                            {item.variance > 0 ? '+' : ''}{item.variance}%
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[7px] text-gray-500">Qty</p>
                      <p className="text-[10px] font-mono text-gray-300">{item.quantity}</p>
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

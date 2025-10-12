import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {  
  Sparkles,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  RefreshCw,
  AlertCircle,
  Clock,
  Zap
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
  const [activeTab, setActiveTab] = useState<'overview' | 'too-high' | 'too-low' | 'good'>('overview');

  // Fetch sync status
  const { data: syncStatus, isLoading: syncStatusLoading } = useQuery<{ success: boolean; data: SyncStatus }>({
    queryKey: ['/api/sync/priceomatic/status'],
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Fetch pricing insights
  const { data: insights, isLoading: insightsLoading } = useQuery<{ success: boolean; data: InsightsData }>({
    queryKey: ['/api/priceomatic/insights'],
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('/api/sync/priceomatic', {
        method: 'POST',
        body: JSON.stringify({ maxItems: 1500 }),
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/sync/priceomatic/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/priceomatic/insights'] });
      
      toast({
        title: "Sync Complete",
        description: `Updated ${data.itemsUpdated} items. ${data.apiCallsUsed} API calls used.`,
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

  const renderItemList = (items: PricingInsight[], emptyMessage: string) => {
    if (items.length === 0) {
      return (
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">{emptyMessage}</p>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {items.slice(0, 50).map((item) => (
          <div
            key={item.inventoryId}
            onClick={() => onItemClick?.('inventory', item.inventoryId)}
            className="bg-gray-900/50 border border-gray-700 rounded-lg p-3 hover-elevate active-elevate-2 cursor-pointer"
            data-testid={`item-${item.inventoryId}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-gray-400">{item.itemNo}</span>
                  {item.colorName && (
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                      {item.colorName}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-white truncate">{item.itemName || 'Unknown Item'}</p>
                <div className="flex items-center gap-3 mt-2">
                  <div>
                    <p className="text-[9px] text-gray-500">Current</p>
                    <p className="text-xs font-mono text-white">{formatCurrency(item.currentPrice)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-500">Suggested</p>
                    <p className="text-xs font-mono text-purple-400">{formatCurrency(item.suggestedPrice)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-500">Variance</p>
                    <p className={`text-xs font-mono font-bold ${
                      item.variance > 0 ? 'text-red-400' : item.variance < 0 ? 'text-orange-400' : 'text-green-400'
                    }`}>
                      {item.variance > 0 ? '+' : ''}{item.variance}%
                    </p>
                  </div>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[9px] text-gray-500">Qty</p>
                <p className="text-sm font-mono text-gray-300">{item.quantity}</p>
              </div>
            </div>
          </div>
        ))}
        {items.length > 50 && (
          <p className="text-xs text-gray-500 text-center py-2">
            Showing 50 of {items.length} items
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 p-4">
      {/* Header with Sync Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="w-6 h-6 text-purple-400" />
          <div>
            <h2 className="text-lg font-bold text-white">Price-o-Matic</h2>
            <p className="text-xs text-gray-400">Smart Pricing Insights</p>
          </div>
        </div>
        <Button
          onClick={handleSync}
          disabled={syncMutation.isPending || status?.lastSyncStatus === 'in_progress'}
          className="gap-2"
          data-testid="button-sync"
        >
          <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
          {syncMutation.isPending ? 'Syncing...' : 'Update Prices'}
        </Button>
      </div>

      {/* Sync Status Card */}
      <Card className="p-4 bg-gray-900/50 border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              status?.lastSyncStatus === 'success' ? 'bg-green-500/20' :
              status?.lastSyncStatus === 'partial' ? 'bg-orange-500/20' :
              status?.lastSyncStatus === 'in_progress' ? 'bg-blue-500/20' :
              status?.lastSyncStatus === 'failed' ? 'bg-red-500/20' :
              'bg-gray-500/20'
            }`}>
              {status?.lastSyncStatus === 'success' && <CheckCircle className="w-5 h-5 text-green-400" />}
              {status?.lastSyncStatus === 'partial' && <AlertCircle className="w-5 h-5 text-orange-400" />}
              {status?.lastSyncStatus === 'in_progress' && <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />}
              {status?.lastSyncStatus === 'failed' && <AlertCircle className="w-5 h-5 text-red-400" />}
              {(!status || status.lastSyncStatus === 'never') && <Clock className="w-5 h-5 text-gray-400" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">
                {status?.lastSyncStatus === 'success' && 'Sync Completed'}
                {status?.lastSyncStatus === 'partial' && 'Partial Sync (API Limit)'}
                {status?.lastSyncStatus === 'in_progress' && 'Syncing...'}
                {status?.lastSyncStatus === 'failed' && 'Sync Failed'}
                {(!status || status.lastSyncStatus === 'never') && 'Never Synced'}
              </p>
              <p className="text-xs text-gray-400">
                {status?.lastSyncTime 
                  ? `Last updated ${formatDistanceToNow(new Date(status.lastSyncTime), { addSuffix: true })}`
                  : 'Run your first sync to see pricing insights'}
              </p>
            </div>
          </div>
          {status?.recordsUpdated !== undefined && status.recordsUpdated > 0 && (
            <div className="text-right">
              <p className="text-2xl font-mono font-bold text-purple-400">{status.recordsUpdated}</p>
              <p className="text-[9px] text-gray-500 uppercase">Items Updated</p>
            </div>
          )}
        </div>
        {status?.errorMessage && (
          <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
            {status.errorMessage}
          </div>
        )}
      </Card>

      {/* Summary Stats */}
      {insightsData && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Card className="p-3 bg-gray-900/50 border-gray-700" data-testid="stat-total">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-purple-400" />
              <p className="text-[10px] text-gray-400 uppercase">Total Analyzed</p>
            </div>
            <p className="text-2xl font-mono font-bold text-white">{insightsData.summary.total}</p>
          </Card>
          
          <Card className="p-3 bg-red-500/10 border-red-500/30" data-testid="stat-too-high">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-red-400" />
              <p className="text-[10px] text-red-400 uppercase">Priced Too High</p>
            </div>
            <p className="text-2xl font-mono font-bold text-red-400">{insightsData.summary.tooHigh}</p>
            <p className="text-[9px] text-gray-500">Losing sales</p>
          </Card>
          
          <Card className="p-3 bg-orange-500/10 border-orange-500/30" data-testid="stat-too-low">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="w-4 h-4 text-orange-400" />
              <p className="text-[10px] text-orange-400 uppercase">Priced Too Low</p>
            </div>
            <p className="text-2xl font-mono font-bold text-orange-400">{insightsData.summary.tooLow}</p>
            <p className="text-[9px] text-gray-500">Losing profit</p>
          </Card>
          
          <Card className="p-3 bg-green-500/10 border-green-500/30" data-testid="stat-good">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <p className="text-[10px] text-green-400 uppercase">Well Priced</p>
            </div>
            <p className="text-2xl font-mono font-bold text-green-400">{insightsData.summary.wellPriced}</p>
            <p className="text-[9px] text-gray-500">Optimal range</p>
          </Card>
        </div>
      )}

      {/* Insights Tabs */}
      {insightsData && (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="too-high" data-testid="tab-too-high">
              Too High ({insightsData.summary.tooHigh})
            </TabsTrigger>
            <TabsTrigger value="too-low" data-testid="tab-too-low">
              Too Low ({insightsData.summary.tooLow})
            </TabsTrigger>
            <TabsTrigger value="good" data-testid="tab-good">
              Well Priced ({insightsData.summary.wellPriced})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
              <h3 className="text-sm font-bold text-purple-400 mb-2">How It Works</h3>
              <ul className="text-xs text-gray-300 space-y-1">
                <li>• Price-o-Matic analyzes up to 1,500 items per day</li>
                <li>• Items are refreshed on a rolling 14-day cycle</li>
                <li>• Prices 20%+ above suggested = "Too High" (may lose sales)</li>
                <li>• Prices 20%+ below suggested = "Too Low" (losing profit)</li>
                <li>• API limit: 5,000 calls/day (stops at 4,500 to preserve quota)</li>
              </ul>
            </div>
            
            {insightsData.summary.tooHigh > 0 && (
              <div>
                <h3 className="text-sm font-bold text-red-400 mb-2">Priority: Priced Too High</h3>
                {renderItemList(insightsData.tooHigh.slice(0, 5), 'No items priced too high')}
              </div>
            )}
            
            {insightsData.summary.tooLow > 0 && (
              <div>
                <h3 className="text-sm font-bold text-orange-400 mb-2">Priority: Priced Too Low</h3>
                {renderItemList(insightsData.tooLow.slice(0, 5), 'No items priced too low')}
              </div>
            )}
          </TabsContent>

          <TabsContent value="too-high">
            {renderItemList(insightsData.tooHigh, 'No items priced too high. Great work!')}
          </TabsContent>

          <TabsContent value="too-low">
            {renderItemList(insightsData.tooLow, 'No items priced too low. Great work!')}
          </TabsContent>

          <TabsContent value="good">
            {renderItemList(insightsData.wellPriced, 'No well-priced items yet. Run a sync to analyze.')}
          </TabsContent>
        </Tabs>
      )}

      {!insightsData && !insightsLoading && (
        <div className="text-center py-12">
          <Sparkles className="w-12 h-12 text-purple-400 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-white mb-2">No Data Yet</h3>
          <p className="text-sm text-gray-400 mb-4">
            Run your first sync to analyze pricing across your inventory
          </p>
          <Button onClick={handleSync} disabled={syncMutation.isPending} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Start First Sync
          </Button>
        </div>
      )}
    </div>
  );
}

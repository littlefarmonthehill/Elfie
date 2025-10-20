import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { RefreshCw, Loader2, ArrowRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type PlatformStats = {
  totalOrders: number;
  totalItems: number;
  pendingOrders: number;
  lastSyncedAt: string | null;
};

type PlatformData = {
  name: string;
  enabled: boolean;
  stats: PlatformStats;
  differentials: {
    missingOrders: number;
    statusDifferences: number;
  };
};

type OrderSyncStatus = {
  platforms: PlatformData[];
  summary: {
    totalOrders: number;
    totalItems: number;
    pendingOrders: number;
    shippedOrders: number;
  };
};

export default function OrderPlatformSyncTool() {
  const { toast } = useToast();
  const [syncingPlatform, setSyncingPlatform] = useState<string | null>(null);

  // Fetch order sync status
  const { data, isLoading } = useQuery<OrderSyncStatus>({
    queryKey: ['/api/order-sync/status'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // BrickLink order sync mutation
  const bricklinkSyncMutation = useMutation({
    mutationFn: async () => {
      const result = await apiRequest('POST', '/api/sync/bricklink/orders', {
        fullSync: false,
      });
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/order-sync/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders/dashboard'] });
      toast({
        title: "BrickLink Sync Complete",
        description: `${result.data.ordersAdded} added, ${result.data.ordersUpdated} updated`,
      });
      setSyncingPlatform(null);
    },
    onError: (error: Error) => {
      toast({
        title: "BrickLink Sync Failed",
        description: error.message,
        variant: "destructive",
      });
      setSyncingPlatform(null);
    },
  });

  // BrickOwl order sync mutation
  const brickowlSyncMutation = useMutation({
    mutationFn: async () => {
      const result = await apiRequest('POST', '/api/sync/brickowl/orders', {
        fullSync: false,
      });
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/order-sync/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders/dashboard'] });
      toast({
        title: "BrickOwl Sync Complete",
        description: `${result.data.ordersAdded} added, ${result.data.ordersUpdated} updated`,
      });
      setSyncingPlatform(null);
    },
    onError: (error: Error) => {
      toast({
        title: "BrickOwl Sync Failed",
        description: error.message,
        variant: "destructive",
      });
      setSyncingPlatform(null);
    },
  });

  // All platforms sync mutation
  const syncAllMutation = useMutation({
    mutationFn: async () => {
      const result = await apiRequest('POST', '/api/sync/all-platforms/orders', {
        fullSync: false,
      });
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/order-sync/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders/dashboard'] });
      
      if (result.allSkipped) {
        toast({
          title: "Configuration Required",
          description: "Please configure BrickLink and/or BrickOwl API credentials in Settings.",
          variant: "destructive",
        });
      } else if (result.success) {
        const successCount = [
          result.results.bricklink.success,
          result.results.brickowl.success,
        ].filter(Boolean).length;
        
        toast({
          title: "Sync Complete",
          description: `Successfully synced ${successCount} platform(s)`,
        });
      } else {
        toast({
          title: "Sync Completed with Errors",
          description: "Some platforms failed to sync. Check individual platform status.",
          variant: "destructive",
        });
      }
      setSyncingPlatform(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
      setSyncingPlatform(null);
    },
  });

  const handleSync = async (platformName: string) => {
    setSyncingPlatform(platformName);
    
    if (platformName === 'BrickLink') {
      bricklinkSyncMutation.mutate();
    } else if (platformName === 'BrickOwl') {
      brickowlSyncMutation.mutate();
    }
  };

  const handleSyncAll = async () => {
    setSyncingPlatform('all');
    syncAllMutation.mutate();
  };

  return (
    <div className="space-y-3">
      {/* Summary Stats */}
      {!isLoading && data?.summary && (
        <Card className="bg-gray-800/50 border-gray-700 p-3">
          <h3 className="text-xs font-semibold text-gray-300 mb-2">Database Summary</h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-900/50 rounded-lg p-2 border border-gray-700">
              <p className="text-sm md:text-base text-gray-400 mb-0.5">Total Orders</p>
              <p className="text-sm font-bold text-white font-mono">
                {data.summary.totalOrders.toLocaleString()}
              </p>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-2 border border-gray-700">
              <p className="text-sm md:text-base text-gray-400 mb-0.5">Total Items</p>
              <p className="text-sm font-bold text-white font-mono">
                {data.summary.totalItems.toLocaleString()}
              </p>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-2 border border-gray-700">
              <p className="text-sm md:text-base text-gray-400 mb-0.5">Pending</p>
              <p className="text-sm font-bold text-orange-400 font-mono">
                {data.summary.pendingOrders.toLocaleString()}
              </p>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-2 border border-gray-700">
              <p className="text-sm md:text-base text-gray-400 mb-0.5">Shipped</p>
              <p className="text-sm font-bold text-green-400 font-mono">
                {data.summary.shippedOrders.toLocaleString()}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Platforms */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs md:text-base lg:text-lg font-bold text-gray-300 flex items-center gap-1.5">
            <ArrowRight className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-orange-400" />
            Sales Platforms
          </h3>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSyncAll}
            disabled={syncingPlatform !== null}
            className="text-xs md:text-base lg:text-lg"
            data-testid="button-sync-all"
          >
            {syncingPlatform === 'all' ? (
              <>
                <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                Syncing All...
              </>
            ) : (
              <>
                <RefreshCw className="w-3 h-3 mr-1.5" />
                Sync All
              </>
            )}
          </Button>
        </div>

        <div className="space-y-2">
          {isLoading ? (
            // Skeleton loading for platforms
            <Card className="bg-gray-800/50 border-gray-700 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="inline-block bg-gray-700 h-4 w-24 rounded animate-pulse" />
                <span className="inline-block bg-gray-700 h-7 w-16 rounded animate-pulse" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gray-900/50 rounded-lg p-1.5 border border-gray-700">
                  <span className="inline-block bg-gray-700 h-2 w-12 rounded animate-pulse mb-1" />
                  <span className="inline-block bg-gray-700 h-3 w-16 rounded animate-pulse" />
                </div>
                <div className="bg-gray-900/50 rounded-lg p-1.5 border border-gray-700">
                  <span className="inline-block bg-gray-700 h-2 w-12 rounded animate-pulse mb-1" />
                  <span className="inline-block bg-gray-700 h-3 w-16 rounded animate-pulse" />
                </div>
              </div>
            </Card>
          ) : data?.platforms.map((platform) => {
            const isSyncing = syncingPlatform === platform.name;

            return (
              <Card 
                key={platform.name} 
                className={`p-3 ${
                  platform.enabled 
                    ? 'bg-gray-800/50 border-gray-700' 
                    : 'bg-gray-900/30 border-gray-800/50 opacity-60'
                }`}
                data-testid={`platform-${platform.name.toLowerCase()}`}
              >
                {/* Platform Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs md:text-base lg:text-lg font-bold text-white">{platform.name}</p>
                    {!platform.enabled && (
                      <Badge variant="outline" className="text-sm md:text-base text-gray-500 border-gray-600">
                        Not Configured
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSync(platform.name)}
                    disabled={!platform.enabled || isSyncing}
                    className="text-xs md:text-base lg:text-lg"
                    data-testid={`button-sync-${platform.name.toLowerCase()}`}
                  >
                    {isSyncing ? (
                      <>
                        <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-3 h-3 mr-1.5" />
                        Sync
                      </>
                    )}
                  </Button>
                </div>

                {/* Last Synced Info */}
                {platform.enabled && platform.stats.lastSyncedAt && (
                  <p className="text-sm md:text-base text-gray-400 mb-2">
                    Last synced: {new Date(platform.stats.lastSyncedAt).toLocaleString()}
                  </p>
                )}

                {/* Platform Stats */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-gray-900/50 rounded-lg p-1.5 border border-gray-700">
                    <p className="text-sm md:text-base md:text-xs text-gray-400 mb-0.5">Orders</p>
                    <p className="text-xs md:text-base lg:text-lg font-bold text-white font-mono">
                      {platform.enabled ? platform.stats.totalOrders.toLocaleString() : '—'}
                    </p>
                  </div>
                  <div className="bg-gray-900/50 rounded-lg p-1.5 border border-gray-700">
                    <p className="text-sm md:text-base md:text-xs text-gray-400 mb-0.5">Items</p>
                    <p className="text-xs md:text-base lg:text-lg font-bold text-white font-mono">
                      {platform.enabled ? platform.stats.totalItems.toLocaleString() : '—'}
                    </p>
                  </div>
                  <div className="bg-gray-900/50 rounded-lg p-1.5 border border-gray-700">
                    <p className="text-sm md:text-base md:text-xs text-gray-400 mb-0.5">Pending</p>
                    <p className="text-xs md:text-base lg:text-lg font-bold text-orange-400 font-mono">
                      {platform.enabled ? platform.stats.pendingOrders.toLocaleString() : '—'}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}

          {/* Info Message when no platforms configured */}
          {!isLoading && data && !data.platforms.some(p => p.enabled) && (
            <Card className="bg-blue-500/10 border-blue-500/30 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-blue-300">
                  <p className="font-medium mb-1">No Platforms Configured</p>
                  <p className="text-blue-400/80">
                    Configure API credentials in Settings → API Credentials to enable platform sync.
                    Once configured, platforms will automatically sync orders from BrickLink and BrickOwl.
                  </p>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Info */}
      {!isLoading && data && data.platforms.some(p => p.enabled) && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-blue-300">
              <p className="font-medium mb-1">About Order Sync</p>
              <ul className="space-y-1 text-blue-400/80">
                <li>• Syncs orders from BrickLink and BrickOwl</li>
                <li>• Only fetches orders modified since last sync</li>
                <li>• Automatically adjusts inventory when order status changes</li>
                <li>• Requires API credentials configured in Settings</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

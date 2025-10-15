import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, ArrowRight, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

type PlatformStats = {
  totalLots: number;
  totalParts: number;
  lastSyncedAt: string | null;
};

type PlatformSyncData = {
  source: {
    name: string;
    stats: PlatformStats;
  };
  targets: {
    name: string;
    enabled: boolean;
    stats: PlatformStats;
    discrepancies: {
      missingLots: number;
      missingParts: number;
      priceDifferences: number;
      quantityDifferences: number;
    };
  }[];
  lastSyncStatus: SyncStatus;
  lastSyncMessage: string | null;
};

export default function PlatformSyncTool() {
  const [syncingPlatform, setSyncingPlatform] = useState<string | null>(null);
  const { toast } = useToast();

  // Fetch platform sync status
  const { data, isLoading } = useQuery<PlatformSyncData>({
    queryKey: ['/api/platform-sync/status'],
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async ({ platform, limit }: { platform: string; limit?: number }) => {
      console.log('[Platform Sync] Mutation triggered with platform:', platform, 'limit:', limit);
      const response = await apiRequest('POST', '/api/platform-sync/sync', { platform, limit });
      const data = await response.json();
      console.log('[Platform Sync] Response:', data);
      return data;
    },
    onSuccess: (data: {
      success: boolean;
      platform: string;
      result: {
        lotsCreated: number;
        lotsUpdated: number;
        lotsSkipped: number;
        errors: string[];
        totalApiCalls: number;
      };
    }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/platform-sync/status'] });
      toast({
        title: "Sync Complete",
        description: `${data.result.lotsCreated} lots created, ${data.result.lotsUpdated} updated, ${data.result.lotsSkipped} skipped`,
      });
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
    console.log('[Platform Sync] handleSync called with platform:', platformName);
    setSyncingPlatform(platformName);
    console.log('[Platform Sync] Calling syncMutation.mutate...');
    // Use a limit of 10 items for testing to prevent long-running sync
    syncMutation.mutate({ platform: platformName, limit: 10 });
  };

  const handleSyncAll = async () => {
    setSyncingPlatform('all');
    // For now, just sync BrickOwl (when more platforms are available, loop through them)
    // Use a limit of 10 items for testing to prevent long-running sync
    syncMutation.mutate({ platform: 'BrickOwl', limit: 10 });
  };

  // Sync unsynced mutation
  const syncUnsyncedMutation = useMutation({
    mutationFn: async ({ limit }: { limit: number }) => {
      console.log('[Platform Sync] Syncing unsynced items with limit:', limit);
      const response = await apiRequest('POST', '/api/platform-sync/sync-unsynced', { platform: 'BrickOwl', limit });
      const data = await response.json();
      console.log('[Platform Sync] Unsynced response:', data);
      return data;
    },
    onSuccess: (data: {
      success: boolean;
      platform: string;
      result: {
        lotsCreated: number;
        lotsUpdated: number;
        lotsSkipped: number;
        errors: string[];
        totalApiCalls: number;
      };
    }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/platform-sync/status'] });
      toast({
        title: "Unsynced Items Sync Complete",
        description: `${data.result.lotsCreated} lots created, ${data.result.lotsUpdated} updated, ${data.result.lotsSkipped} skipped`,
      });
      setSyncingPlatform(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Unsynced Sync Failed",
        description: error.message,
        variant: "destructive",
      });
      setSyncingPlatform(null);
    },
  });

  const handleSyncUnsynced = async (limit: number = 5) => {
    console.log('[Platform Sync] handleSyncUnsynced called with limit:', limit);
    setSyncingPlatform('unsynced');
    syncUnsyncedMutation.mutate({ limit });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">No platform sync data available</p>
      </div>
    );
  }

  const displayData = data;

  return (
    <div className="space-y-4">
      {/* Source Platform */}
      <div>
        <h3 className="text-sm font-bold text-gray-300 mb-3 flex items-center gap-2">
          <Info className="w-4 h-4 text-purple-400" />
          Source of Truth
        </h3>
        <Card className="bg-gray-800/50 border-purple-500/30 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-bold text-white">{displayData.source.name}</p>
              <p className="text-xs text-gray-400">
                {displayData.source.stats.lastSyncedAt 
                  ? `Last synced: ${new Date(displayData.source.stats.lastSyncedAt).toLocaleString()}`
                  : 'Never synced'}
              </p>
            </div>
            <Badge variant="outline" className="bg-purple-500/10 border-purple-500/30 text-purple-400">
              Active
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-900/50 rounded-lg p-2.5 border border-gray-700">
              <p className="text-xs text-gray-400 mb-1">Total Lots</p>
              <p className="text-lg font-bold text-white font-mono">{displayData.source.stats.totalLots.toLocaleString()}</p>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-2.5 border border-gray-700">
              <p className="text-xs text-gray-400 mb-1">Total Parts</p>
              <p className="text-lg font-bold text-white font-mono">{displayData.source.stats.totalParts.toLocaleString()}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Target Platforms */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-300 flex items-center gap-2">
            <ArrowRight className="w-4 h-4 text-blue-400" />
            Selling Platforms
          </h3>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleSyncUnsynced(5)}
              disabled={syncingPlatform !== null}
              className="text-xs"
              data-testid="button-sync-unsynced"
            >
              {syncingPlatform === 'unsynced' ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="w-3 h-3 mr-1.5" />
                  Sync Unsynced (5)
                </>
              )}
            </Button>
            <Button
              size="sm"
              onClick={handleSyncAll}
              disabled={syncingPlatform !== null}
              className="text-xs"
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
        </div>

        <div className="space-y-3">
          {displayData.targets.map((platform) => {
            const isSyncing = syncingPlatform === platform.name;
            const hasDiscrepancies = 
              platform.discrepancies.missingLots > 0 || 
              platform.discrepancies.missingParts > 0 ||
              platform.discrepancies.priceDifferences > 0 ||
              platform.discrepancies.quantityDifferences > 0;

            return (
              <Card 
                key={platform.name} 
                className={`p-4 ${
                  platform.enabled 
                    ? 'bg-gray-800/50 border-gray-700' 
                    : 'bg-gray-900/30 border-gray-800/50 opacity-60'
                }`}
                data-testid={`platform-${platform.name.toLowerCase()}`}
              >
                {/* Platform Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-white">{platform.name}</p>
                    {!platform.enabled && (
                      <Badge variant="outline" className="text-xs text-gray-500 border-gray-600">
                        Not Configured
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={hasDiscrepancies ? "default" : "outline"}
                    onClick={() => handleSync(platform.name)}
                    disabled={!platform.enabled || isSyncing}
                    className="text-xs"
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

                {/* Platform Stats */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-gray-900/50 rounded-lg p-2 border border-gray-700">
                    <p className="text-[10px] text-gray-400 mb-0.5">Lots</p>
                    <p className="text-sm font-bold text-white font-mono">
                      {platform.enabled ? platform.stats.totalLots.toLocaleString() : '—'}
                    </p>
                  </div>
                  <div className="bg-gray-900/50 rounded-lg p-2 border border-gray-700">
                    <p className="text-[10px] text-gray-400 mb-0.5">Parts</p>
                    <p className="text-sm font-bold text-white font-mono">
                      {platform.enabled ? platform.stats.totalParts.toLocaleString() : '—'}
                    </p>
                  </div>
                </div>

                {/* Discrepancies */}
                {platform.enabled && hasDiscrepancies && (
                  <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-2.5">
                    <div className="flex items-start gap-2 mb-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-xs font-bold text-orange-400 mb-1">Discrepancies Found</p>
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          {platform.discrepancies.missingLots > 0 && (
                            <div className="text-gray-300">
                              <span className="text-orange-400 font-bold">{platform.discrepancies.missingLots}</span> missing lots
                            </div>
                          )}
                          {platform.discrepancies.missingParts > 0 && (
                            <div className="text-gray-300">
                              <span className="text-orange-400 font-bold">{platform.discrepancies.missingParts}</span> missing parts
                            </div>
                          )}
                          {platform.discrepancies.priceDifferences > 0 && (
                            <div className="text-gray-300">
                              <span className="text-orange-400 font-bold">{platform.discrepancies.priceDifferences}</span> price diffs
                            </div>
                          )}
                          {platform.discrepancies.quantityDifferences > 0 && (
                            <div className="text-gray-300">
                              <span className="text-orange-400 font-bold">{platform.discrepancies.quantityDifferences}</span> qty diffs
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Last Sync Status */}
                {platform.enabled && platform.stats.lastSyncedAt && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3 h-3 text-green-400" />
                    <p className="text-[10px] text-gray-400">
                      Last synced: {new Date(platform.stats.lastSyncedAt).toLocaleString()}
                    </p>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* Configuration Notice */}
      <Card className="bg-blue-500/10 border-blue-500/30 p-3">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-blue-400 mb-1">Platform Configuration</p>
            <p className="text-[10px] text-gray-300">
              Configure API credentials in Settings → API Credentials to enable platform sync.
              Once configured, platforms will automatically sync inventory from {displayData.source.name}.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

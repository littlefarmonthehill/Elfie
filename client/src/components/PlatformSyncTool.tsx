import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, ArrowRight, Info } from "lucide-react";

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

  // Fetch platform sync status
  const { data, isLoading } = useQuery<PlatformSyncData>({
    queryKey: ['/api/platform-sync/status'],
  });

  const handleSync = async (platformName: string) => {
    setSyncingPlatform(platformName);
    // TODO: Implement sync API call
    setTimeout(() => {
      setSyncingPlatform(null);
    }, 2000);
  };

  const handleSyncAll = async () => {
    setSyncingPlatform('all');
    // TODO: Implement sync all API call
    setTimeout(() => {
      setSyncingPlatform(null);
    }, 2000);
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

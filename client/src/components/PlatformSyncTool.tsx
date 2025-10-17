import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, ArrowRight, Info, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from "@/components/ui/drawer";

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
      remarksDifferences: number;
      descriptionDifferences: number;
    };
  }[];
  lastSyncStatus: SyncStatus;
  lastSyncMessage: string | null;
};

type DiscrepancyItem = {
  itemNo: string;
  itemName: string | null;
  colorName: string | null;
  blQuantity: number;
  blPrice: number;
  boQuantity: number;
  boPrice: number;
  difference: string;
  priceDiff?: number;
  qtyDiff?: number;
  blRemarks?: string;
  boRemarks?: string;
  blDescription?: string;
  boDescription?: string;
};

export default function PlatformSyncTool() {
  const [syncingPlatform, setSyncingPlatform] = useState<string | null>(null);
  const [discrepancyDrawer, setDiscrepancyDrawer] = useState<{
    open: boolean;
    platform: string;
    type: string;
    title: string;
  }>({ open: false, platform: '', type: '', title: '' });
  const [itemsToShow, setItemsToShow] = useState(20); // Show 20 items initially
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

  // Fetch discrepancy details
  const { data: discrepancyData, isLoading: discrepancyLoading } = useQuery<{ discrepancies: DiscrepancyItem[]; total: number }>({
    queryKey: ['/api/platform-sync/discrepancies', discrepancyDrawer.platform, discrepancyDrawer.type],
    enabled: discrepancyDrawer.open && !!discrepancyDrawer.platform && !!discrepancyDrawer.type,
  });

  const handleDiscrepancyClick = (platform: string, type: string, title: string) => {
    setDiscrepancyDrawer({ open: true, platform, type, title });
    setItemsToShow(20); // Reset to initial count when opening new drawer
  };

  const displayData = data;

  return (
    <div className="space-y-3">
      {/* Source Platform */}
      <div>
        <h3 className="text-xs md:text-sm font-bold text-gray-300 mb-2 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 md:w-4 md:h-4 text-purple-400" />
          Source of Truth
          {isLoading && <Loader2 className="w-3 h-3 md:w-3.5 md:h-3.5 animate-spin text-purple-400" />}
        </h3>
        <Card className="bg-gray-800/50 border-purple-500/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs md:text-sm font-bold text-white">
                {isLoading ? <span className="inline-block bg-gray-700 h-3 w-20 rounded animate-pulse" /> : displayData?.source.name || 'BrickLink'}
              </p>
              <p className="text-[10px] md:text-xs text-gray-400">
                {isLoading ? (
                  <span className="inline-block bg-gray-700 h-2 w-32 rounded animate-pulse" />
                ) : (
                  displayData?.source.stats.lastSyncedAt 
                    ? `Last synced: ${new Date(displayData.source.stats.lastSyncedAt).toLocaleString()}`
                    : 'Never synced'
                )}
              </p>
            </div>
            <Badge variant="outline" className="bg-purple-500/10 border-purple-500/30 text-purple-400 text-[10px]">
              Active
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-900/50 rounded-lg p-2 border border-gray-700">
              <p className="text-[10px] md:text-xs text-gray-400 mb-0.5">Total Lots</p>
              <p className="text-sm md:text-base font-bold text-white font-mono">
                {isLoading ? (
                  <span className="inline-block bg-gray-700 h-4 w-16 rounded animate-pulse" />
                ) : (
                  displayData?.source.stats.totalLots.toLocaleString() || '0'
                )}
              </p>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-2 border border-gray-700">
              <p className="text-[10px] md:text-xs text-gray-400 mb-0.5">Total Parts</p>
              <p className="text-sm md:text-base font-bold text-white font-mono">
                {isLoading ? (
                  <span className="inline-block bg-gray-700 h-4 w-16 rounded animate-pulse" />
                ) : (
                  displayData?.source.stats.totalParts.toLocaleString() || '0'
                )}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Target Platforms */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs md:text-sm font-bold text-gray-300 flex items-center gap-1.5">
            <ArrowRight className="w-3.5 h-3.5 md:w-4 md:h-4 text-blue-400" />
            Selling Platforms
          </h3>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleSyncUnsynced(5)}
              disabled={syncingPlatform !== null}
              className="text-xs md:text-sm"
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
              variant="outline"
              onClick={handleSyncAll}
              disabled={syncingPlatform !== null}
              className="text-xs md:text-sm"
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
          ) : displayData?.targets.map((platform) => {
            const isSyncing = syncingPlatform === platform.name;
            const hasDiscrepancies = 
              platform.discrepancies.missingLots > 0 || 
              platform.discrepancies.missingParts > 0 ||
              platform.discrepancies.priceDifferences > 0 ||
              platform.discrepancies.quantityDifferences > 0 ||
              platform.discrepancies.remarksDifferences > 0 ||
              platform.discrepancies.descriptionDifferences > 0;

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
                    <p className="text-xs md:text-sm font-bold text-white">{platform.name}</p>
                    {!platform.enabled && (
                      <Badge variant="outline" className="text-[10px] text-gray-500 border-gray-600">
                        Not Configured
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSync(platform.name)}
                    disabled={!platform.enabled || isSyncing}
                    className="text-xs md:text-sm"
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
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="bg-gray-900/50 rounded-lg p-1.5 border border-gray-700">
                    <p className="text-[10px] md:text-xs text-gray-400 mb-0.5">Lots</p>
                    <p className="text-xs md:text-sm font-bold text-white font-mono">
                      {platform.enabled ? platform.stats.totalLots.toLocaleString() : '—'}
                    </p>
                  </div>
                  <div className="bg-gray-900/50 rounded-lg p-1.5 border border-gray-700">
                    <p className="text-[10px] md:text-xs text-gray-400 mb-0.5">Parts</p>
                    <p className="text-xs md:text-sm font-bold text-white font-mono">
                      {platform.enabled ? platform.stats.totalParts.toLocaleString() : '—'}
                    </p>
                  </div>
                </div>

                {/* Discrepancies */}
                {platform.enabled && hasDiscrepancies && (
                  <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-2">
                    <div className="flex items-start gap-1.5 mb-1.5">
                      <AlertTriangle className="w-3 h-3 text-orange-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-orange-400 mb-1">Discrepancies Found</p>
                        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                          {platform.discrepancies.missingLots > 0 && (
                            <button
                              onClick={() => handleDiscrepancyClick(platform.name, 'missing', `Missing Lots on ${platform.name}`)}
                              className="text-left text-gray-300 hover:text-orange-400 transition-colors cursor-pointer hover-elevate rounded px-1 py-0.5"
                              data-testid="button-discrepancy-missing"
                            >
                              <span className="text-orange-400 font-bold">{platform.discrepancies.missingLots}</span> missing lots
                            </button>
                          )}
                          {platform.discrepancies.missingParts > 0 && (
                            <div className="text-gray-300">
                              <span className="text-orange-400 font-bold">{platform.discrepancies.missingParts}</span> missing parts
                            </div>
                          )}
                          {platform.discrepancies.priceDifferences > 0 && (
                            <button
                              onClick={() => handleDiscrepancyClick(platform.name, 'price', `Price Differences on ${platform.name}`)}
                              className="text-left text-gray-300 hover:text-orange-400 transition-colors cursor-pointer hover-elevate rounded px-1 py-0.5"
                              data-testid="button-discrepancy-price"
                            >
                              <span className="text-orange-400 font-bold">{platform.discrepancies.priceDifferences}</span> price diffs
                            </button>
                          )}
                          {platform.discrepancies.quantityDifferences > 0 && (
                            <button
                              onClick={() => handleDiscrepancyClick(platform.name, 'quantity', `Quantity Differences on ${platform.name}`)}
                              className="text-left text-gray-300 hover:text-orange-400 transition-colors cursor-pointer hover-elevate rounded px-1 py-0.5"
                              data-testid="button-discrepancy-quantity"
                            >
                              <span className="text-orange-400 font-bold">{platform.discrepancies.quantityDifferences}</span> qty diffs
                            </button>
                          )}
                          {platform.discrepancies.remarksDifferences > 0 && (
                            <button
                              onClick={() => handleDiscrepancyClick(platform.name, 'remarks', `Personal Note (Remarks) Differences on ${platform.name}`)}
                              className="text-left text-gray-300 hover:text-orange-400 transition-colors cursor-pointer hover-elevate rounded px-1 py-0.5"
                              data-testid="button-discrepancy-remarks"
                            >
                              <span className="text-orange-400 font-bold">{platform.discrepancies.remarksDifferences}</span> remarks diffs
                            </button>
                          )}
                          {platform.discrepancies.descriptionDifferences > 0 && (
                            <button
                              onClick={() => handleDiscrepancyClick(platform.name, 'description', `Public Note (Description) Differences on ${platform.name}`)}
                              className="text-left text-gray-300 hover:text-orange-400 transition-colors cursor-pointer hover-elevate rounded px-1 py-0.5"
                              data-testid="button-discrepancy-description"
                            >
                              <span className="text-orange-400 font-bold">{platform.discrepancies.descriptionDifferences}</span> description diffs
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Last Sync Status */}
                {platform.enabled && platform.stats.lastSyncedAt && (
                  <div className="mt-1.5 flex items-center gap-1">
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
      <Card className="bg-blue-500/10 border-blue-500/30 p-2">
        <div className="flex items-start gap-1.5">
          <Info className="w-3 h-3 text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-bold text-blue-400 mb-0.5">Platform Configuration</p>
            <p className="text-[10px] text-gray-300">
              Configure API credentials in Settings → API Credentials to enable platform sync.
              Once configured, platforms will automatically sync inventory from {displayData?.source.name || 'BrickLink'}.
            </p>
          </div>
        </div>
      </Card>

      {/* Discrepancy Details Drawer */}
      <Drawer open={discrepancyDrawer.open} onOpenChange={(open) => setDiscrepancyDrawer({ ...discrepancyDrawer, open })}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="border-b border-gray-800">
            <div className="flex items-center justify-between">
              <DrawerTitle className="text-sm md:text-base text-white">{discrepancyDrawer.title}</DrawerTitle>
              <DrawerClose asChild>
                <Button variant="ghost" size="icon" data-testid="button-close-discrepancy">
                  <X className="h-4 w-4" />
                </Button>
              </DrawerClose>
            </div>
          </DrawerHeader>
          
          <div className="overflow-auto p-4">
            {discrepancyLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
              </div>
            ) : discrepancyData?.discrepancies && discrepancyData.discrepancies.length > 0 ? (
              <div className="space-y-2">
                {discrepancyData.discrepancies.slice(0, itemsToShow).map((item, idx) => (
                  <Card key={idx} className="p-3 bg-gray-800/50 border-gray-700">
                    <div className="space-y-2">
                      {/* Item Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="text-sm md:text-base font-bold text-white">{item.itemNo}</p>
                          <p className="text-xs md:text-sm text-gray-400">{item.itemName || 'Unknown Item'}</p>
                          {item.colorName && (
                            <p className="text-xs md:text-sm text-gray-500">{item.colorName}</p>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs md:text-sm">
                          <div className="text-right">
                            <p className="text-gray-400 text-[10px] md:text-xs">BrickLink</p>
                            <p className="text-white font-mono">Qty: {item.blQuantity}</p>
                            <p className="text-white font-mono">${item.blPrice.toFixed(2)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-gray-400 text-[10px] md:text-xs">{discrepancyDrawer.platform}</p>
                            <p className={`font-mono ${item.qtyDiff ? 'text-orange-400' : 'text-white'}`}>
                              Qty: {item.boQuantity}
                              {item.qtyDiff && item.qtyDiff !== 0 && (
                                <span className="text-orange-400 ml-1">({item.qtyDiff > 0 ? '+' : ''}{item.qtyDiff})</span>
                              )}
                            </p>
                            <p className={`font-mono ${item.priceDiff ? 'text-orange-400' : 'text-white'}`}>
                              ${item.boPrice.toFixed(2)}
                              {item.priceDiff && item.priceDiff !== 0 && (
                                <span className="text-orange-400 ml-1">({item.priceDiff > 0 ? '+' : ''}{item.priceDiff.toFixed(2)})</span>
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      {/* Remarks Difference */}
                      {item.difference === 'remarks' && (
                        <div className="border-t border-gray-700 pt-2">
                          <p className="text-[10px] font-bold text-orange-400 mb-1">Personal Note (Internal)</p>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <p className="text-gray-400 text-[10px]">BrickLink:</p>
                              <p className="text-white font-mono break-words">{item.blRemarks || '(empty)'}</p>
                            </div>
                            <div>
                              <p className="text-gray-400 text-[10px]">{discrepancyDrawer.platform}:</p>
                              <p className="text-white font-mono break-words">{item.boRemarks || '(empty)'}</p>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* Description Difference */}
                      {item.difference === 'description' && (
                        <div className="border-t border-gray-700 pt-2">
                          <p className="text-[10px] font-bold text-orange-400 mb-1">Public Note (Buyer Visible)</p>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <p className="text-gray-400 text-[10px]">BrickLink:</p>
                              <p className="text-white font-mono break-words">{item.blDescription || '(empty)'}</p>
                            </div>
                            <div>
                              <p className="text-gray-400 text-[10px]">{discrepancyDrawer.platform}:</p>
                              <p className="text-white font-mono break-words">{item.boDescription || '(empty)'}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
                
                {/* Show More Button and Count */}
                {discrepancyData.discrepancies.length > itemsToShow && (
                  <div className="flex flex-col items-center gap-2 pt-2">
                    <p className="text-xs text-gray-400">
                      Showing {itemsToShow} of {discrepancyData.discrepancies.length} discrepancies
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setItemsToShow(prev => Math.min(prev + 20, discrepancyData.discrepancies.length))}
                      className="text-xs"
                      data-testid="button-show-more"
                    >
                      Show More ({Math.min(20, discrepancyData.discrepancies.length - itemsToShow)})
                    </Button>
                  </div>
                )}
                
                {/* All items shown message */}
                {discrepancyData.discrepancies.length <= itemsToShow && discrepancyData.total > discrepancyData.discrepancies.length && (
                  <p className="text-xs text-gray-400 text-center py-2">
                    Showing first {discrepancyData.discrepancies.length} of {discrepancyData.total} discrepancies
                  </p>
                )}
              </div>
            ) : (
              <p className="text-gray-400 text-center py-8">No discrepancies found</p>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

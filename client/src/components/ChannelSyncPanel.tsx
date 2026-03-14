import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Globe,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  SlidersHorizontal,
  CalendarClock,
  PackageX,
  DollarSign,
  Hash,
  X,
  ChevronRight,
} from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";

interface ChannelSyncPanelProps {
  onOpenSettings?: (section?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'users' | 'billing') => void;
}

export default function ChannelSyncPanel({ onOpenSettings }: ChannelSyncPanelProps) {
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: platformData, isLoading: platformLoading } = useQuery<any>({
    queryKey: ['/api/platform-sync/status'],
    refetchInterval: 30000,
  });

  const { data: syncStatuses, isLoading: statusLoading } = useQuery<any>({
    queryKey: ['/api/sync/statuses'],
    refetchInterval: 15000,
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/sync/channel', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sync/statuses'] });
      toast({ title: 'Channel sync started', description: 'BrickOwl is syncing in the background.' });
      setDrawerOpen(false);
    },
    onError: () => {
      toast({ title: 'Sync failed', description: 'Could not start channel sync.', variant: 'destructive' });
    },
  });

  const brickOwl = platformData?.targets?.find((t: any) => t.name === 'BrickOwl');
  const lastSync = syncStatuses?.channel;
  const isRunning = lastSync?.lastSyncStatus === 'in_progress' || syncMutation.isPending;

  const missingLots = brickOwl?.discrepancies?.missingLots ?? 0;
  const priceDiffs = brickOwl?.discrepancies?.priceDifferences ?? 0;
  const qtyDiffs = brickOwl?.discrepancies?.quantityDifferences ?? 0;
  const totalDiscrepancies = missingLots + priceDiffs + qtyDiffs;

  const syncStatusColor =
    lastSync?.lastSyncStatus === 'success' ? 'text-green-400' :
    lastSync?.lastSyncStatus === 'partial' ? 'text-yellow-400' :
    lastSync?.lastSyncStatus === 'error' || lastSync?.lastSyncStatus === 'failed' ? 'text-red-400' :
    'text-gray-500';

  const SyncStatusIcon =
    lastSync?.lastSyncStatus === 'success' ? CheckCircle2 :
    lastSync?.lastSyncStatus === 'partial' ? AlertTriangle :
    lastSync?.lastSyncStatus === 'error' || lastSync?.lastSyncStatus === 'failed' ? XCircle :
    Clock;

  function relTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  const isLoading = platformLoading || statusLoading;

  if (!isLoading && !brickOwl?.enabled) {
    return (
      <div
        className="rounded-lg border border-green-500/20 bg-gradient-to-br from-green-950/30 to-gray-950/60 p-3"
        data-testid="channel-sync-panel"
      >
        <div className="flex items-center gap-2 mb-1">
          <Globe className="w-3.5 h-3.5 text-green-400/60 shrink-0" />
          <span className="text-xs font-semibold text-green-200/60">Channel Sync — BrickOwl</span>
        </div>
        <p className="text-[10px] text-gray-500">
          BrickOwl not configured — add your API key in Settings → Platform Connections to enable channel sync.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Entire panel is a button that opens the drawer */}
      <button
        onClick={() => setDrawerOpen(true)}
        className="w-full text-left rounded-lg border border-green-500/40 bg-gradient-to-br from-green-950/50 to-gray-950/70 p-3 space-y-2 hover-elevate"
        data-testid="channel-sync-panel"
      >
        {/* Header row */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-green-400 shrink-0" />
            <span className="text-xs font-semibold text-green-100">Channel Sync — BrickOwl</span>
            {isRunning && (
              <span className="flex items-center gap-1 text-[10px] text-blue-400">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                syncing…
              </span>
            )}
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
        </div>

        {/* Stats + last sync */}
        {isLoading ? (
          <div className="flex gap-4">
            <span className="inline-block bg-gray-700/60 h-3 w-16 rounded animate-pulse" />
            <span className="inline-block bg-gray-700/60 h-3 w-16 rounded animate-pulse" />
            <span className="inline-block bg-gray-700/60 h-3 w-24 rounded animate-pulse" />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {brickOwl?.stats && (
              <>
                <span className="text-[10px] text-gray-400">
                  <span className="text-white font-mono font-semibold">{brickOwl.stats.totalLots?.toLocaleString() ?? '—'}</span>
                  {' '}lots
                </span>
                <span className="text-[10px] text-gray-400">
                  <span className="text-white font-mono font-semibold">{brickOwl.stats.totalParts?.toLocaleString() ?? '—'}</span>
                  {' '}parts
                </span>
              </>
            )}
            {lastSync && (
              <span className={`flex items-center gap-1 text-[10px] ${syncStatusColor}`}>
                <SyncStatusIcon className="w-2.5 h-2.5" />
                {lastSync.lastSyncStatus === 'success'
                  ? `+${lastSync.recordsAdded ?? 0} created, ${lastSync.recordsUpdated ?? 0} updated`
                  : lastSync.lastSyncStatus === 'partial'
                  ? `${lastSync.recordsAdded ?? 0} created, ${lastSync.recordsUpdated ?? 0} updated — some errors`
                  : lastSync.lastSyncStatus === 'in_progress'
                  ? 'syncing…'
                  : lastSync.errorMessage ?? lastSync.lastSyncStatus}
                {lastSync.lastSyncTime && (
                  <span className="text-gray-500 ml-0.5">· {relTime(lastSync.lastSyncTime)}</span>
                )}
              </span>
            )}
            {!lastSync && (
              <span className="text-[10px] text-gray-500">Never synced</span>
            )}
          </div>
        )}

        {/* Discrepancies — compact indicator row (no separate click action) */}
        {!isLoading && totalDiscrepancies > 0 && (
          <div
            className="flex items-center gap-1.5 bg-orange-500/10 border border-orange-500/25 rounded px-2 py-1.5"
            data-testid="channel-discrepancy-indicator"
          >
            <AlertTriangle className="w-3 h-3 text-orange-400 shrink-0" />
            <span className="text-[10px] font-semibold text-orange-300">
              {totalDiscrepancies} discrepanc{totalDiscrepancies === 1 ? 'y' : 'ies'} detected
            </span>
          </div>
        )}

        {/* All clear */}
        {!isLoading && brickOwl?.enabled && totalDiscrepancies === 0 && lastSync?.lastSyncStatus === 'success' && (
          <div className="flex items-center gap-1.5 text-[10px] text-green-400/70">
            <CheckCircle2 className="w-2.5 h-2.5" />
            <span>BrickOwl is in sync</span>
          </div>
        )}
      </button>

      {/* Channel Details Drawer */}
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent className="bg-gray-950 border-gray-800 h-[65vh] flex flex-col rounded-t-2xl">
          <DrawerHeader className="p-0 flex-shrink-0">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-600" />
            </div>
            <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-gray-800">
              <Globe className="w-4 h-4 text-green-400 flex-shrink-0" />
              <DrawerTitle className="text-sm font-semibold text-gray-100 flex-1">
                BrickOwl — Channel Sync
              </DrawerTitle>
              <DrawerClose className="ml-2 text-gray-500 hover:text-gray-200 transition-colors" data-testid="button-close-channel-drawer">
                <X className="w-5 h-5" />
                <span className="sr-only">Close</span>
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto px-4 pt-3 pb-6 space-y-4 min-h-0">

            {/* Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="secondary"
                disabled={isRunning || syncMutation.isPending}
                onClick={() => syncMutation.mutate()}
                data-testid="button-channel-sync-now"
              >
                {syncMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                )}
                {isRunning ? 'Syncing…' : 'Sync Now'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setDrawerOpen(false); onOpenSettings?.('automation'); }}
                data-testid="button-channel-schedule"
              >
                <CalendarClock className="w-3.5 h-3.5 mr-1.5" />
                Schedule
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setDrawerOpen(false); onOpenSettings?.('automation'); }}
                data-testid="button-channel-sync-settings"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
                Settings
              </Button>
            </div>

            <Separator className="bg-gray-700/60" />

            {/* Discrepancy details */}
            {totalDiscrepancies > 0 ? (
              <>
                <p className="text-xs text-gray-400">
                  These discrepancies were detected between your BrickLink inventory and BrickOwl store. Running a sync will resolve them based on your current sync mode.
                </p>
                <div className="space-y-3">
                  <div className={`rounded-lg border p-3 ${missingLots > 0 ? 'border-orange-500/40 bg-orange-950/30' : 'border-gray-700/40 bg-gray-900/30 opacity-50'}`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <PackageX className="w-4 h-4 text-orange-400 shrink-0" />
                        <span className="text-sm font-semibold text-orange-200">Missing Lots</span>
                      </div>
                      <span className={`text-lg font-mono font-bold ${missingLots > 0 ? 'text-orange-300' : 'text-gray-500'}`}>
                        {missingLots}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">
                      Items present on BrickLink but not yet listed on BrickOwl. In <strong className="text-gray-300">Full Control</strong> mode, sync will create these listings automatically.
                    </p>
                  </div>

                  <div className={`rounded-lg border p-3 ${priceDiffs > 0 ? 'border-yellow-500/40 bg-yellow-950/30' : 'border-gray-700/40 bg-gray-900/30 opacity-50'}`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-yellow-400 shrink-0" />
                        <span className="text-sm font-semibold text-yellow-200">Price Differences</span>
                      </div>
                      <span className={`text-lg font-mono font-bold ${priceDiffs > 0 ? 'text-yellow-300' : 'text-gray-500'}`}>
                        {priceDiffs}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">
                      Items where BrickOwl price differs from BrickLink. Sync will update BrickOwl prices to match.
                    </p>
                  </div>

                  <div className={`rounded-lg border p-3 ${qtyDiffs > 0 ? 'border-blue-500/40 bg-blue-950/30' : 'border-gray-700/40 bg-gray-900/30 opacity-50'}`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <Hash className="w-4 h-4 text-blue-400 shrink-0" />
                        <span className="text-sm font-semibold text-blue-200">Quantity Differences</span>
                      </div>
                      <span className={`text-lg font-mono font-bold ${qtyDiffs > 0 ? 'text-blue-300' : 'text-gray-500'}`}>
                        {qtyDiffs}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">
                      Items where BrickOwl quantity differs from BrickLink. Sync will align quantities in both sync modes.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                <span>No discrepancies — BrickOwl is in sync with BrickLink.</span>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  CalendarClock,
  X,
  Package,
  ChevronRight,
  Hash,
  Database,
  ShoppingCart,
  Activity,
} from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";

interface BrickLinkSyncPanelProps {
  onOpenSettings?: (section?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'billing', focusTarget?: 'schedulerInventory' | 'schedulerOrders' | 'schedulerChannel' | 'channelSync') => void;
}

export default function BrickLinkSyncPanel({ onOpenSettings }: BrickLinkSyncPanelProps) {
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: syncStatuses } = useQuery<any>({
    queryKey: ['/api/sync/statuses'],
    refetchInterval: 15000,
  });

  const { data: inventoryStats } = useQuery<any>({
    queryKey: ['/api/inventory/stats'],
    refetchInterval: 60000,
  });

  const lastSync = syncStatuses?.inventory;
  const isRunning = lastSync?.lastSyncStatus === 'in_progress';

  const prevIsRunningRef = useRef(isRunning);
  useEffect(() => {
    const wasRunning = prevIsRunningRef.current;
    prevIsRunningRef.current = isRunning;
    if (wasRunning && !isRunning) {
      queryClient.invalidateQueries({ queryKey: ['/api/sync/statuses'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/stats'] });
    }
  }, [isRunning]);

  const { data: progressData } = useQuery<{ status: string; currentStep: string; progress: number; details: any }>({
    queryKey: ['/api/sync/bricklink/progress'],
    refetchInterval: isRunning ? 2000 : false,
    enabled: isRunning,
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/sync/bricklink/inventory', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sync/statuses'] });
      toast({ title: 'BrickLink sync started', description: 'Inventory is syncing in the background.' });
    },
    onError: () => {
      toast({ title: 'Sync failed', description: 'Could not start BrickLink sync.', variant: 'destructive' });
    },
  });

  const progressPct = progressData?.progress ?? 0;
  const showProgress = isRunning && progressData?.status === 'in_progress';

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

  const syncStatusColor =
    lastSync?.lastSyncStatus === 'success'  ? 'text-orange-300' :
    lastSync?.lastSyncStatus === 'partial'  ? 'text-yellow-400' :
    lastSync?.lastSyncStatus === 'error' || lastSync?.lastSyncStatus === 'failed' ? 'text-red-400' :
    'text-gray-500';

  const SyncStatusIcon =
    lastSync?.lastSyncStatus === 'success'  ? CheckCircle2 :
    lastSync?.lastSyncStatus === 'partial'  ? AlertTriangle :
    lastSync?.lastSyncStatus === 'error' || lastSync?.lastSyncStatus === 'failed' ? XCircle :
    Clock;

  return (
    <>
      <button
        onClick={() => setDrawerOpen(true)}
        className="w-full text-left rounded-lg border border-orange-500/40 bg-gradient-to-br from-orange-950/50 to-gray-950/70 p-3 space-y-2 hover-elevate"
        data-testid="bricklink-sync-panel"
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Package className="w-3.5 h-3.5 text-orange-400 shrink-0" />
            <span className="text-xs font-semibold text-orange-100">BrickLink — Inventory</span>
            {isRunning && (
              <span className="flex items-center gap-1 text-[10px] text-blue-400">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                syncing…
              </span>
            )}
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
        </div>

        {showProgress && (
          <div className="space-y-1" data-testid="bricklink-sync-progress">
            <Progress value={progressPct} className="h-1.5" />
            <div className="flex justify-between text-[10px] text-gray-500">
              <span>{progressData?.currentStep ?? 'Syncing…'}</span>
              <span className="tabular-nums">{progressPct}%</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {inventoryStats && (
            <>
              <span className="text-[10px] text-gray-400">
                <span className="text-white font-mono font-semibold">{inventoryStats.totalLots?.toLocaleString() ?? '—'}</span>
                {' '}lots
              </span>
              <span className="text-[10px] text-gray-400">
                <span className="text-white font-mono font-semibold">{inventoryStats.totalParts?.toLocaleString() ?? '—'}</span>
                {' '}parts
              </span>
            </>
          )}
          {lastSync ? (
            <span className={`flex items-center gap-1 text-[10px] ${syncStatusColor}`}>
              <SyncStatusIcon className="w-2.5 h-2.5" />
              {lastSync.lastSyncStatus === 'success'
                ? `+${lastSync.recordsAdded ?? 0} added, ${lastSync.recordsUpdated ?? 0} updated`
                : lastSync.lastSyncStatus === 'in_progress'
                ? 'syncing…'
                : lastSync.errorMessage ?? lastSync.lastSyncStatus}
              {lastSync.lastSyncTime && (
                <span className="text-gray-500 ml-0.5">· {relTime(lastSync.lastSyncTime)}</span>
              )}
            </span>
          ) : (
            <span className="text-[10px] text-gray-500">Never synced</span>
          )}
        </div>
      </button>

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent className="bg-gray-950 border-gray-800 h-[75vh] flex flex-col rounded-t-2xl">
          <DrawerHeader className="p-0 flex-shrink-0">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-600" />
            </div>
            <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-gray-800">
              <Package className="w-4 h-4 text-orange-400 flex-shrink-0" />
              <DrawerTitle className="text-sm font-semibold text-gray-100 flex-1">
                BrickLink — Inventory Sync
              </DrawerTitle>
              <DrawerClose
                className="ml-2 text-gray-500 hover:text-gray-200 transition-colors"
                data-testid="button-close-bricklink-drawer"
              >
                <X className="w-5 h-5" />
                <span className="sr-only">Close</span>
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto min-h-0 px-4 pt-3 pb-6 space-y-4">
            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="secondary"
                disabled={isRunning || syncMutation.isPending}
                onClick={() => syncMutation.mutate()}
                data-testid="button-bricklink-sync-now"
              >
                {syncMutation.isPending || isRunning ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                )}
                {isRunning ? 'Syncing…' : 'Sync Now'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setDrawerOpen(false); onOpenSettings?.('platforms', 'schedulerInventory'); }}
                data-testid="button-bricklink-schedule"
              >
                <CalendarClock className="w-3.5 h-3.5 mr-1.5" />
                Schedule
              </Button>
            </div>

            <Separator className="bg-gray-700/60" />

            {/* Live progress */}
            {isRunning && (
              <div className="space-y-2 rounded-lg border border-blue-500/30 bg-blue-950/20 p-3">
                <div className="flex items-center gap-2 text-xs text-blue-300">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span className="font-medium">Sync in progress</span>
                </div>
                {progressData && (
                  <>
                    <Progress value={progressPct} className="h-2" />
                    <div className="flex justify-between text-[10px] text-gray-400">
                      <span>{progressData.currentStep ?? 'Syncing…'}</span>
                      <span className="tabular-nums font-mono">{progressPct}%</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Last sync summary */}
            {lastSync && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 px-0.5">Last Sync</p>
                <div className="rounded-lg border border-gray-700/60 bg-gray-900/50 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <SyncStatusIcon className={`w-4 h-4 shrink-0 ${syncStatusColor}`} />
                    <span className={`text-sm font-medium ${syncStatusColor}`}>
                      {lastSync.lastSyncStatus === 'success'  ? 'Completed successfully'  :
                       lastSync.lastSyncStatus === 'in_progress' ? 'In progress…'           :
                       lastSync.lastSyncStatus === 'error'    ? 'Failed'                   :
                       lastSync.lastSyncStatus ?? 'Unknown'}
                    </span>
                    {lastSync.lastSyncTime && (
                      <span className="text-[10px] text-gray-500 ml-auto">{relTime(lastSync.lastSyncTime)}</span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Lots',    value: inventoryStats?.totalLots,    icon: Database,     color: 'text-orange-300' },
                      { label: 'Parts',   value: inventoryStats?.totalParts,   icon: Hash,         color: 'text-orange-300' },
                      { label: 'Added',   value: lastSync.recordsAdded,         icon: Package,      color: 'text-green-400'  },
                    ].map(({ label, value, icon: Icon, color }) => (
                      <div key={label} className="rounded bg-gray-800/60 px-2 py-1.5 text-center">
                        <p className={`text-base font-mono font-bold ${color}`}>
                          {value != null ? Number(value).toLocaleString() : '—'}
                        </p>
                        <p className="text-[9px] text-gray-500 mt-0.5">{label}</p>
                      </div>
                    ))}
                  </div>

                  {lastSync.recordsUpdated > 0 && (
                    <p className="text-[10px] text-gray-400">
                      <span className="font-mono font-semibold text-yellow-300">{Number(lastSync.recordsUpdated).toLocaleString()}</span>
                      {' '}lots updated
                    </p>
                  )}

                  {lastSync.errorMessage && lastSync.lastSyncStatus !== 'success' && (
                    <div className="flex items-start gap-1.5 rounded border border-red-500/30 bg-red-950/20 px-2 py-1.5">
                      <XCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-red-300/80">{lastSync.errorMessage}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* What this sync does */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 px-0.5">About This Sync</p>
              <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 p-3 space-y-1.5">
                {[
                  { icon: ShoppingCart, text: 'Pulls your live inventory from BrickLink into E.L.F.I.E.' },
                  { icon: Activity,     text: 'Detects new lots, quantity changes, price updates, and deletions' },
                  { icon: Database,     text: 'Powers Price-o-Matic, Catalog Enrichment, and Channel Sync' },
                ].map(({ icon: Icon, text }, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Icon className="w-3 h-3 text-orange-400/70 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-gray-400">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

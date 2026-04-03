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
  ArrowLeft,
  Plus,
  Pencil,
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
  inlineMode?: boolean;
  onClose?: () => void;
}

type ChangeDetailType = 'added' | 'updated' | null;

const FIELD_LABELS: Record<string, string> = {
  quantity: 'Qty',
  unitPrice: 'Price',
  isStockRoom: 'Stock Room',
  saleRate: 'Sale %',
  description: 'Description',
  remarks: 'Remarks',
  newOrUsed: 'Condition',
  colorId: 'Color',
  stockRoomId: 'Stockroom',
  myWeight: 'Weight',
  bulkQuantity: 'Bulk Min',
  tierQuantity1: 'Tier Qty 1', tierQuantity2: 'Tier Qty 2', tierQuantity3: 'Tier Qty 3',
  tierPrice1: 'Tier Price 1', tierPrice2: 'Tier Price 2', tierPrice3: 'Tier Price 3',
};

function fmtChangeVal(field: string, value: string | null | undefined): string {
  if (value == null || value === '' || value === 'null') return '—';
  if (field === 'unitPrice' || field.includes('Price') || field.includes('price')) {
    const n = parseFloat(value);
    return isNaN(n) ? value : `$${n.toFixed(2)}`;
  }
  if (value === 'true') return 'Yes';
  if (value === 'false') return 'No';
  if (value.length > 32) return value.slice(0, 30) + '…';
  return value;
}

function ChangeDiffRows({ changes }: { changes: { field: string; oldValue: string | null; newValue: string | null }[] }) {
  return (
    <div className="mt-1.5 space-y-[3px]">
      {changes.map((c) => {
        const label = FIELD_LABELS[c.field] ?? c.field;
        const oldDisplay = fmtChangeVal(c.field, c.oldValue);
        const newDisplay = fmtChangeVal(c.field, c.newValue);
        return (
          <div key={c.field} className="grid grid-cols-[5.5rem_auto] gap-x-1.5 items-baseline text-[9px] font-mono">
            <span className="text-gray-600 truncate">{label}</span>
            <span className="min-w-0">
              <span className="text-red-400/70">{oldDisplay}</span>
              <span className="text-gray-600 mx-1">→</span>
              <span className="text-green-400/80">{newDisplay}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function BrickLinkSyncPanel({ onOpenSettings, inlineMode, onClose }: BrickLinkSyncPanelProps) {
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [changeDetail, setChangeDetail] = useState<ChangeDetailType>(null);

  const { data: syncStatuses } = useQuery<any>({
    queryKey: ['/api/sync/statuses'],
    refetchInterval: 15000,
  });

  const { data: inventoryStats } = useQuery<any>({
    queryKey: ['/api/inventory/stats'],
    refetchInterval: 60000,
  });

  const lastSync = syncStatuses?.inventory;
  // True when the unified channel sync (BL pull + channel push) is running.
  // The BL step marks bricklink_inventory as in_progress, but if there's a lock collision
  // with a standalone BL sync, the status can flicker to error.  Detecting the channel
  // sync separately lets us keep showing progress instead of a spurious red warning.
  const isChannelSyncRunning = syncStatuses?.channel?.lastSyncStatus === 'in_progress';

  const syncMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/sync/bricklink/inventory', {}),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/sync/statuses'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/health'] });
      setDrawerOpen(false);
      const added = data?.data?.inventoryAdded ?? 0;
      const updated = data?.data?.inventoryUpdated ?? 0;
      toast({
        title: 'BrickLink inventory sync complete',
        description: added > 0 || updated > 0
          ? `${added} lot${added !== 1 ? 's' : ''} added, ${updated} updated.`
          : 'No changes detected.',
      });
    },
    onError: (err: any) => {
      toast({ title: 'Sync failed', description: err?.message || 'Could not sync BrickLink inventory.', variant: 'destructive' });
    },
  });

  const isRunning = lastSync?.lastSyncStatus === 'in_progress' || syncMutation.isPending;
  const anyRunning = isRunning || isChannelSyncRunning;

  const prevIsRunningRef = useRef(anyRunning);
  useEffect(() => {
    const wasRunning = prevIsRunningRef.current;
    prevIsRunningRef.current = anyRunning;
    if (wasRunning && !anyRunning) {
      queryClient.invalidateQueries({ queryKey: ['/api/sync/statuses'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/health'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sync/bricklink/recent-changes'] });
    }
  }, [anyRunning]);

  const { data: progressData } = useQuery<{ status: string; currentStep: string; progress: number; details: any }>({
    queryKey: ['/api/sync/bricklink/progress'],
    refetchInterval: anyRunning ? 2000 : false,
    enabled: anyRunning,
  });

  const { data: recentChanges, isLoading: recentChangesLoading } = useQuery<{ items: any[]; totalCount: number }>({
    queryKey: ['/api/sync/bricklink/recent-changes', changeDetail],
    queryFn: () => apiRequest('GET', `/api/sync/bricklink/recent-changes?type=${changeDetail}&limit=50`),
    enabled: (drawerOpen || !!inlineMode) && changeDetail !== null,
    staleTime: 30000,
  });

  const progressPct = progressData?.progress ?? 0;
  const showProgress = anyRunning;

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

  // When channel sync is running but BL is not individually running, treat as neutral/in-progress
  const effectiveStatus = (isChannelSyncRunning && !isRunning)
    ? 'in_progress'
    : lastSync?.lastSyncStatus;

  const syncStatusColor =
    effectiveStatus === 'success'  ? 'text-orange-300' :
    effectiveStatus === 'partial'  ? 'text-yellow-400' :
    effectiveStatus === 'error' || effectiveStatus === 'failed' ? 'text-red-400' :
    effectiveStatus === 'in_progress' ? 'text-blue-400' :
    'text-gray-500';

  const SyncStatusIcon =
    effectiveStatus === 'success'  ? CheckCircle2 :
    effectiveStatus === 'partial'  ? AlertTriangle :
    effectiveStatus === 'error' || effectiveStatus === 'failed' ? XCircle :
    Loader2;

  const addedCount = lastSync?.recordsAdded ?? 0;
  const updatedCount = lastSync?.recordsUpdated ?? 0;

  if (inlineMode) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Inline header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 flex-shrink-0">
          {changeDetail ? (
            <button onClick={() => setChangeDetail(null)} className="text-gray-400 hover:text-gray-200 transition-colors mr-1 flex-shrink-0" data-testid="button-back-change-detail">
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <Package className="w-4 h-4 text-orange-400 flex-shrink-0" />
          )}
          <span className="text-sm font-semibold text-gray-100 flex-1">
            {changeDetail === 'added' ? 'Recently Added Lots' : changeDetail === 'updated' ? 'Recently Updated Lots' : 'BrickLink — Inventory Sync'}
          </span>
          {onClose && !changeDetail && (
            <button onClick={onClose} className="text-gray-500 hover:text-gray-200 transition-colors flex-shrink-0" data-testid="button-close-bricklink-inline">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-4 pt-3 pb-6 space-y-4">
          {changeDetail ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 flex-1">
                  {changeDetail === 'added' ? 'Most recently added' : 'Most recently updated'}
                </p>
                <span className="text-[10px] text-gray-600">showing up to 50</span>
              </div>
              {recentChangesLoading ? (
                <div className="flex items-center gap-2 py-6 justify-center text-gray-500 text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading…</div>
              ) : !recentChanges?.items?.length ? (
                <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 p-4 text-center text-xs text-gray-500">No items found</div>
              ) : (
                <div className="space-y-1">
                  {recentChanges.items.map((item: any) => (
                    <div key={item.id} className="flex items-start gap-3 rounded-md bg-gray-900/50 px-2.5 py-2" data-testid={`row-bl-change-${item.id}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-mono font-semibold text-orange-300">{item.itemNo}</span>
                          <span className="text-[9px] text-gray-600">{item.newOrUsed === 'N' ? 'New' : 'Used'}</span>
                          {item.colorName && <span className="text-[9px] text-gray-500 truncate">{item.colorName}</span>}
                        </div>
                        {item.itemName && <p className="text-[10px] text-gray-400 truncate mt-0.5">{item.itemName}</p>}
                        {/* Change diffs for "updated" items */}
                        {changeDetail === 'updated' && item.changes?.length > 0 && (
                          <ChangeDiffRows changes={item.changes} />
                        )}
                        {changeDetail === 'updated' && !item.changes?.length && (
                          <p className="text-[9px] text-gray-600 mt-0.5 italic">qty: ×{item.quantity?.toLocaleString()} · ${parseFloat(item.unitPrice ?? 0).toFixed(2)}</p>
                        )}
                      </div>
                      {changeDetail === 'added' && (
                        <div className="text-right shrink-0">
                          <p className="text-[10px] font-mono font-semibold text-white">×{item.quantity?.toLocaleString()}</p>
                          {item.unitPrice && <p className="text-[9px] text-gray-500">${parseFloat(item.unitPrice).toFixed(2)}</p>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="secondary" disabled={isRunning || syncMutation.isPending} onClick={() => syncMutation.mutate()} data-testid="button-bricklink-sync-now">
                  {syncMutation.isPending || isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                  {isRunning ? 'Syncing…' : 'Sync Now'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onOpenSettings?.('platforms', 'schedulerInventory')} data-testid="button-bricklink-schedule">
                  <CalendarClock className="w-3.5 h-3.5 mr-1.5" />Schedule
                </Button>
              </div>
              <Separator className="bg-gray-700/60" />
              {anyRunning && (
                <div className="space-y-2 rounded-lg border border-blue-500/30 bg-blue-950/20 p-3">
                  <div className="flex items-center gap-2 text-xs text-blue-300"><Loader2 className="w-3.5 h-3.5 animate-spin" /><span className="font-medium">{isChannelSyncRunning && !isRunning ? 'Channel sync in progress' : 'Sync in progress'}</span></div>
                  {progressData && (<><Progress value={progressPct} className="h-2" /><div className="flex justify-between text-[10px] text-gray-400"><span>{isChannelSyncRunning && !isRunning ? 'Channel sync — updating channels…' : (progressData.currentStep ?? 'Syncing…')}</span><span className="tabular-nums font-mono">{progressPct}%</span></div></>)}
                </div>
              )}
              {lastSync && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 px-0.5">Last Sync</p>
                  <div className="rounded-lg border border-gray-700/60 bg-gray-900/50 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <SyncStatusIcon className={`w-4 h-4 shrink-0 ${syncStatusColor}`} />
                      <span className={`text-sm font-medium ${syncStatusColor}`}>
                        {lastSync.lastSyncStatus === 'success' ? 'Completed successfully' : lastSync.lastSyncStatus === 'in_progress' ? 'In progress…' : lastSync.lastSyncStatus === 'error' ? 'Failed' : lastSync.lastSyncStatus ?? 'Unknown'}
                      </span>
                      {lastSync.lastSyncTime && <span className="text-[10px] text-gray-500 ml-auto">{relTime(lastSync.lastSyncTime)}</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: 'Lots',    value: inventoryStats?.totalLots,  color: 'text-orange-300', clickable: false },
                        { label: 'Parts',   value: inventoryStats?.totalParts, color: 'text-orange-300', clickable: false },
                        { label: 'Added',   value: addedCount,                 color: 'text-green-400',  clickable: true, type: 'added'   as const },
                        { label: 'Updated', value: updatedCount,               color: 'text-yellow-300', clickable: true, type: 'updated' as const },
                      ].map(({ label, value, color, clickable, type }) =>
                        clickable ? (
                          <button key={label} onClick={() => setChangeDetail(type!)} className="rounded bg-gray-800/60 px-2 py-1.5 text-center hover-elevate active-elevate-2 w-full" data-testid={`button-bl-stat-${label.toLowerCase()}`}>
                            <p className={`text-base font-mono font-bold ${color}`}>{value != null ? Number(value).toLocaleString() : '—'}</p>
                            <p className="text-[9px] text-gray-500 mt-0.5 flex items-center justify-center gap-0.5">{label}<ChevronRight className="w-2.5 h-2.5 text-gray-600" /></p>
                          </button>
                        ) : (
                          <div key={label} className="rounded bg-gray-800/60 px-2 py-1.5 text-center">
                            <p className={`text-base font-mono font-bold ${color}`}>{value != null ? Number(value).toLocaleString() : '—'}</p>
                            <p className="text-[9px] text-gray-500 mt-0.5">{label}</p>
                          </div>
                        )
                      )}
                    </div>
                    {lastSync.errorMessage && lastSync.lastSyncStatus !== 'success' && (
                      <div className="flex items-start gap-1.5 rounded border border-red-500/30 bg-red-950/20 px-2 py-1.5">
                        <XCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" /><p className="text-[10px] text-red-300/80">{lastSync.errorMessage}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 px-0.5">About This Sync</p>
                <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 p-3 space-y-1.5">
                  {[
                    { icon: ShoppingCart, text: 'Pulls your live inventory from BrickLink into E.L.F.I.E.' },
                    { icon: Activity,     text: 'Detects new lots, quantity changes, price updates, and deletions' },
                    { icon: Database,     text: 'Powers Price-o-Matic, Catalog Enrichment, and Channel Sync' },
                  ].map(({ icon: Ic, text }, i) => (
                    <div key={i} className="flex items-start gap-2"><Ic className="w-3 h-3 text-orange-400/70 shrink-0 mt-0.5" /><p className="text-[10px] text-gray-400">{text}</p></div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

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
              <span>{isChannelSyncRunning && !isRunning ? 'Channel sync — updating channels…' : (progressData?.currentStep ?? 'Syncing…')}</span>
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
          {(lastSync || isChannelSyncRunning) ? (
            <span className={`flex items-center gap-1 text-[10px] ${syncStatusColor}`}>
              <SyncStatusIcon className={`w-2.5 h-2.5 ${anyRunning ? 'animate-spin' : ''}`} />
              {isChannelSyncRunning && !isRunning
                ? 'channel sync in progress'
                : lastSync?.lastSyncStatus === 'success'
                ? `+${addedCount} added, ${updatedCount} updated`
                : lastSync?.lastSyncStatus === 'in_progress'
                ? 'syncing…'
                : lastSync?.errorMessage ?? lastSync?.lastSyncStatus}
              {!anyRunning && lastSync?.lastSyncTime && (
                <span className="text-gray-500 ml-0.5">· {relTime(lastSync.lastSyncTime)}</span>
              )}
            </span>
          ) : (
            <span className="text-[10px] text-gray-500">Never synced</span>
          )}
        </div>
      </button>

      <Drawer open={drawerOpen} onOpenChange={(open) => { setDrawerOpen(open); if (!open) setChangeDetail(null); }}>
        <DrawerContent className="bg-gray-950 border-gray-800 h-[75vh] flex flex-col rounded-t-2xl">
          <DrawerHeader className="p-0 flex-shrink-0">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-600" />
            </div>
            <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-gray-800">
              {changeDetail ? (
                <button
                  onClick={() => setChangeDetail(null)}
                  className="text-gray-400 hover:text-gray-200 transition-colors mr-1"
                  data-testid="button-back-change-detail"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              ) : (
                <Package className="w-4 h-4 text-orange-400 flex-shrink-0" />
              )}
              <DrawerTitle className="text-sm font-semibold text-gray-100 flex-1">
                {changeDetail === 'added'
                  ? 'Recently Added Lots'
                  : changeDetail === 'updated'
                  ? 'Recently Updated Lots'
                  : 'BrickLink — Inventory Sync'}
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

            {/* ── Change detail drilldown ── */}
            {changeDetail ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 flex-1">
                    {changeDetail === 'added' ? 'Most recently added' : 'Most recently updated'}
                  </p>
                  <span className="text-[10px] text-gray-600">showing up to 50</span>
                </div>
                {recentChangesLoading ? (
                  <div className="flex items-center gap-2 py-6 justify-center text-gray-500 text-xs">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading…
                  </div>
                ) : !recentChanges?.items?.length ? (
                  <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 p-4 text-center text-xs text-gray-500">
                    No items found
                  </div>
                ) : (
                  <div className="space-y-1">
                    {recentChanges.items.map((item: any) => (
                      <div
                        key={item.id}
                        className="flex items-start gap-3 rounded-md bg-gray-900/50 px-2.5 py-2"
                        data-testid={`row-bl-change-${item.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono font-semibold text-orange-300">{item.itemNo}</span>
                            <span className="text-[9px] text-gray-600">{item.newOrUsed === 'N' ? 'New' : 'Used'}</span>
                            {item.colorName && (
                              <span className="text-[9px] text-gray-500 truncate">{item.colorName}</span>
                            )}
                          </div>
                          {item.itemName && (
                            <p className="text-[10px] text-gray-400 truncate mt-0.5">{item.itemName}</p>
                          )}
                          {/* Change diffs for "updated" items */}
                          {changeDetail === 'updated' && item.changes?.length > 0 && (
                            <ChangeDiffRows changes={item.changes} />
                          )}
                          {changeDetail === 'updated' && !item.changes?.length && (
                            <p className="text-[9px] text-gray-600 mt-0.5 italic">qty: ×{item.quantity?.toLocaleString()} · ${parseFloat(item.unitPrice ?? 0).toFixed(2)}</p>
                          )}
                        </div>
                        {changeDetail === 'added' && (
                          <div className="text-right shrink-0">
                            <p className="text-[10px] font-mono font-semibold text-white">×{item.quantity?.toLocaleString()}</p>
                            {item.unitPrice && (
                              <p className="text-[9px] text-gray-500">${parseFloat(item.unitPrice).toFixed(2)}</p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
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

                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: 'Lots',    value: inventoryStats?.totalLots,    color: 'text-orange-300', clickable: false },
                          { label: 'Parts',   value: inventoryStats?.totalParts,   color: 'text-orange-300', clickable: false },
                          { label: 'Added',   value: addedCount,                   color: 'text-green-400',  clickable: true,  type: 'added'   as const },
                          { label: 'Updated', value: updatedCount,                 color: 'text-yellow-300', clickable: true,  type: 'updated' as const },
                        ].map(({ label, value, color, clickable, type }) =>
                          clickable ? (
                            <button
                              key={label}
                              onClick={() => setChangeDetail(type!)}
                              className="rounded bg-gray-800/60 px-2 py-1.5 text-center hover-elevate active-elevate-2 w-full"
                              data-testid={`button-bl-stat-${label.toLowerCase()}`}
                            >
                              <p className={`text-base font-mono font-bold ${color}`}>
                                {value != null ? Number(value).toLocaleString() : '—'}
                              </p>
                              <p className="text-[9px] text-gray-500 mt-0.5 flex items-center justify-center gap-0.5">
                                {label}
                                <ChevronRight className="w-2.5 h-2.5 text-gray-600" />
                              </p>
                            </button>
                          ) : (
                            <div key={label} className="rounded bg-gray-800/60 px-2 py-1.5 text-center">
                              <p className={`text-base font-mono font-bold ${color}`}>
                                {value != null ? Number(value).toLocaleString() : '—'}
                              </p>
                              <p className="text-[9px] text-gray-500 mt-0.5">{label}</p>
                            </div>
                          )
                        )}
                      </div>

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
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

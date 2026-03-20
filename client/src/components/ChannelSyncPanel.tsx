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
  ArrowLeft,
  MessageSquare,
  FileText,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";

type DiscrepancyType = 'missing' | 'price' | 'quantity' | 'remarks' | 'description';

interface DiscrepancyArea {
  type: DiscrepancyType;
  label: string;
  icon: React.ElementType;
  accentColor: string;
  borderColor: string;
  bgColor: string;
  count: number;
  description: string;
}

interface ChannelSyncPanelProps {
  onOpenSettings?: (section?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'billing') => void;
}

export default function ChannelSyncPanel({ onOpenSettings }: ChannelSyncPanelProps) {
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedArea, setSelectedArea] = useState<DiscrepancyType | null>(null);

  const { data: platformData, isLoading: platformLoading } = useQuery<any>({
    queryKey: ['/api/platform-sync/status'],
    refetchInterval: 30000,
  });

  const { data: syncStatuses, isLoading: statusLoading } = useQuery<any>({
    queryKey: ['/api/sync/statuses'],
    refetchInterval: 15000,
  });

  const discrepancyUrl = selectedArea
    ? `/api/platform-sync/discrepancies/BrickOwl/${selectedArea}`
    : null;

  const { data: detailData, isLoading: detailLoading } = useQuery<any>({
    queryKey: ['/api/platform-sync/discrepancies/BrickOwl', selectedArea],
    queryFn: () => fetch(discrepancyUrl!).then(r => r.json()),
    enabled: !!selectedArea && drawerOpen && !!discrepancyUrl,
    refetchOnWindowFocus: false,
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
  const remarksDiffs = brickOwl?.discrepancies?.remarksDifferences ?? 0;
  const descriptionDiffs = brickOwl?.discrepancies?.descriptionDifferences ?? 0;
  const totalDiscrepancies = missingLots + priceDiffs + qtyDiffs + remarksDiffs + descriptionDiffs;

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

  const discrepancyAreas: DiscrepancyArea[] = [
    {
      type: 'missing',
      label: 'Missing Lots',
      icon: PackageX,
      accentColor: 'text-orange-400',
      borderColor: 'border-orange-500/40',
      bgColor: 'bg-orange-950/30',
      count: missingLots,
      description: 'On BrickLink but not listed on BrickOwl',
    },
    {
      type: 'price',
      label: 'Price Differences',
      icon: DollarSign,
      accentColor: 'text-yellow-400',
      borderColor: 'border-yellow-500/40',
      bgColor: 'bg-yellow-950/30',
      count: priceDiffs,
      description: 'BrickOwl price differs from BrickLink',
    },
    {
      type: 'quantity',
      label: 'Quantity Differences',
      icon: Hash,
      accentColor: 'text-blue-400',
      borderColor: 'border-blue-500/40',
      bgColor: 'bg-blue-950/30',
      count: qtyDiffs,
      description: 'BrickOwl quantity differs from BrickLink',
    },
    {
      type: 'remarks',
      label: 'Remark Differences',
      icon: MessageSquare,
      accentColor: 'text-purple-400',
      borderColor: 'border-purple-500/40',
      bgColor: 'bg-purple-950/30',
      count: remarksDiffs,
      description: 'Internal notes (remarks) are out of sync',
    },
    {
      type: 'description',
      label: 'Description Differences',
      icon: FileText,
      accentColor: 'text-pink-400',
      borderColor: 'border-pink-500/40',
      bgColor: 'bg-pink-950/30',
      count: descriptionDiffs,
      description: 'Public listing descriptions differ',
    },
  ].filter(a => a.count > 0);

  const activeArea = discrepancyAreas.find(a => a.type === selectedArea);

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
      <button
        onClick={() => setDrawerOpen(true)}
        className="w-full text-left rounded-lg border border-green-500/40 bg-gradient-to-br from-green-950/50 to-gray-950/70 p-3 space-y-2 hover-elevate"
        data-testid="channel-sync-panel"
      >
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

        {!isLoading && brickOwl?.enabled && totalDiscrepancies === 0 && lastSync?.lastSyncStatus === 'success' && (
          <div className="flex items-center gap-1.5 text-[10px] text-green-400/70">
            <CheckCircle2 className="w-2.5 h-2.5" />
            <span>BrickOwl is in sync</span>
          </div>
        )}
      </button>

      <Drawer open={drawerOpen} onOpenChange={(open) => { setDrawerOpen(open); if (!open) setSelectedArea(null); }}>
        <DrawerContent className="bg-gray-950 border-gray-800 h-[75vh] flex flex-col rounded-t-2xl">
          <DrawerHeader className="p-0 flex-shrink-0">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-600" />
            </div>
            <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-gray-800">
              {selectedArea ? (
                <button
                  onClick={() => setSelectedArea(null)}
                  className="text-gray-400 hover:text-gray-200 transition-colors mr-1 flex-shrink-0"
                  data-testid="button-discrepancy-back"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              ) : (
                <Globe className="w-4 h-4 text-green-400 flex-shrink-0" />
              )}
              <DrawerTitle className="text-sm font-semibold text-gray-100 flex-1">
                {selectedArea && activeArea
                  ? <span className="flex items-center gap-1.5">
                      <activeArea.icon className={`w-4 h-4 ${activeArea.accentColor} flex-shrink-0`} />
                      {activeArea.label}
                    </span>
                  : 'BrickOwl — Channel Sync'}
              </DrawerTitle>
              <DrawerClose
                className="ml-2 text-gray-500 hover:text-gray-200 transition-colors"
                data-testid="button-close-channel-drawer"
                onClick={() => setSelectedArea(null)}
              >
                <X className="w-5 h-5" />
                <span className="sr-only">Close</span>
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto min-h-0">
            {selectedArea ? (
              <DiscrepancyDetail
                area={activeArea!}
                data={detailData}
                isLoading={detailLoading}
              />
            ) : (
              <OverviewContent
                brickOwl={brickOwl}
                lastSync={lastSync}
                isLoading={isLoading}
                isRunning={isRunning}
                syncMutation={syncMutation}
                onOpenSettings={onOpenSettings}
                setDrawerOpen={setDrawerOpen}
                discrepancyAreas={discrepancyAreas}
                totalDiscrepancies={totalDiscrepancies}
                onSelectArea={(type) => setSelectedArea(type)}
              />
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function OverviewContent({
  brickOwl,
  lastSync,
  isLoading,
  isRunning,
  syncMutation,
  onOpenSettings,
  setDrawerOpen,
  discrepancyAreas,
  totalDiscrepancies,
  onSelectArea,
}: any) {
  return (
    <div className="px-4 pt-3 pb-6 space-y-4">
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

      {totalDiscrepancies > 0 ? (
        <>
          <p className="text-xs text-gray-400">
            Tap any area below to see exactly which items are out of sync between BrickLink and BrickOwl.
          </p>
          <div className="space-y-2">
            {discrepancyAreas.map((area: DiscrepancyArea) => (
              <button
                key={area.type}
                onClick={() => onSelectArea(area.type)}
                className={`w-full text-left rounded-lg border p-3 hover-elevate transition-opacity ${area.borderColor} ${area.bgColor}`}
                data-testid={`button-discrepancy-area-${area.type}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <area.icon className={`w-4 h-4 ${area.accentColor} shrink-0`} />
                    <div>
                      <span className={`text-sm font-semibold ${area.accentColor.replace('400', '200')}`}>
                        {area.label}
                      </span>
                      <p className="text-[11px] text-gray-400 mt-0.5">{area.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-lg font-mono font-bold ${area.accentColor}`}>
                      {area.count}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : !isLoading && brickOwl?.enabled ? (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
          <span>No discrepancies — BrickOwl is in sync with BrickLink.</span>
        </div>
      ) : isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 rounded-lg bg-gray-800/60 animate-pulse" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DiscrepancyDetail({ area, data, isLoading }: {
  area: DiscrepancyArea;
  data: any;
  isLoading: boolean;
}) {
  const items: any[] = data?.discrepancies ?? [];
  const total: number = data?.total ?? 0;

  if (isLoading) {
    return (
      <div className="px-4 pt-4 pb-6 space-y-2">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-14 rounded-lg bg-gray-800/60 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data || items.length === 0) {
    return (
      <div className="px-4 pt-6 flex flex-col items-center gap-2 text-center">
        <CheckCircle2 className="w-8 h-8 text-green-400" />
        <p className="text-sm text-gray-300 font-medium">All clear</p>
        <p className="text-xs text-gray-500">
          {data?.message ?? 'No discrepancies found. Try refreshing the sync status.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0">
      {total > items.length && (
        <div className="px-4 pt-3 pb-1">
          <p className="text-[11px] text-gray-500">
            Showing {items.length} of {total} items
          </p>
        </div>
      )}
      <div className="px-4 pt-2 pb-6 space-y-2">
        {items.map((item: any, i: number) => (
          <DiscrepancyRow key={`${item.itemNo}-${i}`} item={item} type={area.type} area={area} />
        ))}
      </div>
    </div>
  );
}

function DiscrepancyRow({ item, type, area }: {
  item: any;
  type: DiscrepancyType;
  area: DiscrepancyArea;
}) {
  return (
    <div
      className={`rounded-lg border ${area.borderColor} bg-gray-900/60 p-3 space-y-1.5`}
      data-testid={`discrepancy-row-${type}-${item.itemNo}`}
    >
      {/* Item identity */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-gray-100 truncate">{item.itemName || item.itemNo}</p>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            <span className="text-[10px] text-gray-400">{item.itemNo}</span>
            {item.lotId != null && (
              <span className="font-mono text-[9px] text-gray-600 bg-gray-800 border border-gray-700 rounded px-1 py-px">#{item.lotId}</span>
            )}
            {item.colorName && (
              <span className="text-[10px] text-gray-500">{item.colorName}</span>
            )}
            {item.condition && (
              <span className={`text-[9px] font-medium px-1.5 py-px rounded border ${item.condition === 'N' ? 'text-blue-300 bg-blue-500/10 border-blue-500/25' : 'text-amber-300 bg-amber-500/10 border-amber-500/25'}`}>
                {item.condition === 'N' ? 'New' : 'Used'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Discrepancy details */}
      {type === 'missing' && (
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-gray-400">BrickLink qty: <span className="text-white font-mono">{item.blQuantity ?? '—'}</span></span>
          <span className="text-gray-400">BrickLink price: <span className="text-white font-mono">${Number(item.blPrice ?? 0).toFixed(2)}</span></span>
          <span className="text-orange-400 font-medium">Not on BrickOwl</span>
        </div>
      )}

      {type === 'price' && (
        <div className="flex items-center gap-3 flex-wrap text-[11px]">
          <span className="flex items-center gap-1 text-gray-400">
            BrickLink: <span className="text-white font-mono ml-0.5">${Number(item.blPrice ?? 0).toFixed(2)}</span>
          </span>
          <span className="flex items-center gap-1 text-gray-400">
            BrickOwl: <span className="text-white font-mono ml-0.5">${Number(item.boPrice ?? 0).toFixed(2)}</span>
          </span>
          {item.priceDiff != null && (
            <span className={`flex items-center gap-0.5 font-semibold ${item.priceDiff > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {item.priceDiff > 0
                ? <TrendingUp className="w-3 h-3" />
                : <TrendingDown className="w-3 h-3" />}
              {item.priceDiff > 0 ? '+' : ''}${Number(item.priceDiff).toFixed(2)} on BO
            </span>
          )}
        </div>
      )}

      {type === 'quantity' && (
        <div className="flex items-center gap-3 flex-wrap text-[11px]">
          <span className="flex items-center gap-1 text-gray-400">
            BrickLink: <span className="text-white font-mono ml-0.5">{item.blQuantity ?? '—'}</span>
          </span>
          <span className="flex items-center gap-1 text-gray-400">
            BrickOwl: <span className="text-white font-mono ml-0.5">{item.boQuantity ?? '—'}</span>
          </span>
          {item.qtyDiff != null && (
            <span className={`flex items-center gap-0.5 font-semibold ${item.qtyDiff > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {item.qtyDiff > 0
                ? <TrendingUp className="w-3 h-3" />
                : <TrendingDown className="w-3 h-3" />}
              {item.qtyDiff > 0 ? '+' : ''}{item.qtyDiff} on BO
            </span>
          )}
        </div>
      )}

      {type === 'remarks' && (
        <div className="space-y-1 text-[11px]">
          <div className="flex items-start gap-1.5">
            <span className="text-gray-500 w-14 flex-shrink-0">BrickLink:</span>
            <span className="text-gray-300 break-all">{item.blRemarks || <em className="text-gray-600">empty</em>}</span>
          </div>
          <div className="flex items-start gap-1.5">
            <span className="text-gray-500 w-14 flex-shrink-0">BrickOwl:</span>
            <span className="text-gray-300 break-all">{item.boRemarks || <em className="text-gray-600">empty</em>}</span>
          </div>
        </div>
      )}

      {type === 'description' && (
        <div className="space-y-1 text-[11px]">
          <div className="flex items-start gap-1.5">
            <span className="text-gray-500 w-14 flex-shrink-0">BrickLink:</span>
            <span className="text-gray-300 break-all line-clamp-2">{item.blDescription || <em className="text-gray-600">empty</em>}</span>
          </div>
          <div className="flex items-start gap-1.5">
            <span className="text-gray-500 w-14 flex-shrink-0">BrickOwl:</span>
            <span className="text-gray-300 break-all line-clamp-2">{item.boDescription || <em className="text-gray-600">empty</em>}</span>
          </div>
        </div>
      )}
    </div>
  );
}

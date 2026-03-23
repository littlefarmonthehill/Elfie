import { useState, useEffect, useRef } from "react";
import { BoidReviewPanel } from "@/components/BoidReviewPanel";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";
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
  Printer,
  Download,
  ClipboardList,
  Unlink,
  GitMerge,
  Layers,
  Scale,
  EyeOff,
  StopCircle,
  Percent,
} from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";

type SyncMode = 'analysis' | 'matched_sync' | 'full_control';

interface SyncPreviewBreakdown {
  matchedLots:   number;
  unmatchedLots: number;
  wouldUpdate:   number;
  wouldCreate:   number;
  byField: {
    qty: number; price: number; remarks: number; description: number;
    tierPrice: number; salePercent: number; forSale: number;
    bulkQty: number; lotWeight: number;
  };
}

function SyncModeBadge({ mode, size = 'sm' }: { mode?: SyncMode; size?: 'sm' | 'md' }) {
  if (!mode) return null;
  const cfg = {
    analysis:     { label: 'Analyze Only', classes: 'bg-blue-900/50 text-blue-300 border-blue-500/30' },
    matched_sync: { label: 'Matched Sync', classes: 'bg-amber-900/50 text-amber-300 border-amber-500/30' },
    full_control: { label: 'Full Sync',    classes: 'bg-green-900/50 text-green-300 border-green-500/30' },
  }[mode];
  return (
    <span className={`inline-flex items-center rounded border px-1.5 font-medium ${cfg.classes} ${size === 'sm' ? 'text-[9px] py-0' : 'text-[10px] py-0.5'}`}>
      {cfg.label}
    </span>
  );
}

type DiscrepancyType = 'missing' | 'price' | 'quantity' | 'remarks' | 'description' | 'unlinked' | 'orphaned' | 'bulk_qty' | 'lot_weight' | 'for_sale' | 'sale_percent';

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
  onOpenSettings?: (section?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'billing', focusTarget?: 'channelSync') => void;
}

export default function ChannelSyncPanel({ onOpenSettings }: ChannelSyncPanelProps) {
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedArea, setSelectedArea] = useState<DiscrepancyType | null>(null);
  const [showAuditReport, setShowAuditReport] = useState(false);
  const [previewResult, setPreviewResult] = useState<SyncPreviewBreakdown | null>(null);
  const [showPreview, setShowPreview] = useState(false);

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

  const previewMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/channel-sync/preview', {}),
    onSuccess: (data: any) => {
      setPreviewResult(data?.preview ?? null);
      setShowPreview(true);
    },
    onError: () => {
      toast({ title: 'Preview failed', description: 'Could not run sync preview. Check your BrickOwl API key.', variant: 'destructive' });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/channel-sync/stop', {}),
    onSuccess: (data: any) => {
      if (data?.success) {
        toast({ title: 'Stop signal sent', description: 'The sync will halt after its current batch finishes.' });
      } else {
        toast({ title: 'Nothing to stop', description: data?.message ?? 'No sync is currently running.', variant: 'destructive' });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/sync/statuses'] });
    },
    onError: () => {
      toast({ title: 'Stop failed', description: 'Could not stop the sync.', variant: 'destructive' });
    },
  });

  const brickOwl = platformData?.targets?.find((t: any) => t.name === 'BrickOwl');
  const lastSync = syncStatuses?.channel;
  const isRunning = lastSync?.lastSyncStatus === 'in_progress' || syncMutation.isPending;

  // When sync transitions from running → done, sequence a fresh status fetch (which repopulates
  // the server-side discrepancy cache) then invalidate the detail drawer so it re-reads fresh data.
  const prevIsRunningRef = useRef(isRunning);
  useEffect(() => {
    const wasRunning = prevIsRunningRef.current;
    prevIsRunningRef.current = isRunning;
    if (wasRunning && !isRunning) {
      queryClient.refetchQueries({ queryKey: ['/api/platform-sync/status'] }).then(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/platform-sync/discrepancies/BrickOwl'] });
      });
    }
  }, [isRunning]);

  const { data: progressData } = useQuery<{ processed: number; total: number; phase: string }>({
    queryKey: ['/api/channel-sync/progress'],
    refetchInterval: isRunning ? 1500 : false,
    enabled: isRunning,
  });

  const { data: lastResult } = useQuery<any>({
    queryKey: ['/api/channel-sync/last-result'],
    refetchInterval: isRunning ? false : 60000,
  });

  const progressPct = progressData && progressData.total > 0
    ? Math.round((progressData.processed / progressData.total) * 100)
    : 0;
  const showProgress = isRunning && !!progressData;

  const missingLots = brickOwl?.discrepancies?.missingLots ?? 0;
  const priceDiffs = brickOwl?.discrepancies?.priceDifferences ?? 0;
  const qtyDiffs = brickOwl?.discrepancies?.quantityDifferences ?? 0;
  const remarksDiffs = brickOwl?.discrepancies?.remarksDifferences ?? 0;
  const descriptionDiffs = brickOwl?.discrepancies?.descriptionDifferences ?? 0;
  const unlinkedDiffs = brickOwl?.discrepancies?.unlinkedBoLots ?? 0;
  const orphanedDiffs = brickOwl?.discrepancies?.orphanedBoLots ?? 0;
  const bulkQtyDiffs = brickOwl?.discrepancies?.bulkQtyDifferences ?? 0;
  const lotWeightDiffs = brickOwl?.discrepancies?.lotWeightDifferences ?? 0;
  const forSaleDiffs       = brickOwl?.discrepancies?.forSaleDifferences ?? 0;
  const salePercentDiffs   = brickOwl?.discrepancies?.salePercentDifferences ?? 0;
  const totalDiscrepancies = missingLots + priceDiffs + qtyDiffs + remarksDiffs + descriptionDiffs + unlinkedDiffs + orphanedDiffs + bulkQtyDiffs + lotWeightDiffs + forSaleDiffs + salePercentDiffs;

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
    {
      type: 'unlinked',
      label: 'Unlinked BrickOwl Lots',
      icon: Unlink,
      accentColor: 'text-gray-400',
      borderColor: 'border-gray-500/40',
      bgColor: 'bg-gray-800/40',
      count: unlinkedDiffs,
      description: 'Exist on BrickOwl but not linked to any BrickLink item',
    },
    {
      type: 'orphaned',
      label: 'Orphaned BrickOwl Lots',
      icon: GitMerge,
      accentColor: 'text-rose-400',
      borderColor: 'border-rose-500/40',
      bgColor: 'bg-rose-950/30',
      count: orphanedDiffs,
      description: 'Linked to a BrickLink lot that no longer exists — likely merged or deleted',
    },
    {
      type: 'bulk_qty',
      label: 'Bulk Qty Differences',
      icon: Layers,
      accentColor: 'text-cyan-400',
      borderColor: 'border-cyan-500/40',
      bgColor: 'bg-cyan-950/30',
      count: bulkQtyDiffs,
      description: 'Minimum order quantity differs between platforms',
    },
    {
      type: 'lot_weight',
      label: 'Lot Weight Differences',
      icon: Scale,
      accentColor: 'text-teal-400',
      borderColor: 'border-teal-500/40',
      bgColor: 'bg-teal-950/30',
      count: lotWeightDiffs,
      description: 'Custom lot weight differs between platforms',
    },
    {
      type: 'sale_percent',
      label: 'Sale % Differences',
      icon: Percent,
      accentColor: 'text-orange-400',
      borderColor: 'border-orange-500/40',
      bgColor: 'bg-orange-950/30',
      count: salePercentDiffs,
      description: 'BrickOwl sale discount % differs from BrickLink sale rate',
    },
    {
      type: 'for_sale',
      label: 'Stockroom Mismatch',
      icon: EyeOff,
      accentColor: 'text-violet-400',
      borderColor: 'border-violet-500/40',
      bgColor: 'bg-violet-950/30',
      count: forSaleDiffs,
      description: 'Stockroom / for-sale visibility out of sync',
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
          <div className="flex items-center gap-2">
            <SyncModeBadge mode={brickOwl?.syncMode} size="sm" />
            <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
          </div>
        </div>

        {showProgress && (
          <div className="space-y-1" data-testid="channel-sync-progress">
            <Progress value={progressPct} className="h-1.5" />
            <div className="flex justify-between text-[10px] text-gray-500">
              <span>
                {progressData!.phase === 'fetching'
                  ? 'Fetching inventory…'
                  : `${progressData!.processed.toLocaleString()} / ${progressData!.total.toLocaleString()} items`}
              </span>
              {progressData!.phase === 'syncing' && (
                <span className="tabular-nums">{progressPct}%</span>
              )}
            </div>
          </div>
        )}

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

      <Drawer open={drawerOpen} onOpenChange={(open) => { setDrawerOpen(open); if (!open) { setSelectedArea(null); setShowAuditReport(false); } }}>
        <DrawerContent className="bg-gray-950 border-gray-800 h-[75vh] flex flex-col rounded-t-2xl">
          <DrawerHeader className="p-0 flex-shrink-0">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-600" />
            </div>
            <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-gray-800">
              {(selectedArea || showAuditReport) ? (
                <button
                  onClick={() => { setSelectedArea(null); setShowAuditReport(false); }}
                  className="text-gray-400 hover:text-gray-200 transition-colors mr-1 flex-shrink-0"
                  data-testid="button-discrepancy-back"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              ) : (
                <Globe className="w-4 h-4 text-green-400 flex-shrink-0" />
              )}
              <DrawerTitle className="text-sm font-semibold text-gray-100 flex-1">
                {showAuditReport
                  ? <span className="flex items-center gap-1.5"><ClipboardList className="w-4 h-4 text-gray-400 flex-shrink-0" />Audit Report</span>
                  : selectedArea && activeArea
                  ? <span className="flex items-center gap-1.5">
                      <activeArea.icon className={`w-4 h-4 ${activeArea.accentColor} flex-shrink-0`} />
                      {activeArea.label}
                    </span>
                  : 'BrickOwl — Channel Sync'}
              </DrawerTitle>
              <DrawerClose
                className="ml-2 text-gray-500 hover:text-gray-200 transition-colors"
                data-testid="button-close-channel-drawer"
                onClick={() => { setSelectedArea(null); setShowAuditReport(false); }}
              >
                <X className="w-5 h-5" />
                <span className="sr-only">Close</span>
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto min-h-0">
            {showAuditReport ? (
              <AuditReportView
                discrepancyAreas={discrepancyAreas}
                totalDiscrepancies={totalDiscrepancies}
                lastSyncTime={lastSync?.lastSyncTime}
              />
            ) : selectedArea ? (
              <DiscrepancyDetail
                area={activeArea!}
                data={detailData}
                isLoading={detailLoading}
              />
            ) : (
              <OverviewContent
                brickOwl={brickOwl}
                lastSync={lastSync}
                lastResult={lastResult}
                isLoading={isLoading}
                isRunning={isRunning}
                syncMutation={syncMutation}
                stopMutation={stopMutation}
                previewMutation={previewMutation}
                previewResult={previewResult}
                showPreview={showPreview}
                onDismissPreview={() => setShowPreview(false)}
                onOpenSettings={onOpenSettings}
                setDrawerOpen={setDrawerOpen}
                discrepancyAreas={discrepancyAreas}
                totalDiscrepancies={totalDiscrepancies}
                onSelectArea={(type) => setSelectedArea(type)}
                onShowAuditReport={() => setShowAuditReport(true)}
              />
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function DiscrepancyAreaButton({ area, onSelectArea }: { area: DiscrepancyArea; onSelectArea: (t: DiscrepancyType) => void }) {
  return (
    <button
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
  );
}

function OverviewContent({
  brickOwl,
  lastSync,
  lastResult,
  isLoading,
  isRunning,
  syncMutation,
  stopMutation,
  previewMutation,
  previewResult,
  showPreview,
  onDismissPreview,
  onOpenSettings,
  setDrawerOpen,
  discrepancyAreas,
  totalDiscrepancies,
  onSelectArea,
  onShowAuditReport,
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
        {isRunning && (
          <Button
            size="sm"
            variant="ghost"
            disabled={stopMutation.isPending}
            onClick={() => stopMutation.mutate()}
            data-testid="button-channel-sync-stop"
            className="text-destructive"
          >
            {stopMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
            ) : (
              <StopCircle className="w-3.5 h-3.5 mr-1.5" />
            )}
            {stopMutation.isPending ? 'Stopping…' : 'Stop Sync'}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={previewMutation.isPending || isRunning}
          onClick={() => previewMutation.mutate()}
          data-testid="button-channel-preview"
        >
          {previewMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
          ) : (
            <ClipboardList className="w-3.5 h-3.5 mr-1.5" />
          )}
          {previewMutation.isPending ? 'Scanning…' : 'Preview Run'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { setDrawerOpen(false); onOpenSettings?.('automation', 'channelSync'); }}
          data-testid="button-channel-schedule"
        >
          <CalendarClock className="w-3.5 h-3.5 mr-1.5" />
          Schedule
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { setDrawerOpen(false); onOpenSettings?.('automation', 'channelSync'); }}
          data-testid="button-channel-sync-settings"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
          Settings
        </Button>
        {totalDiscrepancies > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onShowAuditReport}
            data-testid="button-channel-audit-report"
          >
            <ClipboardList className="w-3.5 h-3.5 mr-1.5" />
            Audit Report
          </Button>
        )}
      </div>

      <Separator className="bg-gray-700/60" />

      {brickOwl?.syncMode && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500">Mode:</span>
          <SyncModeBadge mode={brickOwl.syncMode} size="md" />
          <span className="text-[10px] text-gray-600">
            {brickOwl.syncMode === 'analysis'     && '— read-only scan, no changes made'}
            {brickOwl.syncMode === 'matched_sync' && '— updates matched lots only, no new listings'}
            {brickOwl.syncMode === 'full_control' && '— updates matched lots and creates new listings'}
          </span>
        </div>
      )}

      {/* BOID catalog match review */}
      <BoidReviewPanel />

      {/* Preview result panel */}
      {showPreview && previewResult && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-950/30 p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-blue-200">Preview Run — No changes were made</span>
            <button
              onClick={onDismissPreview}
              className="text-gray-500 hover:text-gray-300"
              data-testid="button-dismiss-preview"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Matched lots',   value: previewResult.matchedLots,   color: 'text-gray-200' },
              { label: 'Would update',   value: previewResult.wouldUpdate,   color: 'text-yellow-300' },
              { label: 'Unmatched',      value: previewResult.unmatchedLots, color: 'text-orange-300' },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded bg-gray-800/60 px-2 py-1.5 text-center">
                <p className={`text-base font-mono font-bold ${color}`}>{value.toLocaleString()}</p>
                <p className="text-[9px] text-gray-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {previewResult.wouldUpdate > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Changes by field</p>
              <div className="flex flex-wrap gap-1.5">
                {([
                  ['Qty',         previewResult.byField.qty],
                  ['Price',       previewResult.byField.price],
                  ['Remarks',     previewResult.byField.remarks],
                  ['Description', previewResult.byField.description],
                  ['Tier price',  previewResult.byField.tierPrice],
                  ['Sale %',      previewResult.byField.salePercent],
                  ['For sale',    previewResult.byField.forSale],
                  ['Bulk qty',    previewResult.byField.bulkQty],
                  ['Lot weight',  previewResult.byField.lotWeight],
                ] as [string, number][]).filter(([, n]) => n > 0).map(([label, n]) => (
                  <span key={label} className="inline-flex items-center gap-1 rounded border border-blue-500/20 bg-blue-900/30 px-1.5 py-0.5 text-[10px] text-blue-200">
                    {label}: <span className="font-mono font-semibold">{n.toLocaleString()}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {previewResult.wouldUpdate === 0 && (
            <p className="text-[11px] text-green-400">
              Everything is in sync — no lots would be changed with your current field settings.
            </p>
          )}
        </div>
      )}

      {totalDiscrepancies > 0 ? (
        <>
          <p className="text-xs text-gray-400">
            Tap any area below to see exactly which items are out of sync between BrickLink and BrickOwl.
          </p>

          {/* Lot Issues group */}
          {(() => {
            const LOT_TYPES: DiscrepancyType[] = ['missing', 'unlinked', 'orphaned'];
            const lotAreas = discrepancyAreas.filter(a => LOT_TYPES.includes(a.type));
            if (lotAreas.length === 0) return null;
            return (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 px-0.5">Lot Issues</p>
                <div className="space-y-2">
                  {lotAreas.map((area) => (
                    <DiscrepancyAreaButton key={area.type} area={area} onSelectArea={onSelectArea} />
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Field Issues group */}
          {(() => {
            const FIELD_TYPES: DiscrepancyType[] = ['price', 'quantity', 'remarks', 'description', 'bulk_qty', 'lot_weight', 'for_sale', 'sale_percent'];
            const fieldAreas = discrepancyAreas.filter(a => FIELD_TYPES.includes(a.type));
            if (fieldAreas.length === 0) return null;
            return (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 px-0.5">Field Issues</p>
                <div className="space-y-2">
                  {fieldAreas.map((area) => (
                    <DiscrepancyAreaButton key={area.type} area={area} onSelectArea={onSelectArea} />
                  ))}
                </div>
              </div>
            );
          })()}
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

      {/* Last sync errors — grouped by error reason */}
      {lastResult && lastResult.errorCount > 0 && !isRunning && (() => {
        // Group errors by reason (text after first colon)
        const grouped = new Map<string, string[]>();
        for (const err of (lastResult.errors as string[])) {
          const colonIdx = err.indexOf(':');
          const itemRef = colonIdx > 0 ? err.slice(0, colonIdx).trim() : null;
          const reason  = colonIdx > 0 ? err.slice(colonIdx + 1).trim() : err;
          if (!grouped.has(reason)) grouped.set(reason, []);
          if (itemRef) grouped.get(reason)!.push(itemRef);
        }
        const overflow = lastResult.errorCount - lastResult.errors.length;
        return (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-red-400/80 px-0.5">
              Sync Errors · {lastResult.errorCount} item{lastResult.errorCount !== 1 ? 's' : ''} failed
            </p>
            <div className="rounded-lg border border-red-500/30 bg-red-950/20 divide-y divide-red-500/15 overflow-hidden">
              {Array.from(grouped.entries()).map(([reason, items], i) => (
                <div key={i} className="px-3 py-2 space-y-1" data-testid={`sync-error-group-${i}`}>
                  <div className="flex items-start gap-2">
                    <XCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1 flex items-baseline gap-1.5 flex-wrap">
                      <span className="text-[10px] text-red-200/80">{reason}</span>
                      <span className="text-[9px] text-red-400/60 font-mono">({items.length} item{items.length !== 1 ? 's' : ''})</span>
                    </div>
                  </div>
                  {items.length > 0 && (
                    <p className="text-[9px] text-red-300/50 font-mono pl-5 leading-relaxed break-all">
                      {items.slice(0, 12).join(', ')}{items.length > 12 ? `, +${items.length - 12} more` : ''}
                    </p>
                  )}
                </div>
              ))}
              {overflow > 0 && (
                <div className="px-3 py-1.5 text-[10px] text-red-400/60 italic">
                  …and {overflow} more not shown (run a new sync for a full error log)
                </div>
              )}
            </div>
            <p className="text-[10px] text-gray-600 px-0.5">
              From sync completed {lastResult.completedAt ? new Date(lastResult.completedAt).toLocaleString() : '—'}
            </p>
          </div>
        );
      })()}
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
          {(type === 'unlinked' || type === 'orphaned') ? (
            <p className="text-xs font-semibold text-gray-100 font-mono">BOID {item.boid}</p>
          ) : (
            <p className="text-xs font-semibold text-gray-100 truncate">{item.itemName || item.itemNo}</p>
          )}
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {type !== 'unlinked' && type !== 'orphaned' && <span className="text-[10px] text-gray-400">{item.itemNo}</span>}
            {item.lotId != null && (
              <span className="font-mono text-[9px] text-gray-600 bg-gray-800 border border-gray-700 rounded px-1 py-px">lot #{item.lotId}</span>
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

      {type === 'unlinked' && (
        <div className="flex items-center gap-3 flex-wrap text-[11px]">
          <span className="text-gray-400">Lot ID: <span className="text-white font-mono">{item.lotId}</span></span>
          <span className="text-gray-400">BOID: <span className="text-white font-mono">{item.boid}</span></span>
          <span className="text-gray-400">Qty: <span className="text-white font-mono">{item.qty}</span></span>
          <span className="text-gray-400">Price: <span className="text-white font-mono">${Number(item.price ?? 0).toFixed(2)}</span></span>
          {item.fullCon && <span className="text-gray-400">Cond: <span className="text-gray-300">{item.fullCon}</span></span>}
          <span className="text-gray-500 italic">No BrickLink ID set — excluded from sync</span>
        </div>
      )}

      {type === 'orphaned' && (
        <div className="flex items-center gap-3 flex-wrap text-[11px]">
          <span className="text-gray-400">Lot ID: <span className="text-white font-mono">{item.lotId}</span></span>
          <span className="text-gray-400">BOID: <span className="text-white font-mono">{item.boid}</span></span>
          <span className="text-gray-400">BL ID was: <span className="text-rose-300 font-mono line-through">{item.blId}</span></span>
          <span className="text-gray-400">Qty: <span className="text-white font-mono">{item.qty}</span></span>
          <span className="text-gray-400">Price: <span className="text-white font-mono">${Number(item.price ?? 0).toFixed(2)}</span></span>
          {item.fullCon && <span className="text-gray-400">Cond: <span className="text-gray-300">{item.fullCon}</span></span>}
          <span className="text-rose-400 italic">BL lot deleted — likely merged into another lot</span>
        </div>
      )}

      {type === 'sale_percent' && (
        <div className="flex items-center gap-3 flex-wrap text-[11px]">
          <span className="text-gray-400">
            BrickLink: <span className="text-white font-mono ml-0.5">{item.blSalePercent ?? 0}%</span>
          </span>
          <span className="text-gray-400">
            BrickOwl: <span className="text-white font-mono ml-0.5">{item.boSalePercent ?? 0}%</span>
          </span>
          {item.saleDiff != null && (
            <span className={`flex items-center gap-0.5 font-semibold ${item.saleDiff > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {item.saleDiff > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {item.saleDiff > 0 ? '+' : ''}{item.saleDiff}% on BO
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const AUDIT_TYPES: Array<{ type: DiscrepancyType; label: string; color: string }> = [
  { type: 'missing',     label: 'Missing Lots',            color: '#f97316' },
  { type: 'unlinked',    label: 'Unlinked BrickOwl Lots',  color: '#9ca3af' },
  { type: 'orphaned',    label: 'Orphaned BrickOwl Lots',  color: '#fb7185' },
  { type: 'price',       label: 'Price Differences',       color: '#eab308' },
  { type: 'quantity',    label: 'Quantity Differences',    color: '#60a5fa' },
  { type: 'remarks',     label: 'Remark Differences',      color: '#a855f7' },
  { type: 'description', label: 'Description Differences', color: '#ec4899' },
  { type: 'bulk_qty',     label: 'Bulk Qty Differences',    color: '#22d3ee' },
  { type: 'lot_weight',   label: 'Lot Weight Differences',  color: '#2dd4bf' },
  { type: 'for_sale',     label: 'Stockroom Mismatch',      color: '#a78bfa' },
  { type: 'sale_percent', label: 'Sale % Differences',      color: '#fb923c' },
];

function AuditReportView({ discrepancyAreas, totalDiscrepancies, lastSyncTime }: {
  discrepancyAreas: DiscrepancyArea[];
  totalDiscrepancies: number;
  lastSyncTime?: string | null;
}) {
  const activeTypes = discrepancyAreas.map(a => a.type);

  const q = {
    missing:     useQuery<any>({ queryKey: ['/api/platform-sync/discrepancies/BrickOwl', 'missing',     'all'], queryFn: () => fetch('/api/platform-sync/discrepancies/BrickOwl/missing?limit=10000').then(r => r.json()),     enabled: activeTypes.includes('missing'),     refetchOnWindowFocus: false }),
    price:       useQuery<any>({ queryKey: ['/api/platform-sync/discrepancies/BrickOwl', 'price',       'all'], queryFn: () => fetch('/api/platform-sync/discrepancies/BrickOwl/price?limit=10000').then(r => r.json()),       enabled: activeTypes.includes('price'),       refetchOnWindowFocus: false }),
    quantity:    useQuery<any>({ queryKey: ['/api/platform-sync/discrepancies/BrickOwl', 'quantity',    'all'], queryFn: () => fetch('/api/platform-sync/discrepancies/BrickOwl/quantity?limit=10000').then(r => r.json()),    enabled: activeTypes.includes('quantity'),    refetchOnWindowFocus: false }),
    remarks:     useQuery<any>({ queryKey: ['/api/platform-sync/discrepancies/BrickOwl', 'remarks',     'all'], queryFn: () => fetch('/api/platform-sync/discrepancies/BrickOwl/remarks?limit=10000').then(r => r.json()),     enabled: activeTypes.includes('remarks'),     refetchOnWindowFocus: false }),
    description: useQuery<any>({ queryKey: ['/api/platform-sync/discrepancies/BrickOwl', 'description','all'], queryFn: () => fetch('/api/platform-sync/discrepancies/BrickOwl/description?limit=10000').then(r => r.json()), enabled: activeTypes.includes('description'), refetchOnWindowFocus: false }),
    unlinked:    useQuery<any>({ queryKey: ['/api/platform-sync/discrepancies/BrickOwl', 'unlinked',   'all'], queryFn: () => fetch('/api/platform-sync/discrepancies/BrickOwl/unlinked?limit=10000').then(r => r.json()),   enabled: activeTypes.includes('unlinked'),   refetchOnWindowFocus: false }),
    orphaned:    useQuery<any>({ queryKey: ['/api/platform-sync/discrepancies/BrickOwl', 'orphaned',  'all'], queryFn: () => fetch('/api/platform-sync/discrepancies/BrickOwl/orphaned?limit=10000').then(r => r.json()),  enabled: activeTypes.includes('orphaned'),  refetchOnWindowFocus: false }),
    bulk_qty:    useQuery<any>({ queryKey: ['/api/platform-sync/discrepancies/BrickOwl', 'bulk_qty',  'all'], queryFn: () => fetch('/api/platform-sync/discrepancies/BrickOwl/bulk_qty?limit=10000').then(r => r.json()),  enabled: activeTypes.includes('bulk_qty'),  refetchOnWindowFocus: false }),
    lot_weight:  useQuery<any>({ queryKey: ['/api/platform-sync/discrepancies/BrickOwl', 'lot_weight','all'], queryFn: () => fetch('/api/platform-sync/discrepancies/BrickOwl/lot_weight?limit=10000').then(r => r.json()), enabled: activeTypes.includes('lot_weight'), refetchOnWindowFocus: false }),
    for_sale:     useQuery<any>({ queryKey: ['/api/platform-sync/discrepancies/BrickOwl', 'for_sale',     'all'], queryFn: () => fetch('/api/platform-sync/discrepancies/BrickOwl/for_sale?limit=10000').then(r => r.json()),     enabled: activeTypes.includes('for_sale'),     refetchOnWindowFocus: false }),
    sale_percent: useQuery<any>({ queryKey: ['/api/platform-sync/discrepancies/BrickOwl', 'sale_percent', 'all'], queryFn: () => fetch('/api/platform-sync/discrepancies/BrickOwl/sale_percent?limit=10000').then(r => r.json()), enabled: activeTypes.includes('sale_percent'), refetchOnWindowFocus: false }),
  };

  const isLoading = Object.values(q).some(r => r.isLoading);

  const allSections: Array<{ type: DiscrepancyType; label: string; color: string; items: any[]; total: number }> = AUDIT_TYPES
    .filter(t => activeTypes.includes(t.type))
    .map(t => ({
      ...t,
      items: q[t.type].data?.discrepancies ?? [],
      total: q[t.type].data?.total ?? 0,
    }));

  function formatCondition(c: string | undefined) {
    if (c === 'N') return 'New';
    if (c === 'U') return 'Used';
    return c ?? '';
  }

  function buildPrintHtml() {
    const date = new Date().toLocaleString();
    const syncDate = lastSyncTime ? new Date(lastSyncTime).toLocaleString() : 'unknown';

    const sectionHtml = allSections.map(section => {
      const rowsHtml = section.items.map((item: any) => {
        let valHtml = '';
        if (section.type === 'missing') {
          valHtml = `BL qty: ${item.blQuantity ?? '—'} · BL price: $${Number(item.blPrice ?? 0).toFixed(2)} · Not on BrickOwl`;
        } else if (section.type === 'price') {
          const diff = Number(item.priceDiff ?? 0);
          valHtml = `BL: $${Number(item.blPrice ?? 0).toFixed(2)} → BO: $${Number(item.boPrice ?? 0).toFixed(2)} (${diff >= 0 ? '+' : ''}$${diff.toFixed(2)})`;
        } else if (section.type === 'quantity') {
          valHtml = `BL: ${item.blQuantity ?? '—'} → BO: ${item.boQuantity ?? '—'} (${item.qtyDiff >= 0 ? '+' : ''}${item.qtyDiff})`;
        } else if (section.type === 'remarks') {
          valHtml = `BL: "${item.blRemarks || ''}" → BO: "${item.boRemarks || ''}"`;
        } else if (section.type === 'description') {
          valHtml = `BL: "${(item.blDescription || '').slice(0, 60)}${(item.blDescription || '').length > 60 ? '…' : ''}" → BO: "${(item.boDescription || '').slice(0, 60)}${(item.boDescription || '').length > 60 ? '…' : ''}"`;
        } else if (section.type === 'unlinked') {
          valHtml = `BOID: ${item.boid ?? '—'} · Qty: ${item.qty ?? '—'} · Price: $${Number(item.price ?? 0).toFixed(2)} · No BrickLink ID`;
        } else if (section.type === 'orphaned') {
          valHtml = `BOID: ${item.boid ?? '—'} · BL ID was: ${item.blId ?? '—'} · Qty: ${item.qty ?? '—'} · Price: $${Number(item.price ?? 0).toFixed(2)} · BL lot deleted/merged`;
        } else if (section.type === 'bulk_qty') {
          valHtml = `BL min qty: ${item.blBulkQty ?? 1} → BO bulk qty: ${item.boBulkQty ?? 1} (${item.bulkQtyDiff >= 0 ? '+' : ''}${item.bulkQtyDiff})`;
        } else if (section.type === 'lot_weight') {
          const diff = Number(item.weightDiff ?? 0);
          valHtml = `BL weight: ${Number(item.blLotWeight ?? 0).toFixed(4)}g → BO weight: ${Number(item.boLotWeight ?? 0).toFixed(4)}g (${diff >= 0 ? '+' : ''}${diff.toFixed(4)}g)`;
        } else if (section.type === 'for_sale') {
          valHtml = `BL: ${item.blIsStockRoom ? 'Stockroom (hidden)' : 'For sale'} → BO: ${item.boForSale === 0 ? 'Stockroom (hidden)' : 'For sale'}`;
        } else if (section.type === 'sale_percent') {
          const diff = Number(item.saleDiff ?? 0);
          valHtml = `BL sale rate: ${item.blSalePercent ?? 0}% → BO sale %: ${item.boSalePercent ?? 0}% (${diff >= 0 ? '+' : ''}${diff}%)`;
        }
        return `<tr>
          <td>#${item.lotId ?? '—'}</td>
          <td>${item.itemNo ?? (item.boid ? `BOID ${item.boid}` : '')}</td>
          <td>${item.itemName ?? ''}</td>
          <td>${item.colorName ?? ''}</td>
          <td>${formatCondition(item.condition ?? item.fullCon)}</td>
          <td>${valHtml}</td>
        </tr>`;
      }).join('');

      return `<section>
        <h2 style="color:${section.color};margin:1.5rem 0 0.5rem;font-size:1rem;border-bottom:1px solid #ddd;padding-bottom:0.25rem;">
          ${section.label} <span style="font-size:0.8rem;color:#666;">(${section.total} item${section.total !== 1 ? 's' : ''}${section.items.length < section.total ? `, showing ${section.items.length}` : ''})</span>
        </h2>
        <table>
          <thead><tr><th>Lot ID</th><th>Part No</th><th>Item Name</th><th>Color</th><th>Cond.</th><th>Discrepancy</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </section>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>BrickOwl Channel Sync Audit Report</title>
  <script>window.onafterprint = function() { window.close(); };</script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; margin: 2rem; font-size: 13px; }
    h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
    .meta { color: #555; font-size: 0.8rem; margin-bottom: 1.5rem; }
    .summary { display: flex; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 1rem; padding: 0.75rem 1rem; background: #f5f5f5; border-radius: 6px; }
    .summary-item { text-align: center; }
    .summary-item .count { font-size: 1.5rem; font-weight: 700; }
    .summary-item .label { font-size: 0.7rem; color: #555; text-transform: uppercase; letter-spacing: 0.05em; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 12px; }
    th { background: #f0f0f0; text-align: left; padding: 5px 8px; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: #444; border-bottom: 1px solid #ccc; }
    td { padding: 4px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
    tr:hover td { background: #fafafa; }
    @media print { body { margin: 1cm; } }
  </style>
</head>
<body>
  <h1>BrickOwl Channel Sync — Audit Report</h1>
  <p class="meta">Generated: ${date} · Last sync: ${syncDate} · Total discrepancies: ${totalDiscrepancies}</p>
  <div class="summary">
    ${allSections.map(s => `<div class="summary-item"><div class="count" style="color:${s.color}">${s.total}</div><div class="label">${s.label}</div></div>`).join('')}
  </div>
  ${sectionHtml}
</body>
</html>`;
  }

  function handlePrint() {
    const html = buildPrintHtml();
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    // Close the window after print/share sheet is dismissed (desktop + iOS Safari)
    win.addEventListener('afterprint', () => win.close());
    setTimeout(() => {
      win.print();
      // iOS fallback: if afterprint doesn't fire within 2s of print() returning, close anyway
      // (iOS print() returns immediately, afterprint fires when sheet dismisses)
    }, 400);
  }

  function handleDownloadCsv() {
    const rows: string[][] = [['Type', 'Lot ID', 'Part No', 'Item Name', 'Color', 'Condition', 'BL Value', 'BO Value', 'Difference']];
    allSections.forEach(section => {
      section.items.forEach((item: any) => {
        let blVal = '', boVal = '', diff = '';
        if (section.type === 'missing') {
          blVal = `qty:${item.blQuantity ?? ''} price:${Number(item.blPrice ?? 0).toFixed(2)}`;
          boVal = 'Not listed';
          diff = 'Missing';
        } else if (section.type === 'price') {
          blVal = `$${Number(item.blPrice ?? 0).toFixed(2)}`;
          boVal = `$${Number(item.boPrice ?? 0).toFixed(2)}`;
          diff = `${Number(item.priceDiff ?? 0) >= 0 ? '+' : ''}$${Number(item.priceDiff ?? 0).toFixed(2)}`;
        } else if (section.type === 'quantity') {
          blVal = String(item.blQuantity ?? '');
          boVal = String(item.boQuantity ?? '');
          diff = `${item.qtyDiff >= 0 ? '+' : ''}${item.qtyDiff}`;
        } else if (section.type === 'remarks') {
          blVal = item.blRemarks ?? '';
          boVal = item.boRemarks ?? '';
          diff = 'Mismatch';
        } else if (section.type === 'description') {
          blVal = (item.blDescription ?? '').slice(0, 80);
          boVal = (item.boDescription ?? '').slice(0, 80);
          diff = 'Mismatch';
        } else if (section.type === 'bulk_qty') {
          blVal = String(item.blBulkQty ?? 1);
          boVal = String(item.boBulkQty ?? 1);
          diff = `${item.bulkQtyDiff >= 0 ? '+' : ''}${item.bulkQtyDiff}`;
        } else if (section.type === 'lot_weight') {
          blVal = `${Number(item.blLotWeight ?? 0).toFixed(4)}g`;
          boVal = `${Number(item.boLotWeight ?? 0).toFixed(4)}g`;
          diff = `${Number(item.weightDiff ?? 0) >= 0 ? '+' : ''}${Number(item.weightDiff ?? 0).toFixed(4)}g`;
        } else if (section.type === 'for_sale') {
          blVal = item.blIsStockRoom ? 'Stockroom' : 'For sale';
          boVal = item.boForSale === 0 ? 'Stockroom' : 'For sale';
          diff = 'Mismatch';
        }
        rows.push([
          section.label,
          String(item.lotId ?? ''),
          item.itemNo ?? '',
          item.itemName ?? '',
          item.colorName ?? '',
          formatCondition(item.condition),
          blVal, boVal, diff,
        ]);
      });
    });

    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brickowl-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return (
      <div className="px-4 pt-6 space-y-3">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
          Loading all discrepancy data…
        </div>
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-12 rounded-lg bg-gray-800/60 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0">
      {/* Action bar */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-2 border-b border-gray-800 flex-shrink-0">
        <Button size="sm" variant="secondary" onClick={handlePrint} data-testid="button-audit-print">
          <Printer className="w-3.5 h-3.5 mr-1.5" />
          Print / Save PDF
        </Button>
        <Button size="sm" variant="ghost" onClick={handleDownloadCsv} data-testid="button-audit-csv">
          <Download className="w-3.5 h-3.5 mr-1.5" />
          Download CSV
        </Button>
      </div>

      {/* Summary chips */}
      <div className="px-4 pt-3 pb-1 flex flex-wrap gap-2">
        {allSections.map(s => {
          const area = discrepancyAreas.find((a: DiscrepancyArea) => a.type === s.type);
          return (
            <div
              key={s.type}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium ${area?.borderColor ?? 'border-gray-700'} ${area?.bgColor ?? ''}`}
            >
              {area && <area.icon className={`w-3 h-3 ${area.accentColor} flex-shrink-0`} />}
              <span className={area?.accentColor?.replace('400','200') ?? 'text-gray-200'}>{s.label}</span>
              <span className={`font-mono font-bold ${area?.accentColor ?? 'text-white'}`}>{s.total}</span>
            </div>
          );
        })}
        <div className="flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800/40 px-2.5 py-1 text-[11px]">
          <span className="text-gray-400">Total</span>
          <span className="font-mono font-bold text-white">{totalDiscrepancies}</span>
        </div>
      </div>

      {/* Per-section item lists */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-2 space-y-5">
        {allSections.map(section => {
          const area = discrepancyAreas.find((a: DiscrepancyArea) => a.type === section.type);
          if (!area) return null;
          return (
            <div key={section.type}>
              <div className={`flex items-center gap-2 mb-2`}>
                <area.icon className={`w-3.5 h-3.5 ${area.accentColor} flex-shrink-0`} />
                <span className={`text-xs font-semibold ${area.accentColor.replace('400','200')}`}>{section.label}</span>
                <span className={`text-xs font-mono font-bold ${area.accentColor}`}>{section.total}</span>
                {section.items.length < section.total && (
                  <span className="text-[10px] text-gray-500">(showing {section.items.length})</span>
                )}
              </div>
              <div className="space-y-1.5">
                {section.items.map((item: any, i: number) => (
                  <div
                    key={`${item.lotId}-${i}`}
                    className={`rounded-md border ${area.borderColor} bg-gray-900/50 px-3 py-2`}
                    data-testid={`audit-row-${section.type}-${i}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-[11px] font-semibold text-gray-100 truncate max-w-[180px]">{item.itemName || item.itemNo}</span>
                      {item.lotId != null && <span className="font-mono text-[9px] text-gray-600 bg-gray-800 border border-gray-700 rounded px-1">#{item.lotId}</span>}
                      <span className="text-[10px] text-gray-500">{item.itemNo}</span>
                      {item.colorName && <span className="text-[10px] text-gray-500">{item.colorName}</span>}
                      {item.condition && (
                        <span className={`text-[9px] font-medium px-1.5 py-px rounded border ${item.condition === 'N' ? 'text-blue-300 bg-blue-500/10 border-blue-500/25' : 'text-amber-300 bg-amber-500/10 border-amber-500/25'}`}>
                          {item.condition === 'N' ? 'New' : 'Used'}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {section.type === 'missing' && (
                        <span>BL qty: <span className="text-white font-mono">{item.blQuantity ?? '—'}</span> · BL price: <span className="text-white font-mono">${Number(item.blPrice ?? 0).toFixed(2)}</span> · <span className="text-orange-400 font-medium">Not on BrickOwl</span></span>
                      )}
                      {section.type === 'price' && (
                        <span>BL: <span className="text-white font-mono">${Number(item.blPrice ?? 0).toFixed(2)}</span> → BO: <span className="text-white font-mono">${Number(item.boPrice ?? 0).toFixed(2)}</span>
                          {item.priceDiff != null && <span className={`ml-2 font-semibold ${item.priceDiff > 0 ? 'text-green-400' : 'text-red-400'}`}>{item.priceDiff > 0 ? '+' : ''}${Number(item.priceDiff).toFixed(2)} on BO</span>}
                        </span>
                      )}
                      {section.type === 'quantity' && (
                        <span>BL: <span className="text-white font-mono">{item.blQuantity ?? '—'}</span> → BO: <span className="text-white font-mono">{item.boQuantity ?? '—'}</span>
                          {item.qtyDiff != null && <span className={`ml-2 font-semibold ${item.qtyDiff > 0 ? 'text-green-400' : 'text-red-400'}`}>{item.qtyDiff > 0 ? '+' : ''}{item.qtyDiff} on BO</span>}
                        </span>
                      )}
                      {section.type === 'remarks' && (
                        <span>BL: "<span className="text-gray-300">{item.blRemarks || '—'}</span>" → BO: "<span className="text-gray-300">{item.boRemarks || '—'}</span>"</span>
                      )}
                      {section.type === 'description' && (
                        <span className="line-clamp-2">BL: "<span className="text-gray-300">{(item.blDescription || '').slice(0, 60)}{(item.blDescription || '').length > 60 ? '…' : ''}</span>" → BO: "<span className="text-gray-300">{(item.boDescription || '').slice(0, 60)}{(item.boDescription || '').length > 60 ? '…' : ''}</span>"</span>
                      )}
                      {section.type === 'bulk_qty' && (
                        <span>BL min qty: <span className="text-white font-mono">{item.blBulkQty ?? 1}</span> → BO bulk qty: <span className="text-white font-mono">{item.boBulkQty ?? 1}</span>
                          {item.bulkQtyDiff != null && <span className={`ml-2 font-semibold ${item.bulkQtyDiff > 0 ? 'text-green-400' : 'text-red-400'}`}>{item.bulkQtyDiff > 0 ? '+' : ''}{item.bulkQtyDiff} on BO</span>}
                        </span>
                      )}
                      {section.type === 'lot_weight' && (
                        <span>BL weight: <span className="text-white font-mono">{Number(item.blLotWeight ?? 0).toFixed(4)}g</span> → BO weight: <span className="text-white font-mono">{Number(item.boLotWeight ?? 0).toFixed(4)}g</span>
                          {item.weightDiff != null && <span className={`ml-2 font-semibold ${item.weightDiff > 0 ? 'text-green-400' : 'text-red-400'}`}>{item.weightDiff > 0 ? '+' : ''}{Number(item.weightDiff).toFixed(4)}g on BO</span>}
                        </span>
                      )}
                      {section.type === 'for_sale' && (
                        <span>
                          BL: <span className={`font-mono font-semibold ${item.blIsStockRoom ? 'text-amber-400' : 'text-green-400'}`}>{item.blIsStockRoom ? 'Stockroom' : 'For sale'}</span>
                          {' → '}
                          BO: <span className={`font-mono font-semibold ${item.boForSale === 0 ? 'text-amber-400' : 'text-green-400'}`}>{item.boForSale === 0 ? 'Stockroom' : 'For sale'}</span>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

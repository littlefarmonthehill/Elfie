import { useState, useEffect, useRef } from "react";
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
  Paintbrush,
  ArrowLeftRight,
  Database,
  Search,
  Warehouse,
  ChevronDown,
} from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";

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

type SyncMode = 'analysis' | 'matched_sync' | 'full_control';

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

type DiscrepancyType = 'missing' | 'type_mismatch' | 'price' | 'quantity' | 'remarks' | 'description' | 'unlinked' | 'orphaned' | 'bulk_qty' | 'lot_weight' | 'for_sale' | 'sale_percent';

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
  onOpenSettings?: (section?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'billing', focusTarget?: 'schedulerInventory' | 'schedulerOrders' | 'schedulerChannel' | 'channelSync') => void;
  inlineMode?: boolean;
  onClose?: () => void;
  initialChannel?: string;
  /** Lock this panel to a single channel — hides the channel switcher. */
  channel?: string;
}

/** Map channelKey → the target name used in platform-sync API paths. */
const CHANNEL_DISPLAY: Record<string, { label: string; targetName: string }> = {
  brickowl: { label: 'BrickOwl', targetName: 'BrickOwl' },
  ebay:     { label: 'eBay',     targetName: 'eBay' },
};

function channelLabel(key: string) {
  return CHANNEL_DISPLAY[key]?.label ?? key;
}
function channelTargetName(key: string) {
  return CHANNEL_DISPLAY[key]?.targetName ?? key;
}

export default function ChannelSyncPanel({ onOpenSettings, inlineMode, onClose, initialChannel, channel: lockedChannel }: ChannelSyncPanelProps) {
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedArea, setSelectedArea] = useState<DiscrepancyType | null>(null);
  const [showAuditReport, setShowAuditReport] = useState(false);
  const [showColorRepair, setShowColorRepair] = useState(false);
  const [changeDetail, setChangeDetail] = useState<'created' | 'updated' | null>(null);
  const [selectedChannel, setSelectedChannel] = useState(lockedChannel ?? initialChannel ?? 'brickowl');

  useEffect(() => {
    if (lockedChannel) { selectChannel(lockedChannel); return; }
    if (initialChannel) selectChannel(initialChannel);
  }, [initialChannel, lockedChannel]);

  function selectChannel(key: string) {
    setSelectedChannel(key);
    setSelectedArea(null);
    setShowAuditReport(false);
    setShowColorRepair(false);
    setChangeDetail(null);
  }

  const { data: platformData, isLoading: platformLoading } = useQuery<any>({
    queryKey: ['/api/platform-sync/status'],
    refetchInterval: 30000,
  });

  const { data: orgIntegrationsList = [] } = useQuery<any[]>({
    queryKey: ['/api/org/integrations'],
  });
  const ebayIntegration = (orgIntegrationsList as any[]).find((i: any) => i.channel === 'ebay');
  const ebayEnvironment: 'production' | 'sandbox' = (ebayIntegration?.credentials as any)?.environment ?? 'production';

  const { data: syncStatuses, isLoading: statusLoading } = useQuery<any>({
    queryKey: ['/api/sync/statuses'],
    refetchInterval: 15000,
  });

  const discrepancyUrl = selectedArea
    ? `/api/platform-sync/discrepancies/${channelTargetName(selectedChannel)}/${selectedArea}`
    : null;

  const { data: detailData, isLoading: detailLoading } = useQuery<any>({
    queryKey: ['/api/platform-sync/discrepancies', selectedChannel, selectedArea],
    queryFn: () => fetch(discrepancyUrl!).then(r => r.json()),
    enabled: !!selectedArea && (drawerOpen || !!inlineMode) && !!discrepancyUrl,
    refetchOnWindowFocus: false,
  });

  const { data: recentChanges, isLoading: recentChangesLoading } = useQuery<{ items: any[]; totalCount: number }>({
    queryKey: ['/api/sync/channel/recent-changes', changeDetail],
    queryFn: () => apiRequest('GET', `/api/sync/channel/recent-changes?type=${changeDetail}&limit=50`),
    enabled: (drawerOpen || !!inlineMode) && changeDetail !== null,
    staleTime: 30000,
  });

  const syncMutation = useMutation({
    mutationFn: (opts?: { fullScan?: boolean }) => apiRequest('POST', '/api/sync/channel', { fullScan: opts?.fullScan ?? false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sync/statuses'] });
      queryClient.invalidateQueries({ queryKey: ['/api/platform-sync/status'] });
      setDrawerOpen(false);
      toast({ title: 'Channel sync complete', description: 'All connected channels have been updated.' });
    },
    onError: (err: any) => {
      toast({ title: 'Sync failed', description: err?.message || 'Could not complete channel sync.', variant: 'destructive' });
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

  const configuredChannels: { key: string; label: string; target: any }[] = (platformData?.targets ?? [])
    .filter((t: any) => t.enabled || t.name === 'BrickOwl')
    .map((t: any) => {
      const key = Object.entries(CHANNEL_DISPLAY).find(([, v]) => v.targetName === t.name)?.[0] ?? t.name.toLowerCase();
      return { key, label: channelLabel(key), target: t };
    });

  // Fallback: if platformData not loaded yet, show brickowl as the only channel
  const allDisplayChannels = configuredChannels.length > 0
    ? configuredChannels
    : [{ key: 'brickowl', label: 'BrickOwl', target: null }];

  // When locked to a single channel, only expose that one (hides the switcher)
  const displayChannels = lockedChannel
    ? (allDisplayChannels.find(c => c.key === lockedChannel)
        ? allDisplayChannels.filter(c => c.key === lockedChannel)
        : [{ key: lockedChannel, label: channelLabel(lockedChannel), target: null }])
    : allDisplayChannels;

  const selectedChannelData = displayChannels.find(c => c.key === selectedChannel) ?? displayChannels[0];
  const brickOwl = platformData?.targets?.find((t: any) => t.name === 'BrickOwl');
  const aggregateSync = syncStatuses?.channel;
  // Use per-channel stats when available; fall back to aggregate only for brickowl (primary channel).
  // Other channels (e.g. ebay) show null until they have their own sync record.
  const lastSync = syncStatuses?.channels?.[selectedChannel] !== undefined
    ? (syncStatuses?.channels?.[selectedChannel] ?? (selectedChannel === 'brickowl' ? aggregateSync : null))
    : aggregateSync;
  const isRunning = aggregateSync?.lastSyncStatus === 'in_progress' || syncMutation.isPending;

  // When sync transitions from running → done, sequence a fresh status fetch (which repopulates
  // the server-side discrepancy cache) then invalidate the detail drawer so it re-reads fresh data.
  const prevIsRunningRef = useRef(isRunning);
  useEffect(() => {
    const wasRunning = prevIsRunningRef.current;
    prevIsRunningRef.current = isRunning;
    if (wasRunning && !isRunning) {
      queryClient.refetchQueries({ queryKey: ['/api/platform-sync/status'] }).then(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/platform-sync/discrepancies'] });
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

  const missingLots      = brickOwl?.discrepancies?.missingLots      ?? 0;
  const typeMismatchLots = brickOwl?.discrepancies?.typeMismatchLots ?? 0;
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
  const totalDiscrepancies = missingLots + typeMismatchLots + priceDiffs + qtyDiffs + remarksDiffs + descriptionDiffs + unlinkedDiffs + orphanedDiffs + bulkQtyDiffs + lotWeightDiffs + forSaleDiffs + salePercentDiffs;

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
      description: `On BrickLink but not listed on ${selectedChannelData?.label ?? 'the channel'}`,
    },
    {
      type: 'type_mismatch',
      label: 'Type Mismatch',
      icon: ArrowLeftRight,
      accentColor: 'text-violet-400',
      borderColor: 'border-violet-500/40',
      bgColor: 'bg-violet-950/30',
      count: typeMismatchLots,
      description: 'BL: Part — BO: Minifigure (lot exists but untagged)',
    },
    {
      type: 'price',
      label: 'Price Differences',
      icon: DollarSign,
      accentColor: 'text-yellow-400',
      borderColor: 'border-yellow-500/40',
      bgColor: 'bg-yellow-950/30',
      count: priceDiffs,
      description: `${selectedChannelData?.label ?? 'Channel'} price differs from BrickLink`,
    },
    {
      type: 'quantity',
      label: 'Quantity Differences',
      icon: Hash,
      accentColor: 'text-blue-400',
      borderColor: 'border-blue-500/40',
      bgColor: 'bg-blue-950/30',
      count: qtyDiffs,
      description: `${selectedChannelData?.label ?? 'Channel'} quantity differs from BrickLink`,
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
      label: `Unlinked ${selectedChannelData?.label ?? 'Channel'} Lots`,
      icon: Unlink,
      accentColor: 'text-gray-400',
      borderColor: 'border-gray-500/40',
      bgColor: 'bg-gray-800/40',
      count: unlinkedDiffs,
      description: `Exist on ${selectedChannelData?.label ?? 'the channel'} but not linked to any BrickLink item`,
    },
    {
      type: 'orphaned',
      label: `Orphaned ${selectedChannelData?.label ?? 'Channel'} Lots`,
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
          <span className="text-xs font-semibold text-green-200/60">Channel Sync</span>
        </div>
        <p className="text-[10px] text-gray-500">
          BrickOwl not configured — add your API key in Settings → Platform Connections to enable channel sync.
        </p>
      </div>
    );
  }

  if (inlineMode) {
    const isBack = !!(selectedArea || showAuditReport || showColorRepair || changeDetail);
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 flex-shrink-0">
          {isBack ? (
            <button
              onClick={() => { setSelectedArea(null); setShowAuditReport(false); setShowColorRepair(false); setChangeDetail(null); }}
              className="text-gray-400 hover:text-gray-200 transition-colors mr-1 flex-shrink-0"
              data-testid="button-discrepancy-back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <Globe className="w-4 h-4 text-green-400 flex-shrink-0" />
          )}
          <span className="text-sm font-semibold text-gray-100 flex-1">
            {changeDetail === 'created' ? 'Recently Created Lots'
              : changeDetail === 'updated' ? 'Recently Updated Lots'
              : showAuditReport ? 'Audit Report'
              : showColorRepair ? 'Wrong Color Lots'
              : selectedArea && activeArea ? activeArea.label
              : 'Channel Sync'}
          </span>
          {onClose && !isBack && (
            <button onClick={onClose} className="text-gray-500 hover:text-gray-200 transition-colors flex-shrink-0" data-testid="button-close-channel-inline">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          {changeDetail ? (
            <div className="px-4 pt-3 pb-6 space-y-2">
              <div className="flex items-center gap-2 px-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 flex-1">
                  {changeDetail === 'created' ? 'Most recently created' : 'Most recently updated'}
                </p>
                <span className="text-[10px] text-gray-600">showing up to 50</span>
              </div>
              {recentChangesLoading ? (
                <div className="flex items-center gap-2 py-6 justify-center text-gray-500 text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading…</div>
              ) : !recentChanges?.items?.length ? (
                <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 p-4 text-center text-xs text-gray-500">No items found</div>
              ) : (
                <div className="space-y-1">
                  {recentChanges.items.map((item: any, idx: number) => (
                    <div key={item.blInvId ?? idx} className="flex items-start gap-3 rounded-md bg-gray-900/50 px-2.5 py-2" data-testid={`row-ch-change-${item.blInvId ?? idx}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-mono font-semibold text-green-300">{item.itemNo}</span>
                          <span className="text-[9px] text-gray-600">{item.newOrUsed === 'N' ? 'New' : 'Used'}</span>
                          {item.colorName && <span className="text-[9px] text-gray-500 truncate">{item.colorName}</span>}
                        </div>
                        {item.itemName && <p className="text-[10px] text-gray-400 truncate mt-0.5">{item.itemName}</p>}
                        {item.channelLotId && <p className="text-[9px] text-gray-600 font-mono mt-0.5">BO #{item.channelLotId}</p>}
                        {changeDetail === 'updated' && item.changes?.length > 0 && (
                          <ChangeDiffRows changes={item.changes} />
                        )}
                        {changeDetail === 'updated' && !item.changes?.length && (
                          <p className="text-[9px] text-gray-600 mt-0.5 italic">qty: ×{item.quantity?.toLocaleString()} · ${parseFloat(item.unitPrice ?? 0).toFixed(2)}</p>
                        )}
                      </div>
                      {changeDetail === 'created' && (
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
          ) : showAuditReport ? (
            <AuditReportView discrepancyAreas={discrepancyAreas} totalDiscrepancies={totalDiscrepancies} lastSyncTime={lastSync?.lastSyncTime} />
          ) : showColorRepair ? (
            <ColorRepairDetail />
          ) : selectedArea ? (
            <DiscrepancyDetail area={activeArea!} data={detailData} isLoading={detailLoading} />
          ) : (
            <OverviewContent
              brickOwl={brickOwl} lastSync={lastSync} lastResult={lastResult} isLoading={isLoading}
              isRunning={isRunning} syncMutation={syncMutation} stopMutation={stopMutation}
              onOpenSettings={onOpenSettings} setDrawerOpen={() => {}}
              discrepancyAreas={discrepancyAreas} totalDiscrepancies={totalDiscrepancies}
              onSelectArea={(type) => setSelectedArea(type)}
              onShowAuditReport={() => setShowAuditReport(true)}
              onShowColorRepair={() => setShowColorRepair(true)}
              progressData={progressData} progressPct={progressPct}
              onChangeDetail={(type: 'created' | 'updated') => setChangeDetail(type)}
              displayChannels={displayChannels}
              selectedChannel={selectedChannel}
              onChannelSelect={selectChannel}
              ebayEnvironment={ebayEnvironment}
            />
          )}
        </div>
      </div>
    );
  }

  const isEbayChannel = selectedChannel === 'ebay';
  const barBorder   = isEbayChannel ? 'border-yellow-500/40' : 'border-green-500/40';
  const barBg       = isEbayChannel ? 'from-yellow-950/50 to-gray-950/70' : 'from-green-950/50 to-gray-950/70';
  const barIcon     = isEbayChannel ? 'text-yellow-400' : 'text-green-400';
  const barLabel    = isEbayChannel ? 'text-yellow-100' : 'text-green-100';

  return (
    <>
      <button
        onClick={() => setDrawerOpen(true)}
        className={`w-full text-left rounded-lg border ${barBorder} bg-gradient-to-br ${barBg} p-3 space-y-2 hover-elevate`}
        data-testid={`channel-sync-panel-${selectedChannel}`}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Globe className={`w-3.5 h-3.5 ${barIcon} shrink-0`} />
            <span className={`text-xs font-semibold ${barLabel}`}>{channelLabel(selectedChannel)} — Inventory</span>
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
                  : progressData!.total > 0
                    ? `Syncing ${progressData!.processed.toLocaleString()} / ${progressData!.total.toLocaleString()} items`
                    : 'Syncing…'}
              </span>
              <span className="tabular-nums">{progressPct}%</span>
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
            <span>{selectedChannelData?.label ?? 'Channel'} is in sync</span>
          </div>
        )}
      </button>

      <Drawer open={drawerOpen} onOpenChange={(open) => { setDrawerOpen(open); if (!open) { setSelectedArea(null); setShowAuditReport(false); setShowColorRepair(false); setChangeDetail(null); } }}>
        <DrawerContent className="bg-gray-950 border-gray-800 h-[75vh] flex flex-col rounded-t-2xl">
          <DrawerHeader className="p-0 flex-shrink-0">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-600" />
            </div>
            <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-gray-800">
              {(selectedArea || showAuditReport || showColorRepair || changeDetail) ? (
                <button
                  onClick={() => { setSelectedArea(null); setShowAuditReport(false); setShowColorRepair(false); setChangeDetail(null); }}
                  className="text-gray-400 hover:text-gray-200 transition-colors mr-1 flex-shrink-0"
                  data-testid="button-discrepancy-back"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              ) : (
                <Globe className="w-4 h-4 text-green-400 flex-shrink-0" />
              )}
              <DrawerTitle className="text-sm font-semibold text-gray-100 flex-1">
                {changeDetail === 'created'
                  ? 'Recently Created Lots'
                  : changeDetail === 'updated'
                  ? 'Recently Updated Lots'
                  : showAuditReport
                  ? <span className="flex items-center gap-1.5"><ClipboardList className="w-4 h-4 text-gray-400 flex-shrink-0" />Audit Report</span>
                  : showColorRepair
                  ? <span className="flex items-center gap-1.5"><Paintbrush className="w-4 h-4 text-amber-400 flex-shrink-0" />Wrong Color Lots</span>
                  : selectedArea && activeArea
                  ? <span className="flex items-center gap-1.5">
                      <activeArea.icon className={`w-4 h-4 ${activeArea.accentColor} flex-shrink-0`} />
                      {activeArea.label}
                    </span>
                  : 'Channel Sync'}
              </DrawerTitle>
              <DrawerClose
                className="ml-2 text-gray-500 hover:text-gray-200 transition-colors"
                data-testid="button-close-channel-drawer"
                onClick={() => { setSelectedArea(null); setShowAuditReport(false); setShowColorRepair(false); setChangeDetail(null); }}
              >
                <X className="w-5 h-5" />
                <span className="sr-only">Close</span>
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto min-h-0">
            {changeDetail ? (
              <div className="px-4 pt-3 pb-6 space-y-2">
                <div className="flex items-center gap-2 px-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 flex-1">
                    {changeDetail === 'created' ? 'Most recently created' : 'Most recently updated'}
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
                    {recentChanges.items.map((item: any, idx: number) => (
                      <div
                        key={item.blInvId ?? idx}
                        className="flex items-start gap-3 rounded-md bg-gray-900/50 px-2.5 py-2"
                        data-testid={`row-ch-change-drawer-${item.blInvId ?? idx}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono font-semibold text-green-300">{item.itemNo}</span>
                            <span className="text-[9px] text-gray-600">{item.newOrUsed === 'N' ? 'New' : 'Used'}</span>
                            {item.colorName && (
                              <span className="text-[9px] text-gray-500 truncate">{item.colorName}</span>
                            )}
                          </div>
                          {item.itemName && (
                            <p className="text-[10px] text-gray-400 truncate mt-0.5">{item.itemName}</p>
                          )}
                          {item.channelLotId && (
                            <p className="text-[9px] text-gray-600 font-mono mt-0.5">BO #{item.channelLotId}</p>
                          )}
                          {changeDetail === 'updated' && item.changes?.length > 0 && (
                            <ChangeDiffRows changes={item.changes} />
                          )}
                          {changeDetail === 'updated' && !item.changes?.length && (
                            <p className="text-[9px] text-gray-600 mt-0.5 italic">qty: ×{item.quantity?.toLocaleString()} · ${parseFloat(item.unitPrice ?? 0).toFixed(2)}</p>
                          )}
                        </div>
                        {changeDetail === 'created' && (
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
            ) : showAuditReport ? (
              <AuditReportView
                discrepancyAreas={discrepancyAreas}
                totalDiscrepancies={totalDiscrepancies}
                lastSyncTime={lastSync?.lastSyncTime}
              />
            ) : showColorRepair ? (
              <ColorRepairDetail />
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
                onOpenSettings={onOpenSettings}
                setDrawerOpen={setDrawerOpen}
                discrepancyAreas={discrepancyAreas}
                totalDiscrepancies={totalDiscrepancies}
                onSelectArea={(type) => setSelectedArea(type)}
                onShowAuditReport={() => setShowAuditReport(true)}
                onShowColorRepair={() => setShowColorRepair(true)}
                progressData={progressData}
                progressPct={progressPct}
                onChangeDetail={(type: 'created' | 'updated') => setChangeDetail(type)}
                displayChannels={displayChannels}
                selectedChannel={selectedChannel}
                onChannelSelect={selectChannel}
                ebayEnvironment={ebayEnvironment}
              />
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

type ColorMismatch = {
  lotId: string;
  blId: number;
  itemNo: string;
  currentColorId: number;
  currentColorName: string;
  expectedColorId: number;
  expectedColorName: string;
};

function ColorRepairDetail() {
  const { toast } = useToast();
  const [mismatches, setMismatches] = useState<ColorMismatch[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fixingLots, setFixingLots] = useState<Set<string>>(new Set());
  const [repairDone, setRepairDone] = useState(0);

  useEffect(() => {
    if (fixingLots.size === 0) { setRepairDone(0); return; }
    const id = setInterval(async () => {
      try {
        const p: any = await apiRequest('GET', '/api/repair/brickowl-colors/progress');
        setRepairDone(p.done ?? 0);
        if (p.complete) {
          clearInterval(id);
          setMismatches(prev => prev?.filter(m => !fixingLots.has(m.lotId)) ?? null);
          setSelected(prev => { const next = new Set(prev); fixingLots.forEach(lotId => next.delete(lotId)); return next; });
          setFixingLots(new Set());
          if ((p.errors?.length ?? 0) > 0) {
            toast({ title: `Fixed ${p.fixed ?? 0} lot${p.fixed === 1 ? '' : 's'}`, description: `${p.errors.length} error${p.errors.length === 1 ? '' : 's'} — see console.`, variant: 'destructive' });
          } else {
            toast({ title: p.fixed > 0 ? `Fixed ${p.fixed} lot${p.fixed === 1 ? '' : 's'}` : 'No fixes needed' });
          }
        }
      } catch {}
    }, 600);
    return () => clearInterval(id);
  }, [fixingLots.size]);

  const scanMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/repair/brickowl-colors', { dryRun: true }),
    onSuccess: (data: any) => {
      const sorted = [...(data.mismatches ?? [])].sort((a: ColorMismatch, b: ColorMismatch) => parseInt(b.lotId) - parseInt(a.lotId));
      setMismatches(sorted);
      setSelected(new Set());
    },
    onError: () => {
      toast({ title: 'Color scan failed', description: 'Could not scan BrickOwl inventory.', variant: 'destructive' });
    },
  });

  function fixLots(lotIds?: string[]) {
    const targetIds = new Set(lotIds ?? mismatches?.map(m => m.lotId) ?? []);
    setFixingLots(targetIds);
    apiRequest('POST', '/api/repair/brickowl-colors', {
      dryRun: false,
      ...(lotIds ? { lotIds } : {}),
    }).catch(() => {
      setFixingLots(new Set());
      toast({ title: 'Fix failed', description: 'Could not start the color repair.', variant: 'destructive' });
    });
  }

  const isBusy = scanMutation.isPending || fixingLots.size > 0;
  const allSelected = (mismatches?.length ?? 0) > 0 && selected.size === (mismatches?.length ?? 0);
  const someSelected = selected.size > 0;
  const hasResults = mismatches !== null && mismatches.length > 0;

  function downloadReport() {
    if (!mismatches?.length) return;
    const rows = [
      ['BrickOwl Lot ID', 'Item No', 'BL Item ID', 'Current Color', 'Expected Color'],
      ...mismatches.map(m => [
        m.lotId, m.itemNo, String(m.blId),
        m.currentColorName ?? `Color ${m.currentColorId}`,
        m.expectedColorName ?? `Color ${m.expectedColorId}`,
      ]),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `color-repair-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printReport() {
    if (!mismatches?.length) return;
    const win = window.open('', '_blank');
    if (!win) return;
    const rows = mismatches.map(m => `
      <tr>
        <td>${m.lotId}</td>
        <td>${m.itemNo}</td>
        <td>${m.blId}</td>
        <td style="color:#c0392b">${m.currentColorName ?? `Color ${m.currentColorId}`}</td>
        <td style="color:#16a085">${m.expectedColorName ?? `Color ${m.expectedColorId}`}</td>
      </tr>`).join('');
    win.document.write(`<!DOCTYPE html><html><head><title>Color Repair Report</title>
      <style>
        body { font-family: -apple-system, sans-serif; font-size: 13px; padding: 32px; color: #111; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        p { color: #555; margin-bottom: 20px; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f4f4f4; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; padding: 8px 10px; text-align: left; border-bottom: 2px solid #ddd; }
        td { padding: 7px 10px; border-bottom: 1px solid #eee; font-size: 12px; }
        tr:last-child td { border-bottom: none; }
      </style></head><body>
      <h1>Color Repair Report</h1>
      <p>Generated ${new Date().toLocaleString()} &mdash; ${mismatches.length} lot${mismatches.length !== 1 ? 's' : ''} with wrong colors</p>
      <table>
        <thead><tr><th>BO Lot ID</th><th>Item No</th><th>BL Item ID</th><th>Current Color</th><th>Expected Color</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <div className="flex flex-col h-full">
      {/* Action bar */}
      <div className="px-4 py-3 flex items-center gap-2 border-b border-gray-800 flex-shrink-0">
        <p className="text-[11px] text-gray-500 flex-1">
          Detects BrickOwl lots where the color doesn't match BrickLink. Fixing deletes the mismatched lot and recreates it with the correct color.
        </p>
        {hasResults && (
          <>
            <Button
              size="icon"
              variant="ghost"
              onClick={downloadReport}
              data-testid="button-color-repair-download"
              title="Download CSV"
            >
              <Download className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={printReport}
              data-testid="button-color-repair-print"
              title="Print report"
            >
              <Printer className="w-3.5 h-3.5" />
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={isBusy}
          onClick={() => scanMutation.mutate()}
          data-testid="button-color-repair-scan"
        >
          {scanMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : <RefreshCw className="w-3 h-3 mr-1.5" />}
          {mismatches === null ? 'Scan' : 'Rescan'}
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Pre-scan */}
        {mismatches === null && !scanMutation.isPending && (
          <div className="px-4 py-10 flex flex-col items-center gap-3 text-center">
            <Paintbrush className="w-8 h-8 text-amber-400/50" />
            <p className="text-sm text-gray-400">Tap Scan to check BrickOwl for lots with wrong colors.</p>
          </div>
        )}

        {/* Scanning */}
        {scanMutation.isPending && (
          <div className="px-4 py-10 flex flex-col items-center gap-3 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
            <p className="text-sm text-gray-400">Scanning BrickOwl inventory…</p>
          </div>
        )}

        {/* All good */}
        {mismatches?.length === 0 && (
          <div className="px-4 py-10 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-400" />
            <p className="text-sm text-green-300">All lots have the correct color.</p>
          </div>
        )}

        {/* Mismatch list */}
        {mismatches && mismatches.length > 0 && (
          <>
            {/* Bulk action bar */}
            <div className="px-4 py-2.5 flex items-center gap-2 border-b border-gray-800 bg-gray-900/60 sticky top-0 z-10">
              <input
                type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                onChange={() => setSelected(allSelected ? new Set() : new Set(mismatches!.map(m => m.lotId)))}
                disabled={isBusy}
                className="w-3.5 h-3.5 rounded cursor-pointer flex-shrink-0"
                data-testid="checkbox-color-repair-select-all"
              />
              <span className="text-[11px] text-gray-400 flex-1">
                {someSelected ? `${selected.size} of ${mismatches.length} selected` : `${mismatches.length} item${mismatches.length !== 1 ? 's' : ''} need fixing`}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={!someSelected || isBusy}
                onClick={() => fixLots([...selected])}
                data-testid="button-color-repair-fix-selected"
              >
                {fixingLots.size > 0 ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Paintbrush className="w-3 h-3 mr-1" />}
                {fixingLots.size > 0 ? 'Fixing…' : someSelected ? `Fix Selected (${selected.size})` : 'Fix Selected'}
              </Button>
            </div>

            {/* Fix progress bar */}
            {fixingLots.size > 0 && (
              <div className="px-4 py-2.5 border-b border-gray-800 bg-gray-900/40">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] text-gray-400">Fixing lots…</span>
                  <span className="text-[11px] font-mono text-gray-400">{repairDone} / {fixingLots.size}</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-400 transition-all duration-300"
                    style={{ width: `${Math.min(100, fixingLots.size > 0 ? (repairDone / fixingLots.size) * 100 : 0)}%` }}
                    data-testid="bar-color-repair-progress"
                  />
                </div>
              </div>
            )}

            {/* Rows */}
            <div className="divide-y divide-gray-800">
              {mismatches.map(m => {
                const isSelected = selected.has(m.lotId);
                const isFixing = fixingLots.has(m.lotId);
                return (
                  <div
                    key={m.lotId}
                    className={`px-4 py-3 flex items-center gap-3 ${isSelected ? 'bg-amber-950/20' : ''}`}
                    data-testid={`row-color-mismatch-${m.lotId}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => setSelected(prev => {
                        const next = new Set(prev);
                        isSelected ? next.delete(m.lotId) : next.add(m.lotId);
                        return next;
                      })}
                      disabled={isBusy}
                      className="w-3.5 h-3.5 rounded cursor-pointer flex-shrink-0"
                      data-testid={`checkbox-color-mismatch-${m.lotId}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-gray-100 font-mono">{m.itemNo}</span>
                        <span className="font-mono text-[9px] text-gray-500 bg-gray-800 border border-gray-700 rounded px-1 py-px">BL #{m.blId}</span>
                        <span className="font-mono text-[9px] text-gray-500 bg-gray-800 border border-gray-700 rounded px-1 py-px">BO lot #{m.lotId}</span>
                      </div>
                      <div className="text-[11px] mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span className="text-red-400">{m.currentColorName ?? `Color ${m.currentColorId}`}</span>
                        <span className="text-gray-600">→</span>
                        <span className="text-teal-400">{m.expectedColorName ?? `Color ${m.expectedColorId}`}</span>
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={isBusy}
                      onClick={() => fixLots([m.lotId])}
                      data-testid={`button-fix-color-${m.lotId}`}
                      title="Fix this lot"
                    >
                      {isFixing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paintbrush className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                );
              })}
            </div>

            <p className="px-4 py-3 text-[10px] text-gray-600 border-t border-gray-800">
              Each fix deletes and recreates the lot with the correct color. All fields (qty, price, notes, tier pricing) are preserved. Lots are briefly offline during the operation.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ColorRepairButton({ onShowColorRepair }: { onShowColorRepair: () => void }) {
  return (
    <button
      onClick={onShowColorRepair}
      className="w-full text-left rounded-lg border p-3 hover-elevate transition-opacity border-amber-500/30 bg-amber-950/20"
      data-testid="button-color-repair-entry"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Paintbrush className="w-4 h-4 text-amber-400 shrink-0" />
          <div>
            <span className="text-sm font-semibold text-amber-200">Wrong Color Lots</span>
            <p className="text-[11px] text-gray-400 mt-0.5">BrickOwl lots synced with an incorrect color</p>
          </div>
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
      </div>
    </button>
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

interface ScopeData {
  totalLots: number;
  activeTotalLots: number;
  inScopeLots: number;
  softDeletedLots: number;
  skipLots: number;
  hiddenLots: number;
  activeLots: number;
  mainStoreLots: number;
  zeroQtyInScope: number;
  itemTypeExcludedLots: number;
  priceFloorExcludedLots: number;
  priceFloor: number | null;
  excludedItemTypes: string[];
  stockroomModes: Record<string, string>;
  stockroomBreakdown: Array<{ id: string; mode: string; lots: number; zeroQtyLots: number }>;
  exclusions: Array<{ reason: string; count: number }>;
}

function SyncScopePanel({ brickOwl }: { brickOwl: any }) {
  const { data: scope, isLoading } = useQuery<ScopeData>({
    queryKey: ['/api/channel-sync/scope'],
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const boTotalLots    = brickOwl?.stats?.totalLots ?? 0;
  const boUnlinked     = brickOwl?.discrepancies?.unlinkedBoLots ?? 0;
  const boOrphaned     = brickOwl?.discrepancies?.orphanedBoLots ?? 0;
  const boStandalone   = boUnlinked + boOrphaned;
  const boLinked       = Math.max(0, boTotalLots - boStandalone);
  const missingLots    = brickOwl?.discrepancies?.missingLots ?? 0;

  if (isLoading) {
    return (
      <div className="rounded-md border border-gray-700/50 bg-gray-800/30 p-3 space-y-2" data-testid="panel-sync-scope-loading">
        <div className="h-3 w-24 rounded bg-gray-700/60 animate-pulse" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-16 rounded bg-gray-700/40 animate-pulse" />
          <div className="h-16 rounded bg-gray-700/40 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!scope) return null;

  return (
    <div className="rounded-md border border-gray-700/50 bg-gray-800/20 p-3 space-y-3" data-testid="panel-sync-scope">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Sync Scope</p>

      <div className="grid grid-cols-2 gap-2">
        {/* BrickLink column */}
        <div className="rounded bg-gray-800/50 px-2.5 py-2 space-y-2">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">BrickLink</p>
          <div>
            <p className="text-sm font-mono font-bold text-gray-100">{scope.inScopeLots.toLocaleString()}</p>
            <p className="text-[10px] text-gray-400">lots in scope</p>
          </div>
          <div className="space-y-1">
            {/* Base: total BL lots */}
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] text-gray-500">BL total</span>
              <span className="text-[10px] font-mono text-gray-300">{scope.totalLots.toLocaleString()}</span>
            </div>
            {/* Soft-deleted — always a deduction */}
            {scope.softDeletedLots > 0 && (
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-600">Soft-deleted</span>
                <span className="text-[10px] font-mono text-gray-600">−{scope.softDeletedLots.toLocaleString()}</span>
              </div>
            )}
            {/* Skip-mode stockrooms only — these are excluded from scope */}
            {scope.stockroomBreakdown.filter(r => r.mode === 'skip').map(r => (
              <div key={r.id} className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-600">Stockroom {r.id} (skip)</span>
                <span className="text-[10px] font-mono text-gray-600">−{r.lots.toLocaleString()}</span>
              </div>
            ))}
            {/* Config-based deductions */}
            {scope.itemTypeExcludedLots > 0 && (
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-600">Item type excluded</span>
                <span className="text-[10px] font-mono text-gray-600">−{scope.itemTypeExcludedLots.toLocaleString()}</span>
              </div>
            )}
            {scope.priceFloorExcludedLots > 0 && (
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-600">Below price floor</span>
                <span className="text-[10px] font-mono text-gray-600">−{scope.priceFloorExcludedLots.toLocaleString()}</span>
              </div>
            )}
            {/* Zero-qty — informational, plain line, no warning styling */}
            {scope.zeroQtyInScope > 0 && (
              <div className="flex items-center justify-between gap-1 pt-0.5 border-t border-gray-700/40">
                <span className="text-[10px] text-gray-500">Zero-qty in scope</span>
                <span className="text-[10px] font-mono text-gray-400">{scope.zeroQtyInScope.toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* BrickOwl column */}
        <div className="rounded bg-gray-800/50 px-2.5 py-2 space-y-2">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">BrickOwl</p>
          <div>
            <p className="text-sm font-mono font-bold text-gray-100">{boLinked.toLocaleString()}</p>
            <p className="text-[10px] text-gray-400">linked lots</p>
          </div>
          <div className="space-y-1">
            {/* Base: BO total */}
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] text-gray-500">BO total</span>
              <span className="text-[10px] font-mono text-gray-300">{boTotalLots.toLocaleString()}</span>
            </div>
            {/* Missing: in BL scope but not on BO */}
            {missingLots > 0 && (
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-600">Missing</span>
                <span className="text-[10px] font-mono text-gray-600">+{missingLots.toLocaleString()}</span>
              </div>
            )}
            {/* Standalone: on BO but not in BL scope (unlinked + orphaned) */}
            {boStandalone > 0 && (
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-600">Standalone</span>
                <span className="text-[10px] font-mono text-gray-600">−{boStandalone.toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
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
  onOpenSettings,
  setDrawerOpen,
  discrepancyAreas,
  totalDiscrepancies,
  onSelectArea,
  onShowAuditReport,
  onShowColorRepair,
  progressData,
  progressPct,
  onChangeDetail,
  displayChannels,
  selectedChannel,
  onChannelSelect,
  ebayEnvironment,
}: any) {
  const [showFullSync, setShowFullSync] = useState(false);
  const selectedChannelLabel: string = displayChannels?.find((c: any) => c.key === selectedChannel)?.label ?? 'Channel';
  const syncStatusColor =
    lastSync?.lastSyncStatus === 'success' ? 'text-green-400' :
    lastSync?.lastSyncStatus === 'partial' ? 'text-yellow-400' :
    lastSync?.lastSyncStatus === 'error' || lastSync?.lastSyncStatus === 'failed' ? 'text-red-400' :
    'text-gray-400';
  const SyncStatusIcon =
    lastSync?.lastSyncStatus === 'success' ? CheckCircle2 :
    lastSync?.lastSyncStatus === 'partial' ? AlertTriangle :
    lastSync?.lastSyncStatus === 'error' || lastSync?.lastSyncStatus === 'failed' ? XCircle :
    Clock;

  return (
    <div className="px-4 pt-3 pb-6 space-y-4">
      {/* Primary action row — mirrors BrickLink and OrderSync structure */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant="secondary"
          disabled={isRunning || syncMutation.isPending}
          onClick={() => { setShowFullSync(false); syncMutation.mutate(); }}
          data-testid="button-channel-sync-now"
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
          disabled={isRunning}
          onClick={() => setShowFullSync(v => !v)}
          data-testid="button-channel-full-scan-toggle"
          className={showFullSync ? 'toggle-elevate toggle-elevated' : 'toggle-elevate'}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Full Sync
          <ChevronDown className={`w-3 h-3 ml-1 transition-transform ${showFullSync ? 'rotate-180' : ''}`} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { setDrawerOpen(false); onOpenSettings?.('platforms', 'schedulerChannel'); }}
          data-testid="button-channel-sync-schedule"
        >
          <CalendarClock className="w-3.5 h-3.5 mr-1.5" />
          Schedule
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
        {totalDiscrepancies > 0 && !isRunning && (
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

      {/* Collapsible full sync panel */}
      {showFullSync && (
        <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 p-3 space-y-2.5">
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Pushes all inventory lots to {selectedChannelLabel}, regardless of what has changed. Use this if channel data is significantly out of sync — e.g. after downtime or a bulk price update.
          </p>
          <Button
            size="sm"
            variant="ghost"
            disabled={isRunning || syncMutation.isPending}
            onClick={() => { syncMutation.mutate({ fullScan: true }); setShowFullSync(false); }}
            data-testid="button-channel-run-full-scan"
          >
            {syncMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            )}
            Run full scan
          </Button>
        </div>
      )}

      {/* Channel selector — only shown when multiple channels configured */}
      {displayChannels && displayChannels.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          {displayChannels.map((ch: any) => (
            <button
              key={ch.key}
              onClick={() => onChannelSelect(ch.key)}
              data-testid={`button-channel-select-${ch.key}`}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-[11px] font-medium transition-colors ${
                selectedChannel === ch.key
                  ? 'border-green-500/60 bg-green-950/50 text-green-300'
                  : 'border-gray-700/60 bg-gray-900/40 text-gray-400 hover:text-gray-200 hover:border-gray-600'
              }`}
            >
              {ch.label}
            </button>
          ))}
        </div>
      )}

      {/* eBay-specific info banner */}
      {selectedChannel === 'ebay' && (
        <div className={`rounded-lg border p-3 space-y-2 text-xs ${ebayEnvironment === 'sandbox' ? 'border-yellow-500/30 bg-yellow-950/20' : 'border-blue-500/20 bg-blue-950/20'}`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className={`font-medium flex items-center gap-1.5 ${ebayEnvironment === 'sandbox' ? 'text-yellow-300' : 'text-blue-300'}`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ebayEnvironment === 'sandbox' ? 'bg-yellow-400' : 'bg-blue-400'}`} />
              eBay — Push-only channel
            </p>
            {ebayEnvironment === 'sandbox' && (
              <span className="text-[9px] font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded px-1.5 py-0.5 uppercase tracking-wide">
                Sandbox
              </span>
            )}
          </div>
          {ebayEnvironment === 'sandbox' && (
            <p className="text-yellow-500/80 leading-relaxed">
              Sandbox mode — listings are pushed to eBay sandbox only. Switch to Production in <span className="text-yellow-300">Settings → Platform Connections → eBay</span> when ready to go live.
            </p>
          )}
          <p className="text-gray-400 leading-relaxed">
            Your BrickLink inventory is pushed to eBay as fixed-price listings. Images come from your Image Center (never BrickLink CDN). Discrepancy analysis is not available for eBay — sync runs are always push operations.
          </p>
          {ebayEnvironment !== 'sandbox' && (
            <p className="text-gray-500">
              Configure eBay credentials in <span className="text-gray-300">Settings → Platform Connections → eBay</span>. Listing options (BrickLink ID field placement, catalog matching, listing duration) are set per org in the channel sync config.
            </p>
          )}
        </div>
      )}

      <Separator className="bg-gray-700/60" />

      {/* Live progress box — mirrors BL drawer style */}
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
                <span>
                  {progressData.phase === 'fetching'
                    ? 'Fetching inventory…'
                    : progressData.total > 0
                      ? `Syncing ${progressData.processed.toLocaleString()} / ${progressData.total.toLocaleString()} items`
                      : 'Syncing…'}
                </span>
                <span className="tabular-nums font-mono">{progressPct}%</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Last sync summary — BrickOwl only */}
      {selectedChannel !== 'ebay' && lastSync && !isRunning && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 px-0.5">Last Sync</p>
          <div className="rounded-lg border border-gray-700/60 bg-gray-900/50 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <SyncStatusIcon className={`w-4 h-4 shrink-0 ${syncStatusColor}`} />
              <span className={`text-sm font-medium ${syncStatusColor}`}>
                {lastSync.lastSyncStatus === 'success'  ? 'Completed successfully' :
                 lastSync.lastSyncStatus === 'partial'  ? 'Completed with errors'  :
                 lastSync.lastSyncStatus === 'error'    ? 'Failed'                 :
                 lastSync.lastSyncStatus === 'in_progress' ? 'In progress…'        :
                 lastSync.lastSyncStatus ?? 'Unknown'}
              </span>
              {lastSync.lastSyncTime && (
                <span className="text-[10px] text-gray-500 ml-auto">{relTime(lastSync.lastSyncTime)}</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded bg-gray-800/60 px-2 py-1.5 text-center">
                <p className="text-base font-mono font-bold text-green-300">
                  {brickOwl?.stats?.totalLots != null ? Number(brickOwl.stats.totalLots).toLocaleString() : '—'}
                </p>
                <p className="text-[9px] text-gray-500 mt-0.5">BO Lots</p>
              </div>
              <div className="rounded bg-gray-800/60 px-2 py-1.5 text-center">
                <p className="text-base font-mono font-bold text-green-300">
                  {brickOwl?.stats?.totalParts != null ? Number(brickOwl.stats.totalParts).toLocaleString() : '—'}
                </p>
                <p className="text-[9px] text-gray-500 mt-0.5">BO Parts</p>
              </div>
              <button
                onClick={() => onChangeDetail('created')}
                className="rounded bg-gray-800/60 px-2 py-1.5 text-center hover-elevate active-elevate-2 w-full"
                data-testid="button-ch-stat-created"
              >
                <p className="text-base font-mono font-bold text-green-400">
                  {lastSync.recordsAdded != null ? Number(lastSync.recordsAdded).toLocaleString() : '—'}
                </p>
                <p className="text-[9px] text-gray-500 mt-0.5 flex items-center justify-center gap-0.5">
                  Created
                  <ChevronRight className="w-2.5 h-2.5 text-gray-600" />
                </p>
              </button>
              <button
                onClick={() => onChangeDetail('updated')}
                className="rounded bg-gray-800/60 px-2 py-1.5 text-center hover-elevate active-elevate-2 w-full"
                data-testid="button-ch-stat-updated"
              >
                <p className="text-base font-mono font-bold text-yellow-300">
                  {lastSync.recordsUpdated != null ? Number(lastSync.recordsUpdated).toLocaleString() : '—'}
                </p>
                <p className="text-[9px] text-gray-500 mt-0.5 flex items-center justify-center gap-0.5">
                  Updated
                  <ChevronRight className="w-2.5 h-2.5 text-gray-600" />
                </p>
              </button>
            </div>
            {lastSync.errorMessage && lastSync.lastSyncStatus !== 'success' && (
              <div className="flex items-start gap-1.5 rounded border border-red-500/30 bg-red-950/20 px-2 py-1.5">
                <XCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[10px] text-red-300/80">{lastSync.errorMessage}</p>
              </div>
            )}
            {lastResult?.errors?.length > 0 && (
              <div className="rounded border border-red-500/20 bg-red-950/10 px-2 py-1.5 space-y-0.5">
                <p className="text-[9px] font-semibold text-red-400/80 uppercase tracking-wide mb-1">Error details ({lastResult.errors.length})</p>
                <div className="max-h-28 overflow-y-auto space-y-0.5">
                  {lastResult.errors.slice(0, 50).map((err: string, i: number) => (
                    <p key={i} className="text-[10px] text-red-300/70 font-mono leading-tight">{err}</p>
                  ))}
                  {lastResult.errors.length > 50 && (
                    <p className="text-[10px] text-red-400/50 italic">…and {lastResult.errors.length - 50} more</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedChannel !== 'ebay' && brickOwl?.syncMode && (
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

      {selectedChannel !== 'ebay' && <SyncScopePanel brickOwl={brickOwl} />}

      {/* Lot Issues — BrickOwl only */}
      {selectedChannel !== 'ebay' && (() => {
        const LOT_TYPES: DiscrepancyType[] = ['missing', 'type_mismatch', 'unlinked', 'orphaned'];
        const lotAreas = discrepancyAreas.filter(a => LOT_TYPES.includes(a.type));
        return (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 px-0.5">Lot Issues</p>
            <div className="space-y-2">
              {isLoading ? (
                [1, 2].map(i => <div key={i} className="h-16 rounded-lg bg-gray-800/60 animate-pulse" />)
              ) : (
                lotAreas.map((area) => (
                  <DiscrepancyAreaButton key={area.type} area={area} onSelectArea={onSelectArea} />
                ))
              )}
            </div>
          </div>
        );
      })()}

      {/* Field Issues — BrickOwl only */}
      {selectedChannel !== 'ebay' && (() => {
        const FIELD_TYPES: DiscrepancyType[] = ['price', 'quantity', 'remarks', 'description', 'bulk_qty', 'lot_weight', 'for_sale', 'sale_percent'];
        const fieldAreas = totalDiscrepancies > 0 ? discrepancyAreas.filter(a => FIELD_TYPES.includes(a.type)) : [];
        return (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 px-0.5">Field Issues</p>
            <div className="space-y-2">
              {fieldAreas.map((area) => (
                <DiscrepancyAreaButton key={area.type} area={area} onSelectArea={onSelectArea} />
              ))}
              <ColorRepairButton onShowColorRepair={onShowColorRepair} />
            </div>
          </div>
        );
      })()}

      {selectedChannel !== 'ebay' && !isLoading && brickOwl?.enabled && totalDiscrepancies === 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
          <span>No discrepancies — {selectedChannelLabel} is in sync with BrickLink.</span>
        </div>
      )}

    </div>
  );
}

function DiscrepancyDetail({ area, data, isLoading }: {
  area: DiscrepancyArea;
  data: any;
  isLoading: boolean;
}) {
  const [search, setSearch] = useState('');
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

  const isMissing = area.type === 'missing';

  // Filter by search (part number or lot id) — only for missing type
  const q = search.trim().toLowerCase();
  const filtered = isMissing && q
    ? items.filter((item: any) =>
        item.itemNo?.toLowerCase().includes(q) ||
        String(item.lotId ?? '').includes(q)
      )
    : items;

  // Group by stockroom for missing type
  const renderMissing = () => {
    // Partition: stockroom groups (A, B, C, …) + main store
    const groups = new Map<string, any[]>();
    for (const item of filtered) {
      const key = item.isStockRoom ? `SR-${item.stockRoomId ?? '?'}` : 'main';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }

    // Sort: stockroom groups first (alphabetical by id), then main store
    const sortedKeys = [...groups.keys()].sort((a, b) => {
      if (a === 'main') return 1;
      if (b === 'main') return -1;
      return a.localeCompare(b);
    });

    if (filtered.length === 0) {
      return (
        <div className="px-4 py-6 text-center text-xs text-gray-500">
          No results for "{search}"
        </div>
      );
    }

    return (
      <div className="px-4 pt-2 pb-6 space-y-5">
        {sortedKeys.map(key => {
          const groupItems = groups.get(key)!;
          const isStockroom = key.startsWith('SR-');
          const roomId = isStockroom ? key.replace('SR-', '') : null;
          return (
            <div key={key}>
              {/* Group header */}
              <div className="flex items-center gap-1.5 mb-2">
                <Warehouse className="w-3 h-3 text-gray-500 shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  {isStockroom ? `Stockroom ${roomId}` : 'Main Store'}
                </span>
                <span className="text-[10px] text-gray-600 ml-1">({groupItems.length})</span>
              </div>
              <div className="space-y-2">
                {groupItems.map((item: any, i: number) => (
                  <DiscrepancyRow key={`${item.itemNo}-${i}`} item={item} type={area.type} area={area} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col min-h-0">
      {/* Search bar — missing lots only */}
      {isMissing && (
        <div className="px-4 pt-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search part number or lot ID…"
              className="pl-8 h-8 text-xs bg-gray-800/60 border-gray-700 text-gray-200 placeholder:text-gray-600 focus-visible:ring-orange-500/40"
              data-testid="input-missing-lots-search"
            />
          </div>
        </div>
      )}
      {total > items.length && (
        <div className="px-4 pt-1 pb-1">
          <p className="text-[11px] text-gray-500">
            Showing {items.length} of {total} items
          </p>
        </div>
      )}
      {isMissing ? renderMissing() : (
        <div className="px-4 pt-2 pb-6 space-y-2">
          {filtered.map((item: any, i: number) => (
            <DiscrepancyRow key={`${item.itemNo}-${i}`} item={item} type={area.type} area={area} />
          ))}
        </div>
      )}
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
  { type: 'missing',      label: 'Missing Lots',                         color: '#f97316' },
  { type: 'type_mismatch', label: 'Type Mismatch (BL: Part / BO: Minifig)', color: '#a78bfa' },
  { type: 'unlinked',    label: 'Unlinked BrickOwl Lots',                color: '#9ca3af' },
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
    missing:       useQuery<any>({ queryKey: ['/api/platform-sync/discrepancies/BrickOwl', 'missing',       'all'], queryFn: () => fetch('/api/platform-sync/discrepancies/BrickOwl/missing?limit=10000').then(r => r.json()),       enabled: activeTypes.includes('missing'),       refetchOnWindowFocus: false }),
    type_mismatch: useQuery<any>({ queryKey: ['/api/platform-sync/discrepancies/BrickOwl', 'type_mismatch', 'all'], queryFn: () => fetch('/api/platform-sync/discrepancies/BrickOwl/type_mismatch?limit=10000').then(r => r.json()), enabled: activeTypes.includes('type_mismatch'), refetchOnWindowFocus: false }),
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

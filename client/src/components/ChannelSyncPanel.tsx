import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Globe,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  XCircle,
  Clock,
} from "lucide-react";

interface ChannelSyncPanelProps {
  onOpenDetails: () => void;
}

export default function ChannelSyncPanel({ onOpenDetails }: ChannelSyncPanelProps) {
  const { toast } = useToast();

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
    <div
      className="rounded-lg border border-green-500/40 bg-gradient-to-br from-green-950/50 to-gray-950/70 p-3 space-y-2"
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
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs text-green-300"
            disabled={isRunning || syncMutation.isPending}
            onClick={() => syncMutation.mutate()}
            data-testid="button-channel-sync-now"
          >
            {syncMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <RefreshCw className="w-3 h-3 mr-1" />
            )}
            Sync Now
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs text-green-300"
            onClick={onOpenDetails}
            data-testid="button-channel-open-details"
          >
            Details
            <ArrowRight className="w-3 h-3 ml-1" />
          </Button>
        </div>
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

      {/* Discrepancies */}
      {!isLoading && totalDiscrepancies > 0 && (
        <button
          onClick={onOpenDetails}
          className="w-full flex items-center justify-between gap-2 bg-orange-500/10 border border-orange-500/25 rounded px-2 py-1.5 text-left hover-elevate"
          data-testid="button-channel-discrepancies"
        >
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 text-orange-400 shrink-0" />
            <span className="text-[10px] font-semibold text-orange-300">Discrepancies detected</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {missingLots > 0 && (
              <Badge variant="outline" className="text-[9px] h-4 px-1 border-orange-500/40 text-orange-300">
                {missingLots} missing
              </Badge>
            )}
            {priceDiffs > 0 && (
              <Badge variant="outline" className="text-[9px] h-4 px-1 border-yellow-500/40 text-yellow-300">
                {priceDiffs} price
              </Badge>
            )}
            {qtyDiffs > 0 && (
              <Badge variant="outline" className="text-[9px] h-4 px-1 border-blue-500/40 text-blue-300">
                {qtyDiffs} qty
              </Badge>
            )}
            <ArrowRight className="w-2.5 h-2.5 text-orange-400 shrink-0" />
          </div>
        </button>
      )}

      {/* All clear */}
      {!isLoading && brickOwl?.enabled && totalDiscrepancies === 0 && lastSync?.lastSyncStatus === 'success' && (
        <div className="flex items-center gap-1.5 text-[10px] text-green-400/70">
          <CheckCircle2 className="w-2.5 h-2.5" />
          <span>BrickOwl is in sync</span>
        </div>
      )}
    </div>
  );
}

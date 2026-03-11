import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Package, ShoppingCart,
  RefreshCw, CheckCircle, XCircle, AlertCircle, Loader2,
  ScanSearch, ArrowRight, Settings, AlertTriangle, Zap,
  TrendingDown, Clock, Activity, CreditCard, ChevronUp,
} from "lucide-react";
import DashboardNotifications from "./DashboardNotifications";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CompactModeProvider } from "@/contexts/CompactMode";

interface GeneralDashboardProps {
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
  onOpenFulfillment?: () => void;
  onOpenBrickanalyzer?: () => void;
  onOpenPriceomatic?: () => void;
  onOpenSettings?: (section: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'users' | 'billing') => void;
  panelMode?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function formatCurrency(v: string | number) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

// ── Sub-components ────────────────────────────────────────────────────────────

type LaneColor = 'cyan' | 'orange' | 'teal' | 'purple';

function LaneCard({
  title, Icon, color, children, summary,
}: {
  title: string;
  Icon: React.ElementType;
  color: LaneColor;
  children: React.ReactNode;
  summary?: React.ReactNode;
}) {
  const borderCls = color === 'cyan' ? 'border-cyan-500/40' : color === 'orange' ? 'border-orange-500/40' : color === 'teal' ? 'border-teal-500/40' : 'border-purple-500/40';
  const gradCls = color === 'cyan' ? 'from-cyan-950/30' : color === 'orange' ? 'from-orange-950/30' : color === 'teal' ? 'from-teal-950/30' : 'from-purple-950/30';
  const headerGradCls = color === 'cyan' ? 'from-cyan-950/40' : color === 'orange' ? 'from-orange-950/40' : color === 'teal' ? 'from-teal-950/40' : 'from-purple-950/40';
  const shineCls = color === 'cyan' ? 'via-cyan-400/50' : color === 'orange' ? 'via-orange-400/50' : color === 'teal' ? 'via-teal-400/50' : 'via-purple-400/50';
  const badgeCls = color === 'cyan' ? 'bg-cyan-900/60 ring-cyan-500/50' : color === 'orange' ? 'bg-orange-900/60 ring-orange-500/50' : color === 'teal' ? 'bg-teal-900/60 ring-teal-500/50' : 'bg-purple-900/60 ring-purple-500/50';
  const iconCls = color === 'cyan' ? 'text-cyan-200' : color === 'orange' ? 'text-orange-200' : color === 'teal' ? 'text-teal-200' : 'text-purple-200';
  const glowColor = color === 'cyan' ? 'rgba(6,182,212,0.22)' : color === 'orange' ? 'rgba(249,115,22,0.22)' : color === 'teal' ? 'rgba(20,184,166,0.22)' : 'rgba(168,85,247,0.22)';
  const badgeGlowColor = color === 'cyan' ? 'rgba(6,182,212,0.5)' : color === 'orange' ? 'rgba(249,115,22,0.5)' : color === 'teal' ? 'rgba(20,184,166,0.5)' : 'rgba(168,85,247,0.5)';

  return (
    <div
      className={`relative flex flex-col h-full rounded-lg border ${borderCls} bg-gradient-to-b ${gradCls} to-gray-900/85`}
      style={{ boxShadow: `0 0 24px ${glowColor}, 0 0 8px ${glowColor}` }}
    >
      {/* Shine line */}
      <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent ${shineCls} to-transparent pointer-events-none z-10`} />
      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${borderCls} bg-gradient-to-b ${headerGradCls} to-gray-900/80 rounded-t-lg`}>
        <div
          className={`p-1 rounded-md ${badgeCls} ring-1 shrink-0`}
          style={{ boxShadow: `0 0 8px ${badgeGlowColor}` }}
        >
          <Icon className={`w-3 h-3 ${iconCls}`} />
        </div>
        <span className={`text-xs xl:text-[11px] font-semibold uppercase tracking-widest ${iconCls}`}>{title}</span>
        {summary && <span className="ml-auto text-[10px] text-muted-foreground font-normal truncate max-w-[160px] flex items-center gap-1.5">{summary}</span>}
      </div>
      <div className="flex-1 flex flex-col divide-y divide-border/40 min-h-0 overflow-visible">
        {children}
      </div>
    </div>
  );
}

function LaneSection({ label, children, collapsible = false, className = "" }: { label?: string; children: React.ReactNode; collapsible?: boolean; className?: string }) {
  const [expanded, setExpanded] = useState(false);

  if (collapsible && label) {
    return (
      <div className={`relative mt-auto z-20 ${className}`}>
        {expanded && (
          <div
            className="absolute bottom-full left-0 right-0 z-30"
          >
            <div className="space-y-1.5 overflow-y-auto px-3 pb-2 pt-1 bg-gray-900/95 border-x border-t border-border/40 rounded-t-lg" style={{ maxHeight: 'calc(100vh - 10rem)' }}>
              {children}
            </div>
          </div>
        )}
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-2 w-full text-left px-3 py-2 transition-colors duration-100 border-t-2 border-cyan-500/30 bg-gradient-to-r from-cyan-950/20 via-transparent to-cyan-950/20 cockpit-trigger-bar"
          style={{ boxShadow: expanded ? 'none' : '0 -4px 12px rgba(6,182,212,0.08)' }}
          data-testid={`collapse-${label.toLowerCase().replace(/\s+/g, '-')}`}
        >
          <Clock className="w-3 h-3 shrink-0 text-cyan-400/70" />
          <p className="text-[10px] uppercase tracking-widest text-cyan-300/70 font-semibold flex-1">{label}</p>
          <ChevronUp className={`w-3.5 h-3.5 text-cyan-400/60 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
    );
  }

  return (
    <div className={`px-3 py-2 space-y-1.5 ${className}`}>
      {label && <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</p>}
      {children}
    </div>
  );
}

function JobBar({ label, pct, sublabel, color = 'blue' }: { label: string; pct: number; sublabel?: string; color?: string }) {
  const barColor = color === 'purple' ? 'bg-purple-500' : color === 'green' ? 'bg-green-500' : color === 'cyan' ? 'bg-cyan-500' : color === 'orange' ? 'bg-orange-500' : 'bg-blue-500';
  const trackColor = color === 'purple' ? 'bg-purple-950/80' : color === 'green' ? 'bg-green-950/80' : color === 'cyan' ? 'bg-cyan-950/80' : color === 'orange' ? 'bg-orange-950/80' : 'bg-blue-950/80';
  const textColor = color === 'purple' ? 'text-purple-400' : color === 'green' ? 'text-green-400' : color === 'cyan' ? 'text-cyan-400' : color === 'orange' ? 'text-orange-400' : 'text-blue-400';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <RefreshCw className={`w-3 h-3 shrink-0 ${textColor} animate-spin`} />
          <span className={`text-xs font-medium ${textColor}`}>{label}</span>
        </div>
        <span className={`text-[10px] font-mono ${textColor}`}>{Math.round(pct)}%</span>
      </div>
      <div className={`h-1 w-full rounded-full ${trackColor} overflow-hidden`}>
        <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      {sublabel && <p className="text-[10px] text-muted-foreground truncate">{sublabel}</p>}
    </div>
  );
}

function ActivityItem({ icon: Icon, iconColor, label, sub, time, onClick }: {
  icon: React.ElementType; iconColor: string; label: string; sub?: string; time?: string; onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-start gap-2 rounded px-1.5 py-1 ${onClick ? 'hover-elevate cursor-pointer' : ''}`}
      data-testid={`activity-${label.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}`}
    >
      <Icon className={`w-3 h-3 shrink-0 mt-0.5 ${iconColor}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-foreground leading-tight truncate">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground truncate">{sub}</p>}
      </div>
      {time && <span className="text-[10px] text-muted-foreground shrink-0 ml-1">{time}</span>}
    </div>
  );
}

function AlertItem({ icon: Icon, iconColor, label, sub, onClick, severity = 'warn' }: {
  icon: React.ElementType; iconColor: string; label: string; sub?: string; onClick?: () => void; severity?: 'warn' | 'error' | 'info';
}) {
  const bg = severity === 'error' ? 'bg-red-950/40 border-red-500/20' : severity === 'info' ? 'bg-blue-950/40 border-blue-500/20' : 'bg-yellow-950/40 border-yellow-500/20';
  const ringColor = severity === 'error' ? 'border-red-500' : severity === 'info' ? 'border-blue-400' : 'border-orange-400';
  return (
    <div
      onClick={onClick}
      className={`flex items-start gap-2 rounded border px-2 py-1.5 ${bg} ${onClick ? 'cursor-pointer hover-elevate' : ''}`}
    >
      <div className="relative shrink-0 mt-0.5 w-3 h-3 flex items-center justify-center cockpit-alert-pulse">
        <div className={`retro-wave-ring retro-wave-ring-1 ${ringColor}`} />
        <div className={`retro-wave-ring retro-wave-ring-2 ${ringColor}`} />
        <div className={`retro-wave-ring retro-wave-ring-3 ${ringColor}`} />
        <Icon className={`w-3 h-3 ${iconColor} relative z-10`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium leading-tight truncate">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground truncate">{sub}</p>}
      </div>
      {onClick && <ArrowRight className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" />}
    </div>
  );
}

function AllGood({ label = 'All clear' }: { label?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-1.5 py-0.5">
      <CheckCircle className="w-3 h-3 text-green-500" />
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

// ── INVENTORY LANE ────────────────────────────────────────────────────────────

function InventoryLane({
  stats, globalSyncStatuses, invSyncProgress, pomStatus, pricingInsights, underpricedThreshold, deepSpaceKeys, futureMissionsKeys, onItemClick, onOpenBrickanalyzer, onOpenPriceomatic, onOpenSettings,
  channelSyncRunning, syncStatus, latestScan,
}: any) {
  const lastInvSync = globalSyncStatuses?.inventory;
  const lastPom = pomStatus?.data ?? globalSyncStatuses?.priceomatic;
  const lastChannelSync = globalSyncStatuses?.channel;
  const isInvSyncing = invSyncProgress?.status === 'syncing';
  const isInvComplete = invSyncProgress?.status === 'complete';
  const isPomRunning = pomStatus?.data?.liveProgress?.active === true;
  const pomProgress = pomStatus?.data?.liveProgress;
  const isChannelSyncing = channelSyncRunning?.running === true;
  const channelSyncFailed = lastChannelSync?.lastSyncStatus === 'failed' || lastChannelSync?.lastSyncStatus === 'error';
  const targets: any[] = syncStatus?.targets ?? [];
  const channelIssues = targets.map((t: any) => {
    const name = t.name ?? t.platform ?? 'Unknown channel';
    const connected = t.enabled ?? t.connected;
    const missingLots: number = t.discrepancies?.missingLots || 0;
    const priceDiffs: number = t.discrepancies?.priceDifferences || 0;
    const qtyDiffs: number = t.discrepancies?.quantityDifferences || 0;
    const disc = missingLots + priceDiffs + qtyDiffs;
    return { name, connected, disc, missingLots, priceDiffs, qtyDiffs };
  }).filter(c => !c.connected || c.disc > 0);
  const hasChannelIssues = channelIssues.length > 0 || channelSyncFailed;

  const { data: activeInvEmbed } = useQuery<{ id: string; status: string } | null>({
    queryKey: ['/api/embeddings/jobs/active/inventory'],
    refetchInterval: 8000,
  });

  const { data: embedStats } = useQuery<{
    inventory: { embedded: number; total: number; percentage: string };
    orders: { embedded: number; total: number; percentage: string };
  }>({
    queryKey: ['/api/embeddings/stats'],
    refetchInterval: 10000,
  });

  const invEmbedPct = embedStats && embedStats.inventory.total > 0
    ? Math.round((embedStats.inventory.embedded / embedStats.inventory.total) * 100) : 0;

  const isScanProcessing = latestScan?.status === 'processing';
  const isScanComplete = latestScan?.status === 'complete';
  const isScanFailed = latestScan?.status === 'failed';

  const hasRunningJobs = isInvSyncing || isPomRunning || !!activeInvEmbed || isScanProcessing;

  const threshold = underpricedThreshold ?? 1.5;
  const tooHighCount = pricingInsights?.data?.tooHigh?.length ?? 0;

  // Mirror POM screen logic: group ALL items by itemNo+colorId, use max score per group
  const allInsightItems: any[] = [
    ...(pricingInsights?.data?.tooHigh ?? []),
    ...(pricingInsights?.data?.tooLow ?? []),
    ...(pricingInsights?.data?.wellPriced ?? []),
  ];
  const groupScores = new Map<string, { maxScore: number; totalQty: number }>();
  for (const item of allInsightItems) {
    const key = `${item.itemNo}_${item.colorId ?? 'null'}`;
    const score = item.opportunityScore ?? 0;
    const qty = item.quantity ?? 0;
    const existing = groupScores.get(key);
    if (existing) {
      existing.maxScore = Math.max(existing.maxScore, score);
      existing.totalQty += qty;
    } else {
      groupScores.set(key, { maxScore: score, totalQty: qty });
    }
  }
  const highOpportunityCount = Array.from(groupScores.entries()).filter(
    ([key, g]) => g.totalQty > 0 && g.maxScore >= threshold && !(deepSpaceKeys as Set<string>)?.has(key) && !(futureMissionsKeys as Set<string>)?.has(key)
  ).length;

  const invSyncFailed = lastInvSync?.lastSyncStatus === 'failed' || lastInvSync?.lastSyncStatus === 'error';
  const pomFailed = lastPom?.lastSyncStatus === 'failed' || lastPom?.lastSyncStatus === 'error';

  const summary = stats
    ? `${(stats.totalInventoryItems || 0).toLocaleString()} lots · ${(stats.totalInventoryQuantity || 0).toLocaleString()} pcs`
    : undefined;

  return (
    <LaneCard title="Inventory" Icon={Package} color="cyan" summary={summary}>

      {/* Needs Attention */}
      {(invSyncFailed || pomFailed || highOpportunityCount > 0 || tooHighCount > 0 || hasChannelIssues || (isScanComplete && (latestScan?.totalPieces ?? 0) > 0)) ? (
        <LaneSection label="Attention">
          {isScanComplete && (latestScan?.totalPieces ?? 0) > 0 && (
            <AlertItem
              icon={Zap}
              iconColor="text-purple-400"
              label="Scan results ready to view"
              sub="View before they expire"
              onClick={onOpenBrickanalyzer}
              severity="info"
            />
          )}
          {invSyncFailed && (
            <AlertItem icon={XCircle} iconColor="text-red-400" label="Inventory sync failed" sub={lastInvSync?.errorMessage ?? 'Check BrickLink connection'} onClick={() => onOpenSettings?.('platforms')} severity="error" />
          )}
          {pomFailed && (
            <AlertItem icon={XCircle} iconColor="text-red-400" label="Price-o-Matic failed" sub={lastPom?.errorMessage ?? 'Run manually from Settings'} onClick={() => onOpenSettings?.('automation')} severity="error" />
          )}
          {highOpportunityCount > 0 && (
            <AlertItem icon={TrendingDown} iconColor="text-orange-400" label={`${highOpportunityCount} items underpriced (score > ${threshold}x)`} sub="Open Price-o-Matic to review" onClick={onOpenPriceomatic} severity="warn" />
          )}
          {channelIssues.map(c => (
            <div key={c.name}>
              {!c.connected && (
                <AlertItem icon={XCircle} iconColor="text-red-400" label={`${c.name} disconnected`} sub="Tap to reconnect" onClick={() => onOpenSettings?.('platforms')} severity="error" />
              )}
              {c.missingLots > 0 && (
                <AlertItem icon={AlertTriangle} iconColor="text-yellow-400" label={`${c.name}: ${c.missingLots} missing lot${c.missingLots !== 1 ? 's' : ''}`} severity="warn" />
              )}
              {c.priceDiffs > 0 && (
                <AlertItem icon={AlertTriangle} iconColor="text-yellow-400" label={`${c.name}: ${c.priceDiffs} price diff${c.priceDiffs !== 1 ? 's' : ''}`} severity="warn" />
              )}
              {c.qtyDiffs > 0 && (
                <AlertItem icon={AlertTriangle} iconColor="text-yellow-400" label={`${c.name}: ${c.qtyDiffs} qty diff${c.qtyDiffs !== 1 ? 's' : ''}`} severity="warn" />
              )}
            </div>
          ))}
          {channelSyncFailed && (
            <AlertItem icon={XCircle} iconColor="text-red-400" label="Channel sync failed" sub={lastChannelSync?.errorMessage ?? 'Check channel connections'} onClick={() => onOpenSettings?.('platforms')} severity="error" />
          )}
        </LaneSection>
      ) : (
        <LaneSection><AllGood /></LaneSection>
      )}

      {/* Running Jobs */}
      {(hasRunningJobs || isChannelSyncing) && (
        <LaneSection label="Running">
          {isInvSyncing && (
            <JobBar
              label="Inventory Sync"
              pct={invSyncProgress?.progress ?? 0}
              sublabel={invSyncProgress?.currentStep}
              color="cyan"
            />
          )}
          {isInvComplete && (
            <ActivityItem icon={CheckCircle} iconColor="text-green-400" label="Inventory Sync complete" sub={`${invSyncProgress?.details?.itemsAdded ?? 0} added, ${invSyncProgress?.details?.itemsUpdated ?? 0} updated`} />
          )}
          {isPomRunning && pomProgress && (
            <JobBar
              label="Price-o-Matic"
              pct={pomProgress.itemsTotal > 0 ? (pomProgress.itemsProcessed / pomProgress.itemsTotal) * 100 : 0}
              sublabel={`${pomProgress.itemsProcessed.toLocaleString()} / ${pomProgress.itemsTotal.toLocaleString()} lots`}
              color="purple"
            />
          )}
          {isChannelSyncing && (
            <div className="flex items-center gap-1.5 px-1.5">
              <RefreshCw className="w-3 h-3 text-teal-400 animate-spin shrink-0" />
              <span className="text-[10px] text-teal-300 font-medium">Channel sync running…</span>
            </div>
          )}
          {isScanProcessing && (
            <div className="flex items-center gap-1.5 px-1.5">
              <Loader2 className="w-3 h-3 text-purple-400 animate-spin shrink-0" />
              <span className="text-[10px] text-purple-300 font-medium">BrickSpotter scanning…</span>
            </div>
          )}
          {activeInvEmbed && embedStats ? (
            <JobBar
              label="Inventory embedding"
              pct={invEmbedPct}
              sublabel={`${embedStats.inventory.embedded.toLocaleString()} / ${embedStats.inventory.total.toLocaleString()} items`}
              color="purple"
            />
          ) : activeInvEmbed ? (
            <div className="flex items-center gap-1.5 px-1.5">
              <Activity className="w-3 h-3 text-blue-400 animate-pulse" />
              <span className="text-[10px] text-blue-400">Embedding inventory data…</span>
            </div>
          ) : null}
        </LaneSection>
      )}

      {/* Last Actions */}
      <LaneSection label="Last Actions" collapsible>
        {lastInvSync?.lastSyncTime ? (
          <ActivityItem
            icon={lastInvSync.lastSyncStatus === 'success' ? CheckCircle : lastInvSync.lastSyncStatus === 'partial' ? AlertCircle : XCircle}
            iconColor={lastInvSync.lastSyncStatus === 'success' ? 'text-green-400' : lastInvSync.lastSyncStatus === 'partial' ? 'text-yellow-400' : 'text-red-400'}
            label={`Inventory sync — ${lastInvSync.lastSyncStatus}`}
            sub={lastInvSync.lastSyncStatus === 'success' ? `+${lastInvSync.recordsAdded ?? 0} added, ${lastInvSync.recordsUpdated ?? 0} updated` : lastInvSync.errorMessage ?? undefined}
            time={relTime(lastInvSync.lastSyncTime)}
          />
        ) : (
          <ActivityItem icon={Clock} iconColor="text-muted-foreground" label="No inventory sync yet" />
        )}
        {lastPom?.lastSyncTime && lastPom.lastSyncStatus !== 'in_progress' ? (
          <ActivityItem
            icon={lastPom.lastSyncStatus === 'success' ? CheckCircle : lastPom.lastSyncStatus === 'partial' ? AlertCircle : XCircle}
            iconColor={lastPom.lastSyncStatus === 'success' ? 'text-green-400' : lastPom.lastSyncStatus === 'partial' ? 'text-yellow-400' : 'text-red-400'}
            label={`Price-o-Matic — ${lastPom.lastSyncStatus}`}
            sub={lastPom.lastSyncStatus === 'success' ? `${lastPom.recordsUpdated ?? 0} lots priced` : lastPom.errorMessage ?? undefined}
            time={relTime(lastPom.lastSyncTime)}
          />
        ) : !isPomRunning ? (
          <ActivityItem icon={Clock} iconColor="text-muted-foreground" label="No Price-o-Matic run yet" />
        ) : null}
        {lastChannelSync?.lastSyncTime && lastChannelSync.lastSyncStatus !== 'in_progress' ? (
          <ActivityItem
            icon={lastChannelSync.lastSyncStatus === 'success' ? CheckCircle : lastChannelSync.lastSyncStatus === 'partial' ? AlertCircle : XCircle}
            iconColor={lastChannelSync.lastSyncStatus === 'success' ? 'text-green-400' : lastChannelSync.lastSyncStatus === 'partial' ? 'text-yellow-400' : 'text-red-400'}
            label={`Channel sync — ${lastChannelSync.lastSyncStatus}`}
            sub={lastChannelSync.lastSyncStatus === 'success' ? `+${lastChannelSync.recordsAdded ?? 0} created, ${lastChannelSync.recordsUpdated ?? 0} updated` : lastChannelSync.errorMessage ?? undefined}
            time={relTime(lastChannelSync.lastSyncTime)}
          />
        ) : null}
        {embedStats && (
          <ActivityItem
            icon={embedStats.inventory.embedded >= embedStats.inventory.total && embedStats.inventory.total > 0 ? CheckCircle : RefreshCw}
            iconColor={embedStats.inventory.embedded >= embedStats.inventory.total && embedStats.inventory.total > 0 ? 'text-green-400' : 'text-purple-400'}
            label="Inventory search index"
            sub={`${embedStats.inventory.embedded.toLocaleString()} / ${embedStats.inventory.total.toLocaleString()} — ${embedStats.inventory.percentage}% embedded`}
          />
        )}
        {(isScanComplete || isScanFailed) && latestScan && (
          <ActivityItem
            icon={isScanComplete ? ((latestScan.totalPieces ?? 0) > 0 ? CheckCircle : AlertCircle) : XCircle}
            iconColor={isScanComplete ? ((latestScan.totalPieces ?? 0) > 0 ? 'text-green-400' : 'text-yellow-400') : 'text-red-400'}
            label={isScanComplete ? `BrickSpotter: ${latestScan.totalPieces ?? 0} pieces found` : 'BrickSpotter scan failed'}
            sub={isScanComplete && latestScan.estimatedValue && Number(latestScan.estimatedValue) > 0 ? `Est. ${formatCurrency(latestScan.estimatedValue)}` : isScanFailed ? 'Try again from Inventory tab' : undefined}
            onClick={onOpenBrickanalyzer}
          />
        )}
        {!latestScan && !isScanProcessing && (
          <ActivityItem icon={ScanSearch} iconColor="text-muted-foreground" label="No recent BrickSpotter scan" />
        )}
      </LaneSection>

    </LaneCard>
  );
}

// ── ORDERS LANE ───────────────────────────────────────────────────────────────

function OrdersLane({ stats, dashboardOrders, fulfillmentStats, orderSyncRunning, globalSyncStatuses, onItemClick, onOpenFulfillment }: any) {
  const pendingCount = fulfillmentStats?.unfulfilled ?? dashboardOrders?.pending?.length ?? 0;
  const lastOrderSync = globalSyncStatuses?.orders;
  const isOrderSyncing = orderSyncRunning?.running === true;

  const { data: activeOrdEmbed } = useQuery<{ id: string; status: string } | null>({
    queryKey: ['/api/embeddings/jobs/active/orders'],
    refetchInterval: 8000,
  });

  const { data: embedStats } = useQuery<{
    inventory: { embedded: number; total: number; percentage: string };
    orders: { embedded: number; total: number; percentage: string };
  }>({
    queryKey: ['/api/embeddings/stats'],
    refetchInterval: 10000,
  });

  const ordEmbedPct = embedStats && embedStats.orders.total > 0
    ? Math.round((embedStats.orders.embedded / embedStats.orders.total) * 100) : 0;

  const recentOrders: any[] = dashboardOrders?.recentShipments ?? [];
  const newOrders: any[] = dashboardOrders?.pending ?? [];
  const orderSyncFailed = lastOrderSync?.lastSyncStatus === 'failed' || lastOrderSync?.lastSyncStatus === 'error';

  const summary = stats
    ? `${pendingCount} to fulfill`
    : undefined;

  return (
    <LaneCard title="Orders" Icon={ShoppingCart} color="orange" summary={summary}>

      {/* Attention */}
      {(pendingCount > 0 || orderSyncFailed) ? (
        <LaneSection label="Attention">
          {pendingCount > 0 && (
            <AlertItem
              icon={ShoppingCart}
              iconColor="text-orange-400"
              label={`${pendingCount} order${pendingCount > 1 ? 's' : ''} to fulfill`}
              sub="Ready for packing & shipping"
              onClick={onOpenFulfillment}
              severity="warn"
            />
          )}
          {orderSyncFailed && (
            <AlertItem icon={XCircle} iconColor="text-red-400" label="Order sync failed" sub={lastOrderSync?.errorMessage ?? 'Check connection'} severity="error" />
          )}
        </LaneSection>
      ) : (
        <LaneSection><AllGood label="All orders handled" /></LaneSection>
      )}

      {/* Running */}
      {(isOrderSyncing || activeOrdEmbed) && (
        <LaneSection label="Running">
          {isOrderSyncing && (
            <div className="flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3 text-cyan-400 animate-spin shrink-0" />
              <span className="text-xs text-cyan-300 font-medium">Order sync running…</span>
            </div>
          )}
          {activeOrdEmbed && embedStats ? (
            <JobBar
              label="Order embedding"
              pct={ordEmbedPct}
              sublabel={`${embedStats.orders.embedded.toLocaleString()} / ${embedStats.orders.total.toLocaleString()} orders`}
              color="purple"
            />
          ) : activeOrdEmbed ? (
            <div className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-blue-400 animate-pulse shrink-0" />
              <span className="text-[10px] text-blue-400">Embedding order data…</span>
            </div>
          ) : null}
        </LaneSection>
      )}

      {/* Last Actions */}
      <LaneSection label="Last Actions" collapsible>
        {lastOrderSync?.lastSyncTime ? (
          <ActivityItem
            icon={lastOrderSync.lastSyncStatus === 'success' ? CheckCircle : lastOrderSync.lastSyncStatus === 'partial' ? AlertCircle : XCircle}
            iconColor={lastOrderSync.lastSyncStatus === 'success' ? 'text-green-400' : lastOrderSync.lastSyncStatus === 'partial' ? 'text-yellow-400' : 'text-red-400'}
            label={`Order sync — ${lastOrderSync.lastSyncStatus}`}
            sub={lastOrderSync.lastSyncStatus === 'success' ? `+${lastOrderSync.recordsAdded ?? 0} new orders` : lastOrderSync.errorMessage ?? undefined}
            time={relTime(lastOrderSync.lastSyncTime)}
          />
        ) : (
          <ActivityItem icon={Clock} iconColor="text-muted-foreground" label="No order sync yet" />
        )}
        {recentOrders.slice(0, 3).map((o) => (
          <ActivityItem
            key={o.id}
            icon={o.orderStatus === 'shipped' ? CheckCircle : ShoppingCart}
            iconColor={o.orderStatus === 'shipped' ? 'text-green-400' : 'text-orange-400'}
            label={`#${o.orderNumber} · ${o.customerUsername}`}
            sub={`${o.orderStatus} · ${formatCurrency(o.orderTotal)}`}
            time={relTime(o.orderDate)}
            onClick={() => onItemClick?.('order', o.id)}
          />
        ))}
        {recentOrders.length === 0 && newOrders.length === 0 && (
          <ActivityItem icon={Clock} iconColor="text-muted-foreground" label="No recent orders" />
        )}
        {embedStats && (
          <ActivityItem
            icon={embedStats.orders.embedded >= embedStats.orders.total && embedStats.orders.total > 0 ? CheckCircle : RefreshCw}
            iconColor={embedStats.orders.embedded >= embedStats.orders.total && embedStats.orders.total > 0 ? 'text-green-400' : 'text-purple-400'}
            label="Order search index"
            sub={`${embedStats.orders.embedded.toLocaleString()} / ${embedStats.orders.total.toLocaleString()} — ${embedStats.orders.percentage}% embedded`}
          />
        )}
      </LaneSection>

    </LaneCard>
  );
}


// ── SYSTEM PULSE STRIP ────────────────────────────────────────────────────────

export function SystemPulse({ setupItems, billingStatus, rateLimit, blApiCallLimit, onOpenSettings, children }: {
  setupItems: Array<{ id: string; label: string; section: 'general' | 'platforms' }>;
  billingStatus?: { plan: string; status: string; interval?: string | null; trialEndsAt?: string | null; subscriptionEndsAt?: string | null; brickspotter?: { scansUsed: number; scansLimit: number } } | null;
  rateLimit?: { allowed: boolean; callsLast24h: number; blocked?: boolean } | null;
  blApiCallLimit?: number;
  onOpenSettings?: (section: any) => void;
  children?: React.ReactNode;
}) {
  const planLabels: Record<string, string> = { trial: 'Trial', foundation: 'Foundation', core: 'Core', flagship: 'Flagship' };

  const trialDaysLeft = (() => {
    if (!billingStatus?.trialEndsAt) return null;
    const diff = new Date(billingStatus.trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  })();

  const renewalDateStr = (() => {
    const d = billingStatus?.subscriptionEndsAt;
    if (!d) return null;
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  })();

  const intervalLabel = billingStatus?.interval === 'annual' ? 'Annual' : billingStatus?.interval === 'monthly' ? 'Monthly' : null;

  const isTrial = billingStatus?.status === 'trial' || billingStatus?.plan === 'trial';
  const bs = billingStatus?.brickspotter;
  const bsLimited = bs && bs.scansLimit > 0;
  const bsNearLimit = bsLimited && bs.scansUsed >= Math.floor(bs.scansLimit * 0.8);
  const bsAtLimit = bsLimited && bs.scansUsed >= bs.scansLimit;

  const all = [
    ...setupItems.map((s) => ({ id: s.id, label: s.label, severity: 'info' as any, section: s.section, onClick: null })),
  ];

  const hasAlerts = all.length > 0;
  const hasPlanInfo = !!billingStatus;
  if (!hasAlerts && !hasPlanInfo && !children) return null;

  const trialSeverity = trialDaysLeft !== null && trialDaysLeft <= 3 ? 'error' : trialDaysLeft !== null && trialDaysLeft <= 7 ? 'warn' : null;

  const planSummary = billingStatus ? (
    <button
      onClick={() => onOpenSettings?.('billing')}
      className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
      data-testid="system-pulse-plan"
    >
      <span className="text-[10px] text-violet-300 font-semibold">
        {planLabels[billingStatus.plan] ?? billingStatus.plan}
      </span>
      {intervalLabel && !isTrial && (
        <span className="text-[9px] text-muted-foreground/70 bg-gray-800/60 rounded px-1 py-0.5 leading-none">
          {intervalLabel}
        </span>
      )}
    </button>
  ) : undefined;

  return (
    <LaneCard title="Your Plan" Icon={CreditCard} color="purple" summary={planSummary}>

      {(hasAlerts || (bsLimited && (bsNearLimit || bsAtLimit)) || (isTrial && trialDaysLeft !== null)) ? (
        <LaneSection label="Attention">
          {all.map((item) => (
            <AlertItem
              key={item.id}
              icon={item.severity === 'error' ? XCircle : item.severity === 'info' ? Settings : AlertCircle}
              iconColor={item.severity === 'error' ? 'text-red-400' : item.severity === 'info' ? 'text-blue-400' : 'text-yellow-400'}
              label={item.label}
              sub={item.section ? 'Tap to fix' : undefined}
              severity={item.severity}
              onClick={item.section ? () => onOpenSettings?.(item.section) : undefined}
            />
          ))}
          {bsLimited && (bsNearLimit || bsAtLimit) && (
            <AlertItem
              icon={ScanSearch}
              iconColor={bsAtLimit ? 'text-red-400' : 'text-yellow-400'}
              label={`BrickSpotter ${bsAtLimit ? 'limit reached' : 'near limit'}`}
              sub={`${bs.scansUsed} / ${bs.scansLimit} scans used`}
              severity={bsAtLimit ? 'error' : 'warn'}
              onClick={() => onOpenSettings?.('billing')}
            />
          )}
          {isTrial && trialDaysLeft !== null && (
            <AlertItem
              icon={Clock}
              iconColor={trialSeverity === 'error' ? 'text-red-400' : trialSeverity === 'warn' ? 'text-yellow-400' : 'text-muted-foreground'}
              label={trialDaysLeft === 0 ? 'Trial ending today' : `${trialDaysLeft} days left in trial`}
              sub="Upgrade to keep access"
              severity={trialSeverity ?? 'info'}
              onClick={() => onOpenSettings?.('billing')}
            />
          )}
        </LaneSection>
      ) : (
        <LaneSection><AllGood label="All systems normal" /></LaneSection>
      )}

      {children && (
        <LaneSection label="Communications">
          {children}
        </LaneSection>
      )}

    </LaneCard>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export default function GeneralDashboard({ onItemClick, onOpenFulfillment, onOpenBrickanalyzer, onOpenPriceomatic, onOpenSettings, panelMode }: GeneralDashboardProps) {

  const { data: stats } = useQuery<{ totalOrders: number; totalInventoryItems: number; totalInventoryQuantity: number; totalSales: number }>({
    queryKey: ['/api/dashboard/stats'],
  });

  const { data: dashboardOrders } = useQuery<{ pending: any[]; recentShipments: any[]; highValue: any[] }>({
    queryKey: ['/api/orders/dashboard'],
  });

  const { data: fulfillmentStats } = useQuery<{ unfulfilled: number }>({
    queryKey: ['/api/fulfillment/stats'],
  });

  const { data: pricingInsights } = useQuery<{ success: boolean; data: any }>({
    queryKey: ['/api/priceomatic/insights'],
  });

  const { data: deepSpaceData } = useQuery<{ success: boolean; keys: string[] }>({
    queryKey: ['/api/priceomatic/deep-space'],
    staleTime: 0,
  });
  const { data: futureMissionsData } = useQuery<{ success: boolean; keys: string[] }>({
    queryKey: ['/api/priceomatic/future-missions'],
    staleTime: 0,
  });
  const deepSpaceKeySet = new Set<string>(deepSpaceData?.keys ?? []);
  const futureMissionsKeySet = new Set<string>(futureMissionsData?.keys ?? []);

  const { data: pomStatus } = useQuery<{ success: boolean; data: any }>({
    queryKey: ['/api/sync/priceomatic/status'],
    refetchInterval: 5000,
    staleTime: 0,
  });

  const { data: invSyncProgress } = useQuery<{ status: string; currentStep: string; progress: number; details: any }>({
    queryKey: ['/api/sync/bricklink/progress'],
    refetchInterval: 3000,
    staleTime: 0,
  });

  const { data: orderSyncRunning } = useQuery<{ running: boolean }>({
    queryKey: ['/api/order-sync/running'],
    refetchInterval: 4000,
    staleTime: 0,
  });

  const { data: channelSyncRunning } = useQuery<{ running: boolean }>({
    queryKey: ['/api/channel-sync/running'],
    refetchInterval: 4000,
    staleTime: 0,
  });

  const { data: globalSyncStatuses } = useQuery<any>({
    queryKey: ['/api/sync/statuses'],
    refetchInterval: 15000,
  });

  const { data: syncStatus } = useQuery<any>({
    queryKey: ['/api/platform-sync/status'],
    refetchInterval: 30000,
  });

  const { data: latestScan } = useQuery<any>({
    queryKey: ['/api/brickanalyzer/scans/latest'],
    queryFn: async () => {
      const res = await fetch('/api/brickanalyzer/scans/latest', { credentials: 'include' });
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 5000,
    staleTime: 0,
  });

  const { data: appSettings } = useQuery<{ elfieMode?: string; bricklinkConsumerKey?: string | null; paypalClientId?: string | null; stripeSecretKey?: string | null; paypalConnectedViaEnv?: boolean; stripeConnectedViaEnv?: boolean; pomUnderpricedScore?: number; blApiCallLimit?: number }>({
    queryKey: ['/api/settings'],
  });

  const { data: orgData } = useQuery<{ address: string | null; phone: string | null; onboardingCompleted: boolean }>({
    queryKey: ['/api/org'],
  });


  const { data: billingStatus } = useQuery<{ plan: string; status: string; interval: string | null; trialEndsAt: string | null; subscriptionEndsAt: string | null; brickspotter: { scansUsed: number; scansLimit: number } }>({
    queryKey: ['/api/billing/status'],
    refetchInterval: 60000,
  });

  const { data: rateLimit } = useQuery<{ allowed: boolean; callsLast24h: number; blocked?: boolean }>({
    queryKey: ['/api/bricklink/rate-limit'],
    refetchInterval: 60000,
  });


  const underpricedThreshold = appSettings?.pomUnderpricedScore ?? 1.5;

  const setupItems: Array<{ id: string; label: string; section: 'general' | 'platforms' }> = [];
  if (orgData?.onboardingCompleted) {
    if (!orgData?.address) setupItems.push({ id: 'address', label: 'Add business address', section: 'general' });
    if (!appSettings?.bricklinkConsumerKey) setupItems.push({ id: 'bricklink', label: 'Connect BrickLink', section: 'platforms' });
    if (!appSettings?.paypalClientId && !appSettings?.paypalConnectedViaEnv) setupItems.push({ id: 'paypal', label: 'Connect PayPal', section: 'platforms' });
    if (!appSettings?.stripeSecretKey && !appSettings?.stripeConnectedViaEnv) setupItems.push({ id: 'stripe', label: 'Connect Stripe', section: 'platforms' });
  }

  return (
    <CompactModeProvider value={panelMode ?? false}>
    <div className={panelMode ? "flex flex-col p-2 h-full gap-1" : "p-3 md:p-4 lg:p-5 xl:p-6 space-y-4 md:space-y-4 xl:space-y-5"}>

      {/* System Pulse — only shows when there are errors or setup gaps (hidden in panelMode — rendered separately) */}
      {!panelMode && (
        <SystemPulse setupItems={setupItems} billingStatus={billingStatus} rateLimit={rateLimit} blApiCallLimit={appSettings?.blApiCallLimit} onOpenSettings={onOpenSettings}>
          <DashboardNotifications />
        </SystemPulse>
      )}

      {/* Ops Lanes */}
      <div className={panelMode ? "grid grid-cols-3 gap-3 items-stretch flex-1 min-h-0" : "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 md:gap-4 xl:gap-5 items-stretch"} data-testid="ops-lanes">

        {panelMode && (
          <SystemPulse setupItems={setupItems} billingStatus={billingStatus} rateLimit={rateLimit} blApiCallLimit={appSettings?.blApiCallLimit} onOpenSettings={onOpenSettings}>
            <DashboardNotifications />
          </SystemPulse>
        )}

        <InventoryLane
          stats={stats}
          globalSyncStatuses={globalSyncStatuses}
          invSyncProgress={invSyncProgress}
          pomStatus={pomStatus}
          pricingInsights={pricingInsights}
          underpricedThreshold={underpricedThreshold}
          deepSpaceKeys={deepSpaceKeySet}
          futureMissionsKeys={futureMissionsKeySet}
          channelSyncRunning={channelSyncRunning}
          syncStatus={syncStatus}
          latestScan={latestScan}
          onItemClick={onItemClick}
          onOpenBrickanalyzer={onOpenBrickanalyzer}
          onOpenPriceomatic={onOpenPriceomatic}
          onOpenSettings={onOpenSettings}
        />

        <OrdersLane
          stats={stats}
          dashboardOrders={dashboardOrders}
          fulfillmentStats={fulfillmentStats}
          orderSyncRunning={orderSyncRunning}
          globalSyncStatuses={globalSyncStatuses}
          onItemClick={onItemClick}
          onOpenFulfillment={onOpenFulfillment}
        />

      </div>
    </div>
    </CompactModeProvider>
  );
}

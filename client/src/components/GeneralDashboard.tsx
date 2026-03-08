import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import {
  Package, DollarSign, ShoppingCart, Globe, Brain,
  RefreshCw, CheckCircle, XCircle, AlertCircle, Loader2,
  ScanSearch, ArrowRight, Settings, AlertTriangle, Zap,
  TrendingDown, TrendingUp, Clock, Activity,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DashboardNotifications from "./DashboardNotifications";

interface GeneralDashboardProps {
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
  onOpenFulfillment?: () => void;
  onOpenBrickanalyzer?: () => void;
  onOpenSettings?: (section: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'users') => void;
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

function LaneCard({
  title, Icon, accent, children, summary,
}: {
  title: string;
  Icon: React.ElementType;
  accent: string;
  children: React.ReactNode;
  summary?: string;
}) {
  return (
    <div className={`flex flex-col rounded-lg border ${accent} bg-gray-900/60 overflow-hidden`}>
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${accent} bg-gray-900/80`}>
        <Icon className="w-4 h-4 shrink-0 opacity-80" />
        <span className="text-xs font-semibold uppercase tracking-widest">{title}</span>
        {summary && <span className="ml-auto text-[10px] text-muted-foreground font-normal truncate max-w-[120px]">{summary}</span>}
      </div>
      <div className="flex-1 flex flex-col divide-y divide-border/40 min-h-0">
        {children}
      </div>
    </div>
  );
}

function LaneSection({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2 space-y-1.5">
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
  return (
    <div
      onClick={onClick}
      className={`flex items-start gap-2 rounded border px-2 py-1.5 ${bg} ${onClick ? 'cursor-pointer hover-elevate' : ''}`}
    >
      <Icon className={`w-3 h-3 shrink-0 mt-0.5 ${iconColor}`} />
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
  stats, globalSyncStatuses, invSyncProgress, pomStatus, pricingInsights, onItemClick, onOpenBrickanalyzer, onOpenSettings,
}: any) {
  const lastInvSync = globalSyncStatuses?.inventory;
  const lastPom = globalSyncStatuses?.priceomatic;
  const isInvSyncing = invSyncProgress?.status === 'syncing';
  const isInvComplete = invSyncProgress?.status === 'complete';
  const isPomRunning = pomStatus?.data?.liveProgress?.active === true;
  const pomProgress = pomStatus?.data?.liveProgress;

  const { data: catalogStatus } = useQuery<{ catalog: number; confirmed: number; total: number }>({
    queryKey: ['/api/brickspotter/catalog-status'],
    refetchInterval: 10000,
  });

  const { data: activeInvEmbed } = useQuery<{ id: string; status: string } | null>({
    queryKey: ['/api/embeddings/jobs/active/inventory'],
    refetchInterval: 8000,
  });

  const hasRunningJobs = isInvSyncing || isPomRunning;
  const catalogPct = catalogStatus && catalogStatus.total > 0
    ? Math.round((catalogStatus.catalog / catalogStatus.total) * 100) : 0;

  const tooLowCount = pricingInsights?.data?.tooLow?.length ?? 0;
  const tooHighCount = pricingInsights?.data?.tooHigh?.length ?? 0;

  const invSyncFailed = lastInvSync?.lastSyncStatus === 'failed' || lastInvSync?.lastSyncStatus === 'error';
  const pomFailed = lastPom?.lastSyncStatus === 'failed' || lastPom?.lastSyncStatus === 'error';

  const summary = stats
    ? `${(stats.totalInventoryItems || 0).toLocaleString()} lots · ${(stats.totalInventoryQuantity || 0).toLocaleString()} pcs`
    : undefined;

  return (
    <LaneCard title="Inventory" Icon={Package} accent="border-cyan-800/40 text-cyan-300" summary={summary}>

      {/* Running Jobs */}
      {hasRunningJobs && (
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
          {activeInvEmbed && (
            <div className="flex items-center gap-1.5 px-1.5">
              <Activity className="w-3 h-3 text-blue-400 animate-pulse" />
              <span className="text-[10px] text-blue-400">Embedding inventory data…</span>
            </div>
          )}
        </LaneSection>
      )}

      {/* Last Actions */}
      <LaneSection label="Last Actions">
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
        {lastPom?.lastSyncTime ? (
          <ActivityItem
            icon={lastPom.lastSyncStatus === 'success' ? CheckCircle : lastPom.lastSyncStatus === 'partial' ? AlertCircle : XCircle}
            iconColor={lastPom.lastSyncStatus === 'success' ? 'text-green-400' : lastPom.lastSyncStatus === 'partial' ? 'text-yellow-400' : 'text-red-400'}
            label={`Price-o-Matic — ${lastPom.lastSyncStatus}`}
            sub={lastPom.lastSyncStatus === 'success' ? `${lastPom.recordsUpdated ?? 0} lots priced` : lastPom.errorMessage ?? undefined}
            time={relTime(lastPom.lastSyncTime)}
          />
        ) : (
          <ActivityItem icon={Clock} iconColor="text-muted-foreground" label="No Price-o-Matic run yet" />
        )}
        {catalogStatus && (
          <ActivityItem
            icon={ScanSearch}
            iconColor="text-purple-400"
            label={`CLIP catalog — ${catalogPct}% built`}
            sub={`${catalogStatus.catalog} / ${catalogStatus.total} parts embedded`}
          />
        )}
      </LaneSection>

      {/* Needs Attention */}
      {(invSyncFailed || pomFailed || tooLowCount > 0 || tooHighCount > 0) ? (
        <LaneSection label="Attention">
          {invSyncFailed && (
            <AlertItem icon={XCircle} iconColor="text-red-400" label="Inventory sync failed" sub={lastInvSync?.errorMessage ?? 'Check BrickLink connection'} onClick={() => onOpenSettings?.('platforms')} severity="error" />
          )}
          {pomFailed && (
            <AlertItem icon={XCircle} iconColor="text-red-400" label="Price-o-Matic failed" sub={lastPom?.errorMessage ?? 'Run manually from Settings'} onClick={() => onOpenSettings?.('automation')} severity="error" />
          )}
          {tooLowCount > 0 && (
            <AlertItem icon={TrendingDown} iconColor="text-orange-400" label={`${tooLowCount} items priced too low`} sub="Click a pricing item to view" onClick={() => onItemClick?.('inventory', 0)} severity="warn" />
          )}
        </LaneSection>
      ) : (
        <LaneSection><AllGood /></LaneSection>
      )}
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

  const recentOrders: any[] = dashboardOrders?.recentShipments ?? [];
  const newOrders: any[] = dashboardOrders?.pending ?? [];
  const orderSyncFailed = lastOrderSync?.lastSyncStatus === 'failed' || lastOrderSync?.lastSyncStatus === 'error';

  const summary = stats
    ? `${(stats.totalOrders || 0).toLocaleString()} total · ${pendingCount} to fulfill`
    : undefined;

  return (
    <LaneCard title="Orders" Icon={ShoppingCart} accent="border-orange-800/40 text-orange-300" summary={summary}>

      {/* Running */}
      {(isOrderSyncing || activeOrdEmbed) && (
        <LaneSection label="Running">
          {isOrderSyncing && (
            <div className="flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3 text-cyan-400 animate-spin shrink-0" />
              <span className="text-xs text-cyan-300 font-medium">Order sync running…</span>
            </div>
          )}
          {activeOrdEmbed && (
            <div className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-blue-400 animate-pulse shrink-0" />
              <span className="text-[10px] text-blue-400">Embedding order data…</span>
            </div>
          )}
        </LaneSection>
      )}

      {/* Last Actions */}
      <LaneSection label="Last Actions">
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
      </LaneSection>

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
    </LaneCard>
  );
}

// ── MULTICHANNEL LANE ─────────────────────────────────────────────────────────

function MultichannelLane({ channelSyncRunning, globalSyncStatuses, syncStatus, totalDiscrepancies, onOpenSettings }: any) {
  const isChannelSyncing = channelSyncRunning?.running === true;
  const lastChannelSync = globalSyncStatuses?.channel;
  const channelSyncFailed = lastChannelSync?.lastSyncStatus === 'failed' || lastChannelSync?.lastSyncStatus === 'error';

  const targets: any[] = syncStatus?.targets ?? [];
  const connectedChannels = targets.filter((t: any) => t.connected);
  const disconnectedChannels = targets.filter((t: any) => !t.connected);

  const summary = totalDiscrepancies > 0
    ? `${connectedChannels.length} channel${connectedChannels.length !== 1 ? 's' : ''} · ${totalDiscrepancies} misaligned`
    : connectedChannels.length > 0
      ? `${connectedChannels.length} channel${connectedChannels.length !== 1 ? 's' : ''} in sync`
      : 'No channels connected';

  return (
    <LaneCard title="Multichannel" Icon={Globe} accent="border-teal-800/40 text-teal-300" summary={summary}>

      {/* Running */}
      {isChannelSyncing && (
        <LaneSection label="Running">
          <div className="flex items-center gap-1.5">
            <RefreshCw className="w-3 h-3 text-teal-400 animate-spin shrink-0" />
            <span className="text-xs text-teal-300 font-medium">Channel sync running…</span>
          </div>
        </LaneSection>
      )}

      {/* Channel Status */}
      <LaneSection label="Channels">
        {connectedChannels.length > 0 ? connectedChannels.map((t: any) => {
          const disc = (t.discrepancies?.missingLots || 0) + (t.discrepancies?.priceDifferences || 0) + (t.discrepancies?.quantityDifferences || 0);
          return (
            <ActivityItem
              key={t.platform}
              icon={disc > 0 ? AlertTriangle : CheckCircle}
              iconColor={disc > 0 ? 'text-yellow-400' : 'text-green-400'}
              label={t.platform}
              sub={disc > 0 ? `${disc} discrepanc${disc !== 1 ? 'ies' : 'y'}` : 'In sync'}
            />
          );
        }) : (
          <ActivityItem icon={Globe} iconColor="text-muted-foreground" label="No channels connected" sub="Connect BrickOwl, eBay or Amazon" onClick={() => onOpenSettings?.('platforms')} />
        )}
        {disconnectedChannels.map((t: any, i: number) => (
          <AlertItem key={t.platform ?? `disconnected-${i}`} icon={XCircle} iconColor="text-red-400" label={`${t.platform} disconnected`} onClick={() => onOpenSettings?.('platforms')} severity="error" />
        ))}
      </LaneSection>

      {/* Last Actions */}
      <LaneSection label="Last Actions">
        {lastChannelSync?.lastSyncTime ? (
          <ActivityItem
            icon={lastChannelSync.lastSyncStatus === 'success' ? CheckCircle : lastChannelSync.lastSyncStatus === 'partial' ? AlertCircle : XCircle}
            iconColor={lastChannelSync.lastSyncStatus === 'success' ? 'text-green-400' : lastChannelSync.lastSyncStatus === 'partial' ? 'text-yellow-400' : 'text-red-400'}
            label={`Channel sync — ${lastChannelSync.lastSyncStatus}`}
            sub={lastChannelSync.lastSyncStatus === 'success' ? `${lastChannelSync.recordsUpdated ?? 0} items synced` : lastChannelSync.errorMessage ?? undefined}
            time={relTime(lastChannelSync.lastSyncTime)}
          />
        ) : (
          <ActivityItem icon={Clock} iconColor="text-muted-foreground" label="No channel sync yet" />
        )}
      </LaneSection>

      {/* Attention */}
      {(totalDiscrepancies > 0 || channelSyncFailed) ? (
        <LaneSection label="Attention">
          {totalDiscrepancies > 0 && (
            <AlertItem icon={AlertTriangle} iconColor="text-yellow-400" label={`${totalDiscrepancies} inventory discrepanc${totalDiscrepancies !== 1 ? 'ies' : 'y'}`} sub="Prices or quantities out of sync" severity="warn" />
          )}
          {channelSyncFailed && (
            <AlertItem icon={XCircle} iconColor="text-red-400" label="Channel sync failed" sub={lastChannelSync?.errorMessage ?? 'Check channel connections'} onClick={() => onOpenSettings?.('platforms')} severity="error" />
          )}
        </LaneSection>
      ) : connectedChannels.length > 0 ? (
        <LaneSection><AllGood label="All channels aligned" /></LaneSection>
      ) : null}
    </LaneCard>
  );
}

// ── AI INTELLIGENCE LANE ──────────────────────────────────────────────────────

function AIIntelligenceLane({ latestScan, appSettings, onOpenBrickanalyzer, dismissScanMutation }: any) {
  const elfieMode = (appSettings?.elfieMode as 'search' | 'ai') ?? 'search';

  const { data: universalCatalog } = useQuery<{
    queueSize: number; embedded: number; pending: number; noImage: number; failed: number; workerRunning: boolean;
  }>({
    queryKey: ['/api/brickspotter/universal-catalog/status'],
    refetchInterval: 8000,
  });

  const ucPct = universalCatalog && universalCatalog.queueSize > 0
    ? Math.round(((universalCatalog.embedded + universalCatalog.noImage) / universalCatalog.queueSize) * 100)
    : 0;

  const isScanProcessing = latestScan?.status === 'processing';
  const isScanComplete = latestScan?.status === 'complete';
  const isScanFailed = latestScan?.status === 'failed';

  const summary = `E.L.F.I.E. ${elfieMode === 'ai' ? 'AI' : 'Search'} mode`;

  return (
    <LaneCard title="AI Intelligence" Icon={Brain} accent="border-purple-800/40 text-purple-300" summary={summary}>

      {/* Running */}
      {(isScanProcessing || universalCatalog?.workerRunning) && (
        <LaneSection label="Running">
          {isScanProcessing && (
            <div className="flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 text-purple-400 animate-spin shrink-0" />
              <span className="text-xs text-purple-300 font-medium">Brick Spotter scanning…</span>
            </div>
          )}
          {universalCatalog?.workerRunning && (
            <JobBar
              label="Universal CLIP Catalog"
              pct={ucPct}
              sublabel={`${universalCatalog.embedded.toLocaleString()} / ${universalCatalog.queueSize.toLocaleString()} parts`}
              color="purple"
            />
          )}
        </LaneSection>
      )}

      {/* E.L.F.I.E. Status */}
      <LaneSection label="AI Assistant">
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${elfieMode === 'ai' ? 'bg-purple-500/20 border-purple-500/30 text-purple-300' : 'bg-gray-800/60 border-border text-muted-foreground'}`}>
            <Brain className="w-2.5 h-2.5" />
            <span>{elfieMode === 'ai' ? 'AI Mode' : 'Search Mode'}</span>
          </div>
        </div>
      </LaneSection>

      {/* Catalog Health */}
      {universalCatalog && (
        <LaneSection label="Universal Part Catalog">
          <ActivityItem
            icon={universalCatalog.workerRunning ? RefreshCw : CheckCircle}
            iconColor={universalCatalog.workerRunning ? 'text-purple-400' : 'text-green-400'}
            label={`${universalCatalog.embedded.toLocaleString()} parts embedded (${ucPct}%)`}
            sub={universalCatalog.pending > 0 ? `${universalCatalog.pending.toLocaleString()} pending` : universalCatalog.noImage > 0 ? `${universalCatalog.noImage.toLocaleString()} no image` : 'Catalog complete'}
          />
        </LaneSection>
      )}

      {/* Last Scan */}
      <LaneSection label="Last Scan">
        {isScanComplete && latestScan && (
          <ActivityItem
            icon={(latestScan.totalPieces ?? 0) > 0 ? CheckCircle : AlertCircle}
            iconColor={(latestScan.totalPieces ?? 0) > 0 ? 'text-green-400' : 'text-yellow-400'}
            label={`${latestScan.totalPieces ?? 0} pieces found`}
            sub={latestScan.estimatedValue && Number(latestScan.estimatedValue) > 0 ? `Est. ${formatCurrency(latestScan.estimatedValue)}` : undefined}
            onClick={(latestScan.totalPieces ?? 0) > 0 ? onOpenBrickanalyzer : undefined}
          />
        )}
        {isScanFailed && latestScan && (
          <ActivityItem icon={XCircle} iconColor="text-red-400" label="Last scan failed" sub="Try again from Inventory tab" onClick={onOpenBrickanalyzer} />
        )}
        {!latestScan && !isScanProcessing && (
          <ActivityItem icon={ScanSearch} iconColor="text-muted-foreground" label="No recent scan" sub="Use Brick Spotter from Inventory tab" />
        )}
      </LaneSection>

      {/* Attention */}
      {isScanComplete && (latestScan?.totalPieces ?? 0) > 0 && (
        <LaneSection label="Attention">
          <AlertItem
            icon={Zap}
            iconColor="text-purple-400"
            label="Scan results ready to view"
            sub="View before they expire"
            onClick={onOpenBrickanalyzer}
            severity="info"
          />
        </LaneSection>
      )}
    </LaneCard>
  );
}

// ── SYSTEM PULSE STRIP ────────────────────────────────────────────────────────

function SystemPulse({ syncErrors, setupItems, onOpenSettings }: {
  syncErrors: any[];
  setupItems: Array<{ id: string; label: string; section: 'general' | 'platforms' }>;
  onOpenSettings?: (section: any) => void;
}) {
  const all = [
    ...syncErrors.map((e) => ({ id: e.id, label: e.label + (e.status === 'partial' ? ' — partial' : ' — failed'), severity: e.status === 'partial' ? 'warn' : 'error' as any, section: null })),
    ...setupItems.map((s) => ({ id: s.id, label: s.label, severity: 'info' as any, section: s.section })),
  ];

  if (all.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-gray-900/70 border border-yellow-500/20" data-testid="system-pulse">
      <span className="text-[9px] uppercase tracking-widest text-yellow-400 font-semibold shrink-0">System</span>
      {all.map((item) => (
        <button
          key={item.id}
          onClick={() => item.section && onOpenSettings?.(item.section)}
          className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${
            item.severity === 'error' ? 'border-red-500/30 text-red-300 bg-red-950/30' :
            item.severity === 'info' ? 'border-blue-500/30 text-blue-300 bg-blue-950/30' :
            'border-yellow-500/30 text-yellow-300 bg-yellow-950/30'
          }`}
        >
          {item.severity === 'error' ? <XCircle className="w-2.5 h-2.5" /> : item.severity === 'info' ? <Settings className="w-2.5 h-2.5" /> : <AlertCircle className="w-2.5 h-2.5" />}
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export default function GeneralDashboard({ onItemClick, onOpenFulfillment, onOpenBrickanalyzer, onOpenSettings }: GeneralDashboardProps) {

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

  const { data: appSettings } = useQuery<{ elfieMode?: string; bricklinkConsumerKey?: string | null; paypalClientId?: string | null; stripeSecretKey?: string | null; paypalConnectedViaEnv?: boolean; stripeConnectedViaEnv?: boolean }>({
    queryKey: ['/api/settings'],
  });

  const { data: orgData } = useQuery<{ address: string | null; phone: string | null; onboardingCompleted: boolean }>({
    queryKey: ['/api/org'],
  });

  const { data: recentErrorsData } = useQuery<{ errors: any[] }>({
    queryKey: ['/api/sync/recent-errors'],
    refetchInterval: 30000,
    staleTime: 0,
  });

  const dismissScanMutation = useMutation({
    mutationFn: async (scanId: number) => {
      await fetch(`/api/brickanalyzer/scan/${scanId}`, { method: 'DELETE', credentials: 'include' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/brickanalyzer/scans/latest'] }),
  });

  const syncErrors = recentErrorsData?.errors ?? [];

  const setupItems: Array<{ id: string; label: string; section: 'general' | 'platforms' }> = [];
  if (orgData?.onboardingCompleted) {
    if (!orgData?.address) setupItems.push({ id: 'address', label: 'Add business address', section: 'general' });
    if (!appSettings?.bricklinkConsumerKey) setupItems.push({ id: 'bricklink', label: 'Connect BrickLink', section: 'platforms' });
    if (!appSettings?.paypalClientId && !appSettings?.paypalConnectedViaEnv) setupItems.push({ id: 'paypal', label: 'Connect PayPal', section: 'platforms' });
    if (!appSettings?.stripeSecretKey && !appSettings?.stripeConnectedViaEnv) setupItems.push({ id: 'stripe', label: 'Connect Stripe', section: 'platforms' });
  }

  const totalDiscrepancies = syncStatus?.targets?.reduce((total: number, platform: any) => {
    return total + (platform.discrepancies?.missingLots || 0) + (platform.discrepancies?.priceDifferences || 0) + (platform.discrepancies?.quantityDifferences || 0);
  }, 0) || 0;

  return (
    <div className="p-2 md:p-4 lg:p-5 space-y-3 md:space-y-4">

      {/* System Pulse — only shows when there are errors or setup gaps */}
      <SystemPulse syncErrors={syncErrors} setupItems={setupItems} onOpenSettings={onOpenSettings} />

      {/* Sync issue notifications (per-item detail feed) */}
      <DashboardNotifications />

      {/* Four Ops Lanes */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4" data-testid="ops-lanes">

        <InventoryLane
          stats={stats}
          globalSyncStatuses={globalSyncStatuses}
          invSyncProgress={invSyncProgress}
          pomStatus={pomStatus}
          pricingInsights={pricingInsights}
          onItemClick={onItemClick}
          onOpenBrickanalyzer={onOpenBrickanalyzer}
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

        <MultichannelLane
          channelSyncRunning={channelSyncRunning}
          globalSyncStatuses={globalSyncStatuses}
          syncStatus={syncStatus}
          totalDiscrepancies={totalDiscrepancies}
          onOpenSettings={onOpenSettings}
        />

        <AIIntelligenceLane
          latestScan={latestScan}
          appSettings={appSettings}
          onOpenBrickanalyzer={onOpenBrickanalyzer}
          dismissScanMutation={dismissScanMutation}
        />

      </div>

      {/* Revenue summary strip */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="summary-metrics">
          {[
            { label: 'Total Revenue', value: formatCurrency(stats.totalSales), Icon: TrendingUp, color: 'text-green-400' },
            { label: 'Total Orders', value: stats.totalOrders.toLocaleString(), Icon: ShoppingCart, color: 'text-orange-400' },
            { label: 'Inventory Lots', value: stats.totalInventoryItems.toLocaleString(), Icon: Package, color: 'text-cyan-400' },
            { label: 'Total Pieces', value: stats.totalInventoryQuantity.toLocaleString(), Icon: Activity, color: 'text-purple-400' },
          ].map(({ label, value, Icon, color }) => (
            <div key={label} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900/50 border border-border/60" data-testid={`metric-${label.toLowerCase().replace(/\s+/g, '-')}`}>
              <Icon className={`w-4 h-4 shrink-0 ${color}`} />
              <div>
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <p className={`text-sm font-semibold font-mono ${color}`}>{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

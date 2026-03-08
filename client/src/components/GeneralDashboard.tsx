import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import {
  Package, ShoppingCart, Globe, Brain,
  RefreshCw, CheckCircle, XCircle, AlertCircle, Loader2,
  ScanSearch, ArrowRight, Settings, AlertTriangle, Zap,
  TrendingDown, Clock, Activity, CreditCard,
} from "lucide-react";
import DashboardNotifications from "./DashboardNotifications";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface GeneralDashboardProps {
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
  onOpenFulfillment?: () => void;
  onOpenBrickanalyzer?: () => void;
  onOpenPriceomatic?: () => void;
  onOpenSettings?: (section: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'users' | 'billing') => void;
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
  const ringColor = severity === 'error' ? 'border-red-500' : severity === 'info' ? 'border-blue-400' : 'border-orange-400';
  return (
    <div
      onClick={onClick}
      className={`flex items-start gap-2 rounded border px-2 py-1.5 ${bg} ${onClick ? 'cursor-pointer hover-elevate' : ''}`}
    >
      <div className="relative shrink-0 mt-0.5 w-3 h-3 flex items-center justify-center">
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

// ── BRICKLINK API USAGE ───────────────────────────────────────────────────────
function BrickLinkApiSection({ rateLimit }: { rateLimit: any }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const BL_CEILING = 5000;
  const callsLast24h: number = rateLimit?.callsLast24h ?? 0;
  const buckets: { hourStart: string; rollsOffAt: string; calls: number }[] = rateLimit?.hourlyBuckets ?? [];
  const availableNow = Math.max(0, BL_CEILING - callsLast24h);
  const pct = Math.min(callsLast24h / BL_CEILING, 1);
  const maxCalls = Math.max(...buckets.map(b => b.calls), 1);

  const rolloffEvents = [...buckets]
    .filter(b => b.calls > 0)
    .sort((a, b) => new Date(a.rollsOffAt).getTime() - new Date(b.rollsOffAt).getTime());
  let cumFreed = 0;
  const schedule = rolloffEvents.map((b, idx) => {
    cumFreed += b.calls;
    const availableAfter = Math.min(BL_CEILING, availableNow + cumFreed);
    const prevAvail = idx === 0 ? availableNow : Math.min(BL_CEILING, availableNow + (cumFreed - b.calls));
    return { ...b, freed: b.calls, availableAfter, isFirstFull: availableAfter >= BL_CEILING && prevAvail < BL_CEILING };
  });
  const fullRestoreRow = schedule.find(s => s.isFirstFull);

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    const nowStr = new Date().toLocaleDateString('en-US');
    const dStr = d.toLocaleDateString('en-US');
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return dStr === nowStr ? time : `${time} tomorrow`;
  };
  const progressColor = pct >= 0.9 ? 'bg-red-500' : pct >= 0.6 ? 'bg-orange-500' : 'bg-blue-500';
  const barColor = (calls: number) => {
    if (calls === 0) return 'bg-muted/40';
    if (calls < BL_CEILING * 0.1) return 'bg-blue-500/70';
    if (calls < BL_CEILING * 0.3) return 'bg-orange-500/70';
    return 'bg-red-500/70';
  };
  const availColor = (avail: number) => {
    const r = avail / BL_CEILING;
    if (r >= 0.9) return 'text-emerald-400';
    if (r >= 0.5) return 'text-blue-400';
    if (r >= 0.25) return 'text-orange-400';
    return 'text-muted-foreground';
  };

  return (
    <div className="space-y-2 px-1.5 py-0.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className={`text-[11px] font-medium ${pct >= 0.9 ? 'text-red-400' : pct >= 0.6 ? 'text-orange-400' : 'text-emerald-400'}`}>
            {availableNow.toLocaleString()} free
          </span>
          <span className="text-[10px] text-muted-foreground"> · {callsLast24h.toLocaleString()}/{BL_CEILING.toLocaleString()} used</span>
        </div>
        {fullRestoreRow ? (
          <div className="text-right flex-shrink-0">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide leading-none">Full at</div>
            <div className="text-[10px] font-semibold text-emerald-400">{fmtTime(fullRestoreRow.rollsOffAt)}</div>
          </div>
        ) : availableNow >= BL_CEILING ? (
          <span className="text-[10px] text-emerald-400 font-semibold flex-shrink-0">Full quota</span>
        ) : null}
      </div>
      <div className="h-1 w-full rounded-full bg-muted/50">
        <div className={`h-full rounded-full transition-all ${progressColor}`} style={{ width: `${pct * 100}%` }} />
      </div>
      {buckets.length > 0 && (
        <div>
          <div className="flex items-end gap-px h-7" onMouseLeave={() => setHoveredIdx(null)}>
            {buckets.map((b, i) => {
              const height = b.calls === 0 ? 1 : Math.max(2, Math.round((b.calls / maxCalls) * 28));
              return (
                <div key={b.hourStart} className="flex-1 flex flex-col justify-end cursor-default" onMouseEnter={() => setHoveredIdx(i)}>
                  <div className={`w-full rounded-sm ${barColor(b.calls)} ${hoveredIdx === i ? 'opacity-100' : 'opacity-75'}`} style={{ height: `${height}px` }} />
                </div>
              );
            })}
          </div>
          {hoveredIdx !== null && buckets[hoveredIdx]?.calls > 0 && (
            <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
              {new Date(buckets[hoveredIdx].hourStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}:
              {' '}<span className="text-foreground">{buckets[hoveredIdx].calls.toLocaleString()} calls</span>
            </div>
          )}
        </div>
      )}
      {schedule.length > 0 && (
        <div className="space-y-px">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Recovery schedule</div>
          <div className="flex items-center justify-between px-1.5 py-0.5">
            <span className="text-[10px] text-muted-foreground">Now</span>
            <span className={`text-[10px] font-mono font-semibold ${availColor(availableNow)}`}>{availableNow.toLocaleString()} free</span>
          </div>
          {schedule.slice(0, 6).map(s => {
            const availRatio = s.availableAfter / BL_CEILING;
            return (
              <div key={s.hourStart} className={`relative rounded overflow-hidden px-1.5 py-0.5 ${s.isFirstFull ? 'ring-1 ring-emerald-500/40' : ''}`} style={{ backgroundColor: 'rgba(255,255,255,0.025)' }}>
                <div className="absolute left-0 top-0 bottom-0 rounded-sm pointer-events-none" style={{ width: `${Math.min(availRatio * 100, 100)}%`, backgroundColor: availRatio >= 0.9 ? 'rgba(16,185,129,0.09)' : availRatio >= 0.5 ? 'rgba(59,130,246,0.09)' : 'rgba(249,115,22,0.07)' }} />
                <div className="relative flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">{fmtTime(s.rollsOffAt)}</span>
                    {s.isFirstFull && <span className="text-[8px] font-bold text-emerald-400 uppercase tracking-wide">Full</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-muted-foreground/60 font-mono">+{s.freed.toLocaleString()}</span>
                    <span className={`text-[10px] font-mono font-semibold w-14 text-right ${availColor(s.availableAfter)}`}>{s.availableAfter.toLocaleString()} free</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {schedule.length === 0 && availableNow >= BL_CEILING && (
        <div className="text-[10px] text-emerald-400 text-center py-0.5">Full quota — ready anytime.</div>
      )}
    </div>
  );
}

// ── INVENTORY LANE ────────────────────────────────────────────────────────────

function InventoryLane({
  stats, globalSyncStatuses, invSyncProgress, pomStatus, pricingInsights, underpricedThreshold, onItemClick, onOpenBrickanalyzer, onOpenPriceomatic, onOpenSettings,
}: any) {
  const lastInvSync = globalSyncStatuses?.inventory;
  const lastPom = globalSyncStatuses?.priceomatic;
  const isInvSyncing = invSyncProgress?.status === 'syncing';
  const isInvComplete = invSyncProgress?.status === 'complete';
  const isPomRunning = pomStatus?.data?.liveProgress?.active === true;
  const pomProgress = pomStatus?.data?.liveProgress;

  const { data: activeInvEmbed } = useQuery<{ id: string; status: string } | null>({
    queryKey: ['/api/embeddings/jobs/active/inventory'],
    refetchInterval: 8000,
  });

  const hasRunningJobs = isInvSyncing || isPomRunning;

  const threshold = underpricedThreshold ?? 1.5;
  const tooHighCount = pricingInsights?.data?.tooHigh?.length ?? 0;
  const highOpportunityItems: any[] = (pricingInsights?.data?.tooLow ?? []).filter(
    (i: any) => (i.opportunityScore ?? 0) >= threshold
  );
  const highOpportunityCount = highOpportunityItems.length;

  const invSyncFailed = lastInvSync?.lastSyncStatus === 'failed' || lastInvSync?.lastSyncStatus === 'error';
  const pomFailed = lastPom?.lastSyncStatus === 'failed' || lastPom?.lastSyncStatus === 'error';

  const summary = stats
    ? `${(stats.totalInventoryItems || 0).toLocaleString()} lots · ${(stats.totalInventoryQuantity || 0).toLocaleString()} pcs`
    : undefined;

  return (
    <LaneCard title="Inventory" Icon={Package} accent="border-cyan-800/40 text-cyan-300" summary={summary}>

      {/* Needs Attention */}
      {(invSyncFailed || pomFailed || highOpportunityCount > 0 || tooHighCount > 0) ? (
        <LaneSection label="Attention">
          {invSyncFailed && (
            <AlertItem icon={XCircle} iconColor="text-red-400" label="Inventory sync failed" sub={lastInvSync?.errorMessage ?? 'Check BrickLink connection'} onClick={() => onOpenSettings?.('platforms')} severity="error" />
          )}
          {pomFailed && (
            <AlertItem icon={XCircle} iconColor="text-red-400" label="Price-o-Matic failed" sub={lastPom?.errorMessage ?? 'Run manually from Settings'} onClick={() => onOpenSettings?.('automation')} severity="error" />
          )}
          {highOpportunityCount > 0 && (
            <AlertItem icon={TrendingDown} iconColor="text-orange-400" label={`${highOpportunityCount} items underpriced (score > 2.3x)`} sub="Open Price-o-Matic to review" onClick={onOpenPriceomatic} severity="warn" />
          )}
        </LaneSection>
      ) : (
        <LaneSection><AllGood /></LaneSection>
      )}

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

  const recentOrders: any[] = dashboardOrders?.recentShipments ?? [];
  const newOrders: any[] = dashboardOrders?.pending ?? [];
  const orderSyncFailed = lastOrderSync?.lastSyncStatus === 'failed' || lastOrderSync?.lastSyncStatus === 'error';

  const summary = stats
    ? `${(stats.totalOrders || 0).toLocaleString()} total · ${pendingCount} to fulfill`
    : undefined;

  return (
    <LaneCard title="Orders" Icon={ShoppingCart} accent="border-orange-800/40 text-orange-300" summary={summary}>

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

    </LaneCard>
  );
}

// ── MULTICHANNEL LANE ─────────────────────────────────────────────────────────

function MultichannelLane({ channelSyncRunning, globalSyncStatuses, syncStatus, totalDiscrepancies, onOpenSettings }: any) {
  const isChannelSyncing = channelSyncRunning?.running === true;
  const lastChannelSync = globalSyncStatuses?.channel;
  const channelSyncFailed = lastChannelSync?.lastSyncStatus === 'failed' || lastChannelSync?.lastSyncStatus === 'error';

  const targets: any[] = syncStatus?.targets ?? [];
  const connectedChannels = targets.filter((t: any) => t.enabled ?? t.connected);
  const disconnectedChannels = targets.filter((t: any) => !(t.enabled ?? t.connected));

  const summary = totalDiscrepancies > 0
    ? `${connectedChannels.length} channel${connectedChannels.length !== 1 ? 's' : ''} · ${totalDiscrepancies} misaligned`
    : connectedChannels.length > 0
      ? `${connectedChannels.length} channel${connectedChannels.length !== 1 ? 's' : ''} in sync`
      : 'No channels connected';

  return (
    <LaneCard title="Multichannel" Icon={Globe} accent="border-teal-800/40 text-teal-300" summary={summary}>

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
          const channelName = t.name ?? t.platform ?? 'Unknown channel';
          return (
            <ActivityItem
              key={channelName}
              icon={disc > 0 ? AlertTriangle : CheckCircle}
              iconColor={disc > 0 ? 'text-yellow-400' : 'text-green-400'}
              label={channelName}
              sub={disc > 0 ? `${disc} discrepanc${disc !== 1 ? 'ies' : 'y'}` : 'In sync'}
            />
          );
        }) : (
          <ActivityItem icon={Globe} iconColor="text-muted-foreground" label="No channels connected" sub="Connect BrickOwl, eBay or Amazon" onClick={() => onOpenSettings?.('platforms')} />
        )}
        {disconnectedChannels.map((t: any, i: number) => {
          const channelName = t.name ?? t.platform ?? 'Unknown channel';
          return (
            <AlertItem key={channelName ?? `disconnected-${i}`} icon={XCircle} iconColor="text-red-400" label={`${channelName} disconnected`} onClick={() => onOpenSettings?.('platforms')} severity="error" />
          );
        })}
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

  const { data: embedStats } = useQuery<{
    inventory: { embedded: number; total: number; percentage: string };
    orders: { embedded: number; total: number; percentage: string };
  }>({
    queryKey: ['/api/embeddings/stats'],
    refetchInterval: 30000,
  });

  const { data: catalogStatus } = useQuery<{ catalog: number; confirmed: number; total: number }>({
    queryKey: ['/api/brickspotter/catalog-status'],
    refetchInterval: 10000,
  });

  const ucPct = universalCatalog && universalCatalog.queueSize > 0
    ? Math.round(((universalCatalog.embedded + universalCatalog.noImage) / universalCatalog.queueSize) * 100)
    : 0;

  const catalogPct = catalogStatus && catalogStatus.total > 0
    ? Math.round((catalogStatus.catalog / catalogStatus.total) * 100) : 0;

  const isScanProcessing = latestScan?.status === 'processing';
  const isScanComplete = latestScan?.status === 'complete';
  const isScanFailed = latestScan?.status === 'failed';

  const summary = `E.L.F.I.E. ${elfieMode === 'ai' ? 'AI' : 'Search'} mode`;

  return (
    <LaneCard title="AI Intelligence" Icon={Brain} accent="border-purple-800/40 text-purple-300" summary={summary}>

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

      {/* Data Embeddings — catalogs + inventory/orders */}
      {(universalCatalog || catalogStatus || embedStats) && (
        <LaneSection label="Data Embeddings">
          {universalCatalog && (
            <ActivityItem
              icon={universalCatalog.workerRunning ? RefreshCw : CheckCircle}
              iconColor={universalCatalog.workerRunning ? 'text-purple-400' : 'text-green-400'}
              label={`Universal catalog — ${universalCatalog.embedded.toLocaleString()} parts (${ucPct}%)`}
              sub={universalCatalog.pending > 0 ? `${universalCatalog.pending.toLocaleString()} pending` : universalCatalog.noImage > 0 ? `${universalCatalog.noImage.toLocaleString()} no image` : 'Catalog complete'}
            />
          )}
          {catalogStatus && (
            <ActivityItem
              icon={ScanSearch}
              iconColor="text-purple-400"
              label={`CLIP parts catalog — ${catalogPct}% built`}
              sub={`${catalogStatus.catalog} / ${catalogStatus.total} parts embedded`}
            />
          )}
          {embedStats && (
            <>
              <ActivityItem
                icon={embedStats.inventory.embedded >= embedStats.inventory.total && embedStats.inventory.total > 0 ? CheckCircle : RefreshCw}
                iconColor={embedStats.inventory.embedded >= embedStats.inventory.total && embedStats.inventory.total > 0 ? 'text-green-400' : 'text-purple-400'}
                label={`${embedStats.inventory.embedded.toLocaleString()} / ${embedStats.inventory.total.toLocaleString()} inventory items`}
                sub={`${embedStats.inventory.percentage}% embedded`}
              />
              <ActivityItem
                icon={embedStats.orders.embedded >= embedStats.orders.total && embedStats.orders.total > 0 ? CheckCircle : RefreshCw}
                iconColor={embedStats.orders.embedded >= embedStats.orders.total && embedStats.orders.total > 0 ? 'text-green-400' : 'text-purple-400'}
                label={`${embedStats.orders.embedded.toLocaleString()} / ${embedStats.orders.total.toLocaleString()} orders`}
                sub={`${embedStats.orders.percentage}% embedded`}
              />
            </>
          )}
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

    </LaneCard>
  );
}

// ── SYSTEM PULSE STRIP ────────────────────────────────────────────────────────

function SystemPulse({ syncErrors, setupItems, billingStatus, rateLimit, onOpenSettings }: {
  syncErrors: any[];
  setupItems: Array<{ id: string; label: string; section: 'general' | 'platforms' }>;
  billingStatus?: { plan: string; status: string; trialEndsAt?: string | null; brickspotter?: { scansUsed: number; scansLimit: number } } | null;
  rateLimit?: { allowed: boolean; callsLast24h: number; blocked?: boolean } | null;
  onOpenSettings?: (section: any) => void;
}) {
  const planLabels: Record<string, string> = { trial: 'Trial', foundation: 'Foundation', core: 'Core', flagship: 'Flagship' };

  const trialDaysLeft = (() => {
    if (!billingStatus?.trialEndsAt) return null;
    const diff = new Date(billingStatus.trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  })();

  const isTrial = billingStatus?.status === 'trial' || billingStatus?.plan === 'trial';
  const bs = billingStatus?.brickspotter;
  const bsLimited = bs && bs.scansLimit > 0;
  const bsNearLimit = bsLimited && bs.scansUsed >= Math.floor(bs.scansLimit * 0.8);
  const bsAtLimit = bsLimited && bs.scansUsed >= bs.scansLimit;

  const all = [
    ...syncErrors.map((e) => ({ id: e.id, label: e.label + (e.status === 'partial' ? ' — partial' : ' — failed'), severity: e.status === 'partial' ? 'warn' : 'error' as any, section: null, onClick: null })),
    ...setupItems.map((s) => ({ id: s.id, label: s.label, severity: 'info' as any, section: s.section, onClick: null })),
  ];

  const BL_CEILING = 5000;
  const blCalls = rateLimit?.callsLast24h ?? 0;

  const hasAlerts = all.length > 0;
  const hasPlanInfo = !!billingStatus;
  const hasBlData = rateLimit != null;
  if (!hasAlerts && !hasPlanInfo && !hasBlData) return null;

  const trialSeverity = trialDaysLeft !== null && trialDaysLeft <= 3 ? 'error' : trialDaysLeft !== null && trialDaysLeft <= 7 ? 'warn' : null;

  return (
    <div className="rounded-lg border border-gray-800/60 bg-gray-900/60 overflow-hidden" data-testid="system-pulse">
      {/* Header — plan name right-aligned */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800/40 bg-gray-900/80">
        <CreditCard className="w-4 h-4 shrink-0 text-violet-400 opacity-80" />
        <span className="text-xs font-semibold uppercase tracking-widest">Your Plan</span>
        {billingStatus && (
          <button
            onClick={() => onOpenSettings?.('billing')}
            className="ml-auto text-[10px] text-violet-300 font-medium hover:text-violet-200 transition-colors"
            data-testid="system-pulse-plan"
          >
            {planLabels[billingStatus.plan] ?? billingStatus.plan}
          </button>
        )}
      </div>

      {/* Rows — one per status item, matching ActivityItem / AlertItem style */}
      <div className="flex flex-col divide-y divide-border/40">

        {/* ── Attention items first ── */}

        {/* Sync errors and setup items */}
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

        {/* BrickSpotter scan quota */}
        {bsLimited && (bsNearLimit || bsAtLimit) && (
          <div
            onClick={() => onOpenSettings?.('billing')}
            className="flex items-start gap-2 rounded px-3 py-1.5 cursor-pointer hover-elevate"
            data-testid="system-pulse-brickspotter"
          >
            <ScanSearch className={`w-3 h-3 shrink-0 mt-0.5 ${bsAtLimit ? 'text-red-400' : 'text-yellow-400'}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-xs leading-tight truncate ${bsAtLimit ? 'text-red-300' : 'text-yellow-300'}`}>
                BrickSpotter {bsAtLimit ? 'limit reached' : 'near limit'}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">{bs.scansUsed} / {bs.scansLimit} scans used</p>
            </div>
            <ArrowRight className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" />
          </div>
        )}

        {/* Trial countdown */}
        {isTrial && trialDaysLeft !== null && (
          <div
            onClick={() => onOpenSettings?.('billing')}
            className="flex items-start gap-2 rounded px-3 py-1.5 cursor-pointer hover-elevate"
            data-testid="system-pulse-trial"
          >
            <Clock className={`w-3 h-3 shrink-0 mt-0.5 ${trialSeverity === 'error' ? 'text-red-400' : trialSeverity === 'warn' ? 'text-yellow-400' : 'text-muted-foreground'}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-xs leading-tight truncate ${trialSeverity === 'error' ? 'text-red-300' : trialSeverity === 'warn' ? 'text-yellow-300' : 'text-foreground'}`}>
                {trialDaysLeft === 0 ? 'Trial ending today' : `${trialDaysLeft} days left in trial`}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">Upgrade to keep access</p>
            </div>
            <ArrowRight className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" />
          </div>
        )}

        {/* ── Informational items last ── */}

        {/* BrickLink API usage — opens detail popover */}
        {rateLimit != null && (
          <Popover>
            <PopoverTrigger asChild>
              <div
                className="flex items-start gap-2 rounded px-3 py-1.5 cursor-pointer hover-elevate"
                data-testid="system-pulse-bl-api"
              >
                <Activity className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground leading-tight truncate">BrickLink API</p>
                  <p className="text-[10px] text-muted-foreground truncate">{blCalls.toLocaleString()} / {BL_CEILING.toLocaleString()} calls (24h)</p>
                </div>
                <ArrowRight className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" />
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3" align="start">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">BrickLink API Usage</div>
              <BrickLinkApiSection rateLimit={rateLimit} />
            </PopoverContent>
          </Popover>
        )}

        {/* Placeholder only when nothing at all is shown */}
        {!hasAlerts && !(bsLimited && (bsNearLimit || bsAtLimit)) && !(isTrial && trialDaysLeft !== null) && !hasBlData && (
          <AllGood label="All systems normal" />
        )}

      </div>
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export default function GeneralDashboard({ onItemClick, onOpenFulfillment, onOpenBrickanalyzer, onOpenPriceomatic, onOpenSettings }: GeneralDashboardProps) {

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

  const { data: appSettings } = useQuery<{ elfieMode?: string; bricklinkConsumerKey?: string | null; paypalClientId?: string | null; stripeSecretKey?: string | null; paypalConnectedViaEnv?: boolean; stripeConnectedViaEnv?: boolean; pomUnderpricedScore?: number }>({
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

  const { data: billingStatus } = useQuery<{ plan: string; status: string; trialEndsAt: string | null; brickspotter: { scansUsed: number; scansLimit: number } }>({
    queryKey: ['/api/billing/status'],
    refetchInterval: 60000,
  });

  const { data: rateLimit } = useQuery<{ allowed: boolean; callsLast24h: number; blocked?: boolean }>({
    queryKey: ['/api/bricklink/rate-limit'],
    refetchInterval: 60000,
  });

  const dismissScanMutation = useMutation({
    mutationFn: async (scanId: number) => {
      await fetch(`/api/brickanalyzer/scan/${scanId}`, { method: 'DELETE', credentials: 'include' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/brickanalyzer/scans/latest'] }),
  });

  const syncErrors = recentErrorsData?.errors ?? [];
  const underpricedThreshold = appSettings?.pomUnderpricedScore ?? 1.5;

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
      <SystemPulse syncErrors={syncErrors} setupItems={setupItems} billingStatus={billingStatus} rateLimit={rateLimit} onOpenSettings={onOpenSettings} />

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
          underpricedThreshold={underpricedThreshold}
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
    </div>
  );
}

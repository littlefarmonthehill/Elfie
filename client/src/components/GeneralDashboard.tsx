import { useQuery } from "@tanstack/react-query";
import {
  Package, ShoppingCart, TrendingUp, Users,
  RefreshCw, CheckCircle, XCircle, AlertCircle, Loader2,
  ScanSearch, ArrowRight, Settings, AlertTriangle, Zap,
  TrendingDown, Clock, Activity, CreditCard, ChevronRight,
  Sparkles, Globe, Boxes, Megaphone,
} from "lucide-react";
import DashboardNotifications from "./DashboardNotifications";
import { cn } from "@/lib/utils";

interface GeneralDashboardProps {
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
  onOpenFulfillment?: () => void;
  onOpenBrickanalyzer?: () => void;
  onOpenPriceomatic?: () => void;
  onOpenSettings?: (section: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'users' | 'billing') => void;
  onNavigate?: (tab: 'inventory' | 'orders' | 'sales' | 'marketing') => void;
}

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

function MetricTile({ label, value, sub, Icon, color, onClick }: {
  label: string; value: string; sub?: string; Icon: React.ElementType; color: string; onClick?: () => void;
}) {
  const colorMap: Record<string, { bg: string; icon: string; border: string; glow: string }> = {
    blue:   { bg: 'from-blue-950/40 to-blue-950/20', icon: 'text-blue-400', border: 'border-blue-500/30', glow: '0 0 20px rgba(59,130,246,0.1)' },
    orange: { bg: 'from-orange-950/40 to-orange-950/20', icon: 'text-orange-400', border: 'border-orange-500/30', glow: '0 0 20px rgba(249,115,22,0.1)' },
    green:  { bg: 'from-green-950/40 to-green-950/20', icon: 'text-green-400', border: 'border-green-500/30', glow: '0 0 20px rgba(34,197,94,0.1)' },
    red:    { bg: 'from-red-950/40 to-red-950/20', icon: 'text-red-400', border: 'border-red-500/30', glow: '0 0 20px rgba(239,68,68,0.1)' },
    purple: { bg: 'from-purple-950/40 to-purple-950/20', icon: 'text-purple-400', border: 'border-purple-500/30', glow: '0 0 20px rgba(168,85,247,0.1)' },
    yellow: { bg: 'from-yellow-950/40 to-yellow-950/20', icon: 'text-yellow-400', border: 'border-yellow-500/30', glow: '0 0 20px rgba(234,179,8,0.1)' },
  };
  const c = colorMap[color] ?? colorMap.blue;

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex flex-col gap-1 rounded-lg border p-3 md:p-4 text-left transition-all",
        "bg-gradient-to-br to-gray-900/80",
        c.bg, c.border,
        onClick && "hover-elevate active-elevate-2 cursor-pointer"
      )}
      style={{ boxShadow: c.glow }}
      data-testid={`metric-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</span>
        <Icon className={cn("w-3.5 h-3.5 md:w-4 md:h-4 shrink-0", c.icon)} />
      </div>
      <span className="text-lg md:text-2xl font-bold font-mono text-foreground">{value}</span>
      {sub && <span className="text-[10px] md:text-xs text-muted-foreground">{sub}</span>}
    </button>
  );
}

function QuickActionCard({ label, sub, Icon, color, onClick }: {
  label: string; sub: string; Icon: React.ElementType; color: string; onClick?: () => void;
}) {
  const colorMap: Record<string, { bg: string; icon: string; border: string; iconBg: string }> = {
    blue:   { bg: 'from-blue-950/30', icon: 'text-blue-300', border: 'border-blue-500/25', iconBg: 'bg-blue-900/60 ring-blue-500/40' },
    orange: { bg: 'from-orange-950/30', icon: 'text-orange-300', border: 'border-orange-500/25', iconBg: 'bg-orange-900/60 ring-orange-500/40' },
    green:  { bg: 'from-green-950/30', icon: 'text-green-300', border: 'border-green-500/25', iconBg: 'bg-green-900/60 ring-green-500/40' },
    yellow: { bg: 'from-yellow-950/30', icon: 'text-yellow-300', border: 'border-yellow-500/25', iconBg: 'bg-yellow-900/60 ring-yellow-500/40' },
  };
  const c = colorMap[color] ?? colorMap.blue;

  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 rounded-lg border p-3 md:p-4 text-left transition-all",
        "bg-gradient-to-r to-gray-900/80",
        c.bg, c.border,
        "hover-elevate active-elevate-2 cursor-pointer"
      )}
      data-testid={`action-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className={cn("p-2 rounded-md ring-1 shrink-0", c.iconBg)}>
        <Icon className={cn("w-4 h-4 md:w-5 md:h-5", c.icon)} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm md:text-base font-semibold text-foreground">{label}</p>
        <p className="text-[10px] md:text-xs text-muted-foreground truncate">{sub}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform" />
    </button>
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
          <RefreshCw className={cn("w-3 h-3 shrink-0 animate-spin", textColor)} />
          <span className={cn("text-xs font-medium", textColor)}>{label}</span>
        </div>
        <span className={cn("text-[10px] font-mono", textColor)}>{Math.round(pct)}%</span>
      </div>
      <div className={cn("h-1.5 w-full rounded-full overflow-hidden", trackColor)}>
        <div className={cn("h-full rounded-full transition-all duration-500", barColor)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      {sublabel && <p className="text-[10px] text-muted-foreground truncate">{sublabel}</p>}
    </div>
  );
}

function AlertRow({ icon: Icon, iconColor, label, sub, onClick, severity = 'warn' }: {
  icon: React.ElementType; iconColor: string; label: string; sub?: string; onClick?: () => void; severity?: 'warn' | 'error' | 'info';
}) {
  const bg = severity === 'error' ? 'bg-red-950/30 border-red-500/20' : severity === 'info' ? 'bg-blue-950/30 border-blue-500/20' : 'bg-yellow-950/30 border-yellow-500/20';
  return (
    <div
      onClick={onClick}
      className={cn("flex items-center gap-2.5 rounded-lg border px-3 py-2", bg, onClick && "cursor-pointer hover-elevate")}
      data-testid={`alert-${label.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}`}
    >
      <Icon className={cn("w-4 h-4 shrink-0", iconColor)} />
      <div className="flex-1 min-w-0">
        <p className="text-xs md:text-sm font-medium leading-tight truncate">{label}</p>
        {sub && <p className="text-[10px] md:text-xs text-muted-foreground truncate">{sub}</p>}
      </div>
      {onClick && <ArrowRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
    </div>
  );
}

function OpAreaRow({ label, Icon, color, lastSync, syncOk, alerts, onClick, stat, children }: {
  label: string; Icon: React.ElementType; color: string; lastSync: string | null; syncOk: boolean;
  alerts: Array<{ id: string; icon: React.ElementType; iconColor: string; label: string; sub?: string; severity: 'warn' | 'error' | 'info'; onClick?: () => void }>;
  onClick?: () => void; stat?: string; children?: React.ReactNode;
}) {
  const colorMap: Record<string, { icon: string; dot: string }> = {
    blue:   { icon: 'text-blue-400', dot: 'bg-blue-400' },
    orange: { icon: 'text-orange-400', dot: 'bg-orange-400' },
    green:  { icon: 'text-green-400', dot: 'bg-green-400' },
    purple: { icon: 'text-purple-400', dot: 'bg-purple-400' },
    red:    { icon: 'text-red-400', dot: 'bg-red-400' },
  };
  const c = colorMap[color] ?? colorMap.blue;
  const childArr = Array.isArray(children) ? children : [children];
  const hasChildren = childArr.some(c => c !== null && c !== undefined && c !== false);
  const hasContent = alerts.length > 0 || hasChildren;

  return (
    <div data-testid={`ops-area-${label.toLowerCase()}`}>
      <button
        onClick={onClick}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover-elevate active-elevate-2 transition-all group"
      >
        <Icon className={cn("w-4 h-4 shrink-0", c.icon)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{label}</span>
            {alerts.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-yellow-500/15 text-yellow-400 font-medium">
                <AlertTriangle className="w-2.5 h-2.5" />
                {alerts.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {stat && <span className="text-[10px] text-muted-foreground">{stat}</span>}
            {lastSync && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", syncOk ? 'bg-green-500' : 'bg-red-500')} />
                {lastSync}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform" />
      </button>
      {hasContent && (
        <div className="px-4 pb-3 space-y-2 ml-7">
          {alerts.map((a) => (
            <AlertRow key={a.id} icon={a.icon} iconColor={a.iconColor} label={a.label} sub={a.sub} severity={a.severity} onClick={a.onClick} />
          ))}
          {children}
        </div>
      )}
    </div>
  );
}

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

  const isTrial = billingStatus?.status === 'trial' || billingStatus?.plan === 'trial';
  const bs = billingStatus?.brickspotter;
  const bsLimited = bs && bs.scansLimit > 0;
  const bsNearLimit = bsLimited && bs.scansUsed >= Math.floor(bs.scansLimit * 0.8);
  const bsAtLimit = bsLimited && bs.scansUsed >= bs.scansLimit;

  const trialSeverity = trialDaysLeft !== null && trialDaysLeft <= 3 ? 'error' : trialDaysLeft !== null && trialDaysLeft <= 7 ? 'warn' : null;

  const alerts: Array<{ id: string; icon: React.ElementType; iconColor: string; label: string; sub?: string; severity: 'warn' | 'error' | 'info'; onClick?: () => void }> = [];

  for (const s of setupItems) {
    alerts.push({ id: s.id, icon: Settings, iconColor: 'text-blue-400', label: s.label, sub: 'Tap to fix', severity: 'info', onClick: () => onOpenSettings?.(s.section) });
  }
  if (bsLimited && (bsNearLimit || bsAtLimit)) {
    alerts.push({ id: 'bs-limit', icon: ScanSearch, iconColor: bsAtLimit ? 'text-red-400' : 'text-yellow-400', label: `BrickSpotter ${bsAtLimit ? 'limit reached' : 'near limit'}`, sub: `${bs.scansUsed} / ${bs.scansLimit} scans used`, severity: bsAtLimit ? 'error' : 'warn', onClick: () => onOpenSettings?.('billing') });
  }
  if (isTrial && trialDaysLeft !== null) {
    alerts.push({ id: 'trial', icon: Clock, iconColor: trialSeverity === 'error' ? 'text-red-400' : trialSeverity === 'warn' ? 'text-yellow-400' : 'text-muted-foreground', label: trialDaysLeft === 0 ? 'Trial ending today' : `${trialDaysLeft} days left in trial`, sub: 'Upgrade to keep access', severity: trialSeverity ?? 'info', onClick: () => onOpenSettings?.('billing') });
  }

  if (alerts.length === 0 && !children) return null;

  return (
    <div className="space-y-2" data-testid="section-system-pulse">
      {alerts.map((a) => (
        <AlertRow key={a.id} icon={a.icon} iconColor={a.iconColor} label={a.label} sub={a.sub} severity={a.severity} onClick={a.onClick} />
      ))}
      {children}
    </div>
  );
}

export default function GeneralDashboard({ onItemClick, onOpenFulfillment, onOpenBrickanalyzer, onOpenPriceomatic, onOpenSettings, onNavigate }: GeneralDashboardProps) {

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

  const { data: activeInvEmbed } = useQuery<{ id: string; status: string } | null>({
    queryKey: ['/api/embeddings/jobs/active/inventory'],
    refetchInterval: 8000,
  });

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

  const underpricedThreshold = appSettings?.pomUnderpricedScore ?? 1.5;

  const setupItems: Array<{ id: string; label: string; section: 'general' | 'platforms' }> = [];
  if (orgData?.onboardingCompleted) {
    if (!orgData?.address) setupItems.push({ id: 'address', label: 'Add business address', section: 'general' });
    if (!appSettings?.bricklinkConsumerKey) setupItems.push({ id: 'bricklink', label: 'Connect BrickLink', section: 'platforms' });
    if (!appSettings?.paypalClientId && !appSettings?.paypalConnectedViaEnv) setupItems.push({ id: 'paypal', label: 'Connect PayPal', section: 'platforms' });
    if (!appSettings?.stripeSecretKey && !appSettings?.stripeConnectedViaEnv) setupItems.push({ id: 'stripe', label: 'Connect Stripe', section: 'platforms' });
  }

  const pendingOrders = fulfillmentStats?.unfulfilled ?? dashboardOrders?.pending?.length ?? 0;
  const totalLots = stats?.totalInventoryItems ?? 0;
  const totalPcs = stats?.totalInventoryQuantity ?? 0;
  const totalRevenue = stats?.totalSales ?? 0;

  const isInvSyncing = invSyncProgress?.status === 'syncing';
  const isPomRunning = pomStatus?.data?.liveProgress?.active === true;
  const pomProgress = pomStatus?.data?.liveProgress;
  const isOrderSyncing = orderSyncRunning?.running === true;
  const isChannelSyncing = channelSyncRunning?.running === true;
  const isScanProcessing = latestScan?.status === 'processing';

  const hasRunningJobs = isInvSyncing || isPomRunning || isOrderSyncing || isChannelSyncing || isScanProcessing || !!activeInvEmbed || !!activeOrdEmbed;

  const lastInvSync = globalSyncStatuses?.inventory;
  const lastPom = pomStatus?.data ?? globalSyncStatuses?.priceomatic;
  const lastOrderSync = globalSyncStatuses?.orders;
  const lastChannelSync = globalSyncStatuses?.channel;

  const invSyncFailed = lastInvSync?.lastSyncStatus === 'failed' || lastInvSync?.lastSyncStatus === 'error';
  const pomFailed = lastPom?.lastSyncStatus === 'failed' || lastPom?.lastSyncStatus === 'error';
  const orderSyncFailed = lastOrderSync?.lastSyncStatus === 'failed' || lastOrderSync?.lastSyncStatus === 'error';
  const channelSyncFailed = lastChannelSync?.lastSyncStatus === 'failed' || lastChannelSync?.lastSyncStatus === 'error';
  const isScanComplete = latestScan?.status === 'complete';

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
    ([key, g]) => g.totalQty > 0 && g.maxScore >= underpricedThreshold && !(deepSpaceKeySet as Set<string>)?.has(key) && !(futureMissionsKeySet as Set<string>)?.has(key)
  ).length;

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

  const urgentAlerts: Array<{ id: string; icon: React.ElementType; iconColor: string; label: string; sub?: string; severity: 'warn' | 'error' | 'info'; onClick?: () => void }> = [];

  if (pendingOrders > 0) {
    urgentAlerts.push({ id: 'pending', icon: ShoppingCart, iconColor: 'text-orange-400', label: `${pendingOrders} order${pendingOrders > 1 ? 's' : ''} to fulfill`, sub: 'Ready for packing & shipping', severity: 'warn', onClick: onOpenFulfillment });
  }
  if (isScanComplete && (latestScan?.totalPieces ?? 0) > 0) {
    urgentAlerts.push({ id: 'scan', icon: Zap, iconColor: 'text-purple-400', label: 'Scan results ready to view', sub: 'View before they expire', severity: 'info', onClick: onOpenBrickanalyzer });
  }
  if (invSyncFailed) {
    urgentAlerts.push({ id: 'inv-fail', icon: XCircle, iconColor: 'text-red-400', label: 'Inventory sync failed', sub: lastInvSync?.errorMessage ?? 'Check BrickLink connection', severity: 'error', onClick: () => onOpenSettings?.('platforms') });
  }
  if (pomFailed) {
    urgentAlerts.push({ id: 'pom-fail', icon: XCircle, iconColor: 'text-red-400', label: 'Price-o-Matic failed', sub: lastPom?.errorMessage ?? 'Run manually from Settings', severity: 'error', onClick: () => onOpenSettings?.('automation') });
  }
  if (orderSyncFailed) {
    urgentAlerts.push({ id: 'order-fail', icon: XCircle, iconColor: 'text-red-400', label: 'Order sync failed', sub: lastOrderSync?.errorMessage ?? 'Check connection', severity: 'error' });
  }
  if (channelSyncFailed) {
    urgentAlerts.push({ id: 'channel-fail', icon: XCircle, iconColor: 'text-red-400', label: 'Channel sync failed', sub: lastChannelSync?.errorMessage ?? 'Check channel connections', severity: 'error', onClick: () => onOpenSettings?.('platforms') });
  }
  if (highOpportunityCount > 0) {
    urgentAlerts.push({ id: 'underpriced', icon: TrendingDown, iconColor: 'text-orange-400', label: `${highOpportunityCount} items underpriced`, sub: 'Open Price-o-Matic to review', severity: 'warn', onClick: onOpenPriceomatic });
  }
  for (const c of channelIssues) {
    if (!c.connected) {
      urgentAlerts.push({ id: `ch-${c.name}-disc`, icon: XCircle, iconColor: 'text-red-400', label: `${c.name} disconnected`, sub: 'Tap to reconnect', severity: 'error', onClick: () => onOpenSettings?.('platforms') });
    }
    if (c.disc > 0) {
      urgentAlerts.push({ id: `ch-${c.name}-issues`, icon: AlertTriangle, iconColor: 'text-yellow-400', label: `${c.name}: ${c.disc} discrepanc${c.disc !== 1 ? 'ies' : 'y'}`, severity: 'warn' });
    }
  }

  const invEmbedPct = embedStats && embedStats.inventory.total > 0
    ? Math.round((embedStats.inventory.embedded / embedStats.inventory.total) * 100) : 0;
  const ordEmbedPct = embedStats && embedStats.orders.total > 0
    ? Math.round((embedStats.orders.embedded / embedStats.orders.total) * 100) : 0;

  return (
    <div className="p-3 md:p-5 lg:p-6 xl:p-8 space-y-5 md:space-y-6 max-w-5xl mx-auto" data-testid="launchpad">

      {/* Headline Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4" data-testid="section-metrics">
        <MetricTile
          label="To Fulfill"
          value={pendingOrders.toString()}
          sub={pendingOrders > 0 ? 'orders waiting' : 'all clear'}
          Icon={ShoppingCart}
          color={pendingOrders > 0 ? 'orange' : 'green'}
          onClick={pendingOrders > 0 ? onOpenFulfillment : undefined}
        />
        <MetricTile
          label="Inventory"
          value={totalLots.toLocaleString()}
          sub={`${totalPcs.toLocaleString()} pcs`}
          Icon={Package}
          color="blue"
          onClick={() => onNavigate?.('inventory')}
        />
        <MetricTile
          label="Revenue"
          value={formatCurrency(totalRevenue)}
          sub="all time"
          Icon={TrendingUp}
          color="green"
          onClick={() => onNavigate?.('sales')}
        />
        <MetricTile
          label="Alerts"
          value={urgentAlerts.length.toString()}
          sub={urgentAlerts.length > 0 ? 'need attention' : 'all systems go'}
          Icon={urgentAlerts.length > 0 ? AlertTriangle : CheckCircle}
          color={urgentAlerts.length > 0 ? 'red' : 'green'}
        />
      </div>

      {/* System Pulse (plan info, setup items) */}
      <SystemPulse setupItems={setupItems} billingStatus={billingStatus} rateLimit={rateLimit} blApiCallLimit={appSettings?.blApiCallLimit} onOpenSettings={onOpenSettings}>
        <DashboardNotifications />
      </SystemPulse>

      {/* Ops Central — grouped by operational area */}
      <div className="rounded-lg border border-border/40 bg-gradient-to-br from-gray-900/60 to-gray-950/80 overflow-hidden" data-testid="section-ops-central">
        <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-blue-400" />
            Ops Central
          </h3>
          {hasRunningJobs && (
            <span className="flex items-center gap-1 text-[10px] text-blue-400 font-medium">
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
              Jobs running
            </span>
          )}
        </div>
        <div className="divide-y divide-border/20">
          {/* Inventory */}
          <OpAreaRow
            label="Inventory"
            Icon={Package}
            color="blue"
            lastSync={relTime(lastInvSync?.lastSyncTime)}
            syncOk={!invSyncFailed}
            alerts={urgentAlerts.filter(a => a.id === 'inv-fail' || a.id === 'scan')}
            onClick={() => onNavigate?.('inventory')}
            stat={`${totalLots.toLocaleString()} lots`}
          >
            {isInvSyncing && (
              <JobBar label="Inventory Sync" pct={invSyncProgress?.progress ?? 0} sublabel={invSyncProgress?.currentStep} color="cyan" />
            )}
            {isPomRunning && pomProgress && (
              <JobBar label="Price-o-Matic" pct={pomProgress.itemsTotal > 0 ? (pomProgress.itemsProcessed / pomProgress.itemsTotal) * 100 : 0} sublabel={`${pomProgress.itemsProcessed.toLocaleString()} / ${pomProgress.itemsTotal.toLocaleString()} lots`} color="purple" />
            )}
            {isScanProcessing && (
              <div className="flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 text-purple-400 animate-spin shrink-0" />
                <span className="text-xs text-purple-300 font-medium">BrickSpotter scanning...</span>
              </div>
            )}
            {activeInvEmbed && embedStats ? (
              <JobBar label="Inventory embedding" pct={invEmbedPct} sublabel={`${embedStats.inventory.embedded.toLocaleString()} / ${embedStats.inventory.total.toLocaleString()} items`} color="purple" />
            ) : activeInvEmbed ? (
              <div className="flex items-center gap-1.5">
                <Activity className="w-3 h-3 text-blue-400 animate-pulse" />
                <span className="text-xs text-blue-400">Embedding inventory...</span>
              </div>
            ) : null}
          </OpAreaRow>

          {/* Orders */}
          <OpAreaRow
            label="Orders"
            Icon={ShoppingCart}
            color="orange"
            lastSync={relTime(lastOrderSync?.lastSyncTime)}
            syncOk={!orderSyncFailed}
            alerts={urgentAlerts.filter(a => a.id === 'pending' || a.id === 'order-fail')}
            onClick={() => onNavigate?.('orders')}
            stat={pendingOrders > 0 ? `${pendingOrders} to fulfill` : `${(stats?.totalOrders ?? 0).toLocaleString()} total`}
          >
            {isOrderSyncing && (
              <div className="flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3 text-orange-400 animate-spin shrink-0" />
                <span className="text-xs text-orange-300 font-medium">Order sync running...</span>
              </div>
            )}
            {activeOrdEmbed && embedStats ? (
              <JobBar label="Order embedding" pct={ordEmbedPct} sublabel={`${embedStats.orders.embedded.toLocaleString()} / ${embedStats.orders.total.toLocaleString()} orders`} color="purple" />
            ) : activeOrdEmbed ? (
              <div className="flex items-center gap-1.5">
                <Activity className="w-3 h-3 text-blue-400 animate-pulse" />
                <span className="text-xs text-blue-400">Embedding orders...</span>
              </div>
            ) : null}
          </OpAreaRow>

          {/* Sales */}
          <OpAreaRow
            label="Sales"
            Icon={TrendingUp}
            color="green"
            lastSync={null}
            syncOk={true}
            alerts={urgentAlerts.filter(a => a.id === 'underpriced' || a.id === 'pom-fail')}
            onClick={() => onNavigate?.('sales')}
            stat={formatCurrency(totalRevenue)}
          />

          {/* Channels & Marketing */}
          <OpAreaRow
            label="Channels"
            Icon={Globe}
            color="purple"
            lastSync={relTime(lastChannelSync?.lastSyncTime)}
            syncOk={!channelSyncFailed}
            alerts={urgentAlerts.filter(a => a.id.startsWith('ch-') || a.id === 'channel-fail')}
            onClick={() => onNavigate?.('marketing')}
            stat={targets.length > 0 ? `${targets.length} connected` : 'Not configured'}
          >
            {isChannelSyncing && (
              <div className="flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3 text-teal-400 animate-spin shrink-0" />
                <span className="text-xs text-teal-300 font-medium">Channel sync running...</span>
              </div>
            )}
          </OpAreaRow>
        </div>
      </div>

    </div>
  );
}

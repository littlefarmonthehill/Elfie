import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Package, ShoppingCart, TrendingUp, Users,
  RefreshCw, CheckCircle, XCircle, AlertCircle, Loader2,
  ScanSearch, ArrowRight, Settings, AlertTriangle, Zap,
  TrendingDown, Clock, Activity, Gauge, CreditCard, ChevronRight,
  ChevronDown, ChevronUp,
  Sparkles, Globe, Megaphone,
} from "lucide-react";
import DashboardNotifications from "./DashboardNotifications";
import { cn } from "@/lib/utils";

interface GeneralDashboardProps {
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
  onOpenFulfillment?: () => void;
  onOpenBrickanalyzer?: () => void;
  onOpenPriceomatic?: () => void;
  onOpenBilling?: () => void;
  onOpenSettings?: (section: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'billing') => void;
  onNavigate?: (tab: 'inventory' | 'orders' | 'sales' | 'marketing') => void;
  section?: 'all' | 'plan' | 'ops';
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

function OpAreaCard({ label, Icon, color, stat, alerts, runningJobs, isRunning, lastActions, onClick }: {
  label: string; Icon: React.ElementType; color: string; stat?: string;
  alerts: Array<{ id: string; icon: React.ElementType; iconColor: string; label: string; sub?: string; severity: 'warn' | 'error' | 'info'; onClick?: () => void }>;
  runningJobs?: React.ReactNode; isRunning?: boolean; lastActions?: Array<{ label: string; time: string; ok: boolean }>;
  onClick?: () => void;
}) {
  const [lastActionsOpen, setLastActionsOpen] = useState(false);
  const colorMap: Record<string, { border: string; icon: string; headerBg: string; cardBg: string; glow: string }> = {
    blue:   { border: 'border-blue-500/40', icon: 'text-blue-400', headerBg: 'from-blue-950/50 to-gray-900/80', cardBg: 'bg-gradient-to-br from-blue-950/40 via-gray-950/70 to-blue-950/20', glow: 'shadow-[0_0_15px_rgba(59,130,246,0.12)]' },
    orange: { border: 'border-orange-500/40', icon: 'text-orange-400', headerBg: 'from-orange-950/50 to-gray-900/80', cardBg: 'bg-gradient-to-br from-orange-950/40 via-gray-950/70 to-orange-950/20', glow: 'shadow-[0_0_15px_rgba(251,146,60,0.12)]' },
    green:  { border: 'border-green-500/40', icon: 'text-green-400', headerBg: 'from-green-950/50 to-gray-900/80', cardBg: 'bg-gradient-to-br from-green-950/40 via-gray-950/70 to-green-950/20', glow: 'shadow-[0_0_15px_rgba(34,197,94,0.12)]' },
    purple: { border: 'border-purple-500/40', icon: 'text-purple-400', headerBg: 'from-purple-950/50 to-gray-900/80', cardBg: 'bg-gradient-to-br from-purple-950/40 via-gray-950/70 to-purple-950/20', glow: 'shadow-[0_0_15px_rgba(168,85,247,0.12)]' },
    yellow: { border: 'border-yellow-500/40', icon: 'text-yellow-400', headerBg: 'from-yellow-950/50 to-gray-900/80', cardBg: 'bg-gradient-to-br from-yellow-950/40 via-gray-950/70 to-yellow-950/20', glow: 'shadow-[0_0_15px_rgba(234,179,8,0.12)]' },
  };
  const c = colorMap[color] ?? colorMap.blue;

  const sevOrder: Record<string, number> = { error: 0, warn: 1, info: 2 };
  const sortedAlerts = [...alerts].sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));

  const hasRunning = !!isRunning;
  const hasAlerts = sortedAlerts.length > 0;
  const validActions = (lastActions ?? []).filter(a => a.time !== 'never');

  return (
    <div className={cn("rounded-lg border overflow-hidden", c.border, c.cardBg, c.glow)} data-testid={`ops-area-${label.toLowerCase()}`}>
      <button
        onClick={onClick}
        className={cn("w-full flex items-center justify-between gap-3 px-4 py-3 text-left bg-gradient-to-r hover-elevate active-elevate-2 transition-all group", c.headerBg)}
      >
        <div className="flex items-center gap-2.5">
          <Icon className={cn("w-4 h-4 shrink-0", c.icon)} />
          <span className="text-sm font-bold text-foreground uppercase tracking-wide">{label}</span>
        </div>
        {stat && <span className="text-xs text-muted-foreground font-medium">{stat}</span>}
      </button>

      <div className="bg-gray-950/60">
        {hasAlerts && (
          <div className="px-3 pt-3 space-y-2">
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Attention</h4>
            {sortedAlerts.map((a) => (
              <AlertRow key={a.id} icon={a.icon} iconColor={a.iconColor} label={a.label} sub={a.sub} severity={a.severity} onClick={a.onClick} />
            ))}
          </div>
        )}

        {!hasAlerts && !hasRunning && (
          <div className="px-3 py-2.5 flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
            <span className="text-xs text-muted-foreground">All {label.toLowerCase()} handled</span>
          </div>
        )}

        {hasRunning && (
          <div className="px-3 pt-3 space-y-2">
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Running</h4>
            {runningJobs}
          </div>
        )}

        {validActions.length > 0 && (
          <div className="px-3 pb-1 pt-2">
            <button
              onClick={(e) => { e.stopPropagation(); setLastActionsOpen(!lastActionsOpen); }}
              className="w-full flex items-center justify-between gap-2 py-1.5 group"
              data-testid={`button-last-actions-${label.toLowerCase()}`}
            >
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                <Clock className="w-3 h-3" />
                Last Actions
              </span>
              {lastActionsOpen
                ? <ChevronDown className="w-3.5 h-3.5 text-blue-400" />
                : <ChevronUp className="w-3.5 h-3.5 text-blue-400" />
              }
            </button>
            {lastActionsOpen && (
              <div className="space-y-1 pb-2 pt-1">
                {validActions.map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {a.ok
                        ? <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />
                        : <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                      }
                      <span className="text-muted-foreground truncate">{a.label}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{a.time}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface OrgUsageData {
  billingStartDate?: string | null;
  subscriptionStatus?: string;
  period: { start: string; end: string };
  plan: { id: number; name: string; basePrice: number; salesPercentage: number; freeSalesThreshold: number; isDefault?: boolean; sunsetAt?: string | null };
  monthlySalesCents: number;
  billing: { baseFee: number; salesFee: number; totalDue: number };
}

function UsageSynopsis({ onOpenSettings: _onOpenSettings, onOpenBilling }: { onOpenSettings?: (section: any) => void; onOpenBilling?: () => void }) {
  const { data: usage, isLoading } = useQuery<OrgUsageData>({ queryKey: ['/api/org/usage'] });

  if (isLoading || !usage) return null;

  // Don't show billing details for trial users — they haven't committed to a plan yet
  if (usage.subscriptionStatus === 'trial') return null;

  const { billing, plan, monthlySalesCents } = usage;
  const hasSalesFee = billing.salesFee > 0;

  const periodRange = (() => {
    if (usage.plan.isDefault) {
      if (usage.plan.sunsetAt) {
        const end = new Date(usage.plan.sunsetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        return `Ends ${end}`;
      }
      return '';
    }
    if (!usage.period?.start || !usage.period?.end) return '';
    const s = new Date(usage.period.start);
    const e = new Date(usage.period.end);
    const fmt = (d: Date, includeYear: boolean) =>
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(includeYear ? { year: 'numeric' } : {}) });
    const sameYear = s.getFullYear() === e.getFullYear();
    return `${fmt(s, false)} – ${fmt(e, sameYear)}`;
  })();

  // Sales bar: 0–threshold = green, over threshold = purple
  const barPct = Math.min(100, plan.freeSalesThreshold > 0 ? (monthlySalesCents / (plan.freeSalesThreshold * 2)) * 100 : 0);

  return (
    <>
      <div className="px-3 py-2.5 border-t border-gray-700/30 bg-gray-900/40" data-testid="section-usage-synopsis">
        <button
          onClick={() => onOpenBilling?.()}
          className="w-full text-left"
          data-testid="button-usage-details"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              <CreditCard className="w-3 h-3" />
              My Plan
            </span>
            <span className="text-[9px] text-gray-600">{periodRange}</span>
          </div>

          {/* Cost rows */}
          <div className="space-y-1 mb-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-gray-400">Base fee</span>
              <span className="text-[10px] text-gray-300 font-mono tabular-nums">${(plan.basePrice / 100).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-gray-500">Sales</span>
              <span className="text-[10px] text-gray-400 font-mono tabular-nums">
                ${(monthlySalesCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            {hasSalesFee && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-purple-400/80">{plan.salesPercentage}% sales fee</span>
                <span className="text-[10px] text-purple-300 font-mono tabular-nums">
                  +${(billing.salesFee / 100).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* Sales bar */}
          <div className="h-1.5 rounded-full bg-gray-700/50 overflow-hidden mb-1.5">
            <div
              className={cn("h-full rounded-full transition-all duration-500",
                hasSalesFee ? 'bg-purple-500/70' : 'bg-green-500/60'
              )}
              style={{ width: `${barPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className={cn("text-[10px] font-semibold tabular-nums font-mono",
              hasSalesFee ? 'text-purple-300' : 'text-gray-300'
            )}>
              ~${(billing.totalDue / 100).toFixed(2)}/mo
            </span>
            <span className="flex items-center gap-0.5 text-[9px] text-gray-600">
              See breakdown <ChevronRight className="w-2.5 h-2.5" />
            </span>
          </div>
        </button>
      </div>

    </>
  );
}

function FuelGauge({ remaining }: { remaining: number }) {
  const cx = 64, cy = 58, r = 44, sw = 8;
  const arcLen = Math.PI * r;
  const angleDeg = 180 - (remaining / 100) * 180;
  const angleRad = (angleDeg * Math.PI) / 180;
  const tipX = cx + (r - sw - 4) * Math.cos(angleRad);
  const tipY = cy - (r - sw - 4) * Math.sin(angleRad);
  const isDanger = remaining <= 15;
  const isWarn = remaining <= 35 && !isDanger;
  const fuelColor = isDanger ? '#f87171' : isWarn ? '#fbbf24' : '#60a5fa';
  const glowColor = isDanger ? '#ef4444' : isWarn ? '#f59e0b' : '#3b82f6';
  const ticks = [0, 25, 50, 75, 100].map(p => {
    const a = ((180 - (p / 100) * 180) * Math.PI) / 180;
    return {
      x1: cx + (r - sw + 1) * Math.cos(a), y1: cy - (r - sw + 1) * Math.sin(a),
      x2: cx + (r + 5) * Math.cos(a),       y2: cy - (r + 5) * Math.sin(a),
    };
  });
  return (
    <svg width="128" height="80" viewBox="0 0 128 80" className="mx-auto overflow-visible">
      <defs>
        <filter id="fuelglow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path d={`M ${cx - r},${cy} A ${r},${r} 0 0,1 ${cx + r},${cy}`}
        fill="none" stroke="#111827" strokeWidth={sw} strokeLinecap="butt" />
      {remaining > 0 && (
        <path d={`M ${cx - r},${cy} A ${r},${r} 0 0,1 ${cx + r},${cy}`}
          fill="none" stroke={glowColor} strokeWidth={sw} strokeLinecap="butt"
          strokeDasharray={`${(remaining / 100) * arcLen} ${arcLen}`}
          filter="url(#fuelglow)" opacity={0.35} />
      )}
      {remaining > 0 && (
        <path d={`M ${cx - r},${cy} A ${r},${r} 0 0,1 ${cx + r},${cy}`}
          fill="none" stroke={fuelColor} strokeWidth={sw - 2} strokeLinecap="butt"
          strokeDasharray={`${(remaining / 100) * arcLen} ${arcLen}`} />
      )}
      {ticks.map((t, i) => (
        <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
          stroke="#374151" strokeWidth={i === 0 || i === 4 ? 1.5 : 1} />
      ))}
      <line x1={cx} y1={cy} x2={tipX} y2={tipY}
        stroke="#e5e7eb" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="4" fill="#1f2937" stroke="#374151" strokeWidth="1" />
      <circle cx={cx} cy={cy} r="1.5" fill={fuelColor} />
      <text x={cx - r - 6} y={cy + 14} fontSize="7.5" fill="#4b5563" textAnchor="middle" fontFamily="monospace" fontWeight="700">E</text>
      <text x={cx + r + 6} y={cy + 14} fontSize="7.5" fill="#4b5563" textAnchor="middle" fontFamily="monospace" fontWeight="700">F</text>
    </svg>
  );
}

export function SystemPulse({ setupItems, billingStatus, rateLimit, blApiCallLimit, onOpenSettings, onOpenBilling, children }: {
  setupItems: Array<{ id: string; label: string; section: 'general' | 'platforms' }>;
  billingStatus?: { plan: string; status: string; interval?: string | null; trialEndsAt?: string | null; subscriptionEndsAt?: string | null; planStatus?: string | null; planSunsetAt?: string | null; brickspotter?: { scansUsed: number; scansLimit: number; apiCallLimit?: number } } | null;
  rateLimit?: { allowed: boolean; callsLast24h: number; blocked?: boolean } | null;
  blApiCallLimit?: number;
  onOpenSettings?: (section: any) => void;
  onOpenBilling?: () => void;
  children?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('systemPulseCollapsed') === 'true'; } catch { return false; }
  });
  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem('systemPulseCollapsed', String(next)); } catch {}
  };

  const isActivePaid = billingStatus?.status === 'active';
  const planLabel = isActivePaid ? (billingStatus?.plan ?? '') : '';

  const trialDaysLeft = (() => {
    if (!billingStatus?.trialEndsAt) return null;
    const diff = new Date(billingStatus.trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  })();

  const isTrial = billingStatus?.status === 'trial' || billingStatus?.plan === 'trial';
  const isBrickSpotter = billingStatus?.brickspotter != null;
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
  if (billingStatus?.planStatus === 'sunset') {
    const sunsetDate = billingStatus.planSunsetAt ? new Date(billingStatus.planSunsetAt) : null;
    const daysUntilSunset = sunsetDate ? Math.max(0, Math.ceil((sunsetDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : null;
    const sunsetSeverity: 'error' | 'warn' | 'info' = daysUntilSunset !== null && daysUntilSunset <= 14 ? 'error' : daysUntilSunset !== null && daysUntilSunset <= 30 ? 'warn' : 'info';
    const sunsetLabel = sunsetDate
      ? (daysUntilSunset === 0 ? 'Your plan ends today' : `Your plan ends ${sunsetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`)
      : 'Your current plan is being retired';
    alerts.push({ id: 'plan-sunset', icon: CreditCard, iconColor: sunsetSeverity === 'error' ? 'text-red-400' : sunsetSeverity === 'warn' ? 'text-orange-400' : 'text-yellow-400', label: sunsetLabel, sub: 'Choose a new plan to keep access', severity: sunsetSeverity, onClick: () => onOpenBilling?.() });
  }

  if (isBrickSpotter && rateLimit != null) {
    const limit = bs?.apiCallLimit && bs.apiCallLimit > 0 ? bs.apiCallLimit : (blApiCallLimit ?? 5000);
    const used = rateLimit.callsLast24h ?? 0;
    const pct = limit > 0 ? (used / limit) * 100 : 0;
    if (pct >= 85) {
      alerts.push({ id: 'bl-api-danger', icon: Gauge, iconColor: 'text-red-400', label: 'BrickSpotter Fuel — CRITICAL', sub: `Only ${(limit - used).toLocaleString()} calls remaining today`, severity: 'error' });
    } else if (pct >= 65) {
      alerts.push({ id: 'bl-api-warn', icon: Gauge, iconColor: 'text-yellow-400', label: 'BrickSpotter Fuel running low', sub: `${(limit - used).toLocaleString()} calls left · 24 h rolling`, severity: 'warn' });
    }
  }

  const sevOrder: Record<string, number> = { error: 0, warn: 1, info: 2 };
  alerts.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));

  return (
    <div className="rounded-lg border border-gray-500/30 overflow-hidden" data-testid="section-system-pulse">
      <button
        onClick={toggleCollapse}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-gradient-to-r from-gray-800/60 to-gray-900/80 hover-elevate active-elevate-2 transition-all"
      >
        <div className="flex items-center gap-2.5">
          <CreditCard className="w-4 h-4 text-gray-400 shrink-0" />
          <span className="text-sm font-bold text-foreground uppercase tracking-wide">Your Plan</span>
        </div>
        <div className="flex items-center gap-2">
          {planLabel && <span className="text-xs text-muted-foreground font-medium">{planLabel}</span>}
          {collapsed ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" /> : <ChevronUp className="w-3.5 h-3.5 text-gray-500" />}
        </div>
      </button>

      {!collapsed && (
        <>
          <UsageSynopsis onOpenSettings={onOpenSettings} onOpenBilling={onOpenBilling} />

          {/* BrickSpotter Fuel — only visible on BrickSpotter plan */}
          {isBrickSpotter && rateLimit != null && (() => {
            const limit = bs?.apiCallLimit && bs.apiCallLimit > 0 ? bs.apiCallLimit : (blApiCallLimit ?? 5000);
            const used = rateLimit.callsLast24h ?? 0;
            const pct = Math.min(100, limit > 0 ? Math.round((used / limit) * 100) : 0);
            const remaining = 100 - pct;
            const isDanger = remaining <= 15;
            const isWarn = remaining <= 35 && !isDanger;
            const statusLabel = isDanger ? 'CRITICAL' : isWarn ? 'RUNNING LOW' : 'NOMINAL';
            const statusColor = isDanger ? 'text-red-400' : isWarn ? 'text-yellow-400' : 'text-blue-400';
            return (
              <div className="px-3 pt-2 pb-3 border-t border-gray-700/30 bg-gray-900/40">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <Gauge className="w-3 h-3" />
                    BrickSpotter Fuel
                  </span>
                  <span className={cn('text-[10px] font-mono font-bold tracking-widest', statusColor)}>
                    {statusLabel}
                  </span>
                </div>
                <FuelGauge remaining={remaining} />
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className="text-[10px] text-gray-600 font-mono">{used.toLocaleString()} used</span>
                  <span className="text-[10px] text-gray-600 font-mono">{(limit - used).toLocaleString()} left · rolling 24 h</span>
                </div>
              </div>
            );
          })()}

          <div className="bg-gray-950/60">
            {alerts.length > 0 && (
              <div className="px-3 pt-3 space-y-2">
                <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Attention</h4>
                {alerts.map((a) => (
                  <AlertRow key={a.id} icon={a.icon} iconColor={a.iconColor} label={a.label} sub={a.sub} severity={a.severity} onClick={a.onClick} />
                ))}
              </div>
            )}

            <div className="px-3 py-2.5">
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Communications</h4>
              {children ?? (
                <div className="flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  <span className="text-xs text-muted-foreground">No new notifications</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function GeneralDashboard({ onItemClick, onOpenFulfillment, onOpenBrickanalyzer, onOpenPriceomatic, onOpenBilling, onOpenSettings, onNavigate, section = 'all' }: GeneralDashboardProps) {

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

  const { data: appSettings } = useQuery<{ elfieMode?: string; bricklinkConsumerKey?: string | null; pomUnderpricedScore?: number; blApiCallLimit?: number }>({
    queryKey: ['/api/settings'],
  });

  const { data: orgData } = useQuery<{ address: string | null; phone: string | null; onboardingCompleted: boolean }>({
    queryKey: ['/api/org'],
  });

  const { data: billingStatus } = useQuery<{ plan: string; status: string; interval: string | null; trialEndsAt: string | null; subscriptionEndsAt: string | null; planStatus: string | null; planSunsetAt: string | null; brickspotter: { scansUsed: number; scansLimit: number } }>({
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
  if (!orgData?.address) setupItems.push({ id: 'address', label: 'Add business address', section: 'general' });
  if (!appSettings?.bricklinkConsumerKey) setupItems.push({ id: 'bricklink', label: 'Connect BrickLink', section: 'platforms' });

  const pendingOrders = fulfillmentStats?.unfulfilled ?? dashboardOrders?.pending?.length ?? 0;
  const totalLots = stats?.totalInventoryItems ?? 0;
  const totalPcs = stats?.totalInventoryQuantity ?? 0;
  const totalRevenue = stats?.totalSales ?? 0;

  const isInvSyncing = invSyncProgress?.status === 'syncing';
  const isOrderSyncing = orderSyncRunning?.running === true;
  const isChannelSyncing = channelSyncRunning?.running === true;
  const isScanProcessing = latestScan?.status === 'processing';

  const hasRunningJobs = isInvSyncing || isOrderSyncing || isChannelSyncing || isScanProcessing || !!activeInvEmbed || !!activeOrdEmbed;

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

  const showPlan = section === 'all' || section === 'plan';
  const showOps = section === 'all' || section === 'ops';

  return (
    <div className="p-3 md:p-5 lg:p-6 xl:p-8 space-y-5 md:space-y-6 max-w-5xl mx-auto" data-testid="launchpad">

      {/* System Pulse (plan info, setup items) */}
      {showPlan && (
        <SystemPulse setupItems={setupItems} billingStatus={billingStatus} rateLimit={rateLimit} blApiCallLimit={appSettings?.blApiCallLimit} onOpenSettings={onOpenSettings} onOpenBilling={onOpenBilling}>
          <DashboardNotifications />
        </SystemPulse>
      )}

      {/* Operational areas */}
      {showOps && (<div className="space-y-4" data-testid="section-ops-central">
        <OpAreaCard
          label="Inventory"
          Icon={Package}
          color="blue"
          stat={`${totalLots.toLocaleString()} lots · ${totalPcs.toLocaleString()} pcs`}
          alerts={urgentAlerts.filter(a => ['inv-fail', 'scan', 'underpriced', 'channel-fail'].includes(a.id) || a.id.startsWith('ch-'))}
          onClick={() => onNavigate?.('inventory')}
          isRunning={isInvSyncing || isScanProcessing || isChannelSyncing || !!activeInvEmbed}
          lastActions={[
            { label: 'Inventory sync', time: relTime(lastInvSync?.lastSyncTime), ok: !invSyncFailed },
            { label: 'Channel sync', time: relTime(lastChannelSync?.lastSyncTime), ok: !channelSyncFailed },
          ]}
          runningJobs={<>
            {isInvSyncing && (
              <JobBar label="Inventory Sync" pct={invSyncProgress?.progress ?? 0} sublabel={invSyncProgress?.currentStep} color="cyan" />
            )}
            {isScanProcessing && (
              <div className="flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 text-purple-400 animate-spin shrink-0" />
                <span className="text-xs text-purple-300 font-medium">BrickSpotter scanning...</span>
              </div>
            )}
            {isChannelSyncing && (
              <div className="flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3 text-teal-400 animate-spin shrink-0" />
                <span className="text-xs text-teal-300 font-medium">Channel sync running...</span>
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
          </>}
        />

        <OpAreaCard
          label="Orders"
          Icon={ShoppingCart}
          color="orange"
          stat={pendingOrders > 0 ? `${pendingOrders} to fulfill` : `${(stats?.totalOrders ?? 0).toLocaleString()} total`}
          alerts={urgentAlerts.filter(a => a.id === 'pending' || a.id === 'order-fail')}
          onClick={() => onNavigate?.('orders')}
          isRunning={isOrderSyncing || !!activeOrdEmbed}
          lastActions={[
            { label: 'Order sync', time: relTime(lastOrderSync?.lastSyncTime), ok: !orderSyncFailed },
          ]}
          runningJobs={<>
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
          </>}
        />

        <OpAreaCard
          label="Marketing"
          Icon={Megaphone}
          color="yellow"
          stat={targets.length > 0 ? `${targets.length} channel${targets.length !== 1 ? 's' : ''} connected` : 'No channels'}
          alerts={[]}
          onClick={() => onNavigate?.('marketing')}
        />

        <OpAreaCard
          label="Insights"
          Icon={TrendingUp}
          color="green"
          stat={formatCurrency(totalRevenue)}
          alerts={urgentAlerts.filter(a => a.id === 'pom-fail')}
          onClick={() => onNavigate?.('sales')}
        />
      </div>)}

    </div>
  );
}

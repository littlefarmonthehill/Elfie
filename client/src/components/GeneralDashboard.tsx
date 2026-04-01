import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Package, ShoppingCart, TrendingUp, Users,
  RefreshCw, CheckCircle, XCircle, AlertCircle, Loader2,
  ScanSearch, ArrowRight, Settings, AlertTriangle, Zap,
  TrendingDown, Clock, Activity, Gauge, CreditCard, ChevronRight,
  ChevronDown, ChevronUp, X,
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
  onOpenSettings?: (section: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'billing' | 'ieStrategies' | 'warehouse' | 'notifications') => void;
  onNavigate?: (tab: 'inventory' | 'orders' | 'sales' | 'marketing') => void;
  section?: 'all' | 'plan' | 'ops';
  activeSection?: 'inventory' | 'orders' | 'marketing' | 'sales';
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

function AlertRow({ icon: Icon, iconColor, label, sub, onClick, severity = 'warn', onDismiss }: {
  icon: React.ElementType; iconColor: string; label: string; sub?: string; onClick?: () => void; severity?: 'warn' | 'error' | 'info'; onDismiss?: () => void;
}) {
  const bg = severity === 'error' ? 'bg-red-950/30 border-red-500/20' : severity === 'info' ? 'bg-blue-950/30 border-blue-500/20' : 'bg-yellow-950/30 border-yellow-500/20';
  return (
    <div
      className={cn("flex items-center gap-2.5 rounded-lg border px-3 py-2", bg)}
      data-testid={`alert-${label.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}`}
    >
      <Icon className={cn("w-4 h-4 shrink-0", iconColor)} />
      <div
        onClick={onClick}
        className={cn("flex-1 min-w-0", onClick && "cursor-pointer")}
      >
        <p className="text-xs md:text-sm font-medium leading-tight truncate">{label}</p>
        {sub && <p className="text-[10px] md:text-xs text-muted-foreground truncate">{sub}</p>}
      </div>
      {onClick && !onDismiss && <ArrowRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
      {onDismiss && (
        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          className="w-5 h-5 flex items-center justify-center rounded text-gray-600 hover:text-gray-400 transition-colors shrink-0"
          data-testid={`dismiss-alert-${label.toLowerCase().replace(/\s+/g, '-').slice(0, 20)}`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function relTimeUntil(isoDate: string | null): string {
  if (!isoDate) return '';
  const diffMs = new Date(isoDate).getTime() - Date.now();
  if (diffMs <= 0) return 'update due';
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `in ${hrs}h ${rem}m` : `in ${hrs}h`;
}

function OpAreaCard({ label, Icon, color, stat, alerts, runningJobs, isRunning, lastActions, onClick, isActive, channelNum, channelHex, flashReport, schedulerNextRunAt, schedulerEnabled }: {
  label: string; Icon: React.ElementType; color: string; stat?: string;
  alerts: Array<{ id: string; icon: React.ElementType; iconColor: string; label: string; sub?: string; severity: 'warn' | 'error' | 'info'; onClick?: () => void }>;
  runningJobs?: React.ReactNode; isRunning?: boolean; lastActions?: Array<{ label: string; time: string; ok: boolean }>;
  onClick?: () => void;
  isActive?: boolean; channelNum?: string; channelHex?: string;
  flashReport?: { summary: string; urgency: string; updatedAt?: string } | null;
  schedulerNextRunAt?: string | null;
  schedulerEnabled?: boolean;
}) {
  const [lastActionsOpen, setLastActionsOpen] = useState(false);
  const hex = channelHex ?? '#1B7CE5';

  const iconColorMap: Record<string, string> = {
    blue: 'text-blue-300', orange: 'text-orange-300', green: 'text-green-300',
    yellow: 'text-yellow-200', purple: 'text-purple-300',
  };
  const iconColor = iconColorMap[color] ?? iconColorMap.blue;

  const sevDotColor: Record<string, string> = { error: '#f87171', warn: '#fb923c', info: '#4ade80' };
  const sevTextColor: Record<string, string> = { error: 'text-red-400', warn: 'text-orange-400', info: 'text-green-400' };

  const sortedAlerts = [...alerts].sort((a, b) =>
    ({ error: 0, warn: 1, info: 2 }[a.severity] ?? 9) - ({ error: 0, warn: 1, info: 2 }[b.severity] ?? 9)
  );
  const errorCount = sortedAlerts.filter(a => a.severity === 'error').length;
  const hasAlerts = sortedAlerts.length > 0;
  const validActions = (lastActions ?? []).filter(a => a.time !== 'never');

  return (
    <div
      onClick={onClick}
      className="rounded-lg border flex flex-col overflow-hidden transition-all duration-200 hover-elevate active-elevate-2 cursor-pointer"
      style={{
        minHeight: '186px',
        background: `linear-gradient(135deg, color-mix(in srgb, ${hex} 18%, #0a0c14) 0%, #0d0f1a 55%, color-mix(in srgb, ${hex} 8%, #0a0c14) 100%)`,
        borderColor: isActive ? `${hex}cc` : `${hex}66`,
        boxShadow: isActive
          ? `0 0 28px ${hex}45, 0 0 8px ${hex}20, inset 0 1px 0 ${hex}30`
          : `0 0 16px ${hex}20, inset 0 1px 0 ${hex}18`,
      }}
      data-testid={`ops-area-${label.toLowerCase()}`}
    >
      {/* ── Colored top-edge accent ── */}
      <div style={{ height: 2, background: `linear-gradient(90deg, transparent 0%, ${hex} 30%, ${hex} 70%, transparent 100%)`, opacity: isActive ? 0.9 : 0.45, flexShrink: 0 }} />

      {/* ── Header ── */}
      <div
        className="flex items-center gap-2 px-3 py-2 w-full text-left flex-shrink-0"
        style={{ borderBottom: `1px solid ${hex}30`, background: `linear-gradient(180deg, color-mix(in srgb, ${hex} 22%, transparent) 0%, transparent 100%)` }}
      >
        {channelNum && (
          <div
            className="shrink-0 rounded font-mono font-black leading-none"
            style={{
              fontSize: '8px', letterSpacing: '0.1em', padding: '2px 5px',
              background: `color-mix(in srgb, ${hex} 15%, #03040C)`,
              border: `1px solid ${hex}${isActive ? 'cc' : '66'}`,
              boxShadow: isActive ? `0 0 8px ${hex}66` : `0 0 4px ${hex}33`,
              color: hex,
            }}
          >CH{channelNum}</div>
        )}
        <Icon className={cn('w-3.5 h-3.5 shrink-0 drop-shadow-[0_0_4px_currentColor]', iconColor)} />
        <span className="text-xs font-bold uppercase tracking-wide flex-1 min-w-0 truncate text-foreground/90">
          {label}
        </span>
        {stat && (
          <span className="text-[10px] font-mono shrink-0 truncate max-w-[110px]" style={{ color: `color-mix(in srgb, ${hex} 70%, #8899aa)` }}>{stat}</span>
        )}
        {/* Status dot */}
        {errorCount > 0 ? (
          <div className="w-2 h-2 rounded-full bg-red-400 shrink-0 shadow-[0_0_6px_#f87171]" />
        ) : hasAlerts ? (
          <div className="w-2 h-2 rounded-full bg-orange-400 shrink-0 shadow-[0_0_6px_#fb923c]" />
        ) : isRunning ? (
          <div className="relative w-2 h-2 shrink-0">
            <div className="absolute inset-0 rounded-full bg-cyan-400 animate-ping opacity-75" />
            <div className="absolute inset-0 rounded-full bg-cyan-400" />
          </div>
        ) : (
          <div className="w-2 h-2 rounded-full bg-green-400 shrink-0 shadow-[0_0_6px_#4ade80]" />
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 px-3 py-2 flex flex-col gap-1.5 min-h-0">

        {/* Flash Report — agent situation brief, shown before alerts */}
        {flashReport?.summary && (
          <div
            className="flex flex-col gap-1 rounded px-2 py-1.5"
            style={{ background: `color-mix(in srgb, ${hex} 10%, #080a14)`, border: `1px solid ${hex}25` }}
            data-testid={`flash-report-${label.toLowerCase()}`}
          >
            <div className="flex items-start gap-1.5">
              <Sparkles className="w-2.5 h-2.5 shrink-0 mt-[2px] opacity-80" style={{ color: hex }} />
              <p
                className="text-[10px] leading-[1.4] italic"
                style={{ color: `color-mix(in srgb, ${hex} 65%, #8899aa)` }}
              >
                {flashReport.summary}
              </p>
            </div>
            {schedulerNextRunAt && (
              <p
                className="text-[9px] leading-none text-right opacity-50"
                style={{ color: `color-mix(in srgb, ${hex} 50%, #8899aa)` }}
                data-testid={`flash-next-update-${label.toLowerCase()}`}
              >
                {`next brief ${relTimeUntil(schedulerNextRunAt)}`}
              </p>
            )}
          </div>
        )}

        {/* Alerts */}
        {hasAlerts && (
          <div className="space-y-1">
            {sortedAlerts.slice(0, 3).map(a => (
              <button
                key={a.id}
                onClick={(e) => { e.stopPropagation(); a.onClick?.(); }}
                className={cn('flex items-start gap-2 w-full text-left min-w-0', a.onClick && 'cursor-pointer')}
                data-testid={`alert-${a.id}`}
              >
                <div
                  className="shrink-0 mt-[4px] rounded-full"
                  style={{ width: 5, height: 5, background: sevDotColor[a.severity] ?? '#fb923c', boxShadow: `0 0 5px ${sevDotColor[a.severity] ?? '#fb923c'}` }}
                />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-[10px] leading-tight truncate font-medium', sevTextColor[a.severity] ?? 'text-orange-400')}>{a.label}</p>
                  {a.sub && <p className="text-[9px] text-muted-foreground/50 truncate leading-tight">{a.sub}</p>}
                </div>
                {a.onClick && <ArrowRight className="w-2.5 h-2.5 shrink-0 text-muted-foreground/40 mt-0.5" />}
              </button>
            ))}
          </div>
        )}

        {isRunning && (
          <div className="space-y-1">
            {(hasAlerts || flashReport?.summary) && <div className="h-px my-0.5" style={{ background: `${hex}20` }} />}
            {runningJobs}
          </div>
        )}

        {!hasAlerts && !isRunning && !flashReport?.summary && (
          <div className="flex items-center gap-1.5 h-full justify-center">
            <CheckCircle className="w-3 h-3 text-green-400/60" />
            <span className="text-[10px] text-muted-foreground/40">All clear</span>
          </div>
        )}
      </div>

      {/* ── Last Actions footer ── */}
      {validActions.length > 0 && (
        <div className="flex-shrink-0" style={{ borderTop: `1px solid ${hex}18` }}>
          <button
            onClick={(e) => { e.stopPropagation(); setLastActionsOpen(o => !o); }}
            className="flex items-center justify-between w-full px-3 py-1.5 hover-elevate"
          >
            <span className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/40">
              <Clock className="w-2.5 h-2.5" />
              Last Actions
            </span>
            {lastActionsOpen ? <ChevronUp className="w-2.5 h-2.5 text-muted-foreground/30" /> : <ChevronDown className="w-2.5 h-2.5 text-muted-foreground/30" />}
          </button>
          {lastActionsOpen && (
            <div className="px-3 pb-2 space-y-0.5">
              {validActions.map((a, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <span className="text-[9px] text-muted-foreground/50 truncate">{a.label}</span>
                  <span className={cn('text-[9px] font-mono shrink-0', a.ok ? 'text-green-500/60' : 'text-red-400/70')}>{a.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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

export function SystemPulse({ setupItems, billingStatus, rateLimit, blApiCallLimit, onOpenSettings, onOpenBilling, onDismissSetupItem, children }: {
  setupItems: Array<{ id: string; label: string; section: 'general' | 'platforms' | 'billing' | 'ieStrategies' | 'warehouse' | 'notifications' }>;
  billingStatus?: { plan: string; status: string; interval?: string | null; trialEndsAt?: string | null; subscriptionEndsAt?: string | null; planStatus?: string | null; planSunsetAt?: string | null; brickspotter?: { scansUsed: number; scansLimit: number; apiCallLimit?: number } } | null;
  rateLimit?: { allowed: boolean; callsLast24h: number; blocked?: boolean } | null;
  blApiCallLimit?: number;
  onOpenSettings?: (section: any) => void;
  onOpenBilling?: () => void;
  onDismissSetupItem?: (id: string) => void;
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

  const alerts: Array<{ id: string; icon: React.ElementType; iconColor: string; label: string; sub?: string; severity: 'warn' | 'error' | 'info'; onClick?: () => void; onDismiss?: () => void }> = [];

  for (const s of setupItems) {
    alerts.push({
      id: s.id,
      icon: Settings,
      iconColor: 'text-blue-400',
      label: s.label,
      sub: 'Tap to configure',
      severity: 'info',
      onClick: s.section === 'billing' ? () => onOpenBilling?.() : () => onOpenSettings?.(s.section),
      onDismiss: onDismissSetupItem ? () => onDismissSetupItem(s.id) : undefined,
    });
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
                  <AlertRow key={a.id} icon={a.icon} iconColor={a.iconColor} label={a.label} sub={a.sub} severity={a.severity} onClick={a.onClick} onDismiss={a.onDismiss} />
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

export default function GeneralDashboard({ onItemClick, onOpenFulfillment, onOpenBrickanalyzer, onOpenPriceomatic, onOpenBilling, onOpenSettings, onNavigate, section = 'all', activeSection }: GeneralDashboardProps) {

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

  const { data: appSettings } = useQuery<{ elfieMode?: string; bricklinkConsumerKey?: string | null; brickowlApiKey?: string | null; easypostApiKey?: string | null; pomUnderpricedScore?: number; blApiCallLimit?: number }>({
    queryKey: ['/api/settings'],
  });

  const { data: orgData } = useQuery<{ address: string | null; phone: string | null; onboardingCompleted: boolean; warehouseDepth: number | null }>({
    queryKey: ['/api/org'],
  });

  const { data: ieData } = useQuery<{ visionMission: string | null; pricingStrategy: string | null } | null>({
    queryKey: ['/api/ie-strategies'],
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

  const { data: syncQueueData } = useQuery<{ stats: { pending: number; abandoned: number; done: number; total: number } }>({
    queryKey: ['/api/sync-queue'],
    refetchInterval: 30000,
    select: (d) => ({ stats: d.stats }),
  });
  const abandonedQtyUpdates = syncQueueData?.stats?.abandoned ?? 0;

  const { data: flashReportPayload } = useQuery<{
    reports: Record<string, { summary: string; urgency: string; updatedAt: string } | null>;
    schedulerNextRunAt: string | null;
    schedulerEnabled: boolean;
  }>({
    queryKey: ['/api/ops/flash-report'],
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
  });
  const flashReports = flashReportPayload?.reports;
  const schedulerNextRunAt = flashReportPayload?.schedulerNextRunAt ?? null;
  const schedulerEnabled = flashReportPayload?.schedulerEnabled ?? false;

  const underpricedThreshold = appSettings?.pomUnderpricedScore ?? 1.5;

  const [dismissedItems, setDismissedItems] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('elfie_dismissed_setup_items');
      return new Set(stored ? JSON.parse(stored) : []);
    } catch { return new Set(); }
  });

  const dismissSetupItem = (id: string) => {
    setDismissedItems(prev => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem('elfie_dismissed_setup_items', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const isActivePaidPlan = billingStatus?.status === 'active';

  const setupItems: Array<{ id: string; label: string; section: 'general' | 'platforms' | 'billing' | 'ieStrategies' | 'warehouse' | 'notifications' }> = [];
  if (!orgData?.address && !dismissedItems.has('address')) setupItems.push({ id: 'address', label: 'Add business address', section: 'general' });
  if (!appSettings?.bricklinkConsumerKey && !dismissedItems.has('bricklink')) setupItems.push({ id: 'bricklink', label: 'Connect BrickLink', section: 'platforms' });
  if (!appSettings?.brickowlApiKey && !dismissedItems.has('channels')) setupItems.push({ id: 'channels', label: 'Connect a selling channel', section: 'platforms' });
  if (!appSettings?.easypostApiKey && !dismissedItems.has('shipping')) setupItems.push({ id: 'shipping', label: 'Connect a shipping service', section: 'platforms' });
  if (!isActivePaidPlan && !dismissedItems.has('subscription')) setupItems.push({ id: 'subscription', label: 'Choose a subscription plan', section: 'billing' });
  if (ieData !== undefined && !ieData?.visionMission && !dismissedItems.has('ieStrategies')) setupItems.push({ id: 'ieStrategies', label: 'Configure seller strategy', section: 'ieStrategies' });
  if (orgData !== undefined && !orgData?.warehouseDepth && !dismissedItems.has('warehouse')) setupItems.push({ id: 'warehouse', label: 'Set up warehouse layout', section: 'warehouse' });
  if (!dismissedItems.has('notifications')) setupItems.push({ id: 'notifications', label: 'Set up notifications', section: 'notifications' });

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
  if (abandonedQtyUpdates > 0) {
    urgentAlerts.push({ id: 'qty-sync-fail', icon: AlertTriangle, iconColor: 'text-orange-400', label: `${abandonedQtyUpdates} qty update${abandonedQtyUpdates !== 1 ? 's' : ''} need attention`, sub: 'Open Orders to review and retry', severity: 'error', onClick: () => onNavigate?.('orders') });
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
        <SystemPulse setupItems={setupItems} billingStatus={billingStatus} rateLimit={rateLimit} blApiCallLimit={appSettings?.blApiCallLimit} onOpenSettings={onOpenSettings} onOpenBilling={onOpenBilling} onDismissSetupItem={dismissSetupItem}>
          <DashboardNotifications />
        </SystemPulse>
      )}

      {/* Operational areas */}
      {showOps && (<div className="space-y-3" data-testid="section-ops-central">
        <OpAreaCard
          label="Inventory"
          Icon={Package}
          color="blue"
          stat={`${totalLots.toLocaleString()} lots · ${totalPcs.toLocaleString()} pcs`}
          alerts={urgentAlerts.filter(a => ['inv-fail', 'scan', 'underpriced', 'channel-fail'].includes(a.id) || a.id.startsWith('ch-'))}
          onClick={() => onNavigate?.('inventory')}
          isActive={activeSection === 'inventory'}
          channelNum="01"
          channelHex="#1B7CE5"
          flashReport={flashReports?.inventory ?? null}
          schedulerNextRunAt={schedulerNextRunAt}
          schedulerEnabled={schedulerEnabled}
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
          alerts={urgentAlerts.filter(a => a.id === 'pending' || a.id === 'order-fail' || a.id === 'qty-sync-fail')}
          onClick={() => onNavigate?.('orders')}
          isActive={activeSection === 'orders'}
          channelNum="02"
          channelHex="#E8611C"
          flashReport={flashReports?.orders ?? null}
          schedulerNextRunAt={schedulerNextRunAt}
          schedulerEnabled={schedulerEnabled}
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
          isActive={activeSection === 'marketing'}
          channelNum="03"
          channelHex="#F5C200"
          flashReport={flashReports?.market ?? null}
          schedulerNextRunAt={schedulerNextRunAt}
          schedulerEnabled={schedulerEnabled}
        />

        <OpAreaCard
          label="Insights"
          Icon={TrendingUp}
          color="green"
          stat={formatCurrency(totalRevenue)}
          alerts={urgentAlerts.filter(a => a.id === 'pom-fail')}
          onClick={() => onNavigate?.('sales')}
          isActive={activeSection === 'sales'}
          channelNum="04"
          channelHex="#00963C"
          flashReport={(() => {
            const p = flashReports?.pricing;
            const c = flashReports?.customer;
            if (!p && !c) return null;
            if (!p) return c ?? null;
            if (!c) return p ?? null;
            return p; // pricing takes priority for Insights card
          })()}
          schedulerNextRunAt={schedulerNextRunAt}
          schedulerEnabled={schedulerEnabled}
        />
      </div>)}

    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  X, CreditCard, Package, ShoppingCart, Globe, Sparkles, ScanSearch,
  ChevronDown, ChevronUp, Printer, AlertTriangle, CheckCircle2,
  Info, ArrowRight, TrendingUp, Tag, Clock, Heart,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const AI_TOOL_LABELS: Record<string, { label: string; icon: LucideIcon }> = {
  'elfie-agent':       { label: 'E.L.F.I.E.',         icon: Sparkles  },
  'business-insight':  { label: 'Business Insights',   icon: TrendingUp },
  'brickspotter-scan': { label: 'BrickSpotter',         icon: ScanSearch },
  'feedback-refine':   { label: 'Pricing Feedback',     icon: Tag        },
};

interface DimData {
  current: number;
  base: number;
  bump: number;
  byOperation?: Record<string, { requests: number; cost: number }>;
}

interface MonthUsage {
  label: string;
  periodStart: string;
  periodEnd: string;
  dimensions: {
    inventoryLots: DimData;
    ordersPerMonth: DimData;
    connectedStores: DimData;
    aiCalls: DimData;
    scans: DimData;
  };
  pricing: { basePrice: number; overageBump: number; monthlyCap: number };
  totalBumps: number;
  estimatedCost: number;
}

interface OrgUsageData {
  billingStartDate?: string | null;
  plan?: string;
  trialEndsAt?: string | null;
  subscriptionStatus?: string;
  period: { start: string; end: string };
  dimensions: {
    inventoryLots: DimData;
    ordersPerMonth: DimData;
    connectedStores: DimData;
    aiCalls: DimData;
    scans: DimData;
  };
  pricing: { basePrice: number; overageBump: number; monthlyCap: number };
}

const DIM_META: { key: keyof MonthUsage['dimensions']; label: string; icon: LucideIcon; unit: string }[] = [
  { key: 'inventoryLots',  label: 'Inventory lots',       icon: Package,       unit: 'lots' },
  { key: 'ordersPerMonth', label: 'Orders this month',    icon: ShoppingCart,  unit: 'orders' },
  { key: 'connectedStores',label: 'Connected stores',     icon: Globe,         unit: 'stores' },
  { key: 'aiCalls',        label: 'AI Tools',             icon: Sparkles,      unit: 'calls' },
  { key: 'scans',          label: 'BrickSpotter scans',   icon: ScanSearch,    unit: 'scans' },
];

function calcBumps(current: number, base: number, bump: number) {
  return current > base ? Math.ceil((current - base) / bump) : 0;
}

function DimensionRow({ label, icon: Icon, current, base, bump, overageBump }: {
  label: string; icon: LucideIcon; current: number; base: number; bump: number; overageBump: number;
}) {
  const overBase = current > base;
  const bumps = calcBumps(current, base, bump);
  const chargeCents = bumps * overageBump;
  const pct = Math.min(100, base > 0 ? (current / base) * 100 : 0);
  const approaching = !overBase && pct >= 80;

  const barColor = overBase
    ? 'bg-amber-400/60'
    : approaching ? 'bg-amber-400/70' : 'bg-green-500/50';

  return (
    <div className="py-2.5 flex items-start gap-3">
      <Icon className="w-3.5 h-3.5 mt-[3px] text-gray-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-sm text-gray-300">{label}</span>
          {overBase ? (
            <span className="text-amber-400 font-mono text-sm font-medium">
              +${(chargeCents / 100).toFixed(2)}
            </span>
          ) : (
            <span className="text-gray-500 text-xs">included</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-gray-700/50 overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
          </div>
          <span className={cn("text-xs tabular-nums whitespace-nowrap shrink-0", overBase ? 'text-amber-400' : 'text-gray-500')}>
            {current.toLocaleString()} / {base.toLocaleString()}
          </span>
        </div>
        {overBase && (
          <div className="mt-0.5 text-xs text-amber-400/70">
            {bumps} overage bump{bumps !== 1 ? 's' : ''} × ${(overageBump / 100).toFixed(0)}
          </div>
        )}
        {approaching && (
          <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-400/70">
            <AlertTriangle className="w-3 h-3" />
            Approaching limit
          </div>
        )}
      </div>
    </div>
  );
}

function AiToolsRow({ current, base, bump, overageBump, byOperation }: {
  current: number; base: number; bump: number; overageBump: number;
  byOperation?: Record<string, { requests: number; cost: number }>;
}) {
  const overBase = current > base;
  const bumps = calcBumps(current, base, bump);
  const chargeCents = bumps * overageBump;
  const pct = Math.min(100, base > 0 ? (current / base) * 100 : 0);
  const approaching = !overBase && pct >= 80;

  const TOOL_ORDER = ['elfie-agent', 'business-insight', 'feedback-refine', 'brickspotter-scan'];
  const toolEntries = byOperation
    ? [
        ...TOOL_ORDER.filter(k => byOperation[k]).map(k => [k, byOperation[k]] as [string, { requests: number; cost: number }]),
        ...Object.entries(byOperation).filter(([k]) => !TOOL_ORDER.includes(k) && k !== 'embedding' && k !== 'embedding-onboarding'),
      ]
    : [];

  // Static tool list used when no usage data exists yet
  const ALL_TOOLS = TOOL_ORDER.map(k => ({ key: k, ...AI_TOOL_LABELS[k] }));

  const hasToolBreakdown = toolEntries.length > 0;

  return (
    <div className="py-2.5 flex items-start gap-3">
      <Sparkles className="w-3.5 h-3.5 mt-[3px] text-gray-500 shrink-0" />
      <div className="flex-1 min-w-0">
        {/* Section header: label + pool total + charge */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-sm text-gray-300">AI Tools</span>
          {overBase ? (
            <span className="text-amber-400 font-mono text-sm font-medium">+${(chargeCents / 100).toFixed(2)}</span>
          ) : (
            <span className="text-gray-500 text-xs">included</span>
          )}
        </div>

        {hasToolBreakdown ? (
          /* Per-tool bars — each shows its share of the shared pool */
          <div className="space-y-1.5 mt-1">
            {toolEntries.map(([op, data]) => {
              const meta = AI_TOOL_LABELS[op];
              const ToolIcon = meta?.icon ?? Sparkles;
              const toolPct = Math.min(100, base > 0 ? (data.requests / base) * 100 : 0);
              const toolOverBase = current > base && data.requests > 0;
              const barCol = toolOverBase ? 'bg-amber-400/60' : toolPct >= 80 ? 'bg-amber-400/70' : 'bg-green-500/50';
              return (
                <div key={op}>
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="flex items-center gap-1.5 text-xs text-gray-400">
                      <ToolIcon className="w-3 h-3 shrink-0 text-gray-500" />
                      {meta?.label ?? op}
                    </span>
                    <span className="text-xs tabular-nums text-gray-600">{data.requests.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full bg-gray-700/50 overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all", barCol)} style={{ width: `${toolPct}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
            {/* Shared pool summary line */}
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-[10px] text-gray-600">Shared pool</span>
              <span className={cn("text-[10px] tabular-nums", overBase ? 'text-amber-400' : 'text-gray-600')}>
                {current.toLocaleString()} / {base.toLocaleString()} calls
              </span>
            </div>
          </div>
        ) : (
          /* Fallback: single aggregate bar + tool name chips */
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-gray-700/50 overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", overBase ? 'bg-amber-400/60' : approaching ? 'bg-amber-400/70' : 'bg-green-500/50')}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className={cn("text-xs tabular-nums whitespace-nowrap shrink-0", overBase ? 'text-amber-400' : 'text-gray-500')}>
                {current.toLocaleString()} / {base.toLocaleString()} calls
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {ALL_TOOLS.map(({ key, label, icon: ToolIcon }) => (
                <span key={key} className="flex items-center gap-1 text-[10px] text-gray-600 bg-gray-800/50 rounded px-1.5 py-0.5">
                  <ToolIcon className="w-2.5 h-2.5" />
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}

        {overBase && (
          <div className="mt-0.5 text-xs text-amber-400/70">
            {bumps} overage bump{bumps !== 1 ? 's' : ''} × ${(overageBump / 100).toFixed(0)}
          </div>
        )}
        {approaching && !hasToolBreakdown && (
          <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-400/70">
            <AlertTriangle className="w-3 h-3" />Approaching limit
          </div>
        )}
      </div>
    </div>
  );
}

function HowWeBillSection({ dimensions, pricing }: {
  dimensions: MonthUsage['dimensions'];
  pricing: MonthUsage['pricing'];
}) {
  const [open, setOpen] = useState(false);
  const baseDollars = pricing.basePrice / 100;
  const bumpDollars = pricing.overageBump / 100;
  const capDollars  = pricing.monthlyCap / 100;

  const dimRows: { key: keyof MonthUsage['dimensions']; icon: LucideIcon; label: string; unit: string }[] = [
    { key: 'inventoryLots',  icon: Package,     label: 'Inventory lots',     unit: 'lots'   },
    { key: 'ordersPerMonth', icon: ShoppingCart, label: 'Orders / month',     unit: 'orders' },
    { key: 'connectedStores',icon: Globe,        label: 'Connected stores',   unit: 'stores' },
    { key: 'aiCalls',        icon: Sparkles,     label: 'AI Tool calls',      unit: 'calls'  },
    { key: 'scans',          icon: ScanSearch,   label: 'BrickSpotter scans', unit: 'scans'  },
  ];

  return (
    <div className="mt-3 rounded-md border border-white/8 bg-gray-800/20 overflow-hidden">
      <button
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
        onClick={() => setOpen((o) => !o)}
        data-testid="button-how-we-bill-toggle"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
          <Info className="w-3.5 h-3.5 text-blue-400/70 shrink-0" />
          How your bill is calculated
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-gray-600 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-600 shrink-0" />}
      </button>

      {open && (
        <div className="px-3 pb-4 space-y-4 border-t border-white/6 pt-3">

          {/* What's included table */}
          <div>
            <p className="text-xs font-semibold text-gray-300 mb-2">
              What <span className="text-white">${baseDollars.toFixed(2)}/mo</span> includes
            </p>
            <div className="rounded-md border border-white/8 bg-gray-900/50 overflow-hidden divide-y divide-white/5">

              {/* All-features row */}
              <div className="flex items-center gap-2.5 px-3 py-2">
                <CheckCircle2 className="w-3 h-3 text-green-400/70 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-gray-300 font-medium">All platform features</span>
                  <span className="text-xs text-gray-500"> — no feature gates or tiers</span>
                </div>
                <span className="text-[10px] text-green-500/60 whitespace-nowrap shrink-0 font-medium">Fully unlocked</span>
              </div>

              {/* Column headers */}
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-1 bg-gray-900/30">
                <span className="text-[10px] text-gray-600 uppercase tracking-wider">Dimension</span>
                <span className="text-[10px] text-gray-600 uppercase tracking-wider text-right whitespace-nowrap">Free up to</span>
                <span className="text-[10px] text-gray-600 uppercase tracking-wider text-right whitespace-nowrap">Then per +${bumpDollars.toFixed(0)}</span>
              </div>

              {/* Dimension rows */}
              {dimRows.map(({ key, icon: Icon, label, unit }) => {
                const d = dimensions[key];
                const AI_TOOL_ORDER = ['elfie-agent', 'business-insight', 'feedback-refine', 'brickspotter-scan'];
                return (
                  <div key={key}>
                    <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 items-center px-3 py-2">
                      <span className="flex items-center gap-1.5 text-xs text-gray-400 min-w-0">
                        <Icon className="w-3 h-3 text-gray-600 shrink-0" />
                        {label}
                      </span>
                      <span className="text-xs text-gray-200 font-medium tabular-nums text-right whitespace-nowrap">
                        {d.base.toLocaleString()} {unit}
                      </span>
                      <span className="text-[11px] text-gray-500 tabular-nums text-right whitespace-nowrap">
                        +{d.bump.toLocaleString()} {unit}
                      </span>
                    </div>
                    {/* AI tools sub-row — shows which tools count toward the quota */}
                    {key === 'aiCalls' && (
                      <div className="px-3 pb-2.5 flex flex-wrap gap-1">
                        {AI_TOOL_ORDER.map((op) => {
                          const meta = AI_TOOL_LABELS[op];
                          const ToolIcon = meta?.icon ?? Sparkles;
                          return (
                            <span key={op} className="flex items-center gap-1 text-[10px] text-gray-600 bg-gray-800/60 rounded px-1.5 py-0.5">
                              <ToolIcon className="w-2.5 h-2.5" />
                              {meta?.label ?? op}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* "When will I be charged?" quick reference */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-300">When does my bill go up?</p>
            <p className="text-xs text-gray-500 leading-relaxed">
              Each dimension is tracked independently. As soon as usage in one dimension crosses its threshold,
              a <span className="text-gray-300 font-medium">${bumpDollars.toFixed(2)} bump</span> is added.
              Every additional full block over that costs another ${bumpDollars.toFixed(2)}.
            </p>
            {/* Quick per-dimension trigger summary */}
            <div className="rounded-md border border-white/6 bg-gray-900/40 divide-y divide-white/5 overflow-hidden mt-2">
              {dimRows.map(({ key, icon: Icon, label, unit }) => {
                const d = dimensions[key];
                const t1 = d.base + 1;
                const t2 = d.base + d.bump + 1;
                return (
                  <div key={key} className="flex items-center gap-2 px-3 py-1.5">
                    <Icon className="w-3 h-3 text-gray-600 shrink-0" />
                    <span className="text-[11px] text-gray-500 flex-1">{label}</span>
                    <span className="text-[11px] text-gray-600 tabular-nums text-right whitespace-nowrap">
                      {t1.toLocaleString()}+ {unit} → +${bumpDollars.toFixed(2)} · {t2.toLocaleString()}+ → +${(bumpDollars * 2).toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cap */}
          <div className="flex items-start gap-2 rounded-md border border-green-500/15 bg-green-500/5 px-3 py-2.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-400/70 shrink-0 mt-0.5" />
            <p className="text-xs text-gray-400 leading-relaxed">
              <span className="text-green-400 font-medium">Monthly cap: ${capDollars.toFixed(2)}</span> — your bill
              will never exceed this amount. Once you hit the cap, all additional usage that month is free.
            </p>
          </div>

          {/* Example */}
          <div className="rounded border border-white/6 bg-gray-900/40 px-3 py-2.5">
            <p className="text-xs font-semibold text-gray-400 mb-1.5">Example</p>
            <div className="text-xs text-gray-500 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <ArrowRight className="w-2.5 h-2.5 text-gray-600 shrink-0" />
                <span>You have {(dimensions.inventoryLots.base + dimensions.inventoryLots.bump).toLocaleString()} inventory lots (threshold is {dimensions.inventoryLots.base.toLocaleString()})</span>
              </div>
              <div className="flex items-center gap-1.5 pl-4">
                <span className="text-gray-600">→ {dimensions.inventoryLots.bump.toLocaleString()} over = 1 bump = +${bumpDollars.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <ArrowRight className="w-2.5 h-2.5 text-gray-600 shrink-0" />
                <span>Everything else within base limits</span>
              </div>
              <div className="flex items-center gap-1.5 pl-4">
                <span className="text-gray-600">→ Total: ${baseDollars.toFixed(2)} + ${bumpDollars.toFixed(2)} = ${(baseDollars + bumpDollars).toFixed(2)}/mo</span>
              </div>
            </div>
          </div>

          <p className="text-[10px] text-gray-600 leading-relaxed">
            Usage counts are updated in real time. The estimated total on this bill reflects usage
            as of the period shown. Unused capacity does not roll over to the next month.
          </p>
        </div>
      )}
    </div>
  );
}

function BillCard({
  label, periodStart, periodEnd, dimensions, pricing, printable,
}: {
  label: string;
  periodStart: string;
  periodEnd: string;
  dimensions: MonthUsage['dimensions'];
  pricing: MonthUsage['pricing'];
  printable?: boolean;
}) {
  let totalBumps = 0;
  const overageLines: { label: string; bumps: number; charge: number }[] = [];

  for (const meta of DIM_META) {
    const d = dimensions[meta.key];
    const bumps = calcBumps(d.current, d.base, d.bump);
    if (bumps > 0) {
      totalBumps += bumps;
      overageLines.push({ label: meta.label, bumps, charge: bumps * pricing.overageBump });
    }
  }

  const overageTotal = Math.min(totalBumps * pricing.overageBump, pricing.monthlyCap - pricing.basePrice);
  const total = Math.min(pricing.basePrice + totalBumps * pricing.overageBump, pricing.monthlyCap);

  const start = new Date(periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const end   = new Date(periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <>
    <div className={cn("rounded-md border border-white/8 bg-gray-800/40", printable && "print:border-gray-300 print:bg-white")}>
      {/* Period header */}
      <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-200">{label}</div>
          <div className="text-xs text-gray-500 mt-0.5">{start} – {end}</div>
        </div>
        <div className={cn("text-lg font-bold tabular-nums", totalBumps > 0 ? 'text-amber-400' : 'text-gray-100')}>
          ${(total / 100).toFixed(2)}
        </div>
      </div>

      {/* Base plan fee */}
      <div className="px-4 pt-3 pb-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Base Platform Fee</span>
          <span className="text-sm font-mono text-gray-300">${(pricing.basePrice / 100).toFixed(2)}</span>
        </div>
        <div className="divide-y divide-white/5">
          {DIM_META.map((meta) =>
            meta.key === 'aiCalls' ? (
              <AiToolsRow
                key="aiCalls"
                {...dimensions.aiCalls}
                overageBump={pricing.overageBump}
              />
            ) : (
              <DimensionRow
                key={meta.key}
                label={meta.label}
                icon={meta.icon}
                {...dimensions[meta.key]}
                overageBump={pricing.overageBump}
              />
            )
          )}
        </div>
      </div>

      {/* Overage section */}
      <div className="px-4 pt-3 pb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Overage Charges</span>
          <span className={cn("text-sm font-mono", overageTotal > 0 ? 'text-amber-400 font-semibold' : 'text-gray-500')}>
            {overageTotal > 0 ? `+$${(overageTotal / 100).toFixed(2)}` : '$0.00'}
          </span>
        </div>
        {overageLines.length > 0 ? (
          <div className="space-y-1">
            {overageLines.map((line) => (
              <div key={line.label} className="flex items-center justify-between text-sm">
                <span className="text-gray-400">{line.label} ({line.bumps} bump{line.bumps !== 1 ? 's' : ''})</span>
                <span className="text-amber-400 font-mono">+${(line.charge / 100).toFixed(2)}</span>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-xs text-gray-600 italic">None this period</span>
        )}
      </div>

      {/* Total footer */}
      <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between bg-gray-800/60 rounded-b-md">
        <div>
          <span className="text-sm font-semibold text-gray-200">Total</span>
          {total >= pricing.monthlyCap && (
            <div className="text-xs text-green-400 mt-0.5">Monthly cap applied</div>
          )}
        </div>
        <span className={cn("text-base font-bold tabular-nums font-mono", totalBumps > 0 ? 'text-amber-400' : 'text-gray-100')}>
          ${(total / 100).toFixed(2)}
        </span>
      </div>
    </div>

    {/* Billing explanation — lives beneath each bill card */}
    <HowWeBillSection dimensions={dimensions} pricing={pricing} />
  </>
  );
}

function TrialCallout({ plan, trialEndsAt }: { plan?: string; trialEndsAt?: string | null }) {
  if (plan !== 'trial') return null;

  const now = new Date();
  const endsAt = trialEndsAt ? new Date(trialEndsAt) : null;
  const expired = endsAt ? endsAt < now : false;
  const daysLeft = endsAt && !expired
    ? Math.ceil((endsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const deletionDate = endsAt
    ? new Date(endsAt.getTime() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  const trialEndLabel = endsAt
    ? endsAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  /* ── Expired ─────────────────────────────────────────────────── */
  if (expired) {
    return (
      <div className="rounded-md border border-gray-700/50 bg-gray-800/30 p-4 space-y-3">
        <div className="flex items-start gap-2.5">
          <Heart className="w-4 h-4 text-gray-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-300">Your free trial has ended</p>
            <p className="text-xs text-gray-500 leading-relaxed">
              We hope you've seen the value E.L.F.I.E. can bring to your store. We'd love for you to
              become a customer and keep the momentum going.
            </p>
            {deletionDate && (
              <p className="text-xs text-amber-500/80 leading-relaxed pt-1">
                Your store data will be kept until <span className="font-medium">{deletionDate}</span>, then
                permanently removed. Subscribe before then to keep everything intact.
              </p>
            )}
          </div>
        </div>
        <Button
          className="w-full bg-purple-700"
          size="sm"
          data-testid="button-trial-expired-subscribe"
        >
          Subscribe to keep your data
        </Button>
      </div>
    );
  }

  /* ── Urgent: ≤3 days ─────────────────────────────────────────── */
  if (daysLeft !== null && daysLeft <= 3) {
    return (
      <div className="rounded-md border border-red-900/40 bg-red-950/20 p-4 space-y-3">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-red-200">
              Trial ends in {daysLeft === 1 ? '1 day' : `${daysLeft} days`}
            </p>
            <p className="text-xs text-gray-400 leading-relaxed">
              Subscribe now to avoid interruption. Your usage data, inventory, and store connections
              will carry over seamlessly — billing starts when your trial ends{trialEndLabel ? ` on ${trialEndLabel}` : ''}.
            </p>
          </div>
        </div>
        <Button
          className="w-full bg-purple-700"
          size="sm"
          data-testid="button-trial-urgent-subscribe"
        >
          Subscribe now — billing starts {trialEndLabel ?? 'after trial ends'}
        </Button>
      </div>
    );
  }

  /* ── Warning: 4–7 days ───────────────────────────────────────── */
  if (daysLeft !== null && daysLeft <= 7) {
    return (
      <div className="rounded-md border border-amber-800/30 bg-amber-950/15 p-4 space-y-3">
        <div className="flex items-start gap-2.5">
          <Clock className="w-4 h-4 text-amber-400/80 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-amber-200">Trial ending in {daysLeft} days</p>
            <p className="text-xs text-gray-400 leading-relaxed">
              Subscribe before your trial ends{trialEndLabel ? ` on ${trialEndLabel}` : ''} to keep your
              data and avoid any disruption to your store sync and automations.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          className="w-full border-amber-700/40"
          size="sm"
          data-testid="button-trial-warning-subscribe"
        >
          Subscribe — billing starts when trial ends
        </Button>
      </div>
    );
  }

  /* ── Soft: >7 days or no known end date ─────────────────────── */
  return (
    <div className="rounded-md border border-blue-800/25 bg-blue-950/10 px-4 py-3 space-y-2">
      <div className="flex items-start gap-2.5">
        <Info className="w-3.5 h-3.5 text-blue-400/70 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-blue-200/80">
            You're on a free trial{trialEndLabel ? `, ending ${trialEndLabel}` : ''}
          </p>
          <p className="text-xs text-gray-500 leading-relaxed">
            Usage above shows what your bill would be if you were a subscriber. Billing only starts
            after your trial ends — nothing is charged during the trial.
          </p>
        </div>
      </div>
      <button
        className="text-xs text-blue-400/70 hover:text-blue-300 transition-colors"
        data-testid="button-trial-soft-subscribe"
      >
        Subscribe now and lock in your rate →
      </button>
    </div>
  );
}

function CurrentBillingTab() {
  const { data: usage, isLoading } = useQuery<OrgUsageData>({ queryKey: ['/api/org/usage'] });
  const [cancelConfirm, setCancelConfirm] = useState(false);

  if (isLoading) {
    return <div className="flex items-center justify-center py-16 text-gray-500 text-sm">Loading…</div>;
  }
  if (!usage) {
    return <div className="flex items-center justify-center py-16 text-gray-500 text-sm">No billing data available.</div>;
  }

  const now = new Date();
  const label = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const isTrial = usage.plan === 'trial';

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        {isTrial
          ? 'Usage shown below is what your bill would look like as a subscriber. Nothing is charged during your trial.'
          : 'Usage resets at the start of each calendar month. Charges are estimates based on current usage.'
        }
      </p>
      <BillCard
        label={label}
        periodStart={usage.period.start}
        periodEnd={usage.period.end}
        dimensions={usage.dimensions}
        pricing={usage.pricing}
      />
      <p className="text-xs text-gray-600 text-center">
        Monthly cap: ${(usage.pricing.monthlyCap / 100).toFixed(2)} · Overage: ${(usage.pricing.overageBump / 100).toFixed(2)}/bump
      </p>

      {/* Trial callout — shown for trial orgs; replaces the cancel link */}
      <TrialCallout plan={usage.plan} trialEndsAt={usage.trialEndsAt} />

      {/* Cancel subscription — only for paying subscribers */}
      {!isTrial && <div className="pt-4 border-t border-gray-800">
        {!cancelConfirm ? (
          <div className="flex justify-center">
            <button
              onClick={() => setCancelConfirm(true)}
              className="text-xs text-gray-600 hover:text-red-400 transition-colors"
              data-testid="button-cancel-subscription-prompt"
            >
              Cancel subscription
            </button>
          </div>
        ) : (
          <div className="rounded-md border border-red-900/40 bg-red-950/20 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-red-200">Cancel your subscription?</p>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Your access will remain active until the end of your current billing period. After that, your account will revert to read-only mode and inventory sync will stop.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setCancelConfirm(false)}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1"
                data-testid="button-cancel-subscription-nevermind"
              >
                Never mind
              </button>
              <Button
                variant="destructive"
                size="sm"
                data-testid="button-cancel-subscription-confirm"
              >
                Yes, cancel subscription
              </Button>
            </div>
          </div>
        )}
      </div>}
    </div>
  );
}

function InvoiceRow({ month }: { month: MonthUsage }) {
  const [expanded, setExpanded] = useState(false);

  const handlePrint = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    const start = new Date(month.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const end = new Date(month.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const totalCents = month.estimatedCost;
    const overageCents = Math.min(month.totalBumps * month.pricing.overageBump, month.pricing.monthlyCap - month.pricing.basePrice);
    const dimRows = DIM_META.map((m) => {
      const d = month.dimensions[m.key];
      const bumps = calcBumps(d.current, d.base, d.bump);
      const charge = bumps * month.pricing.overageBump;
      return `<tr><td>${m.label}</td><td>${d.current.toLocaleString()} / ${d.base.toLocaleString()}</td><td>${bumps > 0 ? '+$' + (charge / 100).toFixed(2) : 'Included'}</td></tr>`;
    }).join('');
    win.document.write(`<!DOCTYPE html><html><head><title>Invoice – ${month.label}</title>
      <style>body{font-family:sans-serif;max-width:600px;margin:40px auto;color:#222}
      h1{font-size:18px}table{width:100%;border-collapse:collapse;margin:16px 0}
      th,td{text-align:left;padding:8px;border-bottom:1px solid #ddd}th{font-weight:600}
      .total{font-size:16px;font-weight:700;text-align:right;margin-top:8px}
      .meta{font-size:12px;color:#666;margin-bottom:16px}</style></head><body>
      <h1>E.L.F.I.E. Invoice — ${month.label}</h1>
      <p class="meta">Billing period: ${start} – ${end}</p>
      <table><tr><th>Item</th><th>Usage</th><th>Charge</th></tr>
      <tr><td colspan="2">Base Platform Fee</td><td>$${(month.pricing.basePrice / 100).toFixed(2)}</td></tr>
      ${dimRows}
      <tr><td colspan="2"><strong>Overage Charges</strong></td><td>${overageCents > 0 ? '+$' + (overageCents / 100).toFixed(2) : '$0.00'}</td></tr>
      </table>
      <p class="total">Total: $${(totalCents / 100).toFixed(2)}</p>
      <script>window.print();window.onafterprint=()=>window.close();</script></body></html>`);
    win.document.close();
  };

  const total = month.estimatedCost;
  const hasOverage = month.totalBumps > 0;

  return (
    <div className="rounded-md border border-white/8 bg-gray-800/30 overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover-elevate"
        onClick={() => setExpanded((e) => !e)}
        data-testid={`invoice-row-${month.periodStart}`}
      >
        <CheckCircle2 className="w-4 h-4 text-green-500/70 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-200 font-medium">{month.label}</div>
          {hasOverage && (
            <div className="text-xs text-amber-400/80 mt-0.5">{month.totalBumps} overage bump{month.totalBumps !== 1 ? 's' : ''}</div>
          )}
        </div>
        <span className={cn("font-mono text-sm font-semibold tabular-nums shrink-0", hasOverage ? 'text-amber-400' : 'text-gray-200')}>
          ${(total / 100).toFixed(2)}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="shrink-0"
          onClick={(e) => { e.stopPropagation(); handlePrint(); }}
          data-testid={`button-print-invoice-${month.periodStart}`}
          title="Print invoice"
        >
          <Printer className="w-3.5 h-3.5" />
        </Button>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-gray-500 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
        )}
      </div>
      {expanded && (
        <div className="border-t border-white/8 px-4 pb-4 pt-3">
          <BillCard
            label={month.label}
            periodStart={month.periodStart}
            periodEnd={month.periodEnd}
            dimensions={month.dimensions}
            pricing={month.pricing}
            printable
          />
        </div>
      )}
    </div>
  );
}

function HistoryTab() {
  const { data, isLoading } = useQuery<{ months: MonthUsage[] }>({ queryKey: ['/api/org/billing/history'] });

  if (isLoading) {
    return <div className="flex items-center justify-center py-16 text-gray-500 text-sm">Loading…</div>;
  }

  const months = data?.months ?? [];

  if (months.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
        <CreditCard className="w-8 h-8 text-gray-600" />
        <p className="text-gray-500 text-sm">No previous invoices yet.</p>
        <p className="text-gray-600 text-xs">Invoices appear here after each completed billing month.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 mb-3">
        Click any month to expand the full breakdown. Use the print icon to generate a printable invoice.
      </p>
      {months.map((m) => (
        <InvoiceRow key={m.periodStart} month={m} />
      ))}
    </div>
  );
}

export function BillingDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg flex flex-col gap-0 p-0 bg-gray-950 border-white/10 overflow-hidden"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
        data-testid="sheet-billing-drawer"
      >
        <SheetHeader className="flex flex-row items-center justify-between px-4 py-3 border-b border-white/10 gap-2 flex-wrap flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <CreditCard className="w-5 h-5 text-blue-400 shrink-0" />
            <SheetTitle className="text-sm font-semibold text-gray-200">Payments & Billing</SheetTitle>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-billing-drawer">
            <X className="w-4 h-4" />
          </Button>
        </SheetHeader>

        <Tabs defaultValue="current" className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="px-4 pb-0 pt-2 border-b border-white/8 flex-shrink-0">
            <TabsList className="bg-gray-800/60 h-8 gap-1">
              <TabsTrigger value="current" className="text-xs h-6" data-testid="tab-current-billing">
                Current Billing
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs h-6" data-testid="tab-previous-invoices">
                Previous Invoices
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="current" className="flex-1 min-h-0 overflow-y-auto px-4 py-4 mt-0" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <CurrentBillingTab />
          </TabsContent>
          <TabsContent value="history" className="flex-1 min-h-0 overflow-y-auto px-4 py-4 mt-0" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <HistoryTab />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ToolDrawer } from "@/components/ui/tool-drawer";
import { cn } from "@/lib/utils";
import {
  CreditCard, Package, ShoppingCart, Globe, Sparkles, ScanSearch,
  ChevronDown, ChevronUp, Printer, AlertTriangle, CheckCircle2,
  Info, ArrowRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface DimData { current: number; base: number; bump: number }

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
  { key: 'aiCalls',        label: 'AI calls',             icon: Sparkles,      unit: 'calls' },
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

function HowWeBillSection({ dimensions, pricing }: {
  dimensions: MonthUsage['dimensions'];
  pricing: MonthUsage['pricing'];
}) {
  const [open, setOpen] = useState(false);
  const base = pricing.basePrice / 100;
  const bump = pricing.overageBump / 100;
  const cap  = pricing.monthlyCap / 100;

  const dimExplainers: { key: keyof MonthUsage['dimensions']; icon: LucideIcon; what: string }[] = [
    { key: 'inventoryLots',  icon: Package,      what: 'active listing lots in your BrickLink store' },
    { key: 'ordersPerMonth', icon: ShoppingCart,  what: 'orders received and processed this month' },
    { key: 'connectedStores',icon: Globe,         what: 'selling channels connected to E.L.F.I.E.' },
    { key: 'aiCalls',        icon: Sparkles,      what: 'E.L.F.I.E. AI agent, Business Insights & analysis calls' },
    { key: 'scans',          icon: ScanSearch,    what: 'BrickSpotter physical part identification scans' },
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

          {/* Model overview */}
          <div>
            <p className="text-xs font-semibold text-gray-300 mb-1.5">Pay As You Grow</p>
            <p className="text-xs text-gray-500 leading-relaxed">
              Your plan starts at a flat <span className="text-gray-300 font-medium">${base.toFixed(2)}/mo</span> base fee that
              covers all five usage dimensions up to their included limits. If you exceed any limit, we
              add a small <span className="text-gray-300 font-medium">${bump.toFixed(2)} bump</span> per
              overage unit — one bump per dimension, per period. Your bill can never exceed{' '}
              <span className="text-gray-300 font-medium">${cap.toFixed(2)}/mo</span> regardless of how
              many bumps occur.
            </p>
          </div>

          {/* How bumps work */}
          <div>
            <p className="text-xs font-semibold text-gray-300 mb-1.5">How bumps work</p>
            <p className="text-xs text-gray-500 leading-relaxed mb-2">
              Each dimension has a <em>base limit</em> and a <em>bump size</em>. Every time your usage
              crosses another bump-sized unit above the base, one bump charge is added. Usage resets
              to zero at the start of each calendar month.
            </p>
            <div className="space-y-1.5">
              {dimExplainers.map(({ key, icon: Icon, what }) => {
                const d = dimensions[key];
                return (
                  <div key={key} className="flex items-start gap-2">
                    <Icon className="w-3 h-3 mt-0.5 text-gray-600 shrink-0" />
                    <div className="min-w-0">
                      <span className="text-xs text-gray-400">
                        {what.charAt(0).toUpperCase() + what.slice(1)}
                      </span>
                      <span className="text-xs text-gray-600">
                        {' '}— first {d.base.toLocaleString()} included, then +${bump.toFixed(0)}/bump per {d.bump.toLocaleString()} additional
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Example */}
          <div className="rounded border border-white/6 bg-gray-900/40 px-3 py-2.5">
            <p className="text-xs font-semibold text-gray-400 mb-1.5">Example</p>
            <div className="text-xs text-gray-500 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <ArrowRight className="w-2.5 h-2.5 text-gray-600 shrink-0" />
                <span>You have {(dimensions.inventoryLots.base + dimensions.inventoryLots.bump).toLocaleString()} inventory lots (base is {dimensions.inventoryLots.base.toLocaleString()})</span>
              </div>
              <div className="flex items-center gap-1.5 pl-4">
                <span className="text-gray-600">→ {dimensions.inventoryLots.bump.toLocaleString()} over the limit = 1 bump = +${bump.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <ArrowRight className="w-2.5 h-2.5 text-gray-600 shrink-0" />
                <span>Everything else within base limits</span>
              </div>
              <div className="flex items-center gap-1.5 pl-4">
                <span className="text-gray-600">→ Total: ${base.toFixed(2)} + ${bump.toFixed(2)} = ${(base + bump).toFixed(2)}/mo</span>
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
          {DIM_META.map((meta) => (
            <DimensionRow
              key={meta.key}
              label={meta.label}
              icon={meta.icon}
              {...dimensions[meta.key]}
              overageBump={pricing.overageBump}
            />
          ))}
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

function CurrentBillingTab() {
  const { data: usage, isLoading } = useQuery<OrgUsageData>({ queryKey: ['/api/org/usage'] });

  if (isLoading) {
    return <div className="flex items-center justify-center py-16 text-gray-500 text-sm">Loading…</div>;
  }
  if (!usage) {
    return <div className="flex items-center justify-center py-16 text-gray-500 text-sm">No billing data available.</div>;
  }

  const now = new Date();
  const label = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Usage resets at the start of each calendar month. Charges are estimates based on current usage.
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
        className="w-full sm:max-w-lg p-0 flex flex-col bg-gray-950 border-white/10"
        data-testid="sheet-billing-drawer"
      >
        <ToolDrawer
          icon={CreditCard}
          iconColor="text-blue-400"
          title="Payments & Billing"
          onClose={onClose}
          closeTestId="button-close-billing-drawer"
          contentClassName="flex-1 overflow-hidden p-0 flex flex-col"
        >
          <Tabs defaultValue="current" className="flex flex-col flex-1 overflow-hidden">
            <div className="px-4 pb-0 pt-2 border-b border-white/8 shrink-0">
              <TabsList className="bg-gray-800/60 h-8 gap-1">
                <TabsTrigger value="current" className="text-xs h-6" data-testid="tab-current-billing">
                  Current Billing
                </TabsTrigger>
                <TabsTrigger value="history" className="text-xs h-6" data-testid="tab-previous-invoices">
                  Previous Invoices
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="current" className="flex-1 overflow-y-auto px-4 py-4 mt-0">
              <CurrentBillingTab />
            </TabsContent>
            <TabsContent value="history" className="flex-1 overflow-y-auto px-4 py-4 mt-0">
              <HistoryTab />
            </TabsContent>
          </Tabs>
        </ToolDrawer>
      </SheetContent>
    </Sheet>
  );
}

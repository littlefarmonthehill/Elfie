import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  X, CreditCard, ShoppingCart, TrendingUp, CheckCircle2,
  ChevronDown, ChevronUp, Printer, AlertTriangle,
  Info, ArrowRight, Clock, Heart, Calendar,
} from "lucide-react";

interface SalesData {
  grossSalesCents: number;
  adjustmentsCents: number;
  netSalesCents: number;
  includedInBaseCents: number;
  salesOverBaseCents: number;
  salesPercentage: number;
  salesFeeCents: number;
}

interface Pricing {
  basePrice: number;
  salesPercentage: number;
  salesIncludedInBase: number;
}

interface OrgUsageData {
  orgId?: string;
  billingStartDate?: string | null;
  plan?: string;
  trialEndsAt?: string | null;
  subscriptionStatus?: string;
  period: { start: string; end: string };
  sales: SalesData;
  pricing: Pricing;
  estimatedTotal: number;
}

interface MonthInvoice {
  label: string;
  periodStart: string;
  periodEnd: string;
  sales: SalesData;
  pricing: Pricing;
  estimatedCost: number;
}

function fmtDollars(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SalesFeeCard({ sales, pricing, basePrice }: { sales: SalesData; pricing: Pricing; basePrice: number }) {
  const hasOverBase = sales.salesOverBaseCents > 0;
  const pct = Math.min(100, sales.includedInBaseCents > 0
    ? (sales.netSalesCents / sales.includedInBaseCents) * 100
    : 0);
  const barColor = hasOverBase ? 'bg-amber-400/60' : pct >= 80 ? 'bg-amber-400/50' : 'bg-green-500/50';

  return (
    <div className="rounded-md border border-white/8 bg-gray-800/40">
      <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-200">This billing period</div>
          <div className="text-xs text-gray-500 mt-0.5">Sales activity drives your fee</div>
        </div>
        <div className={cn("text-lg font-bold tabular-nums font-mono", hasOverBase ? 'text-amber-400' : 'text-gray-100')}>
          {fmtDollars(basePrice + sales.salesFeeCents)}
        </div>
      </div>

      <div className="px-4 pt-3 pb-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <ShoppingCart className="w-3.5 h-3.5 text-gray-500 shrink-0" />
              Gross sales
            </span>
            <span className="text-xs text-gray-200 font-mono tabular-nums">{fmtDollars(sales.grossSalesCents)}</span>
          </div>
          {sales.adjustmentsCents !== 0 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-500 pl-5">Adjustments / refunds</span>
              <span className={cn("text-xs font-mono tabular-nums", sales.adjustmentsCents < 0 ? 'text-red-400/80' : 'text-green-400/80')}>
                {sales.adjustmentsCents >= 0 ? '+' : ''}{fmtDollars(sales.adjustmentsCents)}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-white/6 pt-2">
            <span className="text-xs font-medium text-gray-300 pl-5">Net sales</span>
            <span className="text-xs text-gray-100 font-mono font-semibold tabular-nums">{fmtDollars(sales.netSalesCents)}</span>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-xs text-gray-500">
              {fmtDollars(sales.includedInBaseCents)} included in base
            </span>
            <span className={cn("text-xs tabular-nums font-mono", hasOverBase ? 'text-amber-400' : 'text-gray-500')}>
              {fmtDollars(sales.netSalesCents)} / {fmtDollars(sales.includedInBaseCents)}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-700/50 overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
          </div>
          {pct >= 80 && !hasOverBase && (
            <div className="mt-1 flex items-center gap-1 text-xs text-amber-400/70">
              <AlertTriangle className="w-3 h-3" />
              Approaching included threshold
            </div>
          )}
        </div>

        {hasOverBase && (
          <div className="rounded-md border border-amber-500/20 bg-amber-950/15 px-3 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-amber-300/80">Sales over threshold</span>
              <span className="text-xs text-amber-300 font-mono tabular-nums">{fmtDollars(sales.salesOverBaseCents)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-amber-300/60">× {sales.salesPercentage}% fee</span>
              <span className="text-xs text-amber-400 font-mono font-semibold tabular-nums">+{fmtDollars(sales.salesFeeCents)}</span>
            </div>
          </div>
        )}

        <div className="border-t border-white/8 pt-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-400">Base platform fee</span>
            <span className="text-xs text-gray-300 font-mono tabular-nums">{fmtDollars(basePrice)}</span>
          </div>
          {sales.salesFeeCents > 0 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-amber-400/80">Sales fee</span>
              <span className="text-xs text-amber-400 font-mono tabular-nums">+{fmtDollars(sales.salesFeeCents)}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs font-semibold text-gray-200">Estimated total</span>
            <span className={cn("text-sm font-bold font-mono tabular-nums", hasOverBase ? 'text-amber-400' : 'text-gray-100')}>
              {fmtDollars(basePrice + sales.salesFeeCents)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HowWeBillSection({ pricing }: { pricing: Pricing }) {
  const [open, setOpen] = useState(false);
  const baseDollars = pricing.basePrice / 100;
  const includedDollars = pricing.salesIncludedInBase / 100;

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
          <div>
            <p className="text-xs font-semibold text-gray-300 mb-2">
              What <span className="text-white">${baseDollars.toFixed(2)}/mo</span> includes
            </p>
            <div className="rounded-md border border-white/8 bg-gray-900/50 overflow-hidden divide-y divide-white/5">
              <div className="flex items-center gap-2.5 px-3 py-2">
                <CheckCircle2 className="w-3 h-3 text-green-400/70 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-gray-300 font-medium">All platform features</span>
                  <span className="text-xs text-gray-500"> — no feature gates or tiers</span>
                </div>
                <span className="text-[10px] text-green-500/60 whitespace-nowrap shrink-0 font-medium">Fully unlocked</span>
              </div>
              <div className="flex items-center gap-2.5 px-3 py-2">
                <TrendingUp className="w-3 h-3 text-blue-400/60 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-gray-300 font-medium">First ${includedDollars.toLocaleString()} in net sales</span>
                  <span className="text-xs text-gray-500"> — no additional fee</span>
                </div>
                <span className="text-[10px] text-blue-500/60 whitespace-nowrap shrink-0 font-medium">Included</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-300">When does my bill go up?</p>
            <p className="text-xs text-gray-500 leading-relaxed">
              Only when your net sales exceed{' '}
              <span className="text-gray-300 font-medium">${includedDollars.toLocaleString()}</span> in a month.
              A <span className="text-gray-300 font-medium">{pricing.salesPercentage}% fee</span> applies to
              the amount above that threshold.
            </p>
          </div>

          <div className="rounded border border-white/6 bg-gray-900/40 px-3 py-2.5">
            <p className="text-xs font-semibold text-gray-400 mb-1.5">Example</p>
            <div className="text-xs text-gray-500 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <ArrowRight className="w-2.5 h-2.5 text-gray-600 shrink-0" />
                <span>You sell ${(includedDollars + 500).toLocaleString()} net this month</span>
              </div>
              <div className="flex items-center gap-1.5 pl-4">
                <span className="text-gray-600">
                  → $500 over threshold × {pricing.salesPercentage}% = +${(500 * pricing.salesPercentage / 100).toFixed(2)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <ArrowRight className="w-2.5 h-2.5 text-gray-600 shrink-0" />
                <span>Total: ${baseDollars.toFixed(2)} base + ${(500 * pricing.salesPercentage / 100).toFixed(2)} fee = ${(baseDollars + 500 * pricing.salesPercentage / 100).toFixed(2)}/mo</span>
              </div>
            </div>
          </div>

          <p className="text-[10px] text-gray-600 leading-relaxed">
            Net sales = gross sales minus any refunds or adjustments. Usage is calculated from actual BrickLink order data.
          </p>
        </div>
      )}
    </div>
  );
}

function BillCard({
  label, periodStart, periodEnd, sales, pricing, printable,
}: {
  label: string;
  periodStart: string;
  periodEnd: string;
  sales: SalesData;
  pricing: Pricing;
  printable?: boolean;
}) {
  const hasOverBase = sales.salesOverBaseCents > 0;
  const total = pricing.basePrice + sales.salesFeeCents;

  const start = new Date(periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const end   = new Date(periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const handlePrint = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Invoice – ${label}</title>
      <style>body{font-family:sans-serif;max-width:600px;margin:40px auto;color:#222}
      h1{font-size:18px}table{width:100%;border-collapse:collapse;margin:16px 0}
      th,td{text-align:left;padding:8px;border-bottom:1px solid #ddd}th{font-weight:600}
      .total{font-size:16px;font-weight:700;text-align:right;margin-top:8px}
      .meta{font-size:12px;color:#666;margin-bottom:16px}</style></head><body>
      <h1>E.L.F.I.E. Invoice — ${label}</h1>
      <p class="meta">Billing period: ${start} – ${end}</p>
      <table><tr><th>Item</th><th>Amount</th></tr>
      <tr><td>Base Platform Fee</td><td>${fmtDollars(pricing.basePrice)}</td></tr>
      <tr><td>Gross Sales</td><td>${fmtDollars(sales.grossSalesCents)}</td></tr>
      ${sales.adjustmentsCents !== 0 ? `<tr><td>Adjustments</td><td>${fmtDollars(sales.adjustmentsCents)}</td></tr>` : ''}
      <tr><td>Net Sales</td><td>${fmtDollars(sales.netSalesCents)}</td></tr>
      <tr><td>Included in Base</td><td>${fmtDollars(sales.includedInBaseCents)}</td></tr>
      <tr><td>Sales Over Threshold (× ${sales.salesPercentage}%)</td><td>${fmtDollars(sales.salesFeeCents)}</td></tr>
      </table>
      <p class="total">Total: ${fmtDollars(total)}</p>
      <script>window.print();window.onafterprint=()=>window.close();</script></body></html>`);
    win.document.close();
  };

  return (
    <>
      <div className={cn("rounded-md border border-white/8 bg-gray-800/40", printable && "print:border-gray-300 print:bg-white")}>
        <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-gray-200">{label}</div>
            <div className="text-xs text-gray-500 mt-0.5">{start} – {end}</div>
          </div>
          <div className={cn("text-lg font-bold tabular-nums font-mono", hasOverBase ? 'text-amber-400' : 'text-gray-100')}>
            {fmtDollars(total)}
          </div>
        </div>

        <div className="px-4 pt-3 pb-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Base Platform Fee</span>
            <span className="text-sm font-mono text-gray-300">{fmtDollars(pricing.basePrice)}</span>
          </div>

          <div className="divide-y divide-white/5 pb-1">
            <div className="py-2.5 flex items-center justify-between gap-3">
              <span className="text-sm text-gray-300">Gross sales</span>
              <span className="text-sm font-mono tabular-nums text-gray-200">{fmtDollars(sales.grossSalesCents)}</span>
            </div>
            {sales.adjustmentsCents !== 0 && (
              <div className="py-2.5 flex items-center justify-between gap-3">
                <span className="text-sm text-gray-400">Adjustments / refunds</span>
                <span className={cn("text-sm font-mono tabular-nums", sales.adjustmentsCents < 0 ? 'text-red-400/80' : 'text-green-400/80')}>
                  {sales.adjustmentsCents >= 0 ? '+' : ''}{fmtDollars(sales.adjustmentsCents)}
                </span>
              </div>
            )}
            <div className="py-2.5 flex items-center justify-between gap-3">
              <span className="text-sm text-gray-300 font-medium">Net sales</span>
              <span className="text-sm font-mono tabular-nums font-semibold text-gray-100">{fmtDollars(sales.netSalesCents)}</span>
            </div>
          </div>
        </div>

        <div className="px-4 pt-3 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Sales Fee</span>
            <span className={cn("text-sm font-mono", hasOverBase ? 'text-amber-400 font-semibold' : 'text-gray-500')}>
              {hasOverBase ? `+${fmtDollars(sales.salesFeeCents)}` : '$0.00'}
            </span>
          </div>
          {hasOverBase ? (
            <div className="text-xs text-gray-400 space-y-0.5">
              <div>{fmtDollars(sales.salesOverBaseCents)} over {fmtDollars(sales.includedInBaseCents)} threshold</div>
              <div className="text-gray-500">× {sales.salesPercentage}% = {fmtDollars(sales.salesFeeCents)}</div>
            </div>
          ) : (
            <span className="text-xs text-gray-600 italic">Under included threshold — no fee</span>
          )}
        </div>

        <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between bg-gray-800/60 rounded-b-md">
          <span className="text-sm font-semibold text-gray-200">Total</span>
          <div className="flex items-center gap-2">
            {printable && (
              <Button
                size="icon"
                variant="ghost"
                onClick={handlePrint}
                data-testid="button-print-invoice"
                title="Print invoice"
              >
                <Printer className="w-3.5 h-3.5" />
              </Button>
            )}
            <span className={cn("text-base font-bold tabular-nums font-mono", hasOverBase ? 'text-amber-400' : 'text-gray-100')}>
              {fmtDollars(total)}
            </span>
          </div>
        </div>
      </div>

      <HowWeBillSection pricing={pricing} />
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
        <Button className="w-full bg-purple-700" size="sm" data-testid="button-trial-expired-subscribe">
          Subscribe to keep your data
        </Button>
      </div>
    );
  }

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
        <Button className="w-full bg-purple-700" size="sm" data-testid="button-trial-urgent-subscribe">
          Subscribe now — billing starts {trialEndLabel ?? 'after trial ends'}
        </Button>
      </div>
    );
  }

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
        <Button variant="outline" className="w-full border-amber-700/40" size="sm" data-testid="button-trial-warning-subscribe">
          Subscribe — billing starts when trial ends
        </Button>
      </div>
    );
  }

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
          : 'Sales are tracked from your BrickLink orders. Charges are estimates based on current month data.'
        }
      </p>
      <BillCard
        label={label}
        periodStart={usage.period.start}
        periodEnd={usage.period.end}
        sales={usage.sales}
        pricing={usage.pricing}
      />

      <TrialCallout plan={usage.plan} trialEndsAt={usage.trialEndsAt} />

      {!isTrial && (
        <div className="pt-4 border-t border-gray-800">
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
                <Button variant="destructive" size="sm" data-testid="button-cancel-subscription-confirm">
                  Yes, cancel subscription
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InvoiceRow({ month, compact = false }: { month: MonthInvoice; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasOverBase = month.sales.salesOverBaseCents > 0;

  return (
    <div className={compact ? '' : 'rounded-md border border-white/8 bg-gray-800/30 overflow-hidden'}>
      <div
        className={cn(
          "flex items-center gap-3 px-4 cursor-pointer hover-elevate",
          compact ? "py-2.5 bg-gray-900/20" : "py-3",
        )}
        onClick={() => setExpanded((e) => !e)}
        data-testid={`invoice-row-${month.periodStart}`}
      >
        <CheckCircle2 className="w-3.5 h-3.5 text-green-500/60 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className={cn("font-medium text-gray-200", compact ? "text-xs" : "text-sm")}>{month.label}</div>
          {hasOverBase && (
            <div className="text-[10px] text-amber-400/70 mt-0.5">
              {fmtDollars(month.sales.netSalesCents)} net · +{fmtDollars(month.sales.salesFeeCents)} fee
            </div>
          )}
        </div>
        <span className={cn("font-mono font-semibold tabular-nums shrink-0", compact ? "text-xs" : "text-sm", hasOverBase ? 'text-amber-400' : 'text-gray-200')}>
          {fmtDollars(month.estimatedCost)}
        </span>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-gray-500 shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
        )}
      </div>
      {expanded && (
        <div className={cn("border-t border-white/8 px-4 pb-4 pt-3", compact ? "bg-gray-900/30" : "")}>
          <BillCard
            label={month.label}
            periodStart={month.periodStart}
            periodEnd={month.periodEnd}
            sales={month.sales}
            pricing={month.pricing}
            printable
          />
        </div>
      )}
    </div>
  );
}

interface YearGroup {
  year: number;
  months: MonthInvoice[];
  totalNetSalesCents: number;
  totalSalesFeeCents: number;
  totalBilled: number;
}

function YearSection({ group, defaultOpen }: { group: YearGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const hasFees = group.totalSalesFeeCents > 0;

  return (
    <div className="rounded-md border border-white/8 overflow-hidden">
      {/* Year header — clickable to expand/collapse */}
      <button
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 bg-gray-800/40 hover-elevate"
        onClick={() => setOpen((o) => !o)}
        data-testid={`year-section-${group.year}`}
      >
        <div className="flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-gray-500 shrink-0" />
          <span className="text-sm font-semibold text-gray-200">{group.year}</span>
          <span className="text-[10px] text-gray-500">{group.months.length} month{group.months.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className={cn("text-sm font-semibold tabular-nums font-mono", hasFees ? 'text-amber-400' : 'text-gray-200')}>
              {fmtDollars(group.totalBilled)}
            </div>
            <div className="text-[10px] text-gray-600 tabular-nums">
              {fmtDollars(group.totalNetSalesCents)} sales
            </div>
          </div>
          {open ? (
            <ChevronUp className="w-4 h-4 text-gray-500 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
          )}
        </div>
      </button>

      {open && (
        <div className="divide-y divide-white/5">
          {group.months.map((m) => (
            <InvoiceRow key={m.periodStart} month={m} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryTab() {
  const { data, isLoading } = useQuery<{ months: MonthInvoice[] }>({ queryKey: ['/api/org/billing/history'] });

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

  // Group months by year
  const yearMap = new Map<number, MonthInvoice[]>();
  for (const m of months) {
    const yr = new Date(m.periodStart).getFullYear();
    if (!yearMap.has(yr)) yearMap.set(yr, []);
    yearMap.get(yr)!.push(m);
  }
  const groups: YearGroup[] = Array.from(yearMap.entries())
    .sort(([a], [b]) => b - a)
    .map(([year, mons]) => ({
      year,
      months: mons,
      totalNetSalesCents: mons.reduce((s, m) => s + m.sales.netSalesCents, 0),
      totalSalesFeeCents: mons.reduce((s, m) => s + m.sales.salesFeeCents, 0),
      totalBilled: mons.reduce((s, m) => s + m.estimatedCost, 0),
    }));

  const allTimeNetSales = groups.reduce((s, g) => s + g.totalNetSalesCents, 0);
  const allTimeBilled = groups.reduce((s, g) => s + g.totalBilled, 0);
  const allTimeFees = groups.reduce((s, g) => s + g.totalSalesFeeCents, 0);
  const mostRecentYear = groups[0]?.year ?? 0;

  return (
    <div className="space-y-3">
      {/* All-time summary */}
      <div className="rounded-md border border-white/8 bg-gray-800/20 px-4 py-3 grid grid-cols-3 gap-3">
        <div className="text-center">
          <div className="text-sm font-bold text-white tabular-nums font-mono">{fmtDollars(allTimeBilled)}</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Total Paid</div>
        </div>
        <div className="text-center border-x border-white/8">
          <div className="text-sm font-bold text-white tabular-nums font-mono">{fmtDollars(allTimeNetSales)}</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Total Net Sales</div>
        </div>
        <div className="text-center">
          <div className={cn("text-sm font-bold tabular-nums font-mono", allTimeFees > 0 ? 'text-amber-400' : 'text-gray-300')}>
            {fmtDollars(allTimeFees)}
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">Sales Fees</div>
        </div>
      </div>

      <p className="text-xs text-gray-600">
        {months.length} months of history · click any year or month to expand
      </p>

      {groups.map((g) => (
        <YearSection key={g.year} group={g} defaultOpen={g.year === mostRecentYear} />
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

export { SalesFeeCard };
export type { OrgUsageData, SalesData, Pricing, MonthInvoice };

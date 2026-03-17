import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  X, CreditCard, ShoppingCart, ChevronDown, ChevronUp, Printer,
  AlertTriangle, CheckCircle2, Info, Clock, TrendingUp,
} from "lucide-react";

// ─── API response types ───────────────────────────────────────────────────────

interface PlanInfo {
  id: number;
  name: string;
  basePrice: number;
  salesPercentage: number;
  freeSalesThreshold: number;
}

interface BillingBreakdown {
  baseFee: number;
  salesFee: number;
  totalDue: number;
}

interface OrgUsageData {
  orgId: string;
  billingStartDate?: string | null;
  subscriptionStatus?: string;
  period: { start: string; end: string };
  plan: PlanInfo;
  monthlySalesCents: number;
  billing: BillingBreakdown;
}

interface MonthRecord {
  label: string;
  year: number;
  periodStart: string;
  periodEnd: string;
  monthlySalesCents: number;
  billing: BillingBreakdown;
  plan: Omit<PlanInfo, "id">;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cents(c: number) {
  return `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function salesLabel(cents_: number) {
  return `$${(cents_ / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Current billing card ─────────────────────────────────────────────────────

function SalesBillCard({ usage }: { usage: OrgUsageData }) {
  const { plan, monthlySalesCents, billing, period } = usage;
  const salesOverThreshold = Math.max(0, monthlySalesCents - plan.freeSalesThreshold);
  const aboveThreshold = monthlySalesCents > plan.freeSalesThreshold;
  const hasSalesFee = billing.salesFee > 0;

  const start = new Date(period.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const end   = new Date(period.end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const monthLabel = new Date(period.start).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="rounded-md border border-white/8 bg-gray-800/40">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-200">{monthLabel}</div>
          <div className="text-xs text-gray-500 mt-0.5">{start} – {end}</div>
        </div>
        <div className="text-xs text-gray-500">{plan.name}</div>
      </div>

      {/* Sales */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Sales This Period</span>
        </div>
        <div className="flex items-center gap-3 rounded-md bg-gray-900/40 border border-white/6 px-3 py-3">
          <ShoppingCart className="w-4 h-4 text-gray-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xl font-bold text-gray-100 font-mono tabular-nums">{salesLabel(monthlySalesCents)}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {aboveThreshold
                ? `${salesLabel(salesOverThreshold)} above your ${salesLabel(plan.freeSalesThreshold)} free threshold`
                : `Within your ${salesLabel(plan.freeSalesThreshold)} free threshold`
              }
            </div>
          </div>
          {aboveThreshold && (
            <TrendingUp className="w-4 h-4 text-purple-400/70 shrink-0" />
          )}
        </div>
      </div>

      {/* Billing breakdown */}
      <div className="px-4 pb-4">
        <div className="divide-y divide-white/5 rounded-md border border-white/6 bg-gray-900/40 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs text-gray-400">Base platform fee</span>
            <span className="text-xs font-mono text-gray-300">{cents(billing.baseFee)}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs text-gray-400">Sales fee ({plan.salesPercentage}%)</span>
            <span className={cn("text-xs font-mono", hasSalesFee ? 'text-purple-300' : 'text-gray-500')}>
              {hasSalesFee ? `+${cents(billing.salesFee)}` : '$0.00'}
            </span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 bg-gray-800/60">
            <span className="text-xs font-semibold text-gray-200">Estimated total</span>
            <span className={cn("text-sm font-mono font-bold", hasSalesFee ? 'text-purple-300' : 'text-gray-100')}>
              {cents(billing.totalDue)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Trial callout ────────────────────────────────────────────────────────────

function TrialCallout({ status, billingStartDate }: { status?: string; billingStartDate?: string | null }) {
  if (status !== 'trial') return null;
  const now = new Date();
  const startsAt = billingStartDate ? new Date(billingStartDate) : null;
  const isFuture = startsAt ? startsAt > now : false;

  return (
    <div className="rounded-md border border-blue-800/25 bg-blue-950/10 px-4 py-3 space-y-2">
      <div className="flex items-start gap-2.5">
        <Info className="w-3.5 h-3.5 text-blue-400/70 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-blue-200/80">
            {isFuture
              ? `You're on a free trial — billing starts ${startsAt!.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
              : "You're on a free trial"}
          </p>
          <p className="text-xs text-gray-500 leading-relaxed">
            The estimate above shows what you'd pay as a subscriber. Nothing is charged during your trial.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Print helper ─────────────────────────────────────────────────────────────

function printInvoice(month: MonthRecord) {
  const win = window.open('', '_blank');
  if (!win) return;
  const start = new Date(month.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const end   = new Date(month.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const salesDollars = (month.monthlySalesCents / 100).toFixed(2);
  const baseDollars  = (month.billing.baseFee  / 100).toFixed(2);
  const feeDollars   = (month.billing.salesFee / 100).toFixed(2);
  const totalDollars = (month.billing.totalDue / 100).toFixed(2);
  win.document.write(`<!DOCTYPE html><html><head><title>Invoice – ${month.label}</title>
    <style>body{font-family:sans-serif;max-width:600px;margin:40px auto;color:#222}
    h1{font-size:18px}table{width:100%;border-collapse:collapse;margin:16px 0}
    th,td{text-align:left;padding:8px;border-bottom:1px solid #ddd}th{font-weight:600}
    .total{font-size:16px;font-weight:700;text-align:right;margin-top:8px}
    .meta{font-size:12px;color:#666;margin-bottom:16px}</style></head><body>
    <h1>E.L.F.I.E. Invoice — ${month.label}</h1>
    <p class="meta">Billing period: ${start} – ${end} · Plan: ${month.plan.name}</p>
    <table><tr><th>Item</th><th>Detail</th><th>Charge</th></tr>
    <tr><td>Base platform fee</td><td>${month.plan.name}</td><td>$${baseDollars}</td></tr>
    <tr><td>Sales fee (${month.plan.salesPercentage}%)</td><td>$${salesDollars} GMV (threshold $${(month.plan.freeSalesThreshold / 100).toFixed(0)})</td><td>$${feeDollars}</td></tr>
    </table>
    <p class="total">Total: $${totalDollars}</p>
    <script>window.print();window.onafterprint=()=>window.close();</script></body></html>`);
  win.document.close();
}

// ─── Invoice row (history) ────────────────────────────────────────────────────

function InvoiceRow({ month }: { month: MonthRecord }) {
  const [expanded, setExpanded] = useState(false);
  const { billing, monthlySalesCents } = month;
  const hasSalesFee = billing.salesFee > 0;

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
          <div className="text-xs text-gray-500 mt-0.5">{salesLabel(monthlySalesCents)} in sales</div>
        </div>
        <span className={cn("font-mono text-sm font-semibold tabular-nums shrink-0", hasSalesFee ? 'text-purple-300' : 'text-gray-200')}>
          {cents(billing.totalDue)}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="shrink-0"
          onClick={(e) => { e.stopPropagation(); printInvoice(month); }}
          data-testid={`button-print-invoice-${month.periodStart}`}
          title="Print invoice"
        >
          <Printer className="w-3.5 h-3.5" />
        </Button>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-gray-500 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
        }
      </div>

      {expanded && (
        <div className="border-t border-white/8 px-4 pb-4 pt-3 space-y-2">
          <div className="divide-y divide-white/5 rounded-md border border-white/6 bg-gray-900/40 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-gray-400">Sales this month</span>
              <span className="text-xs font-mono text-gray-300">{salesLabel(monthlySalesCents)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-gray-400">Base platform fee</span>
              <span className="text-xs font-mono text-gray-300">{cents(billing.baseFee)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-gray-400">Sales fee ({month.plan.salesPercentage}%)</span>
              <span className={cn("text-xs font-mono", hasSalesFee ? 'text-purple-300' : 'text-gray-500')}>
                {hasSalesFee ? `+${cents(billing.salesFee)}` : '$0.00'}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-2 bg-gray-800/60">
              <span className="text-xs font-semibold text-gray-200">Total</span>
              <span className={cn("text-sm font-mono font-bold", hasSalesFee ? 'text-purple-300' : 'text-gray-100')}>
                {cents(billing.totalDue)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Year section (collapsible) ───────────────────────────────────────────────

function YearSection({ year, months, defaultOpen }: { year: number; months: MonthRecord[]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const yearTotal = months.reduce((s, m) => s + m.billing.totalDue, 0);
  const yearSales = months.reduce((s, m) => s + m.monthlySalesCents, 0);

  return (
    <div className="rounded-md border border-white/8 bg-gray-800/20 overflow-hidden">
      <button
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover-elevate text-left"
        onClick={() => setOpen((o) => !o)}
        data-testid={`year-section-${year}`}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronUp className="w-3.5 h-3.5 text-gray-500 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
          <span className="text-sm font-semibold text-gray-200">{year}</span>
          <span className="text-xs text-gray-500">{months.length} month{months.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="text-right">
          <div className="text-xs font-mono text-gray-300 font-medium">{cents(yearTotal)} billed</div>
          <div className="text-[10px] text-gray-600">{salesLabel(yearSales)} in sales</div>
        </div>
      </button>

      {open && (
        <div className="border-t border-white/6 px-3 pb-3 pt-2 space-y-2">
          {months.map((m) => (
            <InvoiceRow key={m.periodStart} month={m} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab components ───────────────────────────────────────────────────────────

function CurrentBillingTab() {
  const { data: usage, isLoading } = useQuery<OrgUsageData>({ queryKey: ['/api/org/usage'] });
  const [cancelConfirm, setCancelConfirm] = useState(false);

  if (isLoading) {
    return <div className="flex items-center justify-center py-16 text-gray-500 text-sm">Loading…</div>;
  }
  if (!usage) {
    return <div className="flex items-center justify-center py-16 text-gray-500 text-sm">No billing data available.</div>;
  }

  const isTrial = usage.subscriptionStatus === 'trial';

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        {isTrial
          ? 'Usage shown is what your bill would look like as a subscriber. Nothing is charged during your trial.'
          : 'Your billing period runs from your signup anniversary date each month. Sales include all channels — items total minus discounts.'}
      </p>

      <SalesBillCard usage={usage} />
      <TrialCallout status={usage.subscriptionStatus} billingStartDate={usage.billingStartDate} />

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
                    Your access will remain active until the end of your current billing period. After that,
                    your account will revert to read-only mode and inventory sync will stop.
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

function HistoryTab() {
  const { data, isLoading } = useQuery<{ months: MonthRecord[] }>({ queryKey: ['/api/org/billing/history'] });

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

  // Group by year
  const byYear = new Map<number, MonthRecord[]>();
  for (const m of months) {
    const yr = m.year;
    if (!byYear.has(yr)) byYear.set(yr, []);
    byYear.get(yr)!.push(m);
  }
  const years = [...byYear.keys()].sort((a, b) => b - a);
  const currentYear = new Date().getFullYear();

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 mb-1">
        Click any month to expand the full breakdown. Use the print icon for a printable invoice.
      </p>
      {years.map((yr) => (
        <YearSection
          key={yr}
          year={yr}
          months={byYear.get(yr)!}
          defaultOpen={yr === currentYear}
        />
      ))}
    </div>
  );
}

// ─── Drawer shell ─────────────────────────────────────────────────────────────

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
                Invoice History
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

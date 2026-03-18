import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ToolDrawer } from "@/components/ui/tool-drawer";
import {
  CreditCard, ShoppingCart, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Printer,
  AlertTriangle, CheckCircle2, Info, TrendingUp, Clock,
} from "lucide-react";

// ─── API response types ───────────────────────────────────────────────────────

interface PlanInfo {
  id: number;
  name: string;
  basePrice: number;
  salesPercentage: number;
  freeSalesThreshold: number;
  isDefault?: boolean;
  sunsetAt?: string | null;
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
  plan: Omit<PlanInfo, "id"> & { isDefault?: boolean; sunsetAt?: string | null };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cents(c: number) {
  return `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function salesLabel(cents_: number) {
  return `$${(cents_ / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Current billing card ─────────────────────────────────────────────────────

function planDateLabel(plan: PlanInfo, period: { start: string; end: string }): { title: string; sub: string } {
  if (plan.isDefault) {
    if (plan.sunsetAt) {
      const end = new Date(plan.sunsetAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      return { title: plan.name, sub: `Ends ${end}` };
    }
    return { title: plan.name, sub: 'No expiry date set' };
  }
  const start = new Date(period.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const end   = new Date(period.end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const monthLabel = new Date(period.start).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return { title: monthLabel, sub: `${start} – ${end}` };
}

function SalesBillCard({ usage }: { usage: OrgUsageData }) {
  const { plan, monthlySalesCents, billing, period } = usage;
  const salesOverThreshold = Math.max(0, monthlySalesCents - plan.freeSalesThreshold);
  const aboveThreshold = monthlySalesCents > plan.freeSalesThreshold;
  const hasSalesFee = billing.salesFee > 0;

  const { title, sub } = planDateLabel(plan, period);

  return (
    <div className="rounded-md border border-white/8 bg-gray-800/40">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-200">{title}</div>
          <div className="text-xs text-gray-500 mt-0.5">{sub}</div>
        </div>
        {!plan.isDefault && <div className="text-xs text-gray-500">{plan.name}</div>}
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

// ─── Sunset / grace period callout ───────────────────────────────────────────

const GRACE_DAYS = 7;
const MS_PER_DAY = 86400000;

function SunsetCallout({ plan }: { plan: PlanInfo }) {
  if (!plan.sunsetAt) return null;
  const sunsetDate = new Date(plan.sunsetAt);
  const now = new Date();
  const daysSince = Math.floor((now.getTime() - sunsetDate.getTime()) / MS_PER_DAY);
  const daysUntil = Math.ceil((sunsetDate.getTime() - now.getTime()) / MS_PER_DAY);

  const inGrace = daysSince >= 0 && daysSince <= GRACE_DAYS;
  const upcoming = daysUntil > 0;

  if (!inGrace && !upcoming) return null;

  const urgent = inGrace;
  const daysLeftInGrace = GRACE_DAYS - daysSince;

  return (
    <div className={cn(
      "rounded-md border px-4 py-3 space-y-1.5",
      urgent
        ? "border-red-800/40 bg-red-950/20"
        : "border-amber-800/30 bg-amber-950/15"
    )}>
      <div className="flex items-start gap-2.5">
        {urgent
          ? <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          : <Clock className="w-3.5 h-3.5 text-amber-400/80 shrink-0 mt-0.5" />
        }
        <div className="space-y-0.5">
          <p className={cn("text-xs font-semibold", urgent ? "text-red-200" : "text-amber-200/90")}>
            {urgent
              ? `Your ${plan.name} plan has ended — ${daysLeftInGrace} day${daysLeftInGrace !== 1 ? 's' : ''} of access remaining`
              : `Your ${plan.name} plan retires in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`
            }
          </p>
          <p className="text-xs text-gray-500 leading-relaxed">
            {urgent
              ? "Choose a paid plan to keep your access before the grace period expires."
              : "Upgrade to a paid plan before this date to keep your access uninterrupted."
            }
          </p>
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
          <div className="text-xs text-gray-500 mt-0.5">
            {new Date(month.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            {' – '}
            {new Date(month.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {' · '}
            {salesLabel(monthlySalesCents)} in sales
          </div>
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
              <span className="text-xs text-gray-400">Sales this period</span>
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
  const isDefaultPlan = usage.plan?.isDefault;

  return (
    <div className="space-y-3">
      <SunsetCallout plan={usage.plan} />

      <p className="text-xs text-gray-500">
        {isTrial
          ? 'Usage shown is what your bill would look like as a subscriber. Nothing is charged during your trial.'
          : isDefaultPlan
            ? 'You are on a free plan. Sales data is shown for reference — nothing is charged.'
            : 'Your billing period runs from your signup anniversary date each month. Sales include all channels — items total minus discounts.'}
      </p>

      <SalesBillCard usage={usage} />
      <TrialCallout status={usage.subscriptionStatus} billingStartDate={usage.billingStartDate} />

      {!isTrial && !isDefaultPlan && (
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

interface HistoryResponse {
  months: MonthRecord[];
  year: number;
  firstYear: number;
  lastYear: number;
}

function HistoryTab() {
  const currentYear = new Date().getFullYear();
  const [viewYear, setViewYear] = useState(currentYear);

  const { data, isLoading } = useQuery<HistoryResponse>({
    queryKey: ['/api/org/billing/history', viewYear],
    queryFn: async () => {
      const res = await fetch(`/api/org/billing/history?year=${viewYear}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load billing history');
      return res.json();
    },
  });

  const months = data?.months ?? [];
  const firstYear = data?.firstYear ?? currentYear;
  const lastYear = data?.lastYear ?? currentYear;

  const canGoPrev = viewYear > firstYear;
  const canGoNext = viewYear < lastYear;

  const yearTotal = months.reduce((s, m) => s + m.billing.totalDue, 0);
  const yearSales = months.reduce((s, m) => s + m.monthlySalesCents, 0);

  return (
    <div className="space-y-3">
      {/* Year navigator */}
      <div className="flex items-center justify-between gap-2 rounded-md border border-white/8 bg-gray-800/30 px-3 py-2">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setViewYear((y) => y - 1)}
          disabled={!canGoPrev || isLoading}
          data-testid="button-history-prev-year"
          title="Previous year"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>

        <div className="flex-1 text-center">
          <div className="text-sm font-semibold text-gray-200">{viewYear}</div>
          {!isLoading && months.length > 0 && (
            <div className="text-[10px] text-gray-500">
              {cents(yearTotal)} billed · {salesLabel(yearSales)} in sales
            </div>
          )}
        </div>

        <Button
          size="icon"
          variant="ghost"
          onClick={() => setViewYear((y) => y + 1)}
          disabled={!canGoNext || isLoading}
          data-testid="button-history-next-year"
          title="Next year"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Loading…</div>
      ) : months.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
          <CreditCard className="w-7 h-7 text-gray-600" />
          <p className="text-gray-500 text-sm">No invoices for {viewYear}.</p>
          {firstYear < viewYear && (
            <button
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
              onClick={() => setViewYear((y) => y - 1)}
            >
              Go to {viewYear - 1}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Click any month to expand the full breakdown. Use the print icon for a printable invoice.
          </p>
          {months.map((m) => (
            <InvoiceRow key={m.periodStart} month={m} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Drawer shell ─────────────────────────────────────────────────────────────

export function BillingDrawer({ onClose }: { onClose: () => void }) {
  const [billingTab, setBillingTab] = useState<'current' | 'history'>('current');

  return (
    <ToolDrawer
      icon={CreditCard}
      iconColor="text-blue-400"
      title="Payments & Billing"
      onClose={onClose}
      closeTestId="button-close-billing-drawer"
      subHeader={
        <div className="tool-tab-bar">
          <button
            onClick={() => setBillingTab('current')}
            className={`tool-tab ${billingTab === 'current' ? 'text-orange-400 border-orange-500' : 'tool-tab-off'}`}
            data-testid="tab-current-billing"
          >
            Current Billing
          </button>
          <button
            onClick={() => setBillingTab('history')}
            className={`tool-tab ${billingTab === 'history' ? 'text-orange-400 border-orange-500' : 'tool-tab-off'}`}
            data-testid="tab-previous-invoices"
          >
            Invoice History
          </button>
        </div>
      }
      contentClassName="flex-1 min-h-0 overflow-y-auto px-4 py-4"
    >
      {billingTab === 'current' ? <CurrentBillingTab /> : <HistoryTab />}
    </ToolDrawer>
  );
}

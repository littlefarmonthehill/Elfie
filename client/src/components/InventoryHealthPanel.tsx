import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import {
  Activity,
  ArrowLeft,
  ArrowLeftRight,
  ChevronRight,
  X,
  Trash2,
  Tag,
  DollarSign,
  TrendingDown,
  Copy,
  Archive,
  Palette,
  Package,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Link,
  Unlink,
  ChevronLeft,
  Replace,
} from "lucide-react";

interface HealthSummary {
  softDeleted: { total: number; linked: number; standalone: number };
  zeroPriced: number;
  missingCost: number;
  negativeMargin: number;
  missingColor: number;
  duplicates: { groups: number; lots: number };
  deadStock: number;
  overpriced: number;
  crossConditionDupes: { groups: number; lots: number };
  obsoleteCatalog: number;
  stockroom: Record<string, { lotCount: number; totalQty: number; totalValue: number }>;
  productMix: {
    totalCategories: number;
    topConcentrationPct: number;
    rows: Array<{ category_id: number; category_name: string; lot_count: number; total_qty: number; total_value: number }>;
  };
}

type HealthCategory =
  | 'soft_deleted'
  | 'zero_priced'
  | 'missing_cost'
  | 'negative_margin'
  | 'missing_color'
  | 'duplicates'
  | 'dead_stock'
  | 'overpriced'
  | 'cross_condition_dupes'
  | 'obsolete_catalog';

interface CategoryCard {
  id: HealthCategory;
  label: string;
  description: string;
  icon: React.ElementType;
  accentColor: string;
  borderColor: string;
  bgColor: string;
  count: number;
  countLabel?: string;
  severity: 'critical' | 'warning' | 'info';
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmt(n: number | string | undefined | null, decimals = 2): string {
  const v = Number(n ?? 0);
  return isNaN(v) ? '—' : v.toFixed(decimals);
}

function formatCurrency(n: number | string | undefined | null): string {
  const v = Number(n ?? 0);
  return isNaN(v) ? '—' : `$${v.toFixed(2)}`;
}

function ConditionBadge({ cond }: { cond: string }) {
  return cond === 'U'
    ? <span className="text-[9px] px-1 py-0 rounded bg-yellow-900/40 text-yellow-400 border border-yellow-700/30">Used</span>
    : null;
}

function CategoryButton({ card, onSelect }: { card: CategoryCard; onSelect: (id: HealthCategory) => void }) {
  if (card.count === 0) return null;
  const severityIcon = card.severity === 'critical'
    ? <AlertTriangle className="w-2.5 h-2.5 text-red-400" />
    : card.severity === 'warning'
    ? <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
    : null;

  return (
    <button
      onClick={() => onSelect(card.id)}
      className={`w-full text-left rounded-lg border p-3 hover-elevate transition-opacity ${card.borderColor} ${card.bgColor}`}
      data-testid={`button-health-${card.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <card.icon className={`w-4 h-4 ${card.accentColor} shrink-0`} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-sm font-semibold ${card.accentColor.replace('400', '200')}`}>
                {card.label}
              </span>
              {severityIcon}
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">{card.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-right">
            <span className={`text-lg font-mono font-bold ${card.accentColor}`}>
              {card.count.toLocaleString()}
            </span>
            {card.countLabel && (
              <div className="text-[9px] text-gray-500">{card.countLabel}</div>
            )}
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
        </div>
      </div>
    </button>
  );
}

function StockroomOverview({ stockroom }: { stockroom: HealthSummary['stockroom'] }) {
  const live = stockroom.live ?? { lotCount: 0, totalQty: 0, totalValue: 0 };
  const a = stockroom.A ?? { lotCount: 0, totalQty: 0, totalValue: 0 };
  const b = stockroom.B ?? { lotCount: 0, totalQty: 0, totalValue: 0 };
  const c = stockroom.C ?? { lotCount: 0, totalQty: 0, totalValue: 0 };

  const totalLots = live.lotCount + a.lotCount + b.lotCount + c.lotCount;
  const stockroomLots = a.lotCount + b.lotCount + c.lotCount;
  const stockroomPct = totalLots > 0 ? Math.round(stockroomLots / totalLots * 100) : 0;

  const rows = [
    { key: 'Live', data: live, color: 'text-green-400', bg: 'bg-green-500' },
    { key: 'Stockroom A', data: a, color: 'text-sky-400', bg: 'bg-sky-500' },
    { key: 'Stockroom B', data: b, color: 'text-violet-400', bg: 'bg-violet-500' },
    { key: 'Stockroom C', data: c, color: 'text-amber-400', bg: 'bg-amber-500' },
  ].filter(r => r.data.lotCount > 0);

  return (
    <div className="mx-4 my-3 rounded-lg border border-gray-700/50 bg-gray-800/30 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Archive className="w-4 h-4 text-gray-400" />
        <span className="text-sm font-semibold text-gray-200">Stockroom Overview</span>
        {stockroomPct > 0 && (
          <span className="ml-auto text-[10px] text-gray-400">
            <span className="font-mono font-semibold text-gray-200">{stockroomPct}%</span> in stockroom
          </span>
        )}
      </div>

      {/* Visual bar */}
      {totalLots > 0 && (
        <div className="flex h-2 rounded-full overflow-hidden gap-px">
          {rows.map(r => (
            <div
              key={r.key}
              className={`${r.bg} transition-all`}
              style={{ width: `${(r.data.lotCount / totalLots) * 100}%`, minWidth: r.data.lotCount > 0 ? '2px' : '0' }}
            />
          ))}
        </div>
      )}

      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.key} className="flex items-center justify-between text-xs" data-testid={`stockroom-row-${r.key}`}>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${r.bg}`} />
              <span className="text-gray-300">{r.key}</span>
            </div>
            <div className="flex items-center gap-4 text-right">
              <span className="text-gray-400 text-[10px]">{r.data.totalQty.toLocaleString()} pcs</span>
              <span className={`font-mono font-semibold ${r.color} min-w-[3.5rem] text-right`}>
                {r.data.lotCount.toLocaleString()} lots
              </span>
              {r.data.totalValue > 0 && (
                <span className="text-gray-500 text-[10px] min-w-[4rem] text-right">
                  ${r.data.totalValue.toFixed(0)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductMixOverview({ productMix }: { productMix: HealthSummary['productMix'] }) {
  const { rows, topConcentrationPct, totalCategories } = productMix;
  if (!rows || rows.length === 0) return null;
  const totalLots = rows.reduce((s, r) => s + Number(r.lot_count), 0);

  const concentration =
    topConcentrationPct >= 70 ? { label: 'Heavy concentration', color: 'text-red-400', bg: 'bg-red-500' } :
    topConcentrationPct >= 50 ? { label: 'Moderate concentration', color: 'text-amber-400', bg: 'bg-amber-500' } :
    { label: 'Well diversified', color: 'text-green-400', bg: 'bg-green-500' };

  return (
    <div className="mx-4 my-3 rounded-lg border border-gray-700/50 bg-gray-800/30 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-gray-400" />
        <span className="text-sm font-semibold text-gray-200">Product Mix</span>
        <span className={`ml-auto text-[10px] font-semibold ${concentration.color}`}>{concentration.label}</span>
      </div>
      <div className="text-[10px] text-gray-500">{totalCategories} categories · top category = {topConcentrationPct}% of lots</div>

      {/* Stacked bar */}
      <div className="flex h-2 rounded-full overflow-hidden gap-px">
        {rows.slice(0, 8).map((r, i) => {
          const hues = ['bg-blue-500', 'bg-violet-500', 'bg-green-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-orange-500', 'bg-teal-500'];
          return (
            <div
              key={r.category_id ?? i}
              className={`${hues[i % hues.length]} transition-all`}
              style={{ width: `${(Number(r.lot_count) / totalLots) * 100}%`, minWidth: Number(r.lot_count) > 0 ? '2px' : '0' }}
            />
          );
        })}
      </div>

      <div className="space-y-1.5">
        {rows.slice(0, 8).map((r, i) => {
          const hues = ['text-blue-400', 'text-violet-400', 'text-green-400', 'text-amber-400', 'text-rose-400', 'text-cyan-400', 'text-orange-400', 'text-teal-400'];
          const pct = Math.round(Number(r.lot_count) / totalLots * 100);
          return (
            <div key={r.category_id ?? i} className="flex items-center justify-between text-[10px]" data-testid={`mix-row-${r.category_id}`}>
              <div className="flex items-center gap-1.5 min-w-0">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${hues[i % hues.length].replace('text-', 'bg-')}`} />
                <span className="text-gray-300 truncate">{r.category_name ?? `Category ${r.category_id}`}</span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-gray-500">{pct}%</span>
                <span className={`font-mono font-semibold ${hues[i % hues.length]} min-w-[2.5rem] text-right`}>
                  {Number(r.lot_count).toLocaleString()}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailRow({ row, category }: { row: any; category: HealthCategory }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-800/70 last:border-0" data-testid={`health-row-${row.id}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-mono text-gray-300">{row.item_no}</span>
          <ConditionBadge cond={row.new_or_used} />
          {row.is_linked && (
            <span className="flex items-center gap-0.5 text-[9px] px-1 py-0 rounded bg-blue-900/40 text-blue-300 border border-blue-700/30">
              <Link className="w-2 h-2" /> order
            </span>
          )}
          {category === 'soft_deleted' && !row.is_linked && (
            <span className="flex items-center gap-0.5 text-[9px] px-1 py-0 rounded bg-gray-800/60 text-gray-400 border border-gray-700/30">
              <Unlink className="w-2 h-2" /> standalone
            </span>
          )}
          <span className="text-[9px] font-mono text-gray-600">#{row.id}</span>
        </div>
        <div className="text-[10px] text-gray-500 truncate">
          {row.item_name}{row.color_name && row.color_name !== 'No Color' ? ` · ${row.color_name}` : ''}
          {category === 'soft_deleted' && row.deleted_at && (
            <span className="ml-1 text-red-400/70">deleted {relTime(row.deleted_at)}</span>
          )}
        </div>
      </div>
      <div className="text-right flex-shrink-0 space-y-0.5">
        <div className="text-xs font-mono text-blue-300">{Number(row.quantity).toLocaleString()} pcs</div>
        {category === 'negative_margin' && (
          <div className="text-[10px] font-mono text-red-400">
            {formatCurrency(row.unit_price)} vs cost {formatCurrency(row.my_cost)}
          </div>
        )}
        {category === 'overpriced' && (
          <div className="text-[10px] font-mono text-orange-400">
            {formatCurrency(row.unit_price)} · +{fmt(row.pct_above, 0)}% over ceiling
          </div>
        )}
        {category === 'missing_cost' && row.unit_price && (
          <div className="text-[10px] text-gray-500">{formatCurrency(row.unit_price)}</div>
        )}
        {category === 'zero_priced' && (
          <div className="text-[10px] text-red-400/70">no price</div>
        )}
        {category === 'dead_stock' && row.unit_price && (
          <div className="text-[10px] text-gray-500">{formatCurrency(row.unit_price)}</div>
        )}
        {category === 'cross_condition_dupes' && (
          <div className="text-[10px] font-mono text-fuchsia-400">
            {row.new_or_used === 'N' ? 'New' : row.new_or_used === 'U' ? 'Used' : row.new_or_used}
          </div>
        )}
        {category === 'obsolete_catalog' && (
          <div className="text-[10px] font-mono text-rose-400">
            {row.alternate_no ? `→ ${row.alternate_no}` : 'obsolete'}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailView({ category, title, icon: Icon, accentColor }: {
  category: HealthCategory;
  title: string;
  icon: React.ElementType;
  accentColor: string;
}) {
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery<{ rows: any[]; page: number; limit: number }>({
    queryKey: ['/api/inventory/health', category, page],
    queryFn: () => fetch(`/api/inventory/health/${category}?page=${page}`).then(r => r.json()),
    refetchOnWindowFocus: false,
  });

  const rows = data?.rows ?? [];
  const hasMore = rows.length === (data?.limit ?? 50);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${accentColor} shrink-0`} />
          <span className={`text-xs font-semibold ${accentColor.replace('400', '300')}`}>{title}</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 px-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-500/40" />
            <span className="text-sm text-gray-500">Nothing to show here</span>
          </div>
        ) : (
          <div>
            {rows.map((row: any) => (
              <DetailRow key={row.id} row={row} category={category} />
            ))}
          </div>
        )}
      </div>
      {(page > 0 || hasMore) && (
        <div className="flex-shrink-0 border-t border-gray-800 px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {(page * 50 + 1)}–{page * 50 + rows.length}
          </span>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="button-health-detail-prev">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" disabled={!hasMore} onClick={() => setPage(p => p + 1)} data-testid="button-health-detail-next">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface InventoryHealthPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function InventoryHealthPanel({ open, onOpenChange }: InventoryHealthPanelProps) {
  const [selectedCategory, setSelectedCategory] = useState<HealthCategory | null>(null);

  const { data: health, isLoading } = useQuery<HealthSummary>({
    queryKey: ['/api/inventory/health'],
    enabled: open,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const categories: CategoryCard[] = health ? [
    {
      id: 'soft_deleted',
      label: 'Removed from BrickLink',
      description: `${health.softDeleted.linked} linked to orders · ${health.softDeleted.standalone} standalone`,
      icon: Trash2,
      accentColor: 'text-red-400',
      borderColor: 'border-red-500/40',
      bgColor: 'bg-red-950/30',
      count: health.softDeleted.total,
      countLabel: 'items',
      severity: health.softDeleted.linked > 0 ? 'critical' : 'warning',
    },
    {
      id: 'zero_priced',
      label: 'No Price Set',
      description: 'Active lots with quantity but no unit price',
      icon: Tag,
      accentColor: 'text-orange-400',
      borderColor: 'border-orange-500/40',
      bgColor: 'bg-orange-950/30',
      count: health.zeroPriced,
      countLabel: 'lots',
      severity: 'critical',
    },
    {
      id: 'negative_margin',
      label: 'Selling at a Loss',
      description: 'Price is below your recorded cost — check pricing',
      icon: TrendingDown,
      accentColor: 'text-red-400',
      borderColor: 'border-red-500/40',
      bgColor: 'bg-red-950/30',
      count: health.negativeMargin,
      countLabel: 'lots',
      severity: 'critical',
    },
    {
      id: 'missing_cost',
      label: 'Missing Cost Basis',
      description: 'No cost recorded — margin cannot be calculated',
      icon: DollarSign,
      accentColor: 'text-amber-400',
      borderColor: 'border-amber-500/40',
      bgColor: 'bg-amber-950/30',
      count: health.missingCost,
      countLabel: 'lots',
      severity: 'warning',
    },
    {
      id: 'overpriced',
      label: 'Overpriced vs Market',
      description: 'More than 1.5× the BrickLink market ceiling price',
      icon: DollarSign,
      accentColor: 'text-yellow-400',
      borderColor: 'border-yellow-500/40',
      bgColor: 'bg-yellow-950/30',
      count: health.overpriced,
      countLabel: 'lots',
      severity: 'warning',
    },
    {
      id: 'duplicates',
      label: 'Possible Duplicate Lots',
      description: `${health.duplicates.groups} groups · same part, color & condition`,
      icon: Copy,
      accentColor: 'text-violet-400',
      borderColor: 'border-violet-500/40',
      bgColor: 'bg-violet-950/30',
      count: health.duplicates.lots,
      countLabel: 'lots in dupes',
      severity: 'warning',
    },
    {
      id: 'dead_stock',
      label: 'Never Sold',
      description: 'Active lots with quantity that have never appeared in an order',
      icon: Package,
      accentColor: 'text-sky-400',
      borderColor: 'border-sky-500/40',
      bgColor: 'bg-sky-950/30',
      count: health.deadStock,
      countLabel: 'lots',
      severity: 'info',
    },
    {
      id: 'missing_color',
      label: 'Parts Missing Color',
      description: 'Parts or minifigs with color ID = 0 (no color assigned)',
      icon: Palette,
      accentColor: 'text-pink-400',
      borderColor: 'border-pink-500/40',
      bgColor: 'bg-pink-950/30',
      count: health.missingColor,
      countLabel: 'lots',
      severity: 'info',
    },
    {
      id: 'cross_condition_dupes',
      label: 'Listed as Both New & Used',
      description: `${health.crossConditionDupes.groups} items · same part/color active in N and U`,
      icon: ArrowLeftRight,
      accentColor: 'text-fuchsia-400',
      borderColor: 'border-fuchsia-500/40',
      bgColor: 'bg-fuchsia-950/30',
      count: health.crossConditionDupes.lots,
      countLabel: 'lots',
      severity: 'warning',
    },
    {
      id: 'obsolete_catalog',
      label: 'Superseded BL Item IDs',
      description: 'BrickLink has replaced these item numbers — update before they are removed',
      icon: Replace,
      accentColor: 'text-rose-400',
      borderColor: 'border-rose-500/40',
      bgColor: 'bg-rose-950/30',
      count: health.obsoleteCatalog,
      countLabel: 'lots',
      severity: 'warning',
    },
  ] : [];

  const criticalCount = categories.filter(c => c.severity === 'critical' && c.count > 0).length;
  const warningCount = categories.filter(c => c.severity === 'warning' && c.count > 0).length;
  const totalIssues = categories.reduce((s, c) => s + c.count, 0);

  const activeCard = categories.find(c => c.id === selectedCategory);

  function handleClose() {
    onOpenChange(false);
    setSelectedCategory(null);
  }

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DrawerContent className="bg-gray-950 border-gray-800 h-[80vh] flex flex-col rounded-t-2xl">
        <DrawerHeader className="p-0 flex-shrink-0">
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-gray-600" />
          </div>
          <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-gray-800">
            {selectedCategory ? (
              <button
                onClick={() => setSelectedCategory(null)}
                className="text-gray-400 hover:text-gray-200 transition-colors mr-1 flex-shrink-0"
                data-testid="button-health-back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <Activity className="w-4 h-4 text-cyan-400 flex-shrink-0" />
            )}
            <DrawerTitle className="text-sm font-semibold text-gray-100 flex-1">
              {selectedCategory && activeCard
                ? <span className="flex items-center gap-1.5">
                    <activeCard.icon className={`w-4 h-4 ${activeCard.accentColor} shrink-0`} />
                    {activeCard.label}
                  </span>
                : 'Inventory Health'}
            </DrawerTitle>
            <DrawerClose
              className="ml-2 text-gray-500 hover:text-gray-200 transition-colors"
              data-testid="button-health-close"
              onClick={handleClose}
            >
              <X className="w-5 h-5" />
              <span className="sr-only">Close</span>
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {selectedCategory && activeCard ? (
            <DetailView
              category={selectedCategory}
              title={activeCard.label}
              icon={activeCard.icon}
              accentColor={activeCard.accentColor}
            />
          ) : (
            <div className="pb-6">
              {/* Score banner */}
              <div className="px-4 pt-3 pb-2">
                {isLoading ? (
                  <div className="h-14 rounded-lg bg-gray-800/60 animate-pulse" />
                ) : (
                  <div className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border ${
                    criticalCount > 0
                      ? 'bg-red-950/30 border-red-500/30'
                      : warningCount > 0
                      ? 'bg-amber-950/30 border-amber-500/30'
                      : 'bg-green-950/30 border-green-500/30'
                  }`} data-testid="health-score-banner">
                    {criticalCount > 0 ? (
                      <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                    ) : warningCount > 0 ? (
                      <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
                    )}
                    <div>
                      {totalIssues === 0 ? (
                        <p className="text-sm font-semibold text-green-300">Inventory looks healthy</p>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-gray-100">
                            {totalIssues.toLocaleString()} issue{totalIssues !== 1 ? 's' : ''} detected
                          </p>
                          <p className="text-[10px] text-gray-400">
                            {criticalCount > 0 && <span className="text-red-400">{criticalCount} critical</span>}
                            {criticalCount > 0 && warningCount > 0 && ' · '}
                            {warningCount > 0 && <span className="text-amber-400">{warningCount} warnings</span>}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Issue categories */}
              {isLoading ? (
                <div className="px-4 space-y-2">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="h-16 rounded-lg bg-gray-800/60 animate-pulse" />
                  ))}
                </div>
              ) : (
                <>
                  {/* Critical section */}
                  {categories.some(c => c.severity === 'critical' && c.count > 0) && (
                    <div className="px-4 mt-2">
                      <p className="text-[10px] font-semibold text-red-400/80 uppercase tracking-wide mb-1.5">Critical</p>
                      <div className="space-y-2">
                        {categories.filter(c => c.severity === 'critical').map(c => (
                          <CategoryButton key={c.id} card={c} onSelect={setSelectedCategory} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Warning section */}
                  {categories.some(c => c.severity === 'warning' && c.count > 0) && (
                    <div className="px-4 mt-3">
                      <p className="text-[10px] font-semibold text-amber-400/80 uppercase tracking-wide mb-1.5">Warnings</p>
                      <div className="space-y-2">
                        {categories.filter(c => c.severity === 'warning').map(c => (
                          <CategoryButton key={c.id} card={c} onSelect={setSelectedCategory} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Info section */}
                  {categories.some(c => c.severity === 'info' && c.count > 0) && (
                    <div className="px-4 mt-3">
                      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Informational</p>
                      <div className="space-y-2">
                        {categories.filter(c => c.severity === 'info').map(c => (
                          <CategoryButton key={c.id} card={c} onSelect={setSelectedCategory} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* All clear items — always show when health data is loaded */}
                  {categories.some(c => c.count === 0) && (
                    <div className="px-4 mt-3">
                      <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide mb-1.5">All Clear</p>
                      <div className="space-y-1.5">
                        {categories.filter(c => c.count === 0).map(c => (
                          <div key={c.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-800/50 bg-gray-900/30">
                            <c.icon className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                            <span className="text-xs text-gray-600">{c.label}</span>
                            <CheckCircle2 className="w-3 h-3 text-green-500/50 ml-auto shrink-0" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Stockroom overview */}
              {health && <StockroomOverview stockroom={health.stockroom} />}

              {/* Product mix */}
              {health && health.productMix.rows.length > 0 && (
                <ProductMixOverview productMix={health.productMix} />
              )}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

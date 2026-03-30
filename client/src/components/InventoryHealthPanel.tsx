import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
  Tag,
  DollarSign,
  TrendingDown,
  Copy,
  Archive,
  Package,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ChevronLeft,
  Replace,
  History,
  ShoppingCart,
  RefreshCw,
  FileText,
  Trash2,
  MapPin,
  Search,
} from "lucide-react";

interface ItemTypeRow {
  itemType: string;
  lotCount: number;
  totalQty: number;
  avgPrice: number;
  totalValue: number;
}

interface HealthSummary {
  zeroPriced: number;
  missingCost: number;
  negativeMargin: number;
  duplicates: { groups: number; lots: number };
  deadStock: number;
  overpriced: number;
  crossConditionDupes: { groups: number; lots: number };
  obsoleteCatalog: number;
  softDeleted: { total: number; linked: number; standalone: number };
  stockroom: Record<string, { lotCount: number; totalQty: number; totalValue: number }>;
  productMix: {
    totalCategories: number;
    topConcentrationPct: number;
    rows: Array<{ category_id: number; category_name: string; lot_count: number; total_qty: number; total_value: number }>;
  };
  itemTypeBreakdown: ItemTypeRow[];
  warehouseLocation: {
    totalActiveLots: number;
    locatedLots: number;
    unlocatedLots: number;
    totalBins: number;
    aisles: Array<{
      aisleId: number;
      aisleName: string;
      binCount: number;
      locatedLots: number;
      totalQty: number;
    }>;
  };
}

type HealthCategory =
  | 'zero_priced'
  | 'missing_cost'
  | 'negative_margin'
  | 'duplicates'
  | 'dead_stock'
  | 'overpriced'
  | 'cross_condition_dupes'
  | 'obsolete_catalog'
  | 'soft_deleted';

type HealthTheme = 'pricing' | 'listings' | 'sales';

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
  theme: HealthTheme;
}

interface ThemeDef {
  id: HealthTheme;
  label: string;
  icon: React.ElementType;
  color: string;
  description: string;
}

const HEALTH_THEMES: ThemeDef[] = [
  {
    id: 'pricing',
    label: 'Pricing',
    icon: DollarSign,
    color: 'text-amber-400',
    description: 'Price gaps, missing costs & margin issues',
  },
  {
    id: 'listings',
    label: 'Listings',
    icon: Copy,
    color: 'text-violet-400',
    description: 'Duplicates, soft deletes & catalog changes',
  },
  {
    id: 'sales',
    label: 'Sales',
    icon: ShoppingCart,
    color: 'text-green-400',
    description: 'Dead stock & sales velocity',
  },
];

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
    ? <AlertTriangle className="w-2.5 h-2.5 text-red-400 shrink-0" />
    : card.severity === 'warning'
    ? <AlertTriangle className="w-2.5 h-2.5 text-amber-400 shrink-0" />
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
            <p className="text-[11px] text-muted-foreground mt-0.5">{card.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-right">
            <span className={`text-lg font-mono font-bold ${card.accentColor}`}>
              {card.count.toLocaleString()}
            </span>
            {card.countLabel && (
              <div className="text-[9px] text-muted-foreground">{card.countLabel}</div>
            )}
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
      </div>
    </button>
  );
}

function AllClearRow({ card }: { card: CategoryCard }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border/30 bg-muted/10">
      <card.icon className="w-3 h-3 text-muted-foreground/50 shrink-0" />
      <span className="text-xs text-muted-foreground/60">{card.label}</span>
      <CheckCircle2 className="w-3 h-3 text-green-500/40 ml-auto shrink-0" />
    </div>
  );
}

function ThemeSection({
  theme,
  cards,
  onSelect,
}: {
  theme: ThemeDef;
  cards: CategoryCard[];
  onSelect: (id: HealthCategory) => void;
}) {
  const active = cards.filter(c => c.count > 0);
  const cleared = cards.filter(c => c.count === 0);
  if (cards.length === 0) return null;

  return (
    <div className="px-4 mt-3">
      <div className="flex items-center gap-1.5 mb-2">
        <theme.icon className={`w-3 h-3 ${theme.color}`} />
        <p className={`text-[10px] font-semibold uppercase tracking-wide ${theme.color.replace('400', '400/80')}`}>
          {theme.label}
        </p>
      </div>
      <div className="space-y-2">
        {active.map(c => (
          <CategoryButton key={c.id} card={c} onSelect={onSelect} />
        ))}
        {cleared.length > 0 && (
          <div className="space-y-1 mt-1">
            {cleared.map(c => (
              <AllClearRow key={c.id} card={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const ITEM_TYPE_LABELS: Record<string, string> = {
  SET: 'Sets', PART: 'Parts', MINIFIG: 'Minifigs', GEAR: 'Gear',
  BOOK: 'Books', CATALOG: 'Catalogs', INSTRUCTION: 'Instructions', ORIGINAL_BOX: 'Orig. Boxes',
};

function ItemTypeBreakdown({ rows }: { rows: ItemTypeRow[] }) {
  if (!rows || rows.length === 0) return null;
  const totalLots = rows.reduce((s, r) => s + r.lotCount, 0);
  return (
    <div className="px-4 mt-3" data-testid="item-type-breakdown">
      <div className="flex items-center gap-1.5 mb-2">
        <Package className="w-3 h-3 text-muted-foreground/60" />
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">Item Type Breakdown</p>
      </div>
      <div className="rounded-md border border-border/50 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Type</th>
              <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Lots</th>
              <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Qty</th>
              <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Avg Price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const pct = totalLots > 0 ? Math.round(r.lotCount / totalLots * 100) : 0;
              return (
                <tr key={r.itemType} className={i < rows.length - 1 ? 'border-b border-border/30' : ''} data-testid={`item-type-row-${r.itemType}`}>
                  <td className="px-3 py-1.5 font-medium text-foreground">
                    <span>{ITEM_TYPE_LABELS[r.itemType] ?? r.itemType}</span>
                    <span className="ml-1.5 text-[10px] text-muted-foreground">{pct}%</span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{r.lotCount.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{r.totalQty.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-foreground">
                    {r.avgPrice > 0 ? `$${r.avgPrice.toFixed(2)}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const STOCKROOM_PALETTE = [
  { color: 'text-sky-400', bg: 'bg-sky-500' },
  { color: 'text-violet-400', bg: 'bg-violet-500' },
  { color: 'text-amber-400', bg: 'bg-amber-500' },
  { color: 'text-rose-400', bg: 'bg-rose-500' },
  { color: 'text-teal-400', bg: 'bg-teal-500' },
];

function StockroomOverview({ stockroom }: { stockroom: HealthSummary['stockroom'] }) {
  const live = stockroom.live ?? { lotCount: 0, totalQty: 0, totalValue: 0 };

  // Dynamically collect all non-live stockroom keys, sorted alphabetically
  const stockroomKeys = Object.keys(stockroom)
    .filter(k => k !== 'live')
    .sort();

  const totalLots = Object.values(stockroom).reduce((s, v) => s + v.lotCount, 0);
  const stockroomLots = stockroomKeys.reduce((s, k) => s + (stockroom[k]?.lotCount ?? 0), 0);
  const stockroomPct = totalLots > 0 ? Math.round(stockroomLots / totalLots * 100) : 0;

  const rows = [
    { key: 'Live', data: live, color: 'text-green-400', bg: 'bg-green-500' },
    ...stockroomKeys.map((k, i) => ({
      key: `Stockroom ${k}`,
      data: stockroom[k],
      ...STOCKROOM_PALETTE[i % STOCKROOM_PALETTE.length],
    })),
  ].filter(r => r.data.lotCount > 0);

  return (
    <div className="mx-4 my-3 rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Archive className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">BrickLink Stockroom</span>
        {stockroomPct > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            <span className="font-mono font-semibold text-foreground">{stockroomPct}%</span> held back
          </span>
        )}
      </div>

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
              <span className="text-foreground/80">{r.key}</span>
            </div>
            <div className="flex items-center gap-4 text-right">
              <span className="text-muted-foreground text-[10px]">{r.data.totalQty.toLocaleString()} pcs</span>
              <span className={`font-mono font-semibold ${r.color} min-w-[3.5rem] text-right`}>
                {r.data.lotCount.toLocaleString()} lots
              </span>
              {r.data.totalValue > 0 && (
                <span className="text-muted-foreground/60 text-[10px] min-w-[4rem] text-right">
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

function WarehouseLocationPanel({ warehouseLocation }: { warehouseLocation: HealthSummary['warehouseLocation'] }) {
  const { totalActiveLots, locatedLots, unlocatedLots, totalBins, aisles } = warehouseLocation;

  if (totalActiveLots === 0 && totalBins === 0) return null;

  const locatedPct = totalActiveLots > 0 ? Math.round(locatedLots / totalActiveLots * 100) : 0;
  const coverageColor =
    locatedPct >= 80 ? 'text-green-400' :
    locatedPct >= 40 ? 'text-amber-400' :
    'text-rose-400';

  const activeAisles = aisles.filter(a => a.locatedLots > 0);
  const emptyAisles = aisles.filter(a => a.locatedLots === 0);

  return (
    <div className="mx-4 my-3 rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <MapPin className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">Warehouse Locations</span>
        <span className={`ml-auto text-[10px] font-semibold ${coverageColor}`}>
          {locatedPct}% located
        </span>
      </div>

      {/* Coverage bar */}
      {totalActiveLots > 0 && (
        <div className="flex h-2 rounded-full overflow-hidden gap-px bg-muted/40">
          <div
            className="bg-emerald-500 transition-all"
            style={{ width: `${locatedPct}%`, minWidth: locatedLots > 0 ? '2px' : '0' }}
          />
          <div
            className="bg-rose-500/40 transition-all"
            style={{ width: `${100 - locatedPct}%`, minWidth: unlocatedLots > 0 ? '2px' : '0' }}
          />
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="text-center">
          <div className="font-mono font-semibold text-emerald-400">{locatedLots.toLocaleString()}</div>
          <div className="text-muted-foreground text-[10px]">Located</div>
        </div>
        <div className="text-center">
          <div className="font-mono font-semibold text-rose-400">{unlocatedLots.toLocaleString()}</div>
          <div className="text-muted-foreground text-[10px]">Unlocated</div>
        </div>
        <div className="text-center">
          <div className="font-mono font-semibold text-foreground">{totalBins.toLocaleString()}</div>
          <div className="text-muted-foreground text-[10px]">Bins total</div>
        </div>
      </div>

      {/* Aisle breakdown — active aisles first */}
      {aisles.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            Aisles ({aisles.length})
          </div>
          {activeAisles.map(a => (
            <div key={a.aisleId} className="flex items-center justify-between text-xs" data-testid={`wh-aisle-row-${a.aisleId}`}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-foreground/80">{a.aisleName}</span>
                <span className="text-muted-foreground text-[10px]">{a.binCount} bins</span>
              </div>
              <div className="flex items-center gap-3 text-right">
                <span className="text-muted-foreground text-[10px]">{a.totalQty.toLocaleString()} pcs</span>
                <span className="font-mono font-semibold text-emerald-400 min-w-[3rem] text-right">
                  {a.locatedLots.toLocaleString()} lots
                </span>
              </div>
            </div>
          ))}
          {emptyAisles.length > 0 && (
            <div className="text-[10px] text-muted-foreground/60 pt-1">
              {emptyAisles.length} aisle{emptyAisles.length > 1 ? 's' : ''} empty: {emptyAisles.map(a => a.aisleName).join(', ')}
            </div>
          )}
        </div>
      )}

      {totalBins > 0 && aisles.length === 0 && (
        <div className="text-[10px] text-muted-foreground/60 text-center">
          {totalBins} bins configured — no aisles set up yet
        </div>
      )}
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
    <div className="mx-4 my-3 rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">Product Mix</span>
        <span className={`ml-auto text-[10px] font-semibold ${concentration.color}`}>{concentration.label}</span>
      </div>
      <div className="text-[10px] text-muted-foreground">{totalCategories} categories · top category = {topConcentrationPct}% of lots</div>

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
                <span className="text-foreground/80 truncate">{r.category_name ?? `Category ${r.category_id}`}</span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-muted-foreground">{pct}%</span>
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
    <div className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0" data-testid={`health-row-${row.id}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-mono text-foreground/80">{row.item_no}</span>
          <ConditionBadge cond={row.new_or_used} />
          <span className="text-[9px] font-mono text-muted-foreground/50">#{row.id}</span>
        </div>
        <div className="text-[10px] text-muted-foreground truncate">
          {row.item_name}{row.color_name && row.color_name !== 'No Color' ? ` · ${row.color_name}` : ''}
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
          <div className="text-[10px] text-muted-foreground">{formatCurrency(row.unit_price)}</div>
        )}
        {category === 'zero_priced' && (
          <div className="text-[10px] text-red-400/70">no price</div>
        )}
        {category === 'dead_stock' && row.unit_price && (
          <div className="text-[10px] text-muted-foreground">{formatCurrency(row.unit_price)}</div>
        )}
        {category === 'cross_condition_dupes' && (
          <div className="text-[10px] font-mono text-fuchsia-400">
            {row.new_or_used === 'N' ? 'New' : row.new_or_used === 'U' ? 'Used' : row.new_or_used}
          </div>
        )}
        {category === 'obsolete_catalog' && (
          row.alternate_no
            ? <div className="text-[10px] font-mono text-amber-400">replace with {row.alternate_no}</div>
            : <div className="text-[10px] font-mono text-rose-400">retired · no replacement</div>
        )}
        {category === 'soft_deleted' && (
          row.is_linked
            ? <div className="text-[10px] text-sky-400">linked to order</div>
            : <div className="text-[10px] text-slate-400">no order · orphaned</div>
        )}
      </div>
    </div>
  );
}

// ─── History ────────────────────────────────────────────────────────────────

type HistoryThemeId = 'all' | 'pricing' | 'sales' | 'listings' | 'sync';

interface HistoryThemeDef {
  id: HistoryThemeId;
  label: string;
  icon: React.ElementType;
  color: string;
  fields: string[] | null;
  sources: string[] | null;
}

const HISTORY_THEMES: HistoryThemeDef[] = [
  { id: 'all',      label: 'All',      icon: History,      color: 'text-muted-foreground', fields: null,                                                                   sources: null },
  { id: 'pricing',  label: 'Pricing',  icon: DollarSign,   color: 'text-amber-400',        fields: ['unitPrice', 'saleRate'],                                              sources: null },
  { id: 'sales',    label: 'Sales',    icon: ShoppingCart, color: 'text-green-400',         fields: null,                                                                   sources: ['order', 'order_restore'] },
  { id: 'listings', label: 'Listings', icon: Replace,      color: 'text-rose-400',          fields: ['description', 'remarks', 'catalogSuperseded', 'catalogObsolete'],    sources: null },
  { id: 'sync',     label: 'BL Sync',  icon: RefreshCw,    color: 'text-violet-400',        fields: null,                                                                   sources: ['bricklink_sync'] },
];

interface HistoryRow {
  id: number;
  inventory_id: number;
  item_no: string;
  color_id: number | null;
  changed_at: string;
  source: string;
  source_ref: string | null;
  field: string;
  old_value: string | null;
  new_value: string | null;
  item_name: string | null;
  color_name: string | null;
}

function sourceBadge(source: string) {
  switch (source) {
    case 'bricklink_sync':
      return <span className="text-[9px] px-1.5 py-0 rounded bg-violet-900/40 text-violet-400 border border-violet-700/30">BL Sync</span>;
    case 'order':
      return <span className="text-[9px] px-1.5 py-0 rounded bg-green-900/40 text-green-400 border border-green-700/30">Order</span>;
    case 'order_restore':
      return <span className="text-[9px] px-1.5 py-0 rounded bg-amber-900/40 text-amber-400 border border-amber-700/30">Restore</span>;
    case 'catalog_change':
      return <span className="text-[9px] px-1.5 py-0 rounded bg-rose-900/40 text-rose-400 border border-rose-700/30">Catalog</span>;
    default:
      return <span className="text-[9px] px-1.5 py-0 rounded bg-muted text-muted-foreground border border-border/30">Manual</span>;
  }
}

function fieldLabel(field: string) {
  switch (field) {
    case 'quantity':           return 'Qty';
    case 'unitPrice':          return 'Price';
    case 'isStockRoom':        return 'Stockroom';
    case 'saleRate':           return 'Sale Rate';
    case 'remarks':            return 'Remarks';
    case 'description':        return 'Description';
    case 'catalogSuperseded':  return 'Design change';
    case 'catalogObsolete':    return 'Retired';
    default:                   return field;
  }
}

function formatHistoryValue(field: string, value: string | null) {
  if (field === 'catalogSuperseded') {
    return value
      ? <span className="font-mono text-amber-400">replacement: {value}</span>
      : <span className="text-muted-foreground/40 italic">none</span>;
  }
  if (field === 'catalogObsolete') {
    return <span className="text-rose-400">no replacement</span>;
  }
  if (value == null) return <span className="text-muted-foreground/40 italic">none</span>;
  if (field === 'unitPrice') return <span>${parseFloat(value).toFixed(2)}</span>;
  if (field === 'isStockRoom') return <span>{value === 'true' ? 'Yes' : 'No'}</span>;
  if (field === 'saleRate') return <span>{value}%</span>;
  return <span className="truncate max-w-[80px]">{value}</span>;
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function dateGroupLabel(iso: string, timezone?: string): string {
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const fmtDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
  const todayStr = fmtDate(new Date());
  const yesterdayDate = new Date(); yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = fmtDate(yesterdayDate);
  const rowStr = fmtDate(new Date(iso));
  if (rowStr === todayStr) return 'Today';
  if (rowStr === yesterdayStr) return 'Yesterday';
  const sameYear = rowStr.slice(0, 4) === todayStr.slice(0, 4);
  return new Date(iso).toLocaleDateString('en-US', { timeZone: tz, month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

function groupHistoryByDate(rows: HistoryRow[]): { label: string; rows: HistoryRow[] }[] {
  const groups: { label: string; rows: HistoryRow[] }[] = [];
  for (const row of rows) {
    const label = dateGroupLabel(row.changed_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.rows.push(row);
    } else {
      groups.push({ label, rows: [row] });
    }
  }
  return groups;
}

interface SyncJobEntry {
  jobKey: string;
  time: string;
  rows: HistoryRow[];
}

interface SyncDateEntry {
  label: string;
  jobs: SyncJobEntry[];
}

function groupSyncByDateAndJob(rows: HistoryRow[], timezone?: string): SyncDateEntry[] {
  // Cluster rows into jobs: same source_ref = same job; otherwise 5-min bucket
  const jobMap = new Map<string, SyncJobEntry>();
  for (const row of rows) {
    const jobKey = row.source_ref
      ? `ref:${row.source_ref}`
      : `t:${Math.floor(new Date(row.changed_at).getTime() / (5 * 60_000))}`;
    if (!jobMap.has(jobKey)) {
      jobMap.set(jobKey, { jobKey, time: row.changed_at, rows: [] });
    }
    jobMap.get(jobKey)!.rows.push(row);
  }

  // Group jobs by date (using org timezone so midnight boundaries are correct)
  const dateMap = new Map<string, SyncDateEntry>();
  for (const job of jobMap.values()) {
    const label = dateGroupLabel(job.time, timezone);
    if (!dateMap.has(label)) dateMap.set(label, { label, jobs: [] });
    dateMap.get(label)!.jobs.push(job);
  }

  // Sort jobs within each date DESC by time
  for (const d of dateMap.values()) {
    d.jobs.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }

  return Array.from(dateMap.values());
}

function SyncJobGroupView({ job, defaultExpanded, timezone }: { job: SyncJobEntry; defaultExpanded?: boolean; timezone?: string }) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);

  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const jobTime = new Date(job.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  const changeCount = job.rows.length;
  const jobSource = job.rows[0]?.source;

  return (
    <div className="mb-1">
      {/* Job header row */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 py-1.5 text-left hover-elevate rounded px-1"
        data-testid={`button-sync-job-${job.jobKey}`}
      >
        <ChevronRight className={`w-3 h-3 text-muted-foreground/60 flex-shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
        <span className="text-[11px] font-medium text-foreground/70">{jobTime}</span>
        {jobSource && sourceBadge(jobSource)}
        <span className="text-[10px] text-muted-foreground/50">·</span>
        <span className="text-[10px] text-muted-foreground/60">{changeCount} change{changeCount !== 1 ? 's' : ''}</span>
      </button>

      {/* Expanded item list */}
      {expanded && (
        <div className="ml-4 pl-3 border-l border-border/30 mb-2">
          {job.rows.map((row) => (
            <div
              key={row.id}
              className="flex items-start gap-3 py-2 border-b border-border/20 last:border-0"
              data-testid={`history-row-${row.id}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-mono text-foreground/80">{row.item_no}</span>
                  {row.color_name && row.color_name !== 'No Color' && (
                    <span className="text-[9px] text-muted-foreground">{row.color_name}</span>
                  )}
                  <span className="text-[9px] font-mono text-muted-foreground/40">#{row.inventory_id}</span>
                </div>
                {row.item_name && (
                  <div className="text-[10px] text-muted-foreground truncate mt-0.5">{row.item_name}</div>
                )}
                {row.field === 'catalogSuperseded' || row.field === 'catalogObsolete' ? (
                  <div className="flex items-center gap-1.5 mt-1 text-[10px]">
                    <span className="text-muted-foreground">{fieldLabel(row.field)}</span>
                    <span className="text-muted-foreground/40">—</span>
                    {formatHistoryValue(row.field, row.new_value)}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 mt-1 text-[10px]">
                    <span className="text-muted-foreground">{fieldLabel(row.field)}</span>
                    <span className="text-muted-foreground/60">{formatHistoryValue(row.field, row.old_value)}</span>
                    <span className="text-muted-foreground/40">→</span>
                    <span className={row.field === 'quantity'
                      ? (Number(row.new_value ?? 0) < Number(row.old_value ?? 0) ? 'text-red-400' : 'text-green-400')
                      : 'text-blue-400'
                    }>
                      {formatHistoryValue(row.field, row.new_value)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function buildHistoryUrl(theme: HistoryThemeDef, page: number): string {
  const params = new URLSearchParams({ page: String(page) });
  if (theme.fields)  params.set('fields',  theme.fields.join(','));
  if (theme.sources) params.set('sources', theme.sources.join(','));
  return `/api/inventory/history?${params}`;
}

function HistoryView() {
  const [page, setPage] = useState(0);
  const [themeId, setThemeId] = useState<HistoryThemeId>('all');

  const { data: appSettings } = useQuery<{ timezone?: string }>({
    queryKey: ['/api/settings'],
    staleTime: 60_000,
  });
  const timezone = appSettings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const theme = HISTORY_THEMES.find(t => t.id === themeId)!;
  const url = buildHistoryUrl(theme, page);

  const { data, isLoading } = useQuery<{ rows: HistoryRow[]; page: number; limit: number }>({
    queryKey: ['/api/inventory/history', themeId, page],
    queryFn: () => fetch(url).then(r => r.json()),
    refetchOnWindowFocus: false,
  });

  const rows = data?.rows ?? [];
  const hasMore = rows.length === (data?.limit ?? 50);

  return (
    <div className="flex flex-col h-full">
      {/* Theme filter chips */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-1.5 flex-wrap">
        {HISTORY_THEMES.map(t => (
          <button
            key={t.id}
            onClick={() => { setThemeId(t.id); setPage(0); }}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-colors ${
              themeId === t.id
                ? 'bg-muted/60 border-border text-foreground'
                : 'bg-muted/20 border-border/30 text-muted-foreground hover-elevate'
            }`}
            data-testid={`button-history-theme-${t.id}`}
          >
            <t.icon className={`w-2.5 h-2.5 ${t.color}`} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <History className="w-8 h-8 text-muted-foreground/30" />
            <span className="text-sm text-muted-foreground">No history yet</span>
            <span className="text-xs text-muted-foreground/60">
              {themeId === 'all'
                ? 'Changes appear here after a BL sync or order'
                : `No ${theme.label.toLowerCase()} changes recorded yet`}
            </span>
          </div>
        ) : themeId === 'sync' ? (
          /* ── Sync view: Date → Job (collapsible) → Items ── */
          <div>
            {groupSyncByDateAndJob(rows, timezone).map((dateGroup, dateIdx) => (
              <div key={dateGroup.label}>
                <div className="sticky top-0 z-10 flex items-center gap-2 py-1.5 bg-background/95 backdrop-blur-sm">
                  <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide">
                    {dateGroup.label}
                  </span>
                  <div className="flex-1 h-px bg-border/40" />
                </div>
                <div className="py-1">
                  {dateGroup.jobs.map((job, jobIdx) => (
                    <SyncJobGroupView
                      key={job.jobKey}
                      job={job}
                      defaultExpanded={dateIdx === 0 && jobIdx === 0}
                      timezone={timezone}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* ── Default flat view: Date → Items ── */
          <div>
            {groupHistoryByDate(rows).map((group) => (
              <div key={group.label}>
                <div className="sticky top-0 z-10 flex items-center gap-2 py-1.5 bg-background/95 backdrop-blur-sm">
                  <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide">
                    {group.label}
                  </span>
                  <div className="flex-1 h-px bg-border/40" />
                </div>

                {group.rows.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-start gap-3 py-2.5 border-b border-border/30 last:border-0"
                    data-testid={`history-row-${row.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-mono text-foreground/80">{row.item_no}</span>
                        {row.color_name && row.color_name !== 'No Color' && (
                          <span className="text-[9px] text-muted-foreground">{row.color_name}</span>
                        )}
                        {sourceBadge(row.source)}
                        {row.source_ref && (
                          <span className="text-[9px] text-muted-foreground/50">#{row.source_ref.slice(0, 12)}</span>
                        )}
                      </div>
                      {row.item_name && (
                        <div className="text-[10px] text-muted-foreground truncate mt-0.5">{row.item_name}</div>
                      )}
                      {row.field === 'catalogSuperseded' || row.field === 'catalogObsolete' ? (
                        <div className="flex items-center gap-1.5 mt-1 text-[10px]">
                          <span className="text-muted-foreground">{fieldLabel(row.field)}</span>
                          <span className="text-muted-foreground/40">—</span>
                          {formatHistoryValue(row.field, row.new_value)}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 mt-1 text-[10px]">
                          <span className="text-muted-foreground">{fieldLabel(row.field)}</span>
                          <span className="text-muted-foreground/60">
                            {formatHistoryValue(row.field, row.old_value)}
                          </span>
                          <span className="text-muted-foreground/40">→</span>
                          <span className={row.field === 'quantity'
                            ? (Number(row.new_value ?? 0) < Number(row.old_value ?? 0) ? 'text-red-400' : 'text-green-400')
                            : 'text-blue-400'
                          }>
                            {formatHistoryValue(row.field, row.new_value)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-[10px] text-muted-foreground/50 mt-0.5">
                      {relativeTime(row.changed_at)}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {(page > 0 || hasMore) && (
        <div className="flex-shrink-0 border-t border-border px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {(page * 50 + 1)}–{page * 50 + rows.length}
          </span>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="button-history-prev">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" disabled={!hasMore} onClick={() => setPage(p => p + 1)} data-testid="button-history-next">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
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
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-500/40" />
            <span className="text-sm text-muted-foreground">Nothing to show here</span>
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
        <div className="flex-shrink-0 border-t border-border px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
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

// ── Sets Readiness ────────────────────────────────────────────────────────────

interface SetLot {
  id: number;
  quantity: number;
  newOrUsed: string;
  unitPrice: string | null;
  myCost: string | null;
  completeness: string | null;
  isStockRoom: boolean;
  stockRoomId: string | null;
  description: string | null;
  remarks: string | null;
  hasInstructions: boolean | null;
  hasBox: boolean | null;
  pctComplete: number | null;
  completenessNotes: string;
  missingPieces: number | null;
  missingLots: number | null;
  saleLocation: string;
}

interface SetGroup {
  itemNo: string;
  itemName: string;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  yearReleased: number | null;
  lots: SetLot[];
}

function LotReadinessRow({ lot, onSaved }: { lot: SetLot; onSaved: () => void }) {
  const [r, setR] = useState({ ...lot });
  const [saved, setSaved] = useState(false);

  const { mutate } = useMutation({
    mutationFn: (patch: Record<string, any>) =>
      apiRequest('PATCH', `/api/inventory/${lot.id}/readiness`, patch),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      onSaved();
    },
  });

  function save(patch: Record<string, any>) { mutate(patch); }

  function toggleBool(field: 'hasInstructions' | 'hasBox', target: boolean) {
    const v = r[field] === target ? null : target;
    setR(prev => ({ ...prev, [field]: v }));
    save({ [field]: v });
  }

  const yesBtn = (field: 'hasInstructions' | 'hasBox') =>
    `px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
      r[field] === true
        ? 'bg-emerald-500/30 border-emerald-500/60 text-emerald-300'
        : 'bg-white/5 border-white/10 text-gray-500 hover:bg-white/10'
    }`;
  const noBtn = (field: 'hasInstructions' | 'hasBox') =>
    `px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
      r[field] === false
        ? 'bg-rose-500/30 border-rose-500/60 text-rose-300'
        : 'bg-white/5 border-white/10 text-gray-500 hover:bg-white/10'
    }`;

  const inputCls = 'h-6 w-full text-[11px] bg-black/30 border border-white/10 rounded px-1.5 text-white placeholder:text-gray-600 focus:outline-none focus:border-white/30';

  const cond = r.newOrUsed === 'N' ? 'New' : 'Used';
  const condColor = r.newOrUsed === 'N' ? 'text-emerald-400' : 'text-amber-400';
  const price = r.unitPrice ? `$${parseFloat(r.unitPrice).toFixed(2)}` : '—';
  const stockroomLabel = r.isStockRoom ? (r.stockRoomId ? `SR-${r.stockRoomId}` : 'SR') : null;

  return (
    <div className="border border-white/10 rounded-lg bg-black/20 p-2.5 space-y-2" data-testid={`lot-readiness-row-${lot.id}`}>
      {/* Lot header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-bold ${condColor}`}>{cond}</span>
        <span className="text-[10px] font-mono text-gray-400">#{lot.id}</span>
        <span className="text-[10px] font-mono text-white font-semibold">Qty: {r.quantity}</span>
        <span className="text-[10px] font-mono text-white">{price}</span>
        {stockroomLabel && <span className="text-[10px] text-sky-400 font-mono">{stockroomLabel}</span>}
        {r.completeness && <span className="text-[10px] text-gray-500">{r.completeness === 'C' ? 'Complete' : r.completeness === 'B' ? 'w/Box' : r.completeness === 'I' ? 'w/Instr' : r.completeness}</span>}
        {saved && <span className="ml-auto text-[9px] text-emerald-400 animate-pulse">Saved</span>}
      </div>

      {/* BL Description */}
      {lot.description && (
        <p className="text-[10px] text-gray-400 leading-snug px-0.5 border-l-2 border-white/10 pl-2">
          {lot.description}
        </p>
      )}

      {/* Row 1: Instructions + Box Y/N */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wide">Instructions</span>
          <div className="flex gap-1">
            <button onClick={() => toggleBool('hasInstructions', true)} className={yesBtn('hasInstructions')} data-testid={`btn-instr-yes-${lot.id}`}>Y</button>
            <button onClick={() => toggleBool('hasInstructions', false)} className={noBtn('hasInstructions')} data-testid={`btn-instr-no-${lot.id}`}>N</button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wide">Box</span>
          <div className="flex gap-1">
            <button onClick={() => toggleBool('hasBox', true)} className={yesBtn('hasBox')} data-testid={`btn-box-yes-${lot.id}`}>Y</button>
            <button onClick={() => toggleBool('hasBox', false)} className={noBtn('hasBox')} data-testid={`btn-box-no-${lot.id}`}>N</button>
          </div>
        </div>
      </div>

      {/* Row 2: % Complete */}
      <div className="flex flex-col gap-1">
        <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wide">% Complete</span>
        <input
          type="number" min={0} max={100}
          value={r.pctComplete ?? ''}
          onChange={e => setR(p => ({ ...p, pctComplete: e.target.value === '' ? null : Number(e.target.value) }))}
          onBlur={() => save({ pctComplete: r.pctComplete })}
          placeholder="0–100"
          className={inputCls}
          data-testid={`input-pct-${lot.id}`}
        />
      </div>

      {/* Row 3: Missing Pieces + Missing Lots */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wide">Missing Pcs</span>
          <input
            type="number" min={0}
            value={r.missingPieces ?? ''}
            onChange={e => setR(p => ({ ...p, missingPieces: e.target.value === '' ? null : Number(e.target.value) }))}
            onBlur={() => save({ missingPieces: r.missingPieces })}
            placeholder="0"
            className={inputCls}
            data-testid={`input-missing-pcs-${lot.id}`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wide">Missing Lots</span>
          <input
            type="number" min={0}
            value={r.missingLots ?? ''}
            onChange={e => setR(p => ({ ...p, missingLots: e.target.value === '' ? null : Number(e.target.value) }))}
            onBlur={() => save({ missingLots: r.missingLots })}
            placeholder="0"
            className={inputCls}
            data-testid={`input-missing-lots-${lot.id}`}
          />
        </div>
      </div>

      {/* Row 4: Overview (full width) */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wide">Overview</span>
          <span className="text-[9px] text-gray-600">{r.completenessNotes.length}/50</span>
        </div>
        <input
          type="text" maxLength={50}
          value={r.completenessNotes}
          onChange={e => setR(p => ({ ...p, completenessNotes: e.target.value.slice(0, 50) }))}
          onBlur={() => save({ completenessNotes: r.completenessNotes || null })}
          placeholder="Brief description of completeness…"
          className={inputCls}
          data-testid={`input-notes-${lot.id}`}
        />
      </div>
    </div>
  );
}

function SetsReadinessView({ open }: { open: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const { data: sets, isLoading, refetch } = useQuery<SetGroup[]>({
    queryKey: ['/api/inventory/sets-readiness'],
    enabled: open,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const filtered = (sets ?? []).filter(s =>
    !search || s.itemNo.toLowerCase().includes(search.toLowerCase()) || s.itemName.toLowerCase().includes(search.toLowerCase())
  );

  function toggleExpand(itemNo: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(itemNo)) next.delete(itemNo); else next.add(itemNo);
      return next;
    });
  }

  function expandAll() { setExpanded(new Set((sets ?? []).map(s => s.itemNo))); }
  function collapseAll() { setExpanded(new Set()); }

  // Readiness badge helper
  function readinessBadge(lot: SetLot) {
    const checks = [
      lot.hasInstructions === true,
      lot.hasBox === true,
      lot.pctComplete !== null,
    ];
    const done = checks.filter(Boolean).length;
    const pct = Math.round(done / checks.length * 100);
    const color = pct === 100 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-rose-400';
    return <span className={`text-[9px] font-mono font-semibold ${color}`}>{pct}%</span>;
  }

  if (isLoading) {
    return (
      <div className="px-4 pt-4 space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-lg bg-muted/30 animate-pulse" />)}
      </div>
    );
  }

  if (!sets || sets.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center px-4">
        <Package className="w-10 h-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No SET inventory found</p>
        <p className="text-[11px] text-muted-foreground/60">Items with item type SET will appear here</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search sets…"
            className="w-full h-7 pl-6 pr-2 text-xs bg-muted/30 border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-muted-foreground"
            data-testid="input-sets-search"
          />
        </div>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">{filtered.length} set{filtered.length !== 1 ? 's' : ''}</span>
        <button onClick={expandAll} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">All ↓</button>
        <button onClick={collapseAll} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">All ↑</button>
        <button onClick={() => refetch()} className="text-muted-foreground hover:text-foreground transition-colors" data-testid="button-sets-refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Set groups */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground/60 text-sm">
            No sets match your search
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {filtered.map(set => {
              const isOpen = expanded.has(set.itemNo);
              const totalLots = set.lots.length;
              const readyLots = set.lots.filter(l =>
                l.hasInstructions !== null && l.hasBox !== null && l.pctComplete !== null
              ).length;

              return (
                <div key={set.itemNo} data-testid={`set-group-${set.itemNo}`}>
                  {/* Set header row */}
                  <button
                    onClick={() => toggleExpand(set.itemNo)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover-elevate text-left"
                    data-testid={`btn-set-expand-${set.itemNo}`}
                  >
                    {/* Thumbnail */}
                    <div className="w-9 h-9 rounded bg-black/30 flex items-center justify-center shrink-0 overflow-hidden">
                      {set.thumbnailUrl ? (
                        <img src={set.thumbnailUrl} alt={set.itemName} className="w-full h-full object-contain" />
                      ) : (
                        <Package className="w-4 h-4 text-muted-foreground/40" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-foreground truncate">{set.itemName}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-mono text-muted-foreground">{set.itemNo}</span>
                        {set.yearReleased && <span className="text-[10px] text-muted-foreground/60">{set.yearReleased}</span>}
                        <span className="text-[10px] text-muted-foreground">{totalLots} lot{totalLots !== 1 ? 's' : ''}</span>
                      </div>
                    </div>

                    {/* Readiness summary */}
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <div className="text-[9px] text-muted-foreground">Ready</div>
                        <div className={`text-[10px] font-mono font-semibold ${readyLots === totalLots ? 'text-emerald-400' : readyLots > 0 ? 'text-amber-400' : 'text-rose-400'}`}>
                          {readyLots}/{totalLots}
                        </div>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`} />
                    </div>
                  </button>

                  {/* Expanded lots */}
                  {isOpen && (
                    <div className="px-4 pb-3 space-y-2">
                      {set.lots.map(lot => (
                        <LotReadinessRow
                          key={lot.id}
                          lot={lot}
                          onSaved={() => {}}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface InventoryHealthPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inline?: boolean;
}

export default function InventoryHealthPanel({ open, onOpenChange, inline }: InventoryHealthPanelProps) {
  const [mainTab, setMainTab] = useState<'health' | 'sets'>('health');
  const [selectedCategory, setSelectedCategory] = useState<HealthCategory | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const { data: health, isLoading } = useQuery<HealthSummary>({
    queryKey: ['/api/inventory/health'],
    enabled: open,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const categories: CategoryCard[] = health ? [
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
      theme: 'pricing',
    },
    {
      id: 'negative_margin',
      label: 'Selling at a Loss',
      description: 'Price is below your recorded cost',
      icon: TrendingDown,
      accentColor: 'text-red-400',
      borderColor: 'border-red-500/40',
      bgColor: 'bg-red-950/30',
      count: health.negativeMargin,
      countLabel: 'lots',
      severity: 'critical',
      theme: 'pricing',
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
      theme: 'pricing',
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
      theme: 'pricing',
    },
    {
      id: 'duplicates',
      label: 'Possible Duplicate Lots',
      description: `${health.duplicates.groups} groups · same part, color, condition & price`,
      icon: Copy,
      accentColor: 'text-violet-400',
      borderColor: 'border-violet-500/40',
      bgColor: 'bg-violet-950/30',
      count: health.duplicates.lots,
      countLabel: 'lots in dupes',
      severity: 'warning',
      theme: 'listings',
    },
    {
      id: 'cross_condition_dupes',
      label: 'Listed as Both New & Used',
      description: `${health.crossConditionDupes.groups} items · same part/color in N and U`,
      icon: ArrowLeftRight,
      accentColor: 'text-fuchsia-400',
      borderColor: 'border-fuchsia-500/40',
      bgColor: 'bg-fuchsia-950/30',
      count: health.crossConditionDupes.lots,
      countLabel: 'lots',
      severity: 'warning',
      theme: 'listings',
    },
    {
      id: 'obsolete_catalog',
      label: 'Design Changes & Retired Parts',
      description: 'Mold/color variations — BrickLink has issued replacement IDs or retired these parts',
      icon: Replace,
      accentColor: 'text-rose-400',
      borderColor: 'border-rose-500/40',
      bgColor: 'bg-rose-950/30',
      count: health.obsoleteCatalog,
      countLabel: 'lots',
      severity: 'warning',
      theme: 'listings',
    },
    {
      id: 'soft_deleted',
      label: 'Soft-Deleted Lots',
      description: health.softDeleted
        ? `${health.softDeleted.linked} linked to orders · ${health.softDeleted.standalone} with no order`
        : 'Lots removed from BL inventory but still in the database',
      icon: Trash2,
      accentColor: 'text-slate-400',
      borderColor: 'border-slate-500/40',
      bgColor: 'bg-slate-950/30',
      count: health.softDeleted?.total ?? 0,
      countLabel: 'lots',
      severity: 'info',
      theme: 'listings',
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
      theme: 'sales',
    },
  ] : [];

  const totalIssues = categories.reduce((s, c) => s + c.count, 0);
  const criticalCount = categories.filter(c => c.severity === 'critical' && c.count > 0).length;
  const warningCount  = categories.filter(c => c.severity === 'warning'  && c.count > 0).length;

  const activeCard = categories.find(c => c.id === selectedCategory);

  function handleClose() {
    onOpenChange(false);
    setSelectedCategory(null);
    setShowHistory(false);
    setMainTab('health');
  }

  function handleBack() {
    if (selectedCategory) { setSelectedCategory(null); return; }
    if (showHistory)      { setShowHistory(false);      return; }
  }

  const tabStrip = (
    <div className="flex border-b border-border flex-shrink-0 px-4">
      <button
        onClick={() => { setMainTab('health'); setSelectedCategory(null); setShowHistory(false); }}
        className={`py-2 px-3 text-xs font-semibold border-b-2 transition-colors ${mainTab === 'health' ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        data-testid="tab-health"
      >
        HEALTH
      </button>
      <button
        onClick={() => setMainTab('sets')}
        className={`py-2 px-3 text-xs font-semibold border-b-2 transition-colors ${mainTab === 'sets' ? 'border-emerald-400 text-emerald-400' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        data-testid="tab-sets"
      >
        SETS
      </button>
    </div>
  );

  const innerContent = mainTab === 'sets' ? (
    <SetsReadinessView open={open} />
  ) : (
    <div className="flex-1 overflow-y-auto min-h-0">
      {showHistory ? (
        <HistoryView />
      ) : selectedCategory && activeCard ? (
        <DetailView
          category={selectedCategory}
          title={activeCard.label}
          icon={activeCard.icon}
          accentColor={activeCard.accentColor}
        />
      ) : (
        <div className="pb-6">
          <div className="px-4 pt-3 pb-2">
            {isLoading ? (
              <div className="h-14 rounded-lg bg-muted/40 animate-pulse" />
            ) : (
              <div className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border ${
                criticalCount > 0 ? 'bg-red-950/30 border-red-500/30'
                : warningCount > 0 ? 'bg-amber-950/30 border-amber-500/30'
                : 'bg-green-950/30 border-green-500/30'
              }`} data-testid="health-score-banner">
                {criticalCount > 0 ? <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                  : warningCount > 0 ? <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                  : <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />}
                <div>
                  {totalIssues === 0 ? (
                    <p className="text-sm font-semibold text-green-300">Inventory looks healthy</p>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-foreground">{totalIssues.toLocaleString()} issue{totalIssues !== 1 ? 's' : ''} detected</p>
                      <p className="text-[10px] text-muted-foreground">
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
          {isLoading ? (
            <div className="px-4 space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />)}</div>
          ) : (
            <>{HEALTH_THEMES.map(theme => <ThemeSection key={theme.id} theme={theme} cards={categories.filter(c => c.theme === theme.id)} onSelect={setSelectedCategory} />)}</>
          )}
          {health && (
            <div className="px-4 mt-4">
              <div className="flex items-center gap-1.5 mb-1">
                <BarChart3 className="w-3 h-3 text-muted-foreground/60" />
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">Analytics</p>
              </div>
            </div>
          )}
          {health && health.itemTypeBreakdown?.length > 0 && <ItemTypeBreakdown rows={health.itemTypeBreakdown} />}
          {health && <StockroomOverview stockroom={health.stockroom} />}
          {health && health.warehouseLocation && <WarehouseLocationPanel warehouseLocation={health.warehouseLocation} />}
          {health && health.productMix.rows.length > 0 && <ProductMixOverview productMix={health.productMix} />}
          <div className="px-4 mt-3">
            <button onClick={() => setShowHistory(true)} className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-border/50 bg-muted/20 hover-elevate text-sm" data-testid="button-view-history">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-violet-400 shrink-0" />
                <span className="text-foreground font-medium">Change History</span>
              </div>
              <div className="flex items-center gap-1 text-muted-foreground">
                <span className="text-[11px]">Pricing · Sales · Listings · BL Sync</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const headerTitle = mainTab === 'sets'
    ? <span className="flex items-center gap-1.5"><Package className="w-4 h-4 text-emerald-400 shrink-0" />Sets Readiness</span>
    : selectedCategory && activeCard
      ? <span className="flex items-center gap-1.5"><activeCard.icon className={`w-4 h-4 ${activeCard.accentColor} shrink-0`} />{activeCard.label}</span>
      : showHistory
      ? <span className="flex items-center gap-1.5"><History className="w-4 h-4 text-violet-400 shrink-0" />Change History</span>
      : 'Inventory Health';

  const showBackBtn = mainTab === 'health' && (selectedCategory !== null || showHistory);

  if (inline) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0">
          {showBackBtn ? (
            <button onClick={handleBack} className="text-muted-foreground hover:text-foreground transition-colors mr-1 flex-shrink-0" data-testid="button-health-back">
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <Activity className="w-4 h-4 text-cyan-400 flex-shrink-0" />
          )}
          <span className="text-sm font-semibold text-foreground flex-1">{headerTitle}</span>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors" data-testid="button-health-close">
            <X className="w-5 h-5" />
          </button>
        </div>
        {!showBackBtn && tabStrip}
        <div className="flex-1 min-h-0 flex flex-col">
          {innerContent}
        </div>
      </div>
    );
  }

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DrawerContent className="bg-background border-border h-[80vh] flex flex-col rounded-t-2xl">
        <DrawerHeader className="p-0 flex-shrink-0">
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-muted" />
          </div>
          <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-border">
            {showBackBtn ? (
              <button
                onClick={handleBack}
                className="text-muted-foreground hover:text-foreground transition-colors mr-1 flex-shrink-0"
                data-testid="button-health-back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <Activity className="w-4 h-4 text-cyan-400 flex-shrink-0" />
            )}
            <DrawerTitle className="text-sm font-semibold text-foreground flex-1">
              {headerTitle}
            </DrawerTitle>
            <DrawerClose
              className="ml-2 text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-health-close"
              onClick={handleClose}
            >
              <X className="w-5 h-5" />
              <span className="sr-only">Close</span>
            </DrawerClose>
          </div>
          {!showBackBtn && tabStrip}
        </DrawerHeader>
        <div className="flex-1 min-h-0 flex flex-col">
          {innerContent}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

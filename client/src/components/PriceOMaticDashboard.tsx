import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {  
  Sparkles,
  RefreshCw,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  DollarSign,
  Orbit,
  Rocket,
  Satellite,
  Info,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";

const DEEP_SPACE_LS_KEY = 'pom_deep_space_keys';
const DEEP_SPACE_ITEMS_LS_KEY = 'pom_deep_space_items';
const FUTURE_MISSIONS_LS_KEY = 'pom_future_missions_keys';
const FUTURE_MISSIONS_ITEMS_LS_KEY = 'pom_future_missions_items';

const SHORT_SWIPE = 80;
const LONG_SWIPE = 160;
const MAX_OFFSET = 220;

interface StoredGroupInfo {
  key: string;
  itemNo: string;
  itemName: string | null;
  colorId: number | null;
  colorName: string | null;
  colorRgb: string | null;
}

function lsLoadDeepSpace(): Set<string> {
  try {
    const raw = localStorage.getItem(DEEP_SPACE_LS_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}
function lsSaveDeepSpace(keys: Set<string>) {
  localStorage.setItem(DEEP_SPACE_LS_KEY, JSON.stringify(Array.from(keys)));
}
function lsLoadDeepSpaceItems(): Map<string, StoredGroupInfo> {
  try {
    const raw = localStorage.getItem(DEEP_SPACE_ITEMS_LS_KEY);
    if (raw) { const arr: StoredGroupInfo[] = JSON.parse(raw); return new Map(arr.map(i => [i.key, i])); }
  } catch {}
  return new Map();
}
function lsSaveDeepSpaceItems(items: Map<string, StoredGroupInfo>) {
  localStorage.setItem(DEEP_SPACE_ITEMS_LS_KEY, JSON.stringify(Array.from(items.values())));
}
function lsLoadFutureMissions(): Set<string> {
  try {
    const raw = localStorage.getItem(FUTURE_MISSIONS_LS_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}
function lsSaveFutureMissions(keys: Set<string>) {
  localStorage.setItem(FUTURE_MISSIONS_LS_KEY, JSON.stringify(Array.from(keys)));
}
function lsLoadFutureMissionsItems(): Map<string, StoredGroupInfo> {
  try {
    const raw = localStorage.getItem(FUTURE_MISSIONS_ITEMS_LS_KEY);
    if (raw) { const arr: StoredGroupInfo[] = JSON.parse(raw); return new Map(arr.map(i => [i.key, i])); }
  } catch {}
  return new Map();
}
function lsSaveFutureMissionsItems(items: Map<string, StoredGroupInfo>) {
  localStorage.setItem(FUTURE_MISSIONS_ITEMS_LS_KEY, JSON.stringify(Array.from(items.values())));
}

interface SyncStatus {
  id: string;
  lastSyncStatus: string;
  lastSyncTime: string | null;
  recordsUpdated: number;
  errorMessage?: string | null;
  callsLast24h?: number;
}

interface PricingInsight {
  inventoryId: number;
  itemNo: string;
  itemName: string | null;
  itemType: string;
  colorId: number | null;
  colorName: string | null;
  colorRgb: string | null;
  newOrUsed: string;
  currentPrice: string;
  myCost?: string | null;
  stockAvgPrice: string | null;
  stockMinPrice?: string | null;
  stockMaxPrice?: string | null;
  stockQuantity?: number | null;
  stockTotalLots?: number | null;
  soldAvgPrice?: string | null;
  soldMinPrice?: string | null;
  soldMaxPrice?: string | null;
  soldQuantity?: number | null;
  soldTotalLots?: number | null;
  marketPeakSoldPrice?: string | null;
  opportunityScore: number | null;
  priceCeilingRatio: number | null;
  demandVelocity: number | null;
  marketScarcity: number | null;
  undercutRatio: number | null;
  repricingScore: number | null;
  quantity: number;
  lastFetched: string;
}

interface InsightsData {
  items: PricingInsight[];
  summary: {
    total: number;
  };
}

interface GroupedInsight {
  key: string;
  itemNo: string;
  itemName: string | null;
  colorId: number | null;
  colorName: string | null;
  colorRgb: string | null;
  newLot: PricingInsight | null;
  usedLot: PricingInsight | null;
  bestCeiling: number | null;
  bestVelocity: number | null;
  bestScarcity: number | null;
  bestUndercut: number | null;
  bestCombined: number | null;
}

type SortField = 'combined' | 'ceiling' | 'velocity' | 'scarcity' | 'undercut';

interface PriceOMaticDashboardProps {
  onItemClick?: (type: 'inventory' | 'order', id: number) => void;
}

type ZoneFilter = 'in_orbit' | 'future_missions' | 'deep_space';

interface SwipeIntent {
  zone: ZoneFilter;
  label: string;
  color: string;
  bg: string;
  icon: React.ReactNode;
}

function getSwipeIntent(orbitFilter: ZoneFilter, swipeDelta: number): SwipeIntent | null {
  const abs = Math.abs(swipeDelta);
  if (abs < SHORT_SWIPE) return null;

  if (orbitFilter === 'in_orbit' && swipeDelta > 0) {
    if (abs >= LONG_SWIPE) {
      return {
        zone: 'deep_space',
        label: 'Deep Space',
        color: 'text-indigo-300',
        bg: 'linear-gradient(to right, rgba(99,40,220,0.45), rgba(79,70,229,0.25))',
        icon: <Rocket className="w-4 h-4 text-indigo-300 flex-shrink-0" />,
      };
    }
    return {
      zone: 'future_missions',
      label: 'Future Missions',
      color: 'text-amber-300',
      bg: 'linear-gradient(to right, rgba(180,100,0,0.45), rgba(217,119,6,0.20))',
      icon: <Satellite className="w-4 h-4 text-amber-300 flex-shrink-0" />,
    };
  }

  if (orbitFilter === 'future_missions') {
    if (swipeDelta < 0) {
      return {
        zone: 'in_orbit',
        label: 'In Orbit',
        color: 'text-emerald-300',
        bg: 'linear-gradient(to left, rgba(16,100,50,0.45), rgba(16,185,129,0.20))',
        icon: <Orbit className="w-4 h-4 text-emerald-300 flex-shrink-0" />,
      };
    }
    return {
      zone: 'deep_space',
      label: 'Deep Space',
      color: 'text-indigo-300',
      bg: 'linear-gradient(to right, rgba(99,40,220,0.45), rgba(79,70,229,0.25))',
      icon: <Rocket className="w-4 h-4 text-indigo-300 flex-shrink-0" />,
    };
  }

  if (orbitFilter === 'deep_space' && swipeDelta < 0) {
    if (abs >= LONG_SWIPE) {
      return {
        zone: 'in_orbit',
        label: 'In Orbit',
        color: 'text-emerald-300',
        bg: 'linear-gradient(to left, rgba(16,100,50,0.45), rgba(16,185,129,0.20))',
        icon: <Orbit className="w-4 h-4 text-emerald-300 flex-shrink-0" />,
      };
    }
    return {
      zone: 'future_missions',
      label: 'Future Missions',
      color: 'text-amber-300',
      bg: 'linear-gradient(to left, rgba(180,100,0,0.45), rgba(217,119,6,0.20))',
      icon: <Satellite className="w-4 h-4 text-amber-300 flex-shrink-0" />,
    };
  }

  return null;
}

function SwipeableTile({
  group,
  orbitFilter,
  onMoveToZone,
  children,
}: {
  group: GroupedInsight;
  orbitFilter: ZoneFilter;
  onMoveToZone: (group: GroupedInsight, targetZone: ZoneFilter) => void;
  children: React.ReactNode;
}) {
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  const [swipeDelta, setSwipeDelta] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [launchDir, setLaunchDir] = useState<1 | -1>(1);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    setSwiping(false);
    setSwipeDelta(0);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!swiping && Math.abs(dy) > Math.abs(dx)) return;

    const allowRight = orbitFilter === 'in_orbit' || orbitFilter === 'future_missions';
    const allowLeft  = orbitFilter === 'deep_space' || orbitFilter === 'future_missions';

    if (dx > 0 && allowRight) {
      setSwiping(true);
      setSwipeDelta(Math.min(dx, MAX_OFFSET));
      e.preventDefault();
    } else if (dx < 0 && allowLeft) {
      setSwiping(true);
      setSwipeDelta(Math.max(dx, -MAX_OFFSET));
      e.preventDefault();
    }
  }, [swiping, orbitFilter]);

  const onTouchEnd = useCallback(() => {
    const intent = getSwipeIntent(orbitFilter, swipeDelta);
    if (intent) {
      const dir = swipeDelta > 0 ? 1 : -1;
      setLaunchDir(dir);
      setLaunched(true);
      setTimeout(() => {
        onMoveToZone(group, intent.zone);
        setLaunched(false);
        setSwipeDelta(0);
        setSwiping(false);
      }, 260);
    } else {
      setSwipeDelta(0);
      setSwiping(false);
    }
    touchStartX.current = null;
    touchStartY.current = null;
  }, [swipeDelta, orbitFilter, group, onMoveToZone]);

  const absSwipeDelta = Math.abs(swipeDelta);
  const translateX = launched ? launchDir * 340 : swipeDelta;
  const opacity = launched ? 0 : 1 - (absSwipeDelta / 280);
  const intent = getSwipeIntent(orbitFilter, swipeDelta);
  const showLabel = absSwipeDelta >= SHORT_SWIPE * 0.65;

  const isLong = absSwipeDelta >= LONG_SWIPE;
  const isMidZone = absSwipeDelta >= SHORT_SWIPE && !isLong;

  return (
    <div className="relative overflow-hidden rounded-lg">
      <div
        className={`absolute inset-0 rounded-lg flex items-center px-4 gap-2 transition-all duration-150 ${
          swipeDelta < 0 ? 'justify-end' : ''
        }`}
        style={{ background: intent?.bg ?? 'transparent' }}
      >
        {intent && showLabel && (
          <>
            {intent.icon}
            <div className="flex flex-col">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${intent.color}`}>
                {intent.label}
              </span>
              {isMidZone && orbitFilter === 'in_orbit' && (
                <span className="text-[8px] text-amber-500/70 tracking-wide">keep swiping for Deep Space</span>
              )}
              {isMidZone && orbitFilter === 'deep_space' && (
                <span className="text-[8px] text-amber-500/70 tracking-wide">keep swiping for In Orbit</span>
              )}
            </div>
            {(orbitFilter === 'in_orbit' || orbitFilter === 'deep_space') && (
              <div
                className="absolute top-1 bottom-1 w-[2px] bg-white/10 rounded"
                style={{
                  [swipeDelta > 0 ? 'left' : 'right']: `${LONG_SWIPE}px`,
                }}
              />
            )}
          </>
        )}
      </div>

      <div
        ref={tileRef}
        style={{
          transform: `translateX(${translateX}px)`,
          opacity,
          transition: swiping ? 'none' : 'transform 0.26s ease, opacity 0.26s ease',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}

const fmt = (v: any) => {
  if (v == null) return '—';
  const num = typeof v === 'string' ? parseFloat(v) : Number(v);
  if (isNaN(num) || num <= 0) return '—';
  return `$${num.toFixed(2)}`;
};
const fmtInt = (v: any) => v != null ? String(v) : '—';

const scoreColor = (score: number | null) => {
  if (score === null || score === undefined) return 'text-gray-600';
  if (score >= 2.0) return 'text-emerald-400';
  if (score >= 1.5) return 'text-orange-400';
  if (score >= 1.0) return 'text-yellow-500';
  return 'text-gray-500';
};

const GR = 'grid grid-cols-[1fr_52px_52px_52px_52px]';
const cell = (extra = '') => `px-1 py-1 text-center text-[10px] font-mono tabular-nums border-l border-white/[0.06] ${extra}`;

type CellHL = { sN?: boolean; sU?: boolean; lN?: boolean; lU?: boolean };

const HL_CELL = 'bg-violet-500/[0.18] ring-1 ring-inset ring-violet-400/40';

function PricingGrid({ group, activeSort }: { group: GroupedInsight; activeSort: SortField }) {
  const nLot = group.newLot;
  const uLot = group.usedLot;

  const hlMap: Record<string, CellHL> = {};
  if (activeSort === 'ceiling')  { hlMap['Max'] = { sN: true, sU: true }; hlMap['Mine'] = { sN: true, sU: true }; }
  if (activeSort === 'velocity') { hlMap['Qty'] = { sN: true, sU: true, lN: true, lU: true }; }
  if (activeSort === 'scarcity') { hlMap['Qty'] = { lN: true, lU: true }; }
  if (activeSort === 'undercut') { hlMap['Min'] = { lN: true, lU: true }; hlMap['Mine'] = { sN: true, sU: true }; }

  const DataRow = ({ label, sN, sU, lN, lU, isMoney, bold, mine }: {
    label: string; sN: any; sU: any; lN: any; lU: any; isMoney?: boolean; bold?: boolean; mine?: boolean;
  }) => {
    const hl = hlMap[label];
    return (
      <div className={`${GR} border-b border-white/[0.04] ${bold ? 'bg-white/[0.03]' : ''}`}>
        <div className={`px-2 py-1 text-[10px] ${mine ? 'text-emerald-400 font-semibold' : bold ? 'text-gray-200 font-semibold' : 'text-gray-500'}`}>{label}</div>
        <div className={cell(`${mine ? 'text-emerald-300 font-semibold' : bold ? 'text-amber-300 font-semibold' : 'text-gray-200'} ${hl?.sN ? HL_CELL : ''}`)}>{isMoney ? fmt(sN) : fmtInt(sN)}</div>
        <div className={cell(`${mine ? 'text-emerald-300 font-semibold' : bold ? 'text-amber-300 font-semibold' : 'text-gray-200'} ${hl?.sU ? HL_CELL : ''}`)}>{isMoney ? fmt(sU) : fmtInt(sU)}</div>
        <div className={cell(`${mine ? 'text-gray-700' : bold ? 'text-sky-300 font-semibold' : 'text-gray-400'} ${hl?.lN && !mine ? HL_CELL : ''}`)}>{mine ? '' : isMoney ? fmt(lN) : fmtInt(lN)}</div>
        <div className={cell(`${mine ? 'text-gray-700' : bold ? 'text-sky-300 font-semibold' : 'text-gray-400'} ${hl?.lU && !mine ? HL_CELL : ''}`)}>{mine ? '' : isMoney ? fmt(lU) : fmtInt(lU)}</div>
      </div>
    );
  };

  return (
    <div className="rounded-md overflow-hidden border border-white/[0.08] mt-1">
      <div className={`${GR} bg-white/[0.06]`}>
        <div className="px-2 py-1" />
        <div className="col-span-2 py-1 text-center text-[8px] uppercase tracking-widest font-bold text-amber-400 border-l border-white/[0.08]">
          Sold 6mo
        </div>
        <div className="col-span-2 py-1 text-center text-[8px] uppercase tracking-widest font-bold text-sky-400 border-l border-white/[0.10]">
          Listed
        </div>
      </div>
      <div className={`${GR} border-b border-white/[0.10] bg-white/[0.03]`}>
        <div className="px-2 py-0.5" />
        <div className={cell('text-[8px] uppercase font-bold text-blue-300 py-0.5')}>New</div>
        <div className={cell('text-[8px] uppercase font-bold text-orange-300 py-0.5')}>Used</div>
        <div className={cell('text-[8px] uppercase font-bold text-blue-300 py-0.5')}>New</div>
        <div className={cell('text-[8px] uppercase font-bold text-orange-300 py-0.5')}>Used</div>
      </div>
      <DataRow label="Qty" sN={nLot?.soldTotalLots} sU={uLot?.soldTotalLots} lN={nLot?.stockTotalLots} lU={uLot?.stockTotalLots} />
      <DataRow label="Min" sN={nLot?.soldMinPrice} sU={uLot?.soldMinPrice} lN={nLot?.stockMinPrice} lU={uLot?.stockMinPrice} isMoney />
      <DataRow bold label="Avg" sN={nLot?.soldAvgPrice} sU={uLot?.soldAvgPrice} lN={nLot?.stockAvgPrice} lU={uLot?.stockAvgPrice} isMoney />
      <DataRow label="Max" sN={nLot?.soldMaxPrice} sU={uLot?.soldMaxPrice} lN={nLot?.stockMaxPrice} lU={uLot?.stockMaxPrice} isMoney />
      <DataRow mine bold label="Mine" sN={nLot?.currentPrice} sU={uLot?.currentPrice} lN={null} lU={null} isMoney />
    </div>
  );
}

function calcSuggested(lot: PricingInsight | null): { suggested: number | null; premium: number | null; premiumScore: number | null } {
  if (!lot) return { suggested: null, premium: null, premiumScore: null };
  const soldAvg = parseFloat(lot.soldAvgPrice || '0');
  const soldMax = parseFloat(lot.soldMaxPrice || '0');
  const stockMin = parseFloat(lot.stockMinPrice || '0');
  const velocity = lot.demandVelocity ?? 0;
  const scarcity = lot.marketScarcity ?? 0;

  if (soldAvg <= 0 && stockMin <= 0) return { suggested: null, premium: null, premiumScore: null };

  const base = (soldAvg > 0 ? soldAvg * 0.5 : 0)
    + (stockMin > 0 ? stockMin * 0.3 : 0)
    + (soldMax > 0 ? soldMax * 0.2 : 0);
  if (base <= 0) return { suggested: null, premium: null, premiumScore: null };

  const demandAdj = 1 + (velocity * 0.25);
  let raw = base * demandAdj;

  if (stockMin > 0) raw = Math.min(raw, stockMin * 1.15);

  const floor = stockMin > 0 ? stockMin * 0.95 : 0;
  const suggested = Math.max(raw * 1.10, floor);

  const premiumScore = (velocity * 0.6) + (scarcity * 0.4);
  let premium: number | null = null;
  if (premiumScore >= 0.20) {
    const mult = 1 + (premiumScore * 0.5);
    premium = Math.max(suggested * mult, floor);
  }

  return { suggested: Number(suggested.toFixed(2)), premium: premium != null ? Number(premium.toFixed(2)) : null, premiumScore: Number(premiumScore.toFixed(2)) };
}

function SuggestedPriceBar({ group }: { group: GroupedInsight }) {
  const nCalc = calcSuggested(group.newLot);
  const uCalc = calcSuggested(group.usedLot);

  if (!nCalc.suggested && !uCalc.suggested) return null;

  const priceDiff = (mine: string | undefined, suggested: number | null) => {
    if (!mine || !suggested) return null;
    const m = parseFloat(mine);
    if (m <= 0 || suggested <= 0) return null;
    const pct = ((m - suggested) / suggested) * 100;
    return pct;
  };

  const renderLotPrice = (lot: PricingInsight | null, calc: { suggested: number | null; premium: number | null; premiumScore: number | null }, label: string) => {
    if (!calc.suggested || !lot) return null;
    const sugDiff = priceDiff(lot.currentPrice, calc.suggested);
    const hasPremium = calc.premium != null && (calc.premiumScore ?? 0) >= 0.40;
    const premDiff = hasPremium ? priceDiff(lot.currentPrice, calc.premium!) : null;

    return (
      <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
        <span className="text-[8px] uppercase text-gray-500 w-5 flex-shrink-0">{label}</span>
        <span className="text-[11px] font-mono font-bold text-purple-300">${calc.suggested.toFixed(2)}</span>
        {sugDiff != null && (
          <span className={`text-[9px] font-mono ${sugDiff < -5 ? 'text-emerald-400' : sugDiff > 5 ? 'text-red-400' : 'text-gray-500'}`}>
            {sugDiff > 0 ? '+' : ''}{sugDiff.toFixed(0)}%
          </span>
        )}
        {hasPremium && (
          <>
            <span className="text-gray-600 text-[9px]">/</span>
            <span className="text-[7px] font-bold uppercase tracking-wide bg-amber-500/20 text-amber-300 rounded px-1 py-px flex-shrink-0">Prem</span>
            <span className="text-[11px] font-mono font-bold text-amber-300">${calc.premium!.toFixed(2)}</span>
            {premDiff != null && (
              <span className={`text-[9px] font-mono ${premDiff < -5 ? 'text-emerald-400' : premDiff > 5 ? 'text-red-400' : 'text-gray-500'}`}>
                {premDiff > 0 ? '+' : ''}{premDiff.toFixed(0)}%
              </span>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="mt-1 px-2 py-1 rounded-md bg-purple-500/[0.07] border border-purple-400/15">
      <div className="flex items-center gap-1 mb-0.5">
        <Sparkles className="w-2.5 h-2.5 text-purple-400" />
        <span className="text-[8px] uppercase tracking-widest font-bold text-purple-400">Suggested Price</span>
        <Popover>
          <PopoverTrigger asChild>
            <button onClick={(e) => e.stopPropagation()} className="text-gray-600 hover:text-purple-400 transition-colors ml-auto" data-testid="button-suggested-price-info">
              <Info className="w-2.5 h-2.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-56 text-[10px] leading-snug bg-slate-900 border-slate-700 text-gray-300 p-2.5 z-50" onClick={(e) => e.stopPropagation()}>
            <p className="font-bold text-purple-300 mb-1">Market Baseline</p>
            <p className="mb-1.5">Blends sold avg (50%), lowest listed (30%), and sold max (20%), adjusted for demand velocity, capped at 115% of market floor, with 10% store premium.</p>
            <p className="font-bold text-amber-300 mb-1">Premium Opportunity</p>
            <p>For high-velocity / scarce parts (score {'\u2265'} 0.40), applies an additional multiplier. These are parts buyers will pay above market for because they need them to complete sets.</p>
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex flex-col gap-0.5">
        {renderLotPrice(group.newLot, nCalc, 'New')}
        {renderLotPrice(group.usedLot, uCalc, 'Used')}
      </div>
    </div>
  );
}

const SORT_TO_SCORE_LABEL: Record<SortField, string> = {
  ceiling: 'Ceil', velocity: 'Vel', scarcity: 'Scarc', undercut: 'Undr', combined: 'Score',
};

function ScoresBar({ group, activeSort }: { group: GroupedInsight; activeSort: SortField }) {
  const items: Array<{ label: string; value: number | null; suffix?: string }> = [
    { label: 'Ceil', value: group.bestCeiling, suffix: '×' },
    { label: 'Vel', value: group.bestVelocity },
    { label: 'Scarc', value: group.bestScarcity },
    { label: 'Undr', value: group.bestUndercut, suffix: '×' },
    { label: 'Score', value: group.bestCombined },
  ];
  const activeLabel = SORT_TO_SCORE_LABEL[activeSort];

  return (
    <div className="flex items-center gap-0.5 mt-1.5">
      {items.map(({ label, value, suffix }) => {
        const isActive = label === activeLabel;
        return (
          <div key={label} className={`flex-1 text-center rounded-sm py-0.5 ${isActive ? 'bg-violet-500/[0.15] ring-1 ring-inset ring-violet-400/30' : ''}`}>
            <div className={`text-[7px] uppercase tracking-wider leading-none mb-0.5 ${isActive ? 'text-violet-300' : 'text-gray-600'}`}>{label}</div>
            <div className={`text-[10px] font-mono font-bold leading-none ${scoreColor(value)}`}>
              {value != null ? `${value.toFixed(2)}${suffix ?? ''}` : '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const SORT_LABELS: Record<SortField, string> = {
  combined: 'Score',
  ceiling: 'Ceiling',
  velocity: 'Velocity',
  scarcity: 'Scarcity',
  undercut: 'Undercut',
};

export default function PriceOMaticDashboard({ onItemClick }: PriceOMaticDashboardProps) {
  const { toast } = useToast();
  const [itemsToShow, setItemsToShow] = useState(25);
  const [refreshingItems, setRefreshingItems] = useState<Set<number>>(new Set());
  const [sortField, setSortField] = useState<SortField>('combined');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [pricingLoading, setPricingLoading] = useState<Set<string>>(new Set());

  const [deepSpaceKeys, setDeepSpaceKeys] = useState<Set<string>>(lsLoadDeepSpace);
  const [deepSpaceItems, setDeepSpaceItems] = useState<Map<string, StoredGroupInfo>>(lsLoadDeepSpaceItems);
  const [futureMissionsKeys, setFutureMissionsKeys] = useState<Set<string>>(lsLoadFutureMissions);
  const [futureMissionsItems, setFutureMissionsItems] = useState<Map<string, StoredGroupInfo>>(lsLoadFutureMissionsItems);

  const [orbitFilter, setOrbitFilter] = useState<ZoneFilter>('in_orbit');

  const { data: deepSpaceData } = useQuery<{ success: boolean; keys: string[]; items?: StoredGroupInfo[] }>({
    queryKey: ['/api/priceomatic/deep-space'],
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const saveDeepSpaceToServer = useCallback((items: StoredGroupInfo[]) => {
    apiRequest('PUT', '/api/priceomatic/deep-space', { items }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!deepSpaceData) return;
    const serverKeys = deepSpaceData.keys ?? [];
    const serverItems = deepSpaceData.items ?? [];
    const localKeys = Array.from(lsLoadDeepSpace());
    const localItems = lsLoadDeepSpaceItems();
    if (serverKeys.length > 0) {
      const serverSet = new Set(serverKeys);
      const serverItemsMap = new Map(serverItems.map(i => [i.key, i]));
      setDeepSpaceKeys(serverSet);
      setDeepSpaceItems(serverItemsMap);
      lsSaveDeepSpace(serverSet);
      lsSaveDeepSpaceItems(serverItemsMap);
    } else if (localKeys.length > 0) {
      const migratedItems = localKeys.map(k => localItems.get(k) ?? { key: k, itemNo: k.split('_')[0], itemName: null, colorId: null, colorName: null, colorRgb: null });
      apiRequest('PUT', '/api/priceomatic/deep-space', { items: migratedItems }).catch(() => {});
    }
  }, [deepSpaceData]);

  const { data: futureMissionsData } = useQuery<{ success: boolean; keys: string[]; items?: StoredGroupInfo[] }>({
    queryKey: ['/api/priceomatic/future-missions'],
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const saveFutureMissionsToServer = useCallback((items: StoredGroupInfo[]) => {
    apiRequest('PUT', '/api/priceomatic/future-missions', { items }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!futureMissionsData) return;
    const serverKeys = futureMissionsData.keys ?? [];
    const serverItems = futureMissionsData.items ?? [];
    if (serverKeys.length > 0) {
      const serverSet = new Set(serverKeys);
      const serverItemsMap = new Map(serverItems.map(i => [i.key, i]));
      setFutureMissionsKeys(serverSet);
      setFutureMissionsItems(serverItemsMap);
      lsSaveFutureMissions(serverSet);
      lsSaveFutureMissionsItems(serverItemsMap);
    }
  }, [futureMissionsData]);

  const onMoveToZone = useCallback((group: GroupedInsight, targetZone: ZoneFilter) => {
    const stored: StoredGroupInfo = { key: group.key, itemNo: group.itemNo, itemName: group.itemName, colorId: group.colorId, colorName: group.colorName, colorRgb: group.colorRgb };

    const newDeepKeys = new Set(lsLoadDeepSpace());
    const newDeepItems = lsLoadDeepSpaceItems();
    const newFutureKeys = new Set(lsLoadFutureMissions());
    const newFutureItems = lsLoadFutureMissionsItems();

    newDeepKeys.delete(group.key);
    newDeepItems.delete(group.key);
    newFutureKeys.delete(group.key);
    newFutureItems.delete(group.key);

    if (targetZone === 'deep_space') {
      newDeepKeys.add(group.key);
      newDeepItems.set(group.key, stored);
    } else if (targetZone === 'future_missions') {
      newFutureKeys.add(group.key);
      newFutureItems.set(group.key, stored);
    }

    setDeepSpaceKeys(new Set(newDeepKeys));
    setDeepSpaceItems(new Map(newDeepItems));
    setFutureMissionsKeys(new Set(newFutureKeys));
    setFutureMissionsItems(new Map(newFutureItems));

    lsSaveDeepSpace(newDeepKeys);
    lsSaveDeepSpaceItems(newDeepItems);
    lsSaveFutureMissions(newFutureKeys);
    lsSaveFutureMissionsItems(newFutureItems);

    saveDeepSpaceToServer(Array.from(newDeepItems.values()));
    saveFutureMissionsToServer(Array.from(newFutureItems.values()));
  }, [saveDeepSpaceToServer, saveFutureMissionsToServer]);

  const fetchPricingMutation = useMutation({
    mutationFn: async (group: GroupedInsight) => {
      const lots = [
        group.newLot ? { lot: group.newLot, condition: 'n' as const } : null,
        group.usedLot ? { lot: group.usedLot, condition: 'u' as const } : null,
      ].filter(Boolean) as { lot: PricingInsight; condition: 'n' | 'u' }[];

      await Promise.all(lots.map(async ({ lot }) => {
        await apiRequest("POST", "/api/priceomatic/fetch-pricing", {
          itemNo: lot.itemNo,
          itemType: lot.itemType,
          colorId: lot.colorId,
          newOrUsed: lot.newOrUsed,
        });
      }));
      return { key: group.key };
    },
    onMutate: (group) => {
      setPricingLoading(prev => new Set([...prev, group.key]));
    },
    onSettled: (_data, _err, group) => {
      setPricingLoading(prev => { const next = new Set(prev); next.delete(group.key); return next; });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/priceomatic/insights'] });
    },
    onError: () => {
      toast({ title: "Refresh failed", description: "Could not fetch market data from BrickLink", variant: "destructive" });
    },
  });

  const refreshItemMutation = useMutation({
    mutationFn: async (item: { itemNo: string; itemType: string; colorId: number | null; newOrUsed: string; inventoryId: number }) => {
      const params = new URLSearchParams({
        partNo: item.itemNo,
        itemType: item.itemType,
        newOrUsed: item.newOrUsed,
        forceRefresh: 'true',
      });
      if (item.colorId != null) params.set('colorId', item.colorId.toString());
      return await apiRequest("GET", `/api/pom/spot-lookup?${params}`);
    },
    onMutate: (item) => {
      setRefreshingItems(prev => new Set([...prev, item.inventoryId]));
    },
    onSettled: (_data, _err, item) => {
      setRefreshingItems(prev => { const next = new Set(prev); next.delete(item.inventoryId); return next; });
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ['/api/priceomatic/insights'] });
      toast({ title: "Refreshed", description: "Price data updated from BrickLink" });
    },
    onError: () => {
      toast({ title: "Refresh failed", description: "Could not reach BrickLink", variant: "destructive" });
    },
  });

  const { data: insights, isLoading: insightsLoading } = useQuery<{ success: boolean; data: InsightsData }>({
    queryKey: ['/api/priceomatic/insights'],
    refetchOnMount: 'always',
    staleTime: 0,
    refetchInterval: false,
  });

  const insightsData = insights?.data;

  const getGroupScoreValue = (g: GroupedInsight, field: SortField): number => {
    switch (field) {
      case 'combined': return g.bestCombined ?? -1;
      case 'ceiling': return g.bestCeiling ?? -1;
      case 'velocity': return g.bestVelocity ?? -1;
      case 'scarcity': return g.bestScarcity ?? -1;
      case 'undercut': return g.bestUndercut ?? -1;
    }
  };

  const getAllGroups = (): GroupedInsight[] => {
    if (!insightsData) return [];
    const allItems = insightsData.items;
    const map = new Map<string, GroupedInsight>();
    for (const item of allItems) {
      const key = `${item.itemNo}_${item.colorId ?? 'null'}`;
      if (!map.has(key)) {
        map.set(key, {
          key, itemNo: item.itemNo, itemName: item.itemName, colorId: item.colorId, colorName: item.colorName, colorRgb: item.colorRgb,
          newLot: null, usedLot: null,
          bestCeiling: null, bestVelocity: null, bestScarcity: null, bestUndercut: null, bestCombined: null,
        });
      }
      const g = map.get(key)!;
      if (item.newOrUsed === 'N') { g.newLot = item; }
      else { g.usedLot = item; }
    }
    for (const g of map.values()) {
      const pick = (fn: (lot: PricingInsight) => number | null | undefined) => {
        const nv = g.newLot ? fn(g.newLot) : null;
        const uv = g.usedLot ? fn(g.usedLot) : null;
        if (nv != null && uv != null) return Math.max(nv, uv);
        return nv ?? uv ?? null;
      };
      g.bestCeiling = pick(l => l.priceCeilingRatio);
      g.bestVelocity = pick(l => l.demandVelocity);
      g.bestScarcity = pick(l => l.marketScarcity);
      g.bestUndercut = pick(l => l.undercutRatio);
      g.bestCombined = pick(l => l.repricingScore);
    }
    return Array.from(map.values()).sort((a, b) => {
      const aScore = getGroupScoreValue(a, sortField);
      const bScore = getGroupScoreValue(b, sortField);
      return sortDir === 'desc' ? bScore - aScore : aScore - bScore;
    });
  };

  const makeFallbackGroup = (item: StoredGroupInfo): GroupedInsight => ({
    key: item.key, itemNo: item.itemNo, itemName: item.itemName, colorId: item.colorId, colorName: item.colorName, colorRgb: item.colorRgb,
    newLot: null, usedLot: null,
    bestCeiling: null, bestVelocity: null, bestScarcity: null, bestUndercut: null, bestCombined: null,
  });

  const allGroups = getAllGroups().filter(g => (g.newLot?.quantity ?? 0) + (g.usedLot?.quantity ?? 0) > 0);
  const allGroupKeySet = new Set(allGroups.map(g => g.key));

  const inOrbitGroups = allGroups.filter(g => !deepSpaceKeys.has(g.key) && !futureMissionsKeys.has(g.key));

  const futureMissionsFromAnalysis = allGroups.filter(g => futureMissionsKeys.has(g.key));
  const futureMissionsFallbacks: GroupedInsight[] = Array.from(futureMissionsItems.values())
    .filter(item => futureMissionsKeys.has(item.key) && !allGroupKeySet.has(item.key))
    .map(makeFallbackGroup);
  const futureMissionsGroups = [...futureMissionsFromAnalysis, ...futureMissionsFallbacks];

  const deepSpaceFromAnalysis = allGroups.filter(g => deepSpaceKeys.has(g.key));
  const deepSpaceFallbacks: GroupedInsight[] = Array.from(deepSpaceItems.values())
    .filter(item => deepSpaceKeys.has(item.key) && !allGroupKeySet.has(item.key))
    .map(makeFallbackGroup);
  const deepSpaceGroups = [...deepSpaceFromAnalysis, ...deepSpaceFallbacks];

  const selectedGroups = orbitFilter === 'in_orbit'
    ? inOrbitGroups
    : orbitFilter === 'future_missions'
    ? futureMissionsGroups
    : deepSpaceGroups;

  useEffect(() => { setItemsToShow(25); }, [sortDir, sortField, orbitFilter]);

  const handleSortTap = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 px-1 pb-1">
          <div className="flex items-stretch rounded-md border border-gray-700/60 bg-gray-900/50 overflow-hidden flex-1 text-[9px] font-semibold uppercase tracking-wider">
            <button
              onClick={() => setOrbitFilter('in_orbit')}
              className={`flex items-center justify-center gap-1 flex-1 px-2 py-1.5 transition-colors ${
                orbitFilter === 'in_orbit'
                  ? 'bg-blue-500/20 text-blue-300'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
              data-testid="filter-in-orbit"
            >
              <Orbit className="w-2.5 h-2.5 flex-shrink-0" />
              <span>Orbit</span>
              <span className="opacity-50 font-normal">({inOrbitGroups.length})</span>
            </button>
            <div className="w-px self-stretch bg-gray-700/60" />
            <button
              onClick={() => setOrbitFilter('future_missions')}
              className={`flex items-center justify-center gap-1 flex-1 px-2 py-1.5 transition-colors ${
                orbitFilter === 'future_missions'
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
              data-testid="filter-future-missions"
            >
              <Satellite className="w-2.5 h-2.5 flex-shrink-0" />
              <span>Missions</span>
              <span className="opacity-50 font-normal">({futureMissionsGroups.length})</span>
            </button>
            <div className="w-px self-stretch bg-gray-700/60" />
            <button
              onClick={() => setOrbitFilter('deep_space')}
              className={`flex items-center justify-center gap-1 flex-1 px-2 py-1.5 transition-colors ${
                orbitFilter === 'deep_space'
                  ? 'bg-indigo-500/20 text-indigo-300'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
              data-testid="filter-deep-space"
            >
              <Rocket className="w-2.5 h-2.5 flex-shrink-0" />
              <span>Deep Space</span>
              <span className="opacity-50 font-normal">({deepSpaceGroups.length})</span>
            </button>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-gray-600 hover:text-gray-400 transition-colors flex-shrink-0" data-testid="button-swipe-info">
                <Info className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[10px] space-y-0.5 max-w-[180px]">
              {orbitFilter === 'in_orbit' && <>
                <p><span className="text-amber-300">Short swipe right</span> → Missions</p>
                <p><span className="text-indigo-300">Long swipe right</span> → Deep Space</p>
              </>}
              {orbitFilter === 'future_missions' && <>
                <p><span className="text-emerald-300">Swipe left</span> → In Orbit</p>
                <p><span className="text-indigo-300">Swipe right</span> → Deep Space</p>
              </>}
              {orbitFilter === 'deep_space' && <>
                <p><span className="text-amber-300">Short swipe left</span> → Missions</p>
                <p><span className="text-emerald-300">Long swipe left</span> → In Orbit</p>
              </>}
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-0.5 px-1 pb-1">
          <Popover>
            <PopoverTrigger asChild>
              <button className="text-gray-600 hover:text-gray-400 transition-colors flex-shrink-0 mr-0.5" data-testid="button-scores-info">
                <Info className="w-3 h-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="start" className="w-72 text-[11px] bg-gray-900 border-gray-700 p-3 space-y-2">
              <p className="font-semibold text-gray-200 text-xs">Repricing Scores</p>
              <div className="space-y-1.5 text-gray-400">
                <p><span className="text-blue-300 font-medium">Ceiling</span> — ratio of peak sold price to your current price. Higher means more room to raise prices.</p>
                <p><span className="text-purple-300 font-medium">Velocity</span> — sold lots vs listed lots (6mo). Higher means items are selling fast relative to supply.</p>
                <p><span className="text-amber-300 font-medium">Scarcity</span> — inverse of total listed lots. Higher means fewer sellers competing.</p>
                <p><span className="text-rose-300 font-medium">Undercut</span> — your price vs the lowest listed price. Lower means you're closer to the floor.</p>
                <p><span className="text-emerald-300 font-medium">Score</span> — weighted combination of all four metrics using your configured weights.</p>
              </div>
            </PopoverContent>
          </Popover>
          {(Object.entries(SORT_LABELS) as [SortField, string][]).map(([field, label]) => (
            <button
              key={field}
              onClick={() => handleSortTap(field)}
              className={`flex items-center gap-0.5 text-[8px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded transition-colors ${
                sortField === field
                  ? 'bg-purple-500/20 text-purple-300'
                  : 'text-gray-600 hover:text-gray-400'
              }`}
              data-testid={`sort-${field}`}
            >
              {label}
              {sortField === field && (
                sortDir === 'desc' ? <ArrowDown className="w-2.5 h-2.5" /> : <ArrowUp className="w-2.5 h-2.5" />
              )}
            </button>
          ))}
        </div>

        {(orbitFilter === 'deep_space' || orbitFilter === 'future_missions' || insightsData) ? (
          selectedGroups.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {orbitFilter === 'deep_space' ? (
                <div className="space-y-1">
                  <Rocket className="w-8 h-8 text-indigo-700 mx-auto" />
                  <p className="text-xs text-gray-600">Nothing in deep space yet</p>
                  <p className="text-[10px] text-gray-700">Long swipe right on a tile to archive it here</p>
                </div>
              ) : orbitFilter === 'future_missions' ? (
                <div className="space-y-1">
                  <Satellite className="w-8 h-8 text-amber-700 mx-auto" />
                  <p className="text-xs text-gray-600">No items queued for future review</p>
                  <p className="text-[10px] text-gray-700">Short swipe right on an In Orbit tile to queue it here</p>
                </div>
              ) : (
                <p className="text-xs">No items found</p>
              )}
            </div>
          ) : (
            <>
              {selectedGroups.slice(0, itemsToShow).map((group) => {
                const primaryLot = group.newLot ?? group.usedLot;
                const totalQty = (group.newLot?.quantity ?? 0) + (group.usedLot?.quantity ?? 0);
                return (
                  <SwipeableTile
                    key={group.key}
                    group={group}
                    orbitFilter={orbitFilter}
                    onMoveToZone={onMoveToZone}
                  >
                    <div
                      className="group relative bg-gradient-to-br from-blue-950/50 via-slate-800/70 to-blue-900/30 border border-blue-700/25 rounded-lg px-2.5 py-2 cursor-pointer shadow-[0_2px_8px_rgba(15,40,100,0.35),inset_0_1px_0_rgba(147,197,253,0.07)] hover:shadow-[0_4px_14px_rgba(15,40,100,0.5),inset_0_1px_0_rgba(147,197,253,0.12)] hover:border-blue-600/40 transition-shadow duration-150"
                      data-testid={`item-group-${group.key}`}
                      onClick={() => {
                        if (primaryLot) onItemClick?.('inventory', primaryLot.inventoryId);
                      }}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-[11px] text-blue-200/90 font-semibold flex-shrink-0">{group.itemNo}</span>
                        <p className="text-[11px] text-slate-300 truncate flex-1 min-w-0">{group.itemName && group.itemName !== 'undefined' ? group.itemName : 'Unknown Item'}</p>
                        {primaryLot && (
                          <div className="invisible group-hover:visible flex items-center gap-0.5 flex-shrink-0">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    fetchPricingMutation.mutate(group);
                                  }}
                                  disabled={pricingLoading.has(group.key)}
                                  className="text-gray-600 hover:text-purple-400 disabled:text-gray-700 transition-colors"
                                  data-testid={`button-price-group-${group.key}`}
                                >
                                  <DollarSign className={`w-3 h-3 ${pricingLoading.has(group.key) ? 'animate-pulse text-purple-400' : ''}`} />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="text-xs">
                                Refresh market data (2 API calls)
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const lots = [group.newLot, group.usedLot].filter(Boolean) as PricingInsight[];
                                    lots.forEach(lot => refreshItemMutation.mutate({
                                      inventoryId: lot.inventoryId,
                                      itemNo: lot.itemNo,
                                      itemType: lot.itemType,
                                      colorId: lot.colorId,
                                      newOrUsed: lot.newOrUsed,
                                    }));
                                  }}
                                  disabled={[group.newLot, group.usedLot].some(l => l && refreshingItems.has(l.inventoryId))}
                                  className="text-gray-600 hover:text-gray-400 disabled:text-gray-700 transition-colors"
                                  data-testid={`button-refresh-group-${group.key}`}
                                >
                                  <RefreshCw className={`w-3 h-3 ${[group.newLot, group.usedLot].some(l => l && refreshingItems.has(l.inventoryId)) ? 'animate-spin text-purple-400' : ''}`} />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="text-xs">
                                Refresh score data
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400/80 bg-emerald-500/10 rounded px-1 py-0.5 flex-shrink-0">
                          ×{totalQty}
                        </span>
                        {group.colorRgb && (
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-white/20"
                            style={{ backgroundColor: `#${group.colorRgb}` }}
                          />
                        )}
                        <span className="text-[10px] text-slate-400 truncate min-w-0">{group.colorName || '—'}</span>
                      </div>

                      <PricingGrid group={group} activeSort={sortField} />
                      <SuggestedPriceBar group={group} />
                      <ScoresBar group={group} activeSort={sortField} />
                    </div>
                  </SwipeableTile>
                );
              })}

              {selectedGroups.length > itemsToShow && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setItemsToShow(prev => prev + 25)}
                  className="w-full gap-2"
                  data-testid="button-show-more"
                >
                  <ChevronDown className="w-4 h-4" />
                  Show 25 more ({selectedGroups.length - itemsToShow} remaining)
                </Button>
              )}
            </>
          )
        ) : !insightsLoading ? (
          <div className="text-center py-12">
            <Sparkles className="w-10 h-10 text-purple-400 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-white mb-1">No Data Yet</h3>
            <p className="text-xs text-gray-400 mb-3">Run your first sync to analyze pricing</p>
            <p className="text-xs text-gray-500">Use the refresh button in the header to run your first sync.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

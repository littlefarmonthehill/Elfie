import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {  
  Sparkles,
  RefreshCw,
  RotateCcw,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  DollarSign,
  Orbit,
  Rocket,
  Satellite,
  Info,
  X,
  Settings2,
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

export interface PricingInsight {
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

export interface SugConfig {
  soldAvgW: number;
  stockMinW: number;
  soldMaxW: number;
  demandMult: number;
  compCap: number;
  floor: number;
  storePremium: number;
}

export const DEFAULT_SUG_CONFIG: SugConfig = {
  soldAvgW: 0.5, stockMinW: 0.3, soldMaxW: 0.2,
  demandMult: 0.25, compCap: 1.15, floor: 0.95, storePremium: 1.10,
};

export interface ScoreConfig {
  wCeiling: number;
  wVelocity: number;
  wScarcity: number;
  wUndercut: number;
}

export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  wCeiling: 0.4, wVelocity: 0.3, wScarcity: 0.2, wUndercut: 0.1,
};

export function calcScore(lot: PricingInsight, cfg: ScoreConfig): number {
  const c = (lot.priceCeilingRatio ?? 0) * cfg.wCeiling;
  // STR clamped to [0,1] so 200%+ STR doesn't dominate over other signals
  const v = Math.min(1, lot.demandVelocity ?? 0) * cfg.wVelocity;
  const s = (lot.marketScarcity ?? 0) * cfg.wScarcity;
  // Undercut: (1 − ratio) is positive when you undercut market, negative when being undercut.
  // undercutRatio = yourPrice / marketMin → ratio < 1 = you're cheapest → score boost.
  const u = (lot.undercutRatio && lot.undercutRatio > 0) ? (1 - lot.undercutRatio) * cfg.wUndercut : 0;
  return c + v + s + u;
}

// Weight applied to the suggestion-alignment signal when blending into the combined score.
// Keeps the familiar score dominant while letting the strategy-based suggestion quietly
// nudge items up (underpriced) or down (overpriced) as the model earns trust.
const SUG_INFLUENCE_WEIGHT = 0.25;

export function calcHybridScore(lot: PricingInsight, scoreCfg: ScoreConfig, sugCfg: SugConfig): number {
  const base = calcScore(lot, scoreCfg);
  const current = parseFloat(lot.unitPrice || '0');
  if (current <= 0) return base;
  const { suggested } = calcSuggested(lot, sugCfg);
  if (suggested == null) return base;
  const divergence = Math.max(-1, Math.min(1, (suggested - current) / current));
  return base + divergence * SUG_INFLUENCE_WEIGHT;
}

export function calcScoreBreakdown(lot: PricingInsight, cfg: ScoreConfig, sugCfg?: SugConfig) {
  const cRaw = lot.priceCeilingRatio ?? 0;
  const vRaw = lot.demandVelocity ?? 0;         // raw STR (can exceed 1.0)
  const vClamped = Math.min(1, vRaw);           // clamped to [0,1] for scoring
  const sRaw = lot.marketScarcity ?? 0;
  // uRaw = 1 − undercutRatio: positive = you're cheapest, negative = being undercut
  const uRaw = (lot.undercutRatio && lot.undercutRatio > 0) ? 1 - lot.undercutRatio : 0;
  const baseTotal = cRaw * cfg.wCeiling + vClamped * cfg.wVelocity + sRaw * cfg.wScarcity + uRaw * cfg.wUndercut;

  let sugRaw: number | null = null;
  let sugWeighted: number | null = null;
  if (sugCfg) {
    const current = parseFloat(lot.unitPrice || '0');
    const { suggested } = calcSuggested(lot, sugCfg);
    if (suggested != null && current > 0) {
      sugRaw = Math.max(-1, Math.min(1, (suggested - current) / current));
      sugWeighted = sugRaw * SUG_INFLUENCE_WEIGHT;
    }
  }

  return {
    ceiling: { raw: cRaw, weight: cfg.wCeiling, weighted: cRaw * cfg.wCeiling },
    // vRaw is the display STR %, vClamped is what enters the score
    velocity: { raw: vRaw, weight: cfg.wVelocity, weighted: vClamped * cfg.wVelocity },
    scarcity: { raw: sRaw, weight: cfg.wScarcity, weighted: sRaw * cfg.wScarcity },
    undercut: { raw: uRaw, weight: cfg.wUndercut, weighted: uRaw * cfg.wUndercut },
    suggestion: sugRaw != null ? { raw: sugRaw, weight: SUG_INFLUENCE_WEIGHT, weighted: sugWeighted! } : null,
    total: baseTotal + (sugWeighted ?? 0),
  };
}

interface InsightsData {
  items: PricingInsight[];
  summary: {
    total: number;
  };
  sugConfig?: SugConfig;
  scoreConfig?: ScoreConfig;
  sortMode?: 'scoring' | 'suggested';
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
  onOpenSettings?: (section?: string, pricingExample?: PricingInsight, scoringExample?: PricingInsight) => void;
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

const GR = 'grid grid-cols-[1fr_52px_52px_52px_52px] lg:grid-cols-[1fr_72px_72px_72px_72px]';
const cell = (extra = '') => `px-1 py-1 lg:px-2 lg:py-1.5 text-center text-[10px] lg:text-xs font-mono tabular-nums border-l border-white/[0.06] ${extra}`;

type CellHL = { sN?: boolean; sU?: boolean; lN?: boolean; lU?: boolean };

const HL_CELL = 'bg-violet-500/[0.18] ring-1 ring-inset ring-violet-400/40';

function PricingGrid({ group, activeSort, cfg, onOpenSettings }: { group: GroupedInsight; activeSort: SortField; cfg: SugConfig; onOpenSettings?: (lot: PricingInsight) => void }) {
  const nLot = group.newLot;
  const uLot = group.usedLot;

  const hlMap: Record<string, CellHL> = {};
  if (activeSort === 'ceiling')  { hlMap['Max'] = { sN: true, sU: true }; hlMap['My Price'] = { lN: true, lU: true }; }
  if (activeSort === 'velocity') { hlMap['Qty'] = { sN: true, sU: true, lN: true, lU: true }; }
  if (activeSort === 'scarcity') { hlMap['Qty'] = { lN: true, lU: true }; }
  if (activeSort === 'undercut') { hlMap['Min'] = { lN: true, lU: true }; hlMap['My Price'] = { lN: true, lU: true }; }

  const DataRow = ({ label, sN, sU, lN, lU, isMoney, bold, mine, suggested }: {
    label: string; sN: any; sU: any; lN: any; lU: any; isMoney?: boolean; bold?: boolean; mine?: boolean; suggested?: boolean;
  }) => {
    const hl = hlMap[label];
    const labelColor = suggested ? 'text-purple-400 font-semibold' : mine ? 'text-emerald-400 font-semibold' : bold ? 'text-gray-200 font-semibold' : 'text-gray-500';
    const valColor = suggested ? 'text-purple-300 font-semibold' : mine ? 'text-emerald-300 font-semibold' : bold ? 'text-amber-300 font-semibold' : 'text-gray-200';
    const blankSold = mine || suggested;
    const blankListed = false;
    return (
      <div className={`${GR} border-b border-white/[0.04] ${bold ? 'bg-white/[0.03]' : ''} ${suggested ? 'bg-purple-500/[0.05]' : ''}`}>
        <div className={`px-2 py-1 text-[10px] lg:text-xs ${labelColor}`}>{label}</div>
        <div className={cell(`${blankSold ? 'text-gray-700' : valColor} ${hl?.sN && !blankSold ? HL_CELL : ''}`)}>{blankSold ? '' : isMoney ? fmt(sN) : fmtInt(sN)}</div>
        <div className={cell(`${blankSold ? 'text-gray-700' : valColor} ${hl?.sU && !blankSold ? HL_CELL : ''}`)}>{blankSold ? '' : isMoney ? fmt(sU) : fmtInt(sU)}</div>
        <div className={cell(`${blankListed ? 'text-gray-700' : mine ? valColor : suggested ? valColor : bold ? 'text-sky-300 font-semibold' : 'text-gray-400'} ${hl?.lN && !blankListed ? HL_CELL : ''}`)}>{blankListed ? '' : isMoney ? fmt(lN) : fmtInt(lN)}</div>
        <div className={cell(`${blankListed ? 'text-gray-700' : mine ? valColor : suggested ? valColor : bold ? 'text-sky-300 font-semibold' : 'text-gray-400'} ${hl?.lU && !blankListed ? HL_CELL : ''}`)}>{blankListed ? '' : isMoney ? fmt(lU) : fmtInt(lU)}</div>
      </div>
    );
  };

  const nCalc = calcSuggested(nLot, cfg);
  const uCalc = calcSuggested(uLot, cfg);
  const hasSuggested = nCalc.suggested != null || uCalc.suggested != null;

  return (
    <div className="rounded-md overflow-hidden border border-white/[0.08] mt-1">
      <div className={`${GR} bg-white/[0.06]`}>
        <div className="px-2 py-1" />
        <div className="col-span-2 py-1 text-center text-[8px] lg:text-[10px] uppercase tracking-widest font-bold text-amber-400 border-l border-white/[0.08]">
          Sold 6mo
        </div>
        <div className="col-span-2 py-1 text-center text-[8px] lg:text-[10px] uppercase tracking-widest font-bold text-sky-400 border-l border-white/[0.10]">
          Listed
        </div>
      </div>
      <div className={`${GR} border-b border-white/[0.10] bg-white/[0.03]`}>
        <div className="px-2 py-0.5" />
        <div className={cell('text-[8px] lg:text-[10px] uppercase font-bold text-blue-300 py-0.5')}>New</div>
        <div className={cell('text-[8px] lg:text-[10px] uppercase font-bold text-orange-300 py-0.5')}>Used</div>
        <div className={cell('text-[8px] lg:text-[10px] uppercase font-bold text-blue-300 py-0.5')}>New</div>
        <div className={cell('text-[8px] lg:text-[10px] uppercase font-bold text-orange-300 py-0.5')}>Used</div>
      </div>
      <DataRow label="Qty" sN={nLot?.soldTotalLots} sU={uLot?.soldTotalLots} lN={nLot?.stockTotalLots} lU={uLot?.stockTotalLots} />
      <DataRow label="Min" sN={nLot?.soldMinPrice} sU={uLot?.soldMinPrice} lN={nLot?.stockMinPrice} lU={uLot?.stockMinPrice} isMoney />
      <DataRow bold label="Avg" sN={nLot?.soldAvgPrice} sU={uLot?.soldAvgPrice} lN={nLot?.stockAvgPrice} lU={uLot?.stockAvgPrice} isMoney />
      <DataRow label="Max" sN={nLot?.soldMaxPrice} sU={uLot?.soldMaxPrice} lN={nLot?.stockMaxPrice} lU={uLot?.stockMaxPrice} isMoney />
      <DataRow mine bold label="My Price" sN={null} sU={null} lN={nLot?.currentPrice} lU={uLot?.currentPrice} isMoney />
      {hasSuggested && (
        <div className={`${GR} border-b border-white/[0.04] bg-purple-500/[0.05]`}>
          <div className="px-2 py-1 text-[10px] lg:text-xs text-purple-400 font-semibold">Suggested</div>
          <div className={cell('text-gray-700')} />
          <div className={cell('text-gray-700')} />
          <div className={cell('text-purple-300 font-semibold')}>
            {nCalc.suggested != null && nCalc.breakdown ? (
              <BreakdownPopover bd={nCalc.breakdown} label="New Suggested" onOpenSettings={onOpenSettings} lot={nLot}>
                <button onClick={(e) => e.stopPropagation()} className="underline decoration-dotted underline-offset-2 decoration-purple-500/40 hover:text-purple-200 transition-colors" data-testid="button-sug-new">
                  {fmt(nCalc.suggested)}
                </button>
              </BreakdownPopover>
            ) : '\u2014'}
          </div>
          <div className={cell('text-purple-300 font-semibold')}>
            {uCalc.suggested != null && uCalc.breakdown ? (
              <BreakdownPopover bd={uCalc.breakdown} label="Used Suggested" onOpenSettings={onOpenSettings} lot={uLot}>
                <button onClick={(e) => e.stopPropagation()} className="underline decoration-dotted underline-offset-2 decoration-purple-500/40 hover:text-purple-200 transition-colors" data-testid="button-sug-used">
                  {fmt(uCalc.suggested)}
                </button>
              </BreakdownPopover>
            ) : '\u2014'}
          </div>
        </div>
      )}
    </div>
  );
}

interface SugBreakdown {
  soldAvg: number; soldMax: number; stockMin: number;
  soldQty: number; stockQty: number;
  velocity: number; scarcity: number;
  base: number; demandAdj: number; raw: number;
  cappedRaw: number; floor: number;
  suggested: number;
  storePremiumPct: number;
  cfg: SugConfig;
}

function calcSuggested(lot: PricingInsight | null, cfg: SugConfig = DEFAULT_SUG_CONFIG): { suggested: number | null; breakdown: SugBreakdown | null } {
  if (!lot) return { suggested: null, breakdown: null };
  const soldAvg = parseFloat(lot.soldAvgPrice || '0');
  const soldMax = parseFloat(lot.soldMaxPrice || '0');
  const stockMin = parseFloat(lot.stockMinPrice || '0');
  // Only use piece-counts for velocity — lot counts (soldTotalLots/stockTotalLots) are not
  // interchangeable with piece counts and produce nonsense ratios. If piece counts are
  // unavailable, don't apply a demand adjustment (vel = 0).
  const soldQty = lot.soldQuantity ?? null;
  const stockQty = lot.stockQuantity ?? null;
  const velocity = (soldQty != null && stockQty != null && stockQty > 0) ? soldQty / stockQty : 0;
  const scarcity = (stockQty != null && stockQty > 0) ? 1 / stockQty : 0;

  if (soldAvg <= 0 && stockMin <= 0) return { suggested: null, breakdown: null };

  const base = (soldAvg > 0 ? soldAvg * cfg.soldAvgW : 0)
    + (stockMin > 0 ? stockMin * cfg.stockMinW : 0)
    + (soldMax > 0 ? soldMax * cfg.soldMaxW : 0);
  if (base <= 0) return { suggested: null, breakdown: null };

  const demandAdj = 1 + (velocity * cfg.demandMult);
  let raw = base * demandAdj;
  const capLimit = stockMin > 0 ? stockMin * cfg.compCap : raw;
  const cappedRaw = raw <= capLimit ? raw : capLimit + (raw - capLimit) * 0.3;

  const floor = stockMin > 0 ? stockMin * cfg.floor : 0;
  const storePremiumPct = (cfg.storePremium - 1) * 100;
  const suggested = Math.max(cappedRaw * cfg.storePremium, floor);

  const breakdown: SugBreakdown = { soldAvg, soldMax, stockMin, soldQty, stockQty, velocity, scarcity, base, demandAdj, raw: base * demandAdj, cappedRaw, floor, suggested, storePremiumPct, cfg };

  return {
    suggested: Number(suggested.toFixed(2)),
    breakdown,
  };
}

interface DimensionWeights {
  demand: number;
  rarity: number;
  headroom: number;
  competition: number;
}

const DIMENSIONS = [
  { key: 'demand' as const, label: 'Demand', color: '#60a5fa', angle: -Math.PI / 2, desc: 'How fast it sells' },
  { key: 'rarity' as const, label: 'Rarity', color: '#a78bfa', angle: 0, desc: 'How few available' },
  { key: 'competition' as const, label: 'Competition', color: '#34d399', angle: Math.PI / 2, desc: 'Your price vs market' },
  { key: 'headroom' as const, label: 'Store Prem', color: '#fbbf24', angle: Math.PI, desc: 'Deep stock & fast service' },
];

function weightsToSugConfig(w: DimensionWeights, baseCfg: SugConfig): SugConfig {
  const nd = (w.demand - 0.25) * 4;
  const nr = (w.rarity - 0.25) * 4;
  const nh = (w.headroom - 0.25) * 4;
  const nc = (w.competition - 0.25) * 4;

  if (Math.abs(nd) < 0.01 && Math.abs(nr) < 0.01 && Math.abs(nh) < 0.01 && Math.abs(nc) < 0.01) {
    return baseCfg;
  }

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const soldAvgW = clamp(baseCfg.soldAvgW + nd * 0.15 - nc * 0.1, 0.05, 0.9);
  const stockMinW = clamp(baseCfg.stockMinW + nc * 0.2 - nr * 0.05, 0.05, 0.9);
  const soldMaxW = clamp(baseCfg.soldMaxW + nr * 0.15 + nh * 0.1, 0.05, 0.9);
  const blendSum = soldAvgW + stockMinW + soldMaxW;

  return {
    ...baseCfg,
    soldAvgW: soldAvgW / blendSum,
    stockMinW: stockMinW / blendSum,
    soldMaxW: soldMaxW / blendSum,
    demandMult: clamp(baseCfg.demandMult + nd * 0.4, 0.01, 0.8),
    compCap: clamp(baseCfg.compCap + nh * 0.3 + nd * 0.1, 1.0, 2.0),
    floor: clamp(baseCfg.floor + nc * 0.1 - nd * 0.05, 0.5, 1.0),
    storePremium: clamp(baseCfg.storePremium + nh * 0.15 + nr * 0.05, 1.0, 2.0),
  };
}

export function DimensionWheel({ lot, baseCfg, onSave }: { lot?: PricingInsight | null; baseCfg: SugConfig; onSave: (cfg: SugConfig) => void }) {
  const SIZE = 200;
  const R = SIZE / 2;
  const HANDLE_R = 14;
  const RING_R = R - 28;
  const CENTER = R;
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [weights, setWeights] = useState<DimensionWeights>({ demand: 0.25, rarity: 0.25, headroom: 0.25, competition: 0.25 });
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [handlePos, setHandlePos] = useState<{ x: number; y: number }>({ x: CENTER, y: CENTER });
  const [showDetail, setShowDetail] = useState(false);

  const updateFromPos = useCallback((x: number, y: number) => {
    const dx = x - CENTER;
    const dy = y - CENTER;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = RING_R;
    const clampedDist = Math.min(dist, maxDist);
    const angle = Math.atan2(dy, dx);
    const cx = CENTER + Math.cos(angle) * clampedDist;
    const cy = CENTER + Math.sin(angle) * clampedDist;
    setHandlePos({ x: cx, y: cy });

    const strength = clampedDist / maxDist;
    const newW: DimensionWeights = { demand: 0.25, rarity: 0.25, headroom: 0.25, competition: 0.25 };
    if (strength > 0.05) {
      for (const dim of DIMENSIONS) {
        const angleDiff = Math.abs(Math.atan2(Math.sin(angle - dim.angle), Math.cos(angle - dim.angle)));
        const influence = Math.max(0, 1 - angleDiff / (Math.PI * 0.75));
        newW[dim.key] = 0.05 + influence * strength;
      }
      const total = newW.demand + newW.rarity + newW.headroom + newW.competition;
      newW.demand /= total;
      newW.rarity /= total;
      newW.headroom /= total;
      newW.competition /= total;
    }
    setWeights(newW);
  }, [CENTER, RING_R]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const preventScroll = (e: TouchEvent) => {
      if (draggingRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    el.addEventListener('touchmove', preventScroll, { passive: false });
    el.addEventListener('touchstart', (e: TouchEvent) => {
      if (draggingRef.current) { e.preventDefault(); }
    }, { passive: false });
    return () => {
      el.removeEventListener('touchmove', preventScroll);
    };
  }, []);

  const getSvgCoords = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    setDragging(true);
    (e.target as Element).setPointerCapture(e.pointerId);
    const coords = getSvgCoords(e);
    if (coords) updateFromPos(coords.x, coords.y);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const coords = getSvgCoords(e);
    if (coords) updateFromPos(coords.x, coords.y);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = false;
    setDragging(false);
  };

  const isAtCenter = Math.abs(handlePos.x - CENTER) < 2 && Math.abs(handlePos.y - CENTER) < 2;
  const isDefaults = Math.abs(baseCfg.soldAvgW - DEFAULT_SUG_CONFIG.soldAvgW) < 0.001
    && Math.abs(baseCfg.stockMinW - DEFAULT_SUG_CONFIG.stockMinW) < 0.001
    && Math.abs(baseCfg.soldMaxW - DEFAULT_SUG_CONFIG.soldMaxW) < 0.001
    && Math.abs(baseCfg.demandMult - DEFAULT_SUG_CONFIG.demandMult) < 0.001
    && Math.abs(baseCfg.compCap - DEFAULT_SUG_CONFIG.compCap) < 0.001
    && Math.abs(baseCfg.floor - DEFAULT_SUG_CONFIG.floor) < 0.001
    && Math.abs(baseCfg.storePremium - DEFAULT_SUG_CONFIG.storePremium) < 0.001;
  const liveCfg = weightsToSugConfig(weights, baseCfg);
  const liveCalc = lot ? calcSuggested(lot, liveCfg) : { suggested: null, breakdown: null };
  const bd = liveCalc.breakdown;
  const f = (v: number) => `$${v.toFixed(2)}`;
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const row = (lbl: string, val: string, highlight?: boolean) => (
    <div className={`flex justify-between gap-2 ${highlight ? 'text-purple-300 font-semibold' : 'text-gray-400'}`}>
      <span>{lbl}</span>
      <span className="font-mono">{val}</span>
    </div>
  );

  const calloutOffsetY = -(HANDLE_R + 22);

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-2" style={{ touchAction: 'none' }} data-testid="dimension-wheel">
      <div className="relative overflow-visible" style={{ width: SIZE, height: SIZE }}>
        <svg
          ref={svgRef}
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="select-none overflow-visible"
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          data-testid="wheel-svg"
        >
          <rect x={0} y={0} width={SIZE} height={SIZE} fill="transparent" />
          <circle cx={CENTER} cy={CENTER} r={RING_R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
          <circle cx={CENTER} cy={CENTER} r={RING_R * 0.5} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={1} strokeDasharray="3 3" />

          {DIMENSIONS.map((dim) => {
            const lx = CENTER + Math.cos(dim.angle) * (RING_R + 14);
            const ly = CENTER + Math.sin(dim.angle) * (RING_R + 14);
            const barEnd = CENTER + Math.cos(dim.angle) * (RING_R * weights[dim.key] * 3.5);
            const barEndY = CENTER + Math.sin(dim.angle) * (RING_R * weights[dim.key] * 3.5);
            return (
              <g key={dim.key}>
                <line x1={CENTER} y1={CENTER} x2={CENTER + Math.cos(dim.angle) * RING_R} y2={CENTER + Math.sin(dim.angle) * RING_R} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
                <line x1={CENTER} y1={CENTER} x2={barEnd} y2={barEndY} stroke={dim.color} strokeWidth={3} strokeLinecap="round" opacity={0.5} />
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fill={dim.color} fontSize={8} fontWeight={600} opacity={0.9}>
                  {dim.label}
                </text>
              </g>
            );
          })}

          <circle cx={CENTER} cy={CENTER} r={24} fill="rgba(15,23,42,0.85)" />
          <text x={CENTER} y={CENTER} textAnchor="middle" dominantBaseline="central" fill="#94a3b8" fontSize={8} fontWeight={500} opacity={0.7}>
            {isAtCenter ? 'current' : 'drag'}
          </text>

          <circle cx={handlePos.x} cy={handlePos.y} r={HANDLE_R + 8} fill="transparent" data-testid="wheel-handle-hitarea" />
          <circle
            cx={handlePos.x}
            cy={handlePos.y}
            r={HANDLE_R}
            fill={dragging ? 'rgba(139,92,246,1)' : 'rgba(139,92,246,0.8)'}
            stroke="white"
            strokeWidth={2.5}
            className="cursor-grab active:cursor-grabbing"
            style={{ filter: dragging ? 'drop-shadow(0 0 6px rgba(139,92,246,0.6))' : 'none' }}
            data-testid="wheel-handle"
          />
        </svg>
        {liveCalc.suggested != null && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: handlePos.x,
              top: handlePos.y + calloutOffsetY,
              transform: 'translateX(-50%)',
              zIndex: 20,
            }}
          >
            <div
              className="text-[11px] font-bold px-2 py-0.5 rounded-sm leading-tight whitespace-nowrap shadow-lg"
              style={{
                background: 'rgba(88,28,135,0.92)',
                color: '#d8b4fe',
                border: '1px solid rgba(139,92,246,0.6)',
              }}
              data-testid="wheel-price-callout"
            >
              ${liveCalc.suggested.toFixed(2)}
              {bd && bd.storePremiumPct > 0 && (
                <span className="ml-1 text-[9px] text-amber-300 font-medium">+{bd.storePremiumPct.toFixed(0)}%</span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-1 flex-wrap justify-center">
        {DIMENSIONS.map((dim) => (
          <span key={dim.key} className="text-[8px] px-1.5 py-0.5 rounded" style={{ backgroundColor: `${dim.color}20`, color: dim.color }}>
            {dim.label} {(weights[dim.key] * 100).toFixed(0)}%
          </span>
        ))}
      </div>

      <Button
        size="sm"
        variant="default"
        className="w-full bg-purple-600 hover:bg-purple-500 text-xs"
        disabled={isAtCenter}
        onClick={() => {
          onSave(liveCfg);
          setWeights({ demand: 0.25, rarity: 0.25, headroom: 0.25, competition: 0.25 });
          setHandlePos({ x: CENTER, y: CENTER });
        }}
        data-testid="button-apply-weights"
      >
        {isAtCenter ? 'Drag to adjust' : 'Apply to All Items'}
      </Button>

      {!isDefaults && (
        <button
          onClick={() => {
            onSave(DEFAULT_SUG_CONFIG);
            setWeights({ demand: 0.25, rarity: 0.25, headroom: 0.25, competition: 0.25 });
            setHandlePos({ x: CENTER, y: CENTER });
          }}
          className="w-full flex items-center justify-center gap-1.5 text-[10px] text-gray-500 hover:text-gray-300 transition-colors py-1"
          data-testid="button-restore-defaults"
        >
          <RotateCcw className="w-3 h-3" />
          Restore industry defaults
        </button>
      )}

      {bd && (
        <>
          <button
            onClick={() => setShowDetail(!showDetail)}
            className="text-[9px] text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
            data-testid="button-toggle-breakdown"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showDetail ? '' : '-rotate-90'}`} />
            Calculation details
          </button>
          {showDetail && (
            <div className="w-full text-[10px] leading-snug space-y-1.5">
              <div className="space-y-0.5 border-b border-gray-700/60 pb-1.5">
                <p className="text-[8px] uppercase tracking-wider text-gray-500 mb-0.5">Base Market Price</p>
                {row(`Sold Avg × ${pct(bd.cfg.soldAvgW)}`, f(bd.soldAvg * bd.cfg.soldAvgW))}
                {row(`Listed Min × ${pct(bd.cfg.stockMinW)}`, f(bd.stockMin * bd.cfg.stockMinW))}
                {row(`Sold Max × ${pct(bd.cfg.soldMaxW)}`, f(bd.soldMax * bd.cfg.soldMaxW))}
                {row('= Base', f(bd.base), true)}
              </div>
              <div className="space-y-0.5 border-b border-gray-700/60 pb-1.5">
                <p className="text-[8px] uppercase tracking-wider text-gray-500 mb-0.5">Adjustments</p>
                {row(`STR (${bd.soldQty} sold / ${bd.stockQty} listed)`, `${(bd.velocity * 100).toFixed(0)}%`)}
                {row(`Demand adj`, `×${bd.demandAdj.toFixed(3)}`)}
                {bd.stockMin > 0 && row(`Comp cap`, f(bd.stockMin * bd.cfg.compCap))}
                {bd.storePremiumPct > 0 && row(`Store Premium`, `+${bd.storePremiumPct.toFixed(1)}%`)}
                {bd.floor > 0 && row(`Floor`, f(bd.floor))}
                {row('= Suggested', f(bd.suggested), true)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BreakdownPopover({ bd, label, children, onOpenSettings, lot }: {
  bd: SugBreakdown;
  label: string;
  children: React.ReactNode;
  onOpenSettings?: (lot?: PricingInsight) => void;
  lot?: PricingInsight | null;
}) {
  const [open, setOpen] = useState(false);
  const f = (v: number) => `$${v.toFixed(2)}`;
  const pctFmt = (v: number) => `${(v * 100).toFixed(0)}%`;
  const row = (lbl: string, val: string, highlight?: boolean) => (
    <div className={`flex justify-between gap-2 ${highlight ? 'text-purple-300 font-semibold' : 'text-gray-400'}`}>
      <span>{lbl}</span>
      <span className="font-mono">{val}</span>
    </div>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 bg-slate-900 border-slate-700 text-gray-300 p-3 z-50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <p className="font-bold text-purple-300 text-xs">{label}</p>
          <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300 transition-colors" data-testid="button-close-breakdown">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="text-[10px] leading-snug space-y-1.5">
          <div className="space-y-0.5 border-b border-gray-700/60 pb-1.5">
            <p className="text-[8px] uppercase tracking-wider text-gray-500 mb-0.5">Base Market Price</p>
            {row(`Sold Avg × ${pctFmt(bd.cfg.soldAvgW)}`, f(bd.soldAvg * bd.cfg.soldAvgW))}
            {row(`Listed Min × ${pctFmt(bd.cfg.stockMinW)}`, f(bd.stockMin * bd.cfg.stockMinW))}
            {row(`Sold Max × ${pctFmt(bd.cfg.soldMaxW)}`, f(bd.soldMax * bd.cfg.soldMaxW))}
            {row('= Base', f(bd.base), true)}
          </div>
          <div className="space-y-0.5">
            <p className="text-[8px] uppercase tracking-wider text-gray-500 mb-0.5">Adjustments</p>
            {row(`STR (${bd.soldQty} sold / ${bd.stockQty} listed)`, `${(bd.velocity * 100).toFixed(0)}%`)}
            {row(`Demand adj`, `×${bd.demandAdj.toFixed(3)}`)}
            {bd.stockMin > 0 && row(`Comp cap`, f(bd.stockMin * bd.cfg.compCap))}
            {bd.storePremiumPct > 0 && row(`Store Premium`, `+${bd.storePremiumPct.toFixed(1)}%`)}
            {bd.floor > 0 && row(`Floor`, f(bd.floor))}
            {row('= Suggested', f(bd.suggested), true)}
          </div>
          {onOpenSettings && (
            <button
              onClick={() => { setOpen(false); onOpenSettings(lot ?? undefined); }}
              className="flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300 transition-colors pt-1.5 border-t border-gray-700/40 w-full"
              data-testid="button-tune-in-settings"
            >
              <Settings2 className="w-3 h-3" />
              Tune pricing strategy
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}


function ScoreBreakdownPopover({ lot, cfg, sugCfg, children, onOpenSettings }: {
  lot: PricingInsight;
  cfg: ScoreConfig;
  sugCfg?: SugConfig;
  children: React.ReactNode;
  onOpenSettings?: (lot: PricingInsight) => void;
}) {
  const [open, setOpen] = useState(false);
  const bd = calcScoreBreakdown(lot, cfg, sugCfg);
  const strPct = bd.velocity.raw * 100;
  const strBand = strPct >= 100 ? { label: 'demand surge', color: '#4ade80' }
    : strPct >= 40 ? { label: 'healthy demand', color: '#34d399' }
    : { label: 'slow mover', color: '#fb923c' };
  const undercutRatio = lot.undercutRatio ?? 1;
  const undercutFmt = undercutRatio < 1
    ? `${undercutRatio.toFixed(2)}× ↑ room to raise`
    : undercutRatio > 1
    ? `${undercutRatio.toFixed(2)}× ↓ being undercut`
    : `${undercutRatio.toFixed(2)}× at market min`;
  const dims = [
    { key: 'ceiling', label: 'Ceiling', color: '#60a5fa', rawFmt: `${bd.ceiling.raw.toFixed(2)}×`, weighted: bd.ceiling.weighted },
    { key: 'velocity', label: `STR ${strPct.toFixed(0)}%`, color: strBand.color, rawFmt: strBand.label, weighted: bd.velocity.weighted },
    { key: 'scarcity', label: 'Scarcity', color: '#a78bfa', rawFmt: bd.scarcity.raw.toFixed(4), weighted: bd.scarcity.weighted },
    { key: 'undercut', label: 'Undercut', color: '#fbbf24', rawFmt: undercutFmt, weighted: bd.undercut.weighted },
  ];
  const weights = [bd.ceiling.weight, bd.velocity.weight, bd.scarcity.weight, bd.undercut.weight];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 bg-slate-900 border-slate-700 text-gray-300 p-3 z-50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <p className="font-bold text-purple-300 text-xs">Score Breakdown</p>
          <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300 transition-colors" data-testid="button-close-score-breakdown">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="text-[10px] leading-snug space-y-1">
          {dims.map((d, i) => (
            <div key={d.key} className="flex justify-between gap-2 text-gray-400">
              <span style={{ color: d.color }}>{d.label} <span className="text-gray-600">({(weights[i] * 100).toFixed(0)}%)</span></span>
              <span className="font-mono">
                <span className="text-gray-600">{d.rawFmt}</span>
                {' '}
                <span className="text-gray-300">{d.weighted.toFixed(3)}</span>
              </span>
            </div>
          ))}
          {bd.suggestion != null && (
            <div className="flex justify-between gap-2 text-gray-400 border-t border-gray-700/20 pt-1">
              <span style={{ color: '#f472b6' }}>
                Strategy {' '}
                <span className="text-gray-600">(influence)</span>
              </span>
              <span className="font-mono">
                <span className="text-gray-600">
                  {bd.suggestion.raw >= 0 ? '+' : ''}{(bd.suggestion.raw * 100).toFixed(0)}%
                </span>
                {' '}
                <span style={{ color: bd.suggestion.weighted >= 0 ? '#86efac' : '#fca5a5' }}>
                  {bd.suggestion.weighted >= 0 ? '+' : ''}{bd.suggestion.weighted.toFixed(3)}
                </span>
              </span>
            </div>
          )}
          <div className="flex justify-between gap-2 text-purple-300 font-semibold border-t border-gray-700/40 pt-1">
            <span>= Combined</span>
            <span className="font-mono">{bd.total.toFixed(3)}</span>
          </div>
          {onOpenSettings && (
            <button
              onClick={() => { setOpen(false); onOpenSettings(lot); }}
              className="flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300 transition-colors pt-1.5 border-t border-gray-700/40 w-full"
              data-testid="button-tune-scoring-settings"
            >
              <Settings2 className="w-3 h-3" />
              Tune scoring weights
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const SCORE_DIMENSIONS = [
  { key: 'ceiling' as const, label: 'Ceiling', color: '#60a5fa', angle: -Math.PI / 2, desc: 'Price upside potential' },
  { key: 'velocity' as const, label: 'STR', color: '#34d399', angle: 0, desc: 'Sell-through rate (sold ÷ listed)' },
  { key: 'scarcity' as const, label: 'Scarcity', color: '#a78bfa', angle: Math.PI / 2, desc: 'Market rarity' },
  { key: 'undercut' as const, label: 'Undercut', color: '#fbbf24', angle: Math.PI, desc: 'Price ÷ market min — below 1 = boost, above 1 = penalty' },
];

type ScoreWeights = { ceiling: number; velocity: number; scarcity: number; undercut: number };

function scoreWeightsToConfig(w: ScoreWeights, baseCfg: ScoreConfig): ScoreConfig {
  const total = w.ceiling + w.velocity + w.scarcity + w.undercut;
  if (total <= 0) return baseCfg;
  return {
    wCeiling: w.ceiling / total,
    wVelocity: w.velocity / total,
    wScarcity: w.scarcity / total,
    wUndercut: w.undercut / total,
  };
}

export function ScoringWheel({ lot, baseCfg, onSave }: { lot?: PricingInsight | null; baseCfg: ScoreConfig; onSave: (cfg: ScoreConfig) => void }) {
  const SIZE = 200;
  const R = SIZE / 2;
  const HANDLE_R = 14;
  const RING_R = R - 28;
  const CENTER = R;
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [weights, setWeights] = useState<ScoreWeights>({ ceiling: 0.25, velocity: 0.25, scarcity: 0.25, undercut: 0.25 });
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [handlePos, setHandlePos] = useState<{ x: number; y: number }>({ x: CENTER, y: CENTER });
  const [showDetail, setShowDetail] = useState(false);

  const updateFromPos = useCallback((x: number, y: number) => {
    const dx = x - CENTER;
    const dy = y - CENTER;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = RING_R;
    const clampedDist = Math.min(dist, maxDist);
    const angle = Math.atan2(dy, dx);
    const cx = CENTER + Math.cos(angle) * clampedDist;
    const cy = CENTER + Math.sin(angle) * clampedDist;
    setHandlePos({ x: cx, y: cy });

    const strength = clampedDist / maxDist;
    const newW: ScoreWeights = { ceiling: 0.25, velocity: 0.25, scarcity: 0.25, undercut: 0.25 };
    if (strength > 0.05) {
      for (const dim of SCORE_DIMENSIONS) {
        const angleDiff = Math.abs(Math.atan2(Math.sin(angle - dim.angle), Math.cos(angle - dim.angle)));
        const influence = Math.max(0, 1 - angleDiff / (Math.PI * 0.75));
        newW[dim.key] = 0.05 + influence * strength;
      }
      const total = newW.ceiling + newW.velocity + newW.scarcity + newW.undercut;
      newW.ceiling /= total;
      newW.velocity /= total;
      newW.scarcity /= total;
      newW.undercut /= total;
    }
    setWeights(newW);
  }, [CENTER, RING_R]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const preventScroll = (e: TouchEvent) => {
      if (draggingRef.current) { e.preventDefault(); e.stopPropagation(); }
    };
    el.addEventListener('touchmove', preventScroll, { passive: false });
    el.addEventListener('touchstart', (e: TouchEvent) => {
      if (draggingRef.current) { e.preventDefault(); }
    }, { passive: false });
    return () => { el.removeEventListener('touchmove', preventScroll); };
  }, []);

  const getSvgCoords = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    draggingRef.current = true; setDragging(true);
    (e.target as Element).setPointerCapture(e.pointerId);
    const coords = getSvgCoords(e); if (coords) updateFromPos(coords.x, coords.y);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    e.preventDefault(); e.stopPropagation();
    const coords = getSvgCoords(e); if (coords) updateFromPos(coords.x, coords.y);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    draggingRef.current = false; setDragging(false);
  };

  const isAtCenter = Math.abs(handlePos.x - CENTER) < 2 && Math.abs(handlePos.y - CENTER) < 2;
  const isDefaults = Math.abs(baseCfg.wCeiling - DEFAULT_SCORE_CONFIG.wCeiling) < 0.001
    && Math.abs(baseCfg.wVelocity - DEFAULT_SCORE_CONFIG.wVelocity) < 0.001
    && Math.abs(baseCfg.wScarcity - DEFAULT_SCORE_CONFIG.wScarcity) < 0.001
    && Math.abs(baseCfg.wUndercut - DEFAULT_SCORE_CONFIG.wUndercut) < 0.001;
  const liveCfg = scoreWeightsToConfig(weights, baseCfg);
  const liveScore = lot ? calcScore(lot, liveCfg) : null;

  const scoreCalloutOffsetY = -(HANDLE_R + 22);

  const scoreColor = liveScore != null
    ? liveScore >= 0.7 ? { bg: 'rgba(22,101,52,0.92)', text: '#86efac', border: 'rgba(34,197,94,0.6)' }
    : liveScore >= 0.4 ? { bg: 'rgba(120,80,0,0.92)', text: '#fde68a', border: 'rgba(250,204,21,0.6)' }
    : { bg: 'rgba(127,29,29,0.92)', text: '#fca5a5', border: 'rgba(239,68,68,0.6)' }
    : { bg: 'rgba(17,24,39,0.80)', text: '#6b7280', border: 'rgba(156,163,175,0.55)' };

  return (
    <div className="flex flex-col items-center gap-2 w-full select-none" ref={containerRef} style={{ touchAction: 'none' }}>
      <div className="relative overflow-visible" style={{ width: SIZE, height: SIZE }}>
        <svg
          ref={svgRef}
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="overflow-visible"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          data-testid="scoring-wheel-svg"
        >
          <circle cx={CENTER} cy={CENTER} r={RING_R} fill="none" stroke="#334155" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.5} />
          <circle cx={CENTER} cy={CENTER} r={RING_R * 0.5} fill="none" stroke="#334155" strokeWidth={0.8} strokeDasharray="2 4" opacity={0.3} />

          {SCORE_DIMENSIONS.map((dim) => {
            const ex = CENTER + Math.cos(dim.angle) * RING_R;
            const ey = CENTER + Math.sin(dim.angle) * RING_R;
            const lx = CENTER + Math.cos(dim.angle) * (RING_R + 16);
            const ly = CENTER + Math.sin(dim.angle) * (RING_R + 16);
            return (
              <g key={dim.key}>
                <line x1={CENTER} y1={CENTER} x2={ex} y2={ey} stroke={dim.color} strokeWidth={0.8} opacity={0.3} />
                <circle cx={ex} cy={ey} r={3} fill={dim.color} opacity={0.6} />
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fill={dim.color} fontSize={8} fontWeight={600} opacity={0.9}>
                  {dim.label}
                </text>
              </g>
            );
          })}

          <circle cx={CENTER} cy={CENTER} r={24} fill="rgba(15,23,42,0.85)" />
          <text x={CENTER} y={CENTER} textAnchor="middle" dominantBaseline="central" fill="#94a3b8" fontSize={8} fontWeight={500} opacity={0.7}>
            {isAtCenter ? 'current' : 'drag'}
          </text>

          <circle cx={handlePos.x} cy={handlePos.y} r={HANDLE_R + 8} fill="transparent" data-testid="scoring-wheel-handle-hitarea" />
          <circle
            cx={handlePos.x} cy={handlePos.y} r={HANDLE_R}
            fill={dragging ? '#7c3aed' : '#6d28d9'} stroke="#a78bfa" strokeWidth={2}
            style={{ cursor: 'grab', filter: dragging ? 'drop-shadow(0 0 8px rgba(139,92,246,0.5))' : 'drop-shadow(0 0 4px rgba(139,92,246,0.3))' }}
            data-testid="scoring-wheel-handle"
          />
        </svg>
        {liveScore != null && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: handlePos.x,
              top: handlePos.y + scoreCalloutOffsetY,
              transform: 'translateX(-50%)',
              zIndex: 20,
            }}
          >
            <div
              className="text-[11px] font-bold px-2 py-0.5 rounded-sm leading-tight whitespace-nowrap shadow-lg"
              style={{
                background: scoreColor.bg,
                color: scoreColor.text,
                border: `1px solid ${scoreColor.border}`,
              }}
              data-testid="wheel-score-callout"
            >
              {liveScore.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-1.5 text-[9px]">
        {SCORE_DIMENSIONS.map((dim) => (
          <span key={dim.key} className="font-mono px-1 py-0.5 rounded" style={{ color: dim.color, backgroundColor: `${dim.color}15` }}>
            {dim.label} {(liveCfg[`w${dim.key.charAt(0).toUpperCase() + dim.key.slice(1)}` as keyof ScoreConfig] * 100).toFixed(0)}%
          </span>
        ))}
      </div>

      <Button
        size="sm" variant="default"
        className="w-full bg-purple-600 hover:bg-purple-500 text-xs"
        disabled={isAtCenter}
        onClick={() => {
          onSave(liveCfg);
          setWeights({ ceiling: 0.25, velocity: 0.25, scarcity: 0.25, undercut: 0.25 });
          setHandlePos({ x: CENTER, y: CENTER });
        }}
        data-testid="button-apply-scoring-weights"
      >
        {isAtCenter ? 'Drag to adjust' : 'Apply to All Items'}
      </Button>

      {!isDefaults && (
        <button
          onClick={() => {
            onSave(DEFAULT_SCORE_CONFIG);
            setWeights({ ceiling: 0.25, velocity: 0.25, scarcity: 0.25, undercut: 0.25 });
            setHandlePos({ x: CENTER, y: CENTER });
          }}
          className="w-full flex items-center justify-center gap-1.5 text-[10px] text-gray-500 hover:text-gray-300 transition-colors py-1"
          data-testid="button-restore-scoring-defaults"
        >
          <RotateCcw className="w-3 h-3" />
          Restore industry defaults
        </button>
      )}

      {lot && (
        <>
          <button
            onClick={() => setShowDetail(!showDetail)}
            className="text-[9px] text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
            data-testid="button-toggle-scoring-breakdown"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showDetail ? '' : '-rotate-90'}`} />
            Score breakdown
          </button>
          {showDetail && (
            <div className="w-full text-[10px] leading-snug space-y-0.5 bg-gray-900/60 rounded p-2 border border-gray-700/40">
              <div className="flex justify-between gap-2 text-gray-400">
                <span>Ceiling ({(liveCfg.wCeiling * 100).toFixed(0)}%)</span>
                <span className="font-mono">{((lot.priceCeilingRatio ?? 0) * liveCfg.wCeiling).toFixed(3)}</span>
              </div>
              <div className="flex justify-between gap-2 text-gray-400">
                <span>STR ({(liveCfg.wVelocity * 100).toFixed(0)}%)</span>
                <span className="font-mono">{(Math.min(1, lot.demandVelocity ?? 0) * liveCfg.wVelocity).toFixed(3)}</span>
              </div>
              <div className="flex justify-between gap-2 text-gray-400">
                <span>Scarcity ({(liveCfg.wScarcity * 100).toFixed(0)}%)</span>
                <span className="font-mono">{((lot.marketScarcity ?? 0) * liveCfg.wScarcity).toFixed(3)}</span>
              </div>
              <div className="flex justify-between gap-2 text-gray-400">
                <span>Undercut ({(liveCfg.wUndercut * 100).toFixed(0)}%)</span>
                <span className="font-mono">{(lot.undercutRatio && lot.undercutRatio > 0 ? (1 - lot.undercutRatio) * liveCfg.wUndercut : 0).toFixed(3)}</span>
              </div>
              <div className="flex justify-between gap-2 text-purple-300 font-semibold border-t border-gray-700/40 pt-1">
                <span>= Combined Score</span>
                <span className="font-mono">{liveScore?.toFixed(3) ?? '—'}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const SORT_TO_SCORE_LABEL: Record<SortField, string> = {
  ceiling: 'Ceil', velocity: 'STR', scarcity: 'Scarc', undercut: 'Undr', combined: 'Score',
};

function ScoresBar({ group, activeSort, scoreCfg, sugCfg, onOpenScoringSettings }: {
  group: GroupedInsight;
  activeSort: SortField;
  scoreCfg: ScoreConfig;
  sugCfg?: SugConfig;
  onOpenScoringSettings?: (lot: PricingInsight) => void;
}) {
  const strPctBest = group.bestVelocity != null ? group.bestVelocity * 100 : null;
  const items: Array<{ label: string; value: number | null; suffix?: string; isPct?: boolean; isInverted?: boolean }> = [
    { label: 'Ceil', value: group.bestCeiling, suffix: '×' },
    { label: 'STR', value: strPctBest, suffix: '%', isPct: true },
    { label: 'Scarc', value: group.bestScarcity },
    // Undercut: lower ratio = you're cheapest = green; higher = being undercut = red
    { label: 'Undr', value: group.bestUndercut, suffix: '×', isInverted: true },
    { label: 'Score', value: group.bestCombined },
  ];
  const activeLabel = SORT_TO_SCORE_LABEL[activeSort];
  const bestLot = group.newLot ?? group.usedLot;

  const bar = (
    <div
      className={`flex items-center gap-0.5 mt-1.5 ${bestLot ? 'cursor-pointer' : ''}`}
      onClick={(e) => e.stopPropagation()}
      data-testid={`scores-bar-${group.key}`}
    >
      {items.map(({ label, value, suffix, isPct, isInverted }) => {
        const isActive = label === activeLabel;
        // STR: colour based on normalised [0,1]. Inverted (undercut): lower value = greener.
        const colorVal = isPct && value != null ? value / 100
          : isInverted && value != null ? 2 - value  // ratio 0.5 → 1.5 (green), ratio 1.5 → 0.5 (red)
          : value;
        const displayStr = value != null
          ? `${isPct ? value.toFixed(0) : value.toFixed(2)}${suffix ?? ''}`
          : '—';
        return (
          <div key={label} className={`flex-1 text-center rounded-sm py-0.5 lg:py-1 ${isActive ? 'bg-violet-500/[0.15] ring-1 ring-inset ring-violet-400/30' : ''}`}>
            <div className={`text-[7px] lg:text-[9px] uppercase tracking-wider leading-none mb-0.5 ${isActive ? 'text-violet-300' : 'text-gray-600'}`}>{label}</div>
            <div className={`text-[10px] lg:text-xs font-mono font-bold leading-none ${scoreColor(colorVal)}`}>
              {displayStr}
            </div>
          </div>
        );
      })}
    </div>
  );

  if (!bestLot) return bar;

  return (
    <ScoreBreakdownPopover lot={bestLot} cfg={scoreCfg} sugCfg={sugCfg} onOpenSettings={onOpenScoringSettings}>
      {bar}
    </ScoreBreakdownPopover>
  );
}

const SORT_LABELS: Record<SortField, string> = {
  combined: 'Score',
  ceiling: 'Ceiling',
  velocity: 'STR',
  scarcity: 'Scarcity',
  undercut: 'Undercut',
};

export default function PriceOMaticDashboard({ onItemClick, onOpenSettings }: PriceOMaticDashboardProps) {
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
  const sugCfg: SugConfig = insightsData?.sugConfig ?? DEFAULT_SUG_CONFIG;
  const scoreCfg: ScoreConfig = insightsData?.scoreConfig ?? DEFAULT_SCORE_CONFIG;
  const pomSortMode: 'scoring' | 'suggested' = insightsData?.sortMode ?? 'scoring';

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
      // For undercut, pick the LOWEST ratio (cheapest relative to market = most competitive)
      const nU = g.newLot?.undercutRatio ?? null;
      const uU = g.usedLot?.undercutRatio ?? null;
      g.bestUndercut = (nU != null && uU != null) ? Math.min(nU, uU) : (nU ?? uU);
      if (pomSortMode === 'suggested') {
        // Opportunity sort: total dollar impact = sum of (suggested − current) × qty across both lots
        const oppScore = (l: PricingInsight): number => {
          const current = parseFloat(l.unitPrice || '0');
          const { suggested } = calcSuggested(l, sugCfg);
          const qty = l.quantity ?? 0;
          return (suggested - current) * qty;
        };
        const nOpp = g.newLot ? oppScore(g.newLot) : 0;
        const uOpp = g.usedLot ? oppScore(g.usedLot) : 0;
        g.bestCombined = nOpp + uOpp;
      } else {
        g.bestCombined = pick(l => calcHybridScore(l, scoreCfg, sugCfg));
      }
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
        <div className="flex items-stretch rounded-md border border-gray-700/60 bg-gray-900/50 overflow-hidden text-[9px] lg:text-[11px] font-semibold uppercase tracking-wider mx-1 mb-1">
            <button
              onClick={() => setOrbitFilter('in_orbit')}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 px-2 py-1.5 transition-colors ${
                orbitFilter === 'in_orbit'
                  ? 'bg-blue-500/20 text-blue-300'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
              data-testid="filter-in-orbit"
            >
              <div className="flex items-center gap-1 whitespace-nowrap">
                <Orbit className="w-2.5 h-2.5 flex-shrink-0" />
                <span>Orbit</span>
                <span className="opacity-50 font-normal">({inOrbitGroups.length})</span>
              </div>
              <span className="text-[7px] lg:text-[9px] font-normal normal-case tracking-normal opacity-60">In progress</span>
            </button>
            <div className="w-px self-stretch bg-gray-700/60" />
            <button
              onClick={() => setOrbitFilter('future_missions')}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 px-2 py-1.5 transition-colors ${
                orbitFilter === 'future_missions'
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
              data-testid="filter-future-missions"
            >
              <div className="flex items-center gap-1 whitespace-nowrap">
                <Satellite className="w-2.5 h-2.5 lg:w-3 lg:h-3 flex-shrink-0" />
                <span>Missions</span>
                <span className="opacity-50 font-normal">({futureMissionsGroups.length})</span>
              </div>
              <span className="text-[7px] lg:text-[9px] font-normal normal-case tracking-normal opacity-60">Circle back</span>
            </button>
            <div className="w-px self-stretch bg-gray-700/60" />
            <button
              onClick={() => setOrbitFilter('deep_space')}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 px-2 py-1.5 transition-colors ${
                orbitFilter === 'deep_space'
                  ? 'bg-indigo-500/20 text-indigo-300'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
              data-testid="filter-deep-space"
            >
              <div className="flex items-center gap-1 whitespace-nowrap">
                <Rocket className="w-2.5 h-2.5 lg:w-3 lg:h-3 flex-shrink-0" />
                <span>Deep Space</span>
                <span className="opacity-50 font-normal">({deepSpaceGroups.length})</span>
              </div>
              <span className="text-[7px] lg:text-[9px] font-normal normal-case tracking-normal opacity-60">Done</span>
            </button>
          </div>

        <div className="flex items-center justify-center gap-0.5 px-1 pb-1">
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
                <p><span className="text-purple-300 font-medium">STR</span> — sell-through rate (sold ÷ listed, 6mo). &gt;100% = demand surge, 40–100% = healthy, &lt;40% = slow mover. Capped at 100% for scoring.</p>
                <p><span className="text-amber-300 font-medium">Scarcity</span> — inverse of total listed lots. Higher means fewer sellers competing.</p>
                <p><span className="text-rose-300 font-medium">Undercut</span> — your price ÷ market min. Ratio &lt; 1 = you're the cheapest (score boost); ratio &gt; 1 = being undercut (score penalty). Penalises items where competitors are cheaper.</p>
                <p><span className="text-emerald-300 font-medium">Score</span> — weighted combination of all four metrics using your configured weights.</p>
              </div>
            </PopoverContent>
          </Popover>
          {(Object.entries(SORT_LABELS) as [SortField, string][]).map(([field, label]) => (
            <button
              key={field}
              onClick={() => handleSortTap(field)}
              className={`flex items-center gap-0.5 text-[8px] lg:text-[10px] font-semibold uppercase tracking-wide px-1.5 lg:px-2 py-0.5 rounded transition-colors ${
                sortField === field
                  ? 'bg-purple-500/20 text-purple-300'
                  : 'text-gray-600 hover:text-gray-400'
              }`}
              data-testid={`sort-${field}`}
            >
              {field === 'combined' && pomSortMode === 'suggested' ? 'Opp$' : label}
              {sortField === field && (
                sortDir === 'desc' ? <ArrowDown className="w-2.5 h-2.5 lg:w-3 lg:h-3" /> : <ArrowUp className="w-2.5 h-2.5 lg:w-3 lg:h-3" />
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
                      className="group relative bg-gradient-to-br from-blue-950/50 via-slate-800/70 to-blue-900/30 border border-blue-700/25 rounded-lg px-2.5 py-2 lg:px-4 lg:py-3 cursor-pointer shadow-[0_2px_8px_rgba(15,40,100,0.35),inset_0_1px_0_rgba(147,197,253,0.07)] hover:shadow-[0_4px_14px_rgba(15,40,100,0.5),inset_0_1px_0_rgba(147,197,253,0.12)] hover:border-blue-600/40 transition-shadow duration-150"
                      data-testid={`item-group-${group.key}`}
                      onClick={() => {
                        if (primaryLot) onItemClick?.('inventory', primaryLot.inventoryId);
                      }}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-[11px] lg:text-sm text-blue-200/90 font-semibold flex-shrink-0">{group.itemNo}</span>
                        <p className="text-[11px] lg:text-sm text-slate-300 truncate flex-1 min-w-0">{group.itemName && group.itemName !== 'undefined' ? group.itemName : 'Unknown Item'}</p>
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
                        {group.newLot && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] lg:text-[11px] font-mono bg-blue-500/10 text-blue-300 rounded px-1 py-0.5 flex-shrink-0">
                            <span className="text-[7px] lg:text-[9px] font-bold uppercase">N</span>×{group.newLot.quantity}
                          </span>
                        )}
                        {group.usedLot && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] lg:text-[11px] font-mono bg-orange-500/10 text-orange-300 rounded px-1 py-0.5 flex-shrink-0">
                            <span className="text-[7px] lg:text-[9px] font-bold uppercase">U</span>×{group.usedLot.quantity}
                          </span>
                        )}
                        {group.colorRgb && (
                          <span
                            className="w-2.5 h-2.5 lg:w-3 lg:h-3 rounded-full flex-shrink-0 border border-white/20"
                            style={{ backgroundColor: `#${group.colorRgb}` }}
                          />
                        )}
                        <span className="text-[10px] lg:text-xs text-slate-400 truncate min-w-0">{group.colorName || '—'}</span>
                      </div>

                      <PricingGrid group={group} activeSort={sortField} cfg={sugCfg} onOpenSettings={onOpenSettings ? (lot) => onOpenSettings('priceomatic', lot) : undefined} />
                      <ScoresBar group={group} activeSort={sortField} scoreCfg={scoreCfg} sugCfg={sugCfg} onOpenScoringSettings={onOpenSettings ? (lot) => onOpenSettings('priceomatic', undefined, lot) : undefined} />
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

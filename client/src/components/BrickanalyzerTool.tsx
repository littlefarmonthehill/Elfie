import { useState, useRef, useEffect, useMemo, forwardRef, useImperativeHandle } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Camera, X, CheckCircle, Loader2, ExternalLink, Trash2, ScanSearch, ChevronLeft, ChevronRight, Sparkles, Check, Grid3X3, Settings2, RotateCcw, ZoomIn, AlertTriangle, ThumbsUp, ThumbsDown, Minus, FlaskConical, BarChart3, RefreshCw, Target, Info, ChevronDown, ChevronUp } from "lucide-react";
import elfieRobot from "@assets/PlanetBrick_good_robot_1760672362080.png";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";

export interface BrickanalyzerToolRef {
  triggerCamera: () => void;
  triggerUpload: () => void;
  triggerFile: () => void;
}

interface InventoryLot {
  colorId: number | null;
  colorName: string | null;
  colorRgb: string | null;
  imageUrl?: string | null;
  qtyNew: number;
  priceNew: number | null;
  qtyUsed: number;
  priceUsed: number | null;
  peakNew: number | null;
  peakUsed: number | null;
}

interface ScanResult {
  partNo: string;
  partName: string;
  itemType?: 'PART' | 'MINIFIG';
  colorName: string;
  colorId: number | null;
  colorRgb: string | null;
  confidence: "high" | "medium" | "low";
  bqScore?: number | null;
  note: string;
  ourPriceNew: number | null;
  ourQtyNew: number;
  ourPriceUsed: number | null;
  ourQtyUsed: number;
  inventoryId: number | null;
  marketSoldMaxNew: number | null;
  marketSoldMaxUsed: number | null;
  marketSoldAvgNew?: number | null;
  marketSoldAvgUsed?: number | null;
  stockAvgPriceN?: number | null;
  stockAvgPriceU?: number | null;
  stockMaxPriceN?: number | null;
  stockMaxPriceU?: number | null;
  suggestedPriceNew?: number | null;
  suggestedPriceUsed?: number | null;
  thumbnailUrl: string | null;
  bestPrice: number | null;
  categoryId?: number | null;
  inventoryLots?: InventoryLot[];
  cropIndex?: number | null;
  bboxX?: number | null;
  bboxY?: number | null;
  bboxW?: number | null;
  bboxH?: number | null;
  detectionSource?: 'brickognize' | 'elfie' | null;
}

interface BrickanalyzerScan {
  id: number;
  status: "processing" | "complete" | "failed";
  totalPieces: number | null;
  identifiedPieces: number | null;
  estimatedValue: string | null;
  results: ScanResult[] | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  cropCount?: number;
  imgWidth?: number | null;
  imgHeight?: number | null;
  blApiCalls?: number | null;
}

type UIState = "idle" | "uploading" | "previewing" | "processing" | "complete" | "failed";

interface PreviewData {
  boxes:      { x: number; y: number; w: number; h: number }[];
  candidates: { x: number; y: number; w: number; h: number }[];
  imageWidth:  number;
  imageHeight: number;
  objectUrl:   string;
}

interface ScanSettings {
  // Multi-pass
  multiPass:       boolean; // run 3 passes (large/minifig, standard, small) and merge
  // Shared
  segmenter:       "contour";
  minSizePct:      number;  // % of image area — noise floor
  maxSizePct:      number;  // % of image area — surface/baseplate ceiling
  maxDimFrac:      number;  // max bbox width or height as % of image dimension (0-100)
  maxPieces:       number;  // cap on crops sent to Brickognize
  minConfidence:   number;  // Brickognize minimum score (0 = off)
  // Contour
  blurRadius:      number;  // Gaussian blur kernel size (noise suppression)
  cannyLow:        number;  // Canny lower threshold
  cannyHigh:       number;  // Canny upper threshold
  dilateIter:      number;  // dilation passes to close edge gaps
}

const DEFAULT_SETTINGS: ScanSettings = {
  multiPass:       false,
  segmenter:       "contour",
  minSizePct:      0.05,
  maxSizePct:      50,   // raised from 6 — allows close-up shots where a piece fills the frame
  maxDimFrac:      85,   // allow piece bounding box up to 85% of frame width/height
  maxPieces:       100,
  minConfidence:   0,
  blurRadius:      7,
  cannyLow:        110,
  cannyHigh:       320,
  dilateIter:      6,
};

const SETTINGS_KEY    = "brickspotter-settings";
const BASELINE_KEY    = "brickspotter-baseline";
const SCAN_MODE_KEY   = "brickspotter-scan-mode";
const CALIBRATION_KEY = "brickspotter-calibration";

interface CalibrationEntry {
  timestamp: number;
  round: 1 | 2 | 3 | 4;
  scanId: number;
  partNo: string;
  partName: string;
  confidence: string;
  cropIndex: number | null;
  verdict: 'correct' | 'close' | 'wrong';
}

const CALIBRATION_ROUNDS = [
  {
    round: 1 as const,
    label: 'Easy Calibration',
    goal: 'Baseline accuracy — big, obvious parts',
    color: 'text-green-400',
    borderColor: 'border-green-500/30',
    bg: 'bg-green-950/20',
    instructions: 'Scan 5–10 large, distinctive parts — long Technic beams, big slopes, doors, or windows. One piece per photo, plain background.',
    tips: ['Even, flat lighting works best', 'Keep the piece centered in frame', 'Dark or neutral background helps edge detection'],
  },
  {
    round: 2 as const,
    label: 'High-Value Targets',
    goal: 'Minifig + specialty part accuracy',
    color: 'text-amber-400',
    borderColor: 'border-amber-500/30',
    bg: 'bg-amber-950/20',
    instructions: 'Scan minifig torsos, heads, and accessories. Also try rare or highly-colored parts. These are your highest-value ID decisions.',
    tips: ['Minifig heads: try face-on first, then angled', 'Flat diffuse lighting prevents glare on printed faces', 'Accessories often match best when isolated'],
  },
  {
    round: 3 as const,
    label: 'Common Parts',
    goal: 'Volume accuracy — bread-and-butter inventory',
    color: 'text-blue-400',
    borderColor: 'border-blue-500/30',
    bg: 'bg-blue-950/20',
    instructions: 'Scan 1×1s, 1×2s, 2×4 bricks, tiles, and plates in various colors. This is your highest-volume category — accuracy here matters most.',
    tips: ['Small parts are hardest — try close-up shots', 'Color accuracy is critical for pricing', 'Try the same part in 2–3 colors to check color detection'],
  },
  {
    round: 4 as const,
    label: 'Stress Test',
    goal: 'Edge cases and failure modes',
    color: 'text-red-400',
    borderColor: 'border-red-500/30',
    bg: 'bg-red-950/20',
    instructions: 'Scan a pile of 5–8 mixed pieces, worn/dirty parts, unusual angles, or very similar-looking parts side by side.',
    tips: ['This exposes segmentation weaknesses', 'Note which failure types repeat — they reveal tuning opportunities', 'Adjust Manual settings if pieces merge or split'],
  },
] as const;

const ROUND_GUIDES: Record<1 | 2 | 3 | 4, { headline: string; steps: string[] }> = {
  1: {
    headline: 'One large part at a time',
    steps: ['Technic beam, slope, door, or window', 'Alone on a plain surface', 'Tap camera · rate it · repeat 5–10×'],
  },
  2: {
    headline: 'One minifig or specialty part at a time',
    steps: ['Torso, head, accessory, or printed tile — one piece only', 'Face-up on a plain surface', 'Tap camera · rate it · swap for another'],
  },
  3: {
    headline: 'One common brick, plate, or tile at a time',
    steps: ['1×2s, 2×4s, tiles, plates — one piece, up close', 'Fill the frame · try different colors across scans', 'Tap camera · rate it · repeat'],
  },
  4: {
    headline: '5–8 mixed pieces in a pile',
    steps: ['Mix types and colors — don\'t sort', 'Loose on a plain surface', 'Tap camera · see where it struggles'],
  },
};

function loadBaseline(): ScanSettings {
  try {
    const saved = localStorage.getItem(BASELINE_KEY);
    if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch {}
  return DEFAULT_SETTINGS;
}

function saveBaselineToStorage(s: ScanSettings) {
  try { localStorage.setItem(BASELINE_KEY, JSON.stringify(s)); } catch {}
}

function PomPriceRow({ label, value, isMono, highlight }: { label: string; value: string | number | null | undefined; isMono?: boolean; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-gray-400">{label}</span>
      <span className={`text-[10px] font-mono ${highlight ? 'text-purple-300 font-bold' : 'text-gray-200'}`}>
        {value == null ? '—' : isMono ? String(value) : `$${Number(value).toFixed(4)}`}
      </span>
    </div>
  );
}

function PomConditionCol({ data, label }: { data: any; label: string }) {
  if (!data) return <div className="text-gray-500 text-xs text-center py-2">No data</div>;
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wider text-center font-semibold text-gray-300 border-b border-gray-700 pb-1 mb-2">{label}</div>
      <div className="text-[9px] uppercase tracking-wider text-gray-500 pt-1">Current Listings</div>
      <PomPriceRow label="Avg" value={data.stockAvgPrice} />
      <PomPriceRow label="Min" value={data.stockMinPrice} />
      <PomPriceRow label="Max" value={data.stockMaxPrice} />
      <PomPriceRow label="Qty / Lots" value={data.stockQuantity != null ? `${data.stockQuantity ?? '—'} / ${data.stockTotalLots ?? '—'}` : null} isMono />
      <div className="text-[9px] uppercase tracking-wider text-gray-500 pt-2">Sold (6mo)</div>
      <PomPriceRow label="Avg" value={data.soldAvgPrice} />
      <PomPriceRow label="Min" value={data.soldMinPrice} />
      <PomPriceRow label="Max" value={data.soldMaxPrice} />
      <PomPriceRow label="Qty / Lots" value={data.soldQuantity != null ? `${data.soldQuantity ?? '—'} / ${data.soldTotalLots ?? '—'}` : null} isMono />
      {data.suggestedPrice != null && (
        <>
          <div className="text-[9px] uppercase tracking-wider text-gray-500 pt-2">POM Suggested</div>
          <PomPriceRow label={`${data.premiumPercentage ?? 15}% premium`} value={data.suggestedPrice} highlight />
        </>
      )}
    </div>
  );
}

function OverlayPricingPanel({ partNo, itemType, colorEntries }: {
  partNo: string;
  itemType: string;
  colorEntries: Array<{
    colorId?: number | null;
    colorName?: string | null;
    colorRgb?: string | null;
    ourPriceNew?: number | null;
    ourPriceUsed?: number | null;
    ourQtyNew?: number;
    ourQtyUsed?: number;
    marketSoldMaxNew?: number | null;
    marketSoldMaxUsed?: number | null;
    stockAvgPriceN?: number | null;
  }>;
}) {
  const [idx, setIdx] = useState(0);
  const entry = colorEntries[Math.min(idx, colorEntries.length - 1)];
  const scoreColor = (s: number) => s >= 2.0 ? 'text-emerald-400' : s >= 1.5 ? 'text-orange-400' : s >= 1.0 ? 'text-yellow-500' : 'text-gray-400';
  const peak = Math.max(entry?.marketSoldMaxNew ?? 0, entry?.marketSoldMaxUsed ?? 0, entry?.stockAvgPriceN ?? 0) || null;
  const nScore = peak && entry?.ourPriceNew && entry.ourPriceNew > 0 ? Number((peak / entry.ourPriceNew).toFixed(2)) : null;
  const uScore = peak && entry?.ourPriceUsed && entry.ourPriceUsed > 0 ? Number((peak / entry.ourPriceUsed).toFixed(2)) : null;
  const hasMyPrices = entry?.ourPriceNew != null || entry?.ourPriceUsed != null;
  const blType = itemType === 'MINIFIG' ? 'MINIFIG' : 'PART';
  const buildUrl = (cond: 'N' | 'U') => {
    const p = new URLSearchParams({ new_or_used: cond });
    if (entry?.colorId != null) p.set('color_id', String(entry.colorId));
    return `/api/inventory/price-guide/${encodeURIComponent(partNo)}/${blType}?${p}`;
  };
  const { data: nData, isLoading: nLoading } = useQuery<any>({
    queryKey: ['pom-detail', partNo, blType, entry?.colorId ?? null, 'N'],
    queryFn: async () => { const r = await fetch(buildUrl('N'), { credentials: 'include' }); if (!r.ok) throw new Error('Failed'); return r.json(); },
    staleTime: 5 * 60 * 1000,
  });
  const { data: uData, isLoading: uLoading } = useQuery<any>({
    queryKey: ['pom-detail', partNo, blType, entry?.colorId ?? null, 'U'],
    queryFn: async () => { const r = await fetch(buildUrl('U'), { credentials: 'include' }); if (!r.ok) throw new Error('Failed'); return r.json(); },
    staleTime: 5 * 60 * 1000,
  });
  const cachedAt = nData?.fetchedAt ?? uData?.fetchedAt;
  const loading = nLoading || uLoading;
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {colorEntries.length > 1 && (
        <div className="flex gap-2 px-4 pt-3 pb-2 flex-wrap shrink-0">
          {colorEntries.map((e, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium border transition-colors ${
                i === idx
                  ? 'bg-white/10 border-white/20 text-white'
                  : 'bg-transparent border-white/[0.08] text-gray-400 hover:text-gray-200'
              }`}
            >
              {e.colorRgb && <span className="w-3 h-3 rounded-full shrink-0 border border-white/20" style={{ backgroundColor: `#${e.colorRgb}` }} />}
              {e.colorName || `Color ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-gray-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (() => {
        const fmt = (v: any) => v != null && Number(v) > 0 ? `$${Number(v).toFixed(4)}` : '—';
        const fmtNum = (v: any) => v != null ? String(v) : '—';

        const GR = 'grid grid-cols-[1fr_76px_76px_76px_76px]';
        const cell = (extra = '') => `w-[76px] px-1 py-2 text-center text-[11px] font-mono tabular-nums border-l border-white/[0.06] ${extra}`;

        const DataRow = ({ label, sN, sU, lN, lU, mono, bold }: {
          label: string; sN: any; sU: any; lN: any; lU: any; mono?: boolean; bold?: boolean;
        }) => (
          <div className={`${GR} border-b border-white/[0.04] ${bold ? 'bg-white/[0.03]' : ''}`}>
            <div className={`px-3 py-2 text-[11px] ${bold ? 'text-gray-200 font-semibold' : 'text-gray-500'}`}>{label}</div>
            <div className={cell(bold ? 'text-amber-300 font-semibold' : 'text-gray-100')}>{mono ? fmtNum(sN) : fmt(sN)}</div>
            <div className={cell(bold ? 'text-amber-300 font-semibold' : 'text-gray-100')}>{mono ? fmtNum(sU) : fmt(sU)}</div>
            <div className={cell(bold ? 'text-sky-300 font-semibold' : 'text-gray-400')}>{mono ? fmtNum(lN) : fmt(lN)}</div>
            <div className={cell(bold ? 'text-sky-300 font-semibold' : 'text-gray-400')}>{mono ? fmtNum(lU) : fmt(lU)}</div>
          </div>
        );

        const hasSuggested = nData?.suggestedPrice != null || uData?.suggestedPrice != null;
        const pct = nData?.premiumPercentage ?? uData?.premiumPercentage ?? 15;

        return (
          <div className="px-4 pt-2 pb-4 space-y-3">
            {/* ── Main price table ─────────────────────────── */}
            <div className="rounded-xl overflow-hidden border border-white/[0.08]">
              {/* Super-header */}
              <div className={`${GR} bg-white/[0.06]`}>
                <div className="px-3 py-2" />
                <div className="col-span-2 py-2 text-center text-[9px] uppercase tracking-widest font-bold text-amber-400 border-l border-white/[0.08]">
                  Sold (6mo)
                </div>
                <div className="col-span-2 py-2 text-center text-[9px] uppercase tracking-widest font-bold text-sky-400 border-l border-white/[0.10]">
                  Listed
                </div>
              </div>
              {/* Condition sub-header */}
              <div className={`${GR} border-b-2 border-white/[0.10] bg-white/[0.03]`}>
                <div className="px-3 py-1.5" />
                <div className={cell('text-[9px] uppercase font-bold text-blue-300 py-1.5')}>New</div>
                <div className={cell('text-[9px] uppercase font-bold text-orange-300 py-1.5')}>Used</div>
                <div className={cell('text-[9px] uppercase font-bold text-blue-300 py-1.5')}>New</div>
                <div className={cell('text-[9px] uppercase font-bold text-orange-300 py-1.5')}>Used</div>
              </div>
              {/* Data rows */}
              <DataRow label="Lots" sN={nData?.soldTotalLots} sU={uData?.soldTotalLots} lN={nData?.stockTotalLots} lU={uData?.stockTotalLots} mono />
              <DataRow label="Total Qty" sN={nData?.soldQuantity} sU={uData?.soldQuantity} lN={nData?.stockQuantity} lU={uData?.stockQuantity} mono />
              <DataRow label="Min Price" sN={nData?.soldMinPrice} sU={uData?.soldMinPrice} lN={nData?.stockMinPrice} lU={uData?.stockMinPrice} />
              <DataRow bold label="Avg Price" sN={nData?.soldAvgPrice} sU={uData?.soldAvgPrice} lN={nData?.stockAvgPrice} lU={uData?.stockAvgPrice} />
              <DataRow label="Qty Avg Price" sN={nData?.soldQtyAvgPrice} sU={uData?.soldQtyAvgPrice} lN={nData?.stockQtyAvgPrice} lU={uData?.stockQtyAvgPrice} />
              <DataRow label="Max Price" sN={nData?.soldMaxPrice} sU={uData?.soldMaxPrice} lN={nData?.stockMaxPrice} lU={uData?.stockMaxPrice} />
              {/* ── My Price + Suggested — inline below price guide data ── */}
              {hasMyPrices && (() => {
                const nP = entry?.ourPriceNew; const uP = entry?.ourPriceUsed;
                const nQ = entry?.ourQtyNew;   const uQ = entry?.ourQtyUsed;
                const hasSomething = nP != null || uP != null || (nQ && nQ > 0) || (uQ && uQ > 0);
                if (!hasSomething) return null;
                return (
                  <div className={`${GR} border-b border-white/[0.04] bg-purple-950/20`}>
                    <div className="px-3 py-2 flex items-center gap-1.5 text-[11px] font-semibold text-purple-300">
                      <Target className="w-3 h-3 text-purple-400 shrink-0" />
                      <span>My Price</span>
                    </div>
                    <div className={cell('text-purple-200 font-semibold')}>
                      {nP != null ? `$${nP.toFixed(2)}` : '—'}
                      {nQ != null && nQ > 0 && <div className="text-[9px] text-gray-600 font-mono">{nScore != null ? `${nScore}×` : ''} ×{nQ}</div>}
                    </div>
                    <div className={cell('text-purple-200 font-semibold')}>
                      {uP != null ? `$${uP.toFixed(2)}` : '—'}
                      {uQ != null && uQ > 0 && <div className="text-[9px] text-gray-600 font-mono">{uScore != null ? `${uScore}×` : ''} ×{uQ}</div>}
                    </div>
                    <div className={cell('')} />
                    <div className={cell('')} />
                  </div>
                );
              })()}
              {hasSuggested && (
                <div className={`${GR} border-b border-white/[0.04] bg-emerald-950/20`}>
                  <div className="px-3 py-2 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
                    <Sparkles className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span>Suggested ({pct}%)</span>
                  </div>
                  <div className={cell('text-emerald-400 font-semibold')}>{nData?.suggestedPrice != null ? `$${Number(nData.suggestedPrice).toFixed(2)}` : '—'}</div>
                  <div className={cell('text-emerald-400 font-semibold')}>{uData?.suggestedPrice != null ? `$${Number(uData.suggestedPrice).toFixed(2)}` : '—'}</div>
                  <div className={cell('')} />
                  <div className={cell('')} />
                </div>
              )}
            </div>
          </div>
        );
      })()}
      {cachedAt && (
        <div className="px-4 pb-3 text-[9px] text-gray-700">
          Cached: {new Date(cachedAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

function PomPriceDialog({ target, onClose }: { target: { partNo: string; itemType: string; colorId: number | null; colorName: string; myQtyNew?: number; myPriceNew?: number | null; myQtyUsed?: number; myPriceUsed?: number | null }; onClose: () => void }) {
  const blType = target.itemType === 'MINIFIG' ? 'MINIFIG' : 'PART';
  const buildUrl = (cond: 'N' | 'U') => {
    const p = new URLSearchParams({ new_or_used: cond });
    if (target.colorId != null) p.set('color_id', String(target.colorId));
    return `/api/inventory/price-guide/${encodeURIComponent(target.partNo)}/${blType}?${p}`;
  };
  const { data: nData, isLoading: nLoading } = useQuery<any>({
    queryKey: ['pom-detail', target.partNo, blType, target.colorId, 'N'],
    queryFn: async () => { const r = await fetch(buildUrl('N'), { credentials: 'include' }); if (!r.ok) throw new Error('Failed'); return r.json(); },
    staleTime: 5 * 60 * 1000,
  });
  const { data: uData, isLoading: uLoading } = useQuery<any>({
    queryKey: ['pom-detail', target.partNo, blType, target.colorId, 'U'],
    queryFn: async () => { const r = await fetch(buildUrl('U'), { credentials: 'include' }); if (!r.ok) throw new Error('Failed'); return r.json(); },
    staleTime: 5 * 60 * 1000,
  });
  const cachedAt = nData?.fetchedAt ?? uData?.fetchedAt;
  const hasMyNew = (target.myQtyNew ?? 0) > 0 || target.myPriceNew != null;
  const hasMyUsed = (target.myQtyUsed ?? 0) > 0 || target.myPriceUsed != null;
  const hasMyInventory = hasMyNew || hasMyUsed;
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xs sm:max-w-sm bg-gray-900 border-gray-700 text-white">
        <div className="space-y-3">
          <div className="border-b border-gray-700 pb-2">
            <div className="text-sm font-bold text-white font-mono">{target.partNo}</div>
            {target.colorName && <div className="text-xs text-gray-400">{target.colorName}</div>}
          </div>
          {(nLoading || uLoading) ? (
            <div className="flex items-center justify-center py-8 gap-2 text-gray-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <PomConditionCol data={nData} label="New" />
              <PomConditionCol data={uData} label="Used" />
            </div>
          )}
          {hasMyInventory && (
            <div className="border-t border-gray-700 pt-2 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">My Prices</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-0.5">
                  <div className="app-label">New</div>
                  {hasMyNew ? (
                    <>
                      <div className="text-sm font-mono font-bold text-white">
                        {target.myPriceNew != null ? `$${target.myPriceNew.toFixed(2)}` : '—'}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        ×{target.myQtyNew ?? 0} in stock
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-gray-600">Not stocked</div>
                  )}
                </div>
                <div className="space-y-0.5">
                  <div className="app-label">Used</div>
                  {hasMyUsed ? (
                    <>
                      <div className="text-sm font-mono font-bold text-white">
                        {target.myPriceUsed != null ? `$${target.myPriceUsed.toFixed(2)}` : '—'}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        ×{target.myQtyUsed ?? 0} in stock
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-gray-600">Not stocked</div>
                  )}
                </div>
              </div>
            </div>
          )}
          {cachedAt && (
            <div className="text-[9px] text-gray-600 border-t border-gray-800 pt-1">
              Cached: {new Date(cachedAt).toLocaleDateString()}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const MINIFIG_PART_CATEGORY_IDS = new Set([
  20,   // Minifigure, Body Part
  142,  // Minifigure, Body Wear
  847,  // Minifigure, Hair
  238,  // Minifigure, Head
  606,  // Minifigure, Head, Modified
  16,   // Minifigure, Headgear
  636,  // Minifigure, Headgear Accessory
  484,  // Minifigure, Legs
  1098, // Minifigure, Legs, Decorated
  1116, // Minifigure, Legs, Modified
  1118, // Minifigure, Legs, Modified, Decorated
  418,  // Minifigure, Shield
  150,  // Minifigure, Torso
  485,  // Minifigure, Torso Assembly
  1097, // Minifigure, Torso Assembly, Decor.
  18,   // Minifigure, Utensil
  943,  // Minifigure, Utensil, Decorated
  19,   // Minifigure, Weapon
]);

interface BrickanalyzerToolProps {
  onItemClick?: (type: 'inventory', id: string, tab?: string) => void;
}

const BrickanalyzerTool = forwardRef(({ onItemClick }: BrickanalyzerToolProps, ref) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uiState, setUiState] = useState<UIState>("idle");
  const [scanId, setScanId] = useState<number | null>(null);
  const autoDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [leftPage, setLeftPage] = useState(false);
  const [baseline, setBaseline] = useState<ScanSettings>(loadBaseline);
  const [settings, setSettings] = useState<ScanSettings>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch {}
    return loadBaseline();
  });
  const [showSettings, setShowSettings] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  // Mutable copies of boxes/candidates that the user edits in the preview UI
  const [previewBoxes, setPreviewBoxes] = useState<{ x: number; y: number; w: number; h: number }[]>([]);
  const [previewCandidates, setPreviewCandidates] = useState<{ x: number; y: number; w: number; h: number }[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingSettings, setPendingSettings] = useState<Record<string, any> | null>(null);
  const [promotedUnknowns, setPromotedUnknowns] = useState<Set<number>>(new Set());
  const [detectingPoint, setDetectingPoint] = useState<{ x: number; y: number } | null>(null);
  const [drawingRect, setDrawingRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [scanMode, setScanMode] = useState<"auto" | "manual">(() => {
    try { return (localStorage.getItem(SCAN_MODE_KEY) as "auto" | "manual") || "auto"; } catch { return "auto"; }
  });

  function handleScanModeChange(mode: "auto" | "manual") {
    setScanMode(mode);
    try { localStorage.setItem(SCAN_MODE_KEY, mode); } catch {}
  }

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  }, [settings]);

  function handleSaveBaseline() {
    saveBaselineToStorage(settings);
    setBaseline({ ...settings });
    toast({ title: "Baseline saved", description: "Current settings saved as your new baseline." });
  }

  useImperativeHandle(ref, () => ({
    triggerCamera: () => {
      if (fileInputRef.current) {
        fileInputRef.current.accept = "image/*";
        (fileInputRef.current as any).capture = "environment";
        fileInputRef.current.click();
      }
    },
    triggerUpload: () => {
      if (fileInputRef.current) {
        fileInputRef.current.removeAttribute("capture");
        fileInputRef.current.accept = "image/*";
        fileInputRef.current.click();
      }
    },
    triggerFile: () => {
      if (fileInputRef.current) {
        fileInputRef.current.removeAttribute("capture");
        fileInputRef.current.accept = "*/*";
        fileInputRef.current.click();
      }
    },
  }));

  // On mount, check if there's an existing scan to restore (user left and came back)
  const { data: latestScan } = useQuery<BrickanalyzerScan | null>({
    queryKey: ["/api/brickanalyzer/scans/latest"],
    queryFn: async () => {
      const res = await fetch("/api/brickanalyzer/scans/latest", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 0,
  });

  useEffect(() => {
    if (!latestScan || scanId) return;
    // Only auto-restore complete or in-progress scans — don't drag up old failed scans
    if (latestScan.status === "complete") {
      setScanId(latestScan.id);
      setUiState("complete");
    } else if (latestScan.status === "processing") {
      setScanId(latestScan.id);
      setUiState("processing");
      setLeftPage(true);
    }
  }, [latestScan]);

  const { data: scan } = useQuery<BrickanalyzerScan>({
    queryKey: ["/api/brickanalyzer/scan", scanId],
    queryFn: async () => {
      const res = await fetch(`/api/brickanalyzer/scan/${scanId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch scan");
      return res.json();
    },
    // Run whenever we have a scanId (fetches results on restore too, not just during polling)
    enabled: !!scanId,
    // Poll every 3s while processing; single fetch once complete/failed
    refetchInterval: uiState === "processing" ? 3000 : false,
  });

  // Lightweight progress polling — 1 s interval during processing only
  type ScanProgressData = { step: string; detail: string; pct: number; startedAt: number | null; stepAt: number | null; now: number; active: boolean };
  const { data: scanProgress } = useQuery<ScanProgressData>({
    queryKey: ["/api/brickanalyzer/scan", scanId, "progress"],
    queryFn: async () => {
      const res = await fetch(`/api/brickanalyzer/scan/${scanId}/progress`, { credentials: "include" });
      if (!res.ok) throw new Error("progress fetch failed");
      return res.json();
    },
    enabled: !!scanId && uiState === "processing",
    refetchInterval: uiState === "processing" ? 1000 : false,
  });

  // Step-history log — accumulate completed steps with their durations
  type StepHistoryEntry = { step: string; detail: string; elapsedS: string };
  const [stepHistory, setStepHistory] = useState<StepHistoryEntry[]>([]);
  const prevStepRef = useRef<string>('');
  const prevStepAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!scanProgress?.active) return;
    const current = scanProgress.step;
    const currentStepAt = scanProgress.stepAt;
    if (current !== prevStepRef.current && prevStepRef.current) {
      const elapsed = prevStepAtRef.current && currentStepAt
        ? ((currentStepAt - prevStepAtRef.current) / 1000).toFixed(1)
        : '…';
      setStepHistory(h => [...h, { step: prevStepRef.current, detail: '', elapsedS: elapsed }]);
    }
    if (current !== prevStepRef.current) {
      prevStepRef.current = current;
      prevStepAtRef.current = currentStepAt ?? null;
    }
  }, [scanProgress?.step, scanProgress?.stepAt, scanProgress?.active]);

  // Reset history when a new scan starts
  useEffect(() => {
    if (uiState === 'processing') {
      setStepHistory([]);
      prevStepRef.current = '';
      prevStepAtRef.current = null;
    }
  }, [uiState, scanId]);

  // Live tick for elapsed timer
  const [tickNow, setTickNow] = useState(Date.now());
  useEffect(() => {
    if (uiState !== 'processing') return;
    const t = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [uiState]);

  // BrickLink API call limit — poll every 5 min so banner stays current without hammering
  const { data: blRateLimit } = useQuery<{ allowed: boolean; blocked: boolean; callsLast24h: number; oldestCallTime: string | null; warning?: string }>({
    queryKey: ["/api/bricklink/rate-limit"],
    queryFn: async () => {
      const res = await fetch("/api/bricklink/rate-limit", { credentials: "include" });
      if (!res.ok) return { allowed: true, blocked: false, callsLast24h: 0, oldestCallTime: null };
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: pythonStatus } = useQuery<{ ready: boolean }>({
    queryKey: ["/api/brickspotter/python-status"],
    queryFn: async () => {
      const res = await fetch("/api/brickspotter/python-status", { credentials: "include" });
      if (!res.ok) return { ready: false };
      return res.json();
    },
    // Poll every 3 s while not ready; once ready, check once a minute (service can restart)
    refetchInterval: (query) => (query.state.data?.ready ? 60_000 : 3_000),
    staleTime: 0,
  });
  const pythonReady = pythonStatus?.ready ?? false;

  // Transition out of "processing" via useEffect — safe, outside render
  useEffect(() => {
    if (!scan) return;
    if (scan.status === "complete" && uiState === "processing") {
      setUiState("complete");
      queryClient.invalidateQueries({ queryKey: ["/api/brickanalyzer/scans/latest"] });
    } else if (scan.status === "failed" && uiState === "processing") {
      setUiState("failed");
      queryClient.invalidateQueries({ queryKey: ["/api/brickanalyzer/scans/latest"] });
    }
  }, [scan?.status]);

  const dismissMutation = useMutation({
    mutationFn: async () => {
      if (!scanId) return;
      await fetch(`/api/brickanalyzer/scan/${scanId}`, {
        method: "DELETE",
        credentials: "include",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brickanalyzer/scans/latest"] });
      setScanId(null);
      setUiState("idle");
      setLeftPage(false);
      setDismissedItems(new Set());
      setFocusedDetailCropIndex(null);
    },
  });

  // Retry a failed scan using the server-cached image (no re-upload needed if cache is warm).
  // Falls back to prompting a new upload if the server was restarted since the failure.
  const retryMutation = useMutation({
    mutationFn: async () => {
      if (!scanId) throw new Error("No scan to retry");
      const res = await fetch(`/api/brickanalyzer/scan/${scanId}/retry`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 410) {
          // Image evicted from cache — need fresh upload
          return { needsReupload: true };
        }
        throw new Error(data.error || "Retry failed");
      }
      return data;
    },
    onSuccess: (data: any) => {
      if (data?.needsReupload) {
        toast({
          title: "Image no longer available",
          description: "The server was restarted since this scan failed. Please upload the image again.",
          variant: "destructive",
        });
        setScanId(null);
        setUiState("idle");
        return;
      }
      // Retry started — switch back to processing state and poll
      setUiState("processing");
      queryClient.invalidateQueries({ queryKey: ["/api/brickanalyzer/scans/latest"] });
    },
    onError: (err: any) => {
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
    },
  });

  // Swipe-dismiss: remove one result card from the visible list.
  function swipeDismissItem(verdictKey: string) {
    setDismissedItems(prev => { const n = new Set(prev); n.add(verdictKey); return n; });
  }

  // Per-card swipe tracking (only one card swiped at a time)
  const swipeRef = useRef<{ key: string; startX: number; currentX: number } | null>(null);
  const [swipingCard, setSwipingCard] = useState<{ key: string; offset: number } | null>(null);

  function handleCardTouchStart(key: string, clientX: number) {
    swipeRef.current = { key, startX: clientX, currentX: clientX };
  }
  function handleCardTouchMove(key: string, clientX: number) {
    if (!swipeRef.current || swipeRef.current.key !== key) return;
    swipeRef.current.currentX = clientX;
    const offset = Math.max(0, clientX - swipeRef.current.startX);
    if (offset > 8) setSwipingCard({ key, offset });
  }
  function handleCardTouchEnd(key: string) {
    if (!swipeRef.current || swipeRef.current.key !== key) return;
    const offset = Math.max(0, swipeRef.current.currentX - swipeRef.current.startX);
    swipeRef.current = null;
    setSwipingCard(null);
    if (offset > 100) swipeDismissItem(key);
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image file.", variant: "destructive" });
      return;
    }
    setUiState("uploading");
    setLeftPage(false);

    // Auto mode always uses 3-pass; manual uses user's single-pass settings
    const effectiveSettings = scanMode === "auto"
      ? { ...settings, multiPass: true }
      : { ...settings, multiPass: false };

    // Run segmentation preview first — show detected zones before committing to Brickognize
    const previewForm = new FormData();
    previewForm.append("image", file);
    previewForm.append("settings", JSON.stringify(effectiveSettings));
    if (calibrateMode) previewForm.append("calibration", "true");
    try {
      const res = await fetch("/api/brickanalyzer/segment", {
        method: "POST",
        credentials: "include",
        body: previewForm,
      });
      if (!res.ok) throw new Error("Segmentation failed");
      const { boxes, candidates = [], imageWidth, imageHeight } = await res.json();
      const objectUrl = URL.createObjectURL(file);
      if (previewData?.objectUrl) URL.revokeObjectURL(previewData.objectUrl);
      setPreviewData({ boxes, candidates, imageWidth, imageHeight, objectUrl });
      setPreviewBoxes(boxes);
      setPreviewCandidates(candidates);
      setPendingFile(file);
      setPendingSettings(effectiveSettings);
      setUiState("previewing");
    } catch {
      // If segmentation fails, fall through to full scan directly
      await startFullScan(file, effectiveSettings);
    }
  }

  async function startFullScan(file: File, effectiveSettings: Record<string, any>, approvedBoxes?: { x: number; y: number; w: number; h: number }[]) {
    setUiState("uploading");
    const formData = new FormData();
    formData.append("image", file);
    formData.append("settings", JSON.stringify(effectiveSettings));
    if (calibrateMode) formData.append("calibration", "true");
    // Pass the user-approved boxes so the server skips re-segmentation
    if (approvedBoxes && approvedBoxes.length > 0) {
      formData.append("previewBoxes", JSON.stringify(approvedBoxes));
    }
    try {
      const res = await fetch("/api/brickanalyzer/scan", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { scanId: id } = await res.json();
      setScanId(id);
      setUiState("processing");
    } catch {
      setUiState("failed");
      toast({ title: "Upload failed", description: "Couldn't start the scan. Try again.", variant: "destructive" });
    }
  }

  function handleConfirmScan() {
    if (!pendingFile || !pendingSettings) return;
    const approvedBoxes = previewBoxes.length > 0 ? previewBoxes : previewData?.boxes;
    if (previewData?.objectUrl) URL.revokeObjectURL(previewData.objectUrl);
    setPromotedUnknowns(new Set());
    setPreviewData(null);
    setPreviewBoxes([]);
    setPreviewCandidates([]);
    // Pass approved boxes so the server uses them exactly — no re-segmentation
    startFullScan(pendingFile, pendingSettings, approvedBoxes);
  }

  function handleCancelPreview() {
    if (previewData?.objectUrl) URL.revokeObjectURL(previewData.objectUrl);
    setPreviewData(null);
    setPreviewBoxes([]);
    setPreviewCandidates([]);
    setPendingFile(null);
    setPendingSettings(null);
    setUiState("idle");
  }

  // IoU helper for candidate filtering after promotion
  function iouPct(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
    const ix0 = Math.max(a.x, b.x), iy0 = Math.max(a.y, b.y);
    const ix1 = Math.min(a.x + a.w, b.x + b.w), iy1 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
    if (inter === 0) return 0;
    return inter / (a.w * a.h + b.w * b.h - inter);
  }

  function handlePromoteCandidate(idx: number) {
    const promoted = previewCandidates[idx];
    const newBoxes = [...previewBoxes, promoted];
    // Re-filter remaining candidates: drop any that now overlap the promoted box
    const newCandidates = previewCandidates
      .filter((_, i) => i !== idx)
      .filter(c => !newBoxes.some(b => iouPct(c, b) > 0.10));
    setPreviewBoxes(newBoxes);
    setPreviewCandidates(newCandidates);
  }

  function handleRemoveBox(idx: number) {
    const removed = previewBoxes[idx];
    const newBoxes = previewBoxes.filter((_, i) => i !== idx);
    // Re-instate any candidates that are no longer blocked by remaining boxes
    const reinstated = (previewData?.candidates ?? []).filter(
      c => !newBoxes.some(b => iouPct(c, b) > 0.10) &&
           !previewCandidates.some(pc => iouPct(pc, c) > 0.20) &&
           iouPct(c, removed) > 0.10
    );
    setPreviewBoxes(newBoxes);
    setPreviewCandidates([...previewCandidates, ...reinstated]);
  }

  // Tap on image to promote the nearest candidate, or detect+create a new zone at the tap point.
  async function handleImageTap(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const tapX = ((e.clientX - rect.left) / rect.width) * 100;
    const tapY = ((e.clientY - rect.top) / rect.height) * 100;

    // 1. Check if tap lands inside an existing confirmed box — do nothing (user was clicking it)
    const hitConfirmed = previewBoxes.some(
      b => tapX >= b.x && tapX <= b.x + b.w && tapY >= b.y && tapY <= b.y + b.h
    );
    if (hitConfirmed) return;

    // 2. Find candidate whose box contains the tap point
    if (previewCandidates.length > 0) {
      const containingIdx = previewCandidates.findIndex(
        c => tapX >= c.x && tapX <= c.x + c.w && tapY >= c.y && tapY <= c.y + c.h
      );
      if (containingIdx !== -1) {
        handlePromoteCandidate(containingIdx);
        return;
      }
      // Find nearest candidate center within 15%
      let nearestIdx = -1;
      let nearestDist = Infinity;
      previewCandidates.forEach((c, i) => {
        const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
        const d = Math.hypot(tapX - cx, tapY - cy);
        if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
      });
      if (nearestIdx !== -1 && nearestDist < 15) {
        handlePromoteCandidate(nearestIdx);
        return;
      }
    }

    // 3. No candidate hit — ask the server to detect a contour at the tap point.
    //    Falls back to a 16%×16% fixed box if detection fails or returns nothing.
    setDetectingPoint({ x: tapX, y: tapY });
    let detectedBox: { x: number; y: number; w: number; h: number } | null = null;
    try {
      if (pendingFile) {
        const form = new FormData();
        form.append("image", pendingFile);
        form.append("tapX", tapX.toString());
        form.append("tapY", tapY.toString());
        const resp = await fetch("/api/brickanalyzer/detect-at-point", {
          method: "POST", credentials: "include", body: form,
        });
        const data = await resp.json();
        detectedBox = data.box ?? null;
      }
    } catch {}
    setDetectingPoint(null);
    if (detectedBox) {
      setPreviewBoxes(prev => [...prev, detectedBox!]);
    } else {
      // Fallback: fixed 16%×16% box
      const size = 16;
      setPreviewBoxes(prev => [...prev, {
        x: Math.min(Math.max(tapX - size / 2, 0), 100 - size),
        y: Math.min(Math.max(tapY - size / 2, 0), 100 - size),
        w: size, h: size,
      }]);
    }
  }

  // ── Draw-to-segment pointer handlers ─────────────────────────────────────
  function getPointerPct(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(Math.max(((e.clientX - rect.left) / rect.width) * 100, 0), 100),
      y: Math.min(Math.max(((e.clientY - rect.top) / rect.height) * 100, 0), 100),
    };
  }

  function handlePreviewPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const pct = getPointerPct(e);
    dragStartRef.current = pct;
    setDrawingRect(null);
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }

  function handlePreviewPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;
    const pct = getPointerPct(e);
    const x = Math.min(dragStartRef.current.x, pct.x);
    const y = Math.min(dragStartRef.current.y, pct.y);
    const w = Math.abs(pct.x - dragStartRef.current.x);
    const h = Math.abs(pct.y - dragStartRef.current.y);
    if (w > 1 || h > 1) {
      setDrawingRect({ x, y, w, h });
    }
  }

  async function handlePreviewPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    dragStartRef.current = null;

    const pct = getPointerPct(e);
    const dx = Math.abs(pct.x - (start?.x ?? pct.x));
    const dy = Math.abs(pct.y - (start?.y ?? pct.y));
    const isDrag = dx > 2 || dy > 2;
    setDrawingRect(null);

    if (isDrag && start) {
      const MIN_SIZE = 4;
      const rx = Math.min(start.x, pct.x);
      const ry = Math.min(start.y, pct.y);
      const rw = Math.abs(pct.x - start.x);
      const rh = Math.abs(pct.y - start.y);
      const finalRect = {
        x: Math.max(0, rx),
        y: Math.max(0, ry),
        w: Math.max(MIN_SIZE, Math.min(rw, 100 - rx)),
        h: Math.max(MIN_SIZE, Math.min(rh, 100 - ry)),
      };
      setPreviewBoxes(prev => [...prev, finalRect]);
    } else if (!isDrag && start) {
      const syntheticX = start.x;
      const syntheticY = start.y;
      const hitConfirmed = previewBoxes.some(
        b => syntheticX >= b.x && syntheticX <= b.x + b.w && syntheticY >= b.y && syntheticY <= b.y + b.h
      );
      if (hitConfirmed) return;
      if (previewCandidates.length > 0) {
        const containingIdx = previewCandidates.findIndex(
          c => syntheticX >= c.x && syntheticX <= c.x + c.w && syntheticY >= c.y && syntheticY <= c.y + c.h
        );
        if (containingIdx !== -1) { handlePromoteCandidate(containingIdx); return; }
        let nearestIdx = -1, nearestDist = Infinity;
        previewCandidates.forEach((c, i) => {
          const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
          const d = Math.hypot(syntheticX - cx, syntheticY - cy);
          if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
        });
        if (nearestIdx !== -1 && nearestDist < 15) { handlePromoteCandidate(nearestIdx); return; }
      }
      setDetectingPoint({ x: syntheticX, y: syntheticY });
      let detectedBox: { x: number; y: number; w: number; h: number } | null = null;
      try {
        if (pendingFile) {
          const form = new FormData();
          form.append("image", pendingFile);
          form.append("tapX", syntheticX.toString());
          form.append("tapY", syntheticY.toString());
          const resp = await fetch("/api/brickanalyzer/detect-at-point", {
            method: "POST", credentials: "include", body: form,
          });
          const data = await resp.json();
          detectedBox = data.box ?? null;
        }
      } catch {}
      setDetectingPoint(null);
      if (detectedBox) {
        setPreviewBoxes(prev => [...prev, detectedBox!]);
      } else {
        const size = 16;
        setPreviewBoxes(prev => [...prev, {
          x: Math.min(Math.max(syntheticX - size / 2, 0), 100 - size),
          y: Math.min(Math.max(syntheticY - size / 2, 0), 100 - size),
          w: size, h: size,
        }]);
      }
    }
  }

  // ── Calibration mode state ────────────────────────────────────────────────
  const [calibrateMode, setCalibrateMode] = useState(false);
  const [calibrateRound, setCalibrateRound] = useState<1 | 2 | 3 | 4>(1);
  const [showScorecard, setShowScorecard] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<string, 'correct' | 'close' | 'wrong'>>(() => {
    try { const s = localStorage.getItem(CALIBRATION_KEY); return s ? JSON.parse(s).verdicts ?? {} : {}; } catch { return {}; }
  });
  const [calibrationLog, setCalibrationLog] = useState<CalibrationEntry[]>(() => {
    try { const s = localStorage.getItem(CALIBRATION_KEY); return s ? JSON.parse(s).log ?? [] : []; } catch { return []; }
  });
  const [confirmedClips, setConfirmedClips] = useState<Set<string>>(new Set());
  const [confirmingClip, setConfirmingClip] = useState<string | null>(null);
  // colorCorrectedClips: clipKey → { colorId, colorName } picked by SME
  const [colorCorrectedClips, setColorCorrectedClips] = useState<Map<string, { colorId: number; colorName: string }>>(new Map());
  // pendingClipConfirm: staged item awaiting user confirmation before CLIP training
  const [pendingClipConfirm, setPendingClipConfirm] = useState<{
    partNo: string; partName: string; confidence: string;
    colorId: number | null; colorName: string | null; colorRgb: string | null;
    cropIndex: number; itemType: string;
  } | null>(null);
  // dismissedItems: keys of items already scored — hidden from list but scan not yet deleted
  const [dismissedItems, setDismissedItems] = useState<Set<string>>(new Set());
  // Per-card expanded sub-tab: 'matches' | 'inventory'
  const [expandedCardTab, setExpandedCardTab] = useState<Record<string, 'matches' | 'inventory'>>({});
  // Focused crop index for heatmap dialog — highlights one box when opening from card header
  const [heatmapCropFocus, setHeatmapCropFocus] = useState<number | null>(null);
  // Heatmap price toggles — defaults overridden by saved user preferences once loaded
  const [heatmapCondition, setHeatmapCondition] = useState<'new' | 'used'>('new');
  const [heatmapSource, setHeatmapSource] = useState<'peak' | 'sold' | 'listed'>('peak');
  const [heatmapMetric, setHeatmapMetric] = useState<'max' | 'avg'>('max');
  const heatmapPrefsInitialized = useRef(false);
  const heatmapSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load saved preferences from user profile
  const { data: authUser } = useQuery<{ heatmapCondition?: string; heatmapSource?: string; heatmapMetric?: string }>({
    queryKey: ['/api/auth/user'],
    staleTime: Infinity,
  });
  useEffect(() => {
    if (!authUser || heatmapPrefsInitialized.current) return;
    heatmapPrefsInitialized.current = true;
    if (authUser.heatmapCondition === 'new' || authUser.heatmapCondition === 'used') setHeatmapCondition(authUser.heatmapCondition);
    if (authUser.heatmapMetric === 'max' || authUser.heatmapMetric === 'avg') setHeatmapMetric(authUser.heatmapMetric);
  }, [authUser]);

  // Auto-save heatmap preferences (debounced 800ms)
  useEffect(() => {
    if (!heatmapPrefsInitialized.current) return;
    if (heatmapSaveTimer.current) clearTimeout(heatmapSaveTimer.current);
    heatmapSaveTimer.current = setTimeout(() => {
      fetch('/api/auth/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ heatmapCondition, heatmapSource, heatmapMetric }),
      }).catch(() => {});
    }, 800);
    return () => { if (heatmapSaveTimer.current) clearTimeout(heatmapSaveTimer.current); };
  }, [heatmapCondition, heatmapSource, heatmapMetric]);
  // Focused detail view — when set, shows crop image + single card instead of full list
  const [focusedDetailCropIndex, setFocusedDetailCropIndex] = useState<number | null>(null);
  // POM price popup target
  const [pricePopupTarget, setPricePopupTarget] = useState<{ partNo: string; itemType: string; colorId: number | null; colorName: string; myQtyNew?: number; myPriceNew?: number | null; myQtyUsed?: number; myPriceUsed?: number | null } | null>(null);
  // Ref keeps a synchronous count of total groups so handlers can check "all done" without stale closure
  const groupCountRef = useRef(0);

  useEffect(() => {
    try { localStorage.setItem(CALIBRATION_KEY, JSON.stringify({ verdicts, log: calibrationLog })); } catch {}
  }, [verdicts, calibrationLog]);

  // ── Color-diff helpers (CIE76 ΔE, same algorithm as server/routes.ts) ──────
  function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return null;
    return { r: parseInt(clean.slice(0, 2), 16), g: parseInt(clean.slice(2, 4), 16), b: parseInt(clean.slice(4, 6), 16) };
  }
  function rgbToLab(r: number, g: number, b: number): [number, number, number] {
    const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const rl = lin(r), gl = lin(g), bl = lin(b);
    const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
    const y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750) / 1.00000;
    const z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883;
    const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  }
  function colorDeltaE(hex1: string, hex2: string): number {
    const c1 = hexToRgb(hex1); const c2 = hexToRgb(hex2);
    if (!c1 || !c2) return 999;
    const [L1, a1, b1] = rgbToLab(c1.r, c1.g, c1.b);
    const [L2, a2, b2] = rgbToLab(c2.r, c2.g, c2.b);
    return Math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
  }

  // Convert Delta-E to a 0-100 color confidence %.
  // ΔE 0 = perfect match (100%), ΔE 40 = completely different (0%).
  // Cutoff: anything below 15% (ΔE > 34) is filtered from the color list.
  const COLOR_CONF_CUTOFF = 15;
  function colorConfPct(dE: number): number {
    return Math.round(Math.max(0, 100 - dE * 2.5));
  }
  function colorConfLabel(pct: number): { label: string; cls: string } {
    if (pct >= 80) return { label: 'High', cls: 'text-emerald-400' };
    if (pct >= 60) return { label: 'Good', cls: 'text-yellow-400' };
    if (pct >= 40) return { label: 'Fair', cls: 'text-orange-400' };
    return { label: 'Low', cls: 'text-gray-500' };
  }

  async function handleColorCorrection(partNo: string, partName: string, confidence: string, correctedColorId: number, correctedColorName: string, cropIndex: number | null, itemType: string) {
    const key = `${partNo}__${cropIndex ?? 'x'}`;
    // Immediate feedback so the user sees which color was recorded before the card auto-dismisses
    toast({ title: `Color: ${correctedColorName}`, description: `${partNo} — training CLIP…` });
    // Record the SME's corrected color choice
    setColorCorrectedClips(prev => new Map(prev).set(key, { colorId: correctedColorId, colorName: correctedColorName }));
    // Color found + selected → upgrade verdict to correct (right part, color now confirmed)
    handleVerdict(partNo, partName, confidence, cropIndex, 'correct');
    // Train CLIP with the corrected colorId
    await handleConfirmToClip(partNo, partName, confidence, correctedColorId, cropIndex, itemType);
  }

  function handleVerdict(partNo: string, partName: string, confidence: string, cropIndex: number | null, verdict: 'correct' | 'close' | 'wrong') {
    const key = `${partNo}__${cropIndex ?? 'x'}`;
    setVerdicts(v => ({ ...v, [key]: verdict }));
    if (scanId) {
      setCalibrationLog(log => [...log, {
        timestamp: Date.now(), round: calibrateRound, scanId,
        partNo, partName, confidence, cropIndex, verdict,
      }]);
    }
  }

  async function handleConfirmToClip(partNo: string, partName: string, confidence: string, colorId: number | null, cropIndex: number | null, itemType: string) {
    if (!scanId || cropIndex == null) return;
    const key = `${partNo}__${cropIndex}`;
    // Auto-record correct verdict if not already set
    const vKey = `${partNo}__${cropIndex ?? 'x'}`;
    if (!verdicts[vKey]) {
      handleVerdict(partNo, partName, confidence, cropIndex, 'correct');
    }
    setConfirmingClip(key);
    try {
      const res = await fetch('/api/brickspotter/confirm-embedding', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId, cropIndex, itemNo: partNo, colorId, itemType }),
      });
      if (!res.ok) throw new Error('failed');
      setConfirmedClips(prev => new Set([...prev, key]));
      toast({ title: 'Added to CLIP catalog', description: `${partNo} saved as a visual reference.` });
    } catch {
      toast({ title: 'Failed to confirm', variant: 'destructive' });
    } finally {
      setConfirmingClip(null);
    }
  }

  function resetCalibration() {
    setVerdicts({});
    setCalibrationLog([]);
    setConfirmedClips(new Set());
    try { localStorage.removeItem(CALIBRATION_KEY); } catch {}
    toast({ title: 'Calibration reset', description: 'All scores cleared. Start fresh.' });
  }

  // Calibration scorecard computed stats
  const calibStats = useMemo(() => {
    const total = calibrationLog.length;
    const correct = calibrationLog.filter(e => e.verdict === 'correct').length;
    const close   = calibrationLog.filter(e => e.verdict === 'close').length;
    const wrong   = calibrationLog.filter(e => e.verdict === 'wrong').length;
    const byRound = [1, 2, 3, 4].map(r => {
      const entries = calibrationLog.filter(e => e.round === r);
      return {
        round: r as 1|2|3|4,
        total: entries.length,
        correct: entries.filter(e => e.verdict === 'correct').length,
        close: entries.filter(e => e.verdict === 'close').length,
        wrong: entries.filter(e => e.verdict === 'wrong').length,
      };
    });
    const byConf = (['high', 'medium', 'low'] as const).map(c => {
      const entries = calibrationLog.filter(e => e.confidence === c);
      return {
        conf: c,
        total: entries.length,
        correct: entries.filter(e => e.verdict === 'correct').length,
      };
    });
    return { total, correct, close, wrong, byRound, byConf };
  }, [calibrationLog]);

  // ── Standard results state ────────────────────────────────────────────────
  const [expandedParts, setExpandedParts] = useState<Set<string>>(new Set());
  const [showCrops, setShowCrops] = useState(false);
  const [resultsListExpanded, setResultsListExpanded] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);
  const [scanZoom, setScanZoom] = useState(1);
  const [scanPan, setScanPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [pinchDist, setPinchDist] = useState<number | null>(null);
  const [highlightedResult, setHighlightedResult] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanContainerRef = useRef<HTMLDivElement>(null);

  // Overlay catalog image zoom state
  const [overlayZoom, setOverlayZoom] = useState(1);
  const [overlayPan, setOverlayPan] = useState({ x: 0, y: 0 });
  const [overlayDragging, setOverlayDragging] = useState(false);
  const [overlayTab, setOverlayTab] = useState<'matches' | 'pricing' | 'inventory'>('pricing');
  const [overlayCalibration, setOverlayCalibration] = useState<Record<number, 'correct' | 'close' | 'wrong'>>({});
  const [overlayCalibrationColorIdx, setOverlayCalibrationColorIdx] = useState<Record<number, number>>({});
  const [overlayDragStart, setOverlayDragStart] = useState({ x: 0, y: 0 });
  const [overlayPinchDist, setOverlayPinchDist] = useState<number | null>(null);
  useEffect(() => { setOverlayZoom(1); setOverlayPan({ x: 0, y: 0 }); setOverlayTab('pricing'); setOverlayCalibration({}); setOverlayCalibrationColorIdx({}); }, [focusedDetailCropIndex]);
  function handleOverlayWheel(e: React.WheelEvent) {
    e.preventDefault();
    setOverlayZoom(prev => { const next = Math.min(8, Math.max(1, prev - e.deltaY * 0.003)); if (next === 1) setOverlayPan({ x: 0, y: 0 }); return next; });
  }
  function handleOverlayMouseDown(e: React.MouseEvent) { if (overlayZoom <= 1) return; e.preventDefault(); setOverlayDragging(true); setOverlayDragStart({ x: e.clientX - overlayPan.x, y: e.clientY - overlayPan.y }); }
  function handleOverlayMouseMove(e: React.MouseEvent) { if (!overlayDragging) return; setOverlayPan({ x: e.clientX - overlayDragStart.x, y: e.clientY - overlayDragStart.y }); }
  function handleOverlayMouseUp() { setOverlayDragging(false); }
  function handleOverlayTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      setOverlayPinchDist(Math.sqrt(dx * dx + dy * dy));
      setOverlayDragging(false);
    } else if (e.touches.length === 1 && overlayZoom > 1) {
      setOverlayDragging(true);
      setOverlayDragStart({ x: e.touches[0].clientX - overlayPan.x, y: e.touches[0].clientY - overlayPan.y });
    }
  }
  function handleOverlayTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && overlayPinchDist != null) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const newDist = Math.sqrt(dx * dx + dy * dy);
      setOverlayZoom(prev => Math.min(8, Math.max(1, prev * (newDist / overlayPinchDist))));
      setOverlayPinchDist(newDist);
    } else if (e.touches.length === 1 && overlayDragging) {
      setOverlayPan({ x: e.touches[0].clientX - overlayDragStart.x, y: e.touches[0].clientY - overlayDragStart.y });
    }
  }
  function handleOverlayTouchEnd() { setOverlayPinchDist(null); setOverlayDragging(false); }

  function resetScanZoom() { setScanZoom(1); setScanPan({ x: 0, y: 0 }); }
  function flashResult(id: string) {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightedResult(id);
    highlightTimerRef.current = setTimeout(() => setHighlightedResult(null), 2500);
  }
  function handleScanWheel(e: React.WheelEvent) {
    e.preventDefault();
    setScanZoom(prev => { const next = Math.min(8, Math.max(1, prev - e.deltaY * 0.003)); if (next === 1) setScanPan({ x: 0, y: 0 }); return next; });
  }
  function handleScanMouseDown(e: React.MouseEvent) { if (scanZoom <= 1) return; e.preventDefault(); setIsDragging(true); setDragStart({ x: e.clientX - scanPan.x, y: e.clientY - scanPan.y }); }
  function handleScanMouseMove(e: React.MouseEvent) { if (!isDragging) return; setScanPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); }
  function handleScanMouseUp() { setIsDragging(false); }
  function handleScanTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      setPinchDist(Math.sqrt(dx * dx + dy * dy));
      setIsDragging(false);
    } else if (e.touches.length === 1 && scanZoom > 1) {
      setIsDragging(true);
      setDragStart({ x: e.touches[0].clientX - scanPan.x, y: e.touches[0].clientY - scanPan.y });
    }
  }
  function handleScanTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinchDist != null) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const newDist = Math.sqrt(dx * dx + dy * dy);
      const ratio = newDist / pinchDist;
      setScanZoom(prev => Math.min(8, Math.max(1, prev * ratio)));
      setPinchDist(newDist);
    } else if (e.touches.length === 1 && isDragging) {
      setScanPan({ x: e.touches[0].clientX - dragStart.x, y: e.touches[0].clientY - dragStart.y });
    }
  }
  function handleScanTouchEnd() { setPinchDist(null); setIsDragging(false); }

  const activeScan = scan ?? latestScan ?? null;
  const allScanResults: ScanResult[] = useMemo(() => {
    if (uiState !== "complete" || !activeScan?.results) return [];
    const rank = (c: string) => c === 'high' ? 3 : c === 'medium' ? 2 : 1;
    return [...(activeScan.results as ScanResult[])].sort((a, b) => {
      const cs = rank(b.confidence) - rank(a.confidence);
      if (cs !== 0) return cs;
      const ap = Math.max(a.marketSoldMaxNew ?? 0, a.marketSoldMaxUsed ?? 0, a.stockAvgPriceN ?? 0);
      const bp = Math.max(b.marketSoldMaxNew ?? 0, b.marketSoldMaxUsed ?? 0, b.stockAvgPriceN ?? 0);
      return bp - ap;
    });
  }, [activeScan?.results, uiState]);
  // Identified results: show in main list. Unknown results: hidden by default, shown as
  // teal tappable overlays on the image (user taps to promote into the visible list).
  const results: ScanResult[] = useMemo(
    () => allScanResults.filter(r => r.partNo !== '' || promotedUnknowns.has(r.cropIndex ?? -1)),
    [allScanResults, promotedUnknowns]
  );
  const unknownOverlays: ScanResult[] = useMemo(
    () => allScanResults.filter(r => r.partNo === '' && r.bboxX != null && !promotedUnknowns.has(r.cropIndex ?? -1)),
    [allScanResults, promotedUnknowns]
  );
  const totalValue = results.reduce((s, p) => s + (Math.max(p.marketSoldMaxNew ?? 0, p.marketSoldMaxUsed ?? 0, p.stockAvgPriceN ?? 0) || p.ourPriceNew || p.ourPriceUsed || 0), 0);
  const inStockCount = results.filter(p => p.ourQtyNew > 0 || p.ourQtyUsed > 0).length;
  const withPriceCount = results.filter(p => p.ourPriceNew !== null || p.ourPriceUsed !== null || p.marketSoldMaxNew !== null || p.stockAvgPriceN != null).length;

  // Group results by partNo — preserves sort order of first occurrence
  const groupedResults = useMemo(() => {
    const map = new Map<string, { partNo: string; partName: string; itemType: 'PART' | 'MINIFIG'; thumbnailUrl: string | null; entries: ScanResult[] }>();
    for (const r of results) {
      const key = r.partNo || `__unknown_${r.partName}`;
      if (!map.has(key)) {
        map.set(key, { partNo: r.partNo, partName: r.partName, itemType: r.itemType || 'PART', thumbnailUrl: r.thumbnailUrl, entries: [] });
      }
      const grp = map.get(key)!;
      grp.entries.push(r);
      if (!grp.thumbnailUrl && r.thumbnailUrl) grp.thumbnailUrl = r.thumbnailUrl;
      if (r.itemType === 'MINIFIG') grp.itemType = 'MINIFIG'; // propagate if any entry is a minifig
    }
    return Array.from(map.values());
  }, [results]);
  // Keep ref in sync so scoring handlers can synchronously check "all done"
  groupCountRef.current = groupedResults.length;

  // Auto-expand all groups the moment results arrive so "Best Match" is visible immediately
  useEffect(() => {
    if (groupedResults.length > 0) {
      setExpandedParts(new Set(groupedResults.map((g, i) => g.partNo || `__unknown_${i}`)));
    }
  }, [groupedResults.length]);

  function togglePart(partNo: string) {
    setExpandedParts(prev => {
      const next = new Set(prev);
      if (next.has(partNo)) next.delete(partNo); else next.add(partNo);
      return next;
    });
  }

  function confidenceColor(c: string) {
    if (c === "high") return "text-green-400";
    if (c === "medium") return "text-yellow-400";
    return "text-gray-400";
  }

  // Compute reset time: oldest BL call in the 24h window rolls off after 24h
  const blResetTime = blRateLimit?.oldestCallTime
    ? new Date(new Date(blRateLimit.oldestCallTime).getTime() + 24 * 60 * 60 * 1000)
    : null;
  const blResetStr = blResetTime
    ? blResetTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="space-y-4 sm:space-y-12 p-1 sm:p-6">


      {/* ── Python AI service not ready ──────────────────────────────────── */}
      {!pythonReady && (
        <div className="flex items-start gap-2.5 bg-amber-950/50 border border-amber-500/40 rounded-lg px-3 sm:px-10 py-2.5 sm:py-7">
          <div className="shrink-0 mt-0.5">
            <div className="w-3.5 h-3.5 sm:w-7 sm:h-7 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
          </div>
          <div className="space-y-0.5 min-w-0">
            <p className="text-xs sm:text-2xl font-semibold text-amber-300">AI engine starting up</p>
            <p className="text-xs sm:text-xl text-amber-400/80 leading-relaxed">
              Photos sent now will go to Brickognize only — contour detection and CLIP visual matching aren't available yet. Usually ready in 15–30 seconds.
            </p>
          </div>
        </div>
      )}

      {/* ── BrickLink API limit warning ──────────────────────────────────── */}
      {blRateLimit?.blocked && (
        <div className="flex items-start gap-2.5 bg-red-950/50 border border-red-500/40 rounded-lg px-3 sm:px-10 py-2.5 sm:py-7">
          <AlertTriangle className="w-4 h-4 sm:w-9 sm:h-9 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5 min-w-0">
            <p className="text-xs sm:text-2xl font-semibold text-red-300">BrickLink API limit reached</p>
            <p className="text-xs sm:text-2xl text-red-400/80 leading-relaxed">
              Brick Spotter can still identify pieces, but price lookups and color matching won't work until the limit resets.
              {blResetStr && <span className="text-red-300"> Resets around <strong>{blResetStr}</strong>.</span>}
            </p>
          </div>
        </div>
      )}

      {/* ── IDLE: Upload UI ─────────────────────────────────────────────── */}
      {uiState === "idle" && (
        <>
          {/* Native file input — no capture attr so iOS shows its standard sheet:
              "Take Photo", "Photo Library", "Browse". One tap, one sheet. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
            data-testid="input-brickanalyzer-file"
          />
          <button
            className="w-full flex flex-col items-center justify-center gap-3 py-16 sm:py-20 text-center rounded-xl border border-dashed border-gray-700 hover:border-purple-500/50 hover:bg-purple-950/20 transition-colors cursor-pointer"
            data-testid="button-brickanalyzer-idle-trigger"
            onClick={() => fileInputRef.current?.click()}
          >
            <Camera className="w-12 h-12 sm:w-28 sm:h-28 text-gray-500" />
            <p className="text-sm sm:text-3xl text-gray-400">
              Tap to take a photo or pick from your library.
            </p>
          </button>

          {/* placeholder so next diff can find its anchor */}
          {false && (() => {
            const rd = CALIBRATION_ROUNDS.find(r => r.round === calibrateRound)!;
            const rdStats = calibStats.byRound.find(r => r.round === calibrateRound)!;
            return (
              <>
              <div className={`rounded-lg border ${rd.borderColor} ${rd.bg} space-y-2 p-3 sm:p-6`}>
                {/* Round selector */}
                <div className="flex flex-wrap gap-1.5">
                  {CALIBRATION_ROUNDS.map(r => (
                    <button
                      key={r.round}
                      onClick={() => setCalibrateRound(r.round)}
                      className={`text-[10px] sm:text-lg font-semibold px-2.5 py-1 rounded-full transition-colors ${calibrateRound === r.round ? `${r.color} bg-gray-800` : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/60'}`}
                      data-testid={`button-calib-round-${r.round}`}
                    >
                      {r.round}. {r.label}
                    </button>
                  ))}
                </div>
                {/* Guide (no scans yet) or nothing extra (has scans — score below is enough) */}
                {rdStats.total === 0 && (
                  <div className="space-y-1">
                    <p className={`text-xs sm:text-lg font-semibold ${rd.color}`}>{ROUND_GUIDES[rd.round].headline}</p>
                    <ol className="space-y-0.5">
                      {ROUND_GUIDES[rd.round].steps.map((step, i) => (
                        <li key={i} className="flex items-start gap-2 text-[11px] sm:text-base text-gray-400">
                          <span className={`font-bold ${rd.color} flex-shrink-0`}>{i + 1}.</span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {/* Round progress + overall scorecard access */}
                <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-700/50">
                  {rdStats.total > 0 ? (
                    <>
                      <span className="text-[10px] sm:text-lg text-gray-500">Round {rd.round}:</span>
                      <span className="text-[10px] sm:text-lg text-green-400 font-medium">{rdStats.correct} correct</span>
                      <span className="text-[10px] sm:text-lg text-yellow-400 font-medium">{rdStats.close} close</span>
                      <span className="text-[10px] sm:text-lg text-red-400 font-medium">{rdStats.wrong} wrong</span>
                      <span className="text-[10px] sm:text-lg text-gray-600">
                        {Math.round(rdStats.correct / rdStats.total * 100)}% accurate
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] sm:text-lg text-gray-600">No scans rated yet — take a photo above to start.</span>
                  )}
                  {calibStats.total > 0 && (
                    <button
                      onClick={() => setShowScorecard(v => !v)}
                      className="ml-auto flex items-center gap-1 text-[10px] sm:text-lg text-amber-500 hover:text-amber-300 transition-colors font-medium"
                      data-testid="button-calib-scorecard-idle"
                    >
                      <BarChart3 className="w-3 h-3" />
                      {showScorecard ? 'Hide' : 'View'} scorecard ({calibStats.total} total)
                    </button>
                  )}
                </div>

                {/* Inline mini scorecard on idle screen */}
                {showScorecard && calibStats.total > 0 && (
                  <div className="space-y-2 pt-1 border-t border-gray-700/50">
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="rounded bg-green-950/40 border border-green-500/20 p-1.5 text-center">
                        <p className="text-sm sm:text-2xl font-bold text-green-400">{Math.round(calibStats.correct / calibStats.total * 100)}%</p>
                        <p className="text-[9px] sm:text-base text-green-600">Accuracy</p>
                      </div>
                      <div className="rounded bg-yellow-950/40 border border-yellow-500/20 p-1.5 text-center">
                        <p className="text-sm sm:text-2xl font-bold text-yellow-400">{calibStats.close}</p>
                        <p className="text-[9px] sm:text-base text-yellow-600">Close</p>
                      </div>
                      <div className="rounded bg-red-950/40 border border-red-500/20 p-1.5 text-center">
                        <p className="text-sm sm:text-2xl font-bold text-red-400">{calibStats.wrong}</p>
                        <p className="text-[9px] sm:text-base text-red-600">Wrong</p>
                      </div>
                    </div>
                    {calibStats.byConf.filter(c => c.total > 0).map(c => {
                      const pct = Math.round(c.correct / c.total * 100);
                      const confLabel = c.conf === 'high' ? 'text-green-400' : c.conf === 'medium' ? 'text-yellow-400' : 'text-gray-400';
                      return (
                        <div key={c.conf} className="flex items-center gap-2">
                          <span className={`text-[10px] sm:text-lg capitalize w-12 ${confLabel}`}>{c.conf}</span>
                          <div className="flex-1 bg-gray-800 rounded-full h-1 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 70 ? '#22c55e' : pct >= 40 ? '#eab308' : '#ef4444' }} />
                          </div>
                          <span className="text-[10px] sm:text-lg text-gray-500 font-mono">{pct}%</span>
                        </div>
                      );
                    })}
                    <button
                      onClick={resetCalibration}
                      className="flex items-center gap-1 text-[10px] sm:text-lg text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Reset all scores
                    </button>
                  </div>
                )}
              </div>
              </>
            );
          })()}

          {/* ── Auto / Manual mode selector ─────────────────────────── */}
          <div className="rounded-lg border border-gray-700 bg-gray-900/40 overflow-hidden">

            {/* Mode toggle row */}
            <div className="flex">
              <button
                className={`flex-1 py-2.5 sm:py-7 text-xs sm:text-2xl font-semibold transition-colors ${scanMode === "auto" ? "bg-purple-600 text-white" : "text-gray-400 hover:text-gray-300 hover:bg-gray-800/60"}`}
                onClick={() => { handleScanModeChange("auto"); setShowSettings(false); }}
                data-testid="button-scan-mode-auto"
              >
                Auto
              </button>
              <button
                className={`flex-1 py-2.5 sm:py-7 text-xs sm:text-2xl font-semibold transition-colors border-l border-gray-700 ${scanMode === "manual" ? "bg-purple-600 text-white" : "text-gray-400 hover:text-gray-300 hover:bg-gray-800/60"}`}
                onClick={() => { handleScanModeChange("manual"); setShowSettings(true); }}
                data-testid="button-scan-mode-manual"
              >
                Manual
              </button>
            </div>

            {/* Auto mode: brief description */}
            {scanMode === "auto" && (
              <div className="px-3 py-2.5 sm:px-10 sm:py-8 border-t border-gray-700/60 space-y-1">
                <p className="text-[11px] sm:text-2xl text-gray-300 font-medium">Smart 3-pass scan</p>
                <p className="text-[10px] sm:text-xl text-gray-500 leading-relaxed">
                  Your Manual settings are used as the core pass. Two additional passes run alongside — one tuned for large pieces and minifigs, one for small/fine pieces. Minifig regions block smaller-piece passes from subdividing them.
                </p>
              </div>
            )}

            {/* Manual mode: full settings panel */}
            {scanMode === "manual" && (<>
            <button
              className="w-full flex items-center justify-between px-3 py-2 text-left border-t border-gray-700/60"
              onClick={() => setShowSettings(v => !v)}
              data-testid="button-brickanalyzer-settings-toggle"
            >
              <span className="flex items-center gap-2 text-xs sm:text-2xl font-medium text-gray-400">
                <Settings2 className="w-3.5 h-3.5 sm:w-7 sm:h-7" />
                Scan Settings
              </span>
              <span className="flex items-center gap-2">
                {JSON.stringify({ ...settings, multiPass: false }) !== JSON.stringify({ ...baseline, multiPass: false }) && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Custom</Badge>
                )}
                <ChevronRight className={`w-3.5 h-3.5 text-gray-500 transition-transform ${showSettings ? "rotate-90" : ""}`} />
              </span>
            </button>

            {showSettings && (
              <div className="px-3 sm:px-10 pb-3 sm:pb-10 space-y-4 sm:space-y-12 border-t border-gray-700 pt-3 sm:pt-10">

                {/* ── Contour settings ──────────────────────────────────────── */}

                <div className="space-y-1">
                  <div className="flex justify-between items-baseline">
                    <label className="text-xs font-medium text-gray-300">Blur Radius</label>
                    <span className="text-xs font-mono text-purple-400">{settings.blurRadius}</span>
                  </div>
                  <input type="range" min="1" max="15" step="2"
                    value={settings.blurRadius}
                    onChange={e => setSettings(s => ({ ...s, blurRadius: Number(e.target.value) }))}
                    className="w-full accent-purple-500"
                    data-testid="slider-blur-radius"
                  />
                  <p className="text-[10px] text-gray-500">Gaussian blur before edge detection. Raise to smooth noise; lower to catch finer edges.</p>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-baseline">
                    <label className="text-xs font-medium text-gray-300">Edge Sensitivity (Low)</label>
                    <span className="text-xs font-mono text-purple-400">{settings.cannyLow}</span>
                  </div>
                  <input type="range" min="10" max="200" step="10"
                    value={settings.cannyLow}
                    onChange={e => setSettings(s => ({ ...s, cannyLow: Number(e.target.value) }))}
                    className="w-full accent-purple-500"
                    data-testid="slider-canny-low"
                  />
                  <p className="text-[10px] text-gray-500">Canny lower threshold. Lower = picks up weaker edges. Must stay below the high threshold.</p>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-baseline">
                    <label className="text-xs font-medium text-gray-300">Edge Sensitivity (High)</label>
                    <span className="text-xs font-mono text-purple-400">{settings.cannyHigh}</span>
                  </div>
                  <input type="range" min="50" max="400" step="10"
                    value={settings.cannyHigh}
                    onChange={e => setSettings(s => ({ ...s, cannyHigh: Number(e.target.value) }))}
                    className="w-full accent-purple-500"
                    data-testid="slider-canny-high"
                  />
                  <p className="text-[10px] text-gray-500">Canny upper threshold. Lower = more edges detected; raise to keep only strong, clear boundaries.</p>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-baseline">
                    <label className="text-xs font-medium text-gray-300">Edge Dilation</label>
                    <span className="text-xs font-mono text-purple-400">{settings.dilateIter}</span>
                  </div>
                  <input type="range" min="0" max="8" step="1"
                    value={settings.dilateIter}
                    onChange={e => setSettings(s => ({ ...s, dilateIter: Number(e.target.value) }))}
                    className="w-full accent-purple-500"
                    data-testid="slider-dilate-iter"
                  />
                  <p className="text-[10px] text-gray-500">Dilation passes after edge detection. Higher closes more gaps between disconnected edges on the same piece.</p>
                </div>

                {/* ── Shared settings ───────────────────────────────────────── */}
                <div className="border-t border-gray-700/50 pt-3 space-y-4">

                  <div className="space-y-1">
                    <div className="flex justify-between items-baseline">
                      <label className="text-xs font-medium text-gray-300">Min Piece Size</label>
                      <span className="text-xs font-mono text-purple-400">{settings.minSizePct.toFixed(2)}%</span>
                    </div>
                    <input type="range" min="0.01" max="0.5" step="0.01"
                      value={settings.minSizePct}
                      onChange={e => setSettings(s => ({ ...s, minSizePct: Number(e.target.value) }))}
                      className="w-full accent-purple-500"
                      data-testid="slider-min-size"
                    />
                    <p className="text-[10px] text-gray-500">Raise to ignore dust, shadows, and tiny noise. Lower if small pieces are being missed.</p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between items-baseline">
                      <label className="text-xs font-medium text-gray-300">Max Piece Size</label>
                      <span className="text-xs font-mono text-purple-400">{settings.maxSizePct.toFixed(0)}%</span>
                    </div>
                    <input type="range" min="1" max="30" step="1"
                      value={settings.maxSizePct}
                      onChange={e => setSettings(s => ({ ...s, maxSizePct: Number(e.target.value) }))}
                      className="w-full accent-purple-500"
                      data-testid="slider-max-size"
                    />
                    <p className="text-[10px] text-gray-500">Lower if baseplates or the table surface are being detected as pieces.</p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between items-baseline">
                      <label className="text-xs font-medium text-gray-300">Min Confidence</label>
                      <span className="text-xs font-mono text-purple-400">
                        {settings.minConfidence === 0 ? "Off" : `${Math.round(settings.minConfidence * 100)}%`}
                      </span>
                    </div>
                    <input type="range" min="0" max="0.95" step="0.05"
                      value={settings.minConfidence}
                      onChange={e => setSettings(s => ({ ...s, minConfidence: Number(e.target.value) }))}
                      className="w-full accent-purple-500"
                      data-testid="slider-min-confidence"
                    />
                    <p className="text-[10px] text-gray-500">Off = show all Brickognize results. Raise to hide low-confidence IDs.</p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between items-baseline">
                      <label className="text-xs font-medium text-gray-300">Max Pieces</label>
                      <span className="text-xs font-mono text-purple-400">{settings.maxPieces}</span>
                    </div>
                    <input type="range" min="5" max="100" step="5"
                      value={settings.maxPieces}
                      onChange={e => setSettings(s => ({ ...s, maxPieces: Number(e.target.value) }))}
                      className="w-full accent-purple-500"
                      data-testid="slider-max-pieces"
                    />
                    <p className="text-[10px] text-gray-500">Cap how many crops are sent to Brickognize. Reduce for faster results on crowded photos.</p>
                  </div>

                </div>

                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 gap-1.5 text-gray-500"
                    onClick={() => setSettings(loadBaseline())}
                    data-testid="button-settings-reset"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset to baseline
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 gap-1.5 text-purple-400"
                    onClick={handleSaveBaseline}
                    data-testid="button-settings-save-baseline"
                  >
                    Save as baseline
                  </Button>
                </div>
              </div>
            )}
            </>)}
          </div>
        </>
      )}

      {/* ── UPLOADING ───────────────────────────────────────────────────── */}
      {uiState === "uploading" && (
        <div className="flex flex-col items-center gap-3 py-12 sm:py-24">
          <Loader2 className="w-8 h-8 sm:w-20 sm:h-20 text-lego-blue animate-spin" />
          <p className="text-sm sm:text-2xl text-gray-300">Detecting pieces...</p>
        </div>
      )}

      {/* ── PREVIEWING ──────────────────────────────────────────────────── */}
      {uiState === "previewing" && previewData && (
        <div className="space-y-3">
          {/* Header bar */}
          <div className="flex flex-wrap items-center gap-2 bg-gray-800/60 border border-gray-700 rounded-lg px-3 sm:px-10 py-2 sm:py-6">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <ScanSearch className="w-4 h-4 sm:w-9 sm:h-9 text-purple-400 shrink-0" />
              <span className="text-sm sm:text-2xl font-medium text-purple-300">
                {previewBoxes.length} zone{previewBoxes.length !== 1 ? "s" : ""} detected
              </span>
            </div>
            <span className="text-xs sm:text-2xl text-gray-500">Review before identifying</span>
          </div>

          {/* Action buttons — placed above image so they're always visible */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleCancelPreview}
              data-testid="button-preview-cancel"
            >
              Retake
            </Button>
            <Button
              className="flex-1 bg-purple-600 gap-1.5"
              onClick={handleConfirmScan}
              data-testid="button-preview-confirm"
            >
              <ScanSearch className="w-3.5 h-3.5" />
              Identify {previewBoxes.length} piece{previewBoxes.length !== 1 ? "s" : ""}
            </Button>
          </div>
          {previewBoxes.length === 0 && (
            <p className="text-xs text-gray-500 text-center">
              No pieces detected. Try adjusting your settings or retaking the photo.
            </p>
          )}

          {/* Photo with overlaid bounding boxes */}
          <div
            className="relative w-full rounded-lg overflow-hidden bg-gray-900 border border-gray-700"
            style={{ aspectRatio: `${previewData.imageWidth} / ${previewData.imageHeight}` }}
            data-testid="preview-image-container"
          >
            <img
              src={previewData.objectUrl}
              alt="Scan preview"
              className="w-full h-full object-contain pointer-events-none select-none"
            />

            {/* Confirmed boxes — purple solid border + number label */}
            {previewBoxes.map((box, i) => (
              <div
                key={`box-${i}`}
                className="absolute border-2 border-purple-400/90 rounded-sm pointer-events-none"
                style={{
                  left:   `${box.x}%`,
                  top:    `${box.y}%`,
                  width:  `${box.w}%`,
                  height: `${box.h}%`,
                }}
              >
                <span className="absolute -top-4 left-0 text-[9px] font-mono text-purple-300 bg-gray-900/80 px-0.5 leading-3 pointer-events-none select-none">
                  {i + 1}
                </span>
              </div>
            ))}

          </div>

          {/* Zone count hint */}
          <p className="text-xs text-center">
            {previewCandidates.length > 0
              ? <span className="text-teal-400/80">{previewCandidates.length} possible piece{previewCandidates.length !== 1 ? "s" : ""} detected</span>
              : <span className="text-gray-500">Zones detected — ready to identify</span>
            }
          </p>
        </div>
      )}

      {/* ── PROCESSING ──────────────────────────────────────────────────── */}
      {uiState === "processing" && (
        <div className="space-y-3">
          {/* Header */}
          <div className="flex flex-col items-center gap-2 pt-5 pb-2">
            <div className="relative">
              <ScanSearch className="w-8 h-8 sm:w-14 sm:h-14 text-lego-yellow" />
              <Loader2 className="w-3 h-3 sm:w-6 sm:h-6 text-lego-yellow animate-spin absolute -bottom-0.5 -right-0.5" />
            </div>
            <div className="flex items-center gap-2">
              <p className="text-sm sm:text-lg font-medium text-gray-200">Analyzing your LEGO pieces…</p>
              {scanProgress?.startedAt && (
                <span className="text-xs font-mono text-gray-500 tabular-nums" data-testid="text-scan-total-elapsed">
                  {((tickNow - scanProgress.startedAt) / 1000).toFixed(0)}s
                </span>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs sm:text-sm font-semibold text-gray-200 truncate" data-testid="text-scan-progress-step">
                {scanProgress?.step ?? 'Starting…'}
              </span>
              <span className="text-xs font-mono text-lego-yellow shrink-0" data-testid="text-scan-progress-pct">
                {scanProgress?.pct ?? 0}%
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-lego-yellow transition-all duration-500 ease-out"
                style={{ width: `${scanProgress?.pct ?? 0}%` }}
                data-testid="bar-scan-progress"
              />
            </div>
            {scanProgress?.detail && (
              <p className="text-[11px] sm:text-xs text-gray-400 truncate" data-testid="text-scan-progress-detail">
                {scanProgress.detail}
                {scanProgress.stepAt && (
                  <span className="text-gray-600 ml-1">· {((tickNow - scanProgress.stepAt) / 1000).toFixed(0)}s</span>
                )}
              </p>
            )}
          </div>

          {!leftPage ? (
            <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-2">
              <p className="text-xs text-gray-400 text-center">
                You can leave this page. We'll show a notification in the dashboard when it's done.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setLeftPage(true)}
                data-testid="button-brickanalyzer-leave"
              >
                Leave and get notified when done
              </Button>
            </div>
          ) : (
            <div className="bg-green-950/40 border border-green-500/20 rounded-lg p-3 text-center">
              <p className="text-xs text-green-400">
                Scan is running in the background. Watch the Action Items panel on the main dashboard for your notification.
              </p>
            </div>
          )}

          <div className="text-center pt-1">
            <button
              className="text-[10px] sm:text-xs text-gray-600 hover:text-red-400 transition-colors underline underline-offset-2"
              onClick={() => dismissMutation.mutate()}
              disabled={dismissMutation.isPending}
              data-testid="button-brickanalyzer-cancel"
            >
              {dismissMutation.isPending ? "Cancelling..." : "Cancel scan"}
            </button>
          </div>
        </div>
      )}

      {/* ── FAILED ──────────────────────────────────────────────────────── */}
      {uiState === "failed" && (
        <div className="space-y-3">
          <div className="flex flex-col items-center gap-3 py-8 sm:py-16">
            <X className="w-8 h-8 sm:w-20 sm:h-20 text-lego-red" />
            <p className="text-sm sm:text-2xl text-gray-300">Scan failed</p>
            <p className="text-xs sm:text-2xl text-gray-500 text-center">{scan?.errorMessage || "Something went wrong. Please try again."}</p>
          </div>
          <div className="flex flex-col gap-2">
            <Button
              variant="default"
              className="w-full"
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
              data-testid="button-brickanalyzer-retry-cached"
            >
              {retryMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Retrying…</>
              ) : (
                <><RefreshCw className="w-4 h-4 mr-2" />Retry Scan</>
              )}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => { setUiState("idle"); setScanId(null); }}
              data-testid="button-brickanalyzer-new-scan"
            >
              Upload New Image
            </Button>
          </div>
        </div>
      )}

      {/* ── COMPLETE: Results ────────────────────────────────────────────── */}
      {uiState === "complete" && (
        <div className="space-y-3">
          {/* Summary bar */}
          <div className="flex flex-wrap items-center gap-2 bg-gray-800/60 border border-gray-700 rounded-lg px-3 sm:px-10 py-2 sm:py-6">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <CheckCircle className="w-4 h-4 sm:w-9 sm:h-9 text-green-400 shrink-0" />
              <span className="text-sm sm:text-2xl font-medium text-green-300">Scan complete</span>
            </div>
            <div className="flex gap-3 text-xs sm:text-2xl font-mono text-gray-400 flex-wrap">
              <span>{results.length} piece{results.length !== 1 ? "s" : ""} found</span>
              <span>{inStockCount} in your store</span>
              <span>{withPriceCount} priced</span>
              {totalValue > 0 && (
                <span className="text-lego-yellow font-semibold">${totalValue.toFixed(2)} est. value</span>
              )}
              {(activeScan?.blApiCalls ?? 0) > 0 && (
                <span className="text-gray-600" title="BrickLink API calls used for this scan">{activeScan!.blApiCalls} BL calls</span>
              )}
            </div>
            {(activeScan?.cropCount ?? 0) > 0 && (
              <Button
                size="sm"
                variant={showCrops ? "default" : "outline"}
                className="shrink-0 gap-1.5"
                onClick={() => setShowCrops(v => !v)}
                data-testid="button-brickanalyzer-view-crops"
              >
                <Grid3X3 className="w-3.5 h-3.5" />
                {showCrops ? "Hide Crops" : `View ${activeScan?.cropCount} Crops`}
              </Button>
            )}
            {/* Calibrate toggle — shown in results, activates verdict icons on each card */}
            <Button
              size="sm"
              variant={calibrateMode ? "default" : "outline"}
              className={`shrink-0 gap-1.5 ${calibrateMode ? "bg-amber-600 hover:bg-amber-700 border-amber-600" : ""}`}
              onClick={() => { setCalibrateMode(v => !v); if (!calibrateMode) setShowScorecard(false); }}
              data-testid="button-mode-calibrate"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              Calibrate
              {calibrateMode && calibStats.total > 0 && (
                <span className="text-[10px] font-bold bg-amber-800/60 text-amber-200 px-1.5 rounded-full">
                  {calibStats.total}
                </span>
              )}
            </Button>
            {calibrateMode && calibStats.total > 0 && (
              <Button
                size="sm"
                variant={showScorecard ? "default" : "outline"}
                className="shrink-0 gap-1.5"
                onClick={() => setShowScorecard(v => !v)}
                data-testid="button-view-scorecard"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                {calibStats.total > 0 ? `${Math.round(calibStats.correct / calibStats.total * 100)}%` : 'Scorecard'}
              </Button>
            )}
          </div>

          {/* New Scan / Delete Results — top for easy mobile access */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => { setUiState("idle"); setScanId(null); }}
              data-testid="button-brickanalyzer-new-scan"
            >
              New Scan
            </Button>
            <Button
              variant="outline"
              className="flex-1 text-lego-red border-lego-red/40"
              onClick={() => dismissMutation.mutate()}
              disabled={dismissMutation.isPending}
              data-testid="button-brickanalyzer-dismiss"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Close &amp; Delete Results
            </Button>
          </div>

          {/* ── Inline heatmap ───────────────────────────────────────────── */}
          {activeScan && (
            <div className="relative rounded-lg border border-gray-700 overflow-hidden bg-black" data-testid="inline-heatmap">
              {/* Filter bar */}
              <div className="relative flex items-center justify-end gap-2 px-3 py-1.5 border-b border-gray-800 flex-wrap" style={{ zIndex: 10 }}>
                {/* Peak button — left-aligned, distinct color */}
                <button
                  data-testid="heatmap-source-peak"
                  onClick={() => setHeatmapSource('peak')}
                  className={`rounded text-[10px] font-medium px-2.5 py-0.5 transition-colors shrink-0 ${heatmapSource === 'peak' ? 'bg-amber-600 text-white border border-amber-500' : 'text-gray-500 hover:text-gray-300 border border-gray-700 bg-transparent'}`}
                >
                  Peak
                </button>
                <div className="flex-1" />
                {(() => {
                  const isPeak = heatmapSource === 'peak';
                  const exitPeak = () => { if (heatmapSource === 'peak') setHeatmapSource('sold'); };
                  return (
                    <div className={`flex items-center gap-1.5 ${isPeak ? 'opacity-50' : ''}`}>
                      <div className="flex rounded overflow-hidden border border-gray-700 text-[10px] font-medium shrink-0">
                        {(['new', 'used'] as const).map(c => (
                          <button
                            key={c}
                            data-testid={`heatmap-cond-${c}`}
                            onClick={() => { setHeatmapCondition(c); exitPeak(); }}
                            className={`px-2 py-0.5 transition-colors ${heatmapCondition === c && !isPeak ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300 bg-transparent'}`}
                          >
                            {c === 'new' ? 'New' : 'Used'}
                          </button>
                        ))}
                      </div>
                      <div className="flex rounded overflow-hidden border border-gray-700 text-[10px] font-medium shrink-0">
                        {(['sold', 'listed'] as const).map(s => (
                          <button
                            key={s}
                            data-testid={`heatmap-source-${s}`}
                            onClick={() => setHeatmapSource(s)}
                            className={`px-2 py-0.5 transition-colors ${heatmapSource === s && !isPeak ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300 bg-transparent'}`}
                          >
                            {s === 'sold' ? 'Sold' : 'Listed'}
                          </button>
                        ))}
                      </div>
                      <div className="flex rounded overflow-hidden border border-gray-700 text-[10px] font-medium shrink-0">
                        {(['max', 'avg'] as const).map(m => (
                          <button
                            key={m}
                            data-testid={`heatmap-metric-${m}`}
                            onClick={() => { setHeatmapMetric(m); exitPeak(); }}
                            className={`px-2 py-0.5 transition-colors ${heatmapMetric === m && !isPeak ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300 bg-transparent'}`}
                          >
                            {m === 'max' ? 'Max' : 'Avg'}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
              {/* Scan image */}
              <div
                ref={scanContainerRef}
                className="flex items-center justify-center"
                style={{ height: '55vh', overflow: 'visible' }}
              >
                <div
                  style={{
                    position: 'relative',
                    height: '100%',
                    width: activeScan.imgWidth && activeScan.imgHeight
                      ? `calc(55vh * ${activeScan.imgWidth} / ${activeScan.imgHeight})`
                      : '100%',
                    maxWidth: '100%',
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={`/api/brickanalyzer/scan/${activeScan.id}/image`}
                    alt="Original scan"
                    className="absolute inset-0 w-full h-full object-fill block select-none"
                    draggable={false}
                    style={{ filter: 'brightness(0.70)' }}
                  />
                  {(() => {
                    const cropDismissKeyMap = new Map<number, string>();
                    groupedResults.forEach(grp => {
                      const repCropIndex = grp.entries[0]?.cropIndex ?? null;
                      const dismissKey = `${grp.partNo}__${repCropIndex ?? 'x'}`;
                      grp.entries.forEach(e => {
                        if (e.cropIndex != null) cropDismissKeyMap.set(e.cropIndex, dismissKey);
                      });
                    });
                    const bboxResults = results.filter(r => {
                      if (r.bboxX == null || r.bboxY == null || r.bboxW == null || r.bboxH == null) return false;
                      if (!r.partNo) return false;
                      const dk = r.cropIndex != null ? cropDismissKeyMap.get(r.cropIndex) : undefined;
                      return !dk || !dismissedItems.has(dk);
                    });
                    const heatVal = (r: ScanResult): number => {
                      if (heatmapSource === 'peak') {
                        return Math.max(
                          r.marketSoldMaxNew ?? 0, r.marketSoldAvgNew ?? 0,
                          r.marketSoldMaxUsed ?? 0, r.marketSoldAvgUsed ?? 0,
                          r.stockMaxPriceN ?? 0, r.stockAvgPriceN ?? 0,
                          r.stockMaxPriceU ?? 0, r.stockAvgPriceU ?? 0
                        );
                      }
                      if (heatmapSource === 'listed') {
                        if (heatmapCondition === 'new') {
                          return heatmapMetric === 'max'
                            ? (r.stockMaxPriceN ?? 0)
                            : (r.stockAvgPriceN ?? 0);
                        } else {
                          return heatmapMetric === 'max'
                            ? (r.stockMaxPriceU ?? 0)
                            : (r.stockAvgPriceU ?? 0);
                        }
                      }
                      if (heatmapCondition === 'new') {
                        return heatmapMetric === 'max'
                          ? (r.marketSoldMaxNew ?? 0)
                          : (r.marketSoldAvgNew ?? 0);
                      } else {
                        return heatmapMetric === 'max'
                          ? (r.marketSoldMaxUsed ?? 0)
                          : (r.marketSoldAvgUsed ?? 0);
                      }
                    };
                    const allPrices = bboxResults.map(r => heatVal(r)).filter(p => p > 0);
                    const maxPrice = allPrices.length > 0 ? Math.max(...allPrices) : 0;
                    const hiThresh = maxPrice * 0.60;
                    const midThresh = maxPrice * 0.25;
                    const tierStyle = {
                      high:   { corner: 'rgb(239,68,68)',    label: '#fca5a5', badge: 'rgba(127,29,29,0.92)'  },
                      medium: { corner: 'rgb(251,146,60)',   label: '#fdba74', badge: 'rgba(124,45,18,0.92)'  },
                      low:    { corner: 'rgb(250,204,21)',   label: '#fde68a', badge: 'rgba(120,80,0,0.92)'   },
                      none:   { corner: 'rgba(156,163,175,0.55)', label: '#6b7280', badge: 'rgba(17,24,39,0.80)' },
                    };
                    // Corner bracket arm length (px). Short arms = clean, non-blocking look.
                    const ARM = 10;
                    const THK = 2.5;
                    const mkCorner = (color: string, top?: 0|'auto', bottom?: 0|'auto', left?: 0|'auto', right?: 0|'auto') => ({
                      position: 'absolute' as const,
                      top, bottom, left, right,
                      width: ARM, height: ARM,
                      borderTop:    top    === 0 ? `${THK}px solid ${color}` : undefined,
                      borderBottom: bottom === 0 ? `${THK}px solid ${color}` : undefined,
                      borderLeft:   left   === 0 ? `${THK}px solid ${color}` : undefined,
                      borderRight:  right  === 0 ? `${THK}px solid ${color}` : undefined,
                      filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.85)) drop-shadow(0 0 1px rgba(0,0,0,1))',
                      pointerEvents: 'none' as const,
                    });
                    return (
                      <>
                        {bboxResults.map((r, i) => {
                          const peak = heatVal(r);
                          const displayPrice = peak > 0 ? peak : null;
                          const tier = peak === 0 ? 'none' : peak >= hiThresh ? 'high' : peak >= midThresh ? 'medium' : 'low';
                          const ts = tierStyle[tier];
                          const overlayDismissKey = r.cropIndex != null ? cropDismissKeyMap.get(r.cropIndex) : undefined;
                          return (
                            <div
                              key={r.cropIndex ?? i}
                              role="button"
                              tabIndex={0}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                setHeatmapCropFocus(null);
                                setFocusedDetailCropIndex(r.cropIndex ?? null);
                              }}
                              style={{
                                position: 'absolute',
                                left:   `${r.bboxX}%`,
                                top:    `${r.bboxY}%`,
                                width:  `${r.bboxW}%`,
                                height: `${r.bboxH}%`,
                                background: heatmapCropFocus === r.cropIndex ? 'rgba(20,184,166,0.10)' : 'transparent',
                                border: 'none',
                                transition: 'background 0.15s',
                                overflow: 'visible',
                                cursor: 'pointer',
                              }}
                              onMouseEnter={(e) => {
                                (e.currentTarget as HTMLElement).style.background = heatmapCropFocus === r.cropIndex
                                  ? 'rgba(20,184,166,0.18)'
                                  : 'rgba(255,255,255,0.04)';
                              }}
                              onMouseLeave={(e) => {
                                (e.currentTarget as HTMLElement).style.background = heatmapCropFocus === r.cropIndex
                                  ? 'rgba(20,184,166,0.10)'
                                  : 'transparent';
                              }}
                              data-testid={`scan-overlay-inline-${r.cropIndex ?? i}`}
                            >
                              {/* Corner brackets */}
                              {(() => {
                                const c = heatmapCropFocus === r.cropIndex ? 'rgb(20,184,166)' : ts.corner;
                                return (<>
                                  <span style={mkCorner(c, 0, 'auto', 0, 'auto')} />
                                  <span style={mkCorner(c, 0, 'auto', 'auto', 0)} />
                                  <span style={mkCorner(c, 'auto', 0, 0, 'auto')} />
                                  <span style={mkCorner(c, 'auto', 0, 'auto', 0)} />
                                </>);
                              })()}
                              {/* Price badge — tapping opens item details drawer on pricing tab */}
                              <button
                                onMouseDown={e => e.stopPropagation()}
                                onClick={e => {
                                  e.stopPropagation();
                                  if (onItemClick && r.partNo) {
                                    onItemClick('inventory', `bricklink-${r.partNo}`, 'pricing');
                                  }
                                }}
                                data-testid={`heatmap-price-badge-${r.cropIndex ?? i}`}
                                style={{
                                  background: ts.badge,
                                  color: ts.label,
                                  border: `1px solid ${ts.corner}`,
                                  position: 'absolute',
                                  top: 'calc(100% + 2px)',
                                  left: '50%',
                                  transform: 'translateX(-50%)',
                                  zIndex: 20,
                                  cursor: onItemClick && r.partNo ? 'pointer' : 'default',
                                }}
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm leading-tight whitespace-nowrap shadow-lg"
                              >
                                {displayPrice != null ? `$${displayPrice.toFixed(2)}` : '—'}
                              </button>
                              {r.detectionSource === 'elfie' && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      data-testid={`elfie-badge-${r.cropIndex ?? i}`}
                                      style={{
                                        position: 'absolute',
                                        top: -10,
                                        left: -10,
                                        zIndex: 25,
                                        width: 20,
                                        height: 20,
                                        borderRadius: '50%',
                                        background: 'rgba(139,92,246,0.92)',
                                        border: '1.5px solid rgba(196,167,255,0.80)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
                                        pointerEvents: 'auto',
                                      }}
                                    >
                                      <img src={elfieRobot} alt="E.L.F.I.E. detection" style={{ width: 14, height: 14, objectFit: 'contain' }} />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">
                                    Identified by E.L.F.I.E. visual search
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              {overlayDismissKey && (
                                <button
                                  onMouseDown={e => e.stopPropagation()}
                                  onClick={e => {
                                    e.stopPropagation();
                                    setDismissedItems(prev => { const n = new Set(prev); n.add(overlayDismissKey); return n; });
                                  }}
                                  title="Remove from results"
                                  style={{
                                    position: 'absolute',
                                    top: -9, right: -9, zIndex: 30,
                                    width: 18, height: 18,
                                    background: 'rgba(0,0,0,0.80)',
                                    border: '1px solid rgba(255,255,255,0.25)',
                                    borderRadius: '50%',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    cursor: 'pointer', flexShrink: 0,
                                  }}
                                  data-testid={`overlay-remove-inline-${r.cropIndex ?? i}`}
                                >
                                  <X style={{ width: 10, height: 10, color: 'white' }} />
                                </button>
                              )}
                            </div>
                          );
                        })}
                        {unknownOverlays.filter(r => r.bboxX != null).map((r, i) => (
                          <button
                            key={`unknown-inline-${r.cropIndex ?? i}`}
                            title="Unidentified piece — tap to add to results"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPromotedUnknowns(prev => new Set([...prev, r.cropIndex ?? -1]));
                            }}
                            style={{
                              position: 'absolute',
                              left:   `${r.bboxX}%`,
                              top:    `${r.bboxY}%`,
                              width:  `${r.bboxW}%`,
                              height: `${r.bboxH}%`,
                              background: 'rgba(45,212,191,0.12)',
                              border: '2px dashed rgba(45,212,191,0.75)',
                              transition: 'filter 0.15s',
                              overflow: 'visible',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.4)')}
                            onMouseLeave={(e) => (e.currentTarget.style.filter = '')}
                            data-testid={`scan-unknown-overlay-inline-${r.cropIndex ?? i}`}
                          >
                            <span
                              style={{
                                background: 'rgba(17,78,70,0.85)',
                                color: '#5eead4',
                                border: '1px solid rgba(45,212,191,0.70)',
                                position: 'absolute',
                                top: 'calc(100% + 2px)',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                zIndex: 20,
                              }}
                              className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm leading-tight whitespace-nowrap shadow-lg"
                            >
                              ?
                            </span>
                          </button>
                        ))}
                      </>
                    );
                  })()}
                </div>
              </div>
              {/* ── Detail overlay — appears on top of heatmap when a box is tapped ── */}
              {focusedDetailCropIndex != null && (() => {
                const focusedGroup = groupedResults.find(grp =>
                  grp.entries.some(e => e.cropIndex === focusedDetailCropIndex)
                );
                if (!focusedGroup) return (
                  <div className="fixed inset-0 z-[999] bg-gray-950 flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }} data-testid="heatmap-detail-overlay">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 shrink-0">
                      <span className="text-xs text-gray-400">Unidentified piece</span>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setFocusedDetailCropIndex(null)} data-testid="button-close-detail-overlay"><X className="w-4 h-4" /></Button>
                    </div>
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-xs text-gray-500">No match data available</p>
                    </div>
                  </div>
                );

                const overlayRepEntry = focusedGroup.entries[0];
                const overlayTotalQtyNew = focusedGroup.entries.reduce((s, e) => s + e.ourQtyNew, 0);
                const overlayTotalQtyUsed = focusedGroup.entries.reduce((s, e) => s + e.ourQtyUsed, 0);
                const overlayStockLabel = (() => {
                  if (overlayTotalQtyNew > 0 && overlayTotalQtyUsed > 0) return `${overlayTotalQtyNew} new · ${overlayTotalQtyUsed} used in stock`;
                  if (overlayTotalQtyNew > 0) return `${overlayTotalQtyNew} new in stock`;
                  if (overlayTotalQtyUsed > 0) return `${overlayTotalQtyUsed} used in stock`;
                  return null;
                })();
                const overlayBestConf = focusedGroup.entries.some(e => e.confidence === 'high') ? 'high'
                  : focusedGroup.entries.some(e => e.confidence === 'medium') ? 'medium' : 'low';
                const overlayConfRank = (c: 'high' | 'medium' | 'low') => c === 'high' ? 2 : c === 'medium' ? 1 : 0;
                const overlayColorGroupMap = new Map<string, ScanResult[]>();
                for (const e of focusedGroup.entries) {
                  const ck = e.colorId != null ? `id:${e.colorId}` : `name:${e.colorName || '__none__'}`;
                  if (!overlayColorGroupMap.has(ck)) overlayColorGroupMap.set(ck, []);
                  overlayColorGroupMap.get(ck)!.push(e);
                }
                const overlayColorEntries = Array.from(overlayColorGroupMap.values()).map(group =>
                  group.reduce((best, e) => {
                    const bScore = overlayConfRank(best.confidence) * 2 + (best.ourQtyNew + best.ourQtyUsed > 0 ? 1 : 0);
                    const eScore = overlayConfRank(e.confidence) * 2 + (e.ourQtyNew + e.ourQtyUsed > 0 ? 1 : 0);
                    return eScore > bScore ? e : best;
                  }, group[0])
                );
                const overlayScoreColor = (s: number | null) => {
                  if (s === null) return 'text-gray-500';
                  if (s >= 2.0) return 'text-emerald-400';
                  if (s >= 1.5) return 'text-orange-400';
                  if (s >= 1.0) return 'text-yellow-500';
                  return 'text-gray-400';
                };
                const isMinifig = focusedGroup.itemType === 'MINIFIG';
                const blColorUrl = focusedGroup.partNo
                  ? isMinifig
                    ? `https://img.bricklink.com/ItemImage/MN/0/${focusedGroup.partNo}.png`
                    : `https://img.bricklink.com/ItemImage/PN/${overlayRepEntry.colorId ?? 0}/${focusedGroup.partNo}.png`
                  : null;
                const blPlUrl = (focusedGroup.partNo && !isMinifig)
                  ? `https://img.bricklink.com/ItemImage/PL/${focusedGroup.partNo}.png`
                  : null;
                const repImg = focusedGroup.thumbnailUrl;
                const isRebrickable = repImg?.includes('cdn.rebrickable.com');
                const primarySrc = isRebrickable
                  ? `/api/images/proxy?url=${encodeURIComponent(repImg!)}`
                  : (repImg && repImg.startsWith('https://')) ? repImg : blColorUrl;

                return (
                  <div
                    className="fixed inset-0 z-[999] flex flex-col"
                    style={{ background: '#0c0c12', paddingTop: 'env(safe-area-inset-top, 0px)' }}
                    data-testid="heatmap-detail-overlay"
                  >
                    {/* ── Header bar ─────────────────────────────────────── */}
                    <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-white/[0.06]">
                      <Button
                        size="icon" variant="ghost" className="h-8 w-8 shrink-0"
                        onClick={() => setFocusedDetailCropIndex(null)}
                        data-testid="button-close-detail-overlay"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate leading-snug">
                          {focusedGroup.partName || 'Unknown Part'}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {focusedGroup.partNo && (
                            <span className="font-mono text-[11px] text-gray-400 tracking-tight">{focusedGroup.partNo}</span>
                          )}
                          {isMinifig && (
                            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400 bg-amber-900/30 border border-amber-500/30 rounded px-1.5 py-0.5">Fig</span>
                          )}
                          <span className={`text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 ${
                            overlayBestConf === 'high'
                              ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-500/25'
                              : overlayBestConf === 'medium'
                              ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-500/25'
                              : 'bg-gray-800 text-gray-400 border border-gray-600/30'
                          }`}>{overlayBestConf}</span>
                          {overlayRepEntry.bqScore != null && (
                            <span className="text-[9px] font-mono text-gray-400 bg-gray-800/60 border border-gray-600/30 rounded px-1.5 py-0.5" title="Brickognize match score">
                              {Math.round(overlayRepEntry.bqScore * 100)}%
                            </span>
                          )}
                          {overlayStockLabel && (
                            <span className="text-[9px] font-semibold text-emerald-400">· {overlayStockLabel}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {focusedGroup.partNo && !isMinifig && overlayRepEntry.categoryId != null && MINIFIG_PART_CATEGORY_IDS.has(overlayRepEntry.categoryId) && (
                          <a
                            href={`https://www.bricklink.com/catalogItemIn.asp?P=${focusedGroup.partNo}&in=M`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-[10px] font-semibold text-amber-400 hover:text-amber-300 px-2 py-1 rounded-md bg-amber-900/20 border border-amber-500/20 whitespace-nowrap"
                            onClick={e => e.stopPropagation()}
                            title="See which minifigs contain this part"
                          >Appears In</a>
                        )}
                        {focusedGroup.partNo && (
                          <a
                            href={`https://www.bricklink.com/v2/catalog/catalogitem.page?${isMinifig ? 'M' : 'P'}=${focusedGroup.partNo}`}
                            target="_blank" rel="noopener noreferrer"
                            className="p-1.5 rounded-md bg-blue-950/30 border border-blue-500/20 text-lego-blue hover:text-blue-300"
                            onClick={e => e.stopPropagation()} title="View on BrickLink"
                          ><ExternalLink className="w-3.5 h-3.5" /></a>
                        )}
                      </div>
                    </div>

                    {/* ── Hero image ─────────────────────────────────────── */}
                    {(primarySrc || blPlUrl) && (
                      <div
                        className="relative shrink-0 overflow-hidden bg-black flex items-center justify-center border-b border-white/[0.06]"
                        style={{ height: 196 }}
                      >
                        <img
                          src={primarySrc || blPlUrl!}
                          alt={focusedGroup.partName}
                          className="object-contain max-h-full max-w-full select-none"
                          draggable={false}
                          onError={e => {
                            const el = e.target as HTMLImageElement;
                            if (blColorUrl && el.src !== blColorUrl) el.src = blColorUrl;
                            else if (blPlUrl && el.src !== blPlUrl) el.src = blPlUrl;
                            else (el.parentElement as HTMLElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}

                    {/* ── Tab bar ──────────────────────────────────────── */}
                    <div className="shrink-0 flex border-b border-white/[0.06]" style={{ background: '#0c0c12' }}>
                      {(['matches', 'pricing', 'inventory'] as const).map(tab => (
                        <button
                          key={tab}
                          onClick={() => setOverlayTab(tab)}
                          className={`flex-1 py-2.5 text-[11px] font-semibold uppercase tracking-wider transition-colors border-b-2 ${
                            overlayTab === tab
                              ? 'border-lego-blue text-white'
                              : 'border-transparent text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          {tab === 'matches' ? 'Best Matches' : tab === 'pricing' ? 'Pricing' : 'My Inventory'}
                        </button>
                      ))}
                    </div>

                    {/* ── Tab content ──────────────────────────────────── */}
                    <div className="flex-1 overflow-y-auto min-h-0">

                      {/* ── PRICING tab ────────────────────────────────── */}
                      {overlayTab === 'pricing' && focusedGroup.partNo && (
                        <OverlayPricingPanel
                          partNo={focusedGroup.partNo}
                          itemType={focusedGroup.itemType}
                          colorEntries={overlayColorEntries}
                        />
                      )}

                      {/* ── BEST MATCHES tab ───────────────────────────── */}
                      {overlayTab === 'matches' && overlayColorEntries.map((entry, ei) => {
                        const refHex = overlayRepEntry.colorRgb ?? '';
                        const entryHex = entry.colorRgb ?? '';
                        const colorDe = (refHex && entryHex && refHex !== entryHex) ? colorDeltaE(entryHex, refHex) : null;
                        const colorPct = colorDe != null ? colorConfPct(colorDe) : null;
                        const colorLbl = colorPct != null ? colorConfLabel(colorPct) : null;
                        const inStock = (entry.ourQtyNew + entry.ourQtyUsed) > 0;
                        return (
                          <div key={ei} className="border-b border-white/[0.06]">
                            {/* Color identity row */}
                            <div className="flex items-center gap-3 px-4 pt-4 pb-3">
                              {!isMinifig && (
                                entry.colorRgb
                                  ? <span className="w-7 h-7 rounded-full shrink-0 border-2 border-white/15 shadow-md" style={{ backgroundColor: `#${entry.colorRgb}` }} />
                                  : <span className="w-7 h-7 rounded-full shrink-0 bg-gray-600 border border-gray-500" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-[15px] font-semibold text-white leading-tight truncate">
                                  {isMinifig ? (entry.partName || focusedGroup.partName) : (entry.colorName || 'Unknown color')}
                                </p>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  <span className={`text-[10px] font-semibold uppercase tracking-wide ${confidenceColor(entry.confidence)}`}>
                                    {entry.confidence} ID confidence
                                  </span>
                                  {colorLbl && colorPct != null && (
                                    <span className={`text-[10px] font-medium ${colorLbl.cls}`}>· {colorPct}% color match</span>
                                  )}
                                </div>
                              </div>
                              {(inStock || entry.ourPriceNew != null || entry.ourPriceUsed != null) && (
                                <div className="shrink-0 text-right">
                                  {inStock && (
                                    <>
                                      <div className="flex items-center gap-1 justify-end mb-0.5">
                                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                                        <span className="text-xs font-bold text-emerald-400">In stock</span>
                                      </div>
                                      <span className="text-[10px] text-gray-500 font-mono block">
                                        {[entry.ourQtyNew > 0 ? `${entry.ourQtyNew}N` : null, entry.ourQtyUsed > 0 ? `${entry.ourQtyUsed}U` : null].filter(Boolean).join(' · ')}
                                      </span>
                                    </>
                                  )}
                                  {entry.ourPriceNew != null && (
                                    <p className="text-[11px] font-mono text-white tabular-nums mt-0.5">${entry.ourPriceNew.toFixed(2)} <span className="text-gray-600 text-[9px]">N</span></p>
                                  )}
                                  {entry.ourPriceUsed != null && (
                                    <p className="text-[11px] font-mono text-gray-400 tabular-nums">${entry.ourPriceUsed.toFixed(2)} <span className="text-gray-600 text-[9px]">U</span></p>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* ── How did I do? ─────────────────────────────── */}
                            <div className="px-4 pb-3 pt-1 border-t border-white/[0.06]">
                              <p className="app-label mb-2">How did I do?</p>
                              <div className="flex gap-2">
                                {([ 
                                  { key: 'correct', icon: ThumbsUp,   label: 'Nailed it', activeColor: 'text-emerald-400', activeBg: 'bg-emerald-400/10 border-emerald-400/30' },
                                  { key: 'close',   icon: Minus,      label: 'Close',     activeColor: 'text-yellow-400', activeBg: 'bg-yellow-400/10 border-yellow-400/30' },
                                  { key: 'wrong',   icon: ThumbsDown, label: 'Wrong',     activeColor: 'text-red-400',   activeBg: 'bg-red-400/10 border-red-400/30'     },
                                ] as const).map(({ key, icon: Icon, label, activeColor, activeBg }) => {
                                  const active = overlayCalibration[ei] === key;
                                  return (
                                    <button
                                      key={key}
                                      onClick={e => {
                                        e.stopPropagation();
                                        const next = active ? undefined as any : key;
                                        setOverlayCalibration(prev => ({ ...prev, [ei]: next }));
                                        if (next !== 'close') setOverlayCalibrationColorIdx(prev => { const n = { ...prev }; delete n[ei]; return n; });
                                      }}
                                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-[10px] font-semibold transition-colors ${
                                        active
                                          ? `${activeColor} ${activeBg} border`
                                          : 'text-gray-600 border-white/[0.06] hover:text-gray-400 hover:border-white/10'
                                      }`}
                                    >
                                      <Icon className="w-3.5 h-3.5 shrink-0" />
                                      {label}
                                    </button>
                                  );
                                })}
                              </div>

                              {/* Color picker — shown when "Close" is selected */}
                              {overlayCalibration[ei] === 'close' && (
                                <div className="mt-3">
                                  <p className="app-label mb-2">What color is it actually?</p>
                                  <div className="flex flex-wrap gap-2">
                                    {overlayColorEntries.map((ce, ci) => {
                                      const selected = overlayCalibrationColorIdx[ei] === ci;
                                      return (
                                        <button
                                          key={ci}
                                          onClick={e => { e.stopPropagation(); setOverlayCalibrationColorIdx(prev => ({ ...prev, [ei]: selected ? undefined as any : ci })); }}
                                          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors ${
                                            selected
                                              ? 'bg-white/10 border-white/25 text-white'
                                              : 'bg-transparent border-white/[0.08] text-gray-400 hover:text-gray-200 hover:border-white/15'
                                          }`}
                                        >
                                          {ce.colorRgb && (
                                            <span className="w-3 h-3 rounded-full shrink-0 border border-white/20" style={{ backgroundColor: `#${ce.colorRgb}` }} />
                                          )}
                                          {ce.colorName || `Color ${ci + 1}`}
                                          {ci === ei && <span className="text-[9px] text-gray-600 ml-0.5">(detected)</span>}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>

                          </div>
                        );
                      })}

                      {/* ── MY INVENTORY tab ───────────────────────────── */}
                      {overlayTab === 'inventory' && (<>

                      {/* ── Other color variants ──────────────────────────── */}
                      {(() => {
                        const detectedColorIds = new Set(overlayColorEntries.map(e => e.colorId).filter((id): id is number => id != null));
                        const otherLots = (overlayRepEntry.inventoryLots ?? []).filter(lot => lot.colorId == null || !detectedColorIds.has(lot.colorId));
                        const refHex = overlayRepEntry.colorRgb ?? '';
                        const annotated = otherLots.map(lot => {
                          const dE = (refHex && lot.colorRgb) ? colorDeltaE(lot.colorRgb, refHex) : null;
                          const pct = dE != null ? colorConfPct(dE) : null;
                          return { lot, dE, pct };
                        });
                        const sorted = [...annotated].sort((a, b) => {
                          if (a.pct != null && b.pct != null) return b.pct - a.pct;
                          if (a.pct != null) return -1;
                          if (b.pct != null) return 1;
                          return 0;
                        });
                        const visible = refHex
                          ? sorted.filter(({ lot, pct }) => pct == null || pct >= COLOR_CONF_CUTOFF)
                          : sorted;
                        const hiddenCount = sorted.length - visible.length;
                        if (visible.length === 0) return null;
                        return (
                          <div className="border-b border-white/[0.06]">
                            <div className="flex items-center gap-2 px-4 pt-3 pb-2">
                              <p className="app-label flex-1">Other color variants</p>
                              {hiddenCount > 0 && <span className="text-[9px] text-gray-700">+{hiddenCount} below cutoff</span>}
                            </div>
                            <div className="px-3 pb-3 space-y-1.5">
                              {visible.map(({ lot, pct }, li) => {
                                const lotInStock = (lot.qtyNew + lot.qtyUsed) > 0;
                                const lotPeak = Math.max(lot.peakNew ?? 0, lot.peakUsed ?? 0) || null;
                                const lotNScore = lotPeak && lot.priceNew && lot.priceNew > 0 ? Number((lotPeak / lot.priceNew).toFixed(2)) : null;
                                const lotUScore = lotPeak && lot.priceUsed && lot.priceUsed > 0 ? Number((lotPeak / lot.priceUsed).toFixed(2)) : null;
                                const bestScore = lotNScore ?? lotUScore;
                                const confLbl = pct != null ? colorConfLabel(pct) : null;
                                return (
                                  <div
                                    key={li}
                                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 ${lotInStock ? 'bg-emerald-950/25 border border-emerald-500/10' : 'bg-white/[0.02] border border-white/[0.04]'}`}
                                  >
                                    {lot.imageUrl ? (
                                      <img src={lot.imageUrl} alt={lot.colorName || ''} className="w-8 h-8 object-contain rounded-lg shrink-0 bg-gray-800" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                    ) : lot.colorRgb ? (
                                      <span className="w-5 h-5 rounded-full shrink-0 border border-white/20" style={{ backgroundColor: `#${lot.colorRgb}` }} />
                                    ) : (
                                      <span className="w-5 h-5 rounded-full shrink-0 bg-gray-600" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <p className={`text-xs font-medium truncate ${lotInStock ? 'text-white' : 'text-gray-400'}`}>{lot.colorName || '—'}</p>
                                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                        {confLbl && pct != null && (
                                          <span className={`text-[9px] ${confLbl.cls}`}>{pct}% color</span>
                                        )}
                                        {lotInStock && (
                                          <span className="text-[9px] text-emerald-400 font-mono">
                                            {[lot.qtyNew > 0 ? `×${lot.qtyNew}N` : null, lot.qtyUsed > 0 ? `×${lot.qtyUsed}U` : null].filter(Boolean).join(' ')}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="text-right shrink-0 space-y-0.5 min-w-[52px]">
                                      {lot.priceNew != null && (
                                        <p className="text-xs font-mono font-medium text-white tabular-nums">${lot.priceNew.toFixed(2)} <span className="text-gray-600 text-[9px]">N</span></p>
                                      )}
                                      {lot.priceUsed != null && (
                                        <p className="text-xs font-mono text-gray-400 tabular-nums">${lot.priceUsed.toFixed(2)} <span className="text-gray-600 text-[9px]">U</span></p>
                                      )}
                                    </div>
                                    <div className="text-right shrink-0 min-w-[44px]">
                                      {bestScore != null && (
                                        <p className={`text-sm font-bold font-mono leading-none ${overlayScoreColor(bestScore)}`}>{bestScore}×</p>
                                      )}
                                      {lotPeak && (
                                        <span className="text-[9px] text-purple-400 font-mono mt-0.5 leading-none block">pk ${lotPeak.toFixed(2)}</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {/* ── My Inventory ─────────────────────────────────── */}
                      {(() => {
                        const seenColorIds = new Set<string>();
                        const inStockLots = focusedGroup.entries
                          .flatMap(e => e.inventoryLots ?? [])
                          .filter(l => {
                            if ((l.qtyNew + l.qtyUsed) <= 0) return false;
                            const k = String(l.colorId ?? 'null');
                            if (seenColorIds.has(k)) return false;
                            seenColorIds.add(k);
                            return true;
                          });
                        if (inStockLots.length === 0) {
                          return (
                            <div className="px-4 py-5 text-center border-t border-white/[0.06]">
                              <p className="text-xs text-gray-600">Not currently in your inventory</p>
                            </div>
                          );
                        }
                        return (
                          <div className="border-t border-white/[0.06]">
                            <div className="px-4 pt-3 pb-2">
                              <p className="app-label">My Inventory</p>
                            </div>
                            <div className="px-3 pb-3 space-y-1.5">
                              {inStockLots.map((lot, li) => (
                                <div key={li} className="flex items-center gap-3 rounded-xl bg-emerald-950/25 border border-emerald-500/10 px-3 py-2.5">
                                  {lot.colorRgb ? (
                                    <span className="w-5 h-5 rounded-full shrink-0 border border-white/20" style={{ backgroundColor: `#${lot.colorRgb}` }} />
                                  ) : (
                                    <span className="w-5 h-5 rounded-full shrink-0 bg-gray-600" />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-white truncate">{lot.colorName || '—'}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      {lot.qtyNew > 0 && <span className="text-[10px] text-emerald-400 font-mono">×{lot.qtyNew} new</span>}
                                      {lot.qtyUsed > 0 && <span className="text-[10px] text-blue-400 font-mono">×{lot.qtyUsed} used</span>}
                                    </div>
                                  </div>
                                  <div className="text-right shrink-0 space-y-0.5">
                                    {lot.priceNew != null && <p className="text-xs font-mono font-semibold text-white tabular-nums">${lot.priceNew.toFixed(2)} <span className="text-gray-600 text-[9px]">N</span></p>}
                                    {lot.priceUsed != null && <p className="text-xs font-mono text-gray-400 tabular-nums">${lot.priceUsed.toFixed(2)} <span className="text-gray-600 text-[9px]">U</span></p>}
                                  </div>
                                  {focusedGroup.partNo && (
                                    <a
                                      href={isMinifig
                                        ? `https://www.bricklink.com/v2/catalog/catalogitem.page?M=${focusedGroup.partNo}#T=I`
                                        : `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${focusedGroup.partNo}${lot.colorId != null ? `&idColor=${lot.colorId}` : ''}#T=I`}
                                      target="_blank" rel="noopener noreferrer"
                                      className="shrink-0 p-1.5 rounded-lg bg-blue-950/40 border border-blue-500/20 text-lego-blue hover:text-blue-300"
                                      onClick={e => e.stopPropagation()}
                                      title="View my BrickLink inventory listing"
                                    ><ExternalLink className="w-3 h-3" /></a>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      </>)}

                      <div className="h-6" />
                    </div>
                  </div>
                );
              })()}

              {/* Legend */}
              <div className="px-3 py-1.5 border-t border-gray-800 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-500">
                <div className="flex items-center gap-2.5">
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(239,68,68,0.6)', border: '1.5px solid rgb(239,68,68)' }} /> High value</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(251,146,60,0.55)', border: '1.5px solid rgb(251,146,60)' }} /> Mid</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(250,204,21,0.45)', border: '1.5px solid rgb(250,204,21)' }} /> Low</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(107,114,128,0.35)', border: '1.5px solid rgb(107,114,128)' }} /> No price</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(45,212,191,0.15)', border: '1.5px dashed rgba(45,212,191,0.75)' }} /> Unknown (tap)</span>
                  {results.some(r => r.detectionSource === 'elfie') && (
                    <span className="flex items-center gap-1"><span className="inline-block w-3.5 h-3.5 rounded-full flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.92)', border: '1.5px solid rgba(196,167,255,0.80)' }}><img src={elfieRobot} alt="" style={{ width: 10, height: 10, objectFit: 'contain' }} /></span> E.L.F.I.E.</span>
                  )}
                </div>
                <div className="flex items-center gap-1 ml-auto">
                  <ZoomIn className="w-3 h-3" />
                  <span>Scroll or pinch to zoom · Drag to pan</span>
                </div>
              </div>
            </div>
          )}

          {/* ── Crops grid ────────────────────────────────────────────────── */}
          {showCrops && activeScan && (activeScan.cropCount ?? 0) > 0 && (
            <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-2">
              <p className="text-xs text-gray-500 mb-2 px-1">
                Raw crops extracted by Brick Spotter — {activeScan.cropCount} regions detected
              </p>
              <div className="grid grid-cols-4 sm:grid-cols-6 sm:grid-cols-8 gap-1.5">
                {Array.from({ length: activeScan.cropCount ?? 0 }, (_, i) => (
                  <div
                    key={i}
                    className="relative aspect-square rounded overflow-hidden bg-gray-800 border border-gray-700 cursor-pointer hover-elevate"
                    onClick={() => setLightboxImage({ src: `/api/brickanalyzer/scan/${activeScan.id}/crop/${i}`, alt: `Crop ${i + 1}` })}
                    data-testid={`crop-thumbnail-${i}`}
                  >
                    <img
                      src={`/api/brickanalyzer/scan/${activeScan.id}/crop/${i}`}
                      alt={`Crop ${i + 1}`}
                      className="w-full h-full object-contain"
                      loading="lazy"
                    />
                    <span className="absolute bottom-0 right-0 bg-black/60 text-white text-[9px] px-0.5 leading-tight">
                      {i + 1}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Calibration Scorecard Panel ──────────────────────────────── */}
          {calibrateMode && showScorecard && calibStats.total > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-950/15 p-3 sm:p-8 space-y-3">
              {/* Header */}
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 sm:w-7 sm:h-7 text-amber-400" />
                <span className="text-sm sm:text-xl font-semibold text-amber-300">Calibration Scorecard</span>
                <button
                  onClick={resetCalibration}
                  className="ml-auto flex items-center gap-1 text-[10px] sm:text-lg text-gray-500 hover:text-gray-300 transition-colors"
                  data-testid="button-reset-calibration"
                >
                  <RefreshCw className="w-3 h-3" />
                  Reset
                </button>
              </div>

              {/* Overall stats */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-green-950/40 border border-green-500/20 p-2 sm:p-5 text-center">
                  <p className="text-lg sm:text-3xl font-bold text-green-400">{calibStats.total > 0 ? Math.round(calibStats.correct / calibStats.total * 100) : 0}%</p>
                  <p className="text-[10px] sm:text-lg text-green-600 font-medium">Accuracy</p>
                  <p className="text-[9px] sm:text-base text-gray-600">{calibStats.correct}/{calibStats.total} correct</p>
                </div>
                <div className="rounded-lg bg-yellow-950/40 border border-yellow-500/20 p-2 sm:p-5 text-center">
                  <p className="text-lg sm:text-3xl font-bold text-yellow-400">{calibStats.close}</p>
                  <p className="text-[10px] sm:text-lg text-yellow-600 font-medium">Close</p>
                  <p className="text-[9px] sm:text-base text-gray-600">right part, wrong color</p>
                </div>
                <div className="rounded-lg bg-red-950/40 border border-red-500/20 p-2 sm:p-5 text-center">
                  <p className="text-lg sm:text-3xl font-bold text-red-400">{calibStats.wrong}</p>
                  <p className="text-[10px] sm:text-lg text-red-600 font-medium">Wrong</p>
                  <p className="text-[9px] sm:text-base text-gray-600">misidentified</p>
                </div>
              </div>

              {/* By round */}
              <div className="space-y-1">
                <p className="text-[10px] sm:text-lg uppercase tracking-wider text-gray-500 font-medium">By Round</p>
                {calibStats.byRound.filter(r => r.total > 0).map(r => {
                  const rd = CALIBRATION_ROUNDS.find(x => x.round === r.round)!;
                  const pct = r.total > 0 ? Math.round(r.correct / r.total * 100) : 0;
                  return (
                    <div key={r.round} className="flex items-center gap-2">
                      <span className={`text-[10px] sm:text-lg font-medium w-40 sm:w-56 truncate ${rd.color}`}>{r.round}. {rd.label}</span>
                      <div className="flex-1 bg-gray-800 rounded-full h-1.5 sm:h-3 overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] sm:text-lg font-mono text-gray-400 w-8 text-right">{pct}%</span>
                      <span className="text-[10px] sm:text-lg text-gray-600 w-12 text-right">{r.correct}/{r.total}</span>
                    </div>
                  );
                })}
              </div>

              {/* By confidence */}
              <div className="space-y-1">
                <p className="text-[10px] sm:text-lg uppercase tracking-wider text-gray-500 font-medium">Confidence Calibration</p>
                <p className="text-[10px] sm:text-lg text-gray-600">How often does each confidence level actually match?</p>
                {calibStats.byConf.filter(c => c.total > 0).map(c => {
                  const pct = c.total > 0 ? Math.round(c.correct / c.total * 100) : 0;
                  const confLabel = c.conf === 'high' ? 'text-green-400' : c.conf === 'medium' ? 'text-yellow-400' : 'text-gray-400';
                  return (
                    <div key={c.conf} className="flex items-center gap-2">
                      <span className={`text-[10px] sm:text-lg font-medium w-14 sm:w-20 capitalize ${confLabel}`}>{c.conf}</span>
                      <div className="flex-1 bg-gray-800 rounded-full h-1.5 sm:h-3 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 70 ? '#22c55e' : pct >= 40 ? '#eab308' : '#ef4444' }} />
                      </div>
                      <span className="text-[10px] sm:text-lg font-mono text-gray-400 w-8 text-right">{pct}%</span>
                      <span className="text-[10px] sm:text-lg text-gray-600 w-12 text-right">{c.correct}/{c.total}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Results — grouped by part number, collapsible list */}
          {groupedResults.length === 0 ? (
            <div className="text-center py-8 sm:py-16 text-gray-500 text-sm sm:text-2xl">
              No pieces could be identified. Try a clearer photo with better lighting.
            </div>
          ) : (
            <div className="space-y-1.5">
              <button
                className="w-full flex items-center justify-between gap-2 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 hover-elevate"
                onClick={() => setResultsListExpanded(v => !v)}
                data-testid="button-results-list-toggle"
              >
                <span className="text-sm sm:text-lg font-medium text-gray-200">
                  Results ({groupedResults.length} piece{groupedResults.length !== 1 ? "s" : ""})
                </span>
                {resultsListExpanded
                  ? <ChevronUp className="w-4 h-4 text-gray-400" />
                  : <ChevronDown className="w-4 h-4 text-gray-400" />
                }
              </button>
              {!resultsListExpanded ? null : (<>
              {dismissedItems.size > 0 && (
                <div className="text-[10px] sm:text-sm text-gray-500 px-1">
                  {dismissedItems.size} removed · {groupedResults.length - dismissedItems.size} showing
                </div>
              )}
              {groupedResults.filter(grp => {
                const rci = grp.entries[0]?.cropIndex ?? null;
                if (dismissedItems.has(`${grp.partNo}__${rci ?? 'x'}`)) return false;
                return true;
              }).map((grp, gi) => {
                const key = grp.partNo || `__unknown_${gi}`;
                const isExpanded = expandedParts.has(key);
                const totalQtyNew = grp.entries.reduce((s, e) => s + e.ourQtyNew, 0);
                const totalQtyUsed = grp.entries.reduce((s, e) => s + e.ourQtyUsed, 0);
                const totalQty = totalQtyNew + totalQtyUsed;
                const stockLabel = (() => {
                  if (totalQtyNew > 0 && totalQtyUsed > 0) return `${totalQtyNew} new · ${totalQtyUsed} used in stock`;
                  if (totalQtyNew > 0) return `${totalQtyNew} new in stock`;
                  if (totalQtyUsed > 0) return `${totalQtyUsed} used in stock`;
                  return null;
                })();
                const repImg = grp.thumbnailUrl;
                const repEntry = grp.entries[0];
                const bestConfidence = grp.entries.some(e => e.confidence === 'high') ? 'high'
                  : grp.entries.some(e => e.confidence === 'medium') ? 'medium' : 'low';

                // Group entries by detected color — one representative per unique color
                const confRank = (c: 'high' | 'medium' | 'low') => c === 'high' ? 2 : c === 'medium' ? 1 : 0;
                const colorGroupMap = new Map<string, ScanResult[]>();
                for (const e of grp.entries) {
                  const ck = e.colorId != null ? `id:${e.colorId}` : `name:${e.colorName || '__none__'}`;
                  if (!colorGroupMap.has(ck)) colorGroupMap.set(ck, []);
                  colorGroupMap.get(ck)!.push(e);
                }
                const detectedColorEntries = Array.from(colorGroupMap.values()).map(group =>
                  group.reduce((best, e) => {
                    const bScore = confRank(best.confidence) * 2 + (best.ourQtyNew + best.ourQtyUsed > 0 ? 1 : 0);
                    const eScore = confRank(e.confidence) * 2 + (e.ourQtyNew + e.ourQtyUsed > 0 ? 1 : 0);
                    return eScore > bScore ? e : best;
                  }, group[0])
                );
                // Keep bestEntry for the collapsed header (thumbnail, overall confidence)
                const bestEntry = detectedColorEntries[0];
                // All detected color IDs — used to exclude from "all known variants" list
                const detectedColorIds = new Set(detectedColorEntries.map(e => e.colorId).filter((id): id is number => id != null));
                // Other inventory colors = catalog variants not already shown as a detected match
                const otherLots = (bestEntry.inventoryLots ?? []).filter(lot => lot.colorId == null || !detectedColorIds.has(lot.colorId));
                const entryScoreColor = (s: number | null) => {
                  if (s === null) return 'text-gray-500';
                  if (s >= 2.0) return 'text-emerald-400';
                  if (s >= 1.5) return 'text-orange-400';
                  if (s >= 1.0) return 'text-yellow-500';
                  return 'text-gray-400';
                };

                const cardId = `result-${grp.partNo || gi}`;
                const isHighlighted = highlightedResult === cardId;
                // Verdict state for this card (for indicator + calibrate bar)
                const cardVKey = `${grp.partNo || `__unk_${gi}`}__${(repEntry.cropIndex ?? 'x')}`;
                const cardVerdict = verdicts[cardVKey] ?? null;
                const swipeKey = cardId;
                const swipeOffset = swipingCard?.key === swipeKey ? swipingCard.offset : 0;
                return (
                  <div
                    key={key}
                    id={cardId}
                    className="rounded-lg border bg-gradient-to-br from-purple-800/20 to-purple-950/10 overflow-hidden"
                    style={{
                      borderColor: isHighlighted ? 'rgba(251,191,36,0.9)' : 'rgba(168,85,247,0.3)',
                      boxShadow: isHighlighted
                        ? '0 0 0 2px rgba(251,191,36,0.6), 0 0 28px 6px rgba(251,191,36,0.35)'
                        : '0 0 12px rgba(168,85,247,0.10)',
                      transform: swipeOffset > 0 ? `translateX(${swipeOffset}px)` : undefined,
                      opacity: swipeOffset > 0 ? Math.max(0.25, 1 - swipeOffset / 160) : 1,
                      transition: swipeOffset > 0 ? 'none' : 'box-shadow 0.3s ease, border-color 0.3s ease, transform 0.2s ease, opacity 0.2s ease',
                    }}
                    onTouchStart={e => handleCardTouchStart(swipeKey, e.touches[0].clientX)}
                    onTouchMove={e => { handleCardTouchMove(swipeKey, e.touches[0].clientX); }}
                    onTouchEnd={() => handleCardTouchEnd(swipeKey)}
                    data-testid={`tile-brickanalyzer-${gi}`}
                  >
                    {/* ── Collapsed header (always visible) ─────────── */}
                    <div
                      className="flex gap-2.5 sm:gap-8 px-2.5 sm:px-8 py-2 sm:py-6 cursor-pointer hover-elevate"
                      onClick={() => togglePart(key)}
                      data-testid={`toggle-part-${gi}`}
                    >
                      {/* Thumbnail */}
                      {(() => {
                        const isMinifig = grp.itemType === 'MINIFIG';
                        // Primary BL CDN URL — colorId-specific for parts, static for minifigs
                        const blColorUrl = grp.partNo
                          ? isMinifig
                            ? `https://img.bricklink.com/ItemImage/MN/0/${grp.partNo}.png`
                            : `https://img.bricklink.com/ItemImage/PN/${repEntry.colorId ?? 0}/${grp.partNo}.png`
                          : null;
                        // Secondary BL CDN URL — part-listing image, no color needed (parts only)
                        const blPlUrl = (grp.partNo && !isMinifig)
                          ? `https://img.bricklink.com/ItemImage/PL/${grp.partNo}.png`
                          : null;
                        const isRebrickable = repImg?.includes('cdn.rebrickable.com');
                        const primarySrc = isRebrickable
                          ? `/api/images/proxy?url=${encodeURIComponent(repImg!)}`
                          : (repImg && repImg.startsWith('https://')) ? repImg : blColorUrl;
                        const lightboxSrc = primarySrc || blPlUrl;
                        return (
                          <div
                            className={`flex-shrink-0 w-12 h-12 sm:w-24 sm:h-24 rounded bg-gray-800/80 flex items-center justify-center overflow-hidden ${lightboxSrc ? 'cursor-pointer hover-elevate' : ''}`}
                            onClick={lightboxSrc ? (e) => { e.stopPropagation(); setLightboxImage({ src: lightboxSrc, alt: grp.partName || grp.partNo }); } : undefined}
                            data-testid={`thumbnail-part-${gi}`}
                          >
                            {(primarySrc || blPlUrl) ? (
                              <img
                                src={primarySrc || blPlUrl!}
                                alt={grp.partName}
                                className="w-full h-full object-contain p-0.5"
                                onError={(e) => {
                                  const el = e.target as HTMLImageElement;
                                  if (blColorUrl && el.src !== blColorUrl) { el.src = blColorUrl; }
                                  else if (blPlUrl && el.src !== blPlUrl) { el.src = blPlUrl; }
                                  else { el.style.display = 'none'; }
                                }}
                              />
                            ) : <Camera className="w-4 h-4 text-gray-700" />}
                          </div>
                        );
                      })()}

                      {/* Info */}
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5 justify-center">
                        {/* Part name + BL link + chevron */}
                        <div className="flex items-center gap-1">
                          <p className="text-xs sm:text-2xl font-semibold text-white leading-tight flex-1">
                            {grp.partName || "Unknown Part"}
                          </p>
                          {grp.itemType === 'MINIFIG' && (
                            <span className="text-[9px] sm:text-lg font-semibold uppercase tracking-wider text-amber-400 bg-amber-900/40 border border-amber-500/30 rounded px-1 py-0.5 flex-shrink-0">Fig</span>
                          )}
                          {grp.entries.some(e => e.detectionSource === 'elfie') && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="flex items-center gap-0.5 text-[9px] sm:text-xs font-semibold text-purple-300 bg-purple-900/50 border border-purple-500/30 rounded px-1 py-0.5 flex-shrink-0 cursor-help" data-testid={`elfie-card-badge-${gi}`}>
                                  <img src={elfieRobot} alt="" className="w-3 h-3 sm:w-4 sm:h-4 object-contain" />
                                  <span className="hidden sm:inline">E.L.F.I.E.</span>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">
                                Identified by E.L.F.I.E. visual search ({(grp.entries.find(e => e.detectionSource === 'elfie')?.note) || 'CLIP'})
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {grp.partNo && (
                            <a
                              href={`https://www.bricklink.com/v2/catalog/catalogitem.page?${grp.itemType === 'MINIFIG' ? 'M' : 'P'}=${grp.partNo}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-lego-blue hover:text-blue-300 flex-shrink-0"
                              data-testid={`link-bricklink-${gi}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="w-3 h-3 sm:w-7 sm:h-7" />
                            </a>
                          )}
                          {grp.partNo && grp.itemType !== 'MINIFIG' && repEntry.categoryId != null && MINIFIG_PART_CATEGORY_IDS.has(repEntry.categoryId) && (
                            <a
                              href={`https://www.bricklink.com/catalogItemIn.asp?P=${grp.partNo}&in=M`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[9px] sm:text-base font-semibold text-amber-400 hover:text-amber-300 flex-shrink-0 whitespace-nowrap"
                              data-testid={`link-appears-in-${gi}`}
                              onClick={(e) => e.stopPropagation()}
                              title="See which minifigures contain this part"
                            >
                              Appears In
                            </a>
                          )}
                          <ChevronRight
                            className={`w-3.5 h-3.5 sm:w-7 sm:h-7 text-gray-500 flex-shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                          />
                          {/* Calibrated indicator — shown when a verdict has been recorded */}
                          {cardVerdict && (
                            <span
                              className={`flex-shrink-0 w-2 h-2 sm:w-3 sm:h-3 rounded-full ${
                                cardVerdict === 'correct' ? 'bg-green-400' :
                                cardVerdict === 'close'   ? 'bg-yellow-400' :
                                                            'bg-red-400'
                              }`}
                              title={`Calibration: ${cardVerdict}`}
                            />
                          )}
                          {/* Heatmap indicator — opens photo with this piece highlighted */}
                          {repEntry.cropIndex != null && (
                            <button
                              className="flex-shrink-0 text-gray-600 hover:text-teal-400 transition-colors"
                              title="Highlight in scan photo"
                              onClick={e => {
                                e.stopPropagation();
                                setHeatmapCropFocus(heatmapCropFocus === repEntry.cropIndex ? null : repEntry.cropIndex!);
                                setFocusedDetailCropIndex(null);
                              }}
                              data-testid={`heatmap-btn-${gi}`}
                            >
                              <Target className="w-3 h-3 sm:w-5 sm:h-5" />
                            </button>
                          )}
                        </div>

                        {/* Part no · qty · confidence · crop count */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {grp.partNo && <span className="font-mono text-[10px] sm:text-xl text-gray-300">{grp.partNo}</span>}
                          {stockLabel && (
                            <span className="text-[10px] sm:text-xl text-green-400 font-medium">· {stockLabel}</span>
                          )}
                          <span className={`text-[10px] sm:text-xl font-medium capitalize ${confidenceColor(bestConfidence)}`}>
                            · {bestConfidence}
                          </span>
                          {grp.entries.length > 1 && (
                            <span className="text-[10px] sm:text-xl text-gray-500">· {grp.entries.length} crops</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ── Calibration verdict bar ── */}
                    {calibrateMode && (() => {
                      const vKey = `${grp.partNo || `__unk_${gi}`}__${(repEntry.cropIndex ?? 'x')}`;
                      const currentVerdict = verdicts[vKey];
                      const repCropIndex = repEntry.cropIndex ?? null;
                      const clipKey = `${grp.partNo}__${repCropIndex}`;
                      const isConfirmed = confirmedClips.has(clipKey);
                      const isConfirming = confirmingClip === clipKey;
                      return (
                        <div className="border-t border-amber-500/15 px-2.5 sm:px-8 py-2 sm:py-3 flex flex-wrap items-center gap-3 sm:gap-3" onClick={e => e.stopPropagation()}>
                          {/* CLIP (correct) */}
                          {grp.partNo && repCropIndex != null && (
                            isConfirmed ? (
                              <span className="flex items-center gap-1 text-[10px] sm:text-base text-purple-400">
                                <Check className="w-3 h-3 sm:w-4 sm:h-4" />
                                <span className="text-[10px]">CLIP</span>
                              </span>
                            ) : (
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  setPendingClipConfirm({
                                    partNo: grp.partNo, partName: grp.partName, confidence: bestConfidence,
                                    colorId: repEntry.colorId ?? null, colorName: repEntry.colorName ?? null,
                                    colorRgb: repEntry.colorRgb ?? null,
                                    cropIndex: repCropIndex, itemType: grp.itemType ?? 'PART',
                                  });
                                }}
                                disabled={isConfirming}
                                title="Correct — add to CLIP catalog"
                                className={`flex items-center justify-center w-10 h-10 sm:w-10 sm:h-10 rounded-full transition-colors disabled:opacity-50 ${currentVerdict === 'correct' ? 'bg-purple-600 text-white' : 'border border-purple-500/50 text-purple-400 hover:bg-purple-900/40'}`}
                                data-testid={`confirm-clip-${gi}`}
                              >
                                {isConfirming ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3 sm:w-4 sm:h-4" />}
                              </button>
                            )
                          )}
                          {/* Close (right part, wrong color) */}
                          <button
                            onClick={e => { e.stopPropagation(); handleVerdict(grp.partNo, grp.partName, bestConfidence, repCropIndex, 'close'); }}
                            title="Close — right part, wrong color"
                            className={`flex items-center justify-center w-10 h-10 sm:w-10 sm:h-10 rounded-full transition-colors ${currentVerdict === 'close' ? 'bg-yellow-600 text-white' : 'border border-yellow-600/40 text-yellow-500 hover:bg-yellow-900/40'}`}
                            data-testid={`verdict-close-${gi}`}
                          >
                            <Minus className="w-4 h-4 sm:w-4 sm:h-4" />
                          </button>
                          {/* Wrong (misidentified) */}
                          <button
                            onClick={e => { e.stopPropagation(); handleVerdict(grp.partNo, grp.partName, bestConfidence, repCropIndex, 'wrong'); }}
                            title="Wrong — misidentified"
                            className={`flex items-center justify-center w-10 h-10 sm:w-10 sm:h-10 rounded-full transition-colors ${currentVerdict === 'wrong' ? 'bg-red-600 text-white' : 'border border-red-600/40 text-red-500 hover:bg-red-900/40'}`}
                            data-testid={`verdict-wrong-${gi}`}
                          >
                            <ThumbsDown className="w-4 h-4 sm:w-4 sm:h-4" />
                          </button>
                          {/* Spacer + swipe hint */}
                          <span className="ml-auto text-[9px] text-gray-600 select-none">swipe → to remove</span>

                          {/* ── Color correction picker — visible when verdict is Close ── */}
                          {currentVerdict === 'close' && (() => {
                            // Only require colorId + colorName — colorRgb is optional (used for sort/preview only)
                            const lots = (repEntry.inventoryLots ?? []).filter(l => l.colorId != null && (l.colorName ?? '').length > 0);
                            const detectedHex = repEntry.colorRgb ?? '';
                            // Sort by color distance when a detected color is available.
                            // Lots without colorRgb get a large penalty so they sort to the bottom.
                            // When no detected color, sort alphabetically.
                            const sorted = [...lots].sort((a, b) => {
                              if (detectedHex) {
                                const dA = a.colorRgb ? colorDeltaE(a.colorRgb, detectedHex) : 9999;
                                const dB = b.colorRgb ? colorDeltaE(b.colorRgb, detectedHex) : 9999;
                                return dA - dB;
                              }
                              return (a.colorName ?? '').localeCompare(b.colorName ?? '');
                            });
                            const correctedKey = `${grp.partNo}__${repCropIndex ?? 'x'}`;
                            const corrected = colorCorrectedClips.get(correctedKey);
                            return (
                              <div
                                className="w-full basis-full mt-1 pt-1.5 border-t border-yellow-500/20"
                                data-testid={`color-picker-${gi}`}
                                onClick={e => e.stopPropagation()}
                              >
                                <p className="text-[9px] sm:text-sm mb-1.5 font-medium">
                                  {corrected
                                    ? <span className="flex items-center gap-1 text-green-400"><Check className="w-2.5 h-2.5" />Correct — tap a different color to retrain</span>
                                    : <span className="text-yellow-400/80">Tap the correct color:</span>}
                                </p>
                                <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto rounded-md border border-yellow-500/20 bg-black/30">
                                  {/* "Color not found" always first */}
                                  <button
                                    type="button"
                                    data-testid={`color-not-found-${gi}`}
                                    disabled={isConfirming}
                                    onClick={e => {
                                      e.stopPropagation();
                                      setColorCorrectedClips(prev => { const m = new Map(prev); m.delete(correctedKey); return m; });
                                      handleVerdict(grp.partNo, grp.partName, bestConfidence, repCropIndex, 'close');
                                      markItemScored(`${grp.partNo}__${repCropIndex ?? 'x'}`);
                                    }}
                                    className={`flex items-center gap-2 w-full text-left px-2.5 py-2 text-xs sm:text-sm disabled:opacity-40 transition-colors
                                      ${!corrected ? 'bg-yellow-900/40 text-yellow-300 font-semibold' : 'text-gray-400 hover:bg-white/5'}`}
                                  >
                                    <span className="w-3 h-3 rounded-sm border border-white/20 bg-gray-600 flex-shrink-0" />
                                    Color not found
                                  </button>
                                  {sorted.map(lot => {
                                    const isSelected = corrected?.colorId === lot.colorId;
                                    const dE = lot.colorRgb ? colorDeltaE(lot.colorRgb, detectedHex) : null;
                                    const confPct = dE != null ? colorConfPct(dE) : null;
                                    const confLbl = confPct != null ? colorConfLabel(confPct) : null;
                                    return (
                                      <button
                                        type="button"
                                        key={lot.colorId}
                                        data-testid={`color-btn-${gi}-${lot.colorId}`}
                                        disabled={isConfirming}
                                        onClick={e => {
                                          e.stopPropagation();
                                          handleColorCorrection(grp.partNo, grp.partName, bestConfidence, lot.colorId!, lot.colorName ?? String(lot.colorId), repCropIndex, grp.itemType ?? 'PART');
                                        }}
                                        className={`flex items-center gap-2 w-full text-left px-2.5 py-2 text-xs sm:text-sm disabled:opacity-40 transition-colors
                                          ${isSelected ? 'bg-green-900/40 text-green-300 font-semibold' : 'text-gray-200 hover:bg-white/5'}`}
                                      >
                                        <span
                                          className="w-3 h-3 rounded-sm border border-white/20 flex-shrink-0"
                                          style={{ backgroundColor: lot.colorRgb ? `#${lot.colorRgb}` : '#555' }}
                                        />
                                        <span className="flex-1 truncate">{lot.colorName ?? `Color ${lot.colorId}`}</span>
                                        {confPct != null && confLbl != null && (
                                          <span className={`text-[10px] flex-shrink-0 font-medium ${confLbl.cls}`}>{confPct}%</span>
                                        )}
                                        {isSelected && <Check className="w-3 h-3 text-green-400 flex-shrink-0" />}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })()}

                    {/* ── Expanded: sub-tabs + content ── */}
                    {isExpanded && (
                      <div className="border-t border-purple-500/10">
                        {/* Sub-tab bar */}
                        <div className="flex border-b border-purple-500/10 px-2 sm:px-8 pt-1.5 gap-1" onClick={e => e.stopPropagation()}>
                          {(['matches', 'inventory'] as const).map(tab => {
                            const activeTab = expandedCardTab[key] ?? 'matches';
                            return (
                              <button
                                key={tab}
                                onClick={e => { e.stopPropagation(); setExpandedCardTab(prev => ({ ...prev, [key]: tab })); }}
                                className={`px-3 py-1.5 text-[10px] sm:text-sm font-medium rounded-t-md transition-colors border-b-2 -mb-px ${
                                  activeTab === tab
                                    ? 'border-purple-400 text-purple-300'
                                    : 'border-transparent text-gray-500 hover:text-gray-300'
                                }`}
                              >
                                {tab === 'matches' ? 'Best Matches' : 'My Inventory'}
                              </button>
                            );
                          })}
                        </div>

                      {(expandedCardTab[key] ?? 'matches') === 'matches' && (
                      <div className="px-2 sm:px-8 py-1.5 sm:py-5 space-y-1 sm:space-y-5">
                        {/* Column headers */}
                        <div className="flex items-center gap-1 px-2 pb-0.5">
                          <div className="flex-1 min-w-0">
                            <span className="text-[9px] sm:text-lg uppercase tracking-wider text-gray-500">{grp.itemType === 'MINIFIG' ? 'Minifigure' : 'Color'}</span>
                          </div>
                          <span className="text-[9px] sm:text-lg uppercase tracking-wider text-gray-500 w-14 sm:w-24 text-right flex-shrink-0">N Cur</span>
                          <span className="text-[9px] sm:text-lg uppercase tracking-wider text-gray-500 w-[58px] sm:w-20 text-right flex-shrink-0">N Score</span>
                          <span className="text-[9px] sm:text-lg uppercase tracking-wider text-gray-500 w-14 sm:w-24 text-right flex-shrink-0">U Cur</span>
                          <span className="text-[9px] sm:text-lg uppercase tracking-wider text-gray-500 w-[58px] sm:w-20 text-right flex-shrink-0">U Score</span>
                        </div>
                        {/* Best Match banners — one per unique detected color */}
                        {detectedColorEntries.map((entry, ei) => {
                          const peak = Math.max(entry.marketSoldMaxNew ?? 0, entry.marketSoldMaxUsed ?? 0, entry.stockAvgPriceN ?? 0) || null;
                          const nScore = peak && entry.ourPriceNew && entry.ourPriceNew > 0 ? Number((peak / entry.ourPriceNew).toFixed(2)) : null;
                          const uScore = peak && entry.ourPriceUsed && entry.ourPriceUsed > 0 ? Number((peak / entry.ourPriceUsed).toFixed(2)) : null;
                          const inStock = (entry.ourQtyNew + entry.ourQtyUsed) > 0;
                          return (
                            <div key={ei} className="rounded-lg border border-purple-500/40 bg-purple-900/25 px-2 sm:px-6 py-1.5 sm:py-4">
                              {(() => {
                                const refHex = repEntry.colorRgb ?? '';
                                const entryHex = entry.colorRgb ?? '';
                                const colorDe = (refHex && entryHex && refHex !== entryHex)
                                  ? colorDeltaE(entryHex, refHex) : null;
                                const colorPct = colorDe != null ? colorConfPct(colorDe) : null;
                                const colorLbl = colorPct != null ? colorConfLabel(colorPct) : null;
                                return (
                                  <div className="flex items-center gap-1 mb-1 flex-wrap">
                                    <Sparkles className="w-3 h-3 sm:w-6 sm:h-6 text-purple-400 flex-shrink-0" />
                                    <span className="text-[9px] sm:text-lg uppercase tracking-wider text-purple-400 font-semibold">Best Match</span>
                                    <span className={`ml-1 text-[9px] sm:text-lg font-medium capitalize ${confidenceColor(entry.confidence)}`}>
                                      · {entry.confidence} id
                                    </span>
                                    {colorPct != null && colorLbl != null && (
                                      <span className={`text-[9px] sm:text-lg font-medium ${colorLbl.cls}`}>
                                        · {colorPct}% color match
                                      </span>
                                    )}
                                    {entry.cropIndex != null && (
                                      <span className="ml-auto text-[9px] sm:text-lg font-mono text-gray-500 flex-shrink-0">crop #{entry.cropIndex + 1}</span>
                                    )}
                                  </div>
                                );
                              })()}
                              <div className="flex items-center gap-1 min-w-0">
                                <div className="flex flex-col flex-1 min-w-0">
                                  <div className="flex items-center gap-1 min-w-0">
                                    {inStock && <Check className="w-3 h-3 sm:w-6 sm:h-6 text-emerald-400 flex-shrink-0" />}
                                    {inStock && <span className="text-[10px] sm:text-xl font-mono text-gray-200 flex-shrink-0">×{entry.ourQtyNew + entry.ourQtyUsed}</span>}
                                    {grp.itemType !== 'MINIFIG' && (entry.colorRgb ? (
                                      <span className="w-2.5 h-2.5 sm:w-5 sm:h-5 rounded-full flex-shrink-0 border border-gray-500" style={{ backgroundColor: `#${entry.colorRgb}` }} />
                                    ) : (
                                      <span className="w-2.5 h-2.5 sm:w-5 sm:h-5 rounded-full flex-shrink-0 bg-gray-600" />
                                    ))}
                                    <span className="text-[10px] sm:text-xl text-white font-medium truncate">
                                      {grp.itemType === 'MINIFIG' ? (entry.partName || grp.partName) : (entry.colorName || '—')}
                                    </span>
                                  </div>
                                  {peak ? (
                                    <button
                                      className="text-[9px] sm:text-lg pl-0.5 text-purple-400 hover:text-purple-300 underline decoration-dotted cursor-pointer bg-transparent border-none p-0"
                                      onClick={e => { e.stopPropagation(); setPricePopupTarget({ partNo: grp.partNo, itemType: grp.itemType, colorId: entry.colorId ?? null, colorName: entry.colorName || '', myQtyNew: entry.ourQtyNew, myPriceNew: entry.ourPriceNew, myQtyUsed: entry.ourQtyUsed, myPriceUsed: entry.ourPriceUsed }); }}
                                      title="View full POM pricing"
                                    >peak ${peak.toFixed(2)}</button>
                                  ) : null}
                                </div>
                                <span className="text-[10px] sm:text-xl font-mono text-gray-200 w-14 sm:w-24 text-right flex-shrink-0">
                                  {entry.ourPriceNew != null ? `$${entry.ourPriceNew.toFixed(2)}` : '—'}
                                </span>
                                <span className={`text-[10px] sm:text-xl font-mono font-bold w-[58px] sm:w-20 text-right flex-shrink-0 ${entryScoreColor(nScore)}`}>
                                  {nScore != null ? `${nScore}×` : '—'}
                                </span>
                                <span className="text-[10px] sm:text-xl font-mono text-gray-200 w-14 sm:w-24 text-right flex-shrink-0">
                                  {entry.ourPriceUsed != null ? `$${entry.ourPriceUsed.toFixed(2)}` : '—'}
                                </span>
                                <span className={`text-[10px] sm:text-xl font-mono font-bold w-[58px] sm:w-20 text-right flex-shrink-0 ${entryScoreColor(uScore)}`}>
                                  {uScore != null ? `${uScore}×` : '—'}
                                </span>
                              </div>
                            </div>
                          );
                        })}

                        {/* All known color variants — sorted + filtered by color confidence */}
                        {(() => {
                          const refHex = repEntry.colorRgb ?? '';
                          // Annotate each lot with its color confidence vs the detected color
                          const annotated = otherLots.map(lot => {
                            const dE = (refHex && lot.colorRgb) ? colorDeltaE(lot.colorRgb, refHex) : null;
                            const pct = dE != null ? colorConfPct(dE) : null;
                            return { lot, dE, pct };
                          });
                          // Sort: highest confidence first; lots without colorRgb go last
                          const sorted = [...annotated].sort((a, b) => {
                            if (a.pct != null && b.pct != null) return b.pct - a.pct;
                            if (a.pct != null) return -1;
                            if (b.pct != null) return 1;
                            return 0;
                          });
                          // Filter out lots below the cutoff when we have a detected color
                          const visible = refHex
                            ? sorted.filter(({ pct }) => pct == null || pct >= COLOR_CONF_CUTOFF)
                            : sorted;
                          const hiddenCount = sorted.length - visible.length;
                          if (visible.length === 0) return null;
                          return (
                          <div className="space-y-0.5 sm:space-y-3">
                            <div className="flex items-center gap-1 px-2 pb-0.5 pt-1.5">
                              <div className="flex-1 min-w-0 flex items-center gap-1.5">
                                <span className="text-[9px] sm:text-lg uppercase tracking-wider text-gray-500">Other color variants</span>
                                {hiddenCount > 0 && (
                                  <span className="text-[9px] sm:text-sm text-gray-600">({hiddenCount} below cutoff hidden)</span>
                                )}
                              </div>
                              <span className="text-[9px] sm:text-lg uppercase tracking-wider text-gray-500 w-14 sm:w-24 text-right flex-shrink-0">N Cur</span>
                              <span className="text-[9px] sm:text-lg uppercase tracking-wider text-gray-500 w-[58px] sm:w-20 text-right flex-shrink-0">N Score</span>
                              <span className="text-[9px] sm:text-lg uppercase tracking-wider text-gray-500 w-14 sm:w-24 text-right flex-shrink-0">U Cur</span>
                              <span className="text-[9px] sm:text-lg uppercase tracking-wider text-gray-500 w-[58px] sm:w-20 text-right flex-shrink-0">U Score</span>
                            </div>
                            {visible.map(({ lot, pct }, li) => {
                              const lotInStock = (lot.qtyNew + lot.qtyUsed) > 0;
                              const lotPeak = Math.max(lot.peakNew ?? 0, lot.peakUsed ?? 0) || null;
                              const lotNScore = lotPeak && lot.priceNew && lot.priceNew > 0
                                ? Number((lotPeak / lot.priceNew).toFixed(2)) : null;
                              const lotUScore = lotPeak && lot.priceUsed && lot.priceUsed > 0
                                ? Number((lotPeak / lot.priceUsed).toFixed(2)) : null;
                              const confLbl = pct != null ? colorConfLabel(pct) : null;
                              return (
                                <div
                                  key={li}
                                  className="bg-gray-900/50 border border-gray-700/60 rounded-lg px-2 sm:px-6 py-1.5 sm:py-4"
                                  data-testid={`lot-${gi}-${li}`}
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    {lot.imageUrl ? (
                                      <img
                                        src={lot.imageUrl}
                                        alt={lot.colorName || ''}
                                        className="w-6 h-6 sm:w-14 sm:h-14 object-contain rounded flex-shrink-0 bg-gray-800"
                                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                      />
                                    ) : (
                                      <div className="w-6 h-6 sm:w-14 sm:h-14 flex-shrink-0 rounded bg-gray-800" />
                                    )}
                                    <div className="flex flex-col flex-1 min-w-0">
                                      <div className="flex items-center gap-1 min-w-0">
                                        {lotInStock && <Check className="w-3 h-3 sm:w-6 sm:h-6 text-emerald-400 flex-shrink-0" />}
                                        {lotInStock && <span className="text-[10px] sm:text-xl font-mono text-gray-200 flex-shrink-0">×{lot.qtyNew + lot.qtyUsed}</span>}
                                        {lot.colorRgb ? (
                                          <span className="w-2.5 h-2.5 sm:w-5 sm:h-5 rounded-full flex-shrink-0 border border-gray-500" style={{ backgroundColor: `#${lot.colorRgb}` }} />
                                        ) : (
                                          <span className="w-2.5 h-2.5 sm:w-5 sm:h-5 rounded-full flex-shrink-0 bg-gray-600" />
                                        )}
                                        <span className={`text-[10px] sm:text-xl truncate ${lotInStock ? 'text-gray-100' : 'text-gray-400'}`}>{lot.colorName || '—'}</span>
                                      </div>
                                      <div className="flex items-center gap-1.5 pl-0.5">
                                        {lotPeak && (
                                          <button
                                            className="text-[9px] sm:text-lg text-purple-400 hover:text-purple-300 underline decoration-dotted cursor-pointer bg-transparent border-none p-0"
                                            onClick={e => { e.stopPropagation(); setPricePopupTarget({ partNo: grp.partNo, itemType: grp.itemType, colorId: lot.colorId ?? null, colorName: lot.colorName || '', myQtyNew: lot.qtyNew, myPriceNew: lot.priceNew, myQtyUsed: lot.qtyUsed, myPriceUsed: lot.priceUsed }); }}
                                            title="View full POM pricing"
                                          >peak ${lotPeak.toFixed(2)}</button>
                                        )}
                                        {confLbl && pct != null && (
                                          <span className={`text-[9px] sm:text-lg font-medium ${confLbl.cls}`}>
                                            {confLbl.label} ({pct}%)
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <span className="text-[10px] sm:text-xl font-mono text-gray-200 w-14 sm:w-24 text-right flex-shrink-0">
                                      {lot.priceNew != null ? `$${lot.priceNew.toFixed(2)}` : '—'}
                                    </span>
                                    <span className={`text-[10px] sm:text-xl font-mono font-bold w-[58px] sm:w-20 text-right flex-shrink-0 ${entryScoreColor(lotNScore)}`}>
                                      {lotNScore != null ? `${lotNScore}×` : '—'}
                                    </span>
                                    <span className="text-[10px] sm:text-xl font-mono text-gray-200 w-14 sm:w-24 text-right flex-shrink-0">
                                      {lot.priceUsed != null ? `$${lot.priceUsed.toFixed(2)}` : '—'}
                                    </span>
                                    <span className={`text-[10px] sm:text-xl font-mono font-bold w-[58px] sm:w-20 text-right flex-shrink-0 ${entryScoreColor(lotUScore)}`}>
                                      {lotUScore != null ? `${lotUScore}×` : '—'}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>);
                        })()}
                      </div>
                      )}

                      {/* ── My Inventory tab ── */}
                      {(expandedCardTab[key] ?? 'matches') === 'inventory' && (
                        <div className="px-2 sm:px-8 py-2 sm:py-5 space-y-1.5">
                          {(() => {
                            // Collect all lots across all entries for this group
                            const allLots = grp.entries.flatMap(e => e.inventoryLots ?? []).filter(l => l.colorId != null);
                            const inStockLots = allLots.filter(l => (l.qtyNew + l.qtyUsed) > 0);
                            if (inStockLots.length === 0) {
                              return (
                                <div className="flex flex-col items-center gap-2 py-6 text-center">
                                  <span className="text-gray-600 text-xs sm:text-sm">Not in inventory</span>
                                  <span className="text-gray-700 text-[10px] sm:text-xs">You don't currently stock this part. Calibrating it still improves scan accuracy for when you do.</span>
                                </div>
                              );
                            }
                            return inStockLots.map((lot, li) => {
                              const peakVal = Math.max(lot.peakNew ?? 0, lot.peakUsed ?? 0) || null;
                              return (
                                <div key={li} className="flex items-center gap-2 bg-gray-900/50 border border-gray-700/60 rounded-lg px-2 sm:px-4 py-1.5 sm:py-3">
                                  {lot.colorRgb ? (
                                    <span className="w-3 h-3 sm:w-5 sm:h-5 rounded-full flex-shrink-0 border border-gray-500" style={{ backgroundColor: `#${lot.colorRgb}` }} />
                                  ) : (
                                    <span className="w-3 h-3 sm:w-5 sm:h-5 rounded-full flex-shrink-0 bg-gray-600" />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[10px] sm:text-sm text-white font-medium truncate">{lot.colorName ?? '—'}</p>
                                    {peakVal && (
                                      <button
                                        className="text-[9px] sm:text-xs text-purple-400 hover:text-purple-300 underline decoration-dotted cursor-pointer bg-transparent border-none p-0 text-left"
                                        onClick={e => { e.stopPropagation(); setPricePopupTarget({ partNo: grp.partNo, itemType: grp.itemType, colorId: lot.colorId ?? null, colorName: lot.colorName ?? '', myQtyNew: lot.qtyNew, myPriceNew: lot.priceNew, myQtyUsed: lot.qtyUsed, myPriceUsed: lot.priceUsed }); }}
                                        title="View full POM pricing"
                                      >peak ${peakVal.toFixed(2)}</button>
                                    )}
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <div className="flex items-center gap-1.5 justify-end">
                                      {lot.qtyNew > 0 && <span className="text-[10px] sm:text-sm text-emerald-400 font-mono">×{lot.qtyNew} N</span>}
                                      {lot.qtyUsed > 0 && <span className="text-[10px] sm:text-sm text-blue-400 font-mono">×{lot.qtyUsed} U</span>}
                                    </div>
                                    <div className="flex items-center gap-1.5 justify-end mt-0.5">
                                      {lot.priceNew != null && <span className="text-[10px] sm:text-xs text-gray-300 font-mono">${lot.priceNew.toFixed(2)} N</span>}
                                      {lot.priceUsed != null && <span className="text-[10px] sm:text-xs text-gray-400 font-mono">${lot.priceUsed.toFixed(2)} U</span>}
                                    </div>
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      )}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setUiState("idle"); setScanId(null); }}
                  data-testid="button-brickanalyzer-new-scan-bottom"
                >
                  New Scan
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 text-lego-red border-lego-red/40"
                  onClick={() => dismissMutation.mutate()}
                  disabled={dismissMutation.isPending}
                  data-testid="button-brickanalyzer-dismiss-bottom"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Close &amp; Delete Results
                </Button>
              </div>
              </>)}
            </div>
          )}

        </div>
      )}

    {/* ── CLIP confirmation popup ─────────────────────────────────────── */}
    <Dialog open={!!pendingClipConfirm} onOpenChange={open => { if (!open) setPendingClipConfirm(null); }}>
      <DialogContent className="max-w-sm w-full bg-gray-950 border-gray-700 p-5 flex flex-col gap-4">
        <p className="text-sm font-semibold text-white">Add to CLIP catalog?</p>
        {pendingClipConfirm && (
          <>
            <div className="flex items-center gap-3 bg-purple-900/20 border border-purple-500/20 rounded-md px-3 py-2.5">
              {pendingClipConfirm.colorRgb && (
                <div className="w-6 h-6 rounded-sm border border-white/20 flex-shrink-0"
                  style={{ backgroundColor: `#${pendingClipConfirm.colorRgb}` }} />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white truncate">{pendingClipConfirm.partName || pendingClipConfirm.partNo}</p>
                <p className="text-xs text-gray-400">
                  {pendingClipConfirm.partNo}
                  {pendingClipConfirm.colorName && <span className="ml-2 text-gray-300">· {pendingClipConfirm.colorName}</span>}
                </p>
              </div>
            </div>
            <p className="text-xs text-gray-500">This scan photo will be saved as a visual reference. Future scans that see a similar piece will match it more accurately.</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setPendingClipConfirm(null)}
                data-testid="clip-confirm-cancel-dialog"
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-purple-600 hover:bg-purple-500 text-white"
                disabled={!!confirmingClip}
                onClick={() => {
                  const p = pendingClipConfirm;
                  setPendingClipConfirm(null);
                  handleConfirmToClip(p.partNo, p.partName, p.confidence, p.colorId, p.cropIndex, p.itemType);
                }}
                data-testid="clip-confirm-yes-dialog"
              >
                {confirmingClip ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ThumbsUp className="w-4 h-4 mr-1" />}
                Add to CLIP
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>


    {/* Lightbox */}
    <Dialog open={!!lightboxImage} onOpenChange={(open) => { if (!open) setLightboxImage(null); }}>
      <DialogContent className="max-w-lg p-2 bg-gray-950 border-gray-700 flex items-center justify-center">
        {lightboxImage && (
          <img
            src={lightboxImage.src}
            alt={lightboxImage.alt}
            className="max-w-full max-h-[80vh] object-contain rounded"
          />
        )}
      </DialogContent>
    </Dialog>

    {/* POM price detail popup */}
    {pricePopupTarget && (
      <PomPriceDialog
        target={pricePopupTarget}
        onClose={() => setPricePopupTarget(null)}
      />
    )}

    </div>
  );
});

export default BrickanalyzerTool;

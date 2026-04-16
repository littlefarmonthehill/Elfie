import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Info, Flag, ChevronUp, ChevronDown, ChevronsUpDown, Check, X,
  Search, Plus, Printer, Loader2, Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QRCodeSVG } from "qrcode.react";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────
interface PriorityCategory {
  id: number;
  name: string;
  sortingPhase: string | null;
  flagged: boolean;
  currentQty: number;
  totalSold: number;
  soldOutLots: number;
  totalLots: number;
  basePhaseScore: number;
  sellThroughPct: number;
  soldOutSharePct: number;
  effectivePhaseScore: number;
  score: number;
}

interface SampleItem {
  id: number;
  itemNo: string;
  itemName: string | null;
  colorName: string | null;
  quantity: number;
  unitPrice: string | null;
  thumbnailUrl: string | null;
}

interface FileLotCounts {
  unassignedLots: number;
  filingQueueLots: number;
  total: number;
}

interface PriorityResponse {
  categories: PriorityCategory[];
  phaseScores: Record<string, number>;
  fileLotCounts: FileLotCounts;
}

interface LotItem {
  id: number;
  itemNo: string;
  itemName: string | null;
  colorName: string | null;
  newOrUsed: string | null;
  quantity: number | null;
  binName: string | null;
  shelfName: string | null;
  aisleName: string | null;
  assigned: boolean;
  isFilingQueue: boolean;
}

type LotFilter = 'all' | 'assigned' | 'unassigned' | 'filing-queue';

// ── Label templates ────────────────────────────────────────────────────────────
type LotLabelKey =
  | 'avery5160' | 'avery5163' | 'avery5164'
  | 'brotherDK1201' | 'brotherDK2210' | 'brotherDK1209';

interface LotLabelTemplate {
  name: string;
  desc: string;
  w: string; h: string;
  perSheet: number; cols: number;
  pageMarginV: string; pageMarginH: string;
  colGap: string; rowGap: string;
  qrPx: number;
  previewH: string; previewQr: number;
  mode: 'sheet' | 'brother';
  group: string;
}

const LOT_LABEL_TEMPLATES: Record<LotLabelKey, LotLabelTemplate> = {
  // ── Sheet labels (Avery) ────────────────────────────────────────────────────
  avery5160: {
    name: 'Avery 5160 / 8160', desc: '1" × 2⅝" · 30 per sheet',
    w: '2.625in', h: '1in', cols: 3, perSheet: 30,
    pageMarginV: '0.5in', pageMarginH: '0.1875in', colGap: '0.125in', rowGap: '0in',
    qrPx: 48, previewH: 'h-10', previewQr: 32, mode: 'sheet', group: 'Sheet labels (Avery)',
  },
  avery5163: {
    name: 'Avery 5163 / 8163', desc: '2" × 4" · 10 per sheet',
    w: '4in', h: '2in', cols: 2, perSheet: 10,
    pageMarginV: '0.5in', pageMarginH: '0.15625in', colGap: '0.1875in', rowGap: '0in',
    qrPx: 88, previewH: 'h-16', previewQr: 52, mode: 'sheet', group: 'Sheet labels (Avery)',
  },
  avery5164: {
    name: 'Avery 5164 / 8164', desc: '3⅓" × 4" · 6 per sheet',
    w: '4in', h: '3.333in', cols: 2, perSheet: 6,
    pageMarginV: '0.5in', pageMarginH: '0.15625in', colGap: '0.1875in', rowGap: '0in',
    qrPx: 140, previewH: 'h-24', previewQr: 72, mode: 'sheet', group: 'Sheet labels (Avery)',
  },
  // ── Brother QL-810W ─────────────────────────────────────────────────────────
  brotherDK1201: {
    name: 'Brother DK-1201', desc: '1⅛" × 3½" standard address',
    w: '3.5in', h: '1.125in', cols: 1, perSheet: 1,
    pageMarginV: '0.06in', pageMarginH: '0.06in', colGap: '0in', rowGap: '0in',
    qrPx: 64, previewH: 'h-10', previewQr: 42, mode: 'brother', group: 'Brother QL-810W',
  },
  brotherDK2210: {
    name: 'Brother DK-2210', desc: '1⅛" wide continuous tape',
    w: '4in', h: '1.125in', cols: 1, perSheet: 1,
    pageMarginV: '0.06in', pageMarginH: '0.06in', colGap: '0in', rowGap: '0in',
    qrPx: 64, previewH: 'h-10', previewQr: 42, mode: 'brother', group: 'Brother QL-810W',
  },
  brotherDK1209: {
    name: 'Brother DK-1209', desc: '⅞" × 1⅝" small address',
    w: '1.625in', h: '0.875in', cols: 1, perSheet: 1,
    pageMarginV: '0.04in', pageMarginH: '0.04in', colGap: '0in', rowGap: '0in',
    qrPx: 44, previewH: 'h-9', previewQr: 28, mode: 'brother', group: 'Brother QL-810W',
  },
};

const LOT_LABEL_GROUPS: { groupName: string; keys: LotLabelKey[] }[] = [
  { groupName: 'Sheet labels (Avery)',  keys: ['avery5160', 'avery5163', 'avery5164'] },
  { groupName: 'Brother QL-810W',       keys: ['brotherDK1201', 'brotherDK2210', 'brotherDK1209'] },
];

// ── Categories tab config ──────────────────────────────────────────────────────
const PHASES = ['category', 'subcategory', 'finalsort', 'listing', 'file'] as const;
type PhaseKey = typeof PHASES[number];

const PHASE_CONFIG: Record<PhaseKey, {
  label: string; textColor: string; borderColor: string; bgColor: string;
  tileBorder: string; tileBg: string; tileShadow: string; tileHover: string;
}> = {
  category:    { label: "Category",    textColor: "text-amber-400",   borderColor: "border-amber-500/40",   bgColor: "bg-amber-500/10",   tileBorder: "border-amber-600/60",   tileBg: "bg-gradient-to-br from-amber-800/35 via-amber-950/25 to-slate-900/70",   tileShadow: "shadow-[0_2px_10px_rgba(120,70,0,0.4)]",   tileHover: "hover:border-amber-500/80" },
  subcategory: { label: "Subcategory", textColor: "text-blue-400",    borderColor: "border-blue-500/40",    bgColor: "bg-blue-500/10",    tileBorder: "border-blue-600/60",    tileBg: "bg-gradient-to-br from-blue-800/35 via-blue-950/25 to-slate-900/70",    tileShadow: "shadow-[0_2px_10px_rgba(30,60,160,0.4)]",  tileHover: "hover:border-blue-500/80" },
  finalsort:   { label: "Final Sort",  textColor: "text-purple-400",  borderColor: "border-purple-500/40",  bgColor: "bg-purple-500/10",  tileBorder: "border-purple-600/60",  tileBg: "bg-gradient-to-br from-purple-800/35 via-purple-950/25 to-slate-900/70", tileShadow: "shadow-[0_2px_10px_rgba(100,30,160,0.4)]", tileHover: "hover:border-purple-500/80" },
  listing:     { label: "Listing",     textColor: "text-emerald-400", borderColor: "border-emerald-500/40", bgColor: "bg-emerald-500/10", tileBorder: "border-emerald-600/60", tileBg: "bg-gradient-to-br from-emerald-800/35 via-emerald-950/25 to-slate-900/70", tileShadow: "shadow-[0_2px_10px_rgba(0,100,60,0.4)]",   tileHover: "hover:border-emerald-500/80" },
  file:        { label: "File",        textColor: "text-indigo-400",  borderColor: "border-indigo-500/40",  bgColor: "bg-indigo-500/10",  tileBorder: "border-indigo-600/60",  tileBg: "bg-gradient-to-br from-indigo-800/35 via-indigo-950/25 to-slate-900/70",  tileShadow: "shadow-[0_2px_10px_rgba(60,50,180,0.4)]",  tileHover: "hover:border-indigo-500/80" },
};

const UNASSIGNED_TILE = {
  tileBorder: "border-gray-700/30",
  tileBg: "bg-gradient-to-br from-gray-900/60 via-slate-800/70 to-gray-900/40",
  tileShadow: "shadow-[0_2px_8px_rgba(0,0,0,0.3)]",
};

type SortKey = 'score' | 'name' | 'sortingPhase' | 'sellThroughPct' | 'soldOutSharePct' | 'effectivePhaseScore';

function scoreColor(score: number) {
  if (score >= 60) return "text-emerald-400";
  if (score >= 35) return "text-yellow-400";
  if (score >= 15) return "text-orange-400";
  return "text-gray-500";
}

function scoreBadgeBg(score: number) {
  if (score >= 60) return "bg-emerald-500/15 border-emerald-500/30 text-emerald-300";
  if (score >= 35) return "bg-yellow-500/15 border-yellow-500/30 text-yellow-300";
  if (score >= 15) return "bg-orange-500/15 border-orange-500/30 text-orange-300";
  return "bg-gray-800/60 border-gray-700/30 text-gray-500";
}

function decodeHtml(str: string): string {
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

function conditionLabel(newOrUsed: string | null) {
  if (newOrUsed === 'N') return 'New';
  if (newOrUsed === 'U') return 'Used';
  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ListomaticPriority() {
  const { toast } = useToast();

  // ── Categories tab ────────────────────────────────────────────────────────
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'score', dir: 'desc' });
  const [localPhaseScores, setLocalPhaseScores] = useState<Record<string, number> | null>(null);
  const [editingPhase, setEditingPhase] = useState<PhaseKey | null>(null);
  const [editValue, setEditValue] = useState('');
  const [scoreDetailCat, setScoreDetailCat] = useState<PriorityCategory | null>(null);
  const [sampleCat, setSampleCat] = useState<{ id: number; name: string } | null>(null);
  const [openPhaseId, setOpenPhaseId] = useState<number | null>(null);

  // ── Lots tab ──────────────────────────────────────────────────────────────
  const [lotSearch, setLotSearch] = useState('');
  const [lotSearchSubmitted, setLotSearchSubmitted] = useState('');
  const [lotFilter, setLotFilter] = useState<LotFilter>('all');
  const [lotQueue, setLotQueue] = useState<LotItem[]>([]);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [lotLabelSize, setLotLabelSize] = useState<LotLabelKey>('brotherDK1201');

  const inputRef = useRef<HTMLInputElement>(null);

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: sampleData, isLoading: sampleLoading } = useQuery<{ items: SampleItem[] }>({
    queryKey: ['/api/listomatc/category', sampleCat?.id, 'sample'],
    enabled: !!sampleCat,
  });

  const { data, isLoading, error } = useQuery<PriorityResponse>({
    queryKey: ['/api/listomatc/priority'],
    staleTime: 30000,
  });

  const lotsQueryEnabled = lotFilter !== 'all' || lotSearchSubmitted.length > 0;
  const { data: lotResults = [], isFetching: lotSearchLoading } = useQuery<LotItem[]>({
    queryKey: ['/api/warehouse/lots', lotFilter, lotSearchSubmitted],
    queryFn: async ({ queryKey }) => {
      const filter = queryKey[1] as string;
      const q = queryKey[2] as string;
      const params = new URLSearchParams({ filter });
      if (q) params.set('q', q);
      const res = await fetch(`/api/warehouse/lots?${params}`);
      if (!res.ok) throw new Error('Search failed');
      return res.json();
    },
    enabled: lotsQueryEnabled,
    staleTime: 20_000,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const phaseScores = localPhaseScores ?? data?.phaseScores ?? { category: 25, subcategory: 50, finalsort: 75, listing: 100 };

  const saveScoresMutation = useMutation({
    mutationFn: async (scores: Record<string, number>) =>
      apiRequest('PATCH', '/api/listomatc/phase-scores', {
        category: scores.category, subcategory: scores.subcategory,
        finalsort: scores.finalsort, listing: scores.listing,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/listomatc/priority'] });
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
    },
    onError: () => toast({ title: "Failed to save phase score", variant: "destructive" }),
  });

  const flagMutation = useMutation({
    mutationFn: async (categoryId: number) =>
      apiRequest('PATCH', `/api/listomatc/categories/${categoryId}/flag`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/listomatc/priority'] }),
    onError: () => toast({ title: "Failed to toggle flag", variant: "destructive" }),
  });

  const phaseMutation = useMutation({
    mutationFn: async ({ categoryId, phase }: { categoryId: number; phase: string | null }) =>
      apiRequest('PATCH', '/api/listomatc/category-phase', { categoryId, phase }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/listomatc/priority'] });
      queryClient.invalidateQueries({ queryKey: ['/api/listomatc/category-phases'] });
    },
    onError: () => toast({ title: "Failed to update phase", variant: "destructive" }),
  });

  // ── Categories tab helpers ────────────────────────────────────────────────
  const startEditing = (phase: PhaseKey) => {
    setEditingPhase(phase);
    setEditValue(String(phaseScores[phase] ?? 0));
    setTimeout(() => inputRef.current?.select(), 30);
  };

  const commitEdit = () => {
    if (!editingPhase) return;
    const num = Math.max(0, Math.min(999, parseInt(editValue) || 0));
    const updated = { ...phaseScores, [editingPhase]: num };
    setLocalPhaseScores(updated);
    saveScoresMutation.mutate(updated);
    setEditingPhase(null);
  };

  const handleSort = (key: SortKey) =>
    setSort(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'name' ? 'asc' : 'desc' });

  const sorted = [...(data?.categories ?? [])].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    if (sort.key === 'name') return dir * a.name.localeCompare(b.name);
    if (sort.key === 'sortingPhase') {
      const order: Record<string, number> = { file: 5, listing: 4, finalsort: 3, subcategory: 2, category: 1 };
      return dir * ((order[a.sortingPhase ?? ''] ?? 0) - (order[b.sortingPhase ?? ''] ?? 0));
    }
    return dir * ((a[sort.key] as number) - (b[sort.key] as number));
  });

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sort.key !== k) return <ChevronsUpDown className="w-3 h-3 opacity-30" />;
    return sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  // ── Lots tab helpers ──────────────────────────────────────────────────────
  const submitLotSearch = () => {
    const q = lotSearch.trim();
    if (!q && lotFilter === 'all') return;
    setLotSearchSubmitted(q);
  };

  const handleLotFilterChange = (f: LotFilter) => {
    setLotFilter(f);
    setLotSearchSubmitted(lotSearch.trim());
  };

  const addToQueue = (lot: LotItem) => {
    if (lotQueue.some(l => l.id === lot.id)) return;
    setLotQueue(prev => [...prev, lot]);
  };

  const removeFromQueue = (id: number) => {
    setLotQueue(prev => prev.filter(l => l.id !== id));
  };

  // ── Lot label print ───────────────────────────────────────────────────────
  const handlePrintLotLabels = () => {
    if (lotQueue.length === 0) return;
    const origin = window.location.origin;
    const tmpl = LOT_LABEL_TEMPLATES[lotLabelSize];

    const css = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, Helvetica, sans-serif; background: white; }
      .label {
        width: ${tmpl.w}; height: ${tmpl.h};
        display: flex; align-items: center;
        gap: 6px; padding: 4px;
        overflow: hidden;
      }
      .qr { display: block; flex-shrink: 0; }
      .info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 2px; overflow: hidden; }
      .partno-row { display: flex; align-items: center; justify-content: space-between; gap: 4px; overflow: hidden; }
      .partno { font-size: 9px; font-weight: bold; color: #666; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 1; }
      .location { font-size: 9px; font-weight: bold; color: #333; font-family: monospace; white-space: nowrap; flex-shrink: 0; text-align: right; }
      .location.unassigned { color: #aaa; font-style: italic; font-weight: normal; }
      .name   { font-size: 11px; font-weight: 900; color: #000; line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
      .meta   { font-size: 8px; color: #444; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .lotid  { font-size: 8px; font-weight: bold; color: #1a5f1a; font-family: monospace; white-space: nowrap; }
      @media print {
        body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        @page { size: ${tmpl.w} ${tmpl.h}; margin: ${tmpl.pageMarginV} ${tmpl.pageMarginH}; }
      }
    `;

    const waitScript = `<script>
      window.addEventListener('load', function() {
        var imgs = Array.from(document.images);
        Promise.all(imgs.map(function(img) {
          return img.complete ? Promise.resolve() : new Promise(function(r) { img.onload = r; img.onerror = r; });
        })).then(function() { window.print(); });
      });
      window.addEventListener('afterprint', function() { window.close(); });
    <\/script>`;

    const labelsHtml = lotQueue.map((lot, i) => {
      const qrData = `LOT:${lot.id}`;
      const qrUrl = `${origin}/api/warehouse/labels/qr?data=${encodeURIComponent(qrData)}&size=${tmpl.qrPx * 2}`;
      const name = lot.itemName ? decodeHtml(lot.itemName) : lot.itemNo;
      const cond = conditionLabel(lot.newOrUsed);
      const metaParts = [lot.colorName, cond].filter(Boolean).join(' · ');
      const breakStyle = i < lotQueue.length - 1 ? ' style="page-break-after:always;"' : '';
      const locationParts = [lot.aisleName, lot.shelfName, lot.binName].filter(Boolean);
      const locationStr = locationParts.length > 0 ? locationParts.join(' / ') : null;
      return `<div class="label"${breakStyle}>
        <img class="qr" src="${qrUrl}" width="${tmpl.qrPx}" height="${tmpl.qrPx}" />
        <div class="info">
          <div class="partno-row">
            <span class="partno">#${lot.itemNo}</span>
            ${locationStr
              ? `<span class="location">${locationStr}</span>`
              : `<span class="location unassigned">unassigned</span>`}
          </div>
          <div class="name">${name}</div>
          ${metaParts ? `<div class="meta">${metaParts}</div>` : ''}
          <div class="lotid">LOT:${lot.id}</div>
        </div>
      </div>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style>${waitScript}</head><body>${labelsHtml}</body></html>`;
    const win = window.open('', '_blank', 'width=800,height=600');
    if (win) { win.document.write(html); win.document.close(); }
    setPrintDialogOpen(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <Tabs defaultValue="categories">
        <TabsList className="w-full grid grid-cols-2 mb-2">
          <TabsTrigger value="categories" data-testid="tab-categories">Categories</TabsTrigger>
          <TabsTrigger value="lots" data-testid="tab-lots">Ready to File</TabsTrigger>
        </TabsList>

        {/* ── CATEGORIES TAB ───────────────────────────────────────────── */}
        <TabsContent value="categories" className="space-y-4 mt-0">

          {/* Header */}
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-100">Listing Priority Score</h3>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="icon" variant="ghost" className="w-6 h-6" data-testid="button-lom-priority-info">
                  <Info className="w-3.5 h-3.5 text-gray-500" />
                </Button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="start" className="w-96 bg-gray-900 border-gray-700 p-3 z-[300]">
                <h4 className="text-xs font-bold text-emerald-400 mb-2">How the Priority Score is Calculated</h4>
                <p className="text-[11px] text-gray-300 mb-2">
                  Each category gets a score identifying which unlisted categories to prioritize for physical preparation and listing.
                </p>
                <div className="space-y-2 text-[11px]">
                  <div className="bg-gray-800/60 rounded p-2">
                    <p className="text-amber-300 font-semibold mb-0.5">Sell-Through Rate — 30% weight</p>
                    <p className="text-gray-400">Sold ÷ (Current Stock + Sold) × 100. High sell-through means demand is outpacing what's listed.</p>
                  </div>
                  <div className="bg-gray-800/60 rounded p-2">
                    <p className="text-blue-300 font-semibold mb-0.5">Sold-Out Lots Share — 30% weight</p>
                    <p className="text-gray-400">This category's sold-out lots ÷ all sold-out lots across your inventory × 100.</p>
                  </div>
                  <div className="bg-gray-800/60 rounded p-2">
                    <p className="text-purple-300 font-semibold mb-0.5">Sorting Effort — 40% weight</p>
                    <p className="text-gray-400">The phase score you set below. In the Listing phase, flagging a category doubles its effort score.</p>
                  </div>
                  <div className="border-t border-gray-700 pt-2 text-gray-500 font-mono text-[10px]">
                    Score = (Sell-Through × 0.30) + (Sold-Out Share × 0.30) + (Phase Score × 0.40)
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Phase Score Cards */}
          <div className="grid grid-cols-4 gap-2">
            {PHASES.map(phase => {
              const cfg = PHASE_CONFIG[phase];
              const isEditing = editingPhase === phase;
              const score = phaseScores[phase] ?? 0;
              const fileCounts = data?.fileLotCounts;
              return (
                <div
                  key={phase}
                  className={`rounded-lg border ${cfg.borderColor} ${cfg.bgColor} p-2.5 cursor-pointer transition-all`}
                  onClick={() => !isEditing && startEditing(phase)}
                  data-testid={`phase-card-${phase}`}
                >
                  <p className={`text-[9px] font-semibold ${cfg.textColor} mb-1 truncate`}>{cfg.label}</p>
                  {isEditing ? (
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <input
                        ref={inputRef}
                        type="number" min={0} max={999}
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingPhase(null); }}
                        className="w-full bg-gray-900/80 border border-gray-500 rounded px-1.5 py-0.5 text-sm text-gray-100 font-semibold focus:outline-none focus:border-gray-300"
                        data-testid={`input-phase-score-${phase}`}
                        autoFocus
                      />
                      <button onClick={commitEdit} className={`shrink-0 ${cfg.textColor}`} data-testid={`confirm-phase-score-${phase}`}>
                        <Check className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-end justify-between gap-1">
                      <span className="text-xl font-bold text-gray-100 tabular-nums leading-none">{score}</span>
                      {phase === 'listing' && <span className="text-[8px] text-orange-400 mb-0.5 leading-none">×2 if flagged</span>}
                    </div>
                  )}
                  {phase === 'file' && fileCounts && (
                    <div className="mt-1.5 pt-1.5 border-t border-indigo-500/20 space-y-0.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between">
                        <span className="text-[8px] text-gray-500">Total to file</span>
                        <span className="text-[9px] font-bold text-indigo-300 tabular-nums" data-testid="file-count-total">{fileCounts.total}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[8px] text-gray-600">Unassigned</span>
                        <span className="text-[8px] text-gray-400 tabular-nums" data-testid="file-count-unassigned">{fileCounts.unassignedLots}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[8px] text-gray-600">Filing queue</span>
                        <span className="text-[8px] text-gray-400 tabular-nums" data-testid="file-count-queue">{fileCounts.filingQueueLots}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-600 -mt-1">Tap a phase card to edit its score. Tap the phase badge on a tile to reassign. Flag icon pre-tags a category — ×2 activates when it reaches Listing.</p>

          {/* Sort controls */}
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] text-gray-600 mr-1">Sort:</span>
            {([
              ['score', 'Score'], ['name', 'Name'], ['sortingPhase', 'Phase'],
              ['sellThroughPct', 'Sell-Thru'], ['soldOutSharePct', 'Sold-Out'], ['effectivePhaseScore', 'Effort'],
            ] as [SortKey, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => handleSort(key)}
                className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                  sort.key === key
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-gray-500 hover:text-gray-300 border border-transparent'
                }`}
                data-testid={`sort-${key}`}
              >
                {label} <SortIcon k={key} />
              </button>
            ))}
          </div>

          {/* Category tiles */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Loading priority data…</div>
          ) : error ? (
            <div className="text-center py-8 text-red-400 text-sm">Failed to load priority list.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {sorted.map(cat => {
                const phaseCfg = cat.sortingPhase ? PHASE_CONFIG[cat.sortingPhase as PhaseKey] : null;
                const tileCfg  = phaseCfg
                  ? { tileBorder: phaseCfg.tileBorder, tileBg: phaseCfg.tileBg, tileShadow: phaseCfg.tileShadow }
                  : UNASSIGNED_TILE;
                const inListing = cat.sortingPhase === 'listing';
                return (
                  <div
                    key={cat.id}
                    className={`relative rounded-lg border ${tileCfg.tileBorder} ${tileCfg.tileBg} px-3 py-2 ${tileCfg.tileShadow} transition-all duration-150`}
                    data-testid={`tile-priority-${cat.id}`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 mb-1.5">
                      <button
                        onClick={() => setSampleCat({ id: cat.id, name: cat.name })}
                        className={`text-xs font-medium truncate flex-1 min-w-0 text-left hover:underline ${cat.flagged ? 'text-orange-200' : 'text-gray-200'}`}
                        data-testid={`name-btn-${cat.id}`}
                      >
                        {cat.name}
                      </button>
                      <button
                        onClick={() => flagMutation.mutate(cat.id)}
                        className={`shrink-0 transition-colors p-1 rounded ${cat.flagged ? 'text-orange-400' : 'text-gray-600 hover:text-orange-400'}`}
                        title={cat.flagged
                          ? (inListing ? 'Flagged — ×2 active. Tap to remove.' : 'Flagged — ×2 will apply when in Listing. Tap to remove.')
                          : 'Flag to double effort score when in Listing phase'}
                        data-testid={`flag-btn-${cat.id}`}
                      >
                        <Flag className={`w-3.5 h-3.5 ${cat.flagged ? 'fill-current' : ''}`} />
                      </button>
                      <button
                        onClick={() => setScoreDetailCat(cat)}
                        className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border tabular-nums ${scoreBadgeBg(cat.score)}`}
                        data-testid={`score-badge-${cat.id}`}
                      >
                        {cat.score}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] flex-wrap">
                      <Popover open={openPhaseId === cat.id} onOpenChange={open => setOpenPhaseId(open ? cat.id : null)}>
                        <PopoverTrigger asChild>
                          <button
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border transition-colors ${
                              phaseCfg
                                ? `${phaseCfg.bgColor} ${phaseCfg.borderColor} ${phaseCfg.textColor}`
                                : 'bg-gray-800/40 border-gray-700/40 text-gray-500 italic'
                            }`}
                            data-testid={`phase-badge-${cat.id}`}
                          >
                            {phaseCfg ? phaseCfg.label : 'Unassigned'}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent side="bottom" align="start" className="w-52 bg-gray-900 border-gray-700 p-2.5 z-[400] space-y-1.5">
                          <p className="app-label mb-2">Move to phase</p>
                          <button
                            onClick={() => { phaseMutation.mutate({ categoryId: cat.id, phase: null }); setOpenPhaseId(null); }}
                            className={`w-full text-left text-[10px] px-2 py-1.5 rounded border transition-colors ${
                              !cat.sortingPhase ? 'border-gray-500 bg-gray-700/60 text-gray-300' : 'border-gray-700/40 text-gray-500 hover:border-gray-600 hover:text-gray-300'
                            }`}
                            data-testid={`phase-btn-null-${cat.id}`}
                          >
                            Not Assigned
                          </button>
                          {PHASES.map(phase => {
                            const cfg = PHASE_CONFIG[phase];
                            const isActive = cat.sortingPhase === phase;
                            return (
                              <button
                                key={phase}
                                onClick={() => { phaseMutation.mutate({ categoryId: cat.id, phase }); setOpenPhaseId(null); }}
                                className={`w-full text-left text-[10px] px-2 py-1.5 rounded border transition-colors ${
                                  isActive ? `${cfg.borderColor} ${cfg.bgColor} ${cfg.textColor} font-semibold` : 'border-gray-700/40 text-gray-500 hover:text-gray-200'
                                }`}
                                data-testid={`phase-btn-${phase}-${cat.id}`}
                              >
                                {cfg.label}
                              </button>
                            );
                          })}
                        </PopoverContent>
                      </Popover>
                      {cat.sellThroughPct > 0 && <span className="text-gray-500">Sell-Through {cat.sellThroughPct}%</span>}
                      {cat.soldOutLots > 0 && <span className="text-gray-500">Sold-Out {cat.soldOutSharePct}%</span>}
                      {cat.effectivePhaseScore > 0 && (
                        <span className={cat.flagged && inListing ? 'text-orange-400 font-semibold' : 'text-gray-500'}>
                          Effort {cat.effectivePhaseScore}{cat.flagged && inListing ? ' ×2' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {sorted.length === 0 && (
                <div className="col-span-2 py-12 text-center text-gray-600 text-sm italic">No categories found. Run an inventory sync first.</div>
              )}
            </div>
          )}
          <p className="text-[10px] text-gray-600">
            {sorted.length} categories · Tap score number for breakdown. Tap phase badge to reassign.
          </p>
        </TabsContent>

        {/* ── LOTS TAB ─────────────────────────────────────────────────── */}
        <TabsContent value="lots" className="space-y-3 mt-0">

          {/* Filter pills */}
          <div className="flex items-center gap-1 flex-wrap">
            {([
              ['all',          'All'],
              ['assigned',     'Assigned'],
              ['unassigned',   'Unassigned'],
              ['filing-queue', 'Filing Queue'],
            ] as [LotFilter, string][]).map(([f, label]) => (
              <button
                key={f}
                onClick={() => handleLotFilterChange(f)}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                  lotFilter === f
                    ? f === 'filing-queue'
                      ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                      : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'text-gray-500 hover:text-gray-300 border-gray-700 hover:border-gray-600'
                }`}
                data-testid={`filter-lots-${f}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <Input
                placeholder={lotFilter === 'all' ? 'Part number or name…' : 'Narrow by part number or name…'}
                value={lotSearch}
                onChange={e => setLotSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitLotSearch(); }}
                className="pr-8 text-xs"
                data-testid="input-lot-search"
              />
              {lotSearchLoading && (
                <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={submitLotSearch}
              disabled={(!lotSearch.trim() && lotFilter === 'all') || lotSearchLoading}
              data-testid="button-lot-search-submit"
            >
              <Search className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Results */}
          {lotsQueryEnabled && (
            <div className="space-y-1">
              {lotSearchLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-xs">Loading…</span>
                </div>
              ) : lotResults.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-6">
                  {lotSearchSubmitted
                    ? <>No lots found matching &ldquo;{lotSearchSubmitted}&rdquo;.</>
                    : 'No lots in this filter.'}
                </p>
              ) : (
                <>
                  <p className="text-[10px] text-muted-foreground mb-1">
                    <span className="font-semibold text-foreground">{lotResults.length}</span> lot{lotResults.length !== 1 ? 's' : ''}
                    {lotResults.length === 200 && <span className="text-muted-foreground/60"> (showing first 200)</span>}
                    {' '}— tap to add to print queue
                  </p>
                  <div className="rounded-md border border-border bg-muted/20 divide-y divide-border max-h-52 overflow-y-auto">
                    {lotResults.map((lot) => {
                      const inQueue = lotQueue.some(l => l.id === lot.id);
                      const cond = conditionLabel(lot.newOrUsed);
                      return (
                        <button
                          key={lot.id}
                          onClick={() => addToQueue(lot)}
                          disabled={inQueue}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${inQueue ? 'opacity-40 cursor-default' : 'hover-elevate'}`}
                          data-testid={`lot-result-${lot.id}`}
                        >
                          <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="font-mono text-xs font-semibold shrink-0 w-16 truncate text-foreground">{lot.itemNo}</span>
                          <span className="text-xs text-muted-foreground truncate flex-1">{lot.itemName || '—'}</span>
                          {lot.colorName && <span className="text-[10px] text-muted-foreground/60 shrink-0 hidden sm:inline">{lot.colorName}</span>}
                          {cond && <span className="text-[10px] text-muted-foreground shrink-0">{cond}</span>}
                          {lot.isFilingQueue && (
                            <span className="text-[8px] font-semibold text-indigo-400 bg-indigo-500/10 border border-indigo-500/30 rounded px-1 shrink-0">Queue</span>
                          )}
                          {!lot.assigned && !lot.isFilingQueue && (
                            <span className="text-[8px] font-semibold text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded px-1 shrink-0">Unassigned</span>
                          )}
                          {inQueue ? (
                            <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
                          ) : (
                            <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Print queue */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-foreground">
                Print Queue
                {lotQueue.length > 0 && (
                  <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                    ({lotQueue.length} lot{lotQueue.length !== 1 ? 's' : ''})
                  </span>
                )}
              </h4>
              {lotQueue.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setLotQueue([])}
                    className="text-[10px] text-muted-foreground"
                    data-testid="button-clear-queue"
                  >
                    Clear all
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setPrintDialogOpen(true)}
                    className="gap-1.5 text-xs"
                    data-testid="button-print-lot-labels"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Print Labels
                  </Button>
                </div>
              )}
            </div>

            {lotQueue.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-muted/10 py-8 text-center">
                <p className="text-xs text-muted-foreground">No lots queued.</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">Search above and tap a result to add it.</p>
              </div>
            ) : (
              <div className="rounded-md border border-border bg-muted/20 divide-y divide-border max-h-64 overflow-y-auto">
                {lotQueue.map((lot) => {
                  const cond = conditionLabel(lot.newOrUsed);
                  return (
                    <div
                      key={lot.id}
                      className="flex items-center gap-2 px-3 py-2"
                      data-testid={`queue-item-${lot.id}`}
                    >
                      <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-mono text-xs font-semibold shrink-0 w-20 truncate text-foreground">{lot.itemNo}</span>
                      <span className="text-xs text-muted-foreground truncate flex-1">{lot.itemName || '—'}</span>
                      {lot.colorName && <span className="text-[10px] text-muted-foreground shrink-0">{lot.colorName}</span>}
                      {cond && <span className="text-[10px] text-muted-foreground shrink-0">{cond}</span>}
                      {lot.binName && <span className="text-[10px] font-mono text-yellow-500 shrink-0">{lot.binName}</span>}
                      <button
                        onClick={() => removeFromQueue(lot.id)}
                        className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors"
                        data-testid={`remove-queue-${lot.id}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Category sample Dialog ────────────────────────────────────── */}
      <Dialog open={!!sampleCat} onOpenChange={open => { if (!open) setSampleCat(null); }}>
        <DialogContent className="bg-gray-900 border-gray-700 text-gray-200 max-w-sm z-[9999] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-gray-200 pr-6 leading-snug break-words">
              {sampleCat?.name}
              <span className="text-gray-500 font-normal"> — Sample Parts</span>
            </DialogTitle>
          </DialogHeader>
          {sampleLoading && <div className="py-6 text-center text-gray-500 text-xs">Loading…</div>}
          {!sampleLoading && sampleData?.items.length === 0 && (
            <div className="py-6 text-center text-gray-500 text-xs italic">No parts found.</div>
          )}
          {!sampleLoading && sampleData && sampleData.items.length > 0 && (
            <div className="w-full space-y-0">
              {sampleData.items.map(item => (
                <div key={item.id} className="flex items-center gap-2 py-2 border-b border-gray-800 last:border-0 w-full overflow-hidden">
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt={item.itemNo} className="w-9 h-9 object-contain shrink-0 rounded bg-gray-800" />
                  ) : (
                    <div className="w-9 h-9 shrink-0 rounded bg-gray-800 flex items-center justify-center text-gray-600 text-[9px] font-mono">{item.itemNo}</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-200 truncate">{item.itemName ? decodeHtml(item.itemName) : '—'}</p>
                    <p className="text-[10px] text-gray-500 font-mono truncate">#{item.itemNo}{item.colorName ? ` · ${item.colorName}` : ''}</p>
                  </div>
                  <div className="shrink-0 text-right pl-1">
                    <p className="text-xs font-semibold text-gray-300 tabular-nums">{item.quantity.toLocaleString()}</p>
                    <p className="text-[10px] text-gray-600">pcs</p>
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-gray-600 pt-2">Top 5 lots by quantity in stock.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Score breakdown Dialog ────────────────────────────────────── */}
      <Dialog open={!!scoreDetailCat} onOpenChange={open => { if (!open) setScoreDetailCat(null); }}>
        <DialogContent className="bg-gray-900 border-gray-700 text-gray-200 max-w-sm z-[9999]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-gray-200 pr-6 truncate">{scoreDetailCat?.name}</DialogTitle>
          </DialogHeader>
          {scoreDetailCat && (() => {
            const c = scoreDetailCat;
            const inListing = c.sortingPhase === 'listing';
            const phaseName = c.sortingPhase ? PHASE_CONFIG[c.sortingPhase as PhaseKey]?.label : 'Unassigned';
            const totalPieces = c.currentQty + c.totalSold;
            return (
              <div className="space-y-4 text-sm">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-amber-300 font-semibold">Sell-Through</span>
                    <span className="text-gray-400 font-mono text-xs">{c.sellThroughPct}% × 30% = <span className="text-gray-200">{(c.sellThroughPct * 0.30).toFixed(1)} pts</span></span>
                  </div>
                  <p className="text-xs text-gray-500 font-mono">{c.totalSold.toLocaleString()} sold ÷ {totalPieces.toLocaleString()} total pieces</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-blue-300 font-semibold">Sold-Out Lots</span>
                    <span className="text-gray-400 font-mono text-xs">{c.soldOutSharePct}% × 30% = <span className="text-gray-200">{(c.soldOutSharePct * 0.30).toFixed(1)} pts</span></span>
                  </div>
                  <p className="text-xs text-gray-500 font-mono">{c.soldOutLots.toLocaleString()} sold out ÷ {c.totalLots.toLocaleString()} total lots in category</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-purple-300 font-semibold">Effort{c.flagged && inListing ? ' ×2' : ''}</span>
                    <span className="text-gray-400 font-mono text-xs">{c.effectivePhaseScore} × 40% = <span className="text-gray-200">{(c.effectivePhaseScore * 0.40).toFixed(1)} pts</span></span>
                  </div>
                  <p className="text-xs text-gray-500 font-mono">
                    Phase: {phaseName ?? 'None'} → base score {c.basePhaseScore}
                    {c.flagged && inListing && <span className="text-orange-400"> ×2 (flagged in Listing)</span>}
                    {c.flagged && !inListing && <span className="text-orange-400/60"> (×2 activates in Listing)</span>}
                  </p>
                </div>
                <div className="border-t border-gray-700 pt-3 flex justify-between font-semibold text-base">
                  <span className="text-gray-300">Priority Score</span>
                  <span className={scoreColor(c.score)}>{c.score}</span>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Lot label print dialog ────────────────────────────────────── */}
      <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
        <DialogContent className="max-w-lg z-[9999]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-4 w-4 text-muted-foreground" />
              Print Lot Labels
            </DialogTitle>
            <DialogDescription>
              {lotQueue.length} lot label{lotQueue.length !== 1 ? 's' : ''}. Each label includes a QR code (LOT:id), part number, name, color, and condition.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Template selector */}
            <div>
              <Label className="text-xs mb-2 block">Label template</Label>
              <div className="flex flex-col gap-1.5">
                {LOT_LABEL_GROUPS.map(({ groupName, keys }) => (
                  <div key={groupName}>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">{groupName}</p>
                    {keys.map(key => {
                      const t = LOT_LABEL_TEMPLATES[key];
                      const active = lotLabelSize === key;
                      return (
                        <button
                          key={key}
                          onClick={() => setLotLabelSize(key)}
                          className={`w-full rounded-md border py-2 px-3 text-xs text-left transition-colors flex items-center justify-between gap-3 mb-1 ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border hover-elevate'}`}
                          data-testid={`button-lot-label-size-${key}`}
                        >
                          <div>
                            <div className="font-semibold">{t.name}</div>
                            <div className={`mt-0.5 ${active ? 'text-primary/70' : 'text-muted-foreground'}`}>{t.desc}</div>
                          </div>
                          <div className={`text-[10px] font-mono shrink-0 ${active ? 'text-primary/60' : 'text-muted-foreground'}`}>{t.w} × {t.h}</div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Preview */}
            <div>
              <Label className="text-xs mb-2 block text-muted-foreground">
                Preview (first {Math.min(3, lotQueue.length)})
              </Label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {lotQueue.slice(0, 3).map(lot => {
                  const tmpl = LOT_LABEL_TEMPLATES[lotLabelSize];
                  const qrData = `LOT:${lot.id}`;
                  const cond = conditionLabel(lot.newOrUsed);
                  const name = lot.itemName ? decodeHtml(lot.itemName) : lot.itemNo;
                  const metaParts = [lot.colorName, cond].filter(Boolean).join(' · ');
                  return (
                    <div
                      key={lot.id}
                      className={`flex items-center gap-2 border border-border rounded-md bg-white dark:bg-zinc-900 p-2 ${tmpl.previewH} overflow-hidden`}
                    >
                      <QRCodeSVG
                        value={qrData}
                        size={tmpl.previewQr}
                        bgColor="transparent"
                        fgColor="currentColor"
                        className="shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 overflow-hidden">
                          <p className="text-[9px] font-mono text-muted-foreground shrink-1 truncate">#{lot.itemNo}</p>
                          {(() => {
                            const locationParts = [lot.aisleName, lot.shelfName, lot.binName].filter(Boolean);
                            const locationStr = locationParts.length > 0 ? locationParts.join(' / ') : null;
                            return locationStr
                              ? <p className="text-[9px] font-mono font-bold text-foreground shrink-0">{locationStr}</p>
                              : <p className="text-[9px] font-mono italic text-muted-foreground/50 shrink-0">unassigned</p>;
                          })()}
                        </div>
                        <p className="font-bold text-foreground truncate text-xs leading-tight">{name}</p>
                        {metaParts && <p className="text-[9px] text-muted-foreground truncate">{metaParts}</p>}
                        <p className="text-[9px] font-mono text-green-600 dark:text-green-400">LOT:{lot.id}</p>
                      </div>
                    </div>
                  );
                })}
                {lotQueue.length > 3 && (
                  <p className="text-center text-xs text-muted-foreground py-1">
                    +{lotQueue.length - 3} more label{lotQueue.length - 3 !== 1 ? 's' : ''} will be printed
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1 gap-2"
                onClick={handlePrintLotLabels}
                disabled={lotQueue.length === 0}
                data-testid="button-print-confirm"
              >
                <Printer className="h-4 w-4" />
                Print {lotQueue.length} Label{lotQueue.length !== 1 ? 's' : ''}
              </Button>
              <Button variant="ghost" onClick={() => setPrintDialogOpen(false)} data-testid="button-print-cancel">
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Info, Flag, ChevronUp, ChevronDown, ChevronsUpDown, Check, X,
  Search, Plus, Printer, Loader2, Package, Calendar, RefreshCw,
  Sparkles, ArrowLeft, MapPin, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useScanSession } from "@/contexts/ScanSessionContext";
import LotLabelTemplatePrintDialog, { LotLabelPrintItem } from "./LotLabelTemplatePrint";
import { WarehouseScanPanel } from "./WarehouseScanPanel";

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
  colorRgb: string | null;
  newOrUsed: string | null;
  quantity: number | null;
  binName: string | null;
  locationLabel: string | null;
  assigned: boolean;
  isFilingQueue: boolean;
  // Optional fields used by the label image resolver. The lot id alone is
  // enough (via /api/images/lot/:lotId) but these improve fallback chances.
  itemType?: string | null;
  colorId?: number | null;
  imageUrl?: string | null;
  remarks?: string | null;       // private seller note
  description?: string | null;   // public buyer-facing comment
  // Source change-type when queued from a listing batch — drives queue filter pills.
  changeType?: 'new' | 'qty_updated' | null;
  // Aisle of the lot's current physical bin, used as a pre-sort hint on the
  // printed label so the filer can split the print run into one tote per
  // aisle and walk the warehouse only once. Not a permanent address — the
  // label is still identity-only.
  aisleName?: string | null;
}

type LotFilter = 'all' | 'assigned' | 'unassigned' | 'filing-queue';

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

// A lot's locationLabel aggregates every permanent (non-filing-queue) bin it
// sits in, joined by " | " (e.g. "A / 1 / 24 | B / 2 / 5"). Split it back into
// individual bin paths so we can count how many distinct bins a part+condition
// spans across all its colors.
function parseBins(locationLabel: string | null): string[] {
  if (!locationLabel) return [];
  return locationLabel.split('|').map(s => s.trim()).filter(Boolean);
}

// Group lot search results by part number + condition (New/Used). For each
// group, pool the distinct permanent bins across all its color lots — when a
// single part+condition lands in more than one bin it's flagged so a filer can
// catch a color that was bagged into the wrong bin during consolidation.
interface LotGroup {
  key: string;
  itemNo: string;
  itemName: string | null;
  newOrUsed: string | null;
  lots: LotItem[];
  bins: string[];
  multiBin: boolean;
}
function groupLotsByPartCondition(lots: LotItem[]): LotGroup[] {
  const map = new Map<string, LotGroup>();
  const order: string[] = [];
  for (const lot of lots) {
    const key = `${lot.itemNo}|${lot.newOrUsed ?? ''}`;
    let g = map.get(key);
    if (!g) {
      g = { key, itemNo: lot.itemNo, itemName: lot.itemName, newOrUsed: lot.newOrUsed, lots: [], bins: [], multiBin: false };
      map.set(key, g);
      order.push(key);
    }
    g.lots.push(lot);
  }
  for (const key of order) {
    const g = map.get(key)!;
    const set = new Set<string>();
    for (const lot of g.lots) for (const b of parseBins(lot.locationLabel)) set.add(b);
    g.bins = Array.from(set);
    g.multiBin = g.bins.length > 1;
  }
  return order.map(k => map.get(k)!);
}

// ── Date-range labels sub-view (Smart Parts) ──────────────────────────────────
interface RangeRow {
  id: number;
  itemNo: string;
  itemType: string;
  colorId: number;
  newOrUsed: string | null;
  quantity: number;
  itemName: string | null;
  colorName: string | null;
  thumbnailUrl: string | null;
  remarks: string | null;
  description: string | null;
  changeType: 'new' | 'qty_updated';
  aisleName: string | null;
  labelPrintedAt: string | null;
}

const RANGE_SORT_KEY = 'elfie.rangeLabelSort';
type RangeSortKey = 'part' | 'color' | 'condition';

function DateRangeLabels(props: {
  from: string;
  to: string;
  onFrom: (s: string) => void;
  onTo: (s: string) => void;
  onCancel: () => void;
  onPrint: (items: LotLabelPrintItem[]) => void;
}) {
  const { from, to, onFrom, onTo, onCancel, onPrint } = props;
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<RangeSortKey>(() => {
    try { return (localStorage.getItem(RANGE_SORT_KEY) as RangeSortKey) ?? 'part'; } catch { return 'part'; }
  });

  // Auto-sync from BrickLink when this view opens so the latest lots are present
  const syncMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/sync/bricklink/inventory', {}),
    onError: () => toast({
      title: 'BrickLink sync failed',
      description: 'Could not pull latest inventory — results may be incomplete.',
      variant: 'destructive',
    }),
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { syncMutation.mutate(); }, []);

  // Poll sync progress while sync is running
  const { data: progressData } = useQuery<{ status: string; currentStep: string; progress: number }>({
    queryKey: ['/api/sync/bricklink/progress'],
    refetchInterval: syncMutation.isPending ? 1500 : false,
    enabled: syncMutation.isPending,
  });
  const progressPct = progressData?.progress ?? 0;

  // Results auto-load once sync finishes and both dates are set
  const enabled = !!from && !!to && !syncMutation.isPending;
  const { data: rows = [], isFetching } = useQuery<RangeRow[]>({
    queryKey: ['/api/listing-batches/range/labels', from, to],
    queryFn: async () => {
      const fromIso = new Date(from + 'T00:00:00').toISOString();
      const toIso = new Date(to + 'T23:59:59').toISOString();
      const params = new URLSearchParams({ from: fromIso, to: toIso });
      const res = await fetch(`/api/listing-batches/range/labels?${params}`);
      if (!res.ok) throw new Error('Range query failed');
      return res.json();
    },
    enabled,
  });

  // Smart default selection: select only lots NOT already printed today
  useEffect(() => {
    if (rows.length === 0) { setSelectedIds(new Set()); return; }
    const todayLocal = new Date().toLocaleDateString('en-CA');
    const notYetPrinted = rows.filter(r => {
      if (!r.labelPrintedAt) return true;
      return new Date(r.labelPrintedAt).toLocaleDateString('en-CA') !== todayLocal;
    });
    setSelectedIds(new Set(notYetPrinted.map(r => r.id)));
  }, [rows]);

  const changeSort = (s: RangeSortKey) => {
    setSort(s);
    try { localStorage.setItem(RANGE_SORT_KEY, s); } catch { /* ignore */ }
  };

  const sortedRows = useMemo(() => [...rows].sort((a, b) => {
    if (sort === 'part') return a.itemNo.localeCompare(b.itemNo);
    if (sort === 'color') return (a.colorName ?? '').localeCompare(b.colorName ?? '');
    if (sort === 'condition') {
      const ord: Record<string, number> = { N: 0, U: 1 };
      return (ord[a.newOrUsed ?? ''] ?? 2) - (ord[b.newOrUsed ?? ''] ?? 2);
    }
    return 0;
  }), [rows, sort]);

  const toLabelItem = (r: RangeRow): LotLabelPrintItem => ({
    id: r.id,
    itemNo: r.itemNo,
    itemName: r.itemName,
    colorName: r.colorName,
    newOrUsed: r.newOrUsed,
    quantity: r.quantity,
    itemType: r.itemType,
    colorId: r.colorId,
    imageUrl: r.thumbnailUrl,
    remarks: r.remarks,
    description: r.description,
    aisleName: r.aisleName,
  });

  const toggleRow = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === rows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map(r => r.id)));
    }
  };

  const todayLocal = new Date().toLocaleDateString('en-CA');
  const printedTodayIds = useMemo(
    () => new Set(rows.filter(r => r.labelPrintedAt && new Date(r.labelPrintedAt).toLocaleDateString('en-CA') === todayLocal).map(r => r.id)),
    [rows, todayLocal],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="gap-1.5 text-xs"
          data-testid="button-range-back"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All batches
        </Button>
      </div>

      <div className="rounded-md border border-border bg-muted/10 p-3 space-y-2">
        <p className="text-xs font-semibold text-foreground">Print labels for lots last touched in a date range</p>
        <p className="text-[10px] text-muted-foreground">
          Lots already printed today are deselected automatically. Results load automatically after sync.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">From</Label>
            <Input
              type="date"
              value={from}
              onChange={e => onFrom(e.target.value)}
              className="text-xs h-9"
              data-testid="input-range-from"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">To</Label>
            <Input
              type="date"
              value={to}
              onChange={e => onTo(e.target.value)}
              className="text-xs h-9"
              data-testid="input-range-to"
            />
          </div>
        </div>
        {syncMutation.isPending && (
          <div className="space-y-1 pt-0.5" data-testid="range-sync-progress">
            <Progress value={progressPct} className="h-1.5" />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{progressData?.currentStep ?? 'Syncing from BrickLink…'}</span>
              <span className="tabular-nums">{progressPct}%</span>
            </div>
          </div>
        )}
      </div>

      {enabled && (
        <>
          {isFetching ? (
            <div className="flex items-center justify-center py-6 text-gray-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Searching…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-6">No lots in this date range.</p>
          ) : (
            <>
              {/* Action bar */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[10px] text-muted-foreground">
                    <span className="font-semibold text-foreground">{rows.length}</span> lot{rows.length !== 1 ? 's' : ''}
                    {rows.length === 2000 && <span className="text-muted-foreground/60"> (capped at 2000)</span>}
                    {printedTodayIds.size > 0 && (
                      <span className="ml-1.5 text-amber-400">· {printedTodayIds.size} already printed today</span>
                    )}
                  </p>
                  <button
                    onClick={toggleAll}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors hover:underline underline-offset-2"
                    data-testid="button-range-toggle-all"
                  >
                    {selectedIds.size === rows.length ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    const items = sortedRows.filter(r => selectedIds.has(r.id)).map(toLabelItem);
                    if (items.length > 0) onPrint(items);
                  }}
                  disabled={selectedIds.size === 0}
                  className="gap-1.5 text-xs"
                  data-testid="button-range-print-selected"
                >
                  <Printer className="h-3.5 w-3.5" />
                  {selectedIds.size === rows.length
                    ? 'Print All'
                    : selectedIds.size > 0
                      ? `Print Selected (${selectedIds.size})`
                      : 'Print Selected'}
                </Button>
              </div>

              {/* Sort controls */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground shrink-0">Sort by:</span>
                {(['part', 'color', 'condition'] as RangeSortKey[]).map(s => (
                  <button
                    key={s}
                    onClick={() => changeSort(s)}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors capitalize ${
                      sort === s
                        ? 'bg-foreground/10 text-foreground border-foreground/30'
                        : 'text-muted-foreground border-border hover:text-foreground hover:border-foreground/30'
                    }`}
                    data-testid={`button-range-sort-${s}`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Results */}
              <div className="rounded-md border border-border bg-muted/20 divide-y divide-border max-h-80 overflow-y-auto">
                {sortedRows.map(r => {
                  const isSelected = selectedIds.has(r.id);
                  const printedToday = printedTodayIds.has(r.id);
                  return (
                    <div
                      key={r.id}
                      className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${isSelected ? 'bg-emerald-500/10' : ''}`}
                      onClick={() => toggleRow(r.id)}
                      data-testid={`range-row-${r.id}`}
                    >
                      <div className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-emerald-500 border-emerald-400' : 'border-border'}`}>
                        {isSelected && <Check className="h-3 w-3 text-white" />}
                      </div>
                      {r.thumbnailUrl ? (
                        <img src={r.thumbnailUrl} alt={r.itemNo} className="w-6 h-6 object-contain shrink-0 rounded bg-gray-800" />
                      ) : (
                        <div className="w-6 h-6 shrink-0 rounded bg-gray-800" />
                      )}
                      <span className="font-mono text-xs font-semibold shrink-0 w-14 truncate text-foreground">{r.itemNo}</span>
                      <span className="text-xs text-muted-foreground truncate flex-1">{r.itemName || '—'}</span>
                      {r.colorName && <span className="text-[10px] text-muted-foreground/60 shrink-0 hidden sm:inline truncate max-w-[80px]">{r.colorName}</span>}
                      {r.newOrUsed && (
                        <span className={`text-[9px] font-semibold rounded px-1 shrink-0 border ${r.newOrUsed === 'N' ? 'bg-blue-600/20 text-blue-300 border-blue-500/40' : 'bg-zinc-800 text-zinc-300 border-zinc-600'}`}>
                          {r.newOrUsed === 'N' ? 'N' : 'U'}
                        </span>
                      )}
                      {printedToday && (
                        <span className="text-[9px] text-amber-400 shrink-0 font-medium">printed</span>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={e => { e.stopPropagation(); onPrint([toLabelItem(r)]); }}
                        className="shrink-0"
                        data-testid={`button-range-print-row-${r.id}`}
                        title="Print this label"
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ListomaticPriority() {
  const { toast } = useToast();
  const { setInventoryInitialTab } = useScanSession();

  // While this view is mounted, route inventory-QR scans into the
  // "My Inventory" (details) tab of the inventory detail modal.
  useEffect(() => {
    setInventoryInitialTab("details");
    return () => setInventoryInitialTab(null);
  }, [setInventoryInitialTab]);

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
  // The print queue is persisted across page loads so a partially-built batch
  // survives an accidental refresh or a deploy. The version key is bumped
  // whenever the LotItem shape changes — older payloads are dropped on load.
  const LOT_QUEUE_STORAGE_KEY = 'elfie.lotQueue.v4';
  const [lotQueue, setLotQueue] = useState<LotItem[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(LOT_QUEUE_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed as LotItem[] : [];
    } catch {
      return [];
    }
  });
  // Drop legacy payloads (older versions lacked changeType on date-range items
  // so filter pills returned 0 results until users re-queued).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem('elfie.lotQueue.v1');
      window.localStorage.removeItem('elfie.lotQueue.v2');
      window.localStorage.removeItem('elfie.lotQueue.v3');
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (lotQueue.length === 0) {
        window.localStorage.removeItem(LOT_QUEUE_STORAGE_KEY);
      } else {
        window.localStorage.setItem(LOT_QUEUE_STORAGE_KEY, JSON.stringify(lotQueue));
      }
    } catch { /* quota exceeded — silently ignore */ }
  }, [lotQueue]);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  // When set, the print dialog prints this subset instead of the full queue.
  // Cleared automatically when the print dialog closes.
  const [pendingPrintIds, setPendingPrintIds] = useState<Set<number> | null>(null);
  // When set, the print dialog prints this exact list (a single lot's "print
  // now" from the search results) instead of the queue. Cleared on dialog close.
  const [quickPrintItems, setQuickPrintItems] = useState<LotLabelPrintItem[] | null>(null);

  // ── Listing tab ───────────────────────────────────────────────────────────
  const todayStr = new Date().toISOString().split('T')[0];
  const [rangeFrom, setRangeFrom] = useState(todayStr);
  const [rangeTo, setRangeTo] = useState(todayStr);
  const [rangeMode, setRangeMode] = useState(false);

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

  // Group results by part+condition so multi-bin combos can be flagged for QC.
  const lotGroups = useMemo(() => groupLotsByPartCondition(lotResults), [lotResults]);

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
  // Live search: debounce the typed query so results appear on the fly without
  // needing to click a search button.
  useEffect(() => {
    const t = setTimeout(() => setLotSearchSubmitted(lotSearch.trim()), 250);
    return () => clearTimeout(t);
  }, [lotSearch]);

  const handleLotFilterChange = (f: LotFilter) => {
    setLotFilter(f);
    setLotSearchSubmitted(lotSearch.trim());
  };

  const addToQueue = (lot: LotItem) => {
    if (lotQueue.some(l => l.id === lot.id)) return;
    setLotQueue(prev => [...prev, { ...lot, locationLabel: null, binName: null }]);
  };

  const removeFromQueue = (id: number) => {
    setLotQueue(prev => prev.filter(l => l.id !== id));
  };

  // Print a single lot's label immediately from the search results, without
  // touching the print queue. Used by the per-row "Print" button.
  const quickPrint = (lot: LotItem) => {
    setQuickPrintItems([lot]);
    setPrintDialogOpen(true);
  };

  // "Pull from BrickLink" — runs the incremental inventory sync (downloads BL
  // inventory, upserts new/changed lots), then refetches the lot search so a
  // newly-added lot (or new color of an existing part) shows up ready to print.
  const pullFromBricklinkMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/sync/bricklink/inventory', {}),
    onSuccess: (data: any) => {
      const added = data?.data?.inventoryAdded ?? 0;
      const updated = data?.data?.inventoryUpdated ?? 0;
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/lots'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/stats'] });
      toast({
        title: 'BrickLink sync complete',
        description: added > 0 || updated > 0
          ? `${added} lot${added !== 1 ? 's' : ''} added, ${updated} updated — searching again…`
          : 'No new lots found on BrickLink. Double-check the part was added there first.',
      });
    },
    onError: (err: any) => toast({
      title: 'Pull failed',
      description: err?.message || 'Could not pull from BrickLink.',
      variant: 'destructive',
    }),
  });

  // ── Lot label print queue ─────────────────────────────────────────────────
  // The actual PDF rendering lives in LotLabelTemplatePrint.tsx so any font /
  // layout change applies to BOTH this bulk queue and InventoryDetail's
  // single-lot print. Don't fork the template — edit the shared file.
  // Add a list of items to the print queue. Lot labels never carry a location:
  // the bag's identity is permanent, where it physically lives is not.
  const enqueueForPrint = (items: LotItem[]) => {
    setLotQueue(prev => {
      const existing = new Set(prev.map(l => l.id));
      const additions = items
        .filter(l => !existing.has(l.id))
        .map(l => ({ ...l, locationLabel: null, binName: null }));
      return [...prev, ...additions];
    });
    if (items.length > 0) {
      toast({ title: `Added ${items.length} lot${items.length !== 1 ? 's' : ''} to print queue` });
    }
  };

  // Items the print dialog should print: honour an in-flight subset selection
  // from the queue's filter pills so the user can print just NEW (or just
  // UPDATED) without disturbing the rest of the queue.
  const itemsToPrint: LotLabelPrintItem[] = quickPrintItems
    ? quickPrintItems
    : pendingPrintIds
      ? lotQueue.filter(l => pendingPrintIds.has(l.id))
      : lotQueue;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <Tabs defaultValue="categories">
        <TabsList className="w-full grid grid-cols-3 mb-2">
          <TabsTrigger value="categories" data-testid="tab-categories">Sort</TabsTrigger>
          <TabsTrigger value="listing" data-testid="tab-listing">
            <Sparkles className="w-3 h-3 mr-1" /> List
          </TabsTrigger>
          <TabsTrigger value="lots" data-testid="tab-lots">File</TabsTrigger>
        </TabsList>

        {/* ── LISTING TAB (Smart Parts) ─────────────────────────────── */}
        <TabsContent value="listing" className="space-y-3 mt-0">

          {/* ── Select view: search a part, print its label ──────────── */}
          {!rangeMode && (
            <>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">Find lots to label</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Search a part you added or restocked on BrickLink, print its label,
                    stick it on the bag, then drop the bag in its Ready-to-File bin.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRangeMode(true)}
                  className="gap-1.5 text-xs"
                  data-testid="button-range-labels"
                >
                  <Calendar className="h-3.5 w-3.5" />
                  Print by date range
                </Button>
              </div>

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
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder={lotFilter === 'all' ? 'Part number or name…' : 'Narrow by part number or name…'}
                  value={lotSearch}
                  onChange={e => setLotSearch(e.target.value)}
                  className="pl-8 pr-8 text-xs"
                  data-testid="input-lot-search"
                />
                {lotSearchLoading && (
                  <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
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
                    <div className="text-center py-6 space-y-3" data-testid="lots-empty-state">
                      <p className="text-xs text-muted-foreground">
                        {lotSearchSubmitted
                          ? <>No lots found matching &ldquo;{lotSearchSubmitted}&rdquo;.</>
                          : 'No lots in this filter.'}
                      </p>
                      {lotSearchSubmitted && (
                        <div className="space-y-1.5">
                          <Button
                            size="sm"
                            onClick={() => pullFromBricklinkMutation.mutate()}
                            disabled={pullFromBricklinkMutation.isPending}
                            data-testid="button-pull-bricklink"
                          >
                            {pullFromBricklinkMutation.isPending ? (
                              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Pulling from BrickLink…</>
                            ) : (
                              <><RefreshCw className="h-3.5 w-3.5" /> Pull from BrickLink</>
                            )}
                          </Button>
                          <p className="text-[10px] text-muted-foreground/70 max-w-xs mx-auto">
                            Syncs the lots you just added to BrickLink, then shows them here to print.
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <p className="text-[10px] text-muted-foreground mb-1">
                        <span className="font-semibold text-foreground">{lotResults.length}</span> lot{lotResults.length !== 1 ? 's' : ''}
                        {lotResults.length === 200 && <span className="text-muted-foreground/60"> (showing first 200)</span>}
                        {' '}— tap a row to queue, or use the printer icon to print now
                      </p>
                      <div className="rounded-md border border-border bg-muted/20 max-h-52 overflow-y-auto">
                        {lotGroups.map((group) => {
                          const cond = conditionLabel(group.newOrUsed);
                          const testKey = `${group.itemNo}-${group.newOrUsed ?? 'NA'}`;
                          // Most common filed bin in this group — anything else is an outlier worth a second look.
                          const freq = new Map<string, number>();
                          for (const l of group.lots) {
                            const sig = parseBins(l.locationLabel).sort().join(', ');
                            if (sig) freq.set(sig, (freq.get(sig) ?? 0) + 1);
                          }
                          let majoritySig = '';
                          let maxN = 0;
                          freq.forEach((n, s) => { if (n > maxN) { maxN = n; majoritySig = s; } });
                          return (
                            <div key={group.key} className="border-b border-border last:border-b-0" data-testid={`group-${testKey}`}>
                              {/* Group header: part + condition + bin summary / multi-bin flag */}
                              <div className={`flex items-center gap-2 flex-wrap px-3 py-1.5 border-b ${group.multiBin ? 'bg-orange-500/10 border-orange-500/30' : 'bg-muted/40 border-border'}`}>
                                <span className="font-mono text-xs font-semibold text-foreground">{group.itemNo}</span>
                                <span className="text-[11px] text-muted-foreground break-words min-w-0">{group.itemName || '—'}</span>
                                {cond && (
                                  <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 border ${group.newOrUsed === 'N' ? 'bg-blue-600 text-white border-blue-400' : 'bg-zinc-900 text-white border-zinc-400'}`}>{cond}</span>
                                )}
                                {group.multiBin ? (
                                  <span className="flex items-center gap-1 text-[10px] font-semibold text-orange-300 break-words" data-testid={`flag-multibin-${testKey}`}>
                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                    In {group.bins.length} bins: {group.bins.join(', ')} — check consolidation
                                  </span>
                                ) : group.bins.length === 1 ? (
                                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                    <MapPin className="h-3 w-3 shrink-0" />
                                    {group.bins[0]}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground/60">No filed bin yet</span>
                                )}
                              </div>
                              {/* Color rows */}
                              <div className="divide-y divide-border">
                                {group.lots.map((lot) => {
                                  const inQueue = lotQueue.some(l => l.id === lot.id);
                                  const lotBins = parseBins(lot.locationLabel).sort();
                                  const sig = lotBins.join(', ');
                                  const isOutlier = group.multiBin && !!sig && sig !== majoritySig;
                                  return (
                                    <div
                                      key={lot.id}
                                      className="w-full flex items-center"
                                      data-testid={`lot-result-${lot.id}`}
                                    >
                                      <button
                                        onClick={() => addToQueue(lot)}
                                        disabled={inQueue}
                                        className={`flex-1 min-w-0 flex items-start gap-2 px-3 py-2 text-left transition-colors ${inQueue ? 'opacity-40 cursor-default' : 'hover-elevate'}`}
                                        data-testid={`button-queue-lot-${lot.id}`}
                                      >
                                        <Package className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                                        <div className="flex-1 min-w-0 space-y-0.5">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            {lot.colorRgb && (
                                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-white/20" style={{ backgroundColor: `#${lot.colorRgb}` }} />
                                            )}
                                            <span className="text-xs text-foreground break-words">{lot.colorName || '—'}</span>
                                            {lot.isFilingQueue && (
                                              <span className="text-[8px] font-semibold text-indigo-400 bg-indigo-500/10 border border-indigo-500/30 rounded px-1">Queue</span>
                                            )}
                                            {!lot.assigned && !lot.isFilingQueue && (
                                              <span className="text-[8px] font-semibold text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded px-1">Unassigned</span>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-2 flex-wrap">
                                            {lotBins.length > 0 ? (
                                              <span className={`flex items-center gap-1 text-[10px] ${isOutlier ? 'text-orange-300 font-semibold' : 'text-muted-foreground/70'}`} data-testid={`lot-bin-${lot.id}`}>
                                                <MapPin className="h-3 w-3 shrink-0" />
                                                {sig}
                                              </span>
                                            ) : (
                                              <span className="text-[10px] text-muted-foreground/50">No filed bin</span>
                                            )}
                                            {isOutlier && (
                                              <span className="text-[8px] font-semibold text-orange-300 bg-orange-500/10 border border-orange-500/30 rounded px-1">different bin</span>
                                            )}
                                          </div>
                                        </div>
                                        {inQueue ? (
                                          <Check className="h-3.5 w-3.5 shrink-0 mt-0.5 text-green-500" />
                                        ) : (
                                          <Plus className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                                        )}
                                      </button>
                                      <div className="pr-1.5 shrink-0">
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          onClick={() => quickPrint(lot)}
                                          data-testid={`button-print-lot-${lot.id}`}
                                          aria-label={`Print label for lot ${lot.itemNo}`}
                                          title="Print this lot label now"
                                        >
                                          <Printer className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {lotSearchSubmitted && (
                        <div className="flex justify-center pt-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-[11px] text-muted-foreground"
                            onClick={() => pullFromBricklinkMutation.mutate()}
                            disabled={pullFromBricklinkMutation.isPending}
                            data-testid="button-pull-bricklink-inline"
                          >
                            {pullFromBricklinkMutation.isPending ? (
                              <><Loader2 className="h-3 w-3 animate-spin" /> Pulling from BrickLink…</>
                            ) : (
                              <><RefreshCw className="h-3 w-3" /> Don&rsquo;t see it? Pull from BrickLink</>
                            )}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Date range mode ─────────────────────────────────────── */}
          {rangeMode && (
            <DateRangeLabels
              from={rangeFrom}
              to={rangeTo}
              onFrom={setRangeFrom}
              onTo={setRangeTo}
              onCancel={() => setRangeMode(false)}
              onPrint={(items) => {
                setQuickPrintItems(items);
                setPrintDialogOpen(true);
              }}
            />
          )}
        </TabsContent>

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
          <WarehouseScanPanel embedded />
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

      {/* ── Lot label print dialog (shared template w/ InventoryDetail) ── */}
      <LotLabelTemplatePrintDialog
        open={printDialogOpen}
        onOpenChange={(open) => { setPrintDialogOpen(open); if (!open) { setPendingPrintIds(null); setQuickPrintItems(null); } }}
        items={itemsToPrint}
        markRtf
      />
    </div>
  );
}

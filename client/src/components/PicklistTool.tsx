import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Package, Loader2, ChevronDown, ChevronRight, ScanLine, Camera, X, CheckCircle2, AlertCircle, AlertTriangle, ArrowUpAZ, ArrowDownAZ, Warehouse, Layers, Box } from "lucide-react";
import { printPicklist, openPrintWindow, shortCode } from "./PackingSlip";
import PartImage from "./PartImage";
import { useFeatures } from "@/hooks/use-feature";

type WarehouseLocation = {
  aisle: { id: number; name: string };
  shelf: { id: number; name: string };
  bin: { id: number; name: string; description: string | null };
};

type BinPicklistItem = {
  picklistItemId: string;
  orderDetailId: string;
  orderId: string;
  orderNumber: string;
  marketplace: string | null;
  customerNotes: string | null;
  itemName: string;
  quantity: number;
  sku: string;
  partNumber: string | null;
  colorName: string | null;
  colorId: number | null;
  condition: string | null;
  pulled: boolean;
  inventoryId: number | null;
  inventoryQty: number | null;
  remarks: string | null;
  comment: string | null;
  imageUrl: string | null;
  // Ready-to-File pre-sort hint set when the lot's label was printed in the
  // listing flow. Aisle name only — meaningless once the bag is filed for
  // real. Surfaces as a small badge next to the bin so a picker can grab the
  // bag from its rtf tote when an order arrives before re-filing happens.
  rtfBin: string | null;
};

type BinPicklist = {
  binId: number | null;
  warehouseLocation: WarehouseLocation | null;
  itemCount: number;
  items: BinPicklistItem[];
  pulled: boolean;
};

// ── Per-name hues ───────────────────────────────────────────────────────────
// Deterministic hash → hue. Used for the slim color rail on the left edge of
// each bin row AND for the aisle/shelf chips — gives the picker an instant
// peripheral-vision cue that distinguishes aisle from shelf even when both
// are present, and lets the same aisle/shelf letter or number be recognized
// across the whole list by color alone.
//
// Aisle and shelf use DIFFERENT hue offsets so aisle "A" and shelf "1" don't
// collide on the same color. Within each family the colors are stable across
// the whole app — users learn the mapping over time.
function hashHue(name: string, offset: number): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  // 12 evenly-spaced hue stops avoid muddy in-between values.
  return ((Math.abs(h) % 12) * 30 + offset) % 360;
}
function aisleHue(name: string): number { return hashHue(name, 15); }
function shelfHue(name: string): number { return hashHue(name, 195); } // ~opposite side of color wheel
function aisleRailColor(name: string | undefined | null): string {
  if (!name) return 'rgba(120,120,140,0.5)';
  return `hsl(${aisleHue(name)} 85% 60%)`;
}

// Build inline styles for a color-coded chip from a hue. We use inline styles
// (instead of Tailwind classes) so every aisle/shelf gets a distinct color
// without enumerating ~12 utility classes.
function chipStyle(hue: number): React.CSSProperties {
  return {
    backgroundColor: `hsl(${hue} 70% 50% / 0.18)`,
    color: `hsl(${hue} 85% 72%)`,
    borderColor: `hsl(${hue} 70% 50% / 0.40)`,
  };
}

// ── Location chips ──────────────────────────────────────────────────────────
// Picklist headers used to render the bin name as flat text like "1-A-19",
// which made aisle/shelf/bin all blur together. We split it into colored,
// icon-prefixed chips so each segment is instantly distinguishable.
// Aisle chip color is keyed off aisle name, shelf chip color is keyed off
// shelf name — so aisle A is always one color, shelf 1 is always one color,
// independent of one another. Bin keeps a fixed emerald to anchor the eye.
function LocationChips({ loc }: { loc: WarehouseLocation | null }) {
  if (!loc) {
    return (
      <span className="text-sm font-medium text-gray-400" data-testid="text-bin-unassigned">
        Unassigned
      </span>
    );
  }
  const slots: Array<{ icon: any; value: string; style?: React.CSSProperties; cls?: string; testid: string }> = [];
  if (loc.aisle?.name) slots.push({
    icon: Warehouse, value: loc.aisle.name,
    style: chipStyle(aisleHue(loc.aisle.name)),
    testid: 'chip-aisle',
  });
  if (loc.shelf?.name) slots.push({
    icon: Layers, value: loc.shelf.name,
    style: chipStyle(shelfHue(loc.shelf.name)),
    testid: 'chip-shelf',
  });
  if (loc.bin?.name) {
    const binOnly = loc.bin.name.split('-').pop() || loc.bin.name;
    slots.push({
      icon: Box, value: binOnly,
      cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      testid: 'chip-bin',
    });
  }
  return (
    <div className="flex items-center gap-1 flex-wrap min-w-0">
      {slots.map((s, i) => {
        const Icon = s.icon;
        return (
          <span
            key={i}
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-semibold tabular-nums leading-tight ${s.cls ?? ''}`}
            style={s.style}
            data-testid={s.testid}
          >
            <Icon className="h-3 w-3 shrink-0" />
            {s.value}
          </span>
        );
      })}
    </div>
  );
}

type ViewMode = 'by_part' | 'by_bin';
type Filter = 'all' | 'to_pull';

interface PicklistToolProps {
  filterOrderIds?: Set<string>;
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
}

// ── Shared mutation options factory for picklist optimistic updates ──────────
// Each mutation only differs in its endpoint and cache updater;
// onMutate / onError / onSettled are identical across all four.
function picklistMutationOptions<TVariables>(
  mutationFn: (vars: TVariables) => Promise<any>,
  optimisticUpdate: (cache: any[], vars: TVariables) => any[],
  getFilter: () => Filter,
) {
  return {
    mutationFn,
    onMutate: async (vars: TVariables) => {
      await queryClient.cancelQueries({ queryKey: ['/api/picklist'] });
      const f = getFilter();
      const prev = queryClient.getQueryData(['/api/picklist', f]);
      queryClient.setQueryData(['/api/picklist', f], (old: any) =>
        optimisticUpdate(old ?? [], vars)
      );
      return { prev, f };
    },
    onError: (_e: any, _v: any, ctx: any) => {
      if (ctx?.prev) queryClient.setQueryData(['/api/picklist', ctx.f], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/picklist'] });
      queryClient.invalidateQueries({ queryKey: ['/api/picklist/stats'] });
    },
  };
}

const SORT_DIR_KEY = 'picklist-sort-dir';

export default function PicklistTool({ filterOrderIds, onItemClick }: PicklistToolProps = {}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => {
    try { return (localStorage.getItem(SORT_DIR_KEY) as 'asc' | 'desc') ?? 'asc'; } catch { return 'asc'; }
  });

  const toggleSortDir = () => setSortDir(prev => {
    const next = prev === 'asc' ? 'desc' : 'asc';
    try { localStorage.setItem(SORT_DIR_KEY, next); } catch {}
    return next;
  });
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // ── Scan-to-pick state ──
  const [scanMode, setScanMode] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [autoPull, setAutoPull] = useState(false);
  const [scannedBinId, setScannedBinId] = useState<number | null>(null);
  const [scanFeedback, setScanFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lightboxItem, setLightboxItem] = useState<BinPicklistItem | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleGroup = (key: string) =>
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  // Auto-focus scan input when scan mode activates
  useEffect(() => {
    if (scanMode) setTimeout(() => scanInputRef.current?.focus(), 100);
    else { setCameraOpen(false); setScanFeedback(null); setScanInput(''); }
  }, [scanMode]);

  // Stop camera when closed
  useEffect(() => {
    if (!cameraOpen) {
      cameraStreamRef.current?.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }
  }, [cameraOpen]);

  // Clean up camera on unmount
  useEffect(() => () => {
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
  }, []);

  const { data: warehouseSettings, isLoading: warehouseLoading } = useQuery<{ depth: number }>({
    queryKey: ['/api/warehouse/settings'],
  });
  const warehouseDepth = warehouseSettings?.depth ?? 0;
  // Bin locations only appear on the picklist when the Cargo Bay (warehouse)
  // feature is enabled AND a warehouse depth is configured. Turning Cargo Bay
  // off forces the plain "by part" list without touching any saved depth or
  // bin data, so turning it back on restores locations exactly as before.
  // Read both inputs from their queries and wait for them to settle (see the
  // loading gate below) so the view mode is resolved once rather than flipping
  // from by-part to by-bin as each query resolves.
  const { visible: visibleFeatures, isLoading: featuresLoading } = useFeatures();
  const cargoBayEnabled = visibleFeatures.includes('inv_cargo_bay');
  const scanPickEnabled = visibleFeatures.includes('orders_scan_pick');
  const viewMode: ViewMode = cargoBayEnabled && warehouseDepth >= 1 ? 'by_bin' : 'by_part';

  // Force scan mode off if the gated feature becomes unavailable
  useEffect(() => {
    if (!scanPickEnabled && scanMode) setScanMode(false);
  }, [scanPickEnabled, scanMode]);

  const { data: picklistData = [], isLoading } = useQuery<BinPicklist[]>({
    queryKey: ['/api/picklist', filter],
    queryFn: async () => {
      const params = filter !== 'all' ? `?filter=${filter}` : '';
      const response = await fetch(`/api/picklist${params}`);
      if (!response.ok) throw new Error('Failed to fetch picklist');
      return response.json();
    },
    staleTime: 0,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  // Options factory closes over current `filter` on each render (TanStack Query v5 observes options)
  const getFilter = () => filter;

  // ── Bin-level pull mutation ──
  const pullBinMutation = useMutation(picklistMutationOptions(
    ({ binId, pulled }: { binId: number; pulled: boolean }) =>
      apiRequest('PUT', `/api/picklist/bin/${binId}/pull`, { pulled }),
    (old, { binId, pulled }) => old.map((b: any) =>
      b.binId === binId
        ? { ...b, pulled, items: b.items.map((it: any) => ({ ...it, pulled })) }
        : b
    ),
    getFilter,
  ));

  // ── Item-level pull mutation ──
  const pullItemMutation = useMutation(picklistMutationOptions(
    ({ itemId, pulled }: { itemId: string; pulled: boolean }) =>
      apiRequest('PUT', `/api/picklist/item/${itemId}/pull`, { pulled }),
    (old, { itemId, pulled }) =>
      old.map((bin: any) => {
        const updatedItems = bin.items.map((it: any) =>
          it.picklistItemId === itemId ? { ...it, pulled } : it
        );
        return {
          ...bin,
          items: updatedItems,
          pulled: updatedItems.every((it: any) => it.pulled),
        };
      }),
    getFilter,
  ));

  // ── Scan processing ──
  const processScan = useCallback((raw: string, picklist: BinPicklist[]) => {
    const value = raw.trim();
    if (!value) return;

    // Parse QR payload: "BIN:BIN-A1", "SHELF:SH-3", "AISLE:A", or bare bin name
    const colonIdx = value.indexOf(':');
    const type = colonIdx > -1 ? value.slice(0, colonIdx).toUpperCase() : 'BIN';
    const name = colonIdx > -1 ? value.slice(colonIdx + 1) : value;

    let matchedBin: BinPicklist | null = null;

    if (type === 'BIN') {
      matchedBin = picklist.find(b =>
        b.warehouseLocation?.bin.name.toLowerCase() === name.toLowerCase()
      ) ?? null;
    } else if (type === 'SHELF') {
      // Find first bin on this shelf
      matchedBin = picklist.find(b =>
        b.warehouseLocation?.shelf.name.toLowerCase() === name.toLowerCase()
      ) ?? null;
    } else if (type === 'AISLE') {
      matchedBin = picklist.find(b =>
        b.warehouseLocation?.aisle.name.toLowerCase() === name.toLowerCase()
      ) ?? null;
    }

    if (!matchedBin) {
      setScanFeedback({ ok: false, message: `"${name}" not found in picklist` });
      setTimeout(() => setScanFeedback(null), 3000);
      return;
    }

    setScannedBinId(matchedBin.binId);
    setScanFeedback({ ok: true, message: `Found: ${matchedBin.warehouseLocation?.bin.name || name}` });

    // Scroll to the bin after a tick (allow re-render)
    setTimeout(() => {
      const binEl = document.querySelector(`[data-bin-scan-id="${matchedBin!.binId}"]`);
      binEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);

    // Auto-pull if enabled
    if (autoPull && matchedBin.binId && !matchedBin.pulled) {
      pullBinMutation.mutate({ binId: matchedBin.binId, pulled: true });
    }

    // Clear highlight after 4s
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = setTimeout(() => {
      setScannedBinId(null);
      setScanFeedback(null);
    }, 4000);
  }, [autoPull, pullBinMutation]);

  // ── Camera scanning via BarcodeDetector API ──
  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (!('BarcodeDetector' in window)) {
      setCameraError('Your browser does not support camera QR scanning. Use a hardware scanner or type the bin code instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      // @ts-ignore — BarcodeDetector not in TS types yet
      const detector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39'] });
      const scan = async () => {
        if (!cameraStreamRef.current) return;
        try {
          if (videoRef.current && videoRef.current.readyState >= 2) {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) {
              const val = codes[0].rawValue;
              processScan(val, picklistData);
              // Brief pause before next scan
              setTimeout(scan, 2000);
              return;
            }
          }
        } catch {}
        if (cameraStreamRef.current) requestAnimationFrame(scan);
      };
      requestAnimationFrame(scan);
    } catch (err: any) {
      setCameraError(err.name === 'NotAllowedError' ? 'Camera permission denied.' : 'Could not access camera.');
    }
  }, [picklistData, processScan]);

  useEffect(() => {
    if (cameraOpen) startCamera();
  }, [cameraOpen, startCamera]);

  const partKey = (item: BinPicklistItem) => item.partNumber || item.sku || '';

  const cmpDir = (n: number) => sortDir === 'asc' ? n : -n;

  const handlePrint = async () => {
    const preWin = openPrintWindow();
    const sortedItems = [...flatItems].sort((a, b) => {
      const pk = cmpDir(partKey(a).localeCompare(partKey(b), undefined, { numeric: true }));
      if (pk !== 0) return pk;
      const condCmp = cmpDir((a.condition || '').localeCompare(b.condition || ''));
      if (condCmp !== 0) return condCmp;
      return cmpDir((a.colorName || '').localeCompare(b.colorName || ''));
    });
    await printPicklist(sortedItems, preWin);
  };

  // ── Derived data ──
  // Apply order filter when orders are selected in the tiles
  const filteredPicklistData: BinPicklist[] =
    filterOrderIds && filterOrderIds.size > 0
      ? picklistData
          .map(bin => ({ ...bin, items: bin.items.filter(item => filterOrderIds.has(item.orderId)) }))
          .filter(bin => bin.items.length > 0)
      : picklistData;

  const flatItems: BinPicklistItem[] = filteredPicklistData
    .flatMap(bin => bin.items)
    .sort((a, b) => {
      const pk = cmpDir(partKey(a).localeCompare(partKey(b), undefined, { numeric: true }));
      if (pk !== 0) return pk;
      const condCmp = cmpDir((a.condition || '').localeCompare(b.condition || ''));
      if (condCmp !== 0) return condCmp;
      return cmpDir((a.colorName || '').localeCompare(b.colorName || ''));
    });

  const groupedBins = filteredPicklistData.reduce((acc, bin) => {
    const aisleKey = bin.warehouseLocation?.aisle.name || 'No Location';
    const shelfKey = bin.warehouseLocation?.shelf.name || 'No Shelf';
    if (!acc[aisleKey]) acc[aisleKey] = {};
    if (!acc[aisleKey][shelfKey]) acc[aisleKey][shelfKey] = [];
    acc[aisleKey][shelfKey].push(bin);
    return acc;
  }, {} as Record<string, Record<string, BinPicklist[]>>);

  const sortedAisles = Object.keys(groupedBins).sort((a, b) =>
    sortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a)
  );

  if (isLoading || featuresLoading || warehouseLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
      </div>
    );
  }

  const isEmpty = viewMode === 'by_part' ? flatItems.length === 0 : sortedAisles.length === 0;

  const noOrdersSelected = filterOrderIds !== undefined && filterOrderIds.size === 0;

  return (
    <>
    <div className="space-y-4">

      {/* ── Controls row — hidden when no orders selected ── */}
      {!noOrdersSelected && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Status filters */}
          <button
            onClick={() => setFilter('all')}
            className={`text-xs px-2.5 py-1.5 rounded font-medium transition-colors ${
              filter === 'all'
                ? 'bg-gray-600 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
            data-testid="button-filter-all"
          >
            All
          </button>
          <button
            onClick={() => setFilter('to_pull')}
            className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded font-medium transition-colors ${
              filter === 'to_pull'
                ? 'bg-gray-600 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
            data-testid="button-filter-to-pull"
          >
            <Package className="h-3 w-3" />
            To Pick
          </button>

          {/* Separator */}
          <div className="w-px h-5 bg-gray-700 shrink-0" />

          {/* Sort direction toggle */}
          <button
            onClick={toggleSortDir}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700"
            title={sortDir === 'asc' ? 'Sort A → Z (click to reverse)' : 'Sort Z → A (click to reverse)'}
            data-testid="button-picklist-sort-dir"
          >
            {sortDir === 'asc'
              ? <ArrowUpAZ className="w-3.5 h-3.5" />
              : <ArrowDownAZ className="w-3.5 h-3.5" />
            }
            {sortDir === 'asc' ? 'A–Z' : 'Z–A'}
          </button>

          {/* Scan Mode toggle (gated beta feature) */}
          {scanPickEnabled && (
            <>
              {/* Separator */}
              <div className="w-px h-5 bg-gray-700 shrink-0" />
              <button
                onClick={() => setScanMode(s => !s)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  scanMode
                    ? 'bg-yellow-500/20 border border-yellow-500/50 text-yellow-300'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'
                }`}
                data-testid="button-scan-mode"
              >
                <ScanLine className="w-3.5 h-3.5" />
                {scanMode ? 'Scanning…' : 'Scan'}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Scan mode bar ── */}
      {scanPickEnabled && scanMode && !noOrdersSelected && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <ScanLine className="h-4 w-4 text-yellow-400 shrink-0" />
            <span className="text-xs font-semibold text-yellow-300">Scan Mode Active</span>
            <span className="text-xs text-gray-500 ml-1">Point scanner at a bin label or type a bin name</span>
            <button
              className="ml-auto text-gray-500 hover:text-gray-300 transition-colors"
              onClick={() => setScanMode(false)}
              data-testid="button-scan-close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Input + camera button */}
          <div className="flex gap-2">
            <Input
              ref={scanInputRef}
              value={scanInput}
              onChange={e => setScanInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  processScan(scanInput, picklistData);
                  setScanInput('');
                }
              }}
              placeholder="BIN:BIN-A1 or just BIN-A1…"
              className="flex-1 h-8 text-xs bg-gray-900 border-gray-600 text-white placeholder:text-gray-600 font-mono"
              data-testid="input-scan"
            />
            <button
              onClick={() => setCameraOpen(o => !o)}
              className={`flex items-center gap-1 px-3 rounded-md text-xs border transition-colors ${
                cameraOpen
                  ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300'
                  : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
              }`}
              data-testid="button-camera-scan"
            >
              <Camera className="h-3.5 w-3.5" />
              Camera
            </button>
          </div>

          {/* Auto-pull toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
            <div
              onClick={() => setAutoPull(p => !p)}
              className={`w-8 h-4 rounded-full transition-colors relative ${autoPull ? 'bg-yellow-500' : 'bg-gray-600'}`}
            >
              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${autoPull ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-xs text-gray-400">Auto-mark bin as pulled on scan</span>
          </label>

          {/* Camera view */}
          {cameraOpen && (
            <div className="rounded-md overflow-hidden border border-gray-700 bg-black relative">
              {cameraError ? (
                <div className="flex items-center gap-2 p-4 text-xs text-red-400">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {cameraError}
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    className="w-full max-h-48 object-cover"
                    muted
                    playsInline
                    autoPlay
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-40 h-40 border-2 border-yellow-400/60 rounded-md" />
                  </div>
                  <p className="absolute bottom-1 left-0 right-0 text-center text-xs text-yellow-400/80">
                    Point at a QR code
                  </p>
                </>
              )}
            </div>
          )}

          {/* Scan feedback */}
          {scanFeedback && (
            <div className={`flex items-center gap-2 text-xs rounded px-2 py-1.5 ${
              scanFeedback.ok
                ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                : 'bg-red-500/10 border border-red-500/30 text-red-400'
            }`}>
              {scanFeedback.ok
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                : <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              }
              {scanFeedback.message}
            </div>
          )}
        </div>
      )}

      {/* ── Empty state: no orders selected ── */}
      {noOrdersSelected && (
        <div className="text-center py-12 text-gray-500">
          <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>No orders selected</p>
          <p className="text-sm mt-1">Select orders above to view their picklist items</p>
        </div>
      )}

      {/* ── Empty state: orders selected but nothing to show ── */}
      {!noOrdersSelected && isEmpty && (
        <div className="text-center py-12 text-gray-500">
          <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>Nothing in picklist</p>
          <p className="text-sm mt-1">Items appear here when orders are awaiting fulfillment</p>
        </div>
      )}

      {/* ══════════════════════════════════════════
          VIEW: BY PART NUMBER — grouped by part, variants collapsible
          ══════════════════════════════════════════ */}
      {viewMode === 'by_part' && !noOrdersSelected && !isEmpty && (() => {
        // Group flatItems by partNumber (or sku fallback)
        const partGroups: Map<string, BinPicklistItem[]> = new Map();
        for (const item of flatItems) {
          const key = partKey(item);
          if (!partGroups.has(key)) partGroups.set(key, []);
          partGroups.get(key)!.push(item);
        }

        return (
          <div className="space-y-3" data-testid="picklist-by-part">
            {Array.from(partGroups.entries()).map(([key, variants]) => {
              const allPulled = variants.every(v => v.pulled);
              const somePulled = variants.some(v => v.pulled);
              const rep = variants[0];
              const isExpanded = expandedGroups.has(key);
              const totalQty = variants.reduce((sum, v) => sum + v.quantity, 0);
              const groupIsShort = variants.some(v => v.inventoryQty !== null && v.inventoryQty < v.quantity);

              return (
                <div
                  key={key}
                  className={`rounded-lg border overflow-hidden transition-colors ${
                    allPulled
                      ? 'border-blue-800/30'
                      : somePulled
                      ? 'border-yellow-700/40'
                      : 'border-gray-700'
                  }`}
                  data-testid={`part-group-${key}`}
                >
                  {/* Part group header — tap to open detail; chevron toggles expand */}
                  <div
                    className={`flex items-center gap-3 px-3 py-2 cursor-pointer select-none ${
                      allPulled
                        ? 'bg-blue-950/30'
                        : somePulled
                        ? 'bg-yellow-950/20'
                        : 'bg-gray-800/70'
                    }`}
                    onClick={() => {
                      if (rep.inventoryId != null && onItemClick) {
                        onItemClick('inventory', rep.inventoryId);
                      } else {
                        toggleGroup(key);
                      }
                    }}
                  >
                    {/* Group-level pull checkbox */}
                    <Checkbox
                      data-testid={`checkbox-pull-group-${key}`}
                      checked={allPulled ? true : somePulled ? 'indeterminate' : false}
                      onCheckedChange={() => {
                        const target = !allPulled;
                        variants.forEach(v =>
                          pullItemMutation.mutate({ itemId: v.picklistItemId, pulled: target })
                        );
                      }}
                      onClick={e => e.stopPropagation()}
                      disabled={pullItemMutation.isPending}
                      className="shrink-0 touch-auto"
                    />

                    {/* Part thumbnail — click for fullscreen */}
                    <button
                      type="button"
                      data-testid={`img-thumb-part-${key}`}
                      className="shrink-0 w-9 h-9 rounded overflow-hidden bg-gray-700/40 flex items-center justify-center"
                      onClick={e => { e.stopPropagation(); setLightboxItem(rep); }}
                    >
                      <PartImage
                        imageUrl={rep.imageUrl}
                        partNumber={rep.partNumber}
                        colorId={rep.colorId}
                        className="w-full h-full object-contain"
                        fallbackClassName="w-5 h-5 text-gray-500"
                      />
                    </button>

                    <div className="flex-1 min-w-0">
                      {/* Line 1: part# + part name */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {groupIsShort && (
                          <AlertTriangle
                            className="w-3 h-3 text-amber-400 shrink-0 print:hidden"
                          />
                        )}
                        {(rep.marketplace === 'BrickOwl' ? rep.partNumber : (rep.partNumber || rep.sku)) && (
                          <span className="font-mono text-xs font-bold text-white bg-purple-800/80 border border-purple-500/50 px-1.5 py-0.5 rounded shrink-0 tracking-wide">
                            {rep.marketplace === 'BrickOwl' ? rep.partNumber : (rep.partNumber || rep.sku)}
                          </span>
                        )}
                        <span className={`text-xs font-medium leading-snug ${allPulled ? 'text-gray-400 line-through' : 'text-white'}`}>
                          {rep.itemName}
                        </span>
                      </div>
                    </div>

                    {/* Summary: lot count + chevron (chevron toggles expand) */}
                    <div
                      className="shrink-0 flex items-center gap-2 text-xs text-gray-400 tabular-nums"
                      onClick={e => { e.stopPropagation(); toggleGroup(key); }}
                    >
                      {variants.length > 1 && (
                        <span className="font-bold">{variants.length} Lots</span>
                      )}
                      {isExpanded
                        ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                        : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
                      }
                    </div>
                  </div>

                  {/* Variant rows — only visible when expanded */}
                  {isExpanded && (
                    <div className="divide-y divide-gray-700/50">
                      {variants.map((item) => (
                        <div
                          key={item.picklistItemId}
                          className={`flex items-start gap-3 pl-7 pr-3 py-1.5 cursor-pointer ${
                            item.pulled ? 'bg-blue-950/20' : 'bg-gray-900/60'
                          }`}
                          data-testid={`part-item-${item.picklistItemId}`}
                          onClick={() => {
                            if (item.inventoryId != null && onItemClick) {
                              onItemClick('inventory', item.inventoryId);
                            }
                          }}
                        >
                          {/* Per-item checkbox — indented under parent */}
                          <Checkbox
                            data-testid={`checkbox-pull-item-${item.picklistItemId}`}
                            checked={item.pulled}
                            onCheckedChange={(checked) =>
                              pullItemMutation.mutate({ itemId: item.picklistItemId, pulled: checked === true })
                            }
                            onClick={e => e.stopPropagation()}
                            disabled={pullItemMutation.isPending}
                            className="shrink-0 touch-auto mt-0.5"
                          />

                          {/* Variant details */}
                          <div className="flex-1 min-w-0 text-xs">
                            <div className="flex items-center gap-2 flex-wrap text-gray-400">
                              <span className="tabular-nums">Qty {item.quantity}</span>
                              {item.colorName && (
                                <span className="text-yellow-400">{item.colorName}</span>
                              )}
                              {item.condition && (
                                <span className={item.condition === 'N' ? 'cond-new' : 'cond-used'}>
                                  {item.condition === 'N' ? 'New' : item.condition === 'U' ? 'Used' : item.condition}
                                </span>
                              )}
                              <span className="font-mono inline-flex items-baseline gap-1">
                                {item.orderNumber && <span className="font-bold text-gray-200 tracking-wider">{shortCode(item.orderNumber)}</span>}
                                <span className="text-gray-500">({item.marketplace === 'BrickOwl' ? 'BO.' : 'BL.'}{(item.orderNumber || '').replace(/^(BL\.|BO\.)/i, '')})</span>
                              </span>
                              {item.inventoryQty != null && (
                                <span className="text-gray-500">Stock: {item.inventoryQty}</span>
                              )}
                            </div>
                            {(item.comment || item.remarks || item.inventoryId != null) && (
                              <div className="mt-0.5 text-xs text-blue-400/80">
                                {item.comment && <span className="italic bg-yellow-300/70 text-yellow-900 px-0.5 rounded-sm">{item.comment}</span>}
                                {item.remarks && <span className="not-italic text-gray-400">{item.comment ? ' ' : ''}{item.remarks}</span>}
                                {item.inventoryId != null && <span className="not-italic text-gray-500">{(item.comment || item.remarks) ? ' ' : ''}Lot {item.inventoryId}</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════
          VIEW: BY LOCATION — adapts to warehouse depth setting
          depth 3: aisle › shelf › bin
          depth 2: shelf › bin
          depth 1: flat bins
          ══════════════════════════════════════════ */}
      {viewMode === 'by_bin' && !noOrdersSelected && !isEmpty && (() => {
        // ── Shared bin card renderer ──────────────────────────────────────
        const renderBin = (bin: BinPicklist) => {
          const binKey = bin.binId ?? 'none';
          const binDescription = bin.warehouseLocation?.bin.description;
          const isHighlighted = scannedBinId !== null && bin.binId === scannedBinId;
          return (
            <div
              key={binKey}
              className={`space-y-1 rounded-lg transition-all duration-300 ${isHighlighted ? 'ring-2 ring-yellow-400 ring-offset-1 ring-offset-transparent' : ''}`}
              data-testid={`bin-${binKey}`}
              data-bin-scan-id={bin.binId}
            >
              <div className={`flex items-stretch gap-2 app-card overflow-hidden transition-colors ${isHighlighted ? 'bg-yellow-500/10' : ''}`}>
                {/* Aisle rail — slim color bar, hue derived from aisle name.
                    The only visual marker for an aisle change in the list. */}
                <div
                  aria-hidden
                  className="shrink-0 w-1"
                  style={{ background: aisleRailColor(bin.warehouseLocation?.aisle?.name) }}
                  data-testid={`rail-aisle-${bin.warehouseLocation?.aisle?.name ?? 'none'}`}
                />
                <div className="flex flex-1 items-center gap-3 px-3 py-2 min-w-0">
                <Checkbox
                  data-testid={`checkbox-pull-bin-${binKey}`}
                  checked={bin.pulled}
                  onCheckedChange={(checked) => {
                    if (bin.binId) pullBinMutation.mutate({ binId: bin.binId, pulled: checked === true });
                  }}
                  disabled={!bin.binId || pullBinMutation.isPending}
                  className="shrink-0 touch-auto"
                />
                <div className="flex-1 min-w-0">
                  <LocationChips loc={bin.warehouseLocation} />
                  {binDescription && (
                    <div className="text-xs text-gray-400 mt-0.5">{binDescription}</div>
                  )}
                </div>
                {bin.items.length > 0 && (
                  <span className="shrink-0 text-xs font-bold text-blue-300 bg-blue-900/40 border border-blue-700/40 rounded-full px-1.5 py-0.5 tabular-nums">
                    {bin.items.length} {bin.items.length === 1 ? 'Lot' : 'Lots'}
                  </span>
                )}
                </div>
              </div>
              {bin.items.length > 0 && (
                <div className="ml-4 space-y-1">
                  {[...bin.items].sort((a, b) => {
                    const pk = partKey(a).localeCompare(partKey(b), undefined, { numeric: true });
                    if (pk !== 0) return pk;
                    const condCmp = (a.condition || '').localeCompare(b.condition || '');
                    if (condCmp !== 0) return condCmp;
                    return (a.colorName || '').localeCompare(b.colorName || '');
                  }).map((item) => (
                    <div
                      key={item.picklistItemId}
                      className="flex items-start gap-3 bg-gray-900/60 border border-gray-700/50 rounded px-2.5 py-1.5 cursor-pointer"
                      data-testid={`picklist-item-${item.picklistItemId}`}
                      onClick={() => {
                        if (item.inventoryId != null && onItemClick) {
                          onItemClick('inventory', item.inventoryId);
                        }
                      }}
                    >
                      <Checkbox
                        data-testid={`checkbox-pull-bin-item-${item.picklistItemId}`}
                        checked={item.pulled}
                        onCheckedChange={(checked) =>
                          pullItemMutation.mutate({ itemId: item.picklistItemId, pulled: checked === true })
                        }
                        onClick={e => e.stopPropagation()}
                        disabled={pullItemMutation.isPending}
                        className="shrink-0 touch-auto mt-0.5"
                      />
                      {/* Part thumbnail — click for fullscreen */}
                      <button
                        type="button"
                        data-testid={`img-thumb-bin-item-${item.picklistItemId}`}
                        className="shrink-0 w-8 h-8 rounded overflow-hidden bg-gray-700/40 flex items-center justify-center"
                        onClick={e => { e.stopPropagation(); setLightboxItem(item); }}
                      >
                        <PartImage
                          imageUrl={item.imageUrl}
                          partNumber={item.partNumber}
                          colorId={item.colorId}
                          className="w-full h-full object-contain"
                          fallbackClassName="w-4 h-4 text-gray-500"
                        />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {item.inventoryQty !== null && item.inventoryQty < item.quantity && (
                            <AlertTriangle
                              className="w-3 h-3 text-amber-400 shrink-0 print:hidden"
                            />
                          )}
                          {(item.marketplace === 'BrickOwl' ? item.partNumber : (item.partNumber || item.sku)) && (
                            <span className="font-mono text-xs font-bold text-white bg-purple-800/80 border border-purple-500/50 px-1.5 py-0.5 rounded shrink-0 tracking-wide">
                              {item.marketplace === 'BrickOwl' ? item.partNumber : (item.partNumber || item.sku)}
                            </span>
                          )}
                          <span className="text-xs text-white leading-snug">{item.itemName}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5 flex-wrap">
                          <span className="tabular-nums">Qty {item.quantity}</span>
                          {item.colorName && <span className="text-yellow-500">{item.colorName}</span>}
                          {item.condition && (
                            <span className={item.condition === 'N' ? 'cond-new' : 'cond-used'}>
                              {item.condition === 'N' ? 'New' : item.condition === 'U' ? 'Used' : item.condition}
                            </span>
                          )}
                          {item.rtfBin && (
                            <span
                              className="font-mono text-[10px] font-bold text-emerald-100 bg-emerald-900/60 border border-emerald-600/50 px-1.5 py-0.5 rounded tracking-wide"
                              data-testid={`badge-rtf-${item.picklistItemId}`}
                              title="Ready-to-File pre-sort tote — bag is in this aisle's rtf bin until it's officially filed"
                            >
                              rtf {item.rtfBin}
                            </span>
                          )}
                          <span className="font-mono inline-flex items-baseline gap-1">
                            {item.orderNumber && <span className="font-bold text-gray-300 tracking-wider">{shortCode(item.orderNumber)}</span>}
                            <span className="text-gray-500">({item.marketplace === 'BrickOwl' ? 'BO.' : 'BL.'}{(item.orderNumber || '').replace(/^(BL\.|BO\.)/i, '')})</span>
                          </span>
                          {item.inventoryQty != null && <span>Stock: {item.inventoryQty}</span>}
                        </div>
                        {(item.comment || item.remarks || item.inventoryId != null) && (
                          <div className="mt-0.5 text-xs text-blue-400/80">
                            {item.comment && <span className="italic bg-yellow-300/70 text-yellow-900 px-0.5 rounded-sm">{item.comment}</span>}
                            {item.remarks && <span className="not-italic text-gray-400">{item.comment ? ' ' : ''}{item.remarks}</span>}
                            {item.inventoryId != null && <span className="not-italic text-gray-500">{(item.comment || item.remarks) ? ' ' : ''}Lot {item.inventoryId}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        };

        // ── depth 1: flat bin list ────────────────────────────────────────
        if (warehouseDepth === 1) {
          return (
            <div className="space-y-3" data-testid="picklist-by-bin">
              {filteredPicklistData.map(renderBin)}
            </div>
          );
        }

        // ── depth 2: shelf › bin ──────────────────────────────────────────
        if (warehouseDepth === 2) {
          const shelfGroups: Record<string, BinPicklist[]> = {};
          for (const bin of filteredPicklistData) {
            const shelfKey = bin.warehouseLocation?.shelf.name || 'No Shelf';
            if (!shelfGroups[shelfKey]) shelfGroups[shelfKey] = [];
            shelfGroups[shelfKey].push(bin);
          }
          const sortedShelves = Object.keys(shelfGroups).sort((a, b) => a.localeCompare(b));
          return (
            <div className="space-y-3" data-testid="picklist-by-bin">
              {sortedShelves.map((shelf) => (
                <div key={shelf} className="space-y-2" data-testid={`shelf-group-${shelf}`}>
                  <div className="space-y-2">
                    {shelfGroups[shelf].map(renderBin)}
                  </div>
                </div>
              ))}
            </div>
          );
        }

        // ── depth 3 (default): aisle › shelf › bin ───────────────────────
        return (
          <div className="space-y-3" data-testid="picklist-by-bin">
            {sortedAisles.map((aisle) => {
              const shelvesByAisle = groupedBins[aisle];
              const hue = aisleHue(aisle);
              const isReal = aisle && aisle !== 'No Location';
              return (
                <div key={aisle} className="space-y-2" data-testid={`aisle-group-${aisle}`}>
                  {/* Aisle marker — shown ONCE per aisle as a big translucent
                      watermark-style header so the picker can spot aisle changes
                      at a glance without it repeating per row. */}
                  {isReal && (
                    <div
                      className="relative overflow-hidden rounded-md border mt-4 first:mt-0"
                      style={{
                        borderColor: `hsl(${hue} 60% 35% / 0.4)`,
                        background: `linear-gradient(90deg, hsl(${hue} 50% 12%) 0%, hsl(${hue} 40% 8%) 60%, transparent 100%)`,
                      }}
                      data-testid={`aisle-marker-${aisle}`}
                    >
                      <div
                        aria-hidden="true"
                        className="absolute -top-4 -left-2 font-black leading-none select-none pointer-events-none"
                        style={{
                          fontSize: '6rem',
                          color: `hsl(${hue} 75% 55% / 0.18)`,
                          letterSpacing: '-0.05em',
                        }}
                      >
                        {aisle}
                      </div>
                      <div className="relative px-4 py-3 pl-28">
                        <div
                          className="text-[10px] font-bold tracking-[0.2em] uppercase"
                          style={{ color: `hsl(${hue} 80% 65%)` }}
                        >
                          Aisle
                        </div>
                        <div className="text-xl font-semibold text-foreground">
                          {aisle}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    {Object.entries(shelvesByAisle).map(([shelf, bins]) => (
                      <div key={shelf} className="space-y-1" data-testid={`shelf-group-${shelf}`}>
                        <div className="space-y-2">
                          {bins.map(renderBin)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

    </div>

    {/* ── Fullscreen image lightbox ────────────────────────────────────── */}
    {lightboxItem && (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 print:hidden"
        data-testid="lightbox-overlay"
        onClick={() => setLightboxItem(null)}
      >
        {/* Header: part name + close */}
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-black/60"
          onClick={e => e.stopPropagation()}
        >
          <div className="min-w-0">
            {(lightboxItem.partNumber || lightboxItem.sku) && (
              <span className="font-mono text-xs font-bold text-white bg-purple-800/80 border border-purple-500/50 px-1.5 py-0.5 rounded mr-2 tracking-wide inline-block">
                {lightboxItem.partNumber || lightboxItem.sku}
              </span>
            )}
            <span className="text-sm text-white font-medium">{lightboxItem.itemName}</span>
            {lightboxItem.colorName && (
              <span className="ml-2 text-xs text-yellow-400">{lightboxItem.colorName}</span>
            )}
          </div>
          <button
            type="button"
            data-testid="button-lightbox-close"
            className="shrink-0 ml-4 text-gray-400 hover-elevate rounded p-1"
            onClick={() => setLightboxItem(null)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Image */}
        <div
          className="flex items-center justify-center w-full h-full px-6 py-16"
          onClick={() => setLightboxItem(null)}
        >
          <PartImage
            imageUrl={lightboxItem.imageUrl}
            partNumber={lightboxItem.partNumber}
            colorId={lightboxItem.colorId}
            className="max-w-full max-h-full object-contain"
            fallbackClassName="w-24 h-24 text-gray-500"
          />
        </div>
      </div>
    )}
    </>
  );
}

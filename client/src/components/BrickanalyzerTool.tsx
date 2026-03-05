import { useState, useRef, useEffect, useMemo, forwardRef, useImperativeHandle } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Camera, X, CheckCircle, Loader2, ExternalLink, Trash2, ScanSearch, ChevronRight, Sparkles, Check, Grid3X3, Settings2, RotateCcw, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
  note: string;
  ourPriceNew: number | null;
  ourQtyNew: number;
  ourPriceUsed: number | null;
  ourQtyUsed: number;
  inventoryId: number | null;
  marketSoldMaxNew: number | null;
  marketSoldMaxUsed: number | null;
  thumbnailUrl: string | null;
  bestPrice: number | null;
  inventoryLots?: InventoryLot[];
  cropIndex?: number | null;
  bboxX?: number | null;
  bboxY?: number | null;
  bboxW?: number | null;
  bboxH?: number | null;
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
}

type UIState = "idle" | "uploading" | "processing" | "complete" | "failed";

interface ScanSettings {
  // Multi-pass
  multiPass:       boolean; // run 3 passes (large/minifig, standard, small) and merge
  // Shared
  segmenter:       "watershed" | "sam" | "contour";
  minSizePct:      number;  // % of image area — noise floor
  maxSizePct:      number;  // % of image area — surface/baseplate ceiling
  maxPieces:       number;  // cap on crops sent to Brickognize
  minConfidence:   number;  // Brickognize minimum score (0 = off)
  // Watershed-only
  separation:      number;  // % of short side — piece-splitting distance
  sensitivity:     number;  // 0–1 — distance-transform peak threshold
  // SAM-only
  pointsPerSide:   number;  // grid density (4–32)
  iouThresh:       number;  // predicted IoU quality filter
  stabilityThresh: number;  // mask stability filter
  nmsThresh:       number;  // overlap removal (NMS)
  // Contour-only
  blurRadius:      number;  // Gaussian blur kernel size (noise suppression)
  cannyLow:        number;  // Canny lower threshold
  cannyHigh:       number;  // Canny upper threshold
  dilateIter:      number;  // dilation passes to close edge gaps
}

const DEFAULT_SETTINGS: ScanSettings = {
  multiPass:       false,
  segmenter:       "watershed",
  minSizePct:      0.08,
  maxSizePct:      6,
  maxPieces:       50,
  minConfidence:   0,
  separation:      2.5,
  sensitivity:     0.30,
  pointsPerSide:   8,
  iouThresh:       0.86,
  stabilityThresh: 0.90,
  nmsThresh:       0.70,
  blurRadius:      5,
  cannyLow:        50,
  cannyHigh:       150,
  dilateIter:      2,
};

const SETTINGS_KEY  = "brickspotter-settings";
const BASELINE_KEY  = "brickspotter-baseline";
const SCAN_MODE_KEY = "brickspotter-scan-mode";

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

const BrickanalyzerTool = forwardRef((_, ref) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uiState, setUiState] = useState<UIState>("idle");
  const [scanId, setScanId] = useState<number | null>(null);
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
    },
  });

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image file.", variant: "destructive" });
      return;
    }
    setUiState("uploading");
    setLeftPage(false);

    const formData = new FormData();
    formData.append("image", file);
    // Auto mode always uses 3-pass; manual uses user's single-pass settings
    const effectiveSettings = scanMode === "auto"
      ? { ...DEFAULT_SETTINGS, multiPass: true }
      : { ...settings, multiPass: false };
    formData.append("settings", JSON.stringify(effectiveSettings));

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

  const [expandedParts, setExpandedParts] = useState<Set<string>>(new Set());
  const [showCrops, setShowCrops] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);
  const [scanPhotoOpen, setScanPhotoOpen] = useState(false);
  const [scanZoom, setScanZoom] = useState(1);
  const [scanPan, setScanPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [pinchDist, setPinchDist] = useState<number | null>(null);
  const [highlightedResult, setHighlightedResult] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanContainerRef = useRef<HTMLDivElement>(null);

  function closeScanPhoto() { setScanPhotoOpen(false); setScanZoom(1); setScanPan({ x: 0, y: 0 }); }
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
  const results: ScanResult[] = useMemo(() => {
    if (uiState !== "complete" || !activeScan?.results) return [];
    const rank = (c: string) => c === 'high' ? 3 : c === 'medium' ? 2 : 1;
    return [...(activeScan.results as ScanResult[])].sort((a, b) => {
      const cs = rank(b.confidence) - rank(a.confidence);
      if (cs !== 0) return cs;
      const ap = Math.max(a.marketSoldMaxNew ?? 0, a.marketSoldMaxUsed ?? 0);
      const bp = Math.max(b.marketSoldMaxNew ?? 0, b.marketSoldMaxUsed ?? 0);
      return bp - ap;
    });
  }, [activeScan?.results, uiState]);
  const totalValue = results.reduce((s, p) => s + (p.ourPriceNew ?? p.ourPriceUsed ?? p.marketSoldMaxNew ?? 0), 0);
  const inStockCount = results.filter(p => p.ourQtyNew > 0 || p.ourQtyUsed > 0).length;
  const withPriceCount = results.filter(p => p.ourPriceNew !== null || p.ourPriceUsed !== null || p.marketSoldMaxNew !== null).length;

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

  return (
    <div className="space-y-4 p-1">

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
            className="w-full flex flex-col items-center justify-center gap-3 py-16 text-center rounded-xl border border-dashed border-gray-700 hover:border-purple-500/50 hover:bg-purple-950/20 transition-colors cursor-pointer"
            data-testid="button-brickanalyzer-idle-trigger"
            onClick={() => fileInputRef.current?.click()}
          >
            <Camera className="w-12 h-12 text-gray-500" />
            <p className="text-sm text-gray-400">
              Tap to take a photo or pick from your library.
            </p>
          </button>

          {/* ── Auto / Manual mode selector ─────────────────────────── */}
          <div className="rounded-lg border border-gray-700 bg-gray-900/40 overflow-hidden">

            {/* Mode toggle row */}
            <div className="flex">
              <button
                className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${scanMode === "auto" ? "bg-purple-600 text-white" : "text-gray-400 hover:text-gray-300 hover:bg-gray-800/60"}`}
                onClick={() => { handleScanModeChange("auto"); setShowSettings(false); }}
                data-testid="button-scan-mode-auto"
              >
                Auto
              </button>
              <button
                className={`flex-1 py-2.5 text-xs font-semibold transition-colors border-l border-gray-700 ${scanMode === "manual" ? "bg-purple-600 text-white" : "text-gray-400 hover:text-gray-300 hover:bg-gray-800/60"}`}
                onClick={() => { handleScanModeChange("manual"); setShowSettings(true); }}
                data-testid="button-scan-mode-manual"
              >
                Manual
              </button>
            </div>

            {/* Auto mode: brief description */}
            {scanMode === "auto" && (
              <div className="px-3 py-2.5 border-t border-gray-700/60 space-y-1">
                <p className="text-[11px] text-gray-300 font-medium">Smart 3-pass scan</p>
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  Runs 3 Contour passes in parallel — minifigs/large pieces first, then standard parts, then small/fine pieces. Minifig regions block smaller-piece passes from subdividing them. Results merged before Brickognize.
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
              <span className="flex items-center gap-2 text-xs font-medium text-gray-400">
                <Settings2 className="w-3.5 h-3.5" />
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
              <div className="px-3 pb-3 space-y-4 border-t border-gray-700 pt-3">

                {/* ── Segmenter toggle ──────────────────────────────────────── */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-300">Detection Method</label>
                  <div className="flex gap-1.5">
                    <button
                      className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${settings.segmenter === "watershed" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                      onClick={() => setSettings(s => ({ ...s, segmenter: "watershed" }))}
                      data-testid="button-segmenter-watershed"
                    >
                      Watershed
                    </button>
                    <button
                      className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${settings.segmenter === "contour" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                      onClick={() => setSettings(s => ({ ...s, segmenter: "contour" }))}
                      data-testid="button-segmenter-contour"
                    >
                      Contour
                    </button>
                    <button
                      className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${settings.segmenter === "sam" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                      onClick={() => setSettings(s => ({ ...s, segmenter: "sam" }))}
                      data-testid="button-segmenter-sam"
                    >
                      SAM (AI)
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-500">
                    {settings.segmenter === "sam"
                      ? "SAM uses a neural network for precise masks. First scan downloads a 375MB model — subsequent scans are faster. Expect 15–60s per photo on CPU."
                      : settings.segmenter === "contour"
                      ? "Contour finds piece edges using Canny edge detection. Fast like Watershed — good alternative when pieces have strong outlines against the background."
                      : "Watershed is fast (~1s) and works well for pieces on a plain background."}
                  </p>
                </div>

                {/* ── Watershed-specific settings ───────────────────────────── */}
                {settings.segmenter === "watershed" && (<>

                  <div className="space-y-1">
                    <div className="flex justify-between items-baseline">
                      <label className="text-xs font-medium text-gray-300">Piece Separation</label>
                      <span className="text-xs font-mono text-purple-400">{settings.separation.toFixed(1)}%</span>
                    </div>
                    <input type="range" min="1" max="8" step="0.5"
                      value={settings.separation}
                      onChange={e => setSettings(s => ({ ...s, separation: Number(e.target.value) }))}
                      className="w-full accent-purple-500"
                      data-testid="slider-separation"
                    />
                    <p className="text-[10px] text-gray-500">Lower → splits touching pieces more aggressively. Raise if one piece is split into many.</p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between items-baseline">
                      <label className="text-xs font-medium text-gray-300">Peak Sensitivity</label>
                      <span className="text-xs font-mono text-purple-400">{settings.sensitivity.toFixed(2)}</span>
                    </div>
                    <input type="range" min="0.10" max="0.70" step="0.05"
                      value={settings.sensitivity}
                      onChange={e => setSettings(s => ({ ...s, sensitivity: Number(e.target.value) }))}
                      className="w-full accent-purple-500"
                      data-testid="slider-sensitivity"
                    />
                    <p className="text-[10px] text-gray-500">Lower → detects more pieces but may over-split. Raise if too many fragments appear.</p>
                  </div>

                </>)}

                {/* ── Contour-specific settings ────────────────────────────── */}
                {settings.segmenter === "contour" && (<>

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

                </>)}

                {/* ── SAM-specific settings ─────────────────────────────────── */}
                {settings.segmenter === "sam" && (<>

                  <div className="space-y-1">
                    <div className="flex justify-between items-baseline">
                      <label className="text-xs font-medium text-gray-300">Points Per Side</label>
                      <span className="text-xs font-mono text-purple-400">{settings.pointsPerSide}</span>
                    </div>
                    <input type="range" min="4" max="32" step="2"
                      value={settings.pointsPerSide}
                      onChange={e => setSettings(s => ({ ...s, pointsPerSide: Number(e.target.value) }))}
                      className="w-full accent-purple-500"
                      data-testid="slider-points-per-side"
                    />
                    <p className="text-[10px] text-gray-500">Grid density for point prompts. Higher = finds more pieces but much slower. Start at 8.</p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between items-baseline">
                      <label className="text-xs font-medium text-gray-300">Mask Quality (IoU)</label>
                      <span className="text-xs font-mono text-purple-400">{settings.iouThresh.toFixed(2)}</span>
                    </div>
                    <input type="range" min="0.50" max="0.99" step="0.02"
                      value={settings.iouThresh}
                      onChange={e => setSettings(s => ({ ...s, iouThresh: Number(e.target.value) }))}
                      className="w-full accent-purple-500"
                      data-testid="slider-iou-thresh"
                    />
                    <p className="text-[10px] text-gray-500">Lower to get more masks. Raise to filter out lower-quality detections.</p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between items-baseline">
                      <label className="text-xs font-medium text-gray-300">Mask Stability</label>
                      <span className="text-xs font-mono text-purple-400">{settings.stabilityThresh.toFixed(2)}</span>
                    </div>
                    <input type="range" min="0.50" max="0.99" step="0.02"
                      value={settings.stabilityThresh}
                      onChange={e => setSettings(s => ({ ...s, stabilityThresh: Number(e.target.value) }))}
                      className="w-full accent-purple-500"
                      data-testid="slider-stability-thresh"
                    />
                    <p className="text-[10px] text-gray-500">How consistent the mask must be across threshold shifts. Lower = more masks, potentially noisier.</p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between items-baseline">
                      <label className="text-xs font-medium text-gray-300">Overlap Removal (NMS)</label>
                      <span className="text-xs font-mono text-purple-400">{settings.nmsThresh.toFixed(2)}</span>
                    </div>
                    <input type="range" min="0.10" max="0.90" step="0.05"
                      value={settings.nmsThresh}
                      onChange={e => setSettings(s => ({ ...s, nmsThresh: Number(e.target.value) }))}
                      className="w-full accent-purple-500"
                      data-testid="slider-nms-thresh"
                    />
                    <p className="text-[10px] text-gray-500">Lower to remove more overlapping boxes. Raise if touching pieces are being merged.</p>
                  </div>

                </>)}

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
        <div className="flex flex-col items-center gap-3 py-12">
          <Loader2 className="w-8 h-8 text-lego-blue animate-spin" />
          <p className="text-sm text-gray-300">Uploading image...</p>
        </div>
      )}

      {/* ── PROCESSING ──────────────────────────────────────────────────── */}
      {uiState === "processing" && (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="relative">
              <ScanSearch className="w-10 h-10 text-lego-yellow" />
              <Loader2 className="w-4 h-4 text-lego-yellow animate-spin absolute -bottom-1 -right-1" />
            </div>
            <p className="text-sm font-medium text-gray-200">Analyzing your LEGO pieces...</p>
            <p className="text-xs text-gray-500 text-center max-w-xs">
              AI is identifying each piece and looking up prices. This usually takes 30–90 seconds.
            </p>
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
        </div>
      )}

      {/* ── FAILED ──────────────────────────────────────────────────────── */}
      {uiState === "failed" && (
        <div className="space-y-3">
          <div className="flex flex-col items-center gap-3 py-8">
            <X className="w-8 h-8 text-lego-red" />
            <p className="text-sm text-gray-300">Scan failed</p>
            <p className="text-xs text-gray-500 text-center">{scan?.errorMessage || "Something went wrong. Please try again."}</p>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => { setUiState("idle"); setScanId(null); }}
            data-testid="button-brickanalyzer-retry"
          >
            Try Again
          </Button>
        </div>
      )}

      {/* ── COMPLETE: Results ────────────────────────────────────────────── */}
      {uiState === "complete" && (
        <div className="space-y-3">
          {/* Summary bar */}
          <div className="flex flex-wrap items-center gap-2 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
              <span className="text-sm font-medium text-green-300">Scan complete</span>
            </div>
            <div className="flex gap-3 text-xs font-mono text-gray-400 flex-wrap">
              <span>{results.length} piece{results.length !== 1 ? "s" : ""} found</span>
              <span>{inStockCount} in your store</span>
              <span>{withPriceCount} priced</span>
              {totalValue > 0 && (
                <span className="text-lego-yellow font-semibold">${totalValue.toFixed(2)} est. value</span>
              )}
            </div>
            {activeScan && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5"
                onClick={() => setScanPhotoOpen(true)}
                data-testid="button-view-scan-photo"
              >
                <Camera className="w-3.5 h-3.5" />
                View Photo
              </Button>
            )}
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
          </div>

          {/* ── Crops grid ────────────────────────────────────────────────── */}
          {showCrops && activeScan && (activeScan.cropCount ?? 0) > 0 && (
            <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-2">
              <p className="text-xs text-gray-500 mb-2 px-1">
                Raw crops extracted by Brick Spotter — {activeScan.cropCount} regions detected
              </p>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
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

          {/* Results — grouped by part number, expandable */}
          {groupedResults.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              No pieces could be identified. Try a clearer photo with better lighting.
            </div>
          ) : (
            <div className="space-y-1.5">
              {groupedResults.map((grp, gi) => {
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
                      transition: 'box-shadow 0.3s ease, border-color 0.3s ease',
                    }}
                    data-testid={`tile-brickanalyzer-${gi}`}
                  >
                    {/* ── Collapsed header (always visible) ─────────── */}
                    <div
                      className="flex gap-2.5 px-2.5 py-2 cursor-pointer hover-elevate"
                      onClick={() => togglePart(key)}
                      data-testid={`toggle-part-${gi}`}
                    >
                      {/* Thumbnail */}
                      {(() => {
                        const isMinifig = grp.itemType === 'MINIFIG';
                        const blDirectUrl = grp.partNo
                          ? isMinifig
                            ? `https://img.bricklink.com/ItemImage/MN/0/${grp.partNo}.png`
                            : `https://img.bricklink.com/ItemImage/PN/${repEntry.colorId ?? 0}/${grp.partNo}.png`
                          : null;
                        const isRebrickable = repImg?.includes('cdn.rebrickable.com');
                        const primarySrc = isRebrickable
                          ? `/api/images/proxy?url=${encodeURIComponent(repImg!)}`
                          : (repImg && repImg.startsWith('https://')) ? repImg : blDirectUrl;
                        return (
                          <div
                            className={`flex-shrink-0 w-12 h-12 rounded bg-gray-800/80 flex items-center justify-center overflow-hidden ${primarySrc ? 'cursor-pointer hover-elevate' : ''}`}
                            onClick={primarySrc ? (e) => { e.stopPropagation(); setLightboxImage({ src: primarySrc, alt: grp.partName || grp.partNo }); } : undefined}
                            data-testid={`thumbnail-part-${gi}`}
                          >
                            {primarySrc ? (
                              <img
                                src={primarySrc}
                                alt={grp.partName}
                                className="w-full h-full object-contain p-0.5"
                                onError={(e) => {
                                  const el = e.target as HTMLImageElement;
                                  if (blDirectUrl && el.src !== blDirectUrl) { el.src = blDirectUrl; }
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
                          <p className="text-xs font-semibold text-white leading-tight flex-1">
                            {grp.partName || "Unknown Part"}
                          </p>
                          {grp.itemType === 'MINIFIG' && (
                            <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-400 bg-amber-900/40 border border-amber-500/30 rounded px-1 py-0.5 flex-shrink-0">Fig</span>
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
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          <ChevronRight
                            className={`w-3.5 h-3.5 text-gray-500 flex-shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                          />
                        </div>

                        {/* Part no · qty · confidence · crop count */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {grp.partNo && <span className="font-mono text-[10px] text-gray-300">{grp.partNo}</span>}
                          {stockLabel && (
                            <span className="text-[10px] text-green-400 font-medium">· {stockLabel}</span>
                          )}
                          <span className={`text-[10px] font-medium capitalize ${confidenceColor(bestConfidence)}`}>
                            · {bestConfidence}
                          </span>
                          {grp.entries.length > 1 && (
                            <span className="text-[10px] text-gray-500">· {grp.entries.length} crops</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ── Expanded: best match + all color/condition rows ── */}
                    {isExpanded && (
                      <div className="border-t border-purple-500/10 px-2 py-1.5 space-y-1">
                        {/* Column headers */}
                        <div className="flex items-center gap-1 px-2 pb-0.5">
                          <div className="flex-1 min-w-0">
                            <span className="text-[9px] uppercase tracking-wider text-gray-500">{grp.itemType === 'MINIFIG' ? 'Minifigure' : 'Color'}</span>
                          </div>
                          <span className="text-[9px] uppercase tracking-wider text-gray-500 w-14 text-right flex-shrink-0">N Cur</span>
                          <span className="text-[9px] uppercase tracking-wider text-gray-500 w-[58px] text-right flex-shrink-0">N Score</span>
                          <span className="text-[9px] uppercase tracking-wider text-gray-500 w-14 text-right flex-shrink-0">U Cur</span>
                          <span className="text-[9px] uppercase tracking-wider text-gray-500 w-[58px] text-right flex-shrink-0">U Score</span>
                        </div>
                        {/* Best Match banners — one per unique detected color */}
                        {detectedColorEntries.map((entry, ei) => {
                          const peak = Math.max(entry.marketSoldMaxNew ?? 0, entry.marketSoldMaxUsed ?? 0) || null;
                          const nScore = peak && entry.ourPriceNew && entry.ourPriceNew > 0 ? Number((peak / entry.ourPriceNew).toFixed(2)) : null;
                          const uScore = peak && entry.ourPriceUsed && entry.ourPriceUsed > 0 ? Number((peak / entry.ourPriceUsed).toFixed(2)) : null;
                          const inStock = (entry.ourQtyNew + entry.ourQtyUsed) > 0;
                          return (
                            <div key={ei} className="rounded-lg border border-purple-500/40 bg-purple-900/25 px-2 py-1.5">
                              <div className="flex items-center gap-1 mb-1">
                                <Sparkles className="w-3 h-3 text-purple-400 flex-shrink-0" />
                                <span className="text-[9px] uppercase tracking-wider text-purple-400 font-semibold">Best Match</span>
                                <span className={`ml-1 text-[9px] font-medium capitalize ${confidenceColor(entry.confidence)}`}>
                                  · {entry.confidence} confidence
                                </span>
                                {entry.cropIndex != null && (
                                  <span className="ml-auto text-[9px] font-mono text-gray-500 flex-shrink-0">crop #{entry.cropIndex + 1}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 min-w-0">
                                <div className="flex flex-col flex-1 min-w-0">
                                  <div className="flex items-center gap-1 min-w-0">
                                    {inStock && <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />}
                                    {inStock && <span className="text-[10px] font-mono text-gray-200 flex-shrink-0">×{entry.ourQtyNew + entry.ourQtyUsed}</span>}
                                    {grp.itemType !== 'MINIFIG' && (entry.colorRgb ? (
                                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-gray-500" style={{ backgroundColor: `#${entry.colorRgb}` }} />
                                    ) : (
                                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-gray-600" />
                                    ))}
                                    <span className="text-[10px] text-white font-medium truncate">
                                      {grp.itemType === 'MINIFIG' ? (entry.partName || grp.partName) : (entry.colorName || '—')}
                                    </span>
                                  </div>
                                  {peak ? (
                                    <span className="text-[9px] pl-0.5 text-purple-400">peak ${peak.toFixed(2)}</span>
                                  ) : null}
                                </div>
                                <span className="text-[10px] font-mono text-gray-200 w-14 text-right flex-shrink-0">
                                  {entry.ourPriceNew != null ? `$${entry.ourPriceNew.toFixed(2)}` : '—'}
                                </span>
                                <span className={`text-[10px] font-mono font-bold w-[58px] text-right flex-shrink-0 ${entryScoreColor(nScore)}`}>
                                  {nScore != null ? `${nScore}×` : '—'}
                                </span>
                                <span className="text-[10px] font-mono text-gray-200 w-14 text-right flex-shrink-0">
                                  {entry.ourPriceUsed != null ? `$${entry.ourPriceUsed.toFixed(2)}` : '—'}
                                </span>
                                <span className={`text-[10px] font-mono font-bold w-[58px] text-right flex-shrink-0 ${entryScoreColor(uScore)}`}>
                                  {uScore != null ? `${uScore}×` : '—'}
                                </span>
                              </div>
                            </div>
                          );
                        })}

                        {/* All known color variants — matches Best Match column layout */}
                        {otherLots.length > 0 ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1 px-2 pb-0.5 pt-1.5">
                            <div className="flex-1 min-w-0">
                              <span className="text-[9px] uppercase tracking-wider text-gray-500">All known color variants</span>
                            </div>
                            <span className="text-[9px] uppercase tracking-wider text-gray-500 w-14 text-right flex-shrink-0">N Cur</span>
                            <span className="text-[9px] uppercase tracking-wider text-gray-500 w-[58px] text-right flex-shrink-0">N Score</span>
                            <span className="text-[9px] uppercase tracking-wider text-gray-500 w-14 text-right flex-shrink-0">U Cur</span>
                            <span className="text-[9px] uppercase tracking-wider text-gray-500 w-[58px] text-right flex-shrink-0">U Score</span>
                          </div>
                          {otherLots.map((lot, li) => {
                            const lotInStock = (lot.qtyNew + lot.qtyUsed) > 0;
                            const lotPeak = Math.max(lot.peakNew ?? 0, lot.peakUsed ?? 0) || null;
                            const lotNScore = lotPeak && lot.priceNew && lot.priceNew > 0
                              ? Number((lotPeak / lot.priceNew).toFixed(2)) : null;
                            const lotUScore = lotPeak && lot.priceUsed && lot.priceUsed > 0
                              ? Number((lotPeak / lot.priceUsed).toFixed(2)) : null;
                            return (
                              <div
                                key={li}
                                className="bg-gray-900/50 border border-gray-700/60 rounded-lg px-2 py-1.5"
                                data-testid={`lot-${gi}-${li}`}
                              >
                                <div className="flex items-center gap-1 min-w-0">
                                  <div className="flex flex-col flex-1 min-w-0">
                                    <div className="flex items-center gap-1 min-w-0">
                                      {lotInStock && <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />}
                                      {lotInStock && <span className="text-[10px] font-mono text-gray-200 flex-shrink-0">×{lot.qtyNew + lot.qtyUsed}</span>}
                                      {lot.colorRgb ? (
                                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-gray-500" style={{ backgroundColor: `#${lot.colorRgb}` }} />
                                      ) : (
                                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-gray-600" />
                                      )}
                                      <span className={`text-[10px] truncate ${lotInStock ? 'text-gray-100' : 'text-gray-400'}`}>{lot.colorName || '—'}</span>
                                    </div>
                                    {lotPeak && (
                                      <span className="text-[9px] pl-0.5 text-purple-400">peak ${lotPeak.toFixed(2)}</span>
                                    )}
                                  </div>
                                  <span className="text-[10px] font-mono text-gray-200 w-14 text-right flex-shrink-0">
                                    {lot.priceNew != null ? `$${lot.priceNew.toFixed(2)}` : '—'}
                                  </span>
                                  <span className={`text-[10px] font-mono font-bold w-[58px] text-right flex-shrink-0 ${entryScoreColor(lotNScore)}`}>
                                    {lotNScore != null ? `${lotNScore}×` : '—'}
                                  </span>
                                  <span className="text-[10px] font-mono text-gray-200 w-14 text-right flex-shrink-0">
                                    {lot.priceUsed != null ? `$${lot.priceUsed.toFixed(2)}` : '—'}
                                  </span>
                                  <span className={`text-[10px] font-mono font-bold w-[58px] text-right flex-shrink-0 ${entryScoreColor(lotUScore)}`}>
                                    {lotUScore != null ? `${lotUScore}×` : '—'}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Dismiss / New scan */}
          <div className="flex gap-2 pt-1">
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
        </div>
      )}

    {/* ── Scan photo zoom dialog ─────────────────────────────────────── */}
    <Dialog open={scanPhotoOpen} onOpenChange={(open) => { if (!open) closeScanPhoto(); }}>
      <DialogContent className="max-w-[96vw] w-full p-0 bg-gray-950 border-gray-700 overflow-hidden flex flex-col" style={{ maxHeight: '94vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Camera className="w-3.5 h-3.5 text-lego-yellow" />
            <span>Scan photo — tap a box to jump to that result</span>
          </div>
          <div className="flex items-center gap-1.5">
            {scanZoom > 1 && (
              <Button size="sm" variant="ghost" className="text-xs h-7 gap-1 text-gray-400" onClick={() => { setScanZoom(1); setScanPan({ x: 0, y: 0 }); }}>
                <RotateCcw className="w-3 h-3" /> Reset
              </Button>
            )}
            <span className="text-[10px] text-gray-600 font-mono w-8 text-right">{Math.round(scanZoom * 100)}%</span>
            <Button size="icon" variant="ghost" onClick={closeScanPhoto} data-testid="button-close-scan-photo"><X className="w-4 h-4" /></Button>
          </div>
        </div>
        {/* Zoomable image area */}
        {activeScan && (
          <div
            ref={scanContainerRef}
            className="flex-1 overflow-hidden flex items-center justify-center bg-black"
            style={{ cursor: scanZoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default', touchAction: 'none' }}
            onWheel={handleScanWheel}
            onMouseDown={handleScanMouseDown}
            onMouseMove={handleScanMouseMove}
            onMouseUp={handleScanMouseUp}
            onMouseLeave={handleScanMouseUp}
            onTouchStart={handleScanTouchStart}
            onTouchMove={handleScanTouchMove}
            onTouchEnd={handleScanTouchEnd}
          >
            <div
              style={{
                transform: `translate(${scanPan.x}px, ${scanPan.y}px) scale(${scanZoom})`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                position: 'relative',
                width: '100%',
                maxHeight: 'calc(94vh - 52px)',
                aspectRatio: activeScan.imgWidth && activeScan.imgHeight ? `${activeScan.imgWidth}/${activeScan.imgHeight}` : '4/3',
                flexShrink: 0,
              }}
            >
              <img
                src={`/api/brickanalyzer/scan/${activeScan.id}/image`}
                alt="Original scan"
                className="absolute inset-0 w-full h-full object-fill block select-none"
                draggable={false}
              />
              {(() => {
                const bboxResults = results.filter(r => r.bboxX != null && r.bboxY != null && r.bboxW != null && r.bboxH != null);
                const allPrices = bboxResults.map(r => Math.max(r.marketSoldMaxNew ?? 0, r.marketSoldMaxUsed ?? 0, r.ourPriceNew ?? 0, r.ourPriceUsed ?? 0)).filter(p => p > 0);
                const maxPrice = allPrices.length > 0 ? Math.max(...allPrices) : 0;
                const hiThresh = maxPrice * 0.60;
                const midThresh = maxPrice * 0.25;
                // tier → [fill rgba, border rgb, label text color]
                const tierStyle = {
                  high:    { fill: 'rgba(239,68,68,0.38)',  border: 'rgb(239,68,68)',   label: '#fca5a5', badge: 'rgba(127,29,29,0.85)'  },
                  medium:  { fill: 'rgba(251,146,60,0.35)', border: 'rgb(251,146,60)',  label: '#fdba74', badge: 'rgba(124,45,18,0.85)'  },
                  low:     { fill: 'rgba(250,204,21,0.28)', border: 'rgb(250,204,21)',  label: '#fde68a', badge: 'rgba(120,80,0,0.85)'   },
                  none:    { fill: 'rgba(107,114,128,0.18)', border: 'rgb(107,114,128)', label: '#9ca3af', badge: 'rgba(17,24,39,0.80)'  },
                };
                return bboxResults.map((r, i) => {
                  const peak = Math.max(r.marketSoldMaxNew ?? 0, r.marketSoldMaxUsed ?? 0, r.ourPriceNew ?? 0, r.ourPriceUsed ?? 0);
                  const displayPrice = r.ourPriceNew ?? r.ourPriceUsed ?? (r.marketSoldMaxNew ?? r.marketSoldMaxUsed ?? null);
                  const tier = peak === 0 ? 'none' : peak >= hiThresh ? 'high' : peak >= midThresh ? 'medium' : 'low';
                  const ts = tierStyle[tier];
                  const scrollTarget = `result-${(r.partNo || r.cropIndex) ?? i}`;
                  return (
                    <button
                      key={r.cropIndex ?? i}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeScanPhoto();
                        setTimeout(() => {
                          document.getElementById(scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          flashResult(scrollTarget);
                        }, 200);
                      }}
                      style={{
                        position: 'absolute',
                        left:   `${r.bboxX}%`,
                        top:    `${r.bboxY}%`,
                        width:  `${r.bboxW}%`,
                        height: `${r.bboxH}%`,
                        background: ts.fill,
                        border: `2px solid ${ts.border}`,
                        transition: 'filter 0.15s',
                        overflow: 'visible',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.35)')}
                      onMouseLeave={(e) => (e.currentTarget.style.filter = '')}
                      data-testid={`scan-overlay-${r.cropIndex ?? i}`}
                    >
                      <span
                        style={{
                          background: ts.badge,
                          color: ts.label,
                          border: `1px solid ${ts.border}`,
                          position: 'absolute',
                          top: 'calc(100% + 2px)',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          zIndex: 20,
                        }}
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm leading-tight whitespace-nowrap shadow-lg"
                      >
                        {displayPrice != null ? `$${displayPrice.toFixed(2)}` : '—'}
                      </span>
                    </button>
                  );
                });
              })()}
            </div>
          </div>
        )}
        {/* Footer: heat map legend + zoom hint */}
        <div className="px-3 py-1.5 border-t border-gray-800 shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-500">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(239,68,68,0.6)', border: '1.5px solid rgb(239,68,68)' }} /> High value</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(251,146,60,0.55)', border: '1.5px solid rgb(251,146,60)' }} /> Mid</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(250,204,21,0.45)', border: '1.5px solid rgb(250,204,21)' }} /> Low</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(107,114,128,0.35)', border: '1.5px solid rgb(107,114,128)' }} /> No price</span>
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <ZoomIn className="w-3 h-3" />
            <span>Scroll or pinch to zoom · Drag to pan</span>
          </div>
        </div>
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

    </div>
  );
});

export default BrickanalyzerTool;

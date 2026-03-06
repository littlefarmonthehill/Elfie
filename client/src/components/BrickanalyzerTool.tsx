import { useState, useRef, useEffect, useMemo, forwardRef, useImperativeHandle } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Camera, X, CheckCircle, Loader2, ExternalLink, Trash2, ScanSearch, ChevronRight, Sparkles, Check, Grid3X3, Settings2, RotateCcw, ZoomIn, AlertTriangle, ThumbsUp, ThumbsDown, Minus, FlaskConical, BarChart3, RefreshCw, Target, Info } from "lucide-react";
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
  note: string;
  ourPriceNew: number | null;
  ourQtyNew: number;
  ourPriceUsed: number | null;
  ourQtyUsed: number;
  inventoryId: number | null;
  marketSoldMaxNew: number | null;
  marketSoldMaxUsed: number | null;
  stockAvgPriceN?: number | null;
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

type UIState = "idle" | "uploading" | "previewing" | "processing" | "complete" | "failed";

interface PreviewData {
  boxes: { x: number; y: number; w: number; h: number }[];
  imageWidth: number;
  imageHeight: number;
  objectUrl: string;
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

const BrickanalyzerTool = forwardRef((_, ref) => {
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
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingSettings, setPendingSettings] = useState<Record<string, any> | null>(null);
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

  // Auto-dismiss the scan after a verdict is fully recorded (calibration mode).
  // Called after: CLIP confirmed, Wrong verdict, or "Color not found" selection.
  // A short delay lets the success toast show before the view resets.
  function scheduleAutoDismiss(delayMs = 1500) {
    if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    autoDismissTimer.current = setTimeout(() => {
      dismissMutation.mutate();
      autoDismissTimer.current = null;
    }, delayMs);
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

    // Step 1: Run segmentation preview — show detected zones before committing to Brickognize
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
      const { boxes, imageWidth, imageHeight } = await res.json();
      const objectUrl = URL.createObjectURL(file);
      if (previewData?.objectUrl) URL.revokeObjectURL(previewData.objectUrl);
      setPreviewData({ boxes, imageWidth, imageHeight, objectUrl });
      setPendingFile(file);
      setPendingSettings(effectiveSettings);
      setUiState("previewing");
    } catch {
      // If preview fails, fall through to full scan directly
      await startFullScan(file, effectiveSettings);
    }
  }

  async function startFullScan(file: File, effectiveSettings: Record<string, any>) {
    setUiState("uploading");
    const formData = new FormData();
    formData.append("image", file);
    formData.append("settings", JSON.stringify(effectiveSettings));
    if (calibrateMode) formData.append("calibration", "true");
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
    if (previewData?.objectUrl) URL.revokeObjectURL(previewData.objectUrl);
    setPreviewData(null);
    startFullScan(pendingFile, pendingSettings);
  }

  function handleCancelPreview() {
    if (previewData?.objectUrl) URL.revokeObjectURL(previewData.objectUrl);
    setPreviewData(null);
    setPendingFile(null);
    setPendingSettings(null);
    setUiState("idle");
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

  async function handleColorCorrection(partNo: string, partName: string, confidence: string, correctedColorId: number, correctedColorName: string, cropIndex: number | null, itemType: string) {
    const key = `${partNo}__${cropIndex ?? 'x'}`;
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
    // Wrong = fully scored immediately — auto-clear so user can scan the next piece
    if (verdict === 'wrong') scheduleAutoDismiss();
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
      toast({ title: 'Added to CLIP catalog', description: `${partNo} confirmed. Clearing in a moment…` });
      scheduleAutoDismiss();
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
      const ap = Math.max(a.marketSoldMaxNew ?? 0, a.marketSoldMaxUsed ?? 0, a.stockAvgPriceN ?? 0);
      const bp = Math.max(b.marketSoldMaxNew ?? 0, b.marketSoldMaxUsed ?? 0, b.stockAvgPriceN ?? 0);
      return bp - ap;
    });
  }, [activeScan?.results, uiState]);
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

      {/* ── Scan / Calibrate mode toggle ─────────────────────────────────── */}
      {(uiState === "idle" || uiState === "complete" || uiState === "failed") && (
        <div className="flex rounded-lg border border-gray-700 overflow-hidden">
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 sm:py-5 text-xs sm:text-xl font-semibold transition-colors ${!calibrateMode ? "bg-purple-600 text-white" : "text-gray-400 hover:text-gray-300 hover:bg-gray-800/50"}`}
            onClick={() => setCalibrateMode(false)}
            data-testid="button-mode-scan"
          >
            <ScanSearch className="w-3.5 h-3.5 sm:w-6 sm:h-6" />
            Scan
          </button>
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 sm:py-5 text-xs sm:text-xl font-semibold transition-colors border-l border-gray-700 ${calibrateMode ? "bg-amber-600 text-white" : "text-gray-400 hover:text-gray-300 hover:bg-gray-800/50"}`}
            onClick={() => setCalibrateMode(true)}
            data-testid="button-mode-calibrate"
          >
            <FlaskConical className="w-3.5 h-3.5 sm:w-6 sm:h-6" />
            Calibrate
            {calibStats.total > 0 && (
              <span className={`text-[10px] sm:text-lg font-bold px-1.5 rounded-full ${calibrateMode ? 'bg-amber-800/60 text-amber-200' : 'bg-gray-700 text-gray-300'}`}>
                {calibStats.total}
              </span>
            )}
          </button>
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

          {/* ── Calibration: round guidance ──────────────────────────── */}
          {calibrateMode && (() => {
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
                {previewData.boxes.length} zone{previewData.boxes.length !== 1 ? "s" : ""} detected
              </span>
            </div>
            <span className="text-xs sm:text-2xl text-gray-500">Review before identifying</span>
          </div>

          {/* Photo with overlaid bounding boxes */}
          <div
            className="relative w-full rounded-lg overflow-hidden bg-gray-900 border border-gray-700"
            style={{ aspectRatio: `${previewData.imageWidth} / ${previewData.imageHeight}` }}
          >
            <img
              src={previewData.objectUrl}
              alt="Scan preview"
              className="w-full h-full object-contain"
            />
            {previewData.boxes.map((box, i) => (
              <div
                key={i}
                className="absolute border-2 border-purple-400/80 rounded-sm pointer-events-none"
                style={{
                  left:   `${box.x}%`,
                  top:    `${box.y}%`,
                  width:  `${box.w}%`,
                  height: `${box.h}%`,
                }}
              >
                <span className="absolute -top-4 left-0 text-[9px] font-mono text-purple-300 bg-gray-900/80 px-0.5 leading-3">
                  {i + 1}
                </span>
              </div>
            ))}
          </div>

          {/* Action buttons */}
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
              Identify {previewData.boxes.length} piece{previewData.boxes.length !== 1 ? "s" : ""}
            </Button>
          </div>
          {previewData.boxes.length === 0 && (
            <p className="text-xs text-gray-500 text-center">
              No pieces detected. Try adjusting your settings or retaking the photo.
            </p>
          )}
        </div>
      )}

      {/* ── PROCESSING ──────────────────────────────────────────────────── */}
      {uiState === "processing" && (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3 py-8 sm:py-16">
            <div className="relative">
              <ScanSearch className="w-10 h-10 sm:w-24 sm:h-24 text-lego-yellow" />
              <Loader2 className="w-4 h-4 sm:w-10 sm:h-10 text-lego-yellow animate-spin absolute -bottom-1 -right-1" />
            </div>
            <p className="text-sm sm:text-2xl font-medium text-gray-200">Analyzing your LEGO pieces...</p>
            <p className="text-xs sm:text-2xl text-gray-500 text-center max-w-xs sm:max-w-xl">
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
            {calibrateMode && calibStats.total > 0 && (
              <Button
                size="sm"
                variant={showScorecard ? "default" : "outline"}
                className="shrink-0 gap-1.5"
                onClick={() => setShowScorecard(v => !v)}
                data-testid="button-view-scorecard"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                Scorecard
              </Button>
            )}
          </div>

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

          {/* Results — grouped by part number, expandable */}
          {groupedResults.length === 0 ? (
            <div className="text-center py-8 sm:py-16 text-gray-500 text-sm sm:text-2xl">
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
                          <ChevronRight
                            className={`w-3.5 h-3.5 sm:w-7 sm:h-7 text-gray-500 flex-shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                          />
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
                        <div className="border-t border-amber-500/15 px-2.5 sm:px-8 py-1.5 sm:py-4 flex flex-wrap items-center gap-2" onClick={e => e.stopPropagation()}>
                          {/* Info tooltip */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button className="text-gray-600 hover:text-gray-400 transition-colors flex-shrink-0" data-testid="button-verdict-info">
                                <Info className="w-3 h-3 sm:w-5 sm:h-5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs sm:text-sm space-y-1.5 p-3">
                              <p className="font-semibold text-white mb-1">Rate each part independently</p>
                              <p className="text-gray-400 text-[11px] mb-2">If the scan found multiple pieces, each gets its own rating — you don't need all of them correct.</p>
                              <div className="flex items-start gap-2">
                                <ThumbsUp className="w-3 h-3 mt-0.5 text-green-400 flex-shrink-0" />
                                <span><span className="text-green-400 font-medium">Add to CLIP</span> — Right part, right color. Saves this photo as a visual reference so future scans get smarter.</span>
                              </div>
                              <div className="flex items-start gap-2">
                                <Minus className="w-3 h-3 mt-0.5 text-yellow-400 flex-shrink-0" />
                                <span><span className="text-yellow-400 font-medium">Close</span> — Right part, wrong color. Pick the correct color from the swatch that appears to train CLIP with the right label.</span>
                              </div>
                              <div className="flex items-start gap-2">
                                <ThumbsDown className="w-3 h-3 mt-0.5 text-red-400 flex-shrink-0" />
                                <span><span className="text-red-400 font-medium">Wrong</span> — Completely misidentified. Logged as a miss in your scorecard.</span>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                          {/* Add to CLIP — stages for confirmation first */}
                          {grp.partNo && repCropIndex != null && !isConfirmed && (
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                setPendingClipConfirm({
                                  partNo: grp.partNo, partName: grp.partName, confidence: bestConfidence,
                                  colorId: repEntry.colorId ?? null,
                                  colorName: repEntry.colorName ?? null,
                                  colorRgb: repEntry.colorRgb ?? null,
                                  cropIndex: repCropIndex, itemType: grp.itemType ?? 'PART',
                                });
                              }}
                              disabled={isConfirming}
                              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-lg font-semibold transition-colors disabled:opacity-50 ${currentVerdict === 'correct' ? 'bg-purple-600 text-white' : 'border border-purple-500/50 text-purple-400 hover:bg-purple-900/40'}`}
                              data-testid={`confirm-clip-${gi}`}
                            >
                              {isConfirming ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <ThumbsUp className="w-2.5 h-2.5 sm:w-4 sm:h-4" />}
                              Add to CLIP
                            </button>
                          )}
                          {isConfirmed && (
                            <span className="flex items-center gap-1 text-[10px] sm:text-lg text-purple-400 font-medium">
                              <Check className="w-2.5 h-2.5 sm:w-4 sm:h-4" />
                              In CLIP catalog
                            </span>
                          )}
                          {/* ── CLIP confirmation panel ── */}
                          {pendingClipConfirm?.partNo === grp.partNo && pendingClipConfirm?.cropIndex === repCropIndex && (
                            <div
                              className="w-full basis-full mt-1 pt-2 border-t border-purple-500/20"
                              onClick={e => e.stopPropagation()}
                              data-testid={`clip-confirm-panel-${gi}`}
                            >
                              <p className="text-[9px] sm:text-sm text-purple-300 font-medium mb-2">Confirm adding to CLIP catalog:</p>
                              <div className="flex items-center gap-2 mb-2.5 bg-purple-900/20 border border-purple-500/20 rounded-md px-2.5 py-2">
                                {pendingClipConfirm.colorRgb && (
                                  <div className="w-5 h-5 rounded-sm border border-white/20 flex-shrink-0"
                                    style={{ backgroundColor: `#${pendingClipConfirm.colorRgb}` }} />
                                )}
                                <div className="min-w-0">
                                  <p className="text-xs sm:text-sm font-semibold text-white truncate">{pendingClipConfirm.partName || pendingClipConfirm.partNo}</p>
                                  <p className="text-[10px] sm:text-xs text-gray-400">
                                    {pendingClipConfirm.partNo}
                                    {pendingClipConfirm.colorName && <span className="ml-1.5 text-gray-300">· {pendingClipConfirm.colorName}</span>}
                                  </p>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  data-testid={`clip-confirm-yes-${gi}`}
                                  disabled={isConfirming}
                                  onClick={e => {
                                    e.stopPropagation();
                                    const p = pendingClipConfirm;
                                    setPendingClipConfirm(null);
                                    handleConfirmToClip(p.partNo, p.partName, p.confidence, p.colorId, p.cropIndex, p.itemType);
                                  }}
                                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md bg-purple-600 text-white text-xs sm:text-sm font-semibold disabled:opacity-50"
                                >
                                  {isConfirming ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />}
                                  Yes, add to CLIP
                                </button>
                                <button
                                  type="button"
                                  data-testid={`clip-confirm-cancel-${gi}`}
                                  onClick={e => { e.stopPropagation(); setPendingClipConfirm(null); }}
                                  className="px-3 py-2 rounded-md border border-gray-600 text-gray-400 text-xs sm:text-sm"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                          {/* Negative verdicts */}
                          <button
                            onClick={() => handleVerdict(grp.partNo, grp.partName, bestConfidence, repCropIndex, 'close')}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-lg font-semibold transition-colors ${currentVerdict === 'close' ? 'bg-yellow-600 text-white' : 'border border-yellow-600/40 text-yellow-500 hover:bg-yellow-900/40'}`}
                            data-testid={`verdict-close-${gi}`}
                          >
                            <Minus className="w-2.5 h-2.5 sm:w-4 sm:h-4" />
                            Close
                          </button>
                          <button
                            onClick={() => handleVerdict(grp.partNo, grp.partName, bestConfidence, repCropIndex, 'wrong')}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-lg font-semibold transition-colors ${currentVerdict === 'wrong' ? 'bg-red-600 text-white' : 'border border-red-600/40 text-red-500 hover:bg-red-900/40'}`}
                            data-testid={`verdict-wrong-${gi}`}
                          >
                            <ThumbsDown className="w-2.5 h-2.5 sm:w-4 sm:h-4" />
                            Wrong
                          </button>

                          {/* ── Color correction picker — visible when verdict is Close ── */}
                          {currentVerdict === 'close' && (() => {
                            // Only require colorId + colorName — colorRgb is optional (used for sort/preview only)
                            const lots = (repEntry.inventoryLots ?? []).filter(l => l.colorId != null && (l.colorName ?? '').length > 0);
                            const detectedHex = repEntry.colorRgb ?? '';
                            const sorted = [...lots].sort((a, b) =>
                              (a.colorRgb && b.colorRgb)
                                ? colorDeltaE(a.colorRgb, detectedHex) - colorDeltaE(b.colorRgb, detectedHex)
                                : (a.colorName ?? '').localeCompare(b.colorName ?? '')
                            );
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
                                      scheduleAutoDismiss();
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
                                        {dE != null && <span className="text-[10px] text-gray-500 flex-shrink-0">ΔE {dE.toFixed(0)}</span>}
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

                    {/* ── Expanded: best match + all color/condition rows ── */}
                    {isExpanded && (
                      <div className="border-t border-purple-500/10 px-2 sm:px-8 py-1.5 sm:py-5 space-y-1 sm:space-y-5">
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
                              <div className="flex items-center gap-1 mb-1">
                                <Sparkles className="w-3 h-3 sm:w-6 sm:h-6 text-purple-400 flex-shrink-0" />
                                <span className="text-[9px] sm:text-lg uppercase tracking-wider text-purple-400 font-semibold">Best Match</span>
                                <span className={`ml-1 text-[9px] sm:text-lg font-medium capitalize ${confidenceColor(entry.confidence)}`}>
                                  · {entry.confidence} confidence
                                </span>
                                {entry.cropIndex != null && (
                                  <span className="ml-auto text-[9px] sm:text-lg font-mono text-gray-500 flex-shrink-0">crop #{entry.cropIndex + 1}</span>
                                )}
                              </div>
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
                                    <span className="text-[9px] sm:text-lg pl-0.5 text-purple-400">peak ${peak.toFixed(2)}</span>
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

                        {/* All known color variants — matches Best Match column layout */}
                        {otherLots.length > 0 ? (
                        <div className="space-y-0.5 sm:space-y-3">
                          <div className="flex items-center gap-1 px-2 pb-0.5 pt-1.5">
                            <div className="flex-1 min-w-0">
                              <span className="text-[9px] sm:text-lg uppercase tracking-wider text-gray-500">All known color variants</span>
                            </div>
                            <span className="text-[9px] sm:text-lg uppercase tracking-wider text-gray-500 w-14 sm:w-24 text-right flex-shrink-0">N Cur</span>
                            <span className="text-[9px] sm:text-lg uppercase tracking-wider text-gray-500 w-[58px] sm:w-20 text-right flex-shrink-0">N Score</span>
                            <span className="text-[9px] sm:text-lg uppercase tracking-wider text-gray-500 w-14 sm:w-24 text-right flex-shrink-0">U Cur</span>
                            <span className="text-[9px] sm:text-lg uppercase tracking-wider text-gray-500 w-[58px] sm:w-20 text-right flex-shrink-0">U Score</span>
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
                                    {lotPeak && (
                                      <span className="text-[9px] sm:text-lg pl-0.5 text-purple-400">peak ${lotPeak.toFixed(2)}</span>
                                    )}
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
                const allPrices = bboxResults.map(r => Math.max(r.marketSoldMaxNew ?? 0, r.marketSoldMaxUsed ?? 0, r.stockAvgPriceN ?? 0, r.ourPriceNew ?? 0, r.ourPriceUsed ?? 0)).filter(p => p > 0);
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
                  const marketPeak = Math.max(r.marketSoldMaxNew ?? 0, r.marketSoldMaxUsed ?? 0) || null;
                  const peak = Math.max(r.marketSoldMaxNew ?? 0, r.marketSoldMaxUsed ?? 0, r.stockAvgPriceN ?? 0, r.ourPriceNew ?? 0, r.ourPriceUsed ?? 0);
                  // Show market peak price first — the highest sold price on BrickLink is what matters.
                  // Fall back to stock (current listing) average, then our own listing price.
                  const displayPrice = marketPeak ?? (r.stockAvgPriceN && r.stockAvgPriceN > 0 ? r.stockAvgPriceN : null) ?? (r.ourPriceNew || r.ourPriceUsed) ?? null;
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

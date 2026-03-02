import { useState, useRef, useEffect, useMemo, forwardRef, useImperativeHandle } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Camera, X, CheckCircle, Loader2, ExternalLink, Trash2, ScanSearch, ChevronRight, ImageIcon, FileText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

export interface BrickanalyzerToolRef {
  triggerCamera: () => void;
  triggerUpload: () => void;
  triggerFile: () => void;
}

interface ScanResult {
  partNo: string;
  partName: string;
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
}

type UIState = "idle" | "uploading" | "processing" | "complete" | "failed";

const BrickanalyzerTool = forwardRef<BrickanalyzerToolRef, {}>((_, ref) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uiState, setUiState] = useState<UIState>("idle");
  const [scanId, setScanId] = useState<number | null>(null);
  const [leftPage, setLeftPage] = useState(false);

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
    if (latestScan.status === "complete") {
      setScanId(latestScan.id);
      setUiState("complete");
    } else if (latestScan.status === "processing") {
      setScanId(latestScan.id);
      setUiState("processing");
      setLeftPage(true);
    } else if (latestScan.status === "failed") {
      setScanId(latestScan.id);
      setUiState("failed");
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

  const activeScan = scan ?? latestScan ?? null;
  const results: ScanResult[] = (uiState === "complete" && activeScan?.results) ? (activeScan.results as ScanResult[]) : [];
  const totalValue = results.reduce((s, p) => s + (p.ourPriceNew ?? p.ourPriceUsed ?? p.marketSoldMaxNew ?? 0), 0);
  const inStockCount = results.filter(p => p.ourQtyNew > 0 || p.ourQtyUsed > 0).length;
  const withPriceCount = results.filter(p => p.ourPriceNew !== null || p.ourPriceUsed !== null || p.marketSoldMaxNew !== null).length;

  // Group results by partNo — preserves sort order of first occurrence
  const groupedResults = useMemo(() => {
    const map = new Map<string, { partNo: string; partName: string; thumbnailUrl: string | null; entries: ScanResult[] }>();
    for (const r of results) {
      const key = r.partNo || `__unknown_${r.partName}`;
      if (!map.has(key)) {
        map.set(key, { partNo: r.partNo, partName: r.partName, thumbnailUrl: r.thumbnailUrl, entries: [] });
      }
      const grp = map.get(key)!;
      grp.entries.push(r);
      if (!grp.thumbnailUrl && r.thumbnailUrl) grp.thumbnailUrl = r.thumbnailUrl;
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
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
            data-testid="input-brickanalyzer-file"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="w-full flex flex-col items-center justify-center gap-3 py-16 text-center rounded-xl border border-dashed border-gray-700 hover:border-purple-500/50 hover:bg-purple-950/20 transition-colors cursor-pointer"
                data-testid="button-brickanalyzer-idle-trigger"
              >
                <Camera className="w-12 h-12 text-gray-500" />
                <p className="text-sm text-gray-400">
                  Tap to take a photo, pick from your library, or upload a file.
                </p>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-48 bg-gray-900 border border-gray-700 text-white">
              <DropdownMenuItem
                className="gap-2 cursor-pointer"
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.accept = "image/*";
                    (fileInputRef.current as any).capture = "environment";
                    fileInputRef.current.click();
                  }
                }}
                data-testid="menu-brickanalyzer-camera"
              >
                <Camera className="w-4 h-4 text-lego-yellow" />
                Take Photo
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 cursor-pointer"
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.removeAttribute("capture");
                    fileInputRef.current.accept = "image/*";
                    fileInputRef.current.click();
                  }
                }}
                data-testid="menu-brickanalyzer-upload-photo"
              >
                <ImageIcon className="w-4 h-4 text-lego-blue" />
                Upload Photo
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 cursor-pointer"
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.removeAttribute("capture");
                    fileInputRef.current.accept = "*/*";
                    fileInputRef.current.click();
                  }
                }}
                data-testid="menu-brickanalyzer-upload-file"
              >
                <FileText className="w-4 h-4 text-gray-400" />
                Upload File
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          <div className="flex flex-wrap items-center gap-3 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-green-400" />
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
          </div>

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

                // Best match: highest confidence + in-stock bonus
                const confRank = (c: 'high' | 'medium' | 'low') => c === 'high' ? 2 : c === 'medium' ? 1 : 0;
                const bestEntry = grp.entries.reduce((best, e) => {
                  const bScore = confRank(best.confidence) * 2 + (best.ourQtyNew + best.ourQtyUsed > 0 ? 1 : 0);
                  const eScore = confRank(e.confidence) * 2 + (e.ourQtyNew + e.ourQtyUsed > 0 ? 1 : 0);
                  return eScore > bScore ? e : best;
                }, grp.entries[0]);
                const bePeak = Math.max(bestEntry.marketSoldMaxNew ?? 0, bestEntry.marketSoldMaxUsed ?? 0) || null;
                const beNScore = bePeak && bestEntry.ourPriceNew && bestEntry.ourPriceNew > 0
                  ? Number((bePeak / bestEntry.ourPriceNew).toFixed(2)) : null;
                const beUScore = bePeak && bestEntry.ourPriceUsed && bestEntry.ourPriceUsed > 0
                  ? Number((bePeak / bestEntry.ourPriceUsed).toFixed(2)) : null;
                const beInStock = (bestEntry.ourQtyNew + bestEntry.ourQtyUsed) > 0;
                const entryScoreColor = (s: number | null) => {
                  if (s === null) return 'text-gray-600';
                  if (s >= 2.0) return 'text-emerald-400';
                  if (s >= 1.5) return 'text-orange-400';
                  if (s >= 1.0) return 'text-yellow-500';
                  return 'text-gray-500';
                };

                return (
                  <div
                    key={key}
                    className="rounded-lg border border-purple-600/30 bg-gradient-to-br from-purple-800/20 to-purple-950/10 overflow-hidden shadow-[0_0_12px_rgba(168,85,247,0.10)]"
                    data-testid={`tile-brickanalyzer-${gi}`}
                  >
                    {/* ── Collapsed header (always visible) ─────────── */}
                    <div
                      className="flex gap-2.5 px-2.5 py-2 cursor-pointer hover-elevate"
                      onClick={() => togglePart(key)}
                      data-testid={`toggle-part-${gi}`}
                    >
                      {/* Thumbnail */}
                      <div className="flex-shrink-0 w-12 h-12 rounded bg-gray-800/80 flex items-center justify-center overflow-hidden">
                        {repImg ? (
                          <img
                            src={`/api/images/proxy?url=${encodeURIComponent(repImg)}`}
                            alt={grp.partName}
                            className="w-full h-full object-contain p-0.5"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = `https://img.bricklink.com/ItemImage/PN/${repEntry.colorId ?? 0}/${grp.partNo}.png`;
                            }}
                          />
                        ) : grp.partNo ? (
                          <img
                            src={`https://img.bricklink.com/ItemImage/PN/${repEntry.colorId ?? 0}/${grp.partNo}.png`}
                            alt={grp.partName}
                            className="w-full h-full object-contain p-0.5"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <Camera className="w-4 h-4 text-gray-700" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5 justify-center">
                        {/* Part name + BL link + chevron */}
                        <div className="flex items-center gap-1">
                          <p className="text-xs font-semibold text-white leading-tight flex-1 truncate">
                            {grp.partName || "Unknown Part"}
                          </p>
                          {grp.partNo && (
                            <a
                              href={`https://www.bricklink.com/v2/catalog/catalogitem.page?P=${grp.partNo}`}
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

                        {/* Part no · N colors · qty · confidence */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {grp.partNo && <span className="font-mono text-[10px] text-gray-300">{grp.partNo}</span>}
                          <span className="text-[10px] text-gray-400">
                            {grp.entries.length === 1
                              ? grp.entries[0].colorName || "1 color"
                              : `${grp.entries.length} colors`}
                          </span>
                          {stockLabel && (
                            <span className="text-[10px] text-green-400 font-medium">· {stockLabel}</span>
                          )}
                          <span className={`text-[10px] font-medium capitalize ${confidenceColor(bestConfidence)}`}>
                            · {bestConfidence}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* ── Expanded: best match + all color/condition rows ── */}
                    {isExpanded && (
                      <div className="border-t border-purple-500/10 px-2 py-1.5 space-y-1">
                        {/* Best Match banner */}
                        <div className="rounded-lg border border-purple-500/40 bg-purple-900/25 px-2 py-1.5">
                          <div className="flex items-center gap-1 mb-1">
                            <Sparkles className="w-3 h-3 text-purple-400 flex-shrink-0" />
                            <span className="text-[9px] uppercase tracking-wider text-purple-400 font-semibold">Best Match</span>
                            <span className={`ml-1 text-[9px] font-medium capitalize ${confidenceColor(bestEntry.confidence)}`}>
                              · {bestEntry.confidence} confidence
                            </span>
                          </div>
                          <div className="flex items-center gap-1 min-w-0">
                            <div className="flex flex-col flex-1 min-w-0">
                              <div className="flex items-center gap-1 min-w-0">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${beInStock ? 'bg-emerald-500' : 'bg-gray-600'}`} />
                                {beInStock && <span className="text-[10px] font-mono text-gray-300 flex-shrink-0">×{bestEntry.ourQtyNew + bestEntry.ourQtyUsed}</span>}
                                {bestEntry.colorRgb ? (
                                  <span className="w-2 h-2 rounded-full flex-shrink-0 border border-gray-600" style={{ backgroundColor: `#${bestEntry.colorRgb}` }} />
                                ) : (
                                  <span className="w-2 h-2 rounded-full flex-shrink-0 bg-gray-600" />
                                )}
                                <span className="text-[10px] text-white font-medium truncate">{bestEntry.colorName || '—'}</span>
                              </div>
                              {bePeak && (
                                <span className="text-[9px] pl-0.5 text-purple-400">peak ${bePeak.toFixed(2)}</span>
                              )}
                            </div>
                            <span className="text-[10px] font-mono text-gray-300 w-14 text-right flex-shrink-0">
                              {bestEntry.ourPriceNew != null ? `$${bestEntry.ourPriceNew.toFixed(2)}` : '—'}
                            </span>
                            <span className={`text-[10px] font-mono font-bold w-[58px] text-right flex-shrink-0 ${entryScoreColor(beNScore)}`}>
                              {beNScore != null ? `${beNScore}×` : '—'}
                            </span>
                            <span className="text-[10px] font-mono text-gray-300 w-14 text-right flex-shrink-0">
                              {bestEntry.ourPriceUsed != null ? `$${bestEntry.ourPriceUsed.toFixed(2)}` : '—'}
                            </span>
                            <span className={`text-[10px] font-mono font-bold w-[58px] text-right flex-shrink-0 ${entryScoreColor(beUScore)}`}>
                              {beUScore != null ? `${beUScore}×` : '—'}
                            </span>
                          </div>
                        </div>

                        {/* All colors sublist — only shown when multiple entries */}
                        {grp.entries.length > 1 && (
                          <>
                            <div className="flex items-center gap-1 px-1 pb-0.5 pt-0.5">
                              <div className="flex-1 min-w-0">
                                <span className="text-[9px] uppercase tracking-wider text-gray-600">All colors</span>
                              </div>
                              <span className="text-[9px] uppercase tracking-wider text-gray-400 w-14 text-right flex-shrink-0">N Cur</span>
                              <span className="text-[9px] uppercase tracking-wider text-gray-400 w-[58px] text-right flex-shrink-0">N Score</span>
                              <span className="text-[9px] uppercase tracking-wider text-gray-400 w-14 text-right flex-shrink-0">U Cur</span>
                              <span className="text-[9px] uppercase tracking-wider text-gray-400 w-[58px] text-right flex-shrink-0">U Score</span>
                            </div>
                            {grp.entries.map((piece, ei) => {
                              const peak = Math.max(piece.marketSoldMaxNew ?? 0, piece.marketSoldMaxUsed ?? 0) || null;
                              const peakVal = peak && peak > 0 ? peak : null;
                              const nScore = peakVal && piece.ourPriceNew && piece.ourPriceNew > 0
                                ? Number((peakVal / piece.ourPriceNew).toFixed(2)) : null;
                              const uScore = peakVal && piece.ourPriceUsed && piece.ourPriceUsed > 0
                                ? Number((peakVal / piece.ourPriceUsed).toFixed(2)) : null;
                              const pieceTotalQty = piece.ourQtyNew + piece.ourQtyUsed;
                              const inStock = pieceTotalQty > 0;
                              const isBest = piece === bestEntry;
                              return (
                                <div
                                  key={ei}
                                  className={`border rounded-lg px-2 py-1.5 ${isBest ? 'bg-purple-900/20 border-purple-500/30' : 'bg-gray-900/50 border-gray-700/60'}`}
                                  data-testid={`entry-${gi}-${ei}`}
                                >
                                  <div className="flex items-center gap-1 min-w-0">
                                    <div className="flex flex-col flex-1 min-w-0">
                                      <div className="flex items-center gap-1 min-w-0">
                                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${inStock ? 'bg-emerald-500' : 'bg-gray-600'}`} />
                                        {inStock && <span className="text-[10px] font-mono text-gray-300 flex-shrink-0">×{pieceTotalQty}</span>}
                                        {piece.colorRgb ? (
                                          <span className="w-2 h-2 rounded-full flex-shrink-0 border border-gray-600" style={{ backgroundColor: `#${piece.colorRgb}` }} />
                                        ) : (
                                          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-gray-600" />
                                        )}
                                        <span className="text-[10px] text-gray-300 truncate">{piece.colorName || '—'}</span>
                                        {isBest && <Sparkles className="w-2.5 h-2.5 text-purple-400 flex-shrink-0" />}
                                      </div>
                                      {peakVal && (
                                        <span className="text-[9px] pl-0.5 text-purple-400">peak ${peakVal.toFixed(2)}</span>
                                      )}
                                    </div>
                                    <span className="text-[10px] font-mono text-gray-300 w-14 text-right flex-shrink-0">
                                      {piece.ourPriceNew != null ? `$${piece.ourPriceNew.toFixed(2)}` : '—'}
                                    </span>
                                    <span className={`text-[10px] font-mono font-bold w-[58px] text-right flex-shrink-0 ${entryScoreColor(nScore)}`}>
                                      {nScore != null ? `${nScore}×` : '—'}
                                    </span>
                                    <span className="text-[10px] font-mono text-gray-300 w-14 text-right flex-shrink-0">
                                      {piece.ourPriceUsed != null ? `$${piece.ourPriceUsed.toFixed(2)}` : '—'}
                                    </span>
                                    <span className={`text-[10px] font-mono font-bold w-[58px] text-right flex-shrink-0 ${entryScoreColor(uScore)}`}>
                                      {uScore != null ? `${uScore}×` : '—'}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </>
                        )}
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

    </div>
  );
});

export default BrickanalyzerTool;

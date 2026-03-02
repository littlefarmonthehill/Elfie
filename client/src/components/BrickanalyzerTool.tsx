import { useState, useRef, useEffect, useMemo, forwardRef, useImperativeHandle } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Camera, X, CheckCircle, Loader2, ExternalLink, Trash2, ScanSearch, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  confidence: "high" | "medium" | "low";
  note: string;
  ourPrice: number | null;
  ourQty: number;
  inventoryId: number | null;
  pomPrice: number | null;
  marketAvgPrice: number | null;
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
  const totalValue = results.reduce((s, p) => s + (p.pomPrice ?? p.ourPrice ?? p.marketAvgPrice ?? 0), 0);
  const inStockCount = results.filter(p => p.ourPrice !== null).length;
  const withPriceCount = results.filter(p => p.pomPrice !== null || p.ourPrice !== null || p.marketAvgPrice !== null).length;

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
    return "text-gray-500";
  }

  return (
    <div className="space-y-4 p-1">

      {/* ── IDLE: Upload UI ─────────────────────────────────────────────── */}
      {uiState === "idle" && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Camera className="w-12 h-12 text-gray-600" />
          <p className="text-sm text-gray-400">
            Tap the <span className="text-white font-medium">camera icon</span> above to take a photo, pick from your library, or upload a file.
          </p>
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
        </div>
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
                const totalQty = grp.entries.reduce((s, e) => s + e.ourQty, 0);
                const bestPom = grp.entries.reduce<number | null>((best, e) =>
                  e.pomPrice !== null ? (best === null ? e.pomPrice : Math.max(best, e.pomPrice)) : best, null);
                const bestListed = grp.entries.reduce<number | null>((best, e) =>
                  e.ourPrice !== null ? (best === null ? e.ourPrice : Math.max(best, e.ourPrice)) : best, null);
                const bestMkt = grp.entries.reduce<number | null>((best, e) =>
                  e.marketAvgPrice !== null ? (best === null ? e.marketAvgPrice : Math.max(best, e.marketAvgPrice)) : best, null);
                const repImg = grp.thumbnailUrl;
                const repEntry = grp.entries[0];

                return (
                  <div
                    key={key}
                    className="rounded-lg border border-gray-700/60 bg-gradient-to-br from-gray-800/60 via-gray-900/80 to-gray-950/60 overflow-hidden"
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

                        {/* Part no · N colors · qty */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {grp.partNo && <span className="font-mono text-[10px] text-gray-500">{grp.partNo}</span>}
                          <span className="text-[10px] text-gray-600">
                            {grp.entries.length === 1
                              ? grp.entries[0].colorName || "1 color"
                              : `${grp.entries.length} colors`}
                          </span>
                          {totalQty > 0 && (
                            <span className="text-[10px] text-green-400 font-medium">· {totalQty} in stock</span>
                          )}
                        </div>

                        {/* Best prices across all colors */}
                        <div className="flex items-center gap-3">
                          <div className="flex items-baseline gap-1">
                            <span className="text-[9px] text-gray-500 uppercase tracking-wider">POM</span>
                            {bestPom !== null
                              ? <span className="text-[11px] font-mono font-semibold text-lego-yellow">${bestPom.toFixed(2)}</span>
                              : <span className="text-[11px] text-gray-600">—</span>
                            }
                          </div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-[9px] text-gray-500 uppercase tracking-wider">Listed</span>
                            {bestListed !== null
                              ? <span className="text-[11px] font-mono text-green-400">${bestListed.toFixed(2)}</span>
                              : <span className="text-[11px] text-gray-600">—</span>
                            }
                          </div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-[9px] text-gray-500 uppercase tracking-wider">Mkt Hi</span>
                            {bestMkt !== null
                              ? <span className="text-[11px] font-mono text-gray-300">${bestMkt.toFixed(2)}</span>
                              : <span className="text-[11px] text-gray-600">—</span>
                            }
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ── Expanded: all color/condition rows ──────────── */}
                    {isExpanded && (
                      <div className="border-t border-gray-700/50">
                        {grp.entries.map((piece, ei) => (
                          <div
                            key={ei}
                            className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/60 last:border-0"
                            data-testid={`entry-${gi}-${ei}`}
                          >
                            {/* Color swatch */}
                            <div className="w-1 self-stretch rounded-full bg-gray-600/50 flex-shrink-0" />

                            {/* Color name + qty */}
                            <div className="w-28 flex-shrink-0">
                              <p className="text-[11px] text-gray-300 truncate">{piece.colorName || "Unknown"}</p>
                              {piece.ourQty > 0 && (
                                <p className="text-[10px] text-green-400">{piece.ourQty} in stock</p>
                              )}
                            </div>

                            {/* Prices */}
                            <div className="flex-1 flex items-center gap-3">
                              <div className="flex items-baseline gap-1">
                                <span className="text-[9px] text-gray-600 uppercase">POM</span>
                                {piece.pomPrice !== null
                                  ? <span className="text-[11px] font-mono text-lego-yellow">${piece.pomPrice.toFixed(2)}</span>
                                  : <span className="text-[11px] text-gray-700">—</span>
                                }
                              </div>
                              <div className="flex items-baseline gap-1">
                                <span className="text-[9px] text-gray-600 uppercase">Listed</span>
                                {piece.ourPrice !== null
                                  ? <span className="text-[11px] font-mono text-green-400">${piece.ourPrice.toFixed(2)}</span>
                                  : <span className="text-[11px] text-gray-700">—</span>
                                }
                              </div>
                              <div className="flex items-baseline gap-1">
                                <span className="text-[9px] text-gray-600 uppercase">Mkt</span>
                                {piece.marketAvgPrice !== null
                                  ? <span className="text-[11px] font-mono text-gray-400">${piece.marketAvgPrice.toFixed(2)}</span>
                                  : <span className="text-[11px] text-gray-700">—</span>
                                }
                              </div>
                            </div>

                            {/* Confidence */}
                            <span className={`text-[9px] capitalize flex-shrink-0 ${confidenceColor(piece.confidence)}`}>
                              {piece.confidence}
                            </span>
                          </div>
                        ))}
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

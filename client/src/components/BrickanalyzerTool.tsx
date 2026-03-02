import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Camera, Upload, X, AlertTriangle, CheckCircle, Loader2, ExternalLink, Trash2, ScanSearch, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

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

export default function BrickanalyzerTool() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uiState, setUiState] = useState<UIState>("idle");
  const [scanId, setScanId] = useState<number | null>(null);
  const [leftPage, setLeftPage] = useState(false);

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
    enabled: !!scanId && (uiState === "processing"),
    refetchInterval: (data) => {
      if (!data || (data as BrickanalyzerScan).status === "processing") return 2000;
      return false;
    },
    select: (data) => {
      if (data.status === "complete" && uiState === "processing") {
        setUiState("complete");
        queryClient.invalidateQueries({ queryKey: ["/api/brickanalyzer/scans/latest"] });
      }
      if (data.status === "failed" && uiState === "processing") {
        setUiState("failed");
        queryClient.invalidateQueries({ queryKey: ["/api/brickanalyzer/scans/latest"] });
      }
      return data;
    },
  });

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

  const activeScan = scan ?? latestScan ?? null;
  const results: ScanResult[] = (uiState === "complete" && activeScan?.results) ? (activeScan.results as ScanResult[]) : [];
  const totalValue = results.reduce((s, p) => s + (p.pomPrice ?? p.ourPrice ?? p.marketAvgPrice ?? 0), 0);
  const inStockCount = results.filter(p => p.ourPrice !== null).length;
  const withPriceCount = results.filter(p => p.pomPrice !== null || p.ourPrice !== null || p.marketAvgPrice !== null).length;

  function confidenceColor(c: string) {
    if (c === "high") return "text-green-400";
    if (c === "medium") return "text-yellow-400";
    return "text-gray-500";
  }

  return (
    <div className="space-y-4 p-1">

      {/* ── IDLE: Upload UI ─────────────────────────────────────────────── */}
      {uiState === "idle" && (
        <div className="space-y-4">
          {/* Instructions */}
          <div className="bg-blue-950/40 border border-blue-500/20 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span className="text-sm font-medium text-blue-300">Setup for best results</span>
            </div>
            <ul className="text-xs text-blue-400/80 space-y-1 pl-6 list-disc">
              <li>Place pieces on a plain white or light-colored surface</li>
              <li>Spread them out so no pieces overlap or touch</li>
              <li>Use good lighting — avoid harsh shadows</li>
              <li>Shoot straight down for a flat overhead view</li>
              <li>Up to ~30 pieces per scan for best accuracy</li>
            </ul>
          </div>

          {/* Ephemeral warning */}
          <div className="bg-amber-950/40 border border-amber-500/20 rounded-lg p-3 flex gap-2 items-start">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300">
              Results are <strong>not saved</strong>. Once you close or dismiss the scan the data is permanently deleted. Screenshot or note what you need before closing.
            </p>
          </div>

          {/* Upload / Camera buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              className="flex-1 h-24 flex-col gap-2"
              variant="outline"
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.accept = "image/*";
                  fileInputRef.current.capture = "environment" as any;
                  fileInputRef.current.click();
                }
              }}
              data-testid="button-brickanalyzer-camera"
            >
              <Camera className="w-6 h-6 text-lego-yellow" />
              <span className="text-sm">Take Photo</span>
            </Button>
            <Button
              className="flex-1 h-24 flex-col gap-2"
              variant="outline"
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.removeAttribute("capture");
                  fileInputRef.current.accept = "image/*";
                  fileInputRef.current.click();
                }
              }}
              data-testid="button-brickanalyzer-upload"
            >
              <Upload className="w-6 h-6 text-lego-blue" />
              <span className="text-sm">Upload Image</span>
            </Button>
          </div>

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

          {/* Ephemeral warning */}
          <div className="flex gap-2 items-start bg-amber-950/30 border border-amber-500/20 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300">
              These results will be <strong>permanently deleted</strong> when you dismiss this scan. Save what you need now.
            </p>
          </div>

          {/* Results table */}
          {results.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              No pieces could be identified. Try a clearer photo with better lighting.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-700">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-700 bg-gray-800/60">
                    <th className="text-left px-2 py-2 text-gray-400 font-medium w-8"></th>
                    <th className="text-left px-2 py-2 text-gray-400 font-medium">Part</th>
                    <th className="text-right px-2 py-2 text-gray-400 font-medium">POM Price</th>
                    <th className="text-right px-2 py-2 text-gray-400 font-medium">Our Price</th>
                    <th className="text-right px-2 py-2 text-gray-400 font-medium">Mkt Avg</th>
                    <th className="text-right px-2 py-2 text-gray-400 font-medium">Qty</th>
                    <th className="text-center px-2 py-2 text-gray-400 font-medium">AI</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((piece, i) => (
                    <tr
                      key={i}
                      className="border-b border-gray-800 last:border-0 hover-elevate"
                      data-testid={`row-brickanalyzer-${i}`}
                    >
                      {/* Thumbnail */}
                      <td className="px-2 py-1.5">
                        {piece.thumbnailUrl ? (
                          <img
                            src={`/api/images/proxy?url=${encodeURIComponent(piece.thumbnailUrl)}`}
                            alt={piece.partName}
                            className="w-8 h-8 object-contain rounded bg-gray-800"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : piece.partNo ? (
                          <img
                            src={`https://img.bricklink.com/ItemImage/PN/${piece.colorId ?? 0}/${piece.partNo}.png`}
                            alt={piece.partName}
                            className="w-8 h-8 object-contain rounded bg-gray-800"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <div className="w-8 h-8 rounded bg-gray-800" />
                        )}
                      </td>
                      {/* Part info */}
                      <td className="px-2 py-1.5">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {piece.partNo ? (
                              <a
                                href={`https://www.bricklink.com/v2/catalog/catalogitem.page?P=${piece.partNo}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-lego-blue hover:underline flex items-center gap-0.5"
                                data-testid={`link-bricklink-${i}`}
                              >
                                {piece.partNo}
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            ) : (
                              <span className="text-gray-500 italic">unknown</span>
                            )}
                            {piece.colorName && (
                              <span className="text-gray-500">{piece.colorName}</span>
                            )}
                          </div>
                          <span className="text-gray-300 leading-tight">{piece.partName}</span>
                          {piece.note && (
                            <span className="text-gray-600 italic">{piece.note}</span>
                          )}
                        </div>
                      </td>
                      {/* POM suggested price */}
                      <td className="px-2 py-1.5 text-right">
                        {piece.pomPrice !== null
                          ? <span className="text-lego-yellow font-mono font-semibold">${piece.pomPrice.toFixed(2)}</span>
                          : <span className="text-gray-600">—</span>
                        }
                      </td>
                      {/* Our listed price */}
                      <td className="px-2 py-1.5 text-right">
                        {piece.ourPrice !== null
                          ? <span className="text-green-400 font-mono">${piece.ourPrice.toFixed(2)}</span>
                          : <span className="text-gray-600">—</span>
                        }
                      </td>
                      {/* Market avg */}
                      <td className="px-2 py-1.5 text-right">
                        {piece.marketAvgPrice !== null
                          ? <span className="text-gray-400 font-mono">${piece.marketAvgPrice.toFixed(2)}</span>
                          : <span className="text-gray-600">—</span>
                        }
                      </td>
                      {/* Qty in stock */}
                      <td className="px-2 py-1.5 text-right font-mono text-gray-400">
                        {piece.ourQty > 0 ? piece.ourQty : <span className="text-gray-600">—</span>}
                      </td>
                      {/* AI confidence */}
                      <td className="px-2 py-1.5 text-center">
                        <span className={`capitalize font-medium ${confidenceColor(piece.confidence)}`}>
                          {piece.confidence.charAt(0).toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
}

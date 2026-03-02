import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Camera, X, CheckCircle, Loader2, ExternalLink, Trash2, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const [selectedPiece, setSelectedPiece] = useState<ScanResult | null>(null);

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
                    <th className="text-right px-2 py-2 text-gray-400 font-medium">Mkt High</th>
                    <th className="text-right px-2 py-2 text-gray-400 font-medium">Qty</th>
                    <th className="text-center px-2 py-2 text-gray-400 font-medium">AI</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((piece, i) => (
                    <tr
                      key={i}
                      className="border-b border-gray-800 last:border-0 hover-elevate cursor-pointer"
                      data-testid={`row-brickanalyzer-${i}`}
                      onClick={() => setSelectedPiece(piece)}
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
                                onClick={(e) => e.stopPropagation()}
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

      {/* Part detail popup */}
      <Dialog open={!!selectedPiece} onOpenChange={(open) => { if (!open) setSelectedPiece(null); }}>
        <DialogContent className="bg-gray-900 border border-gray-700 text-white max-w-sm" data-testid="dialog-part-detail">
          {selectedPiece && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base font-semibold text-gray-100 pr-6">
                  {selectedPiece.partName || "Unknown Part"}
                </DialogTitle>
              </DialogHeader>

              <div className="flex flex-col gap-4">
                {/* Image */}
                <div className="flex justify-center bg-gray-800 rounded-lg p-4">
                  {selectedPiece.thumbnailUrl ? (
                    <img
                      src={`/api/images/proxy?url=${encodeURIComponent(selectedPiece.thumbnailUrl)}`}
                      alt={selectedPiece.partName}
                      className="w-40 h-40 object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).src = `https://img.bricklink.com/ItemImage/PN/${selectedPiece.colorId ?? 0}/${selectedPiece.partNo}.png`; }}
                    />
                  ) : selectedPiece.partNo ? (
                    <img
                      src={`https://img.bricklink.com/ItemImage/PN/${selectedPiece.colorId ?? 0}/${selectedPiece.partNo}.png`}
                      alt={selectedPiece.partName}
                      className="w-40 h-40 object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <div className="w-40 h-40 flex items-center justify-center text-gray-600 text-sm">No image</div>
                  )}
                </div>

                {/* Details */}
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Part No.</span>
                    <span className="font-mono text-gray-200">{selectedPiece.partNo || "—"}</span>
                  </div>
                  {selectedPiece.colorName && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Color</span>
                      <span className="text-gray-200">{selectedPiece.colorName}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">AI Confidence</span>
                    <Badge variant="outline" className={`text-xs capitalize ${confidenceColor(selectedPiece.confidence)} border-current`}>
                      {selectedPiece.confidence}
                    </Badge>
                  </div>
                </div>

                {/* Prices */}
                <div className="border border-gray-700 rounded-lg divide-y divide-gray-700 text-sm">
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-gray-400">POM Price</span>
                    {selectedPiece.pomPrice !== null
                      ? <span className="text-lego-yellow font-mono font-semibold">${selectedPiece.pomPrice.toFixed(2)}</span>
                      : <span className="text-gray-600">—</span>
                    }
                  </div>
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-gray-400">Our Price</span>
                    {selectedPiece.ourPrice !== null
                      ? <span className="text-green-400 font-mono">${selectedPiece.ourPrice.toFixed(2)}</span>
                      : <span className="text-gray-600">—</span>
                    }
                  </div>
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-gray-400">Mkt High</span>
                    {selectedPiece.marketAvgPrice !== null
                      ? <span className="text-gray-300 font-mono">${selectedPiece.marketAvgPrice.toFixed(2)}</span>
                      : <span className="text-gray-600">—</span>
                    }
                  </div>
                  {selectedPiece.ourQty > 0 && (
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-gray-400">In Stock</span>
                      <span className="font-mono text-gray-300">{selectedPiece.ourQty}</span>
                    </div>
                  )}
                </div>

                {/* BrickLink button */}
                {selectedPiece.partNo && (
                  <a
                    href={`https://www.bricklink.com/v2/catalog/catalogitem.page?P=${selectedPiece.partNo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="button-open-bricklink-catalog"
                  >
                    <Button className="w-full" data-testid="button-bricklink-catalog">
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Open BrickLink Catalog
                    </Button>
                  </a>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
});

export default BrickanalyzerTool;

import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  X, Camera, CameraOff, ScanLine, Package, Archive,
  CheckCircle2, AlertCircle, ArrowRight, Loader2, RotateCcw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ───────────────────────────────────────────────────────────────────

interface ResolvedBin {
  type: "bin";
  id: number;
  name: string;
  shelfName: string | null;
  aisleName: string | null;
  itemCount: number;
}

interface ResolvedLot {
  type: "lot";
  id: number;
  itemNo: string;
  itemName: string | null;
  colorName: string | null;
  newOrUsed: string;
  quantity: number;
  locations: Array<{
    id: number;
    binId: number;
    binName: string | null;
    shelfName: string | null;
    aisleName: string | null;
    bagLabel: string | null;
  }>;
}

type Resolved = ResolvedBin | ResolvedLot;

interface FeedEntry {
  id: string;
  code: string;
  ts: Date;
  status: "ok" | "err" | "busy";
  message: string;
}

type ScanMode = "bin-first" | "lot-first";

interface Props {
  onClose: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function binLabel(bin: ResolvedBin) {
  const parts = [bin.aisleName, bin.shelfName, bin.name].filter(Boolean);
  return parts.length > 1 ? bin.name : bin.name;
}

function binFullLabel(bin: ResolvedBin) {
  return [bin.aisleName, bin.shelfName, bin.name].filter(Boolean).join(" › ");
}

function lotLabel(lot: ResolvedLot) {
  return lot.itemName ?? lot.itemNo;
}

function lotSub(lot: ResolvedLot) {
  const parts: string[] = [];
  if (lot.colorName) parts.push(lot.colorName);
  parts.push(lot.newOrUsed === "N" ? "New" : "Used");
  parts.push(`×${lot.quantity}`);
  return parts.join(" · ");
}

// ── Component ────────────────────────────────────────────────────────────────

export function WarehouseScanPanel({ onClose }: Props) {
  const { toast } = useToast();
  const [mode, setMode] = useState<ScanMode>("bin-first");
  const [activeBin, setActiveBin] = useState<ResolvedBin | null>(null);
  const [activeLot, setActiveLot] = useState<ResolvedLot | null>(null);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [inputVal, setInputVal] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraSupported, setCameraSupported] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const processingRef = useRef(false);

  // Check BarcodeDetector support
  useEffect(() => {
    setCameraSupported("BarcodeDetector" in window);
  }, []);

  // Focus input when camera is closed
  useEffect(() => {
    if (!cameraOpen) inputRef.current?.focus();
  }, [cameraOpen]);

  // Camera cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const assignMutation = useMutation({
    mutationFn: ({ inventoryId, binId }: { inventoryId: number; binId: number }) =>
      apiRequest("POST", "/api/warehouse/scan/assign", { inventoryId, binId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/bins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/locations"] });
    },
  });

  // ── Core scan logic ────────────────────────────────────────────────────────

  const addFeed = useCallback((code: string, status: FeedEntry["status"], message: string) => {
    setFeed(prev => [
      { id: `${Date.now()}-${Math.random()}`, code, ts: new Date(), status, message },
      ...prev.slice(0, 29),
    ]);
  }, []);

  const processCode = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code || processingRef.current) return;
    processingRef.current = true;

    addFeed(code, "busy", "Resolving…");

    let resolved: Resolved;
    try {
      const res = await fetch(`/api/warehouse/scan/resolve?code=${encodeURIComponent(code)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        addFeed(code, "err", err.error ?? "Not found");
        processingRef.current = false;
        return;
      }
      resolved = await res.json();
    } catch {
      addFeed(code, "err", "Network error");
      processingRef.current = false;
      return;
    }

    // ── BIN scanned ──────────────────────────────────────────────────────────
    if (resolved.type === "bin") {
      if (mode === "bin-first") {
        setActiveBin(resolved);
        addFeed(code, "ok", `Active bin set to ${binFullLabel(resolved)}`);
      } else {
        // lot-first: assign active lot to this bin
        if (!activeLot) {
          addFeed(code, "err", "Scan a lot first");
        } else {
          try {
            await assignMutation.mutateAsync({ inventoryId: activeLot.id, binId: resolved.id });
            addFeed(code, "ok", `${lotLabel(activeLot)} → ${binFullLabel(resolved)}`);
            setActiveLot(null);
          } catch {
            addFeed(code, "err", "Assignment failed");
          }
        }
      }
    }

    // ── LOT scanned ──────────────────────────────────────────────────────────
    if (resolved.type === "lot") {
      if (mode === "lot-first") {
        setActiveLot(resolved);
        const locStr = resolved.locations.length > 0
          ? resolved.locations.map(l => l.binName ?? "?").join(", ")
          : "unassigned";
        addFeed(code, "ok", `${lotLabel(resolved)} — currently: ${locStr}`);
      } else {
        // bin-first: assign this lot to active bin
        if (!activeBin) {
          addFeed(code, "err", "Scan a bin first");
        } else {
          try {
            await assignMutation.mutateAsync({ inventoryId: resolved.id, binId: activeBin.id });
            addFeed(code, "ok", `${lotLabel(resolved)} → ${binFullLabel(activeBin)}`);
          } catch {
            addFeed(code, "err", "Assignment failed");
          }
        }
      }
    }

    processingRef.current = false;
  }, [mode, activeBin, activeLot, addFeed, assignMutation]);

  // ── Camera ────────────────────────────────────────────────────────────────

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (!cameraSupported) {
      toast({ title: "Camera scanning not supported on this browser", variant: "destructive" });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      setCameraOpen(true);

      // Attach stream after state update renders the video element
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      });

      // @ts-ignore
      detectorRef.current = new BarcodeDetector({ formats: ["qr_code"] });

      const scanFrame = async () => {
        if (!videoRef.current || !detectorRef.current) return;
        try {
          const codes = await detectorRef.current.detect(videoRef.current);
          if (codes.length > 0) {
            const value: string = codes[0].rawValue;
            await processCode(value);
          }
        } catch {}
        rafRef.current = requestAnimationFrame(scanFrame);
      };
      rafRef.current = requestAnimationFrame(scanFrame);
    } catch (e: any) {
      toast({ title: "Camera access denied", variant: "destructive" });
    }
  }, [cameraSupported, processCode, toast]);

  // ── Keyboard scanner handler ───────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = inputVal.trim();
      if (val) {
        processCode(val);
        setInputVal("");
      }
    }
  };

  // ── Mode switch resets active context ────────────────────────────────────

  const switchMode = (m: ScanMode) => {
    setMode(m);
    setActiveBin(null);
    setActiveLot(null);
    inputRef.current?.focus();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col" data-testid="scan-panel">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <ScanLine className="h-5 w-5 text-yellow-400 shrink-0" />
        <span className="font-semibold text-sm flex-1">Scan Mode</span>
        <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-scan-close">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 px-4 pt-3 pb-2 shrink-0">
        <button
          onClick={() => switchMode("bin-first")}
          data-testid="button-mode-bin-first"
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium border transition-colors
            ${mode === "bin-first"
              ? "bg-yellow-500/15 border-yellow-500/50 text-yellow-400"
              : "border-border text-muted-foreground hover-elevate"}`}
        >
          <Archive className="h-4 w-4" />
          Bin → Lots
        </button>
        <button
          onClick={() => switchMode("lot-first")}
          data-testid="button-mode-lot-first"
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium border transition-colors
            ${mode === "lot-first"
              ? "bg-yellow-500/15 border-yellow-500/50 text-yellow-400"
              : "border-border text-muted-foreground hover-elevate"}`}
        >
          <Package className="h-4 w-4" />
          Lot → Bin
        </button>
      </div>

      {/* Mode description */}
      <p className="px-4 text-[11px] text-muted-foreground mb-3 shrink-0">
        {mode === "bin-first"
          ? "Scan a bin label to set it as active, then scan lots to file them into that bin."
          : "Scan a lot to identify it, then scan a bin label to move it there."}
      </p>

      {/* Active context card */}
      <div className="px-4 mb-3 shrink-0">
        {mode === "bin-first" ? (
          <div className={`rounded-md border p-3 flex items-center gap-3 ${activeBin ? "border-yellow-500/40 bg-yellow-500/8" : "border-dashed border-border"}`}>
            <Archive className={`h-5 w-5 shrink-0 ${activeBin ? "text-yellow-400" : "text-muted-foreground/40"}`} />
            <div className="flex-1 min-w-0">
              {activeBin ? (
                <>
                  <p className="text-sm font-semibold leading-none">{binFullLabel(activeBin)}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{activeBin.itemCount} lots currently in bin</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No active bin — scan a bin label</p>
              )}
            </div>
            {activeBin && (
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => setActiveBin(null)}>
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ) : (
          <div className={`rounded-md border p-3 flex items-center gap-3 ${activeLot ? "border-yellow-500/40 bg-yellow-500/8" : "border-dashed border-border"}`}>
            <Package className={`h-5 w-5 shrink-0 ${activeLot ? "text-yellow-400" : "text-muted-foreground/40"}`} />
            <div className="flex-1 min-w-0">
              {activeLot ? (
                <>
                  <p className="text-sm font-semibold leading-none truncate">{lotLabel(activeLot)}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{lotSub(activeLot)}</p>
                  {activeLot.locations.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Currently in: {activeLot.locations.map(l => l.binName ?? "?").join(", ")}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No active lot — scan a lot label</p>
              )}
            </div>
            {activeLot && (
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => setActiveLot(null)}>
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Camera or input */}
      <div className="px-4 mb-3 shrink-0 space-y-2">
        {cameraOpen ? (
          <div className="relative rounded-md overflow-hidden bg-black aspect-video">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
            />
            {/* Scan target overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-48 border-2 border-yellow-400/70 rounded-md" />
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="absolute top-2 right-2 bg-black/60 text-white"
              onClick={stopCamera}
              data-testid="button-camera-stop"
            >
              <CameraOff className="h-4 w-4 mr-1.5" />Stop camera
            </Button>
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Scan or type code — press Enter"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              data-testid="input-scan-code"
              className="w-full h-11 px-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
            />
            {cameraSupported === true && (
              <Button
                variant="outline"
                className="w-full gap-2 border-yellow-500/40 text-yellow-400"
                onClick={startCamera}
                data-testid="button-camera-start"
              >
                <Camera className="h-4 w-4" />
                Use phone camera to scan QR code
              </Button>
            )}
            {cameraSupported === false && (
              <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2.5 space-y-1">
                <div className="flex items-center gap-2">
                  <CameraOff className="h-4 w-4 text-muted-foreground shrink-0" />
                  <p className="text-xs font-medium text-muted-foreground">Camera scanning not available in this browser</p>
                </div>
                <p className="text-[11px] text-muted-foreground/70 leading-snug">
                  QR scanning with your phone camera requires Chrome or Edge. Open this page in Chrome on your phone, or use a Bluetooth/USB barcode scanner and type codes will appear in the field above.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1.5">
        {feed.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground/50 text-sm gap-2">
            <ScanLine className="h-8 w-8" />
            <span>Scan history will appear here</span>
          </div>
        )}
        {feed.map(entry => (
          <div
            key={entry.id}
            className={`flex items-start gap-2.5 rounded-md px-3 py-2 text-sm border
              ${entry.status === "ok" ? "border-green-500/20 bg-green-500/5" :
                entry.status === "err" ? "border-destructive/20 bg-destructive/5" :
                "border-border/60 bg-muted/20"}`}
          >
            {entry.status === "ok" && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />}
            {entry.status === "err" && <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />}
            {entry.status === "busy" && <Loader2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5 animate-spin" />}
            <div className="flex-1 min-w-0">
              <p className="font-mono text-[11px] text-muted-foreground truncate">{entry.code}</p>
              <p className={`text-xs ${entry.status === "err" ? "text-destructive" : ""}`}>{entry.message}</p>
            </div>
            <span className="text-[10px] text-muted-foreground/50 shrink-0 mt-0.5">
              {entry.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

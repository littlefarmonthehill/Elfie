import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  X, Camera, CameraOff, ScanLine, Package, Archive,
  CheckCircle2, AlertCircle, AlertTriangle, Loader2, RotateCcw, Undo2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import { formatTime } from "@/lib/utils";
import { useScanSession } from "@/contexts/ScanSessionContext";

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
  rtfBin: string | null;
  locations: Array<{
    id: number;
    binId: number;
    binName: string | null;
    shelfName: string | null;
    aisleName: string | null;
    bagLabel: string | null;
  }>;
  // Present only for a never-filed lot (no permanent home). Points at the bin
  // where the lot's closest sibling already lives, so the worker has a starting
  // suggestion to confirm or override by scanning a bin.
  suggestedBin?: {
    id: number;
    name: string;
    shelfName: string | null;
    aisleName: string | null;
    matchLevel: number;
  } | null;
}

type Resolved = ResolvedBin | ResolvedLot;

interface UndoMeta {
  locationId: number;
  restoreRtfBin: string | null;
}

interface FeedEntry {
  id: string;
  code: string;
  ts: Date;
  // "ok" = filed into the correct/expected bin (green)
  // "new" = filed into a new bin association after override (orange)
  // "warn" = wrong bin scanned; awaiting a second scan to confirm (orange)
  status: "ok" | "new" | "warn" | "err" | "busy";
  message: string;
  undo?: UndoMeta;
  undone?: boolean;
}

interface Props {
  onClose?: () => void;
  initialCode?: string;
  embedded?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// "Currently in" string for a resolved lot. Prefers real bin names; falls
// back to the lot's actual rtf bin tag (could be any rtf number, not just 0).
function lotLocationStr(lot: ResolvedLot): string {
  if (lot.locations.length > 0) {
    return lot.locations.map(l => l.binName ?? "?").join(", ");
  }
  return `rtf ${lot.rtfBin ?? "0"}`;
}

// Why a bin was suggested — how closely the sibling lot matched.
function suggestMatchLabel(level: number): string {
  if (level === 1) return "same part, colour & condition";
  if (level === 2) return "same part & condition";
  return "same part";
}

function suggestBinLabel(s: NonNullable<ResolvedLot["suggestedBin"]>): string {
  return [s.aisleName, s.shelfName, s.name].filter(Boolean).join(" › ");
}

// The bin(s) a lot is "expected" to go in: its current home(s) if already
// filed, otherwise the suggested bin. Empty = no expectation, so any bin is
// accepted as a correct first-time filing.
function expectedBinIds(lot: ResolvedLot): number[] {
  if (lot.locations.length > 0) return lot.locations.map(l => l.binId);
  if (lot.suggestedBin) return [lot.suggestedBin.id];
  return [];
}

// Human-readable description of where a lot is expected to go.
function expectedBinLabel(lot: ResolvedLot): string {
  if (lot.locations.length > 0) return lot.locations.map(l => l.binName ?? "?").join(", ");
  if (lot.suggestedBin) return suggestBinLabel(lot.suggestedBin);
  return "a bin";
}

const UNDO_WINDOW_MS = 60_000;

// ── Component ────────────────────────────────────────────────────────────────

export function WarehouseScanPanel({ onClose, initialCode, embedded = false }: Props) {
  const { toast } = useToast();
  const tz = useOrgTimezone();
  const { setActive } = useScanSession();
  const [activeBin, setActiveBin] = useState<ResolvedBin | null>(null);
  const [activeLot, setActiveLot] = useState<ResolvedLot | null>(null);
  // A "wrong" bin scanned for the active lot, awaiting a confirming second scan
  // to override the expected bin and file into this new one instead.
  const [pendingBin, setPendingBin] = useState<ResolvedBin | null>(null);
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

  // Suppress global hardware-scanner BIN/LOT modal while this session is mounted.
  useEffect(() => {
    setActive(true);
    return () => setActive(false);
  }, [setActive]);

  useEffect(() => {
    setCameraSupported("BarcodeDetector" in window);
  }, []);

  useEffect(() => {
    if (!cameraOpen) inputRef.current?.focus();
  }, [cameraOpen]);

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
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
    },
  });

  const unassignMutation = useMutation({
    mutationFn: (body: { locationId: number; restoreRtfBin: string | null }) =>
      apiRequest("POST", "/api/warehouse/scan/unassign", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/bins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
    },
  });

  // ── Core scan logic ────────────────────────────────────────────────────────

  const addFeed = useCallback((entry: Omit<FeedEntry, "id" | "ts">) => {
    const id = `${Date.now()}-${Math.random()}`;
    setFeed(prev => [
      { id, ts: new Date(), ...entry },
      ...prev.slice(0, 29),
    ]);
    return id;
  }, []);

  // Update an existing feed entry in place (e.g. turn a "Resolving…" busy entry
  // into its final ok/new/warn/err result instead of leaving a stuck spinner).
  const updateFeed = useCallback((id: string, patch: Partial<FeedEntry>) => {
    setFeed(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const processCode = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code || processingRef.current) return;
    processingRef.current = true;

    const feedId = addFeed({ code, status: "busy", message: "Resolving…" });

    let resolved: Resolved;
    try {
      const res = await fetch(`/api/warehouse/scan/resolve?code=${encodeURIComponent(code)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        updateFeed(feedId, { status: "err", message: err.error ?? "Not found" });
        processingRef.current = false;
        return;
      }
      resolved = await res.json();
    } catch {
      updateFeed(feedId, { status: "err", message: "Network error" });
      processingRef.current = false;
      return;
    }

    // File a lot into a bin and resolve the busy feed entry to its result.
    // tone "ok" = correct/expected bin (green); "new" = override bin (orange).
    const fileLot = async (
      lot: ResolvedLot,
      bin: ResolvedBin,
      tone: "ok" | "new",
    ): Promise<boolean> => {
      const priorRtf = lot.rtfBin;
      const priorLoc = lotLocationStr(lot);
      try {
        const result: any = await assignMutation.mutateAsync({ inventoryId: lot.id, binId: bin.id });
        const undoMeta: UndoMeta | undefined = result?.id
          ? { locationId: result.id, restoreRtfBin: priorRtf }
          : undefined;
        updateFeed(feedId, {
          status: tone,
          message: `${lotLabel(lot)} — ${priorLoc} → ${binFullLabel(bin)}`,
          undo: undoMeta,
        });
        return true;
      } catch {
        updateFeed(feedId, { status: "err", message: "Assignment failed" });
        return false;
      }
    };

    // Workflow is auto-detected from what is already active:
    //  • an active lot present → lot-first (scan a bin to file that lot)
    //  • an active bin present → bin-first (scan lots to file into that bin)
    //  • nothing active → the first scan sets the active context.

    // ── BIN scanned ──────────────────────────────────────────────────────────
    if (resolved.type === "bin") {
      if (activeLot) {
        // Lot-first: file the active lot into this bin.
        const expected = expectedBinIds(activeLot);
        const isExpected = expected.length === 0 || expected.includes(resolved.id);
        if (isExpected) {
          // Correct bin (or no expectation) — file straight away, even if a
          // wrong bin was pending from a prior scan.
          setPendingBin(null);
          if (await fileLot(activeLot, resolved, "ok")) setActiveLot(null);
        } else if (pendingBin && pendingBin.id === resolved.id) {
          // Second consecutive scan of the same wrong bin → confirm override.
          setPendingBin(null);
          if (await fileLot(activeLot, resolved, "new")) setActiveLot(null);
        } else {
          // First scan of a wrong bin → warn and wait for a confirming rescan.
          setPendingBin(resolved);
          updateFeed(feedId, {
            status: "warn",
            message: `Wrong bin — ${lotLabel(activeLot)} expected in ${expectedBinLabel(activeLot)}. Scan ${binFullLabel(resolved)} again to file it here, or scan the correct bin.`,
          });
        }
      } else {
        // Bin-first (or switching the active bin): set this bin active.
        // Keep contexts mutually exclusive — a bin and a lot are never both active.
        setActiveLot(null);
        setPendingBin(null);
        setActiveBin(resolved);
        updateFeed(feedId, { status: "ok", message: `Active bin: ${binFullLabel(resolved)} (${resolved.itemCount} lots)` });
      }
    }

    // ── LOT scanned ──────────────────────────────────────────────────────────
    if (resolved.type === "lot") {
      if (activeBin) {
        // Bin-first: file this lot into the active bin.
        const expected = expectedBinIds(resolved);
        const tone: "ok" | "new" =
          expected.length === 0 || expected.includes(activeBin.id) ? "ok" : "new";
        await fileLot(resolved, activeBin, tone);
      } else {
        // Lot-first (or switching the active lot): set this lot active.
        if (activeLot && activeLot.id !== resolved.id) {
          addFeed({ code, status: "err", message: `Discarded prior lot ${lotLabel(activeLot)} — scan its bin first to file it` });
        }
        // Keep contexts mutually exclusive and clear any pending wrong-bin confirmation.
        setActiveBin(null);
        setPendingBin(null);
        setActiveLot(resolved);
        updateFeed(feedId, { status: "ok", message: `${lotLabel(resolved)} — currently: ${lotLocationStr(resolved)}` });
      }
    }

    processingRef.current = false;
  }, [activeBin, activeLot, pendingBin, addFeed, updateFeed, assignMutation]);

  const undoEntry = useCallback(async (entryId: string) => {
    setFeed(prev => prev.map(e => e.id === entryId && e.undo
      ? { ...e, undone: true }
      : e));
    const entry = feed.find(e => e.id === entryId);
    if (!entry?.undo) return;
    try {
      await unassignMutation.mutateAsync({
        locationId: entry.undo.locationId,
        restoreRtfBin: entry.undo.restoreRtfBin,
      });
    } catch {
      toast({ title: "Undo failed", variant: "destructive" });
      setFeed(prev => prev.map(e => e.id === entryId ? { ...e, undone: false } : e));
    }
  }, [feed, unassignMutation, toast]);

  // Auto-process a code passed in on mount (from global scanner). The workflow
  // is auto-detected from whether a bin or lot is scanned first.
  useEffect(() => {
    if (initialCode) {
      processCode(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ── Render ────────────────────────────────────────────────────────────────

  const containerClass = embedded
    ? "rounded-md border border-border bg-card flex flex-col"
    : "fixed inset-0 z-50 bg-background flex flex-col";

  return (
    <div className={containerClass} data-testid="scan-panel">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <ScanLine className="h-5 w-5 text-yellow-400 shrink-0" />
        <span className="font-semibold text-sm flex-1">Scan to file</span>
        {!embedded && onClose && (
          <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-scan-close">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <p className="px-4 pt-3 text-[11px] text-muted-foreground mb-3 shrink-0">
        Scan a bin first to file lots into it, or scan a lot first to choose its bin — the workflow is detected automatically.
      </p>

      {/* Active context card — shows whichever context the scans established */}
      <div className="px-4 mb-3 shrink-0">
        {activeBin ? (
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/8 p-3 flex items-center gap-3" data-testid="card-active-bin">
            <Archive className="h-5 w-5 shrink-0 text-yellow-400" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-none">{binFullLabel(activeBin)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{activeBin.itemCount} lots currently in bin — scan lots to file them here</p>
            </div>
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => setActiveBin(null)} data-testid="button-clear-active-bin">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : activeLot ? (
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/8 p-3 flex items-center gap-3" data-testid="card-active-lot">
            <Package className="h-5 w-5 shrink-0 text-yellow-400" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-none truncate">{lotLabel(activeLot)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{lotSub(activeLot)}</p>
              <p className="text-[11px] text-muted-foreground">
                Currently in: {lotLocationStr(activeLot)}
              </p>
              {activeLot.locations.length === 0 && activeLot.suggestedBin && (
                <p className="text-[11px] text-emerald-400 mt-0.5" data-testid="text-suggested-bin">
                  Suggested bin:{" "}
                  <span className="font-semibold">{suggestBinLabel(activeLot.suggestedBin)}</span>{" "}
                  <span className="text-emerald-400/60">
                    ({suggestMatchLabel(activeLot.suggestedBin.matchLevel)} — scan a bin to confirm or override)
                  </span>
                </p>
              )}
            </div>
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => { setActiveLot(null); setPendingBin(null); }} data-testid="button-clear-active-lot">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border p-3 flex items-center gap-3" data-testid="card-active-empty">
            <ScanLine className="h-5 w-5 shrink-0 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Scan a bin or a lot to begin</p>
          </div>
        )}
      </div>

      {/* Wrong-bin warning: require a confirming rescan to override */}
      {activeLot && pendingBin && (
        <div className="px-4 mb-3 shrink-0">
          <div className="rounded-md border border-orange-500/40 bg-orange-500/10 p-3 flex items-start gap-2.5" data-testid="warning-wrong-bin">
            <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-xs">
              <p className="font-semibold text-orange-500">Wrong bin</p>
              <p className="text-muted-foreground mt-0.5">
                {lotLabel(activeLot)} is expected in{" "}
                <span className="font-semibold">{expectedBinLabel(activeLot)}</span>. Scan{" "}
                <span className="font-semibold">{binFullLabel(pendingBin)}</span> again to file it here anyway, or scan the correct bin.
              </p>
            </div>
          </div>
        </div>
      )}

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
                  QR scanning with your phone camera requires Chrome or Edge. Open this page in Chrome on your phone, or use a Bluetooth/USB barcode scanner and codes will appear in the field above.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Feed */}
      <div className={`${embedded ? "max-h-80" : "flex-1"} overflow-y-auto px-4 pb-4 space-y-1.5`}>
        {feed.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground/50 text-sm gap-2">
            <ScanLine className="h-8 w-8" />
            <span>Scan history will appear here</span>
          </div>
        )}
        {feed.map(entry => {
          const undoExpired = entry.undo && (Date.now() - entry.ts.getTime() > UNDO_WINDOW_MS);
          const showUndo = entry.undo && !entry.undone && !undoExpired;
          return (
            <div
              key={entry.id}
              data-testid={`feed-entry-${entry.id}`}
              className={`flex items-start gap-2.5 rounded-md px-3 py-2 text-sm border
                ${entry.undone ? "border-border/40 bg-muted/10 opacity-60" :
                  entry.status === "ok" ? "border-green-500/20 bg-green-500/5" :
                  entry.status === "new" ? "border-orange-500/30 bg-orange-500/10" :
                  entry.status === "warn" ? "border-orange-500/40 bg-orange-500/10" :
                  entry.status === "err" ? "border-destructive/20 bg-destructive/5" :
                  "border-border/60 bg-muted/20"}`}
            >
              {entry.status === "ok" && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />}
              {entry.status === "new" && <CheckCircle2 className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />}
              {entry.status === "warn" && <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />}
              {entry.status === "err" && <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />}
              {entry.status === "busy" && <Loader2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5 animate-spin" />}
              <div className="flex-1 min-w-0">
                <p className="font-mono text-[11px] text-muted-foreground truncate">{entry.code}</p>
                <p className={`text-xs ${entry.status === "err" ? "text-destructive" : ""} ${entry.undone ? "line-through" : ""}`}>
                  {entry.message}
                </p>
                {entry.undone && <p className="text-[11px] text-muted-foreground italic">Undone</p>}
              </div>
              {showUndo && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs gap-1 shrink-0"
                  onClick={() => undoEntry(entry.id)}
                  data-testid={`button-undo-${entry.id}`}
                >
                  <Undo2 className="h-3 w-3" />Undo
                </Button>
              )}
              <span className="text-[10px] text-muted-foreground/50 shrink-0 mt-0.5">
                {formatTime(entry.ts, tz, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

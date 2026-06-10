import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  X, Camera, CameraOff, ScanLine, Package, Archive,
  CheckCircle2, AlertCircle, AlertTriangle, Loader2, RotateCcw, Undo2, Layers,
  Volume2, VolumeX,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import { formatTime } from "@/lib/utils";
import { playTone, speak, unlockAudio, type ScanTone } from "@/lib/scan-audio";
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

function suggestBinLabel(s: NonNullable<ResolvedLot["suggestedBin"]>): string {
  return [s.aisleName, s.shelfName, s.name].filter(Boolean).join(" › ");
}

// Strip the visual "›" separators so a location reads naturally when spoken.
function toSpeech(label: string): string {
  return label.replace(/›/g, ",").replace(/\s+/g, " ").trim();
}

// Spoken instruction for where a freshly-scanned lot should be filed — the
// hands-free equivalent of the on-screen consolidate banner.
function lotFileGuidanceSpeech(lot: ResolvedLot): string {
  if (lot.locations.length > 0) {
    return `Consolidate. Already in ${toSpeech(expectedBinLabel(lot))}.`;
  }
  if (lot.suggestedBin) {
    const where = toSpeech(suggestBinLabel(lot.suggestedBin));
    return lot.suggestedBin.matchLevel <= 2
      ? `Consolidate into ${where}.`
      : `File alongside in ${where}.`;
  }
  return "No suggested bin. Pick any bin.";
}

// Returns the individual aisle/shelf/bin name parts for the hero board so they
// can be displayed at different sizes (bin biggest, context smaller).
function heroBin(lot: ResolvedLot): { aisle: string | null; shelf: string | null; bin: string } | null {
  if (lot.locations.length > 0) {
    const l = lot.locations[0];
    return { aisle: l.aisleName, shelf: l.shelfName, bin: l.binName ?? "?" };
  }
  if (lot.suggestedBin) {
    const s = lot.suggestedBin;
    return { aisle: s.aisleName, shelf: s.shelfName, bin: s.name };
  }
  return null;
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
  // Last code accepted from the camera; reset when the code leaves view so the
  // same QR isn't processed every frame (which would spam the feed and audio).
  const lastCameraCodeRef = useRef<string | null>(null);
  const processingRef = useRef(false);
  // Audio cues for hands-free filing; persisted so a filer's preference sticks.
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("scanSoundOn") !== "0";
  });
  const soundOnRef = useRef(soundOn);
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);

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

  // Play a tone (and optionally speak) for a scan outcome, when sound is on.
  const cue = useCallback((kind: ScanTone, speech?: string) => {
    if (!soundOnRef.current) return;
    playTone(kind);
    if (speech) speak(speech);
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
        cue("err", "Not found.");
        updateFeed(feedId, { status: "err", message: err.error ?? "Not found" });
        processingRef.current = false;
        return;
      }
      resolved = await res.json();
    } catch {
      cue("err", "Network error.");
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
        cue(tone, tone === "new" ? "Filed. Override." : "Filed.");
        return true;
      } catch {
        cue("err", "Assignment failed.");
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
          cue("warn", "Wrong bin. Scan again to confirm, or scan the correct bin.");
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
        cue("ok", `${toSpeech(binFullLabel(resolved))}. ${resolved.itemCount} lots. Scan lots to file here.`);
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
        cue("ok", lotFileGuidanceSpeech(resolved));
        updateFeed(feedId, { status: "ok", message: `${lotLabel(resolved)} — currently: ${lotLocationStr(resolved)}` });
      }
    }

    processingRef.current = false;
  }, [activeBin, activeLot, pendingBin, addFeed, updateFeed, assignMutation, cue]);

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
    lastCameraCodeRef.current = null;
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
    unlockAudio();
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
            // Only act on a code that wasn't the last one accepted; the user
            // must move the camera away (no code in view) before the same code
            // is read again. Prevents repeated feed entries and audio spam.
            if (value !== lastCameraCodeRef.current) {
              lastCameraCodeRef.current = value;
              await processCode(value);
            }
          } else {
            lastCameraCodeRef.current = null;
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
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            unlockAudio();
            const nv = !soundOn;
            setSoundOn(nv);
            try { localStorage.setItem("scanSoundOn", nv ? "1" : "0"); } catch {}
            if (nv) playTone("ok");
          }}
          aria-pressed={soundOn}
          title={soundOn ? "Mute scan sounds" : "Unmute scan sounds"}
          aria-label={soundOn ? "Mute scan sounds" : "Unmute scan sounds"}
          data-testid="button-toggle-scan-sound"
        >
          {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </Button>
        {!embedded && onClose && (
          <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-scan-close">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Distance-readable status board — full-screen only. The filer stands
          at the end of the aisle; this panel is readable from several feet
          away without squinting. High-contrast colour + large type = the
          visual half of voice-directed putaway. */}
      {!embedded && (() => {
        const isWrong = !!(activeLot && pendingBin);
        const isLot   = !isWrong && !!activeLot;
        const isBin   = !isWrong && !isLot && !!activeBin;
        const last    = !isWrong && !isLot && !isBin ? feed[0] : undefined;
        const isOk    = last?.status === "ok";
        const isNew   = last?.status === "new";
        const isErr   = last?.status === "err";
        const isBusy  = last?.status === "busy";
        const isIdle  = !isWrong && !isLot && !isBin && !isOk && !isNew && !isErr && !isBusy;

        const bg =
          isWrong ? "bg-amber-600"
          : isLot ? "bg-blue-900 dark:bg-blue-950"
          : isBin ? "bg-yellow-700 dark:bg-yellow-800"
          : isOk  ? "bg-green-700 dark:bg-green-800"
          : isNew ? "bg-orange-600 dark:bg-orange-700"
          : isErr ? "bg-red-700 dark:bg-red-800"
          : "bg-muted";

        return (
          <div
            className={`${bg} shrink-0 flex flex-col items-center justify-center min-h-52 px-6 py-5 text-center gap-1 transition-colors duration-300`}
            data-testid="hero-status-board"
          >
            {isLot && activeLot && (() => {
              const dest = heroBin(activeLot);
              const consolidate =
                activeLot.locations.length > 0 ? "consolidate"
                : activeLot.suggestedBin != null
                  ? activeLot.suggestedBin.matchLevel <= 2 ? "consolidate" : "file alongside"
                  : null;
              return (
                <>
                  <p className="text-xs font-semibold uppercase tracking-widest text-white/60 mb-1">Go to</p>
                  {dest ? (
                    <>
                      <p className="text-8xl font-black leading-none text-white">{dest.bin}</p>
                      <p className="text-xl font-medium text-white/70 mt-2">
                        {[dest.shelf, dest.aisle].filter(Boolean).join(" · ")}
                      </p>
                    </>
                  ) : (
                    <p className="text-5xl font-black text-white">Any bin</p>
                  )}
                  {consolidate && (
                    <div className="mt-3 px-4 py-1.5 rounded-full bg-white/20">
                      <p className="text-sm font-bold text-white tracking-wide uppercase">
                        {consolidate === "consolidate" ? "Consolidate" : "File alongside"}
                      </p>
                    </div>
                  )}
                </>
              );
            })()}

            {isWrong && activeLot && pendingBin && (
              <>
                <AlertTriangle className="h-10 w-10 text-white mb-1" />
                <p className="text-5xl font-black text-white leading-none">Wrong bin</p>
                <p className="text-xl text-white/80 mt-2">Expected: {expectedBinLabel(activeLot)}</p>
                <p className="text-sm text-white/60 mt-1">Scan {binFullLabel(pendingBin)} again to override</p>
              </>
            )}

            {isBin && activeBin && (
              <>
                <p className="text-xs font-semibold uppercase tracking-widest text-white/60 mb-1">Active bin</p>
                <p className="text-8xl font-black text-white leading-none">{activeBin.name}</p>
                <p className="text-xl font-medium text-white/70 mt-2">
                  {[activeBin.shelfName, activeBin.aisleName].filter(Boolean).join(" · ")}
                </p>
                <p className="text-sm text-white/60 mt-1">Scan lots to file here</p>
              </>
            )}

            {isOk && (
              <>
                <CheckCircle2 className="h-14 w-14 text-white mb-1" />
                <p className="text-6xl font-black text-white leading-none">Filed</p>
              </>
            )}

            {isNew && (
              <>
                <CheckCircle2 className="h-12 w-12 text-white mb-1" />
                <p className="text-5xl font-black text-white leading-none">Filed</p>
                <p className="text-xl text-white/80 mt-2">Override</p>
              </>
            )}

            {isErr && (
              <>
                <AlertCircle className="h-10 w-10 text-white mb-1" />
                <p className="text-4xl font-black text-white leading-none">Error</p>
                <p className="text-sm text-white/60 mt-2">{last?.message}</p>
              </>
            )}

            {isBusy && (
              <>
                <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
                <p className="text-lg text-muted-foreground mt-2">Resolving…</p>
              </>
            )}

            {isIdle && (
              <>
                <ScanLine className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-xl text-muted-foreground mt-2">Scan a lot or bin to begin</p>
              </>
            )}
          </div>
        );
      })()}

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

      {/* Consolidate alert: this part already has stock filed — tell the filer
          to combine into the existing baggie (same condition) or at least
          file it alongside (part-only match, condition may differ). Same-
          condition is required to share a baggie — new and used never mix. */}
      {activeLot && (activeLot.locations.length > 0 || activeLot.suggestedBin) && (() => {
        // "Combine" = safe to share a baggie: the exact same lot (restock) or a
        // sibling with the same condition (level 1/2). A part-only match (level 3)
        // may be a different condition, so we only co-locate, never merge bags.
        const canCombine =
          activeLot.locations.length > 0 ||
          (activeLot.suggestedBin != null && activeLot.suggestedBin.matchLevel <= 2);
        return (
          <div className="px-4 mb-3 shrink-0">
            <div className="rounded-md border border-blue-500/40 bg-blue-500/10 p-3 flex items-start gap-2.5" data-testid="alert-consolidate">
              <Layers className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 text-xs">
                <p className="font-semibold text-blue-400">
                  {canCombine ? "Consolidate — don't start a second baggie" : "File alongside — same part already here"}
                </p>
                {activeLot.locations.length > 0 ? (
                  <p className="text-muted-foreground mt-0.5">
                    This exact lot is already filed in{" "}
                    <span className="font-semibold">{expectedBinLabel(activeLot)}</span>. Open that
                    baggie and combine the new pieces into it.
                  </p>
                ) : activeLot.suggestedBin ? (
                  <p className="text-muted-foreground mt-0.5">
                    {activeLot.suggestedBin.matchLevel === 1 ? (
                      <>
                        The same part, colour &amp; condition already lives in{" "}
                        <span className="font-semibold">{suggestBinLabel(activeLot.suggestedBin)}</span>.
                        File it there and combine into the existing baggie.
                      </>
                    ) : activeLot.suggestedBin.matchLevel === 2 ? (
                      <>
                        The same part &amp; condition (different colour) already lives in{" "}
                        <span className="font-semibold">{suggestBinLabel(activeLot.suggestedBin)}</span>.
                        File it there and combine into that baggie — same condition can share a baggie.
                      </>
                    ) : (
                      <>
                        The same part (different colour/condition) already lives in{" "}
                        <span className="font-semibold">{suggestBinLabel(activeLot.suggestedBin)}</span>.
                        File it in that bin to keep it together, but keep new and used in separate baggies.
                      </>
                    )}{" "}
                    Scan that bin to confirm, or another to override.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        );
      })()}

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

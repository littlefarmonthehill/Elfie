import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  X, Camera, CameraOff, ScanLine, Package, Archive,
  CheckCircle2, AlertCircle, AlertTriangle, Loader2, RotateCcw, Undo2, Layers,
  Volume2, VolumeX, Gauge,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import { formatTime } from "@/lib/utils";
import { playTone, speak, speakBin, unlockAudio, type ScanTone } from "@/lib/scan-audio";
import { useScanSession } from "@/contexts/ScanSessionContext";
import { useHardwareScanner } from "@/hooks/use-hardware-scanner";

// ── Types ───────────────────────────────────────────────────────────────────

// Capacity values: null = unknown (bin has lots but user hasn't set it),
// 0/25/50/75/100 = percentage full. Empty bins are always 0% regardless.
type BinCapacity = 0 | 25 | 50 | 75 | 100 | null;

const CAPACITY_STEPS: Array<0 | 25 | 50 | 75 | 100> = [0, 25, 50, 75, 100];

function capacityLabel(capacity: BinCapacity, itemCount: number): string {
  if (itemCount === 0) return "0%";
  if (capacity === null) return "?";
  return `${capacity}%`;
}

function capacityColor(capacity: BinCapacity, itemCount: number): string {
  if (itemCount === 0) return "text-green-400";
  if (capacity === null) return "text-muted-foreground";
  if (capacity === 0) return "text-green-400";
  if (capacity <= 25) return "text-green-400";
  if (capacity <= 50) return "text-yellow-400";
  if (capacity <= 75) return "text-orange-400";
  return "text-red-400";
}

function capacitySpeech(capacity: BinCapacity, itemCount: number): string {
  if (itemCount === 0) return "zero percent full";
  if (capacity === null) return "capacity unknown";
  return `${capacity} percent full`;
}

interface ResolvedBin {
  type: "bin";
  id: number;
  name: string;
  shelfName: string | null;
  aisleName: string | null;
  capacity: BinCapacity;
  itemCount: number;
}

type SuggestedBin = {
  id: number;
  name: string;
  shelfName: string | null;
  aisleName: string | null;
  matchLevel: number; // 1=exact+color+cond, 2=exact+cond, 3=exact part, 4=family+cond, 5=family, 6=adjacent+cond, 7=adjacent
  capacity: number | null;
};

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
  // First (best) suggestion — backward compat.
  suggestedBin?: SuggestedBin | null;
  // All candidates for a never-filed lot, sorted best-first (up to 5).
  suggestedBins?: SuggestedBin[];
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

// For speech: if the bin name already encodes the aisle and shelf (e.g. "A2-3"
// contains "A" and "A2"), skip the redundant prefix and just say the bin name.
function binSpeechLabel(bin: ResolvedBin): string {
  const n = bin.name.toLowerCase();
  const hasAisle = !bin.aisleName || n.includes(bin.aisleName.toLowerCase());
  const hasShelf = !bin.shelfName || n.includes(bin.shelfName.toLowerCase());
  if (hasAisle && hasShelf) return bin.name;
  return [bin.aisleName, bin.shelfName, bin.name].filter(Boolean).join(", ");
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
    if (lot.suggestedBin.matchLevel <= 2) return `Consolidate into ${where}.`;
    if (lot.suggestedBin.matchLevel === 3) return `File alongside in ${where}.`;
    return `New stock. Similar parts in ${where}.`;
  }
  return "New stock. No suggestions. Scan any bin.";
}

// Split the lot guidance into an intro phrase (normal rate) and a bin name
// (very slow) so the bin address is spoken deliberately with speakBin().
// Returns {text} when there is no bin to call out (fallback to plain speak).
function lotGuidanceParts(lot: ResolvedLot):
  | { intro: string; bin: string }
  | { text: string } {
  const dest = heroBin(lot);
  if (!dest) return { text: "New stock. No suggestions. Scan any bin." };
  if (lot.locations.length > 0) return { intro: "Consolidate.", bin: dest.bin };
  if (lot.suggestedBin) {
    const verb =
      lot.suggestedBin.matchLevel <= 2 ? "Consolidate." :
      lot.suggestedBin.matchLevel === 3 ? "File alongside." :
      "New stock, nearby family.";
    return { intro: verb, bin: dest.bin };
  }
  return { text: "New stock. No suggestions. Scan any bin." };
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
  // Two-step confirmation for RTF0 lots (first-time bin assignment).
  const [pendingConfirm, setPendingConfirm] = useState<{
    lot: ResolvedLot;
    bin: ResolvedBin;
    isSuggested: boolean; // false = override bin (not in suggestions)
  } | null>(null);
  const pendingConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [justFiledBin, setJustFiledBin] = useState<ResolvedBin | null>(null);
  const justFiledTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scanMode, setScanMode] = useState<"lot-first" | "bin-first">(() => {
    try {
      const v = localStorage.getItem("wh.scanMode");
      return v === "bin-first" ? "bin-first" : "lot-first";
    } catch { return "lot-first"; }
  });
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [inputVal, setInputVal] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraSupported, setCameraSupported] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  // Set to true by the useHardwareScanner window-level hook when it claims a
  // scan so the text-input's handleKeyDown doesn't double-process the same
  // Enter keystroke that the hook already forwarded to processCode.
  const hwScanHandledRef = useRef(false);
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

  // Clear pending confirmation and just-filed timers on unmount.
  useEffect(() => {
    return () => {
      if (pendingConfirmTimerRef.current) clearTimeout(pendingConfirmTimerRef.current);
      if (justFiledTimerRef.current) clearTimeout(justFiledTimerRef.current);
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

  const capacityMutation = useMutation({
    mutationFn: ({ binId, capacity }: { binId: number; capacity: BinCapacity }) =>
      apiRequest("PATCH", `/api/warehouse/bins/${binId}/capacity`, { capacity }),
    onSuccess: (_data, { capacity }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/bins"] });
      // Update activeBin in-place so the UI reflects the new capacity immediately.
      setActiveBin(prev => prev ? { ...prev, capacity } : null);
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

  // File a RTF0 lot directly into a suggested bin without requiring a bin scan.
  // The user chose the bin consciously by tapping its card, so we skip the
  // two-step confirmation and assign immediately.
  const tapFileLot = useCallback(async (s: SuggestedBin) => {
    if (!activeLot || activeLot.locations.length > 0) return;
    const feedId = addFeed({ code: `TAP:BIN:${s.name}`, status: "busy", message: `Filing into ${s.name}…` });
    const priorRtf = activeLot.rtfBin;
    const priorLoc = lotLocationStr(activeLot);
    const binLabel = [s.aisleName, s.shelfName, s.name].filter(Boolean).join(" › ");
    try {
      const result: any = await assignMutation.mutateAsync({ inventoryId: activeLot.id, binId: s.id });
      const undoMeta: UndoMeta | undefined = result?.id
        ? { locationId: result.id, restoreRtfBin: priorRtf }
        : undefined;
      updateFeed(feedId, {
        status: "ok",
        message: `${lotLabel(activeLot)} — ${priorLoc} → ${binLabel}`,
        undo: undoMeta,
      });
      cue("ok", `Filed into ${s.name}.`);
      setActiveLot(null);
      // Show capacity picker for the just-filed bin (same as lot-first flow).
      const filedBin: ResolvedBin = {
        type: "bin", id: s.id, name: s.name,
        shelfName: s.shelfName, aisleName: s.aisleName,
        capacity: s.capacity as BinCapacity, itemCount: 1,
      };
      if (justFiledTimerRef.current) clearTimeout(justFiledTimerRef.current);
      setJustFiledBin(filedBin);
      justFiledTimerRef.current = setTimeout(() => setJustFiledBin(null), 30_000);
    } catch {
      cue("err", "Assignment failed.");
      updateFeed(feedId, { status: "err", message: "Assignment failed" });
    }
  }, [activeLot, assignMutation, addFeed, updateFeed, cue]);

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

    // ── PENDING RTF0 CONFIRMATION ─────────────────────────────────────────────
    // A bin was proposed for an RTF0 lot. Waiting for the same bin to be
    // scanned again to lock in the assignment, or a different bin to switch
    // the target. Scanning a lot cancels pending and activates that lot.
    if (pendingConfirm) {
      if (resolved.type === "bin") {
        if (resolved.id === pendingConfirm.bin.id) {
          // Confirmed — file the lot now.
          if (pendingConfirmTimerRef.current) clearTimeout(pendingConfirmTimerRef.current);
          const prev = pendingConfirm;
          setPendingConfirm(null);
          if (await fileLot(prev.lot, resolved, prev.isSuggested ? "ok" : "new")) {
            if (justFiledTimerRef.current) clearTimeout(justFiledTimerRef.current);
            setJustFiledBin(resolved);
            justFiledTimerRef.current = setTimeout(() => setJustFiledBin(null), 30_000);
          }
        } else {
          // Different bin — update the target and restart the timer.
          const isSuggested = (pendingConfirm.lot.suggestedBins ?? (pendingConfirm.lot.suggestedBin ? [pendingConfirm.lot.suggestedBin] : []))
            .some(s => s.id === resolved.id);
          if (pendingConfirmTimerRef.current) clearTimeout(pendingConfirmTimerRef.current);
          setPendingConfirm({ lot: pendingConfirm.lot, bin: resolved, isSuggested });
          if (soundOnRef.current) {
            playTone("warn");
            speak(`Changed to ${binSpeechLabel(resolved)}. Scan again to confirm.`);
          }
          updateFeed(feedId, {
            status: "warn",
            message: `Switched target: ${lotLabel(pendingConfirm.lot)} → ${binFullLabel(resolved)}. Scan bin again to confirm.`,
          });
          pendingConfirmTimerRef.current = setTimeout(() => setPendingConfirm(null), 30_000);
        }
      } else {
        // Lot scanned while pending — cancel confirmation, switch to the new lot.
        if (pendingConfirmTimerRef.current) clearTimeout(pendingConfirmTimerRef.current);
        setPendingConfirm(null);
        setActiveBin(null);
        setActiveLot(resolved);
        if (soundOnRef.current) {
          playTone("ok");
          const parts = lotGuidanceParts(resolved);
          if ("bin" in parts) speakBin(parts.bin);
          else speak(parts.text);
        }
        updateFeed(feedId, { status: "ok", message: `${lotLabel(resolved)} — currently: ${lotLocationStr(resolved)}` });
      }
      processingRef.current = false;
      return;
    }

    // ── BIN scanned ──────────────────────────────────────────────────────────
    if (resolved.type === "bin") {
      if (activeLot && activeLot.locations.length === 0) {
        // RTF0 lot (first-time filing): enter two-step confirmation.
        const isSuggested = (activeLot.suggestedBins ?? (activeLot.suggestedBin ? [activeLot.suggestedBin] : []))
          .some(s => s.id === resolved.id);
        if (pendingConfirmTimerRef.current) clearTimeout(pendingConfirmTimerRef.current);
        const lotForConfirm = activeLot;
        setActiveLot(null);
        setPendingConfirm({ lot: lotForConfirm, bin: resolved, isSuggested });
        if (soundOnRef.current) {
          playTone("warn");
          speak(`Confirm ${binSpeechLabel(resolved)}. Scan bin again.`);
        }
        updateFeed(feedId, {
          status: "warn",
          message: `Confirm: ${lotLabel(lotForConfirm)} → ${binFullLabel(resolved)}. Scan the bin again to lock it in.`,
        });
        pendingConfirmTimerRef.current = setTimeout(() => setPendingConfirm(null), 30_000);
      } else if (activeLot) {
        // Lot-first with existing location: file directly.
        const expected = expectedBinIds(activeLot);
        const isExpected = expected.length === 0 || expected.includes(resolved.id);
        if (isExpected) {
          if (await fileLot(activeLot, resolved, "ok")) {
            setActiveLot(null);
            if (justFiledTimerRef.current) clearTimeout(justFiledTimerRef.current);
            setJustFiledBin(resolved);
            justFiledTimerRef.current = setTimeout(() => setJustFiledBin(null), 30_000);
          }
        } else {
          cue("warn", "Wrong bin. Scan next item.");
          updateFeed(feedId, {
            status: "warn",
            message: `Wrong bin — ${lotLabel(activeLot)} expected in ${expectedBinLabel(activeLot)}.`,
          });
          setActiveLot(null);
        }
      } else if (scanMode === "lot-first") {
        cue("err", "Scan a lot first.");
        updateFeed(feedId, { status: "err", message: "Lot-first mode — scan a lot before scanning a bin." });
      } else {
        // Bin-first: set this bin active; clear any just-filed state.
        setActiveLot(null);
        if (justFiledTimerRef.current) clearTimeout(justFiledTimerRef.current);
        setJustFiledBin(null);
        setActiveBin(resolved);
        if (soundOnRef.current) {
          playTone("ok");
          const capStr = capacitySpeech(resolved.capacity, resolved.itemCount);
          speakBin(`${binSpeechLabel(resolved)}, ${capStr}`);
        }
        updateFeed(feedId, {
          status: "ok",
          message: `Active bin: ${binFullLabel(resolved)} · ${resolved.itemCount} lots · ${capacityLabel(resolved.capacity, resolved.itemCount)}`,
        });
      }
    }

    // ── LOT scanned ──────────────────────────────────────────────────────────
    if (resolved.type === "lot") {
      // Scanning a new lot means the user moved on — clear the post-file state.
      if (justFiledTimerRef.current) clearTimeout(justFiledTimerRef.current);
      setJustFiledBin(null);
      if (activeBin) {
        // Bin-first: reject lots already filed in a different bin.
        const alreadyElsewhere =
          resolved.locations.length > 0 &&
          !resolved.locations.some(l => l.binId === activeBin.id);
        if (alreadyElsewhere) {
          cue("err", "Already assigned. Scan a new bin.");
          updateFeed(feedId, {
            status: "err",
            message: `${lotLabel(resolved)} is already filed in ${expectedBinLabel(resolved)} — only unassigned lots can be filed into this bin.`,
          });
          setActiveBin(null);
        } else {
          await fileLot(resolved, activeBin, "ok");
        }
      } else if (scanMode === "bin-first") {
        cue("err", "Scan a bin first.");
        updateFeed(feedId, { status: "err", message: "Bin-first mode — scan a bin before scanning lots." });
      } else {
        // Lot-first: set this lot active.
        if (activeLot && activeLot.id !== resolved.id) {
          addFeed({ code, status: "err", message: `Discarded prior lot ${lotLabel(activeLot)} — scan its bin first to file it` });
        }
        setActiveBin(null);
        setActiveLot(resolved);
        if (soundOnRef.current) {
          playTone("ok");
          const parts = lotGuidanceParts(resolved);
          if ("bin" in parts) speakBin(parts.bin);
          else speak(parts.text);
        }
        updateFeed(feedId, { status: "ok", message: `${lotLabel(resolved)} — currently: ${lotLocationStr(resolved)}` });
      }
    }

    processingRef.current = false;
  }, [activeBin, activeLot, scanMode, pendingConfirm, addFeed, updateFeed, assignMutation, cue]);

  // Catch hardware-scanner keystrokes at the window level so codes are
  // processed even when the text input isn't focused (e.g. user tapped a
  // button, camera is open, or the panel is in embedded mode inside a tab).
  // Mark hwScanHandledRef so the text-input's handleKeyDown skips this scan.
  useHardwareScanner({
    onScan: useCallback((code: string) => {
      hwScanHandledRef.current = true;
      processCode(code);
    }, [processCode]),
  });

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

  // Keep the screen awake while the scan panel is mounted so the device
  // doesn't lock mid-filing. The wake lock is automatically released by the
  // browser when the page goes hidden, so we re-acquire it on visibilitychange.
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;

    const acquire = async () => {
      try {
        lock = await (navigator as any).wakeLock.request("screen");
      } catch {
        // Wake lock not granted (e.g. low battery) — best-effort, ignore.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      lock?.release().catch(() => {});
    };
  }, []);

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
      // The window-level useHardwareScanner hook fires first (capture phase)
      // and sets hwScanHandledRef when it processes a scan. If it already
      // handled this Enter, clear the input and skip so we don't double-fire.
      if (hwScanHandledRef.current) {
        hwScanHandledRef.current = false;
        setInputVal("");
        return;
      }
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

      {/* Mode selector — must be chosen before scanning begins */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
        <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide shrink-0">Mode</span>
        <Button
          size="sm"
          variant="outline"
          className={`flex-1 text-xs h-7 ${scanMode === "lot-first" ? "bg-yellow-500/15 border-yellow-500/40 text-yellow-300" : ""}`}
          onClick={() => { setScanMode("lot-first"); try { localStorage.setItem("wh.scanMode", "lot-first"); } catch {} }}
          disabled={!!activeLot || !!activeBin || !!pendingConfirm}
          data-testid="button-mode-lot-first"
        >
          <Package className="h-3 w-3 mr-1" />Lot first
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={`flex-1 text-xs h-7 ${scanMode === "bin-first" ? "bg-yellow-500/15 border-yellow-500/40 text-yellow-300" : ""}`}
          onClick={() => { setScanMode("bin-first"); try { localStorage.setItem("wh.scanMode", "bin-first"); } catch {} }}
          disabled={!!activeLot || !!activeBin || !!pendingConfirm}
          data-testid="button-mode-bin-first"
        >
          <Archive className="h-3 w-3 mr-1" />Bin first
        </Button>
      </div>

      {/* Distance-readable status board — shown in both full-screen and
          embedded modes so the filer can read bin names from a distance on
          any device, including mobile portrait in the File tab. */}
      {(() => {
        const isLot     = !!activeLot;
        const isBin     = !isLot && !!activeBin;
        const isPending = !isLot && !isBin && !!pendingConfirm;
        const last      = !isLot && !isBin && !isPending ? feed[0] : undefined;
        const isOk   = last?.status === "ok";
        const isNew  = last?.status === "new";
        const isWarn = last?.status === "warn";
        const isErr  = last?.status === "err";
        const isBusy = last?.status === "busy";
        const isJustFiled = !isLot && !isBin && !isPending && !isOk && !isNew && !isWarn && !isErr && !isBusy && !!justFiledBin;
        const isIdle = !isLot && !isBin && !isPending && !isOk && !isNew && !isWarn && !isErr && !isBusy && !justFiledBin;

        const bg =
          isLot       ? "bg-blue-900 dark:bg-blue-950"
          : isBin       ? "bg-yellow-700 dark:bg-yellow-800"
          : isPending   ? "bg-amber-600 dark:bg-amber-700"
          : isJustFiled ? "bg-green-700 dark:bg-green-800"
          : isOk        ? "bg-green-700 dark:bg-green-800"
          : isNew       ? "bg-orange-600 dark:bg-orange-700"
          : isWarn      ? "bg-orange-600 dark:bg-orange-700"
          : isErr       ? "bg-red-700 dark:bg-red-800"
          : "bg-muted";

        return (
          <div
            className={`${bg} shrink-0 relative flex flex-col items-center justify-center min-h-52 px-6 py-5 text-center gap-1 transition-colors duration-300`}
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

            {isBin && activeBin && (
              <>
                <p className="text-xs font-semibold uppercase tracking-widest text-white/60 mb-1">Active bin</p>
                <p className="text-8xl font-black text-white leading-none">{activeBin.name}</p>
                <p className="text-xl font-medium text-white/70 mt-2">
                  {[activeBin.shelfName, activeBin.aisleName].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Gauge className="h-3.5 w-3.5 text-white/50" />
                  <span className={`text-sm font-semibold ${
                    activeBin.itemCount === 0 ? "text-green-300"
                    : activeBin.capacity === null ? "text-white/50"
                    : activeBin.capacity === 0 ? "text-green-300"
                    : activeBin.capacity <= 25 ? "text-green-300"
                    : activeBin.capacity <= 50 ? "text-yellow-300"
                    : activeBin.capacity <= 75 ? "text-orange-300"
                    : "text-red-300"
                  }`}>
                    {capacityLabel(activeBin.capacity, activeBin.itemCount)}
                  </span>
                </div>
                <p className="text-sm text-white/60 mt-1">Scan lots to file here</p>
              </>
            )}

            {isPending && pendingConfirm && (
              <>
                <p className="text-xs font-semibold uppercase tracking-widest text-white/60 mb-2">Confirm bin</p>
                <p className="text-8xl font-black leading-none text-white">{pendingConfirm.bin.name}</p>
                {(pendingConfirm.bin.shelfName || pendingConfirm.bin.aisleName) && (
                  <p className="text-xl font-medium text-white/70 mt-2">
                    {[pendingConfirm.bin.shelfName, pendingConfirm.bin.aisleName].filter(Boolean).join(" · ")}
                  </p>
                )}
                <p className="text-sm text-white/60 mt-3">Scan this bin again to lock in</p>
                {!pendingConfirm.isSuggested && (
                  <p className="text-xs text-amber-200 mt-1">Override — not in suggestions</p>
                )}
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

            {isWarn && (
              <>
                <AlertTriangle className="h-10 w-10 text-white mb-1" />
                <p className="text-5xl font-black text-white leading-none">Wrong bin</p>
                <p className="text-xl text-white/80 mt-2">{last?.message?.replace("Wrong bin — ", "")}</p>
                <p className="text-sm text-white/60 mt-2">Scan next item</p>
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

            {isJustFiled && justFiledBin && (
              <>
                <p className="text-xs font-semibold uppercase tracking-widest text-white/60 mb-1">Filed into</p>
                <p className="text-8xl font-black text-white leading-none">{justFiledBin.name}</p>
                {(justFiledBin.shelfName || justFiledBin.aisleName) && (
                  <p className="text-xl font-medium text-white/70 mt-2">
                    {[justFiledBin.shelfName, justFiledBin.aisleName].filter(Boolean).join(" · ")}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <Gauge className="h-3.5 w-3.5 text-white/50" />
                  <span className={`text-sm font-semibold ${
                    justFiledBin.capacity === null ? "text-white/50"
                    : justFiledBin.capacity === 0 ? "text-green-300"
                    : justFiledBin.capacity <= 25 ? "text-green-300"
                    : justFiledBin.capacity <= 50 ? "text-yellow-300"
                    : justFiledBin.capacity <= 75 ? "text-orange-300"
                    : "text-red-300"
                  }`}>
                    {capacityLabel(justFiledBin.capacity, justFiledBin.itemCount)}
                  </span>
                </div>
                <p className="text-sm text-white/60 mt-1">Scan next lot to continue</p>
              </>
            )}

            {isIdle && (
              <>
                <ScanLine className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-xl text-muted-foreground mt-2">
                  {scanMode === "bin-first" ? "Scan a bin to begin" : "Scan a lot to begin"}
                </p>
              </>
            )}

            {/* Vertical capacity column — right edge of hero, 0% at bottom 100% at top */}
            {(() => {
              const capBin: { id: number; capacity: BinCapacity; itemCount?: number } | null =
                isBin ? activeBin
                : isJustFiled ? justFiledBin
                : isPending ? (pendingConfirm?.bin ?? null)
                : (isLot && activeLot?.suggestedBin)
                  ? { ...activeLot.suggestedBin, capacity: activeLot.suggestedBin.capacity as BinCapacity }
                  : null;
              if (!capBin) return null;
              if (capBin.itemCount === 0) return null;
              const stepColors: Record<number, { idle: string; active: string }> = {
                0:   { idle: "bg-white/10 text-white/40",   active: "bg-white/30 text-white font-bold" },
                25:  { idle: "bg-green-400/20 text-green-300/70", active: "bg-green-400 text-white font-bold" },
                50:  { idle: "bg-yellow-400/20 text-yellow-300/70", active: "bg-yellow-400 text-white font-bold" },
                75:  { idle: "bg-orange-400/20 text-orange-300/70", active: "bg-orange-400 text-white font-bold" },
                100: { idle: "bg-red-500/20 text-red-300/70",   active: "bg-red-500 text-white font-bold" },
              };
              return (
                <div className="absolute right-2 top-0 bottom-0 flex flex-col-reverse py-3 gap-1.5" data-testid="hero-capacity-column">
                  {CAPACITY_STEPS.map(step => {
                    const isSelected = capBin.capacity === step;
                    const c = stepColors[step];
                    return (
                      <button
                        key={step}
                        className={`w-10 flex-1 rounded-md text-[10px] transition-colors ${isSelected ? c.active : c.idle}`}
                        onClick={() => {
                          const newCap = capBin.capacity === step ? null : step as BinCapacity;
                          capacityMutation.mutate({ binId: capBin.id, capacity: newCap });
                          if (activeBin) setActiveBin(prev => prev ? { ...prev, capacity: newCap } : null);
                          else if (pendingConfirm) setPendingConfirm(prev => prev ? { ...prev, bin: { ...prev.bin, capacity: newCap } } : null);
                          else if (justFiledBin) setJustFiledBin(prev => prev ? { ...prev, capacity: newCap } : null);
                          else if (activeLot?.suggestedBin) setActiveLot(prev => prev ? { ...prev, suggestedBin: prev.suggestedBin ? { ...prev.suggestedBin, capacity: newCap } : null } : null);
                          if (soundOnRef.current && newCap !== null) speak(`${newCap} percent`);
                        }}
                        disabled={capacityMutation.isPending}
                        data-testid={`button-hero-capacity-${step}`}
                      >
                        {step}%
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        );
      })()}

      <p className="px-4 pt-3 text-[11px] text-muted-foreground mb-3 shrink-0">
        {scanMode === "bin-first"
          ? "Scan a bin to activate it, then scan unassigned lots to file them into it."
          : "Scan a lot — the system will direct you to its bin. Then scan that bin to file it."}
      </p>

      {/* Active context card — shows whichever context the scans established */}
      <div className="px-4 mb-3 shrink-0">
        {pendingConfirm && !activeBin && !activeLot ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/8 p-3 flex items-center gap-3" data-testid="card-pending-confirm">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-amber-400" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-none truncate">{lotLabel(pendingConfirm.lot)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">→ {binFullLabel(pendingConfirm.bin)}</p>
              <p className="text-[11px] text-amber-400 font-medium mt-0.5">Scan the bin again to confirm</p>
            </div>
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0"
              onClick={() => { if (pendingConfirmTimerRef.current) clearTimeout(pendingConfirmTimerRef.current); setPendingConfirm(null); }}
              data-testid="button-clear-pending-confirm"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : activeBin ? (
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/8 p-3 space-y-2" data-testid="card-active-bin">
            <div className="flex items-center gap-3">
              <Archive className="h-5 w-5 shrink-0 text-yellow-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-none">{binFullLabel(activeBin)}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {activeBin.itemCount} lots · capacity: <span className={`font-medium ${capacityColor(activeBin.capacity, activeBin.itemCount)}`}>{capacityLabel(activeBin.capacity, activeBin.itemCount)}</span>
                </p>
              </div>
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => setActiveBin(null)} data-testid="button-clear-active-bin">
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>
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
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => setActiveLot(null)} data-testid="button-clear-active-lot">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : justFiledBin ? (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3 space-y-2" data-testid="card-just-filed-bin">
            <div className="flex items-center gap-3">
              <Archive className="h-5 w-5 shrink-0 text-green-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-none">{binFullLabel(justFiledBin)}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Just filed · capacity: <span className={`font-medium ${capacityColor(justFiledBin.capacity, justFiledBin.itemCount)}`}>{capacityLabel(justFiledBin.capacity, justFiledBin.itemCount)}</span>
                </p>
              </div>
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => { if (justFiledTimerRef.current) clearTimeout(justFiledTimerRef.current); setJustFiledBin(null); }} data-testid="button-clear-just-filed">
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground/50">Set capacity on the board above · auto-clears in 30 s</p>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border p-3 flex items-center gap-3" data-testid="card-active-empty">
            <ScanLine className="h-5 w-5 shrink-0 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {scanMode === "bin-first" ? "Scan a bin to begin" : "Scan a lot to begin"}
            </p>
          </div>
        )}
      </div>

      {/* RTF0 suggestion panel — top-5 candidate bins for new-stock lots */}
      {activeLot && activeLot.locations.length === 0 && activeLot.suggestedBins && activeLot.suggestedBins.length > 0 && (
        <div className="px-4 mb-3 shrink-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            Suggested bins — tap to file
          </p>
          <div className="space-y-1.5">
            {activeLot.suggestedBins.map((s, i) => {
              const label = [s.aisleName, s.shelfName, s.name].filter(Boolean).join(" › ");
              const desc =
                s.matchLevel === 1 ? "Same part · Consolidate into this baggie"
                : s.matchLevel === 2 ? "Same part & condition · File alongside"
                : s.matchLevel === 3 ? "Same part, different condition — do not mix baggies"
                : s.matchLevel === 4 ? "Decoration variant · File alongside"
                : s.matchLevel === 5 ? "Part family · File alongside"
                : s.matchLevel === 6 ? "Adjacent part number · Same condition"
                : "Adjacent part number · Nearby neighborhood";
              const isWarnLevel = s.matchLevel === 3;
              const isAdjacent = s.matchLevel >= 6;
              // Capacity display
              const capPct = s.capacity;
              const capLabel = capPct === null ? "?" : `${capPct}%`;
              const capColor =
                capPct === null ? "text-muted-foreground bg-muted/40 border-border"
                : capPct === 0   ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                : capPct <= 50   ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                : capPct <= 75   ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
                : "text-red-400 bg-red-500/10 border-red-500/20";
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => tapFileLot(s)}
                  disabled={assignMutation.isPending}
                  className={`w-full text-left rounded-md border px-3 py-2 flex items-center gap-3 transition-colors hover-elevate active-elevate-2 ${
                    isWarnLevel
                      ? "border-orange-500/30 bg-orange-500/5"
                      : isAdjacent
                      ? "border-border bg-muted/20"
                      : "border-border bg-muted/10"
                  }`}
                  data-testid={`suggested-bin-${s.id}`}
                >
                  <Archive className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold leading-none">{label}</p>
                    <p className={`text-[11px] mt-0.5 ${isWarnLevel ? "text-orange-400" : isAdjacent ? "text-muted-foreground/60 italic" : "text-muted-foreground"}`}>
                      {desc}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border tabular-nums ${capColor}`}>
                      {capLabel}
                    </span>
                    {isWarnLevel && <AlertTriangle className="h-4 w-4 text-orange-400" />}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-1.5">Tap a bin to file, or scan any bin to choose your own.</p>
        </div>
      )}

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
                    Scan that bin to file there.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        );
      })()}

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

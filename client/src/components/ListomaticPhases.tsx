import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { X, GripVertical, Layers, SplitSquareHorizontal, Tag, FolderOpen, Info, Puzzle, User, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { createPortal } from "react-dom";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface PhaseCategory {
  id: number;
  name: string;
  sortingPhase: string | null;
}

const PHASES = ['category', 'subcategory', 'finalsort', 'listing'] as const;
type PhaseKey = typeof PHASES[number];

const PHASE_CONFIG: Record<PhaseKey, {
  label: string;
  stepLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  badgeBg: string;
  dot: string;
  partsDetail: string;
  mfDetail: string;
  partsInfo: string[];
  mfInfo: string[];
}> = {
  category: {
    label: "Phase 1 — Category",
    stepLabel: "Category",
    icon: FolderOpen,
    color: "text-amber-300",
    bg: "bg-amber-500/10 border-amber-500/30",
    badgeBg: "bg-amber-500/20 text-amber-200 border-amber-500/40",
    dot: "bg-amber-400",
    partsDetail: "Broad grouping (Misc, Weapons, Accessories)",
    mfDetail: "Broad grouping (Minifigs)",
    partsInfo: [
      "Sort all loose parts into their broadest functional buckets.",
      "Typical groups: Misc, Weapons, Accessories, Structural, Technic, Bricks, Plates, Tiles, etc.",
      "Goal: clear the unsorted pile and create defined starting piles for the next phase.",
      "Don't overthink sub-categories yet — speed matters here.",
    ],
    mfInfo: [
      "Pull all minifigures and minifig components into a single Minifigs bucket.",
      "Separate complete figures from loose torsos, legs, heads, and accessories.",
      "Sub-types to identify: standard figs, Star Wars, Castle, City, licensed themes.",
      "Goal: isolate all human-shaped elements before detailed sorting begins.",
    ],
  },
  subcategory: {
    label: "Phase 2 — Subcategory",
    stepLabel: "Subcategory",
    icon: Layers,
    color: "text-blue-300",
    bg: "bg-blue-500/10 border-blue-500/30",
    badgeBg: "bg-blue-500/20 text-blue-200 border-blue-500/40",
    dot: "bg-blue-400",
    partsDetail: "Cluster within the category",
    mfDetail: "Cluster within the category",
    partsInfo: [
      "Break each broad category pile into tighter sub-groups.",
      "Example: Bricks → 1×1, 1×2, 1×4, 2×2, 2×4, etc.",
      "Example: Technic → Beams, Connectors, Axles, Gears, Panels.",
      "Example: Accessories → Hats, Tools, Weapons, Food, Animals.",
      "Goal: each sub-pile should be small enough to sort by color in the next phase.",
    ],
    mfInfo: [
      "Cluster minifig components by body part and major theme.",
      "Separate: Heads, Torsos, Legs, Hats/Hair, Accessories.",
      "Group torsos by theme cluster (City, Castle, Space, Licensed, etc.).",
      "Goal: create tight sub-groups that allow fast color and deco sorting later.",
    ],
  },
  finalsort: {
    label: "Phase 3 — Final Sort",
    stepLabel: "Final Sort",
    icon: SplitSquareHorizontal,
    color: "text-purple-300",
    bg: "bg-purple-500/10 border-purple-500/30",
    badgeBg: "bg-purple-500/20 text-purple-200 border-purple-500/40",
    dot: "bg-purple-400",
    partsDetail: "Shape Sort",
    mfDetail: "Hue Sort → Final Color Sort",
    partsInfo: [
      "Sort each sub-category pile by shape within that group.",
      "Example: 1×2 Bricks sorted by stud count, then slope angle, then special features.",
      "Decorated or printed parts are pulled out and handled separately.",
      "Goal: each pile now contains one specific shape ready for a color pass.",
    ],
    mfInfo: [
      "Sort each minifig sub-group by hue (warm → cool spectrum).",
      "Hue order: Red → Orange → Yellow → Green → Blue → Purple → Brown → Grey → Black → White.",
      "Within each hue, sort Light → Dark shade.",
      "Goal: produce a hue-ordered pile per body part for the final color precision sort.",
    ],
  },
  listing: {
    label: "Phase 4 — Listing",
    stepLabel: "Listing",
    icon: Tag,
    color: "text-green-300",
    bg: "bg-green-500/10 border-green-500/30",
    badgeBg: "bg-green-500/20 text-green-200 border-green-500/40",
    dot: "bg-green-400",
    partsDetail: "Variation Sort → Final Color Sort",
    mfDetail: "Deco Group → Torso Deco → Variation of Torso → Final MF / Torso Sort",
    partsInfo: [
      "Variation Sort: within each shape-sorted pile, split by part variation (stud type, pin hole, etc.).",
      "Final Color Sort: sort each variation by BrickLink color ID order for consistent listing.",
      "Count and bag each color-variation combo; note quantity for inventory entry.",
      "Flag any damaged, discolored, or non-LEGO parts before bagging.",
      "Goal: each bag = one BrickLink lot, ready to weigh, price, and list.",
    ],
    mfInfo: [
      "Deco Group: separate torsos by decoration type (plain, printed, stickered).",
      "Torso Deco: within printed torsos, cluster by decoration theme (uniform, civilian, licensed).",
      "Variation of Torso: identify arm-color variations of the same torso print.",
      "Final MF / Torso Sort: arrange by BrickLink color order within each variation group.",
      "Count, bag, and photograph each unique torso combo; note condition and completeness.",
      "Goal: each bag = one BrickLink lot with accurate variation metadata ready to list.",
    ],
  },
};

// ── Drag state ────────────────────────────────────────────────────────────────

interface DragState {
  categoryId: number;
  categoryName: string;
  x: number;
  y: number;
}

// Zone registry: each drop zone registers a ref + its phase value
// We use data attributes on the DOM elements to detect which zone the pointer is over
const ZONE_ATTR = "data-lom-zone";

function getZoneFromPoint(x: number, y: number): string | null {
  // Temporarily hide the ghost so elementFromPoint finds the zone underneath
  const ghost = document.getElementById("lom-drag-ghost");
  const prevDisplay = ghost?.style.display ?? "";
  if (ghost) ghost.style.display = "none";

  let zone: string | null = null;
  const el = document.elementFromPoint(x, y);
  if (el) {
    const zoneEl = (el as HTMLElement).closest(`[${ZONE_ATTR}]`);
    if (zoneEl) zone = zoneEl.getAttribute(ZONE_ATTR);
  }

  if (ghost) ghost.style.display = prevDisplay;
  return zone;
}

// ── Main component ────────────────────────────────────────────────────────────

export function ListomaticPhases() {
  const { toast } = useToast();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragOverZone, setDragOverZone] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragOverRef = useRef<string | null>(null);

  const { data, isLoading } = useQuery<{ success: boolean; categories: PhaseCategory[] }>({
    queryKey: ['/api/listomatc/category-phases'],
  });

  const moveMutation = useMutation({
    mutationFn: ({ categoryId, phase }: { categoryId: number; phase: string | null }) =>
      apiRequest('PATCH', '/api/listomatc/category-phase', { categoryId, phase }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/listomatc/category-phases'] });
    },
    onError: () => {
      toast({ title: "Failed to update phase", variant: "destructive" });
    },
  });

  const categories = data?.categories ?? [];
  const unassigned = categories.filter(c => !c.sortingPhase);
  const byPhase = (phase: PhaseKey) => categories.filter(c => c.sortingPhase === phase);

  // Global pointer move/up handlers during a drag
  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragRef.current) return;
    const x = e.clientX;
    const y = e.clientY;
    setDrag(prev => prev ? { ...prev, x, y } : prev);
    dragRef.current = { ...dragRef.current, x, y };

    const zone = getZoneFromPoint(x, y);
    if (zone !== dragOverRef.current) {
      dragOverRef.current = zone;
      setDragOverZone(zone);
    }
  }, []);

  const handlePointerUp = useCallback((e: PointerEvent) => {
    if (!dragRef.current) return;
    const { categoryId } = dragRef.current;
    const zone = getZoneFromPoint(e.clientX, e.clientY);

    const cat = (data?.categories ?? []).find(c => c.id === categoryId);
    const targetPhase = zone === 'unassigned' ? null : (PHASES.includes(zone as PhaseKey) ? zone as PhaseKey : null);

    if (zone && cat) {
      const currentPhase = cat.sortingPhase ?? 'unassigned';
      const targetZone = zone;
      if (currentPhase !== targetZone) {
        moveMutation.mutate({ categoryId, phase: targetPhase });
      }
    }

    dragRef.current = null;
    dragOverRef.current = null;
    setDrag(null);
    setDragOverZone(null);
    document.body.style.userSelect = "";
    document.body.style.touchAction = "";
  }, [data, moveMutation]);

  useEffect(() => {
    if (drag) {
      window.addEventListener("pointermove", handlePointerMove, { passive: true });
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
      return () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
      };
    }
  }, [drag, handlePointerMove, handlePointerUp]);

  // Guarantee body styles are restored if the component unmounts mid-drag
  // (e.g. modal closes while user is dragging on iOS). Without this, touchAction
  // stays "none" on the body permanently, freezing all touch scrolling app-wide.
  useEffect(() => {
    return () => {
      document.body.style.userSelect = "";
      document.body.style.touchAction = "";
    };
  }, []);

  function startDrag(e: React.PointerEvent, cat: PhaseCategory) {
    e.preventDefault();
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.userSelect = "none";
    document.body.style.touchAction = "none";
    const state: DragState = { categoryId: cat.id, categoryName: cat.name, x: e.clientX, y: e.clientY };
    dragRef.current = state;
    setDrag(state);
  }

  function assignPhase(categoryId: number, phase: PhaseKey) {
    moveMutation.mutate({ categoryId, phase });
  }

  function removeFromPhase(categoryId: number) {
    moveMutation.mutate({ categoryId, phase: null });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
        Loading categories...
      </div>
    );
  }

  const isDragging = drag !== null;
  const [unassignedSearch, setUnassignedSearch] = useState("");
  const filteredUnassigned = unassigned.filter(c =>
    !unassignedSearch || c.name.toLowerCase().includes(unassignedSearch.toLowerCase())
  );

  return (
    <div className="space-y-3" style={{ touchAction: isDragging ? "none" : undefined }}>

      {/* Unassigned zone — fixed scrollable window */}
      <div
        {...{ [ZONE_ATTR]: "unassigned" }}
        className={`rounded-lg border transition-all duration-100 ${
          isDragging && dragOverZone === 'unassigned'
            ? 'border-gray-400/70 bg-gray-700/40 ring-1 ring-gray-400/30'
            : 'border-gray-700/50 bg-gray-800/30'
        }`}
        data-testid="phase-unassigned"
      >
        {/* Header row */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700/40">
          <span className="w-2 h-2 rounded-full bg-gray-500 shrink-0" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Not Assigned</span>
          <Badge variant="outline" className="text-[10px] text-gray-500 border-gray-600">
            {unassigned.length}
          </Badge>
          {filteredUnassigned.length !== unassigned.length && (
            <span className="text-[10px] text-gray-600 italic">({filteredUnassigned.length} shown)</span>
          )}
        </div>

        {/* Search bar */}
        <div className="px-3 py-2 border-b border-gray-700/30">
          <div className="flex items-center gap-2 bg-gray-800/60 border border-gray-700/50 rounded px-2 py-1">
            <Search className="w-3 h-3 text-gray-500 shrink-0" />
            <input
              type="text"
              value={unassignedSearch}
              onChange={e => setUnassignedSearch(e.target.value)}
              placeholder="Filter categories…"
              className="bg-transparent text-[11px] text-gray-300 placeholder-gray-600 outline-none flex-1 min-w-0"
              data-testid="input-unassigned-search"
            />
            {unassignedSearch && (
              <button onClick={() => setUnassignedSearch("")} className="text-gray-600 hover:text-gray-400">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable pill window — fixed 200px tall */}
        <div className="p-3 h-[200px] overflow-y-auto overscroll-contain">
          {unassigned.length === 0 ? (
            <p className={`text-[11px] italic ${isDragging && dragOverZone === 'unassigned' ? 'text-gray-300' : 'text-gray-600'}`}>
              {isDragging && dragOverZone === 'unassigned' ? "Release to unassign" : (categories.length === 0 ? "No inventory categories found." : "All categories assigned.")}
            </p>
          ) : filteredUnassigned.length === 0 ? (
            <p className="text-[11px] italic text-gray-600">No categories match "{unassignedSearch}"</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 content-start">
              {filteredUnassigned.map(cat => (
                <UnassignedPill
                  key={cat.id}
                  cat={cat}
                  isDragging={isDragging}
                  isBeingDragged={drag?.categoryId === cat.id}
                  onPointerDown={(e) => startDrag(e, cat)}
                  onAssign={assignPhase}
                />
              ))}
            </div>
          )}
        </div>

        {/* Drop hint when dragging over */}
        {isDragging && dragOverZone === 'unassigned' && (
          <div className="px-3 pb-2 text-[10px] text-gray-400 italic text-center">Release to move to Not Assigned</div>
        )}
      </div>

      {/* Phase zones */}
      {PHASES.map(phase => {
        const cfg = PHASE_CONFIG[phase];
        const Icon = cfg.icon;
        const phaseCats = byPhase(phase);
        const isOver = isDragging && dragOverZone === phase;

        return (
          <div
            key={phase}
            {...{ [ZONE_ATTR]: phase }}
            className={`rounded-lg border transition-all duration-100 ${cfg.bg} ${isOver ? 'ring-2 ring-inset ring-white/25' : ''}`}
            data-testid={`phase-${phase}`}
          >
            <div className="flex items-start gap-2 px-3 py-2.5 border-b border-white/10">
              <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${cfg.color}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className={`text-xs font-semibold ${cfg.color} uppercase tracking-wider`}>
                    {cfg.label}
                  </p>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
                        data-testid={`info-${phase}`}
                        title="What happens in this phase"
                      >
                        <Info className="w-3 h-3" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="bottom"
                      align="start"
                      className="w-80 bg-gray-900 border-gray-700 p-0 shadow-xl"
                    >
                      <div className={`px-3 py-2 border-b border-gray-700 flex items-center gap-1.5`}>
                        <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                        <span className={`text-xs font-semibold ${cfg.color} uppercase tracking-wider`}>
                          {cfg.label}
                        </span>
                      </div>
                      <div className="p-3 space-y-3">
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Puzzle className="w-3 h-3 text-gray-400 shrink-0" />
                            <span className="app-label">LEGO Parts</span>
                          </div>
                          <ul className="space-y-1">
                            {cfg.partsInfo.map((line, i) => (
                              <li key={i} className="flex gap-1.5 text-[11px] text-gray-400">
                                <span className={`mt-0.5 shrink-0 w-1 h-1 rounded-full ${cfg.dot} mt-[5px]`} />
                                {line}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="border-t border-gray-700/60 pt-3">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <User className="w-3 h-3 text-gray-400 shrink-0" />
                            <span className="app-label">Minifigures</span>
                          </div>
                          <ul className="space-y-1">
                            {cfg.mfInfo.map((line, i) => (
                              <li key={i} className="flex gap-1.5 text-[11px] text-gray-400">
                                <span className={`mt-0.5 shrink-0 w-1 h-1 rounded-full ${cfg.dot} mt-[5px]`} />
                                {line}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  <span className="text-gray-300">Parts:</span> {cfg.partsDetail}
                </p>
                <p className="text-[10px] text-gray-400">
                  <span className="text-gray-300">Minifigs:</span> {cfg.mfDetail}
                </p>
              </div>
              <Badge variant="outline" className={`text-[10px] shrink-0 ${cfg.badgeBg} border-0`}>
                {phaseCats.length}
              </Badge>
            </div>

            <div className="p-3 min-h-[56px]">
              {phaseCats.length === 0 ? (
                <p className={`text-[11px] italic ${isOver ? cfg.color + ' opacity-80' : 'text-gray-600'}`}>
                  {isOver ? "Release to assign here" : "Drag categories here"}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {phaseCats.map(cat => (
                    <AssignedPill
                      key={cat.id}
                      cat={cat}
                      cfg={cfg}
                      isDragging={isDragging}
                      isBeingDragged={drag?.categoryId === cat.id}
                      onPointerDown={(e) => startDrag(e, cat)}
                      onAssign={assignPhase}
                      onRemove={() => removeFromPhase(cat.id)}
                    />
                  ))}
                  {isOver && (
                    <div className={`px-2 py-0.5 rounded text-[10px] border border-dashed ${cfg.badgeBg} opacity-50 pointer-events-none`}>
                      Release here
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Floating ghost that follows the pointer */}
      {drag && createPortal(
        <div
          id="lom-drag-ghost"
          style={{
            position: "fixed",
            left: drag.x + 12,
            top: drag.y - 12,
            pointerEvents: "none",
            zIndex: 9999,
          }}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-gray-700 text-gray-100 border border-gray-500 shadow-xl opacity-90 select-none"
        >
          <GripVertical className="w-2.5 h-2.5 text-gray-400 shrink-0" />
          {drag.categoryName}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Pills ─────────────────────────────────────────────────────────────────────

function UnassignedPill({
  cat,
  isDragging,
  isBeingDragged,
  onPointerDown,
  onAssign,
}: {
  cat: PhaseCategory;
  isDragging: boolean;
  isBeingDragged: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onAssign: (id: number, phase: PhaseKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close dropdown if dragging starts
  useEffect(() => { if (isDragging) setOpen(false); }, [isDragging]);

  return (
    <div className="relative" ref={ref}>
      <div
        onPointerDown={(e) => {
          // Only start drag from the grip handle; clicking elsewhere opens menu
          const target = e.target as HTMLElement;
          if (target.closest("[data-grip]")) {
            onPointerDown(e);
          } else if (!isDragging) {
            setOpen(v => !v);
          }
        }}
        className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-gray-700/60 text-gray-300 border border-gray-600/50 select-none cursor-pointer transition-opacity ${isBeingDragged ? 'opacity-30' : ''}`}
        data-testid={`pill-unassigned-${cat.id}`}
        title="Drag to assign, or tap to pick a phase"
      >
        <span data-grip className="touch-none cursor-grab">
          <GripVertical className="w-3 h-3 text-gray-400 shrink-0" />
        </span>
        {cat.name}
      </div>

      {open && (
        <div className="absolute top-full left-0 z-[200] mt-1 bg-gray-800 border border-gray-600 rounded-md shadow-xl overflow-hidden min-w-[180px]">
          <div className="px-2.5 py-1.5 text-[10px] text-gray-500 border-b border-gray-700 font-medium uppercase tracking-wider">
            Assign to phase
          </div>
          {PHASES.map(p => {
            const cfg = PHASE_CONFIG[p];
            return (
              <button
                key={p}
                className={`w-full text-left px-2.5 py-2 text-[11px] flex items-center gap-2 hover:bg-gray-700 transition-colors ${cfg.color}`}
                onClick={() => { onAssign(cat.id, p); setOpen(false); }}
                data-testid={`assign-${cat.id}-${p}`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                {cfg.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AssignedPill({
  cat,
  cfg,
  isDragging,
  isBeingDragged,
  onPointerDown,
  onAssign,
  onRemove,
}: {
  cat: PhaseCategory;
  cfg: typeof PHASE_CONFIG[PhaseKey];
  isDragging: boolean;
  isBeingDragged: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onAssign: (id: number, phase: PhaseKey) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => { if (isDragging) setOpen(false); }, [isDragging]);

  return (
    <div className="relative" ref={ref}>
      <div
        className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] border select-none group transition-opacity ${cfg.badgeBg} ${isBeingDragged ? 'opacity-30' : ''}`}
        data-testid={`pill-${cat.sortingPhase}-${cat.id}`}
      >
        <span
          data-grip
          onPointerDown={onPointerDown}
          className="touch-none cursor-grab active:cursor-grabbing"
          title="Drag to move"
        >
          <GripVertical className="w-3 h-3 opacity-50 group-hover:opacity-80 shrink-0" />
        </span>
        <span
          className="cursor-pointer"
          onClick={() => !isDragging && setOpen(v => !v)}
          title="Tap to change phase"
        >
          {cat.name}
        </span>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-0.5 opacity-40 hover:opacity-90 transition-opacity"
          data-testid={`remove-${cat.id}`}
          title="Move back to Unassigned"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      </div>

      {open && (
        <div className="absolute top-full left-0 z-[200] mt-1 bg-gray-800 border border-gray-600 rounded-md shadow-xl overflow-hidden min-w-[190px]">
          <div className="px-2.5 py-1.5 text-[10px] text-gray-500 border-b border-gray-700 font-medium uppercase tracking-wider">
            Move to phase
          </div>
          {PHASES.filter(p => p !== cat.sortingPhase).map(p => {
            const pcfg = PHASE_CONFIG[p];
            return (
              <button
                key={p}
                className={`w-full text-left px-2.5 py-2 text-[11px] flex items-center gap-2 hover:bg-gray-700 transition-colors ${pcfg.color}`}
                onClick={() => { onAssign(cat.id, p); setOpen(false); }}
                data-testid={`reassign-${cat.id}-${p}`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${pcfg.dot}`} />
                {pcfg.label}
              </button>
            );
          })}
          <div className="border-t border-gray-700/60">
            <button
              className="w-full text-left px-2.5 py-2 text-[11px] flex items-center gap-2 hover:bg-gray-700 transition-colors text-gray-400"
              onClick={() => { onRemove(); setOpen(false); }}
              data-testid={`unassign-${cat.id}`}
            >
              <span className="w-2 h-2 rounded-full shrink-0 bg-gray-500" />
              Move to Not Assigned
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

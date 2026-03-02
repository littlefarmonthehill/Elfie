import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { X, GripVertical, Layers, SplitSquareHorizontal, Tag, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

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
  },
};

const DRAG_KEY = "listomatc-cat-id";

export function ListomaticPhases() {
  const { toast } = useToast();
  // dragOverPhase = the phase the cursor is currently over, null if none
  const [dragOverPhase, setDragOverPhase] = useState<string | null>(null);
  // dragging = true while any pill is being dragged
  const [dragging, setDragging] = useState(false);

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

  // --- Drag handlers passed to each zone ---

  function onZoneDragEnter(e: React.DragEvent, zone: string) {
    e.preventDefault();
    setDragOverPhase(zone);
  }

  function onZoneDragLeave(e: React.DragEvent, zone: string) {
    // Only counts as leaving if the cursor truly exits the container,
    // not just moving between child elements within it.
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverPhase(prev => (prev === zone ? null : prev));
    }
  }

  function onZoneDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onZoneDrop(e: React.DragEvent, targetPhase: string | null) {
    e.preventDefault();
    setDragOverPhase(null);
    setDragging(false);
    const raw = e.dataTransfer.getData(DRAG_KEY);
    if (!raw) return;
    const categoryId = Number(raw);
    const cat = categories.find(c => c.id === categoryId);
    if (!cat) return;
    if (cat.sortingPhase === targetPhase) return;
    moveMutation.mutate({ categoryId, phase: targetPhase });
  }

  function removeFromPhase(categoryId: number) {
    moveMutation.mutate({ categoryId, phase: null });
  }

  function assignPhase(categoryId: number, phase: PhaseKey) {
    moveMutation.mutate({ categoryId, phase });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
        Loading categories...
      </div>
    );
  }

  const zoneProps = (zone: string, targetPhase: string | null) => ({
    onDragEnter: (e: React.DragEvent) => onZoneDragEnter(e, zone),
    onDragLeave: (e: React.DragEvent) => onZoneDragLeave(e, zone),
    onDragOver: onZoneDragOver,
    onDrop: (e: React.DragEvent) => onZoneDrop(e, targetPhase),
  });

  return (
    <div className="space-y-3">

      {/* Unassigned zone */}
      <DropZone
        label="Not Assigned"
        count={unassigned.length}
        isOver={dragging && dragOverPhase === 'unassigned'}
        isEmpty={unassigned.length === 0}
        emptyText={categories.length === 0 ? "No inventory categories found." : "All categories assigned."}
        headerClass="border-gray-700/40"
        containerClass={`border rounded-lg transition-all duration-150 ${
          dragging && dragOverPhase === 'unassigned'
            ? 'border-gray-400/70 bg-gray-700/30 ring-1 ring-gray-400/30'
            : 'border-gray-700/50 bg-gray-800/30'
        }`}
        dotClass="bg-gray-500"
        labelClass="text-gray-400"
        {...zoneProps('unassigned', null)}
        data-testid="phase-unassigned"
      >
        {unassigned.map(cat => (
          <UnassignedPill
            key={cat.id}
            cat={cat}
            onAssign={assignPhase}
            onDragStart={() => setDragging(true)}
            onDragEnd={() => { setDragging(false); setDragOverPhase(null); }}
          />
        ))}
      </DropZone>

      {/* Phase zones */}
      {PHASES.map(phase => {
        const cfg = PHASE_CONFIG[phase];
        const Icon = cfg.icon;
        const phaseCats = byPhase(phase);
        const isOver = dragging && dragOverPhase === phase;

        return (
          <div
            key={phase}
            className={`rounded-lg border transition-all duration-150 ${cfg.bg} ${isOver ? 'ring-2 ring-inset ring-white/20' : ''}`}
            {...zoneProps(phase, phase)}
            data-testid={`phase-${phase}`}
          >
            {/* Header */}
            <div className="flex items-start gap-2 px-3 py-2.5 border-b border-white/10">
              <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${cfg.color}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-semibold ${cfg.color} uppercase tracking-wider`}>
                  {cfg.label}
                </p>
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

            {/* Pills */}
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
                      onRemove={() => removeFromPhase(cat.id)}
                      onDragStart={() => setDragging(true)}
                      onDragEnd={() => { setDragging(false); setDragOverPhase(null); }}
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
    </div>
  );
}

// ── Drop zone wrapper ─────────────────────────────────────────────────────────

function DropZone({
  children,
  label,
  count,
  isOver,
  isEmpty,
  emptyText,
  containerClass,
  headerClass,
  dotClass,
  labelClass,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  ...rest
}: {
  children: React.ReactNode;
  label: string;
  count: number;
  isOver: boolean;
  isEmpty: boolean;
  emptyText: string;
  containerClass: string;
  headerClass: string;
  dotClass: string;
  labelClass: string;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  [key: string]: unknown;
}) {
  return (
    <div
      className={containerClass}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      {...rest}
    >
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${headerClass}`}>
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${labelClass}`}>{label}</span>
        <Badge variant="outline" className="ml-auto text-[10px] text-gray-500 border-gray-600">
          {count}
        </Badge>
      </div>
      <div className="p-3 min-h-[48px]">
        {isEmpty ? (
          <p className={`text-[11px] italic ${isOver ? 'text-gray-300 opacity-70' : 'text-gray-600'}`}>
            {isOver ? "Release to unassign" : emptyText}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">{children}</div>
        )}
      </div>
    </div>
  );
}

// ── Pills ─────────────────────────────────────────────────────────────────────

function UnassignedPill({
  cat,
  onAssign,
  onDragStart,
  onDragEnd,
}: {
  cat: PhaseCategory;
  onAssign: (id: number, phase: PhaseKey) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_KEY, String(cat.id));
          e.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-gray-700/60 text-gray-300 border border-gray-600/50 cursor-grab active:cursor-grabbing select-none"
        data-testid={`pill-unassigned-${cat.id}`}
        onClick={() => setOpen(v => !v)}
        title="Click to assign phase, or drag to a phase"
      >
        <GripVertical className="w-2.5 h-2.5 text-gray-500 shrink-0" />
        {cat.name}
      </div>

      {open && (
        <div className="absolute top-full left-0 z-[200] mt-1 bg-gray-800 border border-gray-600 rounded-md shadow-xl overflow-hidden min-w-[170px]">
          <div className="px-2.5 py-1.5 text-[10px] text-gray-500 border-b border-gray-700 font-medium uppercase tracking-wider">
            Assign to phase
          </div>
          {PHASES.map(p => {
            const cfg = PHASE_CONFIG[p];
            return (
              <button
                key={p}
                className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center gap-2 hover:bg-gray-700 transition-colors ${cfg.color}`}
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
  onRemove,
  onDragStart,
  onDragEnd,
}: {
  cat: PhaseCategory;
  cfg: typeof PHASE_CONFIG[PhaseKey];
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_KEY, String(cat.id));
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border cursor-grab active:cursor-grabbing select-none group ${cfg.badgeBg}`}
      data-testid={`pill-${cat.sortingPhase}-${cat.id}`}
    >
      <GripVertical className="w-2.5 h-2.5 opacity-40 group-hover:opacity-70 shrink-0" />
      {cat.name}
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="ml-0.5 opacity-40 hover:opacity-90 transition-opacity"
        data-testid={`remove-${cat.id}`}
        title="Move back to Unassigned"
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </div>
  );
}

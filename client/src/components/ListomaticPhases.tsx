import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { X, GripVertical, Layers, SplitSquareHorizontal, Filter, Tag, FolderOpen } from "lucide-react";
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

export function ListomaticPhases() {
  const { toast } = useToast();
  const [dragCategoryId, setDragCategoryId] = useState<number | null>(null);
  const [dragOverPhase, setDragOverPhase] = useState<string | null>(null);
  const dragCounter = useRef<Record<string, number>>({});

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

  function handleDragStart(e: React.DragEvent, categoryId: number) {
    setDragCategoryId(categoryId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragEnd() {
    setDragCategoryId(null);
    setDragOverPhase(null);
    dragCounter.current = {};
  }

  function handleDragEnter(e: React.DragEvent, phase: string) {
    e.preventDefault();
    dragCounter.current[phase] = (dragCounter.current[phase] || 0) + 1;
    setDragOverPhase(phase);
  }

  function handleDragLeave(e: React.DragEvent, phase: string) {
    dragCounter.current[phase] = (dragCounter.current[phase] || 1) - 1;
    if (dragCounter.current[phase] <= 0) {
      dragCounter.current[phase] = 0;
      if (dragOverPhase === phase) setDragOverPhase(null);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: React.DragEvent, targetPhase: string | null) {
    e.preventDefault();
    dragCounter.current = {};
    setDragOverPhase(null);
    if (dragCategoryId == null) return;
    const cat = categories.find(c => c.id === dragCategoryId);
    if (!cat) return;
    if (cat.sortingPhase === targetPhase) return;
    moveMutation.mutate({ categoryId: dragCategoryId, phase: targetPhase });
    setDragCategoryId(null);
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

  return (
    <div className="space-y-4">

      {/* Legend */}
      <div className="flex flex-wrap gap-2 text-[10px] text-gray-400">
        <span className="font-medium text-gray-300 mr-1">Parts:</span>
        {PHASES.map((p, i) => (
          <span key={p} className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${PHASE_CONFIG[p].dot}`} />
            {PHASE_CONFIG[p].stepLabel}{i < PHASES.length - 1 ? " →" : ""}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-[10px] text-gray-400">
        <span className="font-medium text-gray-300 mr-1">Minifigs:</span>
        {PHASES.map((p, i) => (
          <span key={p} className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${PHASE_CONFIG[p].dot}`} />
            {PHASE_CONFIG[p].stepLabel}{i < PHASES.length - 1 ? " →" : ""}
          </span>
        ))}
      </div>

      {/* Unassigned — drop target */}
      <div
        className={`rounded-lg border transition-colors ${
          dragOverPhase === 'unassigned'
            ? 'border-gray-400/60 bg-gray-700/30'
            : 'border-gray-700/50 bg-gray-800/30'
        }`}
        onDragEnter={(e) => handleDragEnter(e, 'unassigned')}
        onDragLeave={(e) => handleDragLeave(e, 'unassigned')}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, null)}
        data-testid="phase-unassigned"
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700/40">
          <span className="w-2 h-2 rounded-full bg-gray-500" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Not Assigned
          </span>
          <Badge variant="outline" className="ml-auto text-[10px] text-gray-500 border-gray-600">
            {unassigned.length}
          </Badge>
        </div>
        <div className="p-3 min-h-[48px]">
          {unassigned.length === 0 ? (
            <p className="text-[11px] text-gray-600 italic">
              {categories.length === 0 ? "No inventory categories found." : "All categories assigned."}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {unassigned.map(cat => (
                <UnassignedPill
                  key={cat.id}
                  cat={cat}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onAssign={assignPhase}
                  isDragging={dragCategoryId === cat.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Phase columns */}
      {PHASES.map(phase => {
        const cfg = PHASE_CONFIG[phase];
        const Icon = cfg.icon;
        const phaseCats = byPhase(phase);
        const isOver = dragOverPhase === phase;

        return (
          <div
            key={phase}
            className={`rounded-lg border transition-colors ${isOver ? 'border-opacity-80 ring-1 ring-inset ' + cfg.bg.split(' ')[1] : ''} ${cfg.bg}`}
            onDragEnter={(e) => handleDragEnter(e, phase)}
            onDragLeave={(e) => handleDragLeave(e, phase)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, phase)}
            data-testid={`phase-${phase}`}
          >
            {/* Phase header */}
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

            {/* Drop zone */}
            <div className="p-3 min-h-[56px]">
              {phaseCats.length === 0 ? (
                <p className={`text-[11px] italic ${isOver ? cfg.color + ' opacity-70' : 'text-gray-600'}`}>
                  {isOver ? "Drop here" : "Drag categories here"}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {phaseCats.map(cat => (
                    <AssignedPill
                      key={cat.id}
                      cat={cat}
                      cfg={cfg}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onRemove={() => removeFromPhase(cat.id)}
                      isDragging={dragCategoryId === cat.id}
                    />
                  ))}
                  {isOver && dragCategoryId !== null && (
                    <div className={`px-2 py-0.5 rounded text-[10px] border border-dashed ${cfg.badgeBg} opacity-60`}>
                      Drop here
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

function UnassignedPill({
  cat,
  onDragStart,
  onDragEnd,
  onAssign,
  isDragging,
}: {
  cat: PhaseCategory;
  onDragStart: (e: React.DragEvent, id: number) => void;
  onDragEnd: () => void;
  onAssign: (id: number, phase: PhaseKey) => void;
  isDragging: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <div
        draggable
        onDragStart={(e) => onDragStart(e, cat.id)}
        onDragEnd={onDragEnd}
        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-gray-700/60 text-gray-300 border border-gray-600/50 cursor-grab active:cursor-grabbing select-none transition-opacity ${isDragging ? 'opacity-30' : ''}`}
        data-testid={`pill-unassigned-${cat.id}`}
        onClick={() => setOpen(!open)}
        title="Click to assign phase or drag to a phase"
      >
        <GripVertical className="w-2.5 h-2.5 text-gray-500" />
        {cat.name}
      </div>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg overflow-hidden min-w-[160px]">
          <div className="px-2 py-1 text-[10px] text-gray-500 border-b border-gray-700">Assign to phase</div>
          {PHASES.map(p => {
            const cfg = PHASE_CONFIG[p];
            return (
              <button
                key={p}
                className={`w-full text-left px-2 py-1.5 text-[11px] flex items-center gap-1.5 hover:bg-gray-700 ${cfg.color}`}
                onClick={() => { onAssign(cat.id, p); setOpen(false); }}
                data-testid={`assign-${cat.id}-${p}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                {cfg.stepLabel}
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
  onDragStart,
  onDragEnd,
  onRemove,
  isDragging,
}: {
  cat: PhaseCategory;
  cfg: typeof PHASE_CONFIG[PhaseKey];
  onDragStart: (e: React.DragEvent, id: number) => void;
  onDragEnd: () => void;
  onRemove: () => void;
  isDragging: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, cat.id)}
      onDragEnd={onDragEnd}
      className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border cursor-grab active:cursor-grabbing select-none transition-opacity group ${cfg.badgeBg} ${isDragging ? 'opacity-30' : ''}`}
      data-testid={`pill-${cat.sortingPhase}-${cat.id}`}
    >
      <GripVertical className="w-2.5 h-2.5 opacity-40 group-hover:opacity-70" />
      {cat.name}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="ml-0.5 opacity-40 hover:opacity-90 transition-opacity"
        data-testid={`remove-${cat.id}`}
        title="Remove from phase"
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </div>
  );
}

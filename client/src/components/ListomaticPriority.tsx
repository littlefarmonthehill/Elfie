import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Info, Flag, ChevronUp, ChevronDown, ChevronsUpDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";

interface PriorityCategory {
  id: number;
  name: string;
  sortingPhase: string | null;
  flagged: boolean;
  currentQty: number;
  totalSold: number;
  soldOutLots: number;
  sellThroughPct: number;
  soldOutSharePct: number;
  effectivePhaseScore: number;
  score: number;
}

interface PriorityResponse {
  categories: PriorityCategory[];
  phaseScores: Record<string, number>;
}

const PHASES = ['category', 'subcategory', 'finalsort', 'listing'] as const;
type PhaseKey = typeof PHASES[number];

const PHASE_CONFIG: Record<PhaseKey, {
  label: string;
  textColor: string;
  borderColor: string;
  bgColor: string;
  tileBorder: string;
  tileBg: string;
  tileShadow: string;
  tileHover: string;
}> = {
  category:    { label: "Category",    textColor: "text-amber-400",   borderColor: "border-amber-500/40",   bgColor: "bg-amber-500/10",   tileBorder: "border-amber-600/60",   tileBg: "bg-gradient-to-br from-amber-800/35 via-amber-950/25 to-slate-900/70",   tileShadow: "shadow-[0_2px_10px_rgba(120,70,0,0.4)]",  tileHover: "hover:border-amber-500/80" },
  subcategory: { label: "Subcategory", textColor: "text-blue-400",    borderColor: "border-blue-500/40",    bgColor: "bg-blue-500/10",    tileBorder: "border-blue-600/60",    tileBg: "bg-gradient-to-br from-blue-800/35 via-blue-950/25 to-slate-900/70",    tileShadow: "shadow-[0_2px_10px_rgba(30,60,160,0.4)]", tileHover: "hover:border-blue-500/80" },
  finalsort:   { label: "Final Sort",  textColor: "text-purple-400",  borderColor: "border-purple-500/40",  bgColor: "bg-purple-500/10",  tileBorder: "border-purple-600/60",  tileBg: "bg-gradient-to-br from-purple-800/35 via-purple-950/25 to-slate-900/70", tileShadow: "shadow-[0_2px_10px_rgba(100,30,160,0.4)]", tileHover: "hover:border-purple-500/80" },
  listing:     { label: "Listing",     textColor: "text-emerald-400", borderColor: "border-emerald-500/40", bgColor: "bg-emerald-500/10", tileBorder: "border-emerald-600/60", tileBg: "bg-gradient-to-br from-emerald-800/35 via-emerald-950/25 to-slate-900/70", tileShadow: "shadow-[0_2px_10px_rgba(0,100,60,0.4)]",  tileHover: "hover:border-emerald-500/80" },
};

const UNASSIGNED_TILE = {
  tileBorder: "border-gray-700/30",
  tileBg: "bg-gradient-to-br from-gray-900/60 via-slate-800/70 to-gray-900/40",
  tileShadow: "shadow-[0_2px_8px_rgba(0,0,0,0.3)]",
  tileHover: "hover:border-gray-600/50",
};

type SortKey = 'score' | 'name' | 'sortingPhase' | 'sellThroughPct' | 'soldOutSharePct' | 'effectivePhaseScore';

function scoreColor(score: number) {
  if (score >= 60) return "text-emerald-400";
  if (score >= 35) return "text-yellow-400";
  if (score >= 15) return "text-orange-400";
  return "text-gray-500";
}

function scoreBadgeBg(score: number) {
  if (score >= 60) return "bg-emerald-500/15 border-emerald-500/30 text-emerald-300";
  if (score >= 35) return "bg-yellow-500/15 border-yellow-500/30 text-yellow-300";
  if (score >= 15) return "bg-orange-500/15 border-orange-500/30 text-orange-300";
  return "bg-gray-800/60 border-gray-700/30 text-gray-500";
}

export default function ListomaticPriority() {
  const { toast } = useToast();
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'score', dir: 'desc' });
  const [localPhaseScores, setLocalPhaseScores] = useState<Record<string, number> | null>(null);
  const [editingPhase, setEditingPhase] = useState<PhaseKey | null>(null);
  const [editValue, setEditValue] = useState('');
  const [openPhaseId, setOpenPhaseId] = useState<number | null>(null);
  const [openScoreId, setOpenScoreId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error } = useQuery<PriorityResponse>({
    queryKey: ['/api/listomatc/priority'],
    staleTime: 30000,
  });

  const phaseScores = localPhaseScores ?? data?.phaseScores ?? { category: 25, subcategory: 50, finalsort: 75, listing: 100 };

  const saveScoresMutation = useMutation({
    mutationFn: async (scores: Record<string, number>) =>
      apiRequest('PATCH', '/api/listomatc/phase-scores', {
        category:    scores.category,
        subcategory: scores.subcategory,
        finalsort:   scores.finalsort,
        listing:     scores.listing,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/listomatc/priority'] });
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
    },
    onError: () => toast({ title: "Failed to save phase score", variant: "destructive" }),
  });

  const flagMutation = useMutation({
    mutationFn: async (categoryId: number) =>
      apiRequest('PATCH', `/api/listomatc/categories/${categoryId}/flag`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/listomatc/priority'] }),
    onError: () => toast({ title: "Failed to toggle flag", variant: "destructive" }),
  });

  const phaseMutation = useMutation({
    mutationFn: async ({ categoryId, phase }: { categoryId: number; phase: string | null }) =>
      apiRequest('PATCH', '/api/listomatc/category-phase', { categoryId, phase }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/listomatc/priority'] });
      queryClient.invalidateQueries({ queryKey: ['/api/listomatc/category-phases'] });
    },
    onError: () => toast({ title: "Failed to update phase", variant: "destructive" }),
  });

  const startEditing = (phase: PhaseKey) => {
    setEditingPhase(phase);
    setEditValue(String(phaseScores[phase] ?? 0));
    setTimeout(() => inputRef.current?.select(), 30);
  };

  const commitEdit = () => {
    if (!editingPhase) return;
    const num = Math.max(0, Math.min(999, parseInt(editValue) || 0));
    const updated = { ...phaseScores, [editingPhase]: num };
    setLocalPhaseScores(updated);
    saveScoresMutation.mutate(updated);
    setEditingPhase(null);
  };

  const handleSort = (key: SortKey) =>
    setSort(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'name' ? 'asc' : 'desc' });

  const sorted = [...(data?.categories ?? [])].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    if (sort.key === 'name') return dir * a.name.localeCompare(b.name);
    if (sort.key === 'sortingPhase') {
      const order: Record<string, number> = { listing: 4, finalsort: 3, subcategory: 2, category: 1 };
      return dir * ((order[a.sortingPhase ?? ''] ?? 0) - (order[b.sortingPhase ?? ''] ?? 0));
    }
    return dir * ((a[sort.key] as number) - (b[sort.key] as number));
  });

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sort.key !== k) return <ChevronsUpDown className="w-3 h-3 opacity-30" />;
    return sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-100">Listing Priority Score</h3>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="icon" variant="ghost" className="w-6 h-6" data-testid="button-lom-priority-info">
              <Info className="w-3.5 h-3.5 text-gray-500" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" className="w-96 bg-gray-900 border-gray-700 p-3 z-[300]">
            <h4 className="text-xs font-bold text-emerald-400 mb-2">How the Priority Score is Calculated</h4>
            <p className="text-[11px] text-gray-300 mb-2">
              Each category gets a score identifying which unlisted categories to prioritize for physical preparation and listing.
            </p>
            <div className="space-y-2 text-[11px]">
              <div className="bg-gray-800/60 rounded p-2">
                <p className="text-amber-300 font-semibold mb-0.5">Sell-Through Rate — 30% weight</p>
                <p className="text-gray-400">Sold ÷ (Current Stock + Sold) × 100. High sell-through means demand is outpacing what's listed.</p>
              </div>
              <div className="bg-gray-800/60 rounded p-2">
                <p className="text-blue-300 font-semibold mb-0.5">Sold-Out Lots Share — 30% weight</p>
                <p className="text-gray-400">This category's sold-out lots ÷ all sold-out lots across your inventory × 100.</p>
              </div>
              <div className="bg-gray-800/60 rounded p-2">
                <p className="text-purple-300 font-semibold mb-0.5">Sorting Effort — 40% weight</p>
                <p className="text-gray-400">The phase score you set below. In the Listing phase, flagging a category doubles its effort score.</p>
              </div>
              <div className="border-t border-gray-700 pt-2 text-gray-500 font-mono text-[10px]">
                Score = (Sell-Through × 0.30) + (Sold-Out Share × 0.30) + (Phase Score × 0.40)
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Phase Score Cards — single row, names only */}
      <div className="grid grid-cols-4 gap-2">
        {PHASES.map(phase => {
          const cfg = PHASE_CONFIG[phase];
          const isEditing = editingPhase === phase;
          const score = phaseScores[phase] ?? 0;
          return (
            <div
              key={phase}
              className={`rounded-lg border ${cfg.borderColor} ${cfg.bgColor} p-2.5 cursor-pointer transition-all`}
              onClick={() => !isEditing && startEditing(phase)}
              data-testid={`phase-card-${phase}`}
            >
              <p className={`text-[9px] font-semibold ${cfg.textColor} mb-1 truncate`}>{cfg.label}</p>
              {isEditing ? (
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <input
                    ref={inputRef}
                    type="number"
                    min={0}
                    max={999}
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingPhase(null); }}
                    className="w-full bg-gray-900/80 border border-gray-500 rounded px-1.5 py-0.5 text-sm text-gray-100 font-semibold focus:outline-none focus:border-gray-300"
                    data-testid={`input-phase-score-${phase}`}
                    autoFocus
                  />
                  <button onClick={commitEdit} className={`shrink-0 ${cfg.textColor}`} data-testid={`confirm-phase-score-${phase}`}>
                    <Check className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="flex items-end justify-between gap-1">
                  <span className="text-xl font-bold text-gray-100 tabular-nums leading-none">{score}</span>
                  {phase === 'listing' && (
                    <span className="text-[8px] text-orange-400 mb-0.5 leading-none">×2 if flagged</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-gray-600 -mt-1">Tap a phase card to edit its score. Tap the phase badge on a tile to reassign. Flag icon pre-tags a category — ×2 activates when it reaches Listing.</p>

      {/* Sort controls */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-gray-600 mr-1">Sort:</span>
        {([
          ['score', 'Score'],
          ['name', 'Name'],
          ['sortingPhase', 'Phase'],
          ['sellThroughPct', 'Sell-Thru'],
          ['soldOutSharePct', 'Sold-Out'],
          ['effectivePhaseScore', 'Effort'],
        ] as [SortKey, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => handleSort(key)}
            className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              sort.key === key
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-gray-500 hover:text-gray-300 border border-transparent'
            }`}
            data-testid={`sort-${key}`}
          >
            {label} <SortIcon k={key} />
          </button>
        ))}
      </div>

      {/* Tiles */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Loading priority data…</div>
      ) : error ? (
        <div className="text-center py-8 text-red-400 text-sm">Failed to load priority list.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {sorted.map(cat => {
            const phaseCfg = cat.sortingPhase ? PHASE_CONFIG[cat.sortingPhase as PhaseKey] : null;
            const tileCfg  = phaseCfg
              ? { tileBorder: phaseCfg.tileBorder, tileBg: phaseCfg.tileBg, tileShadow: phaseCfg.tileShadow, tileHover: phaseCfg.tileHover }
              : UNASSIGNED_TILE;
            const inListing = cat.sortingPhase === 'listing';

            return (
              <div
                key={cat.id}
                className={`relative rounded-lg border ${tileCfg.tileBorder} ${tileCfg.tileBg} px-3 py-2 ${tileCfg.tileShadow} transition-all duration-150 ${cat.flagged ? 'ring-1 ring-orange-500/60' : ''}`}
                data-testid={`tile-priority-${cat.id}`}
              >
                {/* Row 1: Name + flag button + score badge */}
                <div className="flex items-center gap-1.5 min-w-0 mb-1.5">
                  <p className={`text-xs font-medium truncate flex-1 min-w-0 ${cat.flagged ? 'text-orange-200' : 'text-gray-200'}`}>
                    {cat.name}
                  </p>

                  {/* Flag toggle — always visible */}
                  <button
                    onClick={() => flagMutation.mutate(cat.id)}
                    className={`shrink-0 transition-colors p-0.5 rounded ${
                      cat.flagged
                        ? 'text-orange-400'
                        : 'text-gray-700 hover:text-orange-400'
                    }`}
                    title={
                      cat.flagged
                        ? (inListing ? 'Flagged — ×2 active. Tap to remove.' : 'Flagged — ×2 will apply when moved to Listing. Tap to remove.')
                        : 'Flag to double effort score when in Listing phase'
                    }
                    data-testid={`flag-btn-${cat.id}`}
                  >
                    <Flag className={`w-3 h-3 ${cat.flagged ? 'fill-current' : ''}`} />
                  </button>

                  {/* Score badge — tap for breakdown */}
                  <Popover
                    open={openScoreId === cat.id}
                    onOpenChange={open => setOpenScoreId(open ? cat.id : null)}
                  >
                    <PopoverTrigger asChild>
                      <button
                        className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border tabular-nums cursor-pointer ${scoreBadgeBg(cat.score)}`}
                        data-testid={`score-badge-${cat.id}`}
                      >
                        {cat.score}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="left" align="start" className="w-60 bg-gray-900 border-gray-700 p-3 z-[300]">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2 truncate">{cat.name}</p>
                      <div className="space-y-1 text-[10px] font-mono">
                        <div className="flex justify-between gap-2">
                          <span className="text-amber-300">Sell-Through</span>
                          <span className="text-gray-400">{cat.sellThroughPct}% × 30%</span>
                          <span className="text-gray-200 w-8 text-right">{(cat.sellThroughPct * 0.30).toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-blue-300">Sold-Out</span>
                          <span className="text-gray-400">{cat.soldOutSharePct}% × 30%</span>
                          <span className="text-gray-200 w-8 text-right">{(cat.soldOutSharePct * 0.30).toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-purple-300">Effort{cat.flagged && inListing ? ' ×2' : ''}</span>
                          <span className="text-gray-400">{cat.effectivePhaseScore} × 40%</span>
                          <span className="text-gray-200 w-8 text-right">{(cat.effectivePhaseScore * 0.40).toFixed(1)}</span>
                        </div>
                        <div className="border-t border-gray-700 pt-1 flex justify-between font-semibold">
                          <span className="text-gray-300">Total</span>
                          <span className={scoreColor(cat.score)}>{cat.score}</span>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Row 2: Phase badge (tappable) + stats */}
                <div className="flex items-center gap-2 text-[10px] flex-wrap">
                  {/* Phase badge — tap to reassign */}
                  <Popover
                    open={openPhaseId === cat.id}
                    onOpenChange={open => setOpenPhaseId(open ? cat.id : null)}
                  >
                    <PopoverTrigger asChild>
                      <button
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border transition-colors ${
                          phaseCfg
                            ? `${phaseCfg.bgColor} ${phaseCfg.borderColor} ${phaseCfg.textColor}`
                            : 'bg-gray-800/40 border-gray-700/40 text-gray-500 italic'
                        }`}
                        data-testid={`phase-badge-${cat.id}`}
                      >
                        {phaseCfg ? phaseCfg.label : 'Unassigned'}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="bottom" align="start" className="w-52 bg-gray-900 border-gray-700 p-2.5 z-[300] space-y-1.5">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Move to phase</p>
                      <button
                        onClick={() => { phaseMutation.mutate({ categoryId: cat.id, phase: null }); setOpenPhaseId(null); }}
                        className={`w-full text-left text-[10px] px-2 py-1.5 rounded border transition-colors ${
                          !cat.sortingPhase
                            ? 'border-gray-500 bg-gray-700/60 text-gray-300'
                            : 'border-gray-700/40 text-gray-500 hover:border-gray-600 hover:text-gray-300'
                        }`}
                        data-testid={`phase-btn-null-${cat.id}`}
                      >
                        Not Assigned
                      </button>
                      {PHASES.map(phase => {
                        const cfg = PHASE_CONFIG[phase];
                        const isActive = cat.sortingPhase === phase;
                        return (
                          <button
                            key={phase}
                            onClick={() => { phaseMutation.mutate({ categoryId: cat.id, phase }); setOpenPhaseId(null); }}
                            className={`w-full text-left text-[10px] px-2 py-1.5 rounded border transition-colors ${
                              isActive
                                ? `${cfg.borderColor} ${cfg.bgColor} ${cfg.textColor} font-semibold`
                                : `border-gray-700/40 text-gray-500 hover:${cfg.borderColor} hover:${cfg.textColor}`
                            }`}
                            data-testid={`phase-btn-${phase}-${cat.id}`}
                          >
                            {cfg.label}
                          </button>
                        );
                      })}
                    </PopoverContent>
                  </Popover>

                  {cat.sellThroughPct > 0 && (
                    <span className="text-gray-500">Sell-Through {cat.sellThroughPct}%</span>
                  )}
                  {cat.soldOutLots > 0 && (
                    <span className="text-gray-500">Sold-Out {cat.soldOutSharePct}%</span>
                  )}
                  {cat.effectivePhaseScore > 0 && (
                    <span className={cat.flagged && inListing ? 'text-orange-400 font-semibold' : 'text-gray-500'}>
                      Effort {cat.effectivePhaseScore}{cat.flagged && inListing ? ' ×2' : ''}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {sorted.length === 0 && (
            <div className="col-span-2 py-12 text-center text-gray-600 text-sm italic">No categories found. Run an inventory sync first.</div>
          )}
        </div>
      )}

      <p className="text-[10px] text-gray-600">
        {sorted.length} categories · Orange ring = flagged for ×2 effort in Listing phase.
      </p>
    </div>
  );
}

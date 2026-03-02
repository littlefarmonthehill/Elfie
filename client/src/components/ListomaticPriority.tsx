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

const PHASE_CONFIG: Record<PhaseKey, { label: string; shortLabel: string; textColor: string; borderColor: string; bgColor: string }> = {
  category:    { label: "Phase 1 — Category",    shortLabel: "Category",    textColor: "text-amber-400",  borderColor: "border-amber-500/40",  bgColor: "bg-amber-500/10" },
  subcategory: { label: "Phase 2 — Subcategory", shortLabel: "Subcategory", textColor: "text-blue-400",   borderColor: "border-blue-500/40",   bgColor: "bg-blue-500/10" },
  finalsort:   { label: "Phase 3 — Final Sort",  shortLabel: "Final Sort",  textColor: "text-purple-400", borderColor: "border-purple-500/40", bgColor: "bg-purple-500/10" },
  listing:     { label: "Phase 4 — Listing",     shortLabel: "Listing",     textColor: "text-green-400",  borderColor: "border-green-500/40",  bgColor: "bg-green-500/10" },
};

type SortKey = 'score' | 'name' | 'sortingPhase' | 'sellThroughPct' | 'soldOutSharePct' | 'effectivePhaseScore';

export default function ListomaticPriority() {
  const { toast } = useToast();
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'score', dir: 'desc' });
  const [localPhaseScores, setLocalPhaseScores] = useState<Record<string, number> | null>(null);
  const [editingPhase, setEditingPhase] = useState<PhaseKey | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error } = useQuery<PriorityResponse>({
    queryKey: ['/api/listomatc/priority'],
    staleTime: 30000,
  });

  const phaseScores = localPhaseScores ?? data?.phaseScores ?? { category: 25, subcategory: 50, finalsort: 75, listing: 100 };

  const saveScoresMutation = useMutation({
    mutationFn: async (scores: Record<string, number>) =>
      apiRequest('PATCH', '/api/settings', {
        lomCategoryScore: scores.category,
        lomSubcategoryScore: scores.subcategory,
        lomFinalsortScore: scores.finalsort,
        lomListingScore: scores.listing,
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

  const scoreColor = (score: number) => {
    if (score >= 60) return "text-green-400";
    if (score >= 35) return "text-yellow-400";
    if (score >= 15) return "text-orange-400";
    return "text-gray-500";
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
            <h4 className="text-xs font-bold text-green-400 mb-2">How the Priority Score is Calculated</h4>
            <p className="text-[11px] text-gray-300 mb-2">
              Each category gets a score that identifies which unlisted categories to prioritize for physical preparation and listing.
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
                <p className="text-gray-400">The phase score you set below. In the Listing phase, tapping a category row doubles its effort score.</p>
              </div>
              <div className="border-t border-gray-700 pt-2 text-gray-500 font-mono text-[10px]">
                Score = (Sell-Through × 0.30) + (Sold-Out Share × 0.30) + (Phase Score × 0.40)
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Phase Score Cards — tap to edit the number */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {PHASES.map(phase => {
          const cfg = PHASE_CONFIG[phase];
          const isEditing = editingPhase === phase;
          const score = phaseScores[phase] ?? 0;
          return (
            <div
              key={phase}
              className={`rounded-lg border ${cfg.borderColor} ${cfg.bgColor} p-3 cursor-pointer transition-all`}
              onClick={() => !isEditing && startEditing(phase)}
              data-testid={`phase-card-${phase}`}
            >
              <p className={`text-[10px] font-semibold ${cfg.textColor} mb-1.5`}>{cfg.label}</p>
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
                    className="w-full bg-gray-900/80 border border-gray-500 rounded px-2 py-1 text-sm text-gray-100 font-semibold focus:outline-none focus:border-gray-300"
                    data-testid={`input-phase-score-${phase}`}
                    autoFocus
                  />
                  <button onClick={commitEdit} className={`shrink-0 ${cfg.textColor}`} data-testid={`confirm-phase-score-${phase}`}>
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-end justify-between">
                  <span className="text-2xl font-bold text-gray-100 tabular-nums">{score}</span>
                  {phase === 'listing' && (
                    <span className="text-[9px] text-orange-400 mb-0.5">×2 if tapped</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-gray-600 -mt-2">Tap a phase card to edit its score. Tap a category row to toggle ×2 (Listing phase only).</p>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Loading priority data…</div>
      ) : error ? (
        <div className="text-center py-8 text-red-400 text-sm">Failed to load priority list.</div>
      ) : (
        <div className="rounded-lg border border-gray-700/50 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[minmax(120px,1fr)_80px_68px_68px_64px_52px] gap-0 text-[10px] text-gray-500 uppercase tracking-wider font-medium bg-gray-800/60 border-b border-gray-700/50">
            {([
              ['name', 'Category'],
              ['sortingPhase', 'Phase'],
              ['sellThroughPct', 'Sell-Thru'],
              ['soldOutSharePct', 'Sold-Out'],
              ['effectivePhaseScore', 'Effort'],
              ['score', 'Score'],
            ] as [SortKey, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => handleSort(key)}
                className="flex items-center gap-1 px-2 py-2 hover:text-gray-300 transition-colors text-left"
                data-testid={`sort-${key}`}
              >
                {label} <SortIcon k={key} />
              </button>
            ))}
          </div>

          {/* Rows */}
          <div className="divide-y divide-gray-800/60">
            {sorted.map(cat => {
              const phaseCfg = cat.sortingPhase ? PHASE_CONFIG[cat.sortingPhase as PhaseKey] : null;
              const canFlag = cat.sortingPhase === 'listing';
              return (
                <div
                  key={cat.id}
                  className={`grid grid-cols-[minmax(120px,1fr)_80px_68px_68px_64px_52px] gap-0 text-[11px] transition-colors ${
                    canFlag ? 'cursor-pointer hover:bg-gray-800/40' : 'hover:bg-gray-800/20'
                  } ${cat.flagged ? 'border-l-2 border-orange-500/60' : 'border-l-2 border-transparent'}`}
                  onClick={() => canFlag && flagMutation.mutate(cat.id)}
                  title={canFlag ? (cat.flagged ? "Tapped — click to remove ×2 boost" : "Click to double effort score") : undefined}
                  data-testid={`row-priority-${cat.id}`}
                >
                  {/* Name + flag indicator */}
                  <div className="px-2 py-2 flex items-center gap-1.5 min-w-0">
                    {cat.flagged && (
                      <Flag className="w-2.5 h-2.5 text-orange-400 shrink-0" fill="currentColor" />
                    )}
                    <span className={`font-medium truncate ${cat.flagged ? 'text-orange-200' : 'text-gray-300'}`}>
                      {cat.name}
                    </span>
                  </div>

                  {/* Phase */}
                  <div className="px-2 py-2">
                    {phaseCfg ? (
                      <span className={`text-[10px] font-medium ${phaseCfg.textColor}`}>{phaseCfg.shortLabel}</span>
                    ) : (
                      <span className="text-[10px] text-gray-600 italic">—</span>
                    )}
                  </div>

                  {/* Sell-through */}
                  <div className="px-2 py-2 text-gray-400 tabular-nums">
                    {cat.sellThroughPct > 0 ? `${cat.sellThroughPct}%` : <span className="text-gray-700">—</span>}
                  </div>

                  {/* Sold-out share */}
                  <div className="px-2 py-2 text-gray-400 tabular-nums">
                    {cat.soldOutLots > 0 ? (
                      <span title={`${cat.soldOutLots} sold-out lots`}>{cat.soldOutSharePct}%</span>
                    ) : <span className="text-gray-700">—</span>}
                  </div>

                  {/* Effort score */}
                  <div className="px-2 py-2 text-gray-400 tabular-nums">
                    {cat.effectivePhaseScore > 0 ? cat.effectivePhaseScore : <span className="text-gray-700">—</span>}
                    {cat.flagged && cat.sortingPhase === 'listing' && (
                      <span className="ml-0.5 text-[9px] text-orange-400">×2</span>
                    )}
                  </div>

                  {/* Score — click for breakdown */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <div
                        className={`px-2 py-2 font-semibold tabular-nums cursor-pointer underline decoration-dotted underline-offset-2 ${scoreColor(cat.score)}`}
                        onClick={e => e.stopPropagation()}
                        data-testid={`score-${cat.id}`}
                      >
                        {cat.score}
                      </div>
                    </PopoverTrigger>
                    <PopoverContent side="left" align="center" className="w-64 bg-gray-900 border-gray-700 p-3 z-[300]">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{cat.name} — Score Breakdown</p>
                      <div className="space-y-1.5 text-[11px] font-mono">
                        <div className="flex justify-between gap-2">
                          <span className="text-amber-300">Sell-Through</span>
                          <span className="text-gray-400">{cat.sellThroughPct}% × 30%</span>
                          <span className="text-gray-200 w-10 text-right">= {(cat.sellThroughPct * 0.30).toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-blue-300">Sold-Out</span>
                          <span className="text-gray-400">{cat.soldOutSharePct}% × 30%</span>
                          <span className="text-gray-200 w-10 text-right">= {(cat.soldOutSharePct * 0.30).toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-purple-300">Effort{cat.flagged && cat.sortingPhase === 'listing' ? ' ×2' : ''}</span>
                          <span className="text-gray-400">{cat.effectivePhaseScore} × 40%</span>
                          <span className="text-gray-200 w-10 text-right">= {(cat.effectivePhaseScore * 0.40).toFixed(1)}</span>
                        </div>
                        <div className="border-t border-gray-700 pt-1.5 flex justify-between font-semibold">
                          <span className="text-gray-300">Total</span>
                          <span className={scoreColor(cat.score)}>{cat.score}</span>
                        </div>
                      </div>
                      {cat.flagged && cat.sortingPhase === 'listing' && (
                        <p className="text-[10px] text-orange-400 mt-2 pt-2 border-t border-gray-700">Row tapped — effort score doubled.</p>
                      )}
                      {canFlag && !cat.flagged && (
                        <p className="text-[10px] text-gray-600 mt-2 pt-2 border-t border-gray-700">Tap this row to double effort score.</p>
                      )}
                    </PopoverContent>
                  </Popover>
                </div>
              );
            })}
          </div>

          {sorted.length === 0 && (
            <div className="py-12 text-center text-gray-600 text-sm italic">No categories found. Run an inventory sync first.</div>
          )}
        </div>
      )}

      <p className="text-[10px] text-gray-600">
        {sorted.length} categories · Orange rows are flagged for ×2 effort in Listing phase.
      </p>
    </div>
  );
}

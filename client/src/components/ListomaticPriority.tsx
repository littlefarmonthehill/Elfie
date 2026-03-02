import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Info, Flag, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

const PHASE_LABELS: Record<string, { label: string; color: string }> = {
  category:    { label: "Category",    color: "text-amber-400" },
  subcategory: { label: "Subcategory", color: "text-blue-400" },
  finalsort:   { label: "Final Sort",  color: "text-purple-400" },
  listing:     { label: "Listing",     color: "text-green-400" },
};

type SortKey = 'score' | 'name' | 'sortingPhase' | 'sellThroughPct' | 'soldOutSharePct' | 'effectivePhaseScore';

export default function ListomaticPriority() {
  const { toast } = useToast();
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'score', dir: 'desc' });
  const [localPhaseScores, setLocalPhaseScores] = useState<Record<string, number> | null>(null);

  const { data, isLoading, error } = useQuery<PriorityResponse>({
    queryKey: ['/api/listomatc/priority'],
    staleTime: 30000,
  });

  const phaseScores = localPhaseScores ?? data?.phaseScores ?? { category: 25, subcategory: 50, finalsort: 75, listing: 100 };

  const saveScoresMutation = useMutation({
    mutationFn: async (scores: Record<string, number>) => {
      return apiRequest('PATCH', '/api/settings', {
        lomCategoryScore: scores.category,
        lomSubcategoryScore: scores.subcategory,
        lomFinalsortScore: scores.finalsort,
        lomListingScore: scores.listing,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/listomatc/priority'] });
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
      toast({ title: "Phase scores saved", duration: 2000 });
    },
    onError: () => toast({ title: "Failed to save scores", variant: "destructive" }),
  });

  const flagMutation = useMutation({
    mutationFn: async (categoryId: number) => {
      return apiRequest('PATCH', `/api/listomatc/categories/${categoryId}/flag`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/listomatc/priority'] });
    },
    onError: () => toast({ title: "Failed to toggle flag", variant: "destructive" }),
  });

  const handlePhaseScoreChange = (phase: string, value: string) => {
    const num = Math.max(0, Math.min(999, parseInt(value) || 0));
    setLocalPhaseScores(prev => ({ ...(prev ?? phaseScores), [phase]: num }));
  };

  const handlePhaseScoreBlur = () => {
    if (localPhaseScores) saveScoresMutation.mutate(localPhaseScores);
  };

  const handleSort = (key: SortKey) => {
    setSort(prev =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }
    );
  };

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

  const phaseKeys = ['category', 'subcategory', 'finalsort', 'listing'] as const;
  const phaseLabels: Record<string, string> = { category: 'Phase 1', subcategory: 'Phase 2', finalsort: 'Phase 3', listing: 'Phase 4' };

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
              Each category gets a score from 0–100+ that identifies which unlisted categories should be prioritized for physical preparation and listing.
            </p>
            <div className="space-y-2 text-[11px]">
              <div className="bg-gray-800/60 rounded p-2">
                <p className="text-amber-300 font-semibold mb-0.5">Sell-Through Rate — 30% weight</p>
                <p className="text-gray-400">Sold ÷ (Current Stock + Sold) × 100. High sell-through means demand is outpacing what's listed.</p>
              </div>
              <div className="bg-gray-800/60 rounded p-2">
                <p className="text-blue-300 font-semibold mb-0.5">Sold-Out Lots Share — 30% weight</p>
                <p className="text-gray-400">This category's sold-out lots ÷ all sold-out lots across your inventory × 100. More sold-out lots = more urgent restocking need.</p>
              </div>
              <div className="bg-gray-800/60 rounded p-2">
                <p className="text-purple-300 font-semibold mb-0.5">Sorting Effort — 40% weight</p>
                <p className="text-gray-400">The phase score you configure below. In the Listing phase, flagged categories get their score doubled — use the flag to mark categories with complex sorting that need extra attention.</p>
              </div>
              <div className="border-t border-gray-700 pt-2 text-gray-500">
                Score = (Sell-Through × 0.30) + (Sold-Out Share × 0.30) + (Phase Score × 0.40)
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Phase Score Editors */}
      <div className="bg-gray-800/40 border border-gray-700/50 rounded-lg p-3">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">Sorting Effort — Phase Scores (0–100 scale)</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {phaseKeys.map(phase => {
            const cfg = PHASE_LABELS[phase];
            return (
              <div key={phase} className="flex flex-col gap-1">
                <label className={`text-[10px] font-medium ${cfg.color}`}>
                  {phaseLabels[phase]} — {cfg.label}
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={phaseScores[phase] ?? 0}
                    onChange={e => handlePhaseScoreChange(phase, e.target.value)}
                    onBlur={handlePhaseScoreBlur}
                    className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-gray-400"
                    data-testid={`input-phase-score-${phase}`}
                  />
                  {phase === 'listing' && (
                    <span className="text-[9px] text-gray-600 whitespace-nowrap">×2 if flagged</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[9px] text-gray-600 mt-2">Changes save automatically when you leave a field.</p>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Loading priority data…</div>
      ) : error ? (
        <div className="text-center py-8 text-red-400 text-sm">Failed to load priority list.</div>
      ) : (
        <div className="rounded-lg border border-gray-700/50 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[minmax(120px,1fr)_80px_68px_68px_64px_52px_36px] gap-0 text-[10px] text-gray-500 uppercase tracking-wider font-medium bg-gray-800/60 border-b border-gray-700/50">
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
            <div className="px-2 py-2 flex items-center justify-center">
              <Flag className="w-3 h-3" />
            </div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-gray-800/60">
            {sorted.map(cat => {
              const phaseCfg = cat.sortingPhase ? PHASE_LABELS[cat.sortingPhase] : null;
              return (
                <div
                  key={cat.id}
                  className="grid grid-cols-[minmax(120px,1fr)_80px_68px_68px_64px_52px_36px] gap-0 text-[11px] hover:bg-gray-800/30 transition-colors"
                  data-testid={`row-priority-${cat.id}`}
                >
                  {/* Name */}
                  <div className="px-2 py-2 text-gray-300 font-medium truncate">{cat.name}</div>

                  {/* Phase */}
                  <div className="px-2 py-2">
                    {phaseCfg ? (
                      <span className={`text-[10px] font-medium ${phaseCfg.color}`}>{phaseCfg.label}</span>
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

                  {/* Score */}
                  <div className={`px-2 py-2 font-semibold tabular-nums ${scoreColor(cat.score)}`}>
                    {cat.score}
                  </div>

                  {/* Flag */}
                  <div className="px-1 py-1 flex items-center justify-center">
                    <button
                      onClick={() => flagMutation.mutate(cat.id)}
                      title={cat.flagged ? "Flagged — click to unflag" : "Click to flag (doubles effort in Listing phase)"}
                      className={`transition-colors rounded p-0.5 ${cat.flagged ? 'text-orange-400 hover:text-orange-300' : 'text-gray-700 hover:text-gray-500'}`}
                      data-testid={`flag-${cat.id}`}
                    >
                      <Flag className="w-3 h-3" fill={cat.flagged ? 'currentColor' : 'none'} />
                    </button>
                  </div>
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
        {sorted.length} categories · Scores update when phase assignments or flags change.
      </p>
    </div>
  );
}

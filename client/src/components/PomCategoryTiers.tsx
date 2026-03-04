import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { X, ChevronDown, ChevronUp, Search, Clock, CheckCircle2, AlertCircle, CircleDashed, FolderOpen, Wand2, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

interface Category {
  id: number;
  name: string;
  priorityTier: string;
}

interface CategoryFreshness {
  categoryId: number | null;
  categoryName: string;
  tier: string;
  totalLots: number;
  fetchedLots: number;
  neverFetched: number;
  coveragePct: number;
  lastFetchedAt: string | null;
  daysSince: number | null;
  status: 'fresh' | 'stale' | 'never';
  refreshDays: number;
}

interface TierSummary {
  totalLots: number;
  fetchedLots: number;
  coveragePct: number;
  freshCats: number;
  staleCats: number;
  neverCats: number;
  lastFetch: string | null;
  refreshDays: number;
}

interface FreshnessData {
  success: boolean;
  categories: CategoryFreshness[];
  tierSummary: Record<string, TierSummary>;
}

const ASSIGNED_TIERS = ['tier1', 'tier2', 'tier3', 'tier4'] as const;
type TierKey = typeof ASSIGNED_TIERS[number];

const TIER_CONFIG: Record<TierKey, {
  label: string; shortLabel: string; description: string;
  color: string; bg: string; badgeBg: string; dot: string; refreshLabel: string;
}> = {
  tier1: {
    label: "Tier 1 — High Volatility / High Margin",
    shortLabel: "Tier 1",
    description: "Minifigures, Bionicle, decorated & licensed parts.",
    color: "text-yellow-300",
    bg: "bg-yellow-500/10 border-yellow-500/30",
    badgeBg: "bg-yellow-500/20 text-yellow-200 border-yellow-500/40",
    dot: "bg-yellow-400",
    refreshLabel: "Daily refresh",
  },
  tier2: {
    label: "Tier 2 — Strong Demand Structural",
    shortLabel: "Tier 2",
    description: "Slopes, brackets, modified plates, Technic connectors & beams.",
    color: "text-blue-300",
    bg: "bg-blue-500/10 border-blue-500/30",
    badgeBg: "bg-blue-500/20 text-blue-200 border-blue-500/40",
    dot: "bg-blue-400",
    refreshLabel: "Every few days",
  },
  tier3: {
    label: "Tier 3 — Core Commodity",
    shortLabel: "Tier 3",
    description: "Basic bricks, plates, common tiles.",
    color: "text-gray-300",
    bg: "bg-gray-500/10 border-gray-600",
    badgeBg: "bg-gray-600/40 text-gray-300 border-gray-600",
    dot: "bg-gray-400",
    refreshLabel: "Weekly",
  },
  tier4: {
    label: "Tier 4 — Deep Inventory / Low Velocity",
    shortLabel: "Tier 4",
    description: "Zero or near-zero sales, high supply, legacy parts.",
    color: "text-slate-400",
    bg: "bg-slate-800/50 border-slate-700",
    badgeBg: "bg-slate-700/50 text-slate-400 border-slate-600",
    dot: "bg-slate-500",
    refreshLabel: "Monthly",
  },
};

const SHOW_LIMIT = 20;

function ageLabel(daysSince: number | null): string {
  if (daysSince === null) return 'unknown';
  if (daysSince === 0) return 'today';
  if (daysSince === 1) return '1 day ago';
  if (daysSince < 30) return `${daysSince} days ago`;
  const months = Math.round(daysSince / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

function freshnessDot(status: 'fresh' | 'stale' | 'never', daysSince: number | null, refreshDays: number) {
  const age = ageLabel(daysSince);
  if (status === 'fresh') return { color: "bg-green-400", label: `Fresh — last POM run ${age} · reprices every ${refreshDays}d` };
  if (status === 'stale') return { color: "bg-yellow-400", label: `Stale — last POM run ${age} (>6 months) · reprices every ${refreshDays}d` };
  return { color: "bg-red-400/70", label: "Never fetched by POM" };
}

function TierStatusBar({ summary, tier }: { summary: TierSummary; tier: TierKey }) {
  const cfg = TIER_CONFIG[tier];
  const total = summary.freshCats + summary.staleCats + summary.neverCats;
  if (total === 0) return null;

  const lastFetchLabel = summary.lastFetch
    ? (() => {
        const days = Math.floor((Date.now() - new Date(summary.lastFetch).getTime()) / 86400000);
        return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
      })()
    : "never";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
      <div className="flex items-center gap-1 text-[10px]">
        <CheckCircle2 className="w-3 h-3 text-green-400" />
        <span className="text-green-400">{summary.freshCats} fresh</span>
      </div>
      <div className="flex items-center gap-1 text-[10px]">
        <AlertCircle className="w-3 h-3 text-yellow-400" />
        <span className="text-yellow-400">{summary.staleCats} stale</span>
      </div>
      <div className="flex items-center gap-1 text-[10px]">
        <CircleDashed className="w-3 h-3 text-red-400/70" />
        <span className="text-red-400/70">{summary.neverCats} never run</span>
      </div>
      <div className="flex items-center gap-1 text-[10px] text-gray-500 ml-auto">
        <Clock className="w-3 h-3" />
        <span>Last run: {lastFetchLabel}</span>
      </div>
      {summary.coveragePct > 0 && (
        <div className="w-full mt-1">
          <div className="flex justify-between text-[9px] text-gray-600 mb-0.5">
            <span>Price guide coverage</span>
            <span>{summary.coveragePct}%</span>
          </div>
          <div className="w-full h-1 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${summary.coveragePct >= 80 ? 'bg-green-500' : summary.coveragePct >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
              style={{ width: `${summary.coveragePct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function UnassignedSection({
  categories,
  freshnessMap,
  onAssign,
}: {
  categories: Category[];
  freshnessMap: Map<number, CategoryFreshness>;
  onAssign: (categoryId: number, toTier: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? categories : categories.slice(0, SHOW_LIMIT);
  const hiddenCount = categories.length - SHOW_LIMIT;

  if (categories.length === 0) return null;

  return (
    <div className="border rounded-md p-4 space-y-3 bg-amber-950/20 border-amber-700/40">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <h4 className="text-xs font-semibold text-amber-300">Unassigned — Needs Tier</h4>
          </div>
          <p className="text-[10px] text-gray-500 mt-0.5 ml-5">
            New categories from BrickLink sync. Assign each to a tier so Price-o-Matic knows how often to refresh them.
          </p>
        </div>
        <Badge variant="outline" className="text-[10px] border bg-amber-500/20 text-amber-200 border-amber-500/40 shrink-0 self-start">
          {categories.length} unassigned
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {displayed.map((cat) => {
          const fresh = freshnessMap.get(cat.id);
          const dot = fresh ? freshnessDot(fresh.status, fresh.daysSince, fresh.refreshDays) : null;
          return (
            <UnassignedCategoryPill
              key={cat.id}
              cat={cat}
              fresh={fresh ?? null}
              dot={dot}
              onAssign={onAssign}
            />
          );
        })}
      </div>

      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          data-testid="toggle-show-all-unassigned"
        >
          {showAll ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {showAll ? "Show less" : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}

function UnassignedCategoryPill({
  cat,
  fresh,
  dot,
  onAssign,
}: {
  cat: Category;
  fresh: CategoryFreshness | null;
  dot: { color: string; label: string } | null;
  onAssign: (categoryId: number, toTier: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <span
              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border cursor-pointer bg-amber-500/10 text-amber-200 border-amber-500/30 hover:bg-amber-500/20 transition-colors"
              data-testid={`unassigned-cat-${cat.id}`}
            >
              {dot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot.color}`} />}
              {cat.name}
              <ChevronDown className="w-2.5 h-2.5 opacity-60" />
            </span>
          </PopoverTrigger>
        </TooltipTrigger>
        {dot && fresh && (
          <TooltipContent side="top" className="text-[10px] max-w-48">
            <p className="font-medium">{cat.name}</p>
            <p>{dot.label}</p>
            <p className="text-gray-400">{fresh.fetchedLots} / {fresh.totalLots} lots priced ({fresh.coveragePct}%)</p>
          </TooltipContent>
        )}
      </Tooltip>
      <PopoverContent className="w-44 p-1 bg-gray-900 border-gray-700" align="start">
        <p className="text-[9px] text-gray-500 px-2 py-1">Assign to tier:</p>
        {ASSIGNED_TIERS.map((t) => {
          const cfg = TIER_CONFIG[t];
          return (
            <button
              key={t}
              className="w-full text-left text-[10px] px-2 py-1.5 rounded hover:bg-gray-800 text-gray-300 flex items-center gap-2 transition-colors"
              onClick={() => { onAssign(cat.id, t); setOpen(false); }}
              data-testid={`assign-${cat.id}-${t}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
              {cfg.shortLabel}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function TierSection({
  tier,
  categories,
  allCategories,
  freshnessMap,
  tierSummary,
  onMove,
}: {
  tier: TierKey;
  categories: Category[];
  allCategories: Category[];
  freshnessMap: Map<number, CategoryFreshness>;
  tierSummary: TierSummary | undefined;
  onMove: (categoryId: number, toTier: string) => void;
}) {
  const cfg = TIER_CONFIG[tier];
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const displayed = showAll ? categories : categories.slice(0, SHOW_LIMIT);
  const hiddenCount = categories.length - SHOW_LIMIT;

  const available = useMemo(
    () => allCategories.filter((c) => c.priorityTier !== tier).sort((a, b) => a.name.localeCompare(b.name)),
    [allCategories, tier]
  );

  return (
    <div className={`border rounded-md p-4 space-y-3 ${cfg.bg}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
            <h4 className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</h4>
          </div>
          <p className="text-[10px] text-gray-500 mt-0.5 ml-4">{cfg.description}</p>
          {tierSummary && <div className="ml-4"><TierStatusBar summary={tierSummary} tier={tier} /></div>}
        </div>
        <Badge variant="outline" className={`text-[10px] border ${cfg.badgeBg} shrink-0 self-start`}>
          {categories.length} categories
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {displayed.map((cat) => {
          const fresh = freshnessMap.get(cat.id);
          const dot = fresh ? freshnessDot(fresh.status, fresh.daysSince, fresh.refreshDays) : null;
          return (
            <Tooltip key={cat.id}>
              <TooltipTrigger asChild>
                <span
                  className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border cursor-default ${cfg.badgeBg}`}
                  data-testid={`tier-cat-${cat.id}`}
                >
                  {dot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot.color}`} />}
                  {cat.name}
                  {fresh && (
                    <span className="text-gray-600 text-[9px]">
                      ({fresh.coveragePct}%)
                    </span>
                  )}
                  <button
                    onClick={() => onMove(cat.id, 'standard')}
                    className="opacity-40 hover:opacity-100 transition-opacity ml-0.5 flex-shrink-0"
                    title="Remove — move back to Unassigned"
                    data-testid={`remove-cat-${cat.id}`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              </TooltipTrigger>
              {dot && fresh && (
                <TooltipContent side="top" className="text-[10px] max-w-48">
                  <p className="font-medium">{cat.name}</p>
                  <p>{dot.label}</p>
                  <p className="text-gray-400">{fresh.fetchedLots} / {fresh.totalLots} lots priced ({fresh.coveragePct}%)</p>
                  {fresh.neverFetched > 0 && <p className="text-red-400">{fresh.neverFetched} lots never fetched</p>}
                  <p className="text-gray-500 mt-1">Click × to move back to Unassigned</p>
                </TooltipContent>
              )}
            </Tooltip>
          );
        })}
        {categories.length === 0 && (
          <span className="text-[10px] text-gray-600 italic">No categories assigned — use the button below to add some</span>
        )}
      </div>

      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          data-testid={`toggle-show-all-${tier}`}
        >
          {showAll ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {showAll ? "Show less" : `Show ${hiddenCount} more`}
        </button>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="text-[10px] h-7 border-gray-600 text-gray-400 hover:text-gray-200"
            data-testid={`add-to-${tier}`}
          >
            <Search className="w-3 h-3 mr-1" />
            Add to {cfg.shortLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0 bg-gray-900 border-gray-700" align="start">
          <Command className="bg-transparent">
            <CommandInput placeholder="Search categories..." className="text-xs" />
            <CommandList className="max-h-52">
              <CommandEmpty className="text-xs text-gray-500 py-3 text-center">No categories found</CommandEmpty>
              <CommandGroup>
                {available.map((cat) => {
                  const fresh = freshnessMap.get(cat.id);
                  const dot = fresh ? freshnessDot(fresh.status, fresh.daysSince, fresh.refreshDays) : null;
                  const fromTier = ASSIGNED_TIERS.includes(cat.priorityTier as TierKey)
                    ? TIER_CONFIG[cat.priorityTier as TierKey]?.shortLabel
                    : "Unassigned";
                  return (
                    <CommandItem
                      key={cat.id}
                      value={cat.name}
                      onSelect={() => {
                        onMove(cat.id, tier);
                        setOpen(false);
                      }}
                      className="text-xs text-gray-300 cursor-pointer"
                      data-testid={`search-cat-${cat.id}`}
                    >
                      {dot && <span className={`w-1.5 h-1.5 rounded-full mr-1.5 flex-shrink-0 ${dot.color}`} />}
                      {!dot && <span className="w-1.5 h-1.5 rounded-full mr-1.5 flex-shrink-0 bg-amber-400/50" />}
                      <span className="flex-1">{cat.name}</span>
                      <span className="ml-2 text-[9px] text-gray-600 flex-shrink-0">{fromTier}</span>
                      {fresh && (
                        <span className={`ml-1 text-[9px] flex-shrink-0 ${fresh.coveragePct === 0 ? 'text-red-400/70' : fresh.coveragePct < 50 ? 'text-yellow-400' : 'text-green-400'}`}>
                          {fresh.coveragePct}%
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface TierResetResult {
  success: boolean;
  changed: number;
  unchanged: number;
  summary: Record<string, number>;
}

export function PomCategoryTiers() {
  const { toast } = useToast();
  const [showTierResetConfirm, setShowTierResetConfirm] = useState(false);

  const { data: tiersData, isLoading: tiersLoading } = useQuery<{ success: boolean; categories: Category[] }>({
    queryKey: ["/api/priceomatic/category-tiers"],
  });

  const { data: freshnessData, isLoading: freshnessLoading } = useQuery<FreshnessData>({
    queryKey: ["/api/priceomatic/freshness"],
  });

  const moveMutation = useMutation({
    mutationFn: async ({ categoryId, tier }: { categoryId: number; tier: string }) => {
      const res = await fetch("/api/priceomatic/category-tier", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, tier }),
      });
      if (!res.ok) throw new Error("Failed to update tier");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/priceomatic/category-tiers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/priceomatic/freshness"] });
    },
  });

  const tierResetMutation = useMutation<TierResetResult>({
    mutationFn: () => apiRequest("POST", "/api/priceomatic/tier-reset"),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/priceomatic/category-tiers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/priceomatic/freshness"] });
      toast({
        title: "Tier Reset Complete",
        description: `${data.changed} categories reassigned (${data.unchanged} unchanged). T1: ${data.summary.tier1 ?? 0} · T2: ${data.summary.tier2 ?? 0} · T3: ${data.summary.tier3 ?? 0} · T4: ${data.summary.tier4 ?? 0}`,
      });
    },
    onError: () => toast({ title: "Tier reset failed", variant: "destructive" }),
  });

  const categories = tiersData?.categories ?? [];

  const freshnessMap = useMemo(() => {
    const map = new Map<number, CategoryFreshness>();
    for (const cat of freshnessData?.categories ?? []) {
      if (cat.categoryId !== null) map.set(cat.categoryId, cat);
    }
    return map;
  }, [freshnessData]);

  const { byTier, unassigned } = useMemo(() => {
    const grouped: Record<TierKey, Category[]> = { tier1: [], tier2: [], tier3: [], tier4: [] };
    const unassigned: Category[] = [];
    for (const cat of categories) {
      const t = cat.priorityTier as TierKey;
      if (ASSIGNED_TIERS.includes(t)) {
        grouped[t].push(cat);
      } else {
        unassigned.push(cat);
      }
    }
    for (const t of ASSIGNED_TIERS) grouped[t].sort((a, b) => a.name.localeCompare(b.name));
    unassigned.sort((a, b) => a.name.localeCompare(b.name));
    return { byTier: grouped, unassigned };
  }, [categories]);

  const isLoading = tiersLoading || freshnessLoading;

  if (isLoading) {
    return <div className="text-xs text-gray-500 py-4 text-center">Loading category data...</div>;
  }

  return (
    <div className="space-y-3">
      {/* Header row: legend + tier reset */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-[10px] text-gray-500 flex-1 flex-wrap">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Fresh</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400" /> Stale</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400/70" /> Never run</span>
          <span className="text-gray-600">· % = lots with price data</span>
        </div>
        <Popover>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="text-[10px] h-7 border-purple-700/60 text-purple-300 hover:text-purple-100 gap-1.5"
              onClick={() => setShowTierResetConfirm(true)}
              disabled={tierResetMutation.isPending}
              data-testid="button-tier-reset"
            >
              <Wand2 className={`w-3 h-3 ${tierResetMutation.isPending ? 'animate-spin' : ''}`} />
              {tierResetMutation.isPending ? 'Resetting...' : 'Auto-Assign Tiers'}
            </Button>
            <PopoverTrigger asChild>
              <button className="text-gray-600 hover:text-gray-300 transition-colors" data-testid="button-tier-reset-info">
                <Info className="w-3.5 h-3.5" />
              </button>
            </PopoverTrigger>
          </div>
          <PopoverContent side="left" className="w-72 text-xs bg-gray-900 border-gray-700 p-3 space-y-1.5">
            <p className="font-semibold text-gray-200">Auto-Assign Tier Rules</p>
            <p className="text-gray-400">Reassigns every category based on name keywords. Your manual overrides will be replaced. Rules applied in order:</p>
            <ul className="space-y-1 text-gray-300 mt-1">
              <li><span className="text-yellow-300 font-medium">Tier 1</span> — Minifig, Bionicle, Large Figure, Collectible</li>
              <li><span className="text-blue-300 font-medium">Tier 2</span> — Technic, Slope, Modified, Bracket, Electric, Motor, Window, Train, Vehicle</li>
              <li><span className="text-gray-300 font-medium">Tier 3</span> — Brick, Plate, Tile, Bar, Wedge, Panel (commodity core)</li>
              <li><span className="text-slate-400 font-medium">Tier 4</span> — Sticker, Book, Magazine, Instruction, Display</li>
              <li><span className="text-gray-500 font-medium">Default</span> — Tier 3 for anything not matched above</li>
            </ul>
          </PopoverContent>
        </Popover>
      </div>

      <UnassignedSection
        categories={unassigned}
        freshnessMap={freshnessMap}
        onAssign={(categoryId, toTier) => moveMutation.mutate({ categoryId, tier: toTier })}
      />

      {ASSIGNED_TIERS.map((tier) => (
        <TierSection
          key={tier}
          tier={tier}
          categories={byTier[tier]}
          allCategories={categories}
          freshnessMap={freshnessMap}
          tierSummary={freshnessData?.tierSummary?.[tier]}
          onMove={(categoryId, toTier) => moveMutation.mutate({ categoryId, tier: toTier })}
        />
      ))}

      <AlertDialog open={showTierResetConfirm} onOpenChange={setShowTierResetConfirm}>
        <AlertDialogContent className="bg-gray-900 border-gray-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-gray-100">Auto-Assign Tiers</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              This will reassign every category based on keyword rules and overwrite any manual tier assignments you have made. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-gray-600 text-gray-300" data-testid="button-tier-reset-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-purple-700 hover:bg-purple-600 text-white"
              onClick={() => tierResetMutation.mutate()}
              data-testid="button-tier-reset-confirm"
            >
              Auto-Assign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

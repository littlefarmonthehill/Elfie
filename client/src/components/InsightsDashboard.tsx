import { useState, ComponentType } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, parseISO } from "date-fns";
import {
  Newspaper, Radio, Radar, BarChart2, AlertTriangle,
  Activity, Signal, DollarSign, EyeOff, ExternalLink, X,
  Antenna, Settings, RefreshCw, Rocket, Star, Zap, Target, ChevronDown,
  ChevronUp, ArrowRight, Sparkles, Layers, Crosshair, Archive, Compass,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarketIntelData {
  forum: {
    count: number;
    posts: Array<{
      threadId: string | null;
      title: string;
      excerpt: string | null;
      username: string;
      postedAt: string | null;
      threadUrl: string | null;
    }>;
  };
  news: {
    count: number;
    articles: Array<{
      title: string;
      snippet: string | null;
      url: string;
      source: string | null;
      query: string | null;
      fetchedAt: string;
    }>;
  };
}

interface BusinessInsight {
  id: string;
  category: string;
  urgency: string;
  title: string;
  summary: string;
  createdAt: string;
}

interface IEStrategies {
  visionMission: string | null;
  successFactors: string | null;
  pricingStrategy: string | null;
  inventoryStrategy: string | null;
  ordersStrategy: string | null;
  customerStrategy: string | null;
  marketStrategy: string | null;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STRATEGY_AREAS = [
  {
    key: 'pricing',
    label: 'Pricing',
    icon: DollarSign,
    color: 'text-yellow-400',
    bg: 'bg-yellow-900/20',
    border: 'border-yellow-500/30',
    ring: 'ring-yellow-500/40',
    categories: ['pricing'],
    stratField: 'pricingStrategy' as keyof IEStrategies,
  },
  {
    key: 'inventory',
    label: 'Inventory',
    icon: Layers,
    color: 'text-blue-400',
    bg: 'bg-blue-900/20',
    border: 'border-blue-500/30',
    ring: 'ring-blue-500/40',
    categories: ['acquisition', 'overstock', 'restock'],
    stratField: 'inventoryStrategy' as keyof IEStrategies,
  },
  {
    key: 'orders',
    label: 'Orders',
    icon: Rocket,
    color: 'text-orange-400',
    bg: 'bg-orange-900/20',
    border: 'border-orange-500/30',
    ring: 'ring-orange-500/40',
    categories: ['velocity', 'channel'],
    stratField: 'ordersStrategy' as keyof IEStrategies,
  },
  {
    key: 'customer',
    label: 'Customer',
    icon: Crosshair,
    color: 'text-cyan-400',
    bg: 'bg-cyan-900/20',
    border: 'border-cyan-500/30',
    ring: 'ring-cyan-500/40',
    categories: ['new_customer', 'top_spender', 'dormant'],
    stratField: 'customerStrategy' as keyof IEStrategies,
  },
  {
    key: 'market',
    label: 'Market',
    icon: BarChart2,
    color: 'text-green-400',
    bg: 'bg-green-900/20',
    border: 'border-green-500/30',
    ring: 'ring-green-500/40',
    categories: ['revenue'],
    stratField: 'marketStrategy' as keyof IEStrategies,
  },
] as const;

const URGENCY_CONFIG = {
  high: {
    label: 'Urgent',
    color: 'text-red-300',
    bg: 'bg-red-900/30',
    border: 'border-red-500/40',
    glow: 'shadow-[0_0_12px_rgba(239,68,68,0.15)]',
    dot: 'bg-red-400',
    bar: 'bg-red-500',
  },
  medium: {
    label: 'Notable',
    color: 'text-amber-300',
    bg: 'bg-amber-900/20',
    border: 'border-amber-500/30',
    glow: '',
    dot: 'bg-amber-400',
    bar: 'bg-amber-500',
  },
  low: {
    label: 'Info',
    color: 'text-green-300',
    bg: 'bg-green-900/10',
    border: 'border-green-700/30',
    glow: '',
    dot: 'bg-green-500',
    bar: 'bg-green-600',
  },
} as const;

const CATEGORY_ICON: Record<string, React.ElementType> = {
  pricing: DollarSign,
  acquisition: Crosshair,
  overstock: Archive,
  restock: AlertTriangle,
  revenue: BarChart2,
  velocity: Zap,
  channel: Signal,
  new_customer: Compass,
  top_spender: Star,
  dormant: EyeOff,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true });
  } catch {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch {
      return '';
    }
  }
}

function cleanTitle(title: string): string {
  return title.replace(/^Re:\s*/i, '').trim();
}

function getStrategyAreaForCategory(cat: string) {
  return STRATEGY_AREAS.find(s => (s.categories as readonly string[]).includes(cat));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  count,
  unit,
  accent,
}: {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  label: string;
  count?: number;
  unit?: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <div className={cn("rounded-md p-1.5 ring-1 shrink-0", iconBg)}>
        <Icon className={cn("w-3.5 h-3.5", iconColor)} />
      </div>
      <div className="flex-1 min-w-0">
        <span className={cn("text-xs font-bold uppercase tracking-widest", accent ?? "text-gray-200")}>{label}</span>
        {count !== undefined && (
          <span className="ml-2 text-[10px] text-gray-600 font-mono">{count} {unit}</span>
        )}
      </div>
    </div>
  );
}

function HScrollSkeleton() {
  return (
    <div className="flex gap-2.5 overflow-hidden">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="flex-shrink-0 w-[220px] h-[110px] rounded-xl border border-gray-700/40 bg-gray-900/50 animate-pulse" />
      ))}
    </div>
  );
}

function EmptyHScroll({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="rounded-xl border border-gray-700/30 bg-gray-900/30 p-4 flex items-center gap-3">
      <div className="rounded-full bg-gray-800/60 p-2 ring-1 ring-gray-700/40 shrink-0">
        <Icon className="w-4 h-4 text-gray-600" />
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">{message}</p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface InsightsDashboardProps {
  onOpenSettings?: (section?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'billing' | 'priceomatic') => void;
  compact?: boolean;
}

interface StrategyModalData {
  label: string;
  text: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  border: string;
  ring: string;
}

export default function InsightsDashboard({ onOpenSettings, compact }: InsightsDashboardProps) {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [strategyModal, setStrategyModal] = useState<StrategyModalData | null>(null);
  const [visionExpanded, setVisionExpanded] = useState(false);

  const {
    data: marketIntel,
    isLoading: intelLoading,
    refetch: refetchIntel,
    isFetching: intelFetching,
  } = useQuery<MarketIntelData>({
    queryKey: ['/api/market-intel/recent'],
  });

  const { data: insights = [], isLoading: insightsLoading, refetch: refetchInsights } = useQuery<BusinessInsight[]>({
    queryKey: ['/api/business-intel'],
  });

  const { data: strategies } = useQuery<IEStrategies>({
    queryKey: ['/api/ie-strategies'],
  });

  const { data: forumSummaryData, isLoading: forumSummaryLoading } = useQuery<{ descriptions: Record<string, string> }>({
    queryKey: ['/api/market-intel/forum-summary'],
    staleTime: 15 * 60 * 1000,
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/api/business-intel/${id}/dismiss`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/business-intel'] }),
  });

  const handleRefresh = () => {
    refetchIntel();
    refetchInsights();
  };

  // ── Compute signal counts per strategy area ─────────────────────────────────
  const areaCounts = STRATEGY_AREAS.map(area => ({
    ...area,
    total: insights.filter(i => (area.categories as readonly string[]).includes(i.category)).length,
    urgent: insights.filter(i => (area.categories as readonly string[]).includes(i.category) && i.urgency === 'high').length,
  }));

  // ── Filter + sort insights by active strategy area ──────────────────────────
  const filteredInsights = activeFilter
    ? insights.filter(i => {
        const area = STRATEGY_AREAS.find(s => s.key === activeFilter);
        return (area?.categories as readonly string[] | undefined)?.includes(i.category);
      })
    : insights;

  const sortedInsights = [...filteredInsights].sort((a, b) => {
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return (order[a.urgency] ?? 2) - (order[b.urgency] ?? 2);
  });

  const totalSignals = insights.length;
  const urgentCount = insights.filter(i => i.urgency === 'high').length;
  const activeArea = activeFilter ? STRATEGY_AREAS.find(s => s.key === activeFilter) : null;
  const activeStratText = activeArea ? (strategies?.[activeArea.stratField] ?? null) : null;

  const articles = marketIntel?.news?.articles ?? [];
  const posts = marketIntel?.forum?.posts ?? [];

  return (
    <div className={cn("h-full overflow-y-auto", compact ? "p-1.5 space-y-3" : "p-2 md:p-3 space-y-4")}>

      {/* ═══════════════════════════════════════════════════════════════════
          TOP METRIC CARD — title + strategy filters
      ═══════════════════════════════════════════════════════════════════ */}
      <div
        className={cn("relative rounded-lg border border-green-400/65 shadow-[0_0_30px_rgba(34,197,94,0.22)] overflow-hidden", compact ? "p-2" : "p-2 md:p-3")}
        style={{ background: 'linear-gradient(175deg, #071a0f 0%, #050d08 100%)' }}
        data-testid="section-insights-overview"
      >
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-green-300/85 to-transparent" />
        <div className={cn("flex items-center", compact ? "gap-1.5 mb-1.5" : "gap-2 mb-2")}>
          <div className={cn("rounded-md bg-green-900/60 ring-1 ring-green-500/50 shadow-[0_0_10px_rgba(34,197,94,0.25)] shrink-0", compact ? "p-1.5" : "p-1.5")}>
            <Radio className={cn("text-green-200", compact ? "w-3.5 h-3.5" : "w-3 h-3 md:w-4 md:h-4")} />
          </div>
          <h3 className={cn("font-semibold text-green-200 uppercase tracking-wide min-w-0", compact ? "text-xs" : "text-xs md:text-sm")}>Insights</h3>
          {urgentCount > 0 && (
            <span
              className="ml-1 inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-900/50 text-red-300 border border-red-500/40 animate-pulse"
              data-testid="badge-urgent-count"
            >
              <Zap className="w-2 h-2" />
              {urgentCount}
            </span>
          )}
          <div className="ml-auto">
            <Button
              size="icon"
              variant="ghost"
              onClick={handleRefresh}
              disabled={intelFetching}
              data-testid="button-refresh-insights"
              className="text-gray-600"
            >
              <RefreshCw className={cn("w-3 h-3", intelFetching && "animate-spin")} />
            </Button>
          </div>
        </div>
        {/* Strategy filter cells */}
        <div className="grid grid-cols-5 gap-1.5" data-testid="section-strategy-lens">
          {areaCounts.map(area => {
            const isActive = activeFilter === area.key;
            const Icon = area.icon;
            return (
              <button
                key={area.key}
                onClick={() => setActiveFilter(isActive ? null : area.key)}
                data-testid={`filter-strategy-${area.key}`}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border py-2 px-1 transition-all hover-elevate active-elevate-2 text-center",
                  isActive
                    ? `${area.bg} ${area.border} ring-1 ${area.ring}`
                    : "border-gray-700/40 bg-gray-900/60"
                )}
              >
                <div className={cn("flex items-center justify-center gap-1", isActive ? area.color : "text-gray-600")}>
                  <Icon className="w-3 h-3 shrink-0" />
                  {area.total > 0 && (
                    <span className={cn("text-[11px] font-bold", area.urgent > 0 ? 'text-red-400' : (isActive ? area.color : 'text-gray-500'))}>
                      {area.total}
                    </span>
                  )}
                </div>
                <span className={cn("text-[9px] font-bold uppercase tracking-wide leading-tight", isActive ? area.color : "text-gray-600")}>
                  {area.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          VISION & MISSION — collapsible, default collapsed
      ═══════════════════════════════════════════════════════════════════ */}
      {strategies?.visionMission && (
        <div
          className="rounded-xl border border-green-500/15 bg-green-950/20 overflow-hidden"
          data-testid="section-vision-mission"
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-2 hover-elevate active-elevate-2"
            onClick={() => setVisionExpanded(v => !v)}
            data-testid="button-vision-toggle"
          >
            <div className="rounded-md bg-green-900/50 ring-1 ring-green-400/25 p-1.5 shrink-0">
              <Target className="w-3.5 h-3.5 text-green-300" />
            </div>
            <p className="text-[10px] font-bold text-green-400 uppercase tracking-wider flex-1 text-left">Vision & Mission</p>
            {visionExpanded
              ? <ChevronUp className="w-3.5 h-3.5 text-green-500/60 shrink-0" />
              : <ChevronDown className="w-3.5 h-3.5 text-green-500/60 shrink-0" />}
          </button>
          {visionExpanded && (
            <div className="px-3 pb-3 -mt-0.5">
              <p className="text-xs text-gray-400 leading-relaxed">{strategies.visionMission}</p>
            </div>
          )}
        </div>
      )}

      {/* Strategy context banner */}
      {activeArea && (
        <div
          className={cn("rounded-xl border p-3", activeArea.bg, activeArea.border)}
          data-testid="section-strategy-context"
        >
          <div className="flex items-start gap-2.5">
            <div className={cn("rounded-md p-1.5 shrink-0", activeArea.bg, "ring-1", activeArea.ring)}>
              <activeArea.icon className={cn("w-3.5 h-3.5", activeArea.color)} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={cn("text-xs font-bold", activeArea.color)}>{activeArea.label} Strategy</span>
                {(areaCounts.find(a => a.key === activeFilter)?.urgent ?? 0) > 0 && (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                    {areaCounts.find(a => a.key === activeFilter)?.urgent} urgent
                  </Badge>
                )}
              </div>
              {activeStratText ? (
                <div>
                  <p className="text-xs text-gray-300 leading-relaxed">
                    {activeStratText.length > 120 ? activeStratText.slice(0, 120) + '…' : activeStratText}
                  </p>
                  {activeStratText.length > 120 && activeArea && (
                    <button
                      className="mt-1 text-[10px] font-semibold underline underline-offset-2 hover-elevate rounded"
                      style={{ color: 'inherit' }}
                      onClick={() => setStrategyModal({
                        label: activeArea.label,
                        text: activeStratText,
                        icon: activeArea.icon,
                        color: activeArea.color,
                        bg: activeArea.bg,
                        border: activeArea.border,
                        ring: activeArea.ring,
                      })}
                      data-testid="button-strategy-read-more"
                    >
                      Read full strategy
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs text-gray-500 flex-1 min-w-0">
                    No strategy defined for this area yet.
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs gap-1.5 text-gray-500 shrink-0"
                    onClick={() => onOpenSettings?.('ai')}
                    data-testid="button-set-strategy"
                  >
                    <Settings className="w-3 h-3" />
                    Set strategy
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          STRATEGY — horizontal scroll carousel
      ═══════════════════════════════════════════════════════════════════ */}
      <section data-testid="zone-strategy-intel">
        <SectionTitle
          icon={Radar}
          iconBg="bg-cyan-900/50 ring-cyan-400/30"
          iconColor="text-cyan-300"
          label="Strategy"
          accent="text-cyan-200"
        />

        {insightsLoading ? (
          <div className="flex gap-2.5 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} className="rounded-xl border border-gray-700/40 bg-gray-900/50 p-3 animate-pulse flex-shrink-0 w-[220px]">
                <div className="h-1 bg-gray-700/50 rounded w-full mb-2.5" />
                <div className="h-3 bg-gray-700/50 rounded w-1/2 mb-1.5" />
                <div className="h-3 bg-gray-700/50 rounded w-3/4 mb-1" />
                <div className="h-2.5 bg-gray-800/50 rounded w-full" />
              </div>
            ))}
          </div>
        ) : sortedInsights.length === 0 ? (
          <div className="rounded-xl border border-gray-700/30 bg-gray-900/30 p-5 flex flex-col items-center gap-2.5 text-center">
            <div className="rounded-full bg-gray-800/60 p-2.5 ring-1 ring-gray-700/40">
              <Radar className="w-4 h-4 text-gray-600" />
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              {activeFilter
                ? "No signals for this strategy area right now."
                : "No active signals yet. Business Intel generates AI-powered insights about your operations."}
            </p>
            {!activeFilter && (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs gap-1.5 text-gray-500"
                onClick={() => onOpenSettings?.('automation')}
                data-testid="button-empty-settings"
              >
                <Settings className="w-3 h-3" />
                Open automation settings
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex gap-2.5 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1">
              {sortedInsights.map((insight, i) => {
                const urgency = URGENCY_CONFIG[insight.urgency as keyof typeof URGENCY_CONFIG] ?? URGENCY_CONFIG.low;
                const CatIcon = CATEGORY_ICON[insight.category] ?? Target;
                const isLead = i === 0 && urgentCount > 0 && insight.urgency === 'high';

                return (
                  <div
                    key={insight.id}
                    data-testid={`insight-card-${insight.id}`}
                    className={cn(
                      "rounded-xl border p-2.5 flex flex-col gap-1.5 transition-all flex-shrink-0 w-[220px]",
                      urgency.bg,
                      urgency.border,
                      isLead && urgency.glow,
                    )}
                  >
                    {/* Top accent bar */}
                    <div className={cn("h-0.5 rounded-full -mx-0.5", urgency.bar)} />

                    {/* Icon + urgency */}
                    <div className="flex items-center gap-1.5">
                      <div className={cn("rounded p-1 shrink-0", urgency.bg, "ring-1", urgency.border)}>
                        <CatIcon className={cn("w-2.5 h-2.5", urgency.color)} />
                      </div>
                      <div className="flex items-center gap-1 min-w-0">
                        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", urgency.dot, isLead && "animate-pulse")} />
                        <span className={cn("text-[9px] font-bold uppercase tracking-wide truncate", urgency.color)}>
                          {urgency.label}
                        </span>
                        {isLead && (
                          <span className="text-[9px] font-bold px-1 py-0 rounded-full bg-white/8 text-gray-300 border border-white/15 shrink-0 hidden sm:block">
                            Lead
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Title */}
                    <p className="text-[11px] font-bold text-gray-100 leading-snug line-clamp-3 flex-1">
                      {insight.title}
                    </p>

                    {/* Summary */}
                    <p className="text-[10px] text-gray-500 leading-relaxed line-clamp-2">
                      {insight.summary}
                    </p>

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-1 border-t border-white/5">
                      <span className="text-[9px] text-gray-600">{timeAgo(insight.createdAt)}</span>
                      <button
                        onClick={() => dismissMutation.mutate(insight.id)}
                        disabled={dismissMutation.isPending}
                        className="text-gray-600 hover-elevate p-0.5 rounded"
                        data-testid={`button-dismiss-${insight.id}`}
                        title="Dismiss signal"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

          </>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          NEWS — horizontal scroll carousel
      ═══════════════════════════════════════════════════════════════════ */}
      <section data-testid="zone-market-wire">
        <SectionTitle
          icon={Newspaper}
          iconBg="bg-blue-900/50 ring-blue-400/30"
          iconColor="text-blue-300"
          label="News"
          accent="text-blue-200"
        />
        {intelLoading ? (
          <HScrollSkeleton />
        ) : articles.length === 0 ? (
          <EmptyHScroll
            icon={Newspaper}
            message="No recent market articles found. Articles are fetched periodically — try refreshing, or check that the market news sync is scheduled."
          />
        ) : (
          <div className="flex gap-2.5 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1">
            {articles.map((article, i) => (
              <a
                key={i}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`article-news-${i}`}
                className="flex-shrink-0 w-[230px] rounded-xl border border-gray-700/50 bg-gray-900/70 p-3 hover-elevate active-elevate-2 transition-all group flex flex-col"
              >
                {/* Source badge */}
                <div className="flex items-center justify-between mb-2">
                  {article.source ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/50 text-blue-400 border border-blue-700/30 font-semibold truncate max-w-[140px]">
                      {article.source}
                    </span>
                  ) : <span />}
                  <ExternalLink className="w-3 h-3 text-gray-600 group-hover:text-blue-400 shrink-0 transition-colors" />
                </div>
                {/* Title */}
                <p className="text-xs font-bold text-gray-100 leading-snug group-hover:text-blue-200 transition-colors line-clamp-3 flex-1">
                  {article.title}
                </p>
                {/* Snippet */}
                {article.snippet && (
                  <p className="text-[10px] text-gray-500 mt-1.5 leading-relaxed line-clamp-2">
                    {article.snippet}
                  </p>
                )}
                {/* Footer */}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-700/40">
                  <span className="text-[10px] text-gray-600">{timeAgo(article.fetchedAt)}</span>
                  {article.query && (
                    <span className="text-[9px] text-gray-700 italic truncate max-w-[100px]">{article.query}</span>
                  )}
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          FORUM — horizontal scroll carousel
      ═══════════════════════════════════════════════════════════════════ */}
      <section data-testid="zone-forum-pulse">
        <SectionTitle
          icon={Antenna}
          iconBg="bg-purple-900/50 ring-purple-400/30"
          iconColor="text-purple-300"
          label="Forum"
          accent="text-purple-200"
        />

        {intelLoading ? (
          <HScrollSkeleton />
        ) : posts.length === 0 ? (
          <EmptyHScroll
            icon={Antenna}
            message="No recent BrickLink forum topics found. Topics are fetched periodically — try refreshing."
          />
        ) : (
          <div className="flex gap-2.5 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1">
            {posts.map((post, i) => (
              <a
                key={i}
                href={post.threadUrl ?? '#'}
                target={post.threadUrl ? '_blank' : undefined}
                rel="noopener noreferrer"
                data-testid={`post-forum-${i}`}
                className="flex-shrink-0 w-[210px] rounded-xl border border-gray-700/50 bg-gray-900/70 p-3 hover-elevate active-elevate-2 transition-all group flex flex-col"
              >
                {/* User + time */}
                <div className="flex items-center justify-between mb-2 gap-1">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-900/50 text-purple-400 border border-purple-700/30 font-semibold truncate max-w-[120px]">
                    {post.username && post.username.toLowerCase() !== 'unknown' ? post.username : 'BrickLink'}
                  </span>
                  <span className="text-[10px] text-gray-600 shrink-0">{timeAgo(post.postedAt)}</span>
                </div>
                {/* Title — Re: stripped */}
                <p className="text-xs font-bold text-gray-100 leading-snug group-hover:text-purple-200 transition-colors line-clamp-2 flex-1">
                  {cleanTitle(post.title)}
                </p>
                {/* AI description */}
                {forumSummaryLoading ? (
                  <div className="mt-1.5 space-y-1">
                    <div className="h-2 bg-purple-900/30 rounded animate-pulse w-full" />
                    <div className="h-2 bg-purple-900/30 rounded animate-pulse w-3/4" />
                  </div>
                ) : (forumSummaryData?.descriptions?.[post.threadId ?? '']) ? (
                  <div className="mt-1.5 flex items-start gap-1">
                    <Sparkles className="w-2.5 h-2.5 text-purple-500 mt-0.5 shrink-0" />
                    <p className="text-[10px] text-gray-400 leading-relaxed line-clamp-2">
                      {forumSummaryData.descriptions[post.threadId ?? '']}
                    </p>
                  </div>
                ) : post.excerpt ? (
                  <p className="text-[10px] text-gray-500 mt-1.5 leading-relaxed line-clamp-2">
                    {post.excerpt}
                  </p>
                ) : null}
                {/* Footer */}
                <div className="flex items-center justify-end mt-2 pt-2 border-t border-gray-700/40">
                  <ExternalLink className="w-2.5 h-2.5 text-gray-600 group-hover:text-purple-400 transition-colors" />
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      {/* ── Strategy full-text modal ─────────────────────────────────────────── */}
      {strategyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setStrategyModal(null)}
          data-testid="overlay-strategy-modal"
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className={cn("relative max-w-lg w-full rounded-2xl border p-5 shadow-2xl", strategyModal.bg, strategyModal.border)}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-3">
              <div className={cn("rounded-md p-2 shrink-0 ring-1", strategyModal.bg, strategyModal.ring)}>
                <strategyModal.icon className={cn("w-4 h-4", strategyModal.color)} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn("text-[10px] font-bold uppercase tracking-wider mb-0.5", strategyModal.color)}>
                  {strategyModal.label} Strategy
                </p>
              </div>
              <button
                className="text-gray-500 hover-elevate rounded-md p-1 shrink-0"
                onClick={() => setStrategyModal(null)}
                data-testid="button-close-strategy-modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-gray-200 leading-relaxed">{strategyModal.text}</p>
          </div>
        </div>
      )}
    </div>
  );
}

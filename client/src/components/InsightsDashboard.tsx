import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, parseISO } from "date-fns";
import {
  Newspaper, Radio, Radar, TrendingUp, ShoppingCart, Package, AlertTriangle,
  Activity, BarChart2, Users, DollarSign, EyeOff, ExternalLink, X,
  MessageSquare, Settings, RefreshCw, Truck, Star, Zap, Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarketIntelData {
  forum: {
    count: number;
    posts: Array<{
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
    icon: Package,
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
    icon: Truck,
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
    icon: Users,
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
    icon: TrendingUp,
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
  },
  medium: {
    label: 'Notable',
    color: 'text-amber-300',
    bg: 'bg-amber-900/20',
    border: 'border-amber-500/30',
    glow: '',
    dot: 'bg-amber-400',
  },
  low: {
    label: 'Info',
    color: 'text-green-300',
    bg: 'bg-green-900/10',
    border: 'border-green-700/30',
    glow: '',
    dot: 'bg-green-500',
  },
} as const;

const CATEGORY_ICON: Record<string, React.ElementType> = {
  pricing: DollarSign,
  acquisition: ShoppingCart,
  overstock: Package,
  restock: AlertTriangle,
  revenue: TrendingUp,
  velocity: Activity,
  channel: BarChart2,
  new_customer: Users,
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

function getStrategyAreaForCategory(cat: string) {
  return STRATEGY_AREAS.find(s => (s.categories as readonly string[]).includes(cat));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-lg border border-gray-700/40 bg-gray-900/50 p-2.5 animate-pulse space-y-1.5">
          <div className="h-3 bg-gray-700/50 rounded w-3/4" />
          <div className="h-2.5 bg-gray-800/50 rounded w-full" />
          <div className="h-2.5 bg-gray-800/50 rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}

function EmptyZone({
  icon: Icon,
  message,
  action,
  onAction,
}: {
  icon: React.ElementType;
  message: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-lg border border-gray-700/30 bg-gray-900/30 p-5 flex flex-col items-center gap-2.5 text-center">
      <div className="rounded-full bg-gray-800/60 p-2.5 ring-1 ring-gray-700/40">
        <Icon className="w-4 h-4 text-gray-600" />
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">{message}</p>
      {action && onAction && (
        <Button
          size="sm"
          variant="ghost"
          className="text-xs gap-1.5 text-gray-500"
          onClick={onAction}
          data-testid="button-empty-settings"
        >
          <Settings className="w-3 h-3" />
          {action}
        </Button>
      )}
    </div>
  );
}

function ZoneHeader({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  count,
  unit,
}: {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  label: string;
  count?: number;
  unit?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-0.5 mb-2">
      <div className={cn("rounded-md p-1 ring-1", iconBg)}>
        <Icon className={cn("w-3 h-3", iconColor)} />
      </div>
      <span className="text-xs font-bold text-gray-200 uppercase tracking-wide">{label}</span>
      {count !== undefined && (
        <span className="ml-auto text-[11px] text-gray-600">
          {count} {unit}
        </span>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface InsightsDashboardProps {
  onOpenSettings?: (section?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'billing' | 'priceomatic') => void;
  compact?: boolean;
}

export default function InsightsDashboard({ onOpenSettings, compact }: InsightsDashboardProps) {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

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

  return (
    <div className={cn("h-full overflow-y-auto", compact ? "p-1.5 space-y-2" : "p-2 md:p-3 space-y-2.5")}>

      {/* ════════════════════════════════════════════════════════════════════
          MASTHEAD
      ════════════════════════════════════════════════════════════════════ */}
      <div
        className="relative rounded-lg border border-green-500/20 bg-gradient-to-br from-gray-900/95 to-green-950/20 overflow-hidden"
        data-testid="section-insights-masthead"
      >
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-green-400/40 to-transparent" />
        <div className="px-3 py-2.5 flex items-center gap-3 flex-wrap gap-y-1.5">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="rounded-md bg-green-900/60 ring-1 ring-green-400/30 p-1.5 shrink-0">
              <Radio className="w-4 h-4 text-green-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-sm font-bold text-gray-100 uppercase tracking-widest">Insights</h1>
                {urgentCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-900/50 text-red-300 border border-red-500/40 animate-pulse"
                    data-testid="badge-urgent-count"
                  >
                    <Zap className="w-2.5 h-2.5" />
                    {urgentCount} urgent
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {insightsLoading ? 'Loading signals…' : (
                  <>
                    {totalSignals} active signal{totalSignals !== 1 ? 's' : ''}
                    {(marketIntel?.news?.count ?? 0) > 0 && ` · ${marketIntel!.news.count} market articles`}
                    {(marketIntel?.forum?.count ?? 0) > 0 && ` · ${marketIntel!.forum.count} forum posts`}
                  </>
                )}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRefresh}
            disabled={intelFetching}
            className="text-xs text-gray-400 gap-1.5 shrink-0"
            data-testid="button-refresh-insights"
          >
            <RefreshCw className={cn("w-3 h-3", intelFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          STRATEGY LENS — 5 clickable area filters
      ════════════════════════════════════════════════════════════════════ */}
      <div
        className="grid grid-cols-5 gap-1.5"
        data-testid="section-strategy-lens"
      >
        {areaCounts.map(area => {
          const isActive = activeFilter === area.key;
          const Icon = area.icon;
          return (
            <button
              key={area.key}
              onClick={() => setActiveFilter(isActive ? null : area.key)}
              data-testid={`filter-strategy-${area.key}`}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border p-2 transition-all hover-elevate active-elevate-2 text-center",
                isActive
                  ? `${area.bg} ${area.border} ring-1 ${area.ring}`
                  : "border-gray-700/50 bg-gray-900/60"
              )}
            >
              <div className={cn("flex items-center justify-center gap-1", isActive ? area.color : "text-gray-600")}>
                <Icon className="w-3 h-3 shrink-0" />
                {area.total > 0 && (
                  <span className={cn(
                    "text-[11px] font-bold",
                    area.urgent > 0 ? 'text-red-400' : (isActive ? area.color : 'text-gray-500')
                  )}>
                    {area.total}
                  </span>
                )}
              </div>
              <span className={cn(
                "text-[10px] font-semibold leading-tight",
                isActive ? area.color : "text-gray-600"
              )}>
                {area.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          STRATEGY CONTEXT BANNER (shown when a filter is active)
      ════════════════════════════════════════════════════════════════════ */}
      {activeArea && (
        <div
          className={cn("rounded-lg border p-3", activeArea.bg, activeArea.border)}
          data-testid="section-strategy-context"
        >
          <div className="flex items-start gap-2.5">
            <div className={cn("rounded-md p-1.5 shrink-0", activeArea.bg, "ring-1", activeArea.ring)}>
              <activeArea.icon className={cn("w-3.5 h-3.5", activeArea.color)} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={cn("text-xs font-bold", activeArea.color)}>
                  {activeArea.label} Strategy
                </span>
                {(areaCounts.find(a => a.key === activeFilter)?.urgent ?? 0) > 0 && (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                    {areaCounts.find(a => a.key === activeFilter)?.urgent} urgent
                  </Badge>
                )}
              </div>
              {activeStratText ? (
                <p className="text-xs text-gray-300 leading-relaxed">{activeStratText}</p>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs text-gray-500 flex-1 min-w-0">
                    No strategy defined for this area yet. Set one in Settings to get tailored intelligence.
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

      {/* ════════════════════════════════════════════════════════════════════
          3-ZONE MAGAZINE GRID
      ════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5" data-testid="section-magazine-grid">

        {/* ── ZONE 1: Market Wire ───────────────────────────────────────── */}
        <div className="space-y-0" data-testid="zone-market-wire">
          <ZoneHeader
            icon={Newspaper}
            iconBg="bg-blue-900/50 ring-blue-400/30"
            iconColor="text-blue-300"
            label="Market Wire"
            count={marketIntel?.news?.count}
            unit={marketIntel?.news?.count === 1 ? 'article' : 'articles'}
          />

          {intelLoading ? (
            <LoadingSkeleton rows={4} />
          ) : (marketIntel?.news?.articles ?? []).length === 0 ? (
            <EmptyZone
              icon={Newspaper}
              message="No recent market news. Enable market news sync to track LEGO market trends, retirements, and pricing signals."
              action="Enable news sync"
              onAction={() => onOpenSettings?.('automation')}
            />
          ) : (
            <div className="space-y-1.5">
              {marketIntel!.news.articles.map((article, i) => (
                <a
                  key={i}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`article-news-${i}`}
                  className="block rounded-lg border border-gray-700/50 bg-gray-900/60 p-2.5 hover-elevate active-elevate-2 transition-all group"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-100 leading-snug group-hover:text-blue-300 transition-colors line-clamp-2">
                        {article.title}
                      </p>
                      {article.snippet && (
                        <p className="text-[11px] text-gray-500 mt-1 leading-relaxed line-clamp-2">
                          {article.snippet}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {article.source && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-900/40 text-blue-400 border border-blue-700/30 font-medium">
                            {article.source}
                          </span>
                        )}
                        {article.query && (
                          <span className="text-[10px] text-gray-600 italic">{article.query}</span>
                        )}
                        <span className="text-[10px] text-gray-600 ml-auto">{timeAgo(article.fetchedAt)}</span>
                      </div>
                    </div>
                    <ExternalLink className="w-3 h-3 text-gray-600 group-hover:text-blue-400 shrink-0 mt-0.5 transition-colors" />
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* ── ZONE 2: Forum Pulse ───────────────────────────────────────── */}
        <div className="space-y-0" data-testid="zone-forum-pulse">
          <ZoneHeader
            icon={MessageSquare}
            iconBg="bg-purple-900/50 ring-purple-400/30"
            iconColor="text-purple-300"
            label="Forum Pulse"
            count={marketIntel?.forum?.count}
            unit={marketIntel?.forum?.count === 1 ? 'post' : 'posts'}
          />

          {intelLoading ? (
            <LoadingSkeleton rows={4} />
          ) : (marketIntel?.forum?.posts ?? []).length === 0 ? (
            <EmptyZone
              icon={MessageSquare}
              message="No recent BrickLink forum discussions. Enable forum sync to track community conversations around pricing, sets, and market trends."
              action="Enable forum sync"
              onAction={() => onOpenSettings?.('automation')}
            />
          ) : (
            <div className="space-y-1.5">
              {marketIntel!.forum.posts.map((post, i) => (
                <a
                  key={i}
                  href={post.threadUrl ?? '#'}
                  target={post.threadUrl ? '_blank' : undefined}
                  rel="noopener noreferrer"
                  data-testid={`post-forum-${i}`}
                  className="block rounded-lg border border-gray-700/50 bg-gray-900/60 p-2.5 hover-elevate active-elevate-2 transition-all group"
                >
                  <p className="text-xs font-semibold text-gray-100 leading-snug group-hover:text-purple-300 transition-colors line-clamp-2">
                    {post.title}
                  </p>
                  {post.excerpt && (
                    <p className="text-[11px] text-gray-500 mt-1 leading-relaxed line-clamp-2">
                      {post.excerpt}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-900/40 text-purple-400 border border-purple-700/30 font-medium">
                      {post.username}
                    </span>
                    <span className="text-[10px] text-gray-600 ml-auto">{timeAgo(post.postedAt)}</span>
                    <ExternalLink className="w-3 h-3 text-gray-600 group-hover:text-purple-400 shrink-0 transition-colors" />
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* ── ZONE 3: Strategy Intel ────────────────────────────────────── */}
        <div className="space-y-0" data-testid="zone-strategy-intel">
          <ZoneHeader
            icon={Radar}
            iconBg="bg-cyan-900/50 ring-cyan-400/30"
            iconColor="text-cyan-300"
            label="Strategy Intel"
            count={sortedInsights.length}
            unit={sortedInsights.length === 1 ? 'signal' : 'signals'}
          />

          {insightsLoading ? (
            <LoadingSkeleton rows={4} />
          ) : sortedInsights.length === 0 ? (
            <EmptyZone
              icon={Radar}
              message={
                activeFilter
                  ? "No signals for this strategy area right now."
                  : "No active signals yet. Enable Business Intel to get AI-generated insights about your pricing, inventory, orders, and customers."
              }
              action={activeFilter ? undefined : "Enable Business Intel"}
              onAction={activeFilter ? undefined : () => onOpenSettings?.('automation')}
            />
          ) : (
            <div className="space-y-1.5">
              {sortedInsights.map((insight, i) => {
                const urgency = URGENCY_CONFIG[insight.urgency as keyof typeof URGENCY_CONFIG] ?? URGENCY_CONFIG.low;
                const stratArea = getStrategyAreaForCategory(insight.category);
                const CatIcon = CATEGORY_ICON[insight.category] ?? Target;
                const isLead = i === 0 && urgentCount > 0 && insight.urgency === 'high';

                return (
                  <div
                    key={insight.id}
                    data-testid={`insight-card-${insight.id}`}
                    className={cn(
                      "rounded-lg border p-2.5 transition-all",
                      urgency.bg,
                      urgency.border,
                      isLead && urgency.glow,
                    )}
                  >
                    {/* Header row */}
                    <div className="flex items-start gap-2 mb-1.5">
                      <div className={cn("rounded-md p-1 shrink-0 mt-0.5", urgency.bg, "ring-1", urgency.border)}>
                        <CatIcon className={cn("w-3 h-3", urgency.color)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <span className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border",
                            urgency.bg, urgency.border, urgency.color
                          )}>
                            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", urgency.dot, isLead && "animate-pulse")} />
                            {urgency.label}
                          </span>
                          {isLead && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/8 text-gray-300 border border-white/15">
                              Lead Signal
                            </span>
                          )}
                        </div>
                        <p className={cn(
                          "font-semibold text-gray-100 leading-snug",
                          isLead ? "text-sm" : "text-xs"
                        )}>
                          {insight.title}
                        </p>
                      </div>
                    </div>

                    {/* Summary */}
                    <p className="text-[11px] text-gray-400 leading-relaxed mb-2 pl-[1.625rem]">
                      {insight.summary}
                    </p>

                    {/* Footer row */}
                    <div className="flex items-center gap-2 flex-wrap pl-[1.625rem]">
                      {stratArea && (
                        <div className={cn(
                          "flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border",
                          stratArea.bg, stratArea.border
                        )}>
                          <stratArea.icon className={cn("w-2.5 h-2.5", stratArea.color)} />
                          <span className={stratArea.color}>{stratArea.label}</span>
                        </div>
                      )}
                      <span className="text-[10px] text-gray-600 ml-auto">{timeAgo(insight.createdAt)}</span>
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
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          VISION CONTEXT (bottom anchor — shows the org's broader vision)
      ════════════════════════════════════════════════════════════════════ */}
      {strategies?.visionMission && (
        <div
          className="rounded-lg border border-green-500/15 bg-green-950/20 p-3"
          data-testid="section-vision-mission"
        >
          <div className="flex items-start gap-2">
            <div className="rounded-md bg-green-900/50 ring-1 ring-green-400/25 p-1 shrink-0">
              <Target className="w-3.5 h-3.5 text-green-300" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-green-400 uppercase tracking-wider mb-0.5">Vision & Mission</p>
              <p className="text-xs text-gray-400 leading-relaxed">{strategies.visionMission}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

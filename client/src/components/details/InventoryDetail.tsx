import { Package, DollarSign, Weight, Calendar, ExternalLink, TrendingUp, Sparkles, BarChart3, ShoppingCart, FileText, AlertCircle, Database, Tag, Box, Layers, Users, Clock, Zap, Info, MapPin, Boxes, Search, Loader2, RefreshCw, Newspaper, MessageCircle, TrendingDown, Target, ShieldAlert, Settings2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import PartImage from "@/components/PartImage";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface ItemInsight {
  category: string;
  urgency: string;
  title: string;
  summary: string;
  source: string;
}

interface ItemInsightsResponse {
  insights: ItemInsight[];
  meta: {
    newsCount: number;
    forumCount: number;
    salesCount: number;
    hasPriceGuide: boolean;
  };
}

interface PriceOMagicData {
  itemNo: string;
  itemType: string;
  colorId: number | null;
  newOrUsed?: string | null;
  itemName: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  categoryId: number | null;
  weight: string | null;
  dimensionX: string | null;
  dimensionY: string | null;
  dimensionZ: string | null;
  yearReleased: number | null;
  stockAvgPrice: string | null;
  stockMinPrice: string | null;
  stockMaxPrice: string | null;
  stockQuantity: number | null;
  stockTotalLots: number | null;
  soldAvgPrice: string | null;
  soldMinPrice: string | null;
  soldMaxPrice: string | null;
  soldQuantity: number | null;
  soldTotalLots: number | null;
  suggestedPrice: string;
  premiumPercentage: number;
}

interface PomConditionData {
  soldQty: number | null;
  soldMin: string | null;
  soldAvg: string | null;
  soldMax: string | null;
  listedQty: number | null;
  listedMin: string | null;
  listedAvg: string | null;
  listedMax: string | null;
  suggestedPrice: string | null;
}

interface PomFullGuide {
  N: PomConditionData | null;
  U: PomConditionData | null;
  scoring: {
    ceiling: number | null;
    velocity: number | null;
    scarcity: number | null;
    undercut: number | null;
    score: number | null;
    weights: { wCeiling: number; wVelocity: number; wScarcity: number; wUndercut: number };
  };
  fetchedAt: string | null;
}

interface AnalyticsData {
  totalUnitsSold: number;
  totalRevenue: string;
  averageSellingPrice: string;
  salesVelocity: string;
  daysSinceLastSold: number | null;
  daysInInventory: number | null;
  bestSellingMonth: string;
  bestSellingMonthUnits: number;
  topCustomers: Array<{
    name: string;
    units: number;
    revenue: number;
    orders: number;
  }>;
  recentSales: {
    last3Months: number;
    percentOfTotal: string;
  };
  salesByMonth: Array<{
    month: string;
    units: number;
    revenue: string;
  }>;
  totalOrders: number;
}

interface InventoryDetailProps {
  data: {
    id: number;
    loading?: boolean;
    loadingPriceOMagic?: boolean;
    itemNo?: string;
    itemName?: string | null;
    itemType?: string;
    colorId?: number | null;
    colorName?: string | null;
    colorRgb?: string | null;
    categoryId?: number | null;
    categoryName?: string | null;
    quantity?: number;
    newOrUsed?: string;
    completeness?: string | null;
    unitPrice?: string;
    myCost?: string | null;
    bindId?: number | null;
    description?: string | null;
    remarks?: string | null;
    bulk?: number | null;
    isRetain?: boolean | null;
    isStockRoom?: boolean | null;
    stockRoomId?: string | null;
    dateCreated?: string | null;
    saleRate?: number | null;
    tierPrice1?: string | null;
    tierPrice2?: string | null;
    tierPrice3?: string | null;
    tierQuantity1?: number | null;
    tierQuantity2?: number | null;
    tierQuantity3?: number | null;
    myWeight?: string | null;
    updatedAt?: string | null;
    priceOMagic?: PriceOMagicData | null;
  };
  onBrickLinkClick?: (url: string) => void;
  onOpenSettings?: (section?: string) => void;
  initialTab?: string;
}


const INSIGHT_ICONS: Record<string, any> = {
  pricing: DollarSign,
  movement: TrendingDown,
  market: Newspaper,
  category_trend: TrendingUp,
  opportunity: Target,
  risk: ShieldAlert,
};

const INSIGHT_COLORS: Record<string, { icon: string; border: string; bg: string }> = {
  pricing: { icon: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'from-emerald-500/15 via-emerald-500/5 to-transparent' },
  movement: { icon: 'text-amber-400', border: 'border-amber-500/30', bg: 'from-amber-500/15 via-amber-500/5 to-transparent' },
  market: { icon: 'text-blue-400', border: 'border-blue-500/30', bg: 'from-blue-500/15 via-blue-500/5 to-transparent' },
  category_trend: { icon: 'text-purple-400', border: 'border-purple-500/30', bg: 'from-purple-500/15 via-purple-500/5 to-transparent' },
  opportunity: { icon: 'text-cyan-400', border: 'border-cyan-500/30', bg: 'from-cyan-500/15 via-cyan-500/5 to-transparent' },
  risk: { icon: 'text-red-400', border: 'border-red-500/30', bg: 'from-red-500/15 via-red-500/5 to-transparent' },
};

const URGENCY_BADGE: Record<string, { cls: string; label: string }> = {
  high: { cls: 'bg-red-500/20 text-red-400 border-red-500/30', label: 'High' },
  medium: { cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30', label: 'Med' },
  low: { cls: 'bg-gray-500/20 text-gray-400 border-gray-500/30', label: 'Low' },
};

const SOURCE_ICONS: Record<string, { icon: any; label: string }> = {
  sales: { icon: ShoppingCart, label: 'Sales' },
  market_data: { icon: BarChart3, label: 'Market' },
  news: { icon: Newspaper, label: 'News' },
  forum: { icon: MessageCircle, label: 'Forum' },
  inventory: { icon: Package, label: 'Inventory' },
};

function ItemBusinessInsightsDialog({ itemId, itemName, open, onOpenChange }: { itemId: number; itemName: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: insightsData, isLoading, isError, refetch, isFetching } = useQuery<ItemInsightsResponse>({
    queryKey: ['/api/inventory', itemId, 'item-insights'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/inventory/${itemId}/item-insights`);
      return res as unknown as ItemInsightsResponse;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto bg-gray-900 border-gray-700">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-lego-orange" />
            <span className="text-lego-orange">Business Insights</span>
          </DialogTitle>
          <p className="text-xs text-gray-400 truncate">{itemName}</p>
        </DialogHeader>

        {isLoading && (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <Loader2 className="h-6 w-6 text-lego-orange animate-spin" />
            <div className="text-center">
              <p className="text-xs text-gray-300">Analyzing item data...</p>
              <p className="text-[10px] text-gray-500 mt-1">Checking market news, forums, sales history, and pricing</p>
            </div>
          </div>
        )}

        {isError && (
          <div className="text-center py-6">
            <AlertCircle className="h-6 w-6 text-red-400 mx-auto mb-2" />
            <p className="text-xs text-gray-400 mb-3">Unable to generate insights</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-insights">
              <RefreshCw className="h-3 w-3 mr-1.5" /> Retry
            </Button>
          </div>
        )}

        {insightsData && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] text-gray-500">
                {insightsData.meta.newsCount > 0 && <span className="flex items-center gap-0.5"><Newspaper className="h-3 w-3" />{insightsData.meta.newsCount} news</span>}
                {insightsData.meta.forumCount > 0 && <span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{insightsData.meta.forumCount} forum</span>}
                {insightsData.meta.salesCount > 0 && <span className="flex items-center gap-0.5"><ShoppingCart className="h-3 w-3" />{insightsData.meta.salesCount} sales</span>}
                {insightsData.meta.hasPriceGuide && <span className="flex items-center gap-0.5"><BarChart3 className="h-3 w-3" />Price guide</span>}
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => refetch()}
                disabled={isFetching}
                data-testid="button-refresh-insights"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-gray-400 ${isFetching ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            {insightsData.insights.length === 0 ? (
              <div className="app-card-muted p-4 text-center">
                <p className="text-xs text-gray-500">No insights could be generated for this item.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {insightsData.insights.map((insight, idx) => {
                  const colors = INSIGHT_COLORS[insight.category] || INSIGHT_COLORS.market;
                  const IconComp = INSIGHT_ICONS[insight.category] || Sparkles;
                  const urgency = URGENCY_BADGE[insight.urgency] || URGENCY_BADGE.medium;
                  const sourceInfo = SOURCE_ICONS[insight.source] || SOURCE_ICONS.inventory;
                  const SourceIcon = sourceInfo.icon;

                  return (
                    <div
                      key={idx}
                      className={`bg-gradient-to-r ${colors.bg} border ${colors.border} rounded-lg p-3`}
                      data-testid={`insight-card-${idx}`}
                    >
                      <div className="flex items-start gap-2.5">
                        <IconComp className={`h-4 w-4 ${colors.icon} mt-0.5 shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                            <span className="text-xs font-semibold text-gray-200 leading-tight">{insight.title}</span>
                            <span className={`inline-flex items-center rounded-full border text-[8px] px-1.5 py-px font-semibold leading-tight ${urgency.cls}`}>
                              {urgency.label}
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-400 leading-relaxed">{insight.summary}</p>
                          <div className="flex items-center gap-1 mt-1.5">
                            <SourceIcon className="h-2.5 w-2.5 text-gray-600" />
                            <span className="text-[9px] text-gray-600">{sourceInfo.label}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function InventoryDetail({ data, onBrickLinkClick, onOpenSettings, initialTab }: InventoryDetailProps) {
  const [activeTab, setActiveTab] = useState(initialTab ?? "overview");
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [dateRange, setDateRange] = useState<'all' | '1year' | '2years' | '3months' | '6months'>('all');
  const [setsDialogOpen, setSetsDialogOpen] = useState(false);
  const [setsSearch, setSetsSearch] = useState('');
  const priceOMagic = data.priceOMagic;

  // Fetch current POM formula settings for live price computation
  const { data: pomSettings } = useQuery<any>({
    queryKey: ['/api/settings'],
    staleTime: 5 * 60 * 1000,
  });

  const fullGuideParams = new URLSearchParams();
  if (data.colorId) fullGuideParams.append('color_id', String(data.colorId));
  if (data.newOrUsed) fullGuideParams.append('new_or_used', data.newOrUsed);
  if (data.unitPrice) fullGuideParams.append('current_price', data.unitPrice);
  const { data: pomFullGuide, isLoading: loadingFullGuide } = useQuery<PomFullGuide>({
    queryKey: ['/api/inventory/price-guide-full', data.itemNo, data.itemType, data.colorId, data.newOrUsed, data.unitPrice],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/price-guide-full/${data.itemNo}/${data.itemType}?${fullGuideParams.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch full guide');
      return res.json();
    },
    enabled: !data.loading && !!data.itemNo && !!data.itemType,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch warehouse location
  const { data: warehouseLocation } = useQuery<any[]>({
    queryKey: [`/api/warehouse/locations?inventoryId=${data.id}`],
    enabled: !data.loading && !!data.id,
  });

  const { data: setsCountData } = useQuery<{ total: number }>({
    queryKey: [`/api/inventory/${data.itemNo}/${data.colorId || 0}/sets/count`],
    enabled: !!data.itemNo,
  });

  const { data: setsData, isLoading: loadingSets } = useQuery<{ 
    sets: Array<{ 
      setNum: string; 
      setName: string | null; 
      quantity: number;
    }>;
    total: number;
    color: {
      id: number;
      name: string;
      rgb: string | null;
    } | null;
  }>({
    queryKey: [`/api/inventory/${data.itemNo}/${data.colorId || 0}/sets`],
    enabled: setsDialogOpen && !!data.itemNo,
  });

  const setsTotal = setsData?.total ?? setsCountData?.total ?? null;

  const filteredSets = setsData?.sets?.filter((set) => {
    if (!setsSearch.trim()) return true;
    const q = setsSearch.toLowerCase();
    return set.setNum.toLowerCase().includes(q) || (set.setName || '').toLowerCase().includes(q);
  }) ?? [];

  // Fetch analytics data
  useEffect(() => {
    const fetchAnalytics = async () => {
      if (data.loading) return; // Don't fetch if still loading main data
      
      setLoadingAnalytics(true);
      try {
        const params = new URLSearchParams();
        if (dateRange !== 'all') {
          params.append('range', dateRange);
        }
        const response = await fetch(`/api/inventory/${data.id}/analytics?${params.toString()}`);
        if (response.ok) {
          const analyticsData = await response.json();
          setAnalytics(analyticsData);
        }
      } catch (error) {
        console.error("Error fetching analytics:", error);
      } finally {
        setLoadingAnalytics(false);
      }
    };

    fetchAnalytics();
  }, [data.id, data.loading, dateRange]);

  // Show loading skeleton
  if (data.loading) {
    return (
      <div className="flex flex-col h-full" data-testid="inventory-detail-loading">
        {/* Header skeleton */}
        <div className="flex-shrink-0 bg-gradient-to-r from-lego-blue/15 via-lego-blue/5 to-transparent border border-lego-blue/30 rounded-lg p-3 mb-3">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-24 h-24 bg-gray-800 rounded-lg border border-gray-700 animate-pulse"></div>
            <div className="flex-1 space-y-2">
              <div className="h-6 bg-gray-800 rounded w-3/4 animate-pulse"></div>
              <div className="h-4 bg-gray-800 rounded w-1/2 animate-pulse"></div>
              <div className="flex gap-2 mt-2">
                <div className="h-5 w-16 bg-gray-800 rounded animate-pulse"></div>
                <div className="h-5 w-20 bg-gray-800 rounded animate-pulse"></div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Tab skeleton */}
        <div className="flex-shrink-0 mb-3">
          <div className="h-8 bg-gray-800 rounded animate-pulse"></div>
        </div>
        
        {/* Content skeleton */}
        <div className="flex-1 space-y-3">
          <div className="h-24 bg-gray-800/30 border border-gray-700 rounded-lg animate-pulse"></div>
          <div className="h-24 bg-gray-800/30 border border-gray-700 rounded-lg animate-pulse"></div>
          <div className="h-24 bg-gray-800/30 border border-gray-700 rounded-lg animate-pulse"></div>
        </div>
      </div>
    );
  }
  const currentPrice = data.unitPrice ? parseFloat(data.unitPrice) : 0;
  const myCost = data.myCost ? parseFloat(data.myCost) : null;
  const stockAvgPrice = priceOMagic?.stockAvgPrice ? parseFloat(priceOMagic.stockAvgPrice) : null;
  const soldAvgPrice = priceOMagic?.soldAvgPrice ? parseFloat(priceOMagic.soldAvgPrice) : null;

  // Compute suggested price LIVE using current settings — matches calculateSuggestedPriceWithSupply
  const { liveSuggestedPrice, liveTotalPremiumPct } = (() => {
    const empty = { liveSuggestedPrice: null as number | null, liveTotalPremiumPct: 0 };
    if (!priceOMagic || (!stockAvgPrice && !soldAvgPrice)) return empty;
    const s = pomSettings;
    const basePrice = soldAvgPrice || stockAvgPrice || 0;
    if (basePrice === 0) return empty;
    const isMinifig = data.itemType === 'MINIFIG' || data.itemType === 'M';
    let totalPremium = isMinifig
      ? (s?.pomMinifigPremium ?? 5)
      : (s?.pomBasePremium ?? 10);
    const lots = priceOMagic.stockTotalLots ?? 0;
    const t1 = s?.pomScarcityThreshold1 ?? 50;
    const t2 = s?.pomScarcityThreshold2 ?? 200;
    const t3 = s?.pomScarcityThreshold3 ?? 500;
    if (lots < t1) totalPremium += (s?.pomScarcityBonus1 ?? 15);
    else if (lots < t2) totalPremium += (s?.pomScarcityBonus2 ?? 8);
    else if (lots < t3) totalPremium += (s?.pomScarcityBonus3 ?? 3);
    if (s?.pomTrendingEnabled) {
      const maxAdj = s?.pomTrendingDays ?? 30;
      const demandDenom = s?.pomTrendingThreshold ?? 5;
      const supplyDenom = s?.pomHighSupplyThreshold ?? 5000;
      const demandRatio = demandDenom > 0 ? Math.min((priceOMagic.soldQuantity ?? 0) / demandDenom, 1.0) : 0;
      const supplyRatio = supplyDenom > 0 ? Math.min((priceOMagic.stockQuantity ?? 0) / supplyDenom, 1.0) : 0;
      const demandContrib = demandRatio * ((s?.pomTrendingBonus ?? 5) / 100);
      const supplyContrib = supplyRatio * ((s?.pomHighSupplyPenalty ?? 5) / 100);
      totalPremium += maxAdj * (demandContrib - supplyContrib);
    }
    let finalPrice = basePrice * (1 + totalPremium / 100);
    if ((s?.pomCostFloorPct ?? 0) > 0 && myCost && myCost > 0) {
      const costFloor = myCost * (1 + (s.pomCostFloorPct / 100));
      if (costFloor > finalPrice) finalPrice = costFloor;
    }
    const minPrice = parseFloat(String(s?.pomMinPrice ?? '0.02'));
    if (minPrice > 0 && minPrice > finalPrice) finalPrice = minPrice;
    return { liveSuggestedPrice: Number(finalPrice.toFixed(4)), liveTotalPremiumPct: Math.round(totalPremium) };
  })();

  // Use the DB-stored value (same source as POM list and spot lookup).
  // Fall back to live computation only when there is no cached entry yet.
  const suggestedPrice = priceOMagic?.suggestedPrice
    ? parseFloat(priceOMagic.suggestedPrice)
    : liveSuggestedPrice;
  
  const quantity = data.quantity ?? 0;
  const totalValue = quantity * currentPrice;
  const profit = myCost !== null && myCost > 0 ? (currentPrice - myCost) * quantity : null;
  const profitMargin = myCost !== null && myCost > 0 && currentPrice > 0 ? ((currentPrice - myCost) / currentPrice * 100) : null;
  
  // BrickLink URL - Map full item type names to BrickLink URL parameters
  const itemType = data.itemType || 'PART';
  const itemTypeParam = itemType === 'SET' ? 'S' :
                        itemType === 'MINIFIG' ? 'M' :
                        itemType === 'PART' ? 'P' :
                        itemType === 'BOOK' ? 'B' :
                        itemType === 'GEAR' ? 'G' :
                        itemType === 'CATALOG' ? 'C' :
                        itemType === 'INSTRUCTION' ? 'I' :
                        'P'; // Default to P for parts
  const itemNoParam = data.itemNo || 'unknown';
  const bricklinkUrl = `https://www.bricklink.com/v2/catalog/catalogitem.page?${itemTypeParam}=${itemNoParam}${data.colorId ? `&idColor=${data.colorId}` : ''}`;
  
  // Item display name
  const itemName = data.itemName || priceOMagic?.itemName || 
    (data.itemType ? `${data.itemType.toUpperCase()} ${itemNoParam}` : itemNoParam || 'Unknown Item');
  
  // Has tier pricing
  const hasTierPricing = data.tierPrice1 || data.tierPrice2 || data.tierPrice3;

  // Condition display
  const conditionText = data.newOrUsed === 'N' ? 'NEW' : 'USED';
  const conditionColor = data.newOrUsed === 'N' ? 'text-lego-green' : 'text-lego-orange';

  return (
    <div className="flex flex-col h-full">
      {/* Header - Always visible with fixed height */}
      <div className="flex-shrink-0 bg-gradient-to-r from-lego-blue/15 via-lego-blue/5 to-transparent border border-lego-blue/30 rounded-lg p-3 mb-3">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-24 h-24 bg-gray-900 rounded-lg border border-gray-700 p-1.5 flex items-center justify-center">
            {data.itemNo ? (
              <PartImage
                imageUrl={data.imageUrl}
                partNumber={data.itemNo}
                colorId={data.colorId ?? null}
                itemType={itemType}
                fallbackClassName="w-12 h-12 text-gray-600"
              />
            ) : (
              <Package className="w-12 h-12 text-gray-600" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <h3 className="text-sm font-black text-lego-blue font-mono" data-testid="text-item-number">{data.itemNo}</h3>
              {data.bindId && (
                <Badge className="bg-purple-500/20 text-purple-400 border-purple-400/40 text-[9px] md:text-xs h-4 px-2 font-bold">
                  BIND #{data.bindId}
                </Badge>
              )}
              <button
                onClick={() => setInsightsOpen(true)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-lego-orange/15 border border-lego-orange/30 text-lego-orange hover:bg-lego-orange/25 transition-colors"
                data-testid="button-business-insights"
                title="AI Business Insights"
              >
                <Sparkles className="h-3 w-3" />
                <span className="text-[9px] md:text-xs font-semibold">Insights</span>
              </button>
            </div>
            <p className="text-xs text-white font-semibold mb-2 leading-tight" title={itemName}>
              {itemName}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {data.colorName && (
                <div className="flex items-center gap-1.5">
                  {data.colorRgb && (
                    <div 
                      className="w-3 h-3 rounded-full border border-gray-600"
                      style={{ backgroundColor: `#${data.colorRgb}` }}
                    />
                  )}
                  <span className="text-[10px] md:text-sm text-gray-300 font-medium">{data.colorName}</span>
                </div>
              )}
              {data.categoryName && (
                <Badge className="bg-gray-800 text-gray-300 border-gray-700 text-[9px] md:text-xs h-4 px-2 font-medium">
                  {data.categoryName}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabbed Content - Scrollable with fixed height */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="flex-shrink-0 grid w-full grid-cols-4 bg-gray-800 p-0.5 h-9 mb-3">
          <TabsTrigger value="overview" className="text-[9px] md:text-xs py-1 data-[state=active]:bg-lego-blue" data-testid="tab-overview">OVERVIEW</TabsTrigger>
          <TabsTrigger value="pricing" className="text-[9px] md:text-xs py-1 data-[state=active]:bg-purple-600" data-testid="tab-pricing">PRICING</TabsTrigger>
          <TabsTrigger value="analytics" className="text-[9px] md:text-xs py-1 data-[state=active]:bg-lego-orange" data-testid="tab-analytics">ANALYTICS</TabsTrigger>
          <TabsTrigger value="details" className="text-[9px] md:text-xs py-1 data-[state=active]:bg-lego-green" data-testid="tab-details">DETAILS</TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Overview Tab */}
          <TabsContent value="overview" className="mt-0 space-y-2.5">
            {/* Description & Remarks - Top priority */}
            {(data.description || data.remarks) && (
              <div className="space-y-2">
                {data.description && (
                  <div className="app-card-muted p-2.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <FileText className="h-3.5 w-3.5 text-blue-400" />
                      <p className="text-[10px] md:text-sm font-bold text-blue-400">DESCRIPTION</p>
                    </div>
                    <p className="text-xs text-gray-300 leading-relaxed">{data.description}</p>
                  </div>
                )}
                {data.remarks && (
                  <div className="app-card-muted p-2.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <AlertCircle className="h-3.5 w-3.5 text-yellow-400" />
                      <p className="text-[10px] md:text-sm font-bold text-yellow-400">REMARKS</p>
                    </div>
                    <p className="text-xs text-gray-300 leading-relaxed">{data.remarks}</p>
                  </div>
                )}
              </div>
            )}

            {/* Current Inventory Info */}
            <div className="app-card-muted p-2.5">
              <p className="text-[10px] md:text-sm font-bold text-gray-400 mb-2">CURRENT INVENTORY</p>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <div className="text-center">
                  <Package className="h-4 w-4 text-lego-blue mx-auto mb-1" />
                  <p className="text-[9px] md:text-xs text-gray-400 mb-0.5">QUANTITY</p>
                  <p className="text-lg font-black font-mono text-lego-blue" data-testid="text-quantity">{data.quantity}</p>
                </div>

                <div className="text-center">
                  <DollarSign className="h-4 w-4 text-lego-green mx-auto mb-1" />
                  <p className="text-[9px] md:text-xs text-gray-400 mb-0.5">PRICE</p>
                  <p className="text-lg font-black font-mono text-lego-green" data-testid="text-unit-price">${currentPrice.toFixed(2)}</p>
                </div>

                <div className="text-center">
                  <DollarSign className="h-4 w-4 text-lego-red mx-auto mb-1" />
                  <p className="text-[9px] md:text-xs text-gray-400 mb-0.5">VALUE</p>
                  <p className="text-lg font-black font-mono text-lego-red" data-testid="text-total-value">${totalValue.toFixed(2)}</p>
                </div>
              </div>

              {/* Cost & Profit inline */}
              {myCost !== null && myCost > 0 && (
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-700">
                  <div>
                    <p className="text-[9px] md:text-xs text-gray-400 mb-0.5">MY COST</p>
                    <p className="text-sm font-bold font-mono text-yellow-400">${myCost.toFixed(4)}</p>
                  </div>
                  {profit !== null && (
                    <div>
                      <p className="text-[9px] md:text-xs text-gray-400 mb-0.5">PROFIT</p>
                      <p className={`text-sm font-bold font-mono ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${profit.toFixed(2)}
                        {profitMargin !== null && (
                          <span className="text-[9px] md:text-xs text-gray-400 ml-1">({profitMargin.toFixed(1)}%)</span>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Warehouse Location */}
            <div className="app-card-muted p-2.5">
              <div className="flex items-center gap-1.5 mb-2">
                <MapPin className="h-3.5 w-3.5 text-blue-400" />
                <p className="text-[10px] md:text-sm font-bold text-blue-400">WAREHOUSE LOCATION</p>
              </div>
              {warehouseLocation && warehouseLocation.length > 0 ? (
                (() => {
                  // Take only the first location (duplicates are from DB query)
                  const loc = warehouseLocation[0];
                  return (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-2 text-center" data-testid="card-aisle">
                        <p className="text-[9px] md:text-xs text-purple-400 font-bold mb-1">AISLE</p>
                        <p className="text-xs font-semibold text-white" data-testid="text-aisle">
                          {loc.aisleName || '—'}
                        </p>
                      </div>
                      <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-2 text-center" data-testid="card-shelf">
                        <p className="text-[9px] md:text-xs text-orange-400 font-bold mb-1">SHELF</p>
                        <p className="text-xs font-semibold text-white" data-testid="text-shelf">
                          {loc.shelfName || '—'}
                        </p>
                      </div>
                      <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-2 text-center" data-testid="card-bin">
                        <p className="text-[9px] md:text-xs text-green-400 font-bold mb-1">BIN</p>
                        <p className="text-xs font-semibold text-white" data-testid="text-bin">
                          {loc.binName || '—'}
                        </p>
                      </div>
                      {loc.bagLabel && (
                        <div className="col-span-3 bg-blue-500/10 border border-blue-500/30 rounded-lg p-2 text-center" data-testid="card-bag">
                          <p className="text-[9px] md:text-xs text-blue-400 font-bold mb-1">BAG</p>
                          <p className="text-xs font-semibold text-white" data-testid="text-bag">
                            {loc.bagLabel}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                <p className="text-[10px] md:text-sm text-gray-400 italic">
                  Not assigned to a warehouse location
                </p>
              )}
            </div>

            {/* When First Available & Physical Details */}
            {priceOMagic && (priceOMagic.yearReleased || priceOMagic.weight || priceOMagic.dimensionX) && (
              <div className="app-card-muted p-2.5">
                <p className="text-[10px] md:text-sm font-bold text-gray-400 mb-2">ITEM SPECIFICATIONS</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  {priceOMagic.yearReleased && (
                    <div>
                      <span className="text-gray-500">First Available:</span>
                      <span className="text-white font-mono ml-2">{priceOMagic.yearReleased}</span>
                    </div>
                  )}
                  {priceOMagic.weight && (
                    <div>
                      <span className="text-gray-500">Weight:</span>
                      <span className="text-white font-mono ml-2">{parseFloat(priceOMagic.weight).toFixed(1)}g</span>
                    </div>
                  )}
                  {priceOMagic.dimensionX && priceOMagic.dimensionY && (
                    <div className="col-span-2">
                      <span className="text-gray-500">Dimensions:</span>
                      <span className="text-white font-mono ml-2">
                        {priceOMagic.dimensionX}×{priceOMagic.dimensionY}{priceOMagic.dimensionZ ? `×${priceOMagic.dimensionZ}` : ''}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Appears in Sets */}
            <button 
              type="button"
              className="app-card-muted p-2.5 cursor-pointer hover-elevate transition-colors w-full text-left"
              onClick={() => setSetsDialogOpen(true)}
              data-testid="button-appears-in-sets"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Boxes className="h-3.5 w-3.5 text-purple-400" />
                  <p className="text-[10px] md:text-sm font-bold text-purple-400">APPEARS IN SETS</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {setsTotal !== null && (
                    <Badge variant="secondary" className="text-[10px]" data-testid="badge-sets-count">
                      {setsTotal} {setsTotal === 1 ? 'set' : 'sets'}
                    </Badge>
                  )}
                  <ExternalLink className="h-3 w-3 text-gray-500" />
                </div>
              </div>
              {setsTotal !== null && setsTotal > 0 && (
                <p className="text-[10px] md:text-xs text-gray-400 mt-1.5">
                  Tap to view all {setsTotal} sets containing this part
                </p>
              )}
              {setsTotal !== null && setsTotal === 0 && (
                <p className="text-[10px] md:text-xs text-gray-500 mt-1.5 italic">
                  No sets found for this part in this color
                </p>
              )}
              {setsTotal === null && (
                <div className="h-3 bg-gray-800/50 rounded animate-pulse mt-1.5 w-32" />
              )}
            </button>
          </TabsContent>

          {/* Pricing Tab */}
          <TabsContent value="pricing" className="mt-0 space-y-2.5">
            {/* POM Price Guide Table */}
            {(loadingFullGuide || data.loadingPriceOMagic) && (
              <div className="app-card p-3" data-testid="price-o-magic-loading">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-blue-400 animate-pulse" />
                  <div className="h-4 bg-gray-700 rounded w-28 animate-pulse" />
                </div>
                <div className="h-48 bg-gray-800/30 rounded animate-pulse" />
              </div>
            )}

            {!loadingFullGuide && !data.loadingPriceOMagic && pomFullGuide && (pomFullGuide.N || pomFullGuide.U) && (() => {
              const g = pomFullGuide;
              const nD = g.N;
              const uD = g.U;
              const myCondition = data.newOrUsed || 'N';
              const fmtP = (v: string | null | undefined) => v ? `$${parseFloat(v).toFixed(2)}` : '\u2013';
              const fmtQ = (v: number | null | undefined) => v != null ? v.toLocaleString() : '\u2013';

              const mySugN = nD?.suggestedPrice ? parseFloat(nD.suggestedPrice) : null;
              const mySugU = uD?.suggestedPrice ? parseFloat(uD.suggestedPrice) : null;

              return (
                <div className="app-card overflow-hidden" data-testid="pom-price-guide">
                  <table className="w-full text-[10px] md:text-xs font-mono">
                    <thead>
                      <tr className="border-b border-gray-700">
                        <th className="text-left py-1.5 px-2 text-gray-500 font-semibold w-[22%]" />
                        <th colSpan={2} className="text-center py-1 px-1 text-gray-300 font-bold border-b border-gray-600">SOLD 6MO</th>
                        <th colSpan={2} className="text-center py-1 px-1 text-gray-300 font-bold border-b border-gray-600">LISTED</th>
                      </tr>
                      <tr className="border-b border-gray-700/50">
                        <th className="text-left py-1 px-2 text-gray-500 font-semibold" />
                        <th className="text-center py-1 px-1 text-blue-400 font-bold">NEW</th>
                        <th className="text-center py-1 px-1 text-blue-400 font-bold">USED</th>
                        <th className="text-center py-1 px-1 text-blue-400 font-bold">NEW</th>
                        <th className="text-center py-1 px-1 text-blue-400 font-bold">USED</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-800/50">
                        <td className="py-1.5 px-2 text-gray-400 font-sans font-medium">Qty</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{fmtQ(nD?.soldQty)}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{fmtQ(uD?.soldQty)}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{fmtQ(nD?.listedQty)}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{fmtQ(uD?.listedQty)}</td>
                      </tr>
                      <tr className="border-b border-gray-800/50">
                        <td className="py-1.5 px-2 text-gray-400 font-sans font-medium">Min</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{fmtP(nD?.soldMin)}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{fmtP(uD?.soldMin)}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{fmtP(nD?.listedMin)}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{fmtP(uD?.listedMin)}</td>
                      </tr>
                      <tr className="border-b border-gray-800/50">
                        <td className="py-1.5 px-2 text-white font-sans font-bold">Avg</td>
                        <td className="text-center py-1.5 px-1 text-yellow-400 font-bold">{fmtP(nD?.soldAvg)}</td>
                        <td className="text-center py-1.5 px-1 text-yellow-400 font-bold">{fmtP(uD?.soldAvg)}</td>
                        <td className="text-center py-1.5 px-1 text-yellow-400 font-bold">{fmtP(nD?.listedAvg)}</td>
                        <td className="text-center py-1.5 px-1 text-yellow-400 font-bold">{fmtP(uD?.listedAvg)}</td>
                      </tr>
                      <tr className="border-b border-gray-800/50">
                        <td className="py-1.5 px-2 text-gray-400 font-sans font-medium">Max</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{fmtP(nD?.soldMax)}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{fmtP(uD?.soldMax)}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{fmtP(nD?.listedMax)}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{fmtP(uD?.listedMax)}</td>
                      </tr>
                      {currentPrice > 0 && (
                        <tr className="border-b border-gray-800/50">
                          <td className="py-1.5 px-2 text-green-400 font-sans font-bold">My Price</td>
                          <td className="text-center py-1.5 px-1" />
                          <td className="text-center py-1.5 px-1" />
                          <td className="text-center py-1.5 px-1 text-green-400 font-bold">{myCondition === 'N' ? `$${currentPrice.toFixed(2)}` : ''}</td>
                          <td className="text-center py-1.5 px-1 text-green-400 font-bold">{myCondition === 'U' ? `$${currentPrice.toFixed(2)}` : ''}</td>
                        </tr>
                      )}
                      <tr>
                        <td className="py-1.5 px-2 font-sans font-bold">
                          <Dialog>
                            <DialogTrigger asChild>
                              <button className="text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-0.5" data-testid="button-suggested-price">
                                Suggested
                                <Info className="h-2.5 w-2.5 opacity-60" />
                              </button>
                            </DialogTrigger>
                            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto bg-gray-900 border-gray-600" data-testid="dialog-price-breakdown">
                              <DialogHeader>
                                <DialogTitle className="flex items-center gap-2 text-purple-400">
                                  <Sparkles className="h-5 w-5" />
                                  Suggested Price Calculation
                                </DialogTitle>
                              </DialogHeader>
                              <div className="space-y-3 mt-4">
                                {(() => {
                                  if (!liveSuggestedPrice || !priceOMagic) return null;
                                  const s = pomSettings;
                                  const isMinifig = data.itemType === 'MINIFIG' || data.itemType === 'M';
                                  const bPrice = soldAvgPrice || stockAvgPrice || 0;
                                  const basePremiumPct = isMinifig ? (s?.pomMinifigPremium ?? 5) : (s?.pomBasePremium ?? 10);
                                  const lots = priceOMagic.stockTotalLots ?? 0;
                                  const t1 = s?.pomScarcityThreshold1 ?? 50;
                                  const t2 = s?.pomScarcityThreshold2 ?? 200;
                                  const t3 = s?.pomScarcityThreshold3 ?? 500;
                                  let scarcityBonus = 0;
                                  let scarcityLabel = '';
                                  if (lots < t1) { scarcityBonus = s?.pomScarcityBonus1 ?? 15; scarcityLabel = `< ${t1} listings`; }
                                  else if (lots < t2) { scarcityBonus = s?.pomScarcityBonus2 ?? 8; scarcityLabel = `< ${t2} listings`; }
                                  else if (lots < t3) { scarcityBonus = s?.pomScarcityBonus3 ?? 3; scarcityLabel = `< ${t3} listings`; }
                                  let trendingAdj = 0;
                                  if (s?.pomTrendingEnabled) {
                                    const maxAdj = s?.pomTrendingDays ?? 30;
                                    const demandDenom = s?.pomTrendingThreshold ?? 5;
                                    const supplyDenom = s?.pomHighSupplyThreshold ?? 5000;
                                    const demandRatio = demandDenom > 0 ? Math.min((priceOMagic.soldQuantity ?? 0) / demandDenom, 1.0) : 0;
                                    const supplyRatio = supplyDenom > 0 ? Math.min((priceOMagic.stockQuantity ?? 0) / supplyDenom, 1.0) : 0;
                                    trendingAdj = maxAdj * ((demandRatio * ((s?.pomTrendingBonus ?? 5) / 100)) - (supplyRatio * ((s?.pomHighSupplyPenalty ?? 5) / 100)));
                                  }
                                  const totalPremium = basePremiumPct + scarcityBonus + trendingAdj;
                                  const mktPrice = bPrice * (1 + totalPremium / 100);
                                  const costFloorPct = s?.pomCostFloorPct ?? 0;
                                  const floorMin = parseFloat(String(s?.pomMinPrice ?? '0.02'));
                                  let floorApplied: 'cost' | 'min' | 'none' = 'none';
                                  let fPrice = mktPrice;
                                  if (costFloorPct > 0 && myCost && myCost > 0) {
                                    const costFloor = myCost * (1 + costFloorPct / 100);
                                    if (costFloor > fPrice) { fPrice = costFloor; floorApplied = 'cost'; }
                                  }
                                  if (floorMin > 0 && floorMin > fPrice) { floorApplied = floorApplied === 'none' ? 'min' : floorApplied; fPrice = floorMin; }

                                  return (
                                    <>
                                      <div className="app-card p-3">
                                        <p className="text-xs font-bold text-gray-400 mb-2">STEP 1 — MARKET BASE PRICE</p>
                                        <p className="text-2xl font-mono font-black text-white mb-2">${bPrice.toFixed(3)}</p>
                                        <div className="space-y-1 text-xs">
                                          {soldAvgPrice !== null && (
                                            <div className="flex justify-between gap-1"><span className="text-green-400 font-semibold">6-mo Sold Avg (primary)</span><span className="font-mono text-green-400">${soldAvgPrice.toFixed(3)}</span></div>
                                          )}
                                          {stockAvgPrice !== null && (
                                            <div className="flex justify-between gap-1"><span className={soldAvgPrice ? 'text-gray-500' : 'text-blue-400 font-semibold'}>{soldAvgPrice ? 'Stock Avg (fallback)' : 'Stock Avg (primary)'}</span><span className={`font-mono ${soldAvgPrice ? 'text-gray-500' : 'text-blue-400'}`}>${stockAvgPrice.toFixed(3)}</span></div>
                                          )}
                                        </div>
                                      </div>
                                      <div className="app-card p-3 space-y-2">
                                        <p className="text-xs font-bold text-gray-400 mb-1">STEP 2 — PREMIUM ADJUSTMENTS</p>
                                        <div className="flex justify-between items-start gap-1">
                                          <div><span className="text-xs text-gray-300">{isMinifig ? 'Minifig' : 'Base'} Premium</span></div>
                                          <span className="text-sm font-mono font-bold text-emerald-400 shrink-0">+{basePremiumPct}%</span>
                                        </div>
                                        {scarcityBonus > 0 && (
                                          <div className="flex justify-between items-start border-t border-gray-700 pt-2 gap-1">
                                            <div><span className="text-xs text-gray-300">Scarcity Bonus</span><p className="text-[10px] text-gray-500">{lots} listings ({scarcityLabel})</p></div>
                                            <span className="text-sm font-mono font-bold text-orange-400 shrink-0">+{scarcityBonus}%</span>
                                          </div>
                                        )}
                                        {s?.pomTrendingEnabled && trendingAdj !== 0 && (
                                          <div className="flex justify-between items-start border-t border-gray-700 pt-2 gap-1">
                                            <span className="text-xs text-gray-300">Market Dynamics</span>
                                            <span className={`text-sm font-mono font-bold shrink-0 ${trendingAdj >= 0 ? 'text-blue-400' : 'text-red-400'}`}>{trendingAdj >= 0 ? '+' : ''}{trendingAdj.toFixed(1)}%</span>
                                          </div>
                                        )}
                                        <div className="flex justify-between items-center border-t border-gray-700 pt-2 gap-1">
                                          <span className="text-xs font-bold text-gray-300">Total Premium</span>
                                          <span className="text-sm font-mono font-bold text-white">+{totalPremium.toFixed(1)}%</span>
                                        </div>
                                      </div>
                                      {(costFloorPct > 0 || floorMin > 0) && (
                                        <div className="app-card p-3 space-y-2">
                                          <p className="text-xs font-bold text-gray-400 mb-1">STEP 3 — PRICE FLOORS</p>
                                          {costFloorPct > 0 && myCost && myCost > 0 && (
                                            <div className="flex justify-between items-start gap-1">
                                              <div><span className={`text-xs ${floorApplied === 'cost' ? 'text-yellow-400 font-bold' : 'text-gray-500'}`}>Cost Floor{floorApplied === 'cost' ? ' (applied)' : ''}</span><p className="text-[10px] text-gray-500">${myCost.toFixed(3)} x {100 + costFloorPct}%</p></div>
                                              <span className={`text-sm font-mono shrink-0 ${floorApplied === 'cost' ? 'text-yellow-400' : 'text-gray-600'}`}>${(myCost * (1 + costFloorPct / 100)).toFixed(3)}</span>
                                            </div>
                                          )}
                                          {floorMin > 0 && (
                                            <div className="flex justify-between items-center gap-1">
                                              <span className={`text-xs ${floorApplied === 'min' ? 'text-yellow-400 font-bold' : 'text-gray-500'}`}>Min Price{floorApplied === 'min' ? ' (applied)' : ''}</span>
                                              <span className={`text-sm font-mono shrink-0 ${floorApplied === 'min' ? 'text-yellow-400' : 'text-gray-600'}`}>${floorMin.toFixed(3)}</span>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      <div className="bg-purple-500/10 border border-purple-500/40 rounded-lg p-3">
                                        <p className="text-xs text-gray-400 mb-1">SUGGESTED PRICE</p>
                                        <p className="text-3xl font-mono font-black text-purple-400">${suggestedPrice?.toFixed(3) ?? fPrice.toFixed(3)}</p>
                                        <p className="text-[10px] text-gray-500 mt-1 font-mono">{bPrice.toFixed(3)} x (1 + {totalPremium.toFixed(1)}%) = ${mktPrice.toFixed(3)}{floorApplied !== 'none' ? ` → floor → $${(suggestedPrice ?? fPrice).toFixed(3)}` : ''}</p>
                                      </div>
                                    </>
                                  );
                                })()}
                              </div>
                            </DialogContent>
                          </Dialog>
                        </td>
                        <td className="text-center py-1.5 px-1" />
                        <td className="text-center py-1.5 px-1" />
                        <td className="text-center py-1.5 px-1 text-purple-400 font-bold">{mySugN != null ? `$${mySugN.toFixed(2)}` : '\u2013'}</td>
                        <td className="text-center py-1.5 px-1 text-purple-400 font-bold">{mySugU != null ? `$${mySugU.toFixed(2)}` : '\u2013'}</td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Score Bar */}
                  {g.scoring && (
                    <div className="border-t border-gray-700 px-2 py-2 flex items-center justify-between gap-2 flex-wrap">
                      {[
                        { label: 'CEIL', value: g.scoring.ceiling, suffix: 'x', color: 'text-cyan-400' },
                        { label: 'VEL', value: g.scoring.velocity, suffix: '', color: 'text-gray-300' },
                        { label: 'SCARC', value: g.scoring.scarcity, suffix: '', color: 'text-gray-300' },
                        { label: 'UNDR', value: g.scoring.undercut, suffix: 'x', color: 'text-cyan-400' },
                      ].map(m => (
                        <div key={m.label} className="text-center min-w-0">
                          <p className="text-[8px] md:text-[9px] text-gray-500 font-sans font-semibold tracking-wider">{m.label}</p>
                          <p className={`text-[11px] md:text-xs font-bold font-mono ${m.color}`}>
                            {m.value != null ? `${m.value.toFixed(2)}${m.suffix}` : '\u2013'}
                          </p>
                        </div>
                      ))}
                      <Dialog>
                        <DialogTrigger asChild>
                          <button
                            className="bg-indigo-500/20 border border-indigo-500/40 rounded-md px-2.5 py-1 hover-elevate active-elevate-2 transition-all group"
                            data-testid="button-pom-score"
                          >
                            <p className="text-[8px] md:text-[9px] text-gray-400 font-sans font-semibold tracking-wider">SCORE</p>
                            <p className="text-sm md:text-base font-black font-mono text-indigo-300">
                              {g.scoring.score != null ? g.scoring.score.toFixed(2) : '\u2013'}
                            </p>
                          </button>
                        </DialogTrigger>
                        <DialogContent className="max-w-sm bg-gray-900 border-gray-600" data-testid="dialog-pom-score">
                          <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-indigo-400">
                              <Target className="h-5 w-5" />
                              POM Repricing Score
                            </DialogTitle>
                          </DialogHeader>
                          <div className="space-y-3 mt-3">
                            <p className="text-xs text-gray-400">A weighted composite of four market signals. Higher score = stronger repricing opportunity.</p>
                            {[
                              { label: 'Price Ceiling Ratio', abbr: 'CEIL', value: g.scoring.ceiling, weight: g.scoring.weights.wCeiling, desc: 'Peak sold price / your current price' },
                              { label: 'Demand Velocity', abbr: 'VEL', value: g.scoring.velocity, weight: g.scoring.weights.wVelocity, desc: 'Sold qty / listed qty (demand vs supply)' },
                              { label: 'Market Scarcity', abbr: 'SCARC', value: g.scoring.scarcity, weight: g.scoring.weights.wScarcity, desc: '1 / total listed qty (rarer = higher)' },
                              { label: 'Undercut Ratio', abbr: 'UNDR', value: g.scoring.undercut, weight: g.scoring.weights.wUndercut, desc: 'Your price / market min (uses 1/ratio in score)' },
                            ].map(item => (
                              <div key={item.abbr} className="app-card p-2.5 space-y-1">
                                <div className="flex justify-between items-center gap-1">
                                  <span className="text-xs font-bold text-gray-300">{item.label}</span>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-[9px] text-gray-500">w={item.weight}</span>
                                    <span className="text-sm font-mono font-bold text-white">{item.value != null ? item.value.toFixed(3) : '\u2013'}</span>
                                  </div>
                                </div>
                                <p className="text-[10px] text-gray-500">{item.desc}</p>
                              </div>
                            ))}
                            <div className="bg-indigo-500/10 border border-indigo-500/40 rounded-lg p-3 text-center">
                              <p className="text-[10px] text-gray-400 mb-1">COMPOSITE SCORE</p>
                              <p className="text-3xl font-black font-mono text-indigo-300">{g.scoring.score != null ? g.scoring.score.toFixed(2) : '\u2013'}</p>
                              <p className="text-[9px] text-gray-500 mt-1 font-mono">
                                ({(g.scoring.ceiling ?? 0).toFixed(2)} x {g.scoring.weights.wCeiling}) + ({(g.scoring.velocity ?? 0).toFixed(2)} x {g.scoring.weights.wVelocity}) + ({(g.scoring.scarcity ?? 0).toFixed(4)} x {g.scoring.weights.wScarcity}) + ({g.scoring.undercut ? `1/${g.scoring.undercut.toFixed(2)}` : '\u2013'} x {g.scoring.weights.wUndercut})
                              </p>
                            </div>
                            {onOpenSettings && (
                              <button
                                onClick={() => onOpenSettings('priceomatic')}
                                className="flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300 transition-colors pt-1.5 border-t border-gray-700/40 w-full"
                                data-testid="button-tune-scoring-settings"
                              >
                                <Settings2 className="w-3 h-3" />
                                Tune scoring weights
                              </button>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  )}
                </div>
              );
            })()}

            {!loadingFullGuide && !data.loadingPriceOMagic && (!pomFullGuide || (!pomFullGuide.N && !pomFullGuide.U)) && priceOMagic && (() => {
              const pm = priceOMagic;
              const cond = data.newOrUsed || 'N';
              const fmtP = (v: string | null | undefined) => v ? `$${parseFloat(v).toFixed(2)}` : '\u2013';
              const fmtQ = (v: number | null | undefined) => v != null ? v.toLocaleString() : '\u2013';
              const sugP = pm.suggestedPrice ? parseFloat(pm.suggestedPrice) : null;
              return (
                <div className="app-card overflow-hidden" data-testid="pom-price-guide-fallback">
                  <table className="w-full text-[10px] md:text-xs font-mono">
                    <thead>
                      <tr className="border-b border-gray-700">
                        <th className="text-left py-1.5 px-2 text-gray-500 font-semibold w-[22%]" />
                        <th colSpan={2} className="text-center py-1 px-1 text-gray-300 font-bold border-b border-gray-600">SOLD 6MO</th>
                        <th colSpan={2} className="text-center py-1 px-1 text-gray-300 font-bold border-b border-gray-600">LISTED</th>
                      </tr>
                      <tr className="border-b border-gray-700/50">
                        <th className="text-left py-1 px-2 text-gray-500 font-semibold" />
                        <th className="text-center py-1 px-1 text-blue-400 font-bold">NEW</th>
                        <th className="text-center py-1 px-1 text-blue-400 font-bold">USED</th>
                        <th className="text-center py-1 px-1 text-blue-400 font-bold">NEW</th>
                        <th className="text-center py-1 px-1 text-blue-400 font-bold">USED</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-800/50">
                        <td className="py-1.5 px-2 text-gray-400 font-sans font-medium">Qty</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{cond === 'N' ? fmtQ(pm.soldQuantity ?? parseInt(pm.soldTotalLots?.toString() || '0')) : '\u2013'}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{cond === 'U' ? fmtQ(pm.soldQuantity ?? parseInt(pm.soldTotalLots?.toString() || '0')) : '\u2013'}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{cond === 'N' ? fmtQ(pm.stockQuantity ?? pm.stockTotalLots) : '\u2013'}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{cond === 'U' ? fmtQ(pm.stockQuantity ?? pm.stockTotalLots) : '\u2013'}</td>
                      </tr>
                      <tr className="border-b border-gray-800/50">
                        <td className="py-1.5 px-2 text-gray-400 font-sans font-medium">Min</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{cond === 'N' ? fmtP(pm.soldMinPrice) : '\u2013'}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{cond === 'U' ? fmtP(pm.soldMinPrice) : '\u2013'}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{cond === 'N' ? fmtP(pm.stockMinPrice) : '\u2013'}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{cond === 'U' ? fmtP(pm.stockMinPrice) : '\u2013'}</td>
                      </tr>
                      <tr className="border-b border-gray-800/50">
                        <td className="py-1.5 px-2 text-white font-sans font-bold">Avg</td>
                        <td className="text-center py-1.5 px-1 text-yellow-400 font-bold">{cond === 'N' ? fmtP(pm.soldAvgPrice) : '\u2013'}</td>
                        <td className="text-center py-1.5 px-1 text-yellow-400 font-bold">{cond === 'U' ? fmtP(pm.soldAvgPrice) : '\u2013'}</td>
                        <td className="text-center py-1.5 px-1 text-yellow-400 font-bold">{cond === 'N' ? fmtP(pm.stockAvgPrice) : '\u2013'}</td>
                        <td className="text-center py-1.5 px-1 text-yellow-400 font-bold">{cond === 'U' ? fmtP(pm.stockAvgPrice) : '\u2013'}</td>
                      </tr>
                      <tr className="border-b border-gray-800/50">
                        <td className="py-1.5 px-2 text-gray-400 font-sans font-medium">Max</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{cond === 'N' ? fmtP(pm.soldMaxPrice) : '\u2013'}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{cond === 'U' ? fmtP(pm.soldMaxPrice) : '\u2013'}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{cond === 'N' ? fmtP(pm.stockMaxPrice) : '\u2013'}</td>
                        <td className="text-center py-1.5 px-1 text-gray-300">{cond === 'U' ? fmtP(pm.stockMaxPrice) : '\u2013'}</td>
                      </tr>
                      {currentPrice > 0 && (
                        <tr className="border-b border-gray-800/50">
                          <td className="py-1.5 px-2 text-green-400 font-sans font-bold">My Price</td>
                          <td className="text-center py-1.5 px-1" />
                          <td className="text-center py-1.5 px-1" />
                          <td className="text-center py-1.5 px-1 text-green-400 font-bold">{cond === 'N' ? `$${currentPrice.toFixed(2)}` : ''}</td>
                          <td className="text-center py-1.5 px-1 text-green-400 font-bold">{cond === 'U' ? `$${currentPrice.toFixed(2)}` : ''}</td>
                        </tr>
                      )}
                      {sugP != null && (
                        <tr>
                          <td className="py-1.5 px-2 text-purple-400 font-sans font-bold">Suggested</td>
                          <td className="text-center py-1.5 px-1" />
                          <td className="text-center py-1.5 px-1" />
                          <td className="text-center py-1.5 px-1 text-purple-400 font-bold">{cond === 'N' ? `$${sugP.toFixed(2)}` : ''}</td>
                          <td className="text-center py-1.5 px-1 text-purple-400 font-bold">{cond === 'U' ? `$${sugP.toFixed(2)}` : ''}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {!loadingFullGuide && !data.loadingPriceOMagic && (!pomFullGuide || (!pomFullGuide.N && !pomFullGuide.U)) && !priceOMagic && (
              <div className="app-card-muted p-3 text-center">
                <BarChart3 className="h-5 w-5 text-gray-500 mx-auto mb-1.5" />
                <p className="text-xs text-gray-400">No price guide data available</p>
                <p className="text-[10px] text-gray-500 mt-0.5">Run a POM sync to populate pricing data for this item</p>
              </div>
            )}

            {/* Tier Pricing */}
            {hasTierPricing && (
              <div className="app-card-muted p-2.5">
                <p className="text-[10px] md:text-sm font-bold text-gray-400 mb-2">BULK DISCOUNTS</p>
                <div className="space-y-1.5">
                  {data.tierQuantity1 && data.tierPrice1 && parseFloat(data.tierPrice1) > 0 && (
                    <div className="flex items-center justify-between bg-gray-900/50 rounded px-2.5 py-1.5">
                      <span className="text-xs text-gray-400">{data.tierQuantity1}+ units</span>
                      <span className="text-xs font-mono text-green-400">${parseFloat(data.tierPrice1).toFixed(2)}</span>
                    </div>
                  )}
                  {data.tierQuantity2 && data.tierPrice2 && parseFloat(data.tierPrice2) > 0 && (
                    <div className="flex items-center justify-between bg-gray-900/50 rounded px-2.5 py-1.5">
                      <span className="text-xs text-gray-400">{data.tierQuantity2}+ units</span>
                      <span className="text-xs font-mono text-green-400">${parseFloat(data.tierPrice2).toFixed(2)}</span>
                    </div>
                  )}
                  {data.tierQuantity3 && data.tierPrice3 && parseFloat(data.tierPrice3) > 0 && (
                    <div className="flex items-center justify-between bg-gray-900/50 rounded px-2.5 py-1.5">
                      <span className="text-xs text-gray-400">{data.tierQuantity3}+ units</span>
                      <span className="text-xs font-mono text-green-400">${parseFloat(data.tierPrice3).toFixed(2)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Sale Rate */}
            {data.saleRate !== undefined && data.saleRate !== null && data.saleRate > 0 && (
              <div className="app-card-muted p-2.5">
                <p className="text-[10px] md:text-sm font-bold text-gray-400 mb-1">SALE DISCOUNT</p>
                <p className="text-xl font-black font-mono text-red-400">{data.saleRate}% OFF</p>
              </div>
            )}
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="mt-0 space-y-2.5">
            {/* Date Range Selector */}
            <div className="app-card-muted p-2">
              <p className="text-[9px] md:text-xs font-bold text-gray-400 mb-1.5">ANALYSIS PERIOD</p>
              <div className="grid grid-cols-5 gap-1">
                {[
                  { value: '3months' as const, label: '3M' },
                  { value: '6months' as const, label: '6M' },
                  { value: '1year' as const, label: '1Y' },
                  { value: '2years' as const, label: '2Y' },
                  { value: 'all' as const, label: 'All' }
                ].map(option => (
                  <button
                    key={option.value}
                    onClick={() => setDateRange(option.value)}
                    className={`text-[9px] md:text-xs font-bold py-1 px-2 rounded transition-all ${
                      dateRange === option.value
                        ? 'bg-lego-orange text-white border border-lego-orange'
                        : 'bg-gray-900 text-gray-400 border border-gray-700 hover-elevate'
                    }`}
                    data-testid={`button-range-${option.value}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {loadingAnalytics ? (
              <div className="app-card-muted p-4 text-center">
                <BarChart3 className="h-8 w-8 text-lego-orange mx-auto mb-2 animate-pulse" />
                <p className="text-xs text-gray-400">Loading analytics...</p>
              </div>
            ) : analytics ? (
              <>
                {/* Sales Performance */}
                <div className="app-card-muted p-2.5">
                  <div className="flex items-center gap-1.5 mb-2">
                    <TrendingUp className="h-3.5 w-3.5 text-green-400" />
                    <p className="text-[10px] md:text-sm font-bold text-green-400">SALES PERFORMANCE</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div className="text-center">
                      <ShoppingCart className="h-4 w-4 text-lego-blue mx-auto mb-1" />
                      <p className="text-[9px] md:text-xs text-gray-400 mb-0.5">TOTAL SOLD</p>
                      <p className="text-lg font-black font-mono text-lego-blue">{analytics.totalUnitsSold}</p>
                    </div>
                    <div className="text-center">
                      <DollarSign className="h-4 w-4 text-lego-green mx-auto mb-1" />
                      <p className="text-[9px] md:text-xs text-gray-400 mb-0.5">REVENUE</p>
                      <p className="text-lg font-black font-mono text-lego-green">${analytics.totalRevenue}</p>
                    </div>
                    <div className="text-center">
                      <Zap className="h-4 w-4 text-lego-orange mx-auto mb-1" />
                      <p className="text-[9px] md:text-xs text-gray-400 mb-0.5">VELOCITY</p>
                      <p className="text-lg font-black font-mono text-lego-orange">{analytics.salesVelocity}/mo</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-gray-900/50 rounded px-2.5 py-1.5">
                      <span className="text-gray-500 block text-[9px] md:text-xs">Avg Price</span>
                      <span className="text-white font-mono">${analytics.averageSellingPrice}</span>
                    </div>
                    <div className="bg-gray-900/50 rounded px-2.5 py-1.5">
                      <span className="text-gray-500 block text-[9px] md:text-xs">Orders</span>
                      <span className="text-white font-mono">{analytics.totalOrders}</span>
                    </div>
                  </div>
                </div>

                {/* Movement Insights */}
                <div className="app-card-muted p-2.5">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Clock className="h-3.5 w-3.5 text-yellow-400" />
                    <p className="text-[10px] md:text-sm font-bold text-yellow-400">MOVEMENT INSIGHTS</p>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between bg-gray-900/50 rounded px-2.5 py-1.5">
                      <span className="text-gray-500">Last Sold:</span>
                      <span className={`font-mono ${analytics.daysSinceLastSold === null ? 'text-gray-400' : analytics.daysSinceLastSold > 90 ? 'text-red-400' : analytics.daysSinceLastSold > 30 ? 'text-yellow-400' : 'text-green-400'}`}>
                        {analytics.daysSinceLastSold === null ? 'Never' : `${analytics.daysSinceLastSold} days ago`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between bg-gray-900/50 rounded px-2.5 py-1.5">
                      <span className="text-gray-500">In Inventory:</span>
                      <span className="text-white font-mono">{analytics.daysInInventory || 'N/A'} days</span>
                    </div>
                    <div className="flex items-center justify-between bg-gray-900/50 rounded px-2.5 py-1.5">
                      <span className="text-gray-500">Best Month:</span>
                      <span className="text-white font-mono">{analytics.bestSellingMonth} ({analytics.bestSellingMonthUnits} units)</span>
                    </div>
                  </div>
                </div>

                {/* Recent Activity */}
                <div className="app-card-muted p-2.5">
                  <p className="text-[10px] md:text-sm font-bold text-gray-400 mb-2">RECENT ACTIVITY (3 MONTHS)</p>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 text-center">
                      <p className="text-xl font-black font-mono text-purple-400">{analytics.recentSales.last3Months}</p>
                      <p className="text-[9px] md:text-xs text-gray-500">Units Sold</p>
                    </div>
                    <div className="flex-1 text-center">
                      <p className="text-xl font-black font-mono text-purple-400">{analytics.recentSales.percentOfTotal}%</p>
                      <p className="text-[9px] md:text-xs text-gray-500">of Total</p>
                    </div>
                  </div>
                </div>

                {/* Top Customers */}
                {analytics.topCustomers.length > 0 && (
                  <div className="app-card-muted p-2.5">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Users className="h-3.5 w-3.5 text-blue-400" />
                      <p className="text-[10px] md:text-sm font-bold text-blue-400">TOP CUSTOMERS</p>
                    </div>
                    <div className="space-y-1.5">
                      {analytics.topCustomers.map((customer, idx) => (
                        <div key={idx} className="bg-gray-900/50 rounded px-2.5 py-1.5">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs text-white truncate pr-2">{customer.name}</span>
                            <span className="text-xs font-mono text-lego-green">{customer.units} units</span>
                          </div>
                          <div className="flex items-center justify-between text-[9px] md:text-xs">
                            <span className="text-gray-500">{customer.orders} {customer.orders === 1 ? 'order' : 'orders'}</span>
                            <span className="text-gray-400 font-mono">${customer.revenue.toFixed(2)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Strategy Recommendations — static fallback when no AI insights are open */}
                <div className="bg-gradient-to-r from-lego-orange/20 via-lego-orange/10 to-transparent border border-lego-orange/30 rounded-lg p-2.5">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Sparkles className="h-3.5 w-3.5 text-lego-orange" />
                    <p className="text-[10px] md:text-sm font-bold text-lego-orange">MOVEMENT STRATEGIES</p>
                  </div>
                  <div className="space-y-1.5 text-xs text-gray-300">
                    {analytics.daysSinceLastSold !== null && analytics.daysSinceLastSold > 90 && (
                      <p className="flex items-start gap-1.5">
                        <span className="text-yellow-400 mt-0.5">&bull;</span>
                        <span>Consider price reduction - item hasn't sold in {analytics.daysSinceLastSold} days</span>
                      </p>
                    )}
                    {parseFloat(analytics.salesVelocity) > 5 && (
                      <p className="flex items-start gap-1.5">
                        <span className="text-green-400 mt-0.5">&bull;</span>
                        <span>High velocity item ({analytics.salesVelocity}/mo) - consider restocking</span>
                      </p>
                    )}
                    {analytics.topCustomers.length > 0 && analytics.topCustomers[0].orders > 1 && (
                      <p className="flex items-start gap-1.5">
                        <span className="text-blue-400 mt-0.5">&bull;</span>
                        <span>Repeat buyers detected - reach out to {analytics.topCustomers[0].name} for bulk offers</span>
                      </p>
                    )}
                    {analytics.bestSellingMonth !== 'N/A' && (
                      <p className="flex items-start gap-1.5">
                        <span className="text-purple-400 mt-0.5">&bull;</span>
                        <span>Best sales in {analytics.bestSellingMonth} - plan promotions accordingly</span>
                      </p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="app-card-muted p-4 text-center">
                <BarChart3 className="h-8 w-8 text-gray-600 mx-auto mb-2" />
                <p className="text-xs text-gray-500">No sales data available</p>
                <p className="text-[10px] md:text-sm text-gray-600 mt-1">This item hasn't been sold yet</p>
              </div>
            )}
          </TabsContent>

          {/* Details Tab */}
          <TabsContent value="details" className="mt-0 space-y-2.5">
            {/* Identifiers */}
            <div className="app-card-muted p-2.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Tag className="h-3.5 w-3.5 text-blue-400" />
                <p className="text-[10px] md:text-sm font-bold text-blue-400">IDENTIFIERS</p>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Inventory ID:</span>
                  <span className="text-white font-mono">#{data.id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Part Number:</span>
                  <span className="text-white font-mono">{data.itemNo}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Item Type:</span>
                  <span className="text-white font-mono">{data.itemType}</span>
                </div>
                {data.colorId !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Color ID:</span>
                    <span className="text-white font-mono">#{data.colorId}</span>
                  </div>
                )}
                {data.bindId && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Bind ID:</span>
                    <span className="text-white font-mono">#{data.bindId}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Inventory Settings */}
            <div className="app-card-muted p-2.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Database className="h-3.5 w-3.5 text-purple-400" />
                <p className="text-[10px] md:text-sm font-bold text-purple-400">INVENTORY SETTINGS</p>
              </div>
              <div className="space-y-1.5 text-xs">
                {data.completeness && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Completeness:</span>
                    <span className="text-white">{data.completeness}</span>
                  </div>
                )}
                {data.bulk && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Bulk:</span>
                    <span className="text-white font-mono">{data.bulk}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Retain:</span>
                  <span className={data.isRetain ? "text-green-400" : "text-gray-500"}>
                    {data.isRetain ? "Yes" : "No"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Stock Room:</span>
                  <span className={data.isStockRoom ? "text-green-400" : "text-gray-500"}>
                    {data.isStockRoom ? data.stockRoomId || "Yes" : "No"}
                  </span>
                </div>
                {data.dateCreated && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Date Created:</span>
                    <span className="text-white">{new Date(data.dateCreated).toLocaleDateString()}</span>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>

      {/* Footer - Always visible with fixed height */}
      <div className="flex-shrink-0 flex items-center justify-between bg-gray-800 border border-gray-700 rounded-lg p-2.5 mt-3">
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 text-gray-400" />
          <span className="text-[10px] md:text-sm text-gray-400">
            Updated <span className="font-bold text-white">{data.updatedAt ? new Date(data.updatedAt).toLocaleDateString() : 'N/A'}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Sets Dialog */}
          <Dialog open={setsDialogOpen} onOpenChange={(open) => { setSetsDialogOpen(open); if (!open) setSetsSearch(''); }}>
            <DialogContent className="max-w-3xl max-h-[80vh]" aria-describedby="sets-dialog-description">
              <DialogHeader>
                <DialogTitle className="text-base font-bold text-white flex items-center flex-wrap gap-2">
                  <span>Sets Containing {data.itemNo}</span>
                  {setsData?.color && (
                    <span className="flex items-center gap-1.5 text-sm font-normal">
                      <span className="text-gray-500">in</span>
                      <div 
                        className="w-3 h-3 rounded-full border border-gray-600"
                        style={{ 
                          backgroundColor: setsData.color.rgb ? `#${setsData.color.rgb}` : '#666'
                        }}
                      />
                      <span className="text-lego-blue">{setsData.color.name}</span>
                    </span>
                  )}
                  {setsTotal !== null && (
                    <Badge variant="secondary" className="text-[10px]">
                      {setsTotal} {setsTotal === 1 ? 'set' : 'sets'}
                    </Badge>
                  )}
                </DialogTitle>
              </DialogHeader>
              {setsData && !loadingSets && setsData.sets.length > 5 && (
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
                  <Input
                    placeholder="Search by set number or name..."
                    value={setsSearch}
                    onChange={(e) => setSetsSearch(e.target.value)}
                    className="pl-8 text-xs h-8 bg-gray-800/50 border-gray-700"
                    data-testid="input-sets-search"
                  />
                </div>
              )}
              <div id="sets-dialog-description" className="overflow-y-auto max-h-[calc(80vh-160px)]">
                {loadingSets && (
                  <div className="space-y-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="h-10 bg-gray-800/50 rounded animate-pulse" />
                    ))}
                  </div>
                )}
                {!loadingSets && filteredSets.length > 0 && (
                  <div className="space-y-0.5">
                    {setsSearch.trim() && (
                      <p className="text-[10px] text-gray-500 mb-1.5 px-1">
                        {filteredSets.length} of {setsData!.total} sets match "{setsSearch.trim()}"
                      </p>
                    )}
                    {filteredSets.map((set, index) => (
                      <div 
                        key={set.setNum}
                        className={`rounded px-3 py-2 ${
                          index % 2 === 0 ? 'bg-gray-800/30' : 'bg-gray-800/50'
                        }`}
                        data-testid={`set-row-${set.setNum}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span className="text-xs font-mono font-bold text-lego-blue whitespace-nowrap">
                              {set.setNum}
                            </span>
                            <span className="text-xs text-gray-300 truncate flex-1">
                              {set.setName || 'Unknown Set'}
                            </span>
                            <span className="text-[10px] md:text-sm text-lego-yellow font-bold whitespace-nowrap">
                              {set.quantity}×
                            </span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              window.open(`https://www.bricklink.com/v2/catalog/catalogitem.page?S=${set.setNum}`, '_blank', 'noopener,noreferrer');
                            }}
                            className="flex-shrink-0 text-gray-400 hover:text-lego-blue transition-colors"
                            data-testid={`link-set-${set.setNum}`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!loadingSets && setsSearch.trim() && filteredSets.length === 0 && setsData && setsData.total > 0 && (
                  <div className="text-center py-8">
                    <Search className="h-8 w-8 text-gray-600 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">No sets match "{setsSearch.trim()}"</p>
                    <p className="text-xs text-gray-500 mt-1">Try a different search term</p>
                  </div>
                )}
                {!loadingSets && setsData?.sets && setsData.sets.length === 0 && (
                  <div className="text-center py-12">
                    <Boxes className="h-10 w-10 text-gray-600 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">No sets found for this part</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Note: BrickLink and Rebrickable use different part numbering
                    </p>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>

          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(bricklinkUrl, '_blank', 'noopener,noreferrer');
            }}
            className="flex items-center gap-1 text-[10px] md:text-sm font-bold text-lego-blue hover:text-lego-blue/80 transition-colors whitespace-nowrap"
            data-testid="link-bricklink"
          >
            BRICKLINK
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <ItemBusinessInsightsDialog
        itemId={data.id}
        itemName={`${data.itemNo} — ${itemName}`}
        open={insightsOpen}
        onOpenChange={setInsightsOpen}
      />
    </div>
  );
}

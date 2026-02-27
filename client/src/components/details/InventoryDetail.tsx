import { Package, DollarSign, Weight, Calendar, ExternalLink, TrendingUp, Sparkles, BarChart3, ShoppingCart, FileText, AlertCircle, Database, Tag, Box, Layers, Users, Clock, Zap, Info, MapPin, Boxes } from "lucide-react";
import PartImage from "@/components/PartImage";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

interface PriceOMagicData {
  itemNo: string;
  itemType: string;
  colorId: number | null;
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
}


export default function InventoryDetail({ data, onBrickLinkClick }: InventoryDetailProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [dateRange, setDateRange] = useState<'all' | '1year' | '2years' | '3months' | '6months'>('all');
  const [setsDialogOpen, setSetsDialogOpen] = useState(false);
  const priceOMagic = data.priceOMagic;

  // Fetch current POM formula settings for live price computation
  const { data: pomSettings } = useQuery<any>({
    queryKey: ['/api/settings'],
    staleTime: 5 * 60 * 1000,
  });

  // Fetch warehouse location
  const { data: warehouseLocation } = useQuery<any[]>({
    queryKey: [`/api/warehouse/locations?inventoryId=${data.id}`],
    enabled: !data.loading && !!data.id,
  });

  // Fetch sets containing this part in this color
  const { data: setsData, isLoading: loadingSets } = useQuery<{ 
    sets: Array<{ 
      setNum: string; 
      setName: string | null; 
      quantity: number;
    }>;
    color: {
      id: number;
      name: string;
      rgb: string | null;
    } | null;
  }>({
    queryKey: [`/api/inventory/${data.itemNo}/${data.colorId || 0}/sets`],
    enabled: setsDialogOpen && !!data.itemNo,
  });

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

  const suggestedPrice = liveSuggestedPrice;
  
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
              <Badge className={`text-[9px] md:text-xs h-4 px-2 font-bold ${
                data.newOrUsed === 'N' 
                  ? 'bg-lego-green/20 text-lego-green border-lego-green/40' 
                  : 'bg-lego-orange/20 text-lego-orange border-lego-orange/40'
              }`}>
                {conditionText}
              </Badge>
              {data.bindId && (
                <Badge className="bg-purple-500/20 text-purple-400 border-purple-400/40 text-[9px] md:text-xs h-4 px-2 font-bold">
                  BIND #{data.bindId}
                </Badge>
              )}
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
                  <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <FileText className="h-3.5 w-3.5 text-blue-400" />
                      <p className="text-[10px] md:text-sm font-bold text-blue-400">DESCRIPTION</p>
                    </div>
                    <p className="text-xs text-gray-300 leading-relaxed">{data.description}</p>
                  </div>
                )}
                {data.remarks && (
                  <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
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
            <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
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
            <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
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
              <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
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

            {/* Sets & Usage - Placeholder for future implementation */}
            <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Layers className="h-3.5 w-3.5 text-purple-400" />
                <p className="text-[10px] md:text-sm font-bold text-purple-400">APPEARS IN SETS</p>
              </div>
              <p className="text-[10px] md:text-sm text-gray-400 italic">
                Set information will be available soon. This requires additional BrickLink API calls.
              </p>
            </div>
          </TabsContent>

          {/* Pricing Tab */}
          <TabsContent value="pricing" className="mt-0 space-y-2.5">
            {/* Loading skeleton for Price-o-Matic */}
            {data.loadingPriceOMagic && (
              <div className="bg-gradient-to-br from-purple-500/20 to-purple-500/5 border-2 border-purple-500/50 rounded-lg p-3" data-testid="price-o-magic-loading">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-purple-400 animate-pulse" />
                  <div className="h-4 bg-purple-800 rounded w-24 animate-pulse"></div>
                </div>
                <div className="h-24 bg-purple-900/20 rounded animate-pulse"></div>
              </div>
            )}
            
            {/* Price-o-Matic Section */}
            {!data.loadingPriceOMagic && priceOMagic && suggestedPrice !== null && (
              <div className="bg-gradient-to-br from-purple-500/20 to-purple-500/5 border-2 border-purple-500/50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-purple-400" />
                  <h4 className="text-xs font-black text-purple-400">PRICE-O-MAGIC</h4>
                  <Badge className="bg-purple-500/30 text-purple-300 border-purple-400/40 text-[9px] md:text-xs h-4 px-2 font-bold ml-auto">
                    +{liveTotalPremiumPct}% PREMIUM
                  </Badge>
                </div>
                
                {/* Suggested Price - Clickable for breakdown */}
                <Dialog>
                  <DialogTrigger asChild>
                    <button 
                      className="w-full bg-gradient-to-br from-purple-600/20 to-transparent border border-purple-500/30 rounded-lg p-2.5 mb-2 text-center hover-elevate active-elevate-2 transition-all group"
                      data-testid="button-price-breakdown"
                    >
                      <div className="flex items-center justify-center gap-1.5 mb-1">
                        <p className="text-[10px] md:text-sm text-purple-300 font-bold">SUGGESTED PRICE</p>
                        <Info className="h-3 w-3 text-purple-400 opacity-60 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <p className="text-3xl font-black font-mono text-purple-400">
                        ${suggestedPrice.toFixed(3)}
                      </p>
                      {currentPrice > 0 && suggestedPrice > currentPrice && (
                        <p className="text-[10px] md:text-sm text-purple-300/70 mt-1">
                          +${(suggestedPrice - currentPrice).toFixed(3)} vs current
                        </p>
                      )}
                      <p className="text-[9px] md:text-xs text-purple-400/60 mt-1 group-hover:text-purple-400/80 transition-colors">
                        Tap to see calculation
                      </p>
                    </button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto bg-gray-900 border-purple-500/50" data-testid="dialog-price-breakdown">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2 text-purple-400">
                        <Sparkles className="h-5 w-5" />
                        Price-o-Matic Calculation
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 mt-4">
                      {(() => {
                        if (!liveSuggestedPrice || !priceOMagic) return null;
                        const s = pomSettings;
                        const isMinifig = data.itemType === 'MINIFIG' || data.itemType === 'M';
                        const basePrice = soldAvgPrice || stockAvgPrice || 0;
                        const basePremiumPct = isMinifig ? (s?.pomMinifigPremium ?? 5) : (s?.pomBasePremium ?? 10);

                        // Scarcity
                        const lots = priceOMagic.stockTotalLots ?? 0;
                        const t1 = s?.pomScarcityThreshold1 ?? 50;
                        const t2 = s?.pomScarcityThreshold2 ?? 200;
                        const t3 = s?.pomScarcityThreshold3 ?? 500;
                        let scarcityBonus = 0;
                        let scarcityLabel = '';
                        if (lots < t1) { scarcityBonus = s?.pomScarcityBonus1 ?? 15; scarcityLabel = `< ${t1} listings`; }
                        else if (lots < t2) { scarcityBonus = s?.pomScarcityBonus2 ?? 8; scarcityLabel = `< ${t2} listings`; }
                        else if (lots < t3) { scarcityBonus = s?.pomScarcityBonus3 ?? 3; scarcityLabel = `< ${t3} listings`; }

                        // Market dynamics
                        let trendingAdj = 0;
                        const trendingEnabled = s?.pomTrendingEnabled ?? false;
                        if (trendingEnabled) {
                          const maxAdj = s?.pomTrendingDays ?? 30;
                          const demandDenom = s?.pomTrendingThreshold ?? 5;
                          const supplyDenom = s?.pomHighSupplyThreshold ?? 5000;
                          const demandRatio = demandDenom > 0 ? Math.min((priceOMagic.soldQuantity ?? 0) / demandDenom, 1.0) : 0;
                          const supplyRatio = supplyDenom > 0 ? Math.min((priceOMagic.stockQuantity ?? 0) / supplyDenom, 1.0) : 0;
                          const demandContrib = demandRatio * ((s?.pomTrendingBonus ?? 5) / 100);
                          const supplyContrib = supplyRatio * ((s?.pomHighSupplyPenalty ?? 5) / 100);
                          trendingAdj = maxAdj * (demandContrib - supplyContrib);
                        }

                        const totalPremium = basePremiumPct + scarcityBonus + trendingAdj;
                        const marketPrice = basePrice * (1 + totalPremium / 100);

                        // Floors
                        const costFloorPct = s?.pomCostFloorPct ?? 0;
                        const minPrice = parseFloat(String(s?.pomMinPrice ?? '0.02'));
                        let floorApplied: 'cost' | 'min' | 'none' = 'none';
                        let finalPrice = marketPrice;
                        if (costFloorPct > 0 && myCost && myCost > 0) {
                          const costFloor = myCost * (1 + costFloorPct / 100);
                          if (costFloor > finalPrice) { finalPrice = costFloor; floorApplied = 'cost'; }
                        }
                        if (minPrice > 0 && minPrice > finalPrice) { floorApplied = floorApplied === 'none' ? 'min' : floorApplied; finalPrice = minPrice; }

                        return (
                          <>
                            {/* Step 1: Market Base */}
                            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
                              <p className="text-xs font-bold text-gray-400 mb-2">STEP 1 — MARKET BASE PRICE</p>
                              <p className="text-2xl font-mono font-black text-white mb-2">
                                ${basePrice.toFixed(3)}
                              </p>
                              <div className="space-y-1 text-xs">
                                {soldAvgPrice !== null && (
                                  <div className="flex justify-between">
                                    <span className="text-green-400 font-semibold">✓ 6-mo Sold Avg (primary):</span>
                                    <span className="font-mono text-green-400">${soldAvgPrice.toFixed(3)}</span>
                                  </div>
                                )}
                                {stockAvgPrice !== null && (
                                  <div className="flex justify-between">
                                    <span className={`${soldAvgPrice ? 'text-gray-500' : 'text-blue-400 font-semibold'}`}>
                                      {soldAvgPrice ? 'Stock Avg (fallback):' : '✓ Stock Avg (primary):'}
                                    </span>
                                    <span className={`font-mono ${soldAvgPrice ? 'text-gray-500' : 'text-blue-400'}`}>${stockAvgPrice.toFixed(3)}</span>
                                  </div>
                                )}
                                {priceOMagic.stockMinPrice && priceOMagic.stockMaxPrice && (
                                  <div className="flex justify-between text-gray-500">
                                    <span>Market range:</span>
                                    <span className="font-mono">${parseFloat(priceOMagic.stockMinPrice).toFixed(2)} – ${parseFloat(priceOMagic.stockMaxPrice).toFixed(2)}</span>
                                  </div>
                                )}
                                <p className="text-[10px] text-gray-500 pt-1">Sold avg used when available — reflects actual demand. Stock avg used as fallback.</p>
                              </div>
                            </div>

                            {/* Step 2: Premiums */}
                            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-2">
                              <p className="text-xs font-bold text-gray-400 mb-1">STEP 2 — PREMIUM ADJUSTMENTS</p>

                              <div className="flex justify-between items-start">
                                <div>
                                  <span className="text-xs text-gray-300">{isMinifig ? 'Minifig' : 'Base'} Premium</span>
                                  <p className="text-[10px] text-gray-500">{isMinifig ? 'Minifig-specific rate from settings' : 'Base rate from settings'}</p>
                                </div>
                                <div className="text-right shrink-0 ml-2">
                                  <span className="text-sm font-mono font-bold text-purple-400">+{basePremiumPct}%</span>
                                  <span className="text-xs text-gray-500 ml-2">+${(basePrice * basePremiumPct / 100).toFixed(3)}</span>
                                </div>
                              </div>

                              {scarcityBonus > 0 && (
                                <div className="flex justify-between items-start border-t border-gray-700 pt-2">
                                  <div>
                                    <span className="text-xs text-gray-300">Scarcity Bonus</span>
                                    <p className="text-[10px] text-gray-500">{lots} listings worldwide ({scarcityLabel})</p>
                                  </div>
                                  <div className="text-right shrink-0 ml-2">
                                    <span className="text-sm font-mono font-bold text-orange-400">+{scarcityBonus}%</span>
                                    <span className="text-xs text-gray-500 ml-2">+${(basePrice * scarcityBonus / 100).toFixed(3)}</span>
                                  </div>
                                </div>
                              )}
                              {scarcityBonus === 0 && priceOMagic.stockTotalLots !== null && (
                                <div className="flex justify-between items-center border-t border-gray-700 pt-2">
                                  <div>
                                    <span className="text-xs text-gray-500">Scarcity Bonus</span>
                                    <p className="text-[10px] text-gray-500">{lots} listings (≥ {t3} — normal supply)</p>
                                  </div>
                                  <span className="text-xs font-mono text-gray-600">+0%</span>
                                </div>
                              )}

                              {trendingEnabled && trendingAdj !== 0 && (
                                <div className="flex justify-between items-start border-t border-gray-700 pt-2">
                                  <div>
                                    <span className="text-xs text-gray-300">Market Dynamics</span>
                                    <p className="text-[10px] text-gray-500">Demand vs. supply signal</p>
                                  </div>
                                  <div className="text-right shrink-0 ml-2">
                                    <span className={`text-sm font-mono font-bold ${trendingAdj >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                                      {trendingAdj >= 0 ? '+' : ''}{trendingAdj.toFixed(1)}%
                                    </span>
                                    <span className="text-xs text-gray-500 ml-2">{trendingAdj >= 0 ? '+' : ''}${(basePrice * trendingAdj / 100).toFixed(3)}</span>
                                  </div>
                                </div>
                              )}

                              <div className="flex justify-between items-center border-t border-gray-700 pt-2">
                                <span className="text-xs font-bold text-gray-300">Total Premium</span>
                                <span className="text-sm font-mono font-bold text-white">+{totalPremium.toFixed(1)}% → ${marketPrice.toFixed(3)}</span>
                              </div>
                            </div>

                            {/* Step 3: Floors */}
                            {(costFloorPct > 0 || minPrice > 0) && (
                              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-2">
                                <p className="text-xs font-bold text-gray-400 mb-1">STEP 3 — PRICE FLOORS</p>
                                {costFloorPct > 0 && myCost && myCost > 0 && (
                                  <div className="flex justify-between items-start">
                                    <div>
                                      <span className={`text-xs ${floorApplied === 'cost' ? 'text-yellow-400 font-bold' : 'text-gray-500'}`}>
                                        Cost Floor {floorApplied === 'cost' ? '← applied' : ''}
                                      </span>
                                      <p className="text-[10px] text-gray-500">My cost ${myCost.toFixed(3)} × {100 + costFloorPct}%</p>
                                    </div>
                                    <span className={`text-sm font-mono ${floorApplied === 'cost' ? 'text-yellow-400' : 'text-gray-600'}`}>
                                      ${(myCost * (1 + costFloorPct / 100)).toFixed(3)}
                                    </span>
                                  </div>
                                )}
                                {minPrice > 0 && (
                                  <div className="flex justify-between items-center">
                                    <span className={`text-xs ${floorApplied === 'min' ? 'text-yellow-400 font-bold' : 'text-gray-500'}`}>
                                      Min Price {floorApplied === 'min' ? '← applied' : ''}
                                    </span>
                                    <span className={`text-sm font-mono ${floorApplied === 'min' ? 'text-yellow-400' : 'text-gray-600'}`}>${minPrice.toFixed(3)}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Final */}
                            <div className="bg-purple-500/10 border border-purple-500/50 rounded-lg p-3">
                              <p className="text-xs text-gray-400 mb-1">SUGGESTED PRICE</p>
                              <p className="text-3xl font-mono font-black text-purple-400 mb-1">
                                ${liveSuggestedPrice.toFixed(3)}
                              </p>
                              {priceOMagic.stockMinPrice && priceOMagic.stockMaxPrice && (
                                <p className="text-[10px] text-gray-500 mb-2">
                                  Market range: ${parseFloat(priceOMagic.stockMinPrice).toFixed(2)} – ${parseFloat(priceOMagic.stockMaxPrice).toFixed(2)}
                                </p>
                              )}
                              <div className="pt-2 border-t border-purple-500/30 space-y-0.5">
                                <p className="text-[10px] text-purple-300 font-mono">
                                  {basePrice.toFixed(3)} × (1 + {totalPremium.toFixed(1)}%) = ${marketPrice.toFixed(3)}{floorApplied !== 'none' ? ` → floor applied → $${liveSuggestedPrice.toFixed(3)}` : ''}
                                </p>
                                <p className="text-[10px] text-gray-500">Computed live from current settings — updates instantly when formula changes.</p>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </DialogContent>
                </Dialog>

                {/* Market Data */}
                <div className="grid grid-cols-2 gap-2">
                  {/* Stock Data */}
                  {stockAvgPrice !== null && (
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-2">
                      <div className="flex items-center gap-1 mb-1">
                        <ShoppingCart className="h-3.5 w-3.5 text-blue-400" />
                        <p className="text-[10px] md:text-sm font-bold text-blue-400">FOR SALE</p>
                      </div>
                      <p className="text-xs font-mono text-white mb-0.5">Avg: ${stockAvgPrice.toFixed(3)}</p>
                      {priceOMagic.stockMinPrice && priceOMagic.stockMaxPrice && (
                        <p className="text-[9px] md:text-xs text-gray-400">
                          ${parseFloat(priceOMagic.stockMinPrice).toFixed(2)} - ${parseFloat(priceOMagic.stockMaxPrice).toFixed(2)}
                        </p>
                      )}
                      {priceOMagic.stockTotalLots && (
                        <p className="text-[9px] md:text-xs text-gray-400">{priceOMagic.stockTotalLots} lots</p>
                      )}
                    </div>
                  )}

                  {/* Sold Data */}
                  {soldAvgPrice !== null && (
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-2">
                      <div className="flex items-center gap-1 mb-1">
                        <BarChart3 className="h-3.5 w-3.5 text-green-400" />
                        <p className="text-[10px] md:text-sm font-bold text-green-400">SOLD (6mo)</p>
                      </div>
                      <p className="text-xs font-mono text-white mb-0.5">Avg: ${soldAvgPrice.toFixed(3)}</p>
                      {priceOMagic.soldMinPrice && priceOMagic.soldMaxPrice && (
                        <p className="text-[9px] md:text-xs text-gray-400">
                          ${parseFloat(priceOMagic.soldMinPrice).toFixed(2)} - ${parseFloat(priceOMagic.soldMaxPrice).toFixed(2)}
                        </p>
                      )}
                      {priceOMagic.soldTotalLots && (
                        <p className="text-[9px] md:text-xs text-gray-400">{priceOMagic.soldTotalLots} lots</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tier Pricing */}
            {hasTierPricing && (
              <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
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
              <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
                <p className="text-[10px] md:text-sm font-bold text-gray-400 mb-1">SALE DISCOUNT</p>
                <p className="text-xl font-black font-mono text-red-400">{data.saleRate}% OFF</p>
              </div>
            )}
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="mt-0 space-y-2.5">
            {/* Date Range Selector */}
            <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2">
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
              <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-4 text-center">
                <BarChart3 className="h-8 w-8 text-lego-orange mx-auto mb-2 animate-pulse" />
                <p className="text-xs text-gray-400">Loading analytics...</p>
              </div>
            ) : analytics ? (
              <>
                {/* Sales Performance */}
                <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
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
                <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
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
                <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
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
                  <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
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

                {/* Strategy Recommendations */}
                <div className="bg-gradient-to-r from-lego-orange/20 via-lego-orange/10 to-transparent border border-lego-orange/30 rounded-lg p-2.5">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Sparkles className="h-3.5 w-3.5 text-lego-orange" />
                    <p className="text-[10px] md:text-sm font-bold text-lego-orange">MOVEMENT STRATEGIES</p>
                  </div>
                  <div className="space-y-1.5 text-xs text-gray-300">
                    {analytics.daysSinceLastSold !== null && analytics.daysSinceLastSold > 90 && (
                      <p className="flex items-start gap-1.5">
                        <span className="text-yellow-400 mt-0.5">•</span>
                        <span>Consider price reduction - item hasn't sold in {analytics.daysSinceLastSold} days</span>
                      </p>
                    )}
                    {parseFloat(analytics.salesVelocity) > 5 && (
                      <p className="flex items-start gap-1.5">
                        <span className="text-green-400 mt-0.5">•</span>
                        <span>High velocity item ({analytics.salesVelocity}/mo) - consider restocking</span>
                      </p>
                    )}
                    {analytics.topCustomers.length > 0 && analytics.topCustomers[0].orders > 1 && (
                      <p className="flex items-start gap-1.5">
                        <span className="text-blue-400 mt-0.5">•</span>
                        <span>Repeat buyers detected - reach out to {analytics.topCustomers[0].name} for bulk offers</span>
                      </p>
                    )}
                    {analytics.bestSellingMonth !== 'N/A' && (
                      <p className="flex items-start gap-1.5">
                        <span className="text-purple-400 mt-0.5">•</span>
                        <span>Best sales in {analytics.bestSellingMonth} - plan promotions accordingly</span>
                      </p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-4 text-center">
                <BarChart3 className="h-8 w-8 text-gray-600 mx-auto mb-2" />
                <p className="text-xs text-gray-500">No sales data available</p>
                <p className="text-[10px] md:text-sm text-gray-600 mt-1">This item hasn't been sold yet</p>
              </div>
            )}
          </TabsContent>

          {/* Details Tab */}
          <TabsContent value="details" className="mt-0 space-y-2.5">
            {/* Identifiers */}
            <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
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
            <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
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
          {/* View Sets Button */}
          <Dialog open={setsDialogOpen} onOpenChange={setSetsDialogOpen}>
            <DialogTrigger asChild>
              <Button 
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px] md:text-sm font-bold text-lego-yellow hover:text-lego-yellow/80"
                data-testid="button-view-sets"
              >
                <Boxes className="h-3.5 w-3.5 mr-1" />
                SETS
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh]" aria-describedby="sets-dialog-description">
              <DialogHeader>
                <DialogTitle className="text-base font-bold text-white flex items-center gap-2">
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
                </DialogTitle>
              </DialogHeader>
              <div id="sets-dialog-description" className="mt-3 overflow-y-auto max-h-[calc(80vh-120px)]">
                {loadingSets && (
                  <div className="space-y-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="h-10 bg-gray-800/50 rounded animate-pulse" />
                    ))}
                  </div>
                )}
                {!loadingSets && setsData?.sets && setsData.sets.length > 0 && (
                  <div className="space-y-2">
                    {setsData.sets.map((set, index) => (
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
    </div>
  );
}

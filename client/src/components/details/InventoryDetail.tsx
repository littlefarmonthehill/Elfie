import { Package, DollarSign, Weight, Calendar, ExternalLink, TrendingUp, Sparkles, BarChart3, ShoppingCart, FileText, AlertCircle, Database, Tag, Box, Layers, Users, Clock, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect } from "react";

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
    itemNo: string;
    itemName: string | null;
    itemType: string;
    colorId: number | null;
    colorName: string | null;
    colorRgb: string | null;
    categoryId: number | null;
    categoryName: string | null;
    quantity: number;
    newOrUsed: string;
    completeness: string | null;
    unitPrice: string;
    myCost: string | null;
    bindId: number | null;
    description: string | null;
    remarks: string | null;
    bulk: number | null;
    isRetain: boolean | null;
    isStockRoom: boolean | null;
    stockRoomId: string | null;
    dateCreated: string | null;
    saleRate: number | null;
    tierPrice1: string | null;
    tierPrice2: string | null;
    tierPrice3: string | null;
    tierQuantity1: number | null;
    tierQuantity2: number | null;
    tierQuantity3: number | null;
    myWeight: string | null;
    updatedAt: string | null;
    priceOMagic?: PriceOMagicData | null;
  };
}

export default function InventoryDetail({ data }: InventoryDetailProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const priceOMagic = data.priceOMagic;

  // Fetch analytics data
  useEffect(() => {
    const fetchAnalytics = async () => {
      setLoadingAnalytics(true);
      try {
        const response = await fetch(`/api/inventory/${data.id}/analytics`);
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
  }, [data.id]);
  const currentPrice = data.unitPrice ? parseFloat(data.unitPrice) : 0;
  const myCost = data.myCost ? parseFloat(data.myCost) : null;
  const suggestedPrice = priceOMagic ? parseFloat(priceOMagic.suggestedPrice) : null;
  const stockAvgPrice = priceOMagic?.stockAvgPrice ? parseFloat(priceOMagic.stockAvgPrice) : null;
  const soldAvgPrice = priceOMagic?.soldAvgPrice ? parseFloat(priceOMagic.soldAvgPrice) : null;
  
  const totalValue = data.quantity * currentPrice;
  const profit = myCost !== null && myCost > 0 ? (currentPrice - myCost) * data.quantity : null;
  const profitMargin = myCost !== null && myCost > 0 && currentPrice > 0 ? ((currentPrice - myCost) / currentPrice * 100) : null;
  
  // BrickLink URL
  const itemTypeParam = data.itemType || 'P';
  const itemNoParam = data.itemNo || 'unknown';
  const bricklinkUrl = `https://www.bricklink.com/v2/catalog/catalogitem.page?${itemTypeParam}=${itemNoParam}${data.colorId ? `&idColor=${data.colorId}` : ''}`;
  
  // Item display name
  const itemName = data.itemName || priceOMagic?.itemName || 
    (data.itemType ? `${data.itemType.toUpperCase()} ${itemNoParam}` : itemNoParam || 'Unknown Item');
  
  // Image URL
  const imageUrl = priceOMagic?.imageUrl || priceOMagic?.thumbnailUrl || null;

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
          {imageUrl ? (
            <div className="flex-shrink-0 w-24 h-24 bg-gray-900 rounded-lg border border-gray-700 p-1.5">
              <img 
                src={imageUrl} 
                alt={itemName}
                className="w-full h-full object-contain"
              />
            </div>
          ) : (
            <div className="flex-shrink-0 w-24 h-24 bg-gray-900 rounded-lg border border-gray-700 p-1.5 flex items-center justify-center">
              <Package className="w-12 h-12 text-gray-600" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <h3 className="text-sm font-black text-lego-blue font-mono" data-testid="text-item-number">{data.itemNo}</h3>
              <Badge className={`text-[9px] h-4 px-2 font-bold ${
                data.newOrUsed === 'N' 
                  ? 'bg-lego-green/20 text-lego-green border-lego-green/40' 
                  : 'bg-lego-orange/20 text-lego-orange border-lego-orange/40'
              }`}>
                {conditionText}
              </Badge>
              {data.bindId && (
                <Badge className="bg-purple-500/20 text-purple-400 border-purple-400/40 text-[9px] h-4 px-2 font-bold">
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
                  <span className="text-[10px] text-gray-300 font-medium">{data.colorName}</span>
                </div>
              )}
              {data.categoryName && (
                <Badge className="bg-gray-800 text-gray-300 border-gray-700 text-[9px] h-4 px-2 font-medium">
                  {data.categoryName}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabbed Content - Scrollable with fixed height */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="flex-shrink-0 grid w-full grid-cols-4 bg-gray-800 p-0.5 h-8 mb-3">
          <TabsTrigger value="overview" className="text-[10px] py-0.5 data-[state=active]:bg-lego-blue" data-testid="tab-overview">OVERVIEW</TabsTrigger>
          <TabsTrigger value="pricing" className="text-[10px] py-0.5 data-[state=active]:bg-purple-600" data-testid="tab-pricing">PRICING</TabsTrigger>
          <TabsTrigger value="analytics" className="text-[10px] py-0.5 data-[state=active]:bg-lego-orange" data-testid="tab-analytics">ANALYTICS</TabsTrigger>
          <TabsTrigger value="details" className="text-[10px] py-0.5 data-[state=active]:bg-lego-green" data-testid="tab-details">DETAILS</TabsTrigger>
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
                      <p className="text-[10px] font-bold text-blue-400">DESCRIPTION</p>
                    </div>
                    <p className="text-xs text-gray-300 leading-relaxed">{data.description}</p>
                  </div>
                )}
                {data.remarks && (
                  <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <AlertCircle className="h-3.5 w-3.5 text-yellow-400" />
                      <p className="text-[10px] font-bold text-yellow-400">REMARKS</p>
                    </div>
                    <p className="text-xs text-gray-300 leading-relaxed">{data.remarks}</p>
                  </div>
                )}
              </div>
            )}

            {/* Current Inventory Info */}
            <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
              <p className="text-[10px] font-bold text-gray-400 mb-2">CURRENT INVENTORY</p>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <div className="text-center">
                  <Package className="h-4 w-4 text-lego-blue mx-auto mb-1" />
                  <p className="text-[9px] text-gray-400 mb-0.5">QUANTITY</p>
                  <p className="text-lg font-black font-mono text-lego-blue" data-testid="text-quantity">{data.quantity}</p>
                </div>

                <div className="text-center">
                  <DollarSign className="h-4 w-4 text-lego-green mx-auto mb-1" />
                  <p className="text-[9px] text-gray-400 mb-0.5">PRICE</p>
                  <p className="text-lg font-black font-mono text-lego-green" data-testid="text-unit-price">${currentPrice.toFixed(2)}</p>
                </div>

                <div className="text-center">
                  <DollarSign className="h-4 w-4 text-lego-red mx-auto mb-1" />
                  <p className="text-[9px] text-gray-400 mb-0.5">VALUE</p>
                  <p className="text-lg font-black font-mono text-lego-red" data-testid="text-total-value">${totalValue.toFixed(2)}</p>
                </div>
              </div>

              {/* Cost & Profit inline */}
              {myCost !== null && myCost > 0 && (
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-700">
                  <div>
                    <p className="text-[9px] text-gray-400 mb-0.5">MY COST</p>
                    <p className="text-sm font-bold font-mono text-yellow-400">${myCost.toFixed(4)}</p>
                  </div>
                  {profit !== null && (
                    <div>
                      <p className="text-[9px] text-gray-400 mb-0.5">PROFIT</p>
                      <p className={`text-sm font-bold font-mono ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${profit.toFixed(2)}
                        {profitMargin !== null && (
                          <span className="text-[9px] text-gray-400 ml-1">({profitMargin.toFixed(1)}%)</span>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* When First Available & Physical Details */}
            {priceOMagic && (priceOMagic.yearReleased || priceOMagic.weight || priceOMagic.dimensionX) && (
              <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
                <p className="text-[10px] font-bold text-gray-400 mb-2">ITEM SPECIFICATIONS</p>
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
                <p className="text-[10px] font-bold text-purple-400">APPEARS IN SETS</p>
              </div>
              <p className="text-[10px] text-gray-400 italic">
                Set information will be available soon. This requires additional BrickLink API calls.
              </p>
            </div>
          </TabsContent>

          {/* Pricing Tab */}
          <TabsContent value="pricing" className="mt-0 space-y-2.5">
            {/* Price-O-Magic Section */}
            {priceOMagic && suggestedPrice !== null && (
              <div className="bg-gradient-to-br from-purple-500/20 to-purple-500/5 border-2 border-purple-500/50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-purple-400" />
                  <h4 className="text-xs font-black text-purple-400">PRICE-O-MAGIC</h4>
                  <Badge className="bg-purple-500/30 text-purple-300 border-purple-400/40 text-[9px] h-4 px-2 font-bold ml-auto">
                    +{priceOMagic.premiumPercentage}% PREMIUM
                  </Badge>
                </div>
                
                {/* Suggested Price */}
                <div className="bg-gradient-to-br from-purple-600/20 to-transparent border border-purple-500/30 rounded-lg p-2.5 mb-2 text-center">
                  <p className="text-[10px] text-purple-300 font-bold mb-1">SUGGESTED PRICE</p>
                  <p className="text-3xl font-black font-mono text-purple-400">
                    ${suggestedPrice.toFixed(3)}
                  </p>
                  {currentPrice > 0 && suggestedPrice > currentPrice && (
                    <p className="text-[10px] text-purple-300/70 mt-1">
                      +${(suggestedPrice - currentPrice).toFixed(3)} vs current
                    </p>
                  )}
                </div>

                {/* Market Data */}
                <div className="grid grid-cols-2 gap-2">
                  {/* Stock Data */}
                  {stockAvgPrice !== null && (
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-2">
                      <div className="flex items-center gap-1 mb-1">
                        <ShoppingCart className="h-3.5 w-3.5 text-blue-400" />
                        <p className="text-[10px] font-bold text-blue-400">FOR SALE</p>
                      </div>
                      <p className="text-xs font-mono text-white mb-0.5">Avg: ${stockAvgPrice.toFixed(3)}</p>
                      {priceOMagic.stockMinPrice && priceOMagic.stockMaxPrice && (
                        <p className="text-[9px] text-gray-400">
                          ${parseFloat(priceOMagic.stockMinPrice).toFixed(2)} - ${parseFloat(priceOMagic.stockMaxPrice).toFixed(2)}
                        </p>
                      )}
                      {priceOMagic.stockTotalLots && (
                        <p className="text-[9px] text-gray-400">{priceOMagic.stockTotalLots} lots</p>
                      )}
                    </div>
                  )}

                  {/* Sold Data */}
                  {soldAvgPrice !== null && (
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-2">
                      <div className="flex items-center gap-1 mb-1">
                        <BarChart3 className="h-3.5 w-3.5 text-green-400" />
                        <p className="text-[10px] font-bold text-green-400">SOLD (6mo)</p>
                      </div>
                      <p className="text-xs font-mono text-white mb-0.5">Avg: ${soldAvgPrice.toFixed(3)}</p>
                      {priceOMagic.soldMinPrice && priceOMagic.soldMaxPrice && (
                        <p className="text-[9px] text-gray-400">
                          ${parseFloat(priceOMagic.soldMinPrice).toFixed(2)} - ${parseFloat(priceOMagic.soldMaxPrice).toFixed(2)}
                        </p>
                      )}
                      {priceOMagic.soldTotalLots && (
                        <p className="text-[9px] text-gray-400">{priceOMagic.soldTotalLots} lots</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tier Pricing */}
            {hasTierPricing && (
              <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
                <p className="text-[10px] font-bold text-gray-400 mb-2">BULK DISCOUNTS</p>
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
            {data.saleRate !== null && data.saleRate > 0 && (
              <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
                <p className="text-[10px] font-bold text-gray-400 mb-1">SALE DISCOUNT</p>
                <p className="text-xl font-black font-mono text-red-400">{data.saleRate}% OFF</p>
              </div>
            )}
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="mt-0 space-y-2.5">
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
                    <p className="text-[10px] font-bold text-green-400">SALES PERFORMANCE</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div className="text-center">
                      <ShoppingCart className="h-4 w-4 text-lego-blue mx-auto mb-1" />
                      <p className="text-[9px] text-gray-400 mb-0.5">TOTAL SOLD</p>
                      <p className="text-lg font-black font-mono text-lego-blue">{analytics.totalUnitsSold}</p>
                    </div>
                    <div className="text-center">
                      <DollarSign className="h-4 w-4 text-lego-green mx-auto mb-1" />
                      <p className="text-[9px] text-gray-400 mb-0.5">REVENUE</p>
                      <p className="text-lg font-black font-mono text-lego-green">${analytics.totalRevenue}</p>
                    </div>
                    <div className="text-center">
                      <Zap className="h-4 w-4 text-lego-orange mx-auto mb-1" />
                      <p className="text-[9px] text-gray-400 mb-0.5">VELOCITY</p>
                      <p className="text-lg font-black font-mono text-lego-orange">{analytics.salesVelocity}/mo</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-gray-900/50 rounded px-2.5 py-1.5">
                      <span className="text-gray-500 block text-[9px]">Avg Price</span>
                      <span className="text-white font-mono">${analytics.averageSellingPrice}</span>
                    </div>
                    <div className="bg-gray-900/50 rounded px-2.5 py-1.5">
                      <span className="text-gray-500 block text-[9px]">Orders</span>
                      <span className="text-white font-mono">{analytics.totalOrders}</span>
                    </div>
                  </div>
                </div>

                {/* Movement Insights */}
                <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Clock className="h-3.5 w-3.5 text-yellow-400" />
                    <p className="text-[10px] font-bold text-yellow-400">MOVEMENT INSIGHTS</p>
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
                  <p className="text-[10px] font-bold text-gray-400 mb-2">RECENT ACTIVITY (3 MONTHS)</p>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 text-center">
                      <p className="text-xl font-black font-mono text-purple-400">{analytics.recentSales.last3Months}</p>
                      <p className="text-[9px] text-gray-500">Units Sold</p>
                    </div>
                    <div className="flex-1 text-center">
                      <p className="text-xl font-black font-mono text-purple-400">{analytics.recentSales.percentOfTotal}%</p>
                      <p className="text-[9px] text-gray-500">of Total</p>
                    </div>
                  </div>
                </div>

                {/* Top Customers */}
                {analytics.topCustomers.length > 0 && (
                  <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Users className="h-3.5 w-3.5 text-blue-400" />
                      <p className="text-[10px] font-bold text-blue-400">TOP CUSTOMERS</p>
                    </div>
                    <div className="space-y-1.5">
                      {analytics.topCustomers.map((customer, idx) => (
                        <div key={idx} className="bg-gray-900/50 rounded px-2.5 py-1.5">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs text-white truncate pr-2">{customer.name}</span>
                            <span className="text-xs font-mono text-lego-green">{customer.units} units</span>
                          </div>
                          <div className="flex items-center justify-between text-[9px]">
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
                    <p className="text-[10px] font-bold text-lego-orange">MOVEMENT STRATEGIES</p>
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
                <p className="text-[10px] text-gray-600 mt-1">This item hasn't been sold yet</p>
              </div>
            )}
          </TabsContent>

          {/* Details Tab */}
          <TabsContent value="details" className="mt-0 space-y-2.5">
            {/* Identifiers */}
            <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Tag className="h-3.5 w-3.5 text-blue-400" />
                <p className="text-[10px] font-bold text-blue-400">IDENTIFIERS</p>
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
              <div className="mt-2.5 pt-2.5 border-t border-gray-700">
                <p className="text-[9px] text-yellow-400 italic">
                  💡 Part numbers may change over time. Use Inventory ID #{data.id} as the unique identifier.
                </p>
              </div>
            </div>

            {/* Inventory Settings */}
            <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Database className="h-3.5 w-3.5 text-purple-400" />
                <p className="text-[10px] font-bold text-purple-400">INVENTORY SETTINGS</p>
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
          <span className="text-[10px] text-gray-400">
            Updated <span className="font-bold text-white">{data.updatedAt ? new Date(data.updatedAt).toLocaleDateString() : 'N/A'}</span>
          </span>
        </div>
        <a 
          href={bricklinkUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[10px] font-bold text-lego-blue hover:text-lego-blue/80 transition-colors"
          data-testid="link-bricklink"
        >
          VIEW ON BRICKLINK
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

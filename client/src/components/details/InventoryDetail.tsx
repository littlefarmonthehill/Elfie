import { Package, DollarSign, Weight, Calendar, ExternalLink, TrendingUp, Sparkles, BarChart3, ShoppingCart, FileText, AlertCircle, Database, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";

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
  const priceOMagic = data.priceOMagic;
  const currentPrice = data.unitPrice ? parseFloat(data.unitPrice) : 0;
  const myCost = data.myCost ? parseFloat(data.myCost) : null;
  const suggestedPrice = priceOMagic ? parseFloat(priceOMagic.suggestedPrice) : null;
  const stockAvgPrice = priceOMagic?.stockAvgPrice ? parseFloat(priceOMagic.stockAvgPrice) : null;
  const soldAvgPrice = priceOMagic?.soldAvgPrice ? parseFloat(priceOMagic.soldAvgPrice) : null;
  
  const totalValue = data.quantity * currentPrice;
  const profit = myCost ? (currentPrice - myCost) * data.quantity : null;
  const profitMargin = myCost && currentPrice > 0 ? ((currentPrice - myCost) / currentPrice * 100) : null;
  
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

  return (
    <div className="space-y-3">
      {/* Header with Image and Full Item Info */}
      <div className="bg-gradient-to-r from-lego-blue/15 via-lego-blue/5 to-transparent border border-lego-blue/30 rounded-lg p-2.5">
        <div className="flex items-start gap-3">
          {imageUrl && (
            <div className="flex-shrink-0 w-20 h-20 bg-gray-900 rounded-lg border border-gray-700 p-1">
              <img 
                src={imageUrl} 
                alt={itemName}
                className="w-full h-full object-contain"
              />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <h3 className="text-[10px] font-black text-lego-blue font-mono">{data.itemNo}</h3>
              <Badge className={`text-[8px] h-3.5 px-1.5 font-bold ${
                data.newOrUsed === 'N' 
                  ? 'bg-lego-green/20 text-lego-green border-lego-green/40' 
                  : 'bg-lego-orange/20 text-lego-orange border-lego-orange/40'
              }`}>
                {data.newOrUsed === 'N' ? 'NEW' : 'USED'}
              </Badge>
              {data.bindId && (
                <Badge className="bg-purple-500/20 text-purple-400 border-purple-400/40 text-[8px] h-3.5 px-1.5 font-bold">
                  BIND #{data.bindId}
                </Badge>
              )}
            </div>
            <p className="text-[10px] text-white font-medium mb-1.5 leading-tight" title={itemName}>
              {itemName}
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {data.categoryName && (
                <Badge className="bg-gray-800 text-gray-300 border-gray-700 text-[8px] h-3.5 px-1.5 font-medium">
                  {data.categoryName}
                </Badge>
              )}
              {data.colorName && (
                <Badge className="bg-gray-800 text-gray-300 border-gray-700 text-[8px] h-3.5 px-1.5 font-medium">
                  {data.colorName}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabbed Interface */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-gray-800 p-0.5 h-7">
          <TabsTrigger value="overview" className="text-[9px] py-0.5 data-[state=active]:bg-lego-blue">OVERVIEW</TabsTrigger>
          <TabsTrigger value="pricing" className="text-[9px] py-0.5 data-[state=active]:bg-purple-600">PRICING</TabsTrigger>
          <TabsTrigger value="details" className="text-[9px] py-0.5 data-[state=active]:bg-lego-green">DETAILS</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-2 space-y-2">
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gradient-to-br from-lego-blue/20 to-lego-blue/5 border border-lego-blue/40 rounded-lg p-2 text-center">
              <Package className="h-3.5 w-3.5 text-lego-blue mx-auto mb-0.5" />
              <p className="text-[9px] text-gray-400 font-bold mb-0.5">QUANTITY</p>
              <p className="text-xl font-black font-mono text-lego-blue leading-none" data-testid="text-quantity">{data.quantity}</p>
            </div>

            <div className="bg-gradient-to-br from-lego-green/20 to-lego-green/5 border border-lego-green/40 rounded-lg p-2 text-center">
              <DollarSign className="h-3.5 w-3.5 text-lego-green mx-auto mb-0.5" />
              <p className="text-[9px] text-gray-400 font-bold mb-0.5">UNIT PRICE</p>
              <p className="text-xl font-black font-mono text-lego-green leading-none" data-testid="text-unit-price">${currentPrice.toFixed(2)}</p>
            </div>

            <div className="bg-gradient-to-br from-lego-red/20 to-lego-red/5 border border-lego-red/40 rounded-lg p-2 text-center">
              <DollarSign className="h-3.5 w-3.5 text-lego-red mx-auto mb-0.5" />
              <p className="text-[9px] text-gray-400 font-bold mb-0.5">TOTAL VALUE</p>
              <p className="text-xl font-black font-mono text-lego-red leading-none" data-testid="text-total-value">${totalValue.toFixed(2)}</p>
            </div>
          </div>

          {/* Cost & Profit */}
          {myCost !== null && (
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-2">
                <p className="text-[9px] text-gray-400 font-bold mb-1">MY COST</p>
                <p className="text-base font-black font-mono text-yellow-400">${myCost.toFixed(4)}</p>
              </div>
              {profit !== null && (
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-2">
                  <p className="text-[9px] text-gray-400 font-bold mb-1">PROFIT</p>
                  <p className={`text-base font-black font-mono ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${profit.toFixed(2)}
                    {profitMargin !== null && (
                      <span className="text-[9px] text-gray-400 ml-1">({profitMargin.toFixed(1)}%)</span>
                    )}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Description & Remarks */}
          {(data.description || data.remarks) && (
            <div className="space-y-1.5">
              {data.description && (
                <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2">
                  <div className="flex items-center gap-1 mb-1">
                    <FileText className="h-3 w-3 text-blue-400" />
                    <p className="text-[9px] font-bold text-blue-400">DESCRIPTION</p>
                  </div>
                  <p className="text-[10px] text-gray-300 leading-relaxed">{data.description}</p>
                </div>
              )}
              {data.remarks && (
                <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2">
                  <div className="flex items-center gap-1 mb-1">
                    <AlertCircle className="h-3 w-3 text-yellow-400" />
                    <p className="text-[9px] font-bold text-yellow-400">REMARKS</p>
                  </div>
                  <p className="text-[10px] text-gray-300 leading-relaxed">{data.remarks}</p>
                </div>
              )}
            </div>
          )}

          {/* Physical Details */}
          {(priceOMagic?.weight || priceOMagic?.dimensionX) && (
            <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2">
              <p className="text-[9px] font-bold text-gray-400 mb-1.5">PHYSICAL</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                {priceOMagic.weight && (
                  <div>
                    <span className="text-gray-500">Weight:</span>
                    <span className="text-white font-mono ml-1">{parseFloat(priceOMagic.weight).toFixed(1)}g</span>
                  </div>
                )}
                {priceOMagic.dimensionX && priceOMagic.dimensionY && (
                  <div>
                    <span className="text-gray-500">Dimensions:</span>
                    <span className="text-white font-mono ml-1">
                      {priceOMagic.dimensionX}×{priceOMagic.dimensionY}{priceOMagic.dimensionZ ? `×${priceOMagic.dimensionZ}` : ''}
                    </span>
                  </div>
                )}
                {priceOMagic.yearReleased && (
                  <div>
                    <span className="text-gray-500">Released:</span>
                    <span className="text-white font-mono ml-1">{priceOMagic.yearReleased}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Pricing Tab */}
        <TabsContent value="pricing" className="mt-2 space-y-2">
          {/* Price-O-Magic Section */}
          {priceOMagic && suggestedPrice !== null && (
            <div className="bg-gradient-to-br from-purple-500/20 to-purple-500/5 border-2 border-purple-500/50 rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles className="h-4 w-4 text-purple-400" />
                <h4 className="text-[10px] font-black text-purple-400">PRICE-O-MAGIC</h4>
                <Badge className="bg-purple-500/30 text-purple-300 border-purple-400/40 text-[8px] h-3.5 px-1.5 font-bold ml-auto">
                  +{priceOMagic.premiumPercentage}% PREMIUM
                </Badge>
              </div>
              
              {/* Suggested Price */}
              <div className="bg-gradient-to-br from-purple-600/20 to-transparent border border-purple-500/30 rounded-lg p-2 mb-2 text-center">
                <p className="text-[9px] text-purple-300 font-bold mb-1">SUGGESTED PRICE</p>
                <p className="text-3xl font-black font-mono text-purple-400 leading-none">
                  ${suggestedPrice.toFixed(3)}
                </p>
                {currentPrice > 0 && suggestedPrice > currentPrice && (
                  <p className="text-[9px] text-purple-300/70 mt-1">
                    +${(suggestedPrice - currentPrice).toFixed(3)} vs current
                  </p>
                )}
              </div>

              {/* Market Data */}
              <div className="grid grid-cols-2 gap-2">
                {/* Stock Data */}
                {stockAvgPrice !== null && (
                  <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-1.5">
                    <div className="flex items-center gap-1 mb-1">
                      <ShoppingCart className="h-3 w-3 text-blue-400" />
                      <p className="text-[9px] font-bold text-blue-400">FOR SALE</p>
                    </div>
                    <p className="text-[10px] font-mono text-white mb-0.5">Avg: ${stockAvgPrice.toFixed(3)}</p>
                    {priceOMagic.stockMinPrice && priceOMagic.stockMaxPrice && (
                      <p className="text-[8px] text-gray-400">
                        ${parseFloat(priceOMagic.stockMinPrice).toFixed(2)} - ${parseFloat(priceOMagic.stockMaxPrice).toFixed(2)}
                      </p>
                    )}
                    {priceOMagic.stockTotalLots && (
                      <p className="text-[8px] text-gray-400">{priceOMagic.stockTotalLots} lots</p>
                    )}
                  </div>
                )}

                {/* Sold Data */}
                {soldAvgPrice !== null && (
                  <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-1.5">
                    <div className="flex items-center gap-1 mb-1">
                      <BarChart3 className="h-3 w-3 text-green-400" />
                      <p className="text-[9px] font-bold text-green-400">SOLD (6mo)</p>
                    </div>
                    <p className="text-[10px] font-mono text-white mb-0.5">Avg: ${soldAvgPrice.toFixed(3)}</p>
                    {priceOMagic.soldMinPrice && priceOMagic.soldMaxPrice && (
                      <p className="text-[8px] text-gray-400">
                        ${parseFloat(priceOMagic.soldMinPrice).toFixed(2)} - ${parseFloat(priceOMagic.soldMaxPrice).toFixed(2)}
                      </p>
                    )}
                    {priceOMagic.soldTotalLots && (
                      <p className="text-[8px] text-gray-400">{priceOMagic.soldTotalLots} lots</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tier Pricing */}
          {hasTierPricing && (
            <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2">
              <p className="text-[9px] font-bold text-gray-400 mb-2">BULK DISCOUNTS</p>
              <div className="space-y-1.5">
                {data.tierQuantity1 && data.tierPrice1 && (
                  <div className="flex items-center justify-between bg-gray-900/50 rounded px-2 py-1">
                    <span className="text-[10px] text-gray-400">{data.tierQuantity1}+ units</span>
                    <span className="text-[10px] font-mono text-green-400">${parseFloat(data.tierPrice1).toFixed(2)}</span>
                  </div>
                )}
                {data.tierQuantity2 && data.tierPrice2 && (
                  <div className="flex items-center justify-between bg-gray-900/50 rounded px-2 py-1">
                    <span className="text-[10px] text-gray-400">{data.tierQuantity2}+ units</span>
                    <span className="text-[10px] font-mono text-green-400">${parseFloat(data.tierPrice2).toFixed(2)}</span>
                  </div>
                )}
                {data.tierQuantity3 && data.tierPrice3 && (
                  <div className="flex items-center justify-between bg-gray-900/50 rounded px-2 py-1">
                    <span className="text-[10px] text-gray-400">{data.tierQuantity3}+ units</span>
                    <span className="text-[10px] font-mono text-green-400">${parseFloat(data.tierPrice3).toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Sale Rate */}
          {data.saleRate !== null && data.saleRate > 0 && (
            <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2">
              <p className="text-[9px] font-bold text-gray-400 mb-1">SALE DISCOUNT</p>
              <p className="text-lg font-black font-mono text-red-400">{data.saleRate}% OFF</p>
            </div>
          )}
        </TabsContent>

        {/* Details Tab */}
        <TabsContent value="details" className="mt-2 space-y-2">
          {/* Identifiers */}
          <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2">
            <div className="flex items-center gap-1 mb-2">
              <Tag className="h-3 w-3 text-blue-400" />
              <p className="text-[9px] font-bold text-blue-400">IDENTIFIERS</p>
            </div>
            <div className="space-y-1.5 text-[10px]">
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
            <div className="mt-2 pt-2 border-t border-gray-700">
              <p className="text-[8px] text-yellow-400 italic">
                💡 Part numbers may change. Use Inventory ID #{data.id} as unique identifier.
              </p>
            </div>
          </div>

          {/* Inventory Settings */}
          <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-2">
            <div className="flex items-center gap-1 mb-2">
              <Database className="h-3 w-3 text-purple-400" />
              <p className="text-[9px] font-bold text-purple-400">INVENTORY SETTINGS</p>
            </div>
            <div className="space-y-1.5 text-[10px]">
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
      </Tabs>

      {/* Footer - Compact Info */}
      <div className="flex items-center justify-between bg-gray-800 border border-gray-700 rounded-lg p-2">
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3 w-3 text-gray-400" />
          <span className="text-[9px] text-gray-400">
            Updated <span className="font-bold text-white">{data.updatedAt ? new Date(data.updatedAt).toLocaleDateString() : 'N/A'}</span>
          </span>
        </div>
        <a 
          href={bricklinkUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[9px] font-bold text-lego-blue hover:text-lego-blue/80 transition-colors"
          data-testid="link-bricklink"
        >
          VIEW ON BRICKLINK
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

import { Package, DollarSign, Weight, Calendar, ExternalLink, TrendingUp, Sparkles, BarChart3, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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
    itemType: string;
    colorId: number | null;
    colorName: string | null;
    colorRgb: string | null;
    categoryId: number | null;
    categoryName: string | null;
    quantity: number;
    newOrUsed: string;
    unitPrice: string;
    updatedAt: string | null;
    priceOMagic?: PriceOMagicData | null;
  };
}

export default function InventoryDetail({ data }: InventoryDetailProps) {
  const priceOMagic = data.priceOMagic;
  const currentPrice = data.unitPrice ? parseFloat(data.unitPrice) : 0;
  const suggestedPrice = priceOMagic ? parseFloat(priceOMagic.suggestedPrice) : null;
  const stockAvgPrice = priceOMagic?.stockAvgPrice ? parseFloat(priceOMagic.stockAvgPrice) : null;
  const soldAvgPrice = priceOMagic?.soldAvgPrice ? parseFloat(priceOMagic.soldAvgPrice) : null;
  
  const totalValue = data.quantity * currentPrice;
  
  // BrickLink URL
  const itemTypeParam = data.itemType || 'P'; // Default to 'P' for Part if not provided
  const itemNoParam = data.itemNo || 'unknown';
  const bricklinkUrl = `https://www.bricklink.com/v2/catalog/catalogitem.page?${itemTypeParam}=${itemNoParam}${data.colorId ? `&idColor=${data.colorId}` : ''}`;
  
  // Item display name
  const itemName = priceOMagic?.itemName || 
    (data.itemType ? `${data.itemType.toUpperCase()} ${itemNoParam}` : itemNoParam || 'Unknown Item');
  
  // Image URL
  const imageUrl = priceOMagic?.imageUrl || priceOMagic?.thumbnailUrl || null;

  return (
    <div className="space-y-2.5">
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
            <div className="flex items-center gap-1.5 mb-1">
              <h3 className="text-[10px] font-black text-lego-blue font-mono">{data.itemNo}</h3>
              <Badge className={`text-[8px] h-3.5 px-1.5 font-bold ${
                data.newOrUsed === 'N' 
                  ? 'bg-lego-green/20 text-lego-green border-lego-green/40' 
                  : 'bg-lego-orange/20 text-lego-orange border-lego-orange/40'
              }`}>
                {data.newOrUsed === 'N' ? 'NEW' : 'USED'}
              </Badge>
            </div>
            <p className="text-[10px] text-white font-medium mb-1.5 leading-tight" title={itemName}>
              {itemName}
            </p>
            <div className="flex items-center gap-1.5">
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

      {/* Key Metrics Grid - Colorful */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gradient-to-br from-lego-blue/20 to-lego-blue/5 border border-lego-blue/40 rounded-lg p-2 text-center">
          <Package className="h-3.5 w-3.5 text-lego-blue mx-auto mb-0.5" />
          <p className="text-[9px] text-gray-400 font-bold mb-0.5">QUANTITY</p>
          <p className="text-xl font-black font-mono text-lego-blue leading-none">{data.quantity}</p>
        </div>

        <div className="bg-gradient-to-br from-lego-green/20 to-lego-green/5 border border-lego-green/40 rounded-lg p-2 text-center">
          <DollarSign className="h-3.5 w-3.5 text-lego-green mx-auto mb-0.5" />
          <p className="text-[9px] text-gray-400 font-bold mb-0.5">UNIT PRICE</p>
          <p className="text-xl font-black font-mono text-lego-green leading-none">${currentPrice.toFixed(2)}</p>
        </div>

        {priceOMagic?.weight ? (
          <div className="bg-gradient-to-br from-lego-yellow/20 to-lego-yellow/5 border border-lego-yellow/40 rounded-lg p-2 text-center">
            <Weight className="h-3.5 w-3.5 text-lego-yellow mx-auto mb-0.5" />
            <p className="text-[9px] text-gray-400 font-bold mb-0.5">WEIGHT</p>
            <p className="text-xl font-black font-mono text-lego-yellow leading-none">{parseFloat(priceOMagic.weight).toFixed(1)}<span className="text-xs">g</span></p>
          </div>
        ) : (
          <div className="bg-gradient-to-br from-lego-red/20 to-lego-red/5 border border-lego-red/40 rounded-lg p-2 text-center">
            <DollarSign className="h-3.5 w-3.5 text-lego-red mx-auto mb-0.5" />
            <p className="text-[9px] text-gray-400 font-bold mb-0.5">TOTAL VALUE</p>
            <p className="text-xl font-black font-mono text-lego-red leading-none">${totalValue.toFixed(2)}</p>
          </div>
        )}
      </div>

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

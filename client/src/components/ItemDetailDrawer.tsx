import { useState, useEffect } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { X, Package, ExternalLink, MapPin, TrendingUp, DollarSign } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ItemDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  itemNo: string;
}

interface ItemDetail {
  itemNo: string;
  itemName: string | null;
  categoryName: string | null;
  totalQuantity: number;
  newQuantity: number;
  usedQuantity: number;
  colorCount: number;
  avgPrice: string | null;
  minPrice: string | null;
  maxPrice: string | null;
  totalValue: string;
  quantitySold: number;
  revenue: string;
  colors: Array<{
    colorId: number;
    colorName: string;
    colorRgb: string | null;
    quantity: number;
    condition: string;
    price: string | null;
    warehouseLocation: string | null;
  }>;
}

export default function ItemDetailDrawer({ 
  open, 
  onClose, 
  itemNo
}: ItemDetailDrawerProps) {
  const { data: item, isLoading } = useQuery<ItemDetail>({
    queryKey: ['/api/items/detail', itemNo],
    queryFn: async () => {
      const response = await fetch(`/api/items/detail/${encodeURIComponent(itemNo)}`);
      if (!response.ok) throw new Error('Failed to fetch item details');
      return response.json();
    },
    enabled: open && !!itemNo,
  });

  const formatPrice = (price: string | null) => {
    if (!price) return 'N/A';
    return `$${Number(price).toFixed(2)}`;
  };

  const formatColorRgb = (rgb: string | null) => {
    if (!rgb) return '#999999';
    return rgb.startsWith('#') ? rgb : `#${rgb}`;
  };

  return (
    <Drawer open={open} onOpenChange={onClose}>
      <DrawerContent className="bg-gray-950 border-gray-800 h-[92vh] flex flex-col rounded-t-2xl">
        <DrawerHeader className="p-0 flex-shrink-0">
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-gray-600" />
          </div>
          <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-gray-800">
            <Package className="w-4 h-4 text-cyan-400 flex-shrink-0" />
            <DrawerTitle className="text-sm font-semibold text-gray-100 flex-1">
              Item Details
            </DrawerTitle>
            <button
              onClick={onClose}
              className="ml-2 text-gray-500 hover:text-gray-200 transition-colors"
              data-testid="button-close-item-detail"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <DrawerDescription className="sr-only">
            View detailed information about {itemNo}
          </DrawerDescription>
        </DrawerHeader>
        
        <div className="flex-1 overflow-y-auto px-4 pt-3 min-h-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mb-3"></div>
              <p className="text-sm text-gray-400">Loading item details...</p>
            </div>
          ) : !item ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <Package className="h-12 w-12 mb-3 opacity-50" />
              <p className="text-base">Item not found</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Header Section */}
              <div className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xl md:text-2xl font-mono font-bold text-cyan-400 mb-1">
                      {item.itemNo}
                    </div>
                    <div className="text-sm md:text-base text-gray-200 mb-2">
                      {item.itemName || 'Unnamed Item'}
                    </div>
                    {item.categoryName && (
                      <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
                        {item.categoryName}
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-shrink-0"
                    onClick={() => window.open(`https://www.bricklink.com/v2/catalog/catalogitem.page?P=${item.itemNo}`, '_blank')}
                    data-testid="button-view-bricklink"
                  >
                    <ExternalLink className="h-4 w-4 mr-1" />
                    BrickLink
                  </Button>
                </div>
              </div>

              {/* Key Metrics Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="app-card p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Package className="h-4 w-4 text-emerald-400" />
                    <span className="text-xs text-gray-400">Total Inventory</span>
                  </div>
                  <div className="text-xl md:text-2xl font-mono font-bold text-white">
                    {item.totalQuantity.toLocaleString()}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {item.newQuantity > 0 && (
                      <span className="text-[9px] md:text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                        {item.newQuantity.toLocaleString()} New
                      </span>
                    )}
                    {item.usedQuantity > 0 && (
                      <span className="text-[9px] md:text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">
                        {item.usedQuantity.toLocaleString()} Used
                      </span>
                    )}
                  </div>
                </div>

                <div className="app-card p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="h-4 w-4 text-blue-400" />
                    <span className="text-xs text-gray-400">Total Value</span>
                  </div>
                  <div className="text-xl md:text-2xl font-mono font-bold text-blue-400">
                    ${Number(item.totalValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[9px] md:text-xs text-gray-500 mt-1">
                    {item.colorCount} {item.colorCount === 1 ? 'color' : 'colors'}
                  </div>
                </div>

                <div className="app-card p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="h-4 w-4 text-purple-400" />
                    <span className="text-xs text-gray-400">Quantity Sold</span>
                  </div>
                  <div className="text-xl md:text-2xl font-mono font-bold text-purple-400">
                    {item.quantitySold.toLocaleString()}
                  </div>
                  <div className="text-[9px] md:text-xs text-gray-500 mt-1">
                    all time
                  </div>
                </div>

                <div className="app-card p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="h-4 w-4 text-green-400" />
                    <span className="text-xs text-gray-400">Total Revenue</span>
                  </div>
                  <div className="text-xl md:text-2xl font-mono font-bold text-green-400">
                    ${Number(item.revenue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[9px] md:text-xs text-gray-500 mt-1">
                    all time
                  </div>
                </div>
              </div>

              {/* Price Range */}
              {item.avgPrice && (
                <div className="app-card p-3">
                  <div className="text-xs text-gray-400 mb-2">Price Range</div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-gray-500">Min</div>
                      <div className="text-sm md:text-base font-mono font-bold text-gray-200">
                        {formatPrice(item.minPrice)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-500">Avg</div>
                      <div className="text-base md:text-lg font-mono font-bold text-cyan-400">
                        {formatPrice(item.avgPrice)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-500">Max</div>
                      <div className="text-sm md:text-base font-mono font-bold text-gray-200">
                        {formatPrice(item.maxPrice)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Color Variations */}
              <div>
                <h3 className="text-sm font-bold text-gray-300 mb-2 uppercase tracking-wide">
                  Color Variations ({item.colors.length})
                </h3>
                <div className="space-y-2">
                  {item.colors.map((color, index) => (
                    <div
                      key={`${color.colorId}-${color.condition}-${index}`}
                      className="app-card p-3"
                      data-testid={`color-variation-${index}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div
                            className="w-8 h-8 rounded border-2 border-gray-600 flex-shrink-0"
                            style={{ backgroundColor: formatColorRgb(color.colorRgb) }}
                            title={color.colorName}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-200 mb-1">
                              {color.colorName}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge 
                                className={color.condition === 'N' 
                                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[9px] md:text-xs'
                                  : 'bg-amber-500/20 text-amber-400 border-amber-500/30 text-[9px] md:text-xs'
                                }
                              >
                                {color.condition === 'N' ? 'New' : 'Used'}
                              </Badge>
                              <span className="text-[9px] md:text-xs text-gray-400">
                                {color.quantity.toLocaleString()} in stock
                              </span>
                              {color.warehouseLocation && (
                                <span className="text-[9px] md:text-xs text-blue-400 flex items-center gap-1">
                                  <MapPin className="h-3 w-3" />
                                  {color.warehouseLocation}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <div className="text-sm md:text-base font-mono font-bold text-cyan-400">
                            {formatPrice(color.price)}
                          </div>
                          <div className="text-[9px] md:text-xs text-gray-500">
                            each
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

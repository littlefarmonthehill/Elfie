import { useState } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { X, Package } from "lucide-react";
import InventoryDetail from "./details/InventoryDetail";
import { useQuery } from "@tanstack/react-query";

interface CategoryItem {
  item_no: string;
  name: string;
  color_count: number;
  new_qty: number;
  used_qty: number;
  quantity_sold: number;
}

interface CategoryItemsDrawerProps {
  open: boolean;
  onClose: () => void;
  categoryName: string;
  items: CategoryItem[];
  onItemClick?: (type: 'inventory', id: number) => void;
}

export default function CategoryItemsDrawer({ 
  open, 
  onClose, 
  categoryName,
  items,
  onItemClick
}: CategoryItemsDrawerProps) {
  const handleItemClickInternal = (itemNo: string) => {
    console.log('[CategoryItemsDrawer] Item clicked:', itemNo, 'onItemClick available:', !!onItemClick);
    
    // Use the parent's onItemClick if provided
    // For now, we'll need to fetch the inventory lot ID
    // This will open the detail in the parent component's drawer
    if (onItemClick) {
      console.log('[CategoryItemsDrawer] Fetching inventory for:', itemNo);
      // We need to get the first inventory lot for this item
      // The parent will handle showing the detail drawer
      fetch(`/api/inventory/search?itemNo=${encodeURIComponent(itemNo)}&limit=1`)
        .then(res => {
          console.log('[CategoryItemsDrawer] Fetch response status:', res.status);
          return res.json();
        })
        .then(data => {
          console.log('[CategoryItemsDrawer] Inventory data:', data);
          if (data.length > 0) {
            console.log('[CategoryItemsDrawer] Calling onItemClick with id:', data[0].id);
            onItemClick('inventory', data[0].id);
          } else {
            console.warn('[CategoryItemsDrawer] No inventory found for:', itemNo);
          }
        })
        .catch(err => console.error('[CategoryItemsDrawer] Error finding inventory:', err));
    } else {
      console.warn('[CategoryItemsDrawer] onItemClick not provided');
    }
  };

  return (
    <>
      <Drawer open={open} onOpenChange={onClose}>
        <DrawerContent className="bg-gray-950 border-gray-800 h-[92vh] flex flex-col rounded-t-2xl">
          <DrawerHeader className="p-0 flex-shrink-0">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-600" />
            </div>
            <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-gray-800">
              <Package className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <DrawerTitle className="text-sm font-semibold text-gray-100 flex-1">
                {categoryName} — Items Sold
              </DrawerTitle>
              <button
                onClick={onClose}
                className="ml-2 text-gray-500 hover:text-gray-200 transition-colors"
                data-testid="button-close-category-items"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <DrawerDescription className="sr-only">
              View all items sold in {categoryName} category
            </DrawerDescription>
          </DrawerHeader>
          
          <div className="flex-1 overflow-y-auto px-4 pt-3 min-h-0">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <Package className="h-12 w-12 mb-3 opacity-50" />
                <p className="text-base">No items sold in this category</p>
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((item, index) => (
                  <div
                    key={`${item.item_no}-${index}`}
                    onClick={() => handleItemClickInternal(item.item_no)}
                    className="flex justify-between items-start p-3 rounded-lg bg-gray-800/50 border border-gray-700 hover-elevate active-elevate-2 cursor-pointer"
                    data-testid={`category-item-${index}`}
                  >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm md:text-base font-mono font-bold text-cyan-400">
                        {item.item_no}
                      </span>
                    </div>
                    <div className="text-xs md:text-sm text-gray-200 mb-2">{item.name}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {item.color_count > 0 && (
                        <span className="text-[9px] md:text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">
                          {item.color_count} {item.color_count === 1 ? 'color' : 'colors'}
                        </span>
                      )}
                      {item.new_qty > 0 && (
                        <span className="text-[9px] md:text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                          {item.new_qty.toLocaleString()} New
                        </span>
                      )}
                      {item.used_qty > 0 && (
                        <span className="text-[9px] md:text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">
                          {item.used_qty.toLocaleString()} Used
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <div className="text-lg md:text-2xl font-mono font-bold text-purple-400">
                      {item.quantity_sold.toLocaleString()}
                    </div>
                    <div className="text-[9px] md:text-xs text-gray-500">
                      total
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

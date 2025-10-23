import { useState } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { ChevronDown, Package } from "lucide-react";
import ItemDetailDrawer from "./ItemDetailDrawer";

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
}

export default function CategoryItemsDrawer({ 
  open, 
  onClose, 
  categoryName,
  items
}: CategoryItemsDrawerProps) {
  const [selectedItemNo, setSelectedItemNo] = useState<string | null>(null);

  const handleItemClick = (itemNo: string) => {
    setSelectedItemNo(itemNo);
  };

  const handleCloseItemDetail = () => {
    setSelectedItemNo(null);
  };

  return (
    <>
      <Drawer open={open} onOpenChange={onClose}>
        <DrawerContent className="bg-gray-900 border-gray-700 h-[92vh] flex flex-col">
          <DrawerHeader className="border-b border-gray-700 py-3 flex-shrink-0">
            <div className="flex items-center justify-between">
              <DrawerTitle className="text-sm font-black text-white uppercase tracking-wide">
                📦 {categoryName} - Items Sold
              </DrawerTitle>
              <button
                onClick={onClose}
                className="p-1 rounded-md hover:bg-gray-800 transition-colors"
                data-testid="button-close-category-items"
              >
                <ChevronDown className="h-6 w-6 text-gray-400" />
              </button>
            </div>
            <DrawerDescription className="sr-only">
              View all items sold in {categoryName} category
            </DrawerDescription>
          </DrawerHeader>
          
          <div className="flex-1 overflow-y-auto p-4 min-h-0">
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
                    onClick={() => handleItemClick(item.item_no)}
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

      {/* Item Detail Drawer */}
      {selectedItemNo && (
        <ItemDetailDrawer
          open={!!selectedItemNo}
          onClose={handleCloseItemDetail}
          itemNo={selectedItemNo}
        />
      )}
    </>
  );
}

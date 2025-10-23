import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { ChevronDown, Package } from "lucide-react";

interface CategoryItem {
  item_no: string;
  name: string;
  color_name: string | null;
  condition: string;
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
  return (
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
                  key={`${item.item_no}-${item.color_name}-${item.condition}-${index}`}
                  className="flex justify-between items-start p-3 rounded-lg bg-gray-800/50 border border-gray-700"
                  data-testid={`category-item-${index}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm md:text-base font-mono font-bold text-cyan-400">
                        {item.item_no}
                      </span>
                      {item.condition && (
                        <span className={`text-[9px] md:text-xs px-2 py-0.5 rounded ${
                          item.condition === 'N' || item.condition === 'New' 
                            ? 'bg-emerald-500/20 text-emerald-400' 
                            : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          {item.condition === 'N' || item.condition === 'New' ? 'New' : 'Used'}
                        </span>
                      )}
                    </div>
                    <div className="text-xs md:text-sm text-gray-200 mb-1">{item.name}</div>
                    {item.color_name && (
                      <div className="text-[10px] md:text-xs text-gray-400">{item.color_name}</div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <div className="text-lg md:text-2xl font-mono font-bold text-purple-400">
                      {item.quantity_sold.toLocaleString()}
                    </div>
                    <div className="text-[9px] md:text-xs text-gray-500">
                      qty sold
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

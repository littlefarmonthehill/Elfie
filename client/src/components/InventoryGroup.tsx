import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InventoryItem {
  id: number;
  itemNo: string;
  itemName: string | null;
  colorId: number | null;
  colorName: string | null;
  colorRgb: string | null;
  quantity: number;
  unitPrice: string | null;
  newOrUsed: string;
}

interface InventoryGroupProps {
  itemNo: string;
  items: InventoryItem[];
  onItemClick?: (id: number) => void;
}

export function InventoryGroup({ itemNo, items, onItemClick }: InventoryGroupProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Group items by color
  const groupedByColor = items.reduce((acc, item) => {
    const colorKey = `${item.colorId}-${item.colorName}`;
    if (!acc[colorKey]) {
      acc[colorKey] = {
        colorId: item.colorId,
        colorName: item.colorName,
        colorRgb: item.colorRgb,
        new: null as InventoryItem | null,
        used: null as InventoryItem | null,
      };
    }
    if (item.newOrUsed === 'N') {
      acc[colorKey].new = item;
    } else {
      acc[colorKey].used = item;
    }
    return acc;
  }, {} as Record<string, {
    colorId: number | null;
    colorName: string | null;
    colorRgb: string | null;
    new: InventoryItem | null;
    used: InventoryItem | null;
  }>);

  const colorGroups = Object.values(groupedByColor);
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const itemName = items[0]?.itemName || null; // Get item name from first item

  // Convert RGB string to hex
  const rgbToHex = (rgb: string | null) => {
    if (!rgb) return '#808080'; // Default gray
    
    // Check if it's already in hex format (like "FF0000")
    if (/^[0-9A-Fa-f]{6}$/.test(rgb)) {
      return `#${rgb}`;
    }
    
    // Try to parse decimal format (like "255,0,0")
    const match = rgb.match(/(\d+),(\d+),(\d+)/);
    if (!match) return '#808080';
    const [, r, g, b] = match;
    return `#${[r, g, b].map(x => parseInt(x).toString(16).padStart(2, '0')).join('')}`;
  };

  return (
    <div className="border border-purple-500/20 rounded-lg mb-3">
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover-elevate active-elevate-2 rounded-lg"
        data-testid={`inventory-group-${itemNo}`}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-purple-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-purple-400 flex-shrink-0" />
          )}
          <div className="flex items-center gap-1.5 text-[11px] flex-1 min-w-0 overflow-hidden">
            <span className="text-purple-300 whitespace-nowrap font-medium flex-shrink-0">Part {itemNo}</span>
            {itemName && (
              <span className="text-gray-300 truncate flex-1 min-w-0">- {itemName}</span>
            )}
          </div>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-3 pb-3">
          {/* Column headers */}
          <div className="grid grid-cols-[14px_80px_1fr] gap-2 items-center pb-1.5 mb-1.5 border-b border-purple-500/20">
            <div></div> {/* Empty space for color dot column */}
            <div></div> {/* Empty space for color name column */}
            <div className="grid grid-cols-2 gap-3 text-xs md:text-sm font-semibold uppercase tracking-wider">
              <span className="text-green-400/70">New</span>
              <span className="text-orange-400/70">Used</span>
            </div>
          </div>
          
          {/* Color rows */}
          <div className="space-y-1">
            {colorGroups.map((group, idx) => {
              const colorHex = rgbToHex(group.colorRgb);
              // Use the first available item ID for this color group (item-level details)
              const itemId = group.new?.id || group.used?.id;
              
              return (
                <div
                  key={idx}
                  className="w-full grid grid-cols-[14px_80px_1fr] gap-2 items-center py-1.5 px-2 -mx-2 rounded"
                  data-testid={`inventory-row-${itemNo}-${idx}`}
                >
                  {/* Color dot */}
                  <div
                    className="w-2.5 h-2.5 rounded-full border border-gray-700/50 flex-shrink-0"
                    style={{ backgroundColor: colorHex }}
                    title={group.colorName || 'Unknown Color'}
                  />
                  
                  {/* Color name */}
                  <span className="text-gray-400 text-sm md:text-base truncate">{group.colorName || 'Unknown'}</span>
                  
                  {/* Conditions aligned in columns - each clickable separately */}
                  <div className="grid grid-cols-2 gap-3 text-sm md:text-base">
                    {/* New condition - clickable if exists */}
                    {group.new ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log('[InventoryGroup] Clicked New:', { itemId: group.new?.id, itemNo, colorName: group.colorName });
                          if (group.new?.id) {
                            onItemClick?.(group.new.id);
                          }
                        }}
                        className="flex items-center gap-1 text-left hover:bg-gray-800/20 active:bg-gray-800/30 rounded px-1 -mx-1 transition-colors"
                        data-testid={`inventory-new-${itemNo}-${idx}`}
                      >
                        <span className="text-green-400 whitespace-nowrap">{group.new.quantity}@${group.new.unitPrice || '0.00'}</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-1"></div>
                    )}
                    
                    {/* Used condition - clickable if exists */}
                    {group.used ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log('[InventoryGroup] Clicked Used:', { itemId: group.used?.id, itemNo, colorName: group.colorName });
                          if (group.used?.id) {
                            onItemClick?.(group.used.id);
                          }
                        }}
                        className="flex items-center gap-1 text-left hover:bg-gray-800/20 active:bg-gray-800/30 rounded px-1 -mx-1 transition-colors"
                        data-testid={`inventory-used-${itemNo}-${idx}`}
                      >
                        <span className="text-orange-400 whitespace-nowrap">{group.used.quantity}@${group.used.unitPrice || '0.00'}</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-1"></div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

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
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-purple-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-purple-400" />
          )}
          <div className="text-xs text-purple-300 flex-1 min-w-0 flex items-center">
            <span className="whitespace-nowrap">Part {itemNo}</span>
            {itemName && (
              <>
                <span className="whitespace-nowrap mx-1">-</span>
                <span className="text-gray-400 truncate overflow-hidden text-ellipsis whitespace-nowrap">{itemName}</span>
              </>
            )}
          </div>
          <span className="text-xs text-gray-400 flex-shrink-0">({totalQuantity} units in {colorGroups.length} colors)</span>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-3 pb-2 space-y-1">
          {colorGroups.map((group, idx) => {
            const colorHex = rgbToHex(group.colorRgb);
            // Use the first available item ID for this color group (item-level details)
            const itemId = group.new?.id || group.used?.id;
            
            return (
              <button
                key={idx}
                onClick={() => itemId && onItemClick?.(itemId)}
                className="w-full grid grid-cols-[16px_90px_1fr] gap-2 items-center p-2 -mx-2 rounded overflow-hidden text-left hover:bg-gray-800/20 active:bg-gray-800/30 transition-colors"
                data-testid={`inventory-row-${itemNo}-${idx}`}
              >
                {/* Color dot */}
                <div
                  className="w-3 h-3 rounded-full border border-gray-700/50 flex-shrink-0"
                  style={{ backgroundColor: colorHex }}
                  title={group.colorName || 'Unknown Color'}
                />
                
                {/* Color name */}
                <span className="text-gray-400 text-xs truncate">{group.colorName || 'Unknown'}</span>
                
                {/* Conditions aligned in columns with fixed widths to prevent overlap */}
                <div className="flex items-center gap-3 text-xs overflow-hidden">
                  {/* New condition */}
                  <div className="w-[95px] flex-shrink-0">
                    {group.new && (
                      <div className="flex items-center gap-1">
                        <span className="text-green-400">N:</span>
                        <span className="text-green-400 whitespace-nowrap">{group.new.quantity}@${group.new.unitPrice || '0.00'}</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Used condition */}
                  <div className="w-[95px] flex-shrink-0">
                    {group.used && (
                      <div className="flex items-center gap-1">
                        <span className="text-orange-400">U:</span>
                        <span className="text-orange-400 whitespace-nowrap">{group.used.quantity}@${group.used.unitPrice || '0.00'}</span>
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

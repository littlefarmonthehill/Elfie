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
    <div className="border border-purple-500/20 rounded-lg bg-gray-800/40 mb-3">
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
            return (
              <div key={idx} className="grid grid-cols-[16px_100px_1fr] gap-2 items-center">
                {/* Color dot */}
                <div
                  className="w-3 h-3 rounded-full border border-gray-700/50 flex-shrink-0"
                  style={{ backgroundColor: colorHex }}
                  title={group.colorName || 'Unknown Color'}
                />
                
                {/* Color name */}
                <span className="text-gray-400 text-xs">{group.colorName || 'Unknown'}</span>
                
                {/* Conditions aligned in columns */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {/* New condition - fixed width for alignment */}
                  {group.new ? (
                    <button
                      onClick={() => onItemClick?.(group.new!.id)}
                      className="flex items-center gap-1 hover-elevate active-elevate-2 justify-start"
                      data-testid={`item-new-${group.new.id}`}
                    >
                      <span className="text-green-400">N:</span>
                      <span className="text-green-400">{group.new.quantity}@${group.new.unitPrice || '0.00'}</span>
                    </button>
                  ) : (
                    <div></div>
                  )}
                  
                  {/* Used condition - fixed width for alignment */}
                  {group.used ? (
                    <button
                      onClick={() => onItemClick?.(group.used!.id)}
                      className="flex items-center gap-1 hover-elevate active-elevate-2 justify-start"
                      data-testid={`item-used-${group.used.id}`}
                    >
                      <span className="text-orange-400">U:</span>
                      <span className="text-orange-400">{group.used.quantity}@${group.used.unitPrice || '0.00'}</span>
                    </button>
                  ) : (
                    <div></div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

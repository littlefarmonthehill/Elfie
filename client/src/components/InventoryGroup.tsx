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
          <div className="text-xs flex-1 min-w-0 flex flex-col gap-0.5">
            <div className="text-purple-300 flex items-center gap-2">
              <span className="whitespace-nowrap">Part {itemNo}</span>
              <span className="text-gray-400 flex-shrink-0">({totalQuantity} units in {colorGroups.length} colors)</span>
            </div>
            {itemName && (
              <div className="text-gray-400 text-[11px] truncate">{itemName}</div>
            )}
          </div>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-3 pb-2">
          {/* Column headers */}
          <div className="grid grid-cols-[16px_80px_1fr] gap-2 items-center pb-1 mb-1 border-b border-purple-500/20">
            <div></div> {/* Empty space for color dot column */}
            <div></div> {/* Empty space for color name column */}
            <div className="grid grid-cols-2 gap-2 text-[10px] font-semibold uppercase tracking-wider">
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
                <button
                  key={idx}
                  onClick={() => itemId && onItemClick?.(itemId)}
                  className="w-full grid grid-cols-[16px_80px_1fr] gap-2 items-center p-2 -mx-2 rounded text-left hover:bg-gray-800/20 active:bg-gray-800/30 transition-colors"
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
                  
                  {/* Conditions aligned in columns - using grid for vertical alignment */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {/* New condition - always in first column, no "N:" prefix */}
                    <div className="flex items-center gap-1">
                      {group.new && (
                        <span className="text-green-400 whitespace-nowrap">{group.new.quantity}@${group.new.unitPrice || '0.00'}</span>
                      )}
                    </div>
                    
                    {/* Used condition - always in second column, no "U:" prefix */}
                    <div className="flex items-center gap-1">
                      {group.used && (
                        <span className="text-orange-400 whitespace-nowrap">{group.used.quantity}@${group.used.unitPrice || '0.00'}</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

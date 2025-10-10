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
          <span className="text-xs text-purple-300">
            Part {itemNo}
            {itemName && <span className="text-gray-400"> - {itemName}</span>}
          </span>
          <span className="text-xs text-gray-400">({totalQuantity} units in {colorGroups.length} colors)</span>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-3 pb-2 space-y-1">
          {colorGroups.map((group, idx) => {
            const colorHex = rgbToHex(group.colorRgb);
            return (
              <div key={idx} className="flex items-center gap-2">
                {/* Color dot */}
                <div
                  className="w-3 h-3 rounded-full border border-gray-600 flex-shrink-0"
                  style={{ backgroundColor: colorHex }}
                  title={group.colorName || 'Unknown Color'}
                />
                
                {/* Compact single-line display */}
                <div className="flex items-center gap-2 flex-1 text-xs">
                  <span className="text-gray-400 min-w-[80px]">{group.colorName || 'Unknown'}</span>
                  
                  {/* New condition */}
                  {group.new && (
                    <button
                      onClick={() => onItemClick?.(group.new!.id)}
                      className="flex items-center gap-1 hover-elevate active-elevate-2 px-1"
                      data-testid={`item-new-${group.new.id}`}
                    >
                      <span className="text-green-400">N:</span>
                      <span className="text-green-400">{group.new.quantity}@${group.new.unitPrice || '0.00'}</span>
                    </button>
                  )}
                  
                  {/* Used condition */}
                  {group.used && (
                    <button
                      onClick={() => onItemClick?.(group.used!.id)}
                      className="flex items-center gap-1 hover-elevate active-elevate-2 px-1"
                      data-testid={`item-used-${group.used.id}`}
                    >
                      <span className="text-orange-400">U:</span>
                      <span className="text-orange-400">{group.used.quantity}@${group.used.unitPrice || '0.00'}</span>
                    </button>
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

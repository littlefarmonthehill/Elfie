import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InventoryItem {
  id: number;
  itemNo: string;
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
          <span className="font-semibold text-purple-300 text-sm">Part {itemNo}</span>
          <span className="text-xs text-gray-400">({totalQuantity} units in {colorGroups.length} colors)</span>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-2">
          {colorGroups.map((group, idx) => {
            const colorHex = rgbToHex(group.colorRgb);
            return (
              <div key={idx} className="flex items-start gap-2 text-xs">
                {/* Color dot */}
                <div
                  className="w-4 h-4 rounded-full border border-gray-600 mt-0.5 flex-shrink-0"
                  style={{ backgroundColor: colorHex }}
                  title={group.colorName || 'Unknown Color'}
                />
                
                {/* Color name and quantities */}
                <div className="flex-1">
                  <div className="font-medium text-gray-300 mb-1">
                    {group.colorName || 'Unknown Color'}
                  </div>
                  
                  <div className="flex gap-3">
                    {/* New condition */}
                    {group.new && (
                      <button
                        onClick={() => onItemClick?.(group.new!.id)}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-green-900/30 border border-green-700/50 hover:bg-green-900/50 transition-colors"
                        data-testid={`item-new-${group.new.id}`}
                      >
                        <span className="text-green-400 font-semibold">New:</span>
                        <span className="text-gray-300">{group.new.quantity} @ ${group.new.unitPrice || '0.00'}</span>
                      </button>
                    )}
                    
                    {/* Used condition */}
                    {group.used && (
                      <button
                        onClick={() => onItemClick?.(group.used!.id)}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-orange-900/30 border border-orange-700/50 hover:bg-orange-900/50 transition-colors"
                        data-testid={`item-used-${group.used.id}`}
                      >
                        <span className="text-orange-400 font-semibold">Used:</span>
                        <span className="text-gray-300">{group.used.quantity} @ ${group.used.unitPrice || '0.00'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

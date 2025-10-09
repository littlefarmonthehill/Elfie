import MetricCard from "./MetricCard";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface InventoryItem {
  id: number;
  itemNo: string;
  itemType: string;
  colorId: number | null;
  colorName: string | null;
  colorRgb: string | null;
  categoryId: number | null;
  categoryName: string | null;
  quantity: number;
  newOrUsed: string;
  unitPrice: string | null;
  updatedAt: Date;
}

interface InventoryStats {
  totalLots: number;
  totalParts: number;
  totalValue: number;
}

interface InventoryDashboardProps {
  onItemClick?: (item: InventoryItem) => void;
}

export default function InventoryDashboard({ onItemClick }: InventoryDashboardProps) {
  const { data: stats } = useQuery<InventoryStats>({
    queryKey: ['/api/inventory/stats'],
  });

  const { data: inventory = [], isLoading } = useQuery<InventoryItem[]>({
    queryKey: ['/api/inventory'],
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('en-US').format(value);
  };

  return (
    <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-blue/5 to-transparent rounded-lg border border-lego-blue/10 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
      <div className="space-y-1.5">
        <div>
          <h3 className="text-xs text-gray-500 mb-0.5">Quantities</h3>
          <div className="grid grid-cols-3 gap-1.5">
            <MetricCard label="Lots" value={stats ? formatNumber(stats.totalLots) : '0'} color="blue" />
            <MetricCard label="Parts" value={stats ? formatNumber(stats.totalParts) : '0'} color="blue" />
            <MetricCard label="Total Value" value={stats ? formatCurrency(stats.totalValue) : '$0.00'} color="green" />
          </div>
        </div>

        <div>
          <h3 className="text-xs text-gray-500 mb-0.5">Recent Inventory</h3>
          {isLoading ? (
            <div className="text-xs text-gray-400 p-2">Loading inventory...</div>
          ) : inventory.length === 0 ? (
            <div className="text-xs text-gray-400 p-2">No inventory found. Sync with BrickLink to get started.</div>
          ) : (
            <ScrollArea className="h-[300px]">
              <div className="space-y-1">
                {inventory.map((item) => (
                  <Card
                    key={item.id}
                    className="p-2 bg-gray-900/50 border-lego-blue/20 cursor-pointer hover-elevate active-elevate-2"
                    onClick={() => onItemClick?.(item)}
                    data-testid={`inventory-item-${item.id}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="w-8 h-8 bg-gray-800 rounded flex items-center justify-center flex-shrink-0">
                        <Package className="h-4 w-4 text-lego-blue" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className="text-xs font-semibold text-gray-200 truncate">{item.itemNo}</span>
                          <Badge variant="outline" className="text-xs h-4 px-1 flex-shrink-0">
                            {item.newOrUsed === 'N' ? 'New' : 'Used'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-400">
                          {item.categoryName && (
                            <Badge variant="secondary" className="text-xs h-4 px-1">
                              {item.categoryName}
                            </Badge>
                          )}
                          {item.colorName && (
                            <Badge variant="secondary" className="text-xs h-4 px-1">
                              {item.colorName}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-gray-400">Qty: {item.quantity}</span>
                          {item.unitPrice && (
                            <span className="text-xs font-mono text-lego-green">
                              ${parseFloat(item.unitPrice).toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </div>
  );
}

import MetricCard from "./MetricCard";
import { useQuery } from "@tanstack/react-query";
import { InfoIcon, AlertCircle, Package, TrendingUp, Clock } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";

interface InventoryStats {
  totalLots: number;
  totalParts: number;
  totalValue: number;
  totalCost: number;
  totalColors: number;
  totalCategories: number;
}

interface InventoryItem {
  id: number;
  inventoryId: number;
  quantity: number;
  unitPrice: string;
  colorName: string;
  item: {
    no: string;
    name: string;
  };
}

interface RecentInventoryItem {
  id: number;
  inventoryId: number;
  itemNo: string;
  itemName: string | null;
  colorId: number | null;
  colorName: string | null;
  colorRgb: string | null;
  quantity: number;
  unitPrice: string | null;
  newOrUsed: string;
  syncedAt: string;
  updatedAt: string;
}

interface InventoryDashboardProps {
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
}

export default function InventoryDashboard({ onItemClick }: InventoryDashboardProps) {
  const { data: stats, isLoading } = useQuery<InventoryStats>({
    queryKey: ['/api/inventory/stats'],
  });

  // Fetch top value items
  const { data: topValueItems = [] } = useQuery<InventoryItem[]>({
    queryKey: ['/api/inventory', 'top-value'],
    select: (data: InventoryItem[]) => 
      data
        .filter(item => item.unitPrice && !isNaN(Number(item.unitPrice)))
        .sort((a, b) => Number(b.unitPrice) - Number(a.unitPrice))
        .slice(0, 6)
  });

  // Fetch newly added items
  const { data: newItems = [] } = useQuery<RecentInventoryItem[]>({
    queryKey: ['/api/inventory/recent-updates', 'new'],
    queryFn: async () => {
      const response = await fetch('/api/inventory/recent-updates?type=new&limit=4');
      if (!response.ok) throw new Error('Failed to fetch new items');
      return response.json();
    }
  });

  // Fetch recently updated items
  const { data: updatedItems = [] } = useQuery<RecentInventoryItem[]>({
    queryKey: ['/api/inventory/recent-updates', 'updated'],
    queryFn: async () => {
      const response = await fetch('/api/inventory/recent-updates?type=updated&limit=4');
      if (!response.ok) throw new Error('Failed to fetch updated items');
      return response.json();
    }
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

  const safeFormatDate = (dateString: string | null | undefined): string => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'N/A';
    return formatDistanceToNow(date, { addSuffix: true });
  };

  const profitPotential = stats ? stats.totalValue - stats.totalCost : 0;

  if (isLoading) {
    return (
      <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-blue/5 to-transparent rounded-lg border border-lego-blue/10 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
        <div className="flex items-center justify-center py-8">
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-lego-blue border-t-transparent" data-testid="loading-spinner"></div>
            <p className="text-xs text-gray-500">Loading inventory stats...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-blue/5 to-transparent rounded-lg border border-lego-blue/10 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
      <div className="space-y-1.5">
        <div>
          <h3 className="text-xs text-gray-500 mb-0.5">Inventory Info</h3>
          <div className="grid grid-cols-4 gap-1.5">
            <MetricCard label="Lots" value={stats ? formatNumber(stats.totalLots) : '0'} color="blue" data-testid="metric-lots" />
            <MetricCard label="Parts" value={stats ? formatNumber(stats.totalParts) : '0'} color="blue" data-testid="metric-parts" />
            <MetricCard label="Colors" value={stats ? formatNumber(stats.totalColors) : '0'} color="blue" data-testid="metric-colors" />
            <MetricCard label="Categories" value={stats ? formatNumber(stats.totalCategories) : '0'} color="blue" data-testid="metric-categories" />
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1 mb-0.5">
            <h3 className="text-xs text-gray-500">Values</h3>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="text-gray-500 hover:text-gray-400" data-testid="button-cost-info">
                  <InfoIcon className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-xs">
                  <strong>My Cost</strong> tracking is not available via BrickLink's API. 
                  To track costs, you'll need to manually add them in this app. 
                  (Cost tracking feature coming soon!)
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <MetricCard label="My Cost" value={stats ? formatCurrency(stats.totalCost) : '$0.00'} color="red" data-testid="metric-cost" />
            <MetricCard label="Listed" value={stats ? formatCurrency(stats.totalValue) : '$0.00'} color="blue" data-testid="metric-listed" />
            <MetricCard label="Profit Potential" value={formatCurrency(profitPotential)} color="green" data-testid="metric-profit" />
          </div>
        </div>

        {/* Highlights - Top Value Items */}
        <div className="bg-gray-900/50 border border-green-500/20 rounded-lg p-3" data-testid="section-top-value">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-green-400" />
            <h3 className="text-[10px] font-semibold text-green-400 uppercase tracking-wide">Highlights - Highest Value Items</h3>
          </div>
          <div className="space-y-1">
            {topValueItems.length > 0 ? (
              topValueItems.map((item) => (
                <div 
                  key={item.id} 
                  onClick={() => onItemClick?.('inventory', item.inventoryId)}
                  className="flex justify-between items-center text-[10px] hover-elevate rounded px-2 py-0.5 cursor-pointer"
                  data-testid={`top-value-${item.id}`}
                >
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <span className="text-gray-400 font-mono flex-shrink-0">{item.item.no}</span>
                    <span className="text-gray-500 truncate text-[9px]">{item.colorName}</span>
                  </div>
                  <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                    <span className="text-gray-500 text-[9px]">Qty: {item.quantity}</span>
                    <span className="text-lego-green font-mono">@${Number(item.unitPrice).toFixed(2)}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-[9px] text-gray-500 italic">No items to display</div>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-gray-900/50 border border-blue-500/20 rounded-lg p-3" data-testid="section-recent-updates">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-3.5 h-3.5 text-blue-400" />
            <h3 className="text-[10px] font-semibold text-blue-400 uppercase tracking-wide">Recent Activity</h3>
          </div>
          
          {newItems.length > 0 || updatedItems.length > 0 ? (
            <div className="space-y-3">
              {/* Newly Added Items */}
              {newItems.length > 0 && (
                <div>
                  <h4 className="text-[9px] font-bold text-gray-500 uppercase mb-1.5 tracking-wide">New Items</h4>
                  <div className="space-y-1">
                    {newItems.map((item) => (
                      <div 
                        key={item.id} 
                        onClick={() => onItemClick?.('inventory', item.inventoryId)}
                        className="flex justify-between items-center text-[10px] hover-elevate rounded px-2 py-0.5 cursor-pointer"
                        data-testid={`new-item-${item.id}`}
                      >
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <Package className="w-3 h-3 text-green-400 flex-shrink-0" />
                          <span className="text-gray-400 font-mono flex-shrink-0">{item.itemNo}</span>
                          <span className="text-gray-500 truncate text-[9px]">{item.colorName || 'N/A'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                          <span className="text-gray-600 text-[9px]">
                            {safeFormatDate(item.syncedAt)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Updated Items */}
              {updatedItems.length > 0 && (
                <div>
                  <h4 className="text-[9px] font-bold text-gray-500 uppercase mb-1.5 tracking-wide">Updated Items</h4>
                  <div className="space-y-1">
                    {updatedItems.map((item) => (
                      <div 
                        key={item.id} 
                        onClick={() => onItemClick?.('inventory', item.inventoryId)}
                        className="flex justify-between items-center text-[10px] hover-elevate rounded px-2 py-0.5 cursor-pointer"
                        data-testid={`recent-update-${item.id}`}
                      >
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                          <span className="text-gray-400 font-mono flex-shrink-0">{item.itemNo}</span>
                          <span className="text-gray-500 truncate text-[9px]">{item.colorName || 'N/A'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                          <span className="text-gray-600 text-[9px]">
                            {safeFormatDate(item.updatedAt)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[9px] text-gray-500 italic">No recent activity</div>
          )}
        </div>
      </div>
    </div>
  );
}

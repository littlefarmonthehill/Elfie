import MetricCard from "./MetricCard";
import { useQuery } from "@tanstack/react-query";
import { InfoIcon, AlertCircle, Package, TrendingUp, Clock, Sparkles, Warehouse, RefreshCw } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { formatDistanceToNow } from "date-fns";
import PriceOMaticDashboard from "./PriceOMaticDashboard";
import WarehouseManagement from "./WarehouseManagement";
import PlatformSyncTool from "./PlatformSyncTool";

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
  activeDrawer: 'priceomatic' | 'warehouse' | 'platformsync' | null;
  onDrawerChange: (drawer: 'priceomatic' | 'warehouse' | 'platformsync' | null) => void;
}

export default function InventoryDashboard({ onItemClick, activeDrawer, onDrawerChange }: InventoryDashboardProps) {

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
        <div className="bg-gray-900/50 border border-blue-500/20 rounded-lg p-3" data-testid="section-inventory-info">
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-blue-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-blue-400 uppercase tracking-wide">Inventory Info</h3>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            <MetricCard label="Lots" value={stats ? formatNumber(stats.totalLots) : '0'} color="blue" data-testid="metric-lots" />
            <MetricCard label="Parts" value={stats ? formatNumber(stats.totalParts) : '0'} color="blue" data-testid="metric-parts" />
            <MetricCard label="Colors" value={stats ? formatNumber(stats.totalColors) : '0'} color="blue" data-testid="metric-colors" />
            <MetricCard label="Categories" value={stats ? formatNumber(stats.totalCategories) : '0'} color="blue" data-testid="metric-categories" />
          </div>
        </div>

        <div className="bg-gray-900/50 border border-cyan-500/20 rounded-lg p-3" data-testid="section-values">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-cyan-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-cyan-400 uppercase tracking-wide">Values</h3>
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
        <div className="bg-gray-900/50 border border-green-500/20 rounded-lg p-3 md:p-4" data-testid="section-top-value">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-green-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-green-400 uppercase tracking-wide">Highlights - Highest Value Items</h3>
          </div>
          <div className="space-y-1.5">
            {topValueItems.length > 0 ? (
              topValueItems.map((item) => (
                <div 
                  key={item.id} 
                  onClick={() => onItemClick?.('inventory', item.inventoryId)}
                  className="flex justify-between items-start hover-elevate rounded px-2 py-1 cursor-pointer"
                  data-testid={`top-value-${item.id}`}
                >
                  <div className="flex gap-2 flex-1 min-w-0">
                    <TrendingUp className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-green-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-gray-200 font-mono text-xs md:text-base lg:text-lg font-medium">
                        {item.item.no}
                      </div>
                      <div className="flex gap-1.5 text-[11px] md:text-sm lg:text-base text-gray-400 mt-0.5">
                        <span>{item.colorName}</span>
                        <span>•</span>
                        <span>Qty: {item.quantity}</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-lego-green font-mono font-medium text-xs md:text-base lg:text-lg ml-2 flex-shrink-0">@${Number(item.unitPrice).toFixed(2)}</span>
                </div>
              ))
            ) : (
              <div className="text-[11px] text-gray-500 italic">No items to display</div>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-gray-900/50 border border-blue-500/20 rounded-lg p-3 md:p-4" data-testid="section-recent-updates">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-blue-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-blue-400 uppercase tracking-wide">Recent Activity</h3>
          </div>
          
          {newItems.length > 0 || updatedItems.length > 0 ? (
            <div className="space-y-3">
              {/* Newly Added Items */}
              {newItems.length > 0 && (
                <div>
                  <h4 className="text-[9px] md:text-xs font-bold text-gray-500 uppercase mb-1.5 tracking-wide">New Items</h4>
                  <div className="space-y-1">
                    {newItems.map((item) => (
                      <div 
                        key={item.id} 
                        onClick={() => onItemClick?.('inventory', item.inventoryId)}
                        className="flex justify-between items-start hover-elevate rounded px-2 py-1 cursor-pointer"
                        data-testid={`new-item-${item.id}`}
                      >
                        <div className="flex gap-2 flex-1 min-w-0">
                          <Package className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-green-400 flex-shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="text-gray-200 truncate text-xs md:text-base lg:text-lg font-medium">
                              {item.itemNo} {item.itemName && `- ${item.itemName}`}
                            </div>
                            <div className="flex gap-1.5 text-[11px] md:text-sm lg:text-base text-gray-400 mt-0.5">
                              <span>{item.colorName || 'N/A'}</span>
                              <span>•</span>
                              <span>{item.newOrUsed === 'N' ? 'New' : 'Used'}</span>
                              <span>•</span>
                              <span>{safeFormatDate(item.syncedAt)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Updated Items */}
              {updatedItems.length > 0 && (
                <div>
                  <h4 className="text-[9px] md:text-xs font-bold text-gray-500 uppercase mb-1.5 tracking-wide">Updated Items</h4>
                  <div className="space-y-1">
                    {updatedItems.map((item) => (
                      <div 
                        key={item.id} 
                        onClick={() => onItemClick?.('inventory', item.inventoryId)}
                        className="flex justify-between items-start hover-elevate rounded px-2 py-1 cursor-pointer"
                        data-testid={`recent-update-${item.id}`}
                      >
                        <div className="flex gap-2 flex-1 min-w-0">
                          <div className="w-2.5 h-2.5 md:w-3 md:h-3 lg:w-3.5 lg:h-3.5 rounded-full bg-blue-400 flex-shrink-0 mt-1" />
                          <div className="flex-1 min-w-0">
                            <div className="text-gray-200 truncate text-xs md:text-base lg:text-lg font-medium">
                              {item.itemNo} {item.itemName && `- ${item.itemName}`}
                            </div>
                            <div className="flex gap-1.5 text-[11px] md:text-sm lg:text-base text-gray-400 mt-0.5">
                              <span>{item.colorName || 'N/A'}</span>
                              <span>•</span>
                              <span>{item.newOrUsed === 'N' ? 'New' : 'Used'}</span>
                              <span>•</span>
                              <span>{safeFormatDate(item.updatedAt)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[9px] md:text-xs text-gray-500 italic">No recent activity</div>
          )}
        </div>
      </div>

      {/* Price-O-Matic Drawer */}
      <Drawer open={activeDrawer === 'priceomatic'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[92vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2 text-base md:text-lg">
              <Sparkles className="w-5 h-5 text-lego-orange" />
              Price-O-Matic Intelligence
            </DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-4">
            <PriceOMaticDashboard onItemClick={onItemClick} />
          </div>
        </DrawerContent>
      </Drawer>

      {/* Warehouse Management Drawer */}
      <Drawer open={activeDrawer === 'warehouse'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[90vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2 text-base md:text-lg">
              <Warehouse className="w-5 h-5 text-blue-400" />
              Warehouse Management
            </DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-4 flex-1">
            <WarehouseManagement onItemClick={onItemClick} />
          </div>
        </DrawerContent>
      </Drawer>

      {/* Platform Sync Drawer */}
      <Drawer open={activeDrawer === 'platformsync'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[90vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2 text-base md:text-lg">
              <RefreshCw className="w-5 h-5 text-purple-400" />
              Sync Inventory
            </DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-4 flex-1">
            <PlatformSyncTool />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

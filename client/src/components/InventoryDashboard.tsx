import { useState, useRef } from "react";
import MetricCard from "./MetricCard";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { InfoIcon, AlertCircle, Package, TrendingUp, Clock, Sparkles, Warehouse, RefreshCw, Info, ListChecks, ScanSearch, AlertTriangle, ArrowRight, Globe, Boxes } from "lucide-react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import PriceOMaticDashboard from "./PriceOMaticDashboard";
import WarehouseManagement from "./WarehouseManagement";
import PlatformSyncTool from "./PlatformSyncTool";
import ListomaticPriority from "./ListomaticPriority";
import BrickanalyzerTool, { BrickanalyzerToolRef } from "./BrickanalyzerTool";

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
  onItemClick?: (type: 'order' | 'inventory', id: number | string, initialTab?: string) => void;
  activeDrawer: 'priceomatic' | 'warehouse' | 'platformsync' | 'brickanalyzer' | null;
  onDrawerChange: (drawer: 'priceomatic' | 'warehouse' | 'platformsync' | 'brickanalyzer' | null) => void;
  onOpenSettings?: (section?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'users') => void;
}

export default function InventoryDashboard({ onItemClick, activeDrawer, onDrawerChange, onOpenSettings }: InventoryDashboardProps) {

  const { toast } = useToast();
  const brickanalyzerRef = useRef<BrickanalyzerToolRef>(null);

  const { data: appSettings } = useQuery<{ timezone?: string }>({
    queryKey: ['/api/settings'],
    staleTime: 60000,
  });
  const configuredTimezone = appSettings?.timezone || 'America/Chicago';

  const { data: stats, isLoading } = useQuery<InventoryStats>({
    queryKey: ['/api/inventory/stats'],
  });

  const { data: toolStats } = useQuery<{ warehouseUnassigned: number; pendingScans: number }>({
    queryKey: ['/api/inventory/tool-stats'],
    staleTime: 2 * 60 * 1000,
  });

  const { data: pomInsights } = useQuery<{
    data: {
      tooHigh: any[]; tooLow: any[]; wellPriced: any[];
      summary: { total: number; tooHigh: number; tooLow: number; wellPriced: number };
    };
  }>({
    queryKey: ['/api/priceomatic/insights'],
    staleTime: 10 * 60 * 1000,
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

        {/* Combined Inventory Info + Values */}
        <div className="bg-gray-900/50 border border-blue-500/20 rounded-lg p-3" data-testid="section-inventory-overview">
          <div className="flex items-center gap-2 mb-2.5">
            <Package className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-blue-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-blue-400 uppercase tracking-wide">Inventory</h3>
            <div className="flex items-center gap-1.5 ml-auto">
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
          </div>
          <div className="grid grid-cols-4 gap-1.5 mb-2" data-testid="section-inventory-info">
            <MetricCard label="Lots" value={stats ? formatNumber(stats.totalLots) : '0'} color="blue" data-testid="metric-lots" />
            <MetricCard label="Parts" value={stats ? formatNumber(stats.totalParts) : '0'} color="blue" data-testid="metric-parts" />
            <MetricCard label="Colors" value={stats ? formatNumber(stats.totalColors) : '0'} color="blue" data-testid="metric-colors" />
            <MetricCard label="Categories" value={stats ? formatNumber(stats.totalCategories) : '0'} color="blue" data-testid="metric-categories" />
          </div>
          <div className="grid grid-cols-3 gap-1.5" data-testid="section-values">
            <MetricCard label="My Cost" value={stats ? formatCurrency(stats.totalCost) : '$0.00'} color="red" data-testid="metric-cost" />
            <MetricCard label="Listed" value={stats ? formatCurrency(stats.totalValue) : '$0.00'} color="blue" data-testid="metric-listed" />
            <MetricCard label="Profit Potential" value={formatCurrency(profitPotential)} color="green" data-testid="metric-profit" />
          </div>
        </div>

        {/* Tools — Primary Workflows */}
        <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-3" data-testid="section-tools">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-gray-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-gray-400 uppercase tracking-wide">Tools</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">

            {/* Price-O-Matic */}
            <button
              onClick={() => onDrawerChange('priceomatic')}
              data-testid="tool-priceomatic"
              className="group flex flex-col gap-1.5 rounded-lg border border-purple-700/40 bg-purple-950/40 p-3 text-left hover-elevate active-elevate-2 transition-all"
            >
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-purple-900/60 p-1.5">
                  <Sparkles className="w-3.5 h-3.5 md:w-5 md:h-5 text-purple-300" />
                </div>
                <span className="text-xs md:text-sm lg:text-base font-bold text-purple-200 leading-tight flex-1">Price-O-Matic</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <span
                      role="button"
                      onClick={(e) => e.stopPropagation()}
                      className="text-purple-600/60 hover:text-purple-400 transition-colors"
                      data-testid="info-priceomatic"
                    >
                      <Info className="w-3 h-3" />
                    </span>
                  </PopoverTrigger>
                  <PopoverContent side="top" className="w-60 text-xs text-gray-300 bg-gray-900 border-gray-700 p-2.5">
                    AI-powered pricing engine. Review opportunities and set competitive prices.
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem]" data-testid="pom-stats">
                {(pomInsights?.data?.summary?.tooLow ?? 0) > 0 && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-600/30" data-testid="pom-underpriced">
                    {pomInsights!.data.summary.tooLow} underpriced
                  </span>
                )}
                {(pomInsights?.data?.summary?.tooHigh ?? 0) > 0 && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-600/30" data-testid="pom-overpriced">
                    {pomInsights!.data.summary.tooHigh} overpriced
                  </span>
                )}
                {pomInsights?.data?.summary && (pomInsights.data.summary.tooLow ?? 0) === 0 && (pomInsights.data.summary.tooHigh ?? 0) === 0 && (
                  <span className="text-[9px] text-green-400/70">All priced well</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] md:text-xs text-purple-400 font-medium">Open tool</span>
                <ArrowRight className="w-3 h-3 md:w-4 md:h-4 text-purple-500/60 group-hover:text-purple-300 transition-colors" />
              </div>
            </button>

            {/* List-O-Matic */}
            <button
              onClick={() => onDrawerChange('platformsync')}
              data-testid="tool-listomatic"
              className="group flex flex-col gap-1.5 rounded-lg border border-green-700/40 bg-green-950/40 p-3 text-left hover-elevate active-elevate-2 transition-all"
            >
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-green-900/60 p-1.5">
                  <Globe className="w-3.5 h-3.5 md:w-5 md:h-5 text-green-300" />
                </div>
                <span className="text-xs md:text-sm lg:text-base font-bold text-green-200 leading-tight flex-1">List-O-Matic</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <span
                      role="button"
                      onClick={(e) => e.stopPropagation()}
                      className="text-green-600/60 hover:text-green-400 transition-colors"
                      data-testid="info-listomatic"
                    >
                      <Info className="w-3 h-3" />
                    </span>
                  </PopoverTrigger>
                  <PopoverContent side="top" className="w-60 text-xs text-gray-300 bg-gray-900 border-gray-700 p-2.5">
                    Manage listings across BrickLink, BrickOwl, and other platforms.
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem]" />
              <div className="flex items-center justify-between">
                <span className="text-[10px] md:text-xs text-green-400 font-medium">Open tool</span>
                <ArrowRight className="w-3 h-3 md:w-4 md:h-4 text-green-500/60 group-hover:text-green-300 transition-colors" />
              </div>
            </button>

            {/* Warehouse */}
            <button
              onClick={() => onDrawerChange('warehouse')}
              data-testid="tool-warehouse"
              className="group flex flex-col gap-1.5 rounded-lg border border-teal-700/40 bg-teal-950/40 p-3 text-left hover-elevate active-elevate-2 transition-all"
            >
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-teal-900/60 p-1.5">
                  <Boxes className="w-3.5 h-3.5 md:w-5 md:h-5 text-teal-300" />
                </div>
                <span className="text-xs md:text-sm lg:text-base font-bold text-teal-200 leading-tight flex-1">Warehouse</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <span
                      role="button"
                      onClick={(e) => e.stopPropagation()}
                      className="text-teal-600/60 hover:text-teal-400 transition-colors"
                      data-testid="info-warehouse"
                    >
                      <Info className="w-3 h-3" />
                    </span>
                  </PopoverTrigger>
                  <PopoverContent side="top" className="w-60 text-xs text-gray-300 bg-gray-900 border-gray-700 p-2.5">
                    Organize stock by location. Assign bins, shelves, and storage zones.
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem]" data-testid="warehouse-stats">
                {(toolStats?.warehouseUnassigned ?? 0) > 0 ? (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-600/30" data-testid="warehouse-unassigned">
                    {toolStats!.warehouseUnassigned} not in bins
                  </span>
                ) : toolStats ? (
                  <span className="text-[9px] text-green-400/70">All assigned to bins</span>
                ) : null}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] md:text-xs text-teal-400 font-medium">Open tool</span>
                <ArrowRight className="w-3 h-3 md:w-4 md:h-4 text-teal-500/60 group-hover:text-teal-300 transition-colors" />
              </div>
            </button>

            {/* Brick Spotter 3000 */}
            <button
              onClick={() => onDrawerChange('brickanalyzer')}
              data-testid="tool-brickspotter"
              className="group flex flex-col gap-1.5 rounded-lg border border-amber-700/40 bg-amber-950/40 p-3 text-left hover-elevate active-elevate-2 transition-all"
            >
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-amber-900/60 p-1.5">
                  <ScanSearch className="w-3.5 h-3.5 md:w-5 md:h-5 text-amber-300" />
                </div>
                <span className="text-xs md:text-sm lg:text-base font-bold text-amber-200 leading-tight flex-1">Brick Spotter</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <span
                      role="button"
                      onClick={(e) => e.stopPropagation()}
                      className="text-amber-600/60 hover:text-amber-400 transition-colors"
                      data-testid="info-brickspotter"
                    >
                      <Info className="w-3 h-3" />
                    </span>
                  </PopoverTrigger>
                  <PopoverContent side="top" className="w-60 text-xs text-gray-300 bg-gray-900 border-gray-700 p-2.5">
                    Photograph a pile of parts and let AI identify and value each piece.
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-wrap gap-1 min-h-[1.25rem]" data-testid="brickspotter-stats">
                {(toolStats?.pendingScans ?? 0) > 0 ? (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-600/30" data-testid="brickspotter-pending">
                    {toolStats!.pendingScans} {toolStats!.pendingScans === 1 ? 'scan' : 'scans'} ready
                  </span>
                ) : toolStats ? (
                  <span className="text-[9px] text-green-400/70">No pending scans</span>
                ) : null}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] md:text-xs text-amber-400 font-medium">Open tool</span>
                <ArrowRight className="w-3 h-3 md:w-4 md:h-4 text-amber-500/60 group-hover:text-amber-300 transition-colors" />
              </div>
            </button>

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
        <DrawerContent className="h-[92dvh] flex flex-col">
          <DrawerHeader>
            <DrawerTitle className="flex items-center justify-between gap-2 text-base md:text-lg">
              {/* Left: title + info inline */}
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-5 h-5 text-purple-400 flex-shrink-0" />
                <span>Price-o-Matic</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="icon" variant="ghost" className="w-6 h-6" data-testid="button-pom-info">
                      <Info className="w-3.5 h-3.5 text-gray-500" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent side="bottom" align="start" className="w-80 bg-gray-900 border-gray-700 p-3">
                    <h3 className="text-xs font-bold text-purple-400 mb-2">How It Works</h3>
                    <ul className="text-xs text-gray-300 space-y-1.5">
                      <li>• Fetches item details, avg listed price + <strong className="text-purple-300">85th-percentile sold price</strong> from BrickLink — 3 API calls per item.</li>
                      <li>• Applies your premium formula (Settings) to compute a suggested price, then applies cost floor and minimum price if configured.</li>
                      <li>• Items priced <strong className="text-red-300">too high</strong> are losing sales; <strong className="text-orange-300">too low</strong> are leaving margin on the table.</li>
                      <li>• Stops automatically at the daily API call ceiling to preserve your quota.</li>
                      <li>• Items with 0 stock are skipped. Formula changes apply instantly.</li>
                    </ul>
                    <p className="text-[10px] text-gray-500 pt-2 mt-2 border-t border-gray-700">Does not auto-reprice. You review each flag and decide what to change.</p>
                  </PopoverContent>
                </Popover>
              </div>
            </DrawerTitle>
          </DrawerHeader>

          <div className="overflow-y-auto px-4 pb-4 flex-1">
            <PriceOMaticDashboard onItemClick={(type, id) => onItemClick?.(type, id, 'pricing')} />
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

      {/* List O Matic Drawer */}
      <Drawer open={activeDrawer === 'platformsync'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[92dvh] flex flex-col">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2 text-base md:text-lg">
              <ListChecks className="w-5 h-5 text-green-400" />
              List-o-Matic
            </DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-4 flex-1">
            <ListomaticPriority />
          </div>
        </DrawerContent>
      </Drawer>

      {/* Brickanalyzer Drawer */}
      <Drawer open={activeDrawer === 'brickanalyzer'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[92dvh] flex flex-col">
          <DrawerHeader className="flex items-center justify-between gap-2 pr-10">
            <DrawerTitle className="flex items-center gap-2 text-base md:text-lg">
              <ScanSearch className="w-5 h-5 text-lego-yellow" />
              Brick Spotter 3000
              <Popover>
                <PopoverTrigger asChild>
                  <button className="text-gray-500 hover:text-gray-300 transition-colors" data-testid="button-brickanalyzer-info">
                    <Info className="w-4 h-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="bottom" align="start" className="w-72 bg-gray-900 border border-gray-700 text-white p-0 space-y-0">
                  <div className="px-3 py-2.5 border-b border-gray-700">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Info className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                      <span className="text-xs font-semibold text-blue-300">Setup for best results</span>
                    </div>
                    <ul className="text-xs text-blue-400/80 space-y-1 pl-4 list-disc">
                      <li>Place pieces on a plain white or light-colored surface</li>
                      <li>Spread them out so no pieces overlap or touch</li>
                      <li>Use good lighting — avoid harsh shadows</li>
                      <li>Shoot straight down for a flat overhead view</li>
                      <li>Up to ~30 pieces per scan for best accuracy</li>
                    </ul>
                  </div>
                  <div className="px-3 py-2.5 flex gap-2 items-start">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-300">
                      Results are <strong>not saved</strong>. Once you close or dismiss the scan the data is permanently deleted. Screenshot or note what you need before closing.
                    </p>
                  </div>
                </PopoverContent>
              </Popover>
            </DrawerTitle>

          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-4 flex-1">
            <BrickanalyzerTool ref={brickanalyzerRef} />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

import MetricCard from "./MetricCard";
import { useQuery } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface InventoryStats {
  totalLots: number;
  totalParts: number;
  totalValue: number;
  totalCost: number;
  totalColors: number;
  totalCategories: number;
}

export default function InventoryDashboard() {
  const { data: stats, isLoading } = useQuery<InventoryStats>({
    queryKey: ['/api/inventory/stats'],
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
                  <strong>My Cost</strong> must be manually entered in your BrickLink inventory. 
                  Go to BrickLink.com → My Store → Inventory, edit each item, and enter your cost. 
                  Then sync again here to see updated values.
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
      </div>
    </div>
  );
}

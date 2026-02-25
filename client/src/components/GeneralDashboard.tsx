import MetricCard from "./MetricCard";
import { useQuery } from "@tanstack/react-query";
import { TrendingDown, AlertCircle, TrendingUp, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import DashboardNotifications from "./DashboardNotifications";

interface DashboardStats {
  totalOrders: number;
  totalInventoryItems: number;
  totalInventoryQuantity: number;
  totalSales: number;
}

interface Order {
  id: number;
  orderNumber: string;
  customerUsername: string;
  orderDate: string;
  orderTotal: string;
  orderStatus: string;
}

interface DashboardOrders {
  pending: Order[];
  recentShipments: Order[];
  highValue: Order[];
}

interface PricingInsight {
  inventoryId: number;
  itemNo: string;
  itemName: string | null;
  itemType: string;
  colorName: string | null;
  condition: string;
  currentPrice: string;
  suggestedPrice: string;
  variance: number;
  quantity: number;
}

interface InsightsData {
  tooHigh: PricingInsight[];
  tooLow: PricingInsight[];
  wellPriced: PricingInsight[];
  summary: {
    total: number;
    tooHigh: number;
    tooLow: number;
    wellPriced: number;
  };
}

interface GeneralDashboardProps {
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
  onOpenFulfillment?: () => void;
}

export default function GeneralDashboard({ onItemClick, onOpenFulfillment }: GeneralDashboardProps) {
  // Fetch dashboard stats (all-time)
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['/api/dashboard/stats'],
    queryFn: async () => {
      const response = await fetch('/api/dashboard/stats');
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    }
  });

  // Single efficient call — DB-level status filtering, no client-side filtering of huge payloads
  const { data: dashboardOrders } = useQuery<DashboardOrders>({
    queryKey: ['/api/orders/dashboard'],
  });

  // True unfulfilled count (shared cache with home.tsx — no extra network request)
  const { data: fulfillmentStats } = useQuery<{ unfulfilled: number }>({
    queryKey: ['/api/fulfillment/stats'],
  });

  const pendingCount = fulfillmentStats?.unfulfilled ?? dashboardOrders?.pending?.length ?? 0;
  const recentSales = dashboardOrders?.recentShipments ?? [];

  // Fetch pricing opportunities (items priced too low)
  const { data: pricingInsights } = useQuery<{ success: boolean; data: InsightsData }>({
    queryKey: ['/api/priceomatic/insights'],
  });

  // Get top pricing opportunities (items priced too low, sorted by variance)
  const pricingOpportunities = pricingInsights?.data?.tooLow
    ?.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
    ?.slice(0, 5) || [];

  const formatCurrency = (value: string | number) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    }).format(num);
  };

  return (
    <div className="p-2 md:p-4 lg:p-6 space-y-2 md:space-y-4 lg:space-y-6 bg-gradient-to-br from-lego-red/5 to-transparent rounded-lg border border-lego-red/10 shadow-[0_0_15px_rgba(239,68,68,0.1)]">

      {/* Notifications */}
      <DashboardNotifications />

      {/* Key Metrics */}
      <div className="grid grid-cols-2 gap-2 md:gap-3 lg:gap-4">
        <MetricCard 
          label="Total Revenue" 
          value={`$${(stats?.totalSales || 0).toLocaleString()}`} 
          color="green" 
          data-testid="metric-total-revenue"
        />
        <MetricCard 
          label="Total Orders" 
          value={stats?.totalOrders.toLocaleString() || '0'} 
          color="blue" 
          data-testid="metric-total-orders"
        />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4 lg:gap-6 mt-2 md:mt-4 lg:mt-6">
        {/* Action Items - Orders to Fulfill */}
        <div className="bg-gray-900/50 border border-orange-500/20 rounded-lg p-2 md:p-4 lg:p-5" data-testid="section-action-items">
          <div className="flex items-center gap-1.5 md:gap-2 lg:gap-2.5 mb-2 md:mb-3 lg:mb-4">
            <AlertCircle className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-orange-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-orange-400 uppercase tracking-wide">Action Items</h3>
          </div>
          <div
            onClick={pendingCount > 0 ? onOpenFulfillment : undefined}
            className={`flex items-center justify-between rounded px-2 py-2 ${pendingCount > 0 ? 'hover-elevate cursor-pointer' : ''}`}
            data-testid="action-orders-to-fulfill"
          >
            <div className="flex items-center gap-2">
              <ShoppingCart className={`w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 ${pendingCount > 0 ? 'text-orange-400' : 'text-gray-600'}`} />
              <span className={`text-xs md:text-base lg:text-lg ${pendingCount > 0 ? 'text-gray-200' : 'text-gray-500 italic'}`}>
                Orders to Fulfill
              </span>
            </div>
            <span className={`font-mono font-bold text-xs md:text-base lg:text-lg ${pendingCount > 0 ? 'text-orange-400' : 'text-gray-600'}`}>
              {pendingCount > 0 ? pendingCount : '—'}
            </span>
          </div>
        </div>

        {/* Top Pricing Opportunities */}
        <div className="bg-gray-900/50 border border-purple-500/20 rounded-lg p-2 md:p-4 lg:p-5" data-testid="section-pricing-opportunities">
          <div className="flex items-center gap-1.5 md:gap-2 lg:gap-2.5 mb-2 md:mb-3 lg:mb-4">
            <TrendingDown className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-purple-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-purple-400 uppercase tracking-wide">Top Pricing Opportunities</h3>
          </div>
          <div className="space-y-1.5">
            {pricingOpportunities.length > 0 ? (
              pricingOpportunities.map((item) => (
                <div 
                  key={item.inventoryId} 
                  onClick={() => onItemClick?.('inventory', item.inventoryId)}
                  className="flex justify-between items-start hover-elevate rounded px-2 py-1 cursor-pointer"
                  data-testid={`pricing-item-${item.inventoryId}`}
                >
                  <div className="flex gap-2 flex-1 min-w-0">
                    <TrendingDown className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-purple-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-200 font-mono text-xs md:text-base lg:text-lg font-medium flex-shrink-0">{item.itemNo}</span>
                        {item.itemName && (
                          <span className="text-white text-xs md:text-base lg:text-lg truncate">{item.itemName}</span>
                        )}
                      </div>
                      <div className="flex gap-1.5 text-[11px] md:text-sm lg:text-base text-gray-400 mt-0.5">
                        {item.colorName && <span>{item.colorName}</span>}
                        {item.colorName && <span>•</span>}
                        <span>{item.condition === 'N' ? 'New' : 'Used'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                    <span className="text-gray-400 font-mono text-[10px] md:text-sm md:text-xs lg:text-sm">{formatCurrency(item.currentPrice)}</span>
                    <span className="text-orange-400 font-mono text-[10px] md:text-sm md:text-xs lg:text-sm font-bold">{item.variance}%</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-[11px] md:text-sm lg:text-base text-gray-500 italic">Run Price-o-Matic to see opportunities</div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity - High Value Sales */}
      <div className="bg-gray-900/50 border border-green-500/20 rounded-lg p-3 md:p-5 lg:p-6" data-testid="section-recent-activity">
        <div className="flex items-center gap-1.5 md:gap-2 lg:gap-2.5 mb-2 md:mb-3 lg:mb-4">
          <TrendingUp className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-green-400" />
          <h3 className="text-xs md:text-base lg:text-lg font-semibold text-green-400 uppercase tracking-wide">Recent Activity - Latest Sales</h3>
        </div>
        <div className="space-y-1.5">
          {recentSales.length > 0 ? (
            recentSales.map((order) => (
              <div 
                key={order.id} 
                onClick={() => onItemClick?.('order', order.id)}
                className="flex justify-between items-start hover-elevate rounded px-2 py-1 cursor-pointer"
                data-testid={`activity-order-${order.id}`}
              >
                <div className="flex gap-2 flex-1 min-w-0">
                  <div className={`w-2.5 h-2.5 md:w-3 md:h-3 lg:w-3.5 lg:h-3.5 rounded-full flex-shrink-0 mt-1 ${
                    order.orderStatus === 'shipped' ? 'bg-green-400' : 
                    order.orderStatus === 'awaiting_shipment' ? 'bg-orange-400' : 
                    'bg-gray-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-200 font-mono text-xs md:text-base lg:text-lg font-medium">
                      #{order.orderNumber}
                    </div>
                    <div className="flex gap-1.5 text-[11px] md:text-sm lg:text-base text-gray-400 mt-0.5">
                      <span>{order.customerUsername}</span>
                      <span>•</span>
                      <span>{new Date(order.orderDate).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <span className="text-lego-green font-mono font-medium text-xs md:text-base lg:text-lg ml-2 flex-shrink-0">${Number(order.orderTotal || 0).toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[11px] md:text-sm lg:text-base text-gray-500 italic">No recent sales</div>
          )}
        </div>
      </div>
    </div>
  );
}

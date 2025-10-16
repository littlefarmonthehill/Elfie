import MetricCard from "./MetricCard";
import { useQuery } from "@tanstack/react-query";
import { TrendingDown, AlertCircle, TrendingUp, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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

interface PricingInsight {
  inventoryId: number;
  itemNo: string;
  itemName: string | null;
  itemType: string;
  colorName: string | null;
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
}

export default function GeneralDashboard({ onItemClick }: GeneralDashboardProps) {
  // Fetch dashboard stats (all-time)
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['/api/dashboard/stats'],
    queryFn: async () => {
      const response = await fetch('/api/dashboard/stats');
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    }
  });

  // Fetch pending orders (actionable items, all-time)
  const { data: pendingOrders = [] } = useQuery<Order[]>({
    queryKey: ['/api/orders', 'pending'],
    queryFn: async () => {
      const response = await fetch('/api/orders');
      if (!response.ok) throw new Error('Failed to fetch orders');
      return response.json();
    },
    select: (data: Order[]) => 
      data.filter(order => 
        order.orderStatus === 'awaiting_payment' || 
        order.orderStatus === 'awaiting_shipment'
      ).slice(0, 5)
  });

  // Fetch pricing opportunities (items priced too low)
  const { data: pricingInsights } = useQuery<{ success: boolean; data: InsightsData }>({
    queryKey: ['/api/priceomatic/insights'],
  });

  // Get top pricing opportunities (items priced too low, sorted by variance)
  const pricingOpportunities = pricingInsights?.data?.tooLow
    ?.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
    ?.slice(0, 5) || [];

  // Fetch recent high-value orders (all-time)
  const { data: recentSales = [] } = useQuery<Order[]>({
    queryKey: ['/api/orders', 'recent-sales'],
    queryFn: async () => {
      const response = await fetch('/api/orders');
      if (!response.ok) throw new Error('Failed to fetch orders');
      return response.json();
    },
    select: (data: Order[]) => 
      data
        .filter(order => order.orderTotal && !isNaN(Number(order.orderTotal)))
        .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())
        .slice(0, 5)
  });

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
        {/* Action Items - Pending Orders */}
        <div className="bg-gray-900/50 border border-orange-500/20 rounded-lg p-2 md:p-4 lg:p-5" data-testid="section-action-items">
          <div className="flex items-center gap-1.5 md:gap-2 lg:gap-2.5 mb-2 md:mb-3 lg:mb-4">
            <AlertCircle className="w-3 h-3 md:w-4 md:h-4 lg:w-5 lg:h-5 text-orange-400" />
            <h3 className="text-[10px] md:text-xs lg:text-sm font-semibold text-orange-400 uppercase tracking-wide">Action Items - Orders to Fulfill</h3>
          </div>
          <div className="space-y-1.5">
            {pendingOrders.length > 0 ? (
              pendingOrders.map((order) => (
                <div 
                  key={order.id} 
                  onClick={() => onItemClick?.('order', order.id)}
                  className="flex justify-between items-center text-[10px] hover-elevate rounded px-2 py-1 cursor-pointer"
                  data-testid={`action-order-${order.id}`}
                >
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="w-3 h-3 text-orange-400" />
                    <span className="text-gray-300 font-mono">#{order.orderNumber}</span>
                    <span className="text-gray-500 text-[9px]">{order.customerUsername}</span>
                  </div>
                  <span className="text-lego-green font-mono">${Number(order.orderTotal || 0).toFixed(2)}</span>
                </div>
              ))
            ) : (
              <div className="text-[9px] text-gray-500 italic">No pending orders</div>
            )}
          </div>
        </div>

        {/* Top Pricing Opportunities */}
        <div className="bg-gray-900/50 border border-purple-500/20 rounded-lg p-2 md:p-4 lg:p-5" data-testid="section-pricing-opportunities">
          <div className="flex items-center gap-1.5 md:gap-2 lg:gap-2.5 mb-2 md:mb-3 lg:mb-4">
            <TrendingDown className="w-3 h-3 md:w-4 md:h-4 lg:w-5 lg:h-5 text-purple-400" />
            <h3 className="text-[10px] md:text-xs lg:text-sm font-semibold text-purple-400 uppercase tracking-wide">Top Pricing Opportunities</h3>
          </div>
          <div className="space-y-1.5">
            {pricingOpportunities.length > 0 ? (
              pricingOpportunities.map((item) => (
                <div 
                  key={item.inventoryId} 
                  onClick={() => onItemClick?.('inventory', item.inventoryId)}
                  className="flex justify-between items-start text-[10px] hover-elevate rounded px-2 py-1 cursor-pointer"
                  data-testid={`pricing-item-${item.inventoryId}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <TrendingDown className="w-3 h-3 text-purple-400 flex-shrink-0" />
                      <span className="text-gray-400 font-mono flex-shrink-0">{item.itemNo}</span>
                      {item.itemName && (
                        <span className="text-white text-[10px] truncate">{item.itemName}</span>
                      )}
                    </div>
                    {item.colorName && (
                      <div className="ml-5">
                        <Badge variant="outline" className="text-[8px] px-1 py-0">
                          {item.colorName}
                        </Badge>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                    <span className="text-gray-500 font-mono text-[9px]">{formatCurrency(item.currentPrice)}</span>
                    <span className="text-orange-400 font-mono text-[9px] font-bold">{item.variance}%</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-[9px] text-gray-500 italic">Run Price-o-Matic to see opportunities</div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity - High Value Sales */}
      <div className="bg-gray-900/50 border border-green-500/20 rounded-lg p-4" data-testid="section-recent-activity">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-green-400" />
          <h3 className="text-[10px] font-semibold text-green-400 uppercase tracking-wide">Recent Activity - Latest Sales</h3>
        </div>
        <div className="space-y-1.5">
          {recentSales.length > 0 ? (
            recentSales.map((order) => (
              <div 
                key={order.id} 
                onClick={() => onItemClick?.('order', order.id)}
                className="flex justify-between items-start text-[10px] hover-elevate rounded px-2 py-1 cursor-pointer"
                data-testid={`activity-order-${order.id}`}
              >
                <div className="flex gap-1.5 flex-1 min-w-0">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${
                    order.orderStatus === 'shipped' ? 'bg-green-400' : 
                    order.orderStatus === 'awaiting_shipment' ? 'bg-orange-400' : 
                    'bg-gray-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-300 font-mono text-[10px] font-medium">
                      #{order.orderNumber}
                    </div>
                    <div className="flex gap-1.5 text-[9px] text-gray-500 mt-0.5">
                      <span>{order.customerUsername}</span>
                      <span>•</span>
                      <span>{new Date(order.orderDate).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <span className="text-lego-green font-mono ml-2 flex-shrink-0">${Number(order.orderTotal || 0).toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[9px] text-gray-500 italic">No recent sales</div>
          )}
        </div>
      </div>
    </div>
  );
}

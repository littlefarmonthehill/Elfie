import MetricCard from "./MetricCard";
import { useQuery } from "@tanstack/react-query";
import { Package, AlertCircle, TrendingUp, ShoppingCart } from "lucide-react";
import { DateRangeValue } from "./DateRangeSelector";

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

interface GeneralDashboardProps {
  dateRange?: DateRangeValue;
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
}

export default function GeneralDashboard({ dateRange = 'all', onItemClick }: GeneralDashboardProps) {
  // Build query URL with date range parameter
  const buildQueryUrl = (baseUrl: string) => {
    if (dateRange === 'all') return baseUrl;
    return `${baseUrl}?range=${dateRange}`;
  };

  // Fetch dashboard stats with date range
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['/api/dashboard/stats', dateRange],
    queryFn: async () => {
      const response = await fetch(buildQueryUrl('/api/dashboard/stats'));
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    }
  });

  // Fetch pending orders (actionable items) with date range
  const { data: pendingOrders = [] } = useQuery<Order[]>({
    queryKey: ['/api/orders', dateRange, 'pending'],
    queryFn: async () => {
      const response = await fetch(buildQueryUrl('/api/orders'));
      if (!response.ok) throw new Error('Failed to fetch orders');
      return response.json();
    },
    select: (data: Order[]) => 
      data.filter(order => 
        order.orderStatus === 'awaiting_payment' || 
        order.orderStatus === 'awaiting_shipment'
      ).slice(0, 5)
  });

  // Fetch low stock items (critical alerts)
  const { data: lowStockItems = [] } = useQuery<InventoryItem[]>({
    queryKey: ['/api/inventory', 'low-stock'],
    select: (data: InventoryItem[]) => 
      data.filter(item => item.quantity > 0 && item.quantity < 10).slice(0, 5)
  });

  // Fetch recent high-value orders with date range
  const { data: recentSales = [] } = useQuery<Order[]>({
    queryKey: ['/api/orders', dateRange, 'recent-sales'],
    queryFn: async () => {
      const response = await fetch(buildQueryUrl('/api/orders'));
      if (!response.ok) throw new Error('Failed to fetch orders');
      return response.json();
    },
    select: (data: Order[]) => 
      data
        .filter(order => order.orderTotal && !isNaN(Number(order.orderTotal)))
        .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())
        .slice(0, 5)
  });

  return (
    <div className="p-4 space-y-4 bg-gradient-to-br from-lego-red/5 to-transparent rounded-lg border border-lego-red/10 shadow-[0_0_15px_rgba(239,68,68,0.1)]">
      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
        <MetricCard 
          label="Inventory Items" 
          value={stats?.totalInventoryItems.toLocaleString() || '0'} 
          color="red" 
          data-testid="metric-inventory-items"
        />
        <MetricCard 
          label="Total Pieces" 
          value={stats?.totalInventoryQuantity.toLocaleString() || '0'} 
          color="yellow" 
          data-testid="metric-total-pieces"
        />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {/* Action Items - Pending Orders */}
        <div className="bg-gray-900/50 border border-orange-500/20 rounded-lg p-4" data-testid="section-action-items">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-orange-400" />
            <h3 className="text-[10px] font-semibold text-orange-400 uppercase tracking-wide">Action Items - Orders to Fulfill</h3>
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

        {/* Critical Alerts - Low Stock */}
        <div className="bg-gray-900/50 border border-red-500/20 rounded-lg p-4" data-testid="section-critical-alerts">
          <div className="flex items-center gap-2 mb-3">
            <Package className="w-4 h-4 text-red-400" />
            <h3 className="text-[10px] font-semibold text-red-400 uppercase tracking-wide">Critical Alerts - Low Stock</h3>
          </div>
          <div className="space-y-1.5">
            {lowStockItems.length > 0 ? (
              lowStockItems.map((item) => (
                <div 
                  key={item.id} 
                  onClick={() => onItemClick?.('inventory', item.id)}
                  className="flex justify-between items-center text-[10px] hover-elevate rounded px-2 py-1 cursor-pointer"
                  data-testid={`alert-item-${item.id}`}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                    <span className="text-gray-400 font-mono flex-shrink-0">{item.item.no}</span>
                    <span className="text-gray-500 text-[9px] truncate">{item.colorName}</span>
                  </div>
                  <span className="text-red-400 font-mono text-[9px] ml-2 flex-shrink-0">Qty: {item.quantity}</span>
                </div>
              ))
            ) : (
              <div className="text-[9px] text-gray-500 italic">No low stock items</div>
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
                className="flex justify-between items-center text-[10px] hover-elevate rounded px-2 py-1 cursor-pointer"
                data-testid={`activity-order-${order.id}`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    order.orderStatus === 'shipped' ? 'bg-green-400' : 
                    order.orderStatus === 'awaiting_shipment' ? 'bg-orange-400' : 
                    'bg-gray-400'
                  }`} />
                  <span className="text-gray-300 font-mono">#{order.orderNumber}</span>
                  <span className="text-gray-500 text-[9px]">{order.customerUsername}</span>
                  <span className="text-gray-600 text-[9px]">{new Date(order.orderDate).toLocaleDateString()}</span>
                </div>
                <span className="text-lego-green font-mono">${Number(order.orderTotal || 0).toFixed(2)}</span>
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

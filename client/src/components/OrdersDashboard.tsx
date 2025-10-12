import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format, subDays, startOfDay } from "date-fns";
import { AlertCircle, ShoppingCart, TrendingUp, Package } from "lucide-react";
import { DateRangeValue } from "./DateRangeSelector";

interface Order {
  id: string;
  orderNumber: string;
  orderDate: string;
  orderStatus: string;
  orderTotal: string;
  customerUsername: string;
  items: any[];
}

interface OrdersDashboardProps {
  dateRange?: DateRangeValue;
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
}

export default function OrdersDashboard({ dateRange = 'all', onItemClick }: OrdersDashboardProps) {
  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ['/api/orders', dateRange],
    queryFn: async () => {
      const url = dateRange === 'all' ? '/api/orders' : `/api/orders?range=${dateRange}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch orders');
      return response.json();
    }
  });

  // Process orders into trend data based on date range
  const getTrendData = () => {
    if (orders.length === 0) {
      return [];
    }

    // Find the most recent order date to base the chart on
    const mostRecentOrderDate = orders.reduce((latest, order) => {
      const orderDate = new Date(order.orderDate);
      return orderDate > latest ? orderDate : latest;
    }, new Date(orders[0].orderDate));

    // Determine number of days to show based on date range
    const daysToShow = dateRange === '2years' ? 60 :  // Show ~2 months of days for 2 years
                      dateRange === '1year' ? 30 :     // Show 1 month of days for 1 year
                      dateRange === '6months' ? 30 :   // Show 1 month of days for 6 months
                      dateRange === '3months' ? 30 :   // Show 1 month of days for 3 months
                      30;  // Default to 30 days for 'all'

    // Create array of days ending at the most recent order date
    const days = Array.from({ length: daysToShow }, (_, i) => {
      const date = subDays(mostRecentOrderDate, daysToShow - 1 - i);
      return {
        date: format(date, 'MMM d'),  // Format like "Jan 15"
        fullDate: startOfDay(date),
        bricklink: 0,
        brickowl: 0,
        other: 0,
      };
    });

    // Aggregate orders into days
    orders.forEach(order => {
      const orderDate = startOfDay(new Date(order.orderDate));
      const dayData = days.find(day => 
        orderDate.getTime() === day.fullDate.getTime()
      );
      
      if (dayData) {
        if (order.orderNumber.toLowerCase().includes('bl') || 
            order.orderNumber.toLowerCase().includes('bricklink')) {
          dayData.bricklink++;
        } else if (order.orderNumber.toLowerCase().includes('bo') || 
                   order.orderNumber.toLowerCase().includes('brickowl')) {
          dayData.brickowl++;
        } else {
          dayData.other++;
        }
      }
    });

    return days.map(({ date, bricklink, brickowl, other }) => ({
      date,
      bricklink,
      brickowl,
      other,
    }));
  };

  // Get today's total
  const getTodayTotal = () => {
    const today = startOfDay(new Date());
    return orders.filter(order => {
      const orderDate = startOfDay(new Date(order.orderDate));
      return orderDate.getTime() === today.getTime();
    }).length;
  };

  // Get pending orders (action items)
  const pendingOrders = orders
    .filter(order => 
      order.orderStatus === 'awaiting_payment' || 
      order.orderStatus === 'awaiting_shipment'
    )
    .slice(0, 5);

  // Get recently shipped orders (recent activity)
  const recentShipments = orders
    .filter(order => order.orderStatus === 'shipped')
    .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())
    .slice(0, 5);

  // Get high value orders (highlights)
  const highValueOrders = orders
    .filter(order => order.orderTotal && !isNaN(Number(order.orderTotal)))
    .sort((a, b) => Number(b.orderTotal) - Number(a.orderTotal))
    .slice(0, 5);

  const trendData = getTrendData();
  const todayTotal = getTodayTotal();

  if (isLoading) {
    return (
      <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-orange/5 to-transparent rounded-lg border border-lego-orange/10 shadow-[0_0_15px_rgba(251,146,60,0.1)]">
        <div className="bg-gray-900/50 border border-lego-orange/20 rounded-lg p-2">
          <div className="text-xs text-gray-400 animate-pulse">Loading orders...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-orange/5 to-transparent rounded-lg border border-lego-orange/10 shadow-[0_0_15px_rgba(251,146,60,0.1)]">
      {/* Chart */}
      <div className="bg-gray-900/50 border border-lego-orange/20 rounded-lg p-2">
        <div className="mb-1 text-xs text-gray-400">
          Today's Total: <span className="text-lego-orange font-mono font-semibold">{todayTotal} orders</span>
          <span className="ml-2 text-gray-500">({orders.length} total)</span>
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="date" stroke="#9CA3AF" style={{ fontSize: '10px' }} />
            <YAxis stroke="#9CA3AF" style={{ fontSize: '10px' }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '6px', fontSize: '12px' }}
              labelStyle={{ color: '#D1D5DB' }}
            />
            <Line type="monotone" dataKey="bricklink" stroke="hsl(25 95% 55%)" strokeWidth={2} name="BrickLink" />
            <Line type="monotone" dataKey="brickowl" stroke="hsl(25 70% 45%)" strokeWidth={2} name="BrickOwl" />
            <Line type="monotone" dataKey="other" stroke="hsl(25 50% 35%)" strokeWidth={2} name="Other" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Action Items - Pending Orders */}
      <div className="bg-gray-900/50 border border-orange-500/20 rounded-lg p-3" data-testid="section-pending-orders">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="w-3.5 h-3.5 text-orange-400" />
          <h3 className="text-[10px] font-semibold text-orange-400 uppercase tracking-wide">Action Items - Pending Orders</h3>
        </div>
        <div className="space-y-1">
          {pendingOrders.length > 0 ? (
            pendingOrders.map((order) => (
              <div 
                key={order.id} 
                onClick={() => onItemClick?.('order', order.id)}
                className="flex justify-between items-center text-[10px] hover-elevate rounded px-2 py-0.5 cursor-pointer"
                data-testid={`pending-order-${order.id}`}
              >
                <div className="flex items-center gap-1.5">
                  <ShoppingCart className="w-3 h-3 text-orange-400 flex-shrink-0" />
                  <span className="text-gray-300 font-mono">#{order.orderNumber}</span>
                  <span className="text-gray-500 text-[9px]">{order.customerUsername}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                    order.orderStatus === 'awaiting_payment' ? 'bg-red-500/20 text-red-400' : 'bg-orange-500/20 text-orange-400'
                  }`}>
                    {order.orderStatus.replace('_', ' ')}
                  </span>
                </div>
                <span className="text-lego-green font-mono ml-2">${Number(order.orderTotal || 0).toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[9px] text-gray-500 italic">No pending orders</div>
          )}
        </div>
      </div>

      {/* Recent Activity - Shipments */}
      <div className="bg-gray-900/50 border border-blue-500/20 rounded-lg p-3" data-testid="section-recent-shipments">
        <div className="flex items-center gap-2 mb-2">
          <Package className="w-3.5 h-3.5 text-blue-400" />
          <h3 className="text-[10px] font-semibold text-blue-400 uppercase tracking-wide">Recent Activity - Shipped Orders</h3>
        </div>
        <div className="space-y-1">
          {recentShipments.length > 0 ? (
            recentShipments.map((order) => (
              <div 
                key={order.id} 
                onClick={() => onItemClick?.('order', order.id)}
                className="flex justify-between items-center text-[10px] hover-elevate rounded px-2 py-0.5 cursor-pointer"
                data-testid={`shipped-order-${order.id}`}
              >
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                  <span className="text-gray-300 font-mono">#{order.orderNumber}</span>
                  <span className="text-gray-500 text-[9px]">{order.customerUsername}</span>
                  <span className="text-gray-600 text-[9px]">{new Date(order.orderDate).toLocaleDateString()}</span>
                </div>
                <span className="text-lego-green font-mono ml-2">${Number(order.orderTotal || 0).toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[9px] text-gray-500 italic">No recent shipments</div>
          )}
        </div>
      </div>

      {/* Highlights - High Value Orders */}
      <div className="bg-gray-900/50 border border-green-500/20 rounded-lg p-3" data-testid="section-high-value-orders">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-3.5 h-3.5 text-green-400" />
          <h3 className="text-[10px] font-semibold text-green-400 uppercase tracking-wide">Highlights - Top Value Orders</h3>
        </div>
        <div className="space-y-1">
          {highValueOrders.length > 0 ? (
            highValueOrders.map((order) => (
              <div 
                key={order.id} 
                onClick={() => onItemClick?.('order', order.id)}
                className="flex justify-between items-center text-[10px] hover-elevate rounded px-2 py-0.5 cursor-pointer"
                data-testid={`high-value-order-${order.id}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-300 font-mono">#{order.orderNumber}</span>
                  <span className="text-gray-500 text-[9px]">{order.customerUsername}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                    order.orderStatus === 'shipped' ? 'bg-green-500/20 text-green-400' : 
                    order.orderStatus === 'awaiting_shipment' ? 'bg-orange-500/20 text-orange-400' : 
                    'bg-gray-500/20 text-gray-400'
                  }`}>
                    {order.orderStatus.replace('_', ' ')}
                  </span>
                </div>
                <span className="text-lego-green font-mono text-xs ml-2">${Number(order.orderTotal).toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[9px] text-gray-500 italic">No orders to display</div>
          )}
        </div>
      </div>
    </div>
  );
}

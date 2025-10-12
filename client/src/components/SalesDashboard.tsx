import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format, subMonths, startOfMonth, parseISO } from "date-fns";
import { TrendingUp, DollarSign, Target, Store, ShoppingCart } from "lucide-react";
import { DateRangeValue } from "./DateRangeSelector";
import PlatformPerformance from "./PlatformPerformance";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type TimePeriod = 'mtd' | 'ytd' | '1y' | '5y';

interface SalesDashboardProps {
  period: TimePeriod;
  dateRange?: DateRangeValue;
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
}

interface Order {
  id: string;
  orderNumber: string;
  marketplace: string | null;
  orderDate: string;
  orderStatus: string;
  orderTotal: string;
  customerUsername: string;
}

export default function SalesDashboard({ period, dateRange = 'all', onItemClick }: SalesDashboardProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ['/api/orders', dateRange],
    queryFn: async () => {
      const url = dateRange === 'all' ? '/api/orders' : `/api/orders?range=${dateRange}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch orders');
      return response.json();
    }
  });

  // Calculate sales data by month - adjust based on date range
  const getSalesData = () => {
    if (orders.length === 0) {
      return [];
    }

    let months: Array<{ date: string; month: Date; sales: number }>;
    
    if (dateRange === 'all') {
      // For 'all time', use the actual earliest to latest order dates
      const orderDates = orders
        .map(o => parseISO(o.orderDate))
        .filter(d => !isNaN(d.getTime())); // Filter out invalid dates
      
      if (orderDates.length === 0) {
        return [];
      }
      
      const earliestOrderDate = new Date(Math.min(...orderDates.map(d => d.getTime())));
      const latestOrderDate = new Date(Math.max(...orderDates.map(d => d.getTime())));
      
      // Validate dates
      if (isNaN(earliestOrderDate.getTime()) || isNaN(latestOrderDate.getTime())) {
        return [];
      }
      
      // Start from the earliest order's month
      const earliestMonth = startOfMonth(earliestOrderDate);
      const latestMonth = startOfMonth(latestOrderDate);
      
      // Calculate months between earliest and latest
      const monthDiff = (latestMonth.getFullYear() - earliestMonth.getFullYear()) * 12 + 
                        (latestMonth.getMonth() - earliestMonth.getMonth()) + 1;
      
      // If history is too long (>10 years/120 months), show only the most recent 120 months
      let startMonth: Date;
      let monthCount: number;
      
      if (monthDiff > 120) {
        // Start from 120 months before the latest month
        startMonth = new Date(latestMonth);
        startMonth.setMonth(latestMonth.getMonth() - 119); // -119 because we include the latest month
        monthCount = 120;
      } else {
        // Show full history
        startMonth = earliestMonth;
        monthCount = Math.max(monthDiff, 1);
      }
      
      // Generate months from start to latest
      months = Array.from({ length: monthCount }, (_, i) => {
        const monthDate = new Date(startMonth);
        monthDate.setMonth(startMonth.getMonth() + i);
        return {
          date: format(monthDate, 'MMM yy'),
          month: startOfMonth(monthDate),
          sales: 0,
        };
      });
    } else {
      // For specific date ranges, use predefined periods from current date
      const monthsToShow = dateRange === '2years' ? 24 :
                          dateRange === '1year' ? 12 :
                          dateRange === '6months' ? 6 : 3;
      
      months = Array.from({ length: monthsToShow }, (_, i) => {
        const date = subMonths(new Date(), monthsToShow - 1 - i);
        return {
          date: format(date, 'MMM yy'),
          month: startOfMonth(date),
          sales: 0,
        };
      });
    }

    // Aggregate orders into months
    orders.forEach(order => {
      if (order.orderTotal && !isNaN(Number(order.orderTotal))) {
        const orderMonth = startOfMonth(parseISO(order.orderDate));
        const monthData = months.find(m => m.month.getTime() === orderMonth.getTime());
        if (monthData) {
          monthData.sales += Number(order.orderTotal);
        }
      }
    });

    return months.map(({ date, sales }) => ({
      date,
      sales: Math.round(sales),
    }));
  };

  // Get top revenue orders
  const topRevenueOrders = orders
    .filter(order => order.orderTotal && !isNaN(Number(order.orderTotal)))
    .sort((a, b) => Number(b.orderTotal) - Number(a.orderTotal))
    .slice(0, 5);

  // Get recent high-value sales
  const recentHighValueSales = orders
    .filter(order => order.orderTotal && Number(order.orderTotal) >= 50)
    .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())
    .slice(0, 5);

  // Calculate total revenue and average
  const totalRevenue = orders.reduce((sum, order) => 
    sum + (order.orderTotal && !isNaN(Number(order.orderTotal)) ? Number(order.orderTotal) : 0), 0
  );
  const averageOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;

  const data = getSalesData();
  const average = data.length > 0 ? Math.round(data.reduce((sum, d) => sum + d.sales, 0) / data.length) : 0;

  // Get unique platforms from orders
  const platforms = Array.from(new Set(orders.map(o => o.marketplace || 'Unknown'))).sort();
  
  // Filter orders by selected platform
  const platformOrders = selectedPlatform === 'all' 
    ? orders 
    : orders.filter(o => (o.marketplace || 'Unknown') === selectedPlatform);

  if (isLoading) {
    return (
      <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-green/5 to-transparent rounded-lg border border-lego-green/10 shadow-[0_0_15px_rgba(34,197,94,0.1)]">
        <div className="bg-gray-900/50 border border-lego-green/20 rounded-lg p-2">
          <div className="text-xs text-gray-400 animate-pulse">Loading sales data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-green/5 to-transparent rounded-lg border border-lego-green/10 shadow-[0_0_15px_rgba(34,197,94,0.1)]">
      {/* Chart */}
      <div className="bg-gray-900/50 border border-lego-green/20 rounded-lg p-2">
        <div className="mb-1 text-xs text-gray-400">
          Average: <span className="text-lego-green font-mono font-semibold">${average.toLocaleString()}</span>
          <span className="ml-2 text-gray-500">Total Revenue: ${Math.round(totalRevenue).toLocaleString()}</span>
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="date" stroke="#9CA3AF" style={{ fontSize: '10px' }} />
            <YAxis stroke="#9CA3AF" style={{ fontSize: '10px' }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '6px', fontSize: '12px' }}
              labelStyle={{ color: '#D1D5DB' }}
            />
            <Line type="monotone" dataKey="sales" stroke="hsl(140 70% 50%)" strokeWidth={2} dot={{ fill: 'hsl(140 70% 50%)', r: 1 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Highlights - Top Revenue Orders */}
      <div className="bg-gray-900/50 border border-green-500/20 rounded-lg p-3" data-testid="section-top-revenue">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-3.5 h-3.5 text-green-400" />
          <h3 className="text-[10px] font-semibold text-green-400 uppercase tracking-wide">Highlights - Top Revenue Orders</h3>
        </div>
        <div className="space-y-1">
          {topRevenueOrders.length > 0 ? (
            topRevenueOrders.map((order) => (
              <div 
                key={order.id} 
                onClick={() => onItemClick?.('order', order.id)}
                className="flex justify-between items-center text-[10px] hover-elevate rounded px-2 py-0.5 cursor-pointer"
                data-testid={`top-revenue-${order.id}`}
              >
                <div className="flex items-center gap-1.5">
                  <DollarSign className="w-3 h-3 text-green-400 flex-shrink-0" />
                  <span className="text-gray-300 font-mono">#{order.orderNumber}</span>
                  <span className="text-gray-500 text-[9px]">{order.customerUsername}</span>
                </div>
                <span className="text-lego-green font-mono text-xs ml-2">${Number(order.orderTotal).toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[9px] text-gray-500 italic">No revenue data available</div>
          )}
        </div>
      </div>

      {/* Recent Activity - High Value Sales */}
      <div className="bg-gray-900/50 border border-blue-500/20 rounded-lg p-3" data-testid="section-recent-high-value">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-3.5 h-3.5 text-blue-400" />
          <h3 className="text-[10px] font-semibold text-blue-400 uppercase tracking-wide">Recent Activity - High Value Sales ($50+)</h3>
        </div>
        <div className="space-y-1">
          {recentHighValueSales.length > 0 ? (
            recentHighValueSales.map((order) => (
              <div 
                key={order.id} 
                onClick={() => onItemClick?.('order', order.id)}
                className="flex justify-between items-center text-[10px] hover-elevate rounded px-2 py-0.5 cursor-pointer"
                data-testid={`high-value-sale-${order.id}`}
              >
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                  <span className="text-gray-300 font-mono">#{order.orderNumber}</span>
                  <span className="text-gray-500 text-[9px]">{order.customerUsername}</span>
                  <span className="text-gray-600 text-[9px]">{new Date(order.orderDate).toLocaleDateString()}</span>
                </div>
                <span className="text-lego-green font-mono ml-2">${Number(order.orderTotal).toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[9px] text-gray-500 italic">No high value sales</div>
          )}
        </div>
      </div>

      {/* Action Items - Sales Metrics */}
      <div className="bg-gray-900/50 border border-yellow-500/20 rounded-lg p-3" data-testid="section-sales-metrics">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-3.5 h-3.5 text-yellow-400" />
          <h3 className="text-[10px] font-semibold text-yellow-400 uppercase tracking-wide">Key Metrics</h3>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <div className="text-[9px] text-gray-500">Total Orders</div>
            <div className="text-xs text-gray-300 font-mono">{orders.length}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-gray-500">Avg Order Value</div>
            <div className="text-xs text-lego-green font-mono">${averageOrderValue.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-gray-500">Total Revenue</div>
            <div className="text-xs text-lego-green font-mono">${Math.round(totalRevenue).toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Platform Performance */}
      <div className="bg-gray-900/50 border border-blue-500/20 rounded-lg p-3" data-testid="section-platform-performance">
        <PlatformPerformance orders={orders} />
      </div>

      {/* Platform Order Browser */}
      <div className="bg-gray-900/50 border border-purple-500/20 rounded-lg p-3" data-testid="section-platform-orders">
        <div className="flex items-center gap-2 mb-3">
          <ShoppingCart className="w-3.5 h-3.5 text-purple-400" />
          <h3 className="text-[10px] font-semibold text-purple-400 uppercase tracking-wide">Orders by Platform</h3>
        </div>
        
        {/* Platform Selector */}
        <div className="mb-3">
          <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
            <SelectTrigger className="w-full text-xs" data-testid="select-platform">
              <SelectValue placeholder="Select platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Platforms</SelectItem>
              {platforms.map(platform => (
                <SelectItem key={platform} value={platform}>{platform}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Order List */}
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {platformOrders.length > 0 ? (
            [...platformOrders]
              .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())
              .map(order => (
                <div
                  key={order.id}
                  onClick={() => onItemClick?.('order', order.id)}
                  className="flex justify-between items-start p-2 rounded hover-elevate active-elevate-2 cursor-pointer border border-transparent hover:border-purple-500/30"
                  data-testid={`platform-order-${order.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono text-white">#{order.orderNumber}</span>
                      {order.marketplace && (
                        <span className="text-[9px] text-gray-400">{order.marketplace}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[9px] text-gray-400">
                      <span>{order.customerUsername}</span>
                      <span className="text-gray-600">•</span>
                      <span>{new Date(order.orderDate).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <div className="text-xs font-mono text-green-400">${Number(order.orderTotal).toFixed(2)}</div>
                    <div className="text-[8px] text-gray-500">{order.orderStatus}</div>
                  </div>
                </div>
              ))
          ) : (
            <div className="text-center py-4 text-xs text-gray-500">
              No orders for {selectedPlatform === 'all' ? 'any platform' : selectedPlatform}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

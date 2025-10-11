import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format, subMonths, startOfMonth, parseISO } from "date-fns";
import { TrendingUp, DollarSign, Target } from "lucide-react";
import { DateRangeValue } from "./DateRangeSelector";

type TimePeriod = 'mtd' | 'ytd' | '1y' | '5y';

interface SalesDashboardProps {
  period: TimePeriod;
  dateRange?: DateRangeValue;
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
}

interface Order {
  id: string;
  orderNumber: string;
  orderDate: string;
  orderStatus: string;
  orderTotal: string;
  customerUsername: string;
}

export default function SalesDashboard({ period, dateRange = 'all', onItemClick }: SalesDashboardProps) {
  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ['/api/orders', dateRange],
    queryFn: async () => {
      const url = dateRange === 'all' ? '/api/orders' : `/api/orders?range=${dateRange}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch orders');
      return response.json();
    }
  });

  // Calculate sales data by month - show most recent 6 months
  const getSalesData = () => {
    const months = Array.from({ length: 6 }, (_, i) => {
      const date = subMonths(new Date(), 5 - i);
      return {
        date: format(date, 'MMM'),
        month: startOfMonth(date),
        sales: 0,
      };
    });

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
            <Line type="monotone" dataKey="sales" stroke="hsl(140 70% 50%)" strokeWidth={2} dot={{ fill: 'hsl(140 70% 50%)' }} />
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
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format, subDays, startOfDay, isAfter, isBefore } from "date-fns";

interface Order {
  id: string;
  orderNumber: string;
  orderDate: string;
  orderStatus: string;
  orderTotal: string;
  items: any[];
}

export default function OrdersDashboard() {
  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ['/api/orders'],
  });

  // Process orders into 7-day trend data
  const getTrendData = () => {
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = subDays(new Date(), 6 - i);
      return {
        date: format(date, 'EEE'), // Mon, Tue, Wed, etc.
        fullDate: startOfDay(date),
        bricklink: 0,
        brickowl: 0,
        other: 0,
      };
    });

    // Count orders by day and source
    orders.forEach(order => {
      const orderDate = startOfDay(new Date(order.orderDate));
      const dayData = last7Days.find(day => 
        orderDate.getTime() === day.fullDate.getTime()
      );
      
      if (dayData) {
        // Categorize by order number prefix or source
        // ShipStation orders typically have numeric order numbers
        // BrickLink orders often start with specific prefixes
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

    return last7Days.map(({ date, bricklink, brickowl, other }) => ({
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
    </div>
  );
}

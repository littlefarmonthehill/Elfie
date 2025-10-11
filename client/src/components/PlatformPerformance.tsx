import { Store, TrendingUp, ShoppingBag, DollarSign } from "lucide-react";
import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface Order {
  id: string;
  orderNumber: string;
  marketplace: string | null;
  orderDate: string;
  orderTotal: string;
  orderStatus: string;
}

interface PlatformPerformanceProps {
  orders: Order[];
}

const PLATFORM_COLORS: Record<string, string> = {
  'BrickLink': '#FF8C00',
  'eBay': '#E53238',
  'Amazon': '#FF9900',
  'Etsy': '#F1641E',
  'Facebook': '#1877F2',
  'Unknown': '#6B7280',
  'Other': '#9CA3AF',
};

export default function PlatformPerformance({ orders }: PlatformPerformanceProps) {
  // Group orders by marketplace and calculate metrics
  const platformData = orders.reduce((acc, order) => {
    const marketplace = order.marketplace || 'Unknown';
    if (!acc[marketplace]) {
      acc[marketplace] = {
        name: marketplace,
        orders: 0,
        revenue: 0,
        avgOrderValue: 0,
      };
    }
    acc[marketplace].orders += 1;
    acc[marketplace].revenue += Number(order.orderTotal) || 0;
    return acc;
  }, {} as Record<string, { name: string; orders: number; revenue: number; avgOrderValue: number }>);

  // Calculate average order values
  Object.values(platformData).forEach(platform => {
    platform.avgOrderValue = platform.orders > 0 ? platform.revenue / platform.orders : 0;
  });

  // Convert to array and sort by revenue
  const platformArray = Object.values(platformData)
    .sort((a, b) => b.revenue - a.revenue);

  // Get total metrics
  const totalOrders = platformArray.reduce((sum, p) => sum + p.orders, 0);
  const totalRevenue = platformArray.reduce((sum, p) => sum + p.revenue, 0);

  // Prepare chart data
  const chartData = platformArray.map(platform => ({
    name: platform.name,
    revenue: Math.round(platform.revenue),
    orders: platform.orders,
  }));

  if (platformArray.length === 0) {
    return (
      <Card className="bg-gray-800/30 border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Store className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-bold text-gray-300">PLATFORM PERFORMANCE</h3>
        </div>
        <p className="text-xs text-gray-400">No marketplace data available for this period.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Store className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-bold text-gray-300">PLATFORM PERFORMANCE</h3>
      </div>

      {/* Chart */}
      <Card className="bg-gray-800/30 border-gray-700 p-3">
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="name" 
                stroke="#9CA3AF"
                tick={{ fill: '#9CA3AF', fontSize: 10 }}
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis 
                stroke="#9CA3AF"
                tick={{ fill: '#9CA3AF', fontSize: 10 }}
                tickFormatter={(value) => `$${value}`}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1F2937', 
                  border: '1px solid #374151',
                  borderRadius: '6px',
                  fontSize: '11px'
                }}
                formatter={(value: number, name: string) => {
                  if (name === 'revenue') return [`$${value.toFixed(2)}`, 'Revenue'];
                  return [value, 'Orders'];
                }}
              />
              <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={PLATFORM_COLORS[entry.name] || PLATFORM_COLORS['Other']} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Platform Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {platformArray.map((platform) => {
          const revenuePercentage = totalRevenue > 0 ? (platform.revenue / totalRevenue) * 100 : 0;
          const orderPercentage = totalOrders > 0 ? (platform.orders / totalOrders) * 100 : 0;
          const color = PLATFORM_COLORS[platform.name] || PLATFORM_COLORS['Other'];

          return (
            <Card 
              key={platform.name}
              className="bg-gray-800/50 border-gray-700 p-2.5 hover-elevate"
              data-testid={`platform-${platform.name.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div 
                  className="w-2 h-2 rounded-full" 
                  style={{ backgroundColor: color }}
                />
                <p className="text-xs font-bold text-gray-300">{platform.name}</p>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1">
                    <DollarSign className="h-3 w-3 text-green-400" />
                    <span className="text-[10px] text-gray-400">Revenue:</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-white">
                    ${platform.revenue.toFixed(2)}
                  </span>
                </div>
                <div className="w-full bg-gray-900 rounded-full h-1">
                  <div 
                    className="h-1 rounded-full transition-all"
                    style={{ 
                      width: `${revenuePercentage}%`,
                      backgroundColor: color 
                    }}
                  />
                </div>

                <div className="flex justify-between items-center text-[9px] text-gray-500">
                  <span>{platform.orders} orders ({orderPercentage.toFixed(1)}%)</span>
                  <span>Avg: ${platform.avgOrderValue.toFixed(2)}</span>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

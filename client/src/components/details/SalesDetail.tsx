import { TrendingUp, DollarSign, Package, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface SalesDetailProps {
  data: {
    period: string;
    totalRevenue: number;
    totalOrders: number;
    averageOrderValue: number;
    topProducts: Array<{
      partNumber: string;
      name: string;
      sales: number;
      quantity: number;
    }>;
    dailyData: Array<{
      date: string;
      sales: number;
    }>;
  };
}

export default function SalesDetail({ data }: SalesDetailProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-gray-100 mb-1">Sales Analytics</h3>
        <Badge variant="outline" className="text-xs">{data.period}</Badge>
      </div>

      <Separator className="bg-gray-700" />

      {/* Metrics Grid */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-800 border border-lego-green/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="h-4 w-4 text-lego-green" />
            <span className="text-xs text-gray-400">Revenue</span>
          </div>
          <p className="text-xl font-mono font-semibold text-lego-green">${data.totalRevenue.toLocaleString()}</p>
        </div>

        <div className="bg-gray-800 border border-lego-blue/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Package className="h-4 w-4 text-lego-blue" />
            <span className="text-xs text-gray-400">Orders</span>
          </div>
          <p className="text-xl font-mono font-semibold text-gray-100">{data.totalOrders.toLocaleString()}</p>
        </div>

        <div className="bg-gray-800 border border-lego-yellow/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-lego-yellow" />
            <span className="text-xs text-gray-400">Avg Order</span>
          </div>
          <p className="text-xl font-mono font-semibold text-gray-100">${data.averageOrderValue.toFixed(2)}</p>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
        <h4 className="text-sm font-semibold text-gray-300 mb-3">Daily Sales Trend</h4>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data.dailyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey="date" 
              stroke="#9CA3AF"
              tick={{ fill: '#9CA3AF', fontSize: 10 }}
            />
            <YAxis 
              stroke="#9CA3AF"
              tick={{ fill: '#9CA3AF', fontSize: 10 }}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#1F2937', 
                border: '1px solid #374151',
                borderRadius: '8px',
                fontSize: '12px'
              }}
              formatter={(value: number) => [`$${value.toLocaleString()}`, 'Sales']}
            />
            <Line 
              type="monotone" 
              dataKey="sales" 
              stroke="#22C55E" 
              strokeWidth={2}
              dot={{ fill: '#22C55E', r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Top Products */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
        <h4 className="text-sm font-semibold text-gray-300 mb-3">Top Products</h4>
        <div className="space-y-2">
          {data.topProducts.map((product, index) => (
            <div key={index} className="flex justify-between items-center text-sm">
              <div className="flex-1">
                <p className="text-gray-100">{product.partNumber}</p>
                <p className="text-xs text-gray-400">{product.name}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-lego-green">${product.sales.toLocaleString()}</p>
                <p className="text-xs text-gray-400">{product.quantity} sold</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

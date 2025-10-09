import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

type TimePeriod = 'mtd' | 'ytd' | '1y' | '5y';

// TODO: remove mock functionality - replace with real ShipStation data
const mockData = {
  mtd: [
    { date: 'Week 1', sales: 4000 },
    { date: 'Week 2', sales: 3000 },
    { date: 'Week 3', sales: 5000 },
    { date: 'Week 4', sales: 4500 },
  ],
  ytd: [
    { date: 'Jan', sales: 12000 },
    { date: 'Feb', sales: 15000 },
    { date: 'Mar', sales: 18000 },
    { date: 'Apr', sales: 16000 },
    { date: 'May', sales: 19000 },
    { date: 'Jun', sales: 22000 },
  ],
  '1y': [
    { date: 'Q1', sales: 45000 },
    { date: 'Q2', sales: 57000 },
    { date: 'Q3', sales: 52000 },
    { date: 'Q4', sales: 68000 },
  ],
  '5y': [
    { date: '2020', sales: 180000 },
    { date: '2021', sales: 220000 },
    { date: '2022', sales: 250000 },
    { date: '2023', sales: 290000 },
    { date: '2024', sales: 320000 },
  ],
};

export default function SalesDashboard() {
  const [period, setPeriod] = useState<TimePeriod>('ytd');
  
  const data = mockData[period];
  const average = Math.round(data.reduce((sum, d) => sum + d.sales, 0) / data.length);

  return (
    <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-green/5 to-transparent rounded-lg border border-lego-green/10 shadow-[0_0_15px_rgba(34,197,94,0.1)]">
      <h2 className="text-sm font-semibold text-gray-300">Sales Performance - {period.toUpperCase()}</h2>
      
      <div className="bg-gray-900/50 border border-lego-green/20 rounded-lg p-2">
        <div className="mb-1 text-xs text-gray-400">
          Average: <span className="text-lego-green font-mono font-semibold">${average.toLocaleString()}</span>
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
    </div>
  );
}

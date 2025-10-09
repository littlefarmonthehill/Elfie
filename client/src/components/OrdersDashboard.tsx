import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function OrdersDashboard() {
  // TODO: remove mock functionality - replace with real ShipStation data
  const trendData = [
    { date: 'Mon', bricklink: 45, brickowl: 28, other: 12 },
    { date: 'Tue', bricklink: 52, brickowl: 31, other: 15 },
    { date: 'Wed', bricklink: 48, brickowl: 25, other: 10 },
    { date: 'Thu', bricklink: 61, brickowl: 35, other: 18 },
    { date: 'Fri', bricklink: 55, brickowl: 30, other: 14 },
    { date: 'Sat', bricklink: 68, brickowl: 42, other: 20 },
    { date: 'Sun', bricklink: 58, brickowl: 38, other: 16 },
  ];

  const total = trendData[trendData.length - 1].bricklink + 
                trendData[trendData.length - 1].brickowl + 
                trendData[trendData.length - 1].other;

  return (
    <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-orange/5 to-transparent rounded-lg border border-lego-orange/10 shadow-[0_0_15px_rgba(251,146,60,0.1)]">
      <h2 className="text-sm font-semibold text-gray-300">Trending Orders by Platform</h2>
      
      <div className="bg-gray-900/50 border border-lego-orange/20 rounded-lg p-2">
        <div className="mb-1 text-xs text-gray-400">
          Today's Total: <span className="text-lego-orange font-mono font-semibold">{total} orders</span>
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

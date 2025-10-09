import MetricCard from "./MetricCard";

export default function OrdersDashboard() {
  // TODO: remove mock functionality - replace with real ShipStation data
  const platforms = [
    { name: 'BrickLink', orders: '156', revenue: '$8,234' },
    { name: 'BrickOwl', orders: '89', revenue: '$4,567' },
    { name: 'Other', orders: '43', revenue: '$2,890' },
  ];

  return (
    <div className="p-3 space-y-2 bg-gradient-to-br from-lego-orange/5 to-transparent rounded-lg border border-lego-orange/10 shadow-[0_0_15px_rgba(251,146,60,0.1)]">
      <h2 className="text-sm font-semibold text-gray-300">Trending Orders by Platform</h2>
      
      <div className="space-y-2">
        {platforms.map((platform) => (
          <div key={platform.name} className="bg-gray-900/50 border border-lego-orange/20 rounded-lg p-2">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-semibold text-gray-300">{platform.name}</h3>
              <span className="text-xs text-lego-orange font-mono">{platform.revenue}</span>
            </div>
            <div className="text-xs text-gray-500">{platform.orders} orders</div>
          </div>
        ))}
      </div>
    </div>
  );
}

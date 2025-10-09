import MetricCard from "./MetricCard";

export default function GeneralDashboard() {
  // TODO: remove mock functionality - replace with real aggregated data
  const metrics = {
    totalRevenue: '$320,450',
    totalOrders: '2,847',
    inventoryValue: '$28,901',
    profitMargin: '57.2%',
  };

  return (
    <div className="p-4 space-y-4 bg-gradient-to-br from-lego-red/5 to-transparent rounded-lg border border-lego-red/10 shadow-[0_0_15px_rgba(239,68,68,0.1)]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Total Revenue" value={metrics.totalRevenue} color="green" />
        <MetricCard label="Total Orders" value={metrics.totalOrders} color="blue" />
        <MetricCard label="Inventory Value" value={metrics.inventoryValue} color="red" />
        <MetricCard label="Profit Margin" value={metrics.profitMargin} color="green" />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div className="bg-gray-900/50 border border-lego-red/20 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-gray-400 mb-3">Top Products</h3>
          <div className="space-y-2">
            {['LEGO Star Wars Millennium Falcon', 'LEGO Technic Bugatti', 'LEGO Architecture Statue'].map((product, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className="text-gray-300">{product}</span>
                <span className="text-lego-green font-mono">${(Math.random() * 500 + 100).toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
        
        <div className="bg-gray-900/50 border border-lego-blue/20 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-gray-400 mb-3">Recent Activity</h3>
          <div className="space-y-2">
            {['New order received', 'Inventory updated', 'Shipment processed'].map((activity, i) => (
              <div key={i} className="text-xs text-gray-400">
                • {activity}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

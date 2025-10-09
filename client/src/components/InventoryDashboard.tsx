import MetricCard from "./MetricCard";

export default function InventoryDashboard() {
  // TODO: remove mock functionality - replace with real BrickLink data
  const metrics = {
    lots: '1,234',
    parts: '45,678',
    myCost: '$12,345.67',
    listed: '$28,901.23',
    profitPotential: '$16,555.56',
    weight: '2,345 lbs',
  };

  return (
    <div className="p-4 space-y-3 bg-gradient-to-br from-lego-blue/5 to-transparent rounded-lg border border-lego-blue/10 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
      <h2 className="text-sm font-semibold text-gray-300">Inventory Overview</h2>
      
      <div className="space-y-3">
        <div>
          <h3 className="text-xs text-gray-500 mb-2">Quantities</h3>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Lots" value={metrics.lots} color="blue" />
            <MetricCard label="Parts" value={metrics.parts} color="blue" />
          </div>
        </div>

        <div>
          <h3 className="text-xs text-gray-500 mb-2">Values</h3>
          <div className="grid grid-cols-3 gap-3">
            <MetricCard label="My Cost" value={metrics.myCost} color="red" />
            <MetricCard label="Listed" value={metrics.listed} color="blue" />
            <MetricCard label="Profit Potential" value={metrics.profitPotential} color="green" />
          </div>
        </div>

        <div>
          <h3 className="text-xs text-gray-500 mb-2">Weight</h3>
          <div className="grid grid-cols-1 gap-3">
            <MetricCard label="Total Weight" value={metrics.weight} color="blue" />
          </div>
        </div>
      </div>
    </div>
  );
}

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
    <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-blue/5 to-transparent rounded-lg border border-lego-blue/10 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
      <div className="space-y-1.5">
        <div>
          <h3 className="text-xs text-gray-500 mb-0.5">Quantities</h3>
          <div className="grid grid-cols-3 gap-1.5">
            <MetricCard label="Lots" value={metrics.lots} color="blue" />
            <MetricCard label="Parts" value={metrics.parts} color="blue" />
            <MetricCard label="Weight" value={metrics.weight} color="blue" />
          </div>
        </div>

        <div>
          <h3 className="text-xs text-gray-500 mb-0.5">Values</h3>
          <div className="grid grid-cols-3 gap-1.5">
            <MetricCard label="My Cost" value={metrics.myCost} color="red" />
            <MetricCard label="Listed" value={metrics.listed} color="blue" />
            <MetricCard label="Profit Potential" value={metrics.profitPotential} color="green" />
          </div>
        </div>
      </div>
    </div>
  );
}

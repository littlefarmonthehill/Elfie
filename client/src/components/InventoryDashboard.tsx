import MetricCard from "./MetricCard";

export default function InventoryDashboard() {
  // TODO: remove mock functionality - replace with real BrickLink data
  const metrics = {
    lots: '1,234',
    parts: '45,678',
    items: '23,456',
    totalCost: '$12,345.67',
    totalValue: '$28,901.23',
    potentialProfit: '$16,555.56',
    totalWeight: '2,345 lbs',
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-sm font-semibold text-gray-300">Inventory Overview</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Total Lots" value={metrics.lots} color="blue" />
        <MetricCard label="Total Parts" value={metrics.parts} color="blue" />
        <MetricCard label="Total Items" value={metrics.items} color="blue" />
        <MetricCard label="Total Weight" value={metrics.totalWeight} color="blue" />
        <MetricCard label="Total Cost" value={metrics.totalCost} color="red" />
        <MetricCard label="Total Value" value={metrics.totalValue} color="green" />
        <MetricCard label="Potential Profit" value={metrics.potentialProfit} color="green" />
      </div>
    </div>
  );
}

import MetricCard from '../MetricCard';

export default function MetricCardExample() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
      <MetricCard label="Total Lots" value="1,234" color="blue" />
      <MetricCard label="Total Parts" value="45,678" color="blue" />
      <MetricCard label="Total Cost" value="$12,345" color="red" />
      <MetricCard label="Total Value" value="$23,456" color="green" />
    </div>
  );
}

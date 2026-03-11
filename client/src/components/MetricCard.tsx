import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string | number;
  color?: 'red' | 'blue' | 'yellow' | 'green';
  className?: string;
}

export default function MetricCard({ label, value, color = 'blue', className }: MetricCardProps) {
  const colorClass = {
    red: 'border-lego-red/20',
    blue: 'border-lego-blue/20',
    yellow: 'border-lego-yellow/20',
    green: 'border-lego-green/20',
  }[color];

  const textColorClass = {
    red: 'text-lego-red',
    blue: 'text-lego-blue',
    yellow: 'text-lego-yellow',
    green: 'text-lego-green',
  }[color];

  return (
    <Card
      className={cn(
        "bg-gray-900/50 border p-1.5 md:p-4 lg:p-6",
        colorClass,
        className
      )}
      data-testid={`metric-${label.toLowerCase().replace(/\s/g, '-')}`}
    >
      <div className="text-gray-400 mb-0.5 leading-tight text-[9px] md:text-sm lg:text-lg md:mb-2 lg:mb-3">{label}</div>
      <div className={cn(
        "font-semibold font-mono text-xs md:text-lg lg:text-2xl",
        textColorClass
      )}>{value}</div>
    </Card>
  );
}

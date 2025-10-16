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
    <Card className={cn("p-1.5 md:p-3 lg:p-4 bg-gray-900/50 border", colorClass, className)} data-testid={`metric-${label.toLowerCase().replace(/\s/g, '-')}`}>
      <div className="text-xs md:text-sm lg:text-base text-gray-400 mb-0.5 md:mb-1 lg:mb-1.5 leading-tight">{label}</div>
      <div className={cn("text-xs md:text-base lg:text-lg font-semibold font-mono", textColorClass)}>{value}</div>
    </Card>
  );
}

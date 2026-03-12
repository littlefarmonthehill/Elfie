import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string | number;
  color?: 'red' | 'blue' | 'yellow' | 'green' | 'orange';
  className?: string;
  'data-testid'?: string;
}

export default function MetricCard({ label, value, color = 'blue', className, 'data-testid': testId }: MetricCardProps) {
  const colorClass = {
    red: 'border-lego-red/20',
    blue: 'border-lego-blue/20',
    yellow: 'border-lego-yellow/20',
    green: 'border-lego-green/20',
    orange: 'border-lego-orange/20',
  }[color];

  const textColorClass = {
    red: 'text-lego-red',
    blue: 'text-lego-blue',
    yellow: 'text-lego-yellow',
    green: 'text-lego-green',
    orange: 'text-lego-orange',
  }[color];

  return (
    <div
      className={cn(
        "rounded-md border bg-gray-900/50 p-1.5 md:p-2.5 lg:p-3",
        colorClass,
        className
      )}
      data-testid={testId || `metric-${label.toLowerCase().replace(/\s/g, '-')}`}
    >
      <div className="text-gray-400 mb-0.5 leading-tight text-[9px] md:text-xs lg:text-sm">{label}</div>
      <div className={cn(
        "font-semibold font-mono text-xs md:text-base lg:text-lg",
        textColorClass
      )}>{value}</div>
    </div>
  );
}

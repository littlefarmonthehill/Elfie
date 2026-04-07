import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string | number;
  color?: 'red' | 'blue' | 'yellow' | 'green' | 'orange';
  className?: string;
  compact?: boolean;
  'data-testid'?: string;
}

export default function MetricCard({ label, value, color = 'blue', className, compact, 'data-testid': testId }: MetricCardProps) {
  const colorClass = {
    red:    'border-lego-red/50',
    blue:   'border-lego-blue/50',
    yellow: 'border-lego-yellow/50',
    green:  'border-lego-green/50',
    orange: 'border-lego-orange/50',
  }[color];

  const textColorClass = {
    red:    'text-lego-red',
    blue:   'text-lego-blue',
    yellow: 'text-lego-yellow',
    green:  'text-lego-green',
    orange: 'text-lego-orange',
  }[color];

  return (
    <div
      className={cn(
        "rounded-md border bg-gray-800/70",
        compact ? "p-1.5" : "p-1.5 md:p-2.5",
        colorClass,
        className
      )}
      data-testid={testId || `metric-${label.toLowerCase().replace(/\s/g, '-')}`}
    >
      <div className={cn("text-gray-300 mb-0.5 leading-tight", compact ? "text-[11px]" : "text-[11px] md:text-xs")}>{label}</div>
      <div className={cn(
        "font-semibold font-mono leading-none",
        compact ? "text-xs" : "text-xs md:text-base",
        textColorClass
      )}>{value}</div>
    </div>
  );
}

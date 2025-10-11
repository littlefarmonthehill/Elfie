import { Calendar } from "lucide-react";

export type DateRangeValue = 'all' | '3months' | '6months' | '1year' | '2years';

interface DateRangeSelectorProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
}

export default function DateRangeSelector({ value, onChange, className = "" }: DateRangeSelectorProps) {
  const options: { label: string; value: DateRangeValue }[] = [
    { label: '3M', value: '3months' },
    { label: '6M', value: '6months' },
    { label: '1Y', value: '1year' },
    { label: '2Y', value: '2years' },
    { label: 'All', value: 'all' },
  ];

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex items-center gap-1.5">
        <Calendar className="h-3.5 w-3.5 text-gray-400" />
        <span className="text-[10px] font-bold text-gray-400">TIME RANGE</span>
      </div>
      <div className="flex gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`text-[9px] font-bold py-1 px-2 rounded transition-all ${
              value === option.value
                ? 'bg-lego-orange text-white border border-lego-orange'
                : 'bg-gray-900 text-gray-400 border border-gray-700 hover-elevate'
            }`}
            data-testid={`button-range-${option.value}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

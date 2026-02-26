import { Calendar } from "lucide-react";

export type DateRangeValue = 'mtd' | 'lastmonth' | '3months' | '1year' | 'prevyear' | 'all';

interface DateRangeSelectorProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
}

export default function DateRangeSelector({ value, onChange, className = "" }: DateRangeSelectorProps) {
  const options: { label: string; value: DateRangeValue }[] = [
    { label: 'MTD', value: 'mtd' },
    { label: 'Last Mo', value: 'lastmonth' },
    { label: '3M', value: '3months' },
    { label: '1Y', value: '1year' },
    { label: 'Prev Yr', value: 'prevyear' },
    { label: 'All', value: 'all' },
  ];

  return (
    <div className={`flex items-center gap-1.5 md:gap-4 lg:gap-5 ${className}`}>
      <div className="flex items-center gap-1 md:gap-2.5 lg:gap-3">
        <Calendar className="h-3.5 w-3.5 md:h-5 md:w-5 lg:h-6 lg:w-6 text-gray-400" />
        <span className="text-[10px] md:text-base lg:text-lg font-bold text-gray-400">TIME RANGE</span>
      </div>
      <div className="flex gap-1 md:gap-3 lg:gap-4">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`text-[10px] md:text-base lg:text-lg font-bold py-1 md:py-2 lg:py-2.5 px-1.5 md:px-4 lg:px-5 rounded transition-all ${
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

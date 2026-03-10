export type DateRangeValue = 'mtd' | 'lastmonth' | '3months' | '1year' | 'prevyear' | 'all';

interface DateRangeSelectorProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
  compact?: boolean;
}

export default function DateRangeSelector({ value, onChange, className = "", compact = false }: DateRangeSelectorProps) {
  const options: { label: string; value: DateRangeValue }[] = [
    { label: 'This Month',  value: 'mtd' },
    { label: 'Prev Month',  value: 'lastmonth' },
    { label: '3 Months',    value: '3months' },
    { label: '1 Year',      value: '1year' },
    { label: 'Prev Year',   value: 'prevyear' },
    { label: 'All Time',    value: 'all' },
  ];

  return (
    <div className={`flex ${compact ? 'gap-1' : 'gap-1 md:gap-3 lg:gap-4'} ${className}`}>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`font-bold rounded transition-all ${
            compact
              ? 'text-[10px] py-0.5 px-1.5'
              : 'text-[10px] md:text-base lg:text-lg py-1 md:py-2 lg:py-2.5 px-1.5 md:px-4 lg:px-5'
          } ${
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
  );
}

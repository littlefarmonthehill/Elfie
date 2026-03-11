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

  const isActive = (v: DateRangeValue) => value === v;

  return (
    <div
      className={`inline-flex items-center ${compact ? 'gap-0.5' : 'gap-0'} ${className}`}
      style={{
        borderRadius: '999px',
        padding: compact ? '2px' : '3px',
        background: 'linear-gradient(135deg, hsla(200,80%,25%,0.5) 0%, hsla(220,60%,15%,0.7) 50%, hsla(200,80%,25%,0.5) 100%)',
        border: '1px solid hsla(200,80%,55%,0.3)',
        boxShadow: '0 0 12px hsla(200,80%,50%,0.15), inset 0 1px 0 hsla(200,80%,70%,0.1)',
      }}
    >
      {options.map((option, i) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className="relative transition-all duration-200"
          style={{
            padding: compact ? '3px 8px' : '6px 16px',
            fontSize: compact ? '10px' : '12px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            borderRadius: '999px',
            cursor: 'pointer',
            border: 'none',
            outline: 'none',
            ...(isActive(option.value) ? {
              background: 'linear-gradient(180deg, hsla(25,95%,55%,0.95) 0%, hsla(25,95%,45%,0.95) 100%)',
              color: '#fff',
              boxShadow: '0 0 14px hsla(25,95%,55%,0.6), 0 0 4px hsla(25,95%,55%,0.4), inset 0 1px 0 hsla(25,95%,80%,0.3)',
              textShadow: '0 0 8px hsla(25,95%,80%,0.5)',
            } : {
              background: 'transparent',
              color: 'hsla(200,60%,70%,0.7)',
              boxShadow: 'none',
              textShadow: 'none',
            }),
          }}
          onMouseEnter={(e) => {
            if (!isActive(option.value)) {
              e.currentTarget.style.color = 'hsla(200,60%,85%,0.9)';
              e.currentTarget.style.background = 'hsla(200,80%,50%,0.12)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isActive(option.value)) {
              e.currentTarget.style.color = 'hsla(200,60%,70%,0.7)';
              e.currentTarget.style.background = 'transparent';
            }
          }}
          data-testid={`button-range-${option.value}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

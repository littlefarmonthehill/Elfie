import { useState, useEffect } from "react";
import { Calendar, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type DateRangeValue = 'mtd' | 'lastmonth' | '3months' | '1year' | 'prevyear' | 'all';

interface DateRangeSelectorProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
  compact?: boolean;
  scaled?: boolean;
}

export const RANGE_SHORT_LABELS: Record<DateRangeValue, string> = {
  mtd: 'MTD',
  lastmonth: 'Prev',
  '3months': '3M',
  '1year': '1Y',
  prevyear: 'PY',
  all: 'All',
};

const fullLabels: { label: string; short: string; value: DateRangeValue }[] = [
  { label: 'This Month',  short: 'MTD',   value: 'mtd' },
  { label: 'Prev Month',  short: 'Prev',  value: 'lastmonth' },
  { label: '3 Months',    short: '3M',    value: '3months' },
  { label: '1 Year',      short: '1Y',    value: '1year' },
  { label: 'Prev Year',   short: 'PY',    value: 'prevyear' },
  { label: 'All Time',    short: 'All',   value: 'all' },
];

export default function DateRangeSelector({ value, onChange, className = "", compact = false, scaled = false }: DateRangeSelectorProps) {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const isActive = (v: DateRangeValue) => value === v;
  const useCompact = compact || isMobile;
  const useScaled = scaled && useCompact;

  return (
    <div
      className={`inline-flex items-center ${useCompact ? 'gap-0.5' : 'gap-1'} ${className}`}
      style={{
        borderRadius: '999px',
        padding: useScaled ? '2px' : useCompact ? '3px' : '4px',
        background: 'linear-gradient(135deg, hsla(200,80%,25%,0.5) 0%, hsla(220,60%,15%,0.7) 50%, hsla(200,80%,25%,0.5) 100%)',
        border: '1px solid hsla(200,80%,55%,0.3)',
        boxShadow: '0 0 12px hsla(200,80%,50%,0.15), inset 0 1px 0 hsla(200,80%,70%,0.1)',
        maxWidth: '100%',
      }}
    >
      {fullLabels.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className="relative transition-all duration-200 whitespace-nowrap"
          style={{
            padding: useScaled ? '4px 7px' : useCompact ? '6px 10px' : '8px 18px',
            fontSize: useScaled ? '8px' : useCompact ? '10px' : '13px',
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
          {isMobile ? option.short : option.label}
        </button>
      ))}
    </div>
  );
}

interface CollapsibleDatePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  accentClass?: string;
  testId?: string;
}

export function CollapsibleDatePicker({
  value,
  onChange,
  accentClass = 'text-gray-400 hover:text-gray-200',
  testId,
}: CollapsibleDatePickerProps) {
  const [open, setOpen] = useState(false);

  const handleChange = (v: DateRangeValue) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="ml-auto flex items-center gap-1.5 shrink-0">
      {open && (
        <DateRangeSelector
          value={value}
          onChange={handleChange}
          compact
          scaled
        />
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-0.5 transition-colors duration-150 select-none",
          "text-[9px] font-bold uppercase tracking-wider",
          accentClass,
        )}
        data-testid={testId ?? 'button-toggle-date-picker'}
      >
        <Calendar className="w-3 h-3 shrink-0" />
        <span className="leading-none">{RANGE_SHORT_LABELS[value]}</span>
        {open
          ? <ChevronUp className="w-2.5 h-2.5 shrink-0" />
          : <ChevronDown className="w-2.5 h-2.5 shrink-0" />
        }
      </button>
    </div>
  );
}

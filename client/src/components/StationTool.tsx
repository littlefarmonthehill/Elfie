import { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Info } from "lucide-react";

interface StationToolProps {
  icon: ElementType;
  label: string;
  status?: ReactNode;
  hex: string;
  glowRgb: string;
  isCompact?: boolean;
  onClick?: () => void;
  testId?: string;
  infoContent?: string;
}

export function StationTool({
  icon: Icon,
  label,
  status,
  hex,
  glowRgb,
  isCompact,
  onClick,
  testId,
  infoContent,
}: StationToolProps) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "group flex items-center w-full rounded-lg text-left hover-elevate active-elevate-2 transition-all",
        isCompact ? "gap-2.5 px-2.5 py-2" : "gap-3 px-3 py-2.5"
      )}
      style={{
        border: `1px solid ${hex}38`,
        background: `linear-gradient(135deg, color-mix(in srgb, ${hex} 11%, #08090f) 0%, #0b0d18 100%)`,
        boxShadow: `0 0 18px rgba(${glowRgb}, 0.09), inset 0 1px 0 rgba(${glowRgb}, 0.07)`,
      }}
    >
      {/* Circular badge */}
      <div
        className={cn(
          "rounded-full flex-shrink-0 flex items-center justify-center",
          isCompact ? "w-8 h-8" : "w-10 h-10"
        )}
        style={{
          background: `radial-gradient(circle at 35% 35%, color-mix(in srgb, ${hex} 28%, #0d1020), color-mix(in srgb, ${hex} 10%, #080a14))`,
          boxShadow: `0 0 16px rgba(${glowRgb}, 0.42), 0 0 4px rgba(${glowRgb}, 0.18), inset 0 0 0 1.5px rgba(${glowRgb}, 0.42)`,
        }}
      >
        <Icon
          className={cn(isCompact ? "w-3.5 h-3.5" : "w-4 h-4")}
          style={{ color: hex, filter: `drop-shadow(0 0 5px rgba(${glowRgb}, 0.75))` }}
        />
      </div>

      {/* Label + status */}
      <div className="flex flex-col min-w-0 flex-1">
        <span
          className={cn("font-bold leading-tight truncate", isCompact ? "text-xs" : "text-xs md:text-sm")}
          style={{ color: `color-mix(in srgb, ${hex} 60%, #dde4f0)` }}
        >
          {label}
        </span>
        {status != null && (
          <div className={cn("mt-0.5 leading-none", isCompact ? "text-[10px]" : "text-[11px]")}>
            {status}
          </div>
        )}
      </div>

      {/* Optional info popover */}
      {infoContent && (
        <Popover>
          <PopoverTrigger asChild>
            <span
              role="button"
              onClick={(e) => e.stopPropagation()}
              className="flex-shrink-0 transition-colors"
              style={{ color: `rgba(${glowRgb}, 0.45)` }}
              data-testid={testId ? `info-${testId}` : undefined}
            >
              <Info className="w-3 h-3" />
            </span>
          </PopoverTrigger>
          <PopoverContent side="top" className="w-64 text-xs text-gray-300 bg-gray-900 border-gray-700 p-2.5">
            {infoContent}
          </PopoverContent>
        </Popover>
      )}
    </button>
  );
}


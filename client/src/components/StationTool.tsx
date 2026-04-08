import { ElementType } from "react";
import { cn } from "@/lib/utils";

interface StationToolProps {
  icon: ElementType;
  label: string;
  hex: string;
  glowRgb: string;
  isCompact?: boolean;
  onClick?: () => void;
  testId?: string;
}

export function StationTool({
  icon: Icon,
  label,
  hex,
  glowRgb,
  isCompact,
  onClick,
  testId,
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

      {/* Label */}
      <span
        className={cn("font-bold leading-tight truncate min-w-0 flex-1", isCompact ? "text-xs" : "text-xs md:text-sm")}
        style={{ color: `color-mix(in srgb, ${hex} 60%, #dde4f0)` }}
      >
        {label}
      </span>
    </button>
  );
}


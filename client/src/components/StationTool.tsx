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
  const dotSize = isCompact ? 20 : 24;
  const iconSize = isCompact ? 10 : 12;

  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className="group flex items-center w-full hover-elevate active-elevate-2 transition-all"
      style={{
        borderRadius: '999px',
        padding: isCompact ? '5px 12px 5px 5px' : '6px 14px 6px 6px',
        gap: isCompact ? '8px' : '10px',
        border: `1px solid rgba(${glowRgb}, 0.32)`,
        background: `rgba(${glowRgb}, 0.05)`,
      }}
    >
      {/* Indicator light */}
      <div
        className="flex-shrink-0 flex items-center justify-center"
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: '50%',
          background: `radial-gradient(circle at 38% 38%, rgba(${glowRgb}, 0.55), rgba(${glowRgb}, 0.12))`,
          boxShadow: `0 0 10px rgba(${glowRgb}, 0.55), 0 0 3px rgba(${glowRgb}, 0.3), inset 0 0 0 1px rgba(${glowRgb}, 0.5)`,
        }}
      >
        <Icon
          style={{
            width: iconSize,
            height: iconSize,
            color: hex,
            filter: `drop-shadow(0 0 4px rgba(${glowRgb}, 1))`,
            flexShrink: 0,
          }}
        />
      </div>

      {/* Label */}
      <span
        className="truncate min-w-0 flex-1 font-mono uppercase tracking-wide leading-none"
        style={{
          fontSize: '9px',
          color: `color-mix(in srgb, ${hex} 65%, #ccd8f0)`,
        }}
      >
        {label}
      </span>
    </button>
  );
}

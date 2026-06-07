import { ElementType } from "react";
import { cn } from "@/lib/utils";
import { StageTag } from "@/components/BetaTag";
import type { Stage } from "@/hooks/use-feature";

interface StationToolProps {
  icon: ElementType;
  label: string;
  hex: string;
  glowRgb: string;
  isCompact?: boolean;
  onClick?: () => void;
  testId?: string;
  stage?: Stage;
}

export function StationTool({
  icon: Icon,
  label,
  hex,
  glowRgb,
  isCompact,
  onClick,
  testId,
  stage,
}: StationToolProps) {
  const lampSize = isCompact ? 28 : 32;
  const iconSize = isCompact ? 13 : 15;

  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className="group relative flex items-center gap-2.5 w-full active-elevate-2 transition-all rounded-sm px-2.5 py-2"
      style={{
        background: 'rgba(0,0,0,0.18)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Lamp — the interactive focal point */}
      <div
        className="flex-shrink-0 flex items-center justify-center rounded-full transition-all"
        style={{
          width: lampSize,
          height: lampSize,
          background: `radial-gradient(circle at 36% 36%, rgba(${glowRgb}, 0.60), rgba(${glowRgb}, 0.08) 70%)`,
          boxShadow: `0 0 7px rgba(${glowRgb}, 0.45), 0 0 2px rgba(${glowRgb}, 0.25), inset 0 0 0 1px rgba(${glowRgb}, 0.38)`,
        }}
      >
        <Icon
          style={{
            width: iconSize,
            height: iconSize,
            color: hex,
            filter: `drop-shadow(0 0 3px rgba(${glowRgb}, 0.9))`,
            flexShrink: 0,
          }}
        />
      </div>

      {/* Label — keeps its natural flow; reserves a small right gutter only when
          a stage badge is present so the badge never squishes or clips it. */}
      <span
        className={cn(
          "flex-1 min-w-0 font-mono uppercase tracking-widest leading-tight",
          stage && "pr-11",
        )}
        style={{
          fontSize: '10px',
          color: `color-mix(in srgb, ${hex} 55%, #8fa3bf)`,
          letterSpacing: '0.12em',
        }}
      >
        {label}
      </span>

      {/* Maturity badge — absolutely positioned in the top-right corner so it
          overlays the button without pushing, shrinking, or wrapping the label. */}
      {stage && <StageTag stage={stage} className="absolute top-1 right-1.5" />}
    </button>
  );
}

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Stage } from "@/hooks/use-feature";

const STAGE_STYLES: Record<"alpha" | "beta", { label: string; color: string; background: string; borderColor: string }> = {
  // Amber = earliest / least stable, matching the Release visibility view.
  alpha: { label: "Alpha", color: "#fcd34d", background: "rgba(245,158,11,0.16)", borderColor: "rgba(245,158,11,0.45)" },
  // Blue = beta, consistent with other "Beta" markers across the app.
  beta: { label: "Beta", color: "#93c5fd", background: "rgba(59,130,246,0.16)", borderColor: "rgba(59,130,246,0.45)" },
};

interface StageTagProps {
  stage?: Stage | string;
  className?: string;
}

/**
 * Small maturity marker ("Alpha" / "Beta") shown next to feature launchers and
 * sections. Built on the shared Shadcn Badge so it stays consistent with other
 * stage labels in the app; callers gate it on the super-admin flag. Renders
 * nothing for `released`/`none` so it can be dropped in unconditionally.
 */
export function StageTag({ stage, className }: StageTagProps) {
  const s = stage === "alpha" ? "alpha" : stage === "beta" ? "beta" : null;
  if (!s) return null;
  const style = STAGE_STYLES[s];
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 border px-1 py-px font-mono text-[8px] font-bold uppercase tracking-wider leading-none no-default-hover-elevate no-default-active-elevate",
        className,
      )}
      style={{ color: style.color, background: style.background, borderColor: style.borderColor }}
      data-testid={`badge-${s}`}
    >
      {style.label}
    </Badge>
  );
}

/** Back-compat wrapper: a plain "Beta" marker. Prefer <StageTag stage={...} />. */
export function BetaTag({ className }: { className?: string }) {
  return <StageTag stage="beta" className={className} />;
}

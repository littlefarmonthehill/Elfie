import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface BetaTagProps {
  className?: string;
}

/**
 * Small "Beta" marker shown next to feature sections that are still at the
 * beta stage. Built on the shared Shadcn Badge so it stays consistent with
 * other "Beta" labels in the app; callers gate it on the super-admin flag.
 */
export function BetaTag({ className }: BetaTagProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 border px-1 py-px font-mono text-[8px] font-bold uppercase tracking-wider leading-none no-default-hover-elevate no-default-active-elevate",
        className,
      )}
      style={{
        color: "#fcd34d",
        background: "rgba(245,158,11,0.16)",
        borderColor: "rgba(245,158,11,0.45)",
      }}
      data-testid="badge-beta"
    >
      Beta
    </Badge>
  );
}

interface BetaTagProps {
  className?: string;
}

/**
 * Small "Beta" marker shown next to feature launchers that are still at the
 * beta stage. Super admins see every beta feature automatically, so this tag
 * is how they (and opted-in orgs) can tell at a glance which tools are beta.
 */
export function BetaTag({ className }: BetaTagProps) {
  return (
    <span
      className={`shrink-0 rounded-sm px-1 py-px font-mono text-[8px] font-bold uppercase tracking-wider leading-none ${className ?? ""}`}
      style={{
        color: "#fcd34d",
        background: "rgba(245,158,11,0.16)",
        border: "1px solid rgba(245,158,11,0.45)",
      }}
      data-testid="badge-beta"
    >
      Beta
    </span>
  );
}

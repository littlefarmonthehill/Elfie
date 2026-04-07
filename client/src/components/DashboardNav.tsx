import { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Rocket, ToyBrick, Orbit, Sparkles } from "lucide-react";

function InsightsIcon({ className, strokeWidth = 1.5, ...props }: { className?: string; strokeWidth?: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
      <circle cx="12" cy="12" r="3.5" />
      <line x1="12" y1="8.5" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="15.5" />
      <line x1="8.5" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="15.5" y2="12" />
    </svg>
  );
}

export type DashboardType = 'dashboard' | 'inventory' | 'orders' | 'marketing' | 'sales';

interface DashboardNavProps {
  active: DashboardType;
  onSelect: (dashboard: DashboardType) => void;
  hideOpsCentral?: boolean;
  onHiddenChange?: (hidden: boolean) => void;
  ordersCount?: number;
}

export const dashboards: { id: DashboardType; label: string; color: string; activeClass: string; inactiveClass: string; icon: any }[] = [
  { id: 'dashboard', label: 'The Bridge', color: 'lego-red', activeClass: 'text-lego-red', inactiveClass: 'text-lego-red/75', icon: Rocket },
  { id: 'inventory', label: 'Inventory', color: 'lego-blue', activeClass: 'text-lego-blue', inactiveClass: 'text-lego-blue/75', icon: ToyBrick },
  { id: 'orders', label: 'Orders', color: 'lego-orange', activeClass: 'text-lego-orange', inactiveClass: 'text-lego-orange/75', icon: Orbit },
  { id: 'marketing', label: 'Marketing', color: 'lego-yellow', activeClass: 'text-lego-yellow', inactiveClass: 'text-lego-yellow/75', icon: Sparkles },
  { id: 'sales', label: 'Insights', color: 'lego-green', activeClass: 'text-lego-green', inactiveClass: 'text-lego-green/75', icon: InsightsIcon },
];

const SWIPE_THRESHOLD = 30;

export default function DashboardNav({ active, onSelect, hideOpsCentral, onHiddenChange, ordersCount = 0 }: DashboardNavProps) {
  const [isHidden, setIsHidden] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const filtered = hideOpsCentral ? dashboards.filter(d => d.id !== 'dashboard') : dashboards;

  useEffect(() => {
    onHiddenChange?.(isHidden);
  }, [isHidden, onHiddenChange]);

  const navRef = useRef<HTMLElement>(null);
  const pullTabRef = useRef<HTMLDivElement>(null);
  const preventGlobal = useRef<((e: TouchEvent) => void) | null>(null);

  const lockScroll = useCallback(() => {
    if (preventGlobal.current) return;
    const handler = (e: TouchEvent) => { e.preventDefault(); };
    preventGlobal.current = handler;
    document.addEventListener('touchmove', handler, { passive: false });
    document.body.style.overflow = 'hidden';
  }, []);

  const unlockScroll = useCallback(() => {
    if (preventGlobal.current) {
      document.removeEventListener('touchmove', preventGlobal.current);
      preventGlobal.current = null;
    }
    document.body.style.overflow = '';
  }, []);

  useEffect(() => {
    return () => unlockScroll();
  }, [unlockScroll]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    lockScroll();
  }, [lockScroll]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    unlockScroll();
    if (touchStartY.current === null) return;
    const distance = e.changedTouches[0].clientY - touchStartY.current;
    if (distance > SWIPE_THRESHOLD) {
      setIsHidden(true);
    } else if (distance < -SWIPE_THRESHOLD) {
      setIsHidden(false);
    }
    touchStartY.current = null;
  }, [unlockScroll]);

  return (
    <>
      {isHidden && (
        <div
          ref={pullTabRef}
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col items-center pb-[max(8px,env(safe-area-inset-bottom))] pt-2 cursor-pointer touch-none"
          onClick={() => setIsHidden(false)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          data-testid="pull-tab-menu"
        >
          <div className="w-10 h-[3px] rounded-full bg-amber-500/70" />
          <span className="text-[11px] text-amber-500/50 mt-1 font-medium tracking-wider uppercase">Menu</span>
        </div>
      )}

      <nav
        ref={navRef}
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 bg-gray-950/95 backdrop-blur-md border-t border-white/8 transition-transform duration-300 ease-in-out touch-none",
          isHidden ? "translate-y-full" : "translate-y-0"
        )}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        data-testid="bottom-nav"
      >
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/30" />
        </div>

        <div
          className="flex items-end justify-around"
          style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
        >
          {filtered.map((dashboard) => {
            const isActive = active === dashboard.id;
            const Icon = dashboard.icon;
            const showOrdersBadge = dashboard.id === 'orders' && ordersCount > 0 && !isActive;

            return (
              <button
                key={dashboard.id}
                onClick={() => onSelect(dashboard.id)}
                data-testid={`tab-${dashboard.id}`}
                className={cn(
                  "relative flex flex-col items-center gap-0.5 pt-2 pb-1 px-3 min-w-0 flex-1 transition-colors duration-200",
                  isActive ? dashboard.activeClass : dashboard.inactiveClass
                )}
              >
                <div className="relative">
                  {isActive && (
                    <div className={cn(
                      "absolute inset-0 rounded-full blur-md scale-[2] opacity-40",
                      dashboard.color === 'lego-red' && "bg-lego-red",
                      dashboard.color === 'lego-blue' && "bg-lego-blue",
                      dashboard.color === 'lego-orange' && "bg-lego-orange",
                      dashboard.color === 'lego-yellow' && "bg-lego-yellow",
                      dashboard.color === 'lego-green' && "bg-lego-green",
                    )} />
                  )}
                  <Icon className="relative w-5 h-5 shrink-0" strokeWidth={isActive ? 2.2 : 1.6} />
                  {showOrdersBadge && (
                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-lego-orange opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-lego-orange" />
                    </span>
                  )}
                </div>
                <span className={cn(
                  "text-xs font-medium truncate max-w-full",
                  isActive && "font-semibold"
                )}>
                  {dashboard.label}
                </span>
                {isActive && (
                  <div className={cn(
                    "w-5 h-[2px] rounded-full mt-0.5",
                    dashboard.color === 'lego-red' && "bg-lego-red shadow-[0_0_6px_1px] shadow-lego-red/60",
                    dashboard.color === 'lego-blue' && "bg-lego-blue shadow-[0_0_6px_1px] shadow-lego-blue/60",
                    dashboard.color === 'lego-orange' && "bg-lego-orange shadow-[0_0_6px_1px] shadow-lego-orange/60",
                    dashboard.color === 'lego-yellow' && "bg-lego-yellow shadow-[0_0_6px_1px] shadow-lego-yellow/60",
                    dashboard.color === 'lego-green' && "bg-lego-green shadow-[0_0_6px_1px] shadow-lego-green/60",
                  )} />
                )}
                {!isActive && <div className="w-5 h-[2px] mt-0.5" />}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}

interface DashboardNavRailProps {
  active: DashboardType;
  onSelect: (dashboard: DashboardType) => void;
  hideOpsCentral?: boolean;
  compact?: boolean;
  ordersCount?: number;
}

export function DashboardNavRail({ active, onSelect, hideOpsCentral, compact, ordersCount = 0 }: DashboardNavRailProps) {
  const filtered = hideOpsCentral ? dashboards.filter(d => d.id !== 'dashboard') : dashboards;

  return (
    <div className="flex flex-col items-center py-2 gap-0.5 h-full overflow-hidden">
      {filtered.map((dashboard) => {
        const isActive = active === dashboard.id;
        const Icon = dashboard.icon;
        const showOrdersBadge = dashboard.id === 'orders' && ordersCount > 0 && !isActive;

        return (
          <button
            key={dashboard.id}
            onClick={() => onSelect(dashboard.id)}
            data-testid={`rail-tab-${dashboard.id}`}
            title={dashboard.label}
            className={cn(
              "relative flex flex-col items-center gap-1 w-full transition-colors duration-200 rounded-md",
              compact ? "py-2 px-1" : "py-2.5 px-1",
              isActive ? dashboard.activeClass : dashboard.inactiveClass
            )}
          >
            {isActive && (
              <div className={cn(
                "absolute left-0 top-2 bottom-2 w-[2px] rounded-full",
                dashboard.color === 'lego-red' && "bg-lego-red shadow-[0_0_6px_2px] shadow-lego-red/50",
                dashboard.color === 'lego-blue' && "bg-lego-blue shadow-[0_0_6px_2px] shadow-lego-blue/50",
                dashboard.color === 'lego-orange' && "bg-lego-orange shadow-[0_0_6px_2px] shadow-lego-orange/50",
                dashboard.color === 'lego-yellow' && "bg-lego-yellow shadow-[0_0_6px_2px] shadow-lego-yellow/50",
                dashboard.color === 'lego-green' && "bg-lego-green shadow-[0_0_6px_2px] shadow-lego-green/50",
              )} />
            )}

            <div className="relative">
              {isActive && (
                <div className={cn(
                  "absolute inset-0 rounded-full blur-md scale-[2.5] opacity-30",
                  dashboard.color === 'lego-red' && "bg-lego-red",
                  dashboard.color === 'lego-blue' && "bg-lego-blue",
                  dashboard.color === 'lego-orange' && "bg-lego-orange",
                  dashboard.color === 'lego-yellow' && "bg-lego-yellow",
                  dashboard.color === 'lego-green' && "bg-lego-green",
                )} />
              )}
              <Icon
                className={cn("relative shrink-0", compact ? "w-4 h-4" : "w-5 h-5")}
                strokeWidth={isActive ? 2.2 : 1.6}
              />
              {showOrdersBadge && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-lego-orange opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-lego-orange" />
                </span>
              )}
            </div>

            {!compact && (
              <span className={cn(
                "text-[11px] font-medium leading-tight text-center px-0.5 w-full",
                isActive && "font-semibold"
              )}>
                {dashboard.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

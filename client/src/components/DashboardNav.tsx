import { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Radar, Package, ClipboardList, Megaphone, TrendingUp } from "lucide-react";

export type DashboardType = 'dashboard' | 'inventory' | 'orders' | 'marketing' | 'sales';

interface DashboardNavProps {
  active: DashboardType;
  onSelect: (dashboard: DashboardType) => void;
  hideOpsCentral?: boolean;
  onHiddenChange?: (hidden: boolean) => void;
}

const dashboards: { id: DashboardType; label: string; color: string; activeClass: string; inactiveClass: string; icon: typeof Radar }[] = [
  { id: 'dashboard', label: 'Ops Central', color: 'lego-red', activeClass: 'text-lego-red', inactiveClass: 'text-lego-red/75', icon: Radar },
  { id: 'inventory', label: 'Product', color: 'lego-blue', activeClass: 'text-lego-blue', inactiveClass: 'text-lego-blue/75', icon: Package },
  { id: 'orders', label: 'Orders', color: 'lego-orange', activeClass: 'text-lego-orange', inactiveClass: 'text-lego-orange/75', icon: ClipboardList },
  { id: 'marketing', label: 'Marketing', color: 'lego-yellow', activeClass: 'text-lego-yellow', inactiveClass: 'text-lego-yellow/75', icon: Megaphone },
  { id: 'sales', label: 'Sales', color: 'lego-green', activeClass: 'text-lego-green', inactiveClass: 'text-lego-green/75', icon: TrendingUp },
];

const SWIPE_THRESHOLD = 30;

export default function DashboardNav({ active, onSelect, hideOpsCentral, onHiddenChange }: DashboardNavProps) {
  const [isHidden, setIsHidden] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const filtered = hideOpsCentral ? dashboards.filter(d => d.id !== 'dashboard') : dashboards;

  useEffect(() => {
    onHiddenChange?.(isHidden);
  }, [isHidden, onHiddenChange]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const distance = e.changedTouches[0].clientY - touchStartY.current;
    if (distance > SWIPE_THRESHOLD) {
      setIsHidden(true);
    } else if (distance < -SWIPE_THRESHOLD) {
      setIsHidden(false);
    }
    touchStartY.current = null;
  }, []);

  return (
    <>
      {isHidden && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col items-center pb-[max(8px,env(safe-area-inset-bottom))] pt-2 cursor-pointer"
          onClick={() => setIsHidden(false)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          data-testid="pull-tab-menu"
        >
          <div className="w-10 h-[3px] rounded-full bg-amber-500/70" />
          <span className="text-[9px] text-amber-500/50 mt-1 font-medium tracking-wider uppercase">Menu</span>
        </div>
      )}

      <nav
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 bg-gray-950/95 backdrop-blur-md border-t border-white/8 transition-transform duration-300 ease-in-out",
          isHidden ? "translate-y-full" : "translate-y-0"
        )}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        data-testid="bottom-nav"
      >
        <div className="flex justify-center pt-1.5 pb-0.5">
          <div className="w-8 h-[3px] rounded-full bg-white/15" />
        </div>

        <div
          className="flex items-end justify-around"
          style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
        >
          {filtered.map((dashboard) => {
            const isActive = active === dashboard.id;
            const Icon = dashboard.icon;

            return (
              <button
                key={dashboard.id}
                onClick={() => onSelect(dashboard.id)}
                data-testid={`tab-${dashboard.id}`}
                className={cn(
                  "flex flex-col items-center gap-0.5 pt-2 pb-1 px-3 min-w-0 flex-1 transition-colors duration-200",
                  isActive ? dashboard.activeClass : dashboard.inactiveClass
                )}
              >
                <Icon className="w-5 h-5 md:w-6 md:h-6 shrink-0" strokeWidth={isActive ? 2.2 : 1.6} />
                <span className={cn(
                  "text-[10px] md:text-xs font-medium truncate max-w-full",
                  isActive && "font-semibold"
                )}>
                  {dashboard.label}
                </span>
                {isActive && (
                  <div className={cn(
                    "w-1 h-1 rounded-full mt-0.5",
                    dashboard.color === 'lego-red' && "bg-lego-red",
                    dashboard.color === 'lego-blue' && "bg-lego-blue",
                    dashboard.color === 'lego-orange' && "bg-lego-orange",
                    dashboard.color === 'lego-yellow' && "bg-lego-yellow",
                    dashboard.color === 'lego-green' && "bg-lego-green",
                  )} />
                )}
                {!isActive && <div className="w-1 h-1 mt-0.5" />}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}

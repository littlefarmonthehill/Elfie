import { cn } from "@/lib/utils";

export type DashboardType = 'dashboard' | 'inventory' | 'orders' | 'marketing' | 'sales';

interface DashboardNavProps {
  active: DashboardType;
  onSelect: (dashboard: DashboardType) => void;
}

const dashboards = [
  { id: 'dashboard' as const, label: 'Dashboard', color: 'lego-red' },
  { id: 'inventory' as const, label: 'Product', color: 'lego-blue' },
  { id: 'orders' as const, label: 'Orders', color: 'lego-orange' },
  { id: 'marketing' as const, label: 'Marketing', color: 'lego-yellow' },
  { id: 'sales' as const, label: 'Sales', color: 'lego-green' },
];

export default function DashboardNav({ active, onSelect }: DashboardNavProps) {
  return (
    <nav className="h-10 border-b border-gray-800 flex items-center gap-2 px-4 overflow-x-auto scrollbar-hide">
      {dashboards.map((dashboard) => {
        const isActive = active === dashboard.id;
        const bgColor = `bg-${dashboard.color}`;
        const textColor = `text-${dashboard.color}`;
        
        return (
          <button
            key={dashboard.id}
            onClick={() => onSelect(dashboard.id)}
            data-testid={`tab-${dashboard.id}`}
            className={cn(
              "px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all",
              isActive && dashboard.color === 'lego-red' && "bg-lego-red text-white",
              !isActive && dashboard.color === 'lego-red' && "text-lego-red/60 hover:bg-lego-red/30",
              isActive && dashboard.color === 'lego-blue' && "bg-lego-blue text-white",
              !isActive && dashboard.color === 'lego-blue' && "text-lego-blue/60 hover:bg-lego-blue/30",
              isActive && dashboard.color === 'lego-yellow' && "bg-lego-yellow text-black",
              !isActive && dashboard.color === 'lego-yellow' && "text-lego-yellow/60 hover:bg-lego-yellow/30",
              isActive && dashboard.color === 'lego-green' && "bg-lego-green text-white",
              !isActive && dashboard.color === 'lego-green' && "text-lego-green/60 hover:bg-lego-green/30",
              isActive && dashboard.color === 'lego-orange' && "bg-lego-orange text-white",
              !isActive && dashboard.color === 'lego-orange' && "text-lego-orange/60 hover:bg-lego-orange/30",
            )}
          >
            {dashboard.label}
          </button>
        );
      })}
    </nav>
  );
}

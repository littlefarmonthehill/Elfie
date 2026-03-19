import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

interface ToolDrawerProps {
  icon: LucideIcon;
  iconColor: string;
  title: string;
  onClose?: () => void;
  actions?: React.ReactNode;
  subHeader?: React.ReactNode;
  children: React.ReactNode;
  closeTestId?: string;
  contentClassName?: string;
}

export function ToolDrawer({ icon: Icon, iconColor, title, onClose, actions, subHeader, children, closeTestId = "button-close-drawer", contentClassName }: ToolDrawerProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-1.5">
          <Icon className={`w-5 h-5 ${iconColor} flex-shrink-0`} />
          <span className="text-sm font-semibold text-gray-200">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          {actions}
          {onClose && (
            <Button size="icon" variant="ghost" onClick={onClose} data-testid={closeTestId}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
      {subHeader}
      <div className={contentClassName ?? "flex-1 overflow-y-auto px-4 pt-4 pb-4"}>
        {children}
      </div>
    </div>
  );
}

import { useIsMobile } from "@/hooks/use-mobile";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface ResponsiveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  icon?: LucideIcon;
  iconColor?: string;
  description?: string;
  children: ReactNode;
  maxWidth?: string;
  testId?: string;
}

export function ResponsiveModal({
  open,
  onOpenChange,
  title,
  icon: Icon,
  iconColor = "text-gray-400",
  description,
  children,
  maxWidth = "max-w-md",
  testId,
}: ResponsiveModalProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="bg-gray-950 border-gray-800 flex flex-col rounded-t-2xl" data-testid={testId}>
          <DrawerHeader className="p-0 flex-shrink-0">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-600" />
            </div>
            <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-gray-800">
              {Icon && <Icon className={`w-4 h-4 ${iconColor} flex-shrink-0`} />}
              <DrawerTitle className="text-sm font-semibold text-gray-100 flex-1">
                {title}
              </DrawerTitle>
              <button
                onClick={() => onOpenChange(false)}
                className="ml-2 text-gray-500 hover:text-gray-200 transition-colors"
                data-testid={testId ? `${testId}-close` : undefined}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <DrawerDescription className="sr-only">
              {description || title}
            </DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pt-3 pb-4 min-h-0">
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${maxWidth} bg-gray-900 border-gray-700`} data-testid={testId}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            {Icon && <Icon className={`w-4 h-4 ${iconColor}`} />}
            {title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {description || title}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

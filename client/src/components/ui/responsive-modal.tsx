import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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

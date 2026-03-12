import { ChevronDown, X, Package, ShoppingCart, TrendingUp, Megaphone } from "lucide-react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import InventoryDetail from "./details/InventoryDetail";
import OrderDetail from "./details/OrderDetail";
import SalesDetail from "./details/SalesDetail";
import MarketingDetail from "./details/MarketingDetail";

export type DetailType = 'inventory' | 'order' | 'sales' | 'marketing';

export interface DetailData {
  type: DetailType;
  data: any;
  initialTab?: string;
}

interface DetailModalProps {
  open: boolean;
  onClose: () => void;
  detail: DetailData | null;
  onOrderSelect?: (orderId: string) => void;
  onBrickLinkClick?: (url: string) => void;
  inline?: boolean;
}

const titleConfig: Record<DetailType, { icon: typeof Package; label: string; color: string }> = {
  inventory: { icon: Package, label: 'Inventory Detail', color: 'text-blue-400' },
  order: { icon: ShoppingCart, label: 'Order Detail', color: 'text-orange-400' },
  sales: { icon: TrendingUp, label: 'Sales Detail', color: 'text-green-400' },
  marketing: { icon: Megaphone, label: 'Marketing Detail', color: 'text-yellow-400' },
};

export default function DetailModal({ open, onClose, detail, onOrderSelect, onBrickLinkClick, inline }: DetailModalProps) {
  if (!detail) return null;

  const renderDetail = () => {
    switch (detail.type) {
      case 'inventory':
        return <InventoryDetail data={detail.data} onBrickLinkClick={onBrickLinkClick} initialTab={detail.initialTab} />;
      case 'order':
        return <OrderDetail data={detail.data} onOrderSelect={onOrderSelect} />;
      case 'sales':
        return <SalesDetail data={detail.data} />;
      case 'marketing':
        return <MarketingDetail data={detail.data} />;
      default:
        return null;
    }
  };

  if (inline) {
    if (!open) return null;
    const cfg = titleConfig[detail.type];
    const Icon = cfg.icon;
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-1.5">
            <Icon className={`w-5 h-5 ${cfg.color} flex-shrink-0`} />
            <span className="text-sm font-semibold text-gray-200">{cfg.label}</span>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-detail">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {renderDetail()}
        </div>
      </div>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onClose}>
      <DrawerContent className="bg-gray-900 border-gray-700 h-[92vh] flex flex-col">
        <DrawerHeader className="border-b border-gray-700 py-2 flex-shrink-0">
          <div className="flex items-center justify-between">
            <DrawerTitle className="text-sm font-black text-white uppercase tracking-wide">
              {detail.type === 'inventory' ? '🧱 Inventory Detail' :
               detail.type === 'order' ? '📦 Order Detail' :
               detail.type === 'sales' ? '📈 Sales Detail' :
               detail.type === 'marketing' ? '📣 Marketing Detail' : 'Details'}
            </DrawerTitle>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-gray-800 transition-colors"
              data-testid="button-close-detail"
            >
              <ChevronDown className="h-5 w-5 text-gray-400" />
            </button>
          </div>
          <DrawerDescription className="sr-only">
            {detail.type === 'inventory' ? 'View detailed information about this inventory item' :
             detail.type === 'order' ? 'View detailed information about this order' :
             detail.type === 'sales' ? 'View detailed sales analytics' :
             detail.type === 'marketing' ? 'View detailed marketing campaign information' : 'View detailed information'}
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {renderDetail()}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

import { ChevronDown } from "lucide-react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import InventoryDetail from "./details/InventoryDetail";
import OrderDetail from "./details/OrderDetail";
import SalesDetail from "./details/SalesDetail";
import MarketingDetail from "./details/MarketingDetail";

export type DetailType = 'inventory' | 'order' | 'sales' | 'marketing';

export interface DetailData {
  type: DetailType;
  data: any;
}

interface DetailModalProps {
  open: boolean;
  onClose: () => void;
  detail: DetailData | null;
  onOrderSelect?: (orderId: string) => void;
}

export default function DetailModal({ open, onClose, detail, onOrderSelect }: DetailModalProps) {
  if (!detail) return null;

  const renderDetail = () => {
    switch (detail.type) {
      case 'inventory':
        return <InventoryDetail data={detail.data} />;
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

  return (
    <Drawer open={open} onOpenChange={onClose}>
      <DrawerContent className="bg-gray-900 border-gray-700 max-h-[90vh]">
        <DrawerHeader className="border-b border-gray-700 py-2">
          <div className="flex items-center justify-between">
            <DrawerTitle className="text-[10px] font-black text-white uppercase tracking-wide">
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
        <div className="overflow-y-auto p-3">
          {renderDetail()}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

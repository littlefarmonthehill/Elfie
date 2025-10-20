import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { ChevronDown, Package } from "lucide-react";

interface Order {
  id: string;
  orderNumber: string;
  marketplace: string | null;
  orderDate: string;
  orderTotal: string;
  customerUsername: string;
  orderStatus: string;
}

interface PlatformOrdersDrawerProps {
  open: boolean;
  onClose: () => void;
  platform: string;
  orders: Order[];
  onOrderClick: (orderId: string) => void;
}

export default function PlatformOrdersDrawer({ 
  open, 
  onClose, 
  platform, 
  orders,
  onOrderClick 
}: PlatformOrdersDrawerProps) {
  return (
    <Drawer open={open} onOpenChange={onClose}>
      <DrawerContent className="bg-gray-900 border-gray-700 h-[85vh] flex flex-col">
        <DrawerHeader className="border-b border-gray-700 py-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <DrawerTitle className="font-black text-white uppercase tracking-wide">
              📦 {platform} Orders
            </DrawerTitle>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-gray-800 transition-colors"
              data-testid="button-close-platform-orders"
            >
              <ChevronDown className="h-6 w-6 text-gray-400" />
            </button>
          </div>
          <DrawerDescription className="sr-only">
            View all orders from {platform}
          </DrawerDescription>
        </DrawerHeader>
        
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <Package className="h-12 w-12 mb-3 opacity-50" />
              <p className="text-base">No orders from {platform}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {orders
                .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())
                .map(order => (
                  <div
                    key={order.id}
                    onClick={() => onOrderClick(order.id)}
                    className="flex justify-between items-start p-4 rounded-lg bg-gray-800/50 border border-gray-700 hover-elevate active-elevate-2 cursor-pointer"
                    data-testid={`platform-order-${order.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-base md:text-lg font-mono font-bold text-white">#{order.orderNumber}</span>
                        {order.marketplace && (
                          <span className="text-[9px] md:text-xs text-gray-400 bg-gray-700/50 px-2 py-0.5 rounded">
                            {order.marketplace}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] md:text-sm text-gray-400">
                        <span>{order.customerUsername}</span>
                        <span className="text-gray-600">•</span>
                        <span>{new Date(order.orderDate).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-3">
                      <div className="text-base md:text-lg font-mono font-bold text-green-400">
                        ${Number(order.orderTotal).toFixed(2)}
                      </div>
                      <div className="text-[9px] md:text-xs text-gray-500 mt-0.5">
                        {order.orderStatus}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ShoppingCart, Package, TrendingUp, Truck, PackageCheck, X } from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import FulfillmentTool from "./FulfillmentTool";
import ShippedOrdersTool from "./ShippedOrdersTool";

interface Order {
  id: string;
  orderNumber: string;
  orderDate: string;
  orderStatus: string;
  orderTotal: string;
  netTotal: string;
  customerUsername: string;
  items: any[];
}

function OrderAmount({ order }: { order: Order }) {
  const gross = Number(order.orderTotal || 0);
  const net = Number(order.netTotal ?? order.orderTotal ?? 0);
  const hasAdj = Math.abs(gross - net) >= 0.01;
  return (
    <span className="flex flex-col items-end ml-2 flex-shrink-0">
      <span className="text-lego-green font-mono font-medium text-xs md:text-base lg:text-lg">
        ${net.toFixed(2)}
      </span>
      {hasAdj && (
        <span className="text-gray-500 font-mono text-[10px] md:text-xs line-through leading-none">
          ${gross.toFixed(2)}
        </span>
      )}
    </span>
  );
}

interface OrdersDashboardProps {
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
  activeDrawer: 'fulfillment' | 'shipped' | null;
  onDrawerChange: (drawer: 'fulfillment' | 'shipped' | null) => void;
}

export default function OrdersDashboard({ onItemClick, activeDrawer, onDrawerChange }: OrdersDashboardProps) {
  const { data, isLoading } = useQuery<{
    pending: Order[];
    recentShipments: Order[];
    highValue: Order[];
  }>({
    queryKey: ['/api/orders/dashboard'],
  });

  const pendingOrders = data?.pending || [];
  const recentShipments = data?.recentShipments || [];
  const highValueOrders = data?.highValue || [];

  if (isLoading) {
    return (
      <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-orange/5 to-transparent rounded-lg border border-lego-orange/10 shadow-[0_0_15px_rgba(251,146,60,0.1)]">
        <div className="bg-gray-900/50 border border-lego-orange/20 rounded-lg p-2">
          <div className="text-xs text-gray-400 animate-pulse">Loading orders...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-orange/5 to-transparent rounded-lg border border-lego-orange/10 shadow-[0_0_15px_rgba(251,146,60,0.1)]">
      {/* Action Items - Pending Orders */}
      <div className="bg-gray-900/50 border border-orange-500/20 rounded-lg p-3 md:p-5 lg:p-6" data-testid="section-pending-orders">
        <div className="flex items-center gap-1.5 md:gap-2 lg:gap-2.5 mb-2 md:mb-3 lg:mb-4">
          <AlertCircle className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-orange-400" />
          <h3 className="text-xs md:text-base lg:text-lg font-semibold text-orange-400 uppercase tracking-wide">Action Items - Pending Orders</h3>
        </div>
        <div className="space-y-1.5">
          {pendingOrders.length > 0 ? (
            pendingOrders.map((order) => (
              <div 
                key={order.id} 
                onClick={() => onItemClick?.('order', order.id)}
                className="flex justify-between items-center hover-elevate rounded px-2 py-1 cursor-pointer"
                data-testid={`pending-order-${order.id}`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <ShoppingCart className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-orange-400 flex-shrink-0" />
                  <span className="text-gray-200 font-mono text-xs md:text-base lg:text-lg font-medium">#{order.orderNumber}</span>
                  <span className="text-gray-400 text-[11px] md:text-sm lg:text-base">{order.customerUsername}</span>
                </div>
                <OrderAmount order={order} />
              </div>
            ))
          ) : (
            <div className="text-[11px] md:text-sm lg:text-base text-gray-500 italic">No pending orders</div>
          )}
        </div>
      </div>

      {/* Recent Activity - Shipments */}
      <div className="bg-gray-900/50 border border-blue-500/20 rounded-lg p-3 md:p-5 lg:p-6" data-testid="section-recent-shipments">
        <div className="flex items-center gap-1.5 md:gap-2 lg:gap-2.5 mb-2 md:mb-3 lg:mb-4">
          <Package className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-blue-400" />
          <h3 className="text-xs md:text-base lg:text-lg font-semibold text-blue-400 uppercase tracking-wide">Recent Activity - Shipped Orders</h3>
        </div>
        <div className="space-y-1.5">
          {recentShipments.length > 0 ? (
            recentShipments.map((order) => (
              <div 
                key={order.id} 
                onClick={() => onItemClick?.('order', order.id)}
                className="flex justify-between items-center hover-elevate rounded px-2 py-1 cursor-pointer"
                data-testid={`shipped-order-${order.id}`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="w-2.5 h-2.5 md:w-3 md:h-3 lg:w-3.5 lg:h-3.5 rounded-full bg-green-400 flex-shrink-0" />
                  <span className="text-gray-200 font-mono text-xs md:text-base lg:text-lg font-medium">#{order.orderNumber}</span>
                  <span className="text-gray-400 text-[11px] md:text-sm lg:text-base">{order.customerUsername}</span>
                </div>
                <OrderAmount order={order} />
              </div>
            ))
          ) : (
            <div className="text-[11px] md:text-sm lg:text-base text-gray-500 italic">No recent shipments</div>
          )}
        </div>
      </div>

      {/* Highlights - High Value Orders */}
      <div className="bg-gray-900/50 border border-green-500/20 rounded-lg p-3 md:p-5 lg:p-6" data-testid="section-high-value-orders">
        <div className="flex items-center gap-1.5 md:gap-2 lg:gap-2.5 mb-2 md:mb-3 lg:mb-4">
          <TrendingUp className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-green-400" />
          <h3 className="text-xs md:text-base lg:text-lg font-semibold text-green-400 uppercase tracking-wide">Highlights - Top Value Orders</h3>
        </div>
        <div className="space-y-1.5">
          {highValueOrders.length > 0 ? (
            highValueOrders.map((order) => (
              <div 
                key={order.id} 
                onClick={() => onItemClick?.('order', order.id)}
                className="flex justify-between items-center hover-elevate rounded px-2 py-1 cursor-pointer"
                data-testid={`high-value-order-${order.id}`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <TrendingUp className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-green-400 flex-shrink-0" />
                  <span className="text-gray-200 font-mono text-xs md:text-base lg:text-lg font-medium">#{order.orderNumber}</span>
                  <span className="text-gray-400 text-[11px] md:text-sm lg:text-base">{order.customerUsername}</span>
                </div>
                <OrderAmount order={order} />
              </div>
            ))
          ) : (
            <div className="text-[11px] md:text-sm lg:text-base text-gray-500 italic">No orders to display</div>
          )}
        </div>
      </div>

      {/* Fulfillment Drawer */}
      <Drawer open={activeDrawer === 'fulfillment'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[90vh]">
          <DrawerHeader className="relative">
            <DrawerTitle className="flex items-center gap-2 text-base md:text-lg">
              <Truck className="w-5 h-5 text-green-400" />
              Fulfillment and Shipping
            </DrawerTitle>
            <DrawerClose className="absolute right-4 top-4" data-testid="button-close-fulfillment">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DrawerClose>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-4 flex-1">
            <FulfillmentTool />
          </div>
        </DrawerContent>
      </Drawer>

      {/* Shipped Orders Drawer */}
      <Drawer open={activeDrawer === 'shipped'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[90vh]">
          <DrawerHeader className="relative">
            <DrawerTitle className="flex items-center gap-2 text-base md:text-lg">
              <PackageCheck className="w-5 h-5 text-green-400" />
              Shipped Orders
            </DrawerTitle>
            <DrawerClose className="absolute right-4 top-4" data-testid="button-close-shipped">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DrawerClose>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-4 flex-1">
            <ShippedOrdersTool />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

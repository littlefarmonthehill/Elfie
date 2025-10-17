import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ShoppingCart, Package, TrendingUp, ClipboardList, Truck, RefreshCw, Ship } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import PicklistTool from "./PicklistTool";
import FulfillmentTool from "./FulfillmentTool";
import OrderPlatformSyncTool from "./OrderPlatformSyncTool";

interface Order {
  id: string;
  orderNumber: string;
  orderDate: string;
  orderStatus: string;
  orderTotal: string;
  customerUsername: string;
  items: any[];
}

interface OrdersDashboardProps {
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
  activeDrawer: 'picklist' | 'fulfillment' | 'platformsync' | 'shipping' | null;
  onDrawerChange: (drawer: 'picklist' | 'fulfillment' | 'platformsync' | 'shipping' | null) => void;
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
      <div className="bg-gray-900/50 border border-orange-500/20 rounded-lg p-3" data-testid="section-pending-orders">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="w-3.5 h-3.5 text-orange-400" />
          <h3 className="text-xs font-semibold text-orange-400 uppercase tracking-wide">Action Items - Pending Orders</h3>
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
                  <ShoppingCart className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                  <span className="text-gray-200 font-mono text-xs font-medium">#{order.orderNumber}</span>
                  <span className="text-gray-400 text-[11px]">{order.customerUsername}</span>
                </div>
                <span className="text-lego-green font-mono font-medium text-xs ml-2 flex-shrink-0">${Number(order.orderTotal || 0).toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-gray-500 italic">No pending orders</div>
          )}
        </div>
      </div>

      {/* Recent Activity - Shipments */}
      <div className="bg-gray-900/50 border border-blue-500/20 rounded-lg p-3" data-testid="section-recent-shipments">
        <div className="flex items-center gap-2 mb-2">
          <Package className="w-3.5 h-3.5 text-blue-400" />
          <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wide">Recent Activity - Shipped Orders</h3>
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
                  <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                  <span className="text-gray-200 font-mono text-xs font-medium">#{order.orderNumber}</span>
                  <span className="text-gray-400 text-[11px]">{order.customerUsername}</span>
                </div>
                <span className="text-lego-green font-mono font-medium text-xs ml-2 flex-shrink-0">${Number(order.orderTotal || 0).toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-gray-500 italic">No recent shipments</div>
          )}
        </div>
      </div>

      {/* Highlights - High Value Orders */}
      <div className="bg-gray-900/50 border border-green-500/20 rounded-lg p-3" data-testid="section-high-value-orders">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-3.5 h-3.5 text-green-400" />
          <h3 className="text-xs font-semibold text-green-400 uppercase tracking-wide">Highlights - Top Value Orders</h3>
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
                  <TrendingUp className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  <span className="text-gray-200 font-mono text-xs font-medium">#{order.orderNumber}</span>
                  <span className="text-gray-400 text-[11px]">{order.customerUsername}</span>
                </div>
                <span className="text-lego-green font-mono font-medium text-xs ml-2 flex-shrink-0">${Number(order.orderTotal).toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-gray-500 italic">No orders to display</div>
          )}
        </div>
      </div>

      {/* Picklist Drawer */}
      <Drawer open={activeDrawer === 'picklist'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[90vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-orange-400" />
              Picklist
            </DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-4 flex-1">
            <PicklistTool />
          </div>
        </DrawerContent>
      </Drawer>

      {/* Fulfillment Drawer */}
      <Drawer open={activeDrawer === 'fulfillment'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[90vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-green-400" />
              Fulfillment
            </DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-4 flex-1">
            <FulfillmentTool />
          </div>
        </DrawerContent>
      </Drawer>

      {/* Platform Order Sync Drawer */}
      <Drawer open={activeDrawer === 'platformsync'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[90vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-blue-400" />
              Sync Orders
            </DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-4 flex-1">
            <OrderPlatformSyncTool />
          </div>
        </DrawerContent>
      </Drawer>

      {/* Shipping Drawer */}
      <Drawer open={activeDrawer === 'shipping'} onOpenChange={(open) => !open && onDrawerChange(null)}>
        <DrawerContent className="h-[90vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <Ship className="w-5 h-5 text-blue-400" />
              Shipping
            </DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-4 flex-1">
            <div className="text-sm text-gray-400">Shipping functionality coming soon...</div>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

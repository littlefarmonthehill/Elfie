import { Package } from "lucide-react";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import { formatDate } from "@/lib/utils";

interface Order {
  id: string;
  orderNumber: string;
  marketplace: string | null;
  orderDate: string;
  orderTotal: string;
  customerUsername: string;
  orderStatus: string;
}

interface OrderGroupProps {
  orders: Order[];
  onOrderClick: (id: string) => void;
}

export function OrderGroup({ orders, onOrderClick }: OrderGroupProps) {
  const tz = useOrgTimezone();
  return (
    <div className="space-y-1">
      {orders.map((order) => {
        const formattedDate = formatDate(order.orderDate, tz, { 
          month: 'short', 
          day: 'numeric',
          year: 'numeric' 
        });
        
        return (
          <div
            key={order.id}
            onClick={() => onOrderClick(order.id)}
            className="flex items-center justify-between p-2 rounded-lg bg-purple-900/20 border border-purple-500/30 hover:bg-purple-900/30 transition-colors cursor-pointer group"
            data-testid={`chat-order-${order.id}`}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Package className="w-4 h-4 text-purple-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-semibold text-white">
                    #{order.orderNumber}
                  </span>
                  {order.marketplace && (
                    <span className="text-[10px] md:text-sm text-purple-300 bg-purple-900/50 px-1.5 py-0.5 rounded">
                      {order.marketplace}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-400 truncate">
                  {order.customerUsername} · {formattedDate}
                </div>
              </div>
            </div>
            <div className="flex-shrink-0 ml-2">
              <span className="text-sm font-mono font-bold text-purple-400">
                ${Number(order.orderTotal).toFixed(2)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

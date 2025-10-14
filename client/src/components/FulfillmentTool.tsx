import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Truck, Loader2 } from "lucide-react";

type Order = {
  id: string;
  orderNumber: string;
  orderStatus: string;
  marketplace: string | null;
};

type FulfillmentItem = {
  id: string;
  orderId: string;
  orderNumber: string;
  sku: string | null;
  bricklinkPartNumber: string | null;
  name: string;
  quantity: number;
  fulfilled: boolean;
  colorName: string | null;
  condition: string | null;
  binId: number | null;
  binName: string | null;
  shelfName: string | null;
  aisleName: string | null;
};

type FulfillmentData = {
  orders: Order[];
  items: FulfillmentItem[];
};

export default function FulfillmentTool() {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<FulfillmentData>({
    queryKey: ['/api/fulfillment'],
  });

  const fulfillMutation = useMutation({
    mutationFn: async ({ itemId, fulfilled }: { itemId: string; fulfilled: boolean }) => {
      const result = await apiRequest('PUT', `/api/fulfillment/item/${itemId}/fulfill`, { fulfilled });
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment'] });
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment/stats'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!data || data.orders.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center text-gray-400">
          <Truck className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No orders awaiting fulfillment</p>
          <p className="text-xs mt-1">Orders will appear here when they need to be fulfilled</p>
        </div>
      </div>
    );
  }

  // Sort orders alphanumerically
  const sortedOrders = [...data.orders].sort((a, b) => 
    a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true })
  );

  // Filter items based on selected order
  const filteredItems = selectedOrderId 
    ? data.items.filter(item => item.orderId === selectedOrderId)
    : data.items;

  // Group items by bin
  const itemsByBin = filteredItems.reduce((acc, item) => {
    const binKey = item.binId ? `${item.aisleName || 'No Aisle'}-${item.shelfName || 'No Shelf'}-${item.binName}` : 'Unassigned';
    if (!acc[binKey]) {
      acc[binKey] = {
        binId: item.binId,
        binName: item.binName || 'Unassigned',
        aisleName: item.aisleName,
        shelfName: item.shelfName,
        items: [],
      };
    }
    acc[binKey].items.push(item);
    return acc;
  }, {} as Record<string, { binId: number | null; binName: string; aisleName: string | null; shelfName: string | null; items: FulfillmentItem[] }>);

  const handleOrderToggle = (orderId: string) => {
    setSelectedOrderId(prev => prev === orderId ? null : orderId);
  };

  return (
    <div className="space-y-4">
      {/* Orders Section - Filter Toggles */}
      <div>
        <h3 className="text-sm font-bold text-gray-300 mb-3">Order Filters</h3>
        <div className="grid grid-cols-4 gap-2">
          {sortedOrders.map((order) => {
            const isSelected = selectedOrderId === order.id;
            return (
              <div
                key={order.id}
                onClick={() => handleOrderToggle(order.id)}
                className={`border rounded-lg p-2 text-center cursor-pointer transition-colors ${
                  isSelected 
                    ? 'bg-purple-500/20 border-purple-500' 
                    : 'bg-gray-800/50 border-gray-700 hover-elevate'
                }`}
                data-testid={`order-${order.orderNumber}`}
              >
                <p className={`text-xs font-mono font-semibold ${isSelected ? 'text-purple-300' : 'text-white'}`}>
                  {order.orderNumber}
                </p>
                {order.marketplace && (
                  <p className="text-[10px] text-gray-500 mt-0.5">{order.marketplace}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Fulfill Section - Grouped by bin */}
      <div>
        <h3 className="text-sm font-bold text-gray-300 mb-3">Fulfill</h3>
        <div className="space-y-3">
          {Object.entries(itemsByBin).map(([binKey, bin]) => (
            <div key={binKey} className="space-y-2" data-testid={`bin-group-${binKey}`}>
              {/* Bin Header */}
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-2">
                <h4 className="text-xs font-bold text-purple-400">
                  {bin.aisleName && bin.shelfName 
                    ? `${bin.aisleName} › ${bin.shelfName} › ${bin.binName}`
                    : bin.binName}
                </h4>
              </div>

              {/* Items in this bin */}
              {bin.items.map((item) => (
                <div
                  key={item.id}
                  className="ml-4 bg-gray-800/50 border border-gray-700 rounded-lg p-2.5 hover-elevate"
                  data-testid={`fulfillment-item-${item.id}`}
                >
                  <div className="flex items-center gap-3">
                    {/* Fulfill Checkbox */}
                    <Checkbox
                      data-testid={`checkbox-fulfill-${item.id}`}
                      checked={item.fulfilled}
                      onCheckedChange={(checked) => {
                        fulfillMutation.mutate({ itemId: item.id, fulfilled: checked === true });
                      }}
                      disabled={fulfillMutation.isPending}
                    />

                    {/* Item Details */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white">
                        {item.bricklinkPartNumber && `${item.bricklinkPartNumber} - `}{item.name}
                      </p>
                      <p className="text-xs font-bold text-gray-300 mt-0.5">
                        {item.colorName && `${item.colorName} • `}
                        {item.condition && `${item.condition} • `}
                        Qty {item.quantity} • {item.orderNumber}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

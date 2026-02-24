import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Search, Package, Loader2, Printer, Tag, FileText, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PackingSlip from "./PackingSlip";

type ShippedOrder = {
  id: string;
  orderNumber: string;
  orderDate: string;
  shipDate: string | null;
  customerUsername: string | null;
  customerEmail: string | null;
  orderTotal: string;
  marketplace: string | null;
  shipTo: string | null;
  orderStatus: string;
  trackingNumber: string | null;
  carrier: string | null;
  service: string | null;
  labelUrl: string | null;
};

export default function ShippedOrdersTool() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [showPackingSlipDialog, setShowPackingSlipDialog] = useState(false);
  const [packingSlipData, setPackingSlipData] = useState<any[]>([]);

  const { data: shippedOrders, isLoading } = useQuery<ShippedOrder[]>({
    queryKey: ['/api/orders/shipped', searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }
      const response = await fetch(`/api/orders/shipped?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch shipped orders');
      return response.json();
    },
  });

  const handlePrintPackingSlip = async (orderId: string) => {
    try {
      const response = await fetch('/api/fulfillment/packing-slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: [orderId] }),
      });
      
      const data = await response.json();
      setPackingSlipData(data);
      setShowPackingSlipDialog(true);
      
      setTimeout(() => {
        window.print();
      }, 500);
    } catch (error) {
      console.error('Error fetching packing slip data:', error);
      toast({
        title: "Error",
        description: "Failed to generate packing slip",
        variant: "destructive",
      });
    }
  };

  const handlePrintShippingLabel = (order: ShippedOrder) => {
    if (order.labelUrl) {
      window.open(order.labelUrl, '_blank');
    } else {
      toast({
        title: "No Label Available",
        description: "This order doesn't have a shipping label URL.",
        variant: "destructive",
      });
    }
  };

  const handlePrintLotLabels = (orderId: string) => {
    toast({
      title: "Lot Labels",
      description: "Lot label printing will be implemented soon. This feature is coming in a future update.",
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Search Bar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search by order number, customer, or tracking number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-shipped-orders"
            />
          </div>
        </div>

        {/* Results Count */}
        {shippedOrders && shippedOrders.length > 0 && (
          <div className="text-sm text-gray-400 flex items-center gap-2">
            <span>Showing {shippedOrders.length} shipped {shippedOrders.length === 1 ? 'order' : 'orders'}</span>
            {!searchQuery.trim() && shippedOrders.length >= 200 && (
              <span className="text-xs text-gray-500">(most recent 200 — search to find older orders)</span>
            )}
          </div>
        )}

        {/* Shipped Orders List */}
        {!shippedOrders || shippedOrders.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center text-gray-400">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">
                {searchQuery.trim() ? 'No shipped orders found matching your search' : 'No shipped orders found'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {shippedOrders.map((order) => {
              let shipTo: any = {};
              try {
                shipTo = typeof order.shipTo === 'string' ? JSON.parse(order.shipTo) : order.shipTo;
              } catch (e) {
                console.error('Error parsing shipTo:', e);
              }

              return (
                <div
                  key={order.id}
                  className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 hover-elevate"
                  data-testid={`shipped-order-${order.orderNumber}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Order Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-sm font-mono font-bold text-white">
                          {order.orderNumber}
                        </h3>
                        {order.marketplace && (
                          <Badge variant="outline" className="text-xs">
                            {order.marketplace}
                          </Badge>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-400">
                        <div>
                          <span className="text-gray-500">Customer:</span>{' '}
                          {order.customerUsername || shipTo.name || 'Unknown'}
                        </div>
                        <div>
                          <span className="text-gray-500">Ship Date:</span>{' '}
                          {order.shipDate ? format(new Date(order.shipDate), 'MMM d, yyyy') : 'N/A'}
                        </div>
                        <div>
                          <span className="text-gray-500">Total:</span> ${order.orderTotal}
                        </div>
                        {order.trackingNumber && (
                          <div className="truncate">
                            <span className="text-gray-500">Tracking:</span>{' '}
                            <span className="font-mono">{order.trackingNumber}</span>
                          </div>
                        )}
                      </div>
                      
                      {order.carrier && order.service && (
                        <div className="mt-2 text-xs text-gray-500">
                          {order.carrier} • {order.service}
                        </div>
                      )}
                    </div>

                    {/* Actions Dropdown */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`button-actions-${order.orderNumber}`}
                        >
                          <Printer className="w-3.5 h-3.5 mr-1.5" />
                          Print
                          <ChevronDown className="w-3.5 h-3.5 ml-1.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem
                          onClick={() => handlePrintPackingSlip(order.id)}
                          data-testid={`menu-print-packing-slip-${order.orderNumber}`}
                        >
                          <FileText className="w-4 h-4 mr-2" />
                          Print Packing Slip
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handlePrintShippingLabel(order)}
                          disabled={!order.labelUrl}
                          data-testid={`menu-print-shipping-label-${order.orderNumber}`}
                        >
                          <Package className="w-4 h-4 mr-2" />
                          Print Shipping Label
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handlePrintLotLabels(order.id)}
                          data-testid={`menu-print-lot-labels-${order.orderNumber}`}
                        >
                          <Tag className="w-4 h-4 mr-2" />
                          Print Lot Labels
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Packing Slip Dialog */}
      <Dialog open={showPackingSlipDialog} onOpenChange={setShowPackingSlipDialog}>
        <DialogContent className="max-w-none w-auto max-h-[90vh] overflow-y-auto print:max-w-none print:max-h-none">
          <DialogHeader className="print:hidden">
            <DialogTitle>Packing Slip</DialogTitle>
          </DialogHeader>
          <PackingSlip orders={packingSlipData} />
        </DialogContent>
      </Dialog>
    </>
  );
}

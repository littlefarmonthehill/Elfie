import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator 
} from "@/components/ui/dropdown-menu";
import { Truck, Loader2, Printer, AlertTriangle, ChevronDown, Tag, MoreVertical, Scissors, Package, ExternalLink, CheckCircle2, Star } from "lucide-react";
import { printPackingSlips } from "./PackingSlip";
import { useToast } from "@/hooks/use-toast";
import InlineShippingCard, { ShippingReadyState, PurchasedLabelResult, OrderItem } from "./InlineShippingCard";

type BatchResult = {
  orderId: string;
  orderNumber: string;
} & PurchasedLabelResult;

type Order = {
  id: string;
  orderNumber: string;
  orderStatus: string;
  marketplace: string | null;
  customerUsername: string | null;
  shipTo: any;
  orderDate: string | null;
  requestedShippingService: string | null;
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

function cleanItemName(name: string, partNumber: string | null | undefined): string {
  if (!name || !partNumber) return name || '';
  const prefix = `${partNumber} - `;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

export default function FulfillmentTool() {
  const { toast } = useToast();
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [showLotLabelsDialog, setShowLotLabelsDialog] = useState(false);
  const [lotLabelsData, setLotLabelsData] = useState<any[]>([]);

  // Batch shipping state
  const [readyToShip, setReadyToShip] = useState<Map<string, ShippingReadyState>>(new Map());
  const [purchasedLabels, setPurchasedLabels] = useState<Map<string, PurchasedLabelResult>>(new Map());
  const [isShippingAll, setIsShippingAll] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);

  // Split order state
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [selectedItemsForSplit, setSelectedItemsForSplit] = useState<Set<string>>(new Set());
  const [showSplitConfirmDialog, setShowSplitConfirmDialog] = useState(false);
  const [splitOrderNumber, setSplitOrderNumber] = useState<string>("");

  const { data, isLoading } = useQuery<FulfillmentData>({
    queryKey: ['/api/fulfillment'],
  });

  // Fetch settings to determine EasyPost key mode
  const { data: settings } = useQuery<any>({
    queryKey: ['/api/settings'],
  });

  const fulfillMutation = useMutation({
    mutationFn: async ({ itemId, fulfilled }: { itemId: string; fulfilled: boolean }) => {
      const result = await apiRequest('PUT', `/api/fulfillment/item/${itemId}/fulfill`, { fulfilled });
      return result;
    },
    onMutate: async ({ itemId, fulfilled }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['/api/fulfillment'] });
      
      // Snapshot the previous value
      const previousData = queryClient.getQueryData<FulfillmentData>(['/api/fulfillment']);
      
      // Optimistically update the cache
      if (previousData) {
        queryClient.setQueryData<FulfillmentData>(['/api/fulfillment'], {
          ...previousData,
          items: previousData.items.map(item => 
            item.id === itemId ? { ...item, fulfilled } : item
          ),
        });
      }
      
      // Return context with snapshot
      return { previousData };
    },
    onError: (err, variables, context) => {
      // Rollback to previous data on error
      if (context?.previousData) {
        queryClient.setQueryData(['/api/fulfillment'], context.previousData);
      }
    },
    onSuccess: () => {
      // Only update stats, don't refetch the main data
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
  const sortedOrders = [...data.orders].sort((a, b) => {
    const dateA = a.orderDate ? new Date(a.orderDate).getTime() : 0;
    const dateB = b.orderDate ? new Date(b.orderDate).getTime() : 0;
    return dateA - dateB;
  });

  // Derived: single selected order (for ship/split actions that need exactly one)
  const selectedOrderId = selectedOrders.size === 1 ? [...selectedOrders][0] : null;

  // Filter items: show items for all selected orders, or all items if none selected
  const filteredItems = selectedOrders.size > 0
    ? data.items.filter(item => selectedOrders.has(item.orderId))
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
    setSelectedOrders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectedOrders.size === sortedOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(sortedOrders.map(o => o.id)));
    }
  };

  const handlePrintPackingSlips = async (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    
    try {
      const response = await fetch('/api/fulfillment/packing-slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds }),
      });
      
      const data = await response.json();
      await printPackingSlips(data);
    } catch (error) {
      console.error('Error fetching packing slip data:', error);
      toast({
        title: "Error",
        description: "Failed to generate packing slips. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handlePrintLotLabels = async (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    
    toast({
      title: "Lot Labels",
      description: "Lot label printing will be implemented soon. This feature is coming in a future update.",
    });
    
    // Placeholder for future implementation
    // TODO: Implement lot labels API endpoint and printing logic
    // try {
    //   const response = await fetch('/api/fulfillment/lot-labels', {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ orderIds }),
    //   });
    //   
    //   const data = await response.json();
    //   setLotLabelsData(data);
    //   setShowLotLabelsDialog(true);
    //   
    //   setTimeout(() => {
    //     window.print();
    //   }, 500);
    // } catch (error) {
    //   console.error('Error fetching lot labels data:', error);
    // }
  };

  const handleReadyChange = (orderId: string, state: ShippingReadyState | null) => {
    setReadyToShip(prev => {
      const next = new Map(prev);
      if (state) {
        next.set(orderId, state);
      } else {
        next.delete(orderId);
      }
      return next;
    });
  };

  const handleShipAll = async () => {
    if (readyToShip.size === 0) return;
    setIsShippingAll(true);
    const results: BatchResult[] = [];
    const labelMap = new Map<string, PurchasedLabelResult>();

    const orderIds = [...readyToShip.keys()];
    await Promise.allSettled(
      orderIds.map(async (orderId) => {
        const ready = readyToShip.get(orderId)!;
        const order = data?.orders.find(o => o.id === orderId);
        try {
          // Save weight
          if (ready.weight !== "") {
            await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ weight: Number(ready.weight), weightUnits: ready.weightUnits }),
            });
          }
          // Purchase label
          const result: any = await apiRequest("POST", "/api/shipments/purchase", {
            orderId,
            shipmentId: ready.shipmentId,
            rateId: ready.rateId,
          });
          const label: PurchasedLabelResult = {
            trackingNumber: result.shipment?.trackingNumber || result.trackingNumber || "",
            labelUrl: result.shipment?.labelUrl || result.labelUrl,
            carrier: ready.selectedRate.carrier,
            service: ready.selectedRate.service,
            rate: ready.selectedRate.rate,
          };
          labelMap.set(orderId, label);
          results.push({ orderId, orderNumber: order?.orderNumber || orderId, ...label });
        } catch (e: any) {
          results.push({
            orderId,
            orderNumber: order?.orderNumber || orderId,
            trackingNumber: "",
            carrier: ready.selectedRate.carrier,
            service: ready.selectedRate.service,
            rate: ready.selectedRate.rate,
          });
          toast({ title: `Failed: ${order?.orderNumber}`, description: e.message, variant: "destructive" });
        }
      })
    );

    setPurchasedLabels(labelMap);
    setBatchResults(results);
    setReadyToShip(new Map());
    setIsShippingAll(false);

    queryClient.invalidateQueries({ queryKey: ["/api/fulfillment"] });
    queryClient.invalidateQueries({ queryKey: ["/api/fulfillment/stats"] });
    queryClient.invalidateQueries({ queryKey: ["/api/orders/dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["/api/orders/shipped"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });

    const successes = results.filter(r => r.trackingNumber).length;
    toast({
      title: `${successes} of ${results.length} labels purchased`,
      description: successes === results.length ? "All labels ready to print." : "Some labels failed — check the results.",
      variant: successes === results.length ? "default" : "destructive",
    });
  };

  const handleInitiateSplit = () => {
    if (!selectedOrderId) {
      toast({
        title: "No Order Selected",
        description: "Please select an order to split.",
        variant: "destructive",
      });
      return;
    }
    
    setIsSplitMode(true);
    setSelectedItemsForSplit(new Set());
  };

  const handleCancelSplit = () => {
    setIsSplitMode(false);
    setSelectedItemsForSplit(new Set());
  };

  const handleItemSplitToggle = (itemId: string) => {
    setSelectedItemsForSplit(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const handleConfirmSplit = () => {
    if (!selectedOrderId || selectedItemsForSplit.size === 0) {
      toast({
        title: "No Items Selected",
        description: "Please select at least one item to split.",
        variant: "destructive",
      });
      return;
    }

    // Get the current order number
    const currentOrder = data?.orders.find(o => o.id === selectedOrderId);
    if (!currentOrder) return;

    // Generate new order number with -1 suffix
    const newOrderNumber = `${currentOrder.orderNumber}-1`;
    setSplitOrderNumber(newOrderNumber);
    setShowSplitConfirmDialog(true);
  };

  const handleExecuteSplit = async () => {
    if (!selectedOrderId || selectedItemsForSplit.size === 0 || !data) return;

    try {
      // Calculate itemIdsToKeep (all order items except the selected ones)
      const orderItems = data.items.filter(item => item.orderId === selectedOrderId);
      const itemIdsToKeep = orderItems
        .filter(item => !selectedItemsForSplit.has(item.id))
        .map(item => item.id);

      await apiRequest('POST', `/api/orders/${selectedOrderId}/split`, {
        itemIdsToKeep
      });

      toast({
        title: "Order Split Successful",
        description: `Items moved to order ${splitOrderNumber}`,
      });

      // Reset state
      setShowSplitConfirmDialog(false);
      setIsSplitMode(false);
      setSelectedItemsForSplit(new Set());
      
      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment'] });
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment/stats'] });
    } catch (error: any) {
      console.error('Error splitting order:', error);
      toast({
        title: "Split Failed",
        description: error.message || "Failed to split order. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      {/* ── Two-column layout on lg+ (iPad Pro / Mac), single column on mobile ── */}
      <div className="flex flex-col lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start gap-4">

        {/* ═══ LEFT COLUMN: Controls + Orders + Order Details ═══ */}
        <div className="space-y-4">

          {/* Print & Ship Controls */}
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleSelectAll}
                data-testid="button-select-all"
              >
                {selectedOrders.size === sortedOrders.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>
            <div className="flex gap-2 flex-wrap">
              {isSplitMode && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancelSplit}
                    data-testid="button-cancel-split"
                  >
                    Cancel Split
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleConfirmSplit}
                    disabled={selectedItemsForSplit.size === 0}
                    data-testid="button-confirm-split"
                  >
                    <Scissors className="w-3.5 h-3.5 mr-1.5" />
                    Confirm Split ({selectedItemsForSplit.size})
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Orders Section */}
          <div>
            <h3 className="text-sm lg:text-lg font-bold text-gray-300 mb-3">Orders</h3>
            <div className="grid grid-cols-4 lg:grid-cols-3 gap-2 lg:gap-3">
              {sortedOrders.map((order) => {
                const isSelected = selectedOrders.has(order.id);
                const lotCount = data?.items.filter(i => i.orderId === order.id).length ?? 0;
                const isPriority = !!(order.requestedShippingService &&
                  /priority|express|overnight|expedited|2-day|2nd.day|next.day|same.day|rush/i.test(order.requestedShippingService));
                const formattedDate = order.orderDate
                  ? new Date(order.orderDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : null;
                const fullName: string = (order.shipTo as any)?.name || order.customerUsername || '';
                const lastName = fullName.trim().split(' ').pop() || '';
                return (
                  <div
                    key={order.id}
                    onClick={() => handleOrderToggle(order.id)}
                    className={`relative border rounded-lg p-2 lg:p-3 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-purple-500/20 border-purple-500'
                        : isPriority
                          ? 'bg-amber-950/20 border-amber-500/50 hover-elevate'
                          : 'bg-gray-800/50 border-gray-700 hover-elevate'
                    }`}
                    data-testid={`order-${order.orderNumber}`}
                  >
                    {isPriority && (
                      <div className="absolute -top-2 -right-2 w-5 h-5 lg:w-6 lg:h-6 bg-amber-400 rounded-full flex items-center justify-center shadow-md z-10">
                        <Star className="w-3 h-3 lg:w-3.5 lg:h-3.5 fill-amber-900 text-amber-900" />
                      </div>
                    )}
                    <p className={`text-[9px] lg:text-xs font-mono font-semibold leading-tight ${isSelected ? 'text-purple-300' : 'text-white'}`}>
                      {order.orderNumber}
                    </p>
                    {(lastName || order.marketplace) && (
                      <p className="text-[10px] lg:text-sm text-gray-300 truncate mt-0.5">
                        {lastName || order.marketplace}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-1 lg:mt-2">
                      <span className="text-[10px] lg:text-xs text-gray-400">{formattedDate}</span>
                      {lotCount > 0 && (
                        <span className="w-[18px] h-[18px] lg:w-6 lg:h-6 rounded-full bg-blue-700/80 flex items-center justify-center text-[9px] lg:text-[11px] font-bold text-white tabular-nums shrink-0">
                          {lotCount}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
        {/* ═══ end LEFT COLUMN ═══ */}

        {/* ═══ RIGHT COLUMN: Batch Results + Shipping Cards ═══ */}
        <div className="space-y-4">

          {/* Batch Labels Results Panel */}
          {batchResults.length > 0 && (
            <div className="border border-green-500/40 rounded-lg overflow-hidden bg-green-950/20">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-green-500/30 bg-green-900/20">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  <span className="text-sm font-bold text-green-300">
                    {batchResults.filter(r => r.trackingNumber).length} of {batchResults.length} Labels Purchased
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-green-500/40 text-green-300"
                    onClick={() => {
                      batchResults.forEach(r => {
                        if (r.labelUrl) window.open(r.labelUrl, "_blank");
                      });
                    }}
                    data-testid="button-print-all-labels"
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                    Open All Labels
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-gray-500"
                    onClick={() => {
                      setBatchResults([]);
                      setPurchasedLabels(new Map());
                      setSelectedOrders(new Set());
                    }}
                    data-testid="button-dismiss-batch-results"
                  >
                    Done
                  </Button>
                </div>
              </div>
              <div className="divide-y divide-green-900/30">
                {batchResults.map((result) => (
                  <div key={result.orderId} className="flex items-center gap-3 px-3 py-2 flex-wrap">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-white">{result.orderNumber}</span>
                          {result.carrier && result.service && (
                            <span className="text-xs text-gray-400">{result.carrier} {result.service}</span>
                          )}
                          {result.rate != null && (
                            <span className="text-xs font-semibold text-green-300">${result.rate.toFixed(2)}</span>
                          )}
                        </div>
                        {result.trackingNumber ? (
                          <p className="text-[11px] font-mono text-gray-300 mt-0.5">{result.trackingNumber}</p>
                        ) : (
                          <p className="text-[11px] text-red-400 mt-0.5">Purchase failed</p>
                        )}
                      </div>
                      {result.labelUrl && (
                        <Button asChild variant="outline" size="sm" className="shrink-0 border-green-500/40 text-green-300">
                          <a href={result.labelUrl} target="_blank" rel="noopener noreferrer" data-testid={`button-label-${result.orderId}`}>
                            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                            Label
                          </a>
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Inline Shipping Panel — one card per selected order */}
            {selectedOrders.size > 0 && (
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="text-sm lg:text-base font-bold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                    <Truck className="w-4 h-4 text-purple-400" />
                    Shipping
                  </h3>
                  {!isSplitMode && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={selectedOrders.size === 0}
                          data-testid="button-actions-menu"
                        >
                          <MoreVertical className="w-3.5 h-3.5 mr-1.5" />
                          Actions
                          <ChevronDown className="w-3.5 h-3.5 ml-1.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {readyToShip.size > 0 && (
                          <>
                            <DropdownMenuItem
                              onClick={handleShipAll}
                              disabled={isShippingAll}
                              data-testid="menu-ship-all"
                            >
                              {isShippingAll
                                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Shipping...</>
                                : <><Package className="w-4 h-4 mr-2" />Ship All ({readyToShip.size})</>
                              }
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        <DropdownMenuItem
                          onClick={() => handlePrintPackingSlips(Array.from(selectedOrders))}
                          disabled={selectedOrders.size === 0}
                          data-testid="menu-print-packing-slips"
                        >
                          <Printer className="w-4 h-4 mr-2" />
                          Print Packing Slips
                          {selectedOrders.size > 0 && (
                            <Badge variant="secondary" className="ml-auto text-xs">
                              {selectedOrders.size}
                            </Badge>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handlePrintLotLabels(Array.from(selectedOrders))}
                          disabled={selectedOrders.size === 0}
                          data-testid="menu-print-lot-labels"
                        >
                          <Tag className="w-4 h-4 mr-2" />
                          Print Lot Labels
                          {selectedOrders.size > 0 && (
                            <Badge variant="secondary" className="ml-auto text-xs">
                              {selectedOrders.size}
                            </Badge>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={handleInitiateSplit}
                          disabled={!selectedOrderId}
                          data-testid="menu-split-order"
                        >
                          <Scissors className="w-4 h-4 mr-2" />
                          Split Order
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <div className="space-y-2">
                  {[...selectedOrders].map((orderId) => {
                    const items: OrderItem[] = (data?.items ?? [])
                      .filter(item => item.orderId === orderId)
                      .map(item => ({
                        id: item.id,
                        sku: item.sku,
                        bricklinkPartNumber: item.bricklinkPartNumber,
                        name: item.name,
                        quantity: item.quantity,
                        colorName: item.colorName,
                        condition: item.condition,
                        binName: item.binName,
                      }));
                    return (
                      <InlineShippingCard
                        key={orderId}
                        orderId={orderId}
                        isTestMode={settings?.easypostKeyMode === 'test'}
                        onReadyChange={handleReadyChange}
                        purchasedLabel={purchasedLabels.get(orderId)}
                        orderItems={items}
                      />
                    );
                  })}
                </div>
              </div>
            )}

          </div>
          {/* ═══ end RIGHT COLUMN ═══ */}

        </div>
        {/* ═══ end two-column grid ═══ */}

      {/* ═══ Order Details - full width below both columns ═══ */}
      <div className="space-y-3 mt-2">
        <h3 className="text-sm lg:text-base font-bold text-gray-300">Order Details</h3>
        {Object.entries(itemsByBin).map(([binKey, bin]) => (
          <div key={binKey} className="space-y-2" data-testid={`bin-group-${binKey}`}>
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-2 lg:p-3">
              <h4 className="text-xs lg:text-sm font-bold text-purple-400">
                {bin.aisleName && bin.shelfName
                  ? `${bin.aisleName} › ${bin.shelfName} › ${bin.binName}`
                  : bin.binName}
              </h4>
            </div>
            {bin.items.map((item) => (
              <div
                key={item.id}
                className="ml-4 bg-gray-800/50 border border-gray-700 rounded-lg p-2.5 lg:p-3 hover-elevate"
                data-testid={`fulfillment-item-${item.id}`}
              >
                <div className="flex items-center gap-3">
                  {isSplitMode && (
                    <Checkbox
                      data-testid={`checkbox-split-${item.id}`}
                      checked={selectedItemsForSplit.has(item.id)}
                      onCheckedChange={() => handleItemSplitToggle(item.id)}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs lg:text-sm font-medium text-white">
                      {item.bricklinkPartNumber && `${item.bricklinkPartNumber} - `}{cleanItemName(item.name, item.bricklinkPartNumber)}
                    </p>
                    <p className="text-xs lg:text-sm font-bold text-gray-300 mt-0.5">
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

      {/* Lot Labels Dialog - Placeholder for future implementation */}
      <Dialog open={showLotLabelsDialog} onOpenChange={setShowLotLabelsDialog}>
        <DialogContent className="max-w-none w-auto max-h-[90vh] overflow-y-auto print:max-w-none print:max-h-none">
          <DialogHeader className="print:hidden">
            <DialogTitle>Lot Labels</DialogTitle>
          </DialogHeader>
          <div className="p-8 text-center">
            <Tag className="w-16 h-16 mx-auto mb-4 text-gray-400" />
            <p className="text-gray-400">Lot label printing will be implemented soon.</p>
            <p className="text-sm text-gray-500 mt-2">This feature is coming in a future update.</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Split Order Confirmation Dialog */}
      <Dialog open={showSplitConfirmDialog} onOpenChange={setShowSplitConfirmDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scissors className="w-5 h-5 text-orange-500" />
              Confirm Order Split
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Alert className="bg-orange-500/10 border-orange-500/30">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <AlertDescription className="text-orange-200">
                <p className="font-semibold mb-1">This action will split the order:</p>
                <p className="text-sm">
                  Current order: <span className="font-mono">{data?.orders.find(o => o.id === selectedOrderId)?.orderNumber}</span>
                  <br />
                  New order: <span className="font-mono">{splitOrderNumber}</span>
                </p>
              </AlertDescription>
            </Alert>

            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
              <p className="text-sm font-semibold text-gray-300 mb-2">
                Items moving to {splitOrderNumber}:
              </p>
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {data?.items
                  .filter(item => selectedItemsForSplit.has(item.id))
                  .map(item => (
                    <div key={item.id} className="text-xs text-gray-400 bg-gray-900/50 rounded px-2 py-1">
                      {item.bricklinkPartNumber && `${item.bricklinkPartNumber} - `}
                      {item.name}
                      {item.colorName && ` • ${item.colorName}`}
                      {item.condition && ` • ${item.condition}`}
                      {` • Qty ${item.quantity}`}
                    </div>
                  ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowSplitConfirmDialog(false)}
                data-testid="button-cancel-split-confirm"
              >
                Cancel
              </Button>
              <Button
                onClick={handleExecuteSplit}
                className="bg-orange-600 hover:bg-orange-700"
                data-testid="button-execute-split"
              >
                <Scissors className="w-4 h-4 mr-2" />
                Split Order
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </>
  );
}

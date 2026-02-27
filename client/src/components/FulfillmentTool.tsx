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
import { Truck, Loader2, Printer, AlertTriangle, ChevronDown, Tag, MoreVertical, Scissors, Package, ExternalLink, CheckCircle2, Star, ClipboardList, PackageCheck, ScanLine } from "lucide-react";
import { printPackingSlips } from "./PackingSlip";
import { useToast } from "@/hooks/use-toast";
import { cleanItemName, PRIORITY_REGEX, toggleSetItem } from "@/lib/item-utils";
import InlineShippingCard, { ShippingReadyState, PurchasedLabelResult, OrderItem } from "./InlineShippingCard";
import PicklistTool from "./PicklistTool";

type BatchResult = {
  orderId: string;
  orderNumber: string;
} & PurchasedLabelResult;

type PicklistBinItem = {
  picklistItemId: string;
  orderId: string;
  orderNumber: string;
  marketplace: string | null;
  itemName: string;
  quantity: number;
  sku: string;
  partNumber: string | null;
  colorName: string | null;
  condition: string | null;
  pulled: boolean;
  inventoryId: number | null;
  remarks: string | null;
  inventoryQty: number | null;
};
type PicklistBin = { items: PicklistBinItem[] };

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

// ── Fulfillment checklist sub-component (part-grouped view of pulled items) ──
interface FulfillmentChecklistProps {
  pulledItems: PicklistBinItem[];
  selectedOrderIds?: Set<string>;
  fulfilledItems: Set<string>;
  onToggle: (itemId: string) => void;
}

function FulfillmentChecklist({ pulledItems, selectedOrderIds, fulfilledItems, onToggle }: FulfillmentChecklistProps) {
  const visibleItems = selectedOrderIds && selectedOrderIds.size > 0
    ? pulledItems.filter(i => selectedOrderIds.has(i.orderId))
    : pulledItems;

  if (visibleItems.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <PackageCheck className="h-12 w-12 mx-auto mb-3 opacity-40" />
        <p className="font-medium">No picked items to fulfill</p>
        <p className="text-sm mt-1">Items appear here once they have been pulled from the picklist</p>
      </div>
    );
  }

  // Group by part number (or sku fallback), sorted numerically
  const partKey = (item: PicklistBinItem) => item.partNumber || item.sku || '';
  const partGroups = new Map<string, PicklistBinItem[]>();
  for (const item of [...visibleItems].sort((a, b) =>
    partKey(a).localeCompare(partKey(b), undefined, { numeric: true })
  )) {
    const k = partKey(item);
    if (!partGroups.has(k)) partGroups.set(k, []);
    partGroups.get(k)!.push(item);
  }

  return (
    <div className="space-y-2">
      {Array.from(partGroups.entries()).map(([key, variants]) => {
        const allFulfilled = variants.every(v => fulfilledItems.has(v.picklistItemId));
        const someFulfilled = variants.some(v => fulfilledItems.has(v.picklistItemId));
        const rep = variants[0];

        return (
          <div
            key={key}
            className={`rounded-lg border overflow-hidden transition-colors ${
              allFulfilled ? 'border-cyan-800/40' : someFulfilled ? 'border-yellow-700/40' : 'border-gray-700'
            }`}
            data-testid={`fulfill-group-${key}`}
          >
            {/* Part header — no checkbox at group level */}
            <div
              className={`flex items-center gap-2 px-3 py-2 ${
                allFulfilled ? 'bg-cyan-950/30' : someFulfilled ? 'bg-yellow-950/20' : 'bg-gray-800/70'
              }`}
            >
              <div className="flex-1 min-w-0">
                {/* Line 1: part# + color + condition */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-cyan-300 shrink-0">{rep.partNumber || rep.sku}</span>
                  {rep.colorName && (
                    <span className="text-[11px] text-yellow-400">{rep.colorName}</span>
                  )}
                  {rep.condition && (
                    <span className={`text-[11px] ${rep.condition === 'N' ? 'text-green-400' : 'text-orange-400'}`}>
                      {rep.condition === 'N' ? 'New' : rep.condition === 'U' ? 'Used' : rep.condition}
                    </span>
                  )}
                </div>
                {/* Line 2: description (wrapping) */}
                <div className={`text-xs font-medium leading-snug ${allFulfilled ? 'text-gray-500 line-through' : 'text-white'}`}>
                  {rep.itemName}
                </div>
              </div>
              {variants.length > 1 && (
                <span className="shrink-0 text-[10px] font-bold text-gray-400 tabular-nums">
                  {variants.length} lots
                </span>
              )}
            </div>

            {/* Variant rows */}
            <div className="divide-y divide-gray-700/50">
              {variants.map(item => {
                const checked = fulfilledItems.has(item.picklistItemId);
                return (
                  <div
                    key={item.picklistItemId}
                    className={`flex items-start gap-3 px-3 py-1.5 cursor-pointer ${checked ? 'bg-cyan-950/20' : 'bg-gray-900/60'}`}
                    onClick={() => onToggle(item.picklistItemId)}
                    data-testid={`fulfill-item-${item.picklistItemId}`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => onToggle(item.picklistItemId)}
                      onClick={e => e.stopPropagation()}
                      className="shrink-0 touch-auto"
                      data-testid={`checkbox-fulfill-item-${item.picklistItemId}`}
                    />
                    <div className={`flex-1 min-w-0 text-[10px] ${checked ? 'line-through text-gray-500' : ''}`}>
                      <div className="flex items-center gap-2 flex-wrap text-gray-400">
                        <span className="tabular-nums">Qty {item.quantity}</span>
                        {item.inventoryQty != null && !checked && (() => {
                          const stock = item.inventoryQty!;
                          const needed = item.quantity;
                          const isShort = stock < needed;
                          const isExact = stock === needed;
                          return (
                            <span className={`tabular-nums font-semibold ${
                              isShort  ? 'text-red-400' :
                              isExact  ? 'text-yellow-400' :
                                         'text-green-500/80'
                            }`}>
                              ({stock} in stock{isShort ? ' — SHORT' : isExact ? ' — last one' : ''})
                            </span>
                          );
                        })()}
                        <span className="text-gray-600">·</span>
                        <span className="font-mono">{item.marketplace === 'BrickOwl' ? 'BO' : 'BL'}{(item.orderNumber || '').replace(/^(BL|BO)/i, '')}</span>
                        {item.inventoryId && (
                          <span className="font-mono text-blue-400/70">Lot {item.inventoryId}</span>
                        )}
                      </div>
                      {item.remarks && (
                        <div className="text-gray-400 mt-0.5 italic">{item.remarks}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function FulfillmentTool() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'picklist' | 'fulfillment' | 'shipping'>('picklist');
  const [fulfilledItems, setFulfilledItems] = useState<Set<string>>(new Set());
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  // Batch shipping state
  const [readyToShip, setReadyToShip] = useState<Map<string, ShippingReadyState>>(new Map());
  const [purchasedLabels, setPurchasedLabels] = useState<Map<string, PurchasedLabelResult>>(new Map());
  const [isShippingAll, setIsShippingAll] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);

  // End of Day SCAN form state
  const [scanFormUrl, setScanFormUrl] = useState<string | null>(null);

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

  // Today's EasyPost shipments (for End of Day panel)
  const { data: endOfDayData } = useQuery<{ count: number; shipments: any[] }>({
    queryKey: ['/api/shipments/end-of-day'],
    enabled: activeTab === 'shipping',
    staleTime: 30000,
  });

  const scanFormMutation = useMutation({
    mutationFn: async () => apiRequest('POST', '/api/shipments/scan-form', {}),
    onSuccess: (data: any) => {
      if (data?.formUrl) {
        setScanFormUrl(data.formUrl);
        window.open(data.formUrl, '_blank');
        toast({ title: "SCAN Form Ready", description: `Generated for ${data.shipmentCount} shipment${data.shipmentCount !== 1 ? 's' : ''}` });
      }
    },
    onError: (err: any) => {
      toast({ title: "SCAN Form Failed", description: err.message || "Could not generate End of Day form", variant: "destructive" });
    },
  });

  // Per-order picklist pull completion { orderId: allPulled }
  const { data: picklistOrderStatus = {} } = useQuery<Record<string, boolean>>({
    queryKey: ['/api/picklist/order-status'],
    refetchInterval: 3000,
  });

  // All picklist items (for the Fulfillment tab and second-checkmark logic)
  const { data: picklistBins = [] } = useQuery<PicklistBin[]>({
    queryKey: ['/api/picklist'],
    refetchInterval: 60000,
  });
  const allPicklistItems: PicklistBinItem[] = picklistBins.flatMap(b => b.items);
  const pulledItems: PicklistBinItem[] = allPicklistItems.filter(item => item.pulled);

  const toggleFulfilled = (itemId: string) =>
    setFulfilledItems(prev => toggleSetItem(prev, itemId));

  // Is every pulled item for a given order marked fulfilled?
  const isOrderFulfillComplete = (orderId: string) => {
    const orderPulled = pulledItems.filter(i => i.orderId === orderId);
    return orderPulled.length > 0 && orderPulled.every(i => fulfilledItems.has(i.picklistItemId));
  };

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

  // Sort orders by date (oldest first)
  const sortedOrders = [...data.orders].sort((a, b) => {
    const dateA = a.orderDate ? new Date(a.orderDate).getTime() : 0;
    const dateB = b.orderDate ? new Date(b.orderDate).getTime() : 0;
    return dateA - dateB;
  });

  // Derived: single selected order (for ship/split actions that need exactly one)
  const selectedOrderId = selectedOrders.size === 1 ? [...selectedOrders][0] : null;

  const handleOrderToggle = (orderId: string) =>
    setSelectedOrders(prev => toggleSetItem(prev, orderId));

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
      toast({
        title: "Tip: Hide URL & page numbers",
        description: 'In the print dialog, uncheck "Headers and footers" (Chrome) or "Print headers and footers" (Safari/Firefox) for a clean slip.',
        duration: 8000,
      });
    } catch (error) {
      console.error('Error fetching packing slip data:', error);
      toast({
        title: "Error",
        description: "Failed to generate packing slips. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handlePrintLotLabels = (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    toast({ title: "Lot Labels", description: "Lot label printing is coming in a future update." });
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
            await apiRequest("PATCH", `/api/orders/${encodeURIComponent(orderId)}`, {
              weight: Number(ready.weight),
              weightUnits: ready.weightUnits,
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

  const handleItemSplitToggle = (itemId: string) =>
    setSelectedItemsForSplit(prev => toggleSetItem(prev, itemId));

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
      {/* ── Single-column layout: tiles at top, tabbed content below ── */}
      <div className="space-y-4">

        {/* Controls row */}
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

        {/* Orders tiles */}
        <div>
          <h3 className="text-sm lg:text-lg font-bold text-gray-300 mb-3">Orders</h3>
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2 lg:gap-3">
              {sortedOrders.map((order) => {
                const isSelected = selectedOrders.has(order.id);
                const lotCount = data?.items.filter(i => i.orderId === order.id).length ?? 0;
                const isPriority = !!(order.requestedShippingService &&
                  PRIORITY_REGEX.test(order.requestedShippingService));
                const formattedDate = order.orderDate
                  ? new Date(order.orderDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : null;
                const fullName: string = (order.shipTo as any)?.name || order.customerUsername || '';
                const lastName = fullName.trim().split(' ').pop() || '';
                const isPickComplete = !!picklistOrderStatus[order.id];
                const isFulfillComplete = isOrderFulfillComplete(order.id);
                return (
                  <div
                    key={order.id}
                    onClick={() => handleOrderToggle(order.id)}
                    className={`relative border rounded-lg p-2 lg:p-3 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-purple-500/20 border-purple-500'
                        : 'bg-gray-800/50 border-gray-700 hover-elevate'
                    }`}
                    data-testid={`order-${order.orderNumber}`}
                  >
                    {isPriority && (
                      <div className="absolute -top-2 -right-2 w-5 h-5 lg:w-6 lg:h-6 bg-red-600 rounded-full flex items-center justify-center shadow-md z-10">
                        <Star className="w-3 h-3 lg:w-3.5 lg:h-3.5 fill-white text-white" />
                      </div>
                    )}
                    {isPickComplete && (
                      <div className="absolute -top-2 -left-2 w-5 h-5 lg:w-6 lg:h-6 bg-green-500 rounded-full flex items-center justify-center shadow-md z-10">
                        <CheckCircle2 className="w-3 h-3 lg:w-3.5 lg:h-3.5 text-white fill-green-500" />
                      </div>
                    )}
                    {isFulfillComplete && (
                      <div className="absolute -top-2 left-4 lg:left-5 w-5 h-5 lg:w-6 lg:h-6 bg-cyan-500 rounded-full flex items-center justify-center shadow-md z-10">
                        <CheckCircle2 className="w-3 h-3 lg:w-3.5 lg:h-3.5 text-white fill-cyan-500" />
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

        {/* ── Tab switcher: Picklist | Fulfillment | Shipping ── */}
        <div className="flex gap-1 border-b border-gray-700">
          <button
            onClick={() => setActiveTab('picklist')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'picklist'
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
            data-testid="tab-picklist"
          >
            <ClipboardList className="w-4 h-4" />
            Picklist
          </button>
          <button
            onClick={() => setActiveTab('fulfillment')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'fulfillment'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
            data-testid="tab-fulfillment"
          >
            <PackageCheck className="w-4 h-4" />
            Fulfillment
          </button>
          <button
            onClick={() => setActiveTab('shipping')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'shipping'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
            data-testid="tab-shipping"
          >
            <Truck className="w-4 h-4" />
            Shipping
          </button>
        </div>

        {/* ── Tab content ── */}
        {activeTab === 'picklist' ? (
          <PicklistTool filterOrderIds={selectedOrders.size > 0 ? selectedOrders : undefined} />
        ) : activeTab === 'fulfillment' ? (
          <FulfillmentChecklist
            pulledItems={pulledItems}
            selectedOrderIds={selectedOrders.size > 0 ? selectedOrders : undefined}
            fulfilledItems={fulfilledItems}
            onToggle={toggleFulfilled}
          />
        ) : (
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

            {/* Actions bar + Shipping cards — visible when orders are selected */}
            {selectedOrders.size > 0 ? (
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                    <Truck className="w-4 h-4 text-purple-400" />
                    Selected Orders
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
                        {readyToShip.size > 0 && (
                          <>
                            <DropdownMenuSeparator />
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
                          </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            if (scanFormUrl) {
                              window.open(scanFormUrl, '_blank');
                            } else {
                              scanFormMutation.mutate();
                            }
                          }}
                          disabled={scanFormMutation.isPending || (endOfDayData?.count === 0 && !scanFormUrl)}
                          data-testid="menu-end-of-day-scan"
                        >
                          {scanFormMutation.isPending
                            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</>
                            : scanFormUrl
                              ? <><ExternalLink className="w-4 h-4 mr-2" />Reopen SCAN Form</>
                              : <><ScanLine className="w-4 h-4 mr-2" />End of Day SCAN Form</>
                          }
                          {!scanFormUrl && endOfDayData && endOfDayData.count > 0 && (
                            <Badge variant="secondary" className="ml-auto text-xs">
                              {endOfDayData.count}
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
            ) : (
              <p className="text-sm text-gray-500 text-center py-8">Select orders above to see shipping options.</p>
            )}

          </div>
        )}

      </div>

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

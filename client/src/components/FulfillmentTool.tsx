import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator 
} from "@/components/ui/dropdown-menu";
import { Truck, Loader2, Printer, CheckSquare, Square, Package, AlertTriangle, ChevronDown, Tag, MoreVertical, Scissors } from "lucide-react";
import PackingSlip from "./PackingSlip";
import { useToast } from "@/hooks/use-toast";

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
  const { toast } = useToast();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrdersForPrint, setSelectedOrdersForPrint] = useState<Set<string>>(new Set());
  const [showPackingSlipDialog, setShowPackingSlipDialog] = useState(false);
  const [packingSlipData, setPackingSlipData] = useState<any[]>([]);
  const [showLotLabelsDialog, setShowLotLabelsDialog] = useState(false);
  const [lotLabelsData, setLotLabelsData] = useState<any[]>([]);
  
  // Shipping state
  const [showShippingDialog, setShowShippingDialog] = useState(false);
  const [shippingStep, setShippingStep] = useState<'preview' | 'rates' | 'label'>('preview');
  const [selectedOrderForShipping, setSelectedOrderForShipping] = useState<string | null>(null);
  const [shippingRates, setShippingRates] = useState<any[]>([]);
  const [selectedRate, setSelectedRate] = useState<string | null>(null);
  const [shipmentData, setShipmentData] = useState<any>(null);
  const [splitPreview, setSplitPreview] = useState<any>(null);
  const [isLoadingShipping, setIsLoadingShipping] = useState(false);

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

  const handlePrintSelection = (orderId: string) => {
    setSelectedOrdersForPrint(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  };

  const handleSelectAllForPrint = () => {
    if (selectedOrdersForPrint.size === sortedOrders.length) {
      setSelectedOrdersForPrint(new Set());
    } else {
      setSelectedOrdersForPrint(new Set(sortedOrders.map(o => o.id)));
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
      setPackingSlipData(data);
      setShowPackingSlipDialog(true);
      
      // Trigger print after a small delay to ensure dialog is rendered
      setTimeout(() => {
        window.print();
      }, 500);
    } catch (error) {
      console.error('Error fetching packing slip data:', error);
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

  const handleInitiateShipping = async (orderId: string | null) => {
    if (!orderId || !data) return;
    
    // Get all items for this order - assume all items should ship together
    const orderItems = data.items.filter(item => item.orderId === orderId);
    const allItemIds = orderItems.map(item => item.id);
    
    setSelectedOrderForShipping(orderId);
    setShippingStep('preview');
    setShowShippingDialog(true);
    setIsLoadingShipping(true);
    
    // Check if split is needed
    try {
      const result = await apiRequest('POST', '/api/shipments/preview', {
        orderId,
        itemIdsToShip: allItemIds
      });
      setSplitPreview(result);
    } catch (error: any) {
      console.error('Error previewing shipment:', error);
      toast({
        title: "Preview Failed",
        description: error.message || "Failed to preview shipment. Please try again.",
        variant: "destructive",
      });
      setShowShippingDialog(false);
    } finally {
      setIsLoadingShipping(false);
    }
  };

  const handleGetShippingRates = async () => {
    if (!selectedOrderForShipping || !data) return;
    
    // Get all items for this order - assume all items should ship together
    const orderItems = data.items.filter(item => item.orderId === selectedOrderForShipping);
    const allItemIds = orderItems.map(item => item.id);
    
    setIsLoadingShipping(true);
    try {
      // If split is needed, perform split first
      if (splitPreview?.needsSplit) {
        await apiRequest('POST', `/api/orders/${selectedOrderForShipping}/split`, {
          itemIdsToKeep: allItemIds
        });
      }
      
      // Get shipping rates
      // TODO: Make fromAddress and parcel configurable in settings
      // Use EasyPost test addresses when test key mode is selected
      const isTestMode = settings?.easypostKeyMode === 'test';
      const result: any = await apiRequest('POST', '/api/shipments/create', {
        orderId: selectedOrderForShipping,
        itemIdsToShip: allItemIds,
        fromAddress: isTestMode ? {
          // EasyPost test address for test mode
          name: "EasyPost Test",
          company: "EasyPost",
          street1: "417 Montgomery Street",
          street2: "Floor 5",
          city: "San Francisco",
          state: "CA",
          zip: "94104",
          country: "US",
          phone: "4155559999",
          email: "test@easypost.com"
        } : {
          // Production address for production mode
          name: "PlanetBrick Warehouse",
          company: "PlanetBrick",
          street1: "123 Brick Lane",
          city: "Denver",
          state: "CO",
          zip: "80202",
          country: "US",
          phone: "5551234567",
          email: "shipping@planetbrick.com"
        },
        parcel: {
          length: 6,
          width: 4,
          height: 2,
          weight: 16
        }
      });
      
      console.log('📦 Frontend received result:', {
        hasResult: !!result,
        hasRates: !!result?.rates,
        ratesCount: result?.rates?.length || 0,
        result
      });
      
      setShipmentData(result);
      setShippingRates(result.rates || []);
      setShippingStep('rates');
      
      console.log('📦 State updated, shipping step:', 'rates', 'rates count:', result.rates?.length || 0);
    } catch (error: any) {
      console.error('Error getting shipping rates:', error);
      toast({
        title: "Rate Fetch Failed",
        description: error.message || "Failed to get shipping rates. Please try again.",
        variant: "destructive",
      });
      setShowShippingDialog(false);
    } finally {
      setIsLoadingShipping(false);
    }
  };

  const handlePurchaseLabel = async () => {
    if (!selectedRate || !shipmentData || !selectedOrderForShipping) return;
    
    setIsLoadingShipping(true);
    try {
      const result: any = await apiRequest('POST', '/api/shipments/purchase', {
        orderId: selectedOrderForShipping,
        shipmentId: shipmentData.shipmentId,
        rateId: selectedRate
      });
      
      setShipmentData(result.shipment);
      setShippingStep('label');
      
      // Refresh fulfillment data
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment'] });
      
      toast({
        title: "Label Purchased",
        description: "Shipping label generated successfully!",
      });
    } catch (error: any) {
      console.error('Error purchasing label:', error);
      toast({
        title: "Purchase Failed",
        description: error.message || "Failed to purchase label. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingShipping(false);
    }
  };

  return (
    <>
      <div className="space-y-4">
        {/* Print & Ship Controls */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSelectAllForPrint}
              className="h-7 text-xs"
              data-testid="button-select-all-print"
            >
              {selectedOrdersForPrint.size === sortedOrders.length ? (
                <CheckSquare className="w-3.5 h-3.5 md:w-4 md:h-4 lg:w-4 lg:w-4 mr-1.5" />
              ) : (
                <Square className="w-3.5 h-3.5 md:w-4 md:h-4 lg:w-4 lg:w-4 mr-1.5" />
              )}
              {selectedOrdersForPrint.size === sortedOrders.length ? 'Deselect All' : 'Select All'}
            </Button>
            {selectedOrdersForPrint.size > 0 && (
              <Badge variant="secondary" className="text-xs">
                {selectedOrdersForPrint.size} selected
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
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
            {!isSplitMode && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedOrdersForPrint.size === 0 && !selectedOrderId}
                    data-testid="button-actions-menu"
                  >
                    <MoreVertical className="w-3.5 h-3.5 mr-1.5" />
                    Actions
                    <ChevronDown className="w-3.5 h-3.5 ml-1.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onClick={() => handlePrintPackingSlips(Array.from(selectedOrdersForPrint))}
                    disabled={selectedOrdersForPrint.size === 0}
                    data-testid="menu-print-packing-slips"
                  >
                    <Printer className="w-4 h-4 mr-2" />
                    Print Packing Slips
                    {selectedOrdersForPrint.size > 0 && (
                      <Badge variant="secondary" className="ml-auto text-xs">
                        {selectedOrdersForPrint.size}
                      </Badge>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handlePrintLotLabels(Array.from(selectedOrdersForPrint))}
                    disabled={selectedOrdersForPrint.size === 0}
                    data-testid="menu-print-lot-labels"
                  >
                    <Tag className="w-4 h-4 mr-2" />
                    Print Lot Labels
                    {selectedOrdersForPrint.size > 0 && (
                      <Badge variant="secondary" className="ml-auto text-xs">
                        {selectedOrdersForPrint.size}
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
                  <DropdownMenuItem
                    onClick={() => handleInitiateShipping(selectedOrderId)}
                    disabled={!selectedOrderId}
                    data-testid="menu-ship-order"
                  >
                    <Package className="w-4 h-4 mr-2" />
                    Ship Selected Order
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Orders Section - Filter Toggles with Print Checkboxes */}
        <div>
          <h3 className="text-xs md:text-base lg:text-lg font-bold text-gray-300 mb-3">Orders</h3>
          <div className="grid grid-cols-4 gap-2">
            {sortedOrders.map((order) => {
              const isSelected = selectedOrderId === order.id;
              const isPrintSelected = selectedOrdersForPrint.has(order.id);
              return (
                <div
                  key={order.id}
                  className={`border rounded-lg p-2 transition-colors ${
                    isSelected 
                      ? 'bg-purple-500/20 border-purple-500' 
                      : 'bg-gray-800/50 border-gray-700 hover-elevate'
                  }`}
                  data-testid={`order-${order.orderNumber}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Checkbox
                      checked={isPrintSelected}
                      onCheckedChange={() => handlePrintSelection(order.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5"
                      data-testid={`checkbox-print-${order.orderNumber}`}
                    />
                  </div>
                  <div
                    onClick={() => handleOrderToggle(order.id)}
                    className="cursor-pointer text-center"
                  >
                    <p className={`text-xs font-mono font-semibold ${isSelected ? 'text-purple-300' : 'text-white'}`}>
                      {order.orderNumber}
                    </p>
                    {order.marketplace && (
                      <p className="text-sm md:text-base text-gray-500 mt-0.5">{order.marketplace}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      {/* Fulfill Section - Grouped by bin */}
      <div>
        <h3 className="text-sm font-bold text-gray-300 mb-3">Order Details</h3>
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
                    {/* Split Checkbox - only show when in split mode */}
                    {isSplitMode && (
                      <Checkbox
                        data-testid={`checkbox-split-${item.id}`}
                        checked={selectedItemsForSplit.has(item.id)}
                        onCheckedChange={() => handleItemSplitToggle(item.id)}
                      />
                    )}

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

      {/* Packing Slip Dialog */}
      <Dialog open={showPackingSlipDialog} onOpenChange={setShowPackingSlipDialog}>
        <DialogContent className="max-w-none w-auto max-h-[90vh] overflow-y-auto print:max-w-none print:max-h-none">
          <DialogHeader className="print:hidden">
            <DialogTitle>Packing Slips</DialogTitle>
          </DialogHeader>
          <PackingSlip orders={packingSlipData} />
        </DialogContent>
      </Dialog>

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

      {/* Shipping Dialog */}
      <Dialog open={showShippingDialog} onOpenChange={(open) => {
        setShowShippingDialog(open);
        if (!open) {
          // Reset state when closing
          setShippingStep('preview');
          setSelectedOrderForShipping(null);
          setShippingRates([]);
          setSelectedRate(null);
          setShipmentData(null);
          setSplitPreview(null);
          setIsLoadingShipping(false);
        }
      }}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {shippingStep === 'preview' && 'Ship Order'}
              {shippingStep === 'rates' && 'Select Shipping Rate'}
              {shippingStep === 'label' && 'Shipping Label'}
            </DialogTitle>
          </DialogHeader>

          {/* Loading State */}
          {shippingStep === 'preview' && !splitPreview && isLoadingShipping && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          )}

          {/* Step 1: Preview & Split Warning */}
          {shippingStep === 'preview' && splitPreview && (
            <div className="space-y-4">
              {splitPreview.needsSplit && (
                <Alert className="bg-yellow-500/10 border-yellow-500/30">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <AlertDescription className="text-yellow-200">
                    <strong>Order will be split:</strong> {splitPreview.itemsToShip} item(s) will ship now. 
                    {splitPreview.itemsToRemain} item(s) will be moved to a new order ({splitPreview.splitOrderNumber}).
                  </AlertDescription>
                </Alert>
              )}
              
              <div className="space-y-2">
                <p className="text-sm text-gray-400">
                  {splitPreview.needsSplit 
                    ? `Shipping ${splitPreview.itemsToShip} of ${splitPreview.totalItems} items` 
                    : `Shipping all ${splitPreview.totalItems} item(s)`}
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => setShowShippingDialog(false)}
                  disabled={isLoadingShipping}
                  data-testid="button-cancel-shipping"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleGetShippingRates}
                  disabled={isLoadingShipping}
                  className="bg-blue-600 hover:bg-blue-700"
                  data-testid="button-get-rates"
                >
                  {isLoadingShipping ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    'Get Shipping Rates'
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Rate Selection */}
          {shippingStep === 'rates' && (
            <div className="flex flex-col gap-4 max-h-[70vh]">
              {/* Scrollable rates container */}
              <div className="flex-1 overflow-y-auto min-h-0 pr-2">
                {shippingRates.length === 0 ? (
                  <p className="text-sm text-gray-400">Loading rates...</p>
                ) : (
                  <RadioGroup value={selectedRate || ''} onValueChange={setSelectedRate}>
                    <div className="space-y-2">
                      {shippingRates.map((rate: any) => (
                        <div 
                          key={rate.id} 
                          className="flex items-center space-x-2 border border-gray-700 rounded-lg p-3 hover-elevate"
                        >
                          <RadioGroupItem value={rate.id} id={rate.id} data-testid={`radio-rate-${rate.id}`} />
                          <Label htmlFor={rate.id} className="flex-1 cursor-pointer">
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="text-sm font-medium">{rate.service}</p>
                                <p className="text-xs text-gray-400">{rate.carrier} • {rate.deliveryDays} days</p>
                              </div>
                              <p className="text-lg font-bold">${rate.rate}</p>
                            </div>
                          </Label>
                        </div>
                      ))}
                    </div>
                  </RadioGroup>
                )}
              </div>

              {/* Fixed buttons at bottom */}
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-700">
                <Button 
                  variant="outline" 
                  onClick={() => setShowShippingDialog(false)}
                  disabled={isLoadingShipping}
                  data-testid="button-cancel-rate-selection"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handlePurchaseLabel}
                  disabled={!selectedRate || isLoadingShipping}
                  className="bg-green-600 hover:bg-green-700"
                  data-testid="button-purchase-label"
                >
                  {isLoadingShipping ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Purchasing...
                    </>
                  ) : (
                    'Purchase Label'
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Label Display */}
          {shippingStep === 'label' && shipmentData && (
            <div className="space-y-4">
              <Alert className="bg-green-500/10 border-green-500/30">
                <Package className="h-4 w-4 text-green-500" />
                <AlertDescription className="text-green-200">
                  Shipping label purchased successfully!
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-400">Tracking Number</p>
                  <p className="text-sm font-mono font-bold">{shipmentData.trackingNumber}</p>
                </div>
                {shipmentData.labelUrl && (
                  <div>
                    <Button 
                      asChild 
                      variant="outline" 
                      size="sm" 
                      className="w-full"
                      data-testid="button-download-label"
                    >
                      <a href={shipmentData.labelUrl} target="_blank" rel="noopener noreferrer">
                        Download Label (PDF)
                      </a>
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <Button 
                  onClick={() => setShowShippingDialog(false)}
                  data-testid="button-close-shipping"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

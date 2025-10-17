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
import { Truck, Loader2, Printer, CheckSquare, Square, Package, AlertTriangle } from "lucide-react";
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
  
  // Shipping state
  const [showShippingDialog, setShowShippingDialog] = useState(false);
  const [shippingStep, setShippingStep] = useState<'preview' | 'rates' | 'label'>('preview');
  const [selectedOrderForShipping, setSelectedOrderForShipping] = useState<string | null>(null);
  const [shippingRates, setShippingRates] = useState<any[]>([]);
  const [selectedRate, setSelectedRate] = useState<string | null>(null);
  const [shipmentData, setShipmentData] = useState<any>(null);
  const [splitPreview, setSplitPreview] = useState<any>(null);
  const [isLoadingShipping, setIsLoadingShipping] = useState(false);

  const { data, isLoading } = useQuery<FulfillmentData>({
    queryKey: ['/api/fulfillment'],
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

  const handleInitiateShipping = async (orderId: string | null) => {
    if (!orderId || !data) return;
    
    // Get items for this order
    const orderItems = data.items.filter(item => item.orderId === orderId);
    const fulfilledItemIds = orderItems.filter(item => item.fulfilled).map(item => item.id);
    
    // Validate that at least one item is fulfilled
    if (fulfilledItemIds.length === 0) {
      toast({
        title: "No Items Ready",
        description: "Please check at least one item to fulfill before shipping.",
        variant: "destructive",
      });
      return;
    }
    
    setSelectedOrderForShipping(orderId);
    setShippingStep('preview');
    setShowShippingDialog(true);
    setIsLoadingShipping(true);
    
    // Check if split is needed
    try {
      const result = await apiRequest('POST', '/api/shipments/preview', {
        orderId,
        itemIdsToShip: fulfilledItemIds
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
    
    const orderItems = data.items.filter(item => item.orderId === selectedOrderForShipping);
    const fulfilledItemIds = orderItems.filter(item => item.fulfilled).map(item => item.id);
    
    setIsLoadingShipping(true);
    try {
      // If split is needed, perform split first
      if (splitPreview?.needsSplit) {
        await apiRequest('POST', `/api/orders/${selectedOrderForShipping}/split`, {
          itemIdsToKeep: fulfilledItemIds
        });
      }
      
      // Get shipping rates
      const result: any = await apiRequest('POST', '/api/shipments/create', {
        orderId: selectedOrderForShipping,
        itemIdsToShip: fulfilledItemIds
      });
      
      setShipmentData(result);
      setShippingRates(result.rates || []);
      setShippingStep('rates');
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
    if (!selectedRate || !shipmentData) return;
    
    setIsLoadingShipping(true);
    try {
      const result: any = await apiRequest('POST', '/api/shipments/purchase', {
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
            <Button
              size="sm"
              onClick={() => handlePrintPackingSlips(Array.from(selectedOrdersForPrint))}
              disabled={selectedOrdersForPrint.size === 0}
              className="h-7 text-xs bg-purple-600 hover:bg-purple-700"
              data-testid="button-print-selected"
            >
              <Printer className="w-3.5 h-3.5 md:w-4 md:h-4 lg:w-4 lg:w-4 mr-1.5" />
              Print {selectedOrdersForPrint.size > 0 ? `(${selectedOrdersForPrint.size})` : 'Selected'}
            </Button>
            <Button
              size="sm"
              onClick={() => handleInitiateShipping(selectedOrderId)}
              disabled={!selectedOrderId}
              className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
              data-testid="button-ship-order"
            >
              <Package className="w-3.5 h-3.5 md:w-4 md:h-4 lg:w-4 lg:w-4 mr-1.5" />
              Ship Order
            </Button>
          </div>
        </div>

        {/* Orders Section - Filter Toggles with Print Checkboxes */}
        <div>
          <h3 className="text-xs md:text-base lg:text-lg font-bold text-gray-300 mb-3">Order Filters</h3>
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
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <Checkbox
                      checked={isPrintSelected}
                      onCheckedChange={() => handlePrintSelection(order.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5"
                      data-testid={`checkbox-print-${order.orderNumber}`}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handlePrintPackingSlips([order.id])}
                      className="h-5 w-5 hover:bg-purple-500/20"
                      data-testid={`button-print-${order.orderNumber}`}
                    >
                      <Printer className="w-3 h-3" />
                    </Button>
                  </div>
                  <div
                    onClick={() => handleOrderToggle(order.id)}
                    className="cursor-pointer text-center"
                  >
                    <p className={`text-xs font-mono font-semibold ${isSelected ? 'text-purple-300' : 'text-white'}`}>
                      {order.orderNumber}
                    </p>
                    {order.marketplace && (
                      <p className="text-[10px] text-gray-500 mt-0.5">{order.marketplace}</p>
                    )}
                  </div>
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
                  className="ml-4 bg-gray-800/50 border border-gray-700 rounded-lg p-2.5 hover-elevate cursor-pointer"
                  data-testid={`fulfillment-item-${item.id}`}
                  onClick={() => {
                    if (!fulfillMutation.isPending) {
                      fulfillMutation.mutate({ itemId: item.id, fulfilled: !item.fulfilled });
                    }
                  }}
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
                      onClick={(e) => e.stopPropagation()}
                    />

                    {/* Item Details */}
                    <div className="flex-1 min-w-0 pointer-events-none">
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
            <div className="space-y-4">
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

              <div className="flex justify-end gap-2">
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

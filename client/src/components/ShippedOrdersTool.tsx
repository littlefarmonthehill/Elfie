import { useState, useEffect } from "react";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Search, Package, PackageCheck, Loader2, MoreHorizontal, Tag, FileText, RotateCcw, ScanLine, FlaskConical, ClipboardList, X, ExternalLink, RefreshCcw, Truck, CheckCircle2, AlertTriangle, ArrowLeftRight, Clock, MapPin } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

import { printPackingSlips, printPicklist } from "./PackingSlip";
import DateRangeSelector, { DateRangeValue } from "./DateRangeSelector";

function getTrackingUrl(trackingNumber: string, carrier?: string | null): string {
  const c = (carrier ?? '').toLowerCase();
  const t = encodeURIComponent(trackingNumber);
  if (c.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${t}`;
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${t}`;
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${t}`;
  if (c.includes('dhl')) return `https://www.dhl.com/en/express/tracking.html?AWB=${t}`;
  if (c.includes('canada post') || c.includes('canadapost')) return `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${t}`;
  if (/^1Z/i.test(trackingNumber)) return `https://www.ups.com/track?tracknum=${t}`;
  if (/^(94|93|92|95)[0-9]{18,20}$/.test(trackingNumber) || /^7[0-9]{19}$/.test(trackingNumber)) return `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${t}`;
  return `https://parcelsapp.com/en/tracking/${t}`;
}

type ShippedOrder = {
  id: string;
  orderNumber: string;
  orderDate: string;
  shipDate: string | null;
  customerUsername: string | null;
  customerEmail: string | null;
  orderTotal: string;
  refundTotal: string | null;
  marketplace: string | null;
  shipTo: string | null;
  orderStatus: string;
  isTest: boolean;
  trackingNumber: string | null;
  trackerId: string | null;
  trackingStatus: string | null;
  trackingStatusDetail: string | null;
  trackingUpdatedAt: string | null;
  carrier: string | null;
  service: string | null;
  labelUrl: string | null;
};

interface ShippedOrdersToolProps {
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
}

export default function ShippedOrdersTool({ onItemClick }: ShippedOrdersToolProps) {
  const { toast } = useToast();
  const [inputValue, setInputValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(inputValue), 200);
    return () => clearTimeout(t);
  }, [inputValue]);
  const [dateRange, setDateRange] = useState<DateRangeValue>('mtd');
  const [hideNoTracking, setHideNoTracking] = useState(true);
  const [eodPending, setEodPending] = useState<string | null>(null);

  // Return dialog state
  const [returnDialog, setReturnDialog] = useState<{ open: boolean; order: ShippedOrder | null }>({ open: false, order: null });
  const [returnAmount, setReturnAmount] = useState("");

  const returnToFulfillmentMutation = useMutation({
    mutationFn: async (orderId: string) =>
      apiRequest('POST', `/api/orders/${encodeURIComponent(orderId)}/return-to-fulfillment`),
    onSuccess: (data: any) => {
      const voided = data?.voidedLabels ?? 0;
      const warning = data?.voidWarning;
      toast({
        title: "Order returned to fulfillment queue",
        description: voided > 0
          ? `${voided} shipping label${voided > 1 ? 's' : ''} voided with EasyPost.`
          : warning
            ? "Label could not be voided — it may be a test label or already voided."
            : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/orders/shipped'] });
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment'] });
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders/workflow-summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/shipments/tracking-summary'] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to return order", description: err.message, variant: "destructive" });
    },
  });

  const toggleTestMutation = useMutation({
    mutationFn: async (orderId: string) =>
      apiRequest('PATCH', `/api/orders/${encodeURIComponent(orderId)}/toggle-test`),
    onSuccess: (data: any) => {
      toast({
        title: data.isTest ? "Marked as test order" : "Test flag removed",
        description: data.isTest
          ? "This order and customer are now hidden from all dashboards."
          : "This order is now visible in dashboards again.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/orders/shipped'] });
    },
    onError: (err: any) => {
      let msg = "Failed to update test flag";
      try {
        const raw = err?.message || "";
        const jsonStr = raw.includes(": ") ? raw.substring(raw.indexOf(": ") + 2) : raw;
        const parsed = JSON.parse(jsonStr);
        msg = parsed.error || msg;
      } catch {}
      toast({ title: "Cannot mark as test", description: msg, variant: "destructive" });
    },
  });

  const markReturnedMutation = useMutation({
    mutationFn: async ({ orderId, refundAmount }: { orderId: string; refundAmount: number }) =>
      apiRequest('POST', `/api/orders/${encodeURIComponent(orderId)}/mark-returned`, { refundAmount }),
    onSuccess: () => {
      toast({ title: "Order marked as returned", description: "Refund recorded. You can now mark this order as a test order." });
      setReturnDialog({ open: false, order: null });
      queryClient.invalidateQueries({ queryKey: ['/api/orders/shipped'] });
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders/workflow-summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/shipments/tracking-summary'] });
    },
    onError: (err: any) => {
      let msg = "Failed to mark order as returned";
      try {
        const raw = err?.message || "";
        const jsonStr = raw.includes(": ") ? raw.substring(raw.indexOf(": ") + 2) : raw;
        const parsed = JSON.parse(jsonStr);
        msg = parsed.error || msg;
      } catch {}
      toast({ title: "Return failed", description: msg, variant: "destructive" });
    },
  });

  const [isRefreshingTracking, setIsRefreshingTracking] = useState(false);

  const { data: org } = useQuery<any>({
    queryKey: ['/api/org'],
  });

  // Not-delivered panel: no date range, backend excludes delivered orders
  const { data: notDeliveredOrders, isLoading: isLoadingNotDelivered, isFetching: isFetchingNotDelivered } = useQuery<ShippedOrder[]>({
    queryKey: ['/api/orders/shipped', searchQuery, 'not-delivered'],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      params.set('excludeDelivered', 'true');
      const response = await fetch(`/api/orders/shipped?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch shipped orders');
      return response.json();
    },
    placeholderData: keepPreviousData,
  });

  // Delivered panel: backend filters to delivered-only + applies date range
  // (deliveredOnly=true ensures the 200-cap is spent only on delivered rows)
  const { data: deliveredOrders, isLoading: isLoadingDelivered, isFetching: isFetchingDelivered } = useQuery<ShippedOrder[]>({
    queryKey: ['/api/orders/shipped', searchQuery, dateRange, 'delivered'],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (dateRange && dateRange !== 'all') params.set('range', dateRange);
      params.set('deliveredOnly', 'true');
      const response = await fetch(`/api/orders/shipped?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch shipped orders');
      return response.json();
    },
    placeholderData: keepPreviousData,
  });

  const isFetchingSearch = isFetchingNotDelivered || isFetchingDelivered;
  const isLoading = (!notDeliveredOrders && isLoadingNotDelivered) || (!deliveredOrders && isLoadingDelivered);
  // Merge for legacy references (refresh-tracking, etc.)
  // deliveredOrders is already backend-filtered to delivered-only
  const shippedOrders = [...(notDeliveredOrders ?? []), ...(deliveredOrders ?? [])];

  // Visible counts — these respect the hideNoTracking toggle so the "Showing X" line is accurate
  const noTrackingCount = (notDeliveredOrders ?? []).filter(o => !o.trackingNumber).length;
  const visibleNotDeliveredCount = hideNoTracking
    ? (notDeliveredOrders ?? []).filter(o => !!o.trackingNumber).length
    : (notDeliveredOrders ?? []).length;
  const visibleTotal = visibleNotDeliveredCount + (deliveredOrders ?? []).length;

  const handleRefreshTracking = async () => {
    if (!shippedOrders?.length) return;
    const eligibleIds = shippedOrders
      .filter(o => o.trackingNumber && o.trackingStatus !== 'delivered' && o.orderStatus !== 'returned')
      .map(o => o.id);
    if (!eligibleIds.length) {
      toast({ title: "Nothing to refresh", description: "All tracked orders are already delivered." });
      return;
    }
    setIsRefreshingTracking(true);
    try {
      const res = await apiRequest('POST', '/api/orders/shipped/refresh-tracking', { orderIds: eligibleIds });
      const count = Object.keys(res as object).length;
      toast({ title: "Tracking refreshed", description: `Updated ${count} shipment${count !== 1 ? 's' : ''}.` });
      queryClient.invalidateQueries({ queryKey: ['/api/orders/shipped'] });
      queryClient.invalidateQueries({ queryKey: ['/api/shipments/tracking-summary'] });
    } catch (e: any) {
      const msg = e?.message || '';
      if (msg.includes('not configured')) {
        toast({ title: "EasyPost not configured", description: "Add your EasyPost API key in Settings to use live tracking.", variant: "destructive" });
      } else {
        toast({ title: "Tracking refresh failed", description: msg, variant: "destructive" });
      }
    } finally {
      setIsRefreshingTracking(false);
    }
  };

  const handlePrintPackingSlip = async (orderId: string) => {
    try {
      const response = await fetch('/api/fulfillment/packing-slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: [orderId] }),
      });
      const data = await response.json();
      await printPackingSlips(data, org ? { name: org.name, address: org.address, logoUrl: org.logoUrl } : undefined);
    } catch (error) {
      toast({ title: "Error", description: "Failed to generate packing slip", variant: "destructive" });
    }
  };

  const handlePrintPicklistForOrder = async (order: ShippedOrder) => {
    try {
      const response = await fetch('/api/fulfillment/packing-slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: [order.id] }),
      });
      if (!response.ok) throw new Error('Failed to fetch order items');
      const [slip] = await response.json();
      if (!slip?.items?.length) {
        toast({ title: "No Items", description: "This order has no line items to print.", variant: "destructive" });
        return;
      }
      const picklistItems = slip.items
        .sort((a: any, b: any) => {
          const pk = (a.bricklinkPartNumber || '').localeCompare(b.bricklinkPartNumber || '', undefined, { numeric: true });
          if (pk !== 0) return pk;
          const ck = (a.condition || '').localeCompare(b.condition || '');
          if (ck !== 0) return ck;
          return (a.colorName || '').localeCompare(b.colorName || '');
        })
        .map((item: any) => ({
          partNumber: item.bricklinkPartNumber || null,
          sku: item.inventoryId || null,
          colorName: item.colorName || null,
          colorId: item.colorId ?? null,
          condition: item.condition || null,
          itemName: item.name || null,
          quantity: item.quantity,
          orderNumber: order.orderNumber,
          marketplace: order.marketplace || null,
          inventoryId: item.inventoryId ? Number(item.inventoryId) : null,
          comment: item.comment || null,
        }));
      await printPicklist(picklistItems);
    } catch (error) {
      toast({ title: "Error", description: "Failed to generate picklist", variant: "destructive" });
    }
  };

  const handlePrintShippingLabel = (order: ShippedOrder) => {
    if (order.labelUrl) {
      window.open(order.labelUrl, '_blank');
    } else {
      toast({ title: "No Label Available", description: "This order doesn't have a shipping label URL.", variant: "destructive" });
    }
  };

  const handlePrintLotLabels = (_orderId: string) => {
    toast({
      title: "Lot Labels",
      description: "Lot label printing will be implemented soon. This feature is coming in a future update.",
    });
  };

  const handlePrintEodForm = async (orderId: string) => {
    setEodPending(orderId);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/eod-form`);
      if (response.status === 404) {
        toast({ title: "No EOD Form", description: "This order has not been added to an EOD/SCAN form yet.", variant: "destructive" });
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch EOD form');
      const data = await response.json();
      if (data?.formUrl) window.open(data.formUrl, '_blank');
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Could not retrieve EOD form", variant: "destructive" });
    } finally {
      setEodPending(null);
    }
  };

  const openReturnDialog = (order: ShippedOrder) => {
    setReturnAmount(order.orderTotal ?? "0");
    setReturnDialog({ open: true, order });
  };

  const handleConfirmReturn = () => {
    if (!returnDialog.order) return;
    const amount = parseFloat(returnAmount);
    if (isNaN(amount) || amount < 0) {
      toast({ title: "Invalid amount", description: "Please enter a valid refund amount.", variant: "destructive" });
      return;
    }
    markReturnedMutation.mutate({ orderId: returnDialog.order.id, refundAmount: amount });
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
        <div className="flex justify-center" data-testid="shipped-date-range">
          <DateRangeSelector value={dateRange} onChange={setDateRange} compact scaled />
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            {isFetchingSearch
              ? <Loader2 className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
              : <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            }
            <Input
              type="text"
              placeholder="Search by order number, customer, or tracking number..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="pl-10"
              data-testid="input-search-shipped-orders"
            />
          </div>
          <Button
            size="default"
            variant="outline"
            onClick={handleRefreshTracking}
            disabled={isRefreshingTracking || !shippedOrders?.length}
            data-testid="button-refresh-tracking"
          >
            <RefreshCcw className={`w-3.5 h-3.5 mr-1.5 ${isRefreshingTracking ? 'animate-spin' : ''}`} />
            {isRefreshingTracking ? 'Refreshing…' : 'Tracking'}
          </Button>
        </div>

        {visibleTotal > 0 && (
          <div className="text-sm text-gray-400 flex items-center gap-2">
            <span>Showing {visibleTotal} {visibleTotal === 1 ? 'order' : 'orders'}{noTrackingCount > 0 && hideNoTracking ? ` · ${noTrackingCount} without tracking hidden` : ''}</span>
            {!searchQuery.trim() && (deliveredOrders?.length ?? 0) >= 200 && (
              <span className="text-xs text-gray-500">(delivered capped at 200 — search to find older)</span>
            )}
          </div>
        )}

        {shippedOrders.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center text-gray-400">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">
                {searchQuery.trim() ? 'No shipped orders found matching your search' : 'No shipped orders found'}
              </p>
            </div>
          </div>
        ) : (
          (() => {
            const notDelivered = notDeliveredOrders ?? [];
            const delivered    = deliveredOrders ?? [];

            const renderCard = (order: ShippedOrder) => {
              let shipTo: any = {};
              try {
                shipTo = typeof order.shipTo === 'string' ? JSON.parse(order.shipTo) : order.shipTo;
              } catch {}

              const isBrickOwl = order.marketplace === 'BrickOwl';
              const isShipped = order.orderStatus === 'shipped';
              const isReturned = order.orderStatus === 'returned';
              const orderTotalNum = parseFloat(order.orderTotal ?? '0');
              const refundTotalNum = parseFloat(order.refundTotal ?? '0');
              const isFullyRefunded = refundTotalNum > 0 && orderTotalNum > 0 && refundTotalNum >= orderTotalNum - 0.01;
              const isCancelled = order.orderStatus === 'cancelled' || order.orderStatus === 'Cancelled' || isFullyRefunded;

              return (
                <div
                  key={order.id}
                  className={`app-card px-3 py-1.5 flex items-start gap-2 hover-elevate${onItemClick ? ' cursor-pointer' : ''}`}
                  data-testid={`shipped-order-${order.orderNumber}`}
                  onClick={() => onItemClick?.('order', order.id)}
                >
                  {/* Card content — grows to fill available width */}
                  <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <h3 className="text-sm font-mono font-bold text-white shrink-0">
                      {order.orderNumber}
                    </h3>
                    {order.marketplace && (
                      <Badge variant="outline" className="text-xs shrink-0">
                        {order.marketplace}
                      </Badge>
                    )}
                    {order.trackingStatus === 'delivered' && (
                      <Badge className="text-xs bg-green-900/60 text-green-300 border border-green-700/50 gap-1 shrink-0">
                        <CheckCircle2 className="w-3 h-3" /> Delivered
                      </Badge>
                    )}
                    {order.trackingStatus === 'out_for_delivery' && (
                      <Badge className="text-xs bg-amber-900/60 text-amber-300 border border-amber-700/50 gap-1 shrink-0">
                        <Truck className="w-3 h-3" /> Out for Delivery
                      </Badge>
                    )}
                    {order.trackingStatus === 'in_transit' && (
                      <Badge className="text-xs bg-blue-900/60 text-blue-300 border border-blue-700/50 gap-1 shrink-0">
                        <Truck className="w-3 h-3" /> In Transit
                      </Badge>
                    )}
                    {order.trackingStatus === 'return_to_sender' && (
                      <Badge className="text-xs bg-red-900/60 text-red-300 border border-red-700/50 gap-1 shrink-0">
                        <ArrowLeftRight className="w-3 h-3" /> Return to Sender
                      </Badge>
                    )}
                    {order.trackingStatus === 'failure' && (
                      <Badge className="text-xs bg-red-900/60 text-red-300 border border-red-700/50 gap-1 shrink-0">
                        <AlertTriangle className="w-3 h-3" /> Delivery Issue
                      </Badge>
                    )}
                    {order.trackingStatus === 'pre_transit' && (
                      <Badge className="text-xs bg-gray-800/80 text-gray-400 border border-gray-600/50 gap-1 shrink-0">
                        <Clock className="w-3 h-3" /> Label Created
                      </Badge>
                    )}
                    {order.trackingStatus === 'available_for_pickup' && (
                      <Badge className="text-xs bg-teal-900/60 text-teal-300 border border-teal-700/50 gap-1 shrink-0">
                        <MapPin className="w-3 h-3" /> Ready for Pickup
                      </Badge>
                    )}
                    {order.trackingStatus === 'unknown' && (
                      <Badge className="text-xs bg-gray-800/80 text-gray-400 border border-gray-600/50 gap-1 shrink-0">
                        <AlertTriangle className="w-3 h-3" /> Unknown
                      </Badge>
                    )}
                    {(order.trackingStatus === 'error' || order.trackingStatus === 'cancelled') && (
                      <Badge className="text-xs bg-orange-900/60 text-orange-300 border border-orange-700/50 gap-1 shrink-0">
                        <AlertTriangle className="w-3 h-3" /> Tracking Error
                      </Badge>
                    )}
                    {isReturned && (
                      <Badge className="text-xs bg-red-900/60 text-red-300 border border-red-700/50 gap-1 shrink-0">
                        <RotateCcw className="w-3 h-3" /> Returned
                      </Badge>
                    )}
                    {isCancelled && !isReturned && (
                      <Badge className="text-xs bg-orange-900/60 text-orange-300 border border-orange-700/50 gap-1 shrink-0">
                        <X className="w-3 h-3" /> Cancelled
                      </Badge>
                    )}
                    {order.isTest && (
                      <Badge className="text-xs bg-purple-900/60 text-purple-300 border border-purple-700/50 gap-1 shrink-0">
                        <FlaskConical className="w-3 h-3" /> Test
                      </Badge>
                    )}
                    <span className="text-gray-600 shrink-0">·</span>
                    <span className="text-xs text-gray-400 shrink-0">{order.customerUsername || shipTo.name || 'Unknown'}</span>
                    <span className="text-gray-600 shrink-0">·</span>
                    <span className="text-xs text-gray-400 shrink-0">${order.orderTotal}</span>
                    <span className="text-gray-600 shrink-0">·</span>
                    <span className="text-xs text-gray-400 shrink-0">{order.shipDate ? format(new Date(order.shipDate), 'MMM d') : '—'}</span>
                    {order.carrier && (
                      <>
                        <span className="text-gray-600 shrink-0">·</span>
                        <span className="text-xs text-gray-500 shrink-0">{order.carrier}{order.service ? ` ${order.service}` : ''}</span>
                      </>
                    )}
                    {order.trackingNumber && (
                      <>
                        <span className="text-gray-600 shrink-0">·</span>
                        <a
                          href={getTrackingUrl(order.trackingNumber, order.carrier)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="font-mono text-xs truncate max-w-[160px] hover:underline underline-offset-2 flex items-center gap-0.5 text-gray-400"
                          data-testid={`link-tracking-${order.orderNumber}`}
                        >
                          {order.trackingNumber}
                          <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-50" />
                        </a>
                      </>
                    )}
                  </div>

                  {/* Ellipsis menu — anchored top-right */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="shrink-0 self-start h-7 w-7 text-muted-foreground"
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`button-actions-${order.orderNumber}`}
                      >
                        <MoreHorizontal className="w-4 h-4" />
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
                        onClick={() => handlePrintPicklistForOrder(order)}
                        data-testid={`menu-print-picklist-${order.orderNumber}`}
                      >
                        <ClipboardList className="w-4 h-4 mr-2" />
                        Print Picklist
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
                      <DropdownMenuItem
                        onClick={() => handlePrintEodForm(order.id)}
                        disabled={eodPending === order.id}
                        data-testid={`menu-print-eod-form-${order.orderNumber}`}
                      >
                        {eodPending === order.id
                          ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          : <ScanLine className="w-4 h-4 mr-2" />
                        }
                        Print EOD Form
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        onClick={(e) => { e.stopPropagation(); toggleTestMutation.mutate(order.id); }}
                        disabled={toggleTestMutation.isPending}
                        data-testid={`menu-toggle-test-${order.orderNumber}`}
                        className="text-purple-400 focus:text-purple-300"
                      >
                        {toggleTestMutation.isPending
                          ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          : <FlaskConical className="w-4 h-4 mr-2" />
                        }
                        {order.isTest ? "Remove Test Flag" : "Mark as Test Order"}
                      </DropdownMenuItem>

                      {isBrickOwl && isShipped && (
                        <DropdownMenuItem
                          onClick={(e) => { e.stopPropagation(); openReturnDialog(order); }}
                          data-testid={`menu-mark-returned-${order.orderNumber}`}
                          className="text-red-400 focus:text-red-300"
                        >
                          <RotateCcw className="w-4 h-4 mr-2" />
                          Mark as Returned
                        </DropdownMenuItem>
                      )}

                      {!isCancelled && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={(e) => { e.stopPropagation(); returnToFulfillmentMutation.mutate(order.id); }}
                            disabled={returnToFulfillmentMutation.isPending}
                            data-testid={`menu-return-to-fulfillment-${order.orderNumber}`}
                            className="text-amber-400 focus:text-amber-300"
                          >
                            {returnToFulfillmentMutation.isPending
                              ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              : <RotateCcw className="w-4 h-4 mr-2" />
                            }
                            Return to Fulfillment
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            };

            const visibleNotDelivered = hideNoTracking
              ? notDelivered.filter(o => !!o.trackingNumber)
              : notDelivered;

            return (
              <div className="space-y-3">
                {notDelivered.length > 0 && (
                  <>
                    <div className="flex items-center justify-between gap-2 px-1 pb-1">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Not Delivered · {visibleNotDelivered.length}{noTrackingCount > 0 && hideNoTracking ? ` of ${notDelivered.length}` : ''}
                      </span>
                      {noTrackingCount > 0 && (
                        <button
                          onClick={() => setHideNoTracking(h => !h)}
                          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                          data-testid="button-toggle-no-tracking"
                        >
                          {hideNoTracking
                            ? `Show ${noTrackingCount} without tracking`
                            : 'Hide no-tracking'}
                        </button>
                      )}
                    </div>
                    {visibleNotDelivered.map(renderCard)}
                  </>
                )}
                {delivered.length > 0 && (
                  <div className={notDelivered.length > 0 ? "border-t border-border/30 pt-3 space-y-3" : "space-y-3"}>
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1 pb-1">
                      Delivered · {delivered.length}
                    </div>
                    {delivered.map(renderCard)}
                  </div>
                )}
              </div>
            );
          })()
        )}
      </div>

      {/* BrickOwl Return Dialog */}
      <Dialog open={returnDialog.open} onOpenChange={(open) => !open && setReturnDialog({ open: false, order: null })}>
        <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Mark as Returned</DialogTitle>
            <DialogDescription>
              Order {returnDialog.order?.orderNumber} — enter the amount to refund. Defaults to the full order total.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="refund-amount">Refund Amount ($)</Label>
              <Input
                id="refund-amount"
                type="number"
                min="0"
                step="0.01"
                value={returnAmount}
                onChange={(e) => setReturnAmount(e.target.value)}
                data-testid="input-refund-amount"
              />
              <p className="text-xs text-muted-foreground">
                Order total: ${returnDialog.order?.orderTotal ?? "0.00"}. A full refund unlocks "Mark as Test".
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setReturnDialog({ open: false, order: null })}
              data-testid="button-cancel-return"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmReturn}
              disabled={markReturnedMutation.isPending}
              data-testid="button-confirm-return"
            >
              {markReturnedMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}
              Mark as Returned
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

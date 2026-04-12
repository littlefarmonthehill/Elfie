import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package, DollarSign, User, MapPin, Calendar, Truck, RefreshCcw, Pencil, X, Save, Weight, RotateCcw, CreditCard, ShieldCheck, Plus, MessageCircle, AlertTriangle, ExternalLink, Loader2 } from "lucide-react";

import { shortCode } from "@/components/PackingSlip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import PartImage from "@/components/PartImage";

function getTrackingUrl(trackingNumber: string, carrier?: string): string {
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

interface OrderDetailProps {
  data: {
    id: string | number;
    loading?: boolean;
    orderId?: string;
    orderNumber?: string;
    marketplace?: string;
    status?: 'Pending' | 'Paid' | 'Shipped' | 'Cancelled' | 'Returned';
    customer?: {
      name: string;
      email: string;
      address: string;
      address2?: string;
      address3?: string;
      city: string;
      state: string;
      zip: string;
      country: string;
    };
    items?: Array<{
      partNumber: string;
      name: string;
      quantity: number;
      price: number;
      colorId?: number | null;
      blInventoryId?: number | null;
      currentInventoryQty?: number | null;
      stockWarning?: boolean;
      competingOrderCount?: number | null;
      totalDemandQty?: number | null;
      imageUrl?: string | null;
      itemType?: string | null;
    }>;
    shipping?: number;
    tax?: number;
    total?: number;
    orderDate?: string;
    shippedDate?: string;
    trackingNumber?: string;
    labelUrl?: string;
    shippingCarrier?: string;
    shippingService?: string;
    weight?: number | null;
    weightUnits?: string;
    adjustments?: Array<{
      id: string;
      type: string;
      amount: number;
      paymentMethod?: string | null;
      externalTransactionId?: string | null;
      reason?: string | null;
      notes?: string | null;
      createdAt: string;
    }>;
    customerNotes?: string | null;
    internalNotes?: string | null;
    requestedShippingService?: string | null;
    insuranceAmount?: number | null;
    isRepeatCustomer?: boolean;
    previousOrders?: Array<{
      orderId: string;
      orderNumber: string;
      orderDate: string;
      total: number;
      status: 'Pending' | 'Paid' | 'Shipped' | 'Cancelled' | 'Returned';
    }>;
    mergeGroupId?: string | null;
    mergeLinkedOrders?: Array<{
      orderId: string;
      orderNumber: string | null;
      orderTotal: string | null;
      orderStatus: string;
    }>;
  };
  onOrderSelect?: (orderId: string) => void;
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
}

export default function OrderDetail({ data, onOrderSelect, onItemClick }: OrderDetailProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingWeight, setIsLoadingWeight] = useState(false);
  const { data: orgSettings } = useQuery<any>({ queryKey: ['/api/orders/settings'] });
  const [showCustomerNote, setShowCustomerNote] = useState(false);
  const [lightboxItem, setLightboxItem] = useState<{
    partNumber: string;
    name: string;
    imageUrl?: string | null;
    itemType?: string | null;
    colorId?: number | null;
    blInventoryId?: number | null;
  } | null>(null);
  const [editForm, setEditForm] = useState({
    street1: data.customer?.address || '',
    street2: data.customer?.address2 || '',
    street3: data.customer?.address3 || '',
    city: data.customer?.city || '',
    state: data.customer?.state || '',
    postalCode: data.customer?.zip || '',
    country: data.customer?.country || '',
    weight: data.weight != null ? String(data.weight) : '',
    weightUnits: data.weightUnits || 'oz',
  });

  const handleEditStart = async () => {
    const rawMode = orgSettings?.defaultWeightMode || 'none';
    const mode: 'none' | 'order' = (rawMode === 'order' || rawMode === 'order_plus') ? 'order' : 'none';
    let defaultWeight = data.weight != null ? String(data.weight) : '';
    let defaultUnit = data.weightUnits || 'oz';

    // If no saved weight, apply the org default weight mode
    if (data.weight == null && mode !== 'none' && data.orderId) {
      setIsLoadingWeight(true);
      try {
        const res = await apiRequest('GET', `/api/orders/fulfillment/order-shipping/${data.orderId}`);
        const est = await res.json();
        const weightGrams: number = est.weightEstimateGrams || 0;
        const catalogOz = weightGrams * 0.035274;
        const itemsPct = parseFloat(orgSettings?.defaultWeightItemsPct) || 0;
        const extraOz = parseFloat(orgSettings?.defaultWeightPlusAmount) || 0;
        const totalOz = catalogOz + (catalogOz * itemsPct / 100) + extraOz;
        if (totalOz > 0) {
          defaultWeight = String(Math.round(totalOz * 10) / 10);
          defaultUnit = 'oz';
        }
      } catch {
        // silently fall through — weight stays empty
      } finally {
        setIsLoadingWeight(false);
      }
    }

    setEditForm({
      street1: data.customer?.address || '',
      street2: data.customer?.address2 || '',
      street3: data.customer?.address3 || '',
      city: data.customer?.city || '',
      state: data.customer?.state || '',
      postalCode: data.customer?.zip || '',
      country: data.customer?.country || '',
      weight: defaultWeight,
      weightUnits: defaultUnit,
    });
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!data.orderId) return;
    setIsSaving(true);
    try {
      await apiRequest('PATCH', `/api/orders/${data.orderId}`, {
        street1: editForm.street1,
        street2: editForm.street2,
        street3: editForm.street3,
        city: editForm.city,
        state: editForm.state,
        postalCode: editForm.postalCode,
        country: editForm.country,
        weight: editForm.weight !== '' ? Number(editForm.weight) : null,
        weightUnits: editForm.weightUnits,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/orders/${data.orderId}`] });
      toast({ title: "Order Updated", description: "Address and weight saved successfully." });
      setIsEditing(false);
    } catch (err: any) {
      toast({ title: "Save Failed", description: err.message || "Could not save changes.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (data.loading) {
    return (
      <div className="space-y-2" data-testid="order-detail-loading">
        <div className="bg-gradient-to-r from-lego-blue/15 via-lego-blue/5 to-transparent border border-lego-blue/30 rounded-lg p-2">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="h-4 bg-gray-800 rounded w-32 animate-pulse"></div>
            <div className="h-3.5 bg-gray-800 rounded w-16 animate-pulse"></div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 bg-gray-800 rounded flex-1 animate-pulse"></div>
          </div>
        </div>
        <div className="space-y-2">
          <div className="h-24 bg-gray-800/30 border border-gray-700 rounded-lg animate-pulse"></div>
          <div className="h-24 bg-gray-800/30 border border-gray-700 rounded-lg animate-pulse"></div>
        </div>
      </div>
    );
  }
  
  if (!data.items || !data.customer || !data.orderNumber) {
    return (
      <div className="p-4 text-center text-gray-400">
        <p className="text-sm">Unable to load order details</p>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending': return 'bg-lego-yellow/20 text-lego-yellow border-lego-yellow/40';
      case 'Paid': return 'bg-lego-blue/20 text-lego-blue border-lego-blue/40';
      case 'Shipped': return 'bg-lego-green/20 text-lego-green border-lego-green/40';
      case 'Cancelled': return 'bg-lego-red/20 text-lego-red border-lego-red/40';
      case 'Returned': return 'bg-orange-500/20 text-orange-400 border-orange-500/40';
      default: return 'bg-gray-800 text-gray-400 border-gray-700';
    }
  };

  const subtotal = data.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const shipping = data.shipping ?? 0;
  const tax = data.tax ?? 0;
  const total = data.total ?? 0;
  const refundAdjustments = (data.adjustments ?? []).filter(a => a.type === 'refund');
  const feeAdjustments = (data.adjustments ?? []).filter(a => a.type === 'merchant_fee');
  const shippingAdjustments = (data.adjustments ?? []).filter(a => a.type === 'shipping_cost');
  const adjustmentsTotal = refundAdjustments.reduce((sum, a) => sum + a.amount, 0);
  const totalFees = feeAdjustments.reduce((sum, a) => sum + Math.abs(a.amount), 0);
  const totalShippingCost = shippingAdjustments.reduce((sum, a) => sum + Math.abs(a.amount), 0);
  const netTotal = total + adjustmentsTotal;
  const hasAdjustments = refundAdjustments.length > 0;
  // Cancelled or returned with no ship date = order was never fulfilled; treat as $0 revenue
  const isUnshippedCancellation = (data.status === 'Cancelled' || data.status === 'Returned') && !data.shippedDate;
  const hasFees = feeAdjustments.length > 0;
  const hasShippingCost = shippingAdjustments.length > 0;

  const allCustomerOrders = data.previousOrders ? [
    {
      orderId: data.orderId!,
      orderNumber: data.orderNumber!,
      orderDate: data.orderDate!,
      total: total,
      status: data.status!,
      isCurrent: true,
    },
    ...data.previousOrders.map(order => ({ ...order, isCurrent: false })),
  ].sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()) : [];

  const canEdit = data.status !== 'Shipped' && data.status !== 'Cancelled' && data.status !== 'Returned';

  return (
    <div className="space-y-2">
      {/* Order Pills Navigation */}
      {data.isRepeatCustomer && allCustomerOrders.length > 1 && (
        <div className="bg-gradient-to-r from-lego-orange/10 via-lego-orange/5 to-transparent border border-lego-orange/30 rounded-lg p-2.5">
          <div className="flex items-center gap-2 mb-2">
            <RefreshCcw className="h-4 w-4 text-lego-orange" />
            <span className="text-[9px] md:text-xs font-bold text-lego-orange">CUSTOMER ORDERS ({allCustomerOrders.length})</span>
          </div>
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex gap-2 pb-1">
              {allCustomerOrders.map((order) => (
                <button
                  key={order.orderId}
                  onClick={() => !order.isCurrent && onOrderSelect?.(order.orderId)}
                  disabled={order.isCurrent}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[9px] md:text-xs font-bold transition-all border ${
                    order.isCurrent
                      ? 'bg-lego-orange text-white border-lego-orange shadow-lg shadow-lego-orange/20'
                      : 'bg-gray-900 text-gray-300 border-gray-700 hover:bg-lego-orange/20 hover:border-lego-orange/50'
                  }`}
                  data-testid={`order-pill-${order.orderId}`}
                >
                  <span className="font-black">#{order.orderNumber}</span>
                  <Badge className={getStatusColor(order.status) + ' text-xs h-4 px-1.5 font-bold'}>{order.status}</Badge>
                  <span className="text-lego-green font-mono font-black">${order.total.toFixed(2)}</span>
                </button>
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>
      )}

      {/* Header with Customer */}
      <div className="bg-gradient-to-r from-lego-blue/15 via-lego-blue/5 to-transparent border border-lego-blue/30 rounded-lg p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-[10px] md:text-sm font-black text-white font-mono">
              {data.marketplace === 'BrickOwl' ? 'BO.' : 'BL.'}{(data.orderNumber || '').replace(/^(BL\.|BO\.)/i, '')}
            </h3>
            <Badge className={getStatusColor(data.status!) + ' text-[9px] md:text-xs h-5 px-2 font-bold'}>{data.status!}</Badge>
            {data.mergeGroupId && (() => {
              const linked = data.mergeLinkedOrders?.[0];
              const linkedCode = linked
                ? shortCode(linked.orderNumber || linked.orderId)
                : shortCode(data.mergeGroupId);
              return (
                <button
                  onClick={() => linked && onOrderSelect?.(linked.orderId)}
                  disabled={!linked}
                  className="flex items-center gap-0.5 text-[10px] text-amber-400/80 font-mono shrink-0 hover:text-amber-300 disabled:cursor-default"
                  title={`Merged order`}
                  data-testid="button-merge-group-icon"
                >
                  <Plus className="w-2.5 h-2.5" />
                  {linkedCode}
                </button>
              );
            })()}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-[9px] md:text-xs text-gray-400">
              <Calendar className="h-4 w-4" />
              <span className="font-medium">{new Date(data.orderDate!).toLocaleDateString()}</span>
            </div>
            {data.customerNotes && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowCustomerNote(v => !v)}
                data-testid="button-toggle-customer-note"
                title="Customer note"
                className={showCustomerNote ? 'text-amber-400' : 'text-amber-500/50'}
              >
                <MessageCircle className="h-3.5 w-3.5 fill-current" />
              </Button>
            )}
            {canEdit && !isEditing && (
              <Button
                size="icon"
                variant="ghost"
                onClick={handleEditStart}
                disabled={isLoadingWeight}
                data-testid="button-edit-order"
                title="Edit address & weight"
              >
                {isLoadingWeight
                  ? <Loader2 className="h-3.5 w-3.5 text-gray-400 animate-spin" />
                  : <Pencil className="h-3.5 w-3.5 text-gray-400" />
                }
              </Button>
            )}
          </div>
        </div>
        
        {/* Customer Info */}
        <div className="flex items-center gap-3 text-[9px] md:text-xs">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <User className="h-4 w-4 text-lego-blue flex-shrink-0" />
            <span className="font-bold text-white truncate">{data.customer.name}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0" />
            <span className="text-gray-400">
              {[data.customer.city, data.customer.state].filter(Boolean).join(', ') || data.customer.country || '—'}
            </span>
          </div>
        </div>

        {/* Full Address — read-only block, always visible */}
        {(data.customer.address || data.customer.city || data.customer.zip || data.customer.country) && !isEditing && (
          <div className="text-[9px] md:text-[10px] text-gray-500 leading-snug pl-6" data-testid="text-shipping-address">
            {data.customer.address && <div>{data.customer.address}</div>}
            {data.customer.address2 && <div>{data.customer.address2}</div>}
            {data.customer.address3 && <div>{data.customer.address3}</div>}
            <div>
              {[data.customer.city, data.customer.state, data.customer.zip].filter(Boolean).join(' ')}
            </div>
            {data.customer.country && <div>{data.customer.country}</div>}
          </div>
        )}

        {/* Customer / Internal Notes */}
        {(data.customerNotes || data.internalNotes) && (
          <div className="space-y-1">
            {data.customerNotes && showCustomerNote && (
              <div className="flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5" data-testid="text-customer-notes">
                <MessageCircle className="h-3 w-3 text-amber-400/70 flex-shrink-0 mt-0.5 fill-current" />
                <div className="min-w-0">
                  <p className="text-[9px] font-semibold text-amber-400/70 uppercase tracking-wide mb-0.5">Customer note</p>
                  <p className="text-[10px] text-gray-300 leading-snug">{data.customerNotes}</p>
                </div>
              </div>
            )}
            {data.internalNotes && (
              <div className="flex items-start gap-1.5 rounded border border-lego-yellow/30 bg-lego-yellow/5 px-2 py-1.5" data-testid="text-internal-notes">
                <Pencil className="h-3 w-3 text-lego-yellow/70 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-[9px] font-semibold text-lego-yellow/70 uppercase tracking-wide mb-0.5">Internal note</p>
                  <p className="text-[10px] text-gray-300 leading-snug">{data.internalNotes}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Form */}
      {isEditing && (
        <div className="bg-gradient-to-r from-lego-yellow/10 via-lego-yellow/5 to-transparent border border-lego-yellow/30 rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5">
              <Pencil className="h-3.5 w-3.5 text-lego-yellow" />
              <span className="text-[10px] md:text-xs font-bold text-lego-yellow">EDIT ORDER</span>
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" onClick={() => setIsEditing(false)} disabled={isSaving} data-testid="button-cancel-edit-order">
                <X className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isSaving} className="bg-lego-yellow text-black" data-testid="button-save-order">
                <Save className="h-3.5 w-3.5 mr-1" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[9px] md:text-xs font-bold text-gray-400 uppercase tracking-wide flex items-center gap-1">
              <MapPin className="h-3 w-3" /> Address
            </p>
            <div className="grid grid-cols-1 gap-2">
              <div>
                <Label className="text-[9px] text-gray-500">Street 1</Label>
                <Input
                  value={editForm.street1}
                  onChange={e => setEditForm(f => ({ ...f, street1: e.target.value }))}
                  className="h-8 text-xs bg-gray-900 border-gray-600"
                  placeholder="123 Main St"
                  data-testid="input-street1"
                />
              </div>
              <div>
                <Label className="text-[9px] text-gray-500">Street 2 (Apt, Suite, etc.)</Label>
                <Input
                  value={editForm.street2}
                  onChange={e => setEditForm(f => ({ ...f, street2: e.target.value }))}
                  className="h-8 text-xs bg-gray-900 border-gray-600"
                  placeholder="Apt 4B"
                  data-testid="input-street2"
                />
              </div>
              <div>
                <Label className="text-[9px] text-gray-500">Street 3 (International)</Label>
                <Input
                  value={editForm.street3}
                  onChange={e => setEditForm(f => ({ ...f, street3: e.target.value }))}
                  className="h-8 text-xs bg-gray-900 border-gray-600"
                  placeholder="Additional address line"
                  data-testid="input-street3"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[9px] text-gray-500">City</Label>
                  <Input
                    value={editForm.city}
                    onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))}
                    className="h-8 text-xs bg-gray-900 border-gray-600"
                    data-testid="input-city"
                  />
                </div>
                <div>
                  <Label className="text-[9px] text-gray-500">State / Province</Label>
                  <Input
                    value={editForm.state}
                    onChange={e => setEditForm(f => ({ ...f, state: e.target.value }))}
                    className="h-8 text-xs bg-gray-900 border-gray-600"
                    data-testid="input-state"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[9px] text-gray-500">Postal Code</Label>
                  <Input
                    value={editForm.postalCode}
                    onChange={e => setEditForm(f => ({ ...f, postalCode: e.target.value }))}
                    className="h-8 text-xs bg-gray-900 border-gray-600"
                    data-testid="input-postal-code"
                  />
                </div>
                <div>
                  <Label className="text-[9px] text-gray-500">Country</Label>
                  <Input
                    value={editForm.country}
                    onChange={e => setEditForm(f => ({ ...f, country: e.target.value }))}
                    className="h-8 text-xs bg-gray-900 border-gray-600"
                    placeholder="US"
                    data-testid="input-country"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-1 border-t border-gray-700">
            <p className="text-[9px] md:text-xs font-bold text-gray-400 uppercase tracking-wide flex items-center gap-1">
              <Weight className="h-3 w-3" /> Package Weight (including packaging)
            </p>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label className="text-[9px] text-gray-500">Weight</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={editForm.weight}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === '' || /^\d*\.?\d*$/.test(v)) setEditForm(f => ({ ...f, weight: v }));
                  }}
                  onFocus={e => e.target.select()}
                  className="h-8 text-xs bg-gray-900 border-gray-600"
                  placeholder="e.g. 8.5"
                  data-testid="input-weight"
                />
              </div>
              <div className="w-24">
                <Label className="text-[9px] text-gray-500">Unit</Label>
                <Select value={editForm.weightUnits} onValueChange={v => setEditForm(f => ({ ...f, weightUnits: v }))}>
                  <SelectTrigger className="h-8 text-xs bg-gray-900 border-gray-600" data-testid="select-weight-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="oz">oz</SelectItem>
                    <SelectItem value="lb">lb</SelectItem>
                    <SelectItem value="g">g</SelectItem>
                    <SelectItem value="kg">kg</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Items - Scrollable Table */}
      {(() => {
        const stockIssueItems = data.items.filter(i => i.stockWarning);
        const hasStockIssue = stockIssueItems.length > 0;
        return (
      <div className={`bg-gradient-to-r ${isUnshippedCancellation || hasStockIssue ? 'from-lego-red/10 via-lego-red/5' : 'from-lego-green/10 via-lego-green/5'} to-transparent border ${isUnshippedCancellation || hasStockIssue ? 'border-lego-red/40' : 'border-lego-green/30'} rounded-lg overflow-hidden`}>
        <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-1.5">
          <div className="flex items-center gap-2">
            <Package className={`h-4 w-4 ${isUnshippedCancellation || hasStockIssue ? 'text-lego-red' : 'text-lego-green'}`} />
            <h4 className={`text-[10px] md:text-sm font-black ${isUnshippedCancellation || hasStockIssue ? 'text-lego-red' : 'text-lego-green'}`}>ITEMS ({data.items.length})</h4>
          </div>
          {hasStockIssue && (
            <div className="flex items-center gap-1.5 text-[9px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded px-2 py-0.5" data-testid="stock-warning-banner">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>{stockIssueItems.length === 1 ? '1 ITEM' : `${stockIssueItems.length} ITEMS`} SHORT ON STOCK</span>
            </div>
          )}
        </div>
        
        <ScrollArea className="h-[180px] px-3 pb-2">
          <div className="space-y-1">
            <div className="grid grid-cols-12 gap-2 text-[9px] md:text-xs font-bold text-gray-500 border-b border-gray-700 pb-1 sticky top-0 bg-gray-900/95">
              <div className="col-span-1"></div>
              <div className="col-span-2">PART #</div>
              <div className="col-span-4">ITEM NAME</div>
              <div className="col-span-1 text-center">QTY</div>
              <div className="col-span-2 text-right">PRICE</div>
              <div className="col-span-2 text-right">TOTAL</div>
            </div>
            {data.items.map((item, index) => (
              <div
                key={index}
                onClick={() => {
                  if (!onItemClick) return;
                  // Prefer the actual BL inventory lot ID — matches the exact lot sold
                  if (item.blInventoryId) {
                    onItemClick('inventory', item.blInventoryId);
                  } else if (item.partNumber && item.colorId != null) {
                    // Color-aware catalog lookup (handler parses __c{colorId} suffix)
                    onItemClick('inventory', `bricklink-${item.partNumber}__c${item.colorId}`);
                  } else if (item.partNumber) {
                    onItemClick('inventory', `bricklink-${item.partNumber}`);
                  }
                }}
                className={`grid grid-cols-12 gap-2 text-[10px] md:text-sm items-center py-1 rounded transition-colors cursor-pointer ${item.stockWarning ? 'bg-amber-400/5 hover:bg-amber-400/10' : 'hover:bg-lego-green/5'}`}
                data-testid={`order-item-row-${index}`}
              >
                <div
                  className="col-span-1 flex items-center justify-center"
                  onClick={e => {
                    e.stopPropagation();
                    setLightboxItem({ partNumber: item.partNumber, name: item.name, imageUrl: item.imageUrl, itemType: item.itemType, colorId: item.colorId, blInventoryId: item.blInventoryId });
                  }}
                  data-testid={`order-item-thumb-${index}`}
                  title="View full image"
                >
                  <div className="w-7 h-7 rounded bg-gray-800 border border-gray-700 overflow-hidden flex items-center justify-center shrink-0 hover-elevate">
                    <PartImage
                      imageUrl={item.imageUrl}
                      partNumber={item.partNumber}
                      colorId={item.colorId}
                      itemType={item.itemType}
                      lotId={item.blInventoryId}
                      className="w-full h-full object-contain"
                      fallbackClassName="w-3.5 h-3.5 text-gray-600"
                    />
                  </div>
                </div>
                <div className="col-span-2 font-mono font-bold text-lego-blue truncate flex items-center gap-1" title={item.partNumber}>
                  {item.stockWarning && (
                    <AlertTriangle
                      className="h-3 w-3 shrink-0 text-amber-400"
                      data-testid={`stock-warning-icon-${index}`}
                    />
                  )}
                  <span className="truncate">{item.partNumber}</span>
                </div>
                <div className="col-span-4 text-white truncate" title={item.name}>{item.name}</div>
                <div className={`col-span-1 text-center font-bold ${item.stockWarning ? 'text-amber-400' : 'text-gray-300'}`}>
                  {item.quantity}
                  {item.stockWarning && item.currentInventoryQty !== null && item.currentInventoryQty !== undefined && (
                    <span className="block text-[8px] text-amber-500/80 font-normal leading-none">{item.currentInventoryQty} avail</span>
                  )}
                </div>
                <div className="col-span-2 text-right font-mono text-gray-300">${item.price.toFixed(2)}</div>
                <div className={`col-span-2 text-right font-mono font-bold ${isUnshippedCancellation ? 'text-lego-red line-through opacity-60' : 'text-lego-green'}`}>${(item.quantity * item.price).toFixed(2)}</div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
        );
      })()}

      {/* Financial Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <DollarSign className="h-4 w-4 text-lego-yellow" />
            <span className="text-[9px] md:text-xs font-bold text-gray-400">BREAKDOWN</span>
          </div>
          <div className="space-y-1 text-[9px] md:text-xs">
            <div className="flex justify-between">
              <span className="text-gray-400">Subtotal</span>
              <span className="font-mono text-white">${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center gap-2">
              <span className="text-gray-400 flex items-center gap-1 min-w-0">
                Shipping
                {data.requestedShippingService && (
                  <span className="text-[8px] text-gray-600 truncate hidden md:inline">({data.requestedShippingService})</span>
                )}
              </span>
              <span className="font-mono text-white flex-shrink-0">${shipping.toFixed(2)}</span>
            </div>
            {data.requestedShippingService && (
              <div className="text-[8px] text-gray-600 -mt-0.5 md:hidden truncate">{data.requestedShippingService}</div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-400">Tax</span>
              <span className="font-mono text-white">${tax.toFixed(2)}</span>
            </div>
            {data.insuranceAmount != null && data.insuranceAmount > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-emerald-400/80 flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3 flex-shrink-0" />
                  Insurance
                </span>
                <span className="font-mono text-emerald-400/80">${data.insuranceAmount.toFixed(2)}</span>
              </div>
            )}
            {isUnshippedCancellation && (
              <div className="pt-1 mt-1 border-t border-lego-red/30 space-y-1">
                <div className="flex justify-between items-center gap-1">
                  <span className="text-lego-red flex items-center gap-1 min-w-0">
                    <RotateCcw className="h-2.5 w-2.5 flex-shrink-0" />
                    <span className="truncate">{data.status === 'Returned' ? 'Returned — never shipped' : 'Cancelled — never shipped'}</span>
                  </span>
                  <span className="font-mono text-lego-red flex-shrink-0">-${total.toFixed(2)}</span>
                </div>
              </div>
            )}
            {hasAdjustments && (
              <div className="pt-1 mt-1 border-t border-lego-red/30 space-y-1">
                {refundAdjustments.map(adj => (
                  <div key={adj.id} className="flex justify-between items-center gap-1">
                    <span className="text-lego-red flex items-center gap-1 min-w-0">
                      <RotateCcw className="h-2.5 w-2.5 flex-shrink-0" />
                      <span className="truncate">{adj.reason || 'Refund'}</span>
                      {adj.paymentMethod && (
                        <Badge className="text-[8px] h-3 px-1 bg-lego-red/20 text-lego-red border-lego-red/30 ml-1">
                          {adj.paymentMethod}
                        </Badge>
                      )}
                    </span>
                    <span className="font-mono text-lego-red flex-shrink-0">
                      {adj.amount < 0 ? `-$${Math.abs(adj.amount).toFixed(2)}` : `$${adj.amount.toFixed(2)}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {(data.weight != null) && !isEditing && (
              <div className="flex justify-between pt-1 border-t border-gray-700 mt-1">
                <span className="text-gray-400 flex items-center gap-1">
                  <Weight className="h-3 w-3" /> Weight
                </span>
                <span className="font-mono text-gray-300">{data.weight} {data.weightUnits}</span>
              </div>
            )}
          </div>
        </div>

        <div className={`rounded-lg p-3 flex flex-col justify-center items-center ${
          isUnshippedCancellation || hasAdjustments
            ? 'bg-gradient-to-br from-lego-red/20 to-lego-red/5 border-2 border-lego-red/50'
            : 'bg-gradient-to-br from-lego-green/20 to-lego-green/5 border-2 border-lego-green/50'
        }`}>
          {isUnshippedCancellation ? (
            <>
              <span className="text-[9px] md:text-xs font-bold text-lego-red mb-0.5">{data.status === 'Returned' ? 'RETURNED' : 'CANCELLED'}</span>
              <span className="text-sm font-mono text-gray-400 line-through leading-none mb-1">${total.toFixed(2)}</span>
              <span className="text-[9px] md:text-xs font-bold text-gray-400 mb-0.5">NET REVENUE</span>
              <span className="text-2xl md:text-3xl font-black font-mono text-lego-red leading-none">$0.00</span>
            </>
          ) : hasAdjustments ? (
            <>
              <span className="text-[9px] md:text-xs font-bold text-gray-400 mb-0.5">ORIGINAL</span>
              <span className="text-sm font-mono text-gray-400 line-through leading-none mb-1">${total.toFixed(2)}</span>
              <span className="text-[9px] md:text-xs font-bold text-lego-red mb-0.5">NET AFTER REFUND</span>
              <span className="text-2xl md:text-3xl font-black font-mono text-lego-red leading-none">${netTotal.toFixed(2)}</span>
            </>
          ) : (
            <>
              <span className="text-[9px] md:text-xs font-bold text-gray-400 mb-1">ORDER TOTAL</span>
              <span className="text-2xl md:text-3xl font-black font-mono text-lego-green leading-none">${total.toFixed(2)}</span>
            </>
          )}
        </div>
      </div>

      {/* Business Costs — COGS, not part of the customer order */}
      {(hasFees || hasShippingCost) && (
        <div className="bg-gray-900/60 border border-amber-500/20 rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <CreditCard className="h-3 w-3 text-amber-500/70" />
            <span className="text-[9px] md:text-xs font-bold text-amber-500/70 uppercase tracking-wide">Business Costs</span>
            <span className="text-[8px] text-gray-600 ml-auto">COGS — not part of customer order</span>
          </div>
          <div className="space-y-0.5 text-[9px] md:text-xs">
            {feeAdjustments.map(fee => (
              <div key={fee.id} className="flex justify-between items-center">
                <span className="text-gray-500">{fee.reason || 'Merchant fee'}</span>
                <span className="font-mono text-amber-500/80">-${Math.abs(fee.amount).toFixed(2)}</span>
              </div>
            ))}
            {shippingAdjustments.map(sc => (
              <div key={sc.id} className="flex justify-between items-center">
                <span className="text-gray-500">{sc.reason || 'Shipping cost'}</span>
                <span className="font-mono text-amber-500/80">-${Math.abs(sc.amount).toFixed(2)}</span>
              </div>
            ))}
            <div className="flex justify-between items-center pt-1 border-t border-amber-500/10 mt-1">
              <span className="text-gray-500 font-medium">Total costs</span>
              <span className="font-mono text-amber-500/80 font-bold">-${(totalFees + totalShippingCost).toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Shipping Info */}
      {(data.shippedDate || data.trackingNumber) && (
        <div className="bg-gradient-to-r from-lego-green/15 via-lego-green/5 to-transparent border border-lego-green/30 rounded-lg p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[9px] md:text-xs flex-wrap gap-1">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-lego-green shrink-0" />
              <span className="font-bold text-lego-green">SHIPPED</span>
              {data.shippedDate && (
                <span className="text-gray-400">{new Date(data.shippedDate).toLocaleDateString()}</span>
              )}
              {(data.shippingCarrier || data.shippingService) && (
                <span className="text-gray-400">
                  {[data.shippingCarrier, data.shippingService].filter(Boolean).join(' ')}
                </span>
              )}
            </div>
            {data.labelUrl && (
              <a
                href={data.labelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] md:text-xs text-lego-blue underline underline-offset-2 hover:text-lego-blue/80"
              >
                Download Label
              </a>
            )}
          </div>
          {data.trackingNumber && (
            <div className="flex items-center gap-2">
              <span className="text-[9px] md:text-xs text-gray-400">Tracking:</span>
              <a
                href={getTrackingUrl(data.trackingNumber, data.shippingCarrier)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[9px] md:text-xs text-lego-blue font-semibold hover:underline underline-offset-2 flex items-center gap-1"
                data-testid="link-tracking-number"
              >
                {data.trackingNumber}
                <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
              </a>
            </div>
          )}
        </div>
      )}

      {/* Image Lightbox */}
      <Dialog open={!!lightboxItem} onOpenChange={open => { if (!open) setLightboxItem(null); }}>
        <DialogContent className="sm:max-w-md bg-gray-900 border-gray-700" data-testid="image-lightbox">
          <DialogHeader>
            <DialogTitle className="text-white text-sm font-mono">
              {lightboxItem?.partNumber}
              {lightboxItem?.name && (
                <span className="ml-2 text-gray-400 font-sans font-normal text-xs">{lightboxItem.name}</span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center bg-gray-800 rounded-md p-4" style={{ minHeight: 280 }}>
            {lightboxItem && (
              <PartImage
                imageUrl={lightboxItem.imageUrl}
                partNumber={lightboxItem.partNumber}
                colorId={lightboxItem.colorId}
                itemType={lightboxItem.itemType}
                lotId={lightboxItem.blInventoryId}
                className="max-w-full max-h-64 object-contain"
                fallbackClassName="w-16 h-16 text-gray-600"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

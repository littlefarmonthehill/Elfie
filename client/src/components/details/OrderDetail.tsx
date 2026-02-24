import { useState } from "react";
import { Package, DollarSign, User, MapPin, Calendar, Truck, RefreshCcw, Pencil, X, Save, Weight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";

interface OrderDetailProps {
  data: {
    id: string | number;
    loading?: boolean;
    orderId?: string;
    orderNumber?: string;
    platform?: 'BrickLink' | 'BrickOwl' | 'ShipStation' | 'Other';
    status?: 'Pending' | 'Paid' | 'Shipped' | 'Cancelled';
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
    isRepeatCustomer?: boolean;
    previousOrders?: Array<{
      orderId: string;
      orderNumber: string;
      orderDate: string;
      total: number;
      status: 'Pending' | 'Paid' | 'Shipped' | 'Cancelled';
    }>;
  };
  onOrderSelect?: (orderId: string) => void;
}

export default function OrderDetail({ data, onOrderSelect }: OrderDetailProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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

  const handleEditStart = () => {
    setEditForm({
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
      default: return 'bg-gray-800 text-gray-400 border-gray-700';
    }
  };

  const subtotal = data.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const shipping = data.shipping ?? 0;
  const tax = data.tax ?? 0;
  const total = data.total ?? 0;

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

  const canEdit = data.status !== 'Shipped' && data.status !== 'Cancelled';

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
            <h3 className="text-[10px] md:text-sm font-black text-white">ORDER #{data.orderNumber!}</h3>
            <Badge className={getStatusColor(data.status!) + ' text-[9px] md:text-xs h-5 px-2 font-bold'}>{data.status!}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-[9px] md:text-xs text-gray-400">
              <Calendar className="h-4 w-4" />
              <span className="font-medium">{new Date(data.orderDate!).toLocaleDateString()}</span>
            </div>
            {canEdit && !isEditing && (
              <Button
                size="icon"
                variant="ghost"
                onClick={handleEditStart}
                data-testid="button-edit-order"
                title="Edit address & weight"
              >
                <Pencil className="h-3.5 w-3.5 text-gray-400" />
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
            <span className="text-gray-400">{data.customer.city}, {data.customer.state}</span>
          </div>
        </div>
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
                  type="number"
                  step="0.1"
                  min="0"
                  value={editForm.weight}
                  onChange={e => setEditForm(f => ({ ...f, weight: e.target.value }))}
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
      <div className="bg-gradient-to-r from-lego-green/10 via-lego-green/5 to-transparent border border-lego-green/30 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 pt-2 pb-1.5">
          <Package className="h-4 w-4 text-lego-green" />
          <h4 className="text-[10px] md:text-sm font-black text-lego-green">ITEMS ({data.items.length})</h4>
        </div>
        
        <ScrollArea className="h-[180px] px-3 pb-2">
          <div className="space-y-1">
            <div className="grid grid-cols-12 gap-2 text-[9px] md:text-xs font-bold text-gray-500 border-b border-gray-700 pb-1 sticky top-0 bg-gray-900/95">
              <div className="col-span-2">PART #</div>
              <div className="col-span-5">ITEM NAME</div>
              <div className="col-span-1 text-center">QTY</div>
              <div className="col-span-2 text-right">PRICE</div>
              <div className="col-span-2 text-right">TOTAL</div>
            </div>
            {data.items.map((item, index) => (
              <div key={index} className="grid grid-cols-12 gap-2 text-[10px] md:text-sm items-center py-1 hover:bg-lego-green/5 rounded transition-colors">
                <div className="col-span-2 font-mono font-bold text-lego-blue truncate" title={item.partNumber}>{item.partNumber}</div>
                <div className="col-span-5 text-white truncate" title={item.name}>{item.name}</div>
                <div className="col-span-1 text-center font-bold text-gray-300">{item.quantity}</div>
                <div className="col-span-2 text-right font-mono text-gray-300">${item.price.toFixed(2)}</div>
                <div className="col-span-2 text-right font-mono font-bold text-lego-green">${(item.quantity * item.price).toFixed(2)}</div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

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
            <div className="flex justify-between">
              <span className="text-gray-400">Shipping</span>
              <span className="font-mono text-white">${shipping.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Tax</span>
              <span className="font-mono text-white">${tax.toFixed(2)}</span>
            </div>
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

        <div className="bg-gradient-to-br from-lego-green/20 to-lego-green/5 border-2 border-lego-green/50 rounded-lg p-3 flex flex-col justify-center items-center">
          <span className="text-[9px] md:text-xs font-bold text-gray-400 mb-1">ORDER TOTAL</span>
          <span className="text-2xl md:text-3xl font-black font-mono text-lego-green leading-none">${total.toFixed(2)}</span>
        </div>
      </div>

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
              <span className="font-mono text-[9px] md:text-xs text-lego-blue font-semibold">{data.trackingNumber}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

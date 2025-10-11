import { Package, DollarSign, User, MapPin, Calendar, Truck, RefreshCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

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
  // Show loading skeleton
  if (data.loading) {
    return (
      <div className="space-y-2" data-testid="order-detail-loading">
        {/* Header skeleton */}
        <div className="bg-gradient-to-r from-lego-blue/15 via-lego-blue/5 to-transparent border border-lego-blue/30 rounded-lg p-2">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="h-4 bg-gray-800 rounded w-32 animate-pulse"></div>
            <div className="h-3.5 bg-gray-800 rounded w-16 animate-pulse"></div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 bg-gray-800 rounded flex-1 animate-pulse"></div>
          </div>
        </div>

        {/* Content skeleton */}
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

  // Combine current order with other orders for the pills
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

  return (
    <div className="space-y-2">
      {/* Order Pills Navigation - Compact */}
      {data.isRepeatCustomer && allCustomerOrders.length > 1 && (
        <div className="bg-gradient-to-r from-lego-orange/10 via-lego-orange/5 to-transparent border border-lego-orange/30 rounded-lg p-1.5">
          <div className="flex items-center gap-1.5 mb-1">
            <RefreshCcw className="h-3 w-3 text-lego-orange" />
            <span className="text-[9px] font-bold text-lego-orange">CUSTOMER ORDERS ({allCustomerOrders.length})</span>
          </div>
          <ScrollArea className="w-full whitespace-nowrap">
            <div className="flex gap-1.5 pb-1">
              {allCustomerOrders.map((order) => (
                <button
                  key={order.orderId}
                  onClick={() => !order.isCurrent && onOrderSelect?.(order.orderId)}
                  disabled={order.isCurrent}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold transition-all border ${
                    order.isCurrent
                      ? 'bg-lego-orange text-white border-lego-orange shadow-lg shadow-lego-orange/20'
                      : 'bg-gray-900 text-gray-300 border-gray-700 hover:bg-lego-orange/20 hover:border-lego-orange/50'
                  }`}
                  data-testid={`order-pill-${order.orderId}`}
                >
                  <span className="font-black">#{order.orderNumber}</span>
                  <Badge className={getStatusColor(order.status) + ' text-[8px] h-3 px-1 font-bold'}>{order.status}</Badge>
                  <span className="text-lego-green font-mono font-black">${order.total.toFixed(2)}</span>
                </button>
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>
      )}

      {/* Compact Header with Customer - Ultra Condensed */}
      <div className="bg-gradient-to-r from-lego-blue/15 via-lego-blue/5 to-transparent border border-lego-blue/30 rounded-lg p-2">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-[10px] font-black text-white">ORDER #{data.orderNumber!}</h3>
            <Badge className={getStatusColor(data.status!) + ' text-[9px] h-3.5 px-1.5 font-bold'}>{data.status!}</Badge>
          </div>
          <div className="flex items-center gap-1 text-[9px] text-gray-400">
            <Calendar className="h-3 w-3" />
            <span className="font-medium">{new Date(data.orderDate!).toLocaleDateString()}</span>
          </div>
        </div>
        
        {/* Customer Info - Single Line */}
        <div className="flex items-center gap-2 text-[9px]">
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <User className="h-3 w-3 text-lego-blue flex-shrink-0" />
            <span className="font-bold text-white truncate">{data.customer.name}</span>
          </div>
          <div className="flex items-center gap-1">
            <MapPin className="h-3 w-3 text-gray-400 flex-shrink-0" />
            <span className="text-gray-400">{data.customer.city}, {data.customer.state}</span>
          </div>
        </div>
      </div>

      {/* Items - Scrollable Table with Fixed Height */}
      <div className="bg-gradient-to-r from-lego-green/10 via-lego-green/5 to-transparent border border-lego-green/30 rounded-lg overflow-hidden">
        <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
          <Package className="h-3.5 w-3.5 text-lego-green" />
          <h4 className="text-[10px] font-black text-lego-green">ITEMS ({data.items.length})</h4>
        </div>
        
        <ScrollArea className="h-[140px] px-2 pb-1.5">
          <div className="space-y-0.5">
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-1.5 text-[9px] font-bold text-gray-500 border-b border-gray-700 pb-0.5 sticky top-0 bg-gray-900/95">
              <div className="col-span-2">PART #</div>
              <div className="col-span-6">ITEM NAME</div>
              <div className="col-span-1 text-center">QTY</div>
              <div className="col-span-1.5 text-right">PRICE</div>
              <div className="col-span-1.5 text-right">TOTAL</div>
            </div>
            
            {/* Items Rows */}
            {data.items.map((item, index) => (
              <div key={index} className="grid grid-cols-12 gap-1.5 text-[10px] items-center py-0.5 hover:bg-lego-green/5 rounded transition-colors">
                <div className="col-span-2 font-mono font-bold text-lego-blue truncate" title={item.partNumber}>{item.partNumber}</div>
                <div className="col-span-6 text-white truncate" title={item.name}>{item.name}</div>
                <div className="col-span-1 text-center font-bold text-gray-300">{item.quantity}</div>
                <div className="col-span-1.5 text-right font-mono text-gray-300">${item.price.toFixed(2)}</div>
                <div className="col-span-1.5 text-right font-mono font-bold text-lego-green">${(item.quantity * item.price).toFixed(2)}</div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Financial Summary - Ultra Compact */}
      <div className="grid grid-cols-2 gap-1.5">
        {/* Totals */}
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 rounded-lg p-1.5">
          <div className="flex items-center gap-1 mb-1">
            <DollarSign className="h-3 w-3 text-lego-yellow" />
            <span className="text-[9px] font-bold text-gray-400">BREAKDOWN</span>
          </div>
          <div className="space-y-0.5 text-[9px]">
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
          </div>
        </div>

        {/* Total */}
        <div className="bg-gradient-to-br from-lego-green/20 to-lego-green/5 border-2 border-lego-green/50 rounded-lg p-1.5 flex flex-col justify-center items-center">
          <span className="text-[9px] font-bold text-gray-400 mb-0.5">ORDER TOTAL</span>
          <span className="text-2xl font-black font-mono text-lego-green leading-none">${total.toFixed(2)}</span>
        </div>
      </div>

      {/* Shipping Info - Ultra Compact */}
      {data.shippedDate && (
        <div className="bg-gradient-to-r from-lego-green/15 via-lego-green/5 to-transparent border border-lego-green/30 rounded-lg p-1.5">
          <div className="flex items-center justify-between text-[9px]">
            <div className="flex items-center gap-1">
              <Truck className="h-3 w-3 text-lego-green" />
              <span className="font-bold text-lego-green">SHIPPED</span>
              <span className="text-gray-400">{new Date(data.shippedDate).toLocaleDateString()}</span>
            </div>
            {data.trackingNumber && (
              <span className="font-mono text-lego-blue">{data.trackingNumber}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

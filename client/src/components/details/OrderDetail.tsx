import { Package, DollarSign, User, MapPin, Calendar, ExternalLink, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface OrderDetailProps {
  data: {
    orderId: string;
    orderNumber: string;
    platform: 'BrickLink' | 'BrickOwl' | 'Other';
    status: 'Pending' | 'Paid' | 'Shipped' | 'Cancelled';
    customer: {
      name: string;
      email: string;
      address: string;
      city: string;
      state: string;
      zip: string;
      country: string;
    };
    items: Array<{
      partNumber: string;
      name: string;
      quantity: number;
      price: number;
    }>;
    shipping: number;
    tax: number;
    total: number;
    orderDate: string;
    shippedDate?: string;
    trackingNumber?: string;
  };
}

export default function OrderDetail({ data }: OrderDetailProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending': return 'bg-lego-yellow/20 text-lego-yellow border-lego-yellow/30';
      case 'Paid': return 'bg-lego-blue/20 text-lego-blue border-lego-blue/30';
      case 'Shipped': return 'bg-lego-green/20 text-lego-green border-lego-green/30';
      case 'Cancelled': return 'bg-lego-red/20 text-lego-red border-lego-red/30';
      default: return 'bg-gray-800 text-gray-400 border-gray-700';
    }
  };

  const getPlatformColor = (platform: string) => {
    switch (platform) {
      case 'BrickLink': return 'bg-lego-blue/20 text-lego-blue border-lego-blue/30';
      case 'BrickOwl': return 'bg-lego-orange/20 text-lego-orange border-lego-orange/30';
      default: return 'bg-gray-800 text-gray-400 border-gray-700';
    }
  };

  const subtotal = data.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-gray-100">Order #{data.orderNumber}</h3>
          <div className="flex gap-2">
            <Badge className={getStatusColor(data.status)}>{data.status}</Badge>
            <Badge className={getPlatformColor(data.platform)}>{data.platform}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <Calendar className="h-3 w-3" />
          <span>{new Date(data.orderDate).toLocaleString()}</span>
        </div>
      </div>

      <Separator className="bg-gray-700" />

      {/* Customer Info */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-3">
          <User className="h-4 w-4 text-lego-blue" />
          <h4 className="text-sm font-semibold text-gray-300">Customer</h4>
        </div>
        <div className="space-y-1 text-sm">
          <p className="text-gray-100">{data.customer.name}</p>
          <p className="text-gray-400">{data.customer.email}</p>
          <div className="flex items-start gap-1 text-gray-400 mt-2">
            <MapPin className="h-3 w-3 mt-0.5" />
            <div>
              <p>{data.customer.address}</p>
              <p>{data.customer.city}, {data.customer.state} {data.customer.zip}</p>
              <p>{data.customer.country}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-3">
          <Package className="h-4 w-4 text-lego-blue" />
          <h4 className="text-sm font-semibold text-gray-300">Items ({data.items.length})</h4>
        </div>
        <div className="space-y-2">
          {data.items.map((item, index) => (
            <div key={index} className="flex justify-between items-start text-sm">
              <div className="flex-1">
                <p className="text-gray-100">{item.partNumber}</p>
                <p className="text-xs text-gray-400">{item.name}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-100">{item.quantity} × ${item.price.toFixed(2)}</p>
                <p className="text-xs text-lego-green font-mono">${(item.quantity * item.price).toFixed(2)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Order Summary */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign className="h-4 w-4 text-lego-green" />
          <h4 className="text-sm font-semibold text-gray-300">Order Summary</h4>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Subtotal:</span>
            <span className="font-mono text-gray-100">${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Shipping:</span>
            <span className="font-mono text-gray-100">${data.shipping.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Tax:</span>
            <span className="font-mono text-gray-100">${data.tax.toFixed(2)}</span>
          </div>
          <Separator className="bg-gray-700" />
          <div className="flex justify-between text-base">
            <span className="text-gray-300 font-semibold">Total:</span>
            <span className="font-mono text-lego-green font-semibold">${data.total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Shipping Info */}
      {data.shippedDate && (
        <div className="bg-gray-800 border border-lego-green/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Truck className="h-4 w-4 text-lego-green" />
            <h4 className="text-sm font-semibold text-gray-300">Shipping</h4>
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex items-center gap-1 text-gray-400">
              <Calendar className="h-3 w-3" />
              <span>Shipped {new Date(data.shippedDate).toLocaleDateString()}</span>
            </div>
            {data.trackingNumber && (
              <div className="flex items-center gap-1">
                <span className="text-gray-400">Tracking:</span>
                <span className="font-mono text-lego-blue">{data.trackingNumber}</span>
                <ExternalLink className="h-3 w-3 text-lego-blue" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

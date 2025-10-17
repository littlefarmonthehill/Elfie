import { useQuery } from "@tanstack/react-query";
import { Users, TrendingUp, Star, Target } from "lucide-react";
import { DateRangeValue } from "./DateRangeSelector";

interface Order {
  id: string;
  orderNumber: string;
  orderDate: string;
  orderStatus: string;
  orderTotal: string;
  customerUsername: string;
}

interface CustomerData {
  customerUsername: string;
  totalRevenue: number;
  orderCount: number;
  lastOrderDate: string;
}

interface MarketingDashboardProps {
  dateRange?: DateRangeValue;
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
}

export default function MarketingDashboard({ dateRange = 'mtd', onItemClick }: MarketingDashboardProps) {
  // Build query URL with date range parameter
  const buildQueryUrl = (baseUrl: string) => {
    if (dateRange === 'all') return baseUrl;
    return `${baseUrl}?range=${dateRange}`;
  };

  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ['/api/orders', dateRange],
    queryFn: async () => {
      const response = await fetch(buildQueryUrl('/api/orders'));
      if (!response.ok) throw new Error('Failed to fetch orders');
      return response.json();
    }
  });

  // Calculate customer metrics
  const getCustomerData = (): CustomerData[] => {
    const customerMap = new Map<string, CustomerData>();

    orders.forEach(order => {
      const customer = order.customerUsername || 'Unknown';
      const revenue = order.orderTotal && !isNaN(Number(order.orderTotal)) ? Number(order.orderTotal) : 0;
      
      if (customerMap.has(customer)) {
        const existing = customerMap.get(customer)!;
        existing.totalRevenue += revenue;
        existing.orderCount += 1;
        if (new Date(order.orderDate) > new Date(existing.lastOrderDate)) {
          existing.lastOrderDate = order.orderDate;
        }
      } else {
        customerMap.set(customer, {
          customerUsername: customer,
          totalRevenue: revenue,
          orderCount: 1,
          lastOrderDate: order.orderDate,
        });
      }
    });

    return Array.from(customerMap.values());
  };

  const customerData = getCustomerData();

  // Helper to get most recent order ID for a customer
  const getCustomerOrderId = (customerUsername: string): string | null => {
    const customerOrders = orders
      .filter(o => o.customerUsername === customerUsername)
      .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
    return customerOrders.length > 0 ? customerOrders[0].id : null;
  };

  // Top customers by revenue
  const topCustomers = [...customerData]
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 6);

  // Repeat customers (more than 1 order)
  const repeatCustomers = customerData
    .filter(c => c.orderCount > 1)
    .sort((a, b) => b.orderCount - a.orderCount)
    .slice(0, 6);

  // Recent new customers (first order in last 30 days)
  const recentNewCustomers = customerData
    .filter(c => {
      const daysSinceLastOrder = (new Date().getTime() - new Date(c.lastOrderDate).getTime()) / (1000 * 60 * 60 * 24);
      return c.orderCount === 1 && daysSinceLastOrder <= 30;
    })
    .sort((a, b) => new Date(b.lastOrderDate).getTime() - new Date(a.lastOrderDate).getTime())
    .slice(0, 6);

  // Calculate metrics
  const totalCustomers = customerData.length;
  const repeatCustomerCount = customerData.filter(c => c.orderCount > 1).length;
  const repeatCustomerRate = totalCustomers > 0 ? (repeatCustomerCount / totalCustomers * 100).toFixed(1) : '0.0';
  const averageOrdersPerCustomer = totalCustomers > 0 ? (orders.length / totalCustomers).toFixed(1) : '0.0';

  if (isLoading) {
    return (
      <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-yellow/5 to-transparent rounded-lg border border-lego-yellow/10 shadow-[0_0_15px_rgba(234,179,8,0.1)]">
        <div className="bg-gray-900/50 border border-lego-yellow/20 rounded-lg p-2">
          <div className="text-xs text-gray-400 animate-pulse">Loading customer data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-yellow/5 to-transparent rounded-lg border border-lego-yellow/10 shadow-[0_0_15px_rgba(234,179,8,0.1)]">
      {/* Key Metrics */}
      <div className="bg-gray-900/50 border border-yellow-500/20 rounded-lg p-4 md:p-5" data-testid="section-customer-metrics">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 md:w-5 md:h-5 text-yellow-400" />
          <h3 className="text-xs md:text-sm lg:text-base font-semibold text-yellow-400 uppercase tracking-wide">Customer Metrics</h3>
        </div>
        <div className="grid grid-cols-3 gap-2 md:gap-4">
          <div className="text-center">
            <div className="text-[11px] md:text-xs lg:text-sm text-gray-400 mb-1">Total Customers</div>
            <div className="text-lg md:text-xl text-gray-200 font-mono font-semibold">{totalCustomers}</div>
          </div>
          <div className="text-center">
            <div className="text-[11px] md:text-xs lg:text-sm text-gray-400 mb-1">Repeat Rate</div>
            <div className="text-lg md:text-xl text-lego-green font-mono font-semibold">{repeatCustomerRate}%</div>
          </div>
          <div className="text-center">
            <div className="text-[11px] md:text-xs lg:text-sm text-gray-400 mb-1 whitespace-nowrap">Avg Orders/Customer</div>
            <div className="text-lg md:text-xl text-gray-200 font-mono font-semibold">{averageOrdersPerCustomer}</div>
          </div>
        </div>
      </div>

      {/* Highlights - Top Customers */}
      <div className="bg-gray-900/50 border border-green-500/20 rounded-lg p-3 md:p-4" data-testid="section-top-customers">
        <div className="flex items-center gap-2 mb-2">
          <Star className="w-3.5 h-3.5 md:w-4 md:h-4 lg:w-5 lg:h-5 text-green-400" />
          <h3 className="text-xs md:text-sm lg:text-base font-semibold text-green-400 uppercase tracking-wide">Highlights - Top Customers by Revenue</h3>
        </div>
        <div className="space-y-1.5">
          {topCustomers.length > 0 ? (
            topCustomers.map((customer, idx) => (
              <div 
                key={customer.customerUsername + idx} 
                onClick={() => {
                  const orderId = getCustomerOrderId(customer.customerUsername);
                  if (orderId) onItemClick?.('order', orderId);
                }}
                className="flex justify-between items-center hover-elevate rounded px-2 py-1 cursor-pointer"
                data-testid={`top-customer-${idx}`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Star className="w-3.5 h-3.5 md:w-4 md:h-4 lg:w-5 lg:h-5 text-green-400 flex-shrink-0" />
                  <span className="text-gray-200 text-xs md:text-sm lg:text-base font-medium">{customer.customerUsername}</span>
                  <span className="text-gray-400 text-[11px] md:text-xs lg:text-sm">{customer.orderCount} {customer.orderCount === 1 ? 'order' : 'orders'}</span>
                </div>
                <span className="text-lego-green font-mono font-medium text-xs md:text-sm lg:text-base ml-2 flex-shrink-0">${customer.totalRevenue.toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-gray-500 italic">No customer data available</div>
          )}
        </div>
      </div>

      {/* Action Items - Repeat Customers */}
      <div className="bg-gray-900/50 border border-blue-500/20 rounded-lg p-3 md:p-4" data-testid="section-repeat-customers">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-3.5 h-3.5 md:w-4 md:h-4 lg:w-5 lg:h-5 text-blue-400" />
          <h3 className="text-xs md:text-sm lg:text-base font-semibold text-blue-400 uppercase tracking-wide">Action Items - Engage Repeat Customers</h3>
        </div>
        <div className="space-y-1.5">
          {repeatCustomers.length > 0 ? (
            repeatCustomers.map((customer, idx) => (
              <div 
                key={customer.customerUsername + idx} 
                onClick={() => {
                  const orderId = getCustomerOrderId(customer.customerUsername);
                  if (orderId) onItemClick?.('order', orderId);
                }}
                className="flex justify-between items-center hover-elevate rounded px-2 py-1 cursor-pointer"
                data-testid={`repeat-customer-${idx}`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Users className="w-3.5 h-3.5 md:w-4 md:h-4 lg:w-5 lg:h-5 text-blue-400 flex-shrink-0" />
                  <span className="text-gray-200 text-xs md:text-sm lg:text-base font-medium">{customer.customerUsername}</span>
                  <span className="text-gray-400 text-[11px] md:text-xs lg:text-sm">{customer.orderCount}x buyer</span>
                </div>
                <span className="text-lego-green font-mono font-medium text-xs md:text-sm lg:text-base ml-2 flex-shrink-0">${customer.totalRevenue.toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-gray-500 italic">No repeat customers yet</div>
          )}
        </div>
      </div>

      {/* Recent Activity - New Customers */}
      <div className="bg-gray-900/50 border border-purple-500/20 rounded-lg p-3 md:p-4" data-testid="section-new-customers">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-3.5 h-3.5 md:w-4 md:h-4 lg:w-5 lg:h-5 text-purple-400" />
          <h3 className="text-xs md:text-sm lg:text-base font-semibold text-purple-400 uppercase tracking-wide">Recent Activity - New Customers (Last 30 Days)</h3>
        </div>
        <div className="space-y-1.5">
          {recentNewCustomers.length > 0 ? (
            recentNewCustomers.map((customer, idx) => (
              <div 
                key={customer.customerUsername + idx} 
                onClick={() => {
                  const orderId = getCustomerOrderId(customer.customerUsername);
                  if (orderId) onItemClick?.('order', orderId);
                }}
                className="flex justify-between items-center hover-elevate rounded px-2 py-1 cursor-pointer"
                data-testid={`new-customer-${idx}`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="w-2 h-2 md:w-2.5 md:h-2.5 lg:w-3 lg:h-3 rounded-full bg-purple-400 flex-shrink-0" />
                  <span className="text-gray-200 text-xs md:text-sm lg:text-base font-medium">{customer.customerUsername}</span>
                  <span className="text-gray-400 text-[11px] md:text-xs lg:text-sm">{new Date(customer.lastOrderDate).toLocaleDateString()}</span>
                </div>
                <span className="text-lego-green font-mono font-medium text-xs md:text-sm lg:text-base ml-2 flex-shrink-0">${customer.totalRevenue.toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-gray-500 italic">No new customers in last 30 days</div>
          )}
        </div>
      </div>
    </div>
  );
}

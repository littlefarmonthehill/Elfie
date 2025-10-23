const BRICKOWL_API_BASE = 'https://api.brickowl.com/v1';

// Fetch BrickOwl orders
export async function getBrickOwlOrders(
  apiKey: string,
  options: {
    orderTime?: number; // Unix timestamp
    limit?: number;
  } = {}
): Promise<any[]> {
  const params = new URLSearchParams({
    key: apiKey,
  });

  if (options.orderTime) {
    params.append('order_time', options.orderTime.toString());
  }
  if (options.limit) {
    params.append('limit', options.limit.toString());
  }

  const url = `${BRICKOWL_API_BASE}/order/list?${params.toString()}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`BrickOwl API error: ${response.statusText}`);
  }

  const orders = await response.json();
  return Array.isArray(orders) ? orders : [];
}

// Fetch detailed order information
export async function getBrickOwlOrderDetails(
  apiKey: string,
  orderId: string
): Promise<any> {
  const params = new URLSearchParams({
    key: apiKey,
    order_id: orderId,
  });

  const url = `${BRICKOWL_API_BASE}/order/view?${params.toString()}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`BrickOwl API error: ${response.statusText}`);
  }

  const orderData = await response.json();
  
  // Fetch order items separately (BrickOwl uses a separate endpoint)
  const itemsUrl = `${BRICKOWL_API_BASE}/order/items?${params.toString()}`;
  const itemsResponse = await fetch(itemsUrl);
  
  if (!itemsResponse.ok) {
    console.warn(`⚠️ Failed to fetch items for order ${orderId}: ${itemsResponse.statusText}`);
    orderData.items = [];
  } else {
    const items = await itemsResponse.json();
    
    // Debug: Log first item structure to see what API returns
    if (Array.isArray(items) && items.length > 0 && parseInt(orderId) < 8374485) {
      console.log(`🔍 BrickOwl API /order/items sample for order ${orderId}:`, JSON.stringify(items[0]));
    }
    
    orderData.items = Array.isArray(items) ? items : [];
  }
  
  return orderData;
}

// Map BrickOwl status ID to normalized status
export function mapBrickOwlStatus(statusId: number): string {
  // Use hardcoded mapping for synchronous operation
  switch (statusId) {
    case 1: // Processing
      return 'awaiting_shipment';
    case 2: // Shipped
      return 'shipped';
    case 3: // Cancelled
      return 'cancelled';
    case 5: // Shipped (alternate ID)
      return 'shipped';
    default:
      return 'awaiting_shipment';
  }
}

// Map BrickOwl condition to normalized format
export function mapBrickOwlCondition(condition: string): string {
  return condition === 'new' ? 'New' : 'Used';
}

/**
 * Update BrickOwl order status to SHIPPED with tracking information
 */
export async function updateBrickOwlOrderShipped(
  orderId: string,
  trackingNumber: string,
  apiKey: string
): Promise<void> {
  const url = `${BRICKOWL_API_BASE}/order/update`;

  // BrickOwl requires application/x-www-form-urlencoded format
  const params = new URLSearchParams({
    key: apiKey,
    order_id: orderId,
    status_id: '2', // 2 = Shipped
    tracking_no: trackingNumber,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BrickOwl update order error: ${response.status} ${errorText}`);
  }

  console.log(`✅ BrickOwl order ${orderId} updated to SHIPPED with tracking ${trackingNumber}`);
}

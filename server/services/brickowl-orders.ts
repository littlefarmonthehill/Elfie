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
    include_items: '1', // ⭐ Required to get order items!
  });

  const url = `${BRICKOWL_API_BASE}/order/view?${params.toString()}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`BrickOwl API error: ${response.statusText}`);
  }

  const text = await response.text();
  console.log(`BrickOwl API raw response for order ${orderId}:`, text.slice(0, 3000));
  
  return JSON.parse(text);
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

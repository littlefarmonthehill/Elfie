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
    orderData.items = Array.isArray(items) ? items : [];
  }
  
  return orderData;
}

// Map BrickOwl status ID to normalized status
// Official BrickOwl status IDs (from https://www.brickowl.com/api_docs):
//   0 = Pending             (awaiting payment)
//   1 = Payment Submitted   (buyer initiated payment)
//   2 = Payment Received    (payment confirmed — seller needs to ship)
//   3 = Processing          (seller picking/packing)
//   4 = Processed           (packed, ready to dispatch)
//   5 = Shipped             (dispatched to buyer)
//   6 = Received            (buyer confirmed receipt)
//   7 = On Hold
//   8 = Cancelled
//
// textStatus is the formatted name returned by the API as a fallback
export function mapBrickOwlStatus(statusId: number | string | undefined | null, textStatus?: string | null): string {
  const id = statusId !== undefined && statusId !== null ? Number(statusId) : NaN;
  if (!isNaN(id)) {
    switch (id) {
      case 0: // Pending — awaiting payment
        return 'pending';
      case 1: // Payment Submitted
        return 'pending';
      case 2: // Payment Received — paid, awaiting fulfilment
        return 'awaiting_shipment';
      case 3: // Processing — seller is picking
        return 'awaiting_shipment';
      case 4: // Processed — packed, awaiting dispatch
        return 'awaiting_shipment';
      case 5: // Shipped
        return 'shipped';
      case 6: // Received — buyer confirmed, order complete
        return 'shipped';
      case 7: // On Hold
        return 'pending';
      case 8: // Cancelled
        return 'cancelled';
    }
  }

  // Fallback: map text status strings the API returns
  if (textStatus) {
    const t = textStatus.toLowerCase().trim();
    if (t === 'shipped' || t === 'dispatched' || t === 'sent') return 'shipped';
    if (t === 'received') return 'shipped';
    if (t === 'cancelled' || t === 'canceled') return 'cancelled';
    if (t === 'pending' || t === 'on hold' || t === 'payment submitted') return 'pending';
    if (t === 'payment received' || t === 'processing' || t === 'processed') return 'awaiting_shipment';
  }

  // Unknown status — treat as awaiting shipment (safest default for a paid order)
  return 'awaiting_shipment';
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
  // BrickOwl requires application/x-www-form-urlencoded for POST requests

  // Step 1: Set order status to Shipped (status_id 5)
  const statusParams = new URLSearchParams({
    key: apiKey,
    order_id: orderId,
    status_id: '5', // 5 = Shipped (per official BrickOwl API docs)
  });

  const statusResponse = await fetch(`${BRICKOWL_API_BASE}/order/set_status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: statusParams.toString(),
  });

  if (!statusResponse.ok) {
    const errorText = await statusResponse.text();
    throw new Error(`BrickOwl set_status error: ${statusResponse.status} ${errorText}`);
  }

  // Step 2: Attach tracking number
  const trackingParams = new URLSearchParams({
    key: apiKey,
    order_id: orderId,
    tracking_id: trackingNumber,
  });

  const trackingResponse = await fetch(`${BRICKOWL_API_BASE}/order/tracking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: trackingParams.toString(),
  });

  if (!trackingResponse.ok) {
    const errorText = await trackingResponse.text();
    // Tracking is non-fatal — status was already set; log a warning rather than throwing
    console.warn(`⚠️ BrickOwl tracking attach failed for order ${orderId}: ${trackingResponse.status} ${errorText}`);
  }

  console.log(`✅ BrickOwl order ${orderId} marked SHIPPED (status_id=5) with tracking ${trackingNumber}`);
}

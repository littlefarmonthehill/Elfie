import OAuth from 'oauth-1.0a';
import crypto from 'crypto';

const BRICKLINK_API_BASE = 'https://api.bricklink.com/api/store/v1';

// Clean token values - remove any non-alphanumeric characters that may have been added
const cleanToken = (value: string) => value.replace(/[^A-Z0-9]/gi, '');

// OAuth signature method
function getOAuthSignature() {
  return {
    hash_function(base_string: string, key: string) {
      return crypto
        .createHmac('sha1', key)
        .update(base_string)
        .digest('base64');
    },
  };
}

// Fetch BrickLink orders
export async function getBrickLinkOrders(
  consumerKey: string,
  consumerSecret: string,
  tokenValue: string,
  tokenSecret: string,
  options: {
    direction?: 'in' | 'out';
    status?: 'PENDING' | 'COMPLETED' | 'PURGED';
    limit?: number;
    filed?: boolean; // BrickLink API: true = archived orders, false = active orders, omit = all
  } = {}
): Promise<any[]> {
  const oauth = new OAuth({
    consumer: { key: consumerKey, secret: consumerSecret },
    signature_method: 'HMAC-SHA1',
    hash_function: getOAuthSignature().hash_function,
  });

  // Build query params first
  const params = new URLSearchParams();
  if (options.direction) params.append('direction', options.direction);
  if (options.status) params.append('status', options.status);
  if (options.filed !== undefined) {
    params.append('filed', options.filed ? 'true' : 'false');
  }
  
  // Build URL with query params - OAuth needs the full URL for signature
  const url = params.toString() 
    ? `${BRICKLINK_API_BASE}/orders?${params.toString()}`
    : `${BRICKLINK_API_BASE}/orders`;

  const requestData = {
    url,
    method: 'GET',
  };

  // Clean tokens before using them (removes any non-alphanumeric characters)
  const token = { 
    key: cleanToken(tokenValue), 
    secret: cleanToken(tokenSecret) 
  };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader.Authorization,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`BrickLink API error: ${response.status} ${response.statusText}`, errorText);
    throw new Error(`BrickLink API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  console.log(`BrickLink API response for status=${options.status}:`, JSON.stringify(data).slice(0, 300));
  
  // BrickLink returns { meta: {...}, data: [...] }
  const orders = data.data || [];
  
  // Apply limit if specified
  return options.limit ? orders.slice(0, options.limit) : orders;
}

// Fetch full order details (includes cost breakdown with shipping/tax)
export async function getBrickLinkOrderDetail(
  orderId: number,
  consumerKey: string,
  consumerSecret: string,
  tokenValue: string,
  tokenSecret: string
): Promise<any> {
  const oauth = new OAuth({
    consumer: { key: consumerKey, secret: consumerSecret },
    signature_method: 'HMAC-SHA1',
    hash_function: getOAuthSignature().hash_function,
  });

  const requestData = {
    url: `${BRICKLINK_API_BASE}/orders/${orderId}`,
    method: 'GET',
  };

  const token = { 
    key: cleanToken(tokenValue), 
    secret: cleanToken(tokenSecret) 
  };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

  const response = await fetch(requestData.url, {
    method: 'GET',
    headers: {
      Authorization: authHeader.Authorization,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`BrickLink order detail API error for order ${orderId}:`, response.status, errorText);
    throw new Error(`BrickLink API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data || null;
}

// Fetch order items for a specific order
export async function getBrickLinkOrderItems(
  orderId: number,
  consumerKey: string,
  consumerSecret: string,
  tokenValue: string,
  tokenSecret: string
): Promise<any[]> {
  const oauth = new OAuth({
    consumer: { key: consumerKey, secret: consumerSecret },
    signature_method: 'HMAC-SHA1',
    hash_function: getOAuthSignature().hash_function,
  });

  const requestData = {
    url: `${BRICKLINK_API_BASE}/orders/${orderId}/items`,
    method: 'GET',
  };

  // Clean tokens before using them (removes any non-alphanumeric characters)
  const token = { 
    key: cleanToken(tokenValue), 
    secret: cleanToken(tokenSecret) 
  };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

  const response = await fetch(requestData.url, {
    method: 'GET',
    headers: {
      Authorization: authHeader.Authorization,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`BrickLink items API error for order ${orderId}:`, response.status, errorText);
    throw new Error(`BrickLink API error: ${response.statusText}`);
  }

  const data = await response.json();
  console.log(`BrickLink items API response for order ${orderId}:`, JSON.stringify(data).slice(0, 500));
  // BrickLink returns items as nested array: [[item1, item2], [item3]] (array of batches)
  // Flatten to a single array of items
  const rawItems = data.data || [];
  const flatItems = rawItems.flat ? rawItems.flat() : [].concat(...rawItems);
  return flatItems;
}

// Map BrickLink status to normalized status (async version)
export async function mapBrickLinkStatus(blStatus: string): Promise<string> {
  // Import dynamically to avoid circular dependencies
  return import('../config/order-status-mapping.js').then(module => 
    module.mapPlatformStatus('bricklink', blStatus)
  ).catch(() => {
    // Fallback to hardcoded mapping if import fails
    switch (blStatus) {
      case 'PENDING':
        return 'awaiting_shipment';
      case 'COMPLETED':
        return 'shipped';
      case 'PURGED':
        return 'cancelled';
      default:
        return 'awaiting_shipment';
    }
  });
}

// Synchronous version using hardcoded mapping
export function mapBrickLinkStatusSync(blStatus: string): string {
  switch (blStatus) {
    case 'PENDING':
      return 'awaiting_shipment';
    case 'COMPLETED':
      return 'shipped';
    case 'PURGED':
      return 'cancelled';
    default:
      return 'awaiting_shipment';
  }
}

// Map BrickLink condition to normalized format
export function mapBrickLinkCondition(newOrUsed: string): string {
  return newOrUsed === 'N' ? 'New' : 'Used';
}

/**
 * Update BrickLink order status to SHIPPED with tracking information
 */
export async function updateBrickLinkOrderShipped(
  orderId: string,
  trackingNumber: string,
  carrier: string,
  consumerKey: string,
  consumerSecret: string,
  tokenValue: string,
  tokenSecret: string
): Promise<void> {
  const oauth = new OAuth({
    consumer: { key: consumerKey, secret: consumerSecret },
    signature_method: 'HMAC-SHA1',
    hash_function: getOAuthSignature().hash_function,
  });

  const token = { 
    key: cleanToken(tokenValue), 
    secret: cleanToken(tokenSecret) 
  };

  // Step 1: Update shipping details with tracking number
  // Note: date_shipped is NOT accepted by BrickLink's PUT /orders/{id} endpoint
  const updateUrl = `${BRICKLINK_API_BASE}/orders/${orderId}`;
  const updateData = {
    shipping: {
      tracking_no: trackingNumber,
    }
  };

  const updateRequest = {
    url: updateUrl,
    method: 'PUT',
    body: updateData,
  };

  const updateAuthHeader = oauth.toHeader(oauth.authorize(updateRequest, token));

  const updateResponse = await fetch(updateUrl, {
    method: 'PUT',
    headers: {
      'Authorization': updateAuthHeader.Authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updateData),
  });

  if (!updateResponse.ok) {
    const errorText = await updateResponse.text();
    throw new Error(`BrickLink update order error: ${updateResponse.status} ${errorText}`);
  }

  // Step 2: Update order status to SHIPPED
  const statusUrl = `${BRICKLINK_API_BASE}/orders/${orderId}/status`;
  const statusData = {
    field: 'status',
    value: 'SHIPPED'
  };

  const statusRequest = {
    url: statusUrl,
    method: 'PUT',
    body: statusData,
  };

  const statusAuthHeader = oauth.toHeader(oauth.authorize(statusRequest, token));

  const statusResponse = await fetch(statusUrl, {
    method: 'PUT',
    headers: {
      'Authorization': statusAuthHeader.Authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(statusData),
  });

  if (!statusResponse.ok) {
    const errorText = await statusResponse.text();
    throw new Error(`BrickLink update status error: ${statusResponse.status} ${errorText}`);
  }

  console.log(`✅ BrickLink order ${orderId} updated to SHIPPED with tracking ${trackingNumber}`);
}

// Mark a BrickLink order as COMPLETED via the BL API
export async function updateBrickLinkOrderToCompleted(
  blOrderNumber: string,
  consumerKey: string,
  consumerSecret: string,
  tokenValue: string,
  tokenSecret: string,
): Promise<void> {
  const oauth = new OAuth({
    consumer: { key: consumerKey, secret: consumerSecret },
    signature_method: 'HMAC-SHA1',
    hash_function: getOAuthSignature().hash_function,
  });

  const token = {
    key: cleanToken(tokenValue),
    secret: cleanToken(tokenSecret),
  };

  const statusUrl = `${BRICKLINK_API_BASE}/orders/${blOrderNumber}/status`;
  const statusData = { field: 'status', value: 'COMPLETED' };
  const statusRequest = { url: statusUrl, method: 'PUT', body: statusData };
  const authHeader = oauth.toHeader(oauth.authorize(statusRequest, token));

  const response = await fetch(statusUrl, {
    method: 'PUT',
    headers: {
      'Authorization': authHeader.Authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(statusData),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BrickLink mark COMPLETED error: ${response.status} ${errorText}`);
  }

  console.log(`✅ BrickLink order ${blOrderNumber} marked COMPLETED`);
}

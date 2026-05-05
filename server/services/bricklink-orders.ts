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

// Fetch messages for a specific order (buyer ↔ seller in-app messages)
export async function getBrickLinkOrderMessages(
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
    url: `${BRICKLINK_API_BASE}/orders/${orderId}/messages`,
    method: 'GET',
  };

  const token = { key: cleanToken(tokenValue), secret: cleanToken(tokenSecret) };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

  const response = await fetch(requestData.url, {
    method: 'GET',
    headers: { Authorization: authHeader.Authorization },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.warn(`BrickLink messages API warn for order ${orderId}:`, response.status, errorText);
    return [];
  }

  const data = await response.json();
  return data.data || [];
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
 * Update BrickLink order status to SHIPPED with tracking information.
 * Step 1: sets the tracking number on the order.
 * Step 2: PUTs status = SHIPPED on the order.
 *
 * NOTE: We deliberately do NOT call BrickLink's "drive_thru" endpoint here.
 * Despite its name, drive_thru advances the order all the way to COMPLETED on
 * BrickLink (it's the seller's "I'm done, buyer can take it from here" action).
 * COMPLETED is supposed to mean the buyer has received the package, so it's
 * the buyer's job to mark the order COMPLETED — not ours when we ship it.
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
  // Never touch real BL orders from dev
  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV] updateBrickLinkOrderShipped suppressed for order ${orderId} — tracking ${trackingNumber}`);
    return;
  }

  const oauth = new OAuth({
    consumer: { key: consumerKey, secret: consumerSecret },
    signature_method: 'HMAC-SHA1',
    hash_function: getOAuthSignature().hash_function,
  });

  const token = { 
    key: cleanToken(tokenValue), 
    secret: cleanToken(tokenSecret) 
  };

  // Step 1: Update shipping details with tracking number on the order record.
  // Note: date_shipped is NOT accepted by BrickLink's PUT /orders/{id} endpoint.
  const updateUrl = `${BRICKLINK_API_BASE}/orders/${orderId}`;
  const updateData = {
    shipping: {
      tracking_no: trackingNumber,
    }
  };

  const updateRequest = { url: updateUrl, method: 'PUT', body: updateData };
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

  // Step 2: Set status = SHIPPED via the status endpoint.
  // The buyer will mark the order COMPLETED themselves on receipt.
  const statusUrl = `${BRICKLINK_API_BASE}/orders/${orderId}/status`;
  const statusData = { field: 'status', value: 'SHIPPED' };
  const statusRequest = { url: statusUrl, method: 'PUT', body: statusData };
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

  console.log(`✅ BrickLink order ${orderId} marked SHIPPED with tracking ${trackingNumber}`);
}

/**
 * Send BrickLink drive-through notification — triggers the buyer email with tracking number.
 * BL API: POST /orders/{order_id}/drive_thru?tracking_no=...
 * Parameters are query-string only; OAuth signing must include them in the URL.
 * Returns { ok: true } on success or { ok: false, error: string } on failure (non-throwing).
 */
export async function sendBrickLinkDriveThrough(
  orderId: string,
  trackingNumber: string,
  consumerKey: string,
  consumerSecret: string,
  tokenValue: string,
  tokenSecret: string,
  mailMe = false,
): Promise<{ ok: boolean; error?: string }> {
  // Never email real buyers from dev
  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV] BL drive-through suppressed for order ${orderId} — tracking ${trackingNumber}`);
    return { ok: true };
  }

  try {
    const oauth = new OAuth({
      consumer: { key: consumerKey, secret: consumerSecret },
      signature_method: 'HMAC-SHA1',
      hash_function: getOAuthSignature().hash_function,
    });

    const token = {
      key: cleanToken(tokenValue),
      secret: cleanToken(tokenSecret),
    };

    // Query-string params — must be part of the URL for OAuth signing
    const params = new URLSearchParams({ tracking_no: trackingNumber });
    if (mailMe) params.set('mail_me', 'true');
    // Correct BL endpoint: drive_thru (abbreviated), POST method
    const dtUrl = `${BRICKLINK_API_BASE}/orders/${orderId}/drive_thru?${params.toString()}`;

    // OAuth signs the full URL (including query params) with no body
    const dtRequest = { url: dtUrl, method: 'POST' };
    const authHeader = oauth.toHeader(oauth.authorize(dtRequest, token));

    const response = await fetch(dtUrl, {
      method: 'POST',
      headers: { 'Authorization': authHeader.Authorization },
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok || (body?.meta?.code && body.meta.code !== 200 && body.meta.code !== 201)) {
      const msg = body?.meta?.description || body?.meta?.message || `HTTP ${response.status}`;
      return { ok: false, error: msg };
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message ?? 'unknown error' };
  }
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

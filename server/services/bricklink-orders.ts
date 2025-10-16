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
  return data.data || [];
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

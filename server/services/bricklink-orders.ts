import OAuth from 'oauth-1.0a';
import crypto from 'crypto';

const BRICKLINK_API_BASE = 'https://api.bricklink.com/api/store/v1';

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

  const requestData = {
    url: `${BRICKLINK_API_BASE}/orders`,
    method: 'GET',
  };

  const token = { key: tokenValue, secret: tokenSecret };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

  // Build query params
  const params = new URLSearchParams();
  if (options.direction) params.append('direction', options.direction);
  if (options.status) params.append('status', options.status);
  
  const url = `${requestData.url}?${params.toString()}`;

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

  const token = { key: tokenValue, secret: tokenSecret };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

  const response = await fetch(requestData.url, {
    method: 'GET',
    headers: {
      Authorization: authHeader.Authorization,
    },
  });

  if (!response.ok) {
    throw new Error(`BrickLink API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data || [];
}

// Map BrickLink status to ShipStation status
export function mapBrickLinkStatus(blStatus: string): string {
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

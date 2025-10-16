/**
 * Order Status Mapping Configuration
 * 
 * This centralizes all order status mappings across platforms and defines
 * inventory impact for each status transition.
 */

export type InventoryImpact = 'reduce' | 'restore' | 'none';

export interface StatusMapping {
  // Our normalized status (used internally)
  normalizedStatus: string;
  
  // Display name
  displayName: string;
  
  // Platform-specific status values
  shipStation?: string[];
  brickLink?: string[];
  brickOwl?: number[]; // BrickOwl uses numeric status IDs
  ebay?: string[];
  amazon?: string[];
  
  // Inventory impact when order reaches this status
  inventoryImpact: InventoryImpact;
  
  // Description of what this status means
  description: string;
}

/**
 * Master status mapping configuration
 * 
 * Inventory Impact Rules:
 * - 'reduce': Decrease inventory quantity by order line item quantities
 * - 'restore': Increase inventory quantity by order line item quantities
 * - 'none': No change to inventory
 */
export const ORDER_STATUS_MAPPINGS: Record<string, StatusMapping> = {
  // Order placed but payment not yet received
  'awaiting_payment': {
    normalizedStatus: 'awaiting_payment',
    displayName: 'Awaiting Payment',
    shipStation: ['awaiting_payment'],
    brickLink: [], // BrickLink doesn't have this status
    brickOwl: [], // BrickOwl doesn't have this status
    ebay: ['AwaitingPayment'],
    amazon: ['Pending'],
    inventoryImpact: 'none', // Don't reduce inventory until shipped
    description: 'Order placed, waiting for payment confirmation'
  },

  // Payment received, ready to fulfill
  'awaiting_fulfillment': {
    normalizedStatus: 'awaiting_fulfillment',
    displayName: 'Awaiting Fulfillment',
    shipStation: ['awaiting_fulfillment'],
    brickLink: [], // BrickLink uses PENDING
    brickOwl: [], // BrickOwl uses Processing
    inventoryImpact: 'none', // Don't reduce inventory until shipped
    description: 'Payment received, ready to pick and pack'
  },

  // Order being prepared for shipment
  'awaiting_shipment': {
    normalizedStatus: 'awaiting_shipment',
    displayName: 'Awaiting Shipment',
    shipStation: ['awaiting_shipment'],
    brickLink: ['PENDING'], // BrickLink PENDING maps here
    brickOwl: [1], // BrickOwl status_id 1 = Processing
    ebay: ['AwaitingShipment'],
    amazon: ['Unshipped'],
    inventoryImpact: 'none', // Don't reduce inventory until shipped
    description: 'Order picked/packed, waiting to ship'
  },

  // Order has been shipped to customer
  'shipped': {
    normalizedStatus: 'shipped',
    displayName: 'Shipped',
    shipStation: ['shipped'],
    brickLink: ['COMPLETED'], // BrickLink COMPLETED maps here
    brickOwl: [2], // BrickOwl status_id 2 = Shipped
    ebay: ['Shipped'],
    amazon: ['Shipped'],
    inventoryImpact: 'reduce', // Reduce inventory when shipped
    description: 'Order shipped and in transit to customer'
  },

  // Order delivered successfully
  'delivered': {
    normalizedStatus: 'delivered',
    displayName: 'Delivered',
    shipStation: ['delivered'],
    inventoryImpact: 'none', // Already reduced at shipped
    description: 'Order successfully delivered to customer'
  },

  // Order cancelled before shipment
  'cancelled': {
    normalizedStatus: 'cancelled',
    displayName: 'Cancelled',
    shipStation: ['cancelled'],
    brickLink: ['PURGED'], // BrickLink PURGED maps here
    brickOwl: [3], // BrickOwl status_id 3 = Cancelled
    ebay: ['Cancelled'],
    amazon: ['Cancelled'],
    inventoryImpact: 'restore', // Add inventory back when cancelled
    description: 'Order cancelled, inventory restored'
  },

  // Order returned after delivery
  'returned': {
    normalizedStatus: 'returned',
    displayName: 'Returned',
    shipStation: ['returned'],
    inventoryImpact: 'restore', // Add inventory back when returned
    description: 'Order returned by customer, inventory restored'
  },

  // Order on hold (payment issue, verification needed, etc.)
  'on_hold': {
    normalizedStatus: 'on_hold',
    displayName: 'On Hold',
    shipStation: ['on_hold'],
    ebay: ['OnHold'],
    inventoryImpact: 'none', // No inventory change while on hold
    description: 'Order on hold pending issue resolution'
  }
};

/**
 * Map platform status to normalized status
 */
export function mapPlatformStatus(platform: string, platformStatus: string | number): string {
  // Search through all mappings to find matching platform status
  for (const [normalizedStatus, mapping] of Object.entries(ORDER_STATUS_MAPPINGS)) {
    switch (platform.toLowerCase()) {
      case 'shipstation':
        if (mapping.shipStation?.includes(platformStatus as string)) {
          return normalizedStatus;
        }
        break;
      case 'bricklink':
        if (mapping.brickLink?.includes(platformStatus as string)) {
          return normalizedStatus;
        }
        break;
      case 'brickowl':
        if (mapping.brickOwl?.includes(platformStatus as number)) {
          return normalizedStatus;
        }
        break;
      case 'ebay':
        if (mapping.ebay?.includes(platformStatus as string)) {
          return normalizedStatus;
        }
        break;
      case 'amazon':
        if (mapping.amazon?.includes(platformStatus as string)) {
          return normalizedStatus;
        }
        break;
    }
  }
  
  // Default fallback
  return 'awaiting_shipment';
}

/**
 * Get inventory impact for a status
 */
export function getInventoryImpact(normalizedStatus: string): InventoryImpact {
  const mapping = ORDER_STATUS_MAPPINGS[normalizedStatus];
  return mapping?.inventoryImpact || 'none';
}

/**
 * Check if status transition requires inventory adjustment
 */
export function shouldAdjustInventory(
  fromStatus: string | null,
  toStatus: string
): { shouldAdjust: boolean; impact: InventoryImpact } {
  const fromImpact = fromStatus ? getInventoryImpact(fromStatus) : 'none';
  const toImpact = getInventoryImpact(toStatus);
  
  // Only adjust if impact changes
  const shouldAdjust = fromImpact !== toImpact && toImpact !== 'none';
  
  return { shouldAdjust, impact: toImpact };
}

/**
 * Get all possible statuses for a platform
 */
export function getPlatformStatuses(platform: string): Array<string | number> {
  const statuses: Array<string | number> = [];
  
  for (const mapping of Object.values(ORDER_STATUS_MAPPINGS)) {
    switch (platform.toLowerCase()) {
      case 'shipstation':
        if (mapping.shipStation) statuses.push(...mapping.shipStation);
        break;
      case 'bricklink':
        if (mapping.brickLink) statuses.push(...mapping.brickLink);
        break;
      case 'brickowl':
        if (mapping.brickOwl) statuses.push(...mapping.brickOwl);
        break;
      case 'ebay':
        if (mapping.ebay) statuses.push(...mapping.ebay);
        break;
      case 'amazon':
        if (mapping.amazon) statuses.push(...mapping.amazon);
        break;
    }
  }
  
  return [...new Set(statuses)]; // Remove duplicates
}

/**
 * Order Status Mapping Configuration
 *
 * This is the single source of truth for how platform-specific order statuses
 * map to ELFIE's normalized internal statuses, and what inventory impact each
 * transition carries.
 *
 * BrickOwl status IDs (authoritative — from https://www.brickowl.com/api_docs):
 *   0 = Pending            (awaiting payment)
 *   1 = Payment Submitted  (buyer initiated payment)
 *   2 = Payment Received   (payment confirmed)
 *   3 = Processing         (seller picking/packing)
 *   4 = Processed          (packed, ready to dispatch)
 *   5 = Shipped            (dispatched to buyer)
 *   6 = Received           (buyer confirmed receipt)
 *   7 = On Hold
 *   8 = Cancelled
 *
 * BrickLink statuses (from BrickLink API docs):
 *   PENDING    Order placed, payment pending
 *   PAID       Payment received
 *   PACKED     Order packed
 *   SHIPPED    Order shipped to buyer
 *   COMPLETED  Buyer confirmed receipt
 *   PURGED     Cancelled/archived
 *   OCR        Order Cancellation Requested
 *   NPB        Non-Paying Buyer
 *   NRS        Non-Receiving Seller
 *   NPX        Non-Paying (expired)
 *
 * NOTE: BrickOwl sync uses mapBrickOwlStatus() in brickowl-orders.ts (not this
 * file) as its runtime mapping. The brickOwl arrays here are kept in sync with
 * that function and are used for display purposes.
 */

export type InventoryImpact = 'reduce' | 'restore' | 'none';

export interface StatusMapping {
  normalizedStatus: string;
  displayName: string;
  brickLink?: string[];
  brickOwl?: number[];
  ebay?: string[];
  amazon?: string[];
  inventoryImpact: InventoryImpact;
  description: string;
}

export const ORDER_STATUS_MAPPINGS: Record<string, StatusMapping> = {
  awaiting_payment: {
    normalizedStatus: 'awaiting_payment',
    displayName: 'Awaiting Payment',
    brickLink: [],
    brickOwl: [0, 1, 7],
    ebay: ['AwaitingPayment'],
    amazon: ['Pending'],
    inventoryImpact: 'none',
    description: 'Order placed — waiting for payment confirmation',
  },

  awaiting_shipment: {
    normalizedStatus: 'awaiting_shipment',
    displayName: 'Awaiting Shipment',
    brickLink: ['PENDING', 'PAID', 'PACKED'],
    brickOwl: [2, 3, 4],
    ebay: ['AwaitingShipment'],
    amazon: ['Unshipped'],
    inventoryImpact: 'none',
    description: 'Payment confirmed — order is being picked, packed, or queued to ship',
  },

  shipped: {
    normalizedStatus: 'shipped',
    displayName: 'Shipped',
    brickLink: ['SHIPPED'],
    brickOwl: [5],
    ebay: ['Shipped'],
    amazon: ['Shipped'],
    inventoryImpact: 'reduce',
    description: 'Order dispatched — inventory deducted',
  },

  completed: {
    normalizedStatus: 'completed',
    displayName: 'Completed',
    // BrickLink COMPLETED = buyer confirmed receipt.
    // BrickOwl 6 = Received (same semantic). Note: BrickOwl runtime sync uses
    // mapBrickOwlStatus() directly so this array is for display/lookup only.
    brickLink: ['COMPLETED'],
    brickOwl: [6],
    inventoryImpact: 'none',
    description: 'Buyer confirmed receipt — no further inventory change',
  },

  delivered: {
    normalizedStatus: 'delivered',
    displayName: 'Delivered',
    brickLink: [],
    brickOwl: [],
    inventoryImpact: 'none',
    description: 'Order confirmed delivered by buyer — no additional inventory change',
  },

  cancelled: {
    normalizedStatus: 'cancelled',
    displayName: 'Cancelled',
    brickLink: ['PURGED', 'NPB', 'NRS', 'NPX'],
    brickOwl: [8],
    ebay: ['Cancelled'],
    amazon: ['Cancelled'],
    inventoryImpact: 'restore',
    description: 'Order cancelled — inventory restored only if it was previously deducted (post-ship cancel)',
  },

  on_hold: {
    normalizedStatus: 'on_hold',
    displayName: 'On Hold',
    brickLink: ['OCR'],
    brickOwl: [],
    ebay: ['OnHold'],
    inventoryImpact: 'none',
    description: 'Order paused pending issue resolution (e.g. cancellation request, dispute)',
  },

  returned: {
    normalizedStatus: 'returned',
    displayName: 'Returned',
    brickLink: [],
    brickOwl: [],
    inventoryImpact: 'restore',
    description: 'Order returned by buyer — inventory restored',
  },
};

/**
 * Map a platform-specific status value to our normalized internal status.
 * BrickLink and eBay/Amazon use string codes; BrickOwl uses numeric IDs.
 *
 * NOTE: BrickOwl sync calls mapBrickOwlStatus() directly (brickowl-orders.ts)
 * and does NOT use this function at runtime.
 */
export function mapPlatformStatus(platform: string, platformStatus: string | number): string {
  for (const [normalizedStatus, mapping] of Object.entries(ORDER_STATUS_MAPPINGS)) {
    switch (platform.toLowerCase()) {
      case 'bricklink':
        if (mapping.brickLink?.includes(platformStatus as string)) return normalizedStatus;
        break;
      case 'brickowl':
        if (mapping.brickOwl?.includes(platformStatus as number)) return normalizedStatus;
        break;
      case 'ebay':
        if (mapping.ebay?.includes(platformStatus as string)) return normalizedStatus;
        break;
      case 'amazon':
        if (mapping.amazon?.includes(platformStatus as string)) return normalizedStatus;
        break;
    }
  }
  return 'awaiting_shipment';
}

export function getInventoryImpact(normalizedStatus: string): InventoryImpact {
  return ORDER_STATUS_MAPPINGS[normalizedStatus]?.inventoryImpact ?? 'none';
}

export function getPlatformStatuses(platform: string): Array<string | number> {
  const statuses: Array<string | number> = [];
  for (const mapping of Object.values(ORDER_STATUS_MAPPINGS)) {
    switch (platform.toLowerCase()) {
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
  return Array.from(new Set(statuses));
}

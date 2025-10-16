# Platform Order API Mapping Analysis

## Executive Summary

This document maps BrickLink and BrickOwl order APIs to the existing ShipStation-based order structure. The goal is to transition from ShipStation to direct platform API calls while maintaining compatibility with existing functionality.

---

## Current Database Structure (ShipStation-based)

### `orders` Table
```typescript
{
  id: varchar (PK)                    // ShipStation order ID
  orderNumber: text                   // Display order number
  orderKey: text                      // ShipStation order key
  marketplace: text                   // Selling platform (BrickLink, eBay, etc.)
  orderDate: timestamp
  orderStatus: text                   // ShipStation status
  customerUsername: text
  customerEmail: text
  shipTo: text                        // Shipping address (stringified)
  billTo: text                        // Billing address (stringified)
  shipByDate: timestamp
  orderTotal: decimal(10,2)
  shippingAmount: decimal(10,2)
  taxAmount: decimal(10,2)
  internalNotes: text
  customerNotes: text
  requestedShippingService: text
  carrierCode: text
  serviceCode: text
  packageCode: text
  confirmation: text
  shipDate: timestamp
  syncedAt: timestamp
  updatedAt: timestamp
}
```

### `order_details` Table
```typescript
{
  id: varchar (PK)                    // UUID
  orderId: varchar (FK)               // References orders.id
  lineItemKey: text                   // ShipStation line item key
  sku: text                           // ⚠️ CURRENT: BrickLink part number
  name: text                          // Item name
  quantity: integer
  unitPrice: decimal(10,2)
  taxAmount: decimal(10,2)
  weight: decimal(10,2)
  weightUnits: text
  description: text
  options: text                       // JSON: ShipStation options array
  customField1: text
  customField2: text
  customField3: text
  bricklinkInventoryId: integer       // ⚠️ Parsed from options/description
  colorId: integer                    // Parsed from options/description
  condition: text                     // Parsed from options/description
  fulfilled: boolean
  fulfilledAt: timestamp
  syncedAt: timestamp
  updatedAt: timestamp
}
```

---

## BrickLink Order API Structure

### Endpoint: `GET /orders/{order_id}`

#### Order Object
```json
{
  "order_id": 3986441,
  "date_ordered": "2013-12-17T07:00:15.087Z",
  "seller_name": "your_store",
  "store_name": "your_store_name",
  "buyer_name": "customer_name",
  "buyer_email": "customer@email.com",
  "require_insurance": true,
  "status": "PENDING",
  "is_invoiced": false,
  "total_count": 10,
  "unique_count": 1,
  "payment": {
    "method": "PayPal.com",
    "currency_code": "USD",
    "date_paid": "2013-12-17T09:20:02.000Z",
    "status": "Sent"
  },
  "shipping": {
    "address": {
      "name": { "full": "Customer Name" },
      "full": "123 Main St, City, State",
      "country_code": "US"
    },
    "date_shipped": "2013-12-17T03:00:15.087Z",
    "tracking_no": "1Z999AA10123456784",
    "tracking_link": "https://..."
  },
  "cost": {
    "currency_code": "USD",
    "subtotal": "139.99",
    "grand_total": "157.80",
    "shipping": "14.76",
    "insurance": "3.05",
    "credit": "0.00",
    "coupon": "0.00",
    "etc1": "0.00",
    "etc2": "0.00"
  }
}
```

### Endpoint: `GET /orders/{order_id}/items`

#### Order Items
```json
[
  {
    "inventory_id": 123456,           // ⭐ BrickLink inventory ID
    "item": {
      "no": "3001",                   // Part number
      "name": "Brick 2 x 4",
      "type": "PART",
      "category_id": 1
    },
    "color_id": 1,
    "color_name": "White",
    "quantity": 5,
    "new_or_used": "N",
    "completeness": null,
    "unit_price": "0.10",
    "unit_price_final": "0.10",
    "disp_unit_price": "0.10",
    "disp_unit_price_final": "0.10",
    "currency_code": "USD",
    "disp_currency_code": "USD",
    "description": "Brand new condition",
    "remarks": "Bin A-12-3"
  }
]
```

#### BrickLink Statuses
- `PENDING` - Order pending (maps to awaiting_shipment)
- `COMPLETED` - Order completed (maps to shipped)
- `PURGED` - Order cancelled/purged (maps to cancelled)

---

## BrickOwl Order API Structure

### Endpoint: `GET /order/view?order_id=XXX`

#### Order Object
```json
{
  "order_id": "12345678",
  "order_time": 1634567890,           // Unix timestamp
  "status_id": 1,
  "status": "Processing",
  "buyer_name": "Customer Name",
  "buyer_email": "customer@email.com",
  "buyer_user_id": "98765",
  "store_name": "your_store",
  "store_id": "123",
  "ship_to_name": "Customer Name",
  "ship_street_1": "123 Main St",
  "ship_street_2": "Apt 4",
  "ship_city": "City",
  "ship_region": "State",
  "ship_post_code": "12345",
  "ship_country_code": "US",
  "currency": "USD",
  "base_order_total": "157.80",       // Includes items + shipping
  "shipping_method_id": "1",
  "shipping_method_name": "USPS Priority",
  "tracking_no": "1Z999AA10123456784",
  "payment_method": "PayPal",
  "buyer_order_notes": "Please ship carefully",
  "seller_order_notes": "Packed with bubble wrap",
  "total_quantity": 10,
  "vat_amount": "0.00",
  "items": [...]
}
```

#### Order Items (within items array)
```json
{
  "lot_id": "999001",                 // BrickOwl lot ID
  "boid": "123456-1",                 // BrickOwl item ID
  "type": "Part",
  "quantity": 5,
  "price": "0.10",                    // Unit price
  "color_id": 1,
  "color_name": "White",
  "item_name": "Brick 2 x 4",
  "condition": "new",
  "external_lot_ids": {
    "other": "123456"                 // ⭐ BrickLink inventory ID
  }
}
```

#### BrickOwl Statuses
- Status ID 1: "Processing" (maps to awaiting_shipment)
- Status ID 2: "Shipped" (maps to shipped)
- Status ID 3: "Cancelled" (maps to cancelled)

---

## Mapping to Current Structure

### Orders Table Mapping

| Current Field | BrickLink Source | BrickOwl Source | Notes |
|---------------|------------------|-----------------|-------|
| `id` | `order_id` (prefixed `bl-`) | `order_id` (prefixed `bo-`) | Add platform prefix |
| `orderNumber` | `order_id` | `order_id` | Display value |
| `orderKey` | `order_id` | `order_id` | For compatibility |
| `marketplace` | `"BrickLink"` | `"BrickOwl"` | Static value |
| `orderDate` | `date_ordered` | `order_time` (convert from Unix) | Parse timestamp |
| `orderStatus` | Map BL status → SS status | Map BO status → SS status | See status mapping below |
| `customerUsername` | `buyer_name` | `buyer_name` | Direct map |
| `customerEmail` | `buyer_email` | `buyer_email` | Direct map |
| `shipTo` | Stringify `shipping.address` | Stringify address fields | JSON or formatted string |
| `billTo` | Same as shipTo | Same as shipTo | BL/BO don't separate billing |
| `shipByDate` | `null` | `null` | Not provided by platforms |
| `orderTotal` | `cost.grand_total` | `base_order_total` | Parse decimal |
| `shippingAmount` | `cost.shipping` | Parse from total | BL: direct; BO: estimated |
| `taxAmount` | `0` (no tax field) | `vat_amount` | BL doesn't provide tax |
| `internalNotes` | Order messages | `seller_order_notes` | Fetch messages separately for BL |
| `customerNotes` | Order messages | `buyer_order_notes` | Fetch messages separately for BL |
| `requestedShippingService` | `null` | `shipping_method_name` | BO provides this |
| `carrierCode` | `null` | `null` | Not provided |
| `serviceCode` | `null` | `null` | Not provided |
| `packageCode` | `null` | `null` | Not provided |
| `confirmation` | `null` | `null` | Not provided |
| `shipDate` | `shipping.date_shipped` | `null` (set when status=shipped) | BL provides actual date |

### Order Details Table Mapping

| Current Field | BrickLink Source | BrickOwl Source | Notes |
|---------------|------------------|-----------------|-------|
| `id` | Generate UUID | Generate UUID | Auto-generated |
| `orderId` | Parent order ID | Parent order ID | FK to orders |
| `lineItemKey` | `inventory_id` | `lot_id` | For deduplication |
| **`sku`** | **`inventory_id`** ⭐ | **`external_lot_ids.other`** ⭐ | **BrickLink inventory ID** |
| `name` | `item.name` + color | `item_name` + color | Formatted display name |
| `quantity` | `quantity` | `quantity` | Direct map |
| `unitPrice` | `unit_price_final` | `price` | Parse decimal |
| `taxAmount` | `0` | `0` | Not itemized |
| `weight` | `null` | `null` | Not provided |
| `weightUnits` | `null` | `null` | Not provided |
| `description` | `description` | `null` | BL public description |
| `options` | Stringify item data | Stringify item data | For compatibility |
| `customField1` | `null` | `null` | Not used |
| `customField2` | `null` | `null` | Not used |
| `customField3` | `null` | `null` | Not used |
| **`bricklinkInventoryId`** | **`inventory_id`** | **`external_lot_ids.other`** | **Critical for warehouse** |
| `colorId` | `color_id` | `color_id` | Map BO→BL color |
| `condition` | `new_or_used` (N/U) | `condition` (new/used) | Normalize format |
| `fulfilled` | `false` (default) | `false` (default) | Track separately |
| `fulfilledAt` | `null` | `null` | Set when fulfilled |

---

## Status Mapping to ShipStation

We'll continue using ShipStation status values for consistency:

| Platform Status | ShipStation Status | Notes |
|-----------------|-------------------|-------|
| **BrickLink:** | | |
| `PENDING` | `awaiting_shipment` | Ready to ship |
| `COMPLETED` | `shipped` | Order shipped |
| `PURGED` | `cancelled` | Order cancelled |
| **BrickOwl:** | | |
| Status ID 1 ("Processing") | `awaiting_shipment` | Ready to ship |
| Status ID 2 ("Shipped") | `shipped` | Order shipped |
| Status ID 3 ("Cancelled") | `cancelled` | Order cancelled |

---

## Critical Implementation Notes

### 1. **SKU Field = BrickLink Inventory ID** ⭐
```typescript
// BrickLink
order_detail.sku = item.inventory_id.toString()
order_detail.bricklinkInventoryId = item.inventory_id

// BrickOwl
order_detail.sku = item.external_lot_ids?.other || null
order_detail.bricklinkInventoryId = parseInt(item.external_lot_ids?.other) || null
```

### 2. **BrickOwl External Lot IDs Structure**
- **Inventory sync**: We send `external_id` parameter → BrickOwl stores as `external_lot_ids.other`
- **Order items**: Returns as `external_lot_ids: { other: "123456" }`
- **Verification**: Already confirmed in platform sync that BrickLink inventory ID is in `external_lot_ids.other`

### 3. **Missing Data Handling**
- **BrickLink**: Shipping amount is provided in `cost.shipping`
- **BrickOwl**: Shipping is combined in `base_order_total` - need to calculate/estimate
- **Tax**: BrickLink doesn't provide tax; BrickOwl provides `vat_order` 

### 4. **Warehouse Integration**
- **Picklist** relies on `order_details.bricklinkInventoryId`
- **Fulfillment** relies on `order_details.bricklinkInventoryId`
- Both will continue to work as long as we populate this field correctly

### 5. **Order ID Prefixing**
Add platform prefixes to prevent collisions:
- BrickLink: `bl-{order_id}` → `bl-3986441`
- BrickOwl: `bo-{order_id}` → `bo-12345678`
- ShipStation: Keep existing `ss-{orderNumber}` format

---

## API Authentication

### BrickLink (OAuth 1.0)
Already configured in `app_settings`:
- `bricklinkConsumerKey`
- `bricklinkConsumerSecret`
- `bricklinkTokenValue`
- `bricklinkTokenSecret`

### BrickOwl (API Key)
Already configured in `app_settings`:
- `brickowlApiKey`

---

## Recommended Sync Strategy

### Phase 1: Parallel Running
1. Continue syncing from ShipStation (existing logic)
2. Add parallel sync from BrickLink orders
3. Add parallel sync from BrickOwl orders
4. Use order ID prefix to identify source
5. Deduplicate if same order appears in multiple sources

### Phase 2: Platform-Direct Only
1. Disable ShipStation sync
2. Rely solely on BrickLink + BrickOwl APIs
3. Maintain status compatibility for existing features

### Sync Frequency
- **BrickLink**: Poll every 5-15 minutes for new orders (status=PENDING)
- **BrickOwl**: Poll every 5-15 minutes for new orders (status_id=1)
- **Status updates**: Check for status changes (shipped/cancelled)

---

## Data Quality Checklist

✅ **Verified**: BrickOwl stores BrickLink inventory ID in `external_lot_ids.other`
✅ **Confirmed**: Platform sync correctly uses `external_id` parameter → `external_lot_ids.other`
✅ **Required**: BrickLink order items include `inventory_id` field
✅ **Required**: Map platform statuses to ShipStation statuses
✅ **Required**: Prefix order IDs with platform identifier
✅ **Critical**: Populate `sku` and `bricklinkInventoryId` with BrickLink inventory ID

---

## Next Steps

1. Create BrickLink order service (`server/services/bricklink-orders.ts`)
2. Create BrickOwl order service (`server/services/brickowl-orders.ts`)
3. Add order sync endpoints (`/api/orders/sync`)
4. Implement status mapping utilities
5. Add deduplication logic for multi-platform orders
6. Test warehouse integration (Picklist & Fulfillment)
7. Add automated sync scheduling (similar to inventory sync)

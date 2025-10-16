# Phase 1 UAT & Verification Plan

## Overview

During Phase 1, you'll run ShipStation + BrickLink + BrickOwl syncs in parallel to validate data accuracy. This document outlines how to verify everything is working correctly before transitioning to Phase 2.

---

## Verification Dashboard (What to Build)

### 1. **Sync Health Monitor**
Create a new dashboard view showing:

```
┌─────────────────────────────────────────────┐
│         ORDER SYNC HEALTH MONITOR           │
├─────────────────────────────────────────────┤
│                                             │
│  Last Sync Times:                           │
│  ✓ ShipStation:  2 min ago                 │
│  ✓ BrickLink:    3 min ago                 │
│  ✓ BrickOwl:     2 min ago                 │
│                                             │
│  Orders Synced (Last 24h):                  │
│  ShipStation:    45 orders                  │
│  BrickLink:      12 orders (27% of SS)      │
│  BrickOwl:       8 orders (18% of SS)       │
│                                             │
│  Duplicate Detection:                       │
│  ⚠ 3 orders found in multiple sources       │
│  └─ View Details →                          │
│                                             │
│  Data Discrepancies:                        │
│  ⚠ 2 orders with total mismatches           │
│  ⚠ 1 order with item count difference       │
│  └─ View Report →                           │
│                                             │
└─────────────────────────────────────────────┘
```

### 2. **Order Comparison View**
Side-by-side comparison for duplicate orders:

```
Order #3986441 - Found in 2 sources

┌─────────────────────┬─────────────────────┐
│   ShipStation       │    BrickLink API    │
├─────────────────────┼─────────────────────┤
│ ID: ss-BL3986441    │ ID: bl-3986441      │
│ Customer: John Doe  │ Customer: John Doe  │ ✓
│ Email: john@...     │ Email: john@...     │ ✓
│ Total: $157.80      │ Total: $157.80      │ ✓
│ Shipping: $14.75    │ Shipping: $14.76    │ ⚠
│ Items: 5            │ Items: 5            │ ✓
│ Status: awaiting_s… │ Status: awaiting_s… │ ✓
└─────────────────────┴─────────────────────┘

Action: [Use ShipStation] [Use BrickLink] [Merge]
```

---

## Daily Verification Checklist

### **Morning Check (5 minutes)**

1. **Sync Status**
   - [ ] All three syncs ran successfully overnight
   - [ ] No error logs in sync history
   - [ ] Sync timestamps are recent (<15 min)

2. **Order Counts**
   - [ ] ShipStation order count matches expected volume
   - [ ] BrickLink orders are subset of ShipStation (or explain difference)
   - [ ] BrickOwl orders are subset of ShipStation (or explain difference)

3. **Quick Spot Check**
   - [ ] Pick 1 random BrickLink order → verify in ShipStation
   - [ ] Pick 1 random BrickOwl order → verify in ShipStation
   - [ ] Check that items have `bricklinkInventoryId` populated

### **Weekly Deep Dive (30 minutes)**

1. **Data Quality Audit**
   - [ ] Run comparison report (see below)
   - [ ] Review all discrepancies
   - [ ] Document any systematic issues

2. **Warehouse Integration Test**
   - [ ] Test Picklist with BrickLink-sourced order
   - [ ] Test Picklist with BrickOwl-sourced order
   - [ ] Test Fulfillment flow end-to-end

3. **Performance Check**
   - [ ] Sync duration acceptable (<30 sec per platform)
   - [ ] No API rate limit errors
   - [ ] Database performance stable

---

## Automated Comparison Queries

### Query 1: Find Duplicate Orders
```sql
-- Orders that exist in multiple sources
SELECT 
  marketplace,
  order_number,
  COUNT(*) as source_count,
  STRING_AGG(id, ', ') as order_ids
FROM orders
WHERE marketplace IN ('BrickLink', 'BrickOwl')
  AND synced_at >= NOW() - INTERVAL '7 days'
GROUP BY marketplace, order_number
HAVING COUNT(*) > 1
ORDER BY marketplace, order_number;
```

### Query 2: Compare Order Totals
```sql
-- Find orders with total mismatches between sources
WITH order_pairs AS (
  SELECT 
    ss.order_number,
    ss.order_total as ss_total,
    bl.order_total as bl_total,
    ABS(ss.order_total - bl.order_total) as diff
  FROM orders ss
  JOIN orders bl ON ss.order_number = bl.order_number
  WHERE ss.id LIKE 'ss-%'
    AND bl.id LIKE 'bl-%'
    AND ss.marketplace = 'BrickLink'
)
SELECT * FROM order_pairs
WHERE diff > 0.01  -- Allow 1 cent rounding
ORDER BY diff DESC;
```

### Query 3: Verify SKU Population
```sql
-- Check that SKU = BrickLink inventory ID
SELECT 
  o.marketplace,
  COUNT(*) as total_items,
  COUNT(od.sku) as items_with_sku,
  COUNT(od.bricklink_inventory_id) as items_with_bl_id,
  COUNT(CASE WHEN od.sku = od.bricklink_inventory_id::text THEN 1 END) as matching
FROM orders o
JOIN order_details od ON o.id = od.order_id
WHERE o.marketplace IN ('BrickLink', 'BrickOwl')
  AND o.synced_at >= NOW() - INTERVAL '7 days'
GROUP BY o.marketplace;
```

### Query 4: Missing BrickLink Inventory IDs
```sql
-- BrickOwl orders missing external_lot_ids.other
SELECT 
  o.id,
  o.order_number,
  od.name,
  od.sku,
  od.bricklink_inventory_id
FROM orders o
JOIN order_details od ON o.id = od.order_id
WHERE o.marketplace = 'BrickOwl'
  AND o.synced_at >= NOW() - INTERVAL '7 days'
  AND od.bricklink_inventory_id IS NULL;
```

---

## UAT Test Cases

### **Test Case 1: BrickLink Order Sync**

**Objective**: Verify BrickLink orders sync correctly with all required fields

**Steps**:
1. Place a test order on BrickLink (or use recent real order)
2. Wait for sync to run (or trigger manual sync)
3. Verify order appears in database with `bl-` prefix
4. Check all fields populated:
   - ✓ Customer name/email
   - ✓ Shipping address
   - ✓ Order total matches
   - ✓ Status = `awaiting_shipment`
5. Check order items:
   - ✓ All items present
   - ✓ `sku` = BrickLink inventory ID
   - ✓ `bricklinkInventoryId` populated
   - ✓ Quantity correct
   - ✓ Price correct

**Expected**: Order syncs completely and accurately

**Pass Criteria**: All fields match BrickLink order exactly

---

### **Test Case 2: BrickOwl Order Sync**

**Objective**: Verify BrickOwl orders sync with BrickLink inventory IDs

**Steps**:
1. Place a test order on BrickOwl (ensure items have `external_lot_ids.other`)
2. Wait for sync to run
3. Verify order appears with `bo-` prefix
4. Check critical fields:
   - ✓ Customer info
   - ✓ Totals (note: shipping may be combined)
   - ✓ Status mapped correctly
5. **Critical Check - Items**:
   - ✓ `sku` = value from `external_lot_ids.other`
   - ✓ `bricklinkInventoryId` = integer parsed from `external_lot_ids.other`
   - ✓ Can match to warehouse locations

**Expected**: BrickLink inventory IDs extracted correctly

**Pass Criteria**: Every item has valid `bricklinkInventoryId`

---

### **Test Case 3: Duplicate Handling**

**Objective**: Verify deduplication logic works

**Steps**:
1. Find an order that exists in both ShipStation and BrickLink
2. Check database for duplicates
3. Verify deduplication occurred:
   - ✓ Only ONE order in database (or both with clear reconciliation)
   - ✓ Most authoritative source used (ShipStation during Phase 1)
   - ✓ No data loss

**Expected**: Smart deduplication, no conflicts

**Pass Criteria**: Data integrity maintained

---

### **Test Case 4: Warehouse Integration**

**Objective**: Ensure Picklist/Fulfillment work with platform orders

**Steps**:
1. Create picklist with order from BrickLink (`bl-` prefix)
2. Verify bins appear correctly
3. Mark items as pulled
4. Create picklist with order from BrickOwl (`bo-` prefix)
5. Verify bins appear correctly
6. Complete fulfillment flow

**Expected**: Warehouse ops work identically for all sources

**Pass Criteria**: No errors, bins match correctly via inventory ID

---

### **Test Case 5: Status Updates**

**Objective**: Verify status changes sync and map correctly

**Steps**:
1. Mark a BrickLink order as shipped in BrickLink
2. Wait for sync
3. Verify order status → `shipped` in database
4. Verify `shipDate` populated
5. Check tracking number synced

**Expected**: Status changes reflect accurately

**Pass Criteria**: Status mapping works both directions

---

### **Test Case 6: Edge Cases**

**Objective**: Test unusual scenarios

**Scenarios to test**:
1. **BrickOwl order with missing `external_lot_ids.other`**
   - Expected: Item syncs but flagged for manual review
   
2. **Order with 50+ items**
   - Expected: All items sync completely
   
3. **International order**
   - Expected: Address formats handled correctly
   
4. **Order with special characters in notes**
   - Expected: HTML entities decoded correctly
   
5. **Cancelled order**
   - Expected: Status = `cancelled`, excluded from active picklists

**Pass Criteria**: All edge cases handled gracefully

---

## Success Metrics (Weekly Report)

### **Week 1 Goals**
- [ ] 100% of BrickLink orders sync successfully
- [ ] 100% of BrickOwl orders sync successfully
- [ ] 95%+ of items have `bricklinkInventoryId` populated
- [ ] 0 critical errors in sync logs
- [ ] Warehouse ops work for all order sources

### **Week 2 Goals**
- [ ] Discrepancy rate < 1% (totals match within $0.01)
- [ ] Deduplication works for 100% of duplicate cases
- [ ] API performance stable (< 30 sec sync time)
- [ ] All UAT test cases pass

### **Go/No-Go Criteria for Phase 2**

✅ **GO if**:
- All BrickLink/BrickOwl orders sync correctly for 2+ weeks
- Data accuracy matches ShipStation (< 0.5% discrepancy)
- Warehouse integration fully functional
- No unresolved critical bugs
- Team confident in platform API reliability

🛑 **NO-GO if**:
- Missing inventory IDs on >5% of items
- Frequent sync failures
- Data quality issues
- Warehouse ops broken
- Unresolved bugs

---

## Issue Tracking Template

| Issue ID | Source | Description | Severity | Status | Resolution |
|----------|--------|-------------|----------|--------|------------|
| #001 | BrickOwl | Missing inventory ID on minifig orders | High | Open | Investigating |
| #002 | BrickLink | Shipping total off by $0.01 | Low | Resolved | Rounding fix |
| #003 | Both | Duplicate order not deduplicated | Medium | Open | Logic update needed |

**Severity Levels**:
- **Critical**: Blocks warehouse ops, data loss
- **High**: Missing required data, broken functionality
- **Medium**: Incorrect data, minor issues
- **Low**: Cosmetic, minor discrepancies

---

## Monitoring Dashboard SQL

```sql
-- Dashboard Summary Query
WITH sync_stats AS (
  SELECT 
    'ShipStation' as source,
    COUNT(*) as orders_24h,
    MAX(synced_at) as last_sync
  FROM orders 
  WHERE id LIKE 'ss-%' 
    AND synced_at >= NOW() - INTERVAL '24 hours'
  
  UNION ALL
  
  SELECT 
    'BrickLink' as source,
    COUNT(*) as orders_24h,
    MAX(synced_at) as last_sync
  FROM orders 
  WHERE id LIKE 'bl-%' 
    AND synced_at >= NOW() - INTERVAL '24 hours'
  
  UNION ALL
  
  SELECT 
    'BrickOwl' as source,
    COUNT(*) as orders_24h,
    MAX(synced_at) as last_sync
  FROM orders 
  WHERE id LIKE 'bo-%' 
    AND synced_at >= NOW() - INTERVAL '24 hours'
)
SELECT * FROM sync_stats;
```

---

## Quick Verification Command

Run this daily to get a health snapshot:

```sql
-- Daily Health Check
SELECT 
  'Orders synced today' as metric,
  COUNT(*) as value
FROM orders
WHERE synced_at >= CURRENT_DATE

UNION ALL

SELECT 
  'Items missing inventory ID' as metric,
  COUNT(*) as value
FROM order_details
WHERE bricklink_inventory_id IS NULL
  AND synced_at >= CURRENT_DATE

UNION ALL

SELECT 
  'Duplicate orders detected' as metric,
  COUNT(*) as value
FROM (
  SELECT order_number, marketplace
  FROM orders
  WHERE synced_at >= CURRENT_DATE
  GROUP BY order_number, marketplace
  HAVING COUNT(*) > 1
) dupes;
```

---

## Implementation Timeline

**Day 1-3**: Build verification dashboard and queries  
**Day 4-7**: Run first UAT test cases  
**Week 2**: Monitor daily, track metrics  
**Week 3**: Full UAT suite, edge case testing  
**Week 4**: Go/No-Go decision for Phase 2

**Bottom line**: If you can run these checks for 2 weeks with green lights across the board, you're ready to cut over to Phase 2! 🚀

---
name: DB index gaps + push danger
description: Which indexes were missing and why drizzle db:push is unsafe for additive index work on this project.
---

## The rule
Never use `npm run db:push` to add indexes on this project. Use `CREATE INDEX IF NOT EXISTS` via raw SQL instead.

**Why:** `drizzle-kit push` reconciles the full schema, including columns removed from `shared/schema.ts` but not yet dropped from the live DB (phantom columns from old migrations). It will prompt to drop data-bearing columns like `stock_quantity` (price_guide_cache, 9 639 rows), `paypal_order_id` (orders, 9 259 rows), etc.

## Indexes added (June 2026)

All created idempotently with `CREATE INDEX IF NOT EXISTS`.

| Table | Index | Why |
|-------|-------|-----|
| `bl_inventory` | `(org_id, item_no)` | Very common dual-filter lookup |
| `bl_inventory` | `(org_id, new_or_used)` | Condition filter appears constantly |
| `bl_inventory` | `(org_id, deleted_at)` | Soft-delete triple-filter `org=X AND deleted_at IS NULL AND qty>0` appears 20+ times in inventory.ts |
| `price_guide_cache` | `(item_no, item_type, color_id, new_or_used)` | **This table had zero indexes.** POM system queries it on every repricing cycle. |
| `price_guide_cache` | `(next_refresh)` | Scheduler scans for stale entries |
| `orders` | `(org_id, order_number)` | Order-number lookups, dedup checks, platform syncs |
| `inventory_embeddings` | `(inventory_id)` | LEFT JOIN to find inventory rows with no embedding |
| `order_embeddings` | `(order_id)` | LEFT JOIN to find orders with no embedding |
| `order_detail_embeddings` | `(order_detail_id)` | LEFT JOIN to find order_details with no embedding |

## How to apply future index changes
Write a one-shot script in `server/scripts/`, run it with `npx tsx server/scripts/<name>.ts`, then delete it. Define the same index in `shared/schema.ts` so the definition stays in sync (even if db:push can't safely apply it).

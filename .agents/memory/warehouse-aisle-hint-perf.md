---
name: Warehouse aisle-hint regex / DB saturation
description: Why /warehouse/lots can saturate the whole DB, and the expression index that fixes it
---

# /warehouse/lots aisle-hint can saturate the shared DB

`lotAisleHintSql` (server/routers/listing-batches.ts) is a correlated subquery run
PER output row by `GET /api/warehouse/lots` (default `filter=all`, limit 200). It
finds sibling lots by numeric base using
`regexp_replace(item_no, '^([0-9]+).*$', '\1')`.

**The trap:** applying that regex to the *column* defeats the plain `item_no`
btree index, so the subquery degrades to a scan of all filed lots for every output
row. Buffer hits ~110k/call. Under the Warehouse page's ~11-query mount fan-out +
refetches this pegs the shared Neon CPU, and because it's one DB, EVERY endpoint
(auth/session reads included) queues for minutes. On autoscale the app looks fully
down; it self-recovers only when the page stops being loaded and the instance
recycles.

**The fix (durable):** expression index whose expression matches the query's regex
EXACTLY, prefixed by the equality-filter columns:
`CREATE INDEX IF NOT EXISTS bl_inv_org_type_itembase_idx ON bl_inventory (org_id, item_type, (regexp_replace(item_no, '^([0-9]+).*$', '\1')))`
Planner then uses a BitmapOr (item_no index OR the expression index); buffer hits
110k→~2.8k, exec ~500ms→~3ms. Pure index add — results unchanged.

**Why an expression index, not a query rewrite:** lowest-risk hotfix; the regex
semantics are part of the product's filing-sibling logic.

**How to apply:** lives as a phase in `runMigrations()` (server/db.ts) per repo
convention (`CREATE INDEX IF NOT EXISTS`, additive, end of chain). If you ever
change the regex in `lotAisleHintSql`, change the index expression in lockstep or it
silently stops being used.

**Follow-up (non-blocking):** other per-row correlated exprs in /warehouse/lots
(assigned/binName/locationLabel/isFilingQueue) hit indexed columns and weren't the
driver; optionally gate `aisleName` to only the unassigned/filing views.

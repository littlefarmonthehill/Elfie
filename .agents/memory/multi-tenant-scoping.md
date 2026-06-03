---
name: Multi-tenant endpoint scoping
description: All order/fulfillment GET-by-id endpoints must be org-scoped or they leak cross-tenant data (IDOR).
---

# Tenant scoping on fetch-by-id endpoints

Any endpoint that fetches a record by primary key (e.g. `orders` by `id`) and
returns it MUST scope the query by `orgId`, not just by id:
`where(and(eq(orders.id, id), eq(orders.orgId, orgId)))`, returning 404 on miss.

**Why:** A real IDOR existed where `GET /fulfillment/order-shipping/:orderId`
fetched by `orders.id` alone (computing `orgId` only for a settings lookup), so
any authenticated user from another org could read another org's order — and once
financial fields (order total, shipping, insurance) were added to the response it
leaked money data. `isApproved` auth alone does NOT enforce tenant isolation.

**How to apply:** when adding/reviewing a GET-by-id route in server/routers,
confirm the WHERE clause includes `orgId`. Watch for the trap where `reqOrgId(req)`
is computed but only used for a secondary query, giving false confidence.
Also validate numeric body params (e.g. insurance) server-side before passing to
external vendor APIs — coerce, require finite & non-negative, treat 0/blank as unset.

## Raw-SQL multi-table joins must scope EVERY tenant table, not just the driver

In hand-written `sql` joins (e.g. warehouse scan/resolve sibling-bin suggestion),
scoping only the driving table (`bl_inventory`/`inventory_locations`) by `org_id`
is NOT enough. Every tenant-partitioned table joined in (`wh_bins`, `wh_shelves`,
`wh_aisles`) carries its own `org_id` and must get an explicit `AND x.org_id = ${orgId}`
predicate in its JOIN/ON (or WHERE). Otherwise a location row pointing at a foreign
bin can surface another org's bin/shelf/aisle names.

**Why:** the Drizzle query-builder relations don't auto-add tenant predicates, and
raw SQL has no FK-driven safety net — a missing predicate silently widens the scan
across all orgs.

**How to apply:** for any raw `sql` join touching `wh_*` / `inventory_locations` /
`bl_inventory`, put `org_id = ${orgId}` on each joined tenant table, not just the first.

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

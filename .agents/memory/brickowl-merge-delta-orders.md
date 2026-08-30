---
name: BrickOwl merge-delta orders
description: How BrickOwl "merge" (items added to an existing order) is represented internally, and why it can leak into "new order" notifications/queries if not filtered.
---

When BrickOwl reports new items or increased quantities on an order that
already exists in our DB, we don't overwrite the original order — we create
a second synthetic "delta" order row (`orderNumber` suffixed `-M`, `id`
suffixed `-m<timestamp>`) containing only the added items, so it can be
picked/processed like a normal order. Both rows get the same
`mergeGroupId` (set to the original order's `id`); the original row is
identifiable because `id === mergeGroupId`, the delta row because
`id !== mergeGroupId`.

This delta row still increments `ordersAdded` in the sync result, because
operationally it does need picking/fulfillment. But it is NOT a real order
that exists on the channel — a customer never placed "8051734-M".

**Why this matters:** any code that queries "the N most-recently-synced
orders" to react to "new orders" (push notifications, alerts, etc.) will
pick up these delta rows unless it explicitly excludes them. This caused
phantom push notifications like "8051734-M is in the queue" for orders
that don't exist on BrickLink/BrickOwl.

**How to apply:** when building any "new order" surface (notifications,
alerts, digests) that queries recently-synced orders, filter with
`mergeGroupId IS NULL OR id = mergeGroupId` to exclude delta rows. Don't
change how `ordersAdded` is counted or how delta orders are created —
they're needed for correct picking; only exclude them from
customer/operator-facing "new order arrived" framing.

**Fresh-alert rule:** a new-order notification must use only IDs proven to
have been inserted as customer orders during the current sync run. Broad
`ordersAdded` values, recency queries, and `inventoryDeducted` are
operational/recovery signals, not notification evidence.

**Why:** incremental BrickOwl syncs fetch updates as well as new orders, and
an interrupted or concurrent sync can leave an existing order undeducted.
Those cases still need inventory recovery, but announcing them as a newly
placed customer order creates a false alert.

**How to apply:** carry a dedicated list of verified fresh order IDs from the
adapter to every notification caller. Prove insertion with an insert that
returns a row only on success; on a conflict, update/recover the existing row
without adding it to the notification list.

**Second root cause (relisted lots on an already-terminal order):** a
false "merge" can also be detected on an order that's already
shipped/completed/cancelled/returned — a lot that was sold and later
relisted can still carry stale `external_lot_ids`/lot_id references
that get diffed against the old order's stored items, producing a
spurious item delta on an order that can never legitimately receive new
items. Fix: `brickowl-order-sync.ts` now tracks the order's resolved
status through the sync pass (`finalOrderStatus`) and skips delta-order
creation entirely when that status is terminal, logging a warning
instead. If phantom merges recur on non-terminal orders, the root cause
is different (real duplicate/stale lot_id reuse) and needs separate
investigation.

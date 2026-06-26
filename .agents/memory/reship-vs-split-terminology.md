---
name: Reship vs Split terminology
description: Why the post-ship order-split action is labeled "Reship Items" in the UI, not "Split Order"
---

The same underlying mechanism (move selected items off an order into a new $0
child order routed to Fulfillment) is surfaced under two different user-facing
names depending on order stage:

- **Pre-ship / fulfillment stage**: "Split" still fits — you're dividing an order
  into multiple shipments before it goes out.
- **Post-ship (beyond label status, package shown as In Transit/Delivered)**: the
  action is a packing-mistake correction, so it's labeled **"Reship Items"**
  (industry/3PL standard for re-sending wrong/missing items without disturbing the
  original shipment). The original order keeps its tracking and ship info.

**Why:** user feedback — "split order" reads like a fulfillment concept; after
shipment it's really an order correction / reship. Chosen over "Replacement
Order" (RMA framing) and "Order Correction" (vaguer).

**How to apply:** keep all user-visible strings for the post-ship action using
"Reship" wording — menu item, dialog title/button, success/error toasts, and the
internal-notes stamp on both the new child order ("Reship from …") and the
original ("Reship: N items moved to …"). Internal code identifiers (splitOrder
mutation, /split route, splitDialog state) were intentionally left as-is to avoid
churn; only labels changed.

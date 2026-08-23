---
name: Historical recovery identity
description: Safety rule for reconciling historical external-order lines without corrupting fulfillment history.
---

Historical order recovery may mutate a local line only when both the external order and external line have immutable identifiers that map uniquely to the local records. A unique order number, SKU/name/price fingerprint, or other display-field match is never sufficient to confirm a repair; it may be presented for review but must remain skip-only.

**Why:** Legacy channel imports and marketplaces can reuse order numbers or line descriptions. Treating those as identity can attach a valid external item to the wrong local order and silently corrupt fulfillment and sales reporting.

**How to apply:** Keep this invariant in candidate classification and in the write endpoint. When historical channel records predate source-ID storage, let an administrator explicitly verify and persist the immutable source-to-local order link before exposing line repairs; never bootstrap that link from an order number. Confirm-add operations also need an all-writers database guard for the immutable `(order, line)` identity: endpoint-only idempotency cannot prevent a concurrent channel sync from adding the same row.
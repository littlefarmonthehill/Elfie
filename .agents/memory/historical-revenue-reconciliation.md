---
name: Historical revenue reconciliation
description: Safety rules for comparing historical ShipStation and local revenue without counting ambiguous or date-boundary records.
---

Resolve ShipStation/local identity over the complete scoped history before applying a requested date range. Revenue totals may only include a unique, immutable source-to-local match that meets the normal revenue status rules. A source-only record is never assumed deleted without a reviewed mapping to a missing local row; order-number matches are unmatched review leads only. Multiple ShipStation records claiming one local identity are ambiguous evidence, not a valid match.

**Why:** Filtering either side of a reconciliation by its own timestamp before resolving identity can turn a valid cross-boundary record into a false deletion or absence. Choosing one record from multiple source claims makes historical revenue depend on API page order and silently double-counts.

**How to apply:** Keep date-boundary and ambiguous-identity cases visible as order-level evidence and outside matched totals. Apply status/test exclusions only after a unique identity match is established. Keep fixed suspect batches excluded until their existing review audit explicitly confirms or corrects the status.
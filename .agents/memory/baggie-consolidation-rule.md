---
name: Baggie consolidation rule
description: Domain rule for when warehouse filing may merge physical baggies vs only co-locate
---

A physical baggie may hold multiple lots, but **never new + used together**. Multiple
colours of the same condition CAN share one baggie.

**Why:** Reseller's stated workflow constraint; drives the filing "consolidate" alert copy.

**How to apply:** The scan/resolve sibling cascade (`suggestedBin.matchLevel` in
`server/routers/warehouse.ts`, mirrors `lotAisleHintSql`) maps to filing guidance:
- restock of the exact same lot (lot already has `locations`) → combine into existing baggie
- matchLevel 1 (same part+colour+condition) → combine
- matchLevel 2 (same part+condition, diff colour) → combine (same condition can share)
- matchLevel 3 (same part only, condition may differ) → **co-locate in same bin only, do NOT merge bags**

The WarehouseScanPanel consolidate banner switches title/body on a `canCombine`
flag = `locations.length>0 || matchLevel<=2`. Level 3 must never say "combine" /
"don't start a second baggie".

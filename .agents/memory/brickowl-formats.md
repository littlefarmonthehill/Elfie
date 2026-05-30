---
name: BrickOwl export/identifier conventions
description: How BrickOwl inventory XML and boids encode BrickLink identifiers, used when ingesting BO-native data.
---

# BrickOwl identifier conventions

BrickOwl inventory XML export uses an `<inventory>` root with `<lot>` children (NOT
BrickLink's `ITEM` nodes — they share the `<inventory>` root, so detect BrickOwl by
`<boid>`/`<brickowl_item_id>`/`<lot_id>` BEFORE falling back to the BrickLink parser).

A lot's fields:
- `<boid>` — `"{owlId}-{boColorId}"`, e.g. `272330-74`. The suffix after the LAST `-`
  is the BrickOwl color id, which maps to a BrickLink color id via the existing
  color map (reverse direction: BO color -> BL color).
- `<name>` — human name with the design IDs in the LAST parenthetical, formatted
  `(BL-design-id / LEGO-element-id)`, e.g. `"...Pretzel (10170 / 34094)"`. Part names
  can contain their own parens, so take the LAST `\(([^()]*)\)` group and split on
  `/ , whitespace`. The FIRST candidate is normally the BrickLink item number.
- `<quantity>`, `<base_price>`, `<condition>` (new/used).

**Why:** boids and BO color ids are not BrickLink identifiers; anything BL-keyed
(catalog lookups, price guides, stock overlap) must resolve them first.

**How to apply:** when ingesting BO-native data, resolve boid -> BL itemNo by
validating name candidates against `bl_catalog` (prefer a validated candidate, but
fall back to the first candidate since the local catalog is incomplete — dropping
unvalidated items loses legitimate user uploads), and boid color suffix -> BL color
via the reverse color map. The Acquisition Evaluator does this server-side so the
rest of its flow stays BL-keyed.

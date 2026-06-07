---
name: Lot label "rtf N" aisle hint
description: Why lot labels print "rtf 0" and how the re-file aisle is resolved across multiple print entry points
---

The lot-label template (`LotLabelTemplatePrint.tsx`) prints the re-file destination as `rtf ${lot.aisleName ?? 0}`. When `aisleName` is missing it **silently falls back to "rtf 0"** — there is no error, so a wrong/zero aisle looks like normal output.

`aisleName` is NOT a stored column. It is computed per request by a hierarchical correlated subquery (`lotAisleHintSql`, defined in `listing-batches.ts`, now exported and reused by `warehouse.ts`). Priority: own bin (part+color+condition) → sibling part+color+condition → part+condition → part-only. This lets a brand-new lot pre-file into the tote that already holds its closest sibling.

**Rule:** every endpoint that feeds the lot-label print queue must populate `aisleName` via the shared `lotAisleHintSql`. There are multiple print entry points (date-range listing labels, lot-search single-lot quick print via `setQuickPrintItems`, inventory detail). A new entry point that returns lots without `aisleName` will print "rtf 0" for everything.

**Why:** the bug was exactly this — `GET /api/warehouse/lots` (lot search → quick print) selected `binName`/`locationLabel` but never `aisleName`, so searched lots always printed "rtf 0" even when the part lived in an aisle.

**How to apply:** when adding/auditing any lot-label print path, confirm the source query selects `aisleName` from the shared hint, not a local re-implementation (avoid drift). Don't trust that "it prints a number" — 0 is the failure value.

## Template label layout invariant (printLotLabelsWithTemplate)

The image column stacks three things vertically: LOT caption (top) → part image → rtf caption (bottom). The QR column only has QR + one caption, so it is shorter. **The image column is the binding constraint** — size everything off it, not the QR column.

Invariant that must hold for every template (`pageH` is the label height): `topCaption + gap + image + gap + rtfCaption <= pageH - 2*padIn`. Captions are 10pt (`10/72`) except the rtf caption which is 12pt (`12/72`). If you center using only the QR-column height, the top LOT caption clamps to `padIn` and the image (drawn *after* the caption) paints over the LOT number on short labels (DK-1201, DK-2210, Avery 5160).

**Why:** that exact overlap shipped — the image covered "LOT-…" and made it unreadable; tall labels (Avery 5163/5164) hid it because they have spare height.

**How to apply:** cap the art size so the full image-column stack fits, then place the LOT caption at the column top and the image below it (reserve top room in the shared top-Y). DK-1209 has `showImage=false` (no image, no top caption) and must keep its original centered layout.

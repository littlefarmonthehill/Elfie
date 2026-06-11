---
name: Lot label PDF print orientation (iOS vs macOS)
description: Why jsPDF lot labels must keep orientation:'landscape' and how iOS vs macOS handle DK tape printing differently
---

Brother DK lot labels are generated as landscape jsPDF pages (`format: [pageW, pageH]`
where pageW is the long side) and **must** pass `orientation: 'landscape'` to both
`new jsPDF()` and every `addPage(...)`.

**Why:** jsPDF's orientation arg decides width=max vs width=min. Drop it and jsPDF
defaults to portrait, making the page short-side-wide (pageH wide × pageW tall);
the drawing code lays content across pageW so it overflows and the whole label
prints sideways/clipped. This silently breaks iOS (the platform that works).

**Cross-platform behavior — do not "fix" one and break the other:**
- iOS AirPrint reads the landscape PDF and auto-rotates to fit the portrait-feeding
  DK tape (29mm wide). Works with default settings. This is the primary path.
- macOS print dialog ignores the PDF orientation and defaults to Portrait, so a
  landscape label overflows/overlaps the narrow tape. Fix is user-side: select
  **Landscape** in the macOS print dialog (macOS remembers it per printer).
- There is NO way for a downloaded PDF to force the macOS dialog's default
  orientation — that's an OS/printer-driver setting on the user's machine.

**How to apply:** Never remove `orientation:'landscape'` to "fix" macOS clipping.
Don't swap the format to `[pageH, pageW]` either — that rotates the coordinate
space and clips QR/part#/rtf. Tell Mac users to pick Landscape instead.

DK-1201 = 3.5"×1.125" (with part image). DK-1209 = 2.4"×1.125" (no image; too small).
iOS auto-scales a DK-1201 PDF down onto a smaller DK-1209 tape, which is why a
template/tape mismatch still "looks right" on iPhone but clips on Mac.

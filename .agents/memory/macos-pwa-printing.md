---
name: macOS PWA printing
description: How printing works (and breaks) in the installed macOS PWA — share sheet, @page sizing, multi-page risk, service-worker cache.
---

# macOS PWA / Safari printing

The app runs as an installed standalone PWA on macOS (WebKit), not browser Safari. Printing there has several non-obvious traps:

- **Raw-PDF print() → Share sheet, not the print dialog.** Calling `print()` on a PDF blob (iframe `src=blobUrl`, or navigating a window to a PDF) opens the macOS Share sheet instead of the native print dialog. The desktop (Chrome/Win/Linux) hidden-iframe path is fine; the Mac path is not.
  - **Workaround:** open a popup synchronously in the click handler (`openPrintWindow()`, gated to Mac WebKit), then write an HTML page that embeds the PDF via `<object>` and call `window.print()` from that HTML context. WebKit treats printing an HTML doc as a real print → dialog appears.

- **Embedded PDF must get an explicit `@page` size or it prints tiny.** The HTML wrapper defaults to Letter portrait, so a small custom label (e.g. 90×29 mm DK tape) lands tiny in a corner. Inject `@page{size:<W> <H>;margin:0}` matching the PDF's own page geometry (only for label-sized docs; Letter docs leave the default sheet). Pass the size in the same units/orientation jsPDF used (landscape format arrays render wide×tall).

- **Multi-page `<object>` PDF may only print the first page.** WebKit printing of a multi-page embedded PDF is unreliable; a "Page 1 of 1" preview on a multi-label batch is the symptom. The robust alternative is HTML-native labels (one sized div per label with page-breaks, the WarehouseManagement thermal pattern), NOT a PDF embed. Verify any embed-based path with a >1-label batch before trusting it.

- **Mobile (iOS/Android) uses a different path:** `navigator.share` with a `File` hands the raw PDF to AirPrint, preserving exact dimensions with no browser margins. That path is correct — don't route mobile through the HTML wrapper.

- **Shipping client changes to installed PWAs requires bumping the service-worker `CACHE_VERSION`.** The SW only swaps in new code when its own bytes change; an unchanged SW keeps serving the old cached bundle forever, and the cache survives a full app Quit. `registration.update()` runs on app open, but the reload only applies on the next `visibilitychange`, so a clean update often needs two quit+reopens. To verify what's actually deployed, the server is reachable directly (e.g. curl the prod `.replit.app` URL); a temporary `POST /api/debug/print-log` endpoint that logs to server stdout lets you confirm whether the *client* new code is even running (deployment logs are server-side only).

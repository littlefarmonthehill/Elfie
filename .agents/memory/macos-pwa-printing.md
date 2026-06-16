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

- **The `<object>`-PDF approach is a dead end on Mac; render REAL HTML instead.** Two unfixable problems compound: the PDF viewer adds its own page margins that `margin:0` cannot remove, and WebKit scales-to-fit a landscape PDF onto portrait label media instead of auto-rotating (iOS AirPrint *does* rotate — that's why mobile is fine). Both vanish with HTML: `margin:0` works, and you control rotation yourself.
  - **Rotation-to-fill recipe (landscape label on portrait media):** portrait `@page{size:${pageH}in ${pageW}in;margin:0}`; one `.pg` wrapper per label sized to the portrait page; inside it a `.lbl` div sized landscape (`${pageW}in × ${pageH}in`) with `transform-origin:top left; transform:translateX(${pageH}in) rotate(90deg)`. The rotate maps the landscape box to x∈[−pageH,0]; the translateX shifts it back to [0,pageH] → fills the portrait page edge-to-edge. Use `.pg:not(:last-child){page-break-after:always}` to avoid a trailing blank page.
  - Reuse the dataURLs the jsPDF generator already computed (per-label QR PNGs + part-image JPEGs) — no re-fetching. Escape all dynamic text (`escapeHtml`) since it's string-interpolated into the doc.
  - Gate strictly on `isMacSafari() && preWin && !preWin.closed`; wrap the existing jsPDF builder in the `else` so iOS share/AirPrint and the desktop iframe path stay byte-for-byte unchanged. Keep `markRtf` *after* the if/else so it runs for both.
  - **Open risk:** CW vs CCW rotation direction is 50/50 without a physical test — if the print comes out upside-down, flip to `rotate(-90deg)` + `translateY`. Template inch dims (1.125×3.5) are ~1mm under the physical DK media (29×90mm); a thin even margin means switching `@page` to media-exact mm.

- **Mobile (iOS/Android) uses a different path:** `navigator.share` with a `File` hands the raw PDF to AirPrint, preserving exact dimensions with no browser margins. That path is correct — don't route mobile through the HTML wrapper.

- **Shipping client changes to installed PWAs requires bumping the service-worker `CACHE_VERSION`.** The SW only swaps in new code when its own bytes change; an unchanged SW keeps serving the old cached bundle forever, and the cache survives a full app Quit. `registration.update()` runs on app open, but the reload only applies on the next `visibilitychange`, so a clean update often needs two quit+reopens. To verify what's actually deployed, the server is reachable directly (e.g. curl the prod `.replit.app` URL); a temporary `POST /api/debug/print-log` endpoint that logs to server stdout lets you confirm whether the *client* new code is even running (deployment logs are server-side only).

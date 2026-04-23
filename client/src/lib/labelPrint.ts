/**
 * Shared label-printing helper.
 *
 * All label flows in the app (bin/warehouse labels, lot labels, future label
 * types) should funnel through `printHtmlLabels`.  It opens a popup window
 * with each label as its own `<div class="label">` page, sets the printer
 * page size via `@page { size: WIDTHmm HEIGHTmm }`, then calls
 * `window.print()` once images have loaded.
 *
 * This is the only approach that lets label-printer drivers (Brother QL,
 * Dymo LabelWriter) receive exact per-label dimensions, which is what they
 * need to auto-cut between labels.  PDF-based printing through a hidden
 * iframe doesn't carry page-size metadata reliably across browsers/drivers
 * (especially iOS AirPrint), so PDF is reserved for sheet labels (Avery)
 * and full-page documents (packing slips, picklists).
 */

export interface LabelPageSize {
  /** Page width in millimetres — the label's LONG side in landscape feed. */
  widthMm: number;
  /** Page height in millimetres — the label's SHORT side. */
  heightMm: number;
  /** Margin in millimetres applied via @page. Defaults to 0. */
  marginMm?: number;
}

export interface PrintHtmlLabelsOptions {
  pageSize: LabelPageSize;
  /** Inner HTML for each label (no wrapper — the helper adds .label). */
  labels: string[];
  /** Extra CSS appended inside the popup's <style> block. */
  css?: string;
  /** Used for the popup window title only. */
  title?: string;
}

export function printHtmlLabels({
  pageSize,
  labels,
  css = "",
  title = "Labels",
}: PrintHtmlLabelsOptions): void {
  if (labels.length === 0) return;
  const m = pageSize.marginMm ?? 0;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #000; }
  @page { size: ${pageSize.widthMm}mm ${pageSize.heightMm}mm; margin: ${m}mm; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  .label {
    width: 100%;
    height: 100vh;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }
  .label:last-child { page-break-after: auto; break-after: auto; }
  @media print { .label { height: ${pageSize.heightMm - m * 2}mm; } }
  ${css}
</style>
<script>
  window.addEventListener('load', function () {
    var imgs = Array.from(document.images);
    Promise.all(imgs.map(function (i) {
      return i.complete ? Promise.resolve() : new Promise(function (r) { i.onload = i.onerror = r; });
    })).then(function () {
      // Slight delay so layout settles before print dialog grabs the page.
      setTimeout(function () { window.print(); }, 80);
    });
  });
  window.addEventListener('afterprint', function () {
    setTimeout(function () { window.close(); }, 250);
  });
</script>
</head><body>${labels.map(l => `<div class="label">${l}</div>`).join("")}</body></html>`;

  const win = window.open("", "_blank", "width=800,height=600");
  if (!win) {
    // Popup blocked — surface a clear error rather than failing silently.
    alert("Please allow popups for this site to print labels.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { cleanItemName } from "@/lib/item-utils";

// ─── Org branding config ──────────────────────────────────────────────────────
export interface OrgBranding {
  name?: string | null;
  address?: string | null;
  logoUrl?: string | null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type PackingSlipOrder = {
  orderNumber: string;
  orderDate: string;
  shipDate: string | null;
  customerUsername: string | null;
  marketplace: string | null;
  requestedService?: string | null;
  carrierCode?: string | null;
  serviceCode?: string | null;
  shipTo: {
    name?: string;
    company?: string;
    street1?: string;
    street2?: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  items: Array<{
    inventoryId: string | null;
    bricklinkPartNumber: string | null;
    name: string;
    quantity: number;
    colorName: string | null;
    condition: string | null;
    comment?: string | null;
  }>;
};

interface PackingSlipProps {
  orders: PackingSlipOrder[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MX        = 4;            // left / right margin mm
const MY        = 0;            // top margin mm — as narrow as possible
const PAGE_W    = 215.9;        // letter width mm
const PAGE_H    = 279.4;        // letter height mm
const CONTENT_W = PAGE_W - 2 * MX;
const LOGO_H    = 28;           // target logo height mm

// ─── Helpers ─────────────────────────────────────────────────────────────────

function channelLabel(order: PackingSlipOrder): string {
  return order.marketplace === 'BrickOwl' ? 'BrickOwl' : 'BrickLink';
}

/**
 * Deterministic 4-character shortcode derived from an order number.
 *
 * Purpose: staff communication shorthand between the picklist (warehouse) and
 * the packing slip (customer copy). Instead of reading out "BL 12345678",
 * pickers say "J4KN". Consistent — same order always produces the same code.
 *
 * Alphabet: Crockford-style, minus 0/1/L/U to eliminate common misreads when
 * spoken aloud or written by hand. 30 chars → 30^4 = 810 000 possible codes,
 * far more than enough within a working day's volume.
 *
 * The full order number string (including any BL/BO prefix) is hashed so that
 * BrickLink and BrickOwl orders with the same numeric suffix never collide.
 */
export function shortCode(orderNumber: string): string {
  const ALPHA = 'ABCDEFGHJKMPQRSTVWXYZ'; // 21 letters — no I, L, O, N, U
  const s = orderNumber.trim();
  // djb2 variant — simple, fast, good distribution for short strings
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h, 33) ^ s.charCodeAt(i);
  }
  h = (h >>> 0); // unsigned 32-bit
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += ALPHA[h % ALPHA.length];
    h = Math.floor(h / ALPHA.length);
  }
  return code;
}

async function loadLogoInfo(orgLogoUrl?: string | null): Promise<{ dataUrl: string; w: number; h: number } | null> {
  if (!orgLogoUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) { resolve(null); return; }
        // data: URLs are already same-origin — hand them straight to jsPDF,
        // no canvas needed (avoids tainted-canvas / crossOrigin complications).
        if (orgLogoUrl.startsWith('data:')) {
          resolve({ dataUrl: orgLogoUrl, w, h });
          return;
        }
        // External URLs: draw through canvas so jsPDF gets a PNG data URL.
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve({ dataUrl: canvas.toDataURL('image/png'), w, h });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = orgLogoUrl;
  });
}

// ─── Hidden-print helper ──────────────────────────────────────────────────────

function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function hiddenPrint(blob: Blob, filename = 'document.pdf'): void {
  // iOS Safari can't print from a hidden iframe — the share sheet is the
  // only path to AirPrint / PDF save on that platform.
  if (isIOS()) {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file], title: filename.replace(/\.pdf$/i, '') })
        .catch(() => { /* user cancelled */ });
      return;
    }
  }

  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;top:-2400px;left:-2400px;width:816px;height:1056px;border:none;visibility:hidden;';
  document.body.appendChild(iframe);

  const cleanup = () => {
    try { document.body.removeChild(iframe); } catch { /* already removed */ }
    try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
  };

  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch { /* cross-origin guard */ }
    iframe.contentWindow?.addEventListener('afterprint', cleanup, { once: true });
  };

  iframe.addEventListener('load', doPrint, { once: true });
  setTimeout(doPrint, 1500);
  setTimeout(cleanup, 120_000);
  iframe.src = url;
}

// ─── Picklist (half-page panels, 2 per physical page) ────────────────────────

export interface PicklistItem {
  partNumber?: string | null;
  sku?: string | null;
  colorName?: string | null;
  /** BrickLink color ID — used to fetch the part thumbnail via the server proxy. */
  colorId?: number | null;
  condition?: string | null;
  itemName?: string | null;
  quantity: number;
  orderNumber?: string | null;
  marketplace?: string | null;
  inventoryId?: number | null;
  comment?: string | null;
  imageUrl?: string | null;
}

const chanPrefix = (item: PicklistItem) => item.marketplace === 'BrickOwl' ? 'BO' : 'BL';
const condLabel  = (c: string | null | undefined) => c === 'N' ? 'New' : c === 'U' ? 'Used' : (c || '');
const partKey    = (item: PicklistItem) => item.partNumber || item.sku || '';

/**
 * Load a part thumbnail for PDF embedding via the server-side image proxy.
 * The proxy checks object storage first (persistent), then BL CDN (fallback),
 * and processes the PNG (white-bg removal) — same bytes PartImage shows in the UI.
 *
 * Why the proxy instead of loading BrickLink URLs directly in the browser:
 *   - BrickLink CDN does NOT send CORS headers, so `canvas.toDataURL()` throws
 *     a security error after drawing a cross-origin image, even when the image
 *     loads fine in a plain <img> tag.
 *   - The server proxy (/api/images/parts/:partNum/:colorId) fetches from
 *     BrickLink server-side, processes the image, and serves it same-origin —
 *     so canvas access is always permitted.
 *   - The proxy also builds the correct CDN URL from the part number and color ID
 *     (https://img.bricklink.com/ItemImage/PN/{colorId}/{partNum}.png) regardless
 *     of what is stored in bl_catalog.imageUrl (which is NULL for ~99% of rows).
 */
async function loadItemImage(partNum: string, colorId: number): Promise<string | null> {
  const proxyUrl = `/api/images/parts/${encodeURIComponent(partNum)}/${colorId}`;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width  = img.naturalWidth  || img.width  || 1;
        canvas.height = img.naturalHeight || img.height || 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = proxyUrl;
  });
}

export async function printPicklist(items: PicklistItem[]): Promise<void> {
  if (items.length === 0) return;

  // ── Layout constants ────────────────────────────────────────────────────────
  const SC_W       = 14;    // shortcode column width mm (left of image)
  const SC_GAP     = 2;     // gap between shortcode column and image mm
  const IMG_W      = 13.5;  // image cell width mm  (18 × 0.75)
  const IMG_H      = 13.5;  // image cell height mm (18 × 0.75)
  const IMG_GAP    = 3;     // gap between image and text block mm
  const BASE_ROW_H = 22;    // row height mm
  const CMT_LINE_H = 4.5;   // mm per additional wrapped color+comment line
  const PAGE_PAD   = 6;     // breathing room at top/bottom of each page mm
  const IMG_X      = MX + SC_W + SC_GAP;               // image left edge
  const TEXT_X     = IMG_X + IMG_W + IMG_GAP;           // text block left edge
  const TEXT_W     = CONTENT_W - SC_W - SC_GAP - IMG_W - IMG_GAP;
  const RIGHT_X    = MX + CONTENT_W;

  // ── Pre-load all images concurrently ───────────────────────────────────────
  const imageDataUrls = await Promise.all(
    items.map(item =>
      item.partNumber && item.colorId != null
        ? loadItemImage(item.partNumber, item.colorId)
        : Promise.resolve(null)
    )
  );

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  let y = PAGE_PAD;

  const advancePage = () => {
    doc.addPage();
    y = PAGE_PAD;
  };

  // Compute each item's actual height.
  // Color+condition and comment are combined on line 2 and may wrap.
  // Extra wrapped lines beyond the first add CMT_LINE_H each.
  const calcItemH = (item: PicklistItem): number => {
    const cc = [
      item.colorName,
      item.condition ? condLabel(item.condition) : null,
    ].filter(Boolean).join('  \u00b7  ');
    const combined = [cc, item.comment].filter(Boolean).join('  ');
    if (!combined) return BASE_ROW_H;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const lineCount = (doc.splitTextToSize(combined, TEXT_W) as string[]).length;
    return BASE_ROW_H + Math.max(0, lineCount - 1) * CMT_LINE_H;
  };

  for (let i = 0; i < items.length; i++) {
    const item    = items[i];
    const imgData = imageDataUrls[i];
    const itemH   = calcItemH(item);

    if (y + itemH > PAGE_H - PAGE_PAD) advancePage();

    const rowY = y;

    // ── Row divider (between rows only, not before the first) ────────────────
    if (y > PAGE_PAD) {
      doc.setDrawColor(210, 210, 210);
      doc.setLineWidth(0.2);
      doc.line(MX, rowY, RIGHT_X, rowY);
    }

    // ── Baselines — two-line block centred in the row ────────────────────────
    // Block height ≈ cap(13pt)=4.6 + line-gap(5) + desc(9pt)=1.5 ≈ 11mm
    // Centre at BASE_ROW_H/2 → top-of-block at (BASE_ROW_H-11)/2
    //   L1 baseline = top-of-block + cap(13pt) = (BASE_ROW_H-11)/2 + 4.6
    const L1_Y = rowY + (BASE_ROW_H - 11) / 2 + 4.6;
    const L2_Y = L1_Y + 5;   // 5 mm line-gap between baselines

    // ── Shortcode column — left of image, large and bold ─────────────────────
    const sc = item.orderNumber ? shortCode(item.orderNumber) : '';
    if (sc) {
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 15, 15);
      // Centre horizontally within SC_W; vertically centred in the row
      const scW = doc.getTextWidth(sc);
      const SC_Y = rowY + BASE_ROW_H / 2 + 2.5; // 2.5 ≈ half cap-height of 14pt
      doc.text(sc, MX + (SC_W - scW) / 2, SC_Y);
    }

    // ── Image — centred vertically in base row height, after SC column ────────
    const imgY = rowY + (BASE_ROW_H - IMG_H) / 2;
    if (imgData) {
      try {
        doc.addImage(imgData, 'PNG', IMG_X, imgY, IMG_W, IMG_H);
      } catch { /* skip if image data is invalid */ }
    } else {
      doc.setDrawColor(210, 210, 210);
      doc.setLineWidth(0.15);
      doc.setFillColor(248, 248, 248);
      doc.roundedRect(IMG_X, imgY, IMG_W, IMG_H, 1, 1, 'FD');
    }

    // ── Line 1: [bold]PartNo[/bold] [normal]Name…[/normal]  |  ×Qty ─────────
    const partStr = partKey(item);
    const qtyStr  = `\u00d7${item.quantity}`;

    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    const qtyW = doc.getTextWidth(qtyStr);

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 15, 15);
    doc.text(partStr, TEXT_X, L1_Y);
    const partStrW = doc.getTextWidth(partStr);

    const rawName = item.itemName
      ? cleanItemName(item.itemName, item.partNumber || '')
      : '';
    if (rawName) {
      const maxNameW = TEXT_W - partStrW - 3 - qtyW - 2;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(90, 90, 90);
      let name = rawName;
      while (doc.getTextWidth(name) > maxNameW && name.length > 4)
        name = name.slice(0, -1);
      if (name.length < rawName.length) name = name.slice(0, -1) + '\u2026';
      doc.text('\u00a0\u00a0' + name, TEXT_X + partStrW, L1_Y);
    }

    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 15, 15);
    doc.text(qtyStr, RIGHT_X, L1_Y, { align: 'right' });

    // ── Line 2: Color · Condition + Comment (wrapping)  |  bl.12345 (right) ──
    const colorCond = [
      item.colorName,
      item.condition ? condLabel(item.condition) : null,
    ].filter(Boolean).join('  \u00b7  ');

    const combined = [colorCond, item.comment].filter(Boolean).join('  ');
    if (combined) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(55, 55, 55);
      const lines = doc.splitTextToSize(combined, TEXT_W) as string[];
      lines.forEach((line, idx) => {
        doc.text(line, TEXT_X, L2_Y + idx * CMT_LINE_H);
      });
    }

    // Order ref — right-aligned at L2_Y baseline
    const rawOrder = (item.orderNumber || '').replace(/^(BL|BO)/i, '').trim();
    const orderRef = rawOrder ? `${chanPrefix(item).toLowerCase()}.${rawOrder}` : '';
    if (orderRef) {
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(130, 130, 130);
      doc.text(orderRef, RIGHT_X, L2_Y, { align: 'right' });
    }

    y = rowY + itemH;
  }

  hiddenPrint(doc.output('blob'), 'picklist.pdf');
}

// ─── Packing slips ────────────────────────────────────────────────────────────

export async function printPackingSlips(orders: PackingSlipOrder[], org?: OrgBranding): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const logo = await loadLogoInfo(org?.logoUrl);
  let logoW = 0;
  if (logo && logo.w > 0 && logo.h > 0) {
    logoW = (logo.w / logo.h) * LOGO_H;
  }

  const companyName    = org?.name    || 'Your Company';
  const companyAddress = org?.address || '';
  const addressLines   = companyAddress.split('\n').map(l => l.trim()).filter(Boolean);

  orders.forEach((order, idx) => {
    if (idx > 0) doc.addPage();
    const orderStartPage = doc.internal.getNumberOfPages();
    // Explicitly switch to this order's starting page so the footer loop's
    // setPage() calls don't leave the cursor on the wrong page for the next order.
    doc.setPage(orderStartPage);
    let y = MY;

    // ── Company info (left) + logo (right) ──────────────────────────────────
    const headerTopY = y;
    const headerH    = Math.max(LOGO_H, 23);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(19);
    doc.setFont('helvetica', 'bold');
    doc.text(companyName, MX, y + 5);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 51, 51);
    let addrLineY = y + 12;
    addressLines.forEach(line => {
      doc.text(line, MX, addrLineY);
      addrLineY += 6;
    });

    if (logo && logoW > 0) {
      doc.addImage(logo.dataUrl, 'PNG', MX + CONTENT_W - logoW, headerTopY, logoW, LOGO_H);
    }

    // ── Shortcode stamp — centred in header, large + chunky ──────────────────
    const sc          = shortCode(order.orderNumber);
    const STAMP_PT    = 42;
    const STAMP_CAP   = STAMP_PT * 0.352 * 0.70;   // cap-height in mm
    const stampCenterX = MX + CONTENT_W / 2;
    const sPad    = 4;                              // padding inside border

    doc.setFontSize(STAMP_PT);
    doc.setFont('helvetica', 'bold');
    const scTextW = doc.getTextWidth(sc);
    const boxW    = scTextW + sPad * 2;
    const boxH    = STAMP_CAP + sPad * 2;
    const boxX    = stampCenterX - boxW / 2;
    const boxY    = headerTopY + 1;                // top-aligned in header
    const stampY  = boxY + sPad + STAMP_CAP;       // text baseline inside box

    doc.setFillColor(248, 248, 248);
    doc.setDrawColor(35, 35, 35);
    doc.setLineWidth(1.4);
    doc.roundedRect(boxX, boxY, boxW, boxH, 2, 2, 'FD');

    doc.setTextColor(15, 15, 15);
    doc.text(sc, stampCenterX, stampY, { align: 'center' });

    // Small caption below stamp
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text('for internal use only', stampCenterX, boxY + boxH + 3.5, { align: 'center' });

    y += headerH + 3;

    // ── Divider ─────────────────────────────────────────────────────────────
    doc.setDrawColor(170, 170, 170);
    doc.setLineWidth(0.2);
    doc.line(MX, y, MX + CONTENT_W, y);
    y += 5;

    // ── Ship To (left) + Order meta (right) ─────────────────────────────────
    const infoTopY = y;
    const { shipTo } = order;
    const street1  = shipTo.street1 || (shipTo as any).address1 || '';
    const street2  = shipTo.street2 || (shipTo as any).address2 || '';
    const cityLine = [shipTo.city, shipTo.state, shipTo.postalCode].filter(Boolean).join(' ');
    const showCtry = shipTo.country && shipTo.country !== 'US';

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Ship To', MX, y + 5);

    doc.setFont('helvetica', 'normal');
    const shipAddrLines = [
      shipTo.name, shipTo.company, street1, street2, cityLine,
      showCtry ? shipTo.country : undefined,
    ].filter(Boolean) as string[];

    let shipAddrY = y + 11;
    shipAddrLines.forEach(line => { doc.text(line, MX, shipAddrY); shipAddrY += 5.5; });

    const metaX  = MX + CONTENT_W;
    const labelX = metaX - 48;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(85, 85, 85);
    doc.text(`${channelLabel(order)} Order #`, labelX, infoTopY + 5,  { align: 'right' });
    doc.text('Date',                           labelX, infoTopY + 11, { align: 'right' });
    if (order.requestedService) {
      doc.text('Ship Via', labelX, infoTopY + 17, { align: 'right' });
    }

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text(order.orderNumber, metaX, infoTopY + 5,  { align: 'right' });
    const dateStr = order.orderDate ? new Date(order.orderDate).toLocaleDateString() : '';
    doc.text(dateStr, metaX, infoTopY + 11, { align: 'right' });
    const serviceDisplay = (() => {
      // Prefer the clean EasyPost carrier + service fields written when a label is purchased
      const fromEasyPost = [order.carrierCode, order.serviceCode].filter(Boolean).join(' ');
      if (fromEasyPost) return fromEasyPost;
      // Fall back to stripping cost/packaging noise from the raw BrickLink service string
      if (!order.requestedService) return null;
      const cut = order.requestedService.search(/ \$\d| - \$| \(\$| {2,}\(|\|/);
      return (cut > 0 ? order.requestedService.slice(0, cut) : order.requestedService).trim();
    })();
    if (serviceDisplay) {
      doc.text(serviceDisplay, metaX, infoTopY + 17, { align: 'right' });
    }

    y = Math.max(shipAddrY, infoTopY + (serviceDisplay ? 24 : 18)) + 3;

    // ── Items table ──────────────────────────────────────────────────────────
    const rows = order.items.map(item => {
      const base  = cleanItemName(item.name, item.bricklinkPartNumber);
      const color = item.colorName ? `${item.colorName} ` : '';
      const part  = item.bricklinkPartNumber ? ` (${item.bricklinkPartNumber})` : '';
      const name  = `LEGO ${color}${base}${part}`;
      const metaParts = [
        item.colorName ? `Color: ${item.colorName}`     : '',
        item.condition ? `Condition: ${item.condition}` : '',
      ].filter(Boolean);
      const meta    = metaParts.length > 0 ? metaParts.join(', ') : '';
      const comment = item.comment?.trim() || '';
      const line2   = [meta, comment].filter(Boolean).join('  \u00b7  ');
      return [line2 ? `${name}\n${line2}` : name, String(item.quantity)];
    });

    autoTable(doc, {
      startY: y,
      margin: { left: MX, right: MX },
      head: [['Description', 'Qty']],
      body: rows,
      styles: {
        fontSize:    11,
        cellPadding: { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 },
        textColor:   [0, 0, 0],
        lineColor:   [220, 220, 220],
        lineWidth:   0.1,
        overflow:    'linebreak',
      },
      headStyles: {
        fillColor:   [255, 255, 255],
        textColor:   [0, 0, 0],
        fontStyle:   'bold',
        fontSize:    10,
        lineColor:   [85, 85, 85],
        lineWidth:   { bottom: 0.4 },
      },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 18, halign: 'right', fontStyle: 'bold' },
      },
      alternateRowStyles: false,
    });

    // ── Footer: Page X of Y on every page for this order ────────────────────
    const orderEndPage   = doc.internal.getNumberOfPages();
    const orderPageTotal = orderEndPage - orderStartPage + 1;
    const footerLabel    = `${channelLabel(order)} Order # ${order.orderNumber}  \u00b7  Ref ${sc}`;

    for (let p = orderStartPage; p <= orderEndPage; p++) {
      doc.setPage(p);
      const pageInOrder = p - orderStartPage + 1;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(102, 102, 102);
      doc.text(
        `${footerLabel}  \u00b7  Page ${pageInOrder} of ${orderPageTotal}`,
        PAGE_W / 2,
        PAGE_H - 2,
        { align: 'center' },
      );
    }
  });

  hiddenPrint(doc.output('blob'), 'packing-slips.pdf');
}

export default function PackingSlip({ orders }: PackingSlipProps) {
  return null;
}

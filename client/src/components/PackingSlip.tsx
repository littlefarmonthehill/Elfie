import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { cleanItemName, shippingTier } from "@/lib/item-utils";

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
    colorId?: number | null;
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
const ALPHA = 'ABCDEFGHJKMPQRSTVWXYZ'; // 21 letters — no I, L, O, N, U

function hashCode(orderNumber: string, len: number): string {
  const s = orderNumber.trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = Math.imul(h, 33) ^ s.charCodeAt(i);
  h = h >>> 0;
  let code = '';
  for (let i = 0; i < len; i++) { code += ALPHA[h % ALPHA.length]; h = Math.floor(h / ALPHA.length); }
  return code;
}

/** For single-order contexts (e.g. packing slip header). Starts at 2 chars. */
export function shortCode(orderNumber: string): string {
  return hashCode(orderNumber, 2);
}

/**
 * Assign short codes to the active orders in this print batch.
 * Codes are ephemeral — reused once an order ships — so sequential
 * assignment is correct. Orders are sorted for stable output across
 * re-prints of the same batch.
 * Starts at 2 chars (AA–ZZ = 441 slots). Only grows to 3 when the
 * batch genuinely exceeds 441 simultaneous active orders.
 */
export function buildShortCodeMap(orderNumbers: string[]): Map<string, string> {
  const unique = [...new Set(orderNumbers.filter(Boolean))].sort();
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const o of unique) {
    let code = '';
    for (let len = 2; len <= 4; len++) {
      const candidate = hashCode(o, len);
      if (!used.has(candidate)) { code = candidate; break; }
    }
    if (!code) code = hashCode(o, 4);
    used.add(code);
    map.set(o, code);
  }
  return map;
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

async function loadItemImageGrayscale(partNum: string, colorId: number): Promise<string | null> {
  const dataUrl = await loadItemImage(partNum, colorId);
  if (!dataUrl) return null;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width  = img.naturalWidth  || img.width  || 1;
        canvas.height = img.naturalHeight || img.height || 1;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
          d[i] = d[i + 1] = d[i + 2] = g;
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
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
  const BASE_ROW_H = 24;    // row height mm (slightly taller for prominence)
  const CMT_LINE_H = 5;     // mm per extra comment line below color/condition
  const PAGE_PAD   = 6;     // breathing room at top/bottom of each page mm
  const IMG_X      = MX + SC_W + SC_GAP;               // image left edge
  const TEXT_X     = IMG_X + IMG_W + IMG_GAP;           // text block left edge
  const TEXT_W     = CONTENT_W - SC_W - SC_GAP - IMG_W - IMG_GAP;
  const RIGHT_X    = MX + CONTENT_W;

  // ── Pre-load all images concurrently ───────────────────────────────────────
  const imageDataUrls = await Promise.all(
    items.map(item =>
      item.partNumber && item.colorId != null
        ? loadItemImageGrayscale(item.partNumber, item.colorId)
        : Promise.resolve(null)
    )
  );

  // Build collision-free short codes for all orders in this batch.
  // Starts at 2 chars; expands to 3 only if two orders hash to the same code.
  const codeMap = buildShortCodeMap(items.map(i => i.orderNumber).filter(Boolean) as string[]);


  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  let y = PAGE_PAD;

  const advancePage = () => {
    doc.addPage();
    y = PAGE_PAD;
  };

  // Compute each item's actual height.
  // L1: part + name + ×qty (always BASE_ROW_H)
  // L2: color · condition + order ref (fits in BASE_ROW_H)
  // L3+: comment lines (each CMT_LINE_H extra)
  const calcItemH = (item: PicklistItem): number => {
    if (!item.comment) return BASE_ROW_H;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'oblique');
    const lineCount = (doc.splitTextToSize(item.comment, TEXT_W) as string[]).length;
    return BASE_ROW_H + lineCount * CMT_LINE_H;
  };

  for (let i = 0; i < items.length; i++) {
    const item    = items[i];
    const imgData = imageDataUrls[i];
    const itemH   = calcItemH(item);

    if (y + itemH > PAGE_H - PAGE_PAD) advancePage();

    const rowY = y;

    // ── Baselines ─────────────────────────────────────────────────────────────
    // Three-line hierarchy: L1 (part+qty), L2 (color+condition), L3 (comment)
    // Block: cap13pt≈4.6 + gap5.5 + cap11pt≈3.9 ≈ 14mm centred in BASE_ROW_H
    const L1_Y = rowY + (BASE_ROW_H - 14) / 2 + 4.6;
    const L2_Y = L1_Y + 5.5; // gap between part line and color/condition line
    const L3_Y = L2_Y + 5;   // gap for comment line(s)

    // ── Shortcode column — left of image, large and bold ─────────────────────
    const sc = item.orderNumber ? (codeMap.get(item.orderNumber) ?? shortCode(item.orderNumber)) : '';
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

    // ── Line 1: PartNo (bold) · Name (gray) — all left ──────────────────────
    const partStr = partKey(item);

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 15, 15);
    doc.text(partStr, TEXT_X, L1_Y);
    const partStrW = doc.getTextWidth(partStr);

    const rawName = item.itemName
      ? cleanItemName(item.itemName, item.partNumber || '')
      : '';
    if (rawName) {
      const maxNameW = TEXT_W - partStrW - 4;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      let name = rawName;
      while (doc.getTextWidth(name) > maxNameW && name.length > 4)
        name = name.slice(0, -1);
      if (name.length < rawName.length) name = name.slice(0, -1) + '\u2026';
      doc.text('\u00a0\u00a0' + name, TEXT_X + partStrW, L1_Y);
    }

    // ── Line 2: ×Qty · Color · Condition (11pt bold) then · OrderRef (8pt gray) ──
    // Key picker/customer info is prominent; order ref is subdued but left-aligned.
    const rawOrder = (item.orderNumber || '').replace(/^(BL|BO)/i, '').trim();
    const orderRef = rawOrder ? `${chanPrefix(item)}.${rawOrder}` : '';

    const prominentParts = [
      `\u00d7${item.quantity}`,
      item.colorName,
      item.condition ? condLabel(item.condition) : null,
    ].filter(Boolean).join('  \u00b7  ');

    let L2_cursor = TEXT_X;
    if (prominentParts) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(25, 25, 25);
      doc.text(prominentParts, L2_cursor, L2_Y);
      L2_cursor += doc.getTextWidth(prominentParts);
    }

    if (orderRef) {
      const lotLabel = item.inventoryId != null ? `  \u00b7  Lot ${item.inventoryId}` : '';
      const sep = prominentParts ? '  \u00b7  ' : '';
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(40, 40, 40);
      doc.text(sep + orderRef + lotLabel, L2_cursor, L2_Y);
    }

    // ── Line 3+: Comment (italic, yellow highlight) — only if present ─────────
    if (item.comment) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'oblique');
      const lines = doc.splitTextToSize(item.comment, TEXT_W) as string[];
      // Yellow highlight rect behind comment
      const hlH = lines.length * CMT_LINE_H;
      doc.setFillColor(255, 245, 100);
      doc.rect(TEXT_X - 1, L3_Y - 3.5, TEXT_W + 2, hlH + 0.5, 'F');
      doc.setTextColor(40, 40, 40);
      lines.forEach((line, idx) => {
        doc.text(line, TEXT_X, L3_Y + idx * CMT_LINE_H);
      });
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

  const slipCodeMap = buildShortCodeMap(orders.map(o => o.orderNumber).filter(Boolean));

  for (let idx = 0; idx < orders.length; idx++) {
    const order = orders[idx];
    if (idx > 0) doc.addPage();
    const orderStartPage = doc.internal.getNumberOfPages();
    // Explicitly switch to this order's starting page so the footer loop's
    // setPage() calls don't leave the cursor on the wrong page for the next order.
    doc.setPage(orderStartPage);
    let y = MY;

    // Pre-load grayscale images for all items in this order
    const itemImageUrls = await Promise.all(
      order.items.map(item =>
        item.bricklinkPartNumber && item.colorId != null
          ? loadItemImageGrayscale(item.bricklinkPartNumber, item.colorId)
          : Promise.resolve(null)
      )
    );

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
    const sc          = slipCodeMap.get(order.orderNumber) ?? shortCode(order.orderNumber);
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

    const stampTier = shippingTier(order.requestedService);
    if (stampTier === 'express') {
      doc.setFillColor(144, 202, 249); // Material Blue-200 — noticeable, black text reads fine
    } else if (stampTier === 'priority') {
      doc.setFillColor(239, 154, 154); // Material Red-200 — noticeable, black text reads fine
    } else {
      doc.setFillColor(248, 248, 248);
    }
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
      if (stampTier) {
        // Yellow highlight band behind the service text
        const svcW = doc.getTextWidth(serviceDisplay);
        doc.setFillColor(255, 235, 59); // amber-yellow
        doc.setDrawColor(255, 235, 59);
        doc.rect(metaX - svcW - 1.5, infoTopY + 17 - 3.2, svcW + 3, 4.6, 'F');
        doc.setTextColor(0, 0, 0);
      }
      doc.text(serviceDisplay, metaX, infoTopY + 17, { align: 'right' });
      doc.setDrawColor(170, 170, 170); // restore draw color for subsequent lines
    }

    y = Math.max(shipAddrY, infoTopY + (serviceDisplay ? 24 : 18)) + 3;

    // ── Items table ──────────────────────────────────────────────────────────
    const IMG_COL = 14; // mm reserved on the left of the description cell for the image
    const rows = order.items.map(item => {
      const base  = cleanItemName(item.name, item.bricklinkPartNumber);
      const part  = item.bricklinkPartNumber ? ` (${item.bricklinkPartNumber})` : '';
      const name  = `${base}${part}`;
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
      bodyStyles: {
        minCellHeight: 14,
      },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      columnStyles: {
        0: { cellWidth: 'auto', cellPadding: { top: 3.5, right: 3.5, bottom: 3.5, left: IMG_COL + 2 } },
        1: { cellWidth: 18, halign: 'right', fontStyle: 'bold' },
      },
      didDrawCell: (data: any) => {
        if (data.column.index === 0 && data.row.section === 'body') {
          const imgUrl = itemImageUrls[data.row.index];
          if (imgUrl) {
            const imgSize = 12;
            const imgX = data.cell.x + 1;
            const imgY = data.cell.y + (data.cell.height - imgSize) / 2;
            try { doc.addImage(imgUrl, 'PNG', imgX, imgY, imgSize, imgSize); } catch {}
          }
        }
      },
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
  }

  hiddenPrint(doc.output('blob'), 'packing-slips.pdf');
}

export default function PackingSlip({ orders }: PackingSlipProps) {
  return null;
}

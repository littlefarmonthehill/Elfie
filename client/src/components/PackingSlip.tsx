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
  const IMG_W     = 18;     // image cell width mm
  const IMG_H     = 18;     // image cell height mm
  const IMG_GAP   = 3;      // gap between image and text block mm
  const ROW_H     = 24;     // FIXED row height mm — must be consistent for paper cutter
  const PANEL_H   = PAGE_H / 2;
  const PANEL_PAD = 3;      // breathing room at panel top and bottom mm
  const TEXT_X    = MX + IMG_W + IMG_GAP;
  const TEXT_W    = CONTENT_W - IMG_W - IMG_GAP;
  const RIGHT_X   = MX + CONTENT_W;

  // ── Pre-load all images concurrently ───────────────────────────────────────
  const imageDataUrls = await Promise.all(
    items.map(item =>
      item.partNumber && item.colorId != null
        ? loadItemImage(item.partNumber, item.colorId)
        : Promise.resolve(null)
    )
  );

  const panelTop    = (p: 0 | 1) => p * PANEL_H + PANEL_PAD;
  const panelBottom = (p: 0 | 1) => (p + 1) * PANEL_H - PANEL_PAD;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  let panel: 0 | 1 = 0;
  let y = panelTop(0);
  let cutLineDrawn = false;

  const drawCutLine = () => {
    if (cutLineDrawn) return;
    cutLineDrawn = true;
    // Solid dark line — visible against white paper for a straight cut
    doc.setDrawColor(80, 80, 80);
    doc.setLineWidth(0.5);
    doc.line(0, PANEL_H, PAGE_W, PANEL_H);
    // Small "CUT" label centred on the line
    doc.setFontSize(5.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text('CUT', PAGE_W / 2, PANEL_H - 0.8, { align: 'center' });
  };

  const advancePanel = () => {
    if (panel === 0) {
      drawCutLine();
      panel = 1;
    } else {
      doc.addPage();
      panel = 0;
      cutLineDrawn = false;
    }
    y = panelTop(panel);
  };

  for (let i = 0; i < items.length; i++) {
    const item    = items[i];
    const imgData = imageDataUrls[i];

    if (y + ROW_H > panelBottom(panel)) advancePanel();

    const rowY = y;

    // ── Row divider (between rows only, not before the first) ────────────────
    if (y > panelTop(panel)) {
      doc.setDrawColor(210, 210, 210);
      doc.setLineWidth(0.2);
      doc.line(MX, rowY, RIGHT_X, rowY);
    }

    // ── Image — left side, vertically centred in the row ─────────────────────
    const imgY = rowY + (ROW_H - IMG_H) / 2;
    if (imgData) {
      try {
        doc.addImage(imgData, 'PNG', MX, imgY, IMG_W, IMG_H);
      } catch { /* skip if image data is invalid */ }
    } else {
      // Subtle placeholder box so the grid still reads cleanly without an image
      doc.setDrawColor(210, 210, 210);
      doc.setLineWidth(0.15);
      doc.setFillColor(248, 248, 248);
      doc.roundedRect(MX, imgY, IMG_W, IMG_H, 1, 1, 'FD');
    }

    // ── Text block — three stacked rows ──────────────────────────────────────
    // Row heights chosen so the three lines fit inside ROW_H with even padding.
    //   Top-pad ~4mm, line-1 (part+qty) 7pt baseline gap, line-2 5pt, line-3 5pt
    const L1_Y = rowY + 4 + 5;    // part number baseline
    const L2_Y = L1_Y + 5.5;      // color · condition baseline
    const L3_Y = L2_Y + 5;        // item name baseline

    // ── Line 1: Part number (bold) left · Quantity right ────────────────────
    const partStr = partKey(item);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 15, 15);
    doc.text(partStr, TEXT_X, L1_Y);

    // Quantity — large and prominent so pickers see it at a glance
    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 15, 15);
    doc.text(`\u00d7${item.quantity}`, RIGHT_X, L1_Y, { align: 'right' });

    // ── Line 2: Color · Condition left · Order ref right ─────────────────────
    const colorCond = [
      item.colorName,
      item.condition ? condLabel(item.condition) : null,
    ].filter(Boolean).join('  \u00b7  ');

    if (colorCond) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(55, 55, 55);
      doc.text(colorCond, TEXT_X, L2_Y);
    }

    const rawOrder = (item.orderNumber || '').replace(/^(BL|BO)/i, '');
    if (rawOrder) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(130, 130, 130);
      doc.text(`${chanPrefix(item)}\u00a0${rawOrder}`, RIGHT_X, L2_Y, { align: 'right' });
    }

    // ── Line 3: Item name left · Lot right ───────────────────────────────────
    const rawName = item.itemName
      ? cleanItemName(item.itemName, item.partNumber || '')
      : '';
    if (rawName) {
      const lotW = item.inventoryId
        ? doc.getTextWidth(`Lot ${item.inventoryId}`) + 4
        : 0;
      const maxNameW = TEXT_W - lotW;
      let name = rawName;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(110, 110, 110);
      while (doc.getTextWidth(name) > maxNameW && name.length > 4)
        name = name.slice(0, -1);
      if (name.length < rawName.length) name = name.slice(0, -1) + '\u2026';
      doc.text(name, TEXT_X, L3_Y);
    }

    if (item.inventoryId) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(130, 130, 130);
      doc.text(`Lot\u00a0${item.inventoryId}`, RIGHT_X, L3_Y, { align: 'right' });
    }

    // ── Comment (below line 3, only if present) ───────────────────────────────
    if (item.comment) {
      const L4_Y = L3_Y + 4.5;
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(140, 140, 140);
      let cmt = item.comment;
      while (doc.getTextWidth(cmt) > TEXT_W && cmt.length > 4)
        cmt = cmt.slice(0, -1);
      if (cmt.length < item.comment.length) cmt = cmt.slice(0, -1) + '\u2026';
      doc.text(cmt, TEXT_X, L4_Y);
    }

    y = rowY + ROW_H;
  }

  // Ensure the cut line appears on the last physical page if panel 0 was used
  if (panel === 0) drawCutLine();

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

    y += Math.max(LOGO_H, 23) + 3;

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

    const metaX = MX + CONTENT_W;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(85, 85, 85);
    doc.text(`${channelLabel(order)} Order #`, metaX - 48, infoTopY + 5,  { align: 'right' });
    doc.text('Date',                           metaX - 48, infoTopY + 11, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text(order.orderNumber, metaX, infoTopY + 5,  { align: 'right' });
    const dateStr = order.orderDate ? new Date(order.orderDate).toLocaleDateString() : '';
    doc.text(dateStr, metaX, infoTopY + 11, { align: 'right' });

    y = Math.max(shipAddrY, infoTopY + 18) + 3;

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
    const footerLabel    = `${channelLabel(order)} Order # ${order.orderNumber}`;

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

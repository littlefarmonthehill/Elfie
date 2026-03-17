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
    comment: string | null;
  }>;
};

interface PackingSlipProps {
  orders: PackingSlipOrder[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MX       = 4;            // left / right margin mm (~0.16 in)
const MY       = 1;            // top  / bottom margin mm — as narrow as possible
const PAGE_W   = 215.9;        // letter width mm
const PAGE_H   = 279.4;        // letter height mm
const CONTENT_W = PAGE_W - 2 * MX;     // 207.9 mm
const LOGO_H   = 28;           // target logo height in mm

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
        // Draw through a canvas to force full decode and produce a clean PNG
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

// ─── Print helper ────────────────────────────────────────────────────────────

/**
 * iOS Safari requires the iframe to be "visible" (i.e. not visibility:hidden)
 * for it to actually rasterize the PDF and produce non-blank prints.
 * We detect iOS so we can use opacity:0 instead of visibility:hidden.
 */
function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function hiddenPrint(blob: Blob, _filename = 'document.pdf'): void {
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  const ios = isIOS();

  if (ios) {
    // iOS: opacity:0 covers the viewport but lets iOS render the PDF fully.
    // visibility:hidden blocks iOS from rasterizing the PDF → blank prints.
    // pointer-events:none + z-index:-1 keep the page fully interactive.
    iframe.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;border:none;' +
      'opacity:0;pointer-events:none;z-index:-1;';
  } else {
    // Desktop / Android: off-screen at letter size, no layout impact.
    iframe.style.cssText =
      'position:fixed;top:-2400px;left:-2400px;width:816px;height:1056px;' +
      'border:none;visibility:hidden;';
  }
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
    } catch { /* cross-origin guard — shouldn't happen with blob URLs */ }
    if (!ios) {
      // afterprint is unreliable on iOS; the 120 s safety-net handles cleanup there.
      iframe.contentWindow?.addEventListener('afterprint', cleanup, { once: true });
    }
  };

  iframe.addEventListener('load', doPrint, { once: true });
  // Fallback: some browsers don't fire load for PDF blob URLs in iframes.
  setTimeout(doPrint, 1500);
  // Safety net: always clean up eventually.
  setTimeout(cleanup, 120_000);

  iframe.src = url;
}

// ─── Picklist PDF ─────────────────────────────────────────────────────────────

/** Normalised item shape accepted by printPicklist — callers map their own types here. */
export interface PicklistItem {
  partNumber?: string | null;
  sku?: string | null;
  colorName?: string | null;
  condition?: string | null;
  itemName?: string | null;
  quantity: number;
  orderNumber?: string | null;
  marketplace?: string | null;
  inventoryId?: number | null;
  comment?: string | null;   // buyer note / remark
}

const chanPrefix = (item: PicklistItem) => item.marketplace === 'BrickOwl' ? 'BO' : 'BL';
const condLabel  = (c: string | null | undefined) => c === 'N' ? 'New' : c === 'U' ? 'Used' : (c || '');
const partKey    = (item: PicklistItem) => item.partNumber || item.sku || '';

export function printPicklist(items: PicklistItem[]): void {
  if (items.length === 0) return;

  // ── Two-panel layout ─────────────────────────────────────────────────────
  // Each letter page is split into a top panel and a bottom panel.
  // Printing 1-per-sheet gives you 2 content blocks per physical sheet with
  // full control over margins — no printer scaling, no inter-page gaps.
  const PANEL_H = PAGE_H / 2;                          // 139.7 mm per panel
  const panelTop    = (p: 0 | 1) => p * PANEL_H + MY; // content start y
  const panelBottom = (p: 0 | 1) => (p + 1) * PANEL_H - MY; // content end y

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  let panel: 0 | 1 = 0;
  let y = panelTop(0);

  const advancePanel = () => {
    if (panel === 0) {
      // Draw a thin mid-page divider then move to the bottom panel
      doc.setDrawColor(170, 170, 170);
      doc.setLineWidth(0.3);
      doc.line(MX, PANEL_H, MX + CONTENT_W, PANEL_H);
      panel = 1;
    } else {
      doc.addPage();
      panel = 0;
    }
    y = panelTop(panel);
  };

  for (const item of items) {
    const hasComment = !!(item.comment);
    const itemH = 3 + 6 + 5 + (hasComment ? 4.5 : 0) + 6;
    if (y + itemH > panelBottom(panel)) advancePanel();

    // ── Separator line ───────────────────────────────────────────────────────
    doc.setDrawColor(187, 187, 187);
    doc.setLineWidth(0.25);
    doc.line(MX, y, MX + 20, y);
    y += 3;

    // ── Part number (bold) · colour · condition · name ───────────────────────
    const partStr   = partKey(item);
    const restParts = [
      item.colorName,
      item.condition ? condLabel(item.condition) : null,
      item.itemName,
    ].filter(Boolean) as string[];

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(partStr, MX, y);
    const partW = doc.getTextWidth(partStr);

    if (restParts.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(70, 70, 70);
      let restStr = ' \u00b7 ' + restParts.join(' \u00b7 ');
      const maxW = CONTENT_W - partW;
      while (doc.getTextWidth(restStr) > maxW && restStr.length > 4) restStr = restStr.slice(0, -1);
      if (restStr.length < (' \u00b7 ' + restParts.join(' \u00b7 ')).length) restStr = restStr.slice(0, -3) + '\u2026';
      doc.text(restStr, MX + partW, y);
    }
    y += 6;

    // ── Qty · order number · lot number ─────────────────────────────────────
    const rawOrder  = (item.orderNumber || '').replace(/^(BL|BO)/i, '');
    const metaParts = [
      `Qty ${item.quantity}`,
      `${chanPrefix(item)}${rawOrder}`,
      item.inventoryId ? `Lot ${item.inventoryId}` : null,
    ].filter(Boolean) as string[];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text(metaParts.join(' \u00b7 '), MX, y);
    y += 5;

    // ── Buyer comment ────────────────────────────────────────────────────────
    if (item.comment) {
      doc.setFontSize(8.5);
      doc.setTextColor(0, 85, 170);
      doc.text(item.comment, MX, y);
      y += 4.5;
    }
    y += 6;
  }

  hiddenPrint(doc.output('blob'), 'picklist.pdf');
}

// ─── Packing-slip PDF ────────────────────────────────────────────────────────

export async function printPackingSlips(orders: PackingSlipOrder[], org?: OrgBranding): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const logo = await loadLogoInfo(org?.logoUrl);
  let logoW = 0;
  if (logo && logo.w > 0 && logo.h > 0) {
    logoW = (logo.w / logo.h) * LOGO_H;
  }

  const companyName = org?.name || 'Your Company';
  const companyAddress = org?.address || 'Configure your address in Settings';
  const addressLines = companyAddress.split('\n').map(l => l.trim()).filter(Boolean);

  orders.forEach((order, idx) => {
    if (idx > 0) doc.addPage();
    const orderStartPage = doc.internal.getNumberOfPages();
    // Explicitly switch to this order's starting page so any prior footer
    // loop (which calls setPage) doesn't leave the cursor on the wrong page.
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

    // Order meta — right-aligned
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

    // ── Items table ─────────────────────────────────────────────────────────
    // autoTable repeats the Description/Qty header on every page automatically.
    const rows = order.items.map(item => {
      const base  = cleanItemName(item.name, item.bricklinkPartNumber);
      const color = item.colorName ? `${item.colorName} ` : '';
      const part  = item.bricklinkPartNumber ? ` (${item.bricklinkPartNumber})` : '';
      const name  = `LEGO ${color}${base}${part}`;
      const metaParts = [
        item.colorName ? `Color: ${item.colorName}`     : '',
        item.condition ? `Condition: ${item.condition}` : '',
      ].filter(Boolean);
      const meta = metaParts.length > 0 ? metaParts.join(', ') : '';
      const comment = item.comment?.trim() || '';
      const line2 = [meta, comment].filter(Boolean).join('  ·  ');
      return [line2 ? `${name}\n${line2}` : name, String(item.quantity)];
    });

    autoTable(doc, {
      startY: y,
      margin: { left: MX, right: MX },
      head: [['Description', 'Qty']],
      body: rows,
      styles: {
        fontSize: 11,
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

    // ── Footers: stamp every page for this order with order # + Page X of Y.
    // We do this AFTER autotable finishes so we know the final page count.
    const orderEndPage  = doc.internal.getNumberOfPages();
    const orderPageTotal = orderEndPage - orderStartPage + 1;
    const footerLabel   = `${channelLabel(order)} Order # ${order.orderNumber}`;

    for (let p = orderStartPage; p <= orderEndPage; p++) {
      doc.setPage(p);
      const pageInOrder = p - orderStartPage + 1;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(102, 102, 102);
      doc.text(
        `${footerLabel}  ·  Page ${pageInOrder} of ${orderPageTotal}`,
        MX + CONTENT_W,
        PAGE_H - MY,
        { align: 'right' },
      );
    }
  });

  hiddenPrint(doc.output('blob'), 'packing-slips.pdf');
}

export default function PackingSlip({ orders }: PackingSlipProps) {
  return null;
}

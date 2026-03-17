import jsPDF from 'jspdf';
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

const MX        = 4;            // left/right margin mm
const MY        = 1;            // top/bottom margin mm
const PAGE_W    = 215.9;        // letter width mm
const PAGE_H    = 279.4;        // letter height mm
const CONTENT_W = PAGE_W - 2 * MX;
const LOGO_H    = 22;           // logo height mm

// Table row sizing (manual drawing — no autoTable)
const CELL_PAD    = 3.5;  // top/bottom cell padding mm
const NAME_FONT   = 11;   // pt
const META_FONT   = 9.5;  // pt
const NAME_LINE_H = 5.0;  // mm per name line (11pt + leading)
const META_LINE_H = 4.2;  // mm per meta/comment line (9.5pt + leading)
const TABLE_HDR_H = 8;    // mm for "Description / Qty" header row
const FOOTER_ZONE = 10;   // mm reserved at page bottom for footer text

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
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve({ dataUrl: canvas.toDataURL('image/png'), w, h });
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = orgLogoUrl;
  });
}

// ─── Print helper ─────────────────────────────────────────────────────────────

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
    iframe.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;border:none;' +
      'opacity:0;pointer-events:none;z-index:-1;';
  } else {
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
    try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { /* guard */ }
    if (!ios) iframe.contentWindow?.addEventListener('afterprint', cleanup, { once: true });
    setTimeout(cleanup, ios ? 120_000 : 30_000);
  };

  iframe.addEventListener('load', doPrint, { once: true });
  setTimeout(doPrint, 1500);
  setTimeout(cleanup, 120_000);
  iframe.src = url;
}

// ─── Picklist PDF ─────────────────────────────────────────────────────────────

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
  comment?: string | null;
}

const chanPrefix = (item: PicklistItem) => item.marketplace === 'BrickOwl' ? 'BO' : 'BL';
const condLabel  = (c: string | null | undefined) => c === 'N' ? 'New' : c === 'U' ? 'Used' : (c || '');
const partKey    = (item: PicklistItem) => item.partNumber || item.sku || '';

export function printPicklist(items: PicklistItem[]): void {
  if (items.length === 0) return;

  const PANEL_H     = PAGE_H / 2;
  const panelTop    = (p: 0 | 1) => p * PANEL_H + MY;
  const panelBottom = (p: 0 | 1) => (p + 1) * PANEL_H - MY;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  let panel: 0 | 1 = 0;
  let y = panelTop(0);

  const advancePanel = () => {
    if (panel === 0) {
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

    doc.setDrawColor(187, 187, 187);
    doc.setLineWidth(0.25);
    doc.line(MX, y, MX + 20, y);
    y += 3;

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

// ─── Packing-slip PDF (manual table, no autoTable) ────────────────────────────
//
// We draw the items table by hand so every addPage() call is explicit and
// predictable. autoTable maintains internal state that drifts across multiple
// forEach iterations, causing only the first order to appear when printing
// multiple slips. Manual drawing has no such state.

export async function printPackingSlips(orders: PackingSlipOrder[], org?: OrgBranding): Promise<void> {
  const logo = await loadLogoInfo(org?.logoUrl);
  let logoW = 0;
  if (logo && logo.w > 0 && logo.h > 0) {
    // Cap logo width at 40% of content width
    logoW = Math.min((logo.w / logo.h) * LOGO_H, CONTENT_W * 0.4);
  }

  const companyName    = org?.name    || 'Your Company';
  const companyAddress = org?.address || 'Configure your address in Settings';
  const addressLines   = companyAddress.split('\n').map(l => l.trim()).filter(Boolean);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

  orders.forEach((order, orderIdx) => {
    try {
      // ── New page for every order after the first ──────────────────────────
      if (orderIdx > 0) {
        doc.setPage(doc.internal.getNumberOfPages());
        doc.addPage();
      }
      const orderStartPage = doc.internal.getNumberOfPages();
      doc.setPage(orderStartPage);

      // ── Header ────────────────────────────────────────────────────────────
      let y = MY;
      const headerTopY = y;

      doc.setTextColor(0, 0, 0);
      doc.setFontSize(19);
      doc.setFont('helvetica', 'bold');
      doc.text(companyName, MX, y + 6);

      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 51, 51);
      let addrY = y + 13;
      addressLines.forEach(line => { doc.text(line, MX, addrY); addrY += 5.5; });

      if (logo && logoW > 0) {
        doc.addImage(logo.dataUrl, 'PNG', MX + CONTENT_W - logoW, headerTopY, logoW, LOGO_H);
      }

      y += Math.max(LOGO_H, 24) + 3;

      // Divider
      doc.setDrawColor(170, 170, 170);
      doc.setLineWidth(0.2);
      doc.line(MX, y, MX + CONTENT_W, y);
      y += 5;

      // ── Ship-to (left) + Order meta (right) ───────────────────────────────
      const { shipTo } = order;
      const street1  = shipTo.street1 || (shipTo as any).address1 || '';
      const street2  = shipTo.street2 || (shipTo as any).address2 || '';
      const cityLine = [shipTo.city, shipTo.state, shipTo.postalCode].filter(Boolean).join(' ');
      const showCtry = !!(shipTo.country && shipTo.country !== 'US');
      const infoTopY = y;

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

      y = Math.max(shipAddrY, infoTopY + 18) + 4;

      // ── Items table (manual) ───────────────────────────────────────────────
      const BOTTOM    = PAGE_H - MY - FOOTER_ZONE;
      const DESC_W    = CONTENT_W - 20; // 20 mm for qty column

      const drawTableHeader = () => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text('Description', MX + CELL_PAD, y + 5.5);
        doc.text('Qty', MX + CONTENT_W - CELL_PAD, y + 5.5, { align: 'right' });
        doc.setDrawColor(85, 85, 85);
        doc.setLineWidth(0.4);
        doc.line(MX, y + TABLE_HDR_H, MX + CONTENT_W, y + TABLE_HDR_H);
        y += TABLE_HDR_H;
      };

      drawTableHeader();

      for (const item of order.items) {
        // Build display strings
        const base    = cleanItemName(item.name, item.bricklinkPartNumber);
        const color   = item.colorName ? `${item.colorName} ` : '';
        const part    = item.bricklinkPartNumber ? ` (${item.bricklinkPartNumber})` : '';
        const name    = `LEGO ${color}${base}${part}`;
        const metaParts = [
          item.colorName ? `Color: ${item.colorName}` : '',
          item.condition ? `Condition: ${item.condition}` : '',
        ].filter(Boolean).join(', ');
        const comment  = item.comment?.trim() || '';
        const line2    = [metaParts, comment].filter(Boolean).join('  \u00b7  ');

        // Measure wrapped lines at current font settings
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(NAME_FONT);
        const nameLines = doc.splitTextToSize(name, DESC_W - CELL_PAD * 2);

        let line2Lines: string[] = [];
        if (line2) {
          doc.setFontSize(META_FONT);
          line2Lines = doc.splitTextToSize(line2, DESC_W - CELL_PAD * 2);
        }

        const nameBlockH  = nameLines.length  * NAME_LINE_H;
        const line2BlockH = line2Lines.length > 0 ? line2Lines.length * META_LINE_H + 1.5 : 0;
        const rowH        = CELL_PAD + nameBlockH + line2BlockH + CELL_PAD;

        // Overflow → new page, repeat table header
        if (y + rowH > BOTTOM) {
          doc.addPage();
          y = MY;
          drawTableHeader();
        }

        // ── Draw row ────────────────────────────────────────────────────────
        const rowY = y;

        // Description
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(NAME_FONT);
        doc.setTextColor(0, 0, 0);
        // jsPDF text y = baseline; we nudge up by ~1mm so text sits inside padding
        doc.text(nameLines, MX + CELL_PAD, rowY + CELL_PAD + NAME_LINE_H - 1);

        if (line2Lines.length > 0) {
          doc.setFontSize(META_FONT);
          doc.setTextColor(85, 85, 85);
          doc.text(
            line2Lines,
            MX + CELL_PAD,
            rowY + CELL_PAD + nameBlockH + META_LINE_H - 0.5,
          );
        }

        // Qty (right-aligned, vertically centred on name baseline)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(NAME_FONT);
        doc.setTextColor(0, 0, 0);
        doc.text(
          String(item.quantity),
          MX + CONTENT_W - CELL_PAD,
          rowY + CELL_PAD + NAME_LINE_H - 1,
          { align: 'right' },
        );

        y += rowH;

        // Row divider
        doc.setDrawColor(220, 220, 220);
        doc.setLineWidth(0.1);
        doc.line(MX, y, MX + CONTENT_W, y);
      }

      // ── Footer stamp: every page gets "Channel Order # · Page X of Y" ─────
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
          MX + CONTENT_W,
          PAGE_H - MY,
          { align: 'right' },
        );
      }
    } catch (err) {
      console.error(`[printPackingSlips] Failed to render order ${order.orderNumber}:`, err);
    }
  });

  hiddenPrint(doc.output('blob'), 'packing-slips.pdf');
}

export default function PackingSlip({ orders }: PackingSlipProps) {
  return null;
}

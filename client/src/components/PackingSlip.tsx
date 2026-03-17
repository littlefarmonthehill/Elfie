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

const MARGIN   = 6.35;         // 0.25 in → mm (industry-minimum for laser printers)
const PAGE_W   = 215.9;        // letter width mm
const PAGE_H   = 279.4;        // letter height mm
const CONTENT_W = PAGE_W - 2 * MARGIN;  // 203.2 mm
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

/** Open a loading placeholder window before async work to avoid popup blocker. */
export function openLoadingWindow(): Window | null {
  const win = window.open('', '_blank', 'noopener');
  if (win) {
    win.document.write(
      '<html><body style="margin:0;background:#f8f8f8;font-family:sans-serif;' +
      'display:flex;align-items:center;justify-content:center;height:100vh;' +
      'color:#888;font-size:14px">Preparing document\u2026</body></html>'
    );
    win.document.close();
  }
  return win;
}

/**
 * Navigate `preOpenedWin` (or open a new window) to the blob URL, then
 * auto-print and close on afterprint.
 */
export function openPdfAndPrint(blobUrl: string, preOpenedWin?: Window | null): void {
  const win = preOpenedWin ?? window.open(blobUrl, '_blank', 'noopener');
  if (!win) return;
  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    win.addEventListener('afterprint', () => {
      win.close();
      URL.revokeObjectURL(blobUrl);
    }, { once: true });
    try { win.print(); } catch { /* cross-origin guard */ }
  };
  if (preOpenedWin) {
    // Window already open with a loading page — navigate it to the PDF
    preOpenedWin.location.href = blobUrl;
    preOpenedWin.addEventListener('load', doPrint, { once: true });
  } else {
    win.addEventListener('load', doPrint, { once: true });
  }
  // Fallback: some browsers don't fire load for blob PDF URLs
  setTimeout(doPrint, 1200);
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function printPackingSlips(orders: PackingSlipOrder[], org?: OrgBranding, preOpenedWin?: Window | null): Promise<void> {
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
    let y = MARGIN;

    // ── Company info (left) + logo (right) ──────────────────────────────────
    const headerTopY = y;
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(19);
    doc.setFont('helvetica', 'bold');
    doc.text(companyName, MARGIN, y + 5);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 51, 51);
    let addrLineY = y + 12;
    addressLines.forEach(line => {
      doc.text(line, MARGIN, addrLineY);
      addrLineY += 6;
    });

    if (logo && logoW > 0) {
      doc.addImage(logo.dataUrl, 'PNG', MARGIN + CONTENT_W - logoW, headerTopY, logoW, LOGO_H);
    }

    y += Math.max(LOGO_H, 23) + 3;

    // ── Divider ─────────────────────────────────────────────────────────────
    doc.setDrawColor(170, 170, 170);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
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
    doc.text('Ship To', MARGIN, y + 5);

    doc.setFont('helvetica', 'normal');
    const shipAddrLines = [
      shipTo.name, shipTo.company, street1, street2, cityLine,
      showCtry ? shipTo.country : undefined,
    ].filter(Boolean) as string[];

    let shipAddrY = y + 11;
    shipAddrLines.forEach(line => { doc.text(line, MARGIN, shipAddrY); shipAddrY += 5.5; });

    // Order meta — right-aligned
    const metaX = MARGIN + CONTENT_W;
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
      margin: { left: MARGIN, right: MARGIN },
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
        MARGIN + CONTENT_W,
        PAGE_H - MARGIN,
        { align: 'right' },
      );
    }
  });

  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  openPdfAndPrint(url, preOpenedWin);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function PackingSlip({ orders }: PackingSlipProps) {
  return null;
}

import jsPDF from 'jspdf';
import { cleanItemName } from "@/lib/item-utils";

// ─── Org branding ─────────────────────────────────────────────────────────────

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

// ─── Page geometry (all mm) ───────────────────────────────────────────────────

const PW   = 215.9;   // letter width
const PH   = 279.4;   // letter height
const ML   = 15;      // left margin
const MR   = 15;      // right margin
const MT   = 12;      // top margin
const MB   = 14;      // bottom margin
const CW   = PW - ML - MR;   // content width
const YMAX = PH - MB;         // lowest y before page break

// ─── Hidden-print helper ──────────────────────────────────────────────────────

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

// ─── Picklist (jsPDF, manual drawing) ────────────────────────────────────────

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

  const MX        = 4;
  const MY        = 1;
  const PAGE_H    = 279.4;
  const CONTENT_W = PW - 2 * MX;
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

// ─── Logo loader ──────────────────────────────────────────────────────────────

async function loadLogoDataUrl(src?: string | null): Promise<string> {
  if (!src) return '';
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width  = img.naturalWidth  || img.width;
        c.height = img.naturalHeight || img.height;
        const ctx = c.getContext('2d');
        if (!ctx) { resolve(''); return; }
        ctx.drawImage(img, 0, 0);
        resolve(c.toDataURL('image/png'));
      } catch { resolve(''); }
    };
    img.onerror = () => resolve('');
    img.src = src;
  });
}

// ─── Packing slips (jsPDF manual drawing) ────────────────────────────────────
//
// Every visual element is drawn with jsPDF primitives — no autoTable — so
// there is zero internal state drift across orders. PDF blob → hiddenPrint
// means no browser URL / page-number headers appear in the output.

function channelLabel(order: PackingSlipOrder) {
  return order.marketplace === 'BrickOwl' ? 'BrickOwl' : 'BrickLink';
}

// Draw the dark "PACKING SLIP" label bar, return new y
function drawLabelBar(doc: jsPDF, y: number, orderLabel: string): number {
  const BAR_H = 6;
  doc.setFillColor(70, 70, 70);
  doc.rect(ML, y, CW, BAR_H, 'F');

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('PACKING SLIP', ML + 2, y + 4.2);

  doc.setFont('helvetica', 'normal');
  const labelW = doc.getTextWidth(orderLabel);
  doc.text(orderLabel, ML + CW - 2 - labelW, y + 4.2);

  doc.setTextColor(0, 0, 0);
  return y + BAR_H + 4;
}

// Draw the full first-page header (logo, company, order info, ship-to)
// Returns the y after the header
function drawFullHeader(
  doc: jsPDF,
  order: PackingSlipOrder,
  companyName: string,
  addrLines: string[],
  logoDataUrl: string,
  pageLabel: string,
): number {
  let y = MT;

  y = drawLabelBar(doc, y, pageLabel);

  // ── company block (left) + logo (right) ──────────────────────────────────
  const LOGO_H  = 18;
  const LOGO_W  = 50;
  const COL_MID = ML + CW / 2;

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', ML + CW - LOGO_W, y, LOGO_W, LOGO_H);
    } catch { /* ignore if image fails */ }
  }

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(companyName, ML, y + 5);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  let addrY = y + 10;
  for (const line of addrLines) {
    doc.text(line, ML, addrY);
    addrY += 4;
  }

  y += Math.max(LOGO_H, addrY - MT) + 2;

  // ── thin divider ──────────────────────────────────────────────────────────
  doc.setDrawColor(160, 160, 160);
  doc.setLineWidth(0.25);
  doc.line(ML, y, ML + CW, y);
  y += 5;

  // ── order meta (right column) + ship-to (left column) ────────────────────
  const shipTo = order.shipTo;
  const street1  = shipTo.street1 || (shipTo as any).address1 || '';
  const street2  = shipTo.street2 || (shipTo as any).address2 || '';
  const cityLine = [shipTo.city, shipTo.state, shipTo.postalCode].filter(Boolean).join(' ');
  const showCtry = !!(shipTo.country && shipTo.country !== 'US');
  const chan = channelLabel(order);

  // right: order meta
  const metaRightX = ML + CW;
  const metaRows: [string, string][] = [
    [`${chan} Order #`, order.orderNumber],
    ['Date', order.orderDate ? new Date(order.orderDate).toLocaleDateString() : ''],
  ];
  doc.setFontSize(8.5);
  let metaY = y;
  for (const [label, val] of metaRows) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    const lw = doc.getTextWidth(label + ': ');
    doc.text(label + ':', metaRightX - doc.getTextWidth(val) - lw - 2, metaY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text(val, metaRightX - doc.getTextWidth(val), metaY);
    metaY += 5;
  }

  // left: ship-to
  const shipLines: string[] = [];
  if (shipTo.name)    shipLines.push(shipTo.name);
  if (shipTo.company) shipLines.push(shipTo.company);
  if (street1)        shipLines.push(street1);
  if (street2)        shipLines.push(street2);
  if (cityLine)       shipLines.push(cityLine);
  if (showCtry && shipTo.country) shipLines.push(shipTo.country);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(80, 80, 80);
  doc.text('Ship To:', ML, y);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);
  let shipY = y + 4.5;
  if (shipLines.length === 0) {
    doc.setTextColor(150, 150, 150);
    doc.text('Address not available', ML, shipY);
    doc.setTextColor(0, 0, 0);
    shipY += 4.5;
  }
  for (const line of shipLines) {
    doc.text(line, ML, shipY);
    shipY += 4.5;
  }

  y = Math.max(metaY, shipY) + 3;

  // ── thin divider before items ──────────────────────────────────────────────
  doc.setDrawColor(160, 160, 160);
  doc.setLineWidth(0.25);
  doc.line(ML, y, ML + CW, y);
  y += 1;

  return y;
}

// Draw the items table header row, return new y
function drawTableHeader(doc: jsPDF, y: number): number {
  const ROW_H = 6;
  doc.setFillColor(50, 50, 50);
  doc.rect(ML, y, CW, ROW_H, 'F');

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('DESCRIPTION', ML + 2, y + 4.2);
  doc.text('QTY', ML + CW - 2, y + 4.2, { align: 'right' });

  doc.setTextColor(0, 0, 0);
  return y + ROW_H;
}

// Estimate height needed for one item row (mm)
function itemRowHeight(
  doc: jsPDF,
  item: PackingSlipOrder['items'][0],
  maxNameW: number,
): number {
  const base     = cleanItemName(item.name, item.bricklinkPartNumber);
  const color    = item.colorName ? `${item.colorName} ` : '';
  const part     = item.bricklinkPartNumber ? ` (${item.bricklinkPartNumber})` : '';
  const fullName = `LEGO ${color}${base}${part}`;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const lines = doc.splitTextToSize(fullName, maxNameW);
  let h = lines.length * 4.2 + 2; // name lines
  const hasMeta    = !!(item.colorName || item.condition);
  const hasComment = !!(item.comment?.trim());
  if (hasMeta || hasComment) h += 4;     // meta/comment line
  h += 3;                                // bottom padding
  return Math.max(h, 9);
}

// Draw one item row, return new y
function drawItemRow(
  doc: jsPDF,
  y: number,
  item: PackingSlipOrder['items'][0],
  nameColW: number,
  shade: boolean,
): number {
  const base     = cleanItemName(item.name, item.bricklinkPartNumber);
  const color    = item.colorName ? `${item.colorName} ` : '';
  const part     = item.bricklinkPartNumber ? ` (${item.bricklinkPartNumber})` : '';
  const fullName = `LEGO ${color}${base}${part}`;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const nameLines = doc.splitTextToSize(fullName, nameColW);

  const metaParts = [
    item.colorName  ? `Color: ${item.colorName}`  : '',
    item.condition  ? `Cond: ${item.condition === 'N' ? 'New' : item.condition === 'U' ? 'Used' : item.condition}` : '',
  ].filter(Boolean).join('  ·  ');
  const comment = item.comment?.trim() || '';
  const line2   = [metaParts, comment].filter(Boolean).join('  ·  ');

  const rowH = itemRowHeight(doc, item, nameColW);

  if (shade) {
    doc.setFillColor(248, 248, 248);
    doc.rect(ML, y, CW, rowH, 'F');
  }

  // name
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);
  doc.text(nameLines, ML + 2, y + 4);

  // meta / comment
  if (line2) {
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    const metaY = y + nameLines.length * 4.2 + 2;
    doc.text(line2, ML + 2, metaY + 1.5);
    doc.setTextColor(0, 0, 0);
  }

  // qty
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(String(item.quantity), ML + CW - 2, y + 5, { align: 'right' });

  // bottom border
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.15);
  doc.line(ML, y + rowH, ML + CW, y + rowH);

  return y + rowH;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function printPackingSlips(
  orders: PackingSlipOrder[],
  org?: OrgBranding,
): Promise<void> {
  if (orders.length === 0) return;

  const companyName    = org?.name    || 'Your Company';
  const companyAddress = org?.address || '';
  const addrLines = companyAddress.split('\n').map(l => l.trim()).filter(Boolean);
  const logoDataUrl = await loadLogoDataUrl(org?.logoUrl);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const NAME_COL_W = CW - 16; // leave 16mm for qty column

  let firstOrder = true;

  for (const order of orders) {
    // ── new page for every order after the first ──────────────────────────
    if (!firstOrder) doc.addPage();
    firstOrder = false;

    const totalItems = order.items.length;
    const chan       = channelLabel(order);
    const pageLabel  = `${chan} Order ${order.orderNumber}`;

    // ── draw full first-page header ──────────────────────────────────────
    let y = drawFullHeader(doc, order, companyName, addrLines, logoDataUrl, pageLabel);
    y = drawTableHeader(doc, y);

    // ── draw items, inserting new pages as needed ─────────────────────────
    let pageNum    = 1;
    let rowShade   = false;

    for (let i = 0; i < totalItems; i++) {
      const item  = order.items[i];
      const rowH  = itemRowHeight(doc, item, NAME_COL_W);

      // need a new page?
      if (y + rowH > YMAX) {
        doc.addPage();
        pageNum++;
        const contLabel = `${pageLabel}  ·  Page ${pageNum}`;
        y = MT;
        y = drawLabelBar(doc, y, contLabel);
        y = drawTableHeader(doc, y);
        rowShade = false;
      }

      y = drawItemRow(doc, y, item, NAME_COL_W, rowShade);
      rowShade = !rowShade;
    }

    if (totalItems === 0) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(150, 150, 150);
      doc.text('No items', ML + 2, y + 6);
    }
  }

  const filename = orders.length === 1
    ? `packing-slip-${orders[0].orderNumber}.pdf`
    : `packing-slips-${new Date().toISOString().slice(0, 10)}.pdf`;

  hiddenPrint(doc.output('blob'), filename);
}

export default function PackingSlip({ orders }: PackingSlipProps) {
  return null;
}

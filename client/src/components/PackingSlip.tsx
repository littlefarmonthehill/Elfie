import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PDFDocument } from 'pdf-lib';
import planetLogo from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MARGIN    = 7.62;               // 0.3 in → mm
const PAGE_W    = 215.9;              // letter width mm
const PAGE_H    = 279.4;              // letter height mm
const CONTENT_W = PAGE_W - 2 * MARGIN;
const LOGO_H    = 28;                 // target logo height mm

// Picklist
const MX        = 4;
const MY        = 1;
const PL_CONT_W = PAGE_W - 2 * MX;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function channelLabel(order: PackingSlipOrder): string {
  return order.marketplace === 'BrickOwl' ? 'BrickOwl' : 'BrickLink';
}

async function loadLogoInfo(
  orgLogoUrl?: string | null,
): Promise<{ dataUrl: string; w: number; h: number } | null> {
  // Prefer org logo; fall back to bundled PlanetBrick asset
  const src = orgLogoUrl || planetLogo;
  try {
    const response = await fetch(src);
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const img = new Image();
    await new Promise<void>((resolve) => { img.onload = () => resolve(); img.src = dataUrl; });
    return { dataUrl, w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return null;
  }
}

// ─── Hidden print helper ──────────────────────────────────────────────────────

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

// ─── Picklist ─────────────────────────────────────────────────────────────────

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
      doc.line(MX, PANEL_H, MX + PL_CONT_W, PANEL_H);
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
      const maxW = PL_CONT_W - partW;
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

// ─── Build one order's PDF in an isolated jsPDF document ─────────────────────

function buildOrderPDF(
  order: PackingSlipOrder,
  logo: { dataUrl: string; w: number; h: number } | null,
  companyName: string,
  addressLines: string[],
): jsPDF {
  // Fresh document per order — zero shared state with any other order.
  const doc   = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
  const logoW = logo ? LOGO_H * (logo.w / logo.h) : 0;

  const orderStartPage = 1; // always page 1 in this isolated doc
  let y = MARGIN;

  // ── PACKING SLIP label bar ───────────────────────────────────────────────
  const BAR_H = 7;
  doc.setFillColor(119, 119, 119);
  doc.rect(MARGIN, y, CONTENT_W, BAR_H, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.text('PACKING SLIP', MARGIN + 3, y + BAR_H - 1.8);
  y += BAR_H + 4;

  // ── Company info (left) + logo (right) ──────────────────────────────────
  const headerTopY = y;
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(19);
  doc.setFont('helvetica', 'bold');
  doc.text(companyName, MARGIN, y + 6.5);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 51, 51);
  let addrY = y + 13.5;
  addressLines.forEach(line => { doc.text(line, MARGIN, addrY); addrY += 6; });

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
  const addrLines2 = [
    shipTo.name, shipTo.company, street1, street2, cityLine,
    showCtry ? shipTo.country : undefined,
  ].filter(Boolean) as string[];

  let shipAddrY = y + 11;
  addrLines2.forEach(line => { doc.text(line, MARGIN, shipAddrY); shipAddrY += 5.5; });

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
  const rows = order.items.map(item => {
    const base    = cleanItemName(item.name, item.bricklinkPartNumber);
    const color   = item.colorName ? `${item.colorName} ` : '';
    const part    = item.bricklinkPartNumber ? ` (${item.bricklinkPartNumber})` : '';
    const name    = `LEGO ${color}${base}${part}`;
    const meta    = [
      item.colorName ? `Color: ${item.colorName}`     : '',
      item.condition ? `Condition: ${item.condition}` : '',
    ].filter(Boolean).join(', ');
    const comment = item.comment?.trim() || '';
    const line2   = [meta, comment].filter(Boolean).join('  \u00b7  ');
    return [line2 ? `${name}\n${line2}` : name, String(item.quantity)];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
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

  // ── Footer: Page X of Y on every page ───────────────────────────────────
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
      MARGIN + CONTENT_W,
      PAGE_H - MARGIN,
      { align: 'right' },
    );
  }

  return doc;
}

// ─── Packing slips (per-order jsPDF → pdf-lib merge → hiddenPrint) ────────────

export async function printPackingSlips(
  orders: PackingSlipOrder[],
  org?: OrgBranding,
): Promise<void> {
  const logo = await loadLogoInfo(org?.logoUrl);
  const companyName    = org?.name    || 'PlanetBrick.com';
  const companyAddress = org?.address || 'PO Box 202\nLanesboro, MN 55949';
  const addressLines   = companyAddress.split('\n').map(l => l.trim()).filter(Boolean);

  // Build each order in its own isolated jsPDF — no shared autoTable state.
  const orderDocs = orders.map(order =>
    buildOrderPDF(order, logo, companyName, addressLines),
  );

  // Merge all per-order PDFs into a single document using pdf-lib.
  const merged = await PDFDocument.create();
  for (const orderDoc of orderDocs) {
    const bytes  = orderDoc.output('arraybuffer');
    const source = await PDFDocument.load(bytes);
    const pages  = await merged.copyPages(source, source.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }

  const mergedBytes = await merged.save();
  const blob = new Blob([mergedBytes], { type: 'application/pdf' });

  const filename = orders.length === 1
    ? `packing-slip-${orders[0].orderNumber}.pdf`
    : `packing-slips-${new Date().toISOString().slice(0, 10)}.pdf`;
  hiddenPrint(blob, filename);
}

export default function PackingSlip({ orders }: PackingSlipProps) {
  return null;
}

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import planetLogo from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";
import { cleanItemName } from "@/lib/item-utils";

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
  }>;
};

interface PackingSlipProps {
  orders: PackingSlipOrder[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MARGIN   = 7.62;         // 0.3 in → mm
const PAGE_W   = 215.9;        // letter width mm
const PAGE_H   = 279.4;        // letter height mm
const CONTENT_W = PAGE_W - 2 * MARGIN;  // 200.66 mm
const LOGO_H   = 28;           // target logo height in mm

// ─── Helpers ─────────────────────────────────────────────────────────────────

function channelLabel(order: PackingSlipOrder): string {
  return order.marketplace === 'BrickOwl' ? 'BrickOwl' : 'BrickLink';
}

async function loadLogoInfo(): Promise<{ dataUrl: string; w: number; h: number } | null> {
  try {
    const response = await fetch(planetLogo);
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

// ─── Main export ─────────────────────────────────────────────────────────────

export async function printPackingSlips(orders: PackingSlipOrder[]) {
  const doc  = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
  const logo = await loadLogoInfo();
  const logoW = logo ? LOGO_H * (logo.w / logo.h) : 0;

  orders.forEach((order, orderIdx) => {
    if (orderIdx > 0) doc.addPage();

    // Record which doc page this order starts on so we can stamp accurate
    // "Page X of Y" footers after autotable finishes rendering.
    const orderStartPage = doc.internal.getNumberOfPages();

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
    doc.text('PlanetBrick.com', MARGIN, y + 6.5);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 51, 51);
    doc.text('PO Box 202',          MARGIN, y + 13.5);
    doc.text('Lanesboro, MN 55949', MARGIN, y + 19.5);

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
    const addrLines = [
      shipTo.name, shipTo.company, street1, street2, cityLine,
      showCtry ? shipTo.country : undefined,
    ].filter(Boolean) as string[];

    let addrY = y + 11;
    addrLines.forEach(line => { doc.text(line, MARGIN, addrY); addrY += 5.5; });

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

    y = Math.max(addrY, infoTopY + 18) + 3;

    // ── Items table ─────────────────────────────────────────────────────────
    // autoTable repeats the Description/Qty header on every page automatically.
    const rows = order.items.map(item => {
      const base  = cleanItemName(item.name, item.bricklinkPartNumber);
      const color = item.colorName ? `${item.colorName} ` : '';
      const part  = item.bricklinkPartNumber ? ` (${item.bricklinkPartNumber})` : '';
      const name  = `LEGO ${color}${base}${part}`;
      const meta  = [
        item.colorName ? `Color: ${item.colorName}`     : '',
        item.condition ? `Condition: ${item.condition}` : '',
      ].filter(Boolean).join(', ');
      return [meta ? `${name}\n${meta}` : name, String(item.quantity)];
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

  // Trigger browser download — no popup, no print dialog quirks.
  const filename = orders.length === 1
    ? `packing-slip-${orders[0].orderNumber}.pdf`
    : `packing-slips-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}

export default function PackingSlip({ orders }: PackingSlipProps) {
  return null;
}

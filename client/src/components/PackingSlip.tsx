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

const MX        = 4;        // left/right margin mm (picklist)
const MY        = 1;        // top/bottom margin mm (picklist)
const PAGE_W    = 215.9;    // letter width mm
const PAGE_H    = 279.4;    // letter height mm
const CONTENT_W = PAGE_W - 2 * MX;

// Items per page for packing slips (HTML/CSS, browser handles page breaks)
const FIRST_PAGE_ITEMS = 9;   // first page has header, so fewer items fit
const CONT_PAGE_ITEMS  = 20;  // continuation pages

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

// ─── Print helper ─────────────────────────────────────────────────────────────

/**
 * iOS Safari requires the iframe to be "visible" (i.e. not visibility:hidden)
 * for it to rasterize content and produce non-blank prints.
 * We detect iOS so we can use opacity:0 instead of visibility:hidden.
 */
function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/**
 * Loads a Blob (PDF or HTML) into a hidden iframe and calls print().
 * On iOS the iframe is opacity:0 (visible to the render engine, invisible to the user).
 * On all other platforms it is positioned far off-screen.
 */
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
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch { /* cross-origin guard */ }
    if (!ios) {
      iframe.contentWindow?.addEventListener('afterprint', cleanup, { once: true });
    }
    setTimeout(cleanup, ios ? 120_000 : 30_000);
  };

  iframe.addEventListener('load', doPrint, { once: true });
  setTimeout(doPrint, 1500);   // fallback if load doesn't fire
  setTimeout(cleanup, 120_000); // safety net

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

  const PANEL_H = PAGE_H / 2;
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

// ─── Packing-slip HTML ────────────────────────────────────────────────────────
//
// The browser's native print engine handles multi-order perfectly via CSS
// page-break-after on each .page div. This is the approach that was working
// on Feb 25 — we keep the same HTML/CSS generation but route the output
// through the invisible iframe (hiddenPrint) instead of a popup window.

function buildPackingSlipHTML(
  orders: PackingSlipOrder[],
  opts: { companyName: string; companyAddress: string; logoDataUrl: string },
): string {
  const { companyName, companyAddress, logoDataUrl } = opts;
  const addrLines = companyAddress.split('\n').map(l => l.trim()).filter(Boolean);

  const allPageDivs: string[] = [];

  orders.forEach((order, orderIdx) => {
    const { shipTo } = order;
    const street1  = shipTo.street1 || (shipTo as any).address1 || '';
    const street2  = shipTo.street2 || (shipTo as any).address2 || '';
    const cityLine = [shipTo.city, shipTo.state, shipTo.postalCode].filter(Boolean).join(' ');
    const showCtry = !!(shipTo.country && shipTo.country !== 'US');
    const chanLabel = channelLabel(order);

    // Chunk items so each .page div has a controlled number of rows.
    // The browser still applies page-break-after on each div, so this
    // ensures the header is never squeezed off a full-item page.
    const chunks: typeof order.items[] = [];
    if (order.items.length > 0) {
      chunks.push(order.items.slice(0, FIRST_PAGE_ITEMS));
      for (let i = FIRST_PAGE_ITEMS; i < order.items.length; i += CONT_PAGE_ITEMS) {
        chunks.push(order.items.slice(i, i + CONT_PAGE_ITEMS));
      }
    } else {
      chunks.push([]); // always render at least one page per order
    }

    const totalChunks = chunks.length;
    const isLastOrder = orderIdx === orders.length - 1;

    chunks.forEach((chunk, chunkIdx) => {
      const isLastPage     = isLastOrder && chunkIdx === chunks.length - 1;
      const isContinuation = chunkIdx > 0;
      const pageLabel      = totalChunks > 1
        ? `${chanLabel} Order ${order.orderNumber} &nbsp;&middot;&nbsp; Page ${chunkIdx + 1} of ${totalChunks}`
        : `${chanLabel} Order ${order.orderNumber}`;

      // ── Bar (every page) ────────────────────────────────────────────────────
      const barHTML = `
        <div class="slip-label-bar">
          <span class="bar-left">Packing Slip</span>
          <span class="bar-right">${pageLabel}</span>
        </div>`;

      // ── Ship-to block ───────────────────────────────────────────────────────
      const shipToHTML = [
        shipTo.name    ? `<div>${shipTo.name}</div>`    : '',
        shipTo.company ? `<div>${shipTo.company}</div>` : '',
        street1        ? `<div>${street1}</div>`         : '',
        street2        ? `<div>${street2}</div>`         : '',
        cityLine       ? `<div>${cityLine}</div>`        : '',
        showCtry       ? `<div>${shipTo.country}</div>`  : '',
        (!shipTo.name && !street1 && !cityLine)
          ? '<div class="missing-addr">Address not available</div>' : '',
      ].join('');

      // ── Full header (first page of each order only) ─────────────────────────
      const fullHeaderHTML = isContinuation ? '' : `
        <div class="header">
          <div class="header-left">
            <div class="company-name">${companyName}</div>
            ${addrLines.map(l => `<div class="company-addr">${l}</div>`).join('')}
          </div>
          <div class="header-right">
            ${logoDataUrl
              ? `<img src="${logoDataUrl}" alt="${companyName}" class="logo" />`
              : `<div class="logo-fallback">${companyName.toUpperCase()}</div>`}
          </div>
        </div>
        <div class="info-row">
          <div class="ship-to">
            <span class="section-label">Ship To</span>
            ${shipToHTML}
          </div>
          <div class="order-meta">
            <table>
              <tr><td class="ml">${chanLabel} Order #</td><td class="mv">${order.orderNumber}</td></tr>
              <tr><td class="ml">Date</td><td class="mv">${order.orderDate ? new Date(order.orderDate).toLocaleDateString() : ''}</td></tr>
            </table>
          </div>
        </div>`;

      // ── Item rows ───────────────────────────────────────────────────────────
      const rowsHTML = chunk.map(item => {
        const base    = cleanItemName(item.name, item.bricklinkPartNumber);
        const color   = item.colorName ? `${item.colorName} ` : '';
        const part    = item.bricklinkPartNumber ? ` (${item.bricklinkPartNumber})` : '';
        const name    = `LEGO ${color}${base}${part}`;
        const metaParts = [
          item.colorName ? `Color: ${item.colorName}` : '',
          item.condition ? `Condition: ${item.condition}` : '',
        ].filter(Boolean).join(', ');
        const comment = item.comment?.trim() || '';
        const line2   = [metaParts, comment].filter(Boolean).join(' \u00b7 ');
        return `
          <tr>
            <td class="item-desc">
              <div class="item-name">${name}</div>
              ${line2 ? `<div class="item-meta">${line2}</div>` : ''}
            </td>
            <td class="item-qty">${item.quantity}</td>
          </tr>`;
      }).join('');

      allPageDivs.push(`
        <div class="page${isLastPage ? ' last' : ''}">
          ${barHTML}
          ${fullHeaderHTML}
          <table class="items">
            <thead>
              <tr>
                <th class="th-desc">Description</th>
                <th class="th-qty">Qty</th>
              </tr>
            </thead>
            <tbody>${rowsHTML}</tbody>
          </table>
        </div>`);
    });
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Packing Slips</title>
  <style>
    /* margin:0 suppresses the browser's built-in URL/date footer.
       Each .page div carries its own 0.5in top+bottom padding. */
    @page { size: letter portrait; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: white;
      color: black;
      font-family: Arial, sans-serif;
      font-size: 11px;
      padding: 0 0.5in;
    }
    .page {
      width: 100%;
      padding-top: 0.5in;
      padding-bottom: 0.5in;
      page-break-after: always;
      break-after: page;
    }
    .page.last { page-break-after: auto; break-after: auto; }

    .slip-label-bar {
      background: #444;
      color: white;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 9px;
      font-weight: bold;
      letter-spacing: 1px;
      text-transform: uppercase;
      padding: 3px 8px;
      margin-bottom: 8px;
    }
    .bar-right { font-weight: normal; letter-spacing: 0.5px; }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 6px;
      border-bottom: 1px solid #aaa;
      margin-bottom: 8px;
    }
    .header-left { flex: 1; }
    .company-name { font-weight: bold; font-size: 18px; margin-bottom: 2px; }
    .company-addr { font-size: 10px; color: #333; }
    .header-right { text-align: right; }
    .logo { height: 80px; width: auto; max-width: 200px; }
    .logo-fallback { font-size: 20px; font-weight: 900; color: #1a3a8f; }

    .info-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 10px;
    }
    .ship-to { font-size: 11px; line-height: 1.5; flex: 1; }
    .section-label { font-weight: bold; display: block; margin-bottom: 2px; }
    .missing-addr { color: #999; font-style: italic; }
    .order-meta { text-align: right; font-size: 11px; }
    .order-meta table { border-collapse: collapse; }
    .order-meta td { padding: 1px 0 1px 10px; white-space: nowrap; }
    .ml { font-weight: bold; color: #555; text-align: right; }
    .mv { text-align: right; }

    .items { width: 100%; border-collapse: collapse; margin-top: 2px; }
    .items thead tr { background: #333; color: white; }
    .th-desc {
      text-align: left; padding: 4px 6px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
    }
    .th-qty {
      text-align: right; padding: 4px 6px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
      width: 40px;
    }
    .items tbody tr { break-inside: avoid; page-break-inside: avoid; }
    .items tbody tr td {
      padding: 5px 6px;
      border-bottom: 1px solid #e0e0e0;
      vertical-align: top;
    }
    .items tbody tr:last-child td { border-bottom: none; }
    .item-desc { text-align: left; }
    .item-qty  { text-align: right; font-weight: bold; white-space: nowrap; width: 40px; }
    .item-name { font-size: 11px; line-height: 1.4; }
    .item-meta { font-size: 10px; color: #555; margin-top: 2px; }
  </style>
</head>
<body>
  ${allPageDivs.join('')}
</body>
</html>`;
}

export async function printPackingSlips(orders: PackingSlipOrder[], org?: OrgBranding): Promise<void> {
  const logo = await loadLogoInfo(org?.logoUrl);
  const companyName    = org?.name    || 'Your Company';
  const companyAddress = org?.address || 'Configure your address in Settings';

  const html = buildPackingSlipHTML(orders, {
    companyName,
    companyAddress,
    logoDataUrl: logo?.dataUrl || '',
  });

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  hiddenPrint(blob, 'packing-slips.html');
}

export default function PackingSlip({ orders }: PackingSlipProps) {
  return null;
}

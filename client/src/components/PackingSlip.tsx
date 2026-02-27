import planetLogo from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";
import { cleanItemName } from "@/lib/item-utils";

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

// First page carries the full header (bar + logo/address + ship-to + order meta).
// Long international addresses can add 2-3 extra lines, and item names sometimes
// wrap, so keep this conservative enough that no order ever overflows its page div.
const FIRST_PAGE_ITEMS = 9;
const CONT_PAGE_ITEMS  = 22;

async function loadLogoDataUrl(): Promise<string> {
  try {
    const response = await fetch(planetLogo);
    const blob = await response.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

export async function printPackingSlips(orders: PackingSlipOrder[]) {
  const logoDataUrl = await loadLogoDataUrl();
  const content = generatePackingSlipHTML(orders, logoDataUrl);

  // Open via a blob URL so the popup has its own URL rather than inheriting
  // the admin page URL in the browser's print footer. Combined with
  // @page { margin: 0 } this suppresses the footer in Chrome/Firefox entirely.
  const blob = new Blob([content], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  const printWindow = window.open(blobUrl, '_blank', 'width=800,height=600');
  if (!printWindow) {
    URL.revokeObjectURL(blobUrl);
    alert('Please allow popups to print packing slips');
    return;
  }
  const cleanup = () => {
    URL.revokeObjectURL(blobUrl);
    printWindow.close();
  };
  printWindow.addEventListener('afterprint', cleanup);
  printWindow.onafterprint = cleanup;
  // Wait for the blob page to fully load before printing
  printWindow.addEventListener('load', () => setTimeout(() => printWindow.print(), 100));
}

function channelLabel(order: PackingSlipOrder): string {
  if (order.marketplace === 'BrickOwl') return 'BrickOwl';
  return 'BrickLink';
}

function generatePackingSlipHTML(orders: PackingSlipOrder[], logoDataUrl: string): string {
  const allPageDivs: string[] = [];

  orders.forEach((order, orderIdx) => {
    const { shipTo } = order;
    const street1    = shipTo.street1 || (shipTo as any).address1 || '';
    const street2    = shipTo.street2 || (shipTo as any).address2 || '';
    const city       = shipTo.city || '';
    const state      = shipTo.state || '';
    const postalCode = shipTo.postalCode || '';
    const country    = shipTo.country || '';
    const cityLine   = [city, state, postalCode].filter(Boolean).join(' ');
    const showCountry = country && country !== 'US';
    const orderNum   = order.orderNumber;

    // Split items: first page gets fewer to leave room for full header
    const chunks: typeof order.items[] = [];
    if (order.items.length > 0) {
      chunks.push(order.items.slice(0, FIRST_PAGE_ITEMS));
      for (let i = FIRST_PAGE_ITEMS; i < order.items.length; i += CONT_PAGE_ITEMS) {
        chunks.push(order.items.slice(i, i + CONT_PAGE_ITEMS));
      }
    } else {
      chunks.push([]); // still render a page even with no items
    }

    const totalChunks = chunks.length;

    chunks.forEach((chunk, chunkIdx) => {
      const isLastPage =
        orderIdx === orders.length - 1 && chunkIdx === chunks.length - 1;
      const isContinuation = chunkIdx > 0;

      // ── Bar (first page of each order only) ───────────────────────────────
      const barHTML = !isContinuation ? `
        <div class="slip-label-bar">
          <span class="bar-left">Packing Slip</span>
        </div>
      ` : '';

      // ── Bottom-right footer (order# + page info on every page) ────────────
      const pageLabel = totalChunks > 1
        ? `${orderNum} &nbsp;&middot;&nbsp; Page ${chunkIdx + 1} of ${totalChunks}`
        : orderNum;
      const footerHTML = `<div class="page-footer">${pageLabel}</div>`;

      // ── Full header (first page of each order only) ────────────────────────
      const shipToHTML = [
        shipTo.name    ? `<div>${shipTo.name}</div>`    : '',
        shipTo.company ? `<div>${shipTo.company}</div>` : '',
        street1        ? `<div>${street1}</div>`         : '',
        street2        ? `<div>${street2}</div>`         : '',
        cityLine       ? `<div>${cityLine}</div>`        : '',
        showCountry    ? `<div>${country}</div>`         : '',
        (!shipTo.name && !street1 && !cityLine)
          ? '<div class="missing-addr">Address not available</div>' : '',
      ].join('');

      const fullHeaderHTML = `
        <div class="header">
          <div class="header-left">
            <div class="company-name">PlanetBrick.com</div>
            <div class="company-addr">PO Box 202</div>
            <div class="company-addr">Lanesboro, MN 55949</div>
          </div>
          <div class="header-right">
            ${logoDataUrl
              ? `<img src="${logoDataUrl}" alt="PlanetBrick" class="logo" />`
              : '<div class="logo-fallback">PLANETBRICK.COM</div>'}
          </div>
        </div>
        <div class="info-row">
          <div class="ship-to">
            <span class="section-label">Ship To</span>
            ${shipToHTML}
          </div>
          <div class="order-meta">
            <table>
              <tr><td class="ml">${channelLabel(order)} Order #</td><td class="mv">${orderNum}</td></tr>
              <tr><td class="ml">Date</td><td class="mv">${order.orderDate ? new Date(order.orderDate).toLocaleDateString() : ''}</td></tr>
            </table>
          </div>
        </div>
      `;

      // ── Item rows ──────────────────────────────────────────────────────────
      const rowsHTML = chunk.map((item: any) => {
        const baseName    = cleanItemName(item.name, item.bricklinkPartNumber);
        const colorPrefix = item.colorName ? `${item.colorName} ` : '';
        const partLabel   = item.bricklinkPartNumber ? ` (${item.bricklinkPartNumber})` : '';
        const fullName    = `LEGO ${colorPrefix}${baseName}${partLabel}`;
        const metaParts   = [
          item.colorName ? `Color: ${item.colorName}`     : '',
          item.condition ? `Condition: ${item.condition}` : '',
        ].filter(Boolean).join(', ');
        return `
          <tr>
            <td class="item-desc">
              <div class="item-name">${fullName}</div>
              ${metaParts ? `<div class="item-meta">${metaParts}</div>` : ''}
            </td>
            <td class="item-qty">${item.quantity}</td>
          </tr>
        `;
      }).join('');

      allPageDivs.push(`
        <div class="page${isLastPage ? ' last' : ''}">
          ${barHTML}
          ${isContinuation ? '' : fullHeaderHTML}
          <table class="items">
            <thead>
              <tr>
                <th class="th-desc">Description</th>
                <th class="th-qty">Qty</th>
              </tr>
            </thead>
            <tbody>${rowsHTML}</tbody>
          </table>
          ${footerHTML}
        </div>
      `);
    });
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Packing Slips</title>
  <style>
    /* margin:0 eliminates the margin zone so Chrome/Firefox suppress their
       built-in URL/date footer. Each .page div carries its own padding so
       every virtual page gets identical 0.5in top and bottom spacing without
       relying on position:fixed overlays that behave inconsistently. */
    @page { size: letter portrait; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: white;
      color: black;
      font-family: Arial, sans-serif;
      font-size: 11px;
      padding: 0 0.5in; /* horizontal margins only; vertical handled per .page */
    }

    .page {
      width: 100%;
      padding-top: 0.5in;
      padding-bottom: 0.35in;
      page-break-after: always;
      break-after: page;
      position: relative;
    }
    .page.last { page-break-after: auto; break-after: auto; }

    .slip-label-bar {
      background: #777;
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

    .page-footer {
      text-align: right;
      font-size: 9px;
      color: #666;
      margin-top: 8px;
      letter-spacing: 0.3px;
    }

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
    .logo { height: 90px; width: auto; }
    .logo-fallback { font-size: 22px; font-weight: 900; color: #1a3a8f; }

    .info-row { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
    .ship-to { font-size: 11px; line-height: 1.5; flex: 1; }
    .section-label { font-weight: bold; display: block; margin-bottom: 2px; }
    .missing-addr { color: #999; font-style: italic; }
    .order-meta { text-align: right; font-size: 11px; }
    .order-meta table { border-collapse: collapse; }
    .order-meta td { padding: 1px 0 1px 10px; white-space: nowrap; }
    .ml { font-weight: bold; color: #555; text-align: right; }
    .mv { text-align: right; }

    .items { width: 100%; border-collapse: collapse; margin-top: 2px; }
    .items thead tr { background: #777; color: white; }
    .th-desc { text-align: left; padding: 4px 6px; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; }
    .th-qty  { text-align: right; padding: 4px 6px; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; width: 40px; }
    .items tbody tr { break-inside: avoid; page-break-inside: avoid; }
    .items tbody tr td { padding: 5px 6px; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
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

export default function PackingSlip({ orders }: PackingSlipProps) {
  return null;
}

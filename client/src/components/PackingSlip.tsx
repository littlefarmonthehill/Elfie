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
  // Open window immediately while still in the user-gesture context (before any await).
  // Calling window.open after an await loses the gesture context and iOS Safari blocks it.
  const printWindow = window.open('', '_blank', 'width=800,height=600');
  if (!printWindow) {
    alert('Please allow popups to print packing slips');
    return;
  }

  try {
    const logoDataUrl = await loadLogoDataUrl();
    const content = generatePackingSlipHTML(orders, logoDataUrl);

    printWindow.document.open();
    printWindow.document.write(content);
    printWindow.document.close();
    printWindow.focus();
    printWindow.addEventListener('afterprint', () => printWindow.close());
    // Small delay lets the document render before printing
    setTimeout(() => printWindow.print(), 200);
  } catch (e) {
    printWindow.close();
    throw e;
  }
}

function channelLabel(order: PackingSlipOrder): string {
  if (order.marketplace === 'BrickOwl') return 'BrickOwl';
  return 'BrickLink';
}

function generatePackingSlipHTML(orders: PackingSlipOrder[], logoDataUrl: string): string {
  // Each order is one natural-flow div. Items are NOT chunked — the browser
  // flows them across pages organically, which fills each page fully and avoids
  // the large blank gap at the bottom that comes from manually-forced page breaks.
  const orderDivs = orders.map((order, orderIdx) => {
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

    const rowsHTML = order.items.map((item: any) => {
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

    return `
      <div class="order${orderIdx === 0 ? ' first' : ''}">
        <div class="slip-label-bar"><span>Packing Slip</span></div>
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
        <table class="items">
          <thead>
            <tr>
              <th class="th-desc">Description</th>
              <th class="th-qty">Qty</th>
            </tr>
          </thead>
          <tbody>${rowsHTML}</tbody>
        </table>
        <div class="page-footer">${orderNum}</div>
      </div>
    `;
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Packing Slips</title>
  <style>
    /* @page handles margins uniformly on every printed page.
       Each order is one natural-flow div; the browser fills pages organically
       so there is no large blank gap at the bottom from under-filled page divs. */
    @page { size: letter portrait; margin: 0.3in; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: white;
      color: black;
      font-family: Arial, sans-serif;
      font-size: 11px;
    }

    /* Each order starts on a new page (except the first). */
    .order { page-break-before: always; break-before: page; }
    .order.first { page-break-before: auto; break-before: auto; }

    /* Repeat the column header on every printed page within a table. */
    .items thead { display: table-header-group; }

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
    .items tbody tr { break-inside: avoid-page; page-break-inside: avoid; }
    .items tbody tr td { padding: 5px 6px; border-bottom: 1px solid #e0e0e0; vertical-align: top; break-inside: avoid-page; page-break-inside: avoid; }
    .items tbody tr:last-child td { border-bottom: none; }
    .item-desc { text-align: left; }
    .item-qty  { text-align: right; font-weight: bold; white-space: nowrap; width: 40px; }
    .item-name { font-size: 11px; line-height: 1.4; }
    .item-meta { font-size: 10px; color: #555; margin-top: 2px; }
  </style>
</head>
<body>
  ${orderDivs.join('')}
</body>
</html>`;
}

export default function PackingSlip({ orders }: PackingSlipProps) {
  return null;
}

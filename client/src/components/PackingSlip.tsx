import planetLogo from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";

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

function cleanItemName(name: string, partNumber: string | null): string {
  if (!name) return name;
  if (!partNumber) return name;
  const prefix = `${partNumber} - `;
  if (name.startsWith(prefix)) {
    return name.slice(prefix.length);
  }
  return name;
}

export function printPackingSlips(orders: PackingSlipOrder[]) {
  const content = generatePackingSlipHTML(orders);
  const blob = new Blob([content], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  const printWindow = window.open(blobUrl, '_blank', 'width=800,height=600');
  if (!printWindow) {
    URL.revokeObjectURL(blobUrl);
    alert('Please allow popups to print packing slips');
    return;
  }

  printWindow.onload = () => {
    printWindow.addEventListener('afterprint', () => {
      printWindow.close();
      URL.revokeObjectURL(blobUrl);
    });
    printWindow.onafterprint = () => {
      printWindow.close();
      URL.revokeObjectURL(blobUrl);
    };
    setTimeout(() => {
      printWindow.print();
    }, 250);
  };
}

function generatePackingSlipHTML(orders: PackingSlipOrder[]): string {
  const pagesHTML = orders.map((order, orderIndex) => {
    const isLastPage = orderIndex === orders.length - 1;
    const { shipTo } = order;
    const hasAddress = shipTo.name || shipTo.street1 || shipTo.city;

    const itemsHTML = order.items.map((item: any) => {
      const displayName = cleanItemName(item.name, item.bricklinkPartNumber);
      const partLabel = item.bricklinkPartNumber ? ` (${item.bricklinkPartNumber})` : '';
      return `
        <tr class="item-row">
          <td class="item-desc">
            <div class="item-name">${displayName}${partLabel}</div>
            <div class="item-meta">${[item.colorName, item.condition].filter(Boolean).join(', ')}</div>
          </td>
          <td class="item-qty">${item.quantity}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="page-wrapper${isLastPage ? ' last-page' : ''}">
        <div class="packing-slip">

          <div class="slip-header">
            <div class="header-left">
              <img src="${planetLogo}" alt="PlanetBrick" class="slip-logo" />
              <div class="company-info">
                <div class="company-name">PlanetBrick.com</div>
                <div class="company-addr">PO Box 202</div>
                <div class="company-addr">Lanesboro, MN 55949</div>
              </div>
            </div>
            <div class="header-right">
              <div class="slip-title">Packing Slip</div>
              <table class="order-meta">
                <tr>
                  <td class="meta-label">Order #</td>
                  <td class="meta-value">${order.marketplace === 'BrickLink' ? '' : (order.marketplace === 'BrickOwl' ? 'BO ' : '')}${order.orderNumber}</td>
                </tr>
                <tr>
                  <td class="meta-label">Date</td>
                  <td class="meta-value">${order.orderDate ? new Date(order.orderDate).toLocaleDateString() : ''}</td>
                </tr>
                ${order.customerUsername ? `
                <tr>
                  <td class="meta-label">User</td>
                  <td class="meta-value">${order.customerUsername}</td>
                </tr>` : ''}
                <tr>
                  <td class="meta-label">Ship Date</td>
                  <td class="meta-value">${order.shipDate ? new Date(order.shipDate).toLocaleDateString() : ''}</td>
                </tr>
              </table>
            </div>
          </div>

          <div class="ship-to-section">
            <div class="ship-to-label">Ship To</div>
            <div class="ship-to-addr">
              ${hasAddress ? `
                ${shipTo.name ? `<div>${shipTo.name}</div>` : ''}
                ${shipTo.company ? `<div>${shipTo.company}</div>` : ''}
                ${shipTo.street1 ? `<div>${shipTo.street1}</div>` : ''}
                ${shipTo.street2 ? `<div>${shipTo.street2}</div>` : ''}
                <div>${[shipTo.city, shipTo.state ? `${shipTo.state}` : '', shipTo.postalCode].filter(Boolean).join(' ')}</div>
                ${shipTo.country && shipTo.country !== 'US' ? `<div>${shipTo.country}</div>` : ''}
              ` : '<div style="color:#999;font-style:italic">Address not available</div>'}
            </div>
          </div>

          <table class="items-table">
            <thead>
              <tr>
                <th class="th-desc">Description</th>
                <th class="th-qty">Qty</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHTML}
            </tbody>
          </table>

          <div class="slip-footer">
            Thank you for your order!
          </div>

        </div>
      </div>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Packing Slips</title>
      <style>
        @page {
          size: letter portrait;
          margin: 0.5in;
        }

        @media print {
          html, body { margin: 0; padding: 0; }
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
          background: white;
          color: black;
          font-family: Arial, sans-serif;
          font-size: 11px;
        }

        .page-wrapper {
          page-break-after: always;
          break-after: page;
          display: block;
          width: 100%;
        }

        .page-wrapper.last-page {
          page-break-after: auto;
          break-after: auto;
        }

        .packing-slip {
          width: 100%;
          display: block;
        }

        /* Header */
        .slip-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding-bottom: 10px;
          margin-bottom: 10px;
          border-bottom: 2px solid #333;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .slip-logo {
          height: 56px;
          width: auto;
        }

        .company-info {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .company-name {
          font-weight: bold;
          font-size: 12px;
        }

        .company-addr {
          font-size: 10px;
          color: #444;
        }

        .header-right {
          text-align: right;
        }

        .slip-title {
          font-size: 16px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 6px;
          color: #111;
        }

        .order-meta {
          border-collapse: collapse;
          text-align: right;
        }

        .order-meta tr td {
          padding: 1px 0 1px 12px;
          font-size: 11px;
        }

        .meta-label {
          font-weight: bold;
          white-space: nowrap;
          color: #555;
          padding-right: 4px !important;
        }

        .meta-value {
          white-space: nowrap;
        }

        /* Ship To */
        .ship-to-section {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
          align-items: flex-start;
        }

        .ship-to-label {
          font-weight: bold;
          font-size: 11px;
          white-space: nowrap;
          padding-top: 1px;
          min-width: 48px;
        }

        .ship-to-addr {
          font-size: 11px;
          line-height: 1.5;
        }

        /* Items table */
        .items-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 12px;
        }

        .items-table thead tr {
          background: #333;
          color: white;
        }

        .th-desc, .th-qty {
          padding: 4px 6px;
          font-size: 10px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .th-desc { text-align: left; }
        .th-qty { text-align: right; width: 40px; }

        .item-row td {
          padding: 5px 6px;
          border-bottom: 1px solid #e0e0e0;
          vertical-align: top;
        }

        .item-row:last-child td {
          border-bottom: none;
        }

        .item-desc { text-align: left; }
        .item-qty { text-align: right; font-weight: bold; white-space: nowrap; }

        .item-name {
          font-size: 11px;
          line-height: 1.4;
        }

        .item-meta {
          font-size: 10px;
          color: #555;
          margin-top: 1px;
        }

        .slip-footer {
          border-top: 1px solid #ddd;
          padding-top: 6px;
          font-size: 10px;
          color: #444;
        }
      </style>
    </head>
    <body>
      ${pagesHTML}
    </body>
    </html>
  `;
}

export default function PackingSlip({ orders }: PackingSlipProps) {
  return null;
}

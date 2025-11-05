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

// Function to open packing slips in a new print window
export function printPackingSlips(orders: PackingSlipOrder[]) {
  // Debug: Log order details
  orders.forEach((order, idx) => {
    console.log(`Order ${idx + 1}: ${order.orderNumber} with ${order.items.length} items`);
  });
  
  const printWindow = window.open('', '_blank', 'width=800,height=600');
  if (!printWindow) {
    alert('Please allow popups to print packing slips');
    return;
  }

  const content = generatePackingSlipHTML(orders);
  printWindow.document.write(content);
  printWindow.document.close();
  
  // Wait for images to load, then print
  printWindow.onload = () => {
    // Add event listener to close window after print
    printWindow.addEventListener('afterprint', () => {
      printWindow.close();
    });
    
    // Fallback for browsers that don't support afterprint
    printWindow.onafterprint = () => {
      printWindow.close();
    };
    
    setTimeout(() => {
      printWindow.print();
    }, 250);
  };
}

// Generate the complete HTML document for printing
function generatePackingSlipHTML(orders: PackingSlipOrder[]): string {
  // Generate HTML for each order (one slip per order)
  const pagesHTML = orders.map((order, orderIndex) => {
    const isLastPage = orderIndex === orders.length - 1;
    
    return `
      <div class="page-wrapper${isLastPage ? ' last-page' : ''}">
        <div class="packing-slip">
          <div class="slip-header">
            <img src="${planetLogo}" alt="PlanetBrick" class="slip-logo" />
            <div class="slip-title">
              <h1>PACKING SLIP</h1>
            </div>
          </div>

          <div class="slip-section">
            <div class="slip-info-row">
              <div>
                <span class="slip-label">Order:</span>
                <span class="slip-value">${order.orderNumber}</span>
              </div>
              <div>
                <span class="slip-label">Ship Date:</span>
                <span class="slip-value">${order.shipDate ? new Date(order.shipDate).toLocaleDateString() : 'Pending'}</span>
              </div>
            </div>
          </div>

          <div class="slip-section">
            <div class="slip-label-header">SHIP TO:</div>
            <div class="slip-address">
              ${order.shipTo.name ? `<div>${order.shipTo.name}</div>` : ''}
              ${order.shipTo.company ? `<div>${order.shipTo.company}</div>` : ''}
              ${order.shipTo.street1 ? `<div>${order.shipTo.street1}</div>` : ''}
              ${order.shipTo.street2 ? `<div>${order.shipTo.street2}</div>` : ''}
              <div>
                ${order.shipTo.city ? `${order.shipTo.city}, ` : ''}
                ${order.shipTo.state ? `${order.shipTo.state} ` : ''}
                ${order.shipTo.postalCode || ''}
              </div>
              ${order.shipTo.country ? `<div>${order.shipTo.country}</div>` : ''}
            </div>
          </div>

          <div class="slip-section slip-items">
            <div class="slip-label-header">ITEMS:</div>
            <div class="slip-items-list">
              ${order.items.map((item: any) => `
                <div class="slip-item">
                  <div class="slip-item-line1">
                    <span class="slip-sku">${item.inventoryId || '-'}</span>
                    <span class="slip-part-name">${item.bricklinkPartNumber || '-'}: ${item.name}</span>
                    <span class="slip-qty">Qty: ${item.quantity}</span>
                  </div>
                  <div class="slip-item-line2">
                    ${item.colorName ? `<span>${item.colorName}</span>` : ''}
                    ${item.colorName && item.condition ? '<span> • </span>' : ''}
                    ${item.condition ? `<span>${item.condition}</span>` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="slip-footer">
            <div class="slip-footer-left">Thank you for your order!</div>
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
          margin: 0;
        }
        
        @media print {
          @page {
            margin: 0;
          }
          body {
            margin: 0;
          }
        }
        
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          background: white;
          color: black;
          font-family: Arial, sans-serif;
        }
        
        .page-wrapper {
          page-break-after: always;
          page-break-inside: avoid;
          break-after: page;
          break-inside: avoid;
          display: block;
          width: 100%;
          padding: 0.2in 0.3in;
        }
        
        .page-wrapper.last-page {
          page-break-after: auto;
          break-after: auto;
        }
        
        /* Each slip is a separate page - printer's "2 per page" handles the layout */
        .packing-slip {
          page-break-inside: avoid;
          break-inside: avoid;
          width: 100%;
          display: block;
        }
        
        .slip-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 0.3rem;
          border-bottom: 2px solid #000;
          margin-bottom: 0.5rem;
        }
        
        .slip-logo {
          height: 60px;
          width: auto;
        }
        
        .slip-title h1 {
          font-size: 18px;
          font-weight: bold;
          margin: 0;
        }
        
        .slip-section {
          margin-bottom: 0.5rem;
        }
        
        .slip-info-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 0.2rem;
          font-size: 12px;
        }
        
        .slip-label {
          font-weight: bold;
          margin-right: 0.5rem;
        }
        
        .slip-value {
          font-weight: normal;
        }
        
        .slip-continuation-info {
          font-size: 11px;
          color: #666;
          text-align: right;
          font-style: italic;
        }
        
        .slip-label-header {
          font-weight: bold;
          font-size: 13px;
          margin-bottom: 0.3rem;
        }
        
        .slip-address {
          font-size: 12px;
          line-height: 1.4;
        }
        
        .slip-items {
          flex: 1;
        }
        
        .slip-items-list {
          display: block;
          width: 100%;
        }
        
        .slip-item {
          display: block;
          width: 100%;
          padding: 0.25rem 0;
          border-bottom: 1px solid #ddd;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
        
        .slip-item:last-child {
          border-bottom: none;
        }
        
        .slip-item-line1 {
          display: flex;
          gap: 0.75rem;
          margin-bottom: 0.15rem;
          font-size: 11px;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        
        .slip-sku {
          font-weight: bold;
          width: 80px;
          flex-shrink: 0;
        }
        
        .slip-part-name {
          flex: 1;
        }
        
        .slip-qty {
          font-weight: bold;
          white-space: nowrap;
        }
        
        .slip-item-line2 {
          display: block;
          font-size: 10px;
          color: #666;
          padding-left: 92px;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        
        .slip-footer {
          padding-top: 0.3rem;
          border-top: 1px solid #ddd;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 10px;
          margin-top: 0.5rem;
        }
        
        .slip-footer-left {
          font-size: 10px;
          color: #333;
        }
        
        .slip-page-number {
          font-size: 10px;
          color: #666;
        }
      </style>
    </head>
    <body>
      ${pagesHTML}
    </body>
    </html>
  `;
}

// React component is not used - packing slips are generated via printPackingSlips() function
export default function PackingSlip({ orders }: PackingSlipProps) {
  return null;
}

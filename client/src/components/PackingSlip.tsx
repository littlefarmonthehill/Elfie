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

// Split items across slips only for very large orders (for picker convenience)
function paginateItems(items: any[], itemsPerPage: number = 50) {
  const pages = [];
  for (let i = 0; i < items.length; i += itemsPerPage) {
    pages.push(items.slice(i, i + itemsPerPage));
  }
  return pages;
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
  // Build all slips across all orders and track total page count
  const allSlips: Array<{
    order: PackingSlipOrder;
    pageItems: any[];
    slipIndex: number;
    totalSlipsInOrder: number;
  }> = [];
  
  orders.forEach((order) => {
    const pages = paginateItems(order.items);
    console.log(`Order ${order.orderNumber}: ${order.items.length} items → ${pages.length} slips`);
    
    pages.forEach((pageItems, slipIndex) => {
      allSlips.push({
        order,
        pageItems,
        slipIndex,
        totalSlipsInOrder: pages.length
      });
      console.log(`  Slip ${slipIndex + 1}/${pages.length}: ${pageItems.length} items`);
    });
  });
  
  const totalPages = allSlips.length;
  console.log(`Total pages: ${totalPages}`);

  // Generate HTML for each page
  const pagesHTML = allSlips.map((slip, pageIndex) => {
    const isLastPage = pageIndex === totalPages - 1;
    
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
                <span class="slip-value">${slip.order.orderNumber}</span>
              </div>
              <div>
                <span class="slip-label">Ship Date:</span>
                <span class="slip-value">${slip.order.shipDate ? new Date(slip.order.shipDate).toLocaleDateString() : 'Pending'}</span>
              </div>
            </div>
            ${slip.totalSlipsInOrder > 1 ? `<div class="slip-continuation-info">Slip ${slip.slipIndex + 1} of ${slip.totalSlipsInOrder}</div>` : ''}
          </div>

          <div class="slip-section">
            <div class="slip-label-header">SHIP TO:</div>
            <div class="slip-address">
              ${slip.order.shipTo.name ? `<div>${slip.order.shipTo.name}</div>` : ''}
              ${slip.order.shipTo.company ? `<div>${slip.order.shipTo.company}</div>` : ''}
              ${slip.order.shipTo.street1 ? `<div>${slip.order.shipTo.street1}</div>` : ''}
              ${slip.order.shipTo.street2 ? `<div>${slip.order.shipTo.street2}</div>` : ''}
              <div>
                ${slip.order.shipTo.city ? `${slip.order.shipTo.city}, ` : ''}
                ${slip.order.shipTo.state ? `${slip.order.shipTo.state} ` : ''}
                ${slip.order.shipTo.postalCode || ''}
              </div>
              ${slip.order.shipTo.country ? `<div>${slip.order.shipTo.country}</div>` : ''}
            </div>
          </div>

          <div class="slip-section slip-items">
            <div class="slip-label-header">ITEMS:</div>
            <div class="slip-items-list">
              ${slip.pageItems.map((item: any) => `
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
            <div class="slip-footer-text">Thank you for your order!</div>
            <div class="slip-footer-text">Questions? Contact us at orders@planetbrick.com</div>
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
          text-align: center;
          font-size: 10px;
          margin-top: 0.5rem;
        }
        
        .slip-footer-text {
          margin: 0.1rem 0;
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
  return (
    <div className="print-container">
      {orders.flatMap((order) => {
        const pages = paginateItems(order.items);
        return pages.map((pageItems, pageIndex) => (
          <div 
            key={`${order.orderNumber}-page-${pageIndex}`}
            className="packing-slip"
          >
            {/* Header with Logo */}
            <div className="slip-header">
              <img 
                src={planetLogo} 
                alt="PlanetBrick" 
                className="slip-logo"
              />
              <div className="slip-title">
                <h1>PACKING SLIP</h1>
              </div>
            </div>

            {/* Order Info */}
            <div className="slip-section">
              <div className="slip-info-row">
                <div>
                  <span className="slip-label">Order:</span>
                  <span className="slip-value">{order.orderNumber}</span>
                </div>
                <div>
                  <span className="slip-label">Ship Date:</span>
                  <span className="slip-value">
                    {order.shipDate ? new Date(order.shipDate).toLocaleDateString() : 'Pending'}
                  </span>
                </div>
              </div>
              {pages.length > 1 && (
                <div className="slip-page-info">
                  Page {pageIndex + 1} of {pages.length}
                </div>
              )}
            </div>

            {/* Ship To Address */}
            <div className="slip-section">
              <div className="slip-label-header">SHIP TO:</div>
              <div className="slip-address">
                {order.shipTo.name && <div>{order.shipTo.name}</div>}
                {order.shipTo.company && <div>{order.shipTo.company}</div>}
                {order.shipTo.street1 && <div>{order.shipTo.street1}</div>}
                {order.shipTo.street2 && <div>{order.shipTo.street2}</div>}
                <div>
                  {order.shipTo.city && `${order.shipTo.city}, `}
                  {order.shipTo.state && `${order.shipTo.state} `}
                  {order.shipTo.postalCode}
                </div>
                {order.shipTo.country && <div>{order.shipTo.country}</div>}
              </div>
            </div>

            {/* Items List */}
            <div className="slip-section slip-items">
              <div className="slip-label-header">ITEMS:</div>
              <div className="slip-items-list">
                {pageItems.map((item, idx) => (
                  <div key={idx} className="slip-item">
                    <div className="slip-item-line1">
                      <span className="slip-sku">{item.inventoryId || '-'}</span>
                      <span className="slip-part-name">
                        {item.bricklinkPartNumber || '-'}: {item.name}
                      </span>
                      <span className="slip-qty">Qty: {item.quantity}</span>
                    </div>
                    <div className="slip-item-line2">
                      {item.colorName && <span>{item.colorName}</span>}
                      {item.colorName && item.condition && <span> • </span>}
                      {item.condition && <span>{item.condition}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="slip-footer">
              <div>Thank you for your order!</div>
              <div className="slip-company">PlanetBrick.com</div>
              <div className="slip-company-address">PO Box 202, Lanesboro, MN 55949</div>
            </div>
          </div>
        ));
      })}

      <style>{`
        @media print {
          @page {
            size: letter portrait;
            margin: 0.5in;
          }
          
          body * {
            visibility: hidden;
          }
          
          .print-container,
          .print-container * {
            visibility: visible;
          }
          
          .print-container {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          
          .packing-slip {
            page-break-after: always;
            page-break-inside: avoid;
            width: 100%;
            background: white;
            color: black;
            border: none;
            margin: 0;
            padding: 0;
          }
          
          .packing-slip:last-child {
            page-break-after: auto;
          }
        }

        .packing-slip {
          width: 8in;
          max-width: 100%;
          min-height: 10in;
          padding: 0.75in;
          background: white;
          color: black;
          font-family: Arial, sans-serif;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          border: 1px solid #ddd;
          margin: 0 auto 1rem auto;
        }

        .slip-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.15in;
          padding-bottom: 0.1in;
          border-bottom: 2px solid #000;
        }

        .slip-logo {
          height: 0.4in;
          width: auto;
        }

        .slip-title h1 {
          margin: 0;
          font-size: 16pt;
          font-weight: bold;
        }

        .slip-section {
          margin-bottom: 0.12in;
        }

        .slip-info-row {
          display: flex;
          justify-content: space-between;
          font-size: 10pt;
        }

        .slip-page-info {
          text-align: center;
          font-size: 9pt;
          color: #666;
          margin-top: 0.04in;
        }

        .slip-label {
          font-weight: bold;
          margin-right: 0.1in;
        }

        .slip-value {
          font-family: 'Courier New', monospace;
        }

        .slip-label-header {
          font-weight: bold;
          font-size: 10pt;
          margin-bottom: 0.05in;
        }

        .slip-address {
          font-size: 9pt;
          line-height: 1.3;
        }

        .slip-items {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .slip-items-list {
          flex: 1;
          overflow: hidden;
        }

        .slip-item {
          margin-bottom: 0.08in;
          padding-bottom: 0.06in;
          border-bottom: 1px solid #ddd;
        }

        .slip-item:last-child {
          border-bottom: none;
        }

        .slip-item-line1 {
          display: flex;
          align-items: baseline;
          gap: 0.08in;
          font-size: 8pt;
          margin-bottom: 0.03in;
        }

        .slip-sku {
          font-family: 'Courier New', monospace;
          font-weight: bold;
          min-width: 0.6in;
          font-size: 8pt;
        }

        .slip-part-name {
          flex: 1;
          font-size: 8pt;
        }

        .slip-qty {
          font-weight: bold;
          white-space: nowrap;
          font-size: 8pt;
        }

        .slip-item-line2 {
          font-size: 7pt;
          color: #666;
          padding-left: 0.68in;
        }

        .slip-footer {
          margin-top: auto;
          padding-top: 0.1in;
          border-top: 1px solid #ddd;
          text-align: center;
          font-size: 8pt;
          line-height: 1.4;
        }

        .slip-company {
          font-weight: bold;
          font-size: 9pt;
          margin-top: 0.03in;
        }

        .slip-company-address {
          color: #666;
        }
      `}</style>
    </div>
  );
}
